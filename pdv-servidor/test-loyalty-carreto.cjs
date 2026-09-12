// Fase 6 (fidelidade/carreto): API-level, sem navegador. Cobre: (1) ganho de
// pontos automático numa venda; (2) resgate de pontos vira crédito de
// troca, com limite de saldo, idempotência e corrida de 10 resgates
// simultâneos; (3) usar crédito de troca como pagamento de uma venda exige
// cliente, respeita o saldo, e a corrida de 10 vendas simultâneas gastando
// o mesmo crédito só deixa 1 passar; (4) estorno reverte pontos
// proporcionalmente e pode gerar crédito de troca; (5) carreto: criar,
// marcar entregue, cancelar rejeitado após entregue, e corrida de 10
// tentativas simultâneas de entregar o mesmo carreto só deixam 1 passar.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(jar) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  jar.cookie = res.headers.get('set-cookie').split(';')[0];
}

function api(jar) {
  return async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Cookie: jar.cookie, ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
}

(async () => {
  const jar = {};
  await login(jar);
  const call = api(jar);

  // 1 ponto por real gasto, 1 ponto = R$ 1,00 de crédito (números redondos pro teste)
  const cfgRes = await call('/api/loyalty/config', { method: 'PUT', body: JSON.stringify({ pointsPerReal: 1, redemptionRate: 1 }) });
  check('config de fidelidade salva (1 ponto/real, 1 ponto=R$1)', cfgRes.status === 200, cfgRes.status);

  const customerRes = await call('/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente Fidelidade Teste' }) });
  const customer = customerRes.body.customer;

  await call('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'LOYALTY-TEST-01', name: 'Item fidelidade', price: 25 }) });
  const product = (await call('/api/products')).body.products.find((p) => p.barcode === 'LOYALTY-TEST-01');
  await call(`/api/products/${product.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 20, dedupeKey: crypto.randomUUID() }) });

  // --- Ganho de pontos ---
  const sale1 = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 2, unitPrice: 25 }],
      payments: [{ method: 'Dinheiro', amount: 50 }],
      customerId: customer.id, dedupeKey: 'dk-loy-sale1-' + Date.now(),
    }),
  });
  check('venda de 50 aceita', sale1.status === 201, sale1.status);
  const afterSale1 = await call(`/api/loyalty/${customer.id}`);
  check('50 pontos ganhos (1 ponto por real)', afterSale1.body.points === 50, afterSale1.body.points);

  // --- Resgate ---
  const tooManyPoints = await call(`/api/loyalty/${customer.id}/resgatar`, { method: 'POST', body: JSON.stringify({ points: 999, dedupeKey: 'dk-redeem-toomany-' + Date.now() }) });
  check('resgatar mais pontos do que tem é rejeitado', tooManyPoints.status === 400, tooManyPoints.status);

  // Resgata só 10 (não os 30 pretendidos originalmente) pra sobrar saldo
  // suficiente (40) pro reenvio da MESMA dedupeKey ainda passar na checagem
  // de saldo e chegar na checagem de idempotência de verdade — reenviar
  // pedindo mais do que o saldo restante (depois do primeiro sucesso) cairia
  // no erro de saldo insuficiente ANTES de sequer checar a dedupeKey (mesma
  // ordem, de propósito, de customersRepo.js#recordPayment: nunca queimar a
  // chave numa tentativa que nem chegou a validar).
  const dkRedeem1 = 'dk-redeem1-' + Date.now();
  const redeem1 = await call(`/api/loyalty/${customer.id}/resgatar`, { method: 'POST', body: JSON.stringify({ points: 10, dedupeKey: dkRedeem1 }) });
  check('resgate de 10 pontos aceito, crédito de R$10', redeem1.status === 201 && Math.abs(redeem1.body.amount - 10) < 0.001, redeem1.body);
  const redeem1Dup = await call(`/api/loyalty/${customer.id}/resgatar`, { method: 'POST', body: JSON.stringify({ points: 10, dedupeKey: dkRedeem1 }) });
  check('reenviar o mesmo resgate (mesma dedupeKey) é rejeitado', redeem1Dup.status === 409, redeem1Dup.status);

  const afterRedeem1 = await call(`/api/loyalty/${customer.id}`);
  check('saldo de pontos 50-10=40, crédito 10', afterRedeem1.body.points === 40 && Math.abs(afterRedeem1.body.credit - 10) < 0.001, afterRedeem1.body);

  // 10 tentativas simultâneas de resgatar os 40 pontos restantes — só 1 pode vencer
  const raceRedeem = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call(`/api/loyalty/${customer.id}/resgatar`, { method: 'POST', body: JSON.stringify({ points: 40, dedupeKey: 'dk-redeem-race-' + i + '-' + Date.now() }) }))
  );
  const wonRedeem = raceRedeem.filter((a) => a.status === 201);
  check('exatamente 1 de 10 resgates simultâneos dos 20 pontos restantes venceu', wonRedeem.length === 1 && raceRedeem.length - wonRedeem.length === 9, wonRedeem.length);
  const afterRaceRedeem = await call(`/api/loyalty/${customer.id}`);
  check('saldo final de pontos é 0, crédito total 50', afterRaceRedeem.body.points === 0 && Math.abs(afterRaceRedeem.body.credit - 50) < 0.001, afterRaceRedeem.body);

  // --- Usar crédito de troca como pagamento ---
  const noCustomerCredit = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, qty: 1, unitPrice: 25 }], payments: [{ method: 'Crédito de troca', amount: 25 }], dedupeKey: 'dk-credit-nocust-' + Date.now() }),
  });
  check('usar crédito de troca sem cliente é rejeitado', noCustomerCredit.status === 400 && /cliente/i.test(noCustomerCredit.body.error), noCustomerCredit.body.error);

  const tooMuchCredit = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 4, unitPrice: 25 }], payments: [{ method: 'Crédito de troca', amount: 100 }],
      customerId: customer.id, dedupeKey: 'dk-credit-toomuch-' + Date.now(),
    }),
  });
  check('gastar mais crédito do que tem é rejeitado', tooMuchCredit.status === 400 && /crédito de troca disponível/i.test(tooMuchCredit.body.error), tooMuchCredit.body.error);

  const creditSale = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 25 }], payments: [{ method: 'Crédito de troca', amount: 25 }],
      customerId: customer.id, dedupeKey: 'dk-credit-sale-' + Date.now(),
    }),
  });
  check('venda de 25 paga inteira em crédito de troca aceita', creditSale.status === 201, creditSale.status);
  const afterCreditSale = await call(`/api/loyalty/${customer.id}`);
  check('crédito reduzido corretamente (50-25=25)', Math.abs(afterCreditSale.body.credit - 25) < 0.001, afterCreditSale.body.credit);

  // 10 vendas simultâneas de 25 (o crédito restante inteiro) — só 1 pode vencer
  const raceCreditSales = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call('/api/sales', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 1, unitPrice: 25 }], payments: [{ method: 'Crédito de troca', amount: 25 }],
        customerId: customer.id, dedupeKey: 'dk-credit-race-' + i + '-' + Date.now(),
      }),
    }))
  );
  const wonCreditRace = raceCreditSales.filter((a) => a.status === 201);
  check('exatamente 1 de 10 vendas simultâneas gastando o crédito restante (25) venceu', wonCreditRace.length === 1, wonCreditRace.length);
  const afterCreditRace = await call(`/api/loyalty/${customer.id}`);
  check('crédito final é zero (nunca ficou negativo)', Math.abs(afterCreditRace.body.credit) < 0.001, afterCreditRace.body.credit);

  // --- Estorno: reversão de pontos + geração de crédito ---
  const sale2 = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 4, unitPrice: 25 }], payments: [{ method: 'Dinheiro', amount: 100 }],
      customerId: customer.id, dedupeKey: 'dk-loy-sale2-' + Date.now(),
    }),
  });
  const pointsBeforeRefund = (await call(`/api/loyalty/${customer.id}`)).body.points;
  const refund2 = await call(`/api/sales/${sale2.body.sale.id}/refund`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, itemIndex: 0, qty: 1 }], reason: 'Teste fidelidade', generateCredit: true, dedupeKey: 'dk-loy-refund2-' + Date.now() }),
  });
  check('estorno com geração de crédito aceito', refund2.status === 200, refund2.status);
  const afterRefund2 = await call(`/api/loyalty/${customer.id}`);
  check('pontos revertidos proporcionalmente (100 ganhos, 1/4 estornado = -25)', afterRefund2.body.points === pointsBeforeRefund - 25, `antes=${pointsBeforeRefund} depois=${afterRefund2.body.points}`);
  check('crédito de troca gerado pelo estorno (25)', Math.abs(afterRefund2.body.credit - 25) < 0.001, afterRefund2.body.credit);

  // --- Carreto ---
  const deliveryRes = await call('/api/deliveries', {
    method: 'POST',
    body: JSON.stringify({ customerId: customer.id, items: [{ source: 'estoque', productId: product.id, name: product.name, unit: 'un', qty: 2 }], address: 'Rua Teste, 123', dedupeKey: crypto.randomUUID() }),
  });
  check('carreto criado', deliveryRes.status === 201 && deliveryRes.body.delivery.status === 'pendente', deliveryRes.status);
  const delivery = deliveryRes.body.delivery;

  const raceDeliver = await Promise.all(Array.from({ length: 10 }, () => call(`/api/deliveries/${delivery.id}/entregar`, { method: 'POST' })));
  const wonDeliver = raceDeliver.filter((a) => a.status === 200);
  check('exatamente 1 de 10 tentativas simultâneas de marcar entregue venceu', wonDeliver.length === 1, wonDeliver.length);

  const cancelAfterDelivered = await call(`/api/deliveries/${delivery.id}/cancelar`, { method: 'POST' });
  check('cancelar carreto já entregue é rejeitado', cancelAfterDelivered.status === 400, cancelAfterDelivered.status);

  const delivery2Res = await call('/api/deliveries', {
    method: 'POST', body: JSON.stringify({ customerId: customer.id, items: [{ source: 'avulso', name: 'Carga de areia', unit: 'un', qty: 1 }], dedupeKey: crypto.randomUUID() }),
  });
  const cancelFresh = await call(`/api/deliveries/${delivery2Res.body.delivery.id}/cancelar`, { method: 'POST' });
  check('cancelar carreto pendente funciona', cancelFresh.status === 200 && cancelFresh.body.delivery.status === 'cancelado', cancelFresh.status);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
