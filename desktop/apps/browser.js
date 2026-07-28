// Navegador: abas, favoritos e histórico reais (persistidos), como um
// navegador de verdade. Limitação inerente à web: como é uma janela dentro
// do próprio site, só consegue exibir páginas que permitem ser incorporadas
// em outro site (a maioria dos grandes bloqueia isso por segurança, ex:
// X-Frame-Options/CSP) — nesse caso, o botão ⤴ abre numa aba de verdade.
const HOME_URL = 'https://www.wikipedia.org';
const MAX_HISTORY = 200;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeUrl(input) {
  const v = (input || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(v)) return `https://${v}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(v)}`;
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
      <button data-action="back" title="Voltar">←</button>
      <button data-action="forward" title="Avançar">→</button>
      <button data-action="reload" title="Recarregar">↻</button>
      <button data-action="star" title="Adicionar aos favoritos">☆</button>
      <input type="text" class="browser-address" data-role="address" placeholder="Pesquisar ou digitar um endereço da Web">
      <button data-action="go" title="Ir">Ir</button>
      <button data-action="bookmarks" title="Favoritos">⭐</button>
      <button data-action="history" title="Histórico">🕘</button>
      <button data-action="newtab" title="Abrir numa aba de verdade">⤴</button>
    </div>
    <div class="browser-hint">Alguns sites bloqueiam ser exibidos dentro de outro app (proteção do próprio site) — use ⤴ pra abrir numa aba de verdade.</div>
    <div class="browser-pages" data-role="pages"></div>
    <div class="browser-dropdown hidden" data-role="dropdown"></div>
  `;

  const win = windows.createWindow({
    appId: 'browser',
    title: 'Navegador',
    icon: '🌐',
    width: 780,
    height: 520,
    content: root,
  });

  const tabbar = root.querySelector('[data-role="tabbar"]');
  const pages = root.querySelector('[data-role="pages"]');
  const address = root.querySelector('[data-role="address"]');
  const starBtn = root.querySelector('[data-action="star"]');
  const dropdown = root.querySelector('[data-role="dropdown"]');

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
      btn.innerHTML = `<span class="browser-tab-title">${escapeHtml(tab.title || 'Nova guia')}</span><button class="browser-tab-close" data-id="${tab.id}">✕</button>`;
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
    addBtn.title = 'Nova guia';
    addBtn.addEventListener('click', () => createTab(HOME_URL));
    tabbar.appendChild(addBtn);
  }

  async function refreshStarState() {
    const tab = activeTab();
    if (!tab) return;
    const bookmarks = await getBookmarks();
    starBtn.textContent = bookmarks.some((b) => b.url === tab.url) ? '★' : '☆';
  }

  function createTab(initialUrl) {
    const id = `tab-${++tabCounter}`;
    const iframe = document.createElement('iframe');
    iframe.className = 'browser-frame hidden';
    iframe.referrerPolicy = 'no-referrer';
    pages.appendChild(iframe);
    const tab = { id, iframe, url: '', title: 'Nova guia', history: [], historyIndex: -1 };
    tabs.push(tab);
    switchTab(id);
    navigate(initialUrl, true);
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
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
    renderTabbar();
  }

  function navigate(input, pushHistory = true) {
    const tab = activeTab();
    if (!tab) return;
    const target = normalizeUrl(input);
    if (!target) return;
    tab.url = target;
    tab.title = shortTitle(target);
    tab.iframe.src = target;
    address.value = target;
    win.setTitle(`${tab.title} - Navegador`);
    if (pushHistory) {
      tab.history.splice(tab.historyIndex + 1);
      tab.history.push(target);
      tab.historyIndex = tab.history.length - 1;
    }
    addHistory(target, tab.title);
    refreshStarState();
    renderTabbar();
  }

  root.querySelector('[data-action="go"]').addEventListener('click', () => navigate(address.value));
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(address.value);
  });
  root.querySelector('[data-action="reload"]').addEventListener('click', () => {
    const tab = activeTab();
    if (tab) tab.iframe.src = tab.iframe.src;
  });
  root.querySelector('[data-action="back"]').addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.historyIndex > 0) {
      tab.historyIndex--;
      navigate(tab.history[tab.historyIndex], false);
    }
  });
  root.querySelector('[data-action="forward"]').addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      navigate(tab.history[tab.historyIndex], false);
    }
  });
  root.querySelector('[data-action="newtab"]').addEventListener('click', () => {
    const tab = activeTab();
    if (tab?.url) window.open(tab.url, '_blank', 'noopener');
  });

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

  createTab(url || HOME_URL);
  return win;
}
