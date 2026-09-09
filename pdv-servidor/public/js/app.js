// Casca completa do app multi-terminal — Fase 9, último passo do roteiro:
// menu lateral com as 15 rotas reais (gated por permissão, igual ao app.js
// da extensão), timeout de inatividade (30min), trava de aba única (por
// terminal, ver tabPresence.js) e o roteador que troca só o CONTEÚDO
// (#view-root) a cada navegação, sem re-renderizar o resto da casca (nav,
// idle-watch) toda vez — mesma arquitetura de app.js da extensão
// (renderShell monta a casca uma vez por login; renderCurrentRoute troca
// só a tela a cada #hash).
//
// Fora de escopo aqui, de propósito (ver README): tudo que gira em torno
// do assistente de primeira execução e do sistema de licenciamento
// comercial da extensão (setup.js, company.js, trial, chave de ativação) —
// este servidor não é um produto vendido/licenciado por instalação, é
// software interno de uma loja só, sempre com pelo menos um admin já
// cadastrado (ver seed.js).
import { getSessionUserId, setSessionUserId, onSessionUserIdChanged, clearSession, touchActivity, getIdleMs, IDLE_LIMIT_MS } from './session.js';
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
import { renderBackup } from './views/backup.js';
import { escapeHtml } from './utils/format.js';
import { connectLive, onLiveMessage } from './live.js';
import { getCompany } from './data/companyRepo.js';
import { logAction } from './data/auditRepo.js';
import { getThemePreference, applyTheme } from './theme.js';
import { icon } from './components/icon.js';
import { closeAllModals, confirmDialog } from './components/modal.js';
import { closeAllCustomSelects } from './components/customSelect.js';
import { showToast } from './components/toast.js';
import { userCan, isAdmin } from './utils/permissions.js';
import { watchTabPresence } from './tabPresence.js';

// A aparência (claro/escuro/automático) é escolhida na tela Personalização
// (ver views/personalizacao.js) — só precisa ser aplicada aqui, uma vez,
// antes do primeiro render, pra abrir direto no tema certo sem piscar.
// Mesmo ponto de app.js da extensão. Independente da trava de aba abaixo —
// a tela de aba bloqueada também precisa nascer no tema certo.
(async () => {
  applyTheme(await getThemePreference());
})();

const root = document.getElementById('root');

// Nomes de rota iguais aos da extensão de propósito (ver app.js dela,
// const ROUTES) — várias telas navegam entre si chamando
// ctx.navigate('vendas')/('caixa')/('carreto')/etc. direto, sem
// reescrita nenhuma; um nome diferente aqui faria esses links silenciosamente
// caírem no DEFAULT_ROUTE em vez da tela certa (só um `history.pushState`
// muda; ctx.navigate nunca lança erro pra rota desconhecida). Ícone e
// `permission` também copiados da extensão — só o campo `roles` ficou de
// fora: lá ele existe pra uma rota poder ser restrita só a admin, mas
// TODA rota da extensão hoje lista `roles: ['admin', 'vendedor']` (nunca
// usado de verdade pra filtrar nada) — sem sentido reproduzir um campo que
// nunca muda o resultado.
const ROUTES = {
  dashboard: { label: 'Painel', icon: icon('home'), render: renderDashboard },
  estoque: { label: 'Estoque', icon: icon('box'), render: renderProducts },
  venda: { label: 'Nova venda', icon: icon('receipt'), render: renderSale },
  vendas: { label: 'Histórico de vendas', icon: icon('chart'), render: renderSalesHistory },
  caixa: { label: 'Caixa', icon: icon('cash'), render: renderCaixa },
  clientes: { label: 'Clientes', icon: icon('user'), render: renderClientes },
  carreto: { label: 'Carreto', icon: icon('truck'), render: renderCarreto },
  // As seis rotas abaixo exigem uma permissão específica (ver
  // utils/permissions.js e views/users.js) — admin sempre passa,
  // userCan() cuida disso sozinho em canAccessRoute() logo abaixo.
  compras: { label: 'Compras', icon: icon('cart'), permission: 'compras', render: renderCompras },
  financeiro: { label: 'Financeiro', icon: icon('dollar'), permission: 'financeiro', render: renderFinanceiro },
  relatorios: { label: 'Relatórios', icon: icon('trending'), permission: 'relatorios', render: renderRelatorios },
  usuarios: { label: 'Usuários', icon: icon('users'), permission: 'usuarios', render: renderUsers },
  logs: { label: 'Log do sistema', icon: icon('clipboard'), permission: 'logs', render: renderLogs },
  backup: { label: 'Backup', icon: icon('save'), permission: 'backup', render: renderBackup },
  personalizacao: { label: 'Personalização', icon: icon('palette'), render: renderPersonalizacao },
  ajuda: { label: 'Ajuda', icon: icon('question'), render: renderAjuda },
};
const DEFAULT_ROUTE = 'dashboard'; // igual à extensão (ver app.js dela: `if (!location.hash) location.hash = '#/dashboard'`)

/** Uma rota é acessível quando ela não exige nenhuma permissão específica,
 * OU o usuário tem essa permissão — userCan() já deixa admin passar
 * sempre, sem precisar checar papel nenhum aqui (mesmo raciocínio da
 * extensão, só sem o campo `roles` morto — ver comentário em ROUTES). */
function canAccessRoute(route, user) {
  return !route.permission || userCan(user, route.permission);
}

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
// devesse disparar um. 'backup' também fica de fora, mesmo raciocínio de
// 'caixa'/'compras': os três formulários (exportar/restaurar/zerar) têm
// senha e arquivo selecionado em andamento — um recarregamento no meio
// apagaria isso à toa, e nenhum dos três topics abaixo (mudança de
// produto, venda, etc.) é relevante pra esta tela mesmo. As duas ações
// da PRÓPRIA tela que precisam de recarregamento total em TODO terminal
// ('backup-restored'/'data-reset') são tratadas fora deste esquema por
// tópico de tela — ver o listener logo abaixo.
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

// Compartilhada com renderCurrentRoute() logo abaixo — toda vez que uma
// navegação de VERDADE começa (clique no menu, hash mudado por link,
// F5...), essa contagem sobe. scheduleLiveRefresh() tira um retrato dela
// no momento em que É AGENDADO (quando o aviso do WebSocket chega) e
// confere de novo quando o timer finalmente DISPARA (LIVE_DEBOUNCE_MS
// depois) — se uma navegação de verdade aconteceu nesse meio-tempo, o
// live-refresh abandona em silêncio em vez de escrever a tela ANTIGA por
// cima da NOVA. Achado de auditoria reproduzido de verdade em
// test-real-ui.cjs: máquina B ainda no Painel quando o aviso
// 'products-changed' chega (venda feita na máquina A) agenda um
// live-refresh do Painel; o clique de navegação pro Estoque acontece
// LOGO em seguida, mas o timer do live-refresh (isolado do roteador,
// nunca passava por renderCurrentRoute) disparava depois, escrevendo o
// Painel de novo por cima do Estoque que já devia estar na tela.
let renderGeneration = 0;

function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  const scheduledGeneration = renderGeneration;
  liveRefreshTimer = setTimeout(() => {
    // Se um modal estiver aberto (novo produto, ajuste de estoque, aprovação
    // de desconto...), não puxa o tapete da tela debaixo dele agora — o
    // próximo aviso relevante, depois que o modal fechar, tenta de novo.
    if (document.querySelector('.modal')) return;
    if (!activeRouteName || !activeCtx) return;
    if (scheduledGeneration !== renderGeneration) return; // uma navegação de verdade já aconteceu desde que isto foi agendado — abandona
    const view = ROUTES[activeRouteName];
    const container = document.getElementById('view-root');
    if (!view || !container) return;
    view.render(container, activeCtx);
  }, LIVE_DEBOUNCE_MS);
}

// Restaurar ou zerar um backup troca (ou apaga) dado que QUALQUER tela em
// QUALQUER terminal pode estar mostrando agora — diferente dos tópicos por
// tela acima (que só valem enquanto aquela tela específica está aberta),
// os dois abaixo recarregam a PÁGINA INTEIRA em todo terminal conectado,
// não só o container da tela ativa (mesmo raciocínio do comentário do
// broadcast em routes/backup.js: é o jeito mais simples e seguro de todo
// mundo voltar a mostrar dados corretos, mesmo com um modal aberto no meio
// — perder o que estava sendo digitado é o mal menor depois que os dados
// por trás dele deixaram de existir). 'backup-restored' também desloga
// (clearSession) antes de recarregar, igual a extensão (a tabela de
// usuários pode ter sido substituída inteira pela restauração) —
// 'data-reset' não: usuários nunca fazem parte do que é zerado, a mesma
// sessão continua válida depois.
onLiveMessage((msg) => {
  if (msg.topic === 'backup-restored') {
    clearSession().finally(() => location.reload());
    return;
  }
  if (msg.topic === 'data-reset') {
    location.reload();
    return;
  }
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
      // Sem boot() explícito aqui de propósito — setSessionUserId() já
      // dispara onSessionUserIdChanged sozinho, inclusive nesta mesma aba
      // (ver comentário em session.js). Chamar os dois juntos duplicava
      // boot() pro mesmo login — mesmo raciocínio de onLogin em
      // app.js/login.js da extensão.
      await setSessionUserId(body.user.id);
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

// Encerra o monitor de inatividade da chamada anterior de renderShell —
// precisa existir fora dela porque renderShell só roda de novo num login
// novo (nunca mais de uma vez pro mesmo login, já que agora só troca o
// #view-root a cada navegação — diferente da versão anterior desta casca,
// que recriava a casca inteira a cada hashchange). Ainda assim guardado
// aqui fora, não local à função, pelo mesmo motivo da extensão: mais de
// um boot() podia disparar renderShell mais de uma vez em sequência (dois
// eventos de sessão quase juntos), e sem isso cada chamada empilharia
// mais um conjunto de listeners de atividade + intervalo, nunca desligados.
let stopIdleWatch = null;
// Mesmo motivo do stopIdleWatch logo acima, pro listener de resize do
// menu (ver dentro de renderShell): preso a `window`, que nunca é
// recriado como os elementos do shell são.
let stopNavScrollWatch = null;
// Função de limpeza (opcional) que a TELA ATUAL devolveu — ver
// renderCurrentRoute(). `null` quando a tela atual não precisa de nenhuma
// limpeza (a maioria não precisa: trocar innerHTML já solta os listeners
// presos a elementos removidos). views/sale.js é a exceção conhecida
// (reforço global de leitura de código de barras, preso em `document`).
let unmountCurrentRoute = null;

// async de propósito, e SEMPRE aguardada por quem chama (bootImpl) — ver
// o comentário dela: sem isso, bootImpl() considerava o boot "terminado"
// antes da renderização de verdade (que tem um await de rede de verdade,
// `getCompany()` dentro de renderCurrentRoute) ter realmente acabado,
// deixando uma janela aberta pra um SEGUNDO boot() (fila `bootQueue`
// abaixo) começar cedo demais — dois `renderShell()` em sequência muito
// próxima criam dois `#view-root` diferentes, e a PRIMEIRA renderização
// (ainda presa no await de rede) acaba mexendo num container já órfão
// quando finalmente retoma. Achado reproduzido de verdade com
// `page.reload()` + `views/personalizacao.js` (que também tem um await
// antes de tocar no DOM) — mesma classe de corrida, só que a extensão
// nunca sofria disso porque lá TODO acesso a dado é IndexedDB local
// (resolve no mesmo os poucos microtasks, nunca abrindo uma janela real).
async function renderShell(user) {
  if (stopIdleWatch) { stopIdleWatch(); stopIdleWatch = null; }
  if (stopNavScrollWatch) { stopNavScrollWatch(); stopNavScrollWatch = null; }
  if (unmountCurrentRoute) { unmountCurrentRoute(); unmountCurrentRoute = null; }

  root.innerHTML = `
    <div class="shell">
      <button class="menu-toggle-btn" id="menu-toggle-btn" type="button" aria-label="Abrir menu">${icon('menu', { size: 20 })}</button>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="name">PDV - C&amp;S Virtual</div>
          <div class="sub">multi-terminal</div>
        </div>
        <div class="nav-scroll-wrap" id="nav-scroll-wrap">
          <div class="nav-group" id="nav-group"></div>
          <button class="nav-scroll-btn nav-scroll-up" id="nav-scroll-up" type="button" aria-label="Rolar menu para cima">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"></polyline></svg>
          </button>
          <button class="nav-scroll-btn nav-scroll-down" id="nav-scroll-down" type="button" aria-label="Rolar menu para baixo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-user">${escapeHtml(user.nome)}</div>
          <div class="sidebar-role">${isAdmin(user) ? 'Administrador geral' : 'Vendedor'}</div>
          <button class="btn btn-secondary btn-sm" id="logout-btn" style="width:100%;">Sair</button>
        </div>
      </nav>
      <main class="main" id="main"><div id="view-root"></div></main>
    </div>
  `;

  // Menu lateral em tela estreita vira uma gaveta (ver breakpoint 900px em
  // styles.css) — o botão de menu e o véu por trás só ficam visíveis nesse
  // modo, mas os elementos e os listeners existem sempre, sem custo em
  // telas largas.
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
    .filter(([, route]) => canAccessRoute(route, user))
    .map(([key, route]) => `
      <button class="nav-link" data-route="${key}">
        <span class="nav-icon">${route.icon}</span> ${route.label}
      </button>
    `).join('');
  navGroup.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; closeSidebar(); });
  });

  // Menu lateral rola tanto pelos botões de seta (scrollBy abaixo) quanto
  // pela roda/trackpad do mouse — isolado da rolagem da página nos dois
  // sentidos via CSS (.nav-group: overflow-y:auto + overscroll-behavior:
  // contain, ver styles.css), não aqui no JS: com o mouse sobre o menu,
  // rola só o menu; com o mouse sobre a página, rola só a página.
  const navScrollWrap = document.getElementById('nav-scroll-wrap');
  const navScrollUpBtn = document.getElementById('nav-scroll-up');
  const navScrollDownBtn = document.getElementById('nav-scroll-down');
  const updateNavScrollState = () => {
    const scrollable = navGroup.scrollHeight > navGroup.clientHeight + 1;
    const atTop = navGroup.scrollTop <= 1;
    const atBottom = navGroup.scrollTop + navGroup.clientHeight >= navGroup.scrollHeight - 1;
    navScrollWrap.classList.toggle('has-more-above', scrollable && !atTop);
    navScrollWrap.classList.toggle('has-more-below', scrollable && !atBottom);
  };
  navScrollUpBtn.addEventListener('click', () => {
    navGroup.scrollBy({ top: -Math.round(navGroup.clientHeight * 0.75), behavior: 'smooth' });
  });
  navScrollDownBtn.addEventListener('click', () => {
    navGroup.scrollBy({ top: Math.round(navGroup.clientHeight * 0.75), behavior: 'smooth' });
  });
  // scrollBy({behavior:'smooth'}) dispara 'scroll' em cada frame da
  // animação — é assim que os botões somem/aparecem suavemente ao longo do
  // scroll, não só no instante do clique.
  navGroup.addEventListener('scroll', updateNavScrollState);
  window.addEventListener('resize', updateNavScrollState);
  stopNavScrollWatch = () => window.removeEventListener('resize', updateNavScrollState);
  updateNavScrollState();

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sair do sistema', message: 'Deseja encerrar sua sessão?', confirmLabel: 'Sair' });
    if (!ok) return;
    await logAction({
      userId: user.id, userName: user.nome, role: user.role,
      action: 'Logout', details: `Logout realizado por "${user.nome}".`, entity: 'auth', entityId: user.id,
    });
    await clearSession();
    showToast('Sessão encerrada.', 'info');
    // Sem boot() explícito aqui — clearSession() já dispara
    // onSessionUserIdChanged sozinho, inclusive nesta mesma aba.
  });

  // ---------- Expira a sessão sozinha depois de 30 min sem nenhuma
  // interação (ver session.js — a atividade é compartilhada entre abas
  // DESTE terminal via localStorage, então só desloga de verdade quando
  // NENHUMA aba deste terminal teve uso recente). O registro de atividade
  // é limitado a no máximo 1 escrita a cada 15s (mousemove sozinho
  // dispararia dezenas por segundo, sem necessidade nenhuma) — só a
  // CHECAGEM roda a cada 30s, não a escrita. ----------
  let lastActivityWrite = 0;
  function markActivity() {
    const now = Date.now();
    if (now - lastActivityWrite < 15000) return;
    lastActivityWrite = now;
    touchActivity();
  }
  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
  ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));
  touchActivity(); // a entrada nesta tela já conta como atividade inicial

  // stopThisIdleWatch() se refere a SI MESMA por closure em vez de chamar a
  // variável de módulo `stopIdleWatch` por nome — de propósito: essa
  // variável é reatribuída a cada renderShell() (só acontece em cada login
  // novo, mas ainda assim pode se repetir), então se o intervalo de uma
  // chamada ANTIGA ainda estivesse de pé na hora de disparar, chamar
  // `stopIdleWatch()` (o nome) acabaria limpando o intervalo ATUAL (o mais
  // novo), não o de quem disparou. Cada intervalo só desliga a SI PRÓPRIO.
  function stopThisIdleWatch() {
    clearInterval(idleCheckInterval);
    ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActivity));
    if (stopIdleWatch === stopThisIdleWatch) stopIdleWatch = null;
  }
  const idleCheckInterval = setInterval(async () => {
    if (await getIdleMs() < IDLE_LIMIT_MS) return;
    stopThisIdleWatch();
    await logAction({
      userId: user.id, userName: user.nome, role: user.role,
      action: 'Sessão expirada por inatividade',
      details: `Sessão de "${user.nome}" encerrada automaticamente após 30 minutos sem uso.`,
      entity: 'auth', entityId: user.id,
    });
    await clearSession();
    showToast('Sua sessão expirou por inatividade — faça login novamente.', 'error');
    // Sem boot() explícito aqui — mesmo motivo do logout manual acima.
  }, 30000);
  stopIdleWatch = stopThisIdleWatch;

  // Nunca `window.onhashchange = renderCurrentRoute` direto — o navegador
  // chamaria o handler com o HashChangeEvent como primeiro argumento, e
  // renderCurrentRoute trataria isso como se fosse `userHint` (um objeto
  // verdadeiro, então passaria pela checagem `userHint || ...` sem nunca
  // buscar o usuário de verdade).
  window.onhashchange = () => renderCurrentRoute();
  if (!location.hash) location.hash = '#/dashboard';
  // Sempre chama direto, na hora — nunca depende só do evento assíncrono
  // de hashchange disparado pela linha acima pra decidir o que mostrar
  // (mesmo raciocínio da extensão: definir location.hash quando ele
  // estava vazio dispara o evento de qualquer jeito, então isto pode
  // rodar de novo mais tarde, redundante e inofensivo).
  await renderCurrentRoute(user);
  connectLive();
}

// Reconfere a sessão a cada navegação (não só no boot inicial) — sem isso,
// um admin desativando um vendedor ou revogando uma permissão dele pela
// tela Usuários não teria efeito nenhum sobre uma aba desse vendedor que
// já estivesse aberta: ela continuaria plenamente funcional até alguém
// recarregar a página por acaso. GET /api/auth/me já é a fonte de verdade
// (o servidor agora trata uma conta desativada como sessão inválida, ver
// server.js) — reaproveitada em vez de um endpoint próprio de "buscar um
// usuário por id", que abriria a pergunta de quem mais poderia consultar
// o cadastro de quem.
// Achado de auditoria no caminho: duas navegações em sequência rápida (ex:
// o hashchange do LOGIN ainda buscando dados do Painel enquanto o próximo
// clique já muda pra Estoque) disparam duas chamadas de renderCurrentRoute
// SEM nenhuma relação de ordem garantida entre elas — cada uma tem awaits
// de rede de verdade (fetchCurrentUser/getCompany/o fetch da própria
// view), e nada impedia a mais LENTA (ex: o Painel, que busca vários
// cartões) terminar DEPOIS da mais rápida e sobrescrever o #view-root de
// volta pro conteúdo antigo — reproduzido de verdade em
// test-real-ui.cjs (login ainda renderizando o Painel quando o teste já
// navegava pra Estoque; o Painel "vencia" a corrida por terminar por
// último). `renderGeneration` (declarada mais acima, perto de
// scheduleLiveRefresh — as duas compartilham a mesma defesa) é a defesa
// padrão pra essa classe de corrida ("stale render"): cada chamada marca
// sua própria "geração" no início e, depois de CADA await que pode ter
// deixado outra chamada mais nova começar enquanto essa esperava, confere
// se ainda é a mais recente antes de tocar em qualquer coisa visível — se
// não for, abandona em silêncio (a chamada mais nova já cuidou, ou vai
// cuidar, da tela).
async function renderCurrentRoute(userHint) {
  const myGeneration = ++renderGeneration;

  // Fecha qualquer modal aberto ANTES de qualquer outra coisa — inclusive
  // antes do await abaixo. Sem isso, um modal aberto sobrevivia à troca de
  // rota (fica anexado direto no <body>, fora do #view-root que este
  // roteador limpa) e ficava flutuando por cima da tela nova. Mesmo
  // raciocínio pro dropdown de filtro (ver components/customSelect.js).
  closeAllModals();
  closeAllCustomSelects();

  const freshUser = userHint || await fetchCurrentUser();
  if (myGeneration !== renderGeneration) return; // uma navegação mais nova já assumiu — abandona
  if (!freshUser) {
    showToast('Sua sessão não é mais válida — faça login novamente.', 'error');
    await clearSession();
    // Sem boot() explícito aqui — mesmo motivo do logout manual acima.
    return;
  }

  const container = document.getElementById('view-root');
  // Uma mudança de hash feita ENQUANTO outro boot()/logout já reescreveu
  // root.innerHTML por baixo (ex: sessão expirada no meio de uma
  // navegação) pode acionar esta função depois que #view-root já não
  // existe mais nesta versão da tela — sem esta checagem, isso derrubava
  // com "Cannot set properties of null".
  if (!container) return;

  const key = currentRouteName();
  const route = ROUTES[key];

  // De propósito SEM gate de permissão aqui — diferente da extensão
  // (canAccessRoute() só decide o que aparece no MENU, ver renderShell
  // logo acima). Um deep-link direto pra uma rota gated (ex: #/backup sem
  // a permissão 'backup') renderiza a tela normalmente — mesmo padrão já
  // testado e estabelecido em relatorios.js/logs.js/financeiro.js/
  // backup.js (ver test-relatorios.cjs, test-logs.cjs etc.): a proteção
  // de verdade é sempre no SERVIDOR (cada rota protegida por
  // requirePermission(), ver server.js), nunca escondendo a tela — um
  // vendedor sem a permissão vê o formulário/botões normalmente, e
  // qualquer chamada de escrita/leitura sensível volta 403, mostrado como
  // erro amigável pela própria tela (mesmo raciocínio de "nunca confiar
  // só na tela pra decidir algo sensível" repetido em toda a Fase 9).
  // Bloquear a RENDERIZAÇÃO aqui quebraria esse padrão já testado em 4
  // telas diferentes sem ganho nenhum de segurança real.
  const company = await getCompany();
  if (myGeneration !== renderGeneration) return; // idem — outra navegação já assumiu enquanto isto esperava a rede

  if (unmountCurrentRoute) { unmountCurrentRoute(); unmountCurrentRoute = null; }
  document.querySelectorAll('#nav-group .nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === key);
  });
  const ctx = { user: freshUser, company, navigate: (name) => { location.hash = `#/${name}`; } };
  activeRouteName = key;
  activeCtx = ctx;
  container.innerHTML = '';
  // Uma view pode devolver (opcionalmente) uma função de limpeza, chamada
  // automaticamente na PRÓXIMA navegação, antes de montar a tela nova —
  // quase nenhuma view precisa disso (só quem registra listener fora do
  // próprio container, ver views/sale.js).
  const cleanup = await route.render(container, ctx);
  if (myGeneration !== renderGeneration) return; // idem — nunca sobrescreve o cleanup/scroll de uma navegação mais nova que já terminou
  if (typeof cleanup === 'function') unmountCurrentRoute = cleanup;
  window.scrollTo(0, 0);
}

// boot() pode ser chamado mais de uma vez quase ao mesmo tempo pro MESMO
// evento de login/logout (onSessionUserIdChanged dispara na PRÓPRIA aba
// que mudou a sessão, não só nas outras — ver session.js) — serializa as
// chamadas numa fila (nunca em paralelo), mesmo raciocínio de bootQueue no
// app.js da extensão: uma chamada redundante sempre vê o resultado já
// commitado da anterior antes de decidir qualquer coisa.
let bootQueue = Promise.resolve();
function boot() {
  bootQueue = bootQueue.then(bootImpl, bootImpl);
  return bootQueue;
}

// Achado do usuário (mesmo mecanismo da extensão): só avisar que já tinha
// outra aba aberta não bastava — a aba nova nasce REALMENTE bloqueada
// (true) até watchTabPresence (ver rodapé deste arquivo) decidir que esta
// é a mais antiga viva neste terminal — só então vira false, uma única
// vez, e o app começa a rodar de verdade. Checado aqui dentro de
// bootImpl (não só no ponto que chama boot() a primeira vez) porque boot()
// também é chamado por outros gatilhos que independem desta aba ter
// "ganho a eleição" (ex: onSessionUserIdChanged reage a login/logout feito
// em QUALQUER aba deste terminal) — sem essa checagem aqui dentro, um
// desses gatilhos conseguiria fazer uma aba bloqueada renderizar o app de
// verdade por baixo do pano, contornando o bloqueio.
let tabIsBlocked = true;

async function bootImpl() {
  if (tabIsBlocked) return;
  closeAllModals();
  closeAllCustomSelects();
  if (stopIdleWatch) { stopIdleWatch(); stopIdleWatch = null; }
  if (stopNavScrollWatch) { stopNavScrollWatch(); stopNavScrollWatch = null; }
  if (unmountCurrentRoute) { unmountCurrentRoute(); unmountCurrentRoute = null; }
  root.innerHTML = '<div class="boot-loading">Carregando…</div>';

  const userId = await getSessionUserId();
  if (!userId) {
    activeRouteName = null;
    activeCtx = null;
    renderLogin();
    return;
  }
  const user = await fetchCurrentUser();
  if (!user) {
    // Cookie de sessão do servidor não bate mais com o cache local (ex:
    // expirou por inatividade, foi limpo direto no servidor, ou a conta
    // foi desativada — ver server.js) — mesmo tratamento de "sessão
    // inválida" em qualquer um dos casos: volta pro login.
    await clearSession();
    activeRouteName = null;
    activeCtx = null;
    renderLogin();
    return;
  }
  await renderShell(user);
}

// Sessão é compartilhada entre todas as abas DESTE terminal (não é por
// aba) — login/logout numa aba precisa se refletir nas outras. Registrado
// uma única vez aqui (não dentro de boot()), senão cada novo login
// empilharia mais um listener.
onSessionUserIdChanged(() => boot());
boot();

function renderTabBlockedScreen() {
  root.innerHTML = `
    <div class="boot-loading">
      <div class="card" style="max-width:420px;text-align:center;">
        <div style="margin-bottom:6px;">${icon('folder', { size: 34 })}</div>
        <h1 style="font-size:18px;margin:0 0 18px;text-transform:uppercase;letter-spacing:0.4px;">Já aberto em outra janela</h1>
        <p style="margin:0 0 10px;">O sistema já está aberto em outra janela deste navegador. Pra evitar duas telas mexendo na mesma loja ao mesmo tempo, esta fica bloqueada.</p>
        <p class="text-muted" style="font-size:13px;margin:0;">Feche esta e continue na outra — ou feche a outra: assim que ela fechar, esta libera sozinha em poucos segundos, sem precisar recarregar nada.</p>
      </div>
    </div>
  `;
}

// Impede o sistema de rodar em mais de uma aba deste TERMINAL ao mesmo
// tempo (ver tabPresence.js pro mecanismo completo). Chama de volta uma
// vez logo de início e depois a cada poucos segundos, sempre que o
// resultado da "eleição" entre as abas abertas pode ter mudado.
let tabBlockedToastShown = false;
watchTabPresence((iAmTheOldestAlive, otherTabAlive) => {
  if (iAmTheOldestAlive) {
    if (tabIsBlocked) {
      tabIsBlocked = false;
      boot();
    }
    return;
  }
  // Não sou a mais antiga viva agora — só bloqueia se esta aba ainda não
  // tinha começado a rodar o app de verdade (uma aba que já estava
  // operando nunca é interrompida no meio por causa de uma aba nova
  // aparecendo depois — só a aba nova fica bloqueada).
  if (tabIsBlocked) {
    renderTabBlockedScreen();
    if (!tabBlockedToastShown && otherTabAlive) {
      tabBlockedToastShown = true;
      showToast('O sistema já está aberto em outra aba deste navegador.', 'info');
    }
  }
});
