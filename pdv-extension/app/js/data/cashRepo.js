// Caixa da loja: abertura, sangria/suprimento e fechamento com conferência.
// Modelo de caixa único (uma sessão aberta por vez pra loja toda, não por
// vendedor) — combina com uma loja com uma frente de caixa física, onde
// quem está de turno abre e fecha antes de passar pro próximo.
import { dbGetAll, dbGet, dbGetAllByIndex, dbTransaction, dbUpdate, claimIdempotencyKey, newId } from '../db.js';
import { listPaymentsForCashSession } from './customersRepo.js';

const CREDIT_METHOD = 'Crédito de troca';
const FIADO_METHOD = 'Fiado';

export async function getOpenSession() {
  const sessions = await dbGetAllByIndex('cashSessions', 'byStatus', 'aberto');
  return sessions[0] || null;
}

export async function listSessions() {
  const sessions = await dbGetAll('cashSessions');
  return sessions.sort((a, b) => b.openedAt - a.openedAt);
}

async function getSession(id) {
  return dbGet('cashSessions', id);
}

/** Abre um caixa novo — só se não existir nenhum já aberto (o sistema é de
 * um caixa único pra loja toda). A checagem "já existe um aberto?" e a
 * gravação da sessão nova acontecem dentro da MESMA transação
 * (dbTransaction) — o índice `byStatus` não é único (não daria pra marcar
 * só "aberto" como único e permitir vários "fechado"), então sem essa
 * trava um clique duplo em "Abrir caixa" podia ler "nenhum aberto" duas
 * vezes antes de qualquer uma gravar, criando dois caixas abertos ao mesmo
 * tempo — quebrando a premissa que o resto do sistema assume (inclusive a
 * conferência de fechamento, que soma vendas contra UMA sessão só). */
export async function openSession({ userId, userName, openingAmount }) {
  // Achado de auditoria (P1): `Number(openingAmount) || 0` bloqueia
  // negativo e NaN, mas não `Infinity` (sobrevive ao `|| 0`) — como
  // `expected.Dinheiro` (a conferência inteira da sessão) é SEMEADA a
  // partir deste valor (ver computeExpectedAmounts abaixo) e não existe
  // função pra editar `openingAmount` depois de aberto, um valor Infinity
  // aqui corrompe a conferência de caixa da sessão INTEIRA desde o
  // primeiro instante, de forma permanente.
  const parsedOpening = Number(openingAmount);
  if (!Number.isFinite(parsedOpening) || parsedOpening < 0) {
    throw new Error('Informe um valor de abertura válido.');
  }
  const session = {
    id: newId(),
    status: 'aberto',
    openedBy: { userId, userName },
    openedAt: Date.now(),
    openingAmount: parsedOpening,
    closedBy: null,
    closedAt: null,
    countedAmounts: null,
    expectedAmounts: null,
    difference: null,
    closingNotes: '',
  };

  let validationError = null;
  await dbTransaction('cashSessions', 'readwrite', (transaction) => {
    const store = transaction.objectStore('cashSessions');
    const getAllReq = store.index('byStatus').getAll('aberto');
    getAllReq.onsuccess = () => {
      if (getAllReq.result.length > 0) {
        validationError = 'Já existe um caixa aberto. Feche-o antes de abrir um novo.';
        return;
      }
      store.add(session);
    };
  });
  if (validationError) throw new Error(validationError);
  return session;
}

export async function listSessionMovements(sessionId) {
  const movements = await dbGetAllByIndex('cashMovements', 'bySessionId', sessionId);
  return movements.sort((a, b) => b.timestamp - a.timestamp);
}

/** Sangria (retirada) ou suprimento (reforço) de dinheiro no caixa aberto —
 * sempre em espécie, é o que muda fisicamente a gaveta.
 *
 * Achado de auditoria (P1 + P2, dinheiro não pode ter brecha):
 * 1) `Number(amount) || 0` não bloqueava `Infinity` — sem teto nenhum
 *    depois, um valor assim entrava direto na conferência de fechamento
 *    (`computeExpectedAmounts` faz `expected.Dinheiro -= m.amount`),
 *    virando `-Infinity` PRA SEMPRE (não existe função pra excluir uma
 *    movimentação já lançada). `Number.isFinite` fecha isso.
 * 2) A função só bloqueava um valor MAIOR que zero — nunca uma submissão
 *    DUPLICADA e legítima (ex: uma chamada repetida sem passar pela tela,
 *    ou duas abas confirmando quase junto). `dedupeKey` (opcional, gerada
 *    uma vez por abertura do modal) fecha essa segunda classe: a mesma
 *    chave só pode ser usada uma vez, verificado dentro da MESMA transação
 *    atômica que grava a movimentação (ver db.js#claimIdempotencyKey). */
export async function recordCashMovement({ sessionId, type, amount, reason, userId, userName, dedupeKey }) {
  if (!reason || !reason.trim()) throw new Error('Informe o motivo do movimento de caixa.');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero.');

  const movement = {
    id: newId(),
    sessionId,
    type, // 'sangria' | 'suprimento'
    amount: value,
    reason: reason.trim(),
    userId, userName,
    timestamp: Date.now(),
  };

  let opError = null;
  try {
    await dbTransaction(['cashSessions', 'cashMovements', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const fail = (message) => {
        opError = message;
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      };
      claimIdempotencyKey(transaction, dedupeKey, () => fail('Este movimento já foi registrado — evite reenviar.'));
      const getSessionReq = transaction.objectStore('cashSessions').get(sessionId);
      getSessionReq.onsuccess = () => {
        const session = getSessionReq.result;
        if (!session || session.status !== 'aberto') { fail('Este caixa não está mais aberto.'); return; }
        transaction.objectStore('cashMovements').add(movement);
      };
    });
  } catch (err) {
    throw new Error(opError || err.message);
  }
  return movement;
}

/** Valor "efetivo" atual do troco inicial ou de uma sangria/suprimento
 * específico, depois de aplicar toda retificação (`type: 'ajuste'`) já
 * lançada em cima dele. Uma retificação NUNCA edita o lançamento original —
 * é a partir deste valor efetivo (não do valor bruto lançado na hora) que a
 * PRÓXIMA retificação calcula sua diferença, senão duas retificações
 * seguidas na mesma sangria/suprimento dariam resultado errado (a segunda
 * "pisaria" na primeira em vez de somar em cima dela). */
export function effectiveAmount(targetType, baseAmount, movements, targetMovementId = null) {
  const totalDelta = movements
    .filter((m) => m.type === 'ajuste' && m.targetType === targetType
      && (targetType === 'abertura' || m.targetMovementId === targetMovementId))
    .reduce((sum, m) => sum + m.amount, 0);
  // Sangria contribui NEGATIVAMENTE pro Dinheiro esperado (ver
  // computeExpectedAmounts abaixo) — então uma retificação que aumenta o
  // esperado (delta positivo) na verdade DIMINUI a magnitude da sangria.
  return targetType === 'sangria' ? baseAmount - totalDelta : baseAmount + totalDelta;
}

/** Retificação de um erro em lançamento já feito no caixa aberto — troco
 * inicial, uma sangria ou um suprimento específico. NUNCA edita ou apaga o
 * lançamento original (openingAmount e cashMovements continuam imutáveis de
 * propósito, ver comentários acima) — grava um movimento tipo 'ajuste' por
 * cima, com a DIFERENÇA entre o valor efetivo atual e o valor corrigido,
 * sempre com motivo obrigatório e referenciando exatamente o que está sendo
 * corrigido (targetType + targetMovementId). Mesmo princípio de estorno
 * contábil: o rastro do erro original fica intacto (dá pra reconstruir a
 * história inteira depois, inclusive quem errou e quem corrigiu), só entra
 * uma correção rastreável em cima — nunca uma reescrita silenciosa. */
export async function recordCashAdjustment({
  sessionId, targetType, targetMovementId = null, originalAmount, correctedAmount, reason, userId, userName, dedupeKey,
}) {
  if (!['abertura', 'sangria', 'suprimento'].includes(targetType)) {
    throw new Error('Tipo de retificação inválido.');
  }
  if (targetType !== 'abertura' && !targetMovementId) {
    throw new Error('Selecione qual lançamento está sendo corrigido.');
  }
  if (!reason || !reason.trim()) throw new Error('Informe o motivo da retificação.');
  const original = Number(originalAmount);
  const corrected = Number(correctedAmount);
  if (!Number.isFinite(original) || !Number.isFinite(corrected) || corrected < 0) {
    throw new Error('Informe um valor corrigido válido.');
  }
  if (corrected === original) throw new Error('O valor corrigido é igual ao valor atual — nada a retificar.');
  const dinheiroDelta = targetType === 'sangria' ? -(corrected - original) : (corrected - original);

  const movement = {
    id: newId(),
    sessionId,
    type: 'ajuste',
    amount: dinheiroDelta,
    targetType, // 'abertura' | 'sangria' | 'suprimento'
    targetMovementId: targetType === 'abertura' ? null : targetMovementId,
    originalAmount: original,
    correctedAmount: corrected,
    reason: reason.trim(),
    userId, userName,
    timestamp: Date.now(),
  };

  let opError = null;
  try {
    await dbTransaction(['cashSessions', 'cashMovements', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const fail = (message) => {
        opError = message;
        try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
      };
      claimIdempotencyKey(transaction, dedupeKey, () => fail('Esta retificação já foi registrada — evite reenviar.'));
      const getSessionReq = transaction.objectStore('cashSessions').get(sessionId);
      getSessionReq.onsuccess = () => {
        const session = getSessionReq.result;
        if (!session || session.status !== 'aberto') { fail('Este caixa não está mais aberto.'); return; }

        // Achado de auditoria: `originalAmount` vem do NAVEGADOR (calculado
        // por effectiveAmount() com a lista de movimentos que a tela tinha
        // em memória quando o modal abriu) — diferente de sangria/suprimento
        // (que só somam um delta fixo, sem depender de estado anterior),
        // retificação calcula sua diferença EM CIMA de um valor derivado.
        // Se duas pessoas (ou duas abas) abrirem "Retificar" pro MESMO
        // lançamento quase ao mesmo tempo, a segunda a confirmar aplicaria
        // sua diferença sobre uma base já desatualizada pela primeira,
        // corrompendo o valor final sem avisar ninguém. Fecha isso lendo os
        // movimentos de novo AQUI DENTRO da transação (dado mais fresco
        // possível) e conferindo se o valor efetivo atual ainda bate com o
        // que o navegador achava que era — se não bater, rejeita e pede pra
        // atualizar a tela, em vez de aplicar a correção sobre base errada.
        const movementsReq = transaction.objectStore('cashMovements').index('bySessionId').getAll(sessionId);
        movementsReq.onsuccess = () => {
          const currentMovements = movementsReq.result;
          const currentEffective = targetType === 'abertura'
            ? effectiveAmount('abertura', session.openingAmount, currentMovements)
            : (() => {
                const base = currentMovements.find((m) => m.id === targetMovementId && (m.type === 'sangria' || m.type === 'suprimento'));
                if (!base) return null;
                return effectiveAmount(targetType, base.amount, currentMovements, targetMovementId);
              })();
          if (currentEffective === null) { fail('O lançamento que você está corrigindo não foi encontrado — pode já ter sido retificado por outra pessoa. Atualize a tela e tente de novo.'); return; }
          if (Math.abs(currentEffective - original) > 0.005) {
            fail('O valor mudou desde que essa correção foi aberta (outra retificação pode ter sido lançada nesse meio-tempo). Atualize a tela e tente de novo.');
            return;
          }
          transaction.objectStore('cashMovements').add(movement);
        };
      };
    });
  } catch (err) {
    throw new Error(opError || err.message);
  }
  return movement;
}

/** Calcula quanto DEVERIA ter em caixa por forma de pagamento, a partir do
 * valor de abertura, das vendas feitas durante a sessão e das sangrias
 * /suprimentos. Só "Dinheiro" corresponde a espécie física na gaveta —
 * outras formas (cartão, pix) são só conferência informativa contra o
 * extrato da maquininha depois, não entram na sangria/suprimento.
 *
 * Simplificação assumida: um estorno que NÃO gerou crédito de troca é
 * tratado como devolução em dinheiro (reduz o esperado em espécie) — é o
 * caso mais comum numa loja pequena sem controle de qual forma original foi
 * usada no reembolso. Estorno que gerou crédito não mexe em caixa (a loja
 * ficou com o dinheiro, o cliente ficou com o crédito). Venda com pagamento
 * em "Fiado" também não entra aqui (é dívida, não dinheiro agora) — só
 * conta quando o cliente vier pagar de verdade (ver listPaymentsForCashSession).
 *
 * Achado de auditoria (dois problemas na mesma conta, corrigidos juntos):
 *
 * 1) Estorno de uma venda de OUTRA sessão (já fechada) nunca entrava na
 *    conferência de sessão nenhuma — o laço original só olhava pra
 *    `sale.refunds` de vendas cujo `cashSessionId` fosse desta sessão (ou
 *    seja, só estorno de venda feita HOJE). Só que devolução de compra de
 *    dias/semanas atrás, feita com o caixa de hoje aberto, tira dinheiro da
 *    gaveta de HOJE — e o sistema simplesmente não esperava esse dinheiro
 *    sair, gerando uma diferença de fechamento que parece erro/furo de
 *    caixa sem ser. Corrigido buscando estornos em TODAS as vendas, filtrado
 *    pelo `cashSessionId` gravado em CADA ESTORNO (a sessão aberta no
 *    momento do estorno em si, ver salesRepo.js#refundSaleItems) — não mais
 *    pelo `cashSessionId` da venda original.
 *
 * 2) Estornar uma venda paga (total ou parcialmente) em Fiado sempre
 *    reduzia o "Dinheiro" esperado pelo valor cheio do estorno — mas a
 *    parte fiada de uma venda nunca colocou dinheiro na gaveta (é dívida,
 *    ver acima), então devolver o produto e reduzir a dívida do cliente
 *    (customersRepo.js#recordDebtRefund) não tira nada de espécie da
 *    gaveta. Sem isso, o fechamento "esperava" menos dinheiro do que
 *    deveria sempre que um estorno tocasse uma venda com Fiado no meio —
 *    mesmo raciocínio proporcional já usado pra reduzir a dívida (a fração
 *    fiada da venda também é a fração fiada do estorno). */
export async function computeExpectedAmounts(session) {
  // Achado de auditoria (a loja não pode engasgar com fluxo grande de
  // vendas): esta função roda a CADA renderização do Caixa, sangria,
  // suprimento, retificação e fechamento. Antes, carregava `listSales()` —
  // a tabela `sales` INTEIRA, desde o dia 1 da loja — só pra filtrar em
  // memória as poucas linhas desta sessão. Mesmo bug já corrigido antes em
  // Relatórios/Histórico/Painel (ver dbScanByIndex em db.js), ficou faltando
  // só aqui. Agora usa os índices `byCashSessionId`/`byHasRefunds` de
  // `sales` (ver db.js#DB_VERSION 9): o custo passa a ser proporcional ao
  // que esta sessão de caixa realmente movimentou, não ao histórico inteiro
  // da loja.
  const sessionSales = await dbGetAllByIndex('sales', 'byCashSessionId', session.id);
  // Estornos podem tocar uma venda de QUALQUER sessão passada (ver
  // comentário grande acima) — não dá pra restringir pelo `cashSessionId`
  // da venda em si, então varre só as vendas que JÁ tiveram algum estorno
  // algum dia (tipicamente uma fração pequena do total), não a tabela toda.
  const salesWithRefunds = await dbGetAllByIndex('sales', 'byHasRefunds', 1);
  const movements = await listSessionMovements(session.id);
  const debtPayments = await listPaymentsForCashSession(session.id);

  const expected = { Dinheiro: session.openingAmount };
  const ensure = (method) => { if (!(method in expected)) expected[method] = 0; };

  for (const sale of sessionSales) {
    for (const payment of sale.payments) {
      if (payment.method === CREDIT_METHOD || payment.method === FIADO_METHOD) continue; // não é dinheiro novo entrando
      ensure(payment.method);
      expected[payment.method] += payment.amount;
    }
  }

  for (const sale of salesWithRefunds) {
    const fiadoTotal = sale.payments.filter((p) => p.method === FIADO_METHOD).reduce((sum, p) => sum + p.amount, 0);
    const fiadoRatio = sale.total > 0 ? fiadoTotal / sale.total : 0;
    for (const refund of sale.refunds) {
      if (refund.cashSessionId !== session.id) continue; // estorno de/para outra sessão — não mexe na gaveta de hoje
      if (refund.creditGenerated) continue; // virou crédito, não saiu dinheiro da gaveta
      expected.Dinheiro -= refund.totalRefunded * (1 - fiadoRatio); // só a parte não-fiada saiu de espécie
    }
  }

  for (const payment of debtPayments) {
    ensure(payment.paymentMethod);
    expected[payment.paymentMethod] += payment.amount;
  }

  for (const m of movements) {
    if (m.type === 'suprimento') expected.Dinheiro += m.amount;
    if (m.type === 'sangria') expected.Dinheiro -= m.amount;
    // 'ajuste' (retificação) já guarda a DIFERENÇA pronta em `amount`, sinal
    // incluído (calculado em recordCashAdjustment) — soma direto, sem
    // repetir a lógica de sinal de sangria/suprimento aqui.
    if (m.type === 'ajuste') expected.Dinheiro += m.amount;
  }

  return expected;
}

export async function closeSession({ sessionId, userId, userName, countedAmounts, closingNotes = '' }) {
  const session = await getSession(sessionId);
  if (!session || session.status !== 'aberto') throw new Error('Este caixa não está mais aberto.');

  // computeExpectedAmounts faz leituras em outros stores (vendas, extrato
  // de fiado) — não dá pra rodar isso dentro de um dbUpdate (que exige uma
  // função síncrona). Fica de fora; a proteção contra fechar o mesmo caixa
  // duas vezes concorrentemente é a re-checagem de `status` logo abaixo,
  // dentro do dbUpdate — feita com o valor mais recente do registro, não
  // com o `session` já potencialmente desatualizado lido no começo desta
  // função.
  const expectedAmounts = await computeExpectedAmounts(session);
  const counted = {};
  for (const [method, value] of Object.entries(countedAmounts || {})) {
    // Contagem física digitada por uma pessoa — improvável de virar
    // Infinity sem querer, mas protegida do mesmo jeito (achado de
    // auditoria) por consistência com o resto do arquivo.
    const parsed = Number(value);
    counted[method] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  const difference = (counted.Dinheiro ?? 0) - (expectedAmounts.Dinheiro ?? 0);

  return dbUpdate('cashSessions', sessionId, (current) => {
    if (!current || current.status !== 'aberto') {
      throw new Error('Este caixa não está mais aberto.');
    }
    return {
      ...current,
      status: 'fechado',
      closedBy: { userId, userName },
      closedAt: Date.now(),
      expectedAmounts,
      countedAmounts: counted,
      difference,
      closingNotes: closingNotes.trim(),
    };
  });
}
