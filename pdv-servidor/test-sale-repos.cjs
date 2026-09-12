// Testa os 5 módulos que views/sale.js (PDV) precisa — salesRepo,
// deliveriesRepo, companyRepo, cashRepo, customersRepo — isolados, contra
// um servidor de verdade. Foco principal: as duas correções de "nunca
// confiar no cliente pra decidir dinheiro" feitas em routes/sales.js
// (preço unitário e juro de parcelamento sempre recalculados no
// servidor), suporte a unidade "personalizado" e preço promocional por
// validade na venda, e o padrão de permissão leitura-aberta/escrita-gated
// já usado em suppliers/audit/company.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-sale-repos.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function rawApi(page, path, opts = {}) {
  return page.evaluate(async ([p, o]) => {
    const res = await fetch(p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }, [path, opts]);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/test-sale-repos.html`);
  await admin.evaluate(() => window.__login('admin', 'admin123'));

  // ---------- companyRepo: leitura/escrita de políticas ----------

  const initialCompany = await admin.evaluate(() => window.__companyRepo.getCompany());
  check('getCompany() traz políticas com defaults sãos antes de qualquer configuração', initialCompany.policies.vendorMaxDiscountPercent === 10 && initialCompany.policies.creditInterest.monthlyPercent === 0, JSON.stringify(initialCompany.policies));

  // Configura juro de 5%/mês, sem parcela isenta, e teto de desconto de 10%
  // (padrão) — pra testar o cálculo de juro de verdade mais abaixo.
  const putCompany = await rawApi(admin, '/api/company', {
    method: 'PUT',
    body: JSON.stringify({ creditInterest: { freeInstallmentsEnabled: false, type: 'monthly', monthlyPercent: 5 } }),
  });
  check('PUT /api/company grava a política de juro', putCompany.status === 200 && putCompany.body.creditInterest.monthlyPercent === 5, JSON.stringify(putCompany.body));

  const companyAfterPut = await admin.evaluate(() => window.__companyRepo.getCompany());
  check('getCompany() reflete a política gravada', companyAfterPut.policies.creditInterest.monthlyPercent === 5, companyAfterPut.policies.creditInterest.monthlyPercent);

  // ---------- Seed: produto normal + cliente ----------

  const cimento = await admin.evaluate(() => window.__productsRepo.createProduct({ barcode: 'SALE-1111', name: 'Cimento CP-II 50kg', price: 32, costPrice: 24 }));
  await admin.evaluate((id) => window.__stockRepo.recordMovement({ productId: id, type: 'entrada', qty: 100 }), cimento.id);

  const customerRes = await rawApi(admin, '/api/customers', { method: 'POST', body: JSON.stringify({ nome: 'Cliente Teste Venda' }) });
  const customerId = customerRes.body.customer.id;

  // ---------- salesRepo: venda simples ----------

  const sale1 = await admin.evaluate((productId) => window.__salesRepo.createSale({
    items: [{ productId, qty: 2 }],
    payments: [{ method: 'Dinheiro', amount: 64 }],
  }), cimento.id);
  check('createSale registra a venda com o total certo', sale1.total === 64 && sale1.items[0].unitPrice === 32, JSON.stringify({ total: sale1.total, unitPrice: sale1.items[0].unitPrice }));

  const cimentoAfterSale = await admin.evaluate((id) => window.__productsRepo.getProduct(id), cimento.id);
  check('estoque baixou pela quantidade vendida', cimentoAfterSale.quantity === 98, cimentoAfterSale.quantity);

  // ---------- Achado de auditoria: preço nunca confiado do cliente ----------

  const tampered = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: cimento.id, qty: 1, unitPrice: 0.01 }], // tentativa deliberada de forjar o preço
      payments: [{ method: 'Dinheiro', amount: 0.01 }], // paga o valor forjado, não o real — só passaria se o servidor confiasse no unitPrice
      dedupeKey: crypto.randomUUID(),
    }),
  });
  check('venda com unitPrice forjado (R$0,01) é REJEITADA — pagamento não bate com o preço real do catálogo', tampered.status === 400 && /não bate/.test(tampered.body.error), JSON.stringify(tampered.body));

  const tamperedButCorrectPayment = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: cimento.id, qty: 1, unitPrice: 0.01 }], // preço forjado no item
      payments: [{ method: 'Dinheiro', amount: 32 }], // mas paga o preço REAL do catálogo (32) — só bate se o servidor ignorou o unitPrice forjado e usou 32
      dedupeKey: crypto.randomUUID(),
    }),
  });
  check('mesmo pagando o valor REAL, o servidor gravou o unitPrice do CATÁLOGO (32), não o forjado (0,01)', tamperedButCorrectPayment.status === 201 && tamperedButCorrectPayment.body.sale.items[0].unitPrice === 32, JSON.stringify(tamperedButCorrectPayment.body.sale?.items?.[0]));

  // ---------- Produto "personalizado" (múltiplas formas de venda) ----------

  const areia = await admin.evaluate(() => window.__productsRepo.createProduct({
    barcode: 'SALE-AREIA', name: 'Areia', unit: 'personalizado', customUnitLabel: 'lata',
    customForms: [{ forma: 'Lata', valor: 5, custo: 2, fator: 1 }, { forma: 'Carrada', valor: 180, custo: 70, fator: 40 }],
  }));
  await admin.evaluate((id) => window.__stockRepo.recordMovement({ productId: id, type: 'entrada', qty: 200 }), areia.id); // 200 latas equivalentes

  const saleCarrada = await admin.evaluate((productId) => window.__salesRepo.createSale({
    items: [{ productId, qty: 1, formName: 'Carrada' }],
    payments: [{ method: 'Dinheiro', amount: 180 }],
  }), areia.id);
  check('venda de produto personalizado usa o preço da FORMA escolhida (Carrada = 180)', saleCarrada.total === 180 && saleCarrada.items[0].unitPrice === 180, JSON.stringify(saleCarrada.items[0]));
  check('item da venda personalizada grava costPrice/formFator da forma', saleCarrada.items[0].costPrice === 70 && saleCarrada.items[0].formFator === 40, JSON.stringify(saleCarrada.items[0]));

  const areiaAfterSale = await admin.evaluate((id) => window.__productsRepo.getProduct(id), areia.id);
  check('estoque baixou pelo FATOR da forma (1 carrada × 40 = 40 latas), não só 1', areiaAfterSale.quantity === 160, areiaAfterSale.quantity);

  const formInvalid = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: areia.id, qty: 1, formName: 'Forma Que Não Existe' }], payments: [{ method: 'Dinheiro', amount: 1 }], dedupeKey: crypto.randomUUID() }),
  });
  check('vender uma forma que não existe mais no produto é rejeitado', formInvalid.status === 400 && /não existe mais/.test(formInvalid.body.error), JSON.stringify(formInvalid.body));

  // ---------- Preço promocional por validade ----------

  const today = new Date();
  const nearExpiry = new Date(today.getTime() + 2 * 86400000); // vence em 2 dias
  const expiryStr = nearExpiry.toISOString().slice(0, 10);
  const tijolo = await admin.evaluate((expiryDate) => window.__productsRepo.createProduct({
    barcode: 'SALE-TIJOLO', name: 'Tijolo com validade', price: 10, costPrice: 6,
    expiryDate, expiryPromoDays: 5, promoPrice: 6,
  }), expiryStr);
  await admin.evaluate((id) => window.__stockRepo.recordMovement({ productId: id, type: 'entrada', qty: 50 }), tijolo.id);

  const salePromo = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: tijolo.id, qty: 1, unitPrice: 10 }], payments: [{ method: 'Dinheiro', amount: 6 }], dedupeKey: crypto.randomUUID() }), // forjando 10, mas o real esperado é o PROMO (6, perto de vencer)
  });
  check('produto perto de vencer usa o preço PROMOCIONAL automaticamente, mesmo que o cliente tenha mandado o preço cheio', salePromo.status === 201 && salePromo.body.sale.items[0].unitPrice === 6, JSON.stringify(salePromo.body.sale?.items?.[0]));

  // ---------- Achado de auditoria: juro de parcelamento nunca confiado do cliente ----------

  const tamperedInterest = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: cimento.id, qty: 1 }],
      payments: [{ method: 'Cartão de crédito', amount: 32, installments: 3, interestAmount: 0 }], // tenta zerar o juro (política configurada: 5%/mês, sem isenção)
      dedupeKey: crypto.randomUUID(),
    }),
  });
  const expectedInterest = 32 * 0.05 * 3; // monthlyPercent × parcelas, sem isenção
  check('juro de parcelamento é RECALCULADO no servidor (ignora interestAmount:0 forjado)', tamperedInterest.status === 201 && Math.abs(tamperedInterest.body.sale.creditInterestTotal - expectedInterest) < 0.01, JSON.stringify({ got: tamperedInterest.body.sale?.creditInterestTotal, expected: expectedInterest }));

  const inflatedInterest = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: cimento.id, qty: 1 }],
      payments: [{ method: 'Cartão de crédito', amount: 32, installments: 3, interestAmount: 999 }], // tenta inflar o juro pra muito mais que a política manda
      dedupeKey: crypto.randomUUID(),
    }),
  });
  check('juro inflado pelo cliente também é ignorado — servidor usa a mesma fórmula de sempre', inflatedInterest.status === 201 && Math.abs(inflatedInterest.body.sale.creditInterestTotal - expectedInterest) < 0.01, inflatedInterest.body.sale?.creditInterestTotal);

  // ---------- Fiado (dívida do cliente) ----------

  const balanceBefore = await admin.evaluate((id) => window.__customersRepo.getCustomerBalance(id), customerId);
  check('saldo do cliente começa zerado', balanceBefore === 0, balanceBefore);

  await admin.evaluate(([productId, custId]) => window.__salesRepo.createSale({
    items: [{ productId, qty: 1 }],
    payments: [{ method: 'Fiado', amount: 32 }],
    customerId: custId,
  }), [cimento.id, customerId]);

  const balanceAfter = await admin.evaluate((id) => window.__customersRepo.getCustomerBalance(id), customerId);
  check('venda fiada aumenta o saldo devedor do cliente', balanceAfter === 32, balanceAfter);

  const balanceMissing = await admin.evaluate(() => window.__customersRepo.getCustomerBalance('id-que-nao-existe'));
  check('getCustomerBalance de cliente inexistente devolve 0, NUNCA lança erro', balanceMissing === 0, balanceMissing);

  const fiadoNoCustomer = await rawApi(admin, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: cimento.id, qty: 1 }], payments: [{ method: 'Fiado', amount: 32 }], dedupeKey: crypto.randomUUID() }),
  });
  check('venda fiada sem cliente selecionado é rejeitada', fiadoNoCustomer.status === 400 && /Selecione um cliente/.test(fiadoNoCustomer.body.error), JSON.stringify(fiadoNoCustomer.body));

  // ---------- cashRepo: sessão aberta ----------

  const noneOpen = await admin.evaluate(() => window.__cashRepo.getOpenSession());
  check('getOpenSession() devolve null sem nenhum caixa aberto', noneOpen === null, noneOpen);

  await rawApi(admin, '/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 100 }) });
  const nowOpen = await admin.evaluate(() => window.__cashRepo.getOpenSession());
  check('getOpenSession() devolve a sessão depois de abrir o caixa', nowOpen?.openingAmount === 100, JSON.stringify(nowOpen));

  // ---------- deliveriesRepo: carreto + dedupe ----------

  const delivery = await admin.evaluate((custId) => window.__deliveriesRepo.createDelivery({
    customerId: custId, items: [{ source: 'avulso', name: 'Frete', unit: 'un', qty: 1 }],
  }), customerId);
  check('createDelivery cria o carreto', delivery.status === 'pendente' && delivery.items.length === 1, JSON.stringify(delivery));

  const dupDedupeKey = 'teste-dedupe-carreto-fixo';
  const first = await admin.evaluate(([custId, key]) => window.__deliveriesRepo.createDelivery({
    customerId: custId, items: [{ source: 'avulso', name: 'Frete 2', unit: 'un', qty: 1 }], dedupeKey: key,
  }), [customerId, dupDedupeKey]);
  check('primeiro carreto com dedupeKey fixo é aceito', first.status === 'pendente', JSON.stringify(first));

  const second = await rawApi(admin, '/api/deliveries', {
    method: 'POST',
    body: JSON.stringify({ customerId, items: [{ source: 'avulso', name: 'Frete 2', unit: 'un', qty: 1 }], dedupeKey: dupDedupeKey }),
  });
  check('reenvio do mesmo carreto (mesmo dedupeKey) é rejeitado', second.status === 409, JSON.stringify(second.body));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
