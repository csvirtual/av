// Teste de concorrência real: N requisições simultâneas tentando vender
// mais do que o estoque tem. Se a atomicidade estiver certa, exatamente
// `quantity` vendas passam, o resto falha limpo, e o estoque final nunca
// fica negativo.
const BASE = 'http://localhost:3131';

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  return cookie;
}

async function api(cookie, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  const cookie = await login();
  check('login funcionou', !!cookie, cookie);

  // Produto com estoque de 5
  const { status: createStatus, body: createBody } = await api(cookie, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: 'CONC001', name: 'Produto Concorrência', price: 10 }),
  });
  check('produto de teste criado', createStatus === 201, createStatus);
  const productId = createBody.product.id;
  await api(cookie, `/api/products/${productId}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 5, dedupeKey: crypto.randomUUID() }) });

  // 10 tentativas de venda simultâneas, 1 unidade cada, só 5 podem passar
  const ATTEMPTS = 10;
  const saleBody = (i) => JSON.stringify({
    items: [{ productId, qty: 1, unitPrice: 10 }],
    payments: [{ method: 'Dinheiro', amount: 10 }],
    dedupeKey: `conc-${i}-${Date.now()}-${Math.random()}`,
  });
  const promises = Array.from({ length: ATTEMPTS }, (_, i) =>
    api(cookie, '/api/sales', { method: 'POST', body: saleBody(i) })
  );
  const outcomes = await Promise.all(promises);
  const succeeded = outcomes.filter((o) => o.status === 201).length;
  const failed = outcomes.filter((o) => o.status === 400).length;
  check(`exatamente 5 de ${ATTEMPTS} vendas simultâneas passaram (estoque era 5)`, succeeded === 5, `sucesso=${succeeded} falha=${failed}`);
  check('as que falharam tiveram mensagem de estoque insuficiente', outcomes.filter((o) => o.status === 400).every((o) => o.body.error.includes('Estoque insuficiente')));

  const { body: finalProduct } = await api(cookie, `/api/products`);
  const p = finalProduct.products.find((x) => x.id === productId);
  check('estoque final é exatamente 0 (nunca negativo)', p.quantity === 0, p.quantity);

  // ---------- Venda normal + estorno parcial ----------
  await api(cookie, `/api/products/${productId}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 10, dedupeKey: crypto.randomUUID() }) });
  const { status: saleStatus, body: saleBody2 } = await api(cookie, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 4, unitPrice: 10 }],
      payments: [{ method: 'Dinheiro', amount: 40 }],
      dedupeKey: `normal-${Date.now()}`,
    }),
  });
  check('venda normal de 4 unidades criada', saleStatus === 201, saleStatus);
  const sale = saleBody2.sale;
  check('total da venda calculado certo (40)', sale.total === 40, sale.total);

  const { body: afterSaleProduct } = await api(cookie, `/api/products`);
  const p2 = afterSaleProduct.products.find((x) => x.id === productId);
  check('estoque debitado certo após a venda (10-4=6)', p2.quantity === 6, p2.quantity);

  const { status: refundStatus, body: refundBody } = await api(cookie, `/api/sales/${sale.id}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, itemIndex: 0, qty: 2 }],
      reason: 'Teste de estorno parcial',
      dedupeKey: `refund-${Date.now()}`,
    }),
  });
  check('estorno parcial (2 de 4) aceito', refundStatus === 200, refundStatus);
  check('refundedTotal calculado certo (2 * 10 = 20)', refundBody.sale.refundedTotal === 20, refundBody.sale.refundedTotal);

  const { body: afterRefundProduct } = await api(cookie, `/api/products`);
  const p3 = afterRefundProduct.products.find((x) => x.id === productId);
  check('estoque devolvido certo após estorno (6+2=8)', p3.quantity === 8, p3.quantity);

  // Idempotência: reenviar a MESMA dedupeKey da venda original deve falhar
  const { status: dupeStatus } = await api(cookie, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId, qty: 1, unitPrice: 10 }],
      payments: [{ method: 'Dinheiro', amount: 10 }],
      dedupeKey: `normal-${sale.timestamp}`, // reaproveita um padrão, mas testa uma key literal repetida abaixo
    }),
  });
  const REPEAT_KEY = 'repetida-fixa';
  const first = await api(cookie, '/api/sales', { method: 'POST', body: JSON.stringify({ items: [{ productId, qty: 1, unitPrice: 10 }], payments: [{ method: 'Dinheiro', amount: 10 }], dedupeKey: REPEAT_KEY }) });
  const second = await api(cookie, '/api/sales', { method: 'POST', body: JSON.stringify({ items: [{ productId, qty: 1, unitPrice: 10 }], payments: [{ method: 'Dinheiro', amount: 10 }], dedupeKey: REPEAT_KEY }) });
  check('1ª venda com uma dedupeKey nova passa', first.status === 201, first.status);
  check('2ª venda reenviando a MESMA dedupeKey é rejeitada (sem duplo lançamento)', second.status === 409, second.status);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
