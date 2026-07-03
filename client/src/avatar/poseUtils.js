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

export default { NATIVE_FPS, createFrameClock, toVector3, toQuaternion, activeWordForFrame };
