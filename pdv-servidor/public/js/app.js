// Casca mínima da Fase 9 (interface real) — só o suficiente pra hospedar
// as duas telas já portadas de verdade (Estoque, PDV) contra o servidor
// multi-terminal, com login/logout e troca de rota. NÃO é uma cópia do
// app.js da extensão (menu lateral completo, todas as ~15 rotas, timeout
// de inatividade, trava de aba única etc.) — isso é trabalho de uma fase
// futura, quando as telas restantes forem portadas uma a uma. Por ora,
// prova que a arquitetura funciona com as telas REAIS (não mais
// public/test.html), do mesmo jeito que a Fase 1 provou com Estoque
// sozinho numa telinha de teste.
import { getSessionUserId, setSessionUserId, onSessionUserIdChanged, clearSession } from './session.js';
import { renderProducts } from './views/products.js';
import { renderSale } from './views/sale.js';
import { escapeHtml } from './utils/format.js';

const root = document.getElementById('root');

const ROUTES = {
  estoque: { label: 'Estoque', render: renderProducts },
  venda: { label: 'Nova venda', render: renderSale },
};
const DEFAULT_ROUTE = 'venda';

function currentRouteName() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : DEFAULT_ROUTE;
}

async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  const { user } = await res.json();
  return user;
}

function renderLogin() {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="dot"></span><span>PDV - C&amp;S Virtual (multi-terminal)</span></div>
        <h1>Entrar</h1>
        <p class="subtitle">Informe seu usuário e senha para acessar o sistema.</p>
        <form id="login-form" novalidate>
          <div id="form-error"></div>
          <div class="field">
            <label for="username">Usuário</label>
            <input id="username" autofocus required>
          </div>
          <div class="field">
            <label for="password">Senha</label>
            <input id="password" type="password" required>
          </div>
          <button type="submit" class="btn" style="width:100%;padding:11px;">Entrar</button>
        </form>
      </div>
    </div>
  `;
  const form = document.getElementById('login-form');
  const errBox = document.getElementById('form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Erro ao entrar.');
      await setSessionUserId(body.user.id);
      boot();
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function renderShell(user) {
  const routeName = currentRouteName();
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar" style="display:flex;align-items:center;gap:16px;padding:10px 18px;border-bottom:1px solid var(--border);">
        <strong>PDV - C&amp;S Virtual</strong>
        <nav style="display:flex;gap:8px;">
          ${Object.entries(ROUTES).map(([key, r]) => `
            <a href="#/${key}" class="btn ${key === routeName ? '' : 'btn-ghost'} btn-sm">${r.label}</a>
          `).join('')}
        </nav>
        <span style="margin-left:auto;color:var(--text-muted);font-size:13px;">${escapeHtml(user.nome)} (${user.role === 'admin' ? 'Administrador' : 'Vendedor'})</span>
        <button type="button" class="btn btn-ghost btn-sm" id="logout-btn">Sair</button>
      </header>
      <main id="view-root" style="padding:18px;"></main>
    </div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await clearSession();
    boot();
  });

  const view = ROUTES[routeName];
  const container = document.getElementById('view-root');
  const ctx = { user, navigate: (name) => { location.hash = `#/${name}`; } };
  if (view) {
    view.render(container, ctx);
  } else {
    container.innerHTML = `<div class="card">Tela "${escapeHtml(routeName)}" ainda não foi portada pra este modo multi-terminal.</div>`;
  }
}

let booting = false;
async function boot() {
  if (booting) return; // reentrância (ex: dois eventos de sessão quase juntos) — mesma proteção do app.js da extensão
  booting = true;
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      renderLogin();
      return;
    }
    const user = await fetchCurrentUser();
    if (!user) {
      // Cookie de sessão do servidor não bate mais com o cache local
      // (ex: expirou por inatividade, ou foi limpo direto no servidor) —
      // mesmo tratamento de "sessão inválida" em qualquer um dos dois
      // casos: volta pro login.
      await clearSession();
      renderLogin();
      return;
    }
    renderShell(user);
  } finally {
    booting = false;
  }
}

window.onhashchange = boot;
onSessionUserIdChanged(() => boot());
boot();
