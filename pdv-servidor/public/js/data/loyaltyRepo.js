// Pontos de fidelidade — versão multi-terminal, Fase 9 passo 8 (o que
// views/clientes.js precisa pro resgate de pontos).
//
// Achado de arquitetura, FECHADO num passo posterior à Fase 9
// (`getCustomerCredit` abaixo + `views/sale.js`): o resgate aqui sempre
// persistiu o crédito gerado direto em `store_credits`
// (ver routes/loyalty.js#commitRedemption) — diferente de
// data/loyaltyRepo.js#recordRedemption da extensão, que só devolve o
// valor e deixa a TELA chamar session.js#addPendingCredit() separado
// (crédito fica só na sessão/aba de quem resgatou). views/clientes.js
// continua copiada sem alteração, então ainda chama addPendingCredit()
// depois — isso virou um atalho local inerte (nada mais lê o que ele
// escreve; o crédito real já está gravado, correto e auditável, no
// servidor desde sempre). `views/sale.js` (a única mudança de verdade
// desta correção, fora do princípio "portar sem reescrever" da Fase 9 de
// propósito) agora consulta `getCustomerCredit()` sempre que um cliente é
// selecionado — o saldo mostrado e aplicável como pagamento passa a ser o
// SALDO REAL do cliente, sempre igual em qualquer terminal, não mais o
// que sobrou no `localStorage` de quem gerou o crédito.
import { api, newDedupeKey } from './apiClient.js';

/** Extrato de pontos (ganho/resgate) do cliente — mesmo contrato de
 * listCustomerLoyaltyLedger() da extensão. */
export async function listCustomerLoyaltyLedger(customerId) {
  const { ledger } = await api(`/api/loyalty/${encodeURIComponent(customerId)}`);
  return ledger;
}

/** Saldo de pontos do cliente — mesmo contrato de getCustomerPoints() da
 * extensão. O servidor já calcula isso na mesma consulta do extrato (ver
 * routes/loyalty.js), então usa o valor pronto em vez de somar o extrato
 * de novo aqui. */
export async function getCustomerPoints(customerId) {
  const { points } = await api(`/api/loyalty/${encodeURIComponent(customerId)}`);
  return points;
}

/** Saldo de CRÉDITO DE TROCA do cliente — sem equivalente na extensão
 * (lá, o crédito nunca é persistido por cliente num servidor central, só
 * fica na sessão/aba de quem gerou; ver comentário no topo do arquivo).
 * Mesma consulta de `getCustomerPoints`, só o campo `credit` — usado por
 * `views/sale.js` sempre que um cliente é selecionado, pra oferecer o
 * saldo real como forma de pagamento, gerado em QUALQUER terminal. */
export async function getCustomerCredit(customerId) {
  const { credit } = await api(`/api/loyalty/${encodeURIComponent(customerId)}`);
  return credit;
}

/** Resgate de pontos — mesmo contrato de recordRedemption() da extensão
 * (devolve `{ amount, ... }`, o valor em R$ do crédito gerado). A checagem
 * de saldo e a trava contra reenvio (dedupeKey) já vivem no servidor
 * (routes/loyalty.js#commitRedemption, mesma transação atômica). */
export async function recordRedemption({ customerId, points, note = '', userId, userName, dedupeKey = null }) {
  void note; void userId; void userName; // servidor resolve identidade sozinho; nota fixa é gravada lá (ver commitRedemption)
  return api(`/api/loyalty/${encodeURIComponent(customerId)}/resgatar`, {
    method: 'POST',
    body: JSON.stringify({ points, dedupeKey: dedupeKey || newDedupeKey() }),
  });
}

/** Saldo de pontos de TODOS os clientes de uma vez (evita N consultas
 * separadas — usado pelo Painel pra somar "pontos em aberto" na loja
 * inteira) — mesmo contrato de getAllPointsBalances() da extensão: um
 * objeto {customerId: pontos}, não o {points, credit} bruto que o
 * servidor devolve (ver routes/loyalty.js GET /balances, que também traz
 * o crédito de troca de todo mundo — aqui só a parte de pontos importa). */
export async function getAllPointsBalances() {
  const { points } = await api('/api/loyalty/balances');
  return points;
}
