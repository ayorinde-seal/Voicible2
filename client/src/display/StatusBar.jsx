// Voicible — Status bar
// "Every voice, made visible."
//
// Shows STT/LLM provider, connection state, and the vocabulary coverage
// indicator — the single most important debugging signal for whether
// avatar output will actually make sense to a Deaf viewer (Phase 1+ per
// project spec). Never hidden, always visible during a live session.

import React from 'react';

function coverageColor(pct) {
  if (pct >= 90) return '#00D4AA';
  if (pct >= 70) return '#FFD166';
  return '#FF6B6B';
}

export default function StatusBar({ sttProvider, llmProvider, connected, coverage, venueName }) {
  const pct = coverage?.percentFound ?? null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        background: 'rgba(26, 26, 46, 0.7)',
        fontSize: 13,
        color: '#9AA0B4',
        borderBottom: '1px solid rgba(45, 107, 228, 0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? '#00D4AA' : '#FF6B6B',
            display: 'inline-block',
          }}
        />
        <strong style={{ color: '#F2F3F7' }}>{venueName || 'Voicible Live'}</strong>
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <span>STT: <strong style={{ color: '#F2F3F7' }}>{sttProvider}</strong></span>
        <span>LLM: <strong style={{ color: '#F2F3F7' }}>{llmProvider}</strong></span>
        {pct !== null && (
          <span>
            Vocabulary coverage:{' '}
            <strong style={{ color: coverageColor(pct) }}>
              {pct}% ({coverage.found} signed{coverage.synth ? `, ${coverage.synth} synth` : ''}, {coverage.fingerspelled} fingerspelled, {coverage.missing} missing)
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}
