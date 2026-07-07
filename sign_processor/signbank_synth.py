# Voicible — SignBank symbolic sign synthesizer
# "Every voice, made visible."
#
# Ported from the first Voicible iteration's sign_processor.py (branch
# feat/signbank-from-mocap). The SLMocapArchive only thoroughly covers a
# few letters (mostly B/C/D), so most everyday words have no captured
# motion and would otherwise fingerspell. This module renders those words
# from data/signbank.json — 1,895 signs each specified in the five ASL
# parameters (handshape, location, palm/finger orientation, movement,
# non-manual markers) — into keyframe "templates" of world-space arm
# DIRECTION VECTORS + handshape names. The client (AvatarRig.js
# mode:'template') retargets those direction vectors onto Kevin's arms
# via quaternion aiming and applies the handshapes to his fingers, so a
# synthesized sign works regardless of rig bind pose.
#
# Only the signbank path is ported (not the ASL-LEX / WLASL paths). The
# heavy tables (handshape map, location -> arm-reach vectors) are carried
# verbatim; see the original file's comments for their derivation.

import json
import math
import os

# ─── Neutral face (non-manual markers; unused by the current client) ──────────
NEUTRAL_FACE = {"browRaise": 0, "browFurrow": 0, "eyeClose": 0,
                "mouthOpen": 0, "headNod": 0, "headTilt": 0}

# ─── ASL-LEX Handshape → avatar hand shape name (handShapes.js) ───────────────
HANDSHAPE_MAP = {
    "1": "point", "2": "V", "3": "cupped", "4": "open", "5": "open",
    "6": "open", "7": "open", "8": "O",
    "a": "A", "A": "A", "b": "B", "B": "B", "c": "C", "C": "C",
    "d": "point", "D": "point", "e": "fist", "f": "O", "F": "O",
    "g": "point", "h": "flat", "i": "Y", "k": "V", "l": "L", "L": "L",
    "m": "fist", "n": "fist", "o": "O", "O": "O", "p": "point", "q": "point",
    "r": "V", "s": "fist", "S": "fist", "t": "fist", "u": "V", "v": "V",
    "V": "V", "w": "cupped", "x": "point", "y": "Y", "Y": "Y",
    "open_b": "flat", "flat_b": "flat", "closed_b": "B",
    "bent_b": "flat", "flat_n": "flat", "flat_h": "flat",
    "flat_o": "O", "baby_o": "O", "curved_5": "cupped",
    "curved_1": "point", "curved_f": "O", "curved_h": "flat",
    "curved_v": "V", "bent_1": "point", "bent_l": "L",
    "bent_v": "V", "open_8": "open", "flatspread_5": "open",
    "flatspread": "open",
    "NA": "open", "": "open",
}

# ─── ASL-LEX Location → (rightShoulder, rightElbow, rightWrist) dir vectors ────
LOCATION_JOINTS = {
    ("Head", "Forehead"):    ((-0.20, 0.62, 0.76), (0.15, 0.85, 0.50), (0, 0, 0)),
    ("Head", "Temple"):      ((-0.38, 0.58, 0.72), (-0.12, 0.85, 0.51), (0, 0, 0)),
    ("Head", "CheekNose"):   ((-0.25, 0.42, 0.87), (-0.05, 0.65, 0.76), (0, 0, 0)),
    ("Head", "Chin"):        ((-0.25, 0.25, 0.93), (0.05, 0.45, 0.89), (0, 0, 0)),
    ("Head", "Mouth"):       ((-0.22, 0.22, 0.95), (0.05, 0.40, 0.92), (0, 0, 0)),
    ("Head", "Nose"):        ((-0.23, 0.30, 0.92), (0.05, 0.50, 0.86), (0, 0, 0)),
    ("Head", "Eye"):         ((-0.22, 0.47, 0.85), (0.10, 0.68, 0.73), (0, 0, 0)),
    ("Head", "Ear"):         ((-0.44, 0.58, 0.68), (-0.35, 0.80, 0.49), (0, 0, 0)),
    ("Head", "HeadAway"):    ((-0.20, 0.65, 0.73), (0.10, 0.88, 0.46), (0, 0, 0)),
    ("Head", "Neck"):        ((-0.25, 0.12, 0.96), (0.05, 0.28, 0.96), (0, 0, 0)),
    ("Head", "UnderChin"):   ((-0.25, 0.18, 0.95), (0.05, 0.32, 0.95), (0, 0, 0)),
    ("Head", "Clavicle"):    ((-0.22, 0.10, 0.97), (0.03, 0.18, 0.98), (0, 0, 0)),
    ("Neutral", "Neutral"):  ((-0.25, -0.10, 0.96), (-0.05, -0.15, 0.99), (0, 0, 0)),
    ("Hand", "Palm"):        ((-0.30, -0.15, 0.94), (-0.10, -0.20, 0.97), (0, 0, 0)),
    ("Hand", "PalmBack"):    ((-0.30, -0.15, 0.94), (-0.10, -0.20, 0.97), (0, 0, 0)),
    ("Hand", "HandAway"):    ((-0.28, -0.12, 0.95), (-0.08, -0.18, 0.98), (0, 0, 0)),
    ("Hand", "FingerRadial"):((-0.28, -0.10, 0.96), (-0.08, -0.15, 0.99), (0, 0, 0)),
    ("Hand", "FingerTip"):   ((-0.28, -0.10, 0.96), (-0.05, -0.10, 0.99), (0, 0, 0)),
    ("Hand", "FingerBack"):  ((-0.28, -0.10, 0.96), (-0.08, -0.15, 0.99), (0, 0, 0)),
    ("Hand", "FingerFront"): ((-0.28, -0.10, 0.96), (-0.08, -0.15, 0.99), (0, 0, 0)),
    ("Hand", "FingerUlnar"): ((-0.28, -0.10, 0.96), (-0.08, -0.15, 0.99), (0, 0, 0)),
    ("Body", "TorsoTop"):    ((-0.22, 0.08, 0.97), (-0.05, 0.02, 1.00), (0, 0, 0)),
    ("Body", "TorsoMid"):    ((-0.22, -0.06, 0.97), (-0.05, -0.12, 0.99), (0, 0, 0)),
    ("Body", "Clavicle"):    ((-0.22, 0.14, 0.96), (-0.05, 0.18, 0.98), (0, 0, 0)),
    ("Body", "BodyAway"):    ((-0.25, -0.05, 0.97), (-0.05, -0.10, 0.99), (0, 0, 0)),
    ("Body", "Shoulder"):    ((-0.45, 0.30, 0.84), (-0.20, 0.22, 0.95), (0, 0, 0)),
    ("Arm", "ArmAway"):      ((-0.25, -0.10, 0.96), (-0.05, -0.15, 0.99), (0, 0, 0)),
    ("Arm", "ForearmUlnar"): ((-0.25, -0.10, 0.96), (-0.05, -0.15, 0.99), (0, 0, 0)),
}
_LOC_DEFAULT = ((-0.25, -0.10, 0.96), (-0.05, -0.15, 0.99), (0.0, 0.0, 0.0))

# Direction symbols (HamNoSys-style), world convention:
# character-right = -X, up = +Y, away-from-signer/toward-viewer = +Z.
#   u/d = up/down   l/r = signer's left/right   a/t = away-from / toward body
_DIR_BASE = {
    "u": (0.0, 1.0, 0.0), "d": (0.0, -1.0, 0.0),
    "l": (1.0, 0.0, 0.0), "r": (-1.0, 0.0, 0.0),
    "a": (0.0, 0.0, 1.0), "t": (0.0, 0.0, -1.0),
}

# Friendly location name → ASL-LEX (major, minor) key into LOCATION_JOINTS.
LOCATION_ALIAS = {
    "Neutral": ("Neutral", "Neutral"),
    "Forehead": ("Head", "Forehead"), "Temple": ("Head", "Temple"),
    "Eye": ("Head", "Eye"), "Nose": ("Head", "Nose"), "Cheek": ("Head", "CheekNose"),
    "Chin": ("Head", "Chin"), "Mouth": ("Head", "Mouth"), "Ear": ("Head", "Ear"),
    "Neck": ("Head", "Neck"), "UnderChin": ("Head", "UnderChin"),
    "Chest": ("Body", "TorsoTop"), "TorsoTop": ("Body", "TorsoTop"),
    "Belly": ("Body", "TorsoMid"), "TorsoMid": ("Body", "TorsoMid"),
    "Clavicle": ("Body", "Clavicle"), "Shoulder": ("Body", "Shoulder"),
    "WeakHand": ("Hand", "Palm"), "Palm": ("Hand", "Palm"),
}

# Handshape names the client (handShapes.js) understands directly.
_CLIENT_SHAPES = {
    "open", "flat", "fist", "A", "B", "C", "O", "point", "V", "L", "Y", "ILY",
    "thumbsUp", "cupped", "horns",
    "D", "E", "F", "G", "H", "I", "J", "K", "M", "N", "P", "Q", "R", "S", "T",
    "U", "W", "X", "Z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
}

# Hand target position per location, fractions of (upperarm+forearm) length,
# in body axes (inboard, up, forward). Consumed later if 2-bone IK is added;
# carried through so the frame shape matches the original.
LOCATION_TARGET = {
    "Neutral": (0.10, -0.28, 0.80), "Forehead": (0.20, 0.40, 0.52),
    "Temple": (0.40, 0.38, 0.44), "Eye": (0.22, 0.30, 0.54),
    "Nose": (0.16, 0.22, 0.56), "Cheek": (0.30, 0.24, 0.50),
    "Chin": (0.16, 0.10, 0.56), "Mouth": (0.15, 0.14, 0.56),
    "Ear": (0.50, 0.34, 0.32), "Neck": (0.20, 0.00, 0.54),
    "UnderChin": (0.16, 0.06, 0.56), "Chest": (0.30, -0.08, 0.54),
    "TorsoTop": (0.30, -0.08, 0.54), "Belly": (0.26, -0.40, 0.58),
    "TorsoMid": (0.26, -0.40, 0.58), "Clavicle": (0.28, 0.02, 0.52),
    "Shoulder": (0.52, 0.18, 0.40), "WeakHand": (0.14, -0.20, 0.70),
    "Palm": (0.14, -0.20, 0.70),
}
_TARGET_DEFAULT = (0.10, -0.28, 0.80)
_MAJOR_TARGET = {
    "Head": (0.20, 0.30, 0.50), "Body": (0.30, -0.08, 0.54),
    "Neutral": (0.12, -0.28, 0.78), "Hand": (0.16, -0.18, 0.66),
    "Arm": (0.34, -0.18, 0.48),
}

# Movement direction → delta in the (inboard, up, forward) target frame.
_MOVE_AXIS = {
    "u": (0.0, 1.0, 0.0), "d": (0.0, -1.0, 0.0),
    "l": (1.0, 0.0, 0.0), "r": (-1.0, 0.0, 0.0),
    "a": (0.0, 0.0, 1.0), "t": (0.0, 0.0, -1.0),
}


# ─── Geometry helpers ─────────────────────────────────────────────────────────
def _dir_to_vec(sym):
    if not sym:
        return (0.0, 0.0, 1.0)
    vx = vy = vz = 0.0
    for ch in str(sym).strip().lower():
        b = _DIR_BASE.get(ch)
        if b:
            vx += b[0]; vy += b[1]; vz += b[2]
    m = math.sqrt(vx * vx + vy * vy + vz * vz)
    if m < 1e-6:
        return (0.0, 0.0, 1.0)
    return (vx / m, vy / m, vz / m)


def _mirror_vec(v):
    return None if v is None else (-v[0], v[1], v[2])


def _blend_vec(a, b, t):
    x = a[0] + (b[0] - a[0]) * t
    y = a[1] + (b[1] - a[1]) * t
    z = a[2] + (b[2] - a[2]) * t
    m = math.sqrt(x * x + y * y + z * z) or 1.0
    return (x / m, y / m, z / m)


def _resolve_location(name):
    if not name:
        return ("Neutral", "Neutral")
    if name in LOCATION_ALIAS:
        return LOCATION_ALIAS[name]
    if "/" in name:
        a, b = name.split("/", 1)
        return (a, b)
    for maj in ("Head", "Body", "Hand", "Arm", "Neutral"):
        if (maj, name) in LOCATION_JOINTS:
            return (maj, name)
    return ("Neutral", "Neutral")


def _resolve_handshape(sym):
    if sym in _CLIENT_SHAPES:
        return sym
    return HANDSHAPE_MAP.get(sym) or HANDSHAPE_MAP.get(str(sym).lower(), "open")


def _location_target(name):
    if name in LOCATION_TARGET:
        return LOCATION_TARGET[name]
    maj, minor = _resolve_location(name)
    return LOCATION_TARGET.get(minor, LOCATION_TARGET.get(maj, _TARGET_DEFAULT))


def _move_to_offset(sym, size):
    dx = dy = dz = 0.0
    for ch in str(sym).strip().lower():
        b = _MOVE_AXIS.get(ch)
        if b:
            dx += b[0]; dy += b[1]; dz += b[2]
    return (dx * size, dy * size, dz * size)


def _target_field(off):
    return None if off is None else {"inboard": round(off[0], 4),
                                     "up": round(off[1], 4), "forward": round(off[2], 4)}


def _orient_fields(rf, rp, lf, lp):
    def v(d):
        return None if d is None else {"x": round(d[0], 4), "y": round(d[1], 4), "z": round(d[2], 4)}
    return {"rightHandDir": v(rf), "rightPalm": v(rp),
            "leftHandDir": v(lf), "leftPalm": v(lp)}


def _nmm_face(nmm):
    face = {**NEUTRAL_FACE}
    if not nmm:
        face["browRaise"] = 0.1
        return face
    brow = nmm.get("brow")
    if brow == "raise":
        face["browRaise"] = 0.5
    elif brow == "furrow":
        face["browFurrow"] = 0.5
    if nmm.get("mouth"):
        face["mouthOpen"] = 0.3
    if nmm.get("eyes") == "close":
        face["eyeClose"] = 0.5
    return face


def _loc_joints(major, minor):
    return (LOCATION_JOINTS.get((major, minor))
            or LOCATION_JOINTS.get((major, "Neutral"))
            or _LOC_DEFAULT)


def _make_joints(rs, re, rw, ls, le, lw, head_x=0.0):
    return {
        "rightShoulder": {"x": rs[0], "y": rs[1], "z": rs[2]},
        "rightElbow":    {"x": re[0], "y": re[1], "z": re[2]},
        "rightWrist":    {"x": rw[0], "y": rw[1], "z": rw[2]},
        "leftShoulder":  {"x": ls[0], "y": ls[1], "z": ls[2]},
        "leftElbow":     {"x": le[0], "y": le[1], "z": le[2]},
        "leftWrist":     {"x": lw[0], "y": lw[1], "z": lw[2]},
        "head":          {"x": head_x, "y": 0.0, "z": 0.0},
        "spine":         {"x": 0.0, "y": 0.0, "z": 0.0},
    }


def lerp_joints(a, b, t):
    return {
        joint: {ax: a[joint][ax] + (b[joint][ax] - a[joint][ax]) * t for ax in ("x", "y", "z")}
        for joint in a
    }


def _offset_joints(j, dv, size, sign_type):
    """Nudge the dominant arm's DIRECTION vectors toward world dir `dv`
    (mirrored onto the non-dominant arm for symmetric two-handed signs).
    The original encoded path movement only in the IK hand-target; the
    client here is direction-driven (no IK yet), so movement must also
    move the arm-aim vectors or straight/circle signs render static."""
    def shift(vd, d):
        x = vd["x"] + d[0] * size
        y = vd["y"] + d[1] * size
        z = vd["z"] + d[2] * size
        m = math.sqrt(x * x + y * y + z * z) or 1.0
        return {"x": round(x / m, 4), "y": round(y / m, 4), "z": round(z / m, 4)}
    out = {k: dict(v) for k, v in j.items()}
    out["rightShoulder"] = shift(j["rightShoulder"], dv)
    out["rightElbow"] = shift(j["rightElbow"], dv)
    if sign_type == "two-handed-sym":
        mdv = (-dv[0], dv[1], dv[2])
        out["leftShoulder"] = shift(j["leftShoulder"], mdv)
        out["leftElbow"] = shift(j["leftElbow"], mdv)
    return out


# ─── Spec → keyframe templates ────────────────────────────────────────────────
def signbank_to_template(entry):
    """Render one authored 5-parameter sign spec into keyframe templates."""
    dom = entry.get("dominant") or {}
    major, minor = _resolve_location(dom.get("location", "Neutral"))
    rs, re, rw = _loc_joints(major, minor)
    r_shape = _resolve_handshape(dom.get("handshape", "open"))
    r_finger = _dir_to_vec(dom.get("extFinger", "a"))
    r_palm = _dir_to_vec(dom.get("palm", "d"))

    sign_type = entry.get("type", "one-handed")
    nd = entry.get("nonDominant")

    if sign_type == "two-handed-sym":
        ls, le, lw = (-rs[0], rs[1], rs[2]), (-re[0], re[1], re[2]), (-rw[0], rw[1], rw[2])
        l_shape = r_shape
        l_finger = _mirror_vec(r_finger)
        l_palm = _mirror_vec(r_palm)
    elif sign_type == "two-handed-asym" and nd:
        nmaj, nmin = _resolve_location(nd.get("location", dom.get("location", "Neutral")))
        ls, le, lw = _loc_joints(nmaj, nmin)
        l_shape = _resolve_handshape(nd.get("handshape", "open"))
        l_finger = _dir_to_vec(nd.get("extFinger", "a"))
        l_palm = _dir_to_vec(nd.get("palm", "d"))
    else:
        # One-handed: rest the non-dominant arm hanging naturally at the
        # side (mostly -Y down, slight outward) rather than reaching
        # forward, which reads as an unintended second gesture on Kevin.
        ls, le, lw = (0.22, -0.92, 0.20), (0.12, -0.96, 0.14), (0.0, 0.0, 0.0)
        l_shape, l_finger, l_palm = "open", None, None

    r_target = _location_target(dom.get("location", "Neutral"))
    if sign_type == "two-handed-sym":
        l_target = r_target
    elif sign_type == "two-handed-asym" and nd:
        l_target = _location_target(nd.get("location", dom.get("location", "Neutral")))
    else:
        l_target = None

    def _add_off(t, o):
        return None if t is None else (t[0] + o[0], t[1] + o[1], t[2] + o[2])

    head_x = 0.05 if major == "Head" else 0.0
    base = _make_joints(rs, re, rw, ls, le, lw, head_x)

    def kf(rf=None, rp=None, lf=None, lp=None, rt=False, lt=False, joints=None):
        return {"joints": joints if joints is not None else base,
                "rightShape": r_shape, "leftShape": l_shape,
                "rightFingers": None, "leftFingers": None, "palmRoll": 0.0,
                **_orient_fields(rf if rf is not None else r_finger,
                                 rp if rp is not None else r_palm,
                                 lf if lf is not None else l_finger,
                                 lp if lp is not None else l_palm),
                "rightHandTarget": _target_field(r_target if rt is False else rt),
                "leftHandTarget": _target_field(l_target if lt is False else lt)}

    movement = entry.get("movement") or []
    repeated = any(m.get("repeat") or m.get("type") == "repeat" for m in movement)

    kfs = [kf()]
    for m in movement:
        mt = m.get("type")
        if mt == "straight":
            size = float(m.get("size", 0.3))
            dv = _dir_to_vec(m.get("dir", "d"))
            off = _move_to_offset(m.get("dir", "d"), size)
            kfs.append(kf(joints=_offset_joints(base, dv, size, sign_type),
                          rt=_add_off(r_target, off), lt=_add_off(l_target, off)))
        elif mt == "circle":
            size = float(m.get("size", 0.28))
            dv = _dir_to_vec(m.get("dir", "u"))
            off = _move_to_offset(m.get("dir", "u"), size)
            kfs.append(kf(joints=_offset_joints(base, dv, size, sign_type),
                          rt=_add_off(r_target, off), lt=_add_off(l_target, off)))
            kfs.append(kf())
        elif mt == "twist":
            tp = _dir_to_vec(m.get("to", "u"))
            lp = _mirror_vec(tp) if sign_type == "two-handed-sym" else l_palm
            kfs.append(kf(rp=tp, lp=lp))
        elif mt == "nod":
            f2 = _blend_vec(r_finger, _dir_to_vec(m.get("dir", "d")), 0.45)
            kfs.append(kf(rf=f2))
        # contact / wiggle / unknown → hold at the base keyframe

    return {"keyframes": kfs, "face": _nmm_face(entry.get("nmm")),
            "repeated": repeated, "source": "signbank"}


# ─── Data load ────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_SIGNBANK = {}
_CONF = {}


def load_signbank():
    global _SIGNBANK, _CONF
    sb_path = os.path.join(_HERE, "data", "signbank.json")
    rv_path = os.path.join(_HERE, "data", "signbank_review.json")
    try:
        with open(sb_path, "r", encoding="utf-8") as f:
            _SIGNBANK = {k.upper(): v for k, v in json.load(f).items()}
    except FileNotFoundError:
        _SIGNBANK = {}
    try:
        with open(rv_path, "r", encoding="utf-8") as f:
            _CONF = {k.upper(): (v.get("conf") if isinstance(v, dict) else None)
                     for k, v in json.load(f).items()}
    except FileNotFoundError:
        _CONF = {}
    return len(_SIGNBANK)


def has_word(word, min_conf=0.5):
    """True when a trusted spec exists: hand-authored (no review entry) or
    conf >= min_conf."""
    w = (word or "").upper()
    if w not in _SIGNBANK:
        return False
    c = _CONF.get(w)
    return (c is None) or (c >= min_conf)


def confidence(word):
    return _CONF.get((word or "").upper())


# ─── Public: word → flat per-frame template stream ────────────────────────────
def synthesize_frames(word, fps=60, seconds=1.4):
    """Resample a sign's keyframe templates into a flat per-frame stream the
    client plays like any pose sequence. Arm direction vectors are lerped
    between keyframes; handshapes snap to the nearest keyframe."""
    w = (word or "").upper()
    entry = _SIGNBANK.get(w)
    if not entry:
        return None
    tpl = signbank_to_template(entry)
    kfs = tpl["keyframes"]
    n = len(kfs)
    total = max(6, round(fps * seconds))
    frames = []
    for i in range(total):
        if n == 1:
            src, near = kfs[0], kfs[0]
            joints = {k: dict(v) for k, v in kfs[0]["joints"].items()}
        else:
            pos = (i / (total - 1)) * (n - 1)
            i0 = int(pos)
            i1 = min(i0 + 1, n - 1)
            frac = pos - i0
            joints = lerp_joints(kfs[i0]["joints"], kfs[i1]["joints"], frac)
            near = kfs[i0] if frac < 0.5 else kfs[i1]
        frames.append({
            "joints": joints,
            "rightShape": near["rightShape"],
            "leftShape": near["leftShape"],
        })
    return {"word": w, "fps": fps, "frameCount": len(frames),
            "source": "signbank", "frames": frames}


load_signbank()


if __name__ == "__main__":
    import sys
    word = sys.argv[1] if len(sys.argv) > 1 else "GOD"
    print(f"loaded {len(_SIGNBANK)} signs")
    out = synthesize_frames(word)
    if not out:
        print(f"no spec for {word!r}")
    else:
        print(f"{word}: {out['frameCount']} frames @ {out['fps']}fps, conf={confidence(word)}")
        f0 = out["frames"][0]
        print("  frame0 rightShape:", f0["rightShape"],
              "rightShoulder:", f0["joints"]["rightShoulder"],
              "rightElbow:", f0["joints"]["rightElbow"])
