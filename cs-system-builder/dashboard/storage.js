// Camada fina sobre chrome.storage.local. Tudo fica só no dispositivo do
// usuário — inclusive as chaves de API (BYOK) — nunca em storage.sync
// (que sincronizaria com a conta Google) e nunca em servidor nenhum.

const SETTINGS_KEY = 'csb:settings';
const PROJECT_INDEX_KEY = 'csb:projectIndex';
const CURRENT_PROJECT_KEY = 'csb:currentProjectId';

function projectKey(id) {
  return `csb:project:${id}`;
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || { provider: 'groq', model: '', apiKeys: {} };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    apiKeys: { ...current.apiKeys, ...(partial.apiKeys || {}) },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function listProjects() {
  const data = await chrome.storage.local.get(PROJECT_INDEX_KEY);
  return data[PROJECT_INDEX_KEY] || [];
}

async function saveProject(project) {
  project.updatedAt = Date.now();
  const index = await listProjects();
  const entry = { id: project.id, name: project.name, updatedAt: project.updatedAt };
  const idx = index.findIndex((p) => p.id === project.id);
  if (idx >= 0) index[idx] = entry; else index.unshift(entry);
  await chrome.storage.local.set({
    [projectKey(project.id)]: project,
    [PROJECT_INDEX_KEY]: index,
    [CURRENT_PROJECT_KEY]: project.id,
  });
}

async function loadProject(id) {
  const data = await chrome.storage.local.get(projectKey(id));
  return data[projectKey(id)] || null;
}

async function deleteProject(id) {
  const index = (await listProjects()).filter((p) => p.id !== id);
  await chrome.storage.local.remove(projectKey(id));
  await chrome.storage.local.set({ [PROJECT_INDEX_KEY]: index });
}

async function getCurrentProjectId() {
  const data = await chrome.storage.local.get(CURRENT_PROJECT_KEY);
  return data[CURRENT_PROJECT_KEY] || null;
}

async function setCurrentProjectId(id) {
  await chrome.storage.local.set({ [CURRENT_PROJECT_KEY]: id });
}

window.CSB_STORAGE = {
  getSettings, saveSettings, listProjects, saveProject, loadProject,
  deleteProject, getCurrentProjectId, setCurrentProjectId,
};
