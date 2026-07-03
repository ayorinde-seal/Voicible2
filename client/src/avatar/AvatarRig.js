// Voicible — Avatar rig bone mapping
// "Every voice, made visible."
//
// Maps REAL mocap bone names — confirmed by inspecting an actual
// SLMocapArchive keypose JSON file — onto whatever bone names the loaded
// GLTF avatar actually uses. The archive's "deform" rig layer (the bones
// that actually move the mesh, per the archive's own Avatar FAQ: "the
// deform rig... translate[s] the axis from blender standard to unreal
// standard") uses lowercase, underscore-separated UE-Mannequin-style
// names like "pelvis", "spine_01".."spine_05", "hand_l",
// "index_01_l".."index_03_l", etc. — NOT Mixamo-style "Hips"/"LeftArm"
// names. The full per-keypose JSON also contains ~330 additional
// FK/IK/control-layer bones (suffixed inte/fk/ik/mch/ctrl/pole) that
// exist for the animator's rig controls in Blender and are irrelevant to
// retargeted playback — only the plain deform-layer names below matter.
//
// Values below target common Mixamo-style bone names, since many free
// rigged GLTF avatars use that convention — update them to match
// whatever avatar you actually load (inspect its real bone names via
// `avatarObject.traverse(...)`). The Galtis rig itself is only
// distributed as .blend/.fbx today (GLTF export is "in progress" per the
// archive's own README), so retargeting onto a stand-in avatar like this
// is the expected path until a native Galtis GLTF exists.
//
// Note on the 5-segment spine: the mocap spine has 5 bones
// (spine_01..05); most simple humanoid rigs only have 2-3 spine bones,
// so this default mapping only pulls from 3 of the 5 (skipping
// spine_02/04) to avoid multiple mocap bones fighting over one target
// bone in the same frame. A richer avatar rig can map all 5 directly.
export const MOCAP_TO_AVATAR_BONE_MAP = {
  pelvis: 'Hips',
  spine_01: 'Spine',
  spine_03: 'Spine1',
  spine_05: 'Spine2',
  neck_01: 'Neck',
  neck_02: 'Neck1',
  head: 'Head',
  eye_L: 'LeftEye',
  eye_R: 'RightEye',

  clavicle_l: 'LeftShoulder',
  upperarm_l: 'LeftArm',
  lowerarm_l: 'LeftForeArm',
  hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder',
  upperarm_r: 'RightArm',
  lowerarm_r: 'RightForeArm',
  hand_r: 'RightHand',

  // Finger deform chains — StretchSense glove data gives per-finger
  // detail that matters a lot for ASL handshape legibility. The archive
  // includes a metacarpal bone per finger (except thumb) in addition to
  // the three phalange segments.
  thumb_01_l: 'LeftHandThumb1', thumb_02_l: 'LeftHandThumb2', thumb_03_l: 'LeftHandThumb3',
  index_metacarpal_l: 'LeftHandIndex0', index_01_l: 'LeftHandIndex1', index_02_l: 'LeftHandIndex2', index_03_l: 'LeftHandIndex3',
  middle_metacarpal_l: 'LeftHandMiddle0', middle_01_l: 'LeftHandMiddle1', middle_02_l: 'LeftHandMiddle2', middle_03_l: 'LeftHandMiddle3',
  ring_metacarpal_l: 'LeftHandRing0', ring_01_l: 'LeftHandRing1', ring_02_l: 'LeftHandRing2', ring_03_l: 'LeftHandRing3',
  pinky_metacarpal_l: 'LeftHandPinky0', pinky_01_l: 'LeftHandPinky1', pinky_02_l: 'LeftHandPinky2', pinky_03_l: 'LeftHandPinky3',

  thumb_01_r: 'RightHandThumb1', thumb_02_r: 'RightHandThumb2', thumb_03_r: 'RightHandThumb3',
  index_metacarpal_r: 'RightHandIndex0', index_01_r: 'RightHandIndex1', index_02_r: 'RightHandIndex2', index_03_r: 'RightHandIndex3',
  middle_metacarpal_r: 'RightHandMiddle0', middle_01_r: 'RightHandMiddle1', middle_02_r: 'RightHandMiddle2', middle_03_r: 'RightHandMiddle3',
  ring_metacarpal_r: 'RightHandRing0', ring_01_r: 'RightHandRing1', ring_02_r: 'RightHandRing2', ring_03_r: 'RightHandRing3',
  pinky_metacarpal_r: 'RightHandPinky0', pinky_01_r: 'RightHandPinky1', pinky_02_r: 'RightHandPinky2', pinky_03_r: 'RightHandPinky3',
};

// Builds a quick lookup of avatar bone name -> THREE.Bone by traversing
// the loaded GLTF scene once, so per-frame updates are O(1) per bone.
export function buildBoneLookup(avatarRoot) {
  const bones = {};
  avatarRoot.traverse((node) => {
    if (node.isBone) {
      bones[node.name] = node;
    }
  });
  return bones;
}

// Applies a single pose frame's bone transforms to the avatar skeleton.
// `frame.bones` is a map of mocapBoneName -> { position:[x,y,z],
// rotation:[x,y,z,w] } — server/pose/poseStitcher.js already reorders
// Blender's native (w,x,y,z) quaternion storage into three.js's
// (x,y,z,w) convention, so no conversion is needed here.
export function applyFrameToRig(frame, boneLookup, mapping = MOCAP_TO_AVATAR_BONE_MAP) {
  if (!frame || !frame.bones) return;

  for (const [mocapBoneName, transform] of Object.entries(frame.bones)) {
    const avatarBoneName = mapping[mocapBoneName];
    if (!avatarBoneName) continue;

    const bone = boneLookup[avatarBoneName];
    if (!bone) continue;

    if (transform.rotation) {
      const [x, y, z, w] = transform.rotation;
      bone.quaternion.set(x, y, z, w);
    }
    if (transform.position) {
      const [x, y, z] = transform.position;
      bone.position.set(x, y, z);
    }
  }
}

export default { MOCAP_TO_AVATAR_BONE_MAP, buildBoneLookup, applyFrameToRig };
