// Voicible — Live caption bar
// "Every voice, made visible."
//
// Shows the sign currently being animated, in lockstep with playback:
// App.jsx drives `text`/`gloss` from the pose sequence that's actually
// playing (advancing with the queue), never the live STT partials that
// run ahead of the avatar. The GLOSS is the hero — large and teal, since
// it names what the hands are doing — with the spoken sentence beneath it
// as smaller context. Presentation follows the first Voicible iteration.

import React from 'react';

const styles = {
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 29, // clears the footer bar
    padding: '16px 32px 14px',
    background: 'rgba(13, 13, 26, 0.78)',
    borderTop: '2px solid #2D6BE4',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  gloss: {
    fontFamily: "'Syne Mono', monospace",
    fontWeight: 400,
    fontSize: 'clamp(1.5rem, 3.6vw, 2.6rem)',
    color: '#00D4AA',
    lineHeight: 1.15,
    textAlign: 'center',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    textShadow: '0 2px 16px rgba(0, 0, 0, 0.9)',
    minHeight: '1.15em',
  },
  text: {
    fontFamily: "'Syne', system-ui, sans-serif",
    fontWeight: 500,
    fontSize: 'clamp(0.85rem, 1.4vw, 1.05rem)',
    color: '#C4CEE6',
    textAlign: 'center',
    letterSpacing: '-0.01em',
    opacity: 0.85,
    minHeight: '1.3em',
  },
  placeholder: {
    fontFamily: "'Syne Mono', monospace",
    fontSize: 'clamp(1.1rem, 2vw, 1.5rem)',
    color: '#8BA4D4',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: 0.45,
    textAlign: 'center',
  },
};

export default function CaptionBar({ text, gloss }) {
  if (!gloss && !text) {
    return (
      <div style={styles.container}>
        <div style={styles.placeholder}>Listening for speech…</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {gloss && <div style={styles.gloss}>{gloss}</div>}
      {text && <div style={styles.text}>{text}</div>}
    </div>
  );
}
