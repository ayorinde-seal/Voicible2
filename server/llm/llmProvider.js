// Voicible — LLM provider abstraction (gloss conversion ONLY, never motion)
// "Every voice, made visible."
//
// The LLM's entire job in this architecture is: (1) reorder English text
// into ASL grammar (Topic-Comment structure), and (2) pick vocabulary that
// matches what's actually available in the SG ASL Dictionary. It NEVER
// generates or synthesizes motion/pose data — that always comes from real
// mocap files or fingerspelling fallback via mocap_indexer.py.
//
// Switch providers via LLM_PROVIDER env var: "ollama" (default, local/free)
// or "azure" (Azure OpenAI, optional paid upgrade).

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { convertToGlossOllama } from './providers/ollamaProvider.js';
import { convertToGlossAzureOpenAI } from './providers/azureOpenAIProvider.js';

export const GLOSS_SYSTEM_PROMPT = `You are Voicible's gloss converter. Convert the following English
text into ASL gloss notation using ONLY common ASL vocabulary.
Rules: uppercase words, Topic-Comment sentence structure, drop
articles and auxiliary verbs, use base word forms, prefer simple
common words over rare synonyms since our sign dictionary has
limited vocabulary. If a concept has no simple ASL equivalent,
output it as individual letters separated by hyphens for
fingerspelling, e.g. S-A-N-C-T-I-F-I-C-A-T-I-O-N. Respond with
only the gloss string.`;

// Strips sentence punctuation a gloss token should never carry (STT
// transcripts are natural sentences — "Hello." — and gloss/fingerspelling
// lookups are keyed on bare words, so a stray period turns "HELLO" into
// the unrecognizable "HELLO." and silently fails dictionary + fingerspell
// lookup alike). Preserves hyphens, since fingerspelling tokens use them
// as separators (S-A-N-C-T-I-F-I-C-A-T-I-O-N).
function stripPunctuation(text) {
  return text.replace(/[.,!?;:"'()]/g, '');
}

// Converts a chunk of transcribed English text into an ASL gloss string
// using the configured provider. Always returns a plain uppercase gloss
// string (space-separated tokens, hyphenated tokens for fingerspelling).
export async function convertToGloss(text) {
  if (!text || !text.trim()) return '';

  try {
    let gloss;
    switch (config.llmProvider) {
      case 'azure':
        gloss = await convertToGlossAzureOpenAI(text, GLOSS_SYSTEM_PROMPT);
        break;
      case 'ollama':
      default:
        gloss = await convertToGlossOllama(text, GLOSS_SYSTEM_PROMPT);
        break;
    }
    const cleaned = stripPunctuation((gloss || '').trim()).toUpperCase();
    logger.gloss(text, cleaned);
    return cleaned;
  } catch (err) {
    logger.error(`LLM gloss conversion failed (provider=${config.llmProvider}): ${err.message}`);
    // Fail safe: never crash the pipeline on an LLM hiccup. Returning the
    // raw text (uppercased) lets fingerspelling/caption fallback continue
    // rather than dropping the utterance entirely.
    return stripPunctuation(text.trim()).toUpperCase();
  }
}

export default { convertToGloss, GLOSS_SYSTEM_PROMPT };
