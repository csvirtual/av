// Achado de auditoria (DoS, exploração ao vivo): sales.js#commitSale
// (e os mesmos padrões em purchases.js/deliveries.js) não tinham limite
// nenhum no tamanho do array `items` de uma requisição — reproduzido de
// verdade com 200.000 itens: uma única venda travou o processo inteiro
// por ~9s (Node é single-threaded, better-sqlite3 é síncrono), qualquer
// outra requisição concorrente (outro terminal) ficava parada esperando.
// Qualquer usuário autenticado, mesmo um vendedor sem nenhuma permissão
// extra, conseguia disparar isso. Corrigido com um limite (300 itens,
// bem acima de qualquer carrinho real) checado ANTES de abrir a
// transação — este teste prova as duas pontas: o limite rejeita rápido
// E o servidor continua respondendo normalmente durante o ataque.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  return { cookie: res.headers.get('set-cookie').split(';')[0], body };
}

(async () => {
  const admin = await login('admin', 'admin123');
  let adminCookie = admin.cookie;
  await fetch(`${BASE}/api/auth/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ currentPassword: 'admin123', newPassword: 'admin123SenhaNova' }),
  });

  // Vendedor travado — sem NENHUMA permissão extra, pra provar que este
  // ataque não exige nenhum privilégio especial.
  const createSellerRes = await fetch(`${BASE}/api/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ nome: 'Vendedor DoS Test', username: 'vendedor-dos-test', password: 'SenhaVendedorDos123', role: 'vendedor', permissions: {} }),
  });
  check('vendedor de teste criado', createSellerRes.status === 201, createSellerRes.status);
  const seller = await login('vendedor-dos-test', 'SenhaVendedorDos123');
  const sellerCookie = seller.cookie;

  const prodRes = await fetch(`${BASE}/api/products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ barcode: '7899999900011', name: 'Produto Teste DoS', unit: 'un', price: 10, costPrice: 5 }),
  });
  const { product } = await prodRes.json();
  await fetch(`${BASE}/api/products/${product.id}/movimentos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ qty: 1000, type: 'ajuste', note: 'estoque teste', dedupeKey: 'dos-test-stock-' + Date.now() }),
  });

  // (1) Array de 301 itens (passa do limite de 300) — precisa ser
  // rejeitado LIMPO e RÁPIDO, nunca travar processando tudo primeiro.
  const tooMany = Array.from({ length: 301 }, () => ({ productId: product.id, qty: 1 }));
  const t0 = Date.now();
  const bigSaleRes = await fetch(`${BASE}/api/sales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({ items: tooMany, payments: [{ method: 'Dinheiro', amount: 3010 }], dedupeKey: 'dos-test-toomany-' + Date.now() }),
  });
  const bigSaleElapsed = Date.now() - t0;
  const bigSaleBody = await bigSaleRes.json();
  check('venda com 301 itens é rejeitada (400)', bigSaleRes.status === 400, bigSaleRes.status);
  check('rejeitada em menos de 1s (não processou os 301 itens)', bigSaleElapsed < 1000, `${bigSaleElapsed}ms`);
  check('mensagem de erro é sobre limite de itens', /não pode ter mais de/.test(bigSaleBody.error || ''), bigSaleBody.error);

  // (2) Durante uma venda GRANDE (mas dentro do limite, 300 itens — o
  // suficiente pra medir tempo real de processamento), o servidor
  // continua respondendo outras requisições em tempo normal — prova de
  // que o limite realmente impede a classe de ataque, não só o caso
  // específico de 200k testado manualmente.
  const withinLimit = Array.from({ length: 300 }, () => ({ productId: product.id, qty: 1 }));
  const salePromise = fetch(`${BASE}/api/sales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sellerCookie },
    body: JSON.stringify({ items: withinLimit, payments: [{ method: 'Dinheiro', amount: 3000 }], dedupeKey: 'dos-test-atlimit-' + Date.now() }),
  });
  await new Promise((r) => setTimeout(r, 20));
  const statusT0 = Date.now();
  const statusRes = await fetch(`${BASE}/api/status`);
  const statusElapsed = Date.now() - statusT0;
  check('servidor responde /api/status rapidamente mesmo com uma venda grande em andamento', statusElapsed < 500, `${statusElapsed}ms`);
  check('GET /api/status continua OK', statusRes.status === 200, statusRes.status);
  const saleRes = await salePromise;
  check('venda de 300 itens (dentro do limite) é aceita normalmente', saleRes.status === 201, saleRes.status);

  // (3) Pedido de compra com item além do limite (300) — mesma classe de
  // proteção em routes/purchases.js.
  const supplierRes = await fetch(`${BASE}/api/suppliers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ nome: 'Fornecedor Teste DoS' }),
  });
  const { supplier } = await supplierRes.json();
  const tooManyOrderItems = Array.from({ length: 301 }, (_, i) => ({ productId: product.id, name: `Item ${i}`, qty: 1, unitCost: 1 }));
  const orderRes = await fetch(`${BASE}/api/purchases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ supplierId: supplier.id, items: tooManyOrderItems }),
  });
  const orderBody = await orderRes.json();
  check('pedido de compra com 301 itens é rejeitado (400)', orderRes.status === 400, orderRes.status);
  check('mensagem do pedido de compra é sobre limite de itens', /não pode ter mais de/.test(orderBody.error || ''), orderBody.error);

  // (4) Carreto com item além do limite — mesma classe em deliveries.js.
  const customerRes = await fetch(`${BASE}/api/customers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ nome: 'Cliente Teste DoS' }),
  });
  const { customer } = await customerRes.json();
  const tooManyDeliveryItems = Array.from({ length: 301 }, (_, i) => ({ source: 'avulso', name: `Item ${i}`, unit: 'un', qty: 1 }));
  const deliveryRes = await fetch(`${BASE}/api/deliveries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ customerId: customer.id, items: tooManyDeliveryItems }),
  });
  const deliveryBody = await deliveryRes.json();
  check('carreto com 301 itens é rejeitado (400)', deliveryRes.status === 400, deliveryRes.status);
  check('mensagem do carreto é sobre limite de itens', /não pode ter mais de/.test(deliveryBody.error || ''), deliveryBody.error);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})();
