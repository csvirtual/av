// Ponto de entrada do app. Decide qual tela mostrar (setup → login → shell
// principal) e, depois de logado, cuida do roteamento entre as telas do
// sistema (estoque, venda, histórico, usuários, logs, empresa) dentro da
// mesma aba — sem framework, só JS de módulo nativo.
import { isCompanyRegistered, getCompany } from './data/companyRepo.js';
import { hasAnyUser, getUser, markAjudaSeen } from './data/usersRepo.js';
import { getSessionUserId, clearSession, onSessionUserIdChanged, touchActivity, getIdleMs, IDLE_LIMIT_MS } from './session.js';
import { logAction } from './data/auditRepo.js';
import { showToast } from './components/toast.js';
import { confirmDialog, closeAllModals } from './components/modal.js';
import { escapeHtml } from './utils/format.js';
import { getThemePreference, applyTheme } from './theme.js';
import { registerTabAndCheckDuplicate } from './tabPresence.js';

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
// Encerra o monitor de inatividade da tela anterior (ver dentro de
// renderShell) — precisa existir fora dela porque renderShell pode ser
// chamada mais de uma vez na mesma sessão (ctx.refreshShell, usado por
// views/company.js ao salvar os dados da loja), e sem isso cada chamada
// empilharia mais um conjunto de listeners de atividade + intervalo,
// nunca desligados.
let stopIdleWatch = null;

// Mesmo motivo do stopIdleWatch acima: o botão "voltar ao topo" escuta
// scroll na window (que sobrevive a root.innerHTML ser reescrito), então
// precisa ser desligado explicitamente antes de renderShell montar um novo
// — senão cada chamada empilharia mais um listener de scroll.
let stopScrollTopWatch = null;

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

async function bootImpl() {
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

  renderShell(currentUser, company);
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
  if (stopScrollTopWatch) { stopScrollTopWatch(); stopScrollTopWatch = null; }

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
    <button class="scroll-top-btn" id="scroll-top-btn" type="button" aria-label="Voltar ao topo" title="Voltar ao topo">↑</button>
  `;

  // Botão flutuante "voltar ao topo" — funciona em qualquer tela (fica
  // fora de #main-content, então sobrevive à troca de rota) e só aparece
  // quando há de fato o que rolar: some sozinho perto do topo da página,
  // pra não ficar poluindo telas curtas que não precisam dele.
  const scrollTopBtn = document.getElementById('scroll-top-btn');
  const SCROLL_TOP_SHOW_AT = 400;
  const onScroll = () => {
    scrollTopBtn.classList.toggle('visible', window.scrollY > SCROLL_TOP_SHOW_AT);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  onScroll(); // estado inicial correto se o shell já nascer rolado (ex: refreshShell)
  stopScrollTopWatch = () => window.removeEventListener('scroll', onScroll);

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
    if (!route.roles.includes(user.role)) {
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
function reportUnexpectedError(err) {
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
// direto no tema certo sem piscar.
(async () => {
  applyTheme(await getThemePreference());
  boot();
})();

// Aviso de aba duplicada — roda em paralelo com o boot acima (não atrasa o
// primeiro carregamento por causa disso). Aparece uma vez, ao abrir esta
// aba, só se OUTRA aba do sistema já estiver aberta no navegador; não
// bloqueia nada — os dois continuam funcionando normalmente, é só um
// aviso pra quem esqueceu uma aba antiga aberta sem perceber. Some
// sozinho em 5s, como qualquer toast (ver components/toast.js).
registerTabAndCheckDuplicate().then((isDuplicate) => {
  if (isDuplicate) showToast('O sistema já está aberto em outra aba deste navegador.', 'info');
});
