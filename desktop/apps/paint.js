// Paint: editor de imagens baseado em canvas, no espírito do Paint clássico
// do Windows — lápis, pincel, borracha, balde de preenchimento, formas
// (linha/retângulo/elipse), seleção com mover, texto, conta-gotas,
// desfazer/refazer, e salva como PNG de verdade no sistema de arquivos
// virtual (ou baixa pro computador real).
import { showConfirm, showPrompt } from '../core/services/dialogs.js';

const PALETTE = [
  '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fffc00', '#22b14c', '#00a2e8',
  '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#99d9ea', '#c8bfe7',
];
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 420;
const MAX_DIMENSION = 3000;
const MAX_HISTORY = 30;

function clampDimension(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_DIMENSION);
}

export function openPaint(ctx, { fileId } = {}) {
  const { fs, seed, windows } = ctx;
  let currentFileId = fileId || null;
  let dirty = false;
  let fileName = null;

  let tool = 'pencil';
  let color = '#000000';
  let brushSize = 3;
  let history = [];
  let historyIndex = -1;
  let isPointerDown = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let baseSnapshot = null; // ImageData tirado no pointerdown, usado pra "previews" de forma
  let selectionRect = null; // { x, y, w, h } em coordenadas do canvas, quando há seleção ativa
  let movingSelection = null; // { imageData, offsetX, offsetY } durante um arraste de mover
  let selectionMoved = false; // true quando o arraste atual de fato moveu pixels (conta pra histórico)
  let previousToolBeforePicker = 'pencil';

  const root = document.createElement('div');
  root.className = 'paint-app';
  root.innerHTML = `
    <div class="paint-toolbar">
      <button data-action="new" title="Novo (Ctrl+N)">📄 Novo</button>
      <button data-action="save" title="Salvar (Ctrl+S)">💾 Salvar</button>
      <button data-action="save-as" title="Salvar como">💾 Salvar como</button>
      <button data-action="download" title="Baixar para o computador">⬇️ Baixar</button>
      <span class="paint-sep"></span>
      <button data-action="undo" title="Desfazer (Ctrl+Z)">↩️ Desfazer</button>
      <button data-action="redo" title="Refazer (Ctrl+Y)">↪️ Refazer</button>
      <span class="paint-sep"></span>
      <button data-tool="pencil" class="active" title="Lápis">✏️ Lápis</button>
      <button data-tool="brush" title="Pincel">🎨 Pincel</button>
      <button data-tool="eraser" title="Borracha">Borracha</button>
      <button data-tool="fill" title="Preencher">Preencher</button>
      <button data-tool="line" title="Linha">📏 Linha</button>
      <button data-tool="rect" title="Retângulo">▭ Retângulo</button>
      <button data-tool="ellipse" title="Elipse">⭕ Elipse</button>
      <button data-tool="select" title="Selecionar">Selecionar</button>
      <button data-tool="text" title="Texto">🔤 Texto</button>
      <button data-tool="picker" title="Conta-gotas">Conta-gotas</button>
      <span class="paint-sep"></span>
      <label class="paint-size-label">Espessura
        <select data-role="brush-size" aria-label="Espessura do traço">
          <option value="1">1px</option>
          <option value="2">2px</option>
          <option value="3" selected>3px</option>
          <option value="5">5px</option>
          <option value="8">8px</option>
          <option value="12">12px</option>
          <option value="20">20px</option>
        </select>
      </label>
    </div>
    <div class="paint-palette-row">
      <span class="paint-current-color" data-role="current-color" title="Cor atual"></span>
      <input type="color" data-role="custom-color" value="#000000" title="Cor personalizada">
      <div class="paint-palette" data-role="palette"></div>
    </div>
    <div class="paint-canvas-wrap" data-role="canvas-wrap">
      <div class="paint-canvas-stage" data-role="stage">
        <canvas data-role="canvas"></canvas>
        <input type="text" class="paint-text-input hidden" data-role="text-input">
        <div class="paint-selection-box hidden" data-role="selection-box"></div>
      </div>
    </div>
    <div class="paint-status" data-role="status">Sem título — ${DEFAULT_WIDTH}×${DEFAULT_HEIGHT}px</div>
  `;

  const win = windows.createWindow({
    appId: 'paint',
    title: 'Paint',
    icon: '🎨',
    width: 800,
    height: 640,
    content: root,
  });

  const canvas = root.querySelector('[data-role="canvas"]');
  const stage = root.querySelector('[data-role="stage"]');
  const canvasWrap = root.querySelector('[data-role="canvas-wrap"]');
  const status = root.querySelector('[data-role="status"]');
  const paletteEl = root.querySelector('[data-role="palette"]');
  const currentColorEl = root.querySelector('[data-role="current-color"]');
  const customColorInput = root.querySelector('[data-role="custom-color"]');
  const sizeSelect = root.querySelector('[data-role="brush-size"]');
  const textInput = root.querySelector('[data-role="text-input"]');
  const selectionBox = root.querySelector('[data-role="selection-box"]');
  const g = canvas.getContext('2d', { willReadFrequently: true });

  function updateTitle() {
    const label = fileName || 'Sem título';
    win.setTitle(`${dirty ? '● ' : ''}${label} - Paint`);
  }
  function updateStatus() {
    status.textContent = `${fileName || 'Sem título'} — ${canvas.width}×${canvas.height}px`;
  }
  function markDirty() {
    dirty = true;
    updateTitle();
  }

  function setCurrentColor(hex) {
    color = hex;
    currentColorEl.style.background = hex;
    customColorInput.value = hex;
  }
  PALETTE.forEach((hex) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'paint-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => setCurrentColor(hex));
    paletteEl.appendChild(sw);
  });
  customColorInput.addEventListener('input', () => setCurrentColor(customColorInput.value));
  setCurrentColor(color);

  function setTool(name) {
    tool = name;
    root.querySelectorAll('[data-tool]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === name));
    clearSelection();
    canvas.style.cursor = (name === 'text') ? 'text' : (name === 'select') ? 'crosshair' : 'crosshair';
  }
  root.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  sizeSelect.addEventListener('change', () => { brushSize = Number(sizeSelect.value); });

  // ---------------- Histórico (desfazer/refazer) ----------------
  function pushHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(canvas.toDataURL('image/png'));
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
  }
  function restoreFromHistory() {
    const dataUrl = history[historyIndex];
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0);
      updateStatus();
    };
    img.src = dataUrl;
  }
  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreFromHistory();
    markDirty();
  }
  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreFromHistory();
    markDirty();
  }

  // ---------------- Tela em branco / carregar imagem existente ----------------
  function blankCanvas(width, height) {
    canvas.width = width;
    canvas.height = height;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    history = [];
    historyIndex = -1;
    pushHistory();
    updateStatus();
  }
  function loadImageInto(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width || DEFAULT_WIDTH;
        canvas.height = img.height || DEFAULT_HEIGHT;
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0);
        history = [];
        historyIndex = -1;
        pushHistory();
        updateStatus();
        resolve();
      };
      img.onerror = () => { blankCanvas(DEFAULT_WIDTH, DEFAULT_HEIGHT); resolve(); };
      img.src = dataUrl;
    });
  }

  // Ao contrário do Paint de verdade (que tem dimensões fixas e explícitas),
  // aqui a tela em branco recém-criada acompanha o tamanho da janela — mas só
  // enquanto ainda não foi desenhada nem salva/aberta como arquivo, pra nunca
  // esticar silenciosamente as dimensões de uma imagem real do usuário.
  const CANVAS_WRAP_PADDING = 40; // 2x var(--space-5), ver .paint-canvas-wrap
  function growCanvasToFit() {
    if (currentFileId || dirty) return;
    const availW = Math.round(canvasWrap.clientWidth - CANVAS_WRAP_PADDING);
    const availH = Math.round(canvasWrap.clientHeight - CANVAS_WRAP_PADDING);
    const targetW = Math.min(MAX_DIMENSION, Math.max(canvas.width, availW));
    const targetH = Math.min(MAX_DIMENSION, Math.max(canvas.height, availH));
    if (targetW === canvas.width && targetH === canvas.height) return;
    const snapshot = g.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = targetW;
    canvas.height = targetH;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.putImageData(snapshot, 0, 0);
    history = [];
    historyIndex = -1;
    pushHistory();
    updateStatus();
  }
  const canvasResizeObserver = ('ResizeObserver' in window) ? new ResizeObserver(() => growCanvasToFit()) : null;
  if (canvasResizeObserver) canvasResizeObserver.observe(canvasWrap);

  async function openExisting(id) {
    const node = await fs.getNode(id);
    if (!node) return;
    currentFileId = id;
    fileName = node.name;
    await loadImageInto(node.content || '');
    dirty = false;
    updateTitle();
  }

  // ---------------- Salvar ----------------
  async function saveCurrent() {
    if (!currentFileId) return saveAs();
    const dataUrl = canvas.toDataURL('image/png');
    await fs.updateNode(currentFileId, { content: dataUrl, mimeType: 'image/png' });
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }
  async function saveAs() {
    let name = await showPrompt('Nome do arquivo:', fileName || 'Imagem sem título.png', { title: 'Salvar como', container: win.el });
    if (!name || !name.trim()) return;
    name = name.trim();
    if (!/\.png$/i.test(name)) name += '.png';
    const dataUrl = canvas.toDataURL('image/png');
    const existing = await fs.findChildByName(seed.picturesId, name);
    if (existing) {
      await fs.updateNode(existing.id, { content: dataUrl, mimeType: 'image/png' });
      currentFileId = existing.id;
    } else {
      const node = await fs.createNode({ parentId: seed.picturesId, name, type: 'file', content: dataUrl, mimeType: 'image/png' });
      currentFileId = node.id;
    }
    fileName = name;
    dirty = false;
    updateTitle();
    updateStatus();
    ctx.refreshDesktop();
  }
  function downloadCurrent() {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = fileName || 'Imagem sem título.png';
    a.click();
  }

  root.querySelector('[data-action="new"]').addEventListener('click', async () => {
    if (dirty && !(await showConfirm('Descartar alterações não salvas?', { title: 'Nova imagem', okLabel: 'Descartar', danger: true, container: win.el }))) return;
    const w = clampDimension(await showPrompt('Largura da nova imagem (px):', String(DEFAULT_WIDTH), { title: 'Nova imagem', container: win.el }), DEFAULT_WIDTH);
    const h = clampDimension(await showPrompt('Altura da nova imagem (px):', String(DEFAULT_HEIGHT), { title: 'Nova imagem', container: win.el }), DEFAULT_HEIGHT);
    currentFileId = null;
    fileName = null;
    blankCanvas(w, h);
    dirty = false;
    updateTitle();
  });
  root.querySelector('[data-action="save"]').addEventListener('click', saveCurrent);
  root.querySelector('[data-action="save-as"]').addEventListener('click', saveAs);
  root.querySelector('[data-action="download"]').addEventListener('click', downloadCurrent);
  root.querySelector('[data-action="undo"]').addEventListener('click', undo);
  root.querySelector('[data-action="redo"]').addEventListener('click', redo);

  // ---------------- Desenho ----------------
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  }
  function strokeLineTo(x0, y0, x1, y1, strokeColor, width) {
    g.strokeStyle = strokeColor;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  function hexToRgba(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  function floodFill(startXPx, startYPx, fillHex) {
    if (startXPx < 0 || startYPx < 0 || startXPx >= canvas.width || startYPx >= canvas.height) return;
    const imgData = g.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;
    const idx = (x, y) => (y * w + x) * 4;
    const startIdx = idx(startXPx, startYPx);
    const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    const fill = hexToRgba(fillHex);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === fill[3]) return;
    const matches = (i) => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
    const stack = [[startXPx, startYPx]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = idx(x, y);
      if (!matches(i)) continue;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    g.putImageData(imgData, 0, 0);
  }
  function commitText(x, y, text) {
    if (!text) return;
    g.fillStyle = color;
    g.font = `${Math.max(12, brushSize * 6)}px sans-serif`;
    g.textBaseline = 'top';
    g.fillText(text, x, y);
    pushHistory();
    markDirty();
  }

  function clearSelection() {
    selectionRect = null;
    movingSelection = null;
    selectionBox.classList.add('hidden');
  }
  function updateSelectionBox() {
    if (!selectionRect) { selectionBox.classList.add('hidden'); return; }
    selectionBox.classList.remove('hidden');
    selectionBox.style.left = `${selectionRect.x}px`;
    selectionBox.style.top = `${selectionRect.y}px`;
    selectionBox.style.width = `${selectionRect.w}px`;
    selectionBox.style.height = `${selectionRect.h}px`;
  }
  function pointInSelection(x, y) {
    if (!selectionRect) return false;
    return x >= selectionRect.x && x <= selectionRect.x + selectionRect.w
      && y >= selectionRect.y && y <= selectionRect.y + selectionRect.h;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = canvasPos(e);
    if (tool === 'text') {
      textInput.style.left = `${x}px`;
      textInput.style.top = `${y}px`;
      textInput.style.color = color;
      textInput.style.fontSize = `${Math.max(12, brushSize * 6)}px`;
      textInput.value = '';
      textInput.classList.remove('hidden');
      textInput.focus();
      textInput.dataset.x = x;
      textInput.dataset.y = y;
      return;
    }
    if (tool === 'picker') {
      const px = g.getImageData(x, y, 1, 1).data;
      const hex = `#${[px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      setCurrentColor(hex);
      setTool(previousToolBeforePicker);
      return;
    }
    isPointerDown = true;
    startX = x; startY = y; lastX = x; lastY = y;
    canvas.setPointerCapture(e.pointerId);

    if (tool === 'select') {
      if (selectionRect && pointInSelection(x, y)) {
        // Começa a mover o conteúdo já selecionado: recorta os pixels e
        // limpa a área original de branco, deixando só o "buraco" pra trás.
        const r = selectionRect;
        movingSelection = { imageData: g.getImageData(r.x, r.y, r.w, r.h), offsetX: x - r.x, offsetY: y - r.y, origin: { ...r } };
        selectionMoved = false;
        g.fillStyle = '#ffffff';
        g.fillRect(r.x, r.y, r.w, r.h);
        baseSnapshot = g.getImageData(0, 0, canvas.width, canvas.height);
      } else {
        clearSelection();
        baseSnapshot = null;
      }
      return;
    }

    if (tool === 'fill') {
      floodFill(x, y, color);
      pushHistory();
      markDirty();
      isPointerDown = false;
      return;
    }

    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      const w = tool === 'pencil' ? Math.max(1, Math.min(brushSize, 4)) : brushSize;
      strokeLineTo(x, y, x, y, tool === 'eraser' ? '#ffffff' : color, w);
      return;
    }

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      baseSnapshot = g.getImageData(0, 0, canvas.width, canvas.height);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    const { x, y } = canvasPos(e);

    if (tool === 'select') {
      if (movingSelection) {
        selectionMoved = true;
        g.putImageData(baseSnapshot, 0, 0);
        const nx = x - movingSelection.offsetX;
        const ny = y - movingSelection.offsetY;
        g.putImageData(movingSelection.imageData, nx, ny);
        selectionRect = { x: nx, y: ny, w: movingSelection.imageData.width, h: movingSelection.imageData.height };
        updateSelectionBox();
      } else {
        selectionRect = { x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) };
        updateSelectionBox();
      }
      return;
    }

    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      const w = tool === 'pencil' ? Math.max(1, Math.min(brushSize, 4)) : brushSize;
      strokeLineTo(lastX, lastY, x, y, tool === 'eraser' ? '#ffffff' : color, w);
      lastX = x; lastY = y;
      return;
    }

    if (tool === 'line' && baseSnapshot) {
      g.putImageData(baseSnapshot, 0, 0);
      strokeLineTo(startX, startY, x, y, color, brushSize);
      return;
    }
    if (tool === 'rect' && baseSnapshot) {
      g.putImageData(baseSnapshot, 0, 0);
      g.strokeStyle = color;
      g.lineWidth = brushSize;
      g.strokeRect(Math.min(startX, x), Math.min(startY, y), Math.abs(x - startX), Math.abs(y - startY));
      return;
    }
    if (tool === 'ellipse' && baseSnapshot) {
      g.putImageData(baseSnapshot, 0, 0);
      const cx = (startX + x) / 2;
      const cy = (startY + y) / 2;
      const rx = Math.abs(x - startX) / 2;
      const ry = Math.abs(y - startY) / 2;
      g.strokeStyle = color;
      g.lineWidth = brushSize;
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.stroke();
    }
  });

  function finishStroke() {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (tool === 'select') {
      const didMove = movingSelection && selectionMoved;
      movingSelection = null;
      baseSnapshot = null;
      if (selectionRect && (selectionRect.w < 2 || selectionRect.h < 2)) clearSelection();
      if (didMove) { pushHistory(); markDirty(); }
      return;
    }
    baseSnapshot = null;
    pushHistory();
    markDirty();
  }
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('pointerleave', () => { if (isPointerDown && tool !== 'select') finishStroke(); });

  function commitTextInput() {
    if (textInput.classList.contains('hidden')) return;
    const x = Number(textInput.dataset.x);
    const y = Number(textInput.dataset.y);
    const text = textInput.value;
    textInput.classList.add('hidden');
    commitText(x, y, text);
  }
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitTextInput(); }
    else if (e.key === 'Escape') { textInput.classList.add('hidden'); }
  });
  textInput.addEventListener('blur', commitTextInput);

  // Antes de setar o tool 'picker', guarda o tool anterior pra voltar depois
  // de escolher a cor (mesmo comportamento do Paint de verdade).
  root.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool !== 'picker') previousToolBeforePicker = btn.dataset.tool;
    });
  });

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (isMod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    else if (isMod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectionRect && document.activeElement !== textInput) {
      e.preventDefault();
      g.fillStyle = '#ffffff';
      g.fillRect(selectionRect.x, selectionRect.y, selectionRect.w, selectionRect.h);
      clearSelection();
      pushHistory();
      markDirty();
    }
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => {
    window.removeEventListener('keydown', onKeydown);
    if (canvasResizeObserver) canvasResizeObserver.disconnect();
  });

  if (currentFileId) openExisting(currentFileId);
  else blankCanvas(DEFAULT_WIDTH, DEFAULT_HEIGHT);
  updateTitle();

  return win;
}
