// Ponto de entrada do app. Decide qual tela mostrar (setup → login → shell
// principal) e, depois de logado, cuida do roteamento entre as telas do
// sistema (estoque, venda, histórico, usuários, logs, empresa) dentro da
// mesma aba — sem framework, só JS de módulo nativo.
import { isCompanyRegistered, getCompany } from './data/companyRepo.js';
import { hasAnyUser, getUser } from './data/usersRepo.js';
import { getSessionUserId, clearSession } from './session.js';
import { logAction } from './data/auditRepo.js';
import { showToast } from './components/toast.js';
import { confirmDialog } from './components/modal.js';
import { escapeHtml } from './utils/format.js';

import { renderSetup } from './views/setup.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProducts } from './views/products.js';
import { renderSale } from './views/sale.js';
import { renderSalesHistory } from './views/salesHistory.js';
import { renderCaixa } from './views/caixa.js';
import { renderUsers } from './views/users.js';
import { renderLogs } from './views/logs.js';
import { renderCompanySettings } from './views/company.js';
import { renderAjuda } from './views/ajuda.js';

const root = document.getElementById('root');

const ROUTES = {
  dashboard: { label: 'Painel', icon: '🏠', roles: ['admin', 'vendedor'], render: renderDashboard },
  estoque: { label: 'Estoque', icon: '📦', roles: ['admin', 'vendedor'], render: renderProducts },
  venda: { label: 'Nova venda', icon: '🧾', roles: ['admin', 'vendedor'], render: renderSale },
  vendas: { label: 'Histórico de vendas', icon: '📊', roles: ['admin', 'vendedor'], render: renderSalesHistory },
  caixa: { label: 'Caixa', icon: '💰', roles: ['admin', 'vendedor'], render: renderCaixa },
  usuarios: { label: 'Usuários', icon: '👥', roles: ['admin'], render: renderUsers },
  logs: { label: 'Log do sistema', icon: '🗒️', roles: ['admin'], render: renderLogs },
  empresa: { label: 'Dados da loja', icon: '🏬', roles: ['admin'], render: renderCompanySettings },
  ajuda: { label: 'Ajuda', icon: '❓', roles: ['admin', 'vendedor'], render: renderAjuda },
};

async function boot() {
  root.innerHTML = '<div class="boot-loading">Carregando…</div>';

  const [companyRegistered, anyUser] = await Promise.all([isCompanyRegistered(), hasAnyUser()]);
  if (!companyRegistered || !anyUser) {
    renderSetup(root, { onComplete: boot });
    return;
  }

  const company = await getCompany();
  const userId = await getSessionUserId();
  let currentUser = userId ? await getUser(userId) : null;
  if (currentUser && !currentUser.active) currentUser = null;

  if (!currentUser) {
    renderLogin(root, { company, onLogin: () => boot() });
    return;
  }

  renderShell(currentUser, company);
}

function currentRouteKey() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : 'dashboard';
}

function renderShell(user, company) {
  root.innerHTML = `
    <div class="shell">
      <nav class="sidebar">
        <div class="sidebar-brand">
          <div class="name">${escapeHtml(company?.nomeFantasia || 'Gestão de Loja')}</div>
          <div class="sub">${escapeHtml(company?.cnpj || '')}</div>
        </div>
        <div class="nav-group" id="nav-group"></div>
        <div class="sidebar-footer">
          <div class="sidebar-user">${escapeHtml(user.nome)}</div>
          <div class="sidebar-role">${user.role === 'admin' ? 'Administrador geral' : 'Vendedor'}</div>
          <button class="btn btn-secondary btn-sm" id="logout-btn" style="width:100%;">Sair</button>
        </div>
      </nav>
      <main class="main" id="main-content"></main>
    </div>
  `;

  const navGroup = document.getElementById('nav-group');
  navGroup.innerHTML = Object.entries(ROUTES)
    .filter(([, route]) => route.roles.includes(user.role))
    .map(([key, route]) => `
      <button class="nav-link" data-route="${key}">
        <span class="nav-icon">${route.icon}</span> ${route.label}
      </button>
    `).join('');

  navGroup.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; });
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sair do sistema', message: 'Deseja encerrar sua sessão?', confirmLabel: 'Sair' });
    if (!ok) return;
    await logAction({
      userId: user.id, userName: user.nome, role: user.role,
      action: 'Logout', details: `Logout realizado por "${user.nome}".`, entity: 'auth', entityId: user.id,
    });
    await clearSession();
    showToast('Sessão encerrada.', 'info');
    boot();
  });

  const ctx = {
    user,
    company,
    navigate: (key) => { location.hash = `#/${key}`; },
    refreshShell: async () => {
      const freshCompany = await getCompany();
      renderShell(user, freshCompany);
    },
  };

  function renderCurrentRoute() {
    const key = currentRouteKey();
    const route = ROUTES[key];
    navGroup.querySelectorAll('.nav-link').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.route === key);
    });
    if (!route.roles.includes(user.role)) {
      document.getElementById('main-content').innerHTML = '<div class="card">Você não tem permissão para acessar esta tela.</div>';
      return;
    }
    const container = document.getElementById('main-content');
    container.innerHTML = '';
    route.render(container, ctx);
  }

  window.onhashchange = renderCurrentRoute;
  if (!location.hash) location.hash = '#/dashboard';
  else renderCurrentRoute();
}

boot();
