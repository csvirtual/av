// Apresentação: slides com título/corpo editáveis, modo de apresentação em
// tela cheia, gerando e lendo arquivos .pptx de verdade.
//   - Geração real via pptxgenjs (biblioteca de terceiros vendorizada em
//     desktop/vendor/pptxgenjs, carregada só quando o app abre) — um slide
//     criado aqui e baixado pelo Explorador já abre de verdade no
//     PowerPoint/LibreOffice Impress/Google Slides.
//   - Leitura de um .pptx existente é feita por um leitor próprio (não tem
//     biblioteca de leitura de pptx pronta e mantida pro navegador, como
//     existe pro .docx): usa o JSZip (que já vem dentro do bundle do
//     pptxgenjs) pra abrir o .pptx como zip e ler o XML de cada slide.
//     Limitação real: extrai texto (título/corpo) e negrito, mas não
//     imagens, posições exatas ou formatação avançada — um "best effort"
//     de importação, não um leitor completo de OOXML.
export const PRESENTATION_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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
    libsPromise = loadScript(new URL('../vendor/pptxgenjs/pptxgen.bundle.js', import.meta.url).href)
      .then(() => ({ PptxGenJS: window.PptxGenJS, JSZip: window.JSZip }));
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

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// O corpo do slide é guardado como o innerHTML bruto do contenteditable (pra
// preservar negrito/itálico/sublinhado/listas do jeito que o usuário
// digitou). Diferente do Word, aqui isso volta pra tela via innerHTML em
// cada troca de slide e no modo apresentar — então, se alguém colar HTML malicioso
// (ex: <img onerror=...>) direto no corpo, precisa ser limpo antes de
// guardar, senão o payload voltaria a disparar toda vez que o slide for
// exibido de novo.
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

function emptySlide() {
  return { title: '', bodyHtml: '<p></p>', bg: '#ffffff' };
}

// ---------- Corpo do slide (contenteditable) -> runs do pptxgenjs ----------
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3']);

function runsFromInline(node, base = {}) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) runs.push({ text: child.textContent, options: { ...base } });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    const next = { ...base };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = { style: 'sng' };
    runs.push(...runsFromInline(child, next));
  });
  return runs;
}

function blockToRuns(el, isBullet) {
  const blockRuns = runsFromInline(el);
  if (!blockRuns.length) blockRuns.push({ text: '', options: {} });
  blockRuns.forEach((run, i) => {
    run.options.breakLine = i === blockRuns.length - 1;
    if (isBullet && i === 0) run.options.bullet = true;
  });
  return blockRuns;
}

// Percorre os filhos diretos do corpo: <ul>/<ol> viram um "run" por <li>,
// outros elementos de bloco (p/div/h1-h3) viram seu próprio "run", e
// texto/inline soltos (ex: a primeira linha antes do primeiro Enter, como
// "Texto <b>em negrito</b>" direto sob o body) são agrupados num parágrafo
// implícito — mesmo problema já resolvido no word.js: sem isso, um texto
// digitado antes de qualquer Enter simplesmente desaparecia do .pptx
// exportado, porque não é filho-elemento nenhum do body, só texto solto.
function bodyHtmlToPptxRuns(bodyEl) {
  const runs = [];
  let pending = [];
  function flushPending() {
    if (!pending.length) return;
    const wrapper = document.createElement('p');
    pending.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
    runs.push(...blockToRuns(wrapper, false));
    pending = [];
  }
  bodyEl.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'UL' || node.tagName === 'OL')) {
      flushPending();
      Array.from(node.children).forEach((li) => { if (li.tagName === 'LI') runs.push(...blockToRuns(li, true)); });
    } else if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      flushPending();
      runs.push(...blockToRuns(node, false));
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      // espaço em branco solto entre blocos — nunca é conteúdo real
    } else {
      pending.push(node);
    }
  });
  flushPending();
  return runs.length ? runs : [{ text: '', options: {} }];
}

async function slidesToPptxDataUrl(PptxGenJS, slides) {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'WIDE', width: 10, height: 5.63 });
  pres.layout = 'WIDE';
  slides.forEach((slide) => {
    const s = pres.addSlide();
    s.background = { color: (slide.bg || '#ffffff').replace('#', '') };
    if (slide.title) {
      s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 1, fontSize: 28, bold: true, color: '1a1a1a' });
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = slide.bodyHtml || '';
    const runs = bodyHtmlToPptxRuns(wrapper);
    if (runs.some((r) => r.text.trim())) {
      s.addText(runs, { x: 0.5, y: 1.5, w: 9, h: 3.8, fontSize: 18, color: '333333', valign: 'top' });
    }
  });
  const blob = await pres.write({ outputType: 'blob' });
  return blobToDataUrl(blob);
}

// ---------- Leitura best-effort de .pptx existente ----------
// Texto puro de um parágrafo (pra título — guardado sem escapar, do mesmo
// jeito que um título digitado na hora vira texto puro via .textContent).
function plainTextOfRuns(runEls) {
  return Array.from(runEls).map((r) => r.getElementsByTagNameNS('*', 't')[0]?.textContent || '').join('');
}
// HTML de um parágrafo (pro corpo — aqui sim precisa escapar antes de
// misturar com as tags <b> de negrito, já que isso vira innerHTML depois).
function htmlOfRuns(runEls) {
  return Array.from(runEls).map((r) => {
    const t = r.getElementsByTagNameNS('*', 't')[0]?.textContent || '';
    const rPr = r.getElementsByTagNameNS('*', 'rPr')[0];
    const bold = rPr?.getAttribute('b') === '1';
    return t ? (bold ? `<b>${escapeHtml(t)}</b>` : escapeHtml(t)) : '';
  }).join('');
}

// Um .pptx real marca o título via um placeholder de verdade
// (<p:ph type="title">), mas o addText() simples do pptxgenjs (usado pra
// gerar os nossos próprios arquivos) não cria placeholder nenhum — só uma
// caixa de texto comum. Detectar por placeholder deixaria nossos próprios
// arquivos sem título nenhum ao reabrir. Como tanto o PowerPoint quanto o
// pptxgenjs colocam a forma do título primeiro no XML do slide, usar "a
// primeira forma com texto é o título" funciona pros dois casos.
function parseSlideXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const shapes = Array.from(doc.getElementsByTagNameNS('*', 'sp'));
  let title = '';
  let titleSet = false;
  const bodyParas = [];
  shapes.forEach((sp) => {
    const paragraphs = Array.from(sp.getElementsByTagNameNS('*', 'p'));
    if (!titleSet) {
      const plainLines = paragraphs
        .map((p) => plainTextOfRuns(p.getElementsByTagNameNS('*', 'r')))
        .filter((line) => line.trim() !== '');
      if (plainLines.length) {
        title = plainLines.join(' ');
        titleSet = true;
        return;
      }
    }
    const htmlLines = paragraphs
      .map((p) => htmlOfRuns(p.getElementsByTagNameNS('*', 'r')))
      .filter((line) => line.trim() !== '');
    bodyParas.push(...htmlLines);
  });
  return {
    title,
    bodyHtml: bodyParas.length ? bodyParas.map((l) => `<p>${l}</p>`).join('') : '<p></p>',
    bg: '#ffffff',
  };
}

async function pptxArrayBufferToSlides(JSZip, arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));
  const slides = [];
  for (const name of slideFiles) {
    slides.push(parseSlideXml(await zip.files[name].async('text')));
  }
  return slides.length ? slides : [emptySlide()];
}

export function openPresentation(ctx, { fileId = null } = {}) {
  const { fs, seed, windows } = ctx;
  let currentFileId = fileId;
  let dirty = false;
  let libs = null;
  let slides = [emptySlide()];
  let currentIndex = 0;

  const root = document.createElement('div');
  root.className = 'pres-app';
  root.innerHTML = `
    <div class="pres-toolbar">
      <button data-action="new" title="Nova apresentação">📄 Novo</button>
      <button data-action="save" title="Salvar">💾 Salvar</button>
      <button data-action="save-as" title="Salvar como">💾 Salvar como</button>
      <button data-action="import" title="Importar .pptx do computador">📥 Importar .pptx</button>
      <span class="pres-sep"></span>
      <button data-cmd="bold" title="Negrito"><b>B</b></button>
      <button data-cmd="italic" title="Itálico"><i>I</i></button>
      <button data-cmd="underline" title="Sublinhado"><u>S</u></button>
      <button data-cmd="insertUnorderedList" title="Lista com marcadores">• Lista</button>
      <span class="pres-sep"></span>
      <label class="pres-bg-label">Fundo <input type="color" data-role="bg-color" value="#ffffff"></label>
      <span class="pres-toolbar-spacer"></span>
      <button data-action="present" title="Apresentar (tela cheia)">▶ Apresentar</button>
      <input type="file" data-role="import-input" accept=".pptx" class="hidden">
    </div>
    <div class="pres-body">
      <div class="pres-sidebar">
        <div class="pres-slide-list" data-role="slide-list"></div>
        <button class="pres-add-slide" data-action="add-slide">+ Novo slide</button>
      </div>
      <div class="pres-editor-wrap">
        <div class="pres-slide-canvas" data-role="canvas">
          <div class="pres-slide-title" contenteditable="true" data-role="title" placeholder="Título do slide"></div>
          <div class="pres-slide-body" contenteditable="true" data-role="body"></div>
        </div>
      </div>
    </div>
    <div class="pres-status" data-role="status">Nova apresentação</div>
    <div class="pres-present hidden" data-role="present-overlay">
      <div class="pres-present-slide" data-role="present-slide"></div>
      <button class="pres-present-exit" data-action="exit-present" title="Sair (Esc)">✕</button>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'presentation',
    title: 'Apresentação',
    icon: '📙',
    width: 860,
    height: 600,
    content: root,
  });

  const slideListEl = root.querySelector('[data-role="slide-list"]');
  const titleEl = root.querySelector('[data-role="title"]');
  const bodyEl = root.querySelector('[data-role="body"]');
  const canvasEl = root.querySelector('[data-role="canvas"]');
  const bgColorEl = root.querySelector('[data-role="bg-color"]');
  const status = root.querySelector('[data-role="status"]');
  const importInput = root.querySelector('[data-role="import-input"]');
  const presentOverlay = root.querySelector('[data-role="present-overlay"]');
  const presentSlideEl = root.querySelector('[data-role="present-slide"]');
  document.execCommand('defaultParagraphSeparator', false, 'p');

  function updateTitle() {
    const name = status.dataset.name || 'Nova apresentação';
    win.setTitle(`${dirty ? '● ' : ''}${name} - Apresentação`);
    status.textContent = status.dataset.name ? `Salvo em Documentos › ${status.dataset.name}` : 'Nova apresentação';
  }
  function markDirty() { dirty = true; updateTitle(); }

  function renderSlideList() {
    slideListEl.innerHTML = '';
    slides.forEach((slide, i) => {
      const item = document.createElement('div');
      item.className = 'pres-thumb' + (i === currentIndex ? ' active' : '');
      item.style.background = slide.bg || '#ffffff';
      item.innerHTML = `
        <span class="pres-thumb-num">${i + 1}</span>
        <span class="pres-thumb-title">${escapeHtml(slide.title || 'Sem título')}</span>
        <div class="pres-thumb-actions">
          <button data-i="${i}" data-thumb-action="up" title="Mover para cima">↑</button>
          <button data-i="${i}" data-thumb-action="down" title="Mover para baixo">↓</button>
          <button data-i="${i}" data-thumb-action="delete" title="Excluir slide">🗑️</button>
        </div>
      `;
      item.addEventListener('click', (e) => { if (!e.target.closest('button')) selectSlide(i); });
      slideListEl.appendChild(item);
    });
    slideListEl.querySelectorAll('[data-thumb-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(btn.dataset.i);
        const action = btn.dataset.thumbAction;
        if (action === 'up' && i > 0) { [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; currentIndex = i - 1; }
        else if (action === 'down' && i < slides.length - 1) { [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]]; currentIndex = i + 1; }
        else if (action === 'delete') {
          if (slides.length <= 1) { slides = [emptySlide()]; currentIndex = 0; }
          else { slides.splice(i, 1); currentIndex = Math.min(currentIndex, slides.length - 1); }
        }
        markDirty();
        renderSlideList();
        loadSlideIntoEditor();
      });
    });
  }

  function saveEditorIntoSlide() {
    const slide = slides[currentIndex];
    if (!slide) return;
    slide.title = titleEl.textContent.trim();
    slide.bodyHtml = sanitizeHtml(bodyEl.innerHTML);
    slide.bg = bgColorEl.value;
  }
  function loadSlideIntoEditor() {
    const slide = slides[currentIndex];
    if (!slide) return;
    titleEl.textContent = slide.title || '';
    bodyEl.innerHTML = slide.bodyHtml || '<p></p>';
    bgColorEl.value = slide.bg || '#ffffff';
    canvasEl.style.background = slide.bg || '#ffffff';
  }
  function selectSlide(i) {
    saveEditorIntoSlide();
    currentIndex = i;
    loadSlideIntoEditor();
    renderSlideList();
  }

  titleEl.addEventListener('input', () => { saveEditorIntoSlide(); markDirty(); renderSlideList(); });
  bodyEl.addEventListener('input', () => { saveEditorIntoSlide(); markDirty(); });
  bgColorEl.addEventListener('input', () => {
    canvasEl.style.background = bgColorEl.value;
    saveEditorIntoSlide();
    markDirty();
    renderSlideList();
  });
  root.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bodyEl.focus();
      document.execCommand(btn.dataset.cmd);
      saveEditorIntoSlide();
      markDirty();
    });
  });
  root.querySelector('[data-action="new"]').addEventListener('click', () => {
    if (dirty && !confirm('Descartar alterações não salvas?')) return;
    currentFileId = null;
    slides = [emptySlide()];
    currentIndex = 0;
    delete status.dataset.name;
    dirty = false;
    renderSlideList();
    loadSlideIntoEditor();
    updateTitle();
  });

  root.querySelector('[data-action="add-slide"]').addEventListener('click', () => {
    saveEditorIntoSlide();
    slides.splice(currentIndex + 1, 0, emptySlide());
    currentIndex += 1;
    markDirty();
    renderSlideList();
    loadSlideIntoEditor();
  });

  async function ensureLibs() {
    if (!libs) {
      status.textContent = 'Carregando apresentação…';
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
      slides = [emptySlide()];
    } else if (!node.content.startsWith('data:')) {
      slides = [{ title: node.name.replace(/\.[^.]+$/, ''), bodyHtml: `<p>${escapeHtml(node.content)}</p>`, bg: '#ffffff' }];
    } else {
      try {
        const { JSZip } = await ensureLibs();
        slides = await pptxArrayBufferToSlides(JSZip, dataUrlToArrayBuffer(node.content));
      } catch {
        slides = [emptySlide()];
        status.textContent = `Não foi possível ler "${node.name}" como apresentação (arquivo corrompido ou não é um .pptx de verdade).`;
        currentIndex = 0;
        renderSlideList();
        loadSlideIntoEditor();
        dirty = false;
        return;
      }
    }
    currentIndex = 0;
    renderSlideList();
    loadSlideIntoEditor();
    dirty = false;
    updateTitle();
  }

  async function saveCurrent() {
    if (!currentFileId) return saveAs();
    saveEditorIntoSlide();
    const { PptxGenJS } = await ensureLibs();
    const dataUrl = await slidesToPptxDataUrl(PptxGenJS, slides);
    await fs.updateNode(currentFileId, { content: dataUrl, mimeType: PRESENTATION_MIME });
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }
  async function saveAs() {
    saveEditorIntoSlide();
    let name = prompt('Nome do arquivo:', status.dataset.name || 'Nova Apresentação.pptx');
    if (!name || !name.trim()) return;
    name = name.trim();
    if (!/\.pptx$/i.test(name)) name += '.pptx';
    const { PptxGenJS } = await ensureLibs();
    const dataUrl = await slidesToPptxDataUrl(PptxGenJS, slides);
    const existing = await fs.findChildByName(seed.documentsId, name);
    if (existing) {
      await fs.updateNode(existing.id, { content: dataUrl, mimeType: PRESENTATION_MIME });
      currentFileId = existing.id;
    } else {
      const node = await fs.createNode({ parentId: seed.documentsId, name, type: 'file', content: dataUrl, mimeType: PRESENTATION_MIME });
      currentFileId = node.id;
    }
    status.dataset.name = name;
    dirty = false;
    updateTitle();
    ctx.refreshDesktop();
  }
  root.querySelector('[data-action="save"]').addEventListener('click', saveCurrent);
  root.querySelector('[data-action="save-as"]').addEventListener('click', saveAs);
  root.querySelector('[data-action="import"]').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    if (dirty && !confirm('Descartar alterações não salvas e importar este arquivo?')) return;
    const { JSZip } = await ensureLibs();
    try {
      slides = await pptxArrayBufferToSlides(JSZip, await file.arrayBuffer());
    } catch {
      ctx.notify?.({ appId: 'presentation', icon: '📙', title: 'Falha ao importar', body: `"${file.name}" não pôde ser lido como .pptx.` });
      return;
    }
    currentFileId = null;
    currentIndex = 0;
    status.dataset.name = file.name.replace(/\.pptx$/i, '') + ' (importado).pptx';
    dirty = true;
    renderSlideList();
    loadSlideIntoEditor();
    updateTitle();
    ctx.notify?.({ appId: 'presentation', icon: '📙', title: 'Apresentação importada', body: `${file.name} — use "Salvar como" para guardar aqui dentro.` });
  });

  // ---------------- Modo de apresentação (tela cheia) ----------------
  let presenting = false;
  // Índice próprio, independente do `currentIndex` do editor: apresentar
  // sempre começa do slide 1 (como o F5 do PowerPoint), sem depender de qual
  // slide estava selecionado na barra lateral, e sem alterar essa seleção.
  let presentIndex = 0;
  function renderPresentSlide() {
    const slide = slides[presentIndex];
    presentSlideEl.style.background = slide.bg || '#ffffff';
    presentSlideEl.innerHTML = `<h1>${escapeHtml(slide.title || '')}</h1><div class="pres-present-body">${slide.bodyHtml || ''}</div>`;
  }
  function enterPresent() {
    saveEditorIntoSlide();
    presentIndex = 0;
    presenting = true;
    presentOverlay.classList.remove('hidden');
    renderPresentSlide();
    presentOverlay.requestFullscreen?.().catch(() => {});
  }
  function exitPresent() {
    presenting = false;
    presentOverlay.classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function presentStep(delta) {
    const next = presentIndex + delta;
    if (next < 0 || next >= slides.length) return;
    presentIndex = next;
    renderPresentSlide();
  }
  root.querySelector('[data-action="present"]').addEventListener('click', enterPresent);
  root.querySelector('[data-action="exit-present"]').addEventListener('click', exitPresent);
  presentOverlay.addEventListener('click', (e) => { if (e.target === presentOverlay || e.target === presentSlideEl) presentStep(1); });

  function onKeydown(e) {
    if (presenting) {
      if (e.key === 'Escape') exitPresent();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); presentStep(1); }
      else if (e.key === 'ArrowLeft') presentStep(-1);
      return;
    }
    if (!win.el.classList.contains('focused')) return;
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => window.removeEventListener('keydown', onKeydown));

  renderSlideList();
  loadSlideIntoEditor();
  if (currentFileId) loadFile(currentFileId);
  else updateTitle();

  return win;
}
