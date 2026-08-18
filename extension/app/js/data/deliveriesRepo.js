// Carreto: lista organizada do que vai ser entregue pro cliente numa
// entrega (comum em loja de material de construção — "o carreto leva tal
// coisa pro fulano"). É só um registro de controle/logística: NÃO mexe em
// estoque nem em dinheiro — a baixa de estoque de verdade já acontece na
// Venda; o carreto só ajuda a organizar o que precisa sair, pra quem, e se
// já foi entregue ou não.
import { dbGetAll, dbGet, dbPut, dbAdd, newId } from '../db.js';
import { getCustomer } from './customersRepo.js';

export async function listDeliveries() {
  const list = await dbGetAll('deliveries');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDelivery(id) {
  return dbGet('deliveries', id);
}

/** Cadastra um carreto novo. Cada item vem do estoque (amarrado a um
 * productId de verdade, pra manter rastreável) ou é "avulso" (descrição
 * livre — ex: "carga de areia", "entulho" — pra cobrir entrega que não é
 * só produto cadastrado). O endereço, se não for informado, herda o
 * cadastro do cliente — mas fica sempre editável aqui, porque a entrega
 * pode ser num endereço diferente do cadastro (obra, por exemplo). */
export async function createDelivery({ customerId, items, address = '', responsible = '', notes = '', userId, userName }) {
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
    createdBy: { userId, userName },
    createdAt: Date.now(),
    deliveredBy: null,
    deliveredAt: null,
  };
  await dbAdd('deliveries', delivery);
  return delivery;
}

export async function markDelivered(id, { userId, userName }) {
  const delivery = await getDelivery(id);
  if (!delivery) throw new Error('Carreto não encontrado.');
  if (delivery.status !== 'pendente') throw new Error('Este carreto não está mais pendente.');
  delivery.status = 'entregue';
  delivery.deliveredBy = { userId, userName };
  delivery.deliveredAt = Date.now();
  await dbPut('deliveries', delivery);
  return delivery;
}

export async function cancelDelivery(id) {
  const delivery = await getDelivery(id);
  if (!delivery) throw new Error('Carreto não encontrado.');
  if (delivery.status !== 'pendente') throw new Error('Só é possível cancelar um carreto pendente.');
  delivery.status = 'cancelado';
  await dbPut('deliveries', delivery);
  return delivery;
}
