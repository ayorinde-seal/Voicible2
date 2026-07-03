// Voicible — Main server entrypoint
// "Every voice, made visible."
//
// Wires the full pipeline together:
//   mic audio → STT → text → LLM gloss conversion → domain vocabulary
//   preprocessing → mocap dictionary/fingerspelling lookup → pose
//   stitching (real mocap blending) → WebSocket broadcast → avatar
//
// The LLM never generates motion. Motion always comes from real mocap
// data (SLMocapArchive) or fingerspelling fallback.

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { config, validateConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { loadVocabulary, preprocessGloss } from './utils/glossPreprocessor.js';
import { createSttProvider } from './speech/sttProvider.js';
import { convertToGloss } from './llm/llmProvider.js';
import { getSequence, applyFuzzyFallback, health as indexerHealth } from './pose/mocapClient.js';
import { refreshFuzzyIndex } from './pose/fuzzyMatcher.js';
import { stitchSequence } from './pose/poseStitcher.js';
import { convertSignFbx } from './pose/fbxConverter.js';
import {
  startBroadcaster,
  broadcastCaption,
  broadcastGloss,
  broadcastPoseSequence,
  broadcastStatus,
  broadcastError,
} from './websocket/broadcaster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printBanner() {
  const line = chalk.hex('#2D6BE4')('─'.repeat(56));
  console.log(line);
  console.log(chalk.hex('#2D6BE4').bold('  VOICIBLE'), chalk.hex('#00D4AA')('· "Every voice, made visible."'));
  console.log(chalk.gray(`  Venue: ${config.venueName}`));
  console.log(chalk.gray(`  STT provider: ${config.sttProvider}   LLM provider: ${config.llmProvider}`));
  console.log(chalk.gray(`  Vocabulary domain: ${config.vocabularyDomain}`));
  console.log(chalk.gray('  Sign motion data from the SLMocapArchive by Studio Galt (CC0)'));
  console.log(line);
}

async function processUtterance(text) {
  try {
    const rawGloss = await convertToGloss(text);
    const gloss = preprocessGloss(rawGloss);
    broadcastGloss(text, gloss);

    let sequenceResult = await getSequence(gloss);
    sequenceResult = await applyFuzzyFallback(sequenceResult);
    for (const wordResult of sequenceResult.words || []) {
      logger.lookup(wordResult.word, wordResult);
    }

    broadcastStatus({ vocabularyCoverage: sequenceResult.coverage });

    const stitched = stitchSequence(sequenceResult);
    broadcastPoseSequence(stitched);
  } catch (err) {
    logger.error(`Pipeline error processing utterance "${text}": ${err.message}`);
    broadcastError(`Failed to process: ${err.message}`);
  }
}

async function main() {
  printBanner();
  validateConfig(logger);
  loadVocabulary(config.vocabularyDomain);

  const indexerStatus = await indexerHealth();
  if (indexerStatus.status === 'unreachable') {
    logger.warn(
      `mocap_indexer.py is not reachable at ${config.mocapIndexerUrl}. ` +
      'Start it with: python sign_processor/mocap_indexer.py'
    );
  } else {
    logger.success(
      `Connected to mocap_indexer.py — ${indexerStatus.stats?.wordsIndexed || 0} signs, ` +
      `${indexerStatus.stats?.lettersIndexed || 0} fingerspelling letters indexed`
    );
    const fuzzyCount = await refreshFuzzyIndex();
    logger.info(`Fuzzy-match fallback ready (fuse.js) with ${fuzzyCount} dictionary words`);
  }

  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const indexer = await indexerHealth();
    res.json({
      status: 'ok',
      venueName: config.venueName,
      sttProvider: config.sttProvider,
      llmProvider: config.llmProvider,
      indexer,
    });
  });

  // Debug/consultant-preview only — NOT part of the live playback
  // pipeline (see server/pose/fbxConverter.js for why). Converts an
  // archive entry's "No Mesh Mixamo" FBX to .glb on demand so it can be
  // eyeballed in a generic glTF viewer. `uploadFolder` is a path
  // relative to MOCAP_ARCHIVE_PATH, e.g.
  //   "SG ASL Dictionary/ASL C/SG ASL Church 2025-1-22 Upload"
  app.get('/debug/fbx-preview', async (req, res) => {
    const uploadFolder = req.query.uploadFolder;
    if (!uploadFolder || typeof uploadFolder !== 'string') {
      return res.status(400).json({ error: 'uploadFolder query param is required' });
    }
    const archiveRoot = path.resolve(config.mocapArchivePath);
    const resolved = path.resolve(archiveRoot, uploadFolder);
    if (!resolved.startsWith(archiveRoot)) {
      return res.status(400).json({ error: 'uploadFolder must resolve inside the mocap archive' });
    }
    try {
      const glbPath = await convertSignFbx(resolved);
      if (!glbPath) {
        return res.status(404).json({ error: 'no usable "No Mesh Mixamo" FBX found for this entry' });
      }
      res.sendFile(glbPath);
    } catch (err) {
      logger.error(`/debug/fbx-preview failed for "${uploadFolder}": ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Serve the built client in production; in development the Vite dev
  // server handles the frontend separately.
  const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));

  const server = http.createServer(app);
  startBroadcaster(server);

  const stt = createSttProvider();
  stt.on('transcript', ({ text, isFinal }) => {
    broadcastCaption(text, isFinal);
    if (isFinal && text.trim()) {
      processUtterance(text.trim());
    }
  });
  stt.on('error', (err) => {
    logger.error(`STT error: ${err.message}`);
    broadcastError(`STT error: ${err.message}`);
  });
  stt.start();

  server.listen(config.port, () => {
    logger.success(`HTTP server listening on http://localhost:${config.port}`);
    logger.info('Waiting for live audio... (mic capture is handled by the client / whisper-live front-end)');
  });

  process.on('SIGINT', () => {
    logger.info('Shutting down Voicible server...');
    stt.stop();
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
