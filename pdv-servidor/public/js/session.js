// Sessão do usuário logado — versão multi-terminal (servidor).
//
// Contrato idêntico ao session.js da extensão single-machine
// (pdv-extension/app/js/session.js), de propósito: é o que permite as
// telas reais (views/*.js, components/*.js) serem portadas pra cá sem
// reescrita — elas só importam `getSessionUserId`, `setSessionUserId`,
// `onSessionUserIdChanged`, `clearSession`, `getPendingCredit`/
// `setPendingCredit`/`clearPendingCredit`/`addPendingCredit`,
// `touchActivity`/`getIdleMs`/`IDLE_LIMIT_MS` — nunca importam ESTE
// arquivo sabendo se é chrome.storage.session ou isto aqui.
//
// A autenticação de verdade mora no servidor (cookie httpOnly de sessão,
// ver lib/session.js + routes/auth.js) — o que muda aqui é só ONDE o
// "quem está logado nesta aba" fica guardado no navegador:
//   - extensão: chrome.storage.session (efêmero, compartilhado entre
//     abas da extensão, dispara chrome.storage.onChanged em TODAS as
//     abas — inclusive a que fez a mudança).
//   - aqui: cache em memória (rápido, evita bater no servidor a cada
//     getSessionUserId()) + localStorage (compartilha entre abas do
//     mesmo navegador) + um pub/sub local (pra replicar o "dispara
//     inclusive na própria aba" — o evento nativo `storage` do
//     navegador NUNCA dispara na aba que escreveu, só nas outras; sem
//     esse pub/sub local, login.js pararia de funcionar, porque conta
//     com onSessionUserIdChanged reagindo na própria aba que logou —
//     ver o comentário "onLogin não chama boot() de propósito" em
//     app.js da extensão).
//
// O valor cacheado aqui é só uma DICA pra render rápido — nunca a fonte
// de verdade de autorização. Toda rota da API (ver server.js) resolve o
// usuário de novo a partir do cookie (`resolveSession`), nunca confia em
// nada que o cliente mandou — mesmo princípio de "nunca confiar em quem
// está chamando" já aplicado em toda a extensão single-machine.

const USER_ID_KEY = 'session.userId';
const CREDIT_KEY = 'session.pendingCredit';
const ACTIVITY_KEY = 'session.lastActivityAt';

let cachedUserId; // undefined = ainda não hidratado nesta aba/carregamento
let hydrating = null; // Promise em voo, pra não disparar /api/auth/me duas vezes se getSessionUserId() for chamado em paralelo antes da 1ª resposta voltar.

const localListeners = new Set();

// Evento nativo do navegador: dispara nas OUTRAS abas quando este mesmo
// navegador muda `localStorage` — é o mecanismo real de sincronização
// entre abas aqui (não existe rede nem servidor nisso, é só o próprio
// navegador avisando).
window.addEventListener('storage', (e) => {
  if (e.key === USER_ID_KEY) {
    cachedUserId = e.newValue || null;
    localListeners.forEach((cb) => cb());
  }
});

function notifyLocal() {
  localListeners.forEach((cb) => cb());
}

export async function getSessionUserId() {
  if (cachedUserId !== undefined) return cachedUserId;
  if (!hydrating) {
    hydrating = fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        cachedUserId = body?.user?.id || null;
        return cachedUserId;
      })
      .catch(() => {
        // Servidor fora do ar / rede caiu no meio da sessão: trata como
        // deslogado (mesma postura seria mostrar a tela de login) em vez
        // de travar a tela numa Promise que nunca resolve.
        cachedUserId = null;
        return cachedUserId;
      })
      .finally(() => { hydrating = null; });
  }
  return hydrating;
}

/** Registra que ESTA aba já sabe quem está logado — chamado depois de um
 * POST /api/auth/login já ter tido sucesso (a autenticação de verdade já
 * aconteceu nesse fetch; isto aqui só atualiza o cache local e avisa
 * quem está ouvindo, igual ao chrome.storage.session.set() da extensão,
 * que também nunca autentica nada sozinho). */
export async function setSessionUserId(userId) {
  cachedUserId = userId;
  localStorage.setItem(USER_ID_KEY, userId);
  notifyLocal(); // dispara na PRÓPRIA aba (login.js depende disto — ver comentário no topo)
}

/** Chama `callback()` toda vez que o usuário logado mudar — nesta aba OU
 * em qualquer outra aba deste mesmo navegador. Devolve uma função pra
 * remover o listener. */
export function onSessionUserIdChanged(callback) {
  localListeners.add(callback);
  return () => localListeners.delete(callback);
}

export async function clearSession() {
  // O servidor precisa apagar o token de verdade (tabela `sessions`) e
  // limpar o cookie — sem isso, alguém com o cookie antigo (ex: copiado
  // antes do logout) continuaria autenticado no servidor mesmo com esta
  // aba achando que deslogou. Ignora erro de rede (se o servidor já
  // caiu, não tem sessão pra derrubar mesmo) — o importante é sempre
  // limpar o lado do cliente abaixo.
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* servidor inacessível — segue limpando o lado do cliente mesmo assim */ }
  cachedUserId = null;
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(CREDIT_KEY);
  notifyLocal();
}

// ---------- Crédito de troca pendente ----------
// Mesmo papel do bloco equivalente na extensão single-machine: gerado ao
// estornar uma venda marcando "gerar crédito de troca", disponível como
// forma de pagamento na próxima venda do mesmo turno, limpo no logout
// (acima) pra não vazar pro próximo vendedor que usar este terminal.
//
// Diferença assumida conscientemente: chrome.storage.session nunca
// sobrevive a fechar o navegador; localStorage sobrevive. Não é um
// problema de verdade aqui porque a proteção real sempre foi o clearSession()
// no logout (acima), não o navegador fechar — um turno que nunca desloga
// também nunca perderia o crédito na extensão, mesmo com o navegador
// aberto o dia inteiro. Documentado aqui pra não ser "redescoberto" como
// bug mais tarde.
export async function getPendingCredit() {
  const raw = localStorage.getItem(CREDIT_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setPendingCredit(credit) {
  localStorage.setItem(CREDIT_KEY, JSON.stringify(credit));
}

export async function clearPendingCredit() {
  localStorage.removeItem(CREDIT_KEY);
}

export async function addPendingCredit({ amount, sourceSaleId = null, sourceRefundId = null, reason }) {
  const existing = await getPendingCredit();
  const credit = existing && existing.amount > 0
    ? {
      amount: existing.amount + amount,
      sourceSaleId: sourceSaleId ?? existing.sourceSaleId,
      sourceRefundId: sourceRefundId ?? existing.sourceRefundId,
      reason: `${existing.reason} + ${reason}`,
    }
    : { amount, sourceSaleId, sourceRefundId, reason };
  await setPendingCredit(credit);
  return credit;
}

// ---------- Expiração por inatividade ----------
// Mesmo propósito e mesmo limite (30min) da extensão single-machine —
// encerra a sessão sozinha se ninguém mexer no terminal. localStorage
// aqui tem o mesmo papel do chrome.storage.session de lá: compartilhado
// entre todas as abas deste terminal, então mexer numa aba já conta como
// atividade pras outras (só expira quando NENHUMA aba deste terminal
// teve interação nos últimos 30min).
export const IDLE_LIMIT_MS = 30 * 60 * 1000;

export async function touchActivity() {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export async function getIdleMs() {
  const raw = localStorage.getItem(ACTIVITY_KEY);
  return raw ? Date.now() - Number(raw) : 0;
}
