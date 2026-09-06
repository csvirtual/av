// Ponto de entrada do app. Decide qual tela mostrar (setup → login → shell
// principal) e, depois de logado, cuida do roteamento entre as telas do
// sistema (estoque, venda, histórico, usuários, logs, empresa) dentro da
// mesma aba — sem framework, só JS de módulo nativo.
import { isCompanyRegistered, getCompany } from './data/companyRepo.js';
import { hasAnyUser, getUser, markAjudaSeen } from './data/usersRepo.js';
import { getSessionUserId, clearSession, onSessionUserIdChanged, touchActivity, getIdleMs, IDLE_LIMIT_MS } from './session.js';
import { logAction } from './data/auditRepo.js';
import { showToast } from './components/toast.js';
import { openModal, confirmDialog, closeAllModals } from './components/modal.js';
import { icon } from './components/icon.js';
import { escapeHtml } from './utils/format.js';
import { userCan, isAdmin } from './utils/permissions.js';
import { getThemePreference, applyTheme } from './theme.js';
import { watchTabPresence } from './tabPresence.js';
import { markTrialStartIfNeeded, getLicenseStatus, setStoredActivationKey } from './data/licenseRepo.js';
import { verifyLicenseKey } from './license.js';

import { renderSetup } from './views/setup.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProducts } from './views/products.js';
import { renderSale, resetSaleDraft } from './views/sale.js';
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
  dashboard: { label: 'Painel', icon: icon('home'), roles: ['admin', 'vendedor'], render: renderDashboard },
  estoque: { label: 'Estoque', icon: icon('box'), roles: ['admin', 'vendedor'], render: renderProducts },
  venda: { label: 'Nova venda', icon: icon('receipt'), roles: ['admin', 'vendedor'], render: renderSale },
  vendas: { label: 'Histórico de vendas', icon: icon('chart'), roles: ['admin', 'vendedor'], render: renderSalesHistory },
  caixa: { label: 'Caixa', icon: icon('cash'), roles: ['admin', 'vendedor'], render: renderCaixa },
  clientes: { label: 'Clientes', icon: icon('user'), roles: ['admin', 'vendedor'], render: renderClientes },
  carreto: { label: 'Carreto', icon: icon('truck'), roles: ['admin', 'vendedor'], render: renderCarreto },
  // As sete rotas abaixo eram roles:['admin'] fixo — agora ficam abertas
  // pros dois papéis, mas só de verdade acessíveis a um vendedor que tenha
  // a permissão correspondente marcada no cadastro dele (ver
  // utils/permissions.js e views/users.js); admin sempre passa, userCan()
  // cuida disso sozinho em canAccessRoute() logo abaixo.
  compras: { label: 'Compras', icon: icon('cart'), roles: ['admin', 'vendedor'], permission: 'compras', render: renderCompras },
  financeiro: { label: 'Financeiro', icon: icon('dollar'), roles: ['admin', 'vendedor'], permission: 'financeiro', render: renderFinanceiro },
  relatorios: { label: 'Relatórios', icon: icon('trending'), roles: ['admin', 'vendedor'], permission: 'relatorios', render: renderRelatorios },
  usuarios: { label: 'Usuários', icon: icon('users'), roles: ['admin', 'vendedor'], permission: 'usuarios', render: renderUsers },
  logs: { label: 'Log do sistema', icon: icon('clipboard'), roles: ['admin', 'vendedor'], permission: 'logs', render: renderLogs },
  empresa: { label: 'Dados da loja', icon: icon('store'), roles: ['admin', 'vendedor'], permission: 'empresa', render: renderCompanySettings },
  backup: { label: 'Backup', icon: icon('save'), roles: ['admin', 'vendedor'], permission: 'backup', render: renderBackup },
  personalizacao: { label: 'Personalização', icon: icon('palette'), roles: ['admin', 'vendedor'], render: renderPersonalizacao },
  ajuda: { label: 'Ajuda', icon: icon('question'), roles: ['admin', 'vendedor'], render: renderAjuda },
};

let unmountLogin = null;
// Encerra o monitor de inatividade da tela anterior (ver dentro de
// renderShell) — precisa existir fora dela porque renderShell pode ser
// chamada mais de uma vez na mesma sessão (ctx.refreshShell, usado por
// views/company.js ao salvar os dados da loja), e sem isso cada chamada
// empilharia mais um conjunto de listeners de atividade + intervalo,
// nunca desligados.
let stopIdleWatch = null;
// Mesmo motivo do stopIdleWatch logo acima: o listener de resize da barra
// de rolagem do menu (ver dentro de renderShell) é preso a `window`, que
// nunca é recriado como os elementos do shell são — sem isso, cada
// renderShell() empilharia mais um listener de resize nunca desligado.
let stopNavScrollWatch = null;

// boot() pode ser chamado mais de uma vez quase ao mesmo tempo pro MESMO
// evento de login/logout — o próprio login.js chama boot() direto ao
// terminar, e chrome.storage.onChanged (ver onSessionUserIdChanged mais
// abaixo) TAMBÉM dispara boot() reagindo à mesma escrita de sessão, na
// MESMA aba que fez a escrita (não é só um aviso pras outras abas). Duas
// execuções de boot() rodando em paralelo podiam ler o mesmo estado
// "antes" (ex: se este usuário já viu a Ajuda) e tomar decisões
// inconsistentes sobre qual tela mostrar no final — este wrapper serializa
// as chamadas numa fila (nunca em paralelo), garantindo que uma chamada
// redundante sempre vê o resultado já commitado da anterior antes de
// decidir qualquer coisa. O efeito colateral de uma chamada redundante
// continua sendo só um re-render extra (inofensivo), como já era antes —
// só a CONCORRÊNCIA entre elas que precisa deixar de existir.
let bootQueue = Promise.resolve();
function boot() {
  bootQueue = bootQueue.then(bootImpl, bootImpl);
  return bootQueue;
}

// Achado do usuário: só avisar que já tinha outra aba aberta não bastava —
// ele queria a segunda aba REALMENTE bloqueada, não só sinalizada. Nasce
// bloqueada (true) até watchTabPresence (ver rodapé deste arquivo) decidir
// que esta aba é a mais antiga viva no navegador — só então vira false, uma
// única vez, e o app começa a rodar de verdade. Checado aqui dentro do
// bootImpl (não só no ponto que chama boot() a primeira vez) porque boot()
// também é chamado por vários outros gatilhos que independem desta aba ter
// "ganho a eleição" (ex: onSessionUserIdChanged reage a login/logout feito
// em QUALQUER aba) — sem essa checagem aqui dentro, um desses gatilhos
// conseguiria fazer uma aba bloqueada renderizar o app de verdade por
// baixo do pano, contornando o bloqueio.
let tabIsBlocked = true;

async function bootImpl() {
  if (tabIsBlocked) return;
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
  // Idem pro monitor de inatividade do shell principal (ver renderShell).
  if (stopIdleWatch) { stopIdleWatch(); stopIdleWatch = null; }
  root.innerHTML = '<div class="boot-loading"><span class="spinner"></span>Carregando…</div>';

  const [companyRegistered, anyUser] = await Promise.all([isCompanyRegistered(), hasAnyUser()]);
  if (!companyRegistered || !anyUser) {
    // markTrialStartIfNeeded só é chamado NESTE ponto (conclusão do setup,
    // seja cadastro do zero ou restauração de backup) — nunca em nenhum
    // outro boot. Uma instalação que já tinha empresa/usuário cadastrados
    // antes desta função existir nunca passa por aqui de novo, então nunca
    // ganha um trialStartedAt retroativo (ver comentário em licenseRepo.js).
    document.documentElement.classList.add('pre-login-screen');
    renderSetup(root, { onComplete: async () => { await markTrialStartIfNeeded(); return boot(); } });
    return;
  }

  const company = await getCompany();

  // Achado do usuário: restaurar um backup não pode virar atalho pra
  // "burlar" o trial — o CNPJ/dados restaurados não carregam licença
  // nenhuma junto (chrome.storage nunca entra no arquivo de backup, ver
  // licenseRepo.js), então uma instalação recém-restaurada continua sob o
  // mesmo trial de 1h de qualquer instalação nova, a menos que a própria
  // pessoa digite uma chave válida depois (ver "Ativação" em Dados da
  // loja). Instalações que já existiam antes desta função nunca são
  // afetadas (getLicenseStatus nunca bloqueia sem um trialStartedAt
  // gravado).
  const license = await getLicenseStatus(company.cnpj);
  if (!license.active) {
    // Mesma regra do setup/login (ver pre-login-screen abaixo) — sem isso a
    // barra de rolagem nativa do navegador aparecia do lado direito nessa
    // tela também, feia contra o cartão centralizado sozinho na página.
    document.documentElement.classList.add('pre-login-screen');
    renderLicenseBlockedScreen(company);
    return;
  }

  const userId = await getSessionUserId();
  let currentUser = userId ? await getUser(userId) : null;
  if (currentUser && !currentUser.active) currentUser = null;

  if (!currentUser) {
    // Limpa o carrinho de venda em andamento (ver comentário em sale.js)
    // aqui, no único ponto que cobre logout manual, timeout de
    // inatividade e qualquer outro caminho que volte pro login — sem
    // isso, o próximo usuário a logar veria o carrinho de quem saiu.
    resetSaleDraft();
    // onLogin não chama boot() de propósito — login.js já chama
    // setSessionUserId(), que sozinho dispara o listener de sessão (ver
    // onSessionUserIdChanged mais abaixo) e re-renderiza esta aba. Chamar
    // os dois juntos duplicava boot() pro mesmo login (mesmo motivo do
    // logout manual, ver comentário lá).
    document.documentElement.classList.add('pre-login-screen');
    unmountLogin = renderLogin(root, { company, onLogin: () => {} });
    return;
  }

  // Primeiríssimo login deste usuário (Administrador Geral recém-cadastrado
  // ou vendedor novo) — abre direto na Ajuda em vez do Painel, pra ele já
  // aprender a usar o sistema. Marca como visto ANTES de renderizar, então
  // isso só acontece uma única vez na vida da conta, mesmo que o usuário
  // saia da tela imediatamente sem interagir com o conteúdo.
  if (!currentUser.hasSeenAjuda) {
    await markAjudaSeen(currentUser.id);
    currentUser = { ...currentUser, hasSeenAjuda: true };
    location.hash = '#/ajuda';
  }

  document.documentElement.classList.remove('pre-login-screen');
  renderShell(currentUser, company);
}

/** Uma rota é acessível quando o papel bate (admin/vendedor, igual sempre
 * foi) E, se a rota exigir uma permissão específica (ver ROUTES acima), o
 * usuário tiver essa permissão — userCan() já deixa admin passar sempre,
 * sem precisar checar o papel de novo aqui. */
function canAccessRoute(route, user) {
  if (!route.roles.includes(user.role)) return false;
  if (route.permission && !userCan(user, route.permission)) return false;
  return true;
}

function currentRouteKey() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : 'dashboard';
}

function renderShell(user, company) {
  // renderShell pode ser chamada mais de uma vez na mesma sessão
  // (ctx.refreshShell, ver mais abaixo) — encerra o monitor de inatividade
  // da chamada anterior antes de montar um novo, senão cada chamada
  // empilha mais um conjunto de listeners de atividade + intervalo.
  if (stopIdleWatch) { stopIdleWatch(); stopIdleWatch = null; }
  if (stopNavScrollWatch) { stopNavScrollWatch(); stopNavScrollWatch = null; }

  root.innerHTML = `
    <div class="shell">
      <button class="menu-toggle-btn" id="menu-toggle-btn" type="button" aria-label="Abrir menu">${icon('menu', { size: 20 })}</button>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="name">${escapeHtml(company?.nomeFantasia || 'PDV - C&S Virtual')}</div>
          <div class="sub">${escapeHtml(company?.cnpj || '')}</div>
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
      <main class="main" id="main-content"></main>
    </div>
  `;

  // Menu lateral em tela estreita vira uma gaveta (ver breakpoint 900px em
  // styles.css) — o botão de menu e o véu por trás só ficam visíveis nesse modo,
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
    // Sem boot() explícito aqui de propósito — clearSession() já dispara o
    // listener de chrome.storage.onChanged registrado logo abaixo
    // (onSessionUserIdChanged), que roda boot() sozinho, inclusive nesta
    // mesma aba (ver comentário lá). Chamar os dois juntos fazia boot()
    // rodar duas vezes quase ao mesmo tempo pro MESMO logout — mesmo com
    // as chamadas serializadas (ver bootQueue), isso abria uma janela
    // onde um evento de hashchange disparado pela primeira passagem podia
    // ser tratado só depois que a segunda já tinha recriado a tela,
    // achando um #main-content de uma versão já superada. Um gatilho só
    // (o do storage cuida sozinho) elimina a corrida na raiz.
  });

  // ---------- Expira a sessão sozinha depois de 30 min sem nenhuma
  // interação (ver session.js — a atividade é compartilhada entre abas,
  // então só desloga de verdade quando NENHUMA aba teve uso recente). O
  // registro de atividade é limitado a no máximo 1 escrita a cada 15s
  // (mousemove sozinho dispararia dezenas por segundo, sem necessidade
  // nenhuma) — só a CHECAGEM roda a cada 30s, não a escrita. ----------
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

  // stopThisIdleWatch() se refere a SI MESMA por closure (idleCheckInterval,
  // markActivity, ACTIVITY_EVENTS todos capturados diretamente) em vez de
  // chamar a variável de módulo `stopIdleWatch` por nome — de propósito:
  // essa variável é reatribuída a cada renderShell() (login, refreshShell),
  // então se o intervalo de uma chamada ANTIGA ainda estivesse de pé na
  // hora de disparar, chamar `stopIdleWatch()` (o nome) acabaria limpando
  // o intervalo ATUAL (o mais novo), não o de quem disparou — ou pior,
  // encontraria a variável já nula nesse meio-tempo. Cada intervalo só
  // desliga a SI PRÓPRIO, sempre, não importa quantos outros já tenham
  // vindo depois dele.
  function stopThisIdleWatch() {
    clearInterval(idleCheckInterval);
    ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActivity));
    // Só limpa a variável de módulo se ela ainda apontar pra ESTA função —
    // um renderShell mais novo já pode ter posto a dele lá.
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
    // Sem boot() explícito aqui — mesmo motivo do logout manual (ver
    // comentário lá): clearSession() já dispara o listener de sessão
    // sozinho, inclusive nesta aba.
  }, 30000);
  stopIdleWatch = stopThisIdleWatch;

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
      // Sem boot() explícito aqui — mesmo motivo do logout manual (ver
      // comentário lá).
      return;
    }

    if (unmountCurrentRoute) { unmountCurrentRoute(); unmountCurrentRoute = null; }

    // Essa própria função fica presa em window.onhashchange, que sobrevive
    // à troca de innerHTML — então uma mudança de hash feita ENQUANTO um
    // boot() concorrente (ver comentário lá em cima) já reescreveu
    // root.innerHTML por baixo pode acionar esta função depois que
    // #main-content já não existe mais nesta versão da tela. Sem essa
    // checagem, isso derrubava com "Cannot set properties of null".
    const container = document.getElementById('main-content');
    if (!container) return;

    const key = currentRouteKey();
    const route = ROUTES[key];
    navGroup.querySelectorAll('.nav-link').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.route === key);
    });
    // Usa freshUser (não o `user` da closure, potencialmente desatualizado)
    // pra também refletir na hora uma mudança de permissão feita por um
    // admin enquanto esta aba já estava aberta — sem isso, um vendedor
    // perderia (ou ganharia) acesso a uma tela só depois de deslogar e
    // logar de novo, mesma lógica já aplicada ao "ainda está ativo?" acima.
    if (!canAccessRoute(route, freshUser)) {
      container.innerHTML = '<div class="card">Você não tem permissão para acessar esta tela.</div>';
      window.scrollTo(0, 0);
      return;
    }
    container.innerHTML = '';
    // Uma view pode devolver (opcionalmente) uma função de limpeza, que é
    // chamada automaticamente aqui na PRÓXIMA navegação, antes de montar a
    // tela nova — quase nenhuma view precisa disso (só quem registra
    // listener fora do próprio container, ver views/sale.js).
    const cleanup = await route.render(container, ctx);
    if (typeof cleanup === 'function') unmountCurrentRoute = cleanup;
    // Sempre volta pro topo do card ao trocar de tela — sem isso, quem
    // estava rolado lá embaixo numa lista longa (Estoque, Histórico) e
    // clica noutro item do menu via a tela nova já aberta na mesma posição
    // de rolagem de antes, às vezes cortando o título fora da vista.
    window.scrollTo(0, 0);
  }

  window.onhashchange = renderCurrentRoute;
  if (!location.hash) location.hash = '#/dashboard';
  // Sempre chama direto, na hora — nunca depende só do evento assíncrono
  // de hashchange disparado pela linha acima pra decidir o que mostrar.
  // Definir location.hash quando ele estava vazio dispara o evento de
  // qualquer jeito (então isso pode rodar de novo mais tarde, redundante e
  // inofensivo, como o resto do app já tolera) — mas depender só do evento
  // deixava uma janela onde, com boot() concorrente (ver comentário lá em
  // cima), o handler que acabava disparando podia já ser de uma versão
  // superada desta tela. Chamando direto aqui, o #main-content que essa
  // chamada usa é garantidamente o que acabou de ser criado alguns
  // milissegundos atrás, sem depender de ordem entre tarefas assíncronas.
  renderCurrentRoute();
}

// Sessão é compartilhada entre todas as abas da extensão (não é por aba) —
// login/logout numa aba precisa se refletir nas outras. Registrado uma
// única vez aqui (não dentro de boot()/renderShell(), que rodam de novo a
// cada login), senão cada novo login empilharia mais um listener.
onSessionUserIdChanged(() => boot());

// Rede de segurança contra erro inesperado não tratado em algum ponto do
// sistema (uma Promise rejeitada sem .catch, ou uma exceção síncrona fora
// de qualquer try/catch) — achado de auditoria: sem isso, um bug
// imprevisto nessas condições fazia o clique "não fazer nada" pro
// usuário, sem toast nem explicação nenhuma (só um erro no console, que
// ninguém no balcão da loja vai abrir). Não tenta recuperar o estado nem
// adivinhar o que aconteceu — só garante que SEMPRE aparece um aviso
// visível, em vez de falha silenciosa. Limitado a 1 aviso a cada 4s pra
// não empilhar toast repetido se vários erros acontecerem em sequência.
let lastUnexpectedErrorToastAt = 0;

// Achado de auditoria (P1 — "uso contínuo durante todo o expediente"): o
// Chrome pode atualizar a extensão SOZINHO, em segundo plano, sem avisar
// nem fechar as abas já abertas — bem plausível numa aba de PDV que fica
// aberta o turno inteiro. Quando isso acontece, o CONTEXTO desta aba fica
// "órfão": qualquer chamada a chrome.* (chrome.storage.session, usado por
// login/sessão/bloqueio de aba) passa a rejeitar, sempre com o mesmo
// sintoma — e sem essa checagem, cada rejeição só virava mais um toast
// genérico de "erro inesperado" repetido a cada 4s, sem explicar o que
// realmente aconteceu nem o que fazer. `chrome.runtime.id` é a forma
// padrão de detectar isso: vira `undefined` assim que o contexto invalida,
// mesmo sem nenhuma chamada ter sido feita ainda. Aviso PERSISTENTE (não
// um toast que some sozinho) porque este estado não se corrige sozinho —
// só recarregar a aba resolve.
let extensionInvalidatedShown = false;
function handleExtensionInvalidated() {
  if (extensionInvalidatedShown) return;
  extensionInvalidatedShown = true;
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(13,20,17,0.55);padding:20px;';
  banner.innerHTML = `
    <div class="card" style="max-width:440px;text-align:center;">
      <div style="margin-bottom:6px;">${icon('refresh', { size: 34 })}</div>
      <h1 style="font-size:18px;margin:0 0 18px;">A extensão foi atualizada</h1>
      <p style="margin:0 0 14px;">O Chrome atualizou a extensão sozinho enquanto esta janela estava aberta. Esta janela precisa recarregar pra continuar funcionando — nenhum dado foi perdido, é só recarregar mesmo.</p>
      <button class="btn" id="extension-invalidated-reload-btn" type="button">Recarregar agora</button>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('extension-invalidated-reload-btn').addEventListener('click', () => location.reload());
}
function reportUnexpectedError(err) {
  // Checa PRIMEIRO, antes de qualquer outra coisa — um contexto invalidado
  // também quebraria a tentativa de mostrar o toast normal (showToast em
  // si não depende de chrome.*, mas o resto do app ao redor dela sim).
  if (!chrome.runtime?.id) { handleExtensionInvalidated(); return; }
  console.error('[erro não tratado]', err);
  const now = Date.now();
  if (now - lastUnexpectedErrorToastAt < 4000) return;
  lastUnexpectedErrorToastAt = now;
  showToast('Ocorreu um erro inesperado. Tente novamente — se persistir, recarregue a extensão.', 'error');
}
window.addEventListener('unhandledrejection', (event) => reportUnexpectedError(event.reason));
window.addEventListener('error', (event) => reportUnexpectedError(event.error || event.message));

// A aparência (claro/escuro/automático) é escolhida na tela Personalização
// (ver views/personalizacao.js), acessível pelo menu depois de logar — só
// precisa ser aplicada aqui, uma vez, antes do primeiro render, pra abrir
// direto no tema certo sem piscar. Independente do bloqueio de aba abaixo
// — a tela de bloqueio também precisa nascer no tema certo.
(async () => {
  applyTheme(await getThemePreference());
})();

// Botão flutuante "voltar ao topo" — pedido do usuário: precisa ser global
// de verdade, disponível em QUALQUER tela que role (login, cadastro
// inicial, tela de aba bloqueada, app normal), não só dentro do shell já
// logado. O elemento em si vive em index.html, fora de #root (ver
// comentário lá) — sobrevive a qualquer root.innerHTML ser reescrito — e a
// ligação com o scroll é feita uma única vez aqui, também fora de qualquer
// função que possa rodar mais de uma vez (renderShell, boot etc.), então
// não há nada pra desligar/religar nunca: um só listener, pra sempre.
{
  const scrollTopBtn = document.getElementById('scroll-top-btn');
  // Achado do usuário: com um limiar FIXO, o botão nunca aparecia em telas
  // "médias" — longas o bastante pra precisar rolar até o fim com o mouse
  // (ex: Painel, Backup), mas cujo overflow total (scrollHeight -
  // innerHeight, o quanto dá pra rolar de verdade) fica ABAIXO de 400px.
  // Rolar até o fim absoluto de uma tela dessas nunca passava de ~136-375px
  // de scrollY, então `scrollY > 400` nunca virava verdade — o botão ficava
  // permanentemente escondido nessas telas, por mais que o usuário rolasse.
  // O limiar agora se adapta ao quanto CADA tela realmente rola — metade do
  // overflow disponível, sem nunca passar de 400px — recalculado a cada
  // scroll (o roteador reescreve #root com conteúdo de altura diferente a
  // cada navegação, então o overflow de "a tela atual" muda o tempo todo).
  const SCROLL_TOP_SHOW_AT = 400;
  const onScroll = () => {
    const maxScrollY = document.documentElement.scrollHeight - window.innerHeight;
    const showAt = Math.min(SCROLL_TOP_SHOW_AT, maxScrollY / 2);
    const visible = maxScrollY > 0 && window.scrollY > showAt;
    scrollTopBtn.classList.toggle('visible', visible);
    // Enquanto invisível, tira do fluxo de tab/leitor de tela — sem isso
    // um usuário navegando por teclado esbarraria num botão que não dá
    // pra ver nem faz sentido ativar ainda.
    scrollTopBtn.tabIndex = visible ? 0 : -1;
    scrollTopBtn.setAttribute('aria-hidden', String(!visible));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  onScroll(); // estado inicial correto se a página já nascer rolada (ex: refreshShell)
}

// Contato direto (WhatsApp/e-mail) na tela de trial encerrado — achado do
// usuário: "fale com quem te passou o sistema" sozinho não reforçava ONDE
// conseguir a chave. Loja e CNPJ vêm prontos do cadastro (a pessoa nunca
// precisa redigitar o que o sistema já sabe).
const TRIAL_SUPPORT_WHATSAPP = '5571986461027'; // 71 98646-1027, formato E.164 pro link wa.me
const TRIAL_SUPPORT_EMAIL = 'csvirtual.av@gmail.com';

function trialContactMessage(company) {
  return `Olá! Testei o sistema PDV - C&S Virtual e meu período de teste encerrou. Gostaria de saber mais sobre a ativação.\n\nLoja: ${company.nomeFantasia}\nCNPJ: ${company.cnpj}`;
}

function trialContactChipsHtml(company) {
  return `
    <div style="display:flex;gap:10px;margin-bottom:14px;">
      <div style="flex:1;background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 11px;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">Loja</div>
        <div style="font-size:13.5px;font-weight:600;">${escapeHtml(company.nomeFantasia)}</div>
      </div>
      <div style="flex:1;background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 11px;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">CNPJ</div>
        <div style="font-size:13.5px;font-weight:600;">${escapeHtml(company.cnpj)}</div>
      </div>
    </div>
  `;
}

function openTrialWhatsappModal(company) {
  const message = trialContactMessage(company);
  openModal({
    title: 'Contato via WhatsApp',
    centerTitle: true,
    centerActions: true,
    submitLabel: `${icon('whatsapp', { size: 15 })} Abrir WhatsApp`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);line-height:1.5;text-align:center;">Vamos abrir uma conversa com o suporte no WhatsApp, já com a mensagem abaixo pronta pra enviar.</p>
      ${trialContactChipsHtml(company)}
      <div style="background:var(--surface-alt);border-radius:var(--radius-sm);padding:12px 14px;font-size:12.5px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>
    `,
    onSubmit: () => {
      window.open(`https://wa.me/${TRIAL_SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      return true;
    },
  });
}

function openTrialEmailModal(company) {
  const message = trialContactMessage(company);
  openModal({
    title: 'Contato por e-mail',
    centerTitle: true,
    centerActions: true,
    submitLabel: `${icon('mail', { size: 15 })} Enviar e-mail`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:13.5px;color:var(--text-muted);line-height:1.5;text-align:center;">Confirme seu e-mail e clique em enviar — seu programa de e-mail abre com a mensagem pronta pra <strong>${escapeHtml(TRIAL_SUPPORT_EMAIL)}</strong>.</p>
      ${trialContactChipsHtml(company)}
      <div id="trial-email-error"></div>
      <div class="field">
        <label for="trial-contact-email">Seu e-mail para contato *</label>
        <input id="trial-contact-email" type="email" placeholder="seuemail@exemplo.com" value="${escapeHtml(company.email || '')}">
      </div>
    `,
    onSubmit: (modalEl) => {
      const input = modalEl.querySelector('#trial-contact-email');
      const contactEmail = input.value.trim();
      if (!contactEmail || !contactEmail.includes('@')) {
        modalEl.querySelector('#trial-email-error').innerHTML = '<div class="form-error">Informe um e-mail válido.</div>';
        return false;
      }
      const subject = `Solicitação de chave de ativação — ${company.nomeFantasia}`;
      const body = `${message}\nE-mail para contato: ${contactEmail}`;
      window.location.href = `mailto:${TRIAL_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return true;
    },
  });
}

// Tela de bloqueio por trial expirado (sem chave de ativação válida
// guardada). Tem campo pra colar a chave na hora — sem isso a pessoa
// ficaria travada aqui sem nenhum jeito de sair, mesmo já tendo comprado.
function renderLicenseBlockedScreen(company) {
  root.innerHTML = `
    <div class="boot-loading">
      <div class="card" style="max-width:440px;">
        <h1 style="font-size:18px;margin:0 0 18px;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Período de teste encerrado</h1>
        <p style="margin:0 0 14px;text-align:center;">O período de teste de 1 hora deste sistema encerrou. Entre em contato pelo WhatsApp ou e-mail abaixo pra receber sua chave de ativação — é rápido.</p>
        <div style="display:flex;justify-content:center;gap:22px;margin:0 0 16px;">
          <div style="text-align:center;">
            <button type="button" class="contact-icon-btn" id="license-whatsapp-btn" title="Falar no WhatsApp">${icon('whatsapp', { size: 42 })}</button>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">WhatsApp</div>
          </div>
          <div style="text-align:center;">
            <button type="button" class="contact-icon-btn" id="license-email-btn" title="Enviar e-mail">${icon('mail', { size: 42 })}</button>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">E-mail</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin:0 0 16px;color:var(--text-muted);font-size:12px;">
          <div style="flex:1;height:1px;background:var(--border);"></div>ou<div style="flex:1;height:1px;background:var(--border);"></div>
        </div>
        <div id="license-error"></div>
        <div class="field" style="text-align:center;gap:10px;">
          <label for="license-key-input">Já tem uma chave? Cole aqui</label>
          <input id="license-key-input" placeholder="Cole a chave de ativação" style="text-align:center;">
        </div>
        <button class="btn" id="license-activate-btn" style="width:100%;">Ativar</button>
      </div>
    </div>
  `;
  document.getElementById('license-whatsapp-btn').addEventListener('click', () => openTrialWhatsappModal(company));
  document.getElementById('license-email-btn').addEventListener('click', () => openTrialEmailModal(company));
  document.getElementById('license-activate-btn').addEventListener('click', async () => {
    const errBox = document.getElementById('license-error');
    errBox.innerHTML = '';
    const input = document.getElementById('license-key-input');
    const btn = document.getElementById('license-activate-btn');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    const result = await verifyLicenseKey(input.value, company.cnpj);
    // Achado de auditoria: sem checar o tipo aqui, um código de liberação
    // de CNPJ (tipo 'cnpj-unlock' — pensado só pra destravar o campo por
    // 24h) tem assinatura e CNPJ igualmente válidos, e seria aceito como
    // se fosse chave de ativação — virando "Definitiva" pra sempre em
    // data/licenseRepo.js#getLicenseStatus (que trata "não é demo" como
    // "é full"). Os dois tipos de código têm o mesmo formato assinado, só
    // o campo 'tipo' dentro do payload diferencia — precisa checar aqui.
    if (!result.valid || (result.tipo !== 'demo' && result.tipo !== 'full')) {
      const reason = result.valid ? 'Esse código não é uma chave de ativação (é um código de outro tipo).' : result.reason;
      errBox.innerHTML = `<div class="form-error">${escapeHtml(reason)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Ativar';
      return;
    }
    await setStoredActivationKey(input.value.trim());
    await logAction({
      userId: null, userName: 'Ativação (tela de bloqueio)', role: 'admin',
      action: 'Chave de ativação aplicada',
      details: `Licença ativada via tela de bloqueio (tipo: ${result.tipo}) para o CNPJ ${company.cnpj}.`,
      entity: 'license', entityId: 'main',
    });
    showToast('Chave ativada com sucesso!', 'success');
    boot();
  });
}

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

// Impede o sistema de rodar em mais de uma aba ao mesmo tempo (ver
// tabPresence.js pro mecanismo completo). Chama de volta uma vez logo de
// início e depois a cada poucos segundos, sempre que o resultado da
// "eleição" entre as abas abertas pode ter mudado.
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
