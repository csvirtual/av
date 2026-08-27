// Orquestrador principal: liga chat, editor visual, preview, configurações
// (BYOK) e projetos salvos em torno de UM único estado de projeto
// compartilhado (schema.js). É essa única fonte de verdade que faz "pedir
// para a IA" e "arrastar um componente" serem duas formas de editar o mesmo
// sistema, não dois modos desconectados.

const { CSB_SCHEMA: Schema, CSB_RENDER: Render, CSB_STORAGE: Storage, CSB_CANVAS: Canvas } = window;

let project = null;
let selectedId = null;
let dirty = false;
let saveTimer = null;

const $ = (id) => document.getElementById(id);

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (dirty) { Storage.saveProject(project); dirty = false; } }, 400);
}

// ---- Tabs ----

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      $(`view-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'preview') updatePreview();
      if (btn.dataset.tab === 'editor') rerenderEditor();
    });
  });
}

// ---- Editor visual ----

function regenerateIds(node) {
  node.id = Schema.uid();
  if (node.children) node.children.forEach(regenerateIds);
  return node;
}

function moveNodeInTree(nodeId, newParentId, newIndex) {
  if (nodeId === newParentId) return;
  const node = Schema.findNode(project.tree, nodeId);
  const oldParent = Schema.findParent(project.tree, nodeId);
  if (!node || !oldParent) return;
  if (Schema.findNode(node, newParentId)) return; // não pode virar filho do próprio descendente
  const newParent = Schema.findNode(project.tree, newParentId);
  if (!newParent || !Schema.canHaveChildren(newParent.type)) return;
  const oldIndex = oldParent.children.findIndex((c) => c.id === nodeId);
  oldParent.children.splice(oldIndex, 1);
  let insertIndex = newIndex;
  if (oldParent === newParent && oldIndex < insertIndex) insertIndex -= 1;
  newParent.children.splice(insertIndex, 0, node);
}

function onSelect(id) {
  selectedId = id;
  rerenderEditor();
}

function onDropNew(parentId, index, type) {
  const parent = Schema.findNode(project.tree, parentId);
  if (!parent) return;
  const node = Schema.createNode(type);
  parent.children.splice(index, 0, node);
  selectedId = node.id;
  scheduleSave();
  rerenderEditor();
  updatePreview();
}

function onMoveExisting(nodeId, newParentId, index) {
  moveNodeInTree(nodeId, newParentId, index);
  scheduleSave();
  rerenderEditor();
  updatePreview();
}

function onFieldChange(nodeId, field, value) {
  const node = Schema.findNode(project.tree, nodeId);
  if (!node) return;
  if (!node[field.target]) node[field.target] = {};
  node[field.target][field.key] = value;
  scheduleSave();
  rerenderEditor({ skipInspectorFocusLoss: true });
  updatePreview();
}

function onDuplicate(nodeId) {
  const node = Schema.findNode(project.tree, nodeId);
  const parent = Schema.findParent(project.tree, nodeId);
  if (!node || !parent) return;
  const copy = regenerateIds(Schema.cloneNode(node));
  const idx = parent.children.findIndex((c) => c.id === nodeId);
  parent.children.splice(idx + 1, 0, copy);
  selectedId = copy.id;
  scheduleSave();
  rerenderEditor();
  updatePreview();
}

function onDelete(nodeId) {
  Schema.removeNode(project.tree, nodeId);
  if (selectedId === nodeId) selectedId = null;
  scheduleSave();
  rerenderEditor();
  updatePreview();
}

function onMove(nodeId, dir) {
  const parent = Schema.findParent(project.tree, nodeId);
  if (!parent) return;
  const idx = parent.children.findIndex((c) => c.id === nodeId);
  const target = idx + dir;
  if (target < 0 || target >= parent.children.length) return;
  const [item] = parent.children.splice(idx, 1);
  parent.children.splice(target, 0, item);
  scheduleSave();
  rerenderEditor();
  updatePreview();
}

function rerenderEditor() {
  Canvas.renderCanvas($('canvas-root'), project.tree, {
    selectedId, onSelect, onDropNew, onMoveExisting,
  });
  Canvas.renderLayers($('layers'), project.tree, selectedId, onSelect);
  const selectedNode = selectedId ? Schema.findNode(project.tree, selectedId) : null;
  Canvas.renderInspector($('inspector'), selectedNode, selectedNode ? selectedNode.id === project.tree.id : false, {
    onChange: onFieldChange, onDuplicate, onDelete, onMove,
  });
}

// ---- Preview / Código ----

// Só escreve no iframe quando a aba Preview está realmente visível: um
// sandboxed <iframe> que recebe conteúdo enquanto está dentro de um
// ancestral com display:none pode ficar com o viewport interno travado em
// 0x0 mesmo depois do ancestral voltar a ser exibido (o layout do
// documento-filho não é sempre recalculado só por o pai mudar de tamanho).
// Por isso o preview é sempre atualizado de novo no momento em que a aba
// fica ativa (ver initTabs), e chamadas feitas com a aba escondida só
// marcam "desatualizado" em vez de escrever no DOM escondido.
let previewDirty = true;

function updatePreview() {
  const isVisible = $('view-preview').classList.contains('active');
  if (!isVisible) { previewDirty = true; return; }
  const doc = Render.buildFullDocument(project);
  $('preview-frame').srcdoc = doc;
  $('code-view').value = doc;
  previewDirty = false;
}

function initPreviewTab() {
  document.querySelectorAll('#preview-mode .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#preview-mode .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const isCode = btn.dataset.mode === 'code';
      $('preview-frame').style.display = isCode ? 'none' : 'block';
      $('code-view').style.display = isCode ? 'block' : 'none';
    });
  });
  $('btn-copy-code').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('code-view').value);
    flashSaved('btn-copy-code', 'Copiado!');
  });
  $('btn-download').addEventListener('click', () => {
    const blob = new Blob([$('code-view').value], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project.name || 'sistema').replace(/[^a-z0-9-_]+/gi, '-')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

function flashSaved(btnId, text) {
  const btn = $(btnId);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

// ---- Configurações ----

async function initConfigTab() {
  const providerSelect = $('cfg-provider');
  const modelInput = $('cfg-model');
  const datalist = $('model-suggestions');
  const keyHelp = $('cfg-key-help');
  const apiKeyInput = $('cfg-apikey');

  for (const [id, cfg] of Object.entries(window.CSB_PROVIDERS.PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = cfg.label;
    providerSelect.appendChild(opt);
  }

  const settings = await Storage.getSettings();

  function paintProvider(providerId) {
    const cfg = window.CSB_PROVIDERS.PROVIDERS[providerId];
    keyHelp.textContent = cfg.keyHelp;
    modelInput.placeholder = cfg.defaultModel;
    datalist.innerHTML = '';
    cfg.modelSuggestions.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      datalist.appendChild(opt);
    });
    apiKeyInput.value = settings.apiKeys?.[providerId] || '';
  }

  providerSelect.value = settings.provider || 'groq';
  modelInput.value = settings.model || '';
  paintProvider(providerSelect.value);
  providerSelect.addEventListener('change', () => paintProvider(providerSelect.value));

  $('cfg-save').addEventListener('click', async () => {
    const providerId = providerSelect.value;
    await Storage.saveSettings({
      provider: providerId,
      model: modelInput.value.trim(),
      apiKeys: { [providerId]: apiKeyInput.value.trim() },
    });
    $('cfg-saved-msg').textContent = 'Configurações salvas.';
    setTimeout(() => { $('cfg-saved-msg').textContent = ''; }, 2000);
  });
}

// ---- Projetos ----

async function refreshProjectsList() {
  const list = await Storage.listProjects();
  const container = $('projects-list');
  container.innerHTML = '';
  if (!list.length) {
    container.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: 'Nenhum projeto salvo ainda.' }));
    return;
  }
  for (const entry of list.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const row = document.createElement('div');
    row.className = 'project-row';
    row.innerHTML = `<div><div class="name"></div><div class="meta"></div></div>`;
    row.querySelector('.name').textContent = entry.name;
    row.querySelector('.meta').textContent = new Date(entry.updatedAt).toLocaleString('pt-BR');
    const openBtn = document.createElement('button');
    openBtn.className = 'btn small'; openBtn.textContent = 'Abrir';
    openBtn.addEventListener('click', () => loadProjectById(entry.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger'; delBtn.textContent = 'Excluir';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Excluir "${entry.name}"? Essa ação não pode ser desfeita.`)) return;
      await Storage.deleteProject(entry.id);
      if (project.id === entry.id) startNewProject();
      refreshProjectsList();
    });
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  }
}

async function loadProjectById(id) {
  const loaded = await Storage.loadProject(id);
  if (!loaded) return;
  project = loaded;
  selectedId = null;
  await Storage.setCurrentProjectId(project.id);
  $('proj-name').value = project.name;
  rerenderEditor();
  updatePreview();
}

function startNewProject() {
  project = Schema.createProject('Novo projeto');
  selectedId = null;
  dirty = false;
  $('proj-name').value = project.name;
  rerenderEditor();
  updatePreview();
}

function initProjectsTab() {
  $('proj-save').addEventListener('click', async () => {
    const name = $('proj-name').value.trim() || 'Projeto sem nome';
    project.name = name;
    project.meta.title = name;
    await Storage.saveProject(project);
    dirty = false;
    refreshProjectsList();
    flashSaved('proj-save', 'Salvo!');
  });
  $('proj-new').addEventListener('click', () => {
    if (dirty && !confirm('Começar um novo projeto? As alterações não salvas do atual serão perdidas.')) return;
    startNewProject();
  });
}

// ---- Boot ----

async function boot() {
  initTabs();
  initPreviewTab();
  initProjectsTab();
  await initConfigTab();

  const currentId = await Storage.getCurrentProjectId();
  if (currentId) {
    const loaded = await Storage.loadProject(currentId);
    project = loaded || Schema.createProject('Meu sistema');
  } else {
    project = Schema.createProject('Meu sistema');
  }
  $('proj-name').value = project.name;

  Canvas.renderPalette($('palette'));
  rerenderEditor();
  updatePreview();
  refreshProjectsList();

  window.CSB_CHAT.initChat(
    { messagesEl: $('chat-messages'), inputEl: $('chat-input'), sendBtn: $('chat-send') },
    {
      getProject: () => project,
      getSettings: () => Storage.getSettings(),
      onProjectReady: (newProject) => {
        project.tree = newProject.tree;
        project.css = newProject.css;
        project.js = newProject.js;
        if (newProject.meta?.title) project.meta.title = newProject.meta.title;
        selectedId = null;
        scheduleSave();
        rerenderEditor();
        updatePreview();
        refreshProjectsList();
      },
    },
  );
}

document.addEventListener('DOMContentLoaded', boot);
