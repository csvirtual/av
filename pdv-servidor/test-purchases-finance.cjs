// Fase 5 (compras/financeiro): API-level, sem navegador. Cobre: (1) pedido
// de compra com múltiplos itens; (2) recebimento parcial credita estoque e
// atualiza custo; (3) não é possível receber além do pedido; (4)
// idempotência do recebimento; (5) 10 recebimentos simultâneos do mesmo
// restante só deixam 1 passar; (6) cancelar pedido sem nada recebido
// funciona, com itens recebidos é rejeitado; (7) conta financeira com
// pagamento parcial, limite de valor, idempotência, corrida de 10
// pagamentos simultâneos, exclusão de pagamento revertendo status, e
// cancelamento.
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

  // --- Compras ---
  const supplierRes = await call('/api/suppliers', { method: 'POST', body: JSON.stringify({ nome: 'Fornecedor Teste', telefone: '1133334444' }) });
  check('fornecedor criado', supplierRes.status === 201, supplierRes.status);
  const supplier = supplierRes.body.supplier;

  await call('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'COMPRA-TEST-01', name: 'Item de compra', price: 20, costPrice: 3 }) });
  const productsRes = await call('/api/products');
  const product = productsRes.body.products.find((p) => p.barcode === 'COMPRA-TEST-01');

  const orderRes = await call('/api/purchases', {
    method: 'POST',
    body: JSON.stringify({ supplierId: supplier.id, items: [{ productId: product.id, name: product.name, qty: 10, unitCost: 5 }] }),
  });
  check('pedido de compra criado (10 unidades)', orderRes.status === 201 && orderRes.body.order.status === 'aberto', orderRes.status);
  const order = orderRes.body.order;

  const tooMuch = await call(`/api/purchases/${order.id}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, qty: 999, unitCost: 5 }], dedupeKey: 'dk-recv-toomuch-' + Date.now() }),
  });
  check('receber mais que o pedido é rejeitado', tooMuch.status === 400 && /só é possível receber/i.test(tooMuch.body.error), tooMuch.body.error);

  const dkRecv1 = 'dk-recv1-' + Date.now();
  const recv1 = await call(`/api/purchases/${order.id}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, qty: 5, unitCost: 5 }], dedupeKey: dkRecv1 }),
  });
  check('recebimento parcial (5 de 10) aceito', recv1.status === 200 && recv1.body.order.status === 'recebido_parcial', recv1.body.order && recv1.body.order.status);
  const afterRecv1Product = await call('/api/products');
  const productAfterRecv1 = afterRecv1Product.body.products.find((p) => p.id === product.id);
  check('estoque creditado (0+5=5) e custo atualizado (5)', productAfterRecv1.quantity === 5 && productAfterRecv1.costPrice === 5, `qty=${productAfterRecv1.quantity} custo=${productAfterRecv1.costPrice}`);

  const recv1Dup = await call(`/api/purchases/${order.id}/receber`, {
    method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, qty: 5, unitCost: 5 }], dedupeKey: dkRecv1 }),
  });
  check('reenviar o mesmo recebimento (mesma dedupeKey) é rejeitado', recv1Dup.status === 409, recv1Dup.status);

  // 10 tentativas simultâneas de receber o restante (5) — só 1 pode vencer
  const raceAttempts = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call(`/api/purchases/${order.id}/receber`, {
      method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, qty: 5, unitCost: 5 }], dedupeKey: 'dk-recv-race-' + i + '-' + Date.now() }),
    }))
  );
  const wonRace = raceAttempts.filter((a) => a.status === 200);
  const lostRace = raceAttempts.filter((a) => a.status === 400);
  check('exatamente 1 de 10 recebimentos simultâneos do restante (5) venceu', wonRace.length === 1 && lostRace.length === 9, `venceram=${wonRace.length} perderam=${lostRace.length}`);
  const finalProduct = (await call('/api/products')).body.products.find((p) => p.id === product.id);
  check('estoque final é exatamente 10 (nunca passou por duplicidade)', finalProduct.quantity === 10, finalProduct.quantity);
  const finalOrder = (await call(`/api/purchases/${order.id}`)).body.order;
  check('pedido marcado como totalmente recebido', finalOrder.status === 'recebido', finalOrder.status);

  const cancelReceived = await call(`/api/purchases/${order.id}/cancelar`, { method: 'POST' });
  check('cancelar pedido já recebido é rejeitado', cancelReceived.status === 400, cancelReceived.status);

  const order2Res = await call('/api/purchases', {
    method: 'POST', body: JSON.stringify({ supplierId: supplier.id, items: [{ productId: product.id, name: product.name, qty: 3, unitCost: 4 }] }),
  });
  const cancelFresh = await call(`/api/purchases/${order2Res.body.order.id}/cancelar`, { method: 'POST' });
  check('cancelar pedido sem nada recebido funciona', cancelFresh.status === 200 && cancelFresh.body.order.status === 'cancelado', cancelFresh.body.order && cancelFresh.body.order.status);

  // --- Financeiro ---
  const entryRes = await call('/api/finance', {
    method: 'POST',
    body: JSON.stringify({ type: 'pagar', description: 'Conta de teste', amount: 500, dueDate: Date.now() + 7 * 86400000, supplierId: supplier.id }),
  });
  check('conta a pagar criada (500)', entryRes.status === 201, entryRes.status);
  const entry = entryRes.body.entry;

  const partialFinPay = await call(`/api/finance/${entry.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 200, paymentMethod: 'Pix', dedupeKey: 'dk-fin-pay1-' + Date.now() }),
  });
  check('pagamento parcial de 200 aceito, status parcial', partialFinPay.status === 201, partialFinPay.status);
  const afterPartial = (await call('/api/finance')).body.entries.find((e) => e.id === entry.id);
  check('restante correto (500-200=300) e status "parcial"', Math.abs(afterPartial.remaining - 300) < 0.001 && afterPartial.displayStatus === 'parcial', `remaining=${afterPartial.remaining} status=${afterPartial.displayStatus}`);

  const tooMuchFin = await call(`/api/finance/${entry.id}/pagamento`, {
    method: 'POST', body: JSON.stringify({ amount: 999, paymentMethod: 'Dinheiro', dedupeKey: 'dk-fin-toomuch-' + Date.now() }),
  });
  check('pagamento maior que o restante é rejeitado', tooMuchFin.status === 400, tooMuchFin.status);

  // 10 tentativas simultâneas de quitar o restante (300) — só 1 pode vencer
  const finRace = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call(`/api/finance/${entry.id}/pagamento`, {
      method: 'POST', body: JSON.stringify({ amount: 300, paymentMethod: 'Dinheiro', dedupeKey: 'dk-fin-race-' + i + '-' + Date.now() }),
    }))
  );
  const finWon = finRace.filter((a) => a.status === 201);
  const finLost = finRace.filter((a) => a.status === 400);
  check('exatamente 1 de 10 pagamentos simultâneos do restante (300) venceu', finWon.length === 1 && finLost.length === 9, `venceram=${finWon.length} perderam=${finLost.length}`);
  const afterFull = (await call('/api/finance')).body.entries.find((e) => e.id === entry.id);
  check('conta totalmente paga (restante 0, status "pago")', Math.abs(afterFull.remaining) < 0.001 && afterFull.displayStatus === 'pago', `remaining=${afterFull.remaining} status=${afterFull.displayStatus}`);

  const winningPaymentId = finWon[0].body.entry.payments[finWon[0].body.entry.payments.length - 1].id;
  const deletePay = await call(`/api/finance/${entry.id}/pagamento/${winningPaymentId}`, { method: 'DELETE' });
  check('excluir o pagamento que fechou a conta funciona', deletePay.status === 200, deletePay.status);
  const afterDelete = (await call('/api/finance')).body.entries.find((e) => e.id === entry.id);
  check('conta volta a "parcial" sozinha após excluir o pagamento', afterDelete.displayStatus === 'parcial' && Math.abs(afterDelete.remaining - 300) < 0.001, `status=${afterDelete.displayStatus} remaining=${afterDelete.remaining}`);

  const cancelWithPayments = await call(`/api/finance/${entry.id}/cancelar`, { method: 'POST' });
  check('cancelar conta com pagamento registrado é rejeitado', cancelWithPayments.status === 400, cancelWithPayments.status);

  const entry2Res = await call('/api/finance', {
    method: 'POST', body: JSON.stringify({ type: 'receber', description: 'Conta a receber teste', amount: 100, dueDate: Date.now() + 86400000 }),
  });
  const cancelClean = await call(`/api/finance/${entry2Res.body.entry.id}/cancelar`, { method: 'POST' });
  check('cancelar conta nova sem pagamento funciona', cancelClean.status === 200 && cancelClean.body.entry.status === 'cancelado', cancelClean.status);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
