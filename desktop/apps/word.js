// Documento: editor de texto rico, com o mesmo espírito do Bloco de Notas
// (abre/salva no sistema de arquivos virtual), mas gerando e lendo arquivos
// .docx de verdade — não um formato próprio disfarçado. A geração/leitura
// real do OOXML é feita por duas bibliotecas de terceiros vendorizadas em
// desktop/vendor (MIT/BSD, sem servidor nenhum envolvido) e carregadas só
// quando este app abre pela primeira vez, pra não pesar no carregamento do
// resto do desktop:
//   - docx (dolanmiu/docx): monta o Document/Paragraph/TextRun e empacota
//     como .docx real (Packer.toBlob) — usado ao salvar.
//   - mammoth: lê um .docx real e devolve HTML equivalente — usado ao abrir.
// Isso significa que um arquivo criado aqui e baixado pelo Explorador
// ("Baixar para o computador") já abre de verdade no Word/LibreOffice/Google
// Docs, sem conversão nenhuma no meio.
import { showConfirm, showPrompt } from '../core/services/dialogs.js';

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// O mammoth (usado pra reabrir um .docx) por padrão ignora formatação
// direta como cor de texto e tamanho de fonte — o arquivo salvo continua
// correto de verdade (abre certo no Word/LibreOffice de verdade, dá pra
// conferir olhando o XML), só a nossa própria pré-visualização ao reabrir
// não mostra essas duas. Realce, porém, o mammoth sabe recuperar via
// style map — por isso mapeamos as 4 cores que a barra de ferramentas usa.
const MAMMOTH_STYLE_MAP = [
  'u => u',
  "highlight[color='yellow'] => span.mammoth-hl-yellow",
  "highlight[color='green'] => span.mammoth-hl-green",
  "highlight[color='cyan'] => span.mammoth-hl-cyan",
  "highlight[color='magenta'] => span.mammoth-hl-magenta",
];

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
    libsPromise = Promise.all([
      loadScript(new URL('../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href),
      loadScript(new URL('../vendor/docx/docx.iife.js', import.meta.url).href),
    ]).then(() => ({ mammoth: window.mammoth, DocxLib: window.docx }));
  }
  return libsPromise;
}

function escapeHtmlText(text) {
  const escaped = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return escaped.split(/\r?\n/).join('</p><p>');
}

// Sanitização defensiva do HTML que vem do mammoth (arquivo .docx importado
// pode ter sido criado por qualquer programa) antes de jogar em innerHTML.
// Regras extras além de tirar as tags perigosas: bloqueia href/src com
// javascript:/vbscript:, bloqueia src="data:..." que não seja imagem (uma
// imagem em base64 é conteúdo legítimo — o resto de data: não tem porque
// aparecer aqui), e só derruba o atributo style="..." inteiro se ele
// contiver algo além de formatação de texto de verdade (url()/expression()/
// @import/-moz-binding são vetores conhecidos de injeção via CSS) — não dá
// pra bloquear style="..." sempre, porque é assim que a própria barra de
// ferramentas (cor/tamanho/realce) aplica formatação legítima.
const DANGEROUS_STYLE_RE = /url\s*\(|expression\s*\(|-moz-binding|behavior\s*:|@import|javascript:/i;
function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const strip = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'svg', 'math', 'base', 'form'];
  (function walk(node) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName.toLowerCase();
      if (strip.includes(tag)) { child.remove(); return; }
      Array.from(child.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        if (/^on/i.test(name)) { child.removeAttribute(attr.name); return; }
        if ((name === 'href' || name === 'src') && /^(javascript|vbscript):/i.test(value)) { child.removeAttribute(attr.name); return; }
        if (name === 'src' && /^data:/i.test(value) && !/^data:image\//i.test(value)) { child.removeAttribute(attr.name); return; }
        if (name === 'href' && /^data:/i.test(value)) { child.removeAttribute(attr.name); return; }
        if (name === 'style' && DANGEROUS_STYLE_RE.test(value)) { child.removeAttribute(attr.name); }
      });
      walk(child);
    });
  })(template.content);
  return template.innerHTML;
}

function dataUrlToArrayBuffer(dataUrl) {
  const base64 = (dataUrl.split(',')[1]) || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote']);
const HEADING_MAP = { h1: 'HEADING_1', h2: 'HEADING_2', h3: 'HEADING_3' };
const ALIGN_MAP = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'BOTH' };
const NUMBERING_REF = 'lista-numerada';

function colorToHex(colorStr) {
  if (!colorStr) return null;
  if (colorStr.startsWith('#')) return colorStr.slice(1).toUpperCase();
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [1, 2, 3].map((i) => parseInt(m[i], 10).toString(16).padStart(2, '0')).join('').toUpperCase();
}
// O .docx só aceita um conjunto fixo de cores de realce nomeadas (não
// qualquer hex) — mapeia de volta o hex aplicado pelo seletor de realce pro
// nome mais próximo que o formato realmente suporta.
const HIGHLIGHT_HEX_TO_DOCX = { FFFF00: 'yellow', '00FF00': 'green', '00FFFF': 'cyan', FF00FF: 'magenta' };
// Um documento reaberto via mammoth representa o realce como uma classe CSS
// (ver MAMMOTH_STYLE_MAP), não como style inline — reconhece as duas formas,
// senão editar e salvar de novo um arquivo importado perderia o realce.
const HIGHLIGHT_CLASS_TO_DOCX = { 'mammoth-hl-yellow': 'yellow', 'mammoth-hl-green': 'green', 'mammoth-hl-cyan': 'cyan', 'mammoth-hl-magenta': 'magenta' };

// Constrói as "runs" (trechos de texto com formatação) de um elemento
// inline, percorrendo os descendentes e acumulando negrito/itálico/
// sublinhado/tamanho/cor/realce conforme as tags e estilos encontrados
// (<b>/<strong>, <i>/<em>, <u>, ou um <span style="..."> gerado pelo
// execCommand ao aplicar tamanho/cor/realce pela barra de ferramentas).
function runsFromInline(DocxLib, node, base = {}) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) {
        runs.push(new DocxLib.TextRun({
          text: child.textContent,
          bold: base.bold,
          italics: base.italic,
          underline: base.underline ? {} : undefined,
          size: base.size,
          color: base.color,
          highlight: base.highlight,
        }));
      }
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') { runs.push(new DocxLib.TextRun({ break: 1 })); return; }
    const next = { ...base };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;
    const style = child.style;
    // Com styleWithCSS ligado (ver abaixo), o próprio execCommand('bold'/
    // 'italic'/'underline') do botão da barra passa a gerar um <span
    // style="..."> em vez de <b>/<i>/<u> — reconhece os dois formatos,
    // senão o negrito/itálico/sublinhado do botão pararia de ser exportado.
    if (style?.fontWeight) {
      const fw = String(style.fontWeight).toLowerCase();
      if (fw === 'bold' || fw === 'bolder' || (Number(fw) >= 700)) next.bold = true;
    }
    if (style?.fontStyle === 'italic') next.italic = true;
    if (style?.textDecorationLine?.includes('underline') || style?.textDecoration?.includes('underline')) next.underline = true;
    if (style?.fontSize) {
      const pt = parseFloat(style.fontSize);
      if (pt) next.size = Math.round(pt * 2); // docx mede em meios-de-ponto
    }
    if (style?.color) {
      const hex = colorToHex(style.color);
      if (hex) next.color = hex;
    }
    if (style?.backgroundColor) {
      const hex = colorToHex(style.backgroundColor);
      const name = hex && HIGHLIGHT_HEX_TO_DOCX[hex];
      if (name) next.highlight = name;
    }
    for (const cls of child.classList) {
      if (HIGHLIGHT_CLASS_TO_DOCX[cls]) next.highlight = HIGHLIGHT_CLASS_TO_DOCX[cls];
    }
    runs.push(...runsFromInline(DocxLib, child, next));
  });
  return runs;
}

function alignmentFor(DocxLib, el) {
  const key = (el.style && el.style.textAlign) || '';
  return ALIGN_MAP[key] ? DocxLib.AlignmentType[ALIGN_MAP[key]] : undefined;
}

function blockToParagraphs(DocxLib, el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
    if (!items.length) return [];
    return items.map((li) => new DocxLib.Paragraph({
      children: runsFromInline(DocxLib, li),
      alignment: alignmentFor(DocxLib, li),
      ...(tag === 'ul' ? { bullet: { level: 0 } } : { numbering: { reference: NUMBERING_REF, level: 0 } }),
    }));
  }
  if (HEADING_MAP[tag]) {
    return [new DocxLib.Paragraph({ children: runsFromInline(DocxLib, el), heading: DocxLib.HeadingLevel[HEADING_MAP[tag]], alignment: alignmentFor(DocxLib, el) })];
  }
  return [new DocxLib.Paragraph({ children: runsFromInline(DocxLib, el), alignment: alignmentFor(DocxLib, el) })];
}

// Percorre os filhos diretos do editor: elementos de bloco viram parágrafos
// próprios; texto/inline soltos (ex: a primeira linha antes do primeiro
// Enter) são agrupados num parágrafo implícito.
function topLevelToParagraphs(DocxLib, editorEl) {
  const paragraphs = [];
  let pending = [];
  function flushPending() {
    if (!pending.length) return;
    const wrapper = document.createElement('p');
    pending.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
    paragraphs.push(...blockToParagraphs(DocxLib, wrapper));
    pending = [];
  }
  editorEl.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      flushPending();
      paragraphs.push(...blockToParagraphs(DocxLib, node));
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      // espaço em branco solto entre blocos (comum em HTML colado de fora) nunca é conteúdo real
    } else {
      pending.push(node);
    }
  });
  flushPending();
  return paragraphs;
}

async function editorToDocxDataUrl(DocxLib, editorEl) {
  const paragraphs = topLevelToParagraphs(DocxLib, editorEl);
  if (!paragraphs.length) paragraphs.push(new DocxLib.Paragraph({}));
  const documentDef = new DocxLib.Document({
    numbering: {
      config: [{
        reference: NUMBERING_REF,
        levels: [{ level: 0, format: DocxLib.LevelFormat.DECIMAL, text: '%1.', alignment: DocxLib.AlignmentType.START }],
      }],
    },
    sections: [{ children: paragraphs }],
  });
  const blob = await DocxLib.Packer.toBlob(documentDef);
  return blobToDataUrl(blob);
}

export function openWord(ctx, { fileId = null } = {}) {
  const { fs, seed, windows } = ctx;
  let currentFileId = fileId;
  let dirty = false;
  let libs = null;

  const root = document.createElement('div');
  root.className = 'word-app';
  root.innerHTML = `
    <div class="word-toolbar">
      <button data-action="new" title="Novo documento">📄 Novo</button>
      <button data-action="save" title="Salvar">💾 Salvar</button>
      <button data-action="save-as" title="Salvar como">💾 Salvar como</button>
      <button data-action="import" title="Importar .docx do computador">📥 Importar .docx</button>
      <span class="word-sep"></span>
      <button data-cmd="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
      <button data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
      <button data-cmd="underline" title="Sublinhado (Ctrl+U)"><u>S</u></button>
      <select data-role="font-size" title="Tamanho da fonte" aria-label="Tamanho da fonte">
        <option value="">Tamanho</option>
        <option value="9">9</option>
        <option value="10">10</option>
        <option value="11">11</option>
        <option value="12" selected>12</option>
        <option value="14">14</option>
        <option value="16">16</option>
        <option value="18">18</option>
        <option value="24">24</option>
        <option value="28">28</option>
        <option value="36">36</option>
      </select>
      <label class="word-color-label" title="Cor do texto">A<input type="color" data-role="text-color" value="#000000"></label>
      <select data-role="highlight" title="Realçar texto" aria-label="Realçar texto">
        <option value="">Realce</option>
        <option value="yellow">🟡 Amarelo</option>
        <option value="green">🟢 Verde</option>
        <option value="cyan">🔵 Ciano</option>
        <option value="magenta">🩷 Rosa</option>
        <option value="none">Nenhum</option>
      </select>
      <span class="word-sep"></span>
      <button data-block="h1" title="Título 1">T1</button>
      <button data-block="h2" title="Título 2">T2</button>
      <button data-block="h3" title="Título 3">T3</button>
      <button data-block="p" title="Parágrafo normal">¶</button>
      <span class="word-sep"></span>
      <button data-cmd="insertUnorderedList" title="Lista com marcadores">• Lista</button>
      <button data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
      <span class="word-sep"></span>
      <button data-align="left" title="Alinhar à esquerda">Esq</button>
      <button data-align="center" title="Centralizar">Centro</button>
      <button data-align="right" title="Alinhar à direita">Dir</button>
      <button data-align="justify" title="Justificar">Just</button>
      <input type="file" data-role="import-input" accept=".docx" class="hidden">
    </div>
    <div class="word-page-wrap">
      <div class="word-page" contenteditable="true" spellcheck="true"></div>
    </div>
    <div class="word-status" data-role="status">Novo documento</div>
  `;

  const win = windows.createWindow({
    appId: 'word',
    title: 'Documento',
    icon: '📘',
    width: 760,
    height: 560,
    content: root,
  });

  const editor = root.querySelector('.word-page');
  const status = root.querySelector('[data-role="status"]');
  const importInput = root.querySelector('[data-role="import-input"]');
  document.execCommand('defaultParagraphSeparator', false, 'p');
  // Sem isso, foreColor/hiliteColor no Chrome geram <font color> em vez de
  // <span style="...">, que é o que o exportador pro .docx sabe ler.
  document.execCommand('styleWithCSS', false, true);

  function updateTitle() {
    const name = status.dataset.name || 'Novo documento';
    win.setTitle(`${dirty ? '● ' : ''}${name} - Documento`);
  }

  function updateWordCount() {
    const words = (editor.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    const savedLabel = status.dataset.name ? `Salvo em Documentos › ${status.dataset.name}` : 'Novo documento';
    status.textContent = `${savedLabel} • ${words} ${words === 1 ? 'palavra' : 'palavras'}`;
  }

  function markDirty() {
    dirty = true;
    updateTitle();
    updateWordCount();
  }

  function refreshToolbarState() {
    root.querySelectorAll('[data-cmd]').forEach((btn) => {
      const cmd = btn.dataset.cmd;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch { /* comando não suportado no navegador */ }
      btn.classList.toggle('active', active);
    });
    let blockTag = 'p';
    try { blockTag = (document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch { /* ignora */ }
    root.querySelectorAll('[data-block]').forEach((btn) => btn.classList.toggle('active', btn.dataset.block === blockTag));
  }

  editor.addEventListener('input', () => { markDirty(); });
  editor.addEventListener('keyup', refreshToolbarState);
  editor.addEventListener('mouseup', refreshToolbarState);
  editor.addEventListener('focus', refreshToolbarState);

  root.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.cmd);
      markDirty();
      refreshToolbarState();
    });
  });
  root.querySelectorAll('[data-block]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand('formatBlock', false, btn.dataset.block === 'p' ? 'p' : btn.dataset.block);
      markDirty();
      refreshToolbarState();
    });
  });
  root.querySelectorAll('[data-align]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.focus();
      const cmd = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[btn.dataset.align];
      document.execCommand(cmd);
      markDirty();
    });
  });

  // execCommand('fontSize') só aceita a escala antiga 1-7 (xx-small..xx-large),
  // não um tamanho em pt de verdade — o truque padrão é aplicar o "7" (maior
  // da escala, fácil de achar de volta) e trocar pelo tamanho real que a
  // gente quer. Com styleWithCSS ligado (ver acima), o Chrome/Firefox geram
  // um <span style="font-size: xxx-large"> direto; navegadores mais antigos
  // podem gerar <font size="7"> — trata os dois casos.
  const fontSizeEl = root.querySelector('[data-role="font-size"]');
  fontSizeEl.addEventListener('change', () => {
    const pt = fontSizeEl.value;
    if (!pt) return;
    editor.focus();
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('span').forEach((span) => {
      if (span.style.fontSize === 'xxx-large') span.style.fontSize = `${pt}pt`;
    });
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    fontSizeEl.value = '';
    markDirty();
  });

  const textColorEl = root.querySelector('[data-role="text-color"]');
  textColorEl.addEventListener('input', () => {
    editor.focus();
    document.execCommand('foreColor', false, textColorEl.value);
    markDirty();
  });

  const highlightEl = root.querySelector('[data-role="highlight"]');
  const HIGHLIGHT_CSS = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', none: 'transparent' };
  highlightEl.addEventListener('change', () => {
    const value = highlightEl.value;
    if (!value) return;
    editor.focus();
    const supportsHilite = document.queryCommandSupported?.('hiliteColor');
    document.execCommand(supportsHilite ? 'hiliteColor' : 'backColor', false, HIGHLIGHT_CSS[value]);
    highlightEl.value = '';
    markDirty();
  });

  async function ensureLibs() {
    if (!libs) {
      status.textContent = 'Carregando editor de documentos…';
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
      editor.innerHTML = '';
    } else if (!node.content.startsWith('data:')) {
      // Arquivo aberto via "Abrir com" que não é um .docx (ex: um .txt) —
      // carrega o texto puro em vez de tentar (e falhar) interpretar como
      // OOXML. O Word de verdade também abre arquivos de texto assim.
      editor.innerHTML = `<p>${escapeHtmlText(node.content)}</p>`;
    } else {
      try {
        const { mammoth } = await ensureLibs();
        const arrayBuffer = dataUrlToArrayBuffer(node.content);
        const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: MAMMOTH_STYLE_MAP });
        editor.innerHTML = sanitizeHtml(result.value);
      } catch {
        editor.innerHTML = '';
        status.textContent = `Não foi possível ler "${node.name}" como documento do Word (arquivo corrompido ou não é um .docx de verdade).`;
        return;
      }
    }
    dirty = false;
    updateTitle();
    updateWordCount();
  }

  async function saveCurrent() {
    if (!currentFileId) return saveAs();
    const { DocxLib } = await ensureLibs();
    const dataUrl = await editorToDocxDataUrl(DocxLib, editor);
    await fs.updateNode(currentFileId, { content: dataUrl, mimeType: WORD_MIME });
    dirty = false;
    updateTitle();
    updateWordCount();
    ctx.refreshDesktop();
  }

  async function saveAs() {
    let name = await showPrompt('Nome do arquivo:', status.dataset.name || 'Novo Documento.docx', { title: 'Salvar como', container: win.el });
    if (!name || !name.trim()) return;
    name = name.trim();
    if (!/\.docx$/i.test(name)) name += '.docx';
    const { DocxLib } = await ensureLibs();
    const dataUrl = await editorToDocxDataUrl(DocxLib, editor);
    const existing = await fs.findChildByName(seed.documentsId, name);
    if (existing) {
      await fs.updateNode(existing.id, { content: dataUrl, mimeType: WORD_MIME });
      currentFileId = existing.id;
    } else {
      const node = await fs.createNode({ parentId: seed.documentsId, name, type: 'file', content: dataUrl, mimeType: WORD_MIME });
      currentFileId = node.id;
    }
    status.dataset.name = name;
    dirty = false;
    updateTitle();
    updateWordCount();
    ctx.refreshDesktop();
  }

  root.querySelector('[data-action="new"]').addEventListener('click', async () => {
    if (dirty && !(await showConfirm('Descartar alterações não salvas?', { title: 'Novo documento', okLabel: 'Descartar', danger: true, container: win.el }))) return;
    currentFileId = null;
    editor.innerHTML = '';
    delete status.dataset.name;
    dirty = false;
    updateTitle();
    updateWordCount();
  });
  root.querySelector('[data-action="save"]').addEventListener('click', saveCurrent);
  root.querySelector('[data-action="save-as"]').addEventListener('click', saveAs);
  root.querySelector('[data-action="import"]').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    if (dirty && !(await showConfirm('Descartar alterações não salvas e importar este arquivo?', { title: 'Importar arquivo', okLabel: 'Descartar e importar', danger: true, container: win.el }))) return;
    const { mammoth } = await ensureLibs();
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: MAMMOTH_STYLE_MAP });
    editor.innerHTML = sanitizeHtml(result.value);
    currentFileId = null;
    status.dataset.name = file.name.replace(/\.docx$/i, '') + ' (importado).docx';
    dirty = true;
    updateTitle();
    updateWordCount();
    ctx.notify?.({ appId: 'word', icon: '📘', title: 'Documento importado', body: `${file.name} — use "Salvar como" para guardar aqui dentro.` });
  });

  if (currentFileId) loadFile(currentFileId);
  else updateWordCount();

  return win;
}
