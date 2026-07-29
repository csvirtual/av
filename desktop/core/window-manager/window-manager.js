// Gerenciador de janelas: cria a "moldura" estilo Windows 11 (barra de
// título, botões, arrastar, redimensionar, maximizar/minimizar, encaixe) e
// mantém a lista de janelas abertas para a taskbar e o alternador (Alt+Tab).
import { windowOpen, windowClose, windowMinimize, windowRestore, animateLayoutChange, panelOpen } from '../motion/motion.js';
import { detectZone, computeZoneRect, opposingZone, taskbarHeight } from './snap-zones.js';

let zCounter = 10;
const openWindows = new Map(); // id -> { el, title, icon, minimized, focused, snapped }
const listeners = new Set();

// Abaixo dessa largura não há espaço de sobra para o modelo de janelas
// flutuantes/redimensionáveis do desktop — celulares e telas bem estreitas
// passam a abrir tudo maximizado, como um app comum de tela cheia.
const COMPACT_BREAKPOINT = 700;
function isCompactViewport() {
  return window.innerWidth < COMPACT_BREAKPOINT;
}

function notify() {
  const list = Array.from(openWindows.values()).map((w) => ({
    id: w.id,
    title: w.title,
    icon: w.icon,
    appId: w.appId,
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

/** Lista as janelas não minimizadas por ordem de foco mais recente (para o Alt+Tab). */
export function getWindowsOrder() {
  return Array.from(openWindows.values())
    .filter((w) => !w.minimized)
    .sort((a, b) => parseInt(b.el.style.zIndex || '0', 10) - parseInt(a.el.style.zIndex || '0', 10))
    .map((w) => ({ id: w.id, title: w.title, icon: w.icon }));
}

/** Lista completa de janelas abertas, para o Gerenciador de Tarefas. */
export function listProcesses() {
  return Array.from(openWindows.values()).map((w) => ({
    id: w.id,
    title: w.title,
    icon: w.icon,
    appId: w.appId,
    minimized: w.minimized,
    focused: w.focused,
    openedAt: w.openedAt,
  }));
}

export function toggleMinimize(id) {
  const win = openWindows.get(id);
  if (!win) return;
  if (win.minimized || !win.focused) {
    win.el.classList.remove('minimized');
    windowRestore(win.el);
    focusWindow(id);
  } else {
    win.focused = false;
    win.el.classList.remove('focused');
    windowMinimize(win.el).then(() => win.el.classList.add('minimized'));
    notify();
  }
}

export async function closeWindow(id) {
  const win = openWindows.get(id);
  if (!win) return;
  openWindows.delete(id);
  notify();
  win.onClose?.();
  win.cleanupDrag?.();
  await windowClose(win.el);
  win.el.remove();
}

function toggleMaximize(win) {
  animateLayoutChange(win.el, () => win.el.classList.toggle('maximized'));
  win.snapped = win.el.classList.contains('maximized') ? 'maximize' : null;
}

// ---------------- Encaixe (Snap) ----------------
let snapPreviewEl = null;
function getSnapPreview() {
  if (!snapPreviewEl) {
    snapPreviewEl = document.createElement('div');
    snapPreviewEl.className = 'snap-preview hidden';
    document.getElementById('windows-layer').appendChild(snapPreviewEl);
  }
  return snapPreviewEl;
}
function showSnapPreview(zone) {
  const rect = computeZoneRect(zone);
  const el = getSnapPreview();
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  el.classList.remove('hidden');
}
function hideSnapPreview() {
  if (snapPreviewEl) snapPreviewEl.classList.add('hidden');
}

let snapAssistEl = null;
let snapAssistTimer = null;
function getSnapAssist() {
  if (!snapAssistEl) {
    snapAssistEl = document.createElement('div');
    snapAssistEl.className = 'snap-assist hidden';
    document.getElementById('windows-layer').appendChild(snapAssistEl);
  }
  return snapAssistEl;
}
function hideSnapAssist() {
  clearTimeout(snapAssistTimer);
  if (snapAssistEl) snapAssistEl.classList.add('hidden');
}
function showSnapAssist(zone, excludeId) {
  const candidates = Array.from(openWindows.values()).filter((w) => w.id !== excludeId && !w.minimized);
  if (!candidates.length) return;
  const rect = computeZoneRect(zone);
  const el = getSnapAssist();
  el.innerHTML = '';
  candidates.forEach((w) => {
    const btn = document.createElement('button');
    btn.className = 'snap-assist-item';
    // Via textContent: w.title pode conter um nome de arquivo/pasta
    // escolhido pelo usuário.
    const iconEl = document.createElement('span');
    iconEl.className = 'snap-assist-icon';
    iconEl.textContent = w.icon;
    const titleEl = document.createElement('span');
    titleEl.className = 'snap-assist-title';
    titleEl.textContent = w.title;
    btn.appendChild(iconEl);
    btn.appendChild(titleEl);
    btn.addEventListener('click', () => {
      applySnap(w.id, zone);
      hideSnapAssist();
    });
    el.appendChild(btn);
  });
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  el.classList.remove('hidden');
  panelOpen(el);
  clearTimeout(snapAssistTimer);
  snapAssistTimer = setTimeout(hideSnapAssist, 6000);
}
document.addEventListener('pointerdown', (e) => {
  if (snapAssistEl && !snapAssistEl.classList.contains('hidden') && !e.target.closest('.snap-assist')) hideSnapAssist();
});

function applySnap(id, zone) {
  const win = openWindows.get(id);
  if (!win) return;
  if (zone === 'maximize') {
    animateLayoutChange(win.el, () => win.el.classList.add('maximized'));
    win.snapped = 'maximize';
  } else {
    const rect = computeZoneRect(zone);
    animateLayoutChange(win.el, () => {
      win.el.classList.remove('maximized');
      Object.assign(win.el.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      });
    });
    win.snapped = zone;
    const opposite = opposingZone(zone);
    if (opposite) showSnapAssist(opposite, id);
  }
  focusWindow(id);
}

export function createWindow({ appId, title, icon = '🗔', width = 640, height = 460, content }) {
  const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const el = document.createElement('div');
  el.className = 'app-window';
  // Toda janela nova abre centralizada na área útil da tela (sem tender
  // para a esquerda/direita como um cascateamento faria). Se outra janela
  // já estiver bem em cima dessa mesma posição, desloca um pouco — sempre
  // a partir do centro, nunca acumulando numa única direção — só o
  // suficiente pra dar pra perceber que há mais de uma janela aberta.
  const availableHeight = window.innerHeight - taskbarHeight();
  // Nunca abre maior que a área útil: numa tela pequena, uma janela pedida
  // com 640x460 encolhe para caber, em vez de vazar para fora da tela.
  const effWidth = Math.min(width, Math.max(280, window.innerWidth - 16));
  const effHeight = Math.min(height, Math.max(180, availableHeight - 16));
  const baseX = Math.max(0, Math.round((window.innerWidth - effWidth) / 2));
  const baseY = Math.max(0, Math.round((availableHeight - effHeight) / 2));
  const existingPositions = Array.from(openWindows.values()).map((w) => ({
    left: parseFloat(w.el.style.left) || 0,
    top: parseFloat(w.el.style.top) || 0,
  }));
  let startX = baseX;
  let startY = baseY;
  for (let step = 1; step <= 4; step++) {
    const stillOverlapping = existingPositions.some((p) => Math.abs(p.left - startX) < 4 && Math.abs(p.top - startY) < 4);
    if (!stillOverlapping) break;
    startX = baseX + step * 24;
    startY = baseY + step * 24;
  }
  Object.assign(el.style, {
    width: `${effWidth}px`,
    height: `${effHeight}px`,
    left: `${startX}px`,
    top: `${startY}px`,
  });
  // Em telas estreitas (celular) não sobra espaço de verdade para o modelo
  // de janelas flutuantes/redimensionáveis — abre direto maximizada, como
  // qualquer app de tela cheia.
  if (isCompactViewport()) el.classList.add('maximized');

  el.innerHTML = `
    <div class="win-titlebar" data-role="titlebar">
      <span class="win-icon"></span>
      <span class="win-title"></span>
      <div class="win-controls">
        <button class="win-btn" data-action="min" title="Minimizar" aria-label="Minimizar">&#x2013;</button>
        <button class="win-btn" data-action="max" title="Maximizar" aria-label="Maximizar">&#x2610;</button>
        <button class="win-btn win-close" data-action="close" title="Fechar" aria-label="Fechar">&#x2715;</button>
      </div>
    </div>
    <div class="win-body"></div>
    <div class="win-resize" data-role="resize"></div>
  `;

  // Via textContent, nunca innerHTML: título e ícone podem vir de nomes de
  // arquivo/pasta escolhidos pelo usuário, e não devem ser interpretados
  // como HTML.
  el.querySelector('.win-icon').textContent = icon;
  el.querySelector('.win-title').textContent = title;

  const body = el.querySelector('.win-body');
  body.appendChild(content);
  document.getElementById('windows-layer').appendChild(el);
  windowOpen(el);

  const win = { id, el, title, icon, appId, minimized: false, focused: true, snapped: null, openedAt: Date.now() };
  openWindows.set(id, win);
  focusWindow(id);

  el.addEventListener('pointerdown', () => focusWindow(id));

  const titlebar = el.querySelector('[data-role="titlebar"]');
  let dragging = false, offX = 0, offY = 0, activeZone = null, dragStartX = 0, dragStartY = 0;
  titlebar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.win-btn')) return;
    dragging = true;
    activeZone = null;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    el.classList.add('dragging');
  });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-btn')) return;
    toggleMaximize(win);
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

  // Nomeadas (não inline) para poderem ser removidas em closeWindow() —
  // sem isso, cada janela aberta deixava um par de listeners permanentes em
  // `window`, nunca liberados, mesmo depois de fechada (vazamento de
  // memória: iam se acumulando a cada janela aberta/fechada na sessão).
  function onWindowPointerMove(e) {
    if (dragging && el.classList.contains('maximized')) {
      // Só restaura a janela maximizada quando o arrasto realmente começa —
      // um clique duplo não deve disparar isso (senão cancela o toggle).
      const moved = Math.abs(e.clientX - dragStartX) > 4 || Math.abs(e.clientY - dragStartY) > 4;
      if (moved) {
        const restoredWidth = el.offsetWidth * 0.6;
        el.classList.remove('maximized');
        el.style.width = `${restoredWidth}px`;
        offX = restoredWidth / 2;
        offY = 15;
        win.snapped = null;
      }
    }
    if (dragging && !el.classList.contains('maximized')) {
      // Nunca deixa arrastar a ponto de a barra de título sumir da tela —
      // sempre sobra pelo menos um pedaço para conseguir pegar de volta.
      const maxLeft = window.innerWidth - 80;
      const maxTop = window.innerHeight - taskbarHeight() - 36;
      el.style.left = `${Math.min(maxLeft, Math.max(0, e.clientX - offX))}px`;
      el.style.top = `${Math.min(maxTop, Math.max(0, e.clientY - offY))}px`;
      const zone = detectZone(e.clientX, e.clientY);
      if (zone !== activeZone) {
        activeZone = zone;
        if (zone) showSnapPreview(zone);
        else hideSnapPreview();
      }
    }
    if (resizing) {
      const maxW = window.innerWidth - el.offsetLeft;
      const maxH = window.innerHeight - taskbarHeight() - el.offsetTop;
      el.style.width = `${Math.min(maxW, Math.max(320, resizeStartW + (e.clientX - resizeStartX)))}px`;
      el.style.height = `${Math.min(maxH, Math.max(200, resizeStartH + (e.clientY - resizeStartY)))}px`;
      win.snapped = null;
    }
  }
  function onWindowPointerUp() {
    if (dragging && activeZone) applySnap(id, activeZone);
    hideSnapPreview();
    activeZone = null;
    dragging = false;
    resizing = false;
    el.classList.remove('dragging');
  }
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  win.cleanupDrag = () => {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
  };

  el.querySelector('[data-action="min"]').addEventListener('click', () => toggleMinimize(id));
  el.querySelector('[data-action="max"]').addEventListener('click', () => toggleMaximize(win));
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
    /** Registra uma função a ser chamada quando a janela for fechada —
     * usado pelos apps para remover listeners globais e evitar vazamento
     * de memória (ex: atalhos de teclado). */
    onClose: (fn) => {
      win.onClose = fn;
    },
  };
}

export function closeAllWindows() {
  Array.from(openWindows.keys()).forEach(closeWindow);
}

// Reencaixa as janelas abertas quando a viewport muda de tamanho (girar um
// tablet/celular, redimensionar a janela do navegador) — sem isso, uma
// janela aberta numa tela grande podia ficar parcialmente (ou totalmente)
// fora da área visível depois que a tela encolhesse.
window.addEventListener('resize', () => {
  const availableHeight = window.innerHeight - taskbarHeight();
  openWindows.forEach((win) => {
    if (win.el.classList.contains('maximized')) return;
    const maxW = Math.max(280, window.innerWidth - 16);
    const maxH = Math.max(180, availableHeight - 16);
    if (win.el.offsetWidth > maxW) win.el.style.width = `${maxW}px`;
    if (win.el.offsetHeight > maxH) win.el.style.height = `${maxH}px`;
    const maxLeft = Math.max(0, window.innerWidth - 80);
    const maxTop = Math.max(0, availableHeight - 36);
    if (win.el.offsetLeft > maxLeft) win.el.style.left = `${maxLeft}px`;
    if (win.el.offsetTop > maxTop) win.el.style.top = `${maxTop}px`;
  });
  if (isCompactViewport()) {
    openWindows.forEach((win) => win.el.classList.add('maximized'));
  }
});
