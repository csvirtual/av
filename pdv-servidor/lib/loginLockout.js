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

// Achado do usuário: o Painel de Controle (admin.<domínio>) fica exposto na
// internet, diferente do login normal da loja (rede interna) — um
// bloqueio fixo de 60s não desanima um ataque de força bruta de verdade,
// só o deixa mais lento. Nesses namespaces, cada NOVO bloqueio (depois que
// o anterior já venceu e a pessoa errou de novo) dobra de duração a partir
// do último — 60s, 2min, 4min, 8min... até o teto abaixo — em vez de
// voltar sempre pro mesmo 60s. Escopado por namespace (não pro login da
// loja nem pras confirmações de senha pontuais, ver comentário de keyFor)
// porque escalar ali também puniria um vendedor comum que só errou a
// senha por engano, sem ataque nenhum por trás.
const PROGRESSIVE_NAMESPACES = new Set(['platform-admin']);
const MAX_LOCK_DURATION_MS = 30 * 60 * 1000;

const state = new Map(); // "namespace:usernameLower" -> { failedAttempts, lockedUntil, lockCount }

// Achado de auditoria (Fase 9, ao portar passwordConfirm.js): sem
// `namespace`, um vendedor errando a senha de admin 2x no modal de
// aprovação de desconto (routes/sales.js) bloqueava o LOGIN DE VERDADE
// daquele admin por 60s — repetível à vontade, um jeito indireto de negar
// acesso ao próprio admin. Cada confirmação sensível (aprovação de
// desconto, fechar caixa, restaurar backup — quando existirem aqui)
// precisa da própria trava, separada da tela de login real (que não
// passa namespace nenhum — `undefined` vira só mais uma chave de texto
// fixa, `'undefined:usuario'`, nunca colide com um namespace nomeado de
// verdade). Mesmo raciocínio de app/js/loginLockout.js da extensão.
function keyFor(username, namespace) {
  return `${namespace || ''}:${String(username || '').trim().toLowerCase()}`;
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
export function getLoginLockState(username, namespace) {
  if (!username) return toState(null);
  return toState(state.get(keyFor(username, namespace)));
}

/** Registra uma tentativa incorreta e devolve o novo estado. Ao atingir
 * MAX_ATTEMPTS, calcula o bloqueio; se o bloqueio anterior já tinha vencido,
 * começa a contagem de novo (com duração maior que da última vez, nos
 * namespaces em PROGRESSIVE_NAMESPACES — ver comentário lá em cima). */
export function recordFailedLogin(username, namespace) {
  const key = keyFor(username, namespace);
  const prev = state.get(key) || { failedAttempts: 0, lockedUntil: null, lockCount: 0 };
  const activelyLocked = prev.lockedUntil && prev.lockedUntil > Date.now();
  if (activelyLocked) return toState(prev); // defensivo — não deveria ser alcançável normalmente

  const lockExpired = !!(prev.lockedUntil && prev.lockedUntil <= Date.now());
  const failedAttempts = lockExpired ? 1 : (prev.failedAttempts || 0) + 1;
  let lockCount = prev.lockCount || 0;
  let lockedUntil = null;
  if (failedAttempts >= MAX_ATTEMPTS) {
    lockCount += 1;
    const duration = PROGRESSIVE_NAMESPACES.has(namespace)
      ? Math.min(LOCK_DURATION_MS * 2 ** (lockCount - 1), MAX_LOCK_DURATION_MS)
      : LOCK_DURATION_MS;
    lockedUntil = Date.now() + duration;
  }
  const next = { failedAttempts, lockedUntil, lockCount };
  state.set(key, next);
  return toState(next);
}

/** Limpa o histórico de tentativas — chamado depois de um login bem-sucedido. */
export function clearLoginLock(username, namespace) {
  if (!username) return;
  state.delete(keyFor(username, namespace));
}

export { MAX_ATTEMPTS, LOCK_DURATION_MS };
