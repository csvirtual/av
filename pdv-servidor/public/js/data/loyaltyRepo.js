// Pontos de fidelidade — versão multi-terminal, Fase 9 passo 8 (o que
// views/clientes.js precisa pro resgate de pontos).
//
// Achado de arquitetura (não corrigido aqui, documentado no README): o
// resgate aqui já persiste o crédito gerado direto em `store_credits`
// (ver routes/loyalty.js#commitRedemption) — diferente de
// data/loyaltyRepo.js#recordRedemption da extensão, que só devolve o
// valor e deixa a TELA chamar session.js#addPendingCredit() separado
// (crédito fica só na sessão/aba de quem resgatou). views/clientes.js é
// copiada sem alteração, então ainda chama addPendingCredit() depois —
// nesta versão isso vira um atalho local redundante (o crédito real já
// está gravado, correto e auditável, no servidor), não um bug de dinheiro
// duplicado: nada em sale.js ainda LÊ o saldo persistido de
// store_credits, só o pendingCredit local. Sale.js só aplica automático
// no MESMO terminal/sessão que gerou o crédito — resgatar numa máquina e
// usar em outra ainda exige conferir o extrato manualmente. Mesma lacuna
// já existe desde o passo 7 (estorno com "gerar crédito de troca").
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
