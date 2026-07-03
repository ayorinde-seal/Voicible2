// Voicible — Ollama LLM provider (local, free, default)
// "Every voice, made visible."
//
// Talks to a locally running Ollama instance. Zero cost, zero cloud
// dependency — this is the default provider so Voicible works fully
// offline out of the box.

import fetch from 'node-fetch';
import { config } from '../../config/env.js';

export async function convertToGlossOllama(text, systemPrompt) {
  const response = await fetch(config.ollamaEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt: `${systemPrompt}\n\nText: "${text}"\n\nGloss:`,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || '';
}

export default { convertToGlossOllama };
