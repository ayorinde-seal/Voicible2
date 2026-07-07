// Voicible — FACS shapekey / blendshape playback
// "Every voice, made visible."
//
// Non-manual markers (eyebrow raises, mouth morphemes, head tilts encoded
// as facial shapekeys) are core ASL grammar, NOT cosmetic detail — a
// sentence signed with correct handshapes but flat affect is frequently
// unintelligible to Deaf viewers. This module is therefore never treated
// as optional: if a pose frame carries facial data, it is always applied.
//
// Names below are the ACTUAL 70 shapekeys on the Galtis rig's
// "GaltisHead" object, following the FACS (Facial Action Coding System)
// convention per the archive's own FAQ: "Under the GaltisHead Object...
// you will see a list of shapekeys, following the FACS measurement
// system." Confirmed 2026-07-03 by reading the full numbered shapekey
// list out of a real ShapeKeys.txt (every sign's ShapeKeys.txt documents
// all 70, in this same fixed order, regardless of which ones that sign
// actually animates — cross-checked identical across two unrelated
// signs). Most signs only keyframe a handful of these (typically blinks)
// — the archive's FAQ notes facial data is "usually left blank unless
// required to complete the motion" — so don't expect every key to
// animate.
//
// client/public/models/avatar.glb (as of 2026-07-04) is "Kevin", a
// Character Creator 4/5 character with its OWN 160 morph targets on the
// CC_Base_Body mesh, using CC4/ARKit-style names (e.g. 'Eye_Blink_L',
// 'Brow_Raise_Inner_L', 'Jaw_Open') rather than Galtis's FACS AU names.
// Those real names were confirmed present per-accessor on Kevin's GLB and
// patched into mesh.extras.targetNames (same technique used for Galtis,
// see AvatarRig.js header) so three.js's GLTFLoader populates
// morphTargetDictionary with them instead of placeholder index strings.
// BLENDSHAPE_NAME_MAP below is therefore no longer identity — it maps
// each Galtis AU name (the key, since that's what the pose data actually
// carries) to its closest Kevin CC4 equivalent (the value). Only AUs with
// a reasonably clean visual equivalent are mapped; the rest are left
// unmapped, which is already a safe no-op (applyFacialFrame below simply
// skips any name that isn't found in a given mesh's morphTargetDictionary).
export const BLENDSHAPE_NAME_MAP = {
  InnerBrowRaiserL_AU1_L: 'Brow_Raise_Inner_L',
  InnerBrowRaiserR_AU1_R: 'Brow_Raise_Inner_R',
  OuterBrowRaiserL_AU2_L: 'Brow_Raise_Outer_L',
  OuterBrowRaiserR_AU2_R: 'Brow_Raise_Outer_R',
  BrowLowerL_AU4_L: 'Brow_Drop_L',
  BrowLowerR_AU4_R: 'Brow_Drop_R',
  EyesUpperLidRaiserL_AU5_L: 'Eye_Wide_L',
  EyesUpperLidRaiserR_AU5_R: 'Eye_Wide_R',
  CheekRaiserL_AU6_L: 'Cheek_Raise_L',
  CheekRaiserR_AU6_R: 'Cheek_Raise_R',
  NoseWrinklerL_AU9_L: 'Nose_Sneer_L',
  NoseWrinklerR_AU9_R: 'Nose_Sneer_R',
  LipCornerPullerL_AU12_L: 'Mouth_Smile_L',
  LipCornerPullerR_AU12_R: 'Mouth_Smile_R',
  SharpLipPullerL_AU13_L: 'Mouth_Smile_Sharp_L',
  SharpLipPullerR_AU13_R: 'Mouth_Smile_Sharp_R',
  DimplerL_AU14_L: 'Mouth_Dimple_L',
  DimplerR_AU14_R: 'Mouth_Dimple_R',
  LipCornerDepressorL_AU15_L: 'Mouth_Frown_L',
  LipCornerDepressorR_AU15_R: 'Mouth_Frown_R',
  ChinRaiser_AU17: 'Mouth_Chin_Up',
  JawDrop_AU27: 'Jaw_Open',
  JawThrust_AU29: 'Jaw_Forward',
  JawSlideLeft_AU30_L: 'Jaw_L',
  JawSlideRight_AU30_R: 'Jaw_R',
  CheekPuffL_AU34_L: 'Cheek_Puff_L',
  CheekPuffR_AU34_R: 'Cheek_Puff_R',
  CheekSuckL_AU35_L: 'Cheek_Suck_L',
  CheekSuckR_AU35_R: 'Cheek_Suck_R',
  EyesCloseL_AU43_L: 'Eye_Blink_L',
  EyesCloseR_AU43_R: 'Eye_Blink_R',
  SquintL_AU44_L: 'Eye_Squint_L',
  SquintR_AU44_R: 'Eye_Squint_R',
  EyesLookLeft_AU61: 'Eye_L_Look_L',
  EyesLookRight_AU62: 'Eye_L_Look_R',
  EyesLookUp_AU63: 'Eye_L_Look_Up',
  EyesLookDown_AU64: 'Eye_L_Look_Down',
};

// Finds every SkinnedMesh in the avatar scene that has morph targets, so
// facial values can be applied across all relevant meshes (head mesh,
// possibly separate eyebrow/teeth meshes depending on the model).
export function findMorphMeshes(avatarRoot) {
  const meshes = [];
  avatarRoot.traverse((node) => {
    if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
      meshes.push(node);
    }
  });
  return meshes;
}

// server/pose/poseStitcher.js already resamples the archive's sparse FACS
// curves onto every output frame under `frame.shapekeys`, so this is the
// only field we need to read (kept as a fallback chain for resilience
// against future schema tweaks).
function extractFacialData(frame) {
  return frame.shapekeys || frame.blendshapes || frame.facs || frame.facialData || frame.face || null;
}

// Applies one frame's facial data across all morph-target meshes found
// on the avatar. No-ops safely if the frame carries no facial data at
// all (most frames won't animate most AUs — see file header) rather
// than throwing.
export function applyFacialFrame(frame, morphMeshes, nameMap = BLENDSHAPE_NAME_MAP) {
  const facial = extractFacialData(frame);
  if (!facial) return;

  for (const mesh of morphMeshes) {
    for (const [rawName, value] of Object.entries(facial)) {
      const targetName = nameMap[rawName] || rawName;
      const index = mesh.morphTargetDictionary[targetName];
      if (index !== undefined && typeof value === 'number') {
        mesh.morphTargetInfluences[index] = value;
      }
    }
  }
}

export default { BLENDSHAPE_NAME_MAP, findMorphMeshes, applyFacialFrame };
