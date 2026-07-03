// Voicible — Live caption bar
// "Every voice, made visible."
//
// Always-visible fallback showing the original transcribed text, plus
// the current ASL gloss. Words that couldn't be found in the dictionary
// AND couldn't be fingerspelled are visually flagged — Voicible never
// silently drops a word.

import React from 'react';

export default function CaptionBar({ captionText, isFinal, gloss, wordBoundaries }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '86%',
        maxWidth: 900,
        background: 'rgba(26, 26, 46, 0.82)',
        border: '1px solid rgba(45, 107, 228, 0.4)',
        borderRadius: 12,
        padding: '14px 20px',
        textAlign: 'center',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 500, opacity: isFinal ? 1 : 0.6 }}>
        {captionText || <span style={{ opacity: 0.4 }}>Listening…</span>}
      </div>

      {gloss ? (
        <div style={{ marginTop: 8, fontSize: 14, color: '#9AA0B4', letterSpacing: 0.5 }}>
          {(wordBoundaries && wordBoundaries.length ? wordBoundaries : gloss.split(' ').map((w) => ({ word: w, found: true, textOnly: false }))).map((w, i) => (
            <span
              key={`${w.word}-${i}`}
              style={{
                marginRight: 8,
                color: w.textOnly ? '#FF6B6B' : w.isFingerspelled ? '#FFD166' : '#00D4AA',
                fontWeight: 600,
              }}
              title={w.textOnly ? 'Not found in dictionary or fingerspelling — text only' : w.isFingerspelled ? 'Fingerspelled fallback' : 'Real mocap dictionary sign'}
            >
              {w.word}
              {w.textOnly ? ' ⚠' : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
