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
import { dbGetAll, dbTransaction, dbScanByIndex, dbReduceByIndex, dbReduceByRange, claimIdempotencyKey, newId } from '../db.js';
import { getProduct } from './productsRepo.js';
import { isAdmin } from '../utils/permissions.js';
import { recordReversal, listCustomerLoyaltyLedger } from './loyaltyRepo.js';
import { recordDebtRefund } from './customersRepo.js';
import { getCompany } from './companyRepo.js';
import { verifyLogin, getUser } from './usersRepo.js';
import { applyDiscount, computeCartTotals, computeCreditInterest, effectivePrice, MAX_INSTALLMENTS } from '../utils/pricing.js';
import { formatQty } from '../utils/format.js';

const PAYMENT_TOLERANCE = 0.01; // arredondamento de centavos
const FIADO_METHOD = 'Fiado';
const CREDIT_CARD_METHOD = 'Cartão de crédito';
const CUSTOM_UNIT_VALUE = 'personalizado';

/** Preço/custo/fator de estoque de UM item do carrinho, sempre a partir de
 * `product` recém-lido do banco (nunca do carrinho) — mesmo princípio de
 * `effectivePrice(product)` já usado pra produtos normais. Produto
 * 'personalizado' (várias formas de venda, ver data/productsRepo.js) não
 * tem preço único: `item.formName` diz qual forma foi escolhida no PDV, e
 * ela é buscada de novo AGORA no produto — se a forma não existir mais
 * (removida ou renomeada numa edição do produto depois que o item já
 * estava no carrinho), rejeita com um erro claro em vez de usar um preço
 * desatualizado ou adivinhar qual forma o vendedor queria (mesma classe do
 * achado de auditoria F-07 de sale.js: nunca confia numa referência velha
 * pra dinheiro/estoque). `formFator` (quantas unidades de estoque cada
 * unidade vendida desta forma consome) fica `undefined` pra produto normal
 * — todo lugar que usa isso faz `(formFator || 1)`, então 1:1 continua
 * valendo sem precisar de um `if` a mais em cada chamador. */
function resolveSaleItemPricing(product, item) {
  if (product.unit !== CUSTOM_UNIT_VALUE) {
    return { unitPrice: effectivePrice(product), costPrice: undefined, formFator: undefined, unitLabel: product.unit };
  }
  const form = (product.customForms || []).find((f) => f.forma === item.formName);
  if (!form) {
    throw new Error(`A forma de venda "${item.formName || ''}" de "${product.name}" não existe mais — remova o item do carrinho e adicione de novo.`);
  }
  return { unitPrice: form.valor, costPrice: form.custo, formFator: form.fator, unitLabel: form.forma };
}

/** Chave do dia (AAAA-MM-DD) em horário LOCAL, não UTC — usada pelo placar
 * `dailySales` (ver db.js#DB_VERSION 7 e createSale/refundSaleItems
 * abaixo). Tem que ser local: "hoje" pro lojista é o dia no fuso dele, e
 * usar UTC bucketaria errado uma venda das 21h-meia-noite (Brasil é
 * UTC-3) num dia diferente do que a tela mostra. */
function localDateKey(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  userId, userName, items,
  overallDiscountType = null, overallDiscountValue = 0,
  payments, discountApproval = null, cashSessionId = null, customerId = null,
  // Achado de auditoria (P0, venda não pode duplicar): até aqui, a ÚNICA
  // proteção contra finalizar a mesma venda duas vezes era o botão
  // "Finalizar venda" ficar `disabled` na tela (views/sale.js). Provado por
  // teste que isso NÃO basta — disparar 20 cliques sintéticos seguidos no
  // botão gerou 20 vendas reais, uma por clique, todas debitando estoque e
  // registrando faturamento, porque `disabled` só bloqueia um clique NATIVO
  // de mouse/teclado em cima do elemento, não qualquer outro jeito de
  // disparar o mesmo evento (um bug futuro, uma extensão de terceiros, um
  // clique fantasma do sistema operacional). `dedupeKey` fecha essa lacuna
  // na própria lógica de negócio, igual já é feito em sangria/suprimento/
  // pagamento de fiado/conta/recebimento de compra/resgate de fidelidade
  // (ver db.js#claimIdempotencyKey) — views/sale.js agora gera uma chave só
  // quando o carrinho está pronto pra finalizar, e REUSA a mesma chave em
  // toda tentativa daquele carrinho específico, então uma segunda tentativa
  // concorrente da MESMA intenção de venda é recusada aqui dentro, mesmo
  // que a tela por algum motivo deixe passar o segundo clique.
  dedupeKey = null,
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
  const pricings = [];
  for (const item of items) {
    const product = await getProduct(item.productId);
    if (!product) {
      // Achado de auditoria: o carrinho fica na memória da aba, sem se
      // limpar ao trocar de tela (só no logout, ver resetSaleDraft em
      // app.js) — dá pra montar o carrinho, ir excluir o produto no
      // Estoque e voltar pra "Nova venda" com um item que não existe mais.
      // A mensagem genérica de antes ("Produto não encontrado no
      // carrinho.") não dizia QUAL item nem o que fazer — só travava a
      // venda sem pista nenhuma, mesmo com cliente/pagamento certinhos.
      throw new Error(`"${item.name || 'Um item do carrinho'}" não existe mais no Estoque — remova o item do carrinho e adicione de novo.`);
    }
    const pricing = resolveSaleItemPricing(product, item);
    const stockQty = item.qty * (pricing.formFator || 1);
    if (product.quantity < stockQty) {
      throw new Error(`Estoque insuficiente de "${product.name}" (disponível: ${formatQty(product.quantity)}).`);
    }
    products.push(product);
    pricings.push(pricing);
  }

  // O preço unitário vem sempre de resolveSaleItemPricing(product, item) —
  // pra produto normal, o preço promocional gravado no catálogo se estiver
  // perto de vencer, senão o preço normal (ver utils/pricing.js); pra
  // produto 'personalizado', o valor/custo/fator da forma de venda
  // escolhida, buscados de novo agora no produto — nunca de algo que o
  // carrinho/cliente tenha mandado — é essa origem, e só ela, que garante
  // que ninguém consiga fechar uma venda com um preço diferente do
  // cadastrado. `costPrice`/`formFator` só existem no item quando a venda
  // for de uma forma personalizada (produto normal não grava os dois —
  // continua usando o costPrice ATUAL do produto pra margem, ver
  // data/reportsRepo.js, igual sempre foi).
  const saleItems = items.map((item, i) => {
    const product = products[i];
    const { unitPrice, costPrice, formFator, unitLabel } = pricings[i];
    return {
      productId: product.id, name: product.name, barcode: product.barcode, unit: unitLabel,
      qty: item.qty, unitPrice,
      ...(costPrice !== undefined ? { costPrice } : {}),
      ...(formFator !== undefined ? { formFator } : {}),
      discountType: item.discountType || null, discountValue: Number(item.discountValue) || 0,
      lineTotal: applyDiscount(unitPrice * item.qty, item.discountType, item.discountValue),
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
  //
  // Quem decide se ESTE vendedor tem o teto de desconto (permissão
  // 'unlimitedDiscount', ver utils/pricing.js e views/sale.js) é o registro
  // dele buscado agora pelo `userId`, nunca um papel/permissão que quem
  // chamou tenha mandado solto por parâmetro — igual ao resto desta função,
  // nunca confia em nada que quem chamou possa forjar.
  const actingUser = await getUser(userId);
  const bypassDiscountCap = isAdmin(actingUser) || !!actingUser?.permissions?.unlimitedDiscount;
  let discountApprovedBy = null;
  if (!bypassDiscountCap) {
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
    const installments = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(p.installments)) || 1));
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
    // Espelha `refunds.length > 0` — mantido como campo próprio (não
    // calculado on-the-fly) só pra existir um índice (`byHasRefunds`, ver
    // db.js#DB_VERSION 9) que deixa cashRepo.js#computeExpectedAmounts achar
    // reembolsos sem escanear a tabela de vendas inteira a cada abertura do
    // Caixa. Atualizado junto com `refunds` em refundSaleItems, nunca
    // separado. 1/0 em vez de true/false: IndexedDB não aceita booleano
    // como chave de índice.
    hasRefunds: 0,
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
  // gravados DEPOIS desta transação, como duas chamadas separadas (cada
  // uma um dbAdd próprio, em customersRepo.js/loyaltyRepo.js). Se o
  // navegador fechasse/travasse exatamente no intervalo entre a venda já
  // commitada e essas chamadas, a venda ficava registrada como "paga em
  // Fiado" sem NENHUMA dívida lançada no extrato do cliente — dinheiro
  // que a loja deveria cobrar depois, sem rastro nenhum de que era pra
  // cobrar. Como as duas eram só um `dbAdd` cada (sem leitura condicional
  // própria), deu pra virar dois `store.add()` a mais dentro da MESMA
  // transação atômica da venda, sem perder nada da validação de cada uma
  // — a decisão de GERAR ou não cada lançamento já foi tomada acima,
  // antes da transação.
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
    await dbTransaction(['products', 'stockMovements', 'sales', 'customerDebts', 'loyaltyEntries', 'dailySales', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const productsStore = transaction.objectStore('products');
      const movementsStore = transaction.objectStore('stockMovements');
      const salesStore = transaction.objectStore('sales');

      // Reivindica a chave ANTES de mexer em estoque — se `dedupeKey` já
      // foi usada (mesma venda tentada de novo), aborta a transação inteira
      // (desfazendo qualquer baixa de estoque que os requests abaixo já
      // tenham enfileirado, igual ao resto desta função) em vez de deixar
      // uma segunda cópia da venda ser gravada. `dedupeKey` nula (chamada
      // antiga, ou alguma futura chamada interna que não passe por
      // views/sale.js) não ativa proteção nenhuma — ver claimIdempotencyKey.
      claimIdempotencyKey(transaction, dedupeKey, () => {
        stockError = 'Esta venda já foi registrada — evite reenviar.';
        transaction.abort();
      });

      function processItem(idx) {
        if (idx >= saleItems.length) {
          salesStore.add(sale);
          if (debtEntry) transaction.objectStore('customerDebts').add(debtEntry);
          if (loyaltyEntry) transaction.objectStore('loyaltyEntries').add(loyaltyEntry);
          // Mantém o placar diário em dia junto com a venda, na mesma
          // transação (ver db.js#DB_VERSION 7) — assim ele nunca existe
          // "quase certo", só certo ou (se a transação falhar) inalterado.
          const dailyStore = transaction.objectStore('dailySales');
          const dateKey = localDateKey(sale.timestamp);
          const getDailyReq = dailyStore.get(dateKey);
          getDailyReq.onsuccess = () => {
            const row = getDailyReq.result || { date: dateKey, count: 0, netTotal: 0 };
            // `sale` foi montada por esta própria função, então os três
            // campos abaixo são sempre números de verdade aqui — os `|| 0`
            // são defensivos mesmo assim (achado de auditoria: dinheiro não
            // pode ter brecha), pro caso de um refactor futuro quebrar essa
            // garantia sem querer. Importante: só os campos LIDOS de `sale`
            // são protegidos, nunca `row.netTotal`/`row.count` em si — se o
            // ACUMULADOR já persistido estiver corrompido por algum motivo,
            // é melhor ele continuar visivelmente errado (NaN aparece na
            // tela, chama atenção) do que "curar" silenciosamente pra um
            // valor plausível e errado sem ninguém perceber.
            dailyStore.put({
              date: dateKey,
              count: row.count + 1,
              netTotal: row.netTotal + ((Number(sale.total) || 0) - (Number(sale.refundedTotal) || 0) + (Number(sale.creditInterestTotal) || 0)),
            });
          };
          return;
        }
        const item = saleItems[idx];
        const getReq = productsStore.get(item.productId);
        getReq.onsuccess = () => {
          const product = getReq.result;
          if (!product) {
            stockError = `"${item.name}" não existe mais no Estoque — remova o item do carrinho e adicione de novo.`;
            transaction.abort();
            return;
          }
          // `item.formFator` (só existe em item de produto 'personalizado')
          // converte a quantidade VENDIDA (ex: 1 carrada) na quantidade de
          // ESTOQUE que ela consome (ex: 40 latas) — `|| 1` faz produto
          // normal continuar 1:1, sem precisar de um caminho separado.
          const stockQty = item.qty * (item.formFator || 1);
          const newQuantity = product.quantity - stockQty;
          if (newQuantity < 0) {
            stockError = `Estoque insuficiente de "${product.name}" (disponível: ${formatQty(product.quantity)}).`;
            transaction.abort();
            return;
          }
          productsStore.put({ ...product, quantity: newQuantity, updatedAt: Date.now() });
          movementsStore.add({
            id: newId(), productId: item.productId, type: 'venda', qty: -stockQty,
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

function timestampRange(fromTs, toTs) {
  if (fromTs != null && toTs != null) return IDBKeyRange.bound(fromTs, toTs);
  if (fromTs != null) return IDBKeyRange.lowerBound(fromTs);
  if (toTs != null) return IDBKeyRange.upperBound(toTs);
  return undefined;
}

/** Versão paginada de listSales(), pro Histórico de vendas — usada em vez
 * de listSales() + filtro em JS pra a tela não precisar carregar (nem
 * ordenar, nem renderizar) o histórico inteiro de uma vez quando a loja
 * já acumulou muitas vendas (ver dbScanByIndex em db.js). `fromTs`/`toTs`
 * (opcionais, em ms) já cortam o índice de timestamp direto no banco;
 * `sellerId`/`customerId` filtram registro a registro durante a varredura,
 * já que não há (ainda) um índice composto com data. `afterKey`/`afterId`
 * vêm da página anterior (ver dbScanByIndex) — undefined pra primeira
 * página.
 *
 * `customerId` também é o que a tela Clientes usa (ver views/clientes.js#
 * openCustomerSalesModal, "Ver compras") pra listar as vendas de UM cliente
 * sem carregar a tabela `sales` inteira — mesmo cuidado de performance de
 * sempre, só que filtrando por cliente em vez de vendedor. */
export async function listSalesPage({ sellerId, customerId, fromTs, toTs, limit = 50, afterKey, afterId } = {}) {
  const range = timestampRange(fromTs, toTs);
  const matches = (sellerId || customerId)
    ? (s) => (!sellerId || s.userId === sellerId) && (!customerId || s.customerId === customerId)
    : null;
  return dbScanByIndex('sales', 'byTimestamp', { range, limit, afterKey, afterId, matches });
}

/** Total líquido e contagem de um filtro de Histórico de vendas, sem
 * acumular as vendas em memória (ver dbReduceByIndex) — mantém o resumo
 * ("42 venda(s), total líquido R$...") correto mesmo com a listagem
 * paginada, sem voltar a carregar tudo de uma vez só pra somar. */
export async function summarizeSales({ sellerId, customerId, fromTs, toTs } = {}) {
  // Caminho rápido: sem filtro de vendedor nem de cliente, soma o placar
  // diário (dailySales, ver db.js#DB_VERSION 7 e createSale/
  // refundSaleItems) em vez de varrer cada venda uma a uma — algumas
  // centenas/milhares de linhas minúsculas (uma por dia de loja aberta) em
  // vez de até 100 mil+ vendas inteiras. O placar não é separado por
  // vendedor nem por cliente (seria bem mais registros pra manter em dia a
  // cada venda, sem necessidade — filtrar por um dos dois não é o caso
  // comum), então com qualquer um dos dois continua pela varredura de
  // sempre.
  if (!sellerId && !customerId) {
    const range = dateKeyRangeFromTs(fromTs, toTs);
    return dbReduceByRange('dailySales', {
      range,
      initial: { count: 0, netTotal: 0 },
      reduceFn: (acc, row) => ({ count: acc.count + row.count, netTotal: acc.netTotal + row.netTotal }),
    });
  }
  const range = timestampRange(fromTs, toTs);
  const matches = (s) => (!sellerId || s.userId === sellerId) && (!customerId || s.customerId === customerId);
  return dbReduceByIndex('sales', 'byTimestamp', {
    range,
    matches,
    initial: { count: 0, netTotal: 0 },
    reduceFn: (acc, s) => ({
      count: acc.count + 1,
      netTotal: acc.netTotal + (s.total - s.refundedTotal + (s.creditInterestTotal || 0)),
    }),
  });
}

/** Faixa de chaves de `dailySales` (strings "AAAA-MM-DD") equivalente ao
 * `fromTs`/`toTs` em milissegundos recebido por summarizeSales — quem
 * chama isso sempre manda os dois já alinhados a 00:00:00/23:59:59.999
 * locais (ver views/salesHistory.js, views/logs.js e dashboard.js), então
 * "converter pro dia" nunca perde nem inclui um pedaço de dia a mais. */
function dateKeyRangeFromTs(fromTs, toTs) {
  if (fromTs == null && toTs == null) return undefined;
  const from = fromTs != null ? localDateKey(fromTs) : undefined;
  const to = toTs != null ? localDateKey(toTs) : undefined;
  if (from != null && to != null) return IDBKeyRange.bound(from, to);
  if (from != null) return IDBKeyRange.lowerBound(from);
  return IDBKeyRange.upperBound(to);
}

/** Calcula as linhas do placar diário (uma por dia com pelo menos 1 venda)
 * a partir de uma lista de vendas — computação PURA, sem tocar o banco, de
 * propósito: assim dá pra encaixar o resultado dentro de QUALQUER
 * transação que precise gravá-lo, inclusive uma que já esteja fazendo
 * outra coisa (ver data/backupRepo.js#applyBackup logo abaixo, que grava
 * isto na MESMA transação atômica da restauração, não numa chamada
 * separada depois).
 *
 * Achado de auditoria (dinheiro não pode ter brecha): diferente de
 * createSale/refundSaleItems (onde `sale`/`totalRefunded` são sempre
 * valores que ESTA função acabou de calcular), aqui a venda pode vir de um
 * backup restaurado — potencialmente de uma versão mais antiga do sistema,
 * ou mexida à mão. Um `timestamp` inválido vira uma chave de dia
 * "NaN-NaN-NaN" — inofensiva sozinha, mas por ordenação de string ela
 * ficaria DEPOIS de qualquer data real, entrando em consultas "de hoje em
 * diante" por engano. Uma venda assim é pulada (não é possível saber de
 * que dia ela é de verdade), não silenciada: seu total continua fora do
 * placar, mas pelo menos não contamina o dia errado. */
function computeDailySalesRows(sales) {
  const byDay = new Map();
  for (const s of sales) {
    if (!Number.isFinite(s.timestamp)) continue;
    const key = localDateKey(s.timestamp);
    const row = byDay.get(key) || { date: key, count: 0, netTotal: 0 };
    row.count += 1;
    row.netTotal += (Number(s.total) || 0) - (Number(s.refundedTotal) || 0) + (Number(s.creditInterestTotal) || 0);
    byDay.set(key, row);
  }
  return Array.from(byDay.values());
}

/** Reconstrói o placar diário (dailySales) do zero a partir das vendas
 * atuais, numa transação própria. `sales`, se não informado, é lido do
 * banco (dbGetAll). Continua existindo como função à parte (além de
 * computeDailySalesRows acima) pra quem precisa recalcular o placar
 * SOZINHO, fora do fluxo de restauração de backup — ex: os testes de
 * regressão do próprio placar. */
export async function rebuildDailySales(sales) {
  const list = sales || await dbGetAll('sales');
  const rows = computeDailySalesRows(list);
  await dbTransaction(['dailySales'], 'readwrite', (transaction) => {
    const store = transaction.objectStore('dailySales');
    store.clear();
    for (const row of rows) store.put(row);
  });
}

export { computeDailySalesRows };

/** Percorre as vendas de um período direto pelo índice de data, sem
 * carregar a tabela inteira em memória primeiro (ver dbReduceByIndex) —
 * usada por Relatórios (data/reportsRepo.js), que precisa visitar cada
 * venda do período pra somar receita/margem/curva ABC, mas não precisa
 * (nem deve, com anos de histórico acumulado) tocar vendas fora do
 * período escolhido só porque listSales() trazia tudo de uma vez. Um
 * relatório "Todo o período" ainda visita todas as vendas — é inerente a
 * somar o histórico inteiro — mas "Hoje"/"7 dias"/"30 dias" (o caso mais
 * comum) agora só toca as vendas daquela janela. */
export async function reduceSales({ fromTs, toTs, reduceFn, initial }) {
  const range = timestampRange(fromTs, toTs);
  return dbReduceByIndex('sales', 'byTimestamp', { range, reduceFn, initial });
}

/** Estorna um ou mais itens de uma venda (total ou parcial). Devolve a
 * quantidade ao estoque, marca quanto de cada item já foi devolvido e
 * adiciona um registro em `refunds` — a venda original nunca é alterada
 * retroativamente, só ganha esse histórico por cima. `generateCredit`
 * sinaliza que o valor pode virar crédito de troca numa venda futura (ver
 * session.js); quem usa o crédito depois é a tela de Nova Venda, não este
 * módulo.
 *
 * A validação (quanto ainda dá pra estornar de cada item), o incremento de
 * `qtyRefunded` E o crédito de volta ao estoque (produto + movimentação)
 * acontecem dentro de UMA ÚNICA transação do IndexedDB cobrindo `sales`,
 * `products` e `stockMovements` — mesmo padrão de createSale() logo acima.
 *
 * Achado de auditoria extrema (pré-lançamento): antes, o estorno da venda em
 * si já era atômico (get+put na mesma transação, evitando o "lost update"
 * de dois estornos quase simultâneos), mas o crédito de estoque de volta
 * acontecia DEPOIS, em chamadas separadas (uma por item, via
 * stockRepo.recordMovement). Se o navegador fechasse/travasse exatamente
 * entre o estorno já confirmado e o crédito de estoque terminar, a venda
 * ficava corretamente marcada como estornada — mas o produto continuava
 * "faltando" no sistema, mesmo estando de volta na prateleira de verdade.
 * Juntar as duas coisas na mesma transação fecha essa janela: ou a venda
 * estornada E o estoque creditado existem juntos, ou nenhum dos dois. */
// Achado de auditoria (P0, mesma classe do dedupeKey de createSale): o
// modal de estorno (views/salesHistory.js) usa o mesmo openModal() genérico
// que só desabilita o botão de confirmar — a mesma proteção comprovada
// insuficiente sozinha. Testado concretamente: duas chamadas concorrentes
// de refundSaleItems() pedindo a MESMA quantidade (1 de 3 unidades de uma
// venda) resultaram nas DUAS sendo aceitas — 2 unidades devolvidas ao
// estoque e refundedTotal dobrado, a partir de uma única intenção de
// estorno. A checagem natural de "não estornar mais do que existe"
// (`qtyRefunded` vs `qty`) só protege um estorno TOTAL (onde a segunda
// tentativa excederia o disponível) — um estorno PARCIAL como o do teste
// passa batido nela, porque a soma das duas tentativas ainda cabia dentro
// da quantidade original. `dedupeKey` fecha essa lacuna do mesmo jeito já
// usado no resto do sistema.
export async function refundSaleItems({ saleId, userId, userName, reason, items, generateCredit = false, cashSessionId = null, dedupeKey = null }) {
  if (!reason || !reason.trim()) throw new Error('Informe o motivo do estorno.');
  if (!items || items.length === 0) throw new Error('Selecione ao menos um item para estornar.');

  let refund;
  let updatedSale;
  let refundError = null;

  try {
    await dbTransaction(['sales', 'products', 'stockMovements', 'dailySales', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const salesStore = transaction.objectStore('sales');
      const productsStore = transaction.objectStore('products');
      const movementsStore = transaction.objectStore('stockMovements');

      const fail = (message) => {
        refundError = message;
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      };

      claimIdempotencyKey(transaction, dedupeKey, () => fail('Este estorno já foi registrado — evite reenviar.'));

      const getSaleReq = salesStore.get(saleId);
      getSaleReq.onsuccess = () => {
        const sale = getSaleReq.result;
        if (!sale) { fail('Venda não encontrada.'); return; }

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
          // Achado de auditoria: casar o item a estornar só por `productId`
          // (como sempre foi) parte do princípio de que uma venda nunca tem
          // duas LINHAS do mesmo produto — verdade pra produto normal (o
          // carrinho sempre soma na mesma linha), mas não pra um produto
          // 'personalizado' vendido em mais de uma forma na MESMA venda
          // (ex: 3 latas + 1 metro de areia, ver data/productsRepo.js): as
          // duas linhas têm o mesmo `productId`, e `.find()` sempre pegava
          // a PRIMEIRA — um estorno pedido pra segunda forma silenciosamente
          // estornava a primeira (produto/valor errado). `itemIndex` (a
          // posição da linha dentro de `sale.items`, opcional) desambigua
          // isso — quando informado, é a fonte de verdade; sem ele (chamada
          // antiga, ou produto que nunca teve mais de uma linha), continua
          // casando só por `productId`, sem quebrar nada existente.
          const saleItem = req.itemIndex != null
            ? sale.items[req.itemIndex]
            : sale.items.find((i) => i.productId === req.productId);
          if (!saleItem) { fail('Item não encontrado nesta venda.'); return; }
          const available = saleItem.qty - saleItem.qtyRefunded;
          if (qty > available) {
            fail(`Só é possível estornar até ${formatQty(available)} de "${saleItem.name}" (já estornado: ${formatQty(saleItem.qtyRefunded)}).`);
            return;
          }
          const unitNet = (saleItem.lineTotal / saleItem.qty) * discountRatio;
          const amount = unitNet * qty;
          // `saleItem.formFator` é o fator GRAVADO na venda original (item
          // de produto 'personalizado'), não o fator atual do produto — se
          // o cadastro for editado depois (fator diferente, ou a forma
          // renomeada/removida), o estorno credita de volta exatamente o
          // que aquela venda tirou do estoque na hora, nem mais nem menos.
          refundItems.push({ productId: saleItem.productId, name: saleItem.name, qty, amount, stockQty: qty * (saleItem.formFator || 1) });
          totalRefunded += amount;
          saleItem.qtyRefunded += qty;
        }

        if (refundItems.length === 0) { fail('Selecione ao menos um item para estornar.'); return; }

        // Nota (auditoria de bugs/vazamentos): estorno aqui só devolve o lado
        // "produto" da venda (`sale.refundedTotal`, calculado acima a partir do
        // preço líquido dos itens). `sale.creditInterestTotal` e
        // `payments[].interestAmount` — o juro do parcelamento já cobrado na
        // maquininha (ver createSale mais acima) — NÃO são reduzidos nem
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
          // Achado de auditoria: a sessão de caixa gravada aqui é a que estava
          // ABERTA no momento do ESTORNO (agora), não a sessão em que a venda
          // original foi feita — são coisas diferentes (um cliente pode devolver
          // hoje algo comprado semana passada, num caixa que já fechou há muito
          // tempo). cashRepo.js#computeExpectedAmounts usa isso pra saber em
          // qual fechamento de caixa o dinheiro que sai da gaveta entra na
          // conferência — sem isso (campo não existia antes), o estorno de uma
          // venda de sessão já fechada nunca aparecia em NENHUMA conferência,
          // mesmo tirando dinheiro de verdade da gaveta hoje.
          cashSessionId,
        };
        sale.refunds.push(refund);
        sale.hasRefunds = 1;
        sale.refundedTotal += totalRefunded;
        updatedSale = sale;

        // Reduz o placar diário (ver db.js#DB_VERSION 7) pelo valor
        // estornado — no dia da VENDA original (`sale.timestamp`), não no
        // dia do estorno: mesma regra já usada em "vendas de hoje" em todo
        // o resto do sistema ("é a venda que define a data, não o
        // estorno" — ver views/salesHistory.js e data/reportsRepo.js). Só
        // o total líquido muda; a CONTAGEM de vendas do dia não muda (a
        // venda continua tendo acontecido naquele dia, só rendeu menos).
        // Se não existir linha pra aquele dia (venda de antes desta
        // versão existir, ainda sem backfill rodado por algum motivo),
        // não tem o que decrementar — melhor deixar como está do que
        // criar uma linha negativa do nada.
        const dailyStore = transaction.objectStore('dailySales');
        const dateKey = localDateKey(sale.timestamp);
        const getDailyReq = dailyStore.get(dateKey);
        getDailyReq.onsuccess = () => {
          const row = getDailyReq.result;
          // `totalRefunded` (calculado acima nesta mesma função, a partir
          // de qty/preço já validados) é sempre um número aqui — o
          // `Number(...) || 0` é defensivo mesmo assim, mesmo raciocínio do
          // `|| 0` em createSale (achado de auditoria de dinheiro).
          if (row) dailyStore.put({ ...row, netTotal: row.netTotal - (Number(totalRefunded) || 0) });
        };

        // Credita o estoque de cada item estornado — sequencial (uma leitura
        // só depois que a anterior terminou), mesmo raciocínio de createSale:
        // se o mesmo produto aparecer em mais de um item do estorno, a
        // segunda leitura precisa enxergar o efeito da primeira.
        function creditItem(idx) {
          if (idx >= refundItems.length) {
            salesStore.put(sale);
            return;
          }
          const ri = refundItems[idx];
          const getProductReq = productsStore.get(ri.productId);
          getProductReq.onsuccess = () => {
            const product = getProductReq.result;
            if (!product) {
              fail(`Produto de "${ri.name}" não existe mais no catálogo — não foi possível creditar o estoque do estorno.`);
              return;
            }
            productsStore.put({ ...product, quantity: product.quantity + ri.stockQty, updatedAt: Date.now() });
            movementsStore.add({
              id: newId(), productId: ri.productId, type: 'estorno', qty: ri.stockQty,
              userId, userName, note: `Estorno da venda — ${reason.trim()}`, timestamp: Date.now(),
            });
            creditItem(idx + 1);
          };
        }
        creditItem(0);
      };
    });
  } catch (err) {
    throw new Error(refundError || err.message);
  }

  // A partir daqui o estorno já está gravado, validado E com o estoque já
  // creditado, tudo de forma atômica — o que resta (reduzir dívida de
  // fiado, reverter pontos de fidelidade) é efeito colateral monetário
  // menos crítico, mantido como chamadas separadas: se algo falhar aqui, o
  // estorno em si (incluindo o estoque) permanece registrado e correto; o
  // erro sobe pra quem chamou avisar que a dívida/pontos podem não ter sido
  // ajustados.

  // Achado de auditoria: estornar uma venda paga (total ou parcialmente)
  // em fiado não reduzia a dívida do cliente nada — devolvia a mercadoria
  // pro estoque mas continuava cobrando o valor cheio de quem já devolveu
  // o produto. Reduz proporcionalmente, mesmo raciocínio de pontos de
  // fidelidade logo abaixo (estornar metade do carrinho reduz a metade do
  // que aquela venda gerou de dívida, não o valor cheio).
  let debtReduced = 0;
  if (updatedSale.customerId && updatedSale.total > 0) {
    const fiadoTotal = (updatedSale.payments || [])
      .filter((p) => p.method === FIADO_METHOD)
      .reduce((sum, p) => sum + p.amount, 0);
    if (fiadoTotal > 0) {
      debtReduced = fiadoTotal * (refund.totalRefunded / updatedSale.total);
      await recordDebtRefund({
        customerId: updatedSale.customerId, amount: debtReduced,
        saleId: updatedSale.id, refundId: refund.id, userId, userName,
      });
    }
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

  return { sale: updatedSale, refund, debtReduced };
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
