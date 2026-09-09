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
import { renderDashboard } from './views/dashboard.js';
import { renderProducts } from './views/products.js';
import { renderSale } from './views/sale.js';
import { renderSalesHistory } from './views/salesHistory.js';
import { renderClientes } from './views/clientes.js';
import { renderCarreto } from './views/carreto.js';
import { renderUsers } from './views/users.js';
import { renderCaixa } from './views/caixa.js';
import { renderCompras } from './views/compras.js';
import { renderFinanceiro } from './views/financeiro.js';
import { renderLogs } from './views/logs.js';
import { renderRelatorios } from './views/relatorios.js';
import { renderPersonalizacao } from './views/personalizacao.js';
import { renderAjuda } from './views/ajuda.js';
import { escapeHtml } from './utils/format.js';
import { connectLive, onLiveMessage } from './live.js';
import { getCompany } from './data/companyRepo.js';
import { getThemePreference, applyTheme } from './theme.js';

// A aparência (claro/escuro/automático) é escolhida na tela Personalização
// (ver views/personalizacao.js) — só precisa ser aplicada aqui, uma vez,
// antes do primeiro render, pra abrir direto no tema certo sem piscar.
// Mesmo ponto de app.js da extensão.
(async () => {
  applyTheme(await getThemePreference());
})();

const root = document.getElementById('root');

// Nomes de rota iguais aos da extensão de propósito (ver app.js dela,
// const ROUTES) — várias telas navegam entre si chamando
// ctx.navigate('vendas')/('caixa')/('carreto')/etc. direto, sem
// reescrita nenhuma; um nome diferente aqui faria esses links silenciosamente
// caírem no DEFAULT_ROUTE em vez da tela certa (só um `history.pushState`
// muda; ctx.navigate nunca lança erro pra rota desconhecida).
const ROUTES = {
  dashboard: { label: 'Painel', render: renderDashboard },
  estoque: { label: 'Estoque', render: renderProducts },
  venda: { label: 'Nova venda', render: renderSale },
  vendas: { label: 'Histórico de vendas', render: renderSalesHistory },
  clientes: { label: 'Clientes', render: renderClientes },
  carreto: { label: 'Carreto', render: renderCarreto },
  usuarios: { label: 'Usuários', render: renderUsers },
  caixa: { label: 'Caixa', render: renderCaixa },
  compras: { label: 'Compras', render: renderCompras },
  financeiro: { label: 'Financeiro', render: renderFinanceiro },
  logs: { label: 'Log do sistema', render: renderLogs },
  relatorios: { label: 'Relatórios', render: renderRelatorios },
  personalizacao: { label: 'Personalização', render: renderPersonalizacao },
  ajuda: { label: 'Ajuda', render: renderAjuda },
};
const DEFAULT_ROUTE = 'dashboard'; // igual à extensão (ver app.js dela: `if (!location.hash) location.hash = '#/dashboard'`)

// Assuntos que fazem cada tela valer a pena recarregar sozinha — ver
// lib/broadcast.js pros nomes que cada rota manda depois de gravar.
// 'venda' de propósito NÃO escuta 'products-changed': sale.js já busca o
// produto de novo no servidor a cada busca/adição ao carrinho (preço e
// estoque nunca ficam desatualizados no que importa — o servidor
// revalida tudo de novo no fechamento da venda, provado em
// test-sale-repos.cjs), e recarregar a tela inteira no meio de uma venda
// destruiria o foco de quem está digitando. 'estoque' já é seguro
// recarregar por completo (é só uma lista + modais, que vivem fora do
// container — ver components/modal.js). 'vendas', 'clientes' e 'carreto'
// também ficam de fora de propósito, mesmo raciocínio de 'venda': filtro
// (vendedor/cliente/datas em vendas; busca/paginação em clientes; status
// em carreto) e paginação ("Carregar mais") são estado só de tela,
// perdido a cada recarregamento — um vendedor no meio de uma conferência
// não deveria ter a lista trocada debaixo dele por causa de uma ação em
// OUTRO terminal; quem quiser ver o mais recente já tem os filtros (que
// já recarregam) e um F5. 'dashboard' é o oposto: não tem filtro nem
// estado nenhum pra perder (é só um retrato do momento, recalculado do
// zero a cada render), então escuta de tudo que pode mudar um dos
// cartões — é literalmente o propósito da tela. 'usuarios' também não
// tem filtro nem paginação (a lista de vendedores de uma loja é sempre
// pequena) — seguro escutar 'users-changed' e recarregar sozinho. 'caixa'
// fica de fora pelo mesmo motivo de 'vendas'/'clientes'/'carreto': o
// estado fechado tem paginação no histórico E um campo de valor inicial
// que pode estar sendo digitado; o estado aberto tem formulários abertos
// nos modais de sangria/suprimento/retificação/fechamento — um
// recarregamento no meio de qualquer um desses perderia o que a pessoa
// já tinha preenchido. 'compras' também fica de fora, mesmo raciocínio:
// duas abas (fornecedores/pedidos) com paginação própria, e o modal de
// novo pedido tem linhas de busca de produto sendo preenchidas — nada
// que um recarregamento no meio devesse apagar. 'financeiro' também:
// filtro de tipo/status e paginação são estado só de tela, mesmo
// raciocínio de 'vendas'/'clientes'/'carreto'/'compras'. 'logs' também:
// filtro (perfil/usuário/termo/data) e "Carregar mais" (cursor de
// timestamp+id) são estado só de tela, mesmo raciocínio das outras.
// 'relatorios' também: o período selecionado (preset ou datas
// personalizadas) é estado só de tela. 'personalizacao' e 'ajuda' nem
// entram aqui: nenhuma delas lê dado nenhum que outro terminal possa
// mudar (tema é por navegador; ajuda é conteúdo estático) — 'ajuda' tem
// busca/acordeão abertos que um recarregamento sem motivo também
// atrapalharia, mas o ponto principal é que não existe evento nenhum que
// devesse disparar um.
const LIVE_TOPICS = {
  estoque: new Set(['products-changed', 'suppliers-changed']),
  venda: new Set(['customers-changed', 'cash-changed', 'cash-config-changed', 'company-changed']),
  dashboard: new Set(['products-changed', 'sales-changed', 'customers-changed', 'deliveries-changed', 'cash-changed', 'cash-config-changed', 'company-changed', 'loyalty-config-changed']),
  usuarios: new Set(['users-changed']),
};
const LIVE_DEBOUNCE_MS = 500;

let activeRouteName = null;
let activeCtx = null;
let liveRefreshTimer = null;

function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => {
    // Se um modal estiver aberto (novo produto, ajuste de estoque, aprovação
    // de desconto...), não puxa o tapete da tela debaixo dele agora — o
    // próximo aviso relevante, depois que o modal fechar, tenta de novo.
    if (document.querySelector('.modal')) return;
    if (!activeRouteName || !activeCtx) return;
    const view = ROUTES[activeRouteName];
    const container = document.getElementById('view-root');
    if (!view || !container) return;
    view.render(container, activeCtx);
  }, LIVE_DEBOUNCE_MS);
}

onLiveMessage((msg) => {
  if (!activeRouteName) return;
  if (LIVE_TOPICS[activeRouteName]?.has(msg.topic)) scheduleLiveRefresh();
});

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

async function renderShell(user) {
  const routeName = currentRouteName();
  // ctx.company só é lido hoje por views/ajuda.js (o aviso de LGPD do
  // tópico de privacidade lê nomeFantasia/encarregadoLgpd), sempre com
  // fallback seguro (`company?.nomeFantasia || '[nome da loja]'`) — o
  // servidor ainda não tem uma tela "Dados da loja" portada (views/
  // company.js da extensão está fora de escopo por enquanto: entrelaçada
  // com o sistema de licenciamento comercial da extensão, que não existe
  // aqui, ver README), só a política de venda (`company.policies`, já
  // usada por sale.js/dashboard.js/caixa.js). getCompany() aqui devolve só
  // isso — os campos de perfil da loja continuam undefined, mostrando o
  // fallback, nunca quebrando.
  const company = await getCompany();
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
  const ctx = { user, company, navigate: (name) => { location.hash = `#/${name}`; } };
  activeRouteName = routeName;
  activeCtx = ctx;
  if (view) {
    view.render(container, ctx);
  } else {
    container.innerHTML = `<div class="card">Tela "${escapeHtml(routeName)}" ainda não foi portada pra este modo multi-terminal.</div>`;
  }
  connectLive();
}

let booting = false;
async function boot() {
  if (booting) return; // reentrância (ex: dois eventos de sessão quase juntos) — mesma proteção do app.js da extensão
  booting = true;
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      activeRouteName = null;
      activeCtx = null;
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
      activeRouteName = null;
      activeCtx = null;
      renderLogin();
      return;
    }
    await renderShell(user);
  } finally {
    booting = false;
  }
}

window.onhashchange = boot;
onSessionUserIdChanged(() => boot());
boot();
