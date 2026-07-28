// Alternador de janelas (Alt+Tab). Só funciona quando o teclado físico
// envia o atalho para a página — em muitos navegadores/SOs de desktop o
// Alt+Tab é interceptado antes de chegar à aba, então este recurso vale
// principalmente para quem usa um teclado (Bluetooth incluso) enquanto o
// app está em foco, ou ao testar em um navegador desktop comum.
import * as WM from './window-manager.js';
import { panelOpen } from '../motion/motion.js';

let overlayEl = null;
let candidates = [];
let selectedIndex = 0;
let active = false;

function getOverlay() {
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.className = 'task-switcher hidden';
    document.body.appendChild(overlayEl);
  }
  return overlayEl;
}

function render() {
  const el = getOverlay();
  el.innerHTML = candidates
    .map(
      (w, i) => `
      <div class="task-switcher-item${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
        <div class="task-switcher-icon">${w.icon}</div>
        <div class="task-switcher-title">${w.title}</div>
      </div>`
    )
    .join('');
}

function open() {
  candidates = WM.getWindowsOrder();
  if (candidates.length < 2) return;
  selectedIndex = 1;
  active = true;
  render();
  const el = getOverlay();
  el.classList.remove('hidden');
  panelOpen(el);
}

function advance(step = 1) {
  if (!active) return;
  selectedIndex = (selectedIndex + step + candidates.length) % candidates.length;
  render();
}

function commit() {
  if (!active) return;
  active = false;
  getOverlay().classList.add('hidden');
  const chosen = candidates[selectedIndex];
  if (chosen) WM.focusById(chosen.id);
}

export function init() {
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.key !== 'Tab') return;
    e.preventDefault();
    if (!active) open();
    else advance(e.shiftKey ? -1 : 1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && active) commit();
  });
}
