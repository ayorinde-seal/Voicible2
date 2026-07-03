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

  // LLM (gloss conversion ONLY — never motion synthesis)
  llmProvider: process.env.LLM_PROVIDER || 'ollama',
  ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY || '',
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',

  // Sign data
  mocapArchivePath: process.env.MOCAP_ARCHIVE_PATH || './data/mocap-archive',
  mocapIndexerUrl: process.env.MOCAP_INDEXER_URL || 'http://localhost:5001',
  vocabularyDomain: process.env.VOCABULARY_DOMAIN || 'church',

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
