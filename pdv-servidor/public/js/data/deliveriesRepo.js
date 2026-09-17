// Carreto (entregas) — versão multi-terminal. `createDelivery` (Fase 9
// passo 4) é o que views/sale.js chama (botão "Finalizar venda +
// carreto"); `listDeliveries` (passo 9) é o que o Painel usa pra contar
// carretos pendentes; `markDelivered`/`cancelDelivery` (passo 10) são o
// que views/carreto.js precisa.
import { api, newDedupeKey } from './apiClient.js';

/** Lista completa de carretos, mais recente primeiro — mesmo contrato de
 * listDeliveries() da extensão. */
export async function listDeliveries() {
  const { deliveries } = await api('/api/deliveries');
  return deliveries;
}

export async function createDelivery({
  userId, userName, // aceitos só pra bater a assinatura da extensão — servidor sempre resolve quem criou pela sessão real
  customerId, items, address = '', responsible = '', notes = '', saleId = null, dedupeKey = null,
}) {
  void userId; void userName;
  const { delivery } = await api('/api/deliveries', {
    method: 'POST',
    body: JSON.stringify({ customerId, items, address, responsible, notes, saleId, dedupeKey: dedupeKey || newDedupeKey() }),
  });
  return delivery;
}

/** Marca um carreto pendente como entregue — mesmo contrato de
 * markDelivered() da extensão. `userId`/`userName` aceitos só pra bater a
 * assinatura: o servidor sempre resolve quem entregou pela sessão real
 * (ver routes/deliveries.js#commitTransition). A checagem "ainda está
 * pendente?" e a gravação da transição acontecem na mesma transação
 * atômica no servidor — duas máquinas tentando entregar/cancelar o MESMO
 * carreto ao mesmo tempo nunca conseguem as duas passar. */
export async function markDelivered(id, { userId, userName } = {}) {
  void userId; void userName;
  const { delivery } = await api(`/api/deliveries/${encodeURIComponent(id)}/entregar`, { method: 'POST' });
  return delivery;
}

/** Cancela um carreto pendente — mesmo contrato de cancelDelivery() da
 * extensão. */
export async function cancelDelivery(id) {
  const { delivery } = await api(`/api/deliveries/${encodeURIComponent(id)}/cancelar`, { method: 'POST' });
  return delivery;
}
