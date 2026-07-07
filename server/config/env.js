// Voicible — Centralized environment configuration
// "Every voice, made visible."
//
// Loads and validates .env values once, so every module reads config
// from this single source of truth instead of touching process.env
// directly all over the codebase.

import dotenv from 'dotenv';
dotenv.config();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export const config = {
  venueName: process.env.VENUE_NAME || 'Voicible Live',

  // STT
  sttProvider: process.env.STT_PROVIDER || 'whisper-live',
  whisperLiveUrl: process.env.WHISPER_LIVE_URL || 'ws://localhost:9090',
  whisperLiveModel: process.env.WHISPER_LIVE_MODEL || 'small.en',
  azureSpeechKey: process.env.AZURE_SPEECH_KEY || '',
  azureSpeechRegion: process.env.AZURE_SPEECH_REGION || 'southafricanorth',
  // Controls how Azure Speech decides a spoken phrase has ended and emits
  // a final (not just partial) transcript. "Semantic" (the default) uses
  // an AI model to infer natural phrase boundaries from content rather
  // than pure silence duration, and per Azure's own docs takes no
  // adjustable parameters — azureSegmentationSilenceTimeoutMs below is
  // ignored in that mode and only takes effect if this is set to "Time".
  azureSegmentationStrategy: process.env.AZURE_SEGMENTATION_STRATEGY || 'Semantic',
  azureSegmentationSilenceTimeoutMs: parseInt(process.env.AZURE_SEGMENTATION_SILENCE_TIMEOUT_MS || '500', 10),

  // LLM (gloss conversion ONLY — never motion synthesis)
  llmProvider: process.env.LLM_PROVIDER || 'ollama',
  ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY || '',
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',

  // Sign data
  mocapArchivePath: process.env.MOCAP_ARCHIVE_PATH || './data/mocap-archive',
  mocapIndexerUrl: process.env.MOCAP_INDEXER_URL || 'http://localhost:5001',
  vocabularyDomain: process.env.VOCABULARY_DOMAIN || 'church',

  // How long (ms) a partial transcript must stop growing before we treat
  // whatever's new since the last processed chunk as ready to gloss+sign
  // — decouples avatar responsiveness from the STT provider's own
  // finalization timing (Azure's "Semantic" segmentation strategy in
  // particular can go a long time without ever emitting a final result).
  // See createUtteranceChunker() in server/index.js.
  streamChunkIdleMs: parseInt(process.env.STREAM_CHUNK_IDLE_MS || '1200', 10),
  // Hard ceiling (ms) — flush the current chunk even if speech is still
  // continuing without a pause long enough to trigger the idle timer
  // above (confirmed happening in practice: someone talking for 10+
  // seconds straight without a 1.2s gap anywhere).
  streamChunkMaxWaitMs: parseInt(process.env.STREAM_CHUNK_MAX_WAIT_MS || '3500', 10),

  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

export function validateConfig(logger) {
  const warnings = [];

  if (config.sttProvider === 'azure' && !config.azureSpeechKey) {
    warnings.push('STT_PROVIDER=azure but AZURE_SPEECH_KEY is not set.');
  }
  if (config.llmProvider === 'azure' && (!config.azureOpenAIEndpoint || !config.azureOpenAIApiKey)) {
    warnings.push('LLM_PROVIDER=azure but AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY are not fully set.');
  }

  if (warnings.length && logger) {
    warnings.forEach((w) => logger.warn(w));
  }
  return warnings;
}

export default config;
