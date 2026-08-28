import { localProvider } from './providers/local.js';
import { anthropicProvider } from './providers/anthropic.js';
import { openaiProvider } from './providers/openai.js';

const PROVIDERS = {
  local: localProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function getProvider(id) {
  return PROVIDERS[id] || localProvider;
}
