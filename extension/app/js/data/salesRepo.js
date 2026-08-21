// Vendas realizadas. Cada venda é uma lista de itens (produto, quantidade,
// preço unitário e desconto no momento da venda) amarrada ao vendedor
// responsável e ao timestamp exato — é o registro que alimenta o histórico
// de vendas (visível a todos os perfis) e o log de auditoria (admin).
//
// Também guarda os pagamentos (pode ser mais de uma forma na mesma venda) e
// o histórico de estornos — uma venda nunca é apagada ou reescrita por um
// estorno, só ganha uma entrada em `refunds` e os itens afetados marcam
// quanto já foi devolvido (`qtyRefunded`), preservando o valor original pra
// auditoria.
import { dbGetAll, dbUpdate, dbTransaction, newId } from '../db.js';
import { getProduct } from './productsRepo.js';
import { recordMovement } from './stockRepo.js';
import { recordReversal, listCustomerLoyaltyLedger } from './loyaltyRepo.js';
import { getCompany } from './companyRepo.js';
import { verifyLogin } from './usersRepo.js';
import { applyDiscount, computeCartTotals, computeCreditInterest } from '../utils/pricing.js';

const PAYMENT_TOLERANCE = 0.01; // arredondamento de centavos
const FIADO_METHOD = 'Fiado';
const CREDIT_CARD_METHOD = 'Cartão de crédito';

/** Registra uma venda completa: confere estoque de cada item, calcula
 * descontos (por item e geral), debita a quantidade vendida e grava o
 * registro da venda — tudo dentro de UMA ÚNICA transação do IndexedDB (ver
 * o bloco com dbTransaction mais abaixo). Se qualquer item não tiver
 * estoque suficiente, ou a soma dos pagamentos não bater com o total, nada
 * é gravado. Uma venda com pagamento em "Fiado" precisa de um cliente
 * selecionado — vira uma dívida na conta dele (ver data/customersRepo.js),
 * não dinheiro entrando agora.
 *
 * Por que uma transação única (achado de auditoria): antes, cada item do
 * carrinho debitava o estoque numa transação própria (uma chamada a
 * stockRepo.recordMovement por item, em sequência), e só depois de todas
 * elas é que a venda em si era gravada, numa transação separada. Se o
 * Chrome fechasse, travasse ou o computador reiniciasse no meio desse
 * processo — bem mais provável numa venda com vários itens do que parece
 * — o estoque de alguns itens já tinha sido debitado, mas a venda que
 * explicaria essa baixa nunca chegava a existir: estoque errado, sem
 * nenhum registro contábil por trás. Agora a baixa de cada item E o
 * registro da venda só existem juntos, ou nenhum dos dois existe.
 *
 * A autorização de desconto acima do limite (`discountApproval`) é
 * verificada AQUI, não só na tela: a versão antiga confiava num
 * `discountApprovedBy` já resolvido pela UI (o id de um admin), o que
 * qualquer chamada direta a esta função — sem nunca ter passado pelo
 * modal de senha — conseguia forjar sozinha (bastava saber o id de
 * qualquer admin, que não é segredo nenhum). Agora quem decide se o
 * desconto passou do limite, e se a senha do admin bate, é esta função —
 * a tela só continua coletando usuário/senha numa telinha, pra dar
 * feedback rápido, mas a decisão de verdade é sempre revalidada aqui. */
export async function createSale({
  userId, userName, userRole = 'vendedor', items,
  overallDiscountType = null, overallDiscountValue = 0,
  payments, discountApproval = null, cashSessionId = null, customerId = null,
}) {
  if (!items || items.length === 0) throw new Error('A venda precisa ter pelo menos um item.');
  if (!payments || payments.length === 0) throw new Error('Informe ao menos uma forma de pagamento.');

  // Nunca confia cegamente em número vindo de fora (carrinho, ou uma
  // chamada direta a esta função por fora da tela): quantidade tem que ser
  // um número positivo de verdade, e valor de pagamento não pode ser
  // negativo. Sem isso, um item com qty negativa passava batido pelo
  // "estoque insuficiente" (que só falha se o disponível for MENOR que a
  // quantidade — nunca é o caso com qty negativa), gerava estoque do nada
  // (recordMovement grava -qty, então -(-5) = +5 de entrada "por venda") e
  // ainda diminuía o total a pagar (preço × qty negativa = valor negativo
  // somado no subtotal). Da mesma forma, um pagamento com valor negativo
  // podia compensar outro maior e ainda "bater" com o total da venda,
  // enquanto vira uma dívida de fiado negativa (crédito fabricado) se a
  // forma for "Fiado".
  items = items.map((item) => ({ ...item, qty: Number(item.qty) }));
  for (const item of items) {
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new Error('Quantidade inválida em um dos itens do carrinho.');
    }
  }
  for (const p of payments) {
    const amt = Number(p.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      throw new Error('Valor de pagamento inválido.');
    }
  }

  const fiadoTotal = payments.filter((p) => p.method === FIADO_METHOD).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (fiadoTotal > 0 && !customerId) {
    throw new Error('Selecione um cliente para vender fiado.');
  }

  // Confere estoque de todos os itens antes de debitar qualquer um — evita
  // vender parte do carrinho e travar no meio por falta de estoque. Essa
  // leitura aqui é só um filtro rápido, pra devolver um erro amigável cedo
  // (produto errado, estoque zerado) sem nem tentar abrir a transação —
  // não é a checagem que vale de verdade: a decisão final usa uma leitura
  // FRESCA de cada produto, dentro da própria transação atômica lá embaixo
  // (essa aqui pode estar desatualizada por alguns milissegundos).
  const products = [];
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) throw new Error('Produto não encontrado no carrinho.');
    if (product.quantity < item.qty) {
      throw new Error(`Estoque insuficiente de "${product.name}" (disponível: ${product.quantity}).`);
    }
    products.push(product);
  }

  // O preço unitário vem sempre de product.price (o preço gravado no
  // catálogo agora), nunca de algo que o carrinho/cliente tenha mandado —
  // é essa origem, e só ela, que garante que ninguém consiga fechar uma
  // venda com um preço diferente do cadastrado.
  const saleItems = items.map((item, i) => {
    const product = products[i];
    return {
      productId: product.id, name: product.name, barcode: product.barcode, unit: product.unit,
      qty: item.qty, unitPrice: product.price,
      discountType: item.discountType || null, discountValue: Number(item.discountValue) || 0,
      lineTotal: applyDiscount(product.price * item.qty, item.discountType, item.discountValue),
      qtyRefunded: 0,
    };
  });

  // Mesma fórmula de subtotal/desconto/total do PDV (utils/pricing.js) —
  // reaproveitada aqui em vez de reimplementada, pra nunca divergir do que
  // já foi mostrado na tela pro vendedor antes de finalizar.
  const { subtotal, itemsDiscountTotal, overallDiscountAmount, total, totalDiscountPercent } = computeCartTotals(
    saleItems, overallDiscountType, overallDiscountValue,
  );

  const paymentsTotal = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (Math.abs(paymentsTotal - total) > PAYMENT_TOLERANCE) {
    throw new Error(`Os pagamentos (${paymentsTotal.toFixed(2)}) não somam o total da venda (${total.toFixed(2)}).`);
  }

  const company = await getCompany();

  // Desconto acima do limite do vendedor exige autorização de um
  // administrador — verificada de verdade aqui (usuário + senha
  // conferidos contra o hash gravado), não só confiada de quem chamou.
  let discountApprovedBy = null;
  if (userRole !== 'admin') {
    const maxPercent = company?.policies?.vendorMaxDiscountPercent ?? 10;
    if (totalDiscountPercent > maxPercent + 0.001) {
      if (!discountApproval || !discountApproval.username || !discountApproval.password) {
        throw new Error(`Esse desconto passa do limite de ${maxPercent}% — peça a autorização de um administrador.`);
      }
      const admin = await verifyLogin(discountApproval.username, discountApproval.password);
      if (!admin || admin.role !== 'admin') {
        throw new Error('Usuário ou senha de administrador inválidos para autorizar o desconto.');
      }
      discountApprovedBy = admin.id;
    }
  }

  // Juro de parcelamento no cartão de crédito (utils/pricing.js) —
  // calculado AQUI, de novo, a partir da política gravada agora mesmo em
  // Dados da loja, nunca confiando em nada que a tela tenha mandado (a
  // tela já mostra o mesmo cálculo pro vendedor antes de finalizar, só
  // pra dar feedback — quem decide de verdade é sempre esta função,
  // mesmo padrão já usado pra aprovação de desconto acima). `amount` de
  // cada pagamento continua sendo só a parte do total da venda coberta
  // por aquela forma — o juro é gravado à parte, não entra na conferência
  // de paymentsTotal === total logo acima.
  const paymentsWithInterest = payments.map((p) => {
    const amount = Number(p.amount) || 0;
    const installments = Math.max(1, Math.floor(Number(p.installments)) || 1);
    const interest = p.method === CREDIT_CARD_METHOD
      ? computeCreditInterest(amount, installments, company?.policies)
      : { interestAmount: 0 };
    return { method: p.method, amount, installments, interestAmount: interest.interestAmount };
  });
  const creditInterestTotal = paymentsWithInterest.reduce((sum, p) => sum + p.interestAmount, 0);

  const sale = {
    id: newId(),
    timestamp: Date.now(),
    userId, userName,
    items: saleItems,
    subtotal,
    itemsDiscountTotal,
    overallDiscountType: overallDiscountType || null,
    overallDiscountValue: Number(overallDiscountValue) || 0,
    overallDiscountAmount,
    total,
    // installments (parcelas) só faz sentido pra cartão de crédito, mas fica
    // gravado em todo pagamento — sempre 1 quando não se aplica — pra manter
    // o formato do registro previsível em vez de um campo que às vezes existe
    // e às vezes não. interestAmount idem: sempre 0 fora do cartão.
    payments: paymentsWithInterest,
    // Juro total cobrado do cliente pelo parcelamento — dinheiro real que
    // entra na loja além do valor dos produtos, por isso conta como
    // faturamento normal nos relatórios (ver data/reportsRepo.js). Fica
    // separado de `total` pra manter `total` sempre igual à soma dos
    // itens/descontos (o que a tela de venda mostra e valida acima).
    creditInterestTotal,
    discountApprovedBy,
    cashSessionId,
    customerId,
    refunds: [],
    refundedTotal: 0,
  };

  // Dívida de fiado e pontos de fidelidade ganhos por esta venda —
  // calculados aqui, ANTES da transação (só leitura/aritmética pura), pra
  // poderem ser gravados DENTRO dela logo abaixo. Reaproveita o `company`
  // já buscado ali em cima (era buscado de novo aqui — leitura redundante
  // que nunca mudava o resultado, já que nada escreve em `company` entre
  // os dois pontos).
  const loyaltyRate = company?.policies?.loyaltyPointsPerReal ?? 0;
  const loyaltyPoints = customerId && loyaltyRate > 0 ? Math.floor(total * loyaltyRate) : 0;
  const debtEntry = fiadoTotal > 0 ? {
    id: newId(), customerId, type: 'fiado', amount: fiadoTotal, saleId: sale.id,
    paymentMethod: null, cashSessionId: null, note: '', userId, userName, timestamp: Date.now(),
  } : null;
  const loyaltyEntry = loyaltyPoints > 0 ? {
    id: newId(), customerId, type: 'ganho', points: loyaltyPoints, saleId: sale.id,
    note: '', userId, userName, timestamp: Date.now(),
  } : null;

  // Baixa de estoque de cada item + gravação da venda + dívida de fiado +
  // pontos de fidelidade, tudo numa ÚNICA transação (cobrindo os 5 stores
  // envolvidos) — ver comentário no topo da função. `stockError` guarda a
  // mensagem amigável de um item sem estoque suficiente: a transação é
  // abortada nesse caso (desfaz qualquer baixa já enfileirada dos itens
  // anteriores do mesmo carrinho), e o erro de verdade é relançado depois,
  // fora da transação — abortar faz dbTransaction rejeitar só com
  // "Transação cancelada.", sem contexto nenhum, por isso a mensagem
  // específica é guardada à parte.
  //
  // Achado de auditoria (P1): a dívida de fiado e o ganho de pontos eram
  // gravados DEPOIS desta transação, como chamadas separadas
  // (recordDebt/recordEarn). Se o navegador fechasse/travasse exatamente
  // no intervalo entre a venda já commitada e essas chamadas, a venda
  // ficava registrada como "paga em Fiado" sem NENHUMA dívida lançada no
  // extrato do cliente — dinheiro que a loja deveria cobrar depois, sem
  // rastro nenhum de que era pra cobrar. `recordDebt`/`recordEarn` em si
  // são só um `dbAdd` cada (sem leitura condicional própria), então dava
  // pra virar dois `store.add()` a mais dentro da MESMA transação atômica
  // da venda, sem perder nada da validação de cada uma — a decisão de
  // GERAR ou não cada lançamento já foi tomada acima, antes da transação.
  //
  // A checagem por item precisa ser sequencial (uma só depois que a
  // anterior terminou), não em paralelo: se o mesmo produto aparecer duas
  // vezes no carrinho (não deveria acontecer pela UI, que sempre soma na
  // mesma linha, mas esta função não confia cegamente em quem chama), a
  // segunda leitura precisa enxergar o efeito da baixa da primeira, senão
  // as duas debitariam a partir da mesma quantidade "antes" e o produto
  // ficaria com menos estoque do que deveria.
  let stockError = null;
  try {
    await dbTransaction(['products', 'stockMovements', 'sales', 'customerDebts', 'loyaltyEntries'], 'readwrite', (transaction) => {
      const productsStore = transaction.objectStore('products');
      const movementsStore = transaction.objectStore('stockMovements');
      const salesStore = transaction.objectStore('sales');

      function processItem(idx) {
        if (idx >= saleItems.length) {
          salesStore.add(sale);
          if (debtEntry) transaction.objectStore('customerDebts').add(debtEntry);
          if (loyaltyEntry) transaction.objectStore('loyaltyEntries').add(loyaltyEntry);
          return;
        }
        const item = saleItems[idx];
        const getReq = productsStore.get(item.productId);
        getReq.onsuccess = () => {
          const product = getReq.result;
          if (!product) {
            stockError = 'Produto não encontrado no carrinho.';
            transaction.abort();
            return;
          }
          const newQuantity = product.quantity - item.qty;
          if (newQuantity < 0) {
            stockError = `Estoque insuficiente de "${product.name}" (disponível: ${product.quantity}).`;
            transaction.abort();
            return;
          }
          productsStore.put({ ...product, quantity: newQuantity, updatedAt: Date.now() });
          movementsStore.add({
            id: newId(), productId: item.productId, type: 'venda', qty: -item.qty,
            userId, userName, note: 'Baixa por venda', timestamp: Date.now(),
          });
          processItem(idx + 1);
        };
      }
      processItem(0);
    });
  } catch (err) {
    throw new Error(stockError || err.message);
  }

  return sale;
}

export async function listSales() {
  const sales = await dbGetAll('sales');
  return sales.sort((a, b) => b.timestamp - a.timestamp);
}

/** Estorna um ou mais itens de uma venda (total ou parcial). Devolve a
 * quantidade ao estoque (via stockRepo, que também grava a movimentação de
 * tipo 'estorno'), marca quanto de cada item já foi devolvido e adiciona um
 * registro em `refunds` — a venda original nunca é alterada retroativamente,
 * só ganha esse histórico por cima. `generateCredit` sinaliza que o valor
 * pode virar crédito de troca numa venda futura (ver session.js); quem usa
 * o crédito depois é a tela de Nova Venda, não este módulo.
 *
 * A validação (quanto ainda dá pra estornar de cada item) e o incremento de
 * `qtyRefunded` acontecem dentro de um único dbUpdate — get+put na MESMA
 * transação do IndexedDB. Antes, eram um dbGet seguido de um dbPut
 * separados: dois estornos disparados quase juntos (duplo clique no botão
 * de confirmar, ou duas abas na mesma venda) liam o mesmo estado "antes" e
 * a segunda gravação apagava o efeito da primeira — o item podia ser
 * estornado além da quantidade vendida, e um dos dois registros de estorno
 * sumia de `sale.refunds` mesmo o estoque já tendo sido creditado por ele. */
export async function refundSaleItems({ saleId, userId, userName, reason, items, generateCredit = false }) {
  if (!reason || !reason.trim()) throw new Error('Informe o motivo do estorno.');
  if (!items || items.length === 0) throw new Error('Selecione ao menos um item para estornar.');

  let refund;
  let updatedSale;
  await dbUpdate('sales', saleId, (sale) => {
    if (!sale) throw new Error('Venda não encontrada.');

    // `lineTotal` de cada item reflete só o desconto por item — o desconto
    // geral do carrinho (aplicado sobre o total da venda, não guardado por
    // item) fica de fora dele. Sem ratear essa diferença aqui, um estorno
    // devolveria mais do que o cliente pagou de fato numa venda com
    // desconto geral. `discountRatio` traz o valor de cada unidade pro
    // preço líquido realmente cobrado (mesmo raciocínio de reportsRepo.js).
    const lineTotalSum = sale.items.reduce((sum, i) => sum + i.lineTotal, 0);
    const discountRatio = lineTotalSum > 0 ? sale.total / lineTotalSum : 1;

    const refundItems = [];
    let totalRefunded = 0;

    for (const req of items) {
      const qty = Number(req.qty) || 0;
      if (qty <= 0) continue;
      const saleItem = sale.items.find((i) => i.productId === req.productId);
      if (!saleItem) throw new Error('Item não encontrado nesta venda.');
      const available = saleItem.qty - saleItem.qtyRefunded;
      if (qty > available) {
        throw new Error(`Só é possível estornar até ${available} de "${saleItem.name}" (já estornado: ${saleItem.qtyRefunded}).`);
      }
      const unitNet = (saleItem.lineTotal / saleItem.qty) * discountRatio;
      const amount = unitNet * qty;
      refundItems.push({ productId: saleItem.productId, name: saleItem.name, qty, amount });
      totalRefunded += amount;
      saleItem.qtyRefunded += qty;
    }

    if (refundItems.length === 0) throw new Error('Selecione ao menos um item para estornar.');

    // Nota (auditoria de bugs/vazamentos): estorno aqui só devolve o lado
    // "produto" da venda (`sale.refundedTotal`, calculado acima a partir do
    // preço líquido dos itens). `sale.creditInterestTotal` e
    // `payments[].interestAmount` — o juro do parcelamento já cobrado na
    // maquininha (ver createSale mais abaixo) — NÃO são reduzidos nem
    // rateados aqui, seja estorno total ou parcial. Isso é intencional e
    // simples de propósito (a extensão não tem integração real com a
    // maquininha pra saber quanto o emissor do cartão devolveria de juro
    // num estorno parcial — isso depende da operadora, não da loja), mas é
    // um comportamento que o lojista precisa saber: se quiser devolver o
    // juro também, isso é acerto manual fora do sistema. Documentado em
    // Ajuda, tópico "Juro no parcelamento".
    refund = {
      id: newId(),
      timestamp: Date.now(),
      userId, userName,
      reason: reason.trim(),
      items: refundItems,
      totalRefunded,
      creditGenerated: !!generateCredit,
    };
    sale.refunds.push(refund);
    sale.refundedTotal += totalRefunded;
    updatedSale = sale;
    return sale;
  });

  // A partir daqui o estorno já está gravado e validado de forma atômica —
  // o que resta é efeito colateral (creditar estoque, reverter pontos). Se
  // algo falhar nesta parte, o estorno em si permanece registrado (não fica
  // "pela metade" de um jeito que permita estornar o mesmo item de novo);
  // o erro sobe pra quem chamou avisar que o estoque pode não ter sido
  // creditado, mas o registro contábil do estorno já é definitivo.
  for (const ri of refund.items) {
    await recordMovement({
      productId: ri.productId, type: 'estorno', qty: ri.qty,
      userId, userName, note: `Estorno da venda — ${reason.trim()}`,
    });
  }

  // Reverte proporcionalmente os pontos de fidelidade ganhos por esta
  // venda — sem isso, um cliente manteria pontos de compras que devolveu.
  // Fica negativo se ele já tiver resgatado esses pontos antes do estorno;
  // é o mesmo compromisso de qualquer programa de fidelidade real.
  if (updatedSale.customerId && updatedSale.total > 0) {
    const ledger = await listCustomerLoyaltyLedger(updatedSale.customerId);
    const pointsEarned = ledger
      .filter((e) => e.saleId === updatedSale.id && e.type === 'ganho')
      .reduce((sum, e) => sum + e.points, 0);
    if (pointsEarned > 0) {
      const pointsToReverse = Math.floor(pointsEarned * (refund.totalRefunded / updatedSale.total));
      if (pointsToReverse > 0) {
        await recordReversal({ customerId: updatedSale.customerId, points: pointsToReverse, saleId: updatedSale.id, userId, userName });
      }
    }
  }

  return { sale: updatedSale, refund };
}

/** Status derivado da venda, pra exibição (badge na lista, etc.) — não é
 * gravado no registro, é calculado a partir de qtyRefunded de cada item. */
export function saleStatus(sale) {
  const totalQty = sale.items.reduce((sum, i) => sum + i.qty, 0);
  const refundedQty = sale.items.reduce((sum, i) => sum + i.qtyRefunded, 0);
  if (refundedQty === 0) return 'completa';
  if (refundedQty >= totalQty) return 'estornada';
  return 'parcial';
}
