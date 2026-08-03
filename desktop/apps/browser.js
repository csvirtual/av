// Navegador: abas, favoritos e histórico reais (persistidos), como um
// navegador de verdade. A maioria dos grandes sites recusa ser incorporada
// direto num iframe de outro domínio (X-Frame-Options/CSP: frame-ancestors)
// — isso é aplicado pelo navegador do visitante antes de qualquer JS nosso
// rodar, então não dá pra contornar por aqui. Por isso toda navegação passa
// por um proxy reverso (netlify/functions/proxy.js) que busca a página no
// servidor, remove esses cabeçalhos e entrega o conteúdo pelo nosso próprio
// domínio. Continua havendo casos reais que não funcionam (sites que exigem
// sessão/login do domínio original, ou SPAs que chamam APIs por caminho
// absoluto fora do domínio) — quando isso acontece mostra um aviso real e o
// botão "Abrir em nova aba" de verdade, em vez de deixar uma página em
// branco sem explicação.
const HOME_URL = 'https://www.wikipedia.org';
const PROXY_ENDPOINT = '/.netlify/functions/proxy';
const MAX_HISTORY = 200;
const LOAD_TIMEOUT_MS = 12000;

// Ícone próprio (esfera azul com onda), no espírito do Microsoft Edge sem
// usar o logo proprietário da Microsoft — mesmo cuidado já tomado com o
// ícone do Disco Local (C:) no Explorador.
export const BROWSER_GLYPH = `<svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
  <defs>
    <linearGradient id="browserGlyphG1" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#37e0ff"/>
      <stop offset="0.55" stop-color="#1a8ef2"/>
      <stop offset="1" stop-color="#0b3fae"/>
    </linearGradient>
    <linearGradient id="browserGlyphG2" x1="6" y1="26" x2="26" y2="6" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0a2f7a"/>
      <stop offset="1" stop-color="#1f6fe0"/>
    </linearGradient>
  </defs>
  <circle cx="16" cy="16" r="15" fill="url(#browserGlyphG1)"/>
  <path d="M7 19.5C9 12 15 8 22 9.5c-6-2.5-14-1-17.5 5C2.5 18.5 4 23 8 24.5 6.7 23 6 21 7 19.5Z" fill="#eaf6ff"/>
  <path d="M25 12.5c-5-2-11 .5-12.5 6.5-1 4 1 8 5.5 8.5 4 .5 8-2 9-6.5 1-4.5-1-9-2-8.5Z" fill="url(#browserGlyphG2)"/>
  <circle cx="22.5" cy="18" r="3.6" fill="#59d9ff"/>
</svg>`;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeUrl(input) {
  const v = (input || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(v)) return `https://${v}`;
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`;
}

function proxiedUrl(target) {
  return `${PROXY_ENDPOINT}?url=${encodeURIComponent(target)}`;
}

function shortTitle(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function openBrowser(ctx, { url } = {}) {
  const { windows, kv } = ctx;

  const root = document.createElement('div');
  root.className = 'browser-app';
  root.innerHTML = `
    <div class="browser-tabbar" data-role="tabbar"></div>
    <div class="browser-toolbar">
      <button data-action="back" title="Voltar (Alt+←)" aria-label="Voltar">←</button>
      <button data-action="forward" title="Avançar (Alt+→)" aria-label="Avançar">→</button>
      <button data-action="reload" title="Recarregar (F5)" aria-label="Recarregar">↻</button>
      <button data-action="star" title="Adicionar aos favoritos" aria-label="Adicionar aos favoritos">☆</button>
      <input type="text" class="browser-address" data-role="address" placeholder="Pesquisar ou digitar um endereço da Web" aria-label="Endereço da web">
      <button data-action="go" title="Ir">Ir</button>
      <button data-action="bookmarks" title="Favoritos" aria-label="Favoritos">⭐</button>
      <button data-action="history" title="Histórico" aria-label="Histórico">🕘</button>
      <button data-action="newtab" title="Abrir numa aba de verdade" aria-label="Abrir numa aba de verdade">⤴</button>
    </div>
    <div class="browser-pages" data-role="pages">
      <div class="browser-status browser-status-loading hidden" data-role="loading">
        <div class="browser-spinner"></div>
        <span>Carregando…</span>
      </div>
      <div class="browser-status browser-status-blocked hidden" data-role="blocked">
        <p>Não foi possível exibir este site aqui dentro (ele pode exigir login, demorou demais para responder, ou aponta pra um endereço bloqueado).</p>
        <button data-action="open-real-tab" class="btn">⤴ Abrir em uma aba de verdade</button>
      </div>
    </div>
    <div class="browser-dropdown hidden" data-role="dropdown"></div>
  `;

  const win = windows.createWindow({
    appId: 'browser',
    title: 'Navegador',
    icon: BROWSER_GLYPH,
    width: 780,
    height: 520,
    content: root,
  });

  const tabbar = root.querySelector('[data-role="tabbar"]');
  const pages = root.querySelector('[data-role="pages"]');
  const address = root.querySelector('[data-role="address"]');
  const starBtn = root.querySelector('[data-action="star"]');
  const backBtn = root.querySelector('[data-action="back"]');
  const forwardBtn = root.querySelector('[data-action="forward"]');
  const dropdown = root.querySelector('[data-role="dropdown"]');
  const loadingEl = root.querySelector('[data-role="loading"]');
  const blockedEl = root.querySelector('[data-role="blocked"]');

  let tabs = [];
  let activeId = null;
  let tabCounter = 0;

  async function getBookmarks() {
    return kv.get('browser.bookmarks', []);
  }
  async function setBookmarks(list) {
    await kv.set('browser.bookmarks', list);
  }
  async function addHistory(pageUrl, title) {
    const list = await kv.get('browser.history', []);
    list.unshift({ url: pageUrl, title, at: Date.now() });
    await kv.set('browser.history', list.slice(0, MAX_HISTORY));
  }

  function activeTab() {
    return tabs.find((t) => t.id === activeId);
  }

  function renderTabbar() {
    tabbar.innerHTML = '';
    tabs.forEach((tab) => {
      const btn = document.createElement('div');
      btn.className = 'browser-tab' + (tab.id === activeId ? ' active' : '');
      btn.innerHTML = `<span class="browser-tab-title">${escapeHtml(tab.title || 'Nova guia')}</span><button class="browser-tab-close" data-id="${tab.id}" aria-label="Fechar aba">✕</button>`;
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.browser-tab-close')) return;
        switchTab(tab.id);
      });
      btn.querySelector('.browser-tab-close').addEventListener('click', () => closeTab(tab.id));
      tabbar.appendChild(btn);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'browser-tab-add';
    addBtn.textContent = '+';
    addBtn.title = 'Nova guia (Ctrl+T)';
    addBtn.setAttribute('aria-label', 'Nova guia');
    addBtn.addEventListener('click', () => createTab(HOME_URL));
    tabbar.appendChild(addBtn);
  }

  async function refreshStarState() {
    const tab = activeTab();
    if (!tab) return;
    const bookmarks = await getBookmarks();
    starBtn.textContent = bookmarks.some((b) => b.url === tab.url) ? '★' : '☆';
  }

  function refreshNavButtons() {
    const tab = activeTab();
    backBtn.disabled = !tab || tab.historyIndex <= 0;
    forwardBtn.disabled = !tab || tab.historyIndex >= tab.history.length - 1;
  }

  // Mostra o estado (carregando/bloqueado/nenhum) só da aba ativa — cada aba
  // tem seu próprio status, já que o usuário pode trocar de aba enquanto
  // outra ainda está carregando.
  function refreshStatusOverlay() {
    const tab = activeTab();
    loadingEl.classList.toggle('hidden', tab?.status !== 'loading');
    blockedEl.classList.toggle('hidden', tab?.status !== 'blocked');
  }

  function setTabStatus(tab, status) {
    tab.status = status;
    if (tab.id === activeId) refreshStatusOverlay();
  }

  function createTab(initialUrl) {
    const id = `tab-${++tabCounter}`;
    const iframe = document.createElement('iframe');
    iframe.className = 'browser-frame hidden';
    iframe.referrerPolicy = 'no-referrer';
    // Sem "allow-same-origin": o conteúdo do site visitado passa a rodar
    // numa origem opaca própria, isolada de verdade da nossa — sem isso, como
    // o proxy serve tudo pelo NOSSO domínio, um site malicioso carregado aqui
    // enxergaria window.parent e o IndexedDB inteiro do app (senha, arquivos
    // de todas as contas) como se fossem dele mesmo. allow-scripts/forms/
    // popups continuam liberados pra sites de verdade funcionarem; sem
    // allow-top-navigation, o site não consegue navegar a janela toda embora.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
    pages.appendChild(iframe);
    const tab = { id, iframe, url: '', title: 'Nova guia', history: [], historyIndex: -1, status: null, loadTimer: null };
    // Com o sandbox acima, o iframe vira cross-origin de verdade — não dá
    // mais pra ler contentDocument direto. O proxy (netlify/functions/
    // proxy.js) injeta um scriptzinho em toda página que passa por ele
    // (inclusive nas próprias páginas de erro do proxy) que manda o título e
    // o status de erro pra cá via postMessage; o listener global registrado
    // mais abaixo (window.addEventListener('message', ...)) recebe e associa
    // à aba certa comparando event.source com o contentWindow do iframe.
    iframe.addEventListener('load', () => {
      clearTimeout(tab.loadTimer);
    });
    tabs.push(tab);
    switchTab(id);
    navigate(initialUrl, true);
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    clearTimeout(tabs[idx].loadTimer);
    tabs[idx].iframe.remove();
    tabs.splice(idx, 1);
    if (!tabs.length) {
      win.close();
      return;
    }
    if (activeId === id) switchTab(tabs[Math.max(0, idx - 1)].id);
    renderTabbar();
  }

  function switchTab(id) {
    activeId = id;
    tabs.forEach((t) => t.iframe.classList.toggle('hidden', t.id !== id));
    const tab = activeTab();
    address.value = tab.url;
    win.setTitle(tab.title ? `${tab.title} - Navegador` : 'Navegador');
    refreshStarState();
    refreshNavButtons();
    refreshStatusOverlay();
    renderTabbar();
  }

  function navigate(input, pushHistory = true) {
    const tab = activeTab();
    if (!tab) return;
    const target = normalizeUrl(input);
    if (!target) return;
    tab.url = target;
    tab.title = shortTitle(target);
    tab.iframe.src = proxiedUrl(target);
    address.value = target;
    win.setTitle(`${tab.title} - Navegador`);
    if (pushHistory) {
      tab.history.splice(tab.historyIndex + 1);
      tab.history.push(target);
      tab.historyIndex = tab.history.length - 1;
    }
    addHistory(target, tab.title);
    refreshStarState();
    refreshNavButtons();
    renderTabbar();

    clearTimeout(tab.loadTimer);
    setTabStatus(tab, 'loading');
    tab.loadTimer = setTimeout(() => {
      // Se o "load" do iframe não disparou a tempo, o site provavelmente
      // recusou ser exibido aqui (ou está fora do ar) — avisa de verdade em
      // vez de deixar uma página em branco sem explicação nenhuma.
      if (tab.status === 'loading') setTabStatus(tab, 'blocked');
    }, LOAD_TIMEOUT_MS);
  }

  function openActiveInRealTab() {
    const tab = activeTab();
    if (tab?.url) window.open(tab.url, '_blank', 'noopener');
  }

  root.querySelector('[data-action="go"]').addEventListener('click', () => navigate(address.value));
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(address.value);
  });
  address.addEventListener('focus', () => address.select());
  root.querySelector('[data-action="reload"]').addEventListener('click', () => {
    const tab = activeTab();
    if (tab) navigate(tab.url, false);
  });
  backBtn.addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.historyIndex > 0) {
      tab.historyIndex--;
      navigate(tab.history[tab.historyIndex], false);
    }
  });
  forwardBtn.addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      navigate(tab.history[tab.historyIndex], false);
    }
  });
  root.querySelector('[data-action="newtab"]').addEventListener('click', openActiveInRealTab);
  blockedEl.querySelector('[data-action="open-real-tab"]').addEventListener('click', openActiveInRealTab);

  root.querySelector('[data-action="star"]').addEventListener('click', async () => {
    const tab = activeTab();
    if (!tab?.url) return;
    const bookmarks = await getBookmarks();
    const idx = bookmarks.findIndex((b) => b.url === tab.url);
    if (idx === -1) bookmarks.unshift({ url: tab.url, title: tab.title });
    else bookmarks.splice(idx, 1);
    await setBookmarks(bookmarks);
    refreshStarState();
  });

  function hideDropdown() {
    dropdown.classList.add('hidden');
  }

  root.querySelector('[data-action="bookmarks"]').addEventListener('click', async () => {
    const bookmarks = await getBookmarks();
    dropdown.innerHTML = `<div class="browser-dropdown-title">Favoritos</div>` + (
      bookmarks.length
        ? bookmarks.map((b) => `<button class="browser-dropdown-item" data-url="${escapeHtml(b.url)}">⭐ ${escapeHtml(b.title)}</button>`).join('')
        : '<div class="browser-dropdown-empty">Nenhum favorito ainda.</div>'
    );
    dropdown.querySelectorAll('[data-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigate(btn.dataset.url);
        hideDropdown();
      });
    });
    dropdown.classList.remove('hidden');
  });

  root.querySelector('[data-action="history"]').addEventListener('click', async () => {
    const history = await kv.get('browser.history', []);
    dropdown.innerHTML = `<div class="browser-dropdown-title">Histórico</div>` + (
      history.length
        ? history.slice(0, 30).map((h) => `<button class="browser-dropdown-item" data-url="${escapeHtml(h.url)}">${escapeHtml(h.title)}</button>`).join('') +
          '<button class="browser-dropdown-item browser-dropdown-clear" data-action="clear-history">🧹 Limpar histórico</button>'
        : '<div class="browser-dropdown-empty">Nenhuma página visitada ainda.</div>'
    );
    dropdown.querySelectorAll('[data-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigate(btn.dataset.url);
        hideDropdown();
      });
    });
    dropdown.querySelector('[data-action="clear-history"]')?.addEventListener('click', async () => {
      await kv.set('browser.history', []);
      hideDropdown();
    });
    dropdown.classList.remove('hidden');
  });

  root.addEventListener('pointerdown', (e) => {
    if (!dropdown.classList.contains('hidden') && !e.target.closest('[data-role="dropdown"]') && !e.target.closest('[data-action="bookmarks"]') && !e.target.closest('[data-action="history"]')) {
      hideDropdown();
    }
  });

  // Atalhos de teclado de um navegador de verdade — só ativos com a janela
  // em foco. Em Ctrl+T/Ctrl+W: como isto roda dentro da aba/janela real do
  // navegador do usuário, esses atalhos só têm efeito quando o app está
  // instalado/rodando em modo standalone (senão o navegador real intercepta
  // antes de chegar aqui — não há como e nem se deve tentar sobrepor isso).
  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'l') { address.focus(); address.select(); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 't') { createTab(HOME_URL); e.preventDefault(); }
    else if (mod && e.key.toLowerCase() === 'w') { closeTab(activeId); e.preventDefault(); }
    else if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') { const t = activeTab(); if (t) navigate(t.url, false); e.preventDefault(); }
    else if (e.altKey && e.key === 'ArrowLeft') { backBtn.click(); e.preventDefault(); }
    else if (e.altKey && e.key === 'ArrowRight') { forwardBtn.click(); e.preventDefault(); }
    else if (mod && e.key === 'Tab') {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
      switchTab(tabs[next].id);
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKeydown);

  // Canal de comunicação com o conteúdo (agora sandboxed/cross-origin) dos
  // iframes: só aceita mensagens cujo `source` seja exatamente o
  // contentWindow de uma aba nossa (comparação de referência de objeto, não
  // depende de checar `origin` — o iframe é de origem opaca mesmo, então
  // `event.origin` viria como a string "null"). Isso garante que só as
  // páginas que ESTE app carregou conseguem falar com este handler, mesmo
  // sem allow-same-origin.
  function onProxyMessage(e) {
    if (!e.data || e.data.source !== 'app-browser-proxy') return;
    const tab = tabs.find((t) => t.iframe.contentWindow === e.source);
    if (!tab) return;
    clearTimeout(tab.loadTimer);
    if (e.data.proxyError) {
      setTabStatus(tab, 'blocked');
      return;
    }
    setTabStatus(tab, null);
    if (e.data.title) {
      tab.title = e.data.title;
      renderTabbar();
      if (tab.id === activeId) win.setTitle(`${tab.title} - Navegador`);
    }
  }
  window.addEventListener('message', onProxyMessage);

  win.onClose(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('message', onProxyMessage);
    tabs.forEach((t) => clearTimeout(t.loadTimer));
  });

  createTab(url || HOME_URL);
  return win;
}
