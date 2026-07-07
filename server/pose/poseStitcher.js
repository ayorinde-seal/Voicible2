// Voicible — Pose stitching layer
// "Every voice, made visible."
//
// PRIMARY motion source (as of 2026-07-03): each sign's baked FBX
// animation, via server/pose/fbxAnimationExtractor.js — see that file's
// header for why. Its frames are tagged `mode: 'world-delta'` (each
// rotation is the bone's world-space rotation away from its own rest
// pose — rig-agnostic; the client reapplies it on top of the rendered
// avatar's OWN rest orientation, so it survives avatar swaps).
//
// FALLBACK motion source, used only when a sign has no usable
// mesh-bearing FBX to extract from: the per-keypose JSON files under a
// sign's Poses/JSON/ folder. Two real-archive facts drive that path
// (confirmed by inspecting actual SLMocapArchive files, not assumed):
//
//   1. A sign is NOT a pre-baked animation. Each JSON file is a single
//      static Blender "Json Pose Manager" keypose (bone positions/
//      rotations at one instant). The sign's motion is produced by
//      interpolating BETWEEN its ordered keyposes, using the frame
//      numbers documented in the sign's ReadMe.txt. Those keypose frame
//      numbers are NOT guaranteed to be in P1..Pn file order (a real
//      sign in this archive has KeyPose 1 at frame 64, KeyPose 2 at
//      frame 44, KeyPose 3 at frame 27) — mocap_indexer.py already sorts
//      them into chronological (frame-ascending) order before returning
//      them, so this module can trust the order it receives.
//
//   2. Facial data lives ONLY as sparse per-FACS-Action-Unit keyframe
//      curves (frame, value) pairs — never embedded in the bone JSON —
//      and must be resampled onto the same frame timeline as the bone
//      interpolation.
//
// This fallback path's frames are tagged `mode: 'delta'`: the archive's
// keypose values are relative to each bone's own rest orientation (this
// avatar's bones do NOT rest at local identity — see AvatarRig.js), so
// they must be composed onto the avatar's rest pose rather than set
// directly. Confirmed empty (all-identity) for every deform bone across
// every sign checked (HELLO, BLESS, CHURCH) — kept as a fallback rather
// than removed in case some sign's JSON data turns out non-empty, or a
// future archive update fixes the export.
//
// Consecutive SIGNS (not just keyposes within one sign) are additionally
// blended across a short transition window so playback doesn't jump-cut
// between real mocap clips — but only when both sides share the same
// mode, since blending between an absolute pose and a delta value is
// meaningless (different reference frames).

import fs from 'fs';
import { logger } from '../utils/logger.js';
import { extractBakedAnimation } from './fbxAnimationExtractor.js';

const BLEND_FRAMES = 24;       // ~400ms @ 60fps blended between consecutive signs — long enough
                                // to read as a natural transition, not a snap (4 frames/~67ms was
                                // too short to feel organic; raised 2026-07-03, raised again
                                // 2026-07-05 when rest-edge trimming made transitions bridge full
                                // stance-to-stance arcs instead of passing through neutral)
const STATIC_HOLD_FRAMES = 20; // how long to hold a sign/letter that only has one keypose

// ---- Loading -----------------------------------------------------------

// Loads one Blender Json Pose Manager keypose file into a flat
// boneName -> { position:[x,y,z], rotation:[x,y,z,w] } map. Blender
// stores quaternions as (w,x,y,z); we reorder to (x,y,z,w) here, once,
// at load time, so nothing downstream has to think about it again.
function loadKeyposeBones(filepath) {
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(raw);
    const poseObj = Array.isArray(parsed) ? parsed[0] : parsed;
    const bones = {};
    for (const b of poseObj?.bones || []) {
      const loc = b.location?.vector || [0, 0, 0];
      const rot = b.rotation?.vector || [1, 0, 0, 0]; // Blender: w,x,y,z
      const [w, x, y, z] = rot;
      bones[b.name] = { position: loc, rotation: [x, y, z, w] };
    }
    return bones;
  } catch (err) {
    logger.error(`Failed to load keypose "${filepath}": ${err.message}`);
    return {};
  }
}

// ---- Math ---------------------------------------------------------------

function lerpVec3(a = [0, 0, 0], b = [0, 0, 0], t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Normalized quaternion lerp (nlerp) — takes the shortest path (flips
// the second quaternion if the dot product is negative) and renormalizes.
// Cheaper than true slerp and visually indistinguishable for the small
// per-frame deltas involved here.
function nlerpQuat(a = [0, 0, 0, 1], b = [0, 0, 0, 1], t) {
  let [bx, by, bz, bw] = b;
  const dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  const x = a[0] + (bx - a[0]) * t;
  const y = a[1] + (by - a[1]) * t;
  const z = a[2] + (bz - a[2]) * t;
  const w = a[3] + (bw - a[3]) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

function lerpBones(bonesA = {}, bonesB = {}, t) {
  const result = {};
  const names = new Set([...Object.keys(bonesA), ...Object.keys(bonesB)]);
  for (const name of names) {
    const a = bonesA[name];
    const b = bonesB[name];
    if (a && b) {
      result[name] = { position: lerpVec3(a.position, b.position, t), rotation: nlerpQuat(a.rotation, b.rotation, t) };
    } else {
      result[name] = b || a;
    }
  }
  return result;
}

function lerpShapekeys(a = {}, b = {}, t) {
  const result = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    const av = a[name] ?? 0;
    const bv = b[name] ?? 0;
    result[name] = av + (bv - av) * t;
  }
  return result;
}

// Samples a sparse (frame, value) FACS curve at an arbitrary frame,
// linearly interpolating between the two bracketing keyframes and
// holding the nearest edge value outside the curve's range.
function sampleCurve(points, atFrame) {
  if (!points || !points.length) return 0;
  if (atFrame <= points[0][0]) return points[0][1];
  if (atFrame >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [f0, v0] = points[i];
    const [f1, v1] = points[i + 1];
    if (atFrame >= f0 && atFrame <= f1) {
      const t = f1 === f0 ? 0 : (atFrame - f0) / (f1 - f0);
      return v0 + (v1 - v0) * t;
    }
  }
  return 0;
}

function sampleShapekeysAtFrame(curves, atFrame) {
  const result = {};
  for (const [name, points] of Object.entries(curves || {})) {
    result[name] = sampleCurve(points, atFrame);
  }
  return result;
}

// ---- Per-sign frame generation -------------------------------------------

// Builds the interpolated frame stream for ONE sign (or one fingerspelled
// letter) from its ordered keyposes + facial curves. `keyposes` is
// expected already sorted chronologically by mocap_indexer.py. Fallback
// path only — see file header. Frames are tagged mode: 'delta'.
function buildSignFramesFromKeyposes(keyposes, shapeKeyCurves, label) {
  if (!keyposes || !keyposes.length) return [];

  const loaded = keyposes.map((kp) => ({ frame: kp.frame, bones: loadKeyposeBones(kp.file) }));

  if (loaded.length === 1) {
    const shapekeys = sampleShapekeysAtFrame(shapeKeyCurves, loaded[0].frame);
    logger.info(`Built "${label}" from 1 static keypose (JSON fallback), held ${STATIC_HOLD_FRAMES} frames`);
    return Array.from({ length: STATIC_HOLD_FRAMES }, () => ({ bones: loaded[0].bones, shapekeys, mode: 'delta' }));
  }

  const frames = [];
  for (let i = 0; i < loaded.length - 1; i++) {
    const span = Math.max(1, loaded[i + 1].frame - loaded[i].frame);
    for (let f = 0; f < span; f++) {
      const t = f / span;
      const atFrame = loaded[i].frame + f;
      frames.push({
        bones: lerpBones(loaded[i].bones, loaded[i + 1].bones, t),
        shapekeys: sampleShapekeysAtFrame(shapeKeyCurves, atFrame),
        mode: 'delta',
      });
    }
  }
  const last = loaded[loaded.length - 1];
  frames.push({ bones: last.bones, shapekeys: sampleShapekeysAtFrame(shapeKeyCurves, last.frame), mode: 'delta' });

  logger.info(`Built "${label}" from ${loaded.length} keyposes (${frames.length} interpolated frames, JSON fallback)`);
  return frames;
}

// ---- Clip edge trimming ---------------------------------------------------
// The baked clips don't ease in from rest — they hold ONE bind-pose
// frame and then TELEPORT into the signing stance over ~2 frames
// (measured on CHURCH ALT: frame activity 5° -> 34° -> 72° -> 89°, i.e.
// a ~90° arm move in 50ms, far beyond human motion). Since appendClip
// pushes the full clip after its blend window, every sign started with
// that collapse-to-bind-and-snap — which reads as "clips playing one
// after another" instead of continuous signing. Trim the head while
// frames are either near rest OR still inside the teleport (implausibly
// large frame-to-frame jumps); trim any near-rest tail symmetrically
// (rest-only — real endings just stop in stance, which is fine). The
// 24-frame eased blendTransition then bridges stance-to-stance directly.
//
// Only meaningful for 'world-delta' frames, where each bone's rotation
// IS its angular distance from rest — activity is simply the largest
// arm-chain delta in the frame.
const TRIM_REST_DEG = 15;        // below this max arm delta, a frame counts as "at rest"
const TRIM_JUMP_DEG = 15;        // more than this activity change per frame (60fps) = teleport, not motion
const TRIM_ARM_BONES = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'];

function frameActivityDeg(frame) {
  let max = 0;
  for (const name of TRIM_ARM_BONES) {
    const rot = frame.bones?.[name]?.rotation;
    if (!rot) continue;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(rot[3]))) * (180 / Math.PI);
    if (angle > max) max = angle;
  }
  return max;
}

function trimClipEdges(frames, label) {
  if (frames.length < 10 || frames[0]?.mode !== 'world-delta') return frames;
  const acts = frames.map(frameActivityDeg);

  let start = 0;
  while (
    start < frames.length - 1 &&
    (acts[start] < TRIM_REST_DEG || Math.abs(acts[start + 1] - acts[start]) > TRIM_JUMP_DEG)
  ) start++;

  let end = frames.length - 1;
  while (end > start && acts[end] < TRIM_REST_DEG) end--;

  // A clip that never leaves rest (or would be eaten whole) is kept
  // intact rather than emptied — motion-free but timing/shapekeys play.
  if (end - start < 5) return frames;
  const trimmed = frames.slice(start, end + 1);
  if (trimmed.length < frames.length) {
    logger.info(`Trimmed "${label}" clip edges: ${frames.length} -> ${trimmed.length} frames (bind lead-in/teleport removed)`);
  }
  return trimmed;
}

// Builds the frame stream for ONE sign (or fingerspelled letter) —
// prefers the real baked FBX animation, falling back to JSON keypose
// interpolation only if no usable mesh-bearing FBX exists for it.
async function buildSignFrames(uploadFolderPath, keyposes, shapeKeyCurves, label) {
  if (uploadFolderPath) {
    const baked = await extractBakedAnimation(uploadFolderPath);
    if (baked?.frames?.length) {
      logger.info(`Built "${label}" from baked FBX animation (${baked.frames.length} frames)`);
      return trimClipEdges(baked.frames.map((f) => ({ ...f, mode: baked.mode })), label);
    }
  }
  return buildSignFramesFromKeyposes(keyposes, shapeKeyCurves, label);
}

// ---- Cross-sign blending + top-level stitch ------------------------------

function blendTransition(prevFrames, nextFrames, blendLength = BLEND_FRAMES) {
  if (!prevFrames.length || !nextFrames.length) return [];
  // Blending raw bone values only makes sense between two clips using the
  // SAME convention — an 'absolute' pose and a 'delta' value live in
  // different reference frames, so interpolating between them would be
  // meaningless. Skip the transition (hard cut) rather than produce a
  // garbled one; this only happens when one sign has baked FBX data and
  // its neighbor doesn't, which should get rarer as more signs get
  // extracted into cache over time.
  const prevMode = prevFrames[prevFrames.length - 1]?.mode;
  const nextMode = nextFrames[0]?.mode;
  if (prevMode !== nextMode) return [];
  // Synthesized 'template' frames carry arm direction vectors (frame.joints)
  // + handshapes, not the bone quaternions lerpBones expects — hard-cut
  // rather than blend garbage into/out of them.
  if (prevMode === 'template') return [];

  const n = Math.min(blendLength, prevFrames.length, nextFrames.length);
  const blended = [];
  for (let i = 0; i < n; i++) {
    const linearT = (i + 1) / (n + 1);
    // Smoothstep ease-in-out instead of linear — a constant-velocity
    // blend reads as mechanical (starts/stops abruptly at the seams);
    // easing gives a natural accelerate-then-decelerate motion, closer
    // to how a real signer's hands move between signs.
    const t = linearT * linearT * (3 - 2 * linearT);
    const a = prevFrames[prevFrames.length - n + i];
    const b = nextFrames[i];
    blended.push({
      bones: lerpBones(a.bones, b.bones, t),
      shapekeys: lerpShapekeys(a.shapekeys, b.shapekeys, t),
      mode: prevMode,
    });
  }
  return blended;
}

function appendClip(stitched, clipFrames, label) {
  if (!clipFrames.length) return;
  let remaining = clipFrames;
  if (stitched.length > 0) {
    const blend = blendTransition(stitched, clipFrames);
    if (blend.length) {
      // The blend frames REPLACE the previous clip's tail and CONSUME the
      // next clip's head — never append them on top. An earlier version
      // appended the blend after the full previous clip, which re-played
      // its last ~24 frames a second time (faded toward the next sign):
      // any tail motion visibly snapped backwards in time at every word
      // boundary (measured: a 44°/frame rewind at the CHURCH->HELLO
      // seam). Replacing keeps the timeline strictly monotonic — the
      // previous sign flows into the blend, the blend lands exactly on
      // the next sign's frame [n], and playback continues from there.
      stitched.length -= blend.length;
      stitched.push(...blend);
      remaining = clipFrames.slice(blend.length);
    }
  }
  stitched.push(...remaining);
  logger.info(`Stitched clip "${label}" (${clipFrames.length} frames, total now ${stitched.length})`);
}

// Builds one continuous keyframe stream from a /sequence result produced
// by mocap_indexer.py (see server/pose/mocapClient.js). Words that are
// dictionary signs interpolate across their own keyposes; fingerspelled
// words do the same per-letter, in order; words that couldn't be
// resolved at all contribute no motion (they still surface in the
// caption as text-only per Voicible's "never silently drop a word" rule).
export async function stitchSequence(sequenceResult) {
  const stitched = [];
  const wordBoundaries = [];

  for (const wordResult of sequenceResult.words || []) {
    const startFrame = stitched.length;

    if (wordResult.source === 'signbank' && Array.isArray(wordResult.frames)) {
      // Synthesized SignBank sign — arm direction vectors + handshapes,
      // played by the client's 'template' mode. Passed straight through
      // (already per-frame from the indexer's synthesizer). blendTransition
      // hard-cuts across the mocap('world-delta')↔synth('template')
      // boundary since the modes differ — intended, not a garble.
      const clip = wordResult.frames.map((f) => ({ ...f, mode: 'template' }));
      appendClip(stitched, clip, `${wordResult.word} (synth)`);
    } else if (wordResult.found && !wordResult.isFingerspelled && wordResult.keyposes) {
      const clip = await buildSignFrames(wordResult.uploadFolder, wordResult.keyposes, wordResult.shapeKeyCurves, wordResult.word);
      appendClip(stitched, clip, wordResult.word);
    } else if (wordResult.found && wordResult.isFingerspelled && Array.isArray(wordResult.letters)) {
      for (const letter of wordResult.letters) {
        if (letter.found && letter.entry?.keyposes) {
          const clip = await buildSignFrames(
            letter.entry.uploadFolder,
            letter.entry.keyposes,
            letter.entry.shapeKeyCurves,
            `${wordResult.word}:${letter.letter}`
          );
          appendClip(stitched, clip, `${wordResult.word}:${letter.letter}`);
        }
      }
    } else {
      logger.warn(`No motion available for "${wordResult.word}" — will render as text-only flagged caption`);
    }

    wordBoundaries.push({
      word: wordResult.word,
      startFrame,
      endFrame: stitched.length,
      found: wordResult.found,
      isFingerspelled: Boolean(wordResult.isFingerspelled),
      textOnly: !wordResult.found,
    });
  }

  return {
    gloss: sequenceResult.gloss,
    frames: stitched,
    frameCount: stitched.length,
    fps: 60, // matches archive's native posted fps; keypose frame numbers are on this same timeline
    wordBoundaries,
    coverage: sequenceResult.coverage,
  };
}

export default { stitchSequence };
