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

// O .docx só aceita um punhado de formatos de imagem (png/jpg/gif/bmp) —
// qualquer outro formato que o navegador aceite (webp, svg, avif...) é
// redesenhado num canvas e reexportado como PNG antes de virar ImageRun,
// pra exportação nunca quebrar por causa do formato do arquivo escolhido.
const DOCX_IMAGE_TYPES = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', bmp: 'bmp' };
const MAX_DOCX_IMAGE_WIDTH = 550; // px — cabe na largura útil de uma página A4/Carta
function imageRunFromImg(DocxLib, img) {
  const src = img.getAttribute('src') || '';
  const mimeMatch = src.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase() : '';
  let dataUrl = src;
  let type = DOCX_IMAGE_TYPES[mime];
  if (!type) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 1;
    canvas.height = img.naturalHeight || img.height || 1;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/png');
    type = 'png';
  }
  const naturalW = img.naturalWidth || img.width || 300;
  const naturalH = img.naturalHeight || img.height || 200;
  const scale = naturalW > MAX_DOCX_IMAGE_WIDTH ? MAX_DOCX_IMAGE_WIDTH / naturalW : 1;
  return new DocxLib.ImageRun({
    type,
    data: dataUrlToArrayBuffer(dataUrl),
    transformation: { width: Math.round(naturalW * scale), height: Math.round(naturalH * scale) },
  });
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'table']);
const HEADING_MAP = { h1: 'HEADING_1', h2: 'HEADING_2', h3: 'HEADING_3' };
const ALIGN_MAP = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'BOTH' };
const NUMBERING_REF = 'lista-numerada';
// px na tela (aplicados como padding do .word-page) — convertidos pra twips
// (1/20 de ponto; 1440 twips = 1 polegada = 96px) na hora de exportar, que é
// a unidade real que o .docx usa pra margem de página.
const MARGIN_PRESETS = { normal: { v: 48, h: 56 }, narrow: { v: 24, h: 24 }, wide: { v: 72, h: 110 } };
function pxToTwips(px) { return Math.round((px / 96) * 1440); }

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
    if (tag === 'img') { runs.push(imageRunFromImg(DocxLib, child)); return; }
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

// `extra` (ex.: { pageBreakBefore: true }, vindo de uma quebra de página
// manual logo antes deste bloco) só se aplica ao PRIMEIRO parágrafo
// resultante — uma lista com quebra de página antes quebra antes do
// primeiro item, não antes de cada item da lista.
function blockToParagraphs(DocxLib, el, extra = {}) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
    if (!items.length) return [];
    return items.map((li, i) => new DocxLib.Paragraph({
      children: runsFromInline(DocxLib, li),
      alignment: alignmentFor(DocxLib, li),
      ...(tag === 'ul' ? { bullet: { level: 0 } } : { numbering: { reference: NUMBERING_REF, level: 0 } }),
      ...(i === 0 ? extra : {}),
    }));
  }
  if (HEADING_MAP[tag]) {
    return [new DocxLib.Paragraph({ children: runsFromInline(DocxLib, el), heading: DocxLib.HeadingLevel[HEADING_MAP[tag]], alignment: alignmentFor(DocxLib, el), ...extra })];
  }
  return [new DocxLib.Paragraph({ children: runsFromInline(DocxLib, el), alignment: alignmentFor(DocxLib, el), ...extra })];
}

// Converte uma <table> do editor numa Table de verdade do .docx. Cada célula
// vira uma TableCell cujo conteúdo é escaneado como bloco (reaproveita
// scanBlocks, então uma célula pode ter mais de um parágrafo) — suporta
// mesclagem horizontal (colspan) porque é só um número por célula, mas não
// mesclagem vertical (rowspan), que exigiria acompanhar o estado entre
// linhas; uma célula com rowspan > 1 simplesmente aparece como célula normal
// em cada linha em que o HTML de origem (nosso próprio editor ou o do
// mammoth) a repetir.
function tableToDocxTable(DocxLib, tableEl) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (!rows.length) return null;
  const docRows = rows
    .map((tr) => {
      const cells = Array.from(tr.children).filter((c) => ['td', 'th'].includes(c.tagName.toLowerCase()));
      if (!cells.length) return null;
      return new DocxLib.TableRow({
        children: cells.map((cell) => {
          const cellBlocks = scanBlocks(DocxLib, cell);
          return new DocxLib.TableCell({
            children: cellBlocks.length ? cellBlocks : [new DocxLib.Paragraph({})],
            columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
            width: { size: Math.round(100 / cells.length), type: DocxLib.WidthType.PERCENTAGE },
          });
        }),
      });
    })
    .filter(Boolean);
  if (!docRows.length) return null;
  return new DocxLib.Table({ rows: docRows, width: { size: 100, type: DocxLib.WidthType.PERCENTAGE } });
}

// Percorre os filhos diretos de um container (o editor inteiro, ou o
// conteúdo de uma célula de tabela): elementos de bloco viram parágrafos
// próprios, tabelas viram Table de verdade, e texto/inline soltos (ex: a
// primeira linha antes do primeiro Enter) são agrupados num parágrafo
// implícito. Devolve uma lista mista de Paragraph e Table, na ordem em que
// apareceram — é isso que sections[0].children (ou os children de uma
// TableCell) aceitam.
function scanBlocks(DocxLib, containerEl) {
  const blocks = [];
  let pending = [];
  // Uma quebra de página manual (marcador .word-page-break) não é conteúdo
  // — ela só marca o PRÓXIMO bloco de verdade com pageBreakBefore.
  let breakPending = false;
  function flushPending() {
    if (!pending.length) return;
    const wrapper = document.createElement('p');
    pending.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
    const extra = breakPending ? { pageBreakBefore: true } : {};
    breakPending = false;
    blocks.push(...blockToParagraphs(DocxLib, wrapper, extra));
    pending = [];
  }
  containerEl.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('word-page-break')) {
      flushPending(); // conteúdo solto ANTES da quebra não deve herdar a quebra
      breakPending = true;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'table') {
      flushPending();
      const table = tableToDocxTable(DocxLib, node);
      if (table) blocks.push(table);
      breakPending = false; // quebra antes de uma tabela não é suportada nesta versão
    } else if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      flushPending();
      const extra = breakPending ? { pageBreakBefore: true } : {};
      breakPending = false;
      blocks.push(...blockToParagraphs(DocxLib, node, extra));
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      // espaço em branco solto entre blocos (comum em HTML colado de fora) nunca é conteúdo real
    } else {
      pending.push(node);
    }
  });
  flushPending();
  return blocks;
}

async function editorToDocxDataUrl(DocxLib, editorEl, pageSetup = {}) {
  const { marginPreset = 'normal', headerText = '', footerText = '', pageNumberEnabled = false } = pageSetup;
  const blocks = scanBlocks(DocxLib, editorEl);
  if (!blocks.length) blocks.push(new DocxLib.Paragraph({}));
  const margin = MARGIN_PRESETS[marginPreset] || MARGIN_PRESETS.normal;

  const footerRuns = [];
  if (footerText) footerRuns.push(new DocxLib.TextRun(pageNumberEnabled ? `${footerText}  ` : footerText));
  // PageNumber.CURRENT/TOTAL_PAGES viram campos de verdade no .docx — o
  // Word/LibreOffice de verdade calcula e atualiza os números sozinho ao
  // abrir/paginar o arquivo; não é um número fixo escrito aqui.
  if (pageNumberEnabled) {
    footerRuns.push(new DocxLib.TextRun({ children: ['Página ', DocxLib.PageNumber.CURRENT, ' de ', DocxLib.PageNumber.TOTAL_PAGES] }));
  }

  const documentDef = new DocxLib.Document({
    numbering: {
      config: [{
        reference: NUMBERING_REF,
        levels: [{ level: 0, format: DocxLib.LevelFormat.DECIMAL, text: '%1.', alignment: DocxLib.AlignmentType.START }],
      }],
    },
    sections: [{
      properties: {
        page: { margin: { top: pxToTwips(margin.v), bottom: pxToTwips(margin.v), left: pxToTwips(margin.h), right: pxToTwips(margin.h) } },
      },
      headers: headerText
        ? { default: new DocxLib.Header({ children: [new DocxLib.Paragraph({ children: [new DocxLib.TextRun(headerText)] })] }) }
        : undefined,
      footers: (footerText || pageNumberEnabled)
        ? { default: new DocxLib.Footer({ children: [new DocxLib.Paragraph({ children: footerRuns, alignment: DocxLib.AlignmentType.CENTER })] }) }
        : undefined,
      children: blocks,
    }],
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
      <span class="word-sep"></span>
      <button data-action="insert-image" title="Inserir imagem">🖼️ Imagem</button>
      <button data-action="insert-table" title="Inserir tabela">▦ Tabela</button>
      <button data-action="table-add-row" title="Adicionar linha abaixo">➕ Linha</button>
      <button data-action="table-add-col" title="Adicionar coluna à direita">➕ Coluna</button>
      <button data-action="table-del-row" title="Excluir linha atual">➖ Linha</button>
      <button data-action="table-del-col" title="Excluir coluna atual">➖ Coluna</button>
      <span class="word-sep"></span>
      <select data-role="margins" title="Margens da página" aria-label="Margens da página">
        <option value="normal">Margens: Normal</option>
        <option value="narrow">Margens: Estreita</option>
        <option value="wide">Margens: Larga</option>
      </select>
      <button data-action="insert-page-break" title="Inserir quebra de página">⤓ Quebra de página</button>
      <input type="file" data-role="import-input" accept=".docx" class="hidden">
      <input type="file" data-role="image-input" accept="image/*" class="hidden">
    </div>
    <div class="word-page-wrap">
      <div class="word-page-sheet">
        <input type="text" class="word-header-input" data-role="header" placeholder="Cabeçalho (opcional)">
        <div class="word-page" contenteditable="true" spellcheck="true"></div>
        <div class="word-footer-row">
          <input type="text" class="word-footer-input" data-role="footer" placeholder="Rodapé (opcional)">
          <label class="word-page-number-toggle"><input type="checkbox" data-role="page-number-toggle"> Nº de página</label>
        </div>
      </div>
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
  const sheet = root.querySelector('.word-page-sheet');
  const status = root.querySelector('[data-role="status"]');
  const importInput = root.querySelector('[data-role="import-input"]');
  const headerInput = root.querySelector('[data-role="header"]');
  const footerInput = root.querySelector('[data-role="footer"]');
  const pageNumberToggle = root.querySelector('[data-role="page-number-toggle"]');
  const marginsSelect = root.querySelector('[data-role="margins"]');
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

    // Botões de linha/coluna só fazem sentido com o cursor dentro de uma
    // tabela — igual ao Word de verdade, que esconde/desabilita a faixa de
    // ferramentas de tabela fora dela.
    const insideTable = !!currentTableCell();
    ['table-add-row', 'table-add-col', 'table-del-row', 'table-del-col'].forEach((action) => {
      const btn = root.querySelector(`[data-action="${action}"]`);
      if (btn) btn.disabled = !insideTable;
    });
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

  // ---------------- Imagens ----------------
  // Mesmo cuidado de posição do cursor que a inserção de tabela: o seletor
  // de arquivo do sistema também rouba o foco da página, então a posição é
  // capturada no clique do botão (antes de abrir o seletor) e restaurada só
  // depois que o arquivo escolhido termina de ser lido.
  let savedImageRange = null;
  const imageInput = root.querySelector('[data-role="image-input"]');
  root.querySelector('[data-action="insert-image"]').addEventListener('click', () => {
    savedImageRange = captureEditorRange();
    imageInput.click();
  });
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await blobToDataUrl(file);
    editor.focus();
    restoreEditorRange(savedImageRange);
    document.execCommand('insertImage', false, dataUrl);
    markDirty();
  });

  // ---------------- Tabelas ----------------
  // Cada célula recém-criada guarda um parágrafo vazio de verdade (<p><br>)
  // em vez de ficar completamente vazia — contenteditable se comporta mal
  // (cursor não entra, Enter faz coisa estranha) numa célula sem nenhum nó
  // de bloco dentro.
  function buildTableCell() {
    const cell = document.createElement('td');
    cell.innerHTML = '<p><br></p>';
    return cell;
  }
  function buildTableElement(rows, cols) {
    const table = document.createElement('table');
    table.className = 'word-table';
    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(buildTableCell());
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
  function placeCursorIn(el, atStart = true) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(atStart);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Inserir imagem/tabela sempre passa por um diálogo ou seletor de arquivo
  // no meio do caminho — e isso rouba o foco da página. Focar o editor de
  // novo depois, sem mais nada, faz o navegador colocar o cursor de volta
  // no INÍCIO do documento em vez de onde a pessoa realmente estava editando
  // (perda de posição clássica de contenteditable). Por isso a posição é
  // capturada ANTES de abrir o diálogo e restaurada explicitamente depois,
  // ao contrário de simplesmente reler a seleção atual nesse momento.
  function captureEditorRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
    return null;
  }
  function restoreEditorRange(savedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRange && editor.contains(savedRange.startContainer)) {
      sel.addRange(savedRange);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.addRange(range);
  }
  // Sobe da posição do cursor até achar o filho DIRETO do editor que contém
  // esse ponto — é em relação a esse nó (não à posição exata dentro dele)
  // que a tabela é inserida como irmã, nunca como filha. Sem isso, o cursor
  // parado dentro de um <p> vazio (o que sobra depois de um Enter) faz
  // range.insertNode() botar a tabela DENTRO desse parágrafo em vez de ao
  // lado dele — <table> aninhado num <p> é HTML inválido e visualmente
  // aparecia fora de ordem.
  function topLevelNodeAtCursor() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (!editor.contains(node)) return null;
    while (node.parentNode !== editor) {
      node = node.parentNode;
      if (!node) return null;
    }
    return node;
  }
  function currentTableCell() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !editor.contains(node)) return null;
    return node.closest ? node.closest('td, th') : null;
  }

  root.querySelector('[data-action="insert-table"]').addEventListener('click', async () => {
    const savedRange = captureEditorRange();
    const spec = await showPrompt('Tamanho da tabela (linhas x colunas):', '3x3', { title: 'Inserir tabela', container: win.el });
    if (!spec) return;
    const m = spec.match(/(\d+)\s*[x×]\s*(\d+)/i);
    const rows = Math.min(Math.max(parseInt(m?.[1] ?? '3', 10) || 3, 1), 20);
    const cols = Math.min(Math.max(parseInt(m?.[2] ?? '3', 10) || 3, 1), 10);
    editor.focus();
    restoreEditorRange(savedRange);
    const table = buildTableElement(rows, cols);
    const after = document.createElement('p');
    after.innerHTML = '<br>';
    const anchor = topLevelNodeAtCursor();
    if (anchor) {
      anchor.after(table);
    } else {
      editor.appendChild(table);
    }
    table.after(after);
    placeCursorIn(table.querySelector('td, th'));
    markDirty();
    refreshToolbarState();
  });

  root.querySelector('[data-action="table-add-row"]').addEventListener('click', () => {
    const cell = currentTableCell();
    const row = cell?.closest('tr');
    if (!row) return;
    const newRow = document.createElement('tr');
    for (let c = 0; c < row.children.length; c++) newRow.appendChild(buildTableCell());
    row.after(newRow);
    markDirty();
    refreshToolbarState();
  });
  root.querySelector('[data-action="table-add-col"]').addEventListener('click', () => {
    const cell = currentTableCell();
    const table = cell?.closest('table');
    if (!cell || !table) return;
    const colIndex = Array.from(cell.parentElement.children).indexOf(cell);
    table.querySelectorAll('tr').forEach((tr) => {
      const ref = tr.children[colIndex];
      const newCell = buildTableCell();
      if (ref) ref.after(newCell); else tr.appendChild(newCell);
    });
    markDirty();
    refreshToolbarState();
  });
  root.querySelector('[data-action="table-del-row"]').addEventListener('click', () => {
    const cell = currentTableCell();
    const row = cell?.closest('tr');
    const table = row?.closest('table');
    if (!row || !table) return;
    if (table.querySelectorAll('tr').length <= 1) table.remove();
    else row.remove();
    markDirty();
    refreshToolbarState();
  });
  root.querySelector('[data-action="table-del-col"]').addEventListener('click', () => {
    const cell = currentTableCell();
    const table = cell?.closest('table');
    if (!cell || !table) return;
    const colIndex = Array.from(cell.parentElement.children).indexOf(cell);
    const rows = table.querySelectorAll('tr');
    if (rows[0].children.length <= 1) { table.remove(); markDirty(); refreshToolbarState(); return; }
    rows.forEach((tr) => tr.children[colIndex]?.remove());
    markDirty();
    refreshToolbarState();
  });

  // Tab dentro de uma célula pula pra próxima (Shift+Tab pra anterior), como
  // no Word de verdade — sem isso o Tab do navegador sairia do editor
  // inteiro em vez de navegar entre células.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const cell = currentTableCell();
    if (!cell) return;
    e.preventDefault();
    const table = cell.closest('table');
    let cells = Array.from(table.querySelectorAll('td, th'));
    const idx = cells.indexOf(cell);
    let target;
    if (e.shiftKey) {
      target = cells[idx - 1];
    } else if (idx === cells.length - 1) {
      const row = cell.closest('tr');
      const newRow = document.createElement('tr');
      for (let c = 0; c < row.children.length; c++) newRow.appendChild(buildTableCell());
      row.after(newRow);
      cells = Array.from(table.querySelectorAll('td, th'));
      target = cells[idx + 1];
    } else {
      target = cells[idx + 1];
    }
    if (target) placeCursorIn(target);
    markDirty();
  });

  // ---------------- Layout da página (margens, cabeçalho/rodapé, quebra) ----------------
  // Margens/cabeçalho/rodapé/nº de página não sobrevivem a reabrir um .docx
  // (o mammoth foca em conteúdo, não em layout de página) — cada documento
  // recém-aberto ou criado volta pro padrão "Normal" sem cabeçalho/rodapé,
  // igual à exportação em si: real na hora de salvar, mas não fingimos ler
  // de volta o que não temos como ler de verdade.
  function applyMargins() {
    const preset = MARGIN_PRESETS[marginsSelect.value] || MARGIN_PRESETS.normal;
    editor.style.padding = `${preset.v}px ${preset.h}px`;
  }
  applyMargins();
  marginsSelect.addEventListener('change', () => { applyMargins(); markDirty(); });
  headerInput.addEventListener('input', markDirty);
  footerInput.addEventListener('input', markDirty);
  pageNumberToggle.addEventListener('change', markDirty);

  function buildPageBreakMarker() {
    const marker = document.createElement('div');
    marker.className = 'word-page-break';
    marker.contentEditable = 'false';
    marker.textContent = 'Quebra de página';
    return marker;
  }
  root.querySelector('[data-action="insert-page-break"]').addEventListener('click', () => {
    editor.focus();
    const marker = buildPageBreakMarker();
    const anchor = topLevelNodeAtCursor();
    const after = document.createElement('p');
    after.innerHTML = '<br>';
    if (anchor) {
      anchor.after(marker);
    } else {
      editor.appendChild(marker);
    }
    marker.after(after);
    placeCursorIn(after, true);
    markDirty();
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

  function resetPageSetup() {
    marginsSelect.value = 'normal';
    applyMargins();
    headerInput.value = '';
    footerInput.value = '';
    pageNumberToggle.checked = false;
  }

  async function loadFile(id) {
    const node = await fs.getNode(id);
    if (!node) return;
    currentFileId = id;
    status.dataset.name = node.name;
    resetPageSetup();
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

  function currentPageSetup() {
    return {
      marginPreset: marginsSelect.value,
      headerText: headerInput.value.trim(),
      footerText: footerInput.value.trim(),
      pageNumberEnabled: pageNumberToggle.checked,
    };
  }

  async function saveCurrent() {
    if (!currentFileId) return saveAs();
    const { DocxLib } = await ensureLibs();
    const dataUrl = await editorToDocxDataUrl(DocxLib, editor, currentPageSetup());
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
    const dataUrl = await editorToDocxDataUrl(DocxLib, editor, currentPageSetup());
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
    resetPageSetup();
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
    resetPageSetup();
    dirty = true;
    updateTitle();
    updateWordCount();
    ctx.notify?.({ appId: 'word', icon: '📘', title: 'Documento importado', body: `${file.name} — use "Salvar como" para guardar aqui dentro.` });
  });

  if (currentFileId) loadFile(currentFileId);
  else updateWordCount();

  return win;
}
