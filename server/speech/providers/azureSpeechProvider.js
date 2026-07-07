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

    // Segmentation strategy controls when a spoken phrase is considered
    // "done" and a final (not just partial) transcript fires — see the
    // config.js comment above azureSegmentationStrategy for the tradeoffs.
    // "Semantic" (default) has no adjustable timeout; only set the pause
    // duration when explicitly using "Time" mode, since Azure's SDK
    // treats an irrelevant property being set at all as something to
    // validate/reject in some versions rather than silently ignoring it.
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, config.azureSegmentationStrategy);
    if (config.azureSegmentationStrategy === 'Time') {
      speechConfig.setProperty(
        sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
        String(config.azureSegmentationSilenceTimeoutMs)
      );
    }

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
    if (!pushStream) return;
    // pushStream.write() requires a real ArrayBuffer (default format is
    // 16kHz/16-bit/mono PCM, matching what we send) — `chunk` arrives
    // here as a Node Buffer (from ws's binary message frames), and a
    // Buffer is a VIEW into an ArrayBuffer, not an ArrayBuffer itself
    // (`chunk instanceof ArrayBuffer` is false), so it must be sliced
    // out explicitly rather than passed through directly.
    const arrayBuffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    pushStream.write(arrayBuffer);
  }

  return { start, stop, sendAudioChunk };
}

export default { createAzureSpeechProvider };
