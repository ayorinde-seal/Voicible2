// Voicible — STT provider abstraction
// "Every voice, made visible."
//
// Wraps whichever speech-to-text backend is configured behind one
// consistent interface. Both providers emit the same shape of event:
//   { text: string, isFinal: boolean }
// so downstream code (gloss conversion, broadcaster) never needs to know
// which provider produced the transcript.
//
// Switch providers via STT_PROVIDER env var: "whisper-live" (default,
// offline/local via faster-whisper) or "azure" (Azure Speech SDK, optional).

import { EventEmitter } from 'events';
import { config } from '../config/env.js';
import { createWhisperLiveProvider } from './providers/whisperLiveProvider.js';
import { createAzureSpeechProvider } from './providers/azureSpeechProvider.js';
import { logger } from '../utils/logger.js';

// Returns an EventEmitter-based STT session with a consistent interface:
//   .start()                    — connect/initialize the backend
//   .stop()                     — tear down cleanly
//   .sendAudioChunk(buffer)     — feed raw PCM audio in
//   emits 'transcript', { text, isFinal }
//   emits 'error', Error
export function createSttProvider() {
  logger.info(`STT provider: ${config.sttProvider}`);

  const emitter = new EventEmitter();
  let backend;

  switch (config.sttProvider) {
    case 'azure':
      backend = createAzureSpeechProvider(emitter);
      break;
    case 'whisper-live':
    default:
      backend = createWhisperLiveProvider(emitter);
      break;
  }

  return {
    on: (...args) => emitter.on(...args),
    start: () => backend.start(),
    stop: () => backend.stop(),
    sendAudioChunk: (chunk) => backend.sendAudioChunk(chunk),
  };
}

export default { createSttProvider };
