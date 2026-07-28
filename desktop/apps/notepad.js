// Bloco de Notas: edita arquivos de texto do sistema de arquivos virtual.
export function openNotepad(ctx, { fileId = null } = {}) {
  const { fs, seed, windows } = ctx;
  let currentFileId = fileId;
  let dirty = false;

  const root = document.createElement('div');
  root.className = 'notepad';
  root.innerHTML = `
    <div class="notepad-toolbar">
      <button data-action="new">📄 Novo</button>
      <button data-action="save">💾 Salvar</button>
      <button data-action="save-as">💾 Salvar como</button>
    </div>
    <textarea placeholder="Comece a escrever..." spellcheck="false"></textarea>
    <div class="notepad-status" data-role="status">Novo documento</div>
  `;

  const textarea = root.querySelector('textarea');
  const status = root.querySelector('[data-role="status"]');

  const win = windows.createWindow({
    appId: 'notepad',
    title: 'Bloco de Notas',
    icon: '📝',
    width: 560,
    height: 420,
    content: root,
  });

  textarea.addEventListener('input', () => {
    dirty = true;
    updateTitle();
  });

  function updateTitle() {
    const name = status.dataset.name || 'Novo documento';
    win.setTitle(`${dirty ? '● ' : ''}${name} - Bloco de Notas`);
  }

  async function loadFile(id) {
    const node = await fs.getNode(id);
    if (!node) return;
    currentFileId = id;
    textarea.value = node.content || '';
    status.textContent = `Salvo em Documentos › ${node.name}`;
    status.dataset.name = node.name;
    dirty = false;
    updateTitle();
  }

  async function saveCurrent() {
    if (currentFileId) {
      await fs.updateNode(currentFileId, { content: textarea.value });
      dirty = false;
      updateTitle();
      status.textContent = `Salvo • ${status.dataset.name || ''}`;
      ctx.refreshDesktop();
      return;
    }
    await saveAs();
  }

  async function saveAs() {
    const name = prompt('Nome do arquivo:', 'Novo Documento de Texto.txt');
    if (!name || !name.trim()) return;
    const fileName = name.trim();
    const existing = await fs.findChildByName(seed.documentsId, fileName);
    if (existing) {
      await fs.updateNode(existing.id, { content: textarea.value });
      currentFileId = existing.id;
    } else {
      const node = await fs.createNode({ parentId: seed.documentsId, name: fileName, type: 'file', content: textarea.value });
      currentFileId = node.id;
    }
    status.dataset.name = fileName;
    status.textContent = `Salvo em Documentos › ${fileName}`;
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }

  root.querySelector('[data-action="new"]').addEventListener('click', () => {
    if (dirty && !confirm('Descartar alterações não salvas?')) return;
    currentFileId = null;
    textarea.value = '';
    status.textContent = 'Novo documento';
    delete status.dataset.name;
    dirty = false;
    updateTitle();
  });
  root.querySelector('[data-action="save"]').addEventListener('click', saveCurrent);
  root.querySelector('[data-action="save-as"]').addEventListener('click', saveAs);

  if (currentFileId) loadFile(currentFileId);
  else updateTitle();

  return win;
}
