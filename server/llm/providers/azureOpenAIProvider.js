// Voicible — Azure OpenAI LLM provider (cloud, optional paid upgrade)
// "Every voice, made visible."
//
// Only used when LLM_PROVIDER=azure. Requires AZURE_OPENAI_ENDPOINT,
// AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_KEY to be set — Voicible
// never silently falls back to a paid API without explicit configuration.

import fetch from 'node-fetch';
import { config } from '../../config/env.js';

export async function convertToGlossAzureOpenAI(text, systemPrompt) {
  if (!config.azureOpenAIEndpoint || !config.azureOpenAIApiKey || !config.azureOpenAIDeployment) {
    throw new Error(
      'Azure OpenAI provider selected but AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_DEPLOYMENT / AZURE_OPENAI_API_KEY are not fully configured.'
    );
  }

  const url = `${config.azureOpenAIEndpoint.replace(/\/$/, '')}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=${config.azureOpenAIApiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.azureOpenAIApiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure OpenAI request failed: ${response.status} ${response.statusText} — ${body}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export default { convertToGlossAzureOpenAI };
