// Voicible — Pose stitching layer
// "Every voice, made visible."
//
// Takes the ordered sign entries returned by mocap_indexer.py for a full
// gloss sentence and builds one continuous 60fps keyframe stream for the
// avatar. Two real-archive facts drive the design here (confirmed by
// inspecting actual SLMocapArchive files, not assumed):
//
//   1. A sign is NOT a pre-baked animation. Each JSON file under a sign's
//      Poses/JSON/ folder is a single static Blender "Json Pose Manager"
//      keypose (bone positions/rotations at one instant). The sign's
//      motion is produced by interpolating BETWEEN its ordered keyposes,
//      using the frame numbers documented in the sign's ReadMe.txt. Those
//      keypose frame numbers are NOT guaranteed to be in P1..Pn file
//      order (a real sign in this archive has KeyPose 1 at frame 64,
//      KeyPose 2 at frame 44, KeyPose 3 at frame 27) — mocap_indexer.py
//      already sorts them into chronological (frame-ascending) order
//      before returning them, so this module can trust the order it
//      receives.
//
//   2. Facial data lives ONLY as sparse per-FACS-Action-Unit keyframe
//      curves (frame, value) pairs — never embedded in the bone JSON —
//      and must be resampled onto the same frame timeline as the bone
//      interpolation.
//
// Consecutive SIGNS (not just keyposes within one sign) are additionally
// blended across a short transition window so playback doesn't jump-cut
// between real mocap clips.

import fs from 'fs';
import { logger } from '../utils/logger.js';

const BLEND_FRAMES = 4;        // frames blended between consecutive signs (3-5 per spec)
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
// expected already sorted chronologically by mocap_indexer.py.
function buildSignFrames(keyposes, shapeKeyCurves, label) {
  if (!keyposes || !keyposes.length) return [];

  const loaded = keyposes.map((kp) => ({ frame: kp.frame, bones: loadKeyposeBones(kp.file) }));

  if (loaded.length === 1) {
    const shapekeys = sampleShapekeysAtFrame(shapeKeyCurves, loaded[0].frame);
    logger.info(`Built "${label}" from 1 static keypose, held ${STATIC_HOLD_FRAMES} frames`);
    return Array.from({ length: STATIC_HOLD_FRAMES }, () => ({ bones: loaded[0].bones, shapekeys }));
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
      });
    }
  }
  const last = loaded[loaded.length - 1];
  frames.push({ bones: last.bones, shapekeys: sampleShapekeysAtFrame(shapeKeyCurves, last.frame) });

  logger.info(`Built "${label}" from ${loaded.length} keyposes (${frames.length} interpolated frames)`);
  return frames;
}

// ---- Cross-sign blending + top-level stitch ------------------------------

function blendTransition(prevFrames, nextFrames, blendLength = BLEND_FRAMES) {
  if (!prevFrames.length || !nextFrames.length) return [];
  const n = Math.min(blendLength, prevFrames.length, nextFrames.length);
  const blended = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const a = prevFrames[prevFrames.length - n + i];
    const b = nextFrames[i];
    blended.push({ bones: lerpBones(a.bones, b.bones, t), shapekeys: lerpShapekeys(a.shapekeys, b.shapekeys, t) });
  }
  return blended;
}

function appendClip(stitched, clipFrames, label) {
  if (!clipFrames.length) return;
  if (stitched.length > 0) {
    stitched.push(...blendTransition(stitched, clipFrames));
  }
  stitched.push(...clipFrames);
  logger.info(`Stitched clip "${label}" (${clipFrames.length} frames, total now ${stitched.length})`);
}

// Builds one continuous keyframe stream from a /sequence result produced
// by mocap_indexer.py (see server/pose/mocapClient.js). Words that are
// dictionary signs interpolate across their own keyposes; fingerspelled
// words do the same per-letter, in order; words that couldn't be
// resolved at all contribute no motion (they still surface in the
// caption as text-only per Voicible's "never silently drop a word" rule).
export function stitchSequence(sequenceResult) {
  const stitched = [];
  const wordBoundaries = [];

  for (const wordResult of sequenceResult.words || []) {
    const startFrame = stitched.length;

    if (wordResult.found && !wordResult.isFingerspelled && wordResult.keyposes) {
      const clip = buildSignFrames(wordResult.keyposes, wordResult.shapeKeyCurves, wordResult.word);
      appendClip(stitched, clip, wordResult.word);
    } else if (wordResult.found && wordResult.isFingerspelled && Array.isArray(wordResult.letters)) {
      for (const letter of wordResult.letters) {
        if (letter.found && letter.entry?.keyposes) {
          const clip = buildSignFrames(letter.entry.keyposes, letter.entry.shapeKeyCurves, `${wordResult.word}:${letter.letter}`);
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
