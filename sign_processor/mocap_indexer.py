# Voicible — Mocap archive indexing microservice / "Every voice, made visible."
#
# Scans the REAL SLMocapArchive layout and builds an in-memory index of
# word -> newest-dated sign entry.
#
# IMPORTANT — real archive structure (confirmed by inspecting the actual
# StudioGalt/Sign-Language-Mocap-Archive repo, which differs from a naive
# "one JSON file per sign" assumption):
#
#   <SG ASL Dictionary|SG ASL Fingerspelling>/
#     <bucket dir, e.g. "ASL A".."ASL Z", "Letters", "Letters-Old",
#      "Numbers", "Numbers-Old" — arbitrary, not relied upon>/
#       "SG ASL <Word> [<variant tag>] <date> Upload"/
#         Documentation/
#           "... ReadMe.txt"       <- lists each KeyPose's frame number
#           "... ShapeKeys.txt"    <- sparse FACS Action-Unit keyframe
#                                     curves (facial data lives ONLY here,
#                                     never inside the bone JSON itself)
#         Poses/
#           JSON/
#             "jpm_SG_ASL_<Word>_<date>_P<N>.json"  <- ONE static keypose
#                                     per file (Blender "Json Pose Manager"
#                                     export), NOT a baked animation. A
#                                     sign's motion is the interpolation
#                                     BETWEEN its ordered P1..Pn keyposes.
#           "*.blend"               <- ignored, not needed for playback
#         "FBX Files/..."           <- ignored, we use the JSON poses
#
# A single JSON keypose file's top level is a list containing ONE object:
#   [ { "addon": "jpm", "name": "...", "bones": [
#         { "name": "pelvis",
#           "location": {"vector": [x,y,z]},
#           "rotation": {"vector": [w,x,y,z], "mode": "QUATERNION"},
#           "scale":    {"vector": [x,y,z]} },
#         ... ~391 bones, deform + FK/IK/control layers ...
#   ] } ]
# Note the Blender quaternion component order is (w, x, y, z) — callers
# converting to other engines (e.g. three.js, which expects x,y,z,w) must
# reorder.
#
# Because a sign is now a *sequence* of keyposes rather than a single
# file, /lookup and /sequence return a `keyposes` list (ordered, each with
# its target frame from ReadMe.txt) plus `shapeKeyCurves` (sparse
# frame/value pairs per FACS Action Unit) instead of one `poseFile`.
#
# As with the original design: only the newest dated version of any given
# word/letter is retained (the archive's own stated convention — corrected
# signs are added under a new date, old ones are not deleted).
#
# Endpoints:
#   GET /lookup?word=HELLO
#   GET /sequence?gloss=HELLO+CHURCH+TODAY
#   GET /words
#   POST /reindex
#   GET /health

import os
import re
import json
import glob
import threading
import logging
from datetime import datetime

from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format="[Voicible:indexer] %(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("mocap_indexer")

app = Flask(__name__)

MOCAP_ARCHIVE_PATH = os.environ.get("MOCAP_ARCHIVE_PATH", "./data/mocap-archive")
DICTIONARY_SUBDIR = os.environ.get("SG_DICTIONARY_SUBDIR", "SG ASL Dictionary")
FINGERSPELLING_SUBDIR = os.environ.get("SG_FINGERSPELLING_SUBDIR", "SG ASL Fingerspelling")
INDEXER_PORT = int(os.environ.get("MOCAP_INDEXER_PORT", "5001"))

# Matches an "Upload" folder name, e.g.:
#   "SG ASL Billboard 2024-4-16 Upload"
#   "SG ASL Any (Alt) 2024-10-12 Upload"
#   "SG ASL Church Alt 2025-1-22 Upload"
# Group 1 = the word/phrase plus any variant tags, Group 2 = the date
# (month/day may be one or two digits in this archive).
UPLOAD_FOLDER_PATTERN = re.compile(r"^SG ASL (.+?) (\d{4}-\d{1,2}-\d{1,2}) Upload$")

# Matches a keypose JSON filename, e.g. "jpm_SG_ASL_Billboard_2024-4-16_P3.json"
KEYPOSE_FILENAME_PATTERN = re.compile(r"_P(\d+)\.json$", re.IGNORECASE)

# Tokens that denote a variant/take rather than part of the actual word,
# stripped from the END of the word-and-tags group (iteratively) so that
# e.g. "Hello Var Ext" and "Church Alt" collapse to their base word while
# a genuinely different multi-word phrase like "Church Teaching" does not.
VARIANT_TAG_TOKENS = {"ALT", "VAR", "VARIANT", "EXT"}

KEYPOSE_FRAME_PATTERN = re.compile(r"KeyPose\s+(\d+):\s*\n\s*Frame:\s*(\d+)", re.IGNORECASE)
SHAPEKEY_NAME_LINE = re.compile(r"^\s*\d+\.\s+(\S+)")
SHAPEKEY_FRAME_VALUE = re.compile(r"Frame:\s*(\d+),\s*Value:\s*([\-0-9.]+)")

# Global index state, guarded by a lock since /reindex can be triggered
# concurrently with in-flight /lookup or /sequence requests.
_index_lock = threading.Lock()
_word_index = {}          # WORD -> entry dict (dictionary signs)
_letter_index = {}        # letter/number -> entry dict (fingerspelling)
_index_built_at = None
_index_stats = {"wordsIndexed": 0, "lettersIndexed": 0}


FUSED_LETTER_VARIANT_PATTERN = re.compile(r"^([A-Za-z])\d+$")


def _canonicalize(raw, is_fingerspelling=False):
    """Turns an Upload folder's word-and-tags group into a canonical
    lookup key: strips parenthetical annotations entirely, then strips
    trailing variant-tag tokens (Alt/Var/Variant/Ext) and bare trailing
    take/variant numbers, stopping at the first token that isn't one of
    those (so multi-word phrases like "Church Teaching" stay intact).
    For fingerspelling only, also collapses a single letter fused with
    its take number with no separating space (e.g. archive folder "P2"
    meaning letter P, take 2) down to the bare letter — a naming quirk
    isolated to this dataset that would be unsafe to apply to dictionary
    words (e.g. a real word like "K9")."""
    no_parens = re.sub(r"\(.*?\)", "", raw).strip()
    tokens = no_parens.split()
    while tokens and (tokens[-1].upper() in VARIANT_TAG_TOKENS or tokens[-1].isdigit()):
        tokens.pop()
    if is_fingerspelling and len(tokens) == 1:
        m = FUSED_LETTER_VARIANT_PATTERN.match(tokens[0])
        if m:
            tokens[0] = m.group(1)
    return " ".join(tokens).upper()


def _parse_readme_frames(readme_path):
    """Extracts {keypose_index: frame_number} from a ReadMe.txt, e.g.:
        KeyPose 1:
        Frame: 53
        ...
    Returns {} if the file is missing or doesn't match the expected
    format — callers fall back to even spacing in that case."""
    frames = {}
    try:
        with open(readme_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        for match in KEYPOSE_FRAME_PATTERN.finditer(text):
            idx, frame = match.groups()
            frames[int(idx)] = int(frame)
    except Exception as e:
        log.warning(f"Could not parse ReadMe.txt at {readme_path}: {e}")
    return frames


def _parse_shapekey_curves(shapekeys_path):
    """Extracts sparse FACS Action-Unit keyframe curves from a
    ShapeKeys.txt, e.g.:
        41. EyesCloseR_AU43_R
            Frame: 1, Value: 0.0
            Frame: 31, Value: 1.0
    Returns { shapekeyName: [[frame, value], ...] } including only
    shapekeys that actually have keyframes (most signs leave most FACS
    AUs untouched — see the archive's own FAQ on this)."""
    curves = {}
    current_name = None
    try:
        with open(shapekeys_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                name_match = SHAPEKEY_NAME_LINE.match(line)
                if name_match:
                    current_name = name_match.group(1)
                    continue
                value_match = SHAPEKEY_FRAME_VALUE.search(line)
                if value_match and current_name:
                    frame, value = value_match.groups()
                    curves.setdefault(current_name, []).append([int(frame), float(value)])
    except Exception as e:
        log.warning(f"Could not parse ShapeKeys.txt at {shapekeys_path}: {e}")
    return curves


def _build_entry(upload_dir, word, date_version):
    """Builds a full sign entry for one Upload folder: ordered keyposes
    (file + target frame), facial shapekey curves, and summary stats."""
    keypose_files = []
    for filepath in glob.glob(os.path.join(upload_dir, "**", "*.json"), recursive=True):
        basename = os.path.basename(filepath)
        if "metarig" in basename.lower():
            # Auxiliary A-pose/T-pose retargeting reference files, not real
            # keyposes — they happen to share the "_P<N>.json" suffix
            # convention (seen starting with the "Diabetes Alt" 2026-6-29
            # upload), so they'd otherwise be miscounted as 3x the actual
            # keyposes and corrupt playback timing.
            continue
        m = KEYPOSE_FILENAME_PATTERN.search(basename)
        if m:
            keypose_files.append((int(m.group(1)), filepath))
    keypose_files.sort(key=lambda t: t[0])

    readme_matches = glob.glob(os.path.join(upload_dir, "**", "*ReadMe.txt"), recursive=True)
    shapekeys_matches = glob.glob(os.path.join(upload_dir, "**", "*ShapeKeys.txt"), recursive=True)

    frame_map = _parse_readme_frames(readme_matches[0]) if readme_matches else {}
    shape_curves = _parse_shapekey_curves(shapekeys_matches[0]) if shapekeys_matches else {}

    keyposes = []
    for i, (p_index, filepath) in enumerate(keypose_files):
        # Prefer the ReadMe.txt's documented frame number; fall back to
        # even 30-frame spacing (half a second at 60fps) if it's missing
        # or incomplete, so playback still has sane relative timing.
        frame = frame_map.get(p_index, i * 30)
        keyposes.append({"index": p_index, "file": filepath, "frame": frame})

    # IMPORTANT: the P<N> file-numbering order is the order the animator
    # POSED the keyposes in Blender, which is NOT necessarily chronological
    # — e.g. a real sign in this archive has KeyPose 1 at frame 64, KeyPose
    # 2 at frame 44, KeyPose 3 at frame 27, KeyPose 4 at frame 85. Playback
    # must proceed in increasing frame/time order regardless of P-number,
    # so we sort by frame here. `index` (the original P-number) is kept
    # only for traceability/logging.
    keyposes.sort(key=lambda kp: kp["frame"])

    total_frames = max(
        [kp["frame"] for kp in keyposes] + [f for curve in shape_curves.values() for f, _ in curve] + [0]
    )

    return {
        "word": word,
        "dateVersion": date_version,
        "uploadFolder": upload_dir,
        "keyposes": keyposes,
        "shapeKeyCurves": shape_curves,
        "hasFacialData": len(shape_curves) > 0,
        "totalFrames": total_frames,
    }


def _scan_folder(root_path, is_fingerspelling=False):
    """Walks a folder tree looking for "SG ASL <word> <date> Upload"
    directories at any depth, building word -> entry, keeping only the
    newest dated version of each canonical word that actually has
    exported pose data."""
    found = {}
    if not os.path.isdir(root_path):
        log.warning(f"Archive subfolder not found, skipping: {root_path}")
        return found

    for dirpath, dirnames, _filenames in os.walk(root_path):
        for dirname in dirnames:
            m = UPLOAD_FOLDER_PATTERN.match(dirname)
            if not m:
                continue
            raw_word, date_str = m.groups()
            word = _canonicalize(raw_word, is_fingerspelling=is_fingerspelling)
            if not word:
                continue

            try:
                y, mo, d = (int(x) for x in date_str.split("-"))
                date_version = datetime(y, mo, d)
            except ValueError:
                log.warning(f"Unparseable date '{date_str}' in folder '{dirname}', skipping")
                continue

            upload_dir = os.path.join(dirpath, dirname)
            entry = _build_entry(upload_dir, word, date_version.date().isoformat())
            if not entry["keyposes"]:
                # Archive entry has no exported Poses/JSON (source .blend
                # never got exported) — unusable for playback. Skip it so
                # it can never win over a real version, and so the word
                # falls back to fingerspelling if no version has poses.
                log.warning(f"Skipping '{dirname}': no exported pose JSON, entry would be unusable")
                continue

            existing = found.get(word)
            if existing is not None and date_version <= existing["_comparable"]:
                continue  # an already-indexed newer (or equal) version wins

            entry["_comparable"] = date_version
            found[word] = entry

    return found


def build_index():
    """Scan the dictionary and fingerspelling folders and rebuild the
    in-memory index. Only the newest dated version of each word/letter
    is retained, per the archive's versioning convention."""
    global _word_index, _letter_index, _index_built_at, _index_stats

    dict_root = os.path.join(MOCAP_ARCHIVE_PATH, DICTIONARY_SUBDIR)
    fingerspelling_root = os.path.join(MOCAP_ARCHIVE_PATH, FINGERSPELLING_SUBDIR)

    log.info(f"Indexing dictionary signs from: {dict_root}")
    new_word_index = _scan_folder(dict_root)

    log.info(f"Indexing fingerspelling letters/numbers from: {fingerspelling_root}")
    new_letter_index = _scan_folder(fingerspelling_root, is_fingerspelling=True)

    with _index_lock:
        _word_index = new_word_index
        _letter_index = new_letter_index
        _index_built_at = datetime.utcnow().isoformat() + "Z"
        _index_stats = {
            "wordsIndexed": len(new_word_index),
            "lettersIndexed": len(new_letter_index),
        }

    log.info(
        f"Index built: {_index_stats['wordsIndexed']} dictionary signs, "
        f"{_index_stats['lettersIndexed']} fingerspelling letters/numbers"
    )


def _public_entry(entry):
    """Strips internal-only fields (the sort key) before returning an
    entry over the API."""
    return {k: v for k, v in entry.items() if k != "_comparable"}


def _fingerspell(word):
    """Breaks a word into individual letters and looks each up in the
    fingerspelling index. Non-alphanumeric characters (already hyphenated
    gloss like S-A-N-C-T-I-F-I-C-A-T-I-O-N) are split on hyphens first."""
    clean = word.replace("-", "")
    letters = []
    for ch in clean.upper():
        entry = _letter_index.get(ch)
        letters.append({
            "letter": ch,
            "found": entry is not None,
            **({"entry": _public_entry(entry)} if entry else {}),
        })
    return letters


def _lookup_word(word):
    """Core lookup logic shared by /lookup and /sequence. Returns a dict
    describing whether the word was found as a full dictionary sign,
    had to fall back to fingerspelling, or was not resolvable at all."""
    word = (word or "").strip().upper()
    if not word:
        return {"found": False, "word": word, "isFingerspelled": False, "notFound": True}

    with _index_lock:
        entry = _word_index.get(word)

    if entry:
        log.info(f"LOOKUP {word}: found dictionary sign (version={entry['dateVersion']}, {len(entry['keyposes'])} keyposes)")
        return {"found": True, "word": word, "isFingerspelled": False, **_public_entry(entry)}

    # Not in dictionary — attempt fingerspelling fallback.
    letters = _fingerspell(word)
    all_letters_found = all(l["found"] for l in letters) if letters else False

    if all_letters_found:
        log.info(f"LOOKUP {word}: not in dictionary, fingerspelled ({len(letters)} letters)")
    else:
        log.warning(f"LOOKUP {word}: NOT FOUND — no dictionary sign and incomplete fingerspelling")

    return {
        "found": all_letters_found,
        "word": word,
        "isFingerspelled": True,
        "letters": letters,
        "notFound": not all_letters_found,
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "service": "Voicible mocap_indexer",
        "status": "ok",
        "archivePath": MOCAP_ARCHIVE_PATH,
        "indexBuiltAt": _index_built_at,
        "stats": _index_stats,
    })


@app.route("/lookup", methods=["GET"])
def lookup():
    return jsonify(_lookup_word(request.args.get("word", "")))


@app.route("/sequence", methods=["GET"])
def sequence():
    gloss = request.args.get("gloss", "")
    words = [w for w in re.split(r"[+\s]+", gloss.strip()) if w]
    results = [_lookup_word(w) for w in words]

    found_count = sum(1 for r in results if r["found"] and not r.get("isFingerspelled"))
    fingerspelled_count = sum(1 for r in results if r["found"] and r.get("isFingerspelled"))
    missing_count = sum(1 for r in results if not r["found"])
    total = len(results) or 1

    coverage = {
        "total": len(results),
        "found": found_count,
        "fingerspelled": fingerspelled_count,
        "missing": missing_count,
        "percentFound": round(100 * (found_count + fingerspelled_count) / total, 1),
    }

    log.info(
        f"SEQUENCE '{gloss}' -> coverage {coverage['percentFound']}% "
        f"({found_count} signed, {fingerspelled_count} fingerspelled, {missing_count} missing)"
    )

    return jsonify({"gloss": gloss, "words": results, "coverage": coverage})


@app.route("/words", methods=["GET"])
def words():
    """Returns the full list of currently indexed dictionary words (not
    fingerspelling letters). Used by the Node server's fuzzy-matching
    layer (fuse.js) to correct near-miss gloss words before falling back
    to fingerspelling."""
    with _index_lock:
        word_list = sorted(_word_index.keys())
    return jsonify({"words": word_list, "count": len(word_list)})


@app.route("/reindex", methods=["POST"])
def reindex():
    build_index()
    return jsonify({"status": "reindexed", "indexBuiltAt": _index_built_at, "stats": _index_stats})


if __name__ == "__main__":
    print("=" * 60)
    print("  Voicible — Mocap Archive Indexer")
    print('  "Every voice, made visible."')
    print("=" * 60)
    build_index()
    app.run(host="0.0.0.0", port=INDEXER_PORT)
