// Voicible — Azure OpenAI LLM provider (cloud, optional paid upgrade)
// "Every voice, made visible."
//
// Only used when LLM_PROVIDER=azure. Requires AZURE_OPENAI_ENDPOINT,
// AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_KEY to be set — Voicible
// never silently falls back to a paid API without explicit configuration.

import fetch from 'node-fetch';
import { config } from '../../config/env.js';

// Strips a Foundry "Project" path (.../api/projects/<name>) down to the
// bare resource root. The Azure AI Foundry portal prominently shows the
// Project endpoint (used by the Foundry SDK for agents/assistants), but
// direct REST chat-completions calls need the resource endpoint instead
// — https://<resource>.services.ai.azure.com, not .../api/projects/...
// (confirmed against Microsoft's current REST reference; this is a
// self-correcting normalization, not a strict validation, since copying
// the wrong one from the portal is an easy, recurring mistake).
function resourceRootFrom(endpoint) {
  return endpoint.replace(/\/api\/projects\/[^/]+\/?$/, '').replace(/\/$/, '');
}

export async function convertToGlossAzureOpenAI(text, systemPrompt) {
  if (!config.azureOpenAIEndpoint || !config.azureOpenAIApiKey || !config.azureOpenAIDeployment) {
    throw new Error(
      'Azure OpenAI provider selected but AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_DEPLOYMENT / AZURE_OPENAI_API_KEY are not fully configured.'
    );
  }

  const url = `${resourceRootFrom(config.azureOpenAIEndpoint)}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=${config.azureOpenAIApiVersion}`;

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
