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
export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const strip = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
  (function walk(node) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName.toLowerCase();
      if (strip.includes(tag)) { child.remove(); return; }
      Array.from(child.attributes).forEach((attr) => {
        if (/^on/i.test(attr.name) || (attr.name === 'href' && /^javascript:/i.test(attr.value))) child.removeAttribute(attr.name);
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

// Constrói as "runs" (trechos de texto com formatação) de um elemento
// inline, percorrendo os descendentes e acumulando negrito/itálico/sublinhado
// conforme as tags encontradas (<b>/<strong>, <i>/<em>, <u>).
function runsFromInline(DocxLib, node, base = {}) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) runs.push(new DocxLib.TextRun({ text: child.textContent, bold: base.bold, italics: base.italic, underline: base.underline ? {} : undefined }));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') { runs.push(new DocxLib.TextRun({ break: 1 })); return; }
    const next = { ...base };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;
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
        const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: ['u => u'] });
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
    let name = prompt('Nome do arquivo:', status.dataset.name || 'Novo Documento.docx');
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

  root.querySelector('[data-action="new"]').addEventListener('click', () => {
    if (dirty && !confirm('Descartar alterações não salvas?')) return;
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
    if (dirty && !confirm('Descartar alterações não salvas e importar este arquivo?')) return;
    const { mammoth } = await ensureLibs();
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: ['u => u'] });
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
