// Achado de auditoria (DRY): o mesmo markup de "carregando" (spinner +
// texto) estava copiado como string solta em dashboard.js, logs.js,
// salesHistory.js (envolto num `.card`, pra ocupar a tela toda enquanto a
// view principal carrega) e clientes.js (sem `.card`, porque ali é o
// corpo de um modal já com seu próprio card). Fonte única com o wrapper
// como parâmetro em vez de duas cópias quase iguais.
export function loadingStateHtml(message = 'Carregando…', { card = true } = {}) {
  const inner = `<span class="spinner"></span>${message}`;
  return card ? `<div class="card loading-state">${inner}</div>` : `<div class="loading-state">${inner}</div>`;
}
