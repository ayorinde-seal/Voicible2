// Voicible — Pose playback utility helpers
// "Every voice, made visible."
//
// Small, dependency-free helpers shared by AvatarRig and AvatarScene for
// timing playback of the stitched keyframe stream at the archive's native
// 60fps, and for converting raw pose JSON value shapes (arrays/objects)
// into THREE.js-friendly vectors/quaternions.

import * as THREE from 'three';

export const NATIVE_FPS = 60;

// Drives frame-accurate playback given real elapsed time, independent of
// the browser's actual render rate — avoids speeding up/slowing down
// motion on displays that don't run at exactly 60Hz.
export function createFrameClock(fps = NATIVE_FPS) {
  let elapsed = 0;
  const frameDuration = 1 / fps;

  return {
    // Call once per render tick with delta seconds; returns the frame
    // index to display and whether playback has reached the end.
    tick(deltaSeconds, frameCount) {
      elapsed += deltaSeconds;
      const frameIndex = Math.floor(elapsed / frameDuration);
      return {
        frameIndex: Math.min(frameIndex, Math.max(frameCount - 1, 0)),
        done: frameIndex >= frameCount,
      };
    },
    reset() {
      elapsed = 0;
    },
  };
}

// Converts a pose value that may be [x, y, z] or {x, y, z} into a
// THREE.Vector3. Returns null if the shape is unrecognized.
export function toVector3(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  if (typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return null;
}

// Converts a pose value that may be [x, y, z, w] or {x, y, z, w} into a
// THREE.Quaternion. Returns null if the shape is unrecognized.
export function toQuaternion(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 4) {
    return new THREE.Quaternion(value[0], value[1], value[2], value[3]);
  }
  if (typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value && 'w' in value) {
    return new THREE.Quaternion(value.x, value.y, value.z, value.w);
  }
  return null;
}

// Given the current frame index, finds which word (from poseStitcher's
// wordBoundaries) is currently being signed — used to highlight the
// active gloss word in the UI as playback progresses.
export function activeWordForFrame(wordBoundaries, frameIndex) {
  if (!Array.isArray(wordBoundaries)) return null;
  return wordBoundaries.find((w) => frameIndex >= w.startFrame && frameIndex < w.endFrame) || null;
}

// ---- Cross-sequence blending --------------------------------------------
//
// server/pose/poseStitcher.js blends transitions BETWEEN WORDS within one
// stitched sequence, but with streaming (server/index.js's
// createUtteranceChunker) a single utterance now regularly arrives as
// several separate pose sequences queued client-side (see App.jsx's
// poseQueueRef) — and nothing blended the boundary BETWEEN sequences,
// so every chunk transition hard-cut. This mirrors poseStitcher.js's own
// lerp/nlerp/easing math (kept in sync deliberately, not imported — this
// operates on the applied-frame snapshot client-side, not stitched
// server data) so a queued sequence's first few frames cross-fade from
// wherever the avatar actually was, instead of snapping.

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpVec3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function nlerpQuat(a, b, t) {
  let [bx, by, bz, bw] = b;
  const dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const x = a[0] + (bx - a[0]) * t;
  const y = a[1] + (by - a[1]) * t;
  const z = a[2] + (bz - a[2]) * t;
  const w = a[3] + (bw - a[3]) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

// Smoothstep ease-in-out — see poseStitcher.js's blendTransition for why
// (constant-velocity linear blending reads as mechanical).
export function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// Blends snapshot frame `a` toward frame `b` by fraction `t` (already
// eased by the caller). Mismatched modes ('absolute' FBX-sourced vs
// 'delta' JSON-fallback-sourced — see AvatarRig.js) aren't blended, same
// rule as the server side: those live in different reference frames, so
// interpolating raw values between them would be meaningless. Returns
// `b` unchanged in that case (a hard cut, but not a garbled one).
export function blendFrames(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  if (a.mode !== b.mode) return b;

  const bones = {};
  const boneNames = new Set([...Object.keys(a.bones || {}), ...Object.keys(b.bones || {})]);
  for (const name of boneNames) {
    const ab = a.bones?.[name];
    const bb = b.bones?.[name];
    if (ab && bb) {
      bones[name] = {};
      if (ab.position && bb.position) bones[name].position = lerpVec3(ab.position, bb.position, t);
      if (ab.rotation && bb.rotation) bones[name].rotation = nlerpQuat(ab.rotation, bb.rotation, t);
    } else {
      bones[name] = bb || ab;
    }
  }

  const shapekeys = {};
  const shapekeyNames = new Set([...Object.keys(a.shapekeys || {}), ...Object.keys(b.shapekeys || {})]);
  for (const name of shapekeyNames) {
    shapekeys[name] = lerp(a.shapekeys?.[name] ?? 0, b.shapekeys?.[name] ?? 0, t);
  }

  return { bones, shapekeys, mode: b.mode };
}

export default { NATIVE_FPS, createFrameClock, toVector3, toQuaternion, activeWordForFrame, easeInOut, blendFrames };
