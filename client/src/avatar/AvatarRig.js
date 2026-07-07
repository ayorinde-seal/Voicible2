// Voicible — Avatar rig bone mapping
// "Every voice, made visible."

import { Quaternion, Vector3 } from 'three';

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
// client/public/models/avatar.glb (as of 2026-07-04) is "Kevin", a
// Character Creator 4/5 (Reallusion) character ported from the first
// Voicible iteration, converted from main-character.Fbx via FBX2glTF and
// optimized (see memory/project notes this session). Its skeleton uses
// CC4's own "CC_Base_*" naming convention (e.g. CC_Base_R_Upperarm,
// CC_Base_L_Mid1 — note "Mid" not "Middle"), a completely different rig
// from the archive's own Galtis character this map used to target
// identically. The VALUES below are Kevin's real bone names (confirmed
// via a full node traversal of the GLB); the KEYS remain the mocap
// archive's own bone names since those come from the JSON pose data and
// are not ours to change. Kevin has no metacarpal bones (only 3
// phalanges per non-thumb finger), so the archive's metacarpal_* mocap
// bones have no target and are intentionally omitted from this map —
// applyFrameToRig already skips any mocap bone name absent as a key.
//
// This map is only a NAME correspondence — it does NOT assume the two
// rigs share bind poses or bone rolls (they don't; a direct local-
// quaternion copy folded Kevin's body inside-out). The actual cross-rig
// retargeting happens in applyFrameToRig's 'world-delta' branch below,
// which reapplies each mocap bone's world-space rest delta on top of
// THIS avatar's own rest orientation.
//
// Note on the 5-segment spine: the mocap spine has 5 bones
// (spine_01..05); Kevin's spine has only 2 real segments (CC_Base_Waist,
// CC_Base_Spine01, CC_Base_Spine02) plus the hip, so this mapping only
// pulls from 3 of the 5 mocap segments (skipping spine_02/04) to avoid
// multiple mocap bones fighting over one target bone in the same frame.
export const MOCAP_TO_AVATAR_BONE_MAP = {
  pelvis: 'CC_Base_Hip',
  spine_01: 'CC_Base_Waist',
  spine_03: 'CC_Base_Spine01',
  spine_05: 'CC_Base_Spine02',
  neck_01: 'CC_Base_NeckTwist01',
  neck_02: 'CC_Base_NeckTwist02',
  head: 'CC_Base_Head',
  eye_L: 'CC_Base_L_Eye',
  eye_R: 'CC_Base_R_Eye',

  clavicle_l: 'CC_Base_L_Clavicle',
  upperarm_l: 'CC_Base_L_Upperarm',
  lowerarm_l: 'CC_Base_L_Forearm',
  hand_l: 'CC_Base_L_Hand',
  clavicle_r: 'CC_Base_R_Clavicle',
  upperarm_r: 'CC_Base_R_Upperarm',
  lowerarm_r: 'CC_Base_R_Forearm',
  hand_r: 'CC_Base_R_Hand',

  // Finger deform chains — StretchSense glove data gives per-finger
  // detail that matters a lot for ASL handshape legibility. Kevin has no
  // metacarpal bones, so those mocap keys are simply absent below.
  thumb_01_l: 'CC_Base_L_Thumb1', thumb_02_l: 'CC_Base_L_Thumb2', thumb_03_l: 'CC_Base_L_Thumb3',
  index_01_l: 'CC_Base_L_Index1', index_02_l: 'CC_Base_L_Index2', index_03_l: 'CC_Base_L_Index3',
  middle_01_l: 'CC_Base_L_Mid1', middle_02_l: 'CC_Base_L_Mid2', middle_03_l: 'CC_Base_L_Mid3',
  ring_01_l: 'CC_Base_L_Ring1', ring_02_l: 'CC_Base_L_Ring2', ring_03_l: 'CC_Base_L_Ring3',
  pinky_01_l: 'CC_Base_L_Pinky1', pinky_02_l: 'CC_Base_L_Pinky2', pinky_03_l: 'CC_Base_L_Pinky3',

  thumb_01_r: 'CC_Base_R_Thumb1', thumb_02_r: 'CC_Base_R_Thumb2', thumb_03_r: 'CC_Base_R_Thumb3',
  index_01_r: 'CC_Base_R_Index1', index_02_r: 'CC_Base_R_Index2', index_03_r: 'CC_Base_R_Index3',
  middle_01_r: 'CC_Base_R_Mid1', middle_02_r: 'CC_Base_R_Mid2', middle_03_r: 'CC_Base_R_Mid3',
  ring_01_r: 'CC_Base_R_Ring1', ring_02_r: 'CC_Base_R_Ring2', ring_03_r: 'CC_Base_R_Ring3',
  pinky_01_r: 'CC_Base_R_Pinky1', pinky_02_r: 'CC_Base_R_Pinky2', pinky_03_r: 'CC_Base_R_Pinky3',
};

// Builds a quick lookup of avatar bone name -> THREE.Bone by traversing
// the loaded GLTF scene once, so per-frame updates are O(1) per bone.
// Also snapshots each bone's REST local transform (position + quaternion
// as loaded from the GLTF, before any pose is ever applied) — required
// by applyFrameToRig below. This matters because this avatar's bones do
// NOT rest at local identity: Blender bakes each bone's edit-mode/roll
// orientation into its stored local transform, so e.g. this rig's pelvis
// loads with quaternion ~(-0.02, -0.71, 0.02, 0.71), not (0,0,0,1).
// Confirmed 2026-07-03 while debugging the avatar going fully invisible
// on any pose playback: the archive's keypose rotation/position values
// are DELTAS relative to each bone's own rest orientation (Blender
// PoseBone convention), not absolute world-frame values — a keypose of
// identity means "no additional rotation beyond rest", not "snap this
// bone to the global identity frame". Overwriting bone.quaternion/
// position outright (the previous behavior) discarded the rest pose for
// all ~55 mapped bones simultaneously, collapsing the 393-bone hierarchy
// into a degenerate (but numerically finite — no NaN, which is why this
// silently produced an invisible mesh with no console error rather than
// a crash) shape on literally any pose frame, including now-documented
// on the fingerspelling A" through CHURCH multi-keypose case.
const REST_POSE = new WeakMap(); // THREE.Bone -> { position: Vector3, quaternion: Quaternion, worldQuaternion: Quaternion }

// Avatar bone name -> mocap bone name, inverted once at module scope so
// applyFrameToRig's world-delta path (which iterates AVATAR bones in
// hierarchy order, not frame entries) can find each bone's frame data.
const AVATAR_TO_MOCAP_BONE_NAME = Object.fromEntries(
  Object.entries(MOCAP_TO_AVATAR_BONE_MAP).map(([mocap, avatar]) => [avatar, mocap])
);

// Returns { bones: name -> THREE.Bone, boneOrder: names in hierarchy
// order }. traverse() visits parents before children (pre-order), so
// boneOrder is already topologically sorted for free — the world-delta
// application path depends on that (each bone needs its parent's world
// orientation already updated for the current frame).
export function buildBoneLookup(avatarRoot) {
  // Resolve the full ancestor chain (armature/root import rotations)
  // before snapshotting world orientations — nothing else in the client
  // calls updateMatrixWorld explicitly; the renderer's own per-frame
  // update hasn't necessarily run yet when this executes from an effect.
  avatarRoot.updateMatrixWorld(true);

  // The delta reference is each node's LOADED world orientation. The
  // loaded pose is this avatar's T-pose (visually verified — the model
  // renders in a clean T-pose before any sign plays), which is the same
  // semantic stance the server measures its deltas from on the mocap
  // side. Deliberately NOT derived from skin inverseBindMatrices here:
  // this avatar has 11 skins whose IBMs are authored against different
  // mesh-space conventions (measured: skin-derived "bind" came out a
  // constant 90° off, pitching the whole torso forward on every sign),
  // while the loaded node transforms are unambiguous.
  const bones = {};
  const boneOrder = [];
  avatarRoot.traverse((node) => {
    // Not just isBone: gltf-transform's optimization pruned skin joints
    // down to the directly-weighted set, so several structurally vital
    // bones (CC_Base_Hip, both Upperarms/Forearms — their vertices are
    // weighted to child twist bones instead) load as plain Object3D.
    // They still articulate the hierarchy, so drive any node the bone
    // map targets even when the loader didn't mark it as a Bone.
    if (node.isBone || AVATAR_TO_MOCAP_BONE_NAME[node.name]) {
      bones[node.name] = node;
      boneOrder.push(node.name);
      if (!REST_POSE.has(node)) {
        const rest = {
          position: node.position.clone(),
          quaternion: node.quaternion.clone(),
          worldQuaternion: node.getWorldQuaternion(new Quaternion()),
        };
        REST_POSE.set(node, rest);
        node.userData.__restWorldQuat = rest.worldQuaternion; // debug visibility
      }
    }
  });
  return { bones, boneOrder };
}

// Applies a single pose frame's bone transforms to the avatar skeleton.
// `frame.bones` is a map of mocapBoneName -> { position:[x,y,z],
// rotation:[x,y,z,w] } — server/pose/poseStitcher.js already reorders
// Blender's native (w,x,y,z) quaternion storage into three.js's
// (x,y,z,w) convention, so no conversion is needed here.
//
// `frame.mode` picks how those values combine with the bone's rest
// transform (see REST_POSE above) — see server/pose/poseStitcher.js's
// header for the full story:
//
//   'world-delta' (server/pose/fbxAnimationExtractor.js, the real motion
//   source): each rotation is the SOURCE bone's world-space rotation
//   away from its own rest pose — rig-agnostic by construction. Applied
//   here as: targetWorld = delta * thisAvatarRestWorld, then converted
//   back to this avatar's local space through its own live parent chain.
//   That's what makes a mocap clip captured on the archive's Galtis rig
//   land correctly on a differently-built avatar (the raw local
//   transforms it replaces only rendered correctly on Galtis itself —
//   on the CC4 "Kevin" rig they folded the body inside-out). No
//   positions in this mode: rotation-only retargeting, the avatar keeps
//   its own bone lengths.
//
//   'delta' (the JSON-keypose fallback, used only when a sign has no
//   baked FBX to extract from): values are relative to the bone's own
//   rest orientation (Blender's PoseBone.rotation_quaternion convention)
//   — position is rest + delta, rotation is rest * pose. This avatar's
//   bones do NOT rest at local identity, so composing is required; a
//   raw identity delta (this fallback path's data is empty for every
//   bone in every sign checked) correctly resolves back to rest instead
//   of collapsing the skeleton (see the REST_POSE comment above).
//
// Defaults to 'delta' when unset, matching frames from any caller that
// predates this field.
// ---- Proportion calibration (world-delta mode only) ----------------------
// Rotation-only retargeting reproduces the mocap performer's JOINT ANGLES
// exactly, but Kevin's chest is broader and deeper than Galtis's, so
// poses where Galtis's hands sit just in front of (or beside) his body
// land INSIDE Kevin's. Compensate with a world-space swing of each upper
// arm: constant outward (away from the ribcage, mirrored per side) plus
// an ADAPTIVE forward component — a hanging arm gets swung well forward
// (the mocap idle stance tucks hands slightly behind the hips, which
// Kevin's deeper body hides completely), while a raised/signing arm gets
// only a small base amount so chest-contact signs stay believable
// contact rather than floating in the air. The hang weight is the
// downward component of the arm's own direction after the frame's
// rotation is applied: 0 for a horizontal/raised arm, 1 straight down.
const ARM_OUTWARD_DEG = 13;
const ARM_FORWARD_BASE_DEG = 12;
const ARM_FORWARD_HANG_DEG = 32; // added on top of base, scaled by hang weight
                                 // (a low/hanging arm gets base+hang forward — the mocap's
                                 // low poses tuck hands into Kevin's deeper pelvis/belly, so
                                 // they need a big forward swing to sit clear of the body)
const _AXIS_X = new Vector3(1, 0, 0);
const _AXIS_Z = new Vector3(0, 0, 1);
// T-pose arm directions: the avatar faces +Z, his left arm points +X.
// Forearms get the SAME adaptive forward treatment (no outward): the
// mocap idle stance bends the ELBOW backward, tucking the hand behind
// the hip — correcting only the shoulder leaves the hand hidden behind
// Kevin's deeper body. `forwardScale` softens the forearm share so a
// bent-forward elbow doesn't overshoot.
const ARM_TWEAK_SIDES = {
  upperarm_l: { outwardSign: +1, restDir: new Vector3(1, 0, 0), forwardScale: 1 },
  upperarm_r: { outwardSign: -1, restDir: new Vector3(-1, 0, 0), forwardScale: 1 },
  lowerarm_l: { outwardSign: 0, restDir: new Vector3(1, 0, 0), forwardScale: 0.9 },
  lowerarm_r: { outwardSign: 0, restDir: new Vector3(-1, 0, 0), forwardScale: 0.9 },
};
const _tmpArmDir = new Vector3();
const _tmpOut = new Quaternion();
const _tmpFwd = new Quaternion();

// Returns the world-space calibration quaternion for this arm segment at
// this frame (written into _tmpOut), or null for non-arm bones.
function armTweakFor(mocapBoneName, frameDeltaQuat) {
  const side = ARM_TWEAK_SIDES[mocapBoneName];
  if (!side) return null;
  _tmpArmDir.copy(side.restDir).applyQuaternion(frameDeltaQuat);
  const hangWeight = Math.max(0, -_tmpArmDir.y); // 0 horizontal, 1 straight down
  const forwardDeg = (ARM_FORWARD_BASE_DEG + ARM_FORWARD_HANG_DEG * hangWeight) * side.forwardScale;
  _tmpOut.setFromAxisAngle(_AXIS_Z, (side.outwardSign * ARM_OUTWARD_DEG * Math.PI) / 180);
  _tmpFwd.setFromAxisAngle(_AXIS_X, (-forwardDeg * Math.PI) / 180);
  return _tmpOut.multiply(_tmpFwd);
}

const _tmpQuat = new Quaternion();
const _tmpVec = new Vector3();
const _tmpTargetWorld = new Quaternion();
const _tmpParentWorld = new Quaternion();

export function applyFrameToRig(frame, boneLookupObj, mapping = MOCAP_TO_AVATAR_BONE_MAP) {
  if (!frame || !frame.bones || !boneLookupObj?.boneOrder) return;
  const { bones: boneLookup, boneOrder } = boneLookupObj;

  if (frame.mode === 'world-delta') {
    // Hierarchy order matters here: converting each bone's target world
    // orientation to local space reads its PARENT's world orientation,
    // which must already reflect THIS frame — hence parents first
    // (boneOrder guarantees it) and the updateMatrixWorld call per bone
    // (refreshes that bone's own matrixWorld from the quaternion just
    // set — it also touches the subtree, which is redundant-but-harmless
    // at ~55 driven bones — so the next bone down reads current data
    // instead of last frame's).
    for (const avatarBoneName of boneOrder) {
      const mocapBoneName = AVATAR_TO_MOCAP_BONE_NAME[avatarBoneName];
      if (!mocapBoneName) continue;
      const transform = frame.bones[mocapBoneName];
      if (!transform?.rotation) continue;
      const bone = boneLookup[avatarBoneName];
      const rest = bone && REST_POSE.get(bone);
      if (!rest) continue;

      const [x, y, z, w] = transform.rotation;
      _tmpQuat.set(x, y, z, w);
      _tmpTargetWorld.multiplyQuaternions(_tmpQuat, rest.worldQuaternion);
      const tweak = armTweakFor(mocapBoneName, _tmpQuat);
      if (tweak) _tmpTargetWorld.premultiply(tweak);

      if (bone.parent) bone.parent.getWorldQuaternion(_tmpParentWorld);
      else _tmpParentWorld.identity();

      bone.quaternion.copy(_tmpParentWorld).invert().multiply(_tmpTargetWorld);
      bone.updateMatrixWorld(false);
    }
    return;
  }

  const absolute = frame.mode === 'absolute';

  for (const [mocapBoneName, transform] of Object.entries(frame.bones)) {
    const avatarBoneName = mapping[mocapBoneName];
    if (!avatarBoneName) continue;

    const bone = boneLookup[avatarBoneName];
    if (!bone) continue;

    if (transform.rotation) {
      const [x, y, z, w] = transform.rotation;
      if (absolute) {
        bone.quaternion.set(x, y, z, w);
      } else {
        const rest = REST_POSE.get(bone);
        if (!rest) continue; // bone wasn't present when buildBoneLookup ran
        _tmpQuat.set(x, y, z, w);
        bone.quaternion.copy(rest.quaternion).multiply(_tmpQuat);
      }
    }
    if (transform.position) {
      const [x, y, z] = transform.position;
      if (absolute) {
        bone.position.set(x, y, z);
      } else {
        const rest = REST_POSE.get(bone);
        if (!rest) continue;
        _tmpVec.set(x, y, z);
        bone.position.copy(rest.position).add(_tmpVec);
      }
    }
  }
}

export default { MOCAP_TO_AVATAR_BONE_MAP, buildBoneLookup, applyFrameToRig };
