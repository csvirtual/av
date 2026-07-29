// Explorador de Arquivos: navega pelo sistema de arquivos virtual (IndexedDB),
// cria/renomeia/exclui itens, importa arquivos do computador real e permite
// baixar arquivos virtuais de volta para o computador real.

// Ícone de disco (próprio, sem usar o arquivo/ícone proprietário da
// Microsoft) para diferenciar "Disco Local (C:)" de uma pasta comum.
const DRIVE_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <rect x="3" y="9" width="26" height="16" rx="2.5" fill="#d7dbe0" stroke="#9aa1a9" stroke-width="1"/>
  <rect x="3" y="9" width="26" height="6" rx="2.5" fill="#aeb4bb"/>
  <rect x="7" y="18" width="10" height="2" rx="1" fill="#6b7178"/>
  <circle cx="24" cy="19" r="2" fill="#3f9bff"/>
</svg>`;

export function openExplorer(ctx, { startFolderId, isTrash = false } = {}) {
  const { fs, seed, windows, openFile } = ctx;
  let currentFolderId = startFolderId || seed.desktopId;
  let trashMode = isTrash;

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
        <button data-action="new-folder">📁 Nova pasta</button>
        <button data-action="new-file">📄 Novo arquivo</button>
        <button data-action="upload">⬆️ Importar do PC</button>
        <button data-action="rename">✏️ Renomear</button>
        <button data-action="delete">🗑️ Excluir</button>
        <button data-action="empty-trash" class="trash-only hidden">🧹 Esvaziar Lixeira</button>
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
    width: 720,
    height: 480,
    content: root,
  });

  const grid = root.querySelector('[data-role="grid"]');
  const breadcrumb = root.querySelector('[data-role="breadcrumb"]');
  const fileInput = root.querySelector('[data-role="file-input"]');
  let selectedId = null;

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
    selectedId = null;
    await render();
  }

  async function render() {
    root.querySelector('.trash-only').classList.toggle('hidden', !trashMode);
    root.querySelectorAll('.side-item').forEach((item) => {
      const map = { 'this-pc': seed.rootId, desktop: seed.desktopId, documents: seed.documentsId, pictures: seed.picturesId, downloads: seed.downloadsId, trash: seed.trashId };
      item.classList.toggle('active', map[item.dataset.nav] === currentFolderId);
    });

    const path = await fs.getPath(currentFolderId);
    breadcrumb.innerHTML = path
      .map((n, i) => `<span data-id="${n.id}">${n.name}</span>${i < path.length - 1 ? ' › ' : ''}`)
      .join('');
    breadcrumb.querySelectorAll('span').forEach((span) => {
      span.addEventListener('click', () => navigate(span.dataset.id));
    });

    let children;
    if (trashMode) {
      const all = await getAllTrashed();
      children = all;
    } else {
      children = await fs.getChildren(currentFolderId);
    }

    grid.innerHTML = '';
    win.setTitle(path.length ? path[path.length - 1].name : 'Explorador de Arquivos');

    if (!children.length) {
      grid.classList.add('is-empty');
      grid.innerHTML = `<div class="explorer-empty">${trashMode ? 'A Lixeira está vazia.' : 'Esta pasta está vazia.'}</div>`;
      return;
    }
    grid.classList.remove('is-empty');

    children.forEach((node) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.id = node.id;
      const glyph = node.type !== 'folder' ? '📄' : (node.id === seed.cDriveId ? DRIVE_GLYPH : '📁');
      item.innerHTML = `<div class="glyph">${glyph}</div><div class="name">${escapeHtml(node.name)}</div>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        grid.querySelectorAll('.file-item.selected').forEach((n) => n.classList.remove('selected'));
        item.classList.add('selected');
        selectedId = node.id;
      });
      item.addEventListener('dblclick', () => {
        if (trashMode) return;
        if (node.type === 'folder') navigate(node.id);
        else openFile(node);
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedId = node.id;
        grid.querySelectorAll('.file-item.selected').forEach((n) => n.classList.remove('selected'));
        item.classList.add('selected');
        showLocalMenu(e.clientX, e.clientY, node);
      });
      grid.appendChild(item);
    });
  }

  async function getAllTrashed() {
    // Percorre todos os nós cujo parentId é a pasta Lixeira.
    return fs.getChildren(seed.trashId);
  }

  function showLocalMenu(x, y, node) {
    const items = [];
    if (trashMode) {
      items.push(
        { label: '↩️ Restaurar', onClick: () => fs.restore(node.id).then(render) },
        { label: '🗑️ Excluir permanentemente', onClick: () => confirmAnd(() => fs.deleteNodePermanently(node.id).then(render), `Excluir "${node.name}" permanentemente?`) }
      );
    } else {
      items.push(
        { label: '📂 Abrir', onClick: () => (node.type === 'folder' ? navigate(node.id) : openFile(node)) },
        { label: '✏️ Renomear', onClick: () => doRename(node) },
        { label: '🗑️ Excluir', onClick: () => confirmAnd(() => fs.trash(node.id, seed.trashId).then(() => { render(); ctx.refreshDesktop(); }), `Mover "${node.name}" para a Lixeira?`) }
      );
      if (node.type === 'file') {
        items.push({ label: '⬇️ Baixar para o computador', onClick: () => downloadNode(node) });
      }
    }
    simpleContextMenu(x, y, items);
  }

  // Menu de contexto local simples (independente do menu da área de trabalho)
  let localMenuEl = null;
  function simpleContextMenu(x, y, items) {
    localMenuEl?.remove();
    const menu = document.createElement('div');
    menu.className = 'panel small';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = 9999;
    items.forEach((it) => {
      const btn = document.createElement('button');
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

  function downloadNode(node) {
    const blob = new Blob([node.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = node.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  root.querySelector('[data-action="new-folder"]').addEventListener('click', async () => {
    await fs.createNode({ parentId: currentFolderId, name: 'Nova pasta', type: 'folder' });
    render();
    ctx.refreshDesktop();
  });
  root.querySelector('[data-action="new-file"]').addEventListener('click', async () => {
    await fs.createNode({ parentId: currentFolderId, name: 'Novo Documento de Texto.txt', type: 'file', content: '' });
    render();
    ctx.refreshDesktop();
  });
  root.querySelector('[data-action="upload"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const imported = [];
    for (const file of fileInput.files) {
      const text = await file.text().catch(() => '');
      await fs.createNode({ parentId: currentFolderId, name: file.name, type: 'file', content: text, mimeType: file.type || 'text/plain' });
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
    if (!selectedId) return;
    const node = await fs.getNode(selectedId);
    if (node) doRename(node);
  });
  root.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!selectedId) return;
    const node = await fs.getNode(selectedId);
    if (!node) return;
    if (trashMode) {
      confirmAnd(() => fs.deleteNodePermanently(node.id).then(render), `Excluir "${node.name}" permanentemente?`);
    } else {
      confirmAnd(() => fs.trash(node.id, seed.trashId).then(() => { render(); ctx.refreshDesktop(); }), `Mover "${node.name}" para a Lixeira?`);
    }
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

  grid.addEventListener('click', () => {
    selectedId = null;
    grid.querySelectorAll('.file-item.selected').forEach((n) => n.classList.remove('selected'));
  });

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  navigate(currentFolderId);
  return win;
}
