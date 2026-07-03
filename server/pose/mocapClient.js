// Voicible — HTTP client to the Python mocap_indexer.py microservice
// "Every voice, made visible."
//
// Thin wrapper so the rest of the Node server never talks to the indexer's
// raw HTTP API directly. Handles the indexer being slow to start or briefly
// unavailable without crashing the pipeline.

import fetch from 'node-fetch';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { findClosestMatch, isReady as fuzzyIndexReady } from './fuzzyMatcher.js';
import { refreshFuzzyIndex } from './fuzzyMatcher.js';

// Looks up a single gloss word against the mocap dictionary/fingerspelling
// index. Returns the indexer's { found, word, poseFile, isFingerspelled, ... }
// shape, or a safe "not found" fallback if the indexer itself is unreachable.
export async function lookupWord(word) {
  const url = `${config.mocapIndexerUrl}/lookup?word=${encodeURIComponent(word)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.error(`mocapClient.lookupWord("${word}") failed: ${err.message}`);
    return { found: false, word, poseFile: null, isFingerspelled: false, notFound: true, indexerUnreachable: true };
  }
}

// Looks up a full gloss sentence (space/plus-separated ASL gloss tokens)
// in one call, returning the ordered word results plus vocabulary
// coverage stats used by the frontend's coverage indicator.
export async function getSequence(glossString) {
  const url = `${config.mocapIndexerUrl}/sequence?gloss=${encodeURIComponent(glossString)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.error(`mocapClient.getSequence("${glossString}") failed: ${err.message}`);
    return {
      gloss: glossString,
      words: [],
      coverage: { total: 0, found: 0, fingerspelled: 0, missing: 0, percentFound: 0 },
      indexerUnreachable: true,
    };
  }
}

// Applies fuzzy-match correction to any words the indexer couldn't
// resolve on the first pass (see server/pose/fuzzyMatcher.js). Re-queries
// the indexer's exact /lookup for the corrected word so we still only
// ever use real, already-indexed mocap data — this never invents a sign.
export async function applyFuzzyFallback(sequenceResult) {
  if (!fuzzyIndexReady() || !sequenceResult?.words?.length) return sequenceResult;

  const correctedWords = [];
  let recovered = 0;

  for (const wordResult of sequenceResult.words) {
    if (wordResult.notFound) {
      const candidate = findClosestMatch(wordResult.word);
      if (candidate) {
        const retried = await lookupWord(candidate);
        if (retried.found && !retried.isFingerspelled) {
          correctedWords.push({ ...retried, fuzzyMatched: true, originalWord: wordResult.word });
          recovered += 1;
          continue;
        }
      }
    }
    correctedWords.push(wordResult);
  }

  if (recovered > 0) {
    logger.info(`mocapClient.applyFuzzyFallback: recovered ${recovered} word(s) via fuzzy match`);
    const total = correctedWords.length || 1;
    const found = correctedWords.filter((w) => w.found && !w.isFingerspelled).length;
    const fingerspelled = correctedWords.filter((w) => w.found && w.isFingerspelled).length;
    const missing = correctedWords.filter((w) => !w.found).length;
    sequenceResult.coverage = {
      total: correctedWords.length,
      found,
      fingerspelled,
      missing,
      percentFound: Math.round(((found + fingerspelled) / total) * 1000) / 10,
    };
  }

  sequenceResult.words = correctedWords;
  return sequenceResult;
}

// Triggers a manual reindex (e.g. after adding new custom sign recordings).
export async function reindex() {
  const url = `${config.mocapIndexerUrl}/reindex`;
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    const result = await res.json();
    await refreshFuzzyIndex(); // keep the fuzzy word list in sync with the new index
    return result;
  } catch (err) {
    logger.error(`mocapClient.reindex() failed: ${err.message}`);
    return { status: 'error', message: err.message };
  }
}

export async function health() {
  const url = `${config.mocapIndexerUrl}/health`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    return await res.json();
  } catch (err) {
    return { status: 'unreachable', message: err.message };
  }
}

export default { lookupWord, getSequence, applyFuzzyFallback, reindex, health };
