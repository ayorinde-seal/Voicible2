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

// Turns a stream of growing partial transcripts into discrete chunks fed
// to `onChunk` as soon as they're ready, instead of waiting for the STT
// provider's own `isFinal` event — which for Azure's "Semantic"
// segmentation strategy in particular can take a very long time (it's
// waiting for genuine topic closure, not just a pause), leaving the
// avatar frozen the whole time. A real interpreter doesn't wait for you
// to stop talking before starting to sign; this applies the same idea:
// once a partial transcript stops growing for `idleMs` (a live pause),
// whatever text is new since the last processed chunk is ready.
//
// Pure idle-based chunking isn't enough on its own: during genuinely
// continuous speech (someone talking without pausing — confirmed in
// practice, partial updates arriving in sub-second succession for many
// seconds straight), the idle timer keeps getting reset by each new
// partial and NEVER fires, so nothing gets signed until isFinal finally
// shows up. `maxWaitMs` is a hard ceiling: once a chunk has been
// accumulating for that long, flush it regardless of whether speech is
// still ongoing — unlike the idle timer, this one is started once per
// chunk and deliberately NOT reset on every partial.
//
// Tradeoff worth knowing: gloss conversion works best with full clause
// context, so chunking too aggressively (short idleMs/maxWaitMs) can
// produce choppier/lower-quality gloss than waiting for a complete
// sentence would. See STREAM_CHUNK_IDLE_MS / STREAM_CHUNK_MAX_WAIT_MS.
function createUtteranceChunker(onChunk, idleMs, maxWaitMs) {
  let currentText = '';
  let processedLength = 0;
  let idleTimer = null;
  let maxWaitTimer = null;

  function flush() {
    clearTimeout(idleTimer);
    clearTimeout(maxWaitTimer);
    idleTimer = null;
    maxWaitTimer = null;
    const newPart = currentText.slice(processedLength).trim();
    processedLength = currentText.length;
    if (newPart) onChunk(newPart);
  }

  return {
    feed(text, isFinal) {
      currentText = text;
      if (isFinal) {
        flush();
        currentText = '';
        processedLength = 0;
      } else {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(flush, idleMs);
        if (!maxWaitTimer) {
          maxWaitTimer = setTimeout(flush, maxWaitMs);
        }
      }
    },
  };
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

    const stitched = await stitchSequence(sequenceResult);
    // Carry the original spoken text ON the pose sequence so the client
    // can show the caption in lockstep with the signing (the sequence
    // queues client-side; its own text/gloss surface only when it plays,
    // instead of the live transcript racing ahead of the avatar).
    broadcastPoseSequence({ ...stitched, originalText: text });
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

  // Debug only — injects a raw gloss string directly into the pose
  // pipeline (vocabulary preprocessing -> mocap lookup -> pose stitching
  // -> broadcast), bypassing STT and the LLM entirely. Lets avatar/pose
  // playback be verified without whisper-live or Ollama running. NOT
  // part of the live pipeline — real utterances always go through
  // processUtterance() above, starting from transcribed text.
  app.post('/debug/gloss', async (req, res) => {
    const gloss = req.body?.gloss;
    if (!gloss || typeof gloss !== 'string') {
      return res.status(400).json({ error: 'gloss (string) is required in the request body' });
    }
    try {
      const preprocessed = preprocessGloss(gloss);
      broadcastGloss(`[debug] ${gloss}`, preprocessed);

      let sequenceResult = await getSequence(preprocessed);
      sequenceResult = await applyFuzzyFallback(sequenceResult);
      for (const wordResult of sequenceResult.words || []) {
        logger.lookup(wordResult.word, wordResult);
      }
      broadcastStatus({ vocabularyCoverage: sequenceResult.coverage });

      const stitched = await stitchSequence(sequenceResult);
      broadcastPoseSequence({ ...stitched, originalText: gloss });

      res.json({ ok: true, gloss: preprocessed, coverage: sequenceResult.coverage });
    } catch (err) {
      logger.error(`/debug/gloss failed for "${gloss}": ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Debug only — synthesize ONE SignBank sign and broadcast it as a
  // 'template'-mode pose sequence, bypassing STT/LLM/mocap. Lets the
  // synthesized-sign render path be verified in isolation before it's
  // wired into the real lookup fallback (Phase 2).
  app.post('/debug/synth', async (req, res) => {
    const word = req.body?.word;
    if (!word || typeof word !== 'string') {
      return res.status(400).json({ error: 'word (string) is required in the request body' });
    }
    try {
      const r = await fetch(`${config.mocapIndexerUrl}/synth?word=${encodeURIComponent(word)}`);
      const data = await r.json();
      if (!data.found) {
        return res.status(404).json({ error: `no SignBank spec for "${word}"` });
      }
      const frames = data.frames.map((f) => ({ ...f, mode: 'template' }));
      broadcastPoseSequence({
        gloss: data.word,
        originalText: data.word,
        fps: data.fps,
        frameCount: frames.length,
        frames,
        wordBoundaries: [{ word: data.word, startFrame: 0, endFrame: frames.length, found: true, isFingerspelled: false, textOnly: false }],
        coverage: { total: 1, found: 0, synth: 1, fingerspelled: 0, missing: 0, percentFound: 100 },
      });
      res.json({ ok: true, word: data.word, frameCount: frames.length, confidence: data.confidence });
    } catch (err) {
      logger.error(`/debug/synth failed for "${word}": ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Serve the built client in production; in development the Vite dev
  // server handles the frontend separately.
  const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));

  const server = http.createServer(app);

  const stt = createSttProvider();
  const chunker = createUtteranceChunker(processUtterance, config.streamChunkIdleMs, config.streamChunkMaxWaitMs);
  stt.on('transcript', ({ text, isFinal }) => {
    if (text.trim()) logger.transcript(text, isFinal);
    broadcastCaption(text, isFinal);
    chunker.feed(text, isFinal);
  });
  stt.on('error', (err) => {
    logger.error(`STT error: ${err.message}`);
    broadcastError(`STT error: ${err.message}`);
  });

  startBroadcaster(server, (chunk) => stt.sendAudioChunk(chunk));

  // stt.start() is async (e.g. AzureSpeechProvider lazy-imports its SDK
  // and awaits recognizer startup) and was previously called bare, with
  // nothing awaiting or catching the returned promise — any rejection
  // (a missing dependency, bad credentials, network failure) became an
  // unhandled promise rejection, which crashes the entire Node process
  // by default. A single misconfigured STT provider should degrade that
  // one feature, not take down avatar playback / vocabulary lookups /
  // everything else the server does.
  Promise.resolve(stt.start()).catch((err) => {
    logger.error(`STT provider failed to start: ${err.message}`);
    broadcastError(`STT provider failed to start: ${err.message}`);
  });

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
