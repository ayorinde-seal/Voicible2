// Voicible — On-demand FBX → glTF (.glb) conversion utility
// "Every voice, made visible."
//
// IMPORTANT — THIS IS NOT PART OF THE MAIN PLAYBACK PIPELINE.
//
// The main pipeline (mocapClient.js -> poseStitcher.js -> AvatarRig.js)
// plays back signs from the archive's per-keypose JSON files at 60fps,
// interpolating between ordered P1..Pn poses, with facial motion driven
// separately by the sparse FACS Action-Unit curves in each sign's
// ShapeKeys.txt. That JSON+ShapeKeys pipeline is Voicible's source of
// truth and is NOT replaced by anything in this file.
//
// This module exists because the archive *also* ships each sign as a
// "No Mesh Mixamo" FBX (see FBX Files/Game Ready/*.fbx) containing
// Blender's own baked, pre-interpolated animation on a lean ~55-bone
// Mixamo-style skeleton (mixamorig1:Hips, mixamorig1:LeftHandThumb1,
// etc.) rather than the raw ~391-bone deform+control rig the JSON
// poses target. That's a much better starting point for retargeting
// onto common free Mixamo-rigged avatars, so it's useful for a
// consultant/preview tool or for a future avatar swap — just not for
// the live captioning pipeline today. Two problems block that today:
//
//   1. Frame rate mismatch: the baked FBX plays at 24fps. The archive's
//      documented capture/posting rate — and the rate poseStitcher.js
//      assumes when it schedules interpolation between JSON keyposes —
//      is 60fps (240fps captured, posted at 60fps per the archive's
//      own README). There is no confirmed, verified conversion factor
//      from the FBX file alone; naively assuming 24/60 = 0.4 has NOT
//      been validated against real timing and could desync body motion
//      from the ShapeKey-driven face.
//
//   2. No facial data: this lightweight "No Mesh Mixamo" FBX variant
//      has no mesh, therefore no shapekeys/morph targets. ASL facial
//      grammar is non-negotiable, and today it exists ONLY in each
//      sign's separate ShapeKeys.txt. Using the FBX body track would
//      mean running FBX-baked body motion and JSON-derived facial
//      curves side by side, aligned by normalized time (0..1 across
//      the sign) rather than raw frame number — unimplemented.
//
// Until those two problems are actually solved and verified against
// real playback, treat output from this module as a preview/reference
// conversion only (e.g. for a consultant to sanity-check retargeting,
// or for loading a sign into a generic Mixamo-rigged viewer) — not as
// an alternate source for the live pipeline.
//
// Requires the `fbx2gltf` npm package (FBX2glTF binary wrapper).

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// Maps Node's os.platform() to the folder names the `fbx2gltf` npm
// package ships its prebuilt binaries under (bin/Darwin, bin/Linux,
// bin/Windows_NT).
const PLATFORM_DIR = { darwin: 'Darwin', linux: 'Linux', win32: 'Windows_NT' };

// Resolves the platform FBX2glTF binary shipped by the `fbx2gltf` npm
// package. Allows an FBX2GLTF_BIN env override for local dev setups
// where the npm package install is incomplete or unavailable.
function resolveBinary() {
  if (process.env.FBX2GLTF_BIN) return process.env.FBX2GLTF_BIN;

  const platformDir = PLATFORM_DIR[os.platform()];
  if (!platformDir) {
    throw new Error(`fbxConverter: unsupported platform "${os.platform()}" for FBX2glTF`);
  }

  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('fbx2gltf/package.json'));
  } catch (err) {
    throw new Error(
      'fbxConverter: the "fbx2gltf" npm package is not installed. Run `npm install` ' +
      '(or set FBX2GLTF_BIN to point at a FBX2glTF binary directly).'
    );
  }

  const binName = platformDir === 'Windows_NT' ? 'FBX2glTF.exe' : 'FBX2glTF';
  const binPath = path.join(pkgDir, 'bin', platformDir, binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`fbxConverter: expected FBX2glTF binary not found at ${binPath}`);
  }
  return binPath;
}

/**
 * Converts a single FBX file to .glb, caching the result next to the
 * source file (or in `cacheDir` if given) so repeat requests for the
 * same sign don't re-run the converter. Returns the absolute path to
 * the .glb file.
 *
 * @param {string} fbxPath - absolute path to a "No Mesh Mixamo" FBX
 * @param {object} [opts]
 * @param {string} [opts.cacheDir] - directory to write the .glb into
 *   (defaults to alongside the source FBX)
 * @param {boolean} [opts.force] - re-convert even if a cached .glb
 *   already exists and is newer than the source FBX
 */
export async function convertFbxToGlb(fbxPath, opts = {}) {
  if (!fs.existsSync(fbxPath)) {
    throw new Error(`fbxConverter: source file not found: ${fbxPath}`);
  }

  const cacheDir = opts.cacheDir || path.dirname(fbxPath);
  const baseName = path.basename(fbxPath, path.extname(fbxPath));
  const glbPath = path.join(cacheDir, `${baseName}.glb`);

  if (!opts.force && fs.existsSync(glbPath)) {
    const srcStat = fs.statSync(fbxPath);
    const outStat = fs.statSync(glbPath);
    if (outStat.mtimeMs >= srcStat.mtimeMs) {
      logger.info(`fbxConverter: cache hit for ${path.basename(fbxPath)}`);
      return glbPath;
    }
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const binary = resolveBinary();

  logger.info(`fbxConverter: converting ${path.basename(fbxPath)} -> ${path.basename(glbPath)}`);
  try {
    await execFileAsync(binary, ['-i', fbxPath, '-o', glbPath, '--binary']);
  } catch (err) {
    throw new Error(`fbxConverter: FBX2glTF failed for ${fbxPath}: ${err.message}`);
  }

  if (!fs.existsSync(glbPath)) {
    throw new Error(`fbxConverter: FBX2glTF reported success but no .glb was produced for ${fbxPath}`);
  }

  return glbPath;
}

/**
 * Locates the "No Mesh Mixamo" FBX for a given sign's Upload folder
 * (the same folder mocap_indexer.py resolves for its JSON poses) and
 * converts it, if present. Returns null (not an error) if the archive
 * entry has no FBX Files/Game Ready mixamo export — many entries are
 * JSON-only.
 */
export async function convertSignFbx(uploadFolderPath, opts = {}) {
  const gameReadyDir = path.join(uploadFolderPath, 'FBX Files', 'Game Ready');
  if (!fs.existsSync(gameReadyDir)) return null;

  const mixamoFile = fs
    .readdirSync(gameReadyDir)
    .find((f) => /no mesh mixamo/i.test(f) && f.toLowerCase().endsWith('.fbx'));
  if (!mixamoFile) return null;

  const fbxPath = path.join(gameReadyDir, mixamoFile);
  // Skip zero-byte/partial files (e.g. left over from an interrupted
  // download) rather than letting FBX2glTF fail confusingly on them.
  if (fs.statSync(fbxPath).size === 0) {
    logger.warn(`fbxConverter: ${fbxPath} is empty (incomplete download) — skipping`);
    return null;
  }

  return convertFbxToGlb(fbxPath, opts);
}

export default { convertFbxToGlb, convertSignFbx };
