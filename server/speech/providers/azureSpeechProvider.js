// Voicible — Azure Speech STT provider (cloud, optional paid upgrade)
// "Every voice, made visible."
//
// Only used when STT_PROVIDER=azure. Requires the microsoft-cognitiveservices-
// speech-sdk package and AZURE_SPEECH_KEY / AZURE_SPEECH_REGION to be set.
// Voicible never silently falls back to a paid API without explicit config.

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export function createAzureSpeechProvider(emitter) {
  let recognizer = null;
  let pushStream = null;

  async function start() {
    if (!config.azureSpeechKey) {
      const err = new Error('STT_PROVIDER=azure but AZURE_SPEECH_KEY is not set.');
      emitter.emit('error', err);
      logger.error(err.message);
      return;
    }

    // Lazy-loaded so the SDK is only required when this provider is
    // actually selected — keeps the offline default dependency-free.
    const sdk = await import('microsoft-cognitiveservices-speech-sdk');

    const speechConfig = sdk.SpeechConfig.fromSubscription(config.azureSpeechKey, config.azureSpeechRegion);
    speechConfig.speechRecognitionLanguage = 'en-US';

    pushStream = sdk.AudioInputStream.createPushStream();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognizing = (_s, e) => {
      emitter.emit('transcript', { text: e.result.text, isFinal: false });
    };
    recognizer.recognized = (_s, e) => {
      if (e.result.text) {
        emitter.emit('transcript', { text: e.result.text, isFinal: true });
      }
    };
    recognizer.canceled = (_s, e) => {
      emitter.emit('error', new Error(`Azure Speech canceled: ${e.errorDetails}`));
    };

    recognizer.startContinuousRecognitionAsync(
      () => logger.success(`Azure Speech recognition started (region=${config.azureSpeechRegion})`),
      (err) => emitter.emit('error', new Error(err))
    );
  }

  function stop() {
    if (recognizer) {
      recognizer.stopContinuousRecognitionAsync();
      recognizer.close();
      recognizer = null;
    }
    if (pushStream) {
      pushStream.close();
      pushStream = null;
    }
  }

  function sendAudioChunk(chunk) {
    if (pushStream) {
      pushStream.write(chunk);
    }
  }

  return { start, stop, sendAudioChunk };
}

export default { createAzureSpeechProvider };
