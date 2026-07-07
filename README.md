# Voicible

**Real-time speech-to-sign-language interpretation, powered by real motion-capture ASL data.**

> "Every voice, made visible."

Voicible listens to live audio, transcribes it, converts it to ASL gloss, and animates a 3D avatar using **real motion-capture sign data** — not AI-generated or synthesized pose estimation. First deployment target is live sermon interpretation at a church, designed to scale to conferences, hospitals, schools, and courts. It runs entirely on a local machine with zero paid API dependency by default; cloud STT (Azure Speech) and cloud LLM (Azure OpenAI) are supported as optional configurable upgrades.

A small **real** slice of the archive (the actual `HELLO` and `CHURCH` signs, plus the fingerspelling letters T/H/A/N/K/Y/O/U) ships in `data/mocap-archive/` so you can run Phase 1 immediately without cloning anything. See "Getting the rest of the archive data" below for the full set.

---

## Why this exists (and what changed from the previous version)

The earlier version of this project asked an LLM to synthesize novel ASL pose sequences from scratch. Deaf reviewers found the output unreliable — often gibberish. Voicible replaces that entirely:

**Old (deprecated):** Text → LLM generates gloss → LLM/model synthesizes novel poses → avatar.

**New (this version):** Text → LLM converts to gloss (word choice + ASL grammar order only) → each gloss word is looked up in a real motion-capture dictionary → matching clips are stitched together with transition blending → the avatar plays back **real human motion**. Words missing from the dictionary fall back to fingerspelling using real captured letter clips. The LLM never generates motion — motion always comes from real mocap data or fingerspelling.

---

## Credit

Sign motion data from the **SLMocapArchive** by Studio Galt, used under CC0 license:
[github.com/StudioGalt/Sign-Language-Mocap-Archive](https://github.com/StudioGalt/Sign-Language-Mocap-Archive)

CC0 doesn't legally require this credit, but the archive represents real, professionally captured human motion and crediting it is the right thing to do. This line appears on the display screen footer and here in the README, per Voicible's branding requirements.

---

## Important, honest limitations

**Motion accuracy vs. linguistic correctness.** The SLMocapArchive gives us **accurate motion** — captured at 240fps with an Xsens Link mocap suit and StretchSense gloves (posted at 60fps), it's real human movement, not an estimated or synthesized approximation. But the archive's creator is a hearing person, not a certified ASL translator, by his own admission in the archive's README. Individual signs may contain errors. Corrected files are added under new dates rather than overwriting old ones, which is why `mocap_indexer.py` always resolves to the **newest dated version** of any given sign.

**Before any production deployment — a real church service, a conference, a hospital — have a Deaf or certified ASL consultant review the vocabulary mapping.** See `docs/consultant-review-packet.md` for a ready-to-hand-off packet covering exactly what needs checking (this cannot be automated — it requires a real person fluent in ASL).

**Vocabulary coverage varies a lot by word.** The archive is a large, actively growing personal project, not a complete dictionary. For example, as of this writing there is no dictionary sign at all for "THANK-YOU" / "THANKS" / "GRATITUDE" — it will fall back to fingerspelling (T-H-A-N-K-Y-O-U), which is legible but slower and more formal than a native sign. Use the vocabulary coverage indicator (below) to find gaps like this in your actual usage and prioritize either a `data/vocabulary/<domain>.json` override to a close existing sign, or a custom recording (see "Adding custom signs").

---

## The real archive structure (read this before writing custom scanning/parsing code)

This matters because it's easy to assume a simpler layout than what's actually there. Confirmed by inspecting the real repository:

```
SG ASL Dictionary/
  ASL A/ ... ASL Z/                     (bucketed by first letter — not relied upon by the indexer)
    SG ASL <Word> [<variant tag>] <date> Upload/
      Documentation/
        SG ASL <Word> <date> ReadMe.txt      <- lists each KeyPose's frame number
        SG ASL <Word> <date> ShapeKeys.txt   <- sparse FACS Action-Unit keyframe curves
        ... .mp4 / .gif / .mkv (video refs, not used by Voicible)
      Poses/
        JSON/
          jpm_SG_ASL_<Word>_<date>_P<N>.json  <- ONE static keypose per file
        ... .blend (Blender pose-library files, not used by Voicible)
      FBX Files/
        Game Ready/ ...  Research/ ...        <- not used by Voicible (we use the JSON poses)

SG ASL Fingerspelling/
  Letters/, Letters-Old/, Numbers/, Numbers-Old/
    SG ASL <Letter> [<variant tag>] <date> Upload/   (same internal layout as above)
```

A few things that are easy to get wrong:

- **A sign is a sequence of static keyposes, not a baked animation.** Each `Poses/JSON/*_P<N>.json` file is a single Blender "Json Pose Manager" pose (all bone positions/rotations at one instant) — not a multi-frame clip. `server/pose/poseStitcher.js` produces the actual motion by interpolating between a sign's ordered keyposes.
- **P-number order is not chronological order.** The `_P1`, `_P2`, ... filename suffix reflects the order the animator posed each keypose in Blender, not the order they occur in time. A real sign in this archive has KeyPose 1 at frame 64, KeyPose 2 at frame 44, KeyPose 3 at frame 27. `mocap_indexer.py` reads each keypose's real frame number from `ReadMe.txt` and sorts chronologically before returning them — always trust the order the indexer gives you.
- **Facial data lives only in `ShapeKeys.txt`**, as sparse `Frame: N, Value: V` keyframes per named FACS Action Unit (e.g. `InnerBrowRaiserL_AU1_L`) — never inside the bone JSON itself. Most signs only keyframe a couple of AUs (typically blinks); the archive's own FAQ notes facial data is "usually left blank unless required to complete the motion."
- **Bone names are UE-Mannequin-style** (`pelvis`, `spine_01`..`spine_05`, `hand_l`, `index_01_l`..`index_03_l`, etc.), not Mixamo-style (`Hips`, `LeftArm`) — see `client/src/avatar/AvatarRig.js` for the full mapping and how it retargets onto a differently-named avatar skeleton. Blender stores quaternions as `(w, x, y, z)`; `poseStitcher.js` reorders to `(x, y, z, w)` for three.js before frames ever reach the client.
- **Variant/date folder names need normalizing to a canonical word.** E.g. `SG ASL Church Alt 2025-1-22 Upload`, `SG ASL Any (Alt) 2024-10-12 Upload`, and `SG ASL C 1 2024-6-16 Upload` (a fingerspelling letter variant) all need their trailing tag/number stripped to resolve to `CHURCH`, `ANY`, and `C` respectively — see `_canonicalize()` in `mocap_indexer.py`.

---

## Getting the rest of the archive data

A small real slice (`HELLO`, `CHURCH`, and the fingerspelling letters needed to spell `THANK-YOU`) is already included in `data/mocap-archive/` so Phase 1 works out of the box. For the full archive:

**Option A — full archive (large — this is a big binary asset repository):**

```bash
git clone https://github.com/StudioGalt/Sign-Language-Mocap-Archive data/mocap-archive
```

**Option B — just the Dictionary + Fingerspelling folders (lighter, still large):**

Use [DownGit](https://downgit.github.io) to download the `SG ASL Dictionary` and `SG ASL Fingerspelling` folders specifically.

**Option C — sparse-checkout just the signs you need (lightest):** if you know which words you need (e.g. for a specific domain vocabulary), `git sparse-checkout` or per-file `git show <commit>:<path>` against a shallow `--filter=blob:none` clone lets you pull only those Upload folders — this is how the starter subset in this repo was assembled, without downloading the full multi-gigabyte archive.

`data/mocap-archive/` is gitignored — it's local data, not part of this repo.

---

## Setup

### 1. Prerequisites

- Node.js 18+
- Python 3.9+
- [Ollama](https://ollama.com) running locally (default LLM provider) — `ollama pull llama3`
- [whisper-live](https://github.com/collabora/WhisperLive) running locally (default STT provider), or an Azure Speech key if using the cloud provider
  - On macOS, `pip install whisper-live` needs the `portaudio` C library first (`whisper-live` depends on PyAudio even though only its client-side mic capture uses it) — `brew install portaudio` before installing the Python deps below, or the build fails with `portaudio.h file not found`.

### 2. Install dependencies

```bash
python3 -m venv .venv
npm install
npm run install:client
.venv/bin/pip install -r sign_processor/requirements.txt
.venv/bin/pip install whisper-live
```

`npm run dev` runs the indexer and whisper-live via `.venv/bin/python3` (see `package.json`), so the venv above is required — a bare system `pip install` won't be picked up.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` if needed — the included starter archive slice already works with the default `MOCAP_ARCHIVE_PATH=./data/mocap-archive`.

### 4. Avatar model — current status

The Galtis rig (the archive's own avatar) is currently only distributed as `.blend` / `.fbx` — GLTF/glTF export is explicitly listed as "in progress" in the archive's own README, so there is no ready-made web-friendly Galtis model to drop in yet. Until one exists, `client/src/avatar/AvatarScene.jsx` renders a wireframe placeholder so the rest of the pipeline (transcription → gloss → lookup → stitching → coverage) stays fully visible and testable.

To get a real rendered avatar today, you have three options, roughly in order of effort:

1. **Convert an existing FBX yourself.** Import one of the archive's `FBX Files/Game Ready/*No Mesh Mixamo.fbx` exports into Blender and export as GLTF/GLB. This gets you the real Galtis mesh and skeleton, but you'll need to update the bone name mapping in `client/src/avatar/AvatarRig.js` to match whatever names the export produces (Blender's GLTF exporter sometimes alters bone names).
2. **Wait for Studio Galt's native GLTF export**, then drop it in as `client/public/models/avatar.glb` directly — bone names should already line up with what `AvatarRig.js` expects (the UE-mannequin-style deform bone names documented above).
3. **Use a different rigged avatar** as a stand-in, provided it has both **finger bones** and **FACS-style facial morph targets** — both are load-bearing for ASL legibility, not cosmetic. We evaluated a couple of free/CC-licensed sample glTF humanoids (Khronos's `CesiumMan` and `RiggedFigure`) as a quick placeholder and rejected both: neither has finger joints or any facial morph targets at all, so using them would silently produce a technically-running-but-linguistically-useless avatar. Ready Player Me or a custom Mixamo character with a FACS blendshape pass are more promising starting points if you go this route — just update both `AvatarRig.js` and `FacialBlendshapes.js` to match its real bone/morph names.

### 5. Run everything

```bash
npm run dev
```

This starts the Python indexer, the local whisper-live STT server, the Node server, and the Vite client dev server together. Or run them individually:

```bash
npm run indexer       # sign_processor/mocap_indexer.py — must be running for lookups to work
npm run whisper-live  # sign_processor/run_whisper_live.py — local STT; first run downloads the model (~250MB for small.en)
npm run server        # server/index.js
npm run client        # client dev server (Vite)
```

whisper-live's model download only happens once (cached under `~/.cache/huggingface`); on a first `npm run dev` the STT connection will show a few reconnect attempts in the server log until the model finishes loading — that's expected, not an error to chase.

### 6. Confirm Phase 1 before touching the avatar

Check the server console log for lookups of `HELLO` and `CHURCH` (both included in the starter archive slice) and confirm they resolve to real dictionary signs. `THANK-YOU` is a good test of the fingerspelling fallback specifically, since (as of this writing) that exact sign doesn't exist in the archive yet — it should resolve via fingerspelling (T-H-A-N-K-Y-O-U), not silently disappear. Every lookup is logged with its result.

---

## Vocabulary coverage indicator

This is the single most important debugging signal in Voicible. It's shown live in the status bar as a percentage: what fraction of the words in the current sentence were found as real dictionary signs vs. fingerspelled vs. genuinely missing.

- **Green (≥90%):** most of the sentence is real dictionary signs.
- **Yellow (70–89%):** meaningful fingerspelling fallback — legible, but check whether commonly-missed words should be added to the vocabulary mapping.
- **Red (<70%):** significant gaps. A Deaf viewer likely can't follow this reliably.

A word is never silently dropped. If it can't be found in the dictionary and can't be fingerspelled (missing letters too), it's still shown in the caption bar as flagged text (⚠) so nothing disappears from view.

Under the hood: `mocap_indexer.py`'s `/sequence` endpoint reports `{ found, fingerspelled, missing, percentFound }` for every gloss sentence, and the Node server's fuzzy-matching layer (`server/pose/fuzzyMatcher.js`, using `fuse.js`) gets a chance to recover near-misses — e.g. the LLM outputs "THANKS" but the archive files it as something differently spelled — before a word is counted as truly missing.

---

## Adding custom signs for words the archive doesn't cover

Phase 3 of this project is about finding and filling church-vocabulary gaps using the coverage indicator as your guide. To add a sign, follow the **exact same structure** documented above:

1. Record it using the Json Pose Manager Blender add-on (or compatible tooling) so you get the same per-keypose JSON format, and note each keypose's frame number.
2. Lay out the files exactly like an archive entry: `SG ASL <WORD> <date> Upload/Documentation/{ReadMe.txt, ShapeKeys.txt}` and `.../Poses/JSON/jpm_SG_ASL_<WORD>_<date>_P<N>.json`, under either `SG ASL Dictionary/` (any bucket subfolder) or `SG ASL Fingerspelling/`.
3. `ReadMe.txt` must contain `KeyPose N:` / `Frame: X` blocks for each pose file, in the same format as the archive's own files (see `_parse_readme_frames()` in `mocap_indexer.py` for the exact regex if you want to double check compatibility).
4. `ShapeKeys.txt` should list any animated FACS Action Units with their `Frame: N, Value: V` keyframes — it's fine to omit AUs that don't move for this sign.
5. Call the indexer's manual reindex endpoint (or restart it): `POST http://localhost:5001/reindex`.
6. If the word is a domain-specific term that should map to a *different* label than what the LLM naturally outputs, add an entry to `data/vocabulary/church.json` (or your domain's vocabulary file — see `VOCABULARY_DOMAIN` in `.env`).

Have your native signer's recordings reviewed the same way as the base archive — real motion isn't automatically correct ASL grammar. See `docs/consultant-review-packet.md`.

---

## Switching providers

All providers are chosen via `.env` and are hot-swappable without code changes.

| Variable | Values | Notes |
|---|---|---|
| `STT_PROVIDER` | `whisper-live` (default) \| `azure` | Azure requires `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` |
| `LLM_PROVIDER` | `ollama` (default) \| `azure` | Azure requires `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` |

Both defaults are free and run entirely offline on your machine. The cloud options are optional upgrades, never required.

---

## Project structure

```
voicible/
├── server/               # Node/Express backend — STT, LLM, pose pipeline, WebSocket
│   ├── speech/           # STT provider abstraction (whisper-live / Azure)
│   ├── llm/              # LLM provider abstraction (Ollama / Azure) — gloss conversion ONLY
│   ├── pose/             # mocapClient (talks to the Python indexer), poseStitcher (keypose
│   │                       interpolation + blending), fuzzyMatcher
│   └── websocket/        # Broadcasts captions, gloss, pose sequences, status to the client
├── sign_processor/       # Python microservice — indexes and serves real mocap keyposes
├── client/               # React + Three.js frontend — avatar rendering, captions, status bar
├── data/
│   ├── vocabulary/       # Domain-specific gloss overrides (e.g. church.json)
│   └── mocap-archive/    # Gitignored — a small real starter slice ships here; clone more as needed
├── docs/
│   └── consultant-review-packet.md   # Hand this to a Deaf/ASL consultant before production use
└── .env.example
```

---

## Troubleshooting

**Indexer shows 0 words indexed.** Check `MOCAP_ARCHIVE_PATH` in `.env` matches where you actually placed the archive, and that the `SG ASL Dictionary` / `SG ASL Fingerspelling` subfolder names match exactly (case-sensitive on Linux/Mac). Remember signs live several folders deep (`SG ASL Dictionary/ASL H/SG ASL Hello 2024-6-9 Upload/Poses/JSON/...`) — the indexer walks the whole tree looking for `... Upload` folders, so this should work regardless of the bucket subfolder name, but a wrong root path will still index nothing.

**Everything falls back to fingerspelling.** The indexer is likely unreachable — check `npm run indexer` is running and `MOCAP_INDEXER_URL` in `.env` points at the right port (default `5001`). The server logs a warning at startup if it can't reach the indexer. It's also possible the word genuinely isn't in your local archive slice yet — check `GET http://localhost:5001/words` for the current word list.

**Avatar shows a wireframe capsule instead of a real model.** Expected until you complete one of the three options in "Avatar model — current status" above.

**Facial expressions aren't playing.** Confirm your avatar's GLTF actually has morph targets matching the FACS Action-Unit names in `client/src/avatar/FacialBlendshapes.js`, and that the sign's `ShapeKeys.txt` actually keyframes something (most AUs are static/unused for any given sign — check the indexer's `/lookup` response for `hasFacialData` and the contents of `shapeKeyCurves`).

**Ollama gloss output looks wrong.** Try a larger model (`OLLAMA_MODEL=llama3:70b` or similar) — smaller models sometimes drift from the requested gloss format. The system prompt lives in `server/llm/llmProvider.js`.
# Voicible2
