// Voicible — Fuzzy gloss-to-dictionary word matching (fuse.js)
// "Every voice, made visible."
//
// The LLM is instructed to prefer simple, common vocabulary, but it will
// still occasionally produce a gloss word that's a close-but-not-exact
// match for how a sign is actually filed in the archive (e.g. "THANKS"
// vs. the archive's "THANK-YOU", or a minor spelling variant). Rather
// than let every near-miss fall through to fingerspelling, we fuzzy-match
// against the indexer's real word list and retry the exact lookup on the
// best candidate before giving up.
//
// This module NEVER invents a sign — it only re-maps to an existing,
// already-indexed dictionary word.

// Loaded via createRequire() rather than a plain `import Fuse from
// 'fuse.js'`: several published fuse.js 7.x versions ship a package.json
// "exports" map whose ESM condition points at "./dist/fuse.mjs", a file
// that isn't actually present in the tarball, which breaks a normal ESM
// import. Requiring it (which resolves via the "require" condition to
// the .cjs build that IS present) sidesteps that broken exports map.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Fuse = require('fuse.js');
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import fetch from 'node-fetch';

const FUZZY_THRESHOLD = 0.35; // lower = stricter match required (fuse.js scale 0-1)

let fuse = null;
let wordList = [];

async function fetchWordList() {
  const url = `${config.mocapIndexerUrl}/words`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    const data = await res.json();
    return data.words || [];
  } catch (err) {
    logger.warn(`fuzzyMatcher: could not fetch word list from indexer: ${err.message}`);
    return [];
  }
}

// Rebuilds the fuzzy index from the indexer's current word list. Call
// this once at startup and again any time /reindex is triggered.
export async function refreshFuzzyIndex() {
  wordList = await fetchWordList();
  fuse = new Fuse(wordList, { includeScore: true, threshold: FUZZY_THRESHOLD });
  logger.info(`fuzzyMatcher: indexed ${wordList.length} dictionary words for fuzzy fallback`);
  return wordList.length;
}

// Returns the closest matching dictionary word for a gloss word that
// didn't resolve via exact lookup, or null if nothing is close enough.
// Never matches hyphenated fingerspelling tokens — those are an explicit
// LLM decision, not a candidate for correction.
export function findClosestMatch(word) {
  if (!fuse || !word || word.includes('-')) return null;
  const results = fuse.search(word);
  if (results.length === 0) return null;

  const best = results[0];
  logger.info(`fuzzyMatcher: "${word}" ~ "${best.item}" (score=${best.score.toFixed(3)})`);
  return best.item;
}

export function isReady() {
  return fuse !== null;
}

export default { refreshFuzzyIndex, findClosestMatch, isReady };
