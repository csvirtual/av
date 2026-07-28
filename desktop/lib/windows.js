// Gerenciador de janelas: cria a "moldura" estilo Windows 11 (barra de
// título, botões, arrastar, redimensionar, maximizar/minimizar) e mantém a
// lista de janelas abertas para a taskbar.
let zCounter = 10;
const openWindows = new Map(); // id -> { el, titleBarBtn, appId, state }
const listeners = new Set();

function notify() {
  const list = Array.from(openWindows.values()).map((w) => ({
    id: w.id,
    title: w.title,
    icon: w.icon,
    minimized: w.minimized,
    focused: w.focused,
  }));
  listeners.forEach((fn) => fn(list));
}

export function onWindowsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function focusWindow(id) {
  const win = openWindows.get(id);
  if (!win) return;
  openWindows.forEach((w) => {
    w.focused = w.id === id;
    w.el.classList.toggle('focused', w.focused);
  });
  win.el.style.zIndex = ++zCounter;
  win.minimized = false;
  win.el.classList.remove('minimized');
  notify();
}

export function focusById(id) {
  focusWindow(id);
}

export function toggleMinimize(id) {
  const win = openWindows.get(id);
  if (!win) return;
  if (win.minimized || !win.focused) {
    focusWindow(id);
  } else {
    win.minimized = true;
    win.focused = false;
    win.el.classList.add('minimized');
    win.el.classList.remove('focused');
    notify();
  }
}

export function closeWindow(id) {
  const win = openWindows.get(id);
  if (!win) return;
  win.el.remove();
  openWindows.delete(id);
  notify();
}

let cascadeOffset = 0;

export function createWindow({ appId, title, icon = '🗔', width = 640, height = 460, content }) {
  const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const el = document.createElement('div');
  el.className = 'app-window';
  const startX = 120 + (cascadeOffset % 6) * 28;
  const startY = 80 + (cascadeOffset % 6) * 28;
  cascadeOffset++;
  Object.assign(el.style, {
    width: `${width}px`,
    height: `${height}px`,
    left: `${startX}px`,
    top: `${startY}px`,
  });

  el.innerHTML = `
    <div class="win-titlebar" data-role="titlebar">
      <span class="win-icon">${icon}</span>
      <span class="win-title">${title}</span>
      <div class="win-controls">
        <button class="win-btn" data-action="min" title="Minimizar">&#x2013;</button>
        <button class="win-btn" data-action="max" title="Maximizar">&#x2610;</button>
        <button class="win-btn win-close" data-action="close" title="Fechar">&#x2715;</button>
      </div>
    </div>
    <div class="win-body"></div>
    <div class="win-resize" data-role="resize"></div>
  `;

  const body = el.querySelector('.win-body');
  body.appendChild(content);
  document.getElementById('windows-layer').appendChild(el);

  const win = { id, el, title, icon, minimized: false, focused: true };
  openWindows.set(id, win);
  focusWindow(id);

  el.addEventListener('pointerdown', () => focusWindow(id));

  const titlebar = el.querySelector('[data-role="titlebar"]');
  let dragging = false, offX = 0, offY = 0;
  titlebar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.win-btn')) return;
    dragging = true;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    el.classList.add('dragging');
  });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-btn')) return;
    el.classList.toggle('maximized');
  });

  let resizing = false, resizeStartW = 0, resizeStartH = 0, resizeStartX = 0, resizeStartY = 0;
  el.querySelector('[data-role="resize"]').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    resizing = true;
    resizeStartW = el.offsetWidth;
    resizeStartH = el.offsetHeight;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    focusWindow(id);
  });

  window.addEventListener('pointermove', (e) => {
    if (dragging && !el.classList.contains('maximized')) {
      el.style.left = `${Math.max(0, e.clientX - offX)}px`;
      el.style.top = `${Math.max(0, e.clientY - offY)}px`;
    }
    if (resizing) {
      el.style.width = `${Math.max(320, resizeStartW + (e.clientX - resizeStartX))}px`;
      el.style.height = `${Math.max(200, resizeStartH + (e.clientY - resizeStartY))}px`;
    }
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
    resizing = false;
    el.classList.remove('dragging');
  });

  el.querySelector('[data-action="min"]').addEventListener('click', () => toggleMinimize(id));
  el.querySelector('[data-action="max"]').addEventListener('click', () => el.classList.toggle('maximized'));
  el.querySelector('[data-action="close"]').addEventListener('click', () => closeWindow(id));

  notify();
  return {
    id,
    el,
    body,
    close: () => closeWindow(id),
    focus: () => focusWindow(id),
    setTitle: (t) => {
      win.title = t;
      el.querySelector('.win-title').textContent = t;
      notify();
    },
  };
}

export function closeAllWindows() {
  Array.from(openWindows.keys()).forEach(closeWindow);
}
