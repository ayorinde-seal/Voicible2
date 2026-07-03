// Voicible — WebSocket broadcaster
// "Every voice, made visible."
//
// Manages all connected frontend clients and pushes pipeline events to
// them: live captions, gloss conversion, vocabulary coverage, and the
// stitched pose/keyframe stream for avatar playback.

import { WebSocketServer } from 'ws';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

let wss = null;
const clients = new Set();

export function startBroadcaster(server) {
  wss = server ? new WebSocketServer({ server }) : new WebSocketServer({ port: config.wsPort });

  wss.on('connection', (socket) => {
    clients.add(socket);
    logger.info(`Client connected (${clients.size} total)`);

    socket.send(JSON.stringify({
      type: 'status',
      payload: {
        venueName: config.venueName,
        sttProvider: config.sttProvider,
        llmProvider: config.llmProvider,
        connected: true,
      },
    }));

    socket.on('close', () => {
      clients.delete(socket);
      logger.info(`Client disconnected (${clients.size} total)`);
    });

    socket.on('error', (err) => {
      logger.error(`Client socket error: ${err.message}`);
      clients.delete(socket);
    });
  });

  if (!server) {
    logger.success(`WebSocket broadcaster listening on ws://localhost:${config.wsPort}`);
  }

  return wss;
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

// Live transcription text as it streams in (partial or final), used for
// the caption bar fallback that's always shown alongside the avatar.
export function broadcastCaption(text, isFinal) {
  broadcast({ type: 'caption', payload: { text, isFinal } });
}

// The ASL gloss string produced by the LLM for a finalized utterance.
export function broadcastGloss(originalText, gloss) {
  broadcast({ type: 'gloss', payload: { originalText, gloss } });
}

// The stitched keyframe stream ready for avatar playback, plus vocabulary
// coverage stats so the frontend's coverage indicator can update live.
export function broadcastPoseSequence(stitchedSequence) {
  broadcast({ type: 'poseSequence', payload: stitchedSequence });
}

export function broadcastStatus(statusPatch) {
  broadcast({ type: 'status', payload: statusPatch });
}

export function broadcastError(message) {
  broadcast({ type: 'error', payload: { message } });
}

export function clientCount() {
  return clients.size;
}

export default {
  startBroadcaster,
  broadcastCaption,
  broadcastGloss,
  broadcastPoseSequence,
  broadcastStatus,
  broadcastError,
  clientCount,
};
