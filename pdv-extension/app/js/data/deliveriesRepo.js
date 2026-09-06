// Carreto: lista organizada do que vai ser entregue pro cliente numa
// entrega (comum em loja de material de construção — "o carreto leva tal
// coisa pro fulano"). É só um registro de controle/logística: NÃO mexe em
// estoque nem em dinheiro — a baixa de estoque de verdade já acontece na
// Venda; o carreto só ajuda a organizar o que precisa sair, pra quem, e se
// já foi entregue ou não.
import { dbGetAll, dbUpdate, dbTransaction, claimIdempotencyKey, newId } from '../db.js';
import { getCustomer } from './customersRepo.js';

export async function listDeliveries() {
  const list = await dbGetAll('deliveries');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/** Cadastra um carreto novo. Cada item vem do estoque (amarrado a um
 * productId de verdade, pra manter rastreável) ou é "avulso" (descrição
 * livre — ex: "carga de areia", "entulho" — pra cobrir entrega que não é
 * só produto cadastrado). O endereço, se não for informado, herda o
 * cadastro do cliente — mas fica sempre editável aqui, porque a entrega
 * pode ser num endereço diferente do cadastro (obra, por exemplo). */
// Achado de auditoria (P2): não mexe em estoque nem em dinheiro (a baixa
// real já acontece na Venda), mas um duplo clique em "Cadastrar carreto"/
// "Finalizar venda + carreto" ainda assim gerava um registro de entrega
// duplicado — mesma classe de bug já corrigida em createSale/
// refundSaleItems/recordMovement, só que de menor risco aqui (não é
// dinheiro nem estoque, é logística). `dedupeKey` fecha essa lacuna do
// mesmo jeito.
export async function createDelivery({ customerId, items, address = '', responsible = '', notes = '', saleId = null, userId, userName, dedupeKey = null }) {
  if (!customerId) throw new Error('Selecione um cliente para o carreto.');
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error('Cliente não encontrado.');

  const deliveryItems = (items || [])
    .map((item) => ({
      source: item.source === 'avulso' ? 'avulso' : 'estoque',
      productId: item.source === 'avulso' ? null : (item.productId || null),
      name: (item.name || '').trim(),
      unit: (item.unit || 'un').trim() || 'un',
      qty: Math.max(0, Number(item.qty) || 0),
    }))
    .filter((i) => i.name && i.qty > 0 && (i.source === 'avulso' || i.productId));
  if (deliveryItems.length === 0) throw new Error('Adicione ao menos um item ao carreto.');

  const delivery = {
    id: newId(),
    customerId,
    customerName: customer.nome,
    items: deliveryItems,
    address: (address || '').trim() || customer.endereco || '',
    responsible: (responsible || '').trim(),
    notes: (notes || '').trim(),
    status: 'pendente', // 'pendente' | 'entregue' | 'cancelado'
    // Preenchido só quando o carreto nasce direto da tela de Venda (botão
    // "Finalizar venda + carreto") — permite rastrear de qual venda ele
    // veio. Fica null num carreto cadastrado direto na tela Carreto, sem
    // venda associada.
    saleId,
    createdBy: { userId, userName },
    createdAt: Date.now(),
    deliveredBy: null,
    deliveredAt: null,
  };
  let dupError = null;
  try {
    await dbTransaction(['deliveries', 'idempotencyKeys'], 'readwrite', (transaction) => {
      claimIdempotencyKey(transaction, dedupeKey, () => {
        dupError = 'Este carreto já foi registrado — evite reenviar.';
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      });
      transaction.objectStore('deliveries').add(delivery);
    });
  } catch (err) {
    throw new Error(dupError || err.message);
  }
  return delivery;
}

// markDelivered/cancelDelivery usam dbUpdate — a checagem "ainda está
// pendente?" e a gravação da transição de status acontecem na mesma
// transação, pra duas ações concorrentes sobre o mesmo carreto (marcar
// entregue e cancelar, por exemplo) não conseguirem os dois passar na
// checagem antes de qualquer um gravar.
export async function markDelivered(id, { userId, userName }) {
  return dbUpdate('deliveries', id, (delivery) => {
    if (!delivery) throw new Error('Carreto não encontrado.');
    if (delivery.status !== 'pendente') throw new Error('Este carreto não está mais pendente.');
    delivery.status = 'entregue';
    delivery.deliveredBy = { userId, userName };
    delivery.deliveredAt = Date.now();
    return delivery;
  });
}

export async function cancelDelivery(id) {
  return dbUpdate('deliveries', id, (delivery) => {
    if (!delivery) throw new Error('Carreto não encontrado.');
    if (delivery.status !== 'pendente') throw new Error('Só é possível cancelar um carreto pendente.');
    delivery.status = 'cancelado';
    return delivery;
  });
}
