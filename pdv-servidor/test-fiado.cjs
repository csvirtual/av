// Fase 4 (clientes/fiado): API-level, sem navegador. Cobre: (1) venda fiada
// exige cliente; (2) venda fiada lança dívida certa no extrato; (3)
// pagamento maior que a dívida é rejeitado; (4) pagamento parcial reduz o
// saldo certo, com idempotência; (5) 10 pagamentos simultâneos cobrindo a
// dívida inteira só deixam 1 passar (mesma trava atômica de vendas/caixa);
// (6) estornar parte de uma venda fiada reduz a dívida proporcionalmente;
// (7) pagamento de fiado com o caixa aberto entra na conferência de
// fechamento (routes/cash.js#computeExpectedAmounts).
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

  const customerRes = await call('/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente Fiado Teste', telefone: '11999998888' }) });
  check('cliente criado', customerRes.status === 201, customerRes.status);
  const customer = customerRes.body.customer;

  await call('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'FIADO-TEST-01', name: 'Item fiado', price: 20 }) });
  const productsRes = await call('/api/products');
  const product = productsRes.body.products.find((p) => p.barcode === 'FIADO-TEST-01');
  await call(`/api/products/${product.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 100 }) });

  // (1) venda fiada sem cliente é rejeitada
  const noCustomer = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, qty: 1, unitPrice: 20 }], payments: [{ method: 'Fiado', amount: 20 }], dedupeKey: 'dk-nocust-' + Date.now() }),
  });
  check('venda fiada sem cliente é rejeitada', noCustomer.status === 400 && /selecione um cliente/i.test(noCustomer.body.error), noCustomer.body.error);

  // (2) venda mista: 10 em dinheiro + 30 fiado — só os 30 viram dívida
  const sale = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 2, unitPrice: 20 }],
      payments: [{ method: 'Dinheiro', amount: 10 }, { method: 'Fiado', amount: 30 }],
      customerId: customer.id,
      dedupeKey: 'dk-sale1-' + Date.now(),
    }),
  });
  check('venda mista (10 dinheiro + 30 fiado) aceita', sale.status === 201, sale.status);
  const afterSale = await call(`/api/customers/${customer.id}`);
  check('dívida lançada é só a parte fiada (30), não o total (40)', Math.abs(afterSale.body.balance - 30) < 0.001, afterSale.body.balance);

  // (3) pagamento maior que a dívida é rejeitado
  const tooMuch = await call(`/api/customers/${customer.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 999, paymentMethod: 'Dinheiro', dedupeKey: 'dk-toomuch-' + Date.now() }),
  });
  check('pagamento maior que a dívida é rejeitado', tooMuch.status === 400 && /deve/i.test(tooMuch.body.error), tooMuch.body.error);

  // (4) pagamento parcial de 10, com idempotência
  const dkPay1 = 'dk-pay1-' + Date.now();
  const partialPay = await call(`/api/customers/${customer.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: 'Pix', dedupeKey: dkPay1 }),
  });
  check('pagamento parcial de 10 aceito', partialPay.status === 201 && Math.abs(partialPay.body.balance - 20) < 0.001, partialPay.body.balance);
  const dupPay = await call(`/api/customers/${customer.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 10, paymentMethod: 'Pix', dedupeKey: dkPay1 }),
  });
  check('reenviar o mesmo pagamento (mesma dedupeKey) é rejeitado', dupPay.status === 409, dupPay.status);

  // (5) 10 tentativas simultâneas de quitar o saldo restante (20) — só 1 pode vencer
  const attempts = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call(`/api/customers/${customer.id}/pagamento`, {
      method: 'POST', body: JSON.stringify({ amount: 20, paymentMethod: 'Dinheiro', dedupeKey: 'dk-race-' + i + '-' + Date.now() }),
    }))
  );
  const wonRace = attempts.filter((a) => a.status === 201);
  const lostRace = attempts.filter((a) => a.status === 400);
  check('exatamente 1 de 10 pagamentos simultâneos de 20 (saldo restante) venceu', wonRace.length === 1 && lostRace.length === 9, `venceram=${wonRace.length} perderam=${lostRace.length}`);
  const finalBalance = await call(`/api/customers/${customer.id}`);
  check('saldo final é zero (não ficou negativo nem sobrou)', Math.abs(finalBalance.body.balance) < 0.001, finalBalance.body.balance);

  // (6) venda fiada nova + estorno parcial reduz a dívida proporcionalmente
  const sale2 = await call('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 4, unitPrice: 20 }],
      payments: [{ method: 'Fiado', amount: 80 }],
      customerId: customer.id,
      dedupeKey: 'dk-sale2-' + Date.now(),
    }),
  });
  check('segunda venda fiada (80) aceita', sale2.status === 201, sale2.status);
  const refund2 = await call(`/api/sales/${sale2.body.sale.id}/refund`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, itemIndex: 0, qty: 1 }], reason: 'Teste fiado', dedupeKey: 'dk-refund2-' + Date.now() }),
  });
  check('estorno de 1 de 4 unidades aceito', refund2.status === 200, refund2.status);
  // estornou 1/4 do total (80) = 20 de refund; fiadoRatio = 80/80 = 1 -> dívida reduz os 20 inteiros
  const afterRefund2 = await call(`/api/customers/${customer.id}`);
  check('dívida reduzida proporcionalmente pelo estorno (80-20=60)', Math.abs(afterRefund2.body.balance - 60) < 0.001, afterRefund2.body.balance);

  // (7) pagamento de fiado com caixa aberto entra na conferência
  await call('/api/cash/config', { method: 'PUT', body: JSON.stringify({ caixaMode: 'unico' }) });
  const openNow = await call('/api/cash/open');
  if (openNow.body.session) await call(`/api/cash/sessions/${openNow.body.session.id}/fechar`, { method: 'POST', body: JSON.stringify({ countedAmounts: {} }) });
  const openCash = await call('/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 0 }) });
  const session = openCash.body.session;
  await call(`/api/customers/${customer.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 25, paymentMethod: 'Cartão de débito', dedupeKey: 'dk-pay-cash-' + Date.now() }),
  });
  const preview = await call(`/api/cash/sessions/${session.id}`);
  check('pagamento de fiado (25, débito) entra na conferência do caixa aberto', Math.abs((preview.body.expected['Cartão de débito'] || 0) - 25) < 0.001, preview.body.expected);
  await call(`/api/cash/sessions/${session.id}/fechar`, { method: 'POST', body: JSON.stringify({ countedAmounts: {} }) });

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
