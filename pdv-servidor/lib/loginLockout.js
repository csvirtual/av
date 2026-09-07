// Fase 8 (segurança): bloqueio temporário por força bruta — depois de 2
// tentativas de login incorretas seguidas para o MESMO usuário, a conta fica
// bloqueada por 60s antes de liberar de novo. Portado de app/js/
// loginLockout.js (chrome.storage.local lá) — aqui vira um Map em memória
// do PROCESSO do servidor: dado de controle efêmero (não entra em backup,
// não sobrevive a um restart), e faz ainda mais sentido centralizado no
// servidor do que na extensão — protege a conta contra tentativas vindas de
// QUALQUER terminal da loja, não só de um navegador isolado.
const MAX_ATTEMPTS = 2;
const LOCK_DURATION_MS = 60 * 1000;

const state = new Map(); // usernameLower -> { failedAttempts, lockedUntil }

function keyFor(username) {
  return String(username || '').trim().toLowerCase();
}

function toState(raw) {
  const activelyLocked = !!(raw?.lockedUntil && raw.lockedUntil > Date.now());
  return {
    failedAttempts: raw?.failedAttempts || 0,
    lockedUntil: activelyLocked ? raw.lockedUntil : null,
    remainingMs: activelyLocked ? raw.lockedUntil - Date.now() : 0,
  };
}

/** Estado atual pro nome de usuário informado — não muda nada, só lê. */
export function getLoginLockState(username) {
  if (!username) return toState(null);
  return toState(state.get(keyFor(username)));
}

/** Registra uma tentativa incorreta e devolve o novo estado. Ao atingir
 * MAX_ATTEMPTS, calcula o bloqueio; se o bloqueio anterior já tinha vencido,
 * começa a contagem de novo. */
export function recordFailedLogin(username) {
  const key = keyFor(username);
  const prev = state.get(key) || { failedAttempts: 0, lockedUntil: null };
  const activelyLocked = prev.lockedUntil && prev.lockedUntil > Date.now();
  if (activelyLocked) return toState(prev); // defensivo — não deveria ser alcançável normalmente

  const lockExpired = !!(prev.lockedUntil && prev.lockedUntil <= Date.now());
  const failedAttempts = lockExpired ? 1 : (prev.failedAttempts || 0) + 1;
  const lockedUntil = failedAttempts >= MAX_ATTEMPTS ? Date.now() + LOCK_DURATION_MS : null;
  const next = { failedAttempts, lockedUntil };
  state.set(key, next);
  return toState(next);
}

/** Limpa o histórico de tentativas — chamado depois de um login bem-sucedido. */
export function clearLoginLock(username) {
  if (!username) return;
  state.delete(keyFor(username));
}

export { MAX_ATTEMPTS, LOCK_DURATION_MS };
