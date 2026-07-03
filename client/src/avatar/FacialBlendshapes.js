// Voicible — FACS shapekey / blendshape playback
// "Every voice, made visible."
//
// Non-manual markers (eyebrow raises, mouth morphemes, head tilts encoded
// as facial shapekeys) are core ASL grammar, NOT cosmetic detail — a
// sentence signed with correct handshapes but flat affect is frequently
// unintelligible to Deaf viewers. This module is therefore never treated
// as optional: if a pose frame carries facial data, it is always applied.
//
// Names below are the ACTUAL 49 shapekeys on the Galtis rig's
// "Galtismesh" object (confirmed from a real ShapeKeys.txt in the
// archive), following the FACS (Facial Action Coding System) convention
// per the archive's own FAQ: "Under the GaltisHead Object... you will
// see a list of shapekeys, following the FACS measurement system." Most
// signs only keyframe a handful of these (typically blinks) — the
// archive's FAQ notes facial data is "usually left blank unless required
// to complete the motion" — so don't expect every key to animate.
//
// The map is identity by default (source AU name -> same target morph
// name) since we don't yet know a specific target avatar's own morph
// target naming; if you retarget onto an avatar with different morph
// names, fill in the right-hand side to match.
const GALTIS_SHAPEKEY_NAMES = [
  'InnerBrowRaiserL_AU1_L', 'OuterBrowRaiserL_AU2_L', 'BrowLowerL_AU4_L',
  'EyesUpperLidRaiserL_AU5_L', 'CheekRaiserL_AU6_L', 'LidTightener_AU7',
  'LipsTowardsEachother_AU8', 'NoseWrinklerL_AU9_L', 'UpperLipRaiserL_AU10_L',
  'UpperLipRaiserN_AU10_N', 'NasolabialDeepenerL_AU11_L', 'LipCornerPullerL_AU12_L',
  'SharpLipPullerL_AU13_L', 'SharpLipPullerN_AU13_N', 'DimplerL_AU14_L',
  'LipCornerDepressorL_AU15_L', 'LowerLipDepressorL_AU16_L', 'ChinRaiser_AU17',
  'Pucker_AU18', 'TongueShow_AU19', 'TongueShowD_AU19D', 'LipStretcherL_AU20_L',
  'NeckTighten_AU21', 'Funneler_AU22', 'LipTightenerH_AU23H', 'LipTightenerV_AU23V',
  'LipPressor_AU24', 'LipParts_AU25', 'JawDropLipTowards_AU26', 'JawDrop_AU27',
  'LipSuck_AU28', 'JawThrust_AU29', 'JawSlideLeft_AU30_L', 'JawClenchL_AU31_L',
  'LipBite_AU32', 'CheekBlowL_AU33_L', 'CheekPuffL_AU34_L', 'CheekPuffN_AU34_N',
  'CheekSuckL_AU35_L', 'EyesCloseL_AU43_L', 'EyesCloseR_AU43_R', 'SquintL_AU44_L',
  'EyeWinkL_AU46_L', 'EyesLookLeft_AU61', 'EyesLookRight_AU62', 'EyesLookUp_AU63',
  'EyesLookDown_AU64', 'MouthSlideLeft', 'MouthSlideRight',
];

export const BLENDSHAPE_NAME_MAP = Object.fromEntries(GALTIS_SHAPEKEY_NAMES.map((n) => [n, n]));

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
