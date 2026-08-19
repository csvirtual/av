// Ponto de entrada do app. Decide qual tela mostrar (setup → login → shell
// principal) e, depois de logado, cuida do roteamento entre as telas do
// sistema (estoque, venda, histórico, usuários, logs, empresa) dentro da
// mesma aba — sem framework, só JS de módulo nativo.
import { isCompanyRegistered, getCompany } from './data/companyRepo.js';
import { hasAnyUser, getUser } from './data/usersRepo.js';
import { getSessionUserId, clearSession, onSessionUserIdChanged } from './session.js';
import { logAction } from './data/auditRepo.js';
import { showToast } from './components/toast.js';
import { confirmDialog, closeAllModals } from './components/modal.js';
import { escapeHtml } from './utils/format.js';
import { getThemePreference, applyTheme } from './theme.js';

import { renderSetup } from './views/setup.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProducts } from './views/products.js';
import { renderSale } from './views/sale.js';
import { renderSalesHistory } from './views/salesHistory.js';
import { renderCaixa } from './views/caixa.js';
import { renderClientes } from './views/clientes.js';
import { renderCompras } from './views/compras.js';
import { renderFinanceiro } from './views/financeiro.js';
import { renderRelatorios } from './views/relatorios.js';
import { renderUsers } from './views/users.js';
import { renderLogs } from './views/logs.js';
import { renderCompanySettings } from './views/company.js';
import { renderAjuda } from './views/ajuda.js';
import { renderPersonalizacao } from './views/personalizacao.js';
import { renderBackup } from './views/backup.js';
import { renderCarreto } from './views/carreto.js';

const root = document.getElementById('root');

const ROUTES = {
  dashboard: { label: 'Painel', icon: '🏠', roles: ['admin', 'vendedor'], render: renderDashboard },
  estoque: { label: 'Estoque', icon: '📦', roles: ['admin', 'vendedor'], render: renderProducts },
  venda: { label: 'Nova venda', icon: '🧾', roles: ['admin', 'vendedor'], render: renderSale },
  vendas: { label: 'Histórico de vendas', icon: '📊', roles: ['admin', 'vendedor'], render: renderSalesHistory },
  caixa: { label: 'Caixa', icon: '💰', roles: ['admin', 'vendedor'], render: renderCaixa },
  clientes: { label: 'Clientes', icon: '🧑‍🤝‍🧑', roles: ['admin', 'vendedor'], render: renderClientes },
  carreto: { label: 'Carreto', icon: '🛻', roles: ['admin', 'vendedor'], render: renderCarreto },
  compras: { label: 'Compras', icon: '🛒', roles: ['admin'], render: renderCompras },
  financeiro: { label: 'Financeiro', icon: '💵', roles: ['admin'], render: renderFinanceiro },
  relatorios: { label: 'Relatórios', icon: '📈', roles: ['admin'], render: renderRelatorios },
  usuarios: { label: 'Usuários', icon: '👥', roles: ['admin'], render: renderUsers },
  logs: { label: 'Log do sistema', icon: '🗒️', roles: ['admin'], render: renderLogs },
  empresa: { label: 'Dados da loja', icon: '🏬', roles: ['admin'], render: renderCompanySettings },
  backup: { label: 'Backup', icon: '💾', roles: ['admin'], render: renderBackup },
  personalizacao: { label: 'Personalização', icon: '🎨', roles: ['admin', 'vendedor'], render: renderPersonalizacao },
  ajuda: { label: 'Ajuda', icon: '❓', roles: ['admin', 'vendedor'], render: renderAjuda },
};

let unmountLogin = null;

async function boot() {
  // Mesmo motivo do closeAllModals() em renderCurrentRoute (ver comentário
  // lá): um modal aberto fica anexado direto no <body>, fora de #root, e
  // sobreviveria mesmo a isso reescrever root.innerHTML por completo.
  // boot() é chamado não só no carregamento inicial, mas também no logout,
  // ao completar o setup/login, e — o caso mais fácil de reproduzir de
  // verdade — quando outra aba desloga (ver onSessionUserIdChanged mais
  // abaixo): se esta aba tiver um modal aberto no momento, ele ficaria
  // flutuando por cima da tela de login sem essa chamada.
  closeAllModals();
  // A tela de login pode deixar um intervalo do contador de bloqueio
  // rodando (ver views/login.js) — encerra antes de trocar de tela.
  if (unmountLogin) { unmountLogin(); unmountLogin = null; }
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
    unmountLogin = renderLogin(root, { company, onLogin: () => boot() });
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
      <button class="menu-toggle-btn" id="menu-toggle-btn" type="button" aria-label="Abrir menu">☰</button>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <nav class="sidebar" id="sidebar">
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

  // Menu lateral em tela estreita vira uma gaveta (ver breakpoint 900px em
  // styles.css) — o botão ☰ e o véu por trás só ficam visíveis nesse modo,
  // mas os elementos e os listeners existem sempre, sem custo em telas largas.
  const sidebarEl = document.getElementById('sidebar');
  const overlayEl = document.getElementById('sidebar-overlay');
  const closeSidebar = () => { sidebarEl.classList.remove('open'); overlayEl.classList.remove('open'); };
  const toggleSidebar = () => {
    const opening = !sidebarEl.classList.contains('open');
    sidebarEl.classList.toggle('open', opening);
    overlayEl.classList.toggle('open', opening);
  };
  document.getElementById('menu-toggle-btn').addEventListener('click', toggleSidebar);
  overlayEl.addEventListener('click', closeSidebar);

  const navGroup = document.getElementById('nav-group');
  navGroup.innerHTML = Object.entries(ROUTES)
    .filter(([, route]) => route.roles.includes(user.role))
    .map(([key, route]) => `
      <button class="nav-link" data-route="${key}">
        <span class="nav-icon">${route.icon}</span> ${route.label}
      </button>
    `).join('');

  navGroup.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; closeSidebar(); });
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

  // Guarda a função de limpeza (opcional) que a tela atual devolveu — ver
  // comentário logo abaixo. `null` quando a tela atual não precisa de
  // nenhuma limpeza (a maioria não precisa: trocar innerHTML já solta os
  // listeners presos a elementos removidos, o único caso que precisa de
  // limpeza explícita é um listener preso em `document`/`window` que
  // sobrevive à troca de innerHTML, como o reforço global de leitura de
  // código de barras em Nova Venda).
  let unmountCurrentRoute = null;

  // Reconfere se este usuário continua ativo a cada navegação (não só uma
  // vez, no boot inicial) — sem isso, um admin desativando um vendedor
  // pela tela Usuários não tinha nenhum efeito sobre uma aba desse
  // vendedor que já estivesse aberta: ela continuava plenamente
  // funcional (vender, estornar etc.) até alguém recarregar a página por
  // acaso. Custa uma leitura no IndexedDB por clique de navegação — 1
  // registro, sem sensação de lentidão perceptível.
  async function renderCurrentRoute() {
    // Fecha qualquer modal aberto ANTES de qualquer outra coisa — inclusive
    // antes do await abaixo. Sem isso, um modal aberto sobrevivia à troca
    // de rota (ele fica anexado direto no <body>, fora do #main-content
    // que este roteador limpa) e ficava flutuando por cima da tela nova.
    // Isso é alcançável de verdade: a extensão abre numa aba cheia, então
    // o usuário tem o histórico do navegador disponível normalmente — dá
    // pra reproduzir com o botão "Voltar" enquanto um modal está aberto.
    closeAllModals();

    const freshUser = await getUser(user.id);
    if (!freshUser || !freshUser.active) {
      showToast('Sua sessão não é mais válida — faça login novamente.', 'error');
      await clearSession();
      boot();
      return;
    }

    if (unmountCurrentRoute) { unmountCurrentRoute(); unmountCurrentRoute = null; }

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
    // Uma view pode devolver (opcionalmente) uma função de limpeza, que é
    // chamada automaticamente aqui na PRÓXIMA navegação, antes de montar a
    // tela nova — quase nenhuma view precisa disso (só quem registra
    // listener fora do próprio container, ver views/sale.js).
    const cleanup = await route.render(container, ctx);
    if (typeof cleanup === 'function') unmountCurrentRoute = cleanup;
  }

  window.onhashchange = renderCurrentRoute;
  if (!location.hash) location.hash = '#/dashboard';
  else renderCurrentRoute();
}

// Sessão é compartilhada entre todas as abas da extensão (não é por aba) —
// login/logout numa aba precisa se refletir nas outras. Registrado uma
// única vez aqui (não dentro de boot()/renderShell(), que rodam de novo a
// cada login), senão cada novo login empilharia mais um listener.
onSessionUserIdChanged(() => boot());

// A aparência (claro/escuro/automático) é escolhida na tela Personalização
// (ver views/personalizacao.js), acessível pelo menu depois de logar — só
// precisa ser aplicada aqui, uma vez, antes do primeiro render, pra abrir
// direto no tema certo sem piscar.
(async () => {
  applyTheme(await getThemePreference());
  boot();
})();
