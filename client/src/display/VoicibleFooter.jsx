// Voicible — Required footer credit
// "Every voice, made visible."
//
// CC0 doesn't legally require attribution, but crediting Studio Galt's
// SLMocapArchive is required by this project's own branding rules and is
// good practice for a data source this central to the product.

import React from 'react';

export default function VoicibleFooter() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        textAlign: 'center',
        padding: '8px 12px',
        fontSize: 11,
        color: '#6b7086',
        background: 'rgba(26, 26, 46, 0.6)',
      }}
    >
      Sign motion data from the SLMocapArchive by Studio Galt (CC0) · Voicible — "Every voice, made visible."
    </div>
  );
}
