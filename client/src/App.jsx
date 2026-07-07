// Voicible — Root application component
// "Every voice, made visible."
//
// Connects to the server's WebSocket broadcaster and renders the avatar
// display: Three.js avatar scene, live caption bar (always-visible text
// fallback), status bar (providers, connection, vocabulary coverage %),
// and the required SLMocapArchive credit footer. Dark UI, brand colours,
// fullscreen via the F key.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import AvatarScene from './avatar/AvatarScene.jsx';
import CaptionBar from './display/CaptionBar.jsx';
import StatusBar from './display/StatusBar.jsx';
import VoicibleFooter from './display/VoicibleFooter.jsx';
import { startMicCapture } from './audio/micCapture.js';

// server/index.js attaches the WebSocket broadcaster to the SAME HTTP
// server as the REST API (see startBroadcaster(server) — the standalone
// config.wsPort/8080 branch only fires if no server is passed, which
// never happens in the real startup path), so this must point at the
// API port (3000 in dev), not WS_PORT/8080.
const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3000`;
const RECONNECT_DELAY_MS = 3000;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState({ sttProvider: '—', llmProvider: '—', venueName: 'Voicible Live' });
  // The caption shows the text + gloss of the sequence CURRENTLY being
  // signed — not the live STT partials, which run ahead of the avatar
  // because pose sequences queue up. Each pose sequence now carries its
  // own originalText + gloss (server/index.js), and these advance only
  // when that sequence actually starts playing (see advancePoseQueue and
  // the poseSequence handler), so text and signing stay aligned.
  const [activeText, setActiveText] = useState('');
  const [activeGloss, setActiveGloss] = useState('');
  const [poseSequence, setPoseSequence] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  // Signing playback rate, user-adjustable from the display itself.
  // Scales the avatar's frame clock only — capture/STT/queueing are
  // untouched; a slower rate just drains the pose queue more slowly.
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  // Sequences queue here rather than replacing `poseSequence` outright —
  // the server now streams incremental gloss+sign chunks as speech comes
  // in (server/index.js's createUtteranceChunker) instead of waiting for
  // one full "final" transcript, so multiple pose sequences can arrive in
  // quick succession. Without a queue, each new one would cut off
  // whatever the avatar was still mid-way through signing. Lives in a
  // ref (not state) since draining it doesn't itself need a re-render —
  // only advancing `poseSequence` does.
  const poseQueueRef = useRef([]);
  // Mirrors "is a sequence currently active", read/written as a plain
  // side effect outside any setState updater — NOT derived from the
  // `poseSequence` state value inside a functional updater. React 18
  // StrictMode intentionally double-invokes setState updater functions
  // to catch impure ones (see the React docs on Strict Mode), and an
  // earlier version of this code did `setPoseSequence(current => { if
  // (!current) return payload; poseQueueRef.current.push(payload); ...
  // })` — the push was a side effect inside the updater, so StrictMode's
  // double-invoke silently double-pushed every single incoming sequence,
  // corrupting the queue order. Tracking play state in this ref instead
  // keeps every setPoseSequence call a plain, idempotent direct value
  // set, which is safe to invoke more than once.
  const isPlayingRef = useRef(false);

  const advancePoseQueue = useCallback(() => {
    const next = poseQueueRef.current.shift();
    isPlayingRef.current = Boolean(next);
    setPoseSequence(next || null);
    // Advance the caption to the newly-active sequence's own text/gloss.
    // When the queue drains (no next), leave the last text on screen —
    // it matches the avatar freezing on its last sign (freeze-on-last).
    if (next) {
      setActiveText(next.originalText || '');
      setActiveGloss(next.gloss || '');
    }
  }, []);

  // Distinguishes a real unexpected drop from a stale/superseded socket
  // closing (React 18 StrictMode double-invokes effects in dev — mounts,
  // immediately cleans up, mounts again — and WebSocket close is async,
  // so the FIRST socket's onclose fires later, after the SECOND socket
  // is already connected). A single "did we intend to close" flag isn't
  // enough: the second mount resets any such flag back to true before
  // the first socket's belated onclose reads it. Checking `wsRef.current
  // === socket` instead correctly identifies "am I still the active
  // connection" regardless of flag timing — a stale socket finds it's
  // been replaced and skips reconnecting; the real, current socket
  // reconnects normally if it actually drops. Without this, the phantom
  // reconnect briefly left two live sockets both receiving every
  // broadcast (visible as e.g. a sign appearing to play twice in a row).
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(() => {
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      if (shouldReconnectRef.current && wsRef.current === socket) {
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
    socket.onerror = () => socket.close();

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'status':
          setStatus((prev) => ({ ...prev, ...msg.payload }));
          if (msg.payload.vocabularyCoverage) setCoverage(msg.payload.vocabularyCoverage);
          break;
        case 'caption':
          // Live STT partials: shown ONLY as a listening preview while
          // nothing is being signed yet. Once a sequence is playing, the
          // caption is driven by that sequence (activeText/activeGloss)
          // so the text stays aligned with the avatar, not the partials.
          if (!isPlayingRef.current) setActiveText(msg.payload.text);
          break;
        case 'gloss':
          // Superseded by the gloss carried on each poseSequence (which
          // advances in lockstep with playback) — ignored for display.
          break;
        case 'poseSequence':
          if (msg.payload.coverage) setCoverage(msg.payload.coverage);
          // Nothing playing right now — start immediately and show this
          // sequence's text/gloss. Otherwise queue it; advancePoseQueue
          // (passed to AvatarScene) pulls the next one once the current
          // sequence finishes, updating the caption as it goes.
          if (isPlayingRef.current) {
            poseQueueRef.current.push(msg.payload);
          } else {
            isPlayingRef.current = true;
            setPoseSequence(msg.payload);
            setActiveText(msg.payload.originalText || '');
            setActiveGloss(msg.payload.gloss || '');
          }
          break;
        case 'error':
          setErrorMessage(msg.payload.message);
          setTimeout(() => setErrorMessage(null), 6000);
          break;
        default:
          break;
      }
    };
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Streams mic audio to the server over the same WebSocket connection
  // used for receiving broadcasts (server/websocket/broadcaster.js
  // forwards any binary frame it receives to the STT provider). Started
  // once on mount — a live venue display, not a user-triggered action,
  // so no "start listening" button; the mic permission prompt itself is
  // the only user-facing gate.
  useEffect(() => {
    let micHandle;
    let cancelled = false;

    startMicCapture((chunk) => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(chunk);
      }
    })
      .then((handle) => {
        if (cancelled) {
          handle.stop();
        } else {
          micHandle = handle;
        }
      })
      .catch((err) => {
        setErrorMessage(`Microphone error: ${err.message}`);
      });

    return () => {
      cancelled = true;
      micHandle?.stop();
    };
  }, []);

  // Fullscreen toggle on the "F" key, standard for a display/kiosk screen.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key.toLowerCase() === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#1A1A2E' }}>
      <StatusBar
        sttProvider={status.sttProvider}
        llmProvider={status.llmProvider}
        connected={connected}
        coverage={coverage}
        venueName={status.venueName}
      />

      <AvatarScene poseSequence={poseSequence} playbackSpeed={playbackSpeed} onSequenceComplete={advancePoseQueue} />

      <CaptionBar text={activeText} gloss={activeGloss} />

      <VoicibleFooter />

      <div
        style={{
          position: 'absolute',
          right: 16,
          top: 52, // below the StatusBar, clear of the full-width caption bar
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(26, 26, 46, 0.85)',
          border: '1px solid #2D6BE4',
          borderRadius: 8,
          padding: '6px 12px',
          color: '#EAEAF2',
          fontSize: 12,
        }}
      >
        <span style={{ whiteSpace: 'nowrap' }}>Signing speed</span>
        <input
          type="range"
          min="0.5"
          max="8"
          step="0.5"
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          style={{ width: 140, accentColor: '#00D4AA' }}
          aria-label="Signing speed"
        />
        <span style={{ minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          ×{playbackSpeed.toFixed(1)}
        </span>
      </div>

      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FF6B6B',
            color: '#1A1A2E',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
