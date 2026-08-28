// Token economy (spec §17): cache identical requests, and read/write
// provider settings from the right storage tier — provider id + model in
// chrome.storage.local (small, not secret, survives restarts so the user
// doesn't reconfigure every session), the API key in chrome.storage.session
// (never touches disk, cleared when the browser closes — spec §14 security).

const cache = new Map();
const CACHE_LIMIT = 50;

function hashKey(obj) {
  const str = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `k_${h}`;
}

export async function withCache(payload, fn) {
  const key = hashKey(payload);
  if (cache.has(key)) return cache.get(key);
  const result = await fn();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage?.local && chrome.storage?.session;

export async function getSettings() {
  if (!hasChromeStorage) return { provider: 'local', model: '', apiKey: '' };
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['provider', 'model']),
    chrome.storage.session.get(['apiKey']),
  ]);
  return { provider: local.provider || 'local', model: local.model || '', apiKey: session.apiKey || '' };
}

export async function saveSettings({ provider, model, apiKey }) {
  if (!hasChromeStorage) return;
  await chrome.storage.local.set({ provider, model });
  await chrome.storage.session.set({ apiKey: apiKey || '' });
}

/** Compact, incremental context for an "edit this" command — never the whole project. */
export function buildNodeContext(project, nodeId) {
  for (const page of project.pages) {
    const stack = [page.tree];
    while (stack.length) {
      const node = stack.pop();
      if (node.id === nodeId) return { page: { name: page.name, route: page.route }, node };
      stack.push(...node.children);
    }
  }
  return null;
}
