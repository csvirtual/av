// Histórico de movimentações de estoque — versão multi-terminal, mesmo
// contrato de app/js/data/stockRepo.js da extensão single-machine. Ver
// routes/products.js#commitMovement pra onde a atomicidade de verdade
// (baixa de estoque + registro da movimentação na mesma transação) e a
// deduplicação por dedupeKey realmente acontecem — aqui é só a chamada.
//
// `userId`/`userName` continuam aceitos aqui (views/products.js sempre
// manda `ctx.user.id`/`ctx.user.nome`, ver views/products.js#openHistoryModal
// e vizinhos) só pra manter a MESMA assinatura da extensão e a tela
// funcionar sem reescrita — mas nunca são enviados ao servidor: quem
// registrou a movimentação é sempre resolvido lá, a partir do cookie de
// sessão de verdade (req.userId/req.userName em server.js), nunca do que
// o cliente afirma ser. Mesmo motivo de session.js nunca ser a fonte de
// verdade de autorização (ver comentário no topo daquele arquivo).
import { api, newDedupeKey } from './apiClient.js';

export async function recordMovement({ productId, type, qty, note = '', dedupeKey = null }) {
  const { product, movement } = await api(`/api/products/${encodeURIComponent(productId)}/movimentos`, {
    method: 'POST',
    body: JSON.stringify({ type, qty, note, dedupeKey: dedupeKey || newDedupeKey() }),
  });
  void product; // devolvido pelo servidor só pra quem quiser atualizar a UI direto; a chamadora típica já recarrega a lista à parte
  return movement;
}

export async function listMovementsByProduct(productId) {
  const { movements } = await api(`/api/products/${encodeURIComponent(productId)}/movimentos`);
  return movements;
}

/** Mesmo papel do stockRepo.js da extensão: existe só pra deixar explícito,
 * no código que chama, que este é o caminho do AJUSTE MANUAL (Ajustar
 * estoque / Fazer inventário em Estoque) — a permissão 'adjustStock' de
 * verdade é sempre conferida no servidor (ver routes/products.js), não
 * aqui. Delega pra recordMovement porque, nesta fase, é o único caminho de
 * movimentação exposto por HTTP (venda/estorno/recebimento de compra ainda
 * não foram portados — quando forem, cada um grava direto no servidor
 * dentro da própria transação deles, sem passar por este endpoint). */
export async function recordManualAdjustment(args) {
  return recordMovement(args);
}
