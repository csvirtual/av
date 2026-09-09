// Caixa — versão multi-terminal. Escopo desta primeira fatia: só
// `getOpenSession`, o que views/sale.js lê (pra saber se existe caixa
// aberto, quando a política "exigir caixa aberto pra vender" estiver
// ligada). `openSession`/`recordMovement`/`closeSession` (usados por uma
// futura views/caixa.js portada) ficam pra quando essa tela for a vez.
import { api } from './apiClient.js';

/** Devolve a sessão de caixa aberta NESTE terminal (ou `null`) — mesmo
 * contrato de app/js/data/cashRepo.js#getOpenSession() da extensão
 * (single-machine sempre tinha um caixa só pra loja toda; aqui pode ser
 * "só deste terminal" dependendo do modo configurado, ver routes/cash.js
 * — a rota já resolve isso pelo cabeçalho X-Terminal-Id, ver
 * apiClient.js). */
export async function getOpenSession() {
  const { session } = await api('/api/cash/open');
  return session;
}
