// Bloqueio temporário do campo de senha por força bruta: depois de 2
// tentativas de login incorretas seguidas para o MESMO usuário, o campo de
// senha fica bloqueado por 60 segundos antes de liberar de novo (ver
// views/login.js, que consome este módulo).
//
// Guardado em chrome.storage.local — não junto do registro do usuário no
// IndexedDB — de propósito: é dado de controle efêmero (não precisa entrar
// em backup, nem sobreviver a uma troca de senha do usuário), e funciona do
// mesmo jeito pra um nome de usuário que nem existe, sem precisar consultar
// o banco. Isso também evita que a proteção revele se uma conta existe ou
// não só pelo comportamento (login errado numa conta inexistente bloqueia
// exatamente igual a uma conta real).
//
// Uma chave por nome de usuário (normalizado, minúsculo) — tentativas contra
// contas diferentes não se misturam.
//
// Achado de auditoria (P1): `namespace` existe porque este módulo também é
// usado (via usersRepo.js#verifyLogin) por três telas que NÃO são o login —
// aprovar desconto acima do limite (views/sale.js), fechar caixa
// (views/caixa.js) e zerar dados (views/backup.js) — todas pedindo a
// senha de um administrador pra confirmar uma ação sensível. Sem
// namespace, as três compartilhavam a MESMA trava do login de verdade: um
// vendedor errando a senha do admin 2x num desses modais bloqueava o login
// do admin de verdade por 60s, sem o admin nunca ter tentado logar —
// um jeito indireto (e repetível à vontade) de negar acesso ao próprio
// admin. Cada chamador agora tem sua própria trava, isolada por
// namespace — a proteção contra força bruta continua existindo em cada
// uma, só não vazam mais bloqueio umas pras outras.
const MAX_ATTEMPTS = 2;
const LOCK_DURATION_MS = 60 * 1000;

function keyFor(username, namespace = 'loginLockout') {
  return `${namespace}:${(username || '').trim().toLowerCase()}`;
}

/** Achado de auditoria (severidade baixa): recordFailedLogin faz um
 * get-then-set em chrome.storage.local, que não tem transação atômica
 * (diferente do IndexedDB — ver db.js#dbUpdate). Duas chamadas
 * disparadas quase juntas pro MESMO usuário (ex: um script automatizando
 * tentativas de senha bem rápido) podiam ler o mesmo `failedAttempts`
 * antes de qualquer uma escrever, e a segunda escrita "pisava" na
 * primeira — na prática, um jeito de nunca alcançar MAX_ATTEMPTS mesmo
 * errando a senha repetidas vezes. Serializa as chamadas nesta mesma
 * aba (a extensão já impede mais de uma aba aberta ao mesmo tempo, ver
 * tabPresence.js) numa fila simples, pra cada get+set rodar sozinho do
 * início ao fim antes do próximo começar. */
let lockoutQueue = Promise.resolve();
function serialized(fn) {
  const result = lockoutQueue.then(fn, fn);
  lockoutQueue = result.then(() => {}, () => {});
  return result;
}

function toState(raw) {
  const state = raw || { failedAttempts: 0, lockedUntil: null };
  const activelyLocked = !!(state.lockedUntil && state.lockedUntil > Date.now());
  return {
    failedAttempts: state.failedAttempts || 0,
    lockedUntil: activelyLocked ? state.lockedUntil : null,
    remainingMs: activelyLocked ? state.lockedUntil - Date.now() : 0,
  };
}

/** Estado atual pro nome de usuário informado — não muda nada, só lê. Usado
 * pra refletir um bloqueio já em andamento assim que o usuário digita o
 * nome (inclusive depois de recarregar a página no meio da espera). */
export async function getLoginLockState(username, namespace) {
  if (!username) return toState(null);
  const key = keyFor(username, namespace);
  const data = await chrome.storage.local.get(key);
  return toState(data[key]);
}

/** Registra uma tentativa de senha incorreta e devolve o novo estado (mesmo
 * formato de getLoginLockState). Ao atingir MAX_ATTEMPTS, calcula o
 * bloqueio; se o bloqueio anterior já tinha vencido, começa a contagem de
 * novo (não nasce bloqueado de novo por causa de tentativas antigas). */
export async function recordFailedLogin(username, namespace) {
  return serialized(async () => {
    const key = keyFor(username, namespace);
    const data = await chrome.storage.local.get(key);
    const prev = data[key] || { failedAttempts: 0, lockedUntil: null };

    const activelyLocked = prev.lockedUntil && prev.lockedUntil > Date.now();
    if (activelyLocked) {
      // Não deveria ser alcançável pela UI normal (o campo de senha fica
      // desabilitado durante o bloqueio) — defensivamente, não estende nem
      // reinicia o bloqueio já em andamento.
      return toState(prev);
    }

    const lockExpired = !!(prev.lockedUntil && prev.lockedUntil <= Date.now());
    const failedAttempts = lockExpired ? 1 : (prev.failedAttempts || 0) + 1;
    const lockedUntil = failedAttempts >= MAX_ATTEMPTS ? Date.now() + LOCK_DURATION_MS : null;

    const next = { failedAttempts, lockedUntil };
    await chrome.storage.local.set({ [key]: next });
    return toState(next);
  });
}

/** Limpa o histórico de tentativas — chamado depois de um login bem-sucedido,
 * pra não carregar tentativas erradas antigas pro próximo turno. */
export async function clearLoginLock(username, namespace) {
  if (!username) return;
  await chrome.storage.local.remove(keyFor(username, namespace));
}

export { MAX_ATTEMPTS };
