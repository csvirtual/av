// Planilha: grade de células editáveis com fórmulas de verdade
// (SUM/AVERAGE/MIN/MAX/COUNT/IF/ROUND/ABS/CONCATENATE, operadores
// aritméticos e de comparação, texto entre aspas), lendo e salvando .xlsx
// real. A grade/edição/motor de fórmulas é 100% nosso (tokenizer, parser e
// avaliador com detecção de referência circular, escritos aqui mesmo); só
// a leitura/escrita do arquivo .xlsx em si usa a biblioteca SheetJS
// (vendorizada em desktop/vendor/xlsx, carregada só quando este app abre),
// porque reinventar o formato binário OOXML de planilha do zero seria
// reinventar a roda e arriscar gerar arquivo corrompido.
//
// Limitação real: a grade tem tamanho fixo (colunas A–R, linhas 1–60) — um
// .xlsx importado com dados fora desse intervalo tem essas células
// ignoradas. Fórmulas suportam apenas os intervalos/funções acima, não a
// linguagem de fórmulas completa do Excel.
import { showConfirm, showPrompt } from '../core/services/dialogs.js';

export const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const COLS = 18; // A..R
const ROWS = 60;

let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}
function loadLibs() {
  if (!libsPromise) {
    libsPromise = loadScript(new URL('../vendor/xlsx/xlsx.full.min.js', import.meta.url).href).then(() => ({ XLSXLib: window.XLSX }));
  }
  return libsPromise;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function dataUrlToArrayBuffer(dataUrl) {
  const base64 = (dataUrl.split(',')[1]) || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function colToLetters(col) {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function refFromColRow(col, row) { return `${colToLetters(col)}${row + 1}`; }
function colRowFromRef(ref) {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) throw new Error(`Referência inválida: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

// ---------- Motor de fórmulas (tokenizer + parser + avaliador) ----------
function tokenize(src) {
  const tokens = [];
  const re = /"([^"]*)"|(\d+\.?\d*)|([A-Za-z]+[0-9]+)|([A-Za-z]+)|(<=|>=|<>|[()+\-*/^,:=<>])/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ type: 'str', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: 'num', value: parseFloat(m[2]) });
    else if (m[3] !== undefined) tokens.push({ type: 'ref', value: m[3].toUpperCase() });
    else if (m[4] !== undefined) tokens.push({ type: 'name', value: m[4].toUpperCase() });
    else tokens.push({ type: 'op', value: m[5] });
  }
  return tokens;
}
const COMPARISON_OPS = ['=', '<>', '<', '>', '<=', '>='];

function parseFormula(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (t, v) => t && t.type === 'op' && t.value === v;
  function expectOp(op) {
    const t = next();
    if (!isOp(t, op)) throw new Error(`Esperado "${op}" na fórmula`);
  }
  function parseComparison() {
    let node = parseExpression();
    while (COMPARISON_OPS.some((op) => isOp(peek(), op))) {
      const op = next().value;
      node = { type: 'binop', op, left: node, right: parseExpression() };
    }
    return node;
  }
  function parseExpression() {
    let node = parseTerm();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = next().value;
      node = { type: 'binop', op, left: node, right: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = next().value;
      node = { type: 'binop', op, left: node, right: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (isOp(peek(), '-') || isOp(peek(), '+')) {
      const op = next().value;
      return { type: 'unary', op, arg: parseUnary() };
    }
    return parsePower();
  }
  function parsePower() {
    let node = parsePrimary();
    if (isOp(peek(), '^')) {
      next();
      node = { type: 'binop', op: '^', left: node, right: parseUnary() };
    }
    return node;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Fórmula incompleta');
    if (t.type === 'num') { next(); return { type: 'num', value: t.value }; }
    if (t.type === 'str') { next(); return { type: 'str', value: t.value }; }
    if (t.type === 'ref') { next(); return { type: 'ref', ref: t.value }; }
    if (t.type === 'name') {
      next();
      expectOp('(');
      const args = parseArgs();
      expectOp(')');
      return { type: 'call', name: t.value, args };
    }
    if (isOp(t, '(')) {
      next();
      const node = parseExpression();
      expectOp(')');
      return node;
    }
    throw new Error('Token inesperado na fórmula');
  }
  function parseArgs() {
    const args = [];
    if (isOp(peek(), ')')) return args;
    args.push(parseArg());
    while (isOp(peek(), ',')) { next(); args.push(parseArg()); }
    return args;
  }
  function parseArg() {
    if (peek() && peek().type === 'ref' && isOp(tokens[pos + 1], ':')) {
      const from = next().value;
      next();
      const to = next().value;
      return { type: 'range', from, to };
    }
    return parseComparison();
  }
  const result = parseComparison();
  if (pos !== tokens.length) throw new Error('Fórmula com sobra de tokens');
  return result;
}

function evaluateSheet(cells) {
  const cache = new Map();
  const visiting = new Set();

  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return 0;
  }
  function toText(v) {
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    return v == null ? '' : String(v);
  }
  function compareValues(a, b, op) {
    const numA = typeof a === 'number' || (typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a)));
    const numB = typeof b === 'number' || (typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b)));
    let cmp;
    if (numA && numB) {
      const na = Number(a), nb = Number(b);
      cmp = na < nb ? -1 : na > nb ? 1 : 0;
    } else {
      const sa = toText(a), sb = toText(b);
      cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    if (op === '=') return cmp === 0;
    if (op === '<>') return cmp !== 0;
    if (op === '<') return cmp < 0;
    if (op === '>') return cmp > 0;
    if (op === '<=') return cmp <= 0;
    if (op === '>=') return cmp >= 0;
    throw new Error('Operador de comparação desconhecido');
  }
  function rangeRefs(from, to) {
    const a = colRowFromRef(from), b = colRowFromRef(to);
    const refs = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) refs.push(refFromColRow(c, r));
    }
    return refs;
  }
  function evalNode(node) {
    switch (node.type) {
      case 'num': return node.value;
      case 'str': return node.value;
      case 'ref': {
        const v = getValue(node.ref);
        if (typeof v === 'string' && v.startsWith('#')) throw new Error(v);
        return v;
      }
      case 'unary': {
        const v = toNumber(evalNode(node.arg));
        return node.op === '-' ? -v : v;
      }
      case 'binop': {
        if (COMPARISON_OPS.includes(node.op)) {
          return compareValues(evalNode(node.left), evalNode(node.right), node.op);
        }
        const l = toNumber(evalNode(node.left));
        const r = toNumber(evalNode(node.right));
        if (node.op === '+') return l + r;
        if (node.op === '-') return l - r;
        if (node.op === '*') return l * r;
        if (node.op === '/') { if (r === 0) throw new Error('#DIV/0!'); return l / r; }
        if (node.op === '^') return Math.pow(l, r);
        throw new Error('Operador desconhecido');
      }
      case 'call': {
        const name = node.name;
        if (name === 'IF') {
          if (node.args.length < 2 || node.args.length > 3) throw new Error('IF espera 2 ou 3 argumentos');
          const cond = evalNode(node.args[0]);
          const truthy = typeof cond === 'boolean' ? cond : toNumber(cond) !== 0;
          if (truthy) return evalNode(node.args[1]);
          return node.args.length === 3 ? evalNode(node.args[2]) : false;
        }
        if (name === 'ROUND') {
          if (node.args.length !== 2) throw new Error('ROUND espera 2 argumentos');
          const num = toNumber(evalNode(node.args[0]));
          const digits = toNumber(evalNode(node.args[1]));
          const factor = Math.pow(10, digits);
          return Math.round(num * factor) / factor;
        }
        if (name === 'ABS') {
          if (node.args.length !== 1) throw new Error('ABS espera 1 argumento');
          return Math.abs(toNumber(evalNode(node.args[0])));
        }
        if (name === 'CONCATENATE') {
          return node.args.map((arg) => {
            if (arg.type === 'range') return rangeRefs(arg.from, arg.to).map((ref) => toText(getValue(ref))).join('');
            return toText(evalNode(arg));
          }).join('');
        }
        const values = [];
        for (const arg of node.args) {
          if (arg.type === 'range') rangeRefs(arg.from, arg.to).forEach((ref) => values.push(toNumber(getValue(ref))));
          else values.push(toNumber(evalNode(arg)));
        }
        if (name === 'SUM') return values.reduce((a, b) => a + b, 0);
        if (name === 'AVERAGE') return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        if (name === 'MIN') return values.length ? Math.min(...values) : 0;
        if (name === 'MAX') return values.length ? Math.max(...values) : 0;
        if (name === 'COUNT') return values.length;
        throw new Error(`Função desconhecida: ${name}`);
      }
      case 'range':
        throw new Error('Intervalo só é válido dentro de uma função');
      default:
        throw new Error('Nó inválido');
    }
  }
  function getValue(ref) {
    if (cache.has(ref)) return cache.get(ref);
    if (visiting.has(ref)) return '#CICLO!';
    const cell = cells[ref];
    if (!cell || cell.raw === '' || cell.raw == null) { cache.set(ref, 0); return 0; }
    const raw = String(cell.raw);
    if (!raw.startsWith('=')) {
      const num = Number(raw);
      const val = raw.trim() !== '' && !Number.isNaN(num) ? num : raw;
      cache.set(ref, val);
      return val;
    }
    visiting.add(ref);
    let result;
    try {
      result = evalNode(parseFormula(tokenize(raw.slice(1))));
    } catch (err) {
      result = (err && typeof err.message === 'string' && err.message.startsWith('#')) ? err.message : '#ERRO!';
    }
    visiting.delete(ref);
    cache.set(ref, result);
    return result;
  }

  const results = {};
  for (const ref of Object.keys(cells)) results[ref] = getValue(ref);
  return results;
}

// ---------- Leitura/escrita real de .xlsx via SheetJS ----------
function buildWorksheet(XLSXLib, cells, computed) {
  const ws = {};
  let maxCol = 0, maxRow = 0;
  for (const ref of Object.keys(cells)) {
    const raw = cells[ref].raw;
    if (raw === '' || raw == null) continue;
    const { col, row } = colRowFromRef(ref);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    const value = computed[ref];
    if (String(raw).startsWith('=')) {
      const t = typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's';
      ws[ref] = { t, v: value, f: String(raw).slice(1) };
    } else {
      const num = Number(raw);
      ws[ref] = (String(raw).trim() !== '' && !Number.isNaN(num)) ? { t: 'n', v: num } : { t: 's', v: String(raw) };
    }
  }
  ws['!ref'] = XLSXLib.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxCol, r: maxRow } });
  return ws;
}
async function cellsToXlsxDataUrl(XLSXLib, cells) {
  const computed = evaluateSheet(cells);
  const ws = buildWorksheet(XLSXLib, cells, computed);
  const wb = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(wb, ws, 'Planilha1');
  const arrayBuffer = XLSXLib.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([arrayBuffer], { type: SHEET_MIME });
  return blobToDataUrl(blob);
}
function xlsxArrayBufferToCells(XLSXLib, arrayBuffer) {
  const wb = XLSXLib.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const cells = {};
  if (ws && ws['!ref']) {
    const range = XLSXLib.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= Math.min(range.e.r, ROWS - 1); r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, COLS - 1); c++) {
        const ref = refFromColRow(c, r);
        const cell = ws[ref];
        if (!cell) continue;
        const raw = cell.f ? `=${cell.f}` : (cell.v != null ? String(cell.v) : '');
        if (raw !== '') cells[ref] = { raw };
      }
    }
  }
  return cells;
}

export function openSheet(ctx, { fileId = null } = {}) {
  const { fs, seed, windows } = ctx;
  let currentFileId = fileId;
  let dirty = false;
  let libs = null;
  let cells = {};
  let currentRef = null;
  const gridInputs = {};

  const root = document.createElement('div');
  root.className = 'sheet-app';
  root.innerHTML = `
    <div class="sheet-toolbar">
      <button data-action="new" title="Nova planilha">📄 Novo</button>
      <button data-action="save" title="Salvar">💾 Salvar</button>
      <button data-action="save-as" title="Salvar como">💾 Salvar como</button>
      <button data-action="import" title="Importar .xlsx do computador">📥 Importar .xlsx</button>
      <span class="sheet-sep"></span>
      <button data-action="freeze" title="Congelar a linha 1 (fica visível ao rolar a planilha)">🧊 Congelar linha 1</button>
      <input type="file" data-role="import-input" accept=".xlsx" class="hidden">
    </div>
    <div class="sheet-formula-bar">
      <span class="sheet-cell-ref" data-role="cell-ref">A1</span>
      <span class="sheet-fx">fx</span>
      <input type="text" data-role="formula-bar" aria-label="Barra de fórmulas">
    </div>
    <div class="sheet-grid-wrap" data-role="grid-wrap"></div>
    <div class="sheet-status" data-role="status">Nova planilha</div>
  `;

  const win = windows.createWindow({
    appId: 'sheet',
    title: 'Planilha',
    icon: '📗',
    width: 820,
    height: 560,
    content: root,
  });

  const gridWrap = root.querySelector('[data-role="grid-wrap"]');
  const formulaBar = root.querySelector('[data-role="formula-bar"]');
  const cellRefLabel = root.querySelector('[data-role="cell-ref"]');
  const status = root.querySelector('[data-role="status"]');
  const importInput = root.querySelector('[data-role="import-input"]');

  function buildGrid() {
    const table = document.createElement('table');
    table.className = 'sheet-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    for (let c = 0; c < COLS; c++) {
      const th = document.createElement('th');
      th.textContent = colToLetters(c);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < ROWS; r++) {
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th');
      rowHead.textContent = String(r + 1);
      tr.appendChild(rowHead);
      for (let c = 0; c < COLS; c++) {
        const ref = refFromColRow(c, r);
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.ref = ref;
        input.addEventListener('focus', () => onCellFocus(ref));
        input.addEventListener('input', () => { if (currentRef === ref) formulaBar.value = input.value; });
        input.addEventListener('keydown', (e) => onCellKeydown(e, ref, input));
        input.addEventListener('blur', () => commitCell(ref, input.value));
        gridInputs[ref] = input;
        td.appendChild(input);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    gridWrap.innerHTML = '';
    gridWrap.appendChild(table);
    applyFreezeState();
  }

  // "Congelar linha 1": mantém a primeira linha de dados visível ao rolar,
  // como o "Congelar Painel Superior" do Excel. O offset é medido na hora
  // (não fixo em CSS) pra funcionar com qualquer tamanho de fonte/zoom.
  let headerFrozen = false;
  function applyFreezeState() {
    const table = gridWrap.querySelector('.sheet-table');
    if (!table) return;
    table.classList.toggle('frozen-header', headerFrozen);
    const theadRow = table.querySelector('thead tr');
    if (theadRow) table.style.setProperty('--sheet-head-h', `${theadRow.getBoundingClientRect().height}px`);
  }

  function onCellFocus(ref) {
    currentRef = ref;
    cellRefLabel.textContent = ref;
    formulaBar.value = cells[ref]?.raw || '';
  }
  function onCellKeydown(e, ref, input) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const { col, row } = colRowFromRef(ref);
      const nextRef = row + 1 < ROWS ? refFromColRow(col, row + 1) : null;
      input.blur();
      if (nextRef) gridInputs[nextRef].focus();
    }
  }
  formulaBar.addEventListener('input', () => { if (currentRef) gridInputs[currentRef].value = formulaBar.value; });
  formulaBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (currentRef) gridInputs[currentRef].blur(); }
  });

  function markDirty() {
    dirty = true;
    updateTitle();
  }
  function updateTitle() {
    const name = status.dataset.name || 'Nova planilha';
    win.setTitle(`${dirty ? '● ' : ''}${name} - Planilha`);
    status.textContent = status.dataset.name ? `Salvo em Documentos › ${status.dataset.name}` : 'Nova planilha';
  }

  function commitCell(ref, rawValue) {
    if (rawValue === '') delete cells[ref];
    else cells[ref] = { raw: rawValue };
    markDirty();
    recalcAndRender();
  }
  function recalcAndRender() {
    const computed = evaluateSheet(cells);
    Object.keys(gridInputs).forEach((ref) => {
      if (gridInputs[ref] === document.activeElement) return; // deixa a célula em edição (com foco de verdade) mostrando a fórmula crua
      const value = computed[ref];
      if (value === undefined) gridInputs[ref].value = '';
      else gridInputs[ref].value = typeof value === 'boolean' ? (value ? 'VERDADEIRO' : 'FALSO') : String(value);
    });
  }

  async function ensureLibs() {
    if (!libs) {
      status.textContent = 'Carregando planilha…';
      libs = await loadLibs();
    }
    return libs;
  }

  async function loadFile(id) {
    const node = await fs.getNode(id);
    if (!node) return;
    currentFileId = id;
    status.dataset.name = node.name;
    if (!node.content) {
      cells = {};
    } else if (!node.content.startsWith('data:')) {
      // Arquivo aberto via "Abrir com" que não é um .xlsx (ex: um .txt) —
      // joga o texto na primeira célula em vez de tentar (e falhar)
      // interpretar como planilha OOXML.
      cells = { A1: { raw: node.content } };
    } else {
      try {
        const { XLSXLib } = await ensureLibs();
        cells = xlsxArrayBufferToCells(XLSXLib, dataUrlToArrayBuffer(node.content));
      } catch {
        cells = {};
        status.textContent = `Não foi possível ler "${node.name}" como planilha (arquivo corrompido ou não é um .xlsx de verdade).`;
        recalcAndRender();
        dirty = false;
        return;
      }
    }
    recalcAndRender();
    dirty = false;
    updateTitle();
  }

  async function saveCurrent() {
    if (!currentFileId) return saveAs();
    const { XLSXLib } = await ensureLibs();
    const dataUrl = await cellsToXlsxDataUrl(XLSXLib, cells);
    await fs.updateNode(currentFileId, { content: dataUrl, mimeType: SHEET_MIME });
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }
  async function saveAs() {
    let name = await showPrompt('Nome do arquivo:', status.dataset.name || 'Nova Planilha.xlsx', { title: 'Salvar como', container: win.el });
    if (!name || !name.trim()) return;
    name = name.trim();
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    const { XLSXLib } = await ensureLibs();
    const dataUrl = await cellsToXlsxDataUrl(XLSXLib, cells);
    const existing = await fs.findChildByName(seed.documentsId, name);
    if (existing) {
      await fs.updateNode(existing.id, { content: dataUrl, mimeType: SHEET_MIME });
      currentFileId = existing.id;
    } else {
      const node = await fs.createNode({ parentId: seed.documentsId, name, type: 'file', content: dataUrl, mimeType: SHEET_MIME });
      currentFileId = node.id;
    }
    status.dataset.name = name;
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }

  root.querySelector('[data-action="new"]').addEventListener('click', async () => {
    if (dirty && !(await showConfirm('Descartar alterações não salvas?', { title: 'Nova planilha', okLabel: 'Descartar', danger: true, container: win.el }))) return;
    currentFileId = null;
    cells = {};
    currentRef = null;
    recalcAndRender();
    formulaBar.value = '';
    delete status.dataset.name;
    dirty = false;
    updateTitle();
  });
  root.querySelector('[data-action="save"]').addEventListener('click', saveCurrent);
  const freezeBtn = root.querySelector('[data-action="freeze"]');
  freezeBtn.addEventListener('click', () => {
    headerFrozen = !headerFrozen;
    freezeBtn.textContent = headerFrozen ? '🧊 Descongelar linha 1' : '🧊 Congelar linha 1';
    freezeBtn.classList.toggle('active', headerFrozen);
    applyFreezeState();
  });
  root.querySelector('[data-action="save-as"]').addEventListener('click', saveAs);
  root.querySelector('[data-action="import"]').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    if (dirty && !(await showConfirm('Descartar alterações não salvas e importar este arquivo?', { title: 'Importar arquivo', okLabel: 'Descartar e importar', danger: true, container: win.el }))) return;
    const { XLSXLib } = await ensureLibs();
    const arrayBuffer = await file.arrayBuffer();
    cells = xlsxArrayBufferToCells(XLSXLib, arrayBuffer);
    currentFileId = null;
    currentRef = null;
    recalcAndRender();
    formulaBar.value = '';
    status.dataset.name = file.name.replace(/\.xlsx$/i, '') + ' (importado).xlsx';
    dirty = true;
    updateTitle();
    ctx.notify?.({ appId: 'sheet', icon: '📗', title: 'Planilha importada', body: `${file.name} — use "Salvar como" para guardar aqui dentro.` });
  });

  buildGrid();
  if (currentFileId) loadFile(currentFileId);
  else updateTitle();

  return win;
}
