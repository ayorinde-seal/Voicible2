// Voicible — whisper-live STT provider (offline, faster-whisper backend, default)
// "Every voice, made visible."
//
// Connects to a locally running whisper-live server over WebSocket and
// streams raw audio to it. Requires zero cloud API calls — this is why
// it's the default so Voicible works fully offline out of the box.
// See: https://github.com/collabora/WhisperLive

import WebSocket from 'ws';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export function createWhisperLiveProvider(emitter) {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    try {
      ws = new WebSocket(config.whisperLiveUrl);

      ws.on('open', () => {
        logger.success(`Connected to whisper-live at ${config.whisperLiveUrl} (model=${config.whisperLiveModel})`);
        ws.send(JSON.stringify({
          uid: `voicible-${Date.now()}`,
          language: 'en',
          task: 'transcribe',
          model: config.whisperLiveModel,
          use_vad: true,
        }));
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          // whisper-live emits partial + final segments; we normalize
          // both into the same { text, isFinal } shape.
          if (msg.segments && Array.isArray(msg.segments)) {
            const last = msg.segments[msg.segments.length - 1];
            if (last && last.text) {
              emitter.emit('transcript', {
                text: last.text.trim(),
                isFinal: Boolean(msg.eos || last.completed),
              });
            }
          } else if (msg.text) {
            emitter.emit('transcript', { text: msg.text.trim(), isFinal: Boolean(msg.isFinal) });
          }
        } catch (err) {
          logger.warn(`whisper-live: could not parse message: ${err.message}`);
        }
      });

      ws.on('close', () => {
        logger.warn('whisper-live connection closed — attempting reconnect in 3s');
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        emitter.emit('error', err);
        logger.error(`whisper-live socket error: ${err.message}`);
      });
    } catch (err) {
      emitter.emit('error', err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  return {
    start: () => connect(),
    stop: () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    },
    sendAudioChunk: (chunk) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    },
  };
}

export default { createWhisperLiveProvider };
