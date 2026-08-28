// Entry point: wires every module to the DOM. Deliberately one file — the
// app is small enough that a router/framework would add more ceremony than
// it removes (spec §29 "máxima capacidade + mínima complexidade").
import { store } from './state/store.js';
import { createHistory } from './state/history.js';
import { createProject, createPage, createNode, saveProject, loadProject, listProjects, findNode, createSnapshot } from './data/project.js';
import { componentsByCategory, getComponent } from './components/registry.js';
import './components/library.js'; // side-effect: registers all built-in components
import { generateSite } from './codegen/generator.js';
import { reimportSiteHtml } from './codegen/import.js';
import { createPreview } from './runtime/preview.js';
import { createCanvasOverlay } from './builder/canvas.js';
import { renderLayers, initLayersPanel } from './builder/tree.js';
import { renderProperties, initPropertiesPanel } from './builder/properties.js';
import * as cmd from './builder/commands.js';
import { validateProject } from './validate/validator.js';
import { repairAll, REPAIRABLE_CODES } from './validate/repair.js';
import { downloadProjectZip } from './export/exporter.js';
import { generateApp, runCommand } from './ai/planner.js';
import { getSettings, saveSettings } from './ai/contextManager.js';
import { createCommandPalette } from './commandPalette.js';
import { escapeHtml } from './codegen/sanitize.js';
import { icons } from './utils/icons.js';

const $ = (id) => document.getElementById(id);
const CONTAINER_TYPES = new Set(['Container', 'Stack', 'Grid', 'Card', 'Header', 'Sidebar', 'Navbar', 'Footer', 'Modal', 'Tabs', 'Form']);

const el = {
  projectName: $('projectName'),
  btnUndo: $('btnUndo'), btnRedo: $('btnRedo'),
  btnToggleCode: $('btnToggleCode'), btnExport: $('btnExport'), btnSettings: $('btnSettings'),
  btnToggleLeft: $('btnToggleLeft'), btnToggleRight: $('btnToggleRight'),
  panelLeft: document.querySelector('.av-panel--left'), panelRight: document.querySelector('.av-panel--right'),
  panelLayers: $('panelLayers'), panelLibrary: $('panelLibrary'), panelPages: $('panelPages'),
  canvasViewport: $('canvasViewport'), previewFrame: $('previewFrame'), selectionOverlay: $('selectionOverlay'),
  codeView: $('codeView'), codeEditor: $('codeEditor'), codeSyncStatus: $('codeSyncStatus'), btnApplyCode: $('btnApplyCode'),
  consoleDrawer: $('consoleDrawer'), consoleLog: $('consoleLog'), btnClearConsole: $('btnClearConsole'), btnToggleConsole: $('btnToggleConsole'),
  issueBadge: $('issueBadge'), btnValidate: $('btnValidate'), btnRepair: $('btnRepair'), btnReload: $('btnReload'),
  aiPanel: $('aiPanel'), aiPrompt: $('aiPrompt'), btnGenerate: $('btnGenerate'), aiPlan: $('aiPlan'), propertiesPanel: $('propertiesPanel'),
  commandPalette: $('commandPalette'), paletteInput: $('paletteInput'), paletteResults: $('paletteResults'),
  settingsModal: $('settingsModal'), providerSelect: $('providerSelect'), apiKeyInput: $('apiKeyInput'),
  btnCloseSettings: $('btnCloseSettings'), btnCloseSettingsX: $('btnCloseSettingsX'), btnSaveSettings: $('btnSaveSettings'),
};

let history = createHistory(updateUndoRedoButtons);
let lastIssues = [];

const preview = createPreview(el.previewFrame, {
  onConsole: handlePreviewConsole,
  onSelect: (nodeId) => selectNode(nodeId),
  onHover: (nodeId) => store.setState({ hoveredNodeId: nodeId }),
});
const overlay = createCanvasOverlay(el.selectionOverlay);

// ---------------------------------------------------------------- Boot ---

async function boot() {
  const projects = await listProjects().catch(() => []);
  const project = projects.sort((a, b) => b.updatedAt - a.updatedAt)[0] || starterProject();
  loadIntoStore(project);
  wireEvents();
  renderAll();
}

function starterProject() {
  const project = createProject('Meu Aplicativo');
  const tree = createNode('Stack', { direction: 'column', gap: '5' }, [
    createNode('Header', { title: 'Bem-vindo ao AV Builder', subtitle: 'Descreva um app no painel à direita para começar.' }),
    createNode('EmptyState', {
      title: 'Nenhuma página ainda',
      description: 'Use o comando "Gerar aplicação" com uma descrição do que você quer construir.',
      actionLabel: '',
    }),
  ]);
  project.pages = [createPage('Início', '/', tree)];
  return project;
}

function loadIntoStore(project) {
  history = createHistory(updateUndoRedoButtons);
  store.setState({ project, activePageId: project.pages[0]?.id || null, selectedNodeId: null, viewMode: 'visual' });
}

// -------------------------------------------------------------- Render ---

function activePage() {
  const { project, activePageId } = store.getState();
  return project?.pages.find((p) => p.id === activePageId) || project?.pages[0];
}

function renderAll() {
  const { project } = store.getState();
  if (!project) return;
  el.projectName.value = project.name;
  preview.render(project);
  renderLayersPanel();
  renderLibraryPanel();
  renderPagesPanel();
  renderPropertiesPanel();
  updateUndoRedoButtons({ canUndo: history.canUndo, canRedo: history.canRedo });
  persist();
  runValidation(false);
}

function renderLayersPanel() {
  const { selectedNodeId } = store.getState();
  renderLayers(el.panelLayers, activePage()?.tree, selectedNodeId);
}

function renderPropertiesPanel() {
  const { project, selectedNodeId } = store.getState();
  const found = selectedNodeId ? findNode(activePage()?.tree, selectedNodeId) : null;
  renderProperties(el.propertiesPanel, found?.node, project);
  // The AI command box stays visible even with a selection — "select a
  // component, then type 'melhore isso'" (spec §35) needs it reachable at
  // the same time as the properties panel, not hidden behind it.
}

function renderLibraryPanel() {
  const groups = componentsByCategory();
  el.panelLibrary.innerHTML = Object.entries(groups)
    .map(
      ([cat, defs]) => `<div class="av-lib-group"><div class="av-lib-group__title">${escapeHtml(cat)}</div>${defs
        .filter((d) => d.type !== 'Raw')
        .map((d) => `<div class="av-lib-item" data-type="${escapeHtml(d.type)}">${d.meta.icon} ${escapeHtml(d.meta.label)}</div>`)
        .join('')}</div>`
    )
    .join('');
}

function renderPagesPanel() {
  const { project, activePageId } = store.getState();
  el.panelPages.innerHTML =
    project.pages
      .map(
        (p) => `<div class="av-tree-row${p.id === activePageId ? ' is-selected' : ''}" data-page-id="${p.id}">
      <span class="av-tree-row__label">${escapeHtml(p.name)}</span>
      <span class="av-hint">${escapeHtml(p.route)}</span>
      <button class="av-btn av-btn--icon av-btn--small" data-action="delete-page" title="Excluir página" tabindex="-1">${icons.trash}</button>
    </div>`
      )
      .join('') + `<button id="btnAddPage" class="av-btn av-btn--block av-btn--small" style="margin-block-start:8px">${icons.plus} Nova página</button>`;
}

function persist() {
  const { project } = store.getState();
  if (project) saveProject(project).catch((e) => log('warn', `Falha ao salvar: ${e.message}`));
}

function refreshAfterEdit() {
  const { selectedNodeId } = store.getState();
  preview.render(store.getState().project);
  renderLayersPanel();
  renderPropertiesPanel();
  overlay.clear();
  if (selectedNodeId) selectNode(selectedNodeId); // re-measure once the reloaded iframe reports its rect
  updateUndoRedoButtons({ canUndo: history.canUndo, canRedo: history.canRedo });
  persist();
  runValidation(false);
}

// ------------------------------------------------------------ Selection --

async function selectNode(nodeId) {
  store.setState({ selectedNodeId: nodeId });
  renderLayersPanel();
  renderPropertiesPanel();
  if (!nodeId) {
    overlay.clear();
    return;
  }
  const rect = await preview.measure(nodeId);
  const found = findNode(activePage()?.tree, nodeId);
  overlay.paint({ selectedRect: rect, selectedLabel: found?.node?.type });
}

// --------------------------------------------------------------- Events --

function updateUndoRedoButtons({ canUndo, canRedo }) {
  el.btnUndo.disabled = !canUndo;
  el.btnRedo.disabled = !canRedo;
}

function log(level, message) {
  const entry = document.createElement('div');
  entry.className = `av-console-entry av-console-entry--${level}`;
  entry.textContent = `[${level}] ${message}`;
  el.consoleLog.appendChild(entry);
  el.consoleLog.scrollTop = el.consoleLog.scrollHeight;
  if (level === 'error') el.consoleDrawer.dataset.open = 'true';
}

function setButtonBusy(btn, busy, busyLabel) {
  if (busy) {
    btn.dataset.idleHtml ??= btn.innerHTML;
    btn.innerHTML = `<span class="av-spinner"></span> ${escapeHtml(busyLabel)}`;
  } else if (btn.dataset.idleHtml) {
    btn.innerHTML = btn.dataset.idleHtml;
  }
  btn.disabled = busy;
}

function handlePreviewConsole(d) {
  if (d.type === 'error') log('error', d.message);
  else log(d.level === 'error' ? 'error' : d.level === 'warn' ? 'warn' : 'info', d.args?.join(' ') ?? '');
}

function wireEvents() {
  el.projectName.addEventListener('change', () => {
    store.getState().project.name = el.projectName.value.trim() || 'Meu Aplicativo';
    preview.render(store.getState().project);
    persist();
  });

  el.btnUndo.addEventListener('click', () => { history.undo(); refreshAfterEdit(); });
  el.btnRedo.addEventListener('click', () => { history.redo(); refreshAfterEdit(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? history.redo() : history.undo();
      refreshAfterEdit();
    }
  });

  document.querySelector('.av-devicebar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-device]');
    if (!btn) return;
    document.querySelectorAll('[data-device]').forEach((b) => b.classList.toggle('is-active', b === btn));
    el.canvasViewport.dataset.device = btn.dataset.device;
  });

  el.btnToggleCode.addEventListener('click', () => toggleCodeView());
  el.btnToggleLeft.addEventListener('click', () => el.panelLeft.classList.toggle('is-open'));
  el.btnToggleRight.addEventListener('click', () => el.panelRight.classList.toggle('is-open'));

  document.querySelectorAll('.av-panel--left .av-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.av-panel--left .av-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      ['layers', 'library', 'pages'].forEach((name) => {
        $(`panel${name[0].toUpperCase()}${name.slice(1)}`).hidden = tab.dataset.panel !== name;
      });
    })
  );

  document.querySelector('#codeView .av-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.av-tab');
    if (!tab) return;
    document.querySelectorAll('#codeView .av-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    store.setState({ codeTab: tab.dataset.code });
    fillCodeEditor();
  });

  el.btnApplyCode.addEventListener('click', applyCodeEdits);

  el.btnReload.addEventListener('click', () => preview.render(store.getState().project));
  el.btnValidate.addEventListener('click', () => runValidation(true));
  el.btnRepair.addEventListener('click', doRepair);

  el.btnExport.addEventListener('click', doExport);

  el.btnSettings.addEventListener('click', openSettings);
  el.btnCloseSettings.addEventListener('click', () => (el.settingsModal.hidden = true));
  el.btnCloseSettingsX.addEventListener('click', () => (el.settingsModal.hidden = true));
  el.btnSaveSettings.addEventListener('click', async () => {
    await saveSettings({ provider: el.providerSelect.value, model: '', apiKey: el.apiKeyInput.value.trim() });
    el.settingsModal.hidden = true;
  });
  el.settingsModal.addEventListener('click', (e) => { if (e.target === el.settingsModal) el.settingsModal.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.settingsModal.hidden) el.settingsModal.hidden = true;
  });

  el.btnGenerate.addEventListener('click', () => doGenerate(el.aiPrompt.value));
  el.aiPrompt.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doGenerate(el.aiPrompt.value);
  });

  el.btnClearConsole.addEventListener('click', () => (el.consoleLog.innerHTML = ''));
  el.btnToggleConsole.addEventListener('click', () => {
    el.consoleDrawer.dataset.open = el.consoleDrawer.dataset.open === 'true' ? 'false' : 'true';
  });

  el.panelLibrary.addEventListener('click', (e) => {
    const item = e.target.closest('[data-type]');
    if (item) insertComponent(item.dataset.type);
  });

  el.panelPages.addEventListener('click', (e) => {
    if (e.target.id === 'btnAddPage') return addPage();
    const delBtn = e.target.closest('[data-action="delete-page"]');
    const row = e.target.closest('[data-page-id]');
    if (delBtn && row) return removePage(row.dataset.pageId);
    if (row) {
      store.setState({ activePageId: row.dataset.pageId, selectedNodeId: null });
      preview.navigate(activePage().route);
      renderPagesPanel();
      renderLayersPanel();
      renderPropertiesPanel();
      overlay.clear();
    }
  });

  initLayersPanel(el.panelLayers, {
    onRepaint: renderLayersPanel,
    onSelect: selectNode,
    onDelete: (nodeId) => runEdit(cmd.cmdRemoveNode(activePage().tree, nodeId), true),
    onDuplicate: (nodeId) => runEdit(cmd.cmdDuplicateNode(activePage().tree, nodeId)),
    onDropInto: (dragId, targetId) => {
      const target = findNode(activePage().tree, targetId);
      if (!target) return;
      const parentId = CONTAINER_TYPES.has(target.node.type) ? target.node.id : target.parent?.id;
      const index = CONTAINER_TYPES.has(target.node.type) ? target.node.children.length : target.index;
      if (parentId) runEdit(cmd.cmdMoveNode(activePage().tree, dragId, parentId, index));
    },
  });

  initPropertiesPanel(el.propertiesPanel, {
    onChangeProps: (patch) => runEdit(cmd.cmdUpdateProps(activePage().tree, store.getState().selectedNodeId, patch)),
    onReplaceProps: (props) => runEdit(cmd.cmdUpdateProps(activePage().tree, store.getState().selectedNodeId, props)),
    onChangeStyle: (patch) => runEdit(cmd.cmdUpdateStyle(activePage().tree, store.getState().selectedNodeId, patch)),
    onChangeBind: (bindPatch) => {
      const { node } = findNode(activePage().tree, store.getState().selectedNodeId);
      node.bind = bindPatch.entity ? { ...node.bind, ...bindPatch } : undefined;
      refreshAfterEdit();
    },
    onError: (message) => log('error', message),
  });

  const palette = createCommandPalette(el.commandPalette, el.paletteInput, el.paletteResults, {
    getActions: () => [
      { label: 'Gerar aplicação a partir do texto atual', run: () => doGenerate(el.aiPrompt.value) },
      { label: 'Exportar projeto (.zip)', run: doExport },
      { label: 'Validar projeto', run: () => runValidation(true) },
      { label: 'Abrir configurações', run: openSettings },
      { label: 'Nova página', run: addPage },
      { label: 'Alternar visual / código', run: toggleCodeView },
    ],
    onRun: (text) => doGenerate(text),
  });

  el.previewFrame.addEventListener('mouseleave', () => store.setState({ hoveredNodeId: null }));
}

// ------------------------------------------------------------- Actions ---

function runEdit(command, clearSelection = false) {
  history.push(command);
  if (clearSelection) store.setState({ selectedNodeId: null });
  refreshAfterEdit();
}

function insertComponent(type) {
  const def = getComponent(type);
  const node = createNode(type, { ...def.defaultProps });
  const { selectedNodeId } = store.getState();
  const tree = activePage().tree;
  let parentId = tree.id;
  let index = tree.children.length;
  if (selectedNodeId) {
    const found = findNode(tree, selectedNodeId);
    if (found) {
      if (CONTAINER_TYPES.has(found.node.type)) { parentId = found.node.id; index = found.node.children.length; }
      else if (found.parent) { parentId = found.parent.id; index = found.index + 1; }
    }
  }
  runEdit(cmd.cmdAddNode(tree, parentId, index, node));
  selectNode(node.id);
}

function addPage() {
  const name = `Página ${store.getState().project.pages.length + 1}`;
  const route = `/pagina-${Date.now().toString(36)}`;
  const tree = createNode('Stack', { direction: 'column', gap: '4' }, [createNode('Header', { title: name })]);
  history.push(cmd.cmdAddPage(store.getState().project, createPage(name, route, tree)));
  renderPagesPanel();
  persist();
}

function removePage(pageId) {
  const { project } = store.getState();
  if (project.pages.length <= 1) return log('warn', 'O projeto precisa de pelo menos uma página.');
  history.push(cmd.cmdRemovePage(project, pageId));
  if (store.getState().activePageId === pageId) store.setState({ activePageId: project.pages[0]?.id, selectedNodeId: null });
  renderAll();
}

function toggleCodeView() {
  const showCode = el.codeView.hidden;
  el.codeView.hidden = !showCode;
  el.canvasViewport.hidden = showCode;
  document.querySelector('.av-stage__toolbar').hidden = showCode;
  store.setState({ viewMode: showCode ? 'code' : 'visual' });
  if (showCode) fillCodeEditor();
}

function fillCodeEditor() {
  const { project, codeTab } = store.getState();
  const site = generateSite(project);
  const content = { html: site.html, css: site.css, js: site.js }[codeTab || 'html'];
  el.codeEditor.value = content;
  el.codeEditor.readOnly = (codeTab || 'html') !== 'html';
  el.btnApplyCode.disabled = el.codeEditor.readOnly;
  el.codeSyncStatus.textContent = el.codeEditor.readOnly ? 'somente leitura (gerado)' : 'sincronizado';
}

function applyCodeEdits() {
  const { project } = store.getState();
  const { warnings } = reimportSiteHtml(el.codeEditor.value, project);
  warnings.forEach((w) => log('warn', w));
  history.clear(); // structural reimport isn't expressed as a command; keep history consistent rather than lying about undo
  renderAll();
  el.codeSyncStatus.textContent = 'sincronizado';
}

async function runValidation(announce) {
  const { project } = store.getState();
  lastIssues = validateProject(project);
  const errorCount = lastIssues.filter((i) => i.severity === 'error').length;
  const warnCount = lastIssues.filter((i) => i.severity === 'warning').length;
  el.issueBadge.textContent = `${lastIssues.length} problema${lastIssues.length === 1 ? '' : 's'}`;
  el.issueBadge.className = `av-badge ${errorCount ? 'av-badge--danger' : warnCount ? 'av-badge--warning' : 'av-badge--muted'}`;
  el.btnRepair.disabled = !lastIssues.some((i) => REPAIRABLE_CODES.has(i.code));
  if (announce) lastIssues.forEach((i) => log(i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warn' : 'info', i.message));
  return lastIssues;
}

function doRepair() {
  const { project } = store.getState();
  const results = repairAll(project, lastIssues);
  results.forEach((r) => log(r.fixed ? 'info' : 'warn', `${r.issue.message} → ${r.fixed ? 'corrigido' : r.reason}`));
  history.clear();
  renderAll();
  runValidation(false);
}

async function doExport() {
  const { project } = store.getState();
  setButtonBusy(el.btnExport, true, 'Exportando…');
  try {
    await downloadProjectZip(project);
    log('info', 'Projeto exportado com sucesso.');
  } catch (err) {
    log('error', `Falha ao exportar: ${err.message}`);
  } finally {
    setButtonBusy(el.btnExport, false);
  }
}

async function openSettings() {
  const settings = await getSettings();
  el.providerSelect.value = settings.provider;
  el.apiKeyInput.value = settings.apiKey;
  el.settingsModal.hidden = false;
}

async function doGenerate(promptText) {
  const text = (promptText || '').trim();
  if (!text) return;
  setButtonBusy(el.btnGenerate, true, 'Gerando…');
  el.aiPlan.hidden = true;
  try {
    const { project: currentProject, selectedNodeId } = store.getState();
    const result = await runCommand(text, { project: currentProject, selectedNodeId });
    if (result.kind === 'generate') {
      loadIntoStore(result.project);
      await createSnapshot(result.project, 'Gerado por IA').catch(() => {});
      renderAll();
      showPlan(result.plan, result.usedFallback);
    } else if (result.kind === 'improve') {
      runEdit(cmd.cmdUpdateProps(activePage().tree, result.nodeId, result.patch.props));
      log('info', result.note || 'Componente atualizado.');
    } else {
      log('warn', 'Comando não reconhecido — descreva um app inteiro (ex: "Crie um sistema de...") ou selecione um componente e peça para melhorá-lo.');
    }
  } catch (err) {
    log('error', `Falha ao gerar: ${err.message}`);
  } finally {
    setButtonBusy(el.btnGenerate, false);
  }
}

function showPlan(plan, usedFallback) {
  el.aiPlan.hidden = false;
  el.aiPlan.innerHTML = `
    ${usedFallback ? `<p class="av-hint">${escapeHtml(plan.__warning || 'Usando o planejador local.')}</p>` : ''}
    <h3>${escapeHtml(plan.name)}</h3>
    <p class="av-hint">Entidades</p>
    <ul>${plan.entities.map((e) => `<li>${escapeHtml(e.name)}</li>`).join('')}</ul>
    <p class="av-hint">Funcionalidades</p>
    <ul>${plan.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
  `;
}

boot();
