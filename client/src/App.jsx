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

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:8080`;
const RECONNECT_DELAY_MS = 3000;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState({ sttProvider: '—', llmProvider: '—', venueName: 'Voicible Live' });
  const [captionText, setCaptionText] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [gloss, setGloss] = useState('');
  const [poseSequence, setPoseSequence] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
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
          setCaptionText(msg.payload.text);
          setIsFinal(msg.payload.isFinal);
          break;
        case 'gloss':
          setGloss(msg.payload.gloss);
          break;
        case 'poseSequence':
          setPoseSequence(msg.payload);
          if (msg.payload.coverage) setCoverage(msg.payload.coverage);
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
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

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

      <AvatarScene poseSequence={poseSequence} />

      <CaptionBar
        captionText={captionText}
        isFinal={isFinal}
        gloss={gloss}
        wordBoundaries={poseSequence?.wordBoundaries}
      />

      <VoicibleFooter />

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
