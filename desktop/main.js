import { kv, fs, ensureSeed } from './lib/idb.js';
import { hasPassword, setPassword, verifyPassword, getHint, setHint } from './lib/crypto.js';
import * as WM from './lib/windows.js';
import { openExplorer } from './apps/explorer.js';
import { openNotepad } from './apps/notepad.js';
import { openSettings } from './apps/settings.js';

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

let seed = null;

const ctx = {
  fs,
  kv,
  windows: WM,
  get seed() { return seed; },
  openFile,
  refreshDesktop: () => renderDesktopIcons(),
  getTheme,
  setTheme,
  getWallpaper,
  setWallpaper,
  verifyPassword,
  changePassword: async (oldP, newP) => {
    const ok = await verifyPassword(oldP);
    if (!ok) return false;
    await setPassword(newP);
    return true;
  },
  getAvatar: () => kv.get('user.avatar', null),
  setAvatar: async (dataUrl) => {
    await kv.set('user.avatar', dataUrl);
    await refreshAvatars();
  },
};

function avatarHTML(name, avatarDataUrl) {
  if (avatarDataUrl) return `<img class="avatar-img" src="${avatarDataUrl}" alt="">`;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar-initial">${initial}</div>`;
}

async function refreshAvatars() {
  const name = await kv.get('user.name', 'Usuário');
  const avatar = await kv.get('user.avatar', null);
  const html = avatarHTML(name, avatar);
  document.querySelectorAll('#lock-avatar, #start-avatar').forEach((el) => (el.innerHTML = html));
}

function openFile(node) {
  if (!node) return;
  if (node.type === 'folder') openExplorer(ctx, { startFolderId: node.id });
  else openNotepad(ctx, { fileId: node.id });
}

async function getTheme() {
  return kv.get('settings.theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
async function setTheme(theme) {
  await kv.set('settings.theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}
async function getWallpaper() {
  return kv.get('settings.wallpaper', 'linear-gradient(135deg, #0f3057 0%, #1a5088 45%, #2c7fb8 100%)');
}
async function setWallpaper(value) {
  await kv.set('settings.wallpaper', value);
  applyWallpaper(value);
}
function applyWallpaper(value) {
  const isUrl = value.startsWith('data:') || value.startsWith('http');
  $('#wallpaper').style.background = isUrl ? `center/cover no-repeat url(${value})` : value;
}

// ---------------- Boot sequence ----------------
async function boot() {
  seed = await ensureSeed();
  const theme = await getTheme();
  document.documentElement.setAttribute('data-theme', theme);
  applyWallpaper(await getWallpaper());

  setTimeout(async () => {
    hide($('#boot-screen'));
    if (await hasPassword()) {
      $('#lock-username').textContent = await kv.get('user.name', 'Usuário');
      await refreshAvatars();
      show($('#lock-screen'));
      $('#lock-pass').focus();
    } else {
      $('#setup-avatar').innerHTML = avatarHTML('', null);
      show($('#setup-screen'));
    }
  }, 900);
}

// ---------------- Setup ----------------
$('#setup-name').addEventListener('input', (e) => {
  $('#setup-avatar').innerHTML = avatarHTML(e.target.value, null);
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#setup-name').value.trim() || 'Usuário';
  const pass = $('#setup-pass').value;
  const pass2 = $('#setup-pass2').value;
  const hint = $('#setup-hint').value.trim();
  const err = $('#setup-error');
  if (pass !== pass2) {
    err.textContent = 'As senhas não coincidem.';
    show(err);
    return;
  }
  await setPassword(pass);
  await kv.set('user.name', name);
  if (hint) await setHint(hint);
  hide($('#setup-screen'));
  enterDesktop();
});

// ---------------- Lock screen ----------------
$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('#lock-pass').value;
  const ok = await verifyPassword(pass);
  const err = $('#lock-error');
  if (ok) {
    hide($('#lock-screen'));
    $('#lock-pass').value = '';
    hide(err);
    enterDesktop();
  } else {
    show(err);
  }
});
$('#lock-hint-btn').addEventListener('click', async () => {
  const hint = await getHint();
  alert(hint ? `Dica: ${hint}` : 'Nenhuma dica foi cadastrada. Limpe os dados do site no navegador para redefinir.');
});

function updateClocks() {
  const now = new Date();
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const lockTime = $('#lock-time');
  if (lockTime) lockTime.textContent = time;
  const lockDate = $('#lock-date');
  if (lockDate) lockDate.textContent = date;
  const tray = $('#tray-clock');
  if (tray) tray.textContent = `${time}\n${date.split(',')[0]}`;
}
setInterval(updateClocks, 1000);
updateClocks();

function lockNow() {
  WM.closeAllWindows();
  hide($('#desktop'));
  $('#lock-username').textContent = '';
  kv.get('user.name', 'Usuário').then((n) => ($('#lock-username').textContent = n));
  refreshAvatars();
  show($('#lock-screen'));
  $('#lock-pass').focus();
}

// ---------------- Desktop ----------------
async function enterDesktop() {
  show($('#desktop'));
  $('#start-username').textContent = await kv.get('user.name', 'Usuário');
  await refreshAvatars();
  await renderDesktopIcons();
  renderStartMenu();
}

function fixedIcons() {
  return [
    { id: 'this-pc', label: 'Este Computador', glyph: '🖥️', fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.rootId }) },
    { id: 'recycle-bin', label: 'Lixeira', glyph: '🗑️', fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.trashId, isTrash: true }) },
  ];
}

async function renderDesktopIcons() {
  const container = $('#desktop-icons');
  container.innerHTML = '';
  const children = await fs.getChildren(seed.desktopId);
  const icons = [
    ...fixedIcons(),
    ...children.map((node) => ({
      id: node.id,
      label: node.name,
      glyph: node.type === 'folder' ? '📁' : '📄',
      node,
      onOpen: () => openFile(node),
    })),
  ];
  const positions = await kv.get('desktop.positions', {});
  const rowHeight = 100;
  const maxRows = Math.max(3, Math.floor((window.innerHeight - 100) / rowHeight));

  icons.forEach((icon, idx) => {
    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.innerHTML = `<div class="icon-glyph">${icon.glyph}</div><div class="icon-label">${escapeHtml(icon.label)}</div>`;
    const pos = positions[icon.id] || {
      x: 16 + Math.floor(idx / maxRows) * 100,
      y: 16 + (idx % maxRows) * rowHeight,
    };
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    el.addEventListener('dblclick', () => icon.onOpen());

    let dragging = false, moved = false, offX = 0, offY = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false;
      offX = e.clientX - el.offsetLeft;
      offY = e.clientY - el.offsetTop;
      document.querySelectorAll('.desktop-icon.selected').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      moved = true;
      el.style.left = `${Math.max(0, e.clientX - offX)}px`;
      el.style.top = `${Math.max(0, e.clientY - offY)}px`;
    });
    window.addEventListener('pointerup', async () => {
      if (dragging && moved) {
        const all = await kv.get('desktop.positions', {});
        all[icon.id] = { x: el.offsetLeft, y: el.offsetTop };
        await kv.set('desktop.positions', all);
      }
      dragging = false;
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = [{ label: 'Abrir', onClick: () => icon.onOpen() }];
      if (!icon.fixed) {
        items.push(
          { label: 'Renomear', onClick: () => renameIcon(icon.node) },
          { label: 'Excluir', onClick: () => deleteIcon(icon.node) }
        );
      }
      showContextMenu(e.clientX, e.clientY, items);
    });

    container.appendChild(el);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renameIcon(node) {
  const name = prompt('Novo nome:', node.name);
  if (!name || !name.trim()) return;
  await fs.rename(node.id, name.trim());
  renderDesktopIcons();
}
async function deleteIcon(node) {
  if (!confirm(`Mover "${node.name}" para a Lixeira?`)) return;
  await fs.trash(node.id, seed.trashId);
  renderDesktopIcons();
}

$('#desktop-icons').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.desktop-icon')) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    {
      label: '📁 Nova pasta',
      onClick: async () => {
        await fs.createNode({ parentId: seed.desktopId, name: 'Nova pasta', type: 'folder' });
        renderDesktopIcons();
      },
    },
    {
      label: '📄 Novo documento de texto',
      onClick: async () => {
        await fs.createNode({ parentId: seed.desktopId, name: 'Novo Documento de Texto.txt', type: 'file', content: '' });
        renderDesktopIcons();
      },
    },
    { label: '↻ Atualizar', onClick: () => renderDesktopIcons() },
    { label: '🎨 Personalizar', onClick: () => openSettings(ctx, { tab: 'personalization' }) },
  ]);
});

// ---------------- Context menu ----------------
function showContextMenu(x, y, items) {
  const menu = $('#context-menu');
  menu.innerHTML = '';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      hide(menu);
      item.onClick();
    });
    menu.appendChild(btn);
  });
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 36 - 60)}px`;
  show(menu);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) hide($('#context-menu'));
  if (!e.target.closest('#start-menu') && !e.target.closest('#start-btn')) hide($('#start-menu'));
  if (!e.target.closest('#power-menu') && !e.target.closest('#start-power')) hide($('#power-menu'));
});

// ---------------- Taskbar / Start menu ----------------
const PINNED_APPS = [
  { id: 'explorer', label: 'Explorador', glyph: '📁', onOpen: () => openExplorer(ctx) },
  { id: 'notepad', label: 'Bloco de Notas', glyph: '📝', onOpen: () => openNotepad(ctx) },
  { id: 'settings', label: 'Configurações', glyph: '⚙️', onOpen: () => openSettings(ctx) },
  { id: 'recycle-bin', label: 'Lixeira', glyph: '🗑️', onOpen: () => openExplorer(ctx, { startFolderId: seed.trashId, isTrash: true }) },
];

function renderStartMenu() {
  const grid = $('#start-pinned');
  grid.innerHTML = '';
  PINNED_APPS.forEach((app) => {
    const btn = document.createElement('button');
    btn.className = 'start-app';
    btn.innerHTML = `<span class="glyph">${app.glyph}</span><span>${app.label}</span>`;
    btn.addEventListener('click', () => {
      hide($('#start-menu'));
      app.onOpen();
    });
    grid.appendChild(btn);
  });
}

$('#start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#start-menu').classList.toggle('hidden');
  hide($('#power-menu'));
});

$('#start-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.start-app').forEach((btn) => {
    btn.style.display = btn.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
  });
});

$('#start-power').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#power-menu').classList.toggle('hidden');
});
$('#power-menu').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (action === 'lock') { hide($('#start-menu')); lockNow(); }
  if (action === 'reload') location.reload();
});

document.querySelectorAll('.taskbar-btn[data-app]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const app = PINNED_APPS.find((a) => a.id === btn.dataset.app);
    if (app) app.onOpen();
  });
});

WM.onWindowsChange((list) => {
  const holder = $('#taskbar-running');
  holder.innerHTML = '';
  list.forEach((w) => {
    const btn = document.createElement('button');
    btn.className = 'taskbar-btn running' + (w.focused ? ' active' : '');
    btn.textContent = w.icon;
    btn.title = w.title;
    btn.addEventListener('click', () => WM.toggleMinimize(w.id));
    holder.appendChild(btn);
  });
});

if (window.matchMedia('(display-mode: standalone)').matches && screen.orientation?.lock) {
  screen.orientation.lock('landscape').catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

boot();
