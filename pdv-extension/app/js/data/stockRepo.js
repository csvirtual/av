// Histórico de movimentações de estoque: toda entrada, saída manual, ajuste
// ou venda que muda a quantidade de um produto fica registrada aqui, com
// quem fez e quando — é o que dá rastreabilidade além do log de auditoria
// (que registra a AÇÃO; isto aqui registra o EFEITO no estoque).
import { dbGetAllByIndex, dbTransaction, claimIdempotencyKey, newId } from '../db.js';
import { assertActingUserHasPermission } from './usersRepo.js';

/** Achado de auditoria (P1): a versão anterior ajustava a quantidade do
 * produto (um dbUpdate, atômico só pra `products`) e DEPOIS, numa
 * transação SEPARADA, gravava o registro em `stockMovements` —
 * exatamente o padrão que qualquer auditoria de estoque deveria caçar:
 * "estoque é atualizado MAS a movimentação histórica falha". Se o
 * navegador fechasse/travasse bem entre as duas escritas, a quantidade
 * do produto já tinha mudado, mas NENHUM registro explicava a mudança —
 * nem pra entrada de compra, nem pra ajuste manual, nem pro crédito de
 * estoque de um estorno (todos passam por esta função). Agora as duas
 * escritas (baixa/alta de quantidade + registro da movimentação) vivem
 * na MESMA transação — mesmo padrão já usado em createSale() pro
 * caminho principal de venda. */
// Achado de auditoria (P1, mesma classe já corrigida em createSale/
// refundSaleItems): "Ajustar estoque" e "Fazer inventário"
// (views/products.js) só tinham a proteção genérica de openModal()
// (desabilitar o botão), provada insuficiente sozinha nas duas correções
// acima. Um duplo clique em "Confirmar ajuste" registraria a mesma
// entrada/saída duas vezes. `dedupeKey` fecha essa lacuna do mesmo jeito.
export async function recordMovement({ productId, type, qty, userId, userName, note = '', dedupeKey = null }) {
  // Achado de auditoria (P1, dinheiro/estoque não pode ter margem pra erro):
  // diferente de toda outra função de quantidade/dinheiro do sistema, esta
  // função não fazia NENHUMA validação numérica em `qty` — um NaN (ex: um
  // bug de conversão em algum chamador futuro) passava direto pelo guard
  // `newQuantity < 0` logo abaixo, porque `NaN < 0` é `false` em JavaScript,
  // e gravava `quantity: NaN` no produto PRA SEMPRE (sem função de exclusão
  // de movimentação pra desfazer). Um `qty: Infinity` tinha o mesmo destino.
  // `Number.isFinite` pega os dois casos de uma vez — nem `NaN` nem
  // `Infinity`/`-Infinity` são "finite".
  const numericQty = Number(qty);
  if (!Number.isFinite(numericQty) || numericQty === 0) {
    throw new Error('Quantidade de movimentação inválida.');
  }
  const record = {
    id: newId(),
    productId,
    type,
    qty: numericQty, // positivo = entrada, negativo = saída
    userId,
    userName,
    note,
    timestamp: Date.now(),
  };
  let adjustError = null;
  // Achado de auditoria: precisa de try/catch agora que existe reivindicação
  // de dedupeKey (abaixo) — abortar a transação de propósito faz a promise
  // de dbTransaction REJEITAR (ver db.js#dbTransaction, transaction.onabort),
  // então sem isso o erro que chegaria no chamador seria o genérico
  // "Transação cancelada.", não a mensagem amigável (`adjustError`) que a
  // tela usa pra explicar o que aconteceu.
  try {
    await dbTransaction(['products', 'stockMovements', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const productsStore = transaction.objectStore('products');
      const movementsStore = transaction.objectStore('stockMovements');
      claimIdempotencyKey(transaction, dedupeKey, () => {
        adjustError = 'Este ajuste já foi registrado — evite reenviar.';
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      });
      const getReq = productsStore.get(productId);
      getReq.onsuccess = () => {
        const product = getReq.result;
        if (!product) {
          adjustError = 'Produto não encontrado.';
          // Achado de auditoria: precisa abortar de propósito agora que
          // existe a reivindicação de dedupeKey acima — sem isso, uma
          // tentativa que falha aqui (produto sumiu, estoque insuficiente)
          // ainda assim CONSOME a chave pra sempre, e um reenvio legítimo
          // (mesmo modal, dado corrigido) seria recusado por engano como
          // "já registrado".
          try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
          return;
        }
        const newQuantity = product.quantity + numericQty;
        if (newQuantity < 0) {
          adjustError = `Estoque insuficiente de "${product.name}".`;
          try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
          return;
        }
        productsStore.put({ ...product, quantity: newQuantity, updatedAt: Date.now() });
        movementsStore.add(record);
      };
    });
  } catch (err) {
    throw new Error(adjustError || err.message);
  }
  return record;
}

export async function listMovementsByProduct(productId) {
  const list = await dbGetAllByIndex('stockMovements', 'byProductId', productId);
  return list.sort((a, b) => b.timestamp - a.timestamp);
}

/** Achado de auditoria (mesma classe já corrigida em
 * productsRepo.js#updateProduct): recordMovement() em si nunca checou
 * permissão nenhuma — de propósito, porque ela também é chamada por
 * caminhos que não devem (nem podem) exigir 'adjustStock': venda
 * (createSale), estorno (refundSaleItems) e recebimento de compra
 * (purchasesRepo, que já confere 'compras' antes de chamar), todos ações
 * "base" ou já guardadas na origem. Só que o AJUSTE MANUAL de estoque e o
 * INVENTÁRIO/BALANÇO (views/products.js) chamavam recordMovement()
 * DIRETO, protegidos só pela TELA (botão escondido de quem não tem
 * 'adjustStock') — um vendedor sem essa permissão conseguia, pelo console
 * do navegador, inventar estoque do nada ou zerar o de um concorrente
 * interno só chamando a função direto. Esta função existe só pra esses
 * dois caminhos manuais — reconfere 'adjustStock' aqui, na fonte, antes de
 * delegar pro recordMovement de sempre. */
export async function recordManualAdjustment(args) {
  await assertActingUserHasPermission('adjustStock');
  return recordMovement(args);
}
