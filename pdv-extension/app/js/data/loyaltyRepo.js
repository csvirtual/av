// Pontos de fidelidade. Segue o mesmo padrão de extrato usado no fiado
// (customerDebts) — o saldo de pontos nunca é um número solto, é sempre a
// soma dos lançamentos (ganho de venda, resgate), o que preserva o
// histórico completo de como o cliente chegou naquele saldo.
import { dbGetAll, dbAdd, dbGetAllByIndex, dbTransaction, claimIdempotencyKey, newId } from '../db.js';

export async function listCustomerLoyaltyLedger(customerId) {
  const entries = await dbGetAllByIndex('loyaltyEntries', 'byCustomerId', customerId);
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getCustomerPoints(customerId) {
  const entries = await listCustomerLoyaltyLedger(customerId);
  return entries.reduce((sum, e) => sum + (e.type === 'ganho' ? e.points : -e.points), 0);
}

/** Resgate de pontos — converte em crédito de troca (mesma sessão usada
 * pelo estorno), pra reaproveitar o fluxo que já existe no PDV em vez de
 * inventar uma segunda forma de pagamento só pra pontos.
 *
 * Achado de auditoria (mesma classe já corrigida em
 * customersRepo.js#recordPayment): a checagem do saldo e a gravação do
 * resgate precisam estar na MESMA transação do IndexedDB, não um dbGetAll
 * (via getCustomerPoints) seguido de um dbAdd separados. Antes, dois
 * cliques rápidos em "Resgatar pontos" (ou duas abas resgatando pontos do
 * mesmo cliente ao mesmo tempo) liam o mesmo saldo "antes" de qualquer um
 * gravar — os dois passavam na validação "pontos <= saldo" e os dois
 * gravavam um resgate, deixando o cliente resgatar mais pontos do que
 * tinha de verdade. Como o "saldo" aqui não é um campo único (é a soma de
 * todo o extrato, ver comentário no topo do arquivo), a trava não pode
 * usar dbUpdate (que é get+put de UM registro) — a leitura do extrato
 * inteiro e a decisão de gravar ou não ficam dentro do mesmo `work`
 * síncrono do dbTransaction, serializadas pelo próprio IndexedDB. */
// Achado de auditoria (P2, dinheiro não pode ter brecha): a trava do
// dbTransaction já impedia o LOST UPDATE — mas não uma submissão DUPLICADA
// e legítima (ex: uma chamada repetida sem passar pela tela). Duas chamadas
// de "resgatar 100 pontos" contra um saldo de 1000: cada uma, isolada, cabe
// no saldo, e as duas passam — o cliente perde 200 pontos (e o crédito de
// troca correspondente é gerado em dobro) por um único resgate pretendido.
// `dedupeKey` (opcional, gerada uma vez por abertura do modal de resgate)
// fecha isso: a mesma chave só pode ser usada uma vez, verificado dentro da
// MESMA transação atômica (ver db.js#claimIdempotencyKey).
// Achado de auditoria (P1, re-auditoria — mesma classe encontrada em
// customersRepo.js#recordPayment): `claimIdempotencyKey` chamado no início
// da transação reivindicava a chave mesmo quando a checagem de saldo abaixo
// rejeitava o resgate (que não aborta, de propósito, pra manter a mensagem
// amigável) — queimando `dedupeKey` numa tentativa que nunca gravou nada e
// rejeitando como "duplicado" um reenvio legítimo (pontos corrigidos) no
// mesmo modal. Corrigido: só reivindica a chave DEPOIS de passar na
// checagem de saldo, logo antes do `store.add`.
export async function recordRedemption({ customerId, points, note = '', userId, userName, dedupeKey }) {
  const value = Number(points);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe uma quantidade de pontos maior que zero.');

  const entry = {
    id: newId(), customerId, type: 'resgate', points: value,
    saleId: null, note: note.trim(), userId, userName, timestamp: Date.now(),
  };

  let validationError = null;
  try {
    await dbTransaction(['loyaltyEntries', 'idempotencyKeys'], 'readwrite', (transaction) => {
      const store = transaction.objectStore('loyaltyEntries');
      const getAllReq = store.index('byCustomerId').getAll(customerId);
      getAllReq.onsuccess = () => {
        const balance = getAllReq.result.reduce((sum, e) => sum + (e.type === 'ganho' ? e.points : -e.points), 0);
        if (value > balance) {
          // Não aborta — transação termina vazia, sem consumir a chave de
          // idempotência (que só é reivindicada abaixo, depois desta
          // checagem). Ver comentário de recordPayment em customersRepo.js.
          validationError = `O cliente só tem ${balance} pontos disponíveis.`;
          return;
        }
        claimIdempotencyKey(transaction, dedupeKey, () => {
          validationError = 'Este resgate já foi registrado — evite reenviar.';
          try { transaction.abort(); } catch { /* já pode não ter requisição pendente */ }
        });
        store.add(entry);
      };
    });
  } catch (err) {
    throw new Error(validationError || err.message);
  }

  if (validationError) throw new Error(validationError);
  return entry;
}

/** Reverte pontos ganhos por uma venda que foi estornada — chamado pelo
 * salesRepo depois de um estorno. Pontos negativos "puxados de volta" (o
 * cliente já pode ter gastado/resgatado desde então) deixam o saldo
 * negativo até a próxima compra — mesmo compromisso adotado por qualquer
 * programa de fidelidade real, não é um erro de cálculo. */
export async function recordReversal({ customerId, points, saleId, userId, userName }) {
  // Achado de auditoria (P4): sem `Number(...)`, um `points` que não seja
  // já um número (ex: string, undefined) passava direto pra `entry.points`
  // sem conversão nem checagem de `NaN`/`Infinity` — mesmo padrão de
  // proteção já usado no resto do arquivo.
  const value = Number(points);
  if (!Number.isFinite(value) || value <= 0) return null;
  const entry = {
    id: newId(), customerId, type: 'estorno', points: value, saleId,
    note: '', userId, userName, timestamp: Date.now(),
  };
  await dbAdd('loyaltyEntries', entry);
  return entry;
}

export async function getAllPointsBalances() {
  const all = await dbGetAll('loyaltyEntries');
  const balances = {};
  for (const e of all) {
    const delta = e.type === 'ganho' ? e.points : -e.points;
    balances[e.customerId] = (balances[e.customerId] || 0) + delta;
  }
  return balances;
}
