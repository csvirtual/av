import { kv } from './core/state/kv-store.js';
import { fs, ensureSeed } from './core/state/filesystem.js';
import { hasPassword, setPassword, verifyPassword, getHint, setHint } from './core/services/auth.js';
import * as WM from './core/window-manager/window-manager.js';
import { playStartupChime, playShutdownChime, playLockChime, volumeControl } from './core/services/sounds.js';
import * as motion from './core/motion/motion.js';
import { init as initTaskSwitcher } from './core/window-manager/task-switcher.js';
import { openExplorer } from './apps/explorer.js';
import { openNotepad } from './apps/notepad.js';
import { openSettings } from './apps/settings.js';
import { openBrowser } from './apps/browser.js';
import { openCalculator } from './apps/calculator.js';
import { openClock } from './apps/clock.js';
import { openTerminal } from './apps/terminal.js';
import { openTaskManager } from './apps/task-manager.js';

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// Painéis flutuantes (menus, popups) animam com o motion compartilhado.
function showPanel(el) {
  show(el);
  motion.panelOpen(el);
}
function hidePanel(el) {
  if (el.classList.contains('hidden')) return;
  motion.panelClose(el).then(() => hide(el));
}

let seed = null;
let bootTime = Date.now();

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
  getAccentColor,
  setAccentColor,
  getScale,
  setScale,
  getReduceMotion,
  setReduceMotion,
  getTimeFormat: () => timeFormat,
  setTimeFormat,
  getOrientation: () => kv.get('settings.orientation', 'landscape'),
  setOrientation: async (value) => {
    await kv.set('settings.orientation', value);
    if (value !== 'auto' && screen.orientation?.lock) {
      screen.orientation.lock(value).catch(() => {});
    } else if (screen.orientation?.unlock) {
      try { screen.orientation.unlock(); } catch {}
    }
  },
  getBootTime: () => bootTime,
  getAutoArrange,
  setAutoArrange,
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

async function getAccentColor() {
  return kv.get('settings.accentColor', '#0067c0');
}
async function setAccentColor(color) {
  await kv.set('settings.accentColor', color);
  document.documentElement.style.setProperty('--accent-2', color);
}

async function getScale() {
  return kv.get('settings.scale', 1);
}
async function setScale(scale) {
  await kv.set('settings.scale', scale);
  document.documentElement.style.zoom = scale;
}

async function getReduceMotion() {
  return kv.get('settings.reduceMotion', false);
}
async function setReduceMotion(value) {
  await kv.set('settings.reduceMotion', value);
  motion.setReducedMotionOverride(value);
}

let timeFormat = '24h';
async function setTimeFormat(value) {
  timeFormat = value;
  await kv.set('settings.timeFormat', value);
  updateClocks();
}

// ---------------- Boot sequence ----------------
async function boot() {
  seed = await ensureSeed();
  const theme = await getTheme();
  document.documentElement.setAttribute('data-theme', theme);
  applyWallpaper(await getWallpaper());
  document.documentElement.style.setProperty('--accent-2', await getAccentColor());
  document.documentElement.style.zoom = await getScale();
  motion.setReducedMotionOverride(await getReduceMotion());
  timeFormat = await kv.get('settings.timeFormat', '24h');

  setTimeout(async () => {
    hide($('#boot-screen'));
    playStartupChime();
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
  if (seed?.userFolderId) await fs.rename(seed.userFolderId, name);
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
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' });
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
  playLockChime();
  show($('#lock-screen'));
  $('#lock-pass').focus();
}

function sleepNow() {
  document.body.classList.add('sleeping');
  setTimeout(() => {
    lockNow();
    document.body.classList.remove('sleeping');
  }, 420);
}

function restartNow() {
  WM.closeAllWindows();
  hide($('#start-menu'));
  hide($('#power-menu'));
  hide($('#desktop'));
  playShutdownChime();
  show($('#restart-screen'));
  setTimeout(() => location.reload(), 1700);
}

function shutdownNow() {
  WM.closeAllWindows();
  hide($('#start-menu'));
  hide($('#power-menu'));
  hide($('#desktop'));
  playShutdownChime();
  show($('#shutdown-screen'));
  setTimeout(() => {
    hide($('#shutdown-spinner'));
    show($('#shutdown-message'));
    show($('#power-on-btn'));
    try { window.close(); } catch {}
  }, 1600);
}

$('#power-on-btn').addEventListener('click', () => location.reload());

// ---------------- Desktop ----------------
async function enterDesktop() {
  show($('#desktop'));
  $('#start-username').textContent = await kv.get('user.name', 'Usuário');
  await refreshAvatars();
  await refreshVolumeUI();
  await renderDesktopIcons();
  renderStartMenu();
}

function fixedIcons() {
  return [
    { id: 'this-pc', label: 'Este Computador', glyph: '🖥️', fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.rootId }) },
    { id: 'recycle-bin', label: 'Lixeira', glyph: '🗑️', fixed: true, onOpen: () => openExplorer(ctx, { startFolderId: seed.trashId, isTrash: true }) },
  ];
}

function gridPosition(idx) {
  const rowHeight = 100;
  const maxRows = Math.max(3, Math.floor((window.innerHeight - 100) / rowHeight));
  return { x: 16 + Math.floor(idx / maxRows) * 100, y: 16 + (idx % maxRows) * rowHeight };
}

async function getAutoArrange() {
  return kv.get('desktop.autoArrange', false);
}
async function setAutoArrange(value) {
  await kv.set('desktop.autoArrange', value);
  renderDesktopIcons();
}

// Estado do ícone sendo arrastado no momento. Os listeners de ponteiro do
// arraste são registrados uma única vez (fora de renderDesktopIcons) e
// reaproveitados a cada renderização — anexá-los de novo a cada chamada
// (como uma versão anterior fazia) vazava um listener em `window` por
// ícone, a cada atualização da área de trabalho, para sempre.
let draggedIcon = null; // { id, el }
let draggedMoved = false;
let dragOffX = 0, dragOffY = 0;

document.addEventListener('pointermove', (e) => {
  if (!draggedIcon) return;
  draggedMoved = true;
  draggedIcon.el.style.left = `${Math.max(0, e.clientX - dragOffX)}px`;
  draggedIcon.el.style.top = `${Math.max(0, e.clientY - dragOffY)}px`;
});
document.addEventListener('pointerup', async () => {
  if (draggedIcon && draggedMoved) {
    const all = await kv.get('desktop.positions', {});
    all[draggedIcon.id] = { x: draggedIcon.el.offsetLeft, y: draggedIcon.el.offsetTop };
    await kv.set('desktop.positions', all);
  }
  draggedIcon = null;
});

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
  const autoArrange = await getAutoArrange();
  const positions = autoArrange ? {} : await kv.get('desktop.positions', {});

  icons.forEach((icon, idx) => {
    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.innerHTML = `<div class="icon-glyph">${icon.glyph}</div><div class="icon-label">${escapeHtml(icon.label)}</div>`;
    const pos = positions[icon.id] || gridPosition(idx);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    el.addEventListener('dblclick', () => icon.onOpen());

    if (!autoArrange) {
      el.addEventListener('pointerdown', (e) => {
        draggedIcon = { id: icon.id, el };
        draggedMoved = false;
        dragOffX = e.clientX - el.offsetLeft;
        dragOffY = e.clientY - el.offsetTop;
        document.querySelectorAll('.desktop-icon.selected').forEach((n) => n.classList.remove('selected'));
        el.classList.add('selected');
      });
    }

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

$('#desktop-icons').addEventListener('contextmenu', async (e) => {
  if (e.target.closest('.desktop-icon')) return;
  e.preventDefault();
  const autoArrange = await getAutoArrange();
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
    { label: `${autoArrange ? '✓ ' : ''}Organizar ícones automaticamente`, onClick: () => setAutoArrange(!autoArrange) },
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
      hidePanel(menu);
      item.onClick();
    });
    menu.appendChild(btn);
  });
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 36 - 60)}px`;
  showPanel(menu);
}

function positionPanelNearButton(panel, btn) {
  panel.style.left = '-9999px';
  panel.style.top = '-9999px';
  panel.style.bottom = 'auto';
  panel.style.right = 'auto';
  panel.style.transform = 'none';
  show(panel);
  const btnRect = btn.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let left = btnRect.right - panelRect.width;
  left = Math.min(left, window.innerWidth - panelRect.width - 8);
  left = Math.max(8, left);
  const top = Math.max(8, btnRect.top - panelRect.height - 8);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  motion.panelOpen(panel);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) hidePanel($('#context-menu'));
  if (!e.target.closest('#start-menu') && !e.target.closest('#start-btn')) hidePanel($('#start-menu'));
  if (!e.target.closest('#power-menu') && !e.target.closest('#start-power')) hidePanel($('#power-menu'));
  if (!e.target.closest('#account-menu') && !e.target.closest('#start-user-btn')) hidePanel($('#account-menu'));
  if (!e.target.closest('#volume-menu') && !e.target.closest('#tray-volume-btn')) hidePanel($('#volume-menu'));
  if (!e.target.closest('#calendar-flyout') && !e.target.closest('#tray-clock')) hidePanel($('#calendar-flyout'));
});

// ---------------- Taskbar / Start menu ----------------
const PINNED_APPS = [
  { id: 'explorer', label: 'Explorador', glyph: '📁', onOpen: () => openExplorer(ctx) },
  { id: 'browser', label: 'Navegador', glyph: '🌐', onOpen: () => openBrowser(ctx) },
  { id: 'notepad', label: 'Bloco de Notas', glyph: '📝', onOpen: () => openNotepad(ctx) },
  { id: 'calculator', label: 'Calculadora', glyph: '🧮', onOpen: () => openCalculator(ctx) },
  { id: 'clock', label: 'Relógio e Calendário', glyph: '🕒', onOpen: () => openClock(ctx) },
  { id: 'terminal', label: 'Terminal', glyph: '💻', onOpen: () => openTerminal(ctx) },
  { id: 'taskmanager', label: 'Gerenciador de Tarefas', glyph: '📊', onOpen: () => openTaskManager(ctx) },
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
      hidePanel($('#start-menu'));
      app.onOpen();
    });
    grid.appendChild(btn);
  });
}

$('#start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#power-menu'));
  const menu = $('#start-menu');
  if (menu.classList.contains('hidden')) showPanel(menu);
  else hidePanel(menu);
});

$('#start-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.start-app').forEach((btn) => {
    btn.style.display = btn.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
  });
});

$('#start-user-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#power-menu'));
  const menu = $('#account-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, e.currentTarget);
  else hidePanel(menu);
});
$('#account-menu').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  hidePanel($('#start-menu'));
  if (action === 'lock' || action === 'signout') lockNow();
});

$('#start-power').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#account-menu'));
  const menu = $('#power-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, e.currentTarget);
  else hidePanel(menu);
});
$('#power-menu').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  hidePanel($('#start-menu'));
  if (action === 'sleep') sleepNow();
  if (action === 'restart') restartNow();
  if (action === 'shutdown') shutdownNow();
});

// ---------------- Volume ----------------
function volumeGlyph(vol, muted) {
  if (muted || vol === 0) return '🔇';
  if (vol < 34) return '🔈';
  if (vol < 67) return '🔉';
  return '🔊';
}
async function refreshVolumeUI() {
  const vol = await volumeControl.get();
  const muted = await volumeControl.getMuted();
  $('#volume-slider').value = vol;
  $('#volume-value').textContent = vol;
  const glyph = volumeGlyph(vol, muted);
  $('#tray-volume-btn').textContent = glyph;
  $('#volume-mute-btn').textContent = muted ? '🔇' : '🔊';
}
$('#tray-volume-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const btn = e.currentTarget;
  hidePanel($('#account-menu'));
  hidePanel($('#power-menu'));
  await refreshVolumeUI();
  const menu = $('#volume-menu');
  if (menu.classList.contains('hidden')) positionPanelNearButton(menu, btn);
  else hidePanel(menu);
});
$('#volume-slider').addEventListener('input', async (e) => {
  const v = Number(e.target.value);
  await volumeControl.set(v);
  if (v > 0) await volumeControl.setMuted(false);
  await refreshVolumeUI();
});
$('#volume-mute-btn').addEventListener('click', async () => {
  const muted = await volumeControl.getMuted();
  await volumeControl.setMuted(!muted);
  await refreshVolumeUI();
});

// ---------------- Calendário da bandeja ----------------
const CAL_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CAL_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
let calFlyoutMonth = new Date().getMonth();
let calFlyoutYear = new Date().getFullYear();

function renderCalendarFlyout() {
  const today = new Date();
  const panel = $('#calendar-flyout');
  panel.querySelector('[data-role="full-date"]').textContent = today.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  panel.querySelector('[data-role="month-label"]').textContent = `${CAL_MONTHS[calFlyoutMonth]} ${calFlyoutYear}`;

  const weekdaysEl = panel.querySelector('[data-role="weekdays"]');
  weekdaysEl.innerHTML = CAL_WEEKDAYS.map((w) => `<div class="calendar-weekday">${w}</div>`).join('');

  const daysEl = panel.querySelector('[data-role="days"]');
  daysEl.innerHTML = '';
  const firstDay = new Date(calFlyoutYear, calFlyoutMonth, 1);
  const daysInMonth = new Date(calFlyoutYear, calFlyoutMonth + 1, 0).getDate();
  for (let i = 0; i < firstDay.getDay(); i++) daysEl.appendChild(document.createElement('div'));
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(calFlyoutYear, calFlyoutMonth, day);
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (cellDate.toDateString() === today.toDateString() ? ' today' : '');
    cell.textContent = day;
    daysEl.appendChild(cell);
  }
}

$('#tray-clock').addEventListener('click', (e) => {
  e.stopPropagation();
  hidePanel($('#account-menu'));
  hidePanel($('#power-menu'));
  hidePanel($('#volume-menu'));
  const panel = $('#calendar-flyout');
  if (panel.classList.contains('hidden')) {
    calFlyoutMonth = new Date().getMonth();
    calFlyoutYear = new Date().getFullYear();
    renderCalendarFlyout();
    positionPanelNearButton(panel, $('#tray'));
  } else {
    hidePanel(panel);
  }
});
$('#calendar-flyout [data-action="prev-month"]').addEventListener('click', () => {
  calFlyoutMonth--;
  if (calFlyoutMonth < 0) { calFlyoutMonth = 11; calFlyoutYear--; }
  renderCalendarFlyout();
});
$('#calendar-flyout [data-action="next-month"]').addEventListener('click', () => {
  calFlyoutMonth++;
  if (calFlyoutMonth > 11) { calFlyoutMonth = 0; calFlyoutYear++; }
  renderCalendarFlyout();
});
$('#calendar-flyout [data-action="open-clock"]').addEventListener('click', () => {
  hidePanel($('#calendar-flyout'));
  openClock(ctx);
});

// Traz para frente (ou minimiza, se já estiver em foco) a janela mais
// recente de um app — usado tanto pelos ícones fixos da barra de tarefas
// quanto pelos temporários, para que um app aberto NUNCA ganhe um ícone
// duplicado ao lado do seu: o mesmo ícone é reutilizado, só muda de estado.
function focusOrToggleApp(appId) {
  const windows = WM.listProcesses().filter((w) => w.appId === appId);
  if (!windows.length) return false;
  const focused = windows.find((w) => w.focused);
  if (focused) {
    WM.toggleMinimize(focused.id);
  } else {
    // Nenhuma janela deste app está em foco (pode estar minimizada ou só
    // atrás de outra) — toggleMinimize já sabe restaurar com a animação
    // correta e focar em seguida, então reaproveita essa lógica em vez de
    // chamar focusById direto (que pularia a animação e deixaria a janela
    // com opacidade travada em 0 quando ela estava minimizada).
    const mostRecent = windows.reduce((a, b) => (b.openedAt > a.openedAt ? b : a));
    WM.toggleMinimize(mostRecent.id);
  }
  return true;
}

document.querySelectorAll('.taskbar-btn[data-app]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const appId = btn.dataset.app;
    if (focusOrToggleApp(appId)) return;
    const app = PINNED_APPS.find((a) => a.id === appId);
    if (app) app.onOpen();
  });
});

WM.onWindowsChange((list) => {
  const pinnedBtns = document.querySelectorAll('.taskbar-btn[data-app]');
  const byApp = new Map();
  list.forEach((w) => {
    if (!byApp.has(w.appId)) byApp.set(w.appId, []);
    byApp.get(w.appId).push(w);
  });

  // Ícones fixos: só refletem o estado (rodando/em foco) do próprio ícone,
  // nunca criam um segundo ícone ao lado.
  pinnedBtns.forEach((btn) => {
    const appWindows = byApp.get(btn.dataset.app) || [];
    btn.classList.toggle('running', appWindows.length > 0);
    btn.classList.toggle('active', appWindows.some((w) => w.focused));
    byApp.delete(btn.dataset.app);
  });

  // Apps sem ícone fixo (Calculadora, Relógio, Terminal, Gerenciador de
  // Tarefas...) ganham um ícone temporário só enquanto estiverem abertos —
  // um por app, mesmo que existam várias janelas dele.
  const holder = $('#taskbar-running');
  holder.innerHTML = '';
  byApp.forEach((appWindows, appId) => {
    const btn = document.createElement('button');
    btn.className = 'taskbar-btn running' + (appWindows.some((w) => w.focused) ? ' active' : '');
    btn.textContent = appWindows[0].icon;
    btn.title = appWindows.length > 1 ? `${appWindows[0].title} (+${appWindows.length - 1})` : appWindows[0].title;
    btn.addEventListener('click', () => focusOrToggleApp(appId));
    holder.appendChild(btn);
  });
});

function isStandaloneDisplay() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

async function applyDisplayPreferences() {
  if (!isStandaloneDisplay()) return;
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Alguns navegadores só permitem tela cheia após um gesto do usuário —
      // por isso tentamos de novo no primeiro toque, logo abaixo.
    }
  }
  const orientation = await kv.get('settings.orientation', 'landscape');
  if (orientation !== 'auto' && screen.orientation?.lock) {
    screen.orientation.lock(orientation).catch(() => {});
  }
}

applyDisplayPreferences();
window.addEventListener('pointerdown', () => applyDisplayPreferences(), { once: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

initTaskSwitcher();
boot();
