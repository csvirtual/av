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
  el.innerHTML = '';
  // Via textContent: w.title pode conter um nome de arquivo/pasta escolhido
  // pelo usuário, nunca deve ser interpretado como HTML.
  candidates.forEach((w, i) => {
    const item = document.createElement('div');
    item.className = 'task-switcher-item' + (i === selectedIndex ? ' selected' : '');
    item.dataset.index = i;
    const icon = document.createElement('div');
    icon.className = 'task-switcher-icon';
    WM.setGlyph(icon, w.icon);
    const title = document.createElement('div');
    title.className = 'task-switcher-title';
    title.textContent = w.title;
    item.appendChild(icon);
    item.appendChild(title);
    el.appendChild(item);
  });
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
