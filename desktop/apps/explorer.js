// Explorador de Arquivos: navega pelo sistema de arquivos virtual (IndexedDB),
// cria/renomeia/exclui itens, importa arquivos do computador real, permite
// baixar arquivos virtuais de volta para o computador real, recortar/copiar/
// colar, selecionar múltiplos itens, ver propriedades e ordenar/alternar a
// visualização (grade/lista).
import { WORD_MIME } from './word.js';

// Ícone de disco (próprio, sem usar o arquivo/ícone proprietário da
// Microsoft) para diferenciar "Disco Local (C:)" de uma pasta comum.
const DRIVE_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <rect x="3" y="9" width="26" height="16" rx="2.5" fill="#d7dbe0" stroke="#9aa1a9" stroke-width="1"/>
  <rect x="3" y="9" width="26" height="6" rx="2.5" fill="#aeb4bb"/>
  <rect x="7" y="18" width="10" height="2" rx="1" fill="#6b7178"/>
  <circle cx="24" cy="19" r="2" fill="#3f9bff"/>
</svg>`;

// Área de transferência compartilhada entre todas as janelas do Explorador
// (módulo é um singleton) — copiar numa janela e colar em outra funciona,
// como no Windows de verdade.
let clipboard = null; // { mode: 'copy' | 'cut', ids: [...] }

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// Tamanho real (aproximado) do conteúdo: para imagens (data URL base64), usa
// o tamanho decodificado do binário, não o tamanho do texto da data URL
// (que é ~33% maior por causa da própria codificação base64).
function contentByteSize(node) {
  const content = node.content || '';
  if (content.startsWith('data:')) {
    const base64 = content.split(',')[1] || '';
    return Math.round((base64.length * 3) / 4);
  }
  return new Blob([content]).size;
}

function sortNodes(nodes, sortBy, dir) {
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'date') cmp = a.modifiedAt - b.modifiedAt;
    else if (sortBy === 'size') cmp = contentByteSize(a) - contentByteSize(b);
    else if (sortBy === 'type') cmp = (a.type === 'folder' ? '' : (a.mimeType || '')).localeCompare(b.type === 'folder' ? '' : (b.mimeType || ''));
    else cmp = a.name.localeCompare(b.name, 'pt-BR');
    return dir === 'desc' ? -cmp : cmp;
  });
  // Pastas sempre antes dos arquivos, como no Explorador do Windows — o sort
  // acima é estável, então a ordem já calculada dentro de cada grupo (pastas
  // entre si, arquivos entre si) é preservada por este segundo sort.
  return sorted.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1));
}

async function uniqueNameInFolder(fs, parentId, baseName, excludeId = null) {
  const existing = await fs.getChildren(parentId);
  const names = new Set(existing.filter((n) => n.id !== excludeId).map((n) => n.name.toLowerCase()));
  if (!names.has(baseName.toLowerCase())) return baseName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  const firstCandidate = `${stem} - Cópia${ext}`;
  if (!names.has(firstCandidate.toLowerCase())) return firstCandidate;
  let n = 2;
  while (names.has(`${stem} - Cópia (${n})${ext}`.toLowerCase())) n++;
  return `${stem} - Cópia (${n})${ext}`;
}

async function deepCopyNode(fs, node, targetParentId) {
  const newName = await uniqueNameInFolder(fs, targetParentId, node.name);
  if (node.type === 'folder') {
    const newNode = await fs.createNode({ parentId: targetParentId, name: newName, type: 'folder' });
    const children = await fs.getChildren(node.id);
    for (const child of children) await deepCopyNode(fs, child, newNode.id);
    return newNode;
  }
  return fs.createNode({ parentId: targetParentId, name: newName, type: 'file', content: node.content, mimeType: node.mimeType });
}

export function openExplorer(ctx, { startFolderId, isTrash = false } = {}) {
  const { fs, kv, seed, windows, openFile } = ctx;
  let currentFolderId = startFolderId || seed.desktopId;
  let trashMode = isTrash;
  let currentChildren = [];
  let selectedIds = new Set();
  let lastClickedId = null;
  let sortBy = 'name';
  let sortDir = 'asc';
  let viewMode = 'grid';

  const root = document.createElement('div');
  root.className = 'explorer';
  root.innerHTML = `
    <div class="explorer-sidebar">
      <div class="side-item" data-nav="this-pc">🖥️ Este Computador</div>
      <div class="side-item" data-nav="desktop">🖵 Área de Trabalho</div>
      <div class="side-item" data-nav="documents">📄 Documentos</div>
      <div class="side-item" data-nav="pictures">🖼️ Imagens</div>
      <div class="side-item" data-nav="downloads">⬇️ Downloads</div>
      <div class="side-item" data-nav="trash">🗑️ Lixeira</div>
    </div>
    <div class="explorer-main">
      <div class="explorer-toolbar">
        <button data-action="new">➕ Novo</button>
        <button data-action="upload">⬆️ Importar do PC</button>
        <button data-action="rename">✏️ Renomear</button>
        <button data-action="copy">🗐 Copiar</button>
        <button data-action="cut">✂️ Recortar</button>
        <button data-action="paste">📋 Colar</button>
        <button data-action="delete">🗑️ Excluir</button>
        <button data-action="properties">ℹ️ Propriedades</button>
        <button data-action="empty-trash" class="trash-only hidden">🧹 Esvaziar Lixeira</button>
        <span class="explorer-toolbar-spacer"></span>
        <label class="explorer-sort-label">
          Ordenar por
          <select data-role="sort-by" aria-label="Ordenar por">
            <option value="name">Nome</option>
            <option value="date">Data de modificação</option>
            <option value="size">Tamanho</option>
            <option value="type">Tipo</option>
          </select>
        </label>
        <button data-action="sort-dir" aria-label="Inverter ordem" title="Inverter ordem">⇅</button>
        <button data-action="view-toggle" aria-label="Alternar visualização" title="Alternar entre grade e lista">▦</button>
        <input type="file" data-role="file-input" class="hidden" multiple>
      </div>
      <div class="explorer-breadcrumb" data-role="breadcrumb"></div>
      <div class="explorer-grid" data-role="grid"></div>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'explorer',
    title: 'Explorador de Arquivos',
    icon: '📁',
    width: 760,
    height: 500,
    content: root,
  });

  const grid = root.querySelector('[data-role="grid"]');
  const breadcrumb = root.querySelector('[data-role="breadcrumb"]');
  const fileInput = root.querySelector('[data-role="file-input"]');
  const sortBySelect = root.querySelector('[data-role="sort-by"]');

  root.querySelectorAll('.side-item').forEach((item) => {
    item.addEventListener('click', () => {
      trashMode = item.dataset.nav === 'trash';
      const map = {
        'this-pc': seed.rootId,
        desktop: seed.desktopId,
        documents: seed.documentsId,
        pictures: seed.picturesId,
        downloads: seed.downloadsId,
        trash: seed.trashId,
      };
      navigate(map[item.dataset.nav]);
    });
  });

  async function navigate(folderId) {
    currentFolderId = folderId;
    clearSelection();
    await render();
  }

  function clearSelection() {
    selectedIds = new Set();
    lastClickedId = null;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    grid.querySelectorAll('.file-item, .file-row').forEach((el) => {
      el.classList.toggle('selected', selectedIds.has(el.dataset.id));
    });
    const count = selectedIds.size;
    root.querySelector('[data-action="rename"]').disabled = count !== 1;
    root.querySelector('[data-action="properties"]').disabled = count !== 1;
    root.querySelector('[data-action="delete"]').disabled = count === 0;
    root.querySelector('[data-action="copy"]').disabled = count === 0 || trashMode;
    root.querySelector('[data-action="cut"]').disabled = count === 0 || trashMode;
    root.querySelector('[data-action="paste"]').disabled = !clipboard || !clipboard.ids.length || trashMode;
  }

  function selectSingle(id) {
    selectedIds = new Set([id]);
    lastClickedId = id;
    updateSelectionUI();
  }

  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    lastClickedId = id;
    updateSelectionUI();
  }

  function selectRangeTo(id) {
    const ids = currentChildren.map((n) => n.id);
    const from = ids.indexOf(lastClickedId ?? id);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) {
      selectSingle(id);
      return;
    }
    const [start, end] = from < to ? [from, to] : [to, from];
    selectedIds = new Set(ids.slice(start, end + 1));
    updateSelectionUI();
  }

  function handleItemClick(e, node) {
    e.stopPropagation();
    if (e.shiftKey) selectRangeTo(node.id);
    else if (e.ctrlKey || e.metaKey) toggleSelect(node.id);
    else selectSingle(node.id);
  }

  async function loadPrefs() {
    sortBy = await kv.get('explorer.sortBy', 'name');
    sortDir = await kv.get('explorer.sortDir', 'asc');
    viewMode = await kv.get('explorer.viewMode', 'grid');
    sortBySelect.value = sortBy;
    updateViewToggleUI();
  }

  function updateViewToggleUI() {
    const btn = root.querySelector('[data-action="view-toggle"]');
    btn.textContent = viewMode === 'grid' ? '☰' : '▦';
    btn.title = viewMode === 'grid' ? 'Ver como lista' : 'Ver como grade';
    grid.classList.toggle('view-list', viewMode === 'list');
  }

  async function render() {
    root.querySelector('.trash-only').classList.toggle('hidden', !trashMode);
    root.querySelectorAll('.side-item').forEach((item) => {
      const map = { 'this-pc': seed.rootId, desktop: seed.desktopId, documents: seed.documentsId, pictures: seed.picturesId, downloads: seed.downloadsId, trash: seed.trashId };
      item.classList.toggle('active', map[item.dataset.nav] === currentFolderId);
    });

    const path = await fs.getPath(currentFolderId);
    breadcrumb.innerHTML = '';
    // Via textContent: n.name pode conter um nome de arquivo/pasta escolhido
    // pelo usuário, nunca deve ser interpretado como HTML.
    path.forEach((n, i) => {
      const span = document.createElement('span');
      span.dataset.id = n.id;
      span.textContent = n.name;
      span.addEventListener('click', () => navigate(span.dataset.id));
      breadcrumb.appendChild(span);
      if (i < path.length - 1) breadcrumb.appendChild(document.createTextNode(' › '));
    });

    let children;
    if (trashMode) {
      children = await getAllTrashed();
    } else {
      children = await fs.getChildren(currentFolderId);
    }
    children = sortNodes(children, sortBy, sortDir);
    currentChildren = children;

    grid.innerHTML = '';
    win.setTitle(path.length ? path[path.length - 1].name : 'Explorador de Arquivos');

    if (!children.length) {
      grid.classList.add('is-empty');
      grid.innerHTML = `<div class="explorer-empty">${trashMode ? 'A Lixeira está vazia.' : 'Esta pasta está vazia.'}</div>`;
      updateSelectionUI();
      return;
    }
    grid.classList.remove('is-empty');

    if (viewMode === 'list') {
      const header = document.createElement('div');
      header.className = 'file-list-header';
      header.innerHTML = '<span>Nome</span><span>Modificado em</span><span>Tipo</span><span>Tamanho</span>';
      grid.appendChild(header);
    }

    children.forEach((node) => {
      const item = document.createElement('div');
      item.className = viewMode === 'list' ? 'file-row' : 'file-item';
      item.dataset.id = node.id;
      const glyph = node.type === 'folder'
        ? (node.id === seed.cDriveId ? DRIVE_GLYPH : '📁')
        : ((node.mimeType || '').startsWith('image/') ? '🖼️' : (node.mimeType === WORD_MIME ? '📘' : '📄'));

      if (viewMode === 'list') {
        const typeLabel = node.type === 'folder' ? 'Pasta de arquivos' : (node.mimeType || 'Arquivo');
        const sizeLabel = node.type === 'folder' ? '' : formatBytes(contentByteSize(node));
        item.innerHTML = `
          <span class="name-cell"><span class="glyph">${glyph}</span><span class="name">${escapeHtml(node.name)}</span></span>
          <span class="col-dim">${new Date(node.modifiedAt).toLocaleString('pt-BR')}</span>
          <span class="col-dim">${escapeHtml(typeLabel)}</span>
          <span class="col-dim">${sizeLabel}</span>
        `;
      } else {
        item.innerHTML = `<div class="glyph">${glyph}</div><div class="name">${escapeHtml(node.name)}</div>`;
      }

      if (clipboard?.mode === 'cut' && clipboard.ids.includes(node.id)) item.classList.add('cut-pending');
      item.classList.toggle('selected', selectedIds.has(node.id));

      item.addEventListener('click', (e) => handleItemClick(e, node));
      item.addEventListener('dblclick', () => {
        if (trashMode) return;
        if (node.type === 'folder') navigate(node.id);
        else openFile(node);
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedIds.has(node.id)) selectSingle(node.id);
        showLocalMenu(e.clientX, e.clientY, node);
      });
      grid.appendChild(item);
    });

    updateSelectionUI();
  }

  async function getAllTrashed() {
    // Percorre todos os nós cujo parentId é a pasta Lixeira.
    return fs.getChildren(seed.trashId);
  }

  async function getSelectedNodes() {
    const nodes = [];
    for (const id of selectedIds) {
      const n = await fs.getNode(id);
      if (n) nodes.push(n);
    }
    return nodes;
  }

  function showLocalMenu(x, y, node) {
    const multi = selectedIds.size > 1;
    const items = [];
    if (trashMode) {
      items.push(
        { label: multi ? `↩️ Restaurar (${selectedIds.size})` : '↩️ Restaurar', onClick: () => restoreSelection() },
        { label: multi ? `🗑️ Excluir permanentemente (${selectedIds.size})` : '🗑️ Excluir permanentemente', onClick: () => confirmAnd(() => deleteSelectionPermanently(), `Excluir ${multi ? 'os itens selecionados' : `"${node.name}"`} permanentemente?`) }
      );
    } else {
      if (!multi) {
        items.push({ label: '📂 Abrir', onClick: () => (node.type === 'folder' ? navigate(node.id) : openFile(node)) });
      }
      items.push(
        { label: '🗐 Copiar', onClick: () => copySelection('copy') },
        { label: '✂️ Recortar', onClick: () => copySelection('cut') }
      );
      if (!multi) items.push({ label: '✏️ Renomear', onClick: () => doRename(node) });
      items.push({ label: multi ? `🗑️ Excluir (${selectedIds.size})` : '🗑️ Excluir', onClick: () => confirmAnd(() => deleteSelectionToTrash(), `Mover ${multi ? 'os itens selecionados' : `"${node.name}"`} para a Lixeira?`) });
      if (!multi && node.type === 'file') {
        items.push({ label: '⬇️ Baixar para o computador', onClick: () => downloadNode(node) });
      }
      if (!multi) items.push({ label: 'ℹ️ Propriedades', onClick: () => showProperties(node) });
    }
    simpleContextMenu(x, y, items);
  }

  // Menu de contexto local simples (independente do menu da área de trabalho)
  let localMenuEl = null;
  function simpleContextMenu(x, y, items) {
    localMenuEl?.remove();
    const menu = document.createElement('div');
    menu.className = 'panel small';
    menu.setAttribute('role', 'menu');
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = 9999;
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.setAttribute('role', 'menuitem');
      btn.textContent = it.label;
      btn.addEventListener('click', () => { it.onClick(); menu.remove(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    localMenuEl = menu;
    setTimeout(() => {
      document.addEventListener('click', function onDocClick() {
        menu.remove();
        document.removeEventListener('click', onDocClick);
      }, { once: true });
    });
  }

  function confirmAnd(fn, msg) {
    if (confirm(msg)) fn();
  }

  async function doRename(node) {
    const name = prompt('Novo nome:', node.name);
    if (!name || !name.trim()) return;
    await fs.rename(node.id, name.trim());
    render();
    ctx.refreshDesktop();
  }

  async function deleteSelectionToTrash() {
    const nodes = await getSelectedNodes();
    for (const n of nodes) await fs.trash(n.id, seed.trashId);
    clearSelection();
    render();
    ctx.refreshDesktop();
  }

  async function deleteSelectionPermanently() {
    const nodes = await getSelectedNodes();
    for (const n of nodes) await fs.deleteNodePermanently(n.id);
    clearSelection();
    render();
  }

  async function restoreSelection() {
    const nodes = await getSelectedNodes();
    for (const n of nodes) await fs.restore(n.id);
    clearSelection();
    render();
    ctx.refreshDesktop();
  }

  function copySelection(mode) {
    if (!selectedIds.size || trashMode) return;
    clipboard = { mode, ids: Array.from(selectedIds) };
    render();
  }

  async function pasteClipboard() {
    if (!clipboard || !clipboard.ids.length || trashMode) return;
    const nodes = [];
    for (const id of clipboard.ids) {
      const n = await fs.getNode(id);
      if (n) nodes.push(n);
    }
    if (clipboard.mode === 'copy') {
      for (const n of nodes) await deepCopyNode(fs, n, currentFolderId);
    } else {
      for (const n of nodes) {
        const newName = await uniqueNameInFolder(fs, currentFolderId, n.name, n.id);
        if (newName !== n.name) await fs.rename(n.id, newName);
        await fs.move(n.id, currentFolderId);
      }
      clipboard = null;
    }
    render();
    ctx.refreshDesktop();
  }

  function downloadNode(node) {
    // Imagens já são uma data URL — baixa direto, sem passar por Blob
    // (senão o arquivo baixado seria o texto da própria data URL, não a
    // imagem de verdade).
    if ((node.content || '').startsWith('data:')) {
      const a = document.createElement('a');
      a.href = node.content;
      a.download = node.name;
      a.click();
      return;
    }
    const blob = new Blob([node.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function showProperties(node) {
    const overlay = document.createElement('div');
    overlay.className = 'explorer-modal-overlay';
    const box = document.createElement('div');
    box.className = 'explorer-modal';
    const title = document.createElement('h3');
    title.textContent = 'Propriedades';
    box.appendChild(title);

    const path = await fs.getPath(node.id);
    const location = path.slice(0, -1).map((n) => n.name).join(' › ') || '—';
    let sizeLabel;
    if (node.type === 'folder') {
      const children = await fs.getChildren(node.id);
      sizeLabel = `${children.length} ${children.length === 1 ? 'item' : 'itens'}`;
    } else {
      sizeLabel = formatBytes(contentByteSize(node));
    }
    const rows = [
      ['Nome', node.name],
      ['Tipo', node.type === 'folder' ? 'Pasta de arquivos' : (node.mimeType || 'Arquivo')],
      ['Local', location],
      ['Tamanho', sizeLabel],
      ['Criado em', new Date(node.createdAt).toLocaleString('pt-BR')],
      ['Modificado em', new Date(node.modifiedAt).toLocaleString('pt-BR')],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'explorer-modal-row';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      const valueSpan = document.createElement('span');
      valueSpan.textContent = value;
      row.appendChild(labelSpan);
      row.appendChild(valueSpan);
      box.appendChild(row);
    });

    const actions = document.createElement('div');
    actions.className = 'explorer-modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Fechar';
    closeBtn.addEventListener('click', () => overlay.remove());
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    function onEscape(e) {
      if (e.key === 'Escape') { overlay.remove(); window.removeEventListener('keydown', onEscape); }
    }
    window.addEventListener('keydown', onEscape);
    root.appendChild(overlay);
  }

  root.querySelector('[data-action="new"]').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    simpleContextMenu(rect.left, rect.bottom, [
      { label: '📁 Pasta', onClick: () => newFolder() },
      { label: '📄 Documento de Texto', onClick: () => newTextFile() },
      { label: '📘 Documento (.docx)', onClick: () => newWordFile() },
    ]);
  });
  async function newFolder() {
    await fs.createNode({ parentId: currentFolderId, name: await uniqueNameInFolder(fs, currentFolderId, 'Nova pasta'), type: 'folder' });
    render();
    ctx.refreshDesktop();
  }
  async function newTextFile() {
    const name = await uniqueNameInFolder(fs, currentFolderId, 'Novo Documento de Texto.txt');
    await fs.createNode({ parentId: currentFolderId, name, type: 'file', content: '' });
    render();
    ctx.refreshDesktop();
  }
  async function newWordFile() {
    const name = await uniqueNameInFolder(fs, currentFolderId, 'Novo Documento.docx');
    const node = await fs.createNode({ parentId: currentFolderId, name, type: 'file', content: '', mimeType: WORD_MIME });
    render();
    ctx.refreshDesktop();
    openFile(node);
  }
  root.querySelector('[data-action="upload"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const imported = [];
    for (const file of fileInput.files) {
      // Imagens precisam entrar como data URL (base64) — lê-las como texto
      // (como os outros arquivos) corromperia o binário.
      const isImage = (file.type || '').startsWith('image/');
      const content = isImage ? await readAsDataURL(file) : await file.text().catch(() => '');
      await fs.createNode({ parentId: currentFolderId, name: file.name, type: 'file', content, mimeType: file.type || 'text/plain' });
      imported.push(file.name);
    }
    fileInput.value = '';
    render();
    ctx.refreshDesktop();
    if (imported.length) {
      ctx.notify?.({
        appId: 'explorer',
        icon: '📁',
        title: imported.length > 1 ? `${imported.length} arquivos importados` : 'Arquivo importado',
        body: imported.length > 1 ? imported.join(', ') : imported[0],
      });
    }
  });
  root.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    if (selectedIds.size !== 1) return;
    const node = await fs.getNode(Array.from(selectedIds)[0]);
    if (node) doRename(node);
  });
  root.querySelector('[data-action="copy"]').addEventListener('click', () => copySelection('copy'));
  root.querySelector('[data-action="cut"]').addEventListener('click', () => copySelection('cut'));
  root.querySelector('[data-action="paste"]').addEventListener('click', () => pasteClipboard());
  root.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!selectedIds.size) return;
    const multi = selectedIds.size > 1;
    if (trashMode) {
      confirmAnd(() => deleteSelectionPermanently(), `Excluir ${multi ? 'os itens selecionados' : 'o item selecionado'} permanentemente?`);
    } else {
      confirmAnd(() => deleteSelectionToTrash(), `Mover ${multi ? 'os itens selecionados' : 'o item selecionado'} para a Lixeira?`);
    }
  });
  root.querySelector('[data-action="properties"]').addEventListener('click', async () => {
    if (selectedIds.size !== 1) return;
    const node = await fs.getNode(Array.from(selectedIds)[0]);
    if (node) showProperties(node);
  });
  root.querySelector('[data-action="empty-trash"]').addEventListener('click', async () => {
    if (!confirm('Excluir permanentemente todos os itens da Lixeira?')) return;
    const items = await fs.getChildren(seed.trashId);
    for (const item of items) await fs.deleteNodePermanently(item.id);
    render();
    if (items.length) {
      ctx.notify?.({
        appId: 'explorer',
        icon: '🗑️',
        title: 'Lixeira esvaziada',
        body: `${items.length} ${items.length > 1 ? 'itens excluídos' : 'item excluído'} permanentemente.`,
      });
    }
  });
  sortBySelect.addEventListener('change', async () => {
    sortBy = sortBySelect.value;
    await kv.set('explorer.sortBy', sortBy);
    render();
  });
  root.querySelector('[data-action="sort-dir"]').addEventListener('click', async () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    await kv.set('explorer.sortDir', sortDir);
    render();
  });
  root.querySelector('[data-action="view-toggle"]').addEventListener('click', async () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    await kv.set('explorer.viewMode', viewMode);
    updateViewToggleUI();
    render();
  });

  grid.addEventListener('click', () => clearSelection());

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') { copySelection('copy'); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'x') { copySelection('cut'); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'v') { pasteClipboard(); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'a') { selectedIds = new Set(currentChildren.map((n) => n.id)); updateSelectionUI(); e.preventDefault(); }
    else if (e.key === 'Delete' && selectedIds.size) {
      const multi = selectedIds.size > 1;
      if (trashMode) confirmAnd(() => deleteSelectionPermanently(), `Excluir ${multi ? 'os itens selecionados' : 'o item selecionado'} permanentemente?`);
      else confirmAnd(() => deleteSelectionToTrash(), `Mover ${multi ? 'os itens selecionados' : 'o item selecionado'} para a Lixeira?`);
      e.preventDefault();
    } else if (e.key === 'F2' && selectedIds.size === 1) {
      fs.getNode(Array.from(selectedIds)[0]).then((node) => { if (node) doRename(node); });
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => window.removeEventListener('keydown', onKeydown));

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  loadPrefs().then(() => navigate(currentFolderId));
  return win;
}
