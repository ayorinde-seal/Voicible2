// Voicible — Baked FBX animation extractor (the REAL motion source)
// "Every voice, made visible."
//
// server/pose/poseStitcher.js's original design interpolates between a
// sign's per-keypose JSON files — but investigation (2026-07-03, see
// memory/project_pose_pipeline_architecture_gap.md) found that data is
// EMPTY for every deform bone we actually map, across every sign
// checked (HELLO, BLESS, CHURCH): the archive's "Json Pose Manager"
// export captures the animator's FK/IK CONTROL bones, not the
// constraint-solved DEFORM bones the mesh is actually skinned to, so
// the JSON path silently produces zero visible motion.
//
// The real, correct, already-computed motion lives in each sign's own
// baked FBX animation (FBX Files/Game Ready/*Mesh.fbx) — Blender's own
// constraint solver already resolved FK/IK into final deform-bone poses
// when that clip was baked. This module extracts it: convert the FBX to
// glTF (server/pose/fbxConverter.js, already used elsewhere for preview
// purposes), read the embedded animation clip's channels, and resample
// them at 60fps into the exact same {bones, shapekeys} per-frame shape
// server/pose/poseStitcher.js already produces from the JSON path — so
// nothing downstream (client bone/shapekey application, chunking, the
// pose queue) needs to change, only where the frame data comes from.
//
// RETARGETING (2026-07-04): rotations are emitted as WORLD-SPACE DELTAS
// from each bone's own rest pose (mode 'world-delta'), not raw local
// transforms. Raw locals only render correctly on the source rig itself
// (Galtis) — applying them to a different avatar (the CC4 "Kevin" rig,
// whose bones rest at entirely different orientations/rolls) folded the
// whole body inside-out. A world-space delta ("how far has this bone
// rotated from ITS OWN rest, in world coordinates") is rig-agnostic: the
// client re-applies it on top of the TARGET avatar's own rest world
// orientation and converts back to that avatar's local space through its
// own parent chain (client/src/avatar/AvatarRig.js). Positions are not
// emitted at all — rotation-only FK retargeting; the avatar keeps its
// own bone lengths. World quats are composed from the GLB's true scene
// root using the real gltf.nodes[].children hierarchy (NOT a hardcoded
// parent table, and NOT just the deform bones — the chain runs through
// animated intermediates like spine_02/spine_04 and a constant Z-up→Y-up
// root rotation that must all participate or angles come out wrong).
//
// Conversion takes a few seconds per sign, so results are cached to disk
// next to the source FBX — first use of a given sign is slow, everything
// after is instant.

import fs from 'fs';
import path from 'path';
import { convertFbxToGlb } from './fbxConverter.js';
import { logger } from '../utils/logger.js';

const OUTPUT_FPS = 60;

// The archive's deform-layer bone names this pipeline actually drives —
// MUST stay in sync with client/src/avatar/AvatarRig.js's
// MOCAP_TO_AVATAR_BONE_MAP keys (duplicated here, not imported, since
// that file pulls in `three` from client/node_modules, which isn't
// resolvable from the root server package). Extraction only keeps
// channels for these bones; the baked FBX animates ~330 additional
// FK/IK/control bones that are irrelevant to playback either way.
const DEFORM_BONE_NAMES = new Set([
  'pelvis', 'spine_01', 'spine_03', 'spine_05', 'neck_01', 'neck_02', 'head', 'eye_L', 'eye_R',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thumb_01_l', 'thumb_02_l', 'thumb_03_l',
  'index_metacarpal_l', 'index_01_l', 'index_02_l', 'index_03_l',
  'middle_metacarpal_l', 'middle_01_l', 'middle_02_l', 'middle_03_l',
  'ring_metacarpal_l', 'ring_01_l', 'ring_02_l', 'ring_03_l',
  'pinky_metacarpal_l', 'pinky_01_l', 'pinky_02_l', 'pinky_03_l',
  'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
  'index_metacarpal_r', 'index_01_r', 'index_02_r', 'index_03_r',
  'middle_metacarpal_r', 'middle_01_r', 'middle_02_r', 'middle_03_r',
  'ring_metacarpal_r', 'ring_01_r', 'ring_02_r', 'ring_03_r',
  'pinky_metacarpal_r', 'pinky_01_r', 'pinky_02_r', 'pinky_03_r',
]);

// The Galtis rig's 70 FACS shapekeys, in the archive's own fixed,
// verified-stable numbered order (every sign's ShapeKeys.txt documents
// all 70 in this order regardless of which ones it actually animates —
// see client/src/avatar/FacialBlendshapes.js's GALTIS_SHAPEKEY_NAMES,
// which this MUST stay in sync with. FBX2glTF doesn't preserve morph
// target names on export, so this positional order is the only way to
// know which weight-channel index means which shapekey.
const SHAPEKEY_NAMES = [
  'InnerBrowRaiserL_AU1_L', 'InnerBrowRaiserR_AU1_R', 'OuterBrowRaiserL_AU2_L',
  'OuterBrowRaiserR_AU2_R', 'BrowLowerL_AU4_L', 'BrowLowerR_AU4_R',
  'EyesUpperLidRaiserL_AU5_L', 'EyesUpperLidRaiserR_AU5_R', 'CheekRaiserL_AU6_L',
  'CheekRaiserR_AU6_R', 'LidTightener_AU7', 'LipsTowardsEachother_AU8',
  'NoseWrinklerL_AU9_L', 'NoseWrinklerR_AU9_R', 'UpperLipRaiserL_AU10_L',
  'UpperLipRaiserR_AU10_R', 'UpperLipRaiserN_AU10_N', 'NasolabialDeepenerL_AU11_L',
  'NasolabialDeepenerR_AU11_R', 'LipCornerPullerL_AU12_L', 'LipCornerPullerR_AU12_R',
  'SharpLipPullerL_AU13_L', 'SharpLipPullerR_AU13_R', 'SharpLipPullerN_AU13_N',
  'DimplerL_AU14_L', 'DimplerR_AU14_R', 'LipCornerDepressorL_AU15_L',
  'LipCornerDepressorR_AU15_R', 'LowerLipDepressorL_AU16_L', 'LowerLipDepressorR_AU16_R',
  'ChinRaiser_AU17', 'Pucker_AU18', 'TongueShow_AU19',
  'TongueShowD_AU19D', 'LipStretcherL_AU20_L', 'LipStretcherR_AU20_R',
  'NeckTighten_AU21', 'Funneler_AU22', 'LipTightenerH_AU23H',
  'LipTightenerV_AU23V', 'LipPressor_AU24', 'LipParts_AU25',
  'JawDropLipTowards_AU26', 'JawDrop_AU27', 'LipSuck_AU28',
  'JawThrust_AU29', 'JawSlideLeft_AU30_L', 'JawSlideRight_AU30_R',
  'JawClenchL_AU31_L', 'JawClenchR_AU31_R', 'LipBite_AU32',
  'CheekBlowL_AU33_L', 'CheekBlowR_AU33_R', 'CheekPuffL_AU34_L',
  'CheekPuffR_AU34_R', 'CheekPuffN_AU34_N', 'CheekSuckL_AU35_L',
  'CheekSuckR_AU35_R', 'EyesCloseL_AU43_L', 'EyesCloseR_AU43_R',
  'SquintL_AU44_L', 'SquintR_AU44_R', 'EyeWinkL_AU46_L',
  'EyeWinkR_AU46_R', 'EyesLookLeft_AU61', 'EyesLookRight_AU62',
  'EyesLookUp_AU63', 'EyesLookDown_AU64', 'MouthSlideLeft',
  'MouthSlideRight',
];

// ---- GLB binary parsing (tailored to FBX2glTF's specific output shape,
// not a general-purpose glTF reader — single JSON+BIN chunk, all
// accessors float32, no sparse accessors, no Draco) ----------------------

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb file');
  const jsonChunkLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonChunkLength));
  const binChunkStart = 20 + jsonChunkLength;
  const binChunkLength = buffer.readUInt32LE(binChunkStart);
  const binData = buffer.subarray(binChunkStart + 8, binChunkStart + 8 + binChunkLength);
  return { json, binData };
}

function readAccessor(gltf, binData, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const numComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const count = accessor.count * numComponents;
  // Float32Array requires 4-byte alignment into the underlying buffer;
  // binData is itself a subarray view, so byteOffset is relative to it.
  const arr = new Float32Array(binData.buffer, binData.byteOffset + byteOffset, count);
  return Array.from(arr);
}

// ---- Quaternion algebra (no three.js in the server package) -------------
// Conventions match three.js exactly: quaternions are [x, y, z, w];
// qMultiply(a, b) is the Hamilton product a * b (same operand order as
// THREE.Quaternion.multiplyQuaternions(a, b)); world orientation composes
// parent-first (worldQ = parentWorldQ * localQ), mirroring three.js's
// matrixWorld = parent.matrixWorld * local matrix.

function qMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

// Conjugate — inverse only for unit quaternions, which everything here is.
function qInvert([x, y, z, w]) {
  return [-x, -y, -z, w];
}

function qNormalize([x, y, z, w]) {
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

// ---- Interpolation (same nlerp convention as poseStitcher.js) ----------

function lerp(a, b, t) {
  return a + (b - a) * t;
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

// Finds the two keyframes bracketing `t` in a channel's own time array
// (channels are NOT assumed to share a common time array — FBX2glTF
// keyframes each bone/channel independently) and returns the
// interpolation fraction between them.
function bracket(times, t) {
  if (t <= times[0]) return { i0: 0, i1: 0, frac: 0 };
  if (t >= times[times.length - 1]) return { i0: times.length - 1, i1: times.length - 1, frac: 0 };
  for (let i = 0; i < times.length - 1; i++) {
    if (t >= times[i] && t <= times[i + 1]) {
      const span = times[i + 1] - times[i];
      return { i0: i, i1: i + 1, frac: span === 0 ? 0 : (t - times[i]) / span };
    }
  }
  return { i0: times.length - 1, i1: times.length - 1, frac: 0 };
}

// ---- Core extraction -----------------------------------------------------

// parentOf[nodeIndex] -> parent node index, or -1 at the scene root.
// Derived from the GLB's real gltf.nodes[].children arrays — never
// hardcoded, so intermediate bones outside DEFORM_BONE_NAMES (spine_02,
// spine_04, the Z-up→Y-up root node...) are composed through correctly.
function buildNodeParentIndex(gltf) {
  const parentOf = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((node, i) => (node.children || []).forEach((c) => { parentOf[c] = i; }));
  return parentOf;
}

// Bind-pose world rotation per skinned node, extracted from the skins'
// inverseBindMatrices. This — NOT the node hierarchy's static rest
// transforms — is the correct delta reference: FBX2glTF stores each
// node's TRS at some captured animation stance (verified on CHURCH: the
// arm sits within ~6° of the stored node rest for the whole middle of
// the clip, i.e. the node "rest" IS the signing stance, 112° away from
// the true T-pose bind). Deltas measured from that stance read as ≈0
// mid-sign, freezing any retargeted avatar near ITS rest pose. The bind
// pose is the one semantically shared reference (both rigs bind in a
// T-pose), and it's what skinning itself is defined against.
//
// IBM = inverse(bindWorld) = inverse(T·R·S), so the 3x3 block is
// S⁻¹·Rᵀ — transposing it gives R's columns scaled by 1/s; normalizing
// each column strips the (FBX unit-conversion) scale, leaving pure R.
function quatFromInverseBindMatrix(m, offset) {
  const col = (r) => { // row r of the 3x3 block == column r of R (scaled)
    const v = [m[offset + r], m[offset + 4 + r], m[offset + 8 + r]]; // column-major mat4
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const [c0, c1, c2] = [col(0), col(1), col(2)];
  const r00 = c0[0], r01 = c1[0], r02 = c2[0];
  const r10 = c0[1], r11 = c1[1], r12 = c2[1];
  const r20 = c0[2], r21 = c1[2], r22 = c2[2];
  const tr = r00 + r11 + r22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, 0.25 * s];
  }
  if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    return [0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s];
  }
  if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    return [(r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s];
  }
  const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
  return [(r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s];
}

// worldRotationOf(nodeIdx) must give the SCENE world rotation of a node
// via its static node chain — fine for mesh nodes (they and their
// ancestors are plain scene nodes, not animated bones). Needed because
// IBMs are expressed in the skinned MESH node's space, not scene world
// space; the mesh node carries the FBX Z-up→Y-up −90°X conversion, so
// omitting it leaves every bind quat off by that constant (measured:
// a uniform 90° [-0.707,0,0,0.707] delta polluting every bone).
function buildBindWorldQuats(gltf, binData, worldRotationOf) {
  const bindWorld = new Map(); // nodeIndex -> [x,y,z,w]
  (gltf.skins || []).forEach((skin, skinIdx) => {
    if (skin.inverseBindMatrices === undefined) return;
    const meshNodeIdx = gltf.nodes.findIndex((n) => n.skin === skinIdx);
    const meshWorldQ = meshNodeIdx === -1 ? [0, 0, 0, 1] : worldRotationOf(meshNodeIdx);
    const ibms = readAccessor(gltf, binData, skin.inverseBindMatrices);
    skin.joints.forEach((nodeIdx, j) => {
      if (!bindWorld.has(nodeIdx)) {
        bindWorld.set(nodeIdx, qNormalize(qMultiply(meshWorldQ, quatFromInverseBindMatrix(ibms, j * 16))));
      }
    });
  });
  return bindWorld;
}

// Returns worldQuat(nodeIndex) composed from the true scene root, given
// a localRotationOf(nodeIndex) source. Memoized — but the memo is scoped
// to one resolver instance, so callers MUST build a fresh resolver per
// animation frame (a frame's world quats must not leak into the next).
function makeWorldQuatResolver(parentOf, localRotationOf) {
  const memo = new Map();
  function resolve(idx) {
    if (idx === -1) return [0, 0, 0, 1];
    const cached = memo.get(idx);
    if (cached) return cached;
    const world = qMultiply(resolve(parentOf[idx]), localRotationOf(idx));
    memo.set(idx, world);
    return world;
  }
  return resolve;
}

function sampleRotationChannel(channel, t) {
  const { times, values } = channel;
  const { i0, i1, frac } = bracket(times, t);
  return nlerpQuat(
    [values[i0 * 4], values[i0 * 4 + 1], values[i0 * 4 + 2], values[i0 * 4 + 3]],
    [values[i1 * 4], values[i1 * 4 + 1], values[i1 * 4 + 2], values[i1 * 4 + 3]],
    frac
  );
}

function extractFramesFromGlb(glbPath) {
  const buffer = fs.readFileSync(glbPath);
  const { json: gltf, binData } = readGlb(buffer);

  const anim = gltf.animations?.[0];
  if (!anim) return null;

  // Rotation channels for EVERY animated node (keyed by node index) —
  // deform-bone world orientations depend on animated intermediates that
  // aren't themselves emitted. Translation channels are not captured at
  // all: retargeting is rotation-only, the avatar keeps its own bone
  // positions/lengths.
  const rotationChannels = new Map(); // nodeIndex -> {times, values}
  let weightsChannel = null; // { times, values, targetCount }

  for (const channel of anim.channels) {
    const sampler = anim.samplers[channel.sampler];

    if (channel.target.path === 'weights') {
      const times = readAccessor(gltf, binData, sampler.input);
      const values = readAccessor(gltf, binData, sampler.output);
      weightsChannel = { times, values, targetCount: values.length / times.length };
      continue;
    }

    if (channel.target.path !== 'rotation') continue;
    rotationChannels.set(channel.target.node, {
      times: readAccessor(gltf, binData, sampler.input),
      values: readAccessor(gltf, binData, sampler.output),
    });
  }

  const parentOf = buildNodeParentIndex(gltf);
  const restLocal = (idx) => gltf.nodes[idx].rotation || [0, 0, 0, 1];

  // Delta reference per deform bone: the BIND pose (see
  // quatFromInverseBindMatrix's comment for why the node hierarchy's own
  // rest transforms are the wrong reference). Node-chain rest is kept
  // only as a fallback for any deform bone not in a skin.
  const restWorldResolver = makeWorldQuatResolver(parentOf, restLocal);
  const bindWorld = buildBindWorldQuats(gltf, binData, restWorldResolver);
  const deformNodes = []; // { name, idx, restWorldInv }
  gltf.nodes.forEach((node, idx) => {
    if (DEFORM_BONE_NAMES.has(node.name) && rotationChannels.has(idx)) {
      const reference = bindWorld.get(idx) || restWorldResolver(idx);
      deformNodes.push({ name: node.name, idx, restWorldInv: qInvert(reference) });
    }
  });
  if (deformNodes.length === 0) return null;

  // Clip duration = latest keyframe time across every channel.
  let duration = 0;
  for (const ch of rotationChannels.values()) duration = Math.max(duration, ch.times[ch.times.length - 1]);
  if (weightsChannel) duration = Math.max(duration, weightsChannel.times[weightsChannel.times.length - 1]);
  if (duration <= 0) return null;

  const frameCount = Math.max(1, Math.round(duration * OUTPUT_FPS));
  const frames = [];

  for (let i = 0; i < frameCount; i++) {
    const t = i / OUTPUT_FPS;

    // Fresh resolver per frame — see makeWorldQuatResolver's memo caveat.
    const frameLocal = (idx) => {
      const channel = rotationChannels.get(idx);
      return channel ? sampleRotationChannel(channel, t) : restLocal(idx);
    };
    const frameWorldResolver = makeWorldQuatResolver(parentOf, frameLocal);

    const bones = {};
    for (const { name, idx, restWorldInv } of deformNodes) {
      // World-space rotation away from this bone's own rest pose —
      // rig-agnostic; the client reapplies it onto the avatar's own rest.
      bones[name] = { rotation: qNormalize(qMultiply(frameWorldResolver(idx), restWorldInv)) };
    }

    const shapekeys = {};
    if (weightsChannel) {
      const { times, values, targetCount } = weightsChannel;
      const { i0, i1, frac } = bracket(times, t);
      for (let m = 0; m < Math.min(targetCount, SHAPEKEY_NAMES.length); m++) {
        const v = lerp(values[i0 * targetCount + m], values[i1 * targetCount + m], frac);
        if (v !== 0) shapekeys[SHAPEKEY_NAMES[m]] = v;
      }
    }

    frames.push({ bones, shapekeys });
  }

  return { fps: OUTPUT_FPS, frameCount: frames.length, mode: 'world-delta', frames };
}

// Finds the mesh-bearing FBX (the only variant with real geometry + skin
// + baked animation — "No Mesh ..." variants are skeleton-only) for a
// sign's Upload folder.
function findMeshFbx(uploadFolderPath) {
  const gameReadyDir = path.join(uploadFolderPath, 'FBX Files', 'Game Ready');
  if (!fs.existsSync(gameReadyDir)) return null;
  const match = fs.readdirSync(gameReadyDir).find((f) => /mesh\.fbx$/i.test(f) && !/no mesh/i.test(f));
  return match ? path.join(gameReadyDir, match) : null;
}

// Extracts (or loads from cache) the baked-animation frame stream for
// one sign's Upload folder. Returns null (not an error) if there's no
// usable mesh-bearing FBX — callers should fall back to the JSON-keypose
// path in that case rather than dropping the word's motion entirely.
export async function extractBakedAnimation(uploadFolderPath) {
  const fbxPath = findMeshFbx(uploadFolderPath);
  if (!fbxPath) return null;
  if (fs.statSync(fbxPath).size === 0) return null; // incomplete download

  const cacheDir = path.join(uploadFolderPath, '.baked-anim-cache');
  // v2: world-space rest deltas replaced raw local transforms.
  // v3: delta reference corrected from node-hierarchy rest (which FBX2glTF
  // stores as a captured animation stance, not a neutral pose) to the
  // skin's bind pose. Filename bumps keep stale caches (same field shape,
  // incompatible meaning) from ever being misread.
  const cacheFile = path.join(cacheDir, 'frames.v3.json');

  if (fs.existsSync(cacheFile)) {
    const srcStat = fs.statSync(fbxPath);
    const cacheStat = fs.statSync(cacheFile);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }
  }

  logger.info(`fbxAnimationExtractor: converting + extracting "${path.basename(fbxPath)}" (first use — cached after this)`);
  let glbPath;
  try {
    glbPath = await convertFbxToGlb(fbxPath, { cacheDir });
  } catch (err) {
    logger.warn(`fbxAnimationExtractor: conversion failed for "${fbxPath}": ${err.message}`);
    return null;
  }

  let result;
  try {
    result = extractFramesFromGlb(glbPath);
  } catch (err) {
    logger.warn(`fbxAnimationExtractor: extraction failed for "${glbPath}": ${err.message}`);
    return null;
  }
  if (!result) return null;

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  logger.info(`fbxAnimationExtractor: extracted ${result.frameCount} frames for "${path.basename(uploadFolderPath)}"`);
  return result;
}

export default { extractBakedAnimation };
