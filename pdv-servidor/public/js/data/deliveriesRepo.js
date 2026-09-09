// Carreto (entregas) — versão multi-terminal. `createDelivery` (Fase 9
// passo 4) é o que views/sale.js chama (botão "Finalizar venda +
// carreto"); `listDeliveries` (passo 9) é o que o Painel usa pra contar
// carretos pendentes. `markDelivered`/`cancelDelivery` (usados por uma
// futura views/carreto.js portada) ficam pra quando essa tela for a vez.
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
