// Carreto (entregas) — versão multi-terminal. Escopo desta primeira
// fatia: só `createDelivery`, o que views/sale.js chama (botão
// "Finalizar venda + carreto"). `listDeliveries`/`markDelivered`/
// `cancelDelivery` (usados por uma futura views/carreto.js portada)
// ficam pra quando essa tela for a vez.
import { api, newDedupeKey } from './apiClient.js';

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
