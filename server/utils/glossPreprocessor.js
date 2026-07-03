// Voicible — Domain vocabulary preprocessor (e.g. church terms)
// "Every voice, made visible."
//
// Some domain-specific words (e.g. sermon/church vocabulary) either don't
// exist in the SG ASL Dictionary at all, or exist under a different label
// than the LLM's gloss output. Before gloss words are sent to the mocap
// indexer for lookup, this module rewrites them using a curated mapping
// file (data/vocabulary/<domain>.json) so we get the best available real
// mocap sign instead of an avoidable fingerspelling fallback.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let vocabularyMap = {};
let loadedDomain = null;

function vocabularyPath(domain) {
  return path.resolve(__dirname, '..', '..', 'data', 'vocabulary', `${domain}.json`);
}

export function loadVocabulary(domain = config.vocabularyDomain) {
  const filePath = vocabularyPath(domain);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    vocabularyMap = JSON.parse(raw);
    loadedDomain = domain;
    logger.info(`Loaded "${domain}" vocabulary mapping (${Object.keys(vocabularyMap).length} terms) from ${filePath}`);
  } catch (err) {
    logger.warn(`Could not load vocabulary file for domain "${domain}" (${filePath}): ${err.message}. Continuing with no domain overrides.`);
    vocabularyMap = {};
    loadedDomain = domain;
  }
  return vocabularyMap;
}

// Rewrites a single gloss word (already uppercased ASL-gloss form) to its
// mapped dictionary-friendly equivalent, if a domain mapping exists.
// Falls through unchanged if no mapping is defined for this word.
export function applyVocabulary(glossWord) {
  const key = glossWord.toUpperCase();
  const mapped = vocabularyMap[key];
  if (mapped) {
    logger.info(`Vocabulary override: ${key} → ${mapped} (domain="${loadedDomain}")`);
    return mapped.toUpperCase();
  }
  return glossWord;
}

// Applies applyVocabulary() across a full gloss string (space-separated
// ASL gloss tokens), preserving hyphenated fingerspelling tokens as-is
// since those are already a deliberate LLM fallback decision.
export function preprocessGloss(glossString) {
  if (!glossString) return glossString;
  return glossString
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.includes('-') ? token : applyVocabulary(token)))
    .join(' ');
}

export default { loadVocabulary, applyVocabulary, preprocessGloss };
