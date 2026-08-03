// Fotos: visualizador de imagens do sistema de arquivos virtual, com
// navegação entre imagens da mesma pasta, definir como plano de fundo e
// baixar de volta para o computador real.
import { PHOTO_GLYPH } from '../core/icons.js';

export function openPhotos(ctx, { fileId } = {}) {
  const { fs, windows } = ctx;
  let currentId = fileId;
  let siblings = [];

  const root = document.createElement('div');
  root.className = 'photos-app';
  root.innerHTML = `
    <div class="photos-toolbar">
      <button data-action="prev" aria-label="Imagem anterior" title="Anterior">◀</button>
      <button data-action="next" aria-label="Próxima imagem" title="Próxima">▶</button>
      <span class="photos-name" data-role="name"></span>
      <div class="photos-toolbar-spacer"></div>
      <button data-action="wallpaper">${PHOTO_GLYPH} Definir como plano de fundo</button>
      <button data-action="download">⬇️ Baixar</button>
    </div>
    <div class="photos-viewport">
      <img data-role="img" alt="" class="hidden">
      <div class="photos-empty" data-role="empty">Nenhuma imagem aberta. Abra uma imagem pelo Explorador de Arquivos.</div>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'photos',
    title: 'Fotos',
    icon: PHOTO_GLYPH,
    width: 720,
    height: 520,
    content: root,
  });

  const img = root.querySelector('[data-role="img"]');
  const nameEl = root.querySelector('[data-role="name"]');
  const emptyEl = root.querySelector('[data-role="empty"]');

  async function loadSiblings(node) {
    const children = await fs.getChildren(node.parentId);
    siblings = children.filter((c) => c.type === 'file' && (c.mimeType || '').startsWith('image/'));
  }

  async function show(id) {
    const node = await fs.getNode(id);
    if (!node) return;
    currentId = id;
    img.src = node.content || '';
    img.alt = node.name;
    img.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    nameEl.textContent = node.name;
    win.setTitle(`${node.name} - Fotos`);
    await loadSiblings(node);
  }

  function step(delta) {
    if (siblings.length < 2) return;
    const idx = siblings.findIndex((s) => s.id === currentId);
    if (idx === -1) return;
    const nextNode = siblings[(idx + delta + siblings.length) % siblings.length];
    show(nextNode.id);
  }

  root.querySelector('[data-action="prev"]').addEventListener('click', () => step(-1));
  root.querySelector('[data-action="next"]').addEventListener('click', () => step(1));
  root.querySelector('[data-action="wallpaper"]').addEventListener('click', async () => {
    if (!currentId) return;
    const node = await fs.getNode(currentId);
    if (!node) return;
    await ctx.setWallpaper(node.content);
    ctx.notify?.({ appId: 'photos', icon: PHOTO_GLYPH, title: 'Plano de fundo atualizado', body: node.name });
  });
  root.querySelector('[data-action="download"]').addEventListener('click', async () => {
    if (!currentId) return;
    const node = await fs.getNode(currentId);
    if (!node) return;
    const a = document.createElement('a');
    a.href = node.content;
    a.download = node.name;
    a.click();
  });

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => window.removeEventListener('keydown', onKeydown));

  if (currentId) show(currentId);
  return win;
}
