// Prova views/relatorios.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 16. Relatório de vendas
// (faturamento, ticket médio, margem estimada, vendas por vendedor/
// categoria, curva ABC de produtos), com filtro de período (presets +
// personalizado) e exportação em PDF via impressão nativa. A agregação
// roda no SERVIDOR (routes/reports.js, novo) — nunca traz as vendas
// cruas do período pro navegador, só o relatório já pronto.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-relatorios.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
}

async function apiCall(page, path, opts = {}) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    data: opts.body,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

async function pickCustomSelect(page, selectId, optionText) {
  await page.locator(`#${selectId} + button.custom-select-trigger`).click();
  await page.waitForTimeout(150);
  await page.locator('.custom-select-list.is-open .custom-select-option', { hasText: optionText }).click();
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // Dois produtos em categorias diferentes, dois vendedores.
  const prodA = (await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7801111111111', name: 'Produto A', category: 'material', unit: 'un', price: 100, costPrice: 60, minStock: 1 }),
  })).body.product;
  const prodB = (await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7802222222222', name: 'Produto B', category: 'ferramenta', unit: 'un', price: 10, costPrice: 4, minStock: 1 }),
  })).body.product;
  await apiCall(page, `/api/products/${prodA.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'entrada', qty: 20, note: 'estoque', dedupeKey: crypto.randomUUID() }) });
  await apiCall(page, `/api/products/${prodB.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'entrada', qty: 20, note: 'estoque', dedupeKey: crypto.randomUUID() }) });

  const vendorRes = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Relatorio', username: 'vendedor.relatorio', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor criado', vendorRes.status === 201, vendorRes.status);

  // Venda 1 (admin): 2× Produto A (R$200) — a maior parte do faturamento.
  const sale1 = await apiCall(page, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prodA.id, qty: 2 }], payments: [{ method: 'Dinheiro', amount: 200 }], dedupeKey: crypto.randomUUID() }),
  });
  check('Venda 1 (admin, Produto A) criada', sale1.status === 201, sale1.status);

  // Venda 2 (vendedor): 1× Produto B (R$10) — pequena, deve ficar em C.
  await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.relatorio', password: 'senhaVendedor1' }) });
  const sale2 = await apiCall(page, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prodB.id, qty: 1 }], payments: [{ method: 'Dinheiro', amount: 10 }], dedupeKey: crypto.randomUUID() }),
  });
  check('Venda 2 (vendedor, Produto B) criada', sale2.status === 201, sale2.status);
  await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });

  // Estorna metade da venda 1 (1 unidade de Produto A) — a receita
  // reportada precisa refletir só a quantidade REALMENTE vendida
  // (qty - qtyRefunded), não o que foi originalmente lançado no pedido.
  const refund = await apiCall(page, `/api/sales/${sale1.body.sale.id}/refund`, {
    method: 'POST', body: JSON.stringify({ items: [{ itemIndex: 0, productId: prodA.id, qty: 1 }], reason: 'Teste de estorno pra relatório', dedupeKey: crypto.randomUUID() }),
  });
  check('Estorno parcial da venda 1 (1 de 2 unidades de Produto A) funciona', refund.status === 200, JSON.stringify(refund).slice(0, 200));

  // ---------- Fluxo real: relatório reflete as duas vendas + o estorno ----------
  await page.goto(`${BASE}/#/relatorios`);
  await page.waitForTimeout(800);
  await pickCustomSelect(page, 'period-preset', 'Desde o início');
  let viewText = await page.locator('#view-root').innerText();
  // Faturamento esperado: venda 1 líquida (100, já com o estorno de 1 unidade de A a R$100) + venda 2 (10) = R$110.
  check('Faturamento reflete as duas vendas COM o estorno já descontado (R$ 110,00)', /R\$\s*110,00/.test(viewText), viewText.slice(0, 300));
  check('Contagem de vendas é 2 (as duas vendas, não o estorno como uma terceira)', viewText.includes('2') && /VENDAS[\s\S]{0,10}\n?2\b/.test(viewText) || viewText.includes('VENDAS\n2'), viewText.slice(0, 200));

  check('Faturamento por vendedor: Administrador aparece com R$ 100,00 (venda 1 líquida do estorno)', /Administrador[\s\S]{0,20}1[\s\S]{0,20}R\$\s*100,00/.test(viewText), viewText.slice(0, 400));
  check('Faturamento por vendedor: Vendedor Relatorio aparece com R$ 10,00 (venda 2)', /Vendedor Relatorio[\s\S]{0,20}1[\s\S]{0,20}R\$\s*10,00/.test(viewText), viewText.slice(0, 400));

  check('Vendas por categoria mostra "material" e "ferramenta" separados', viewText.includes('material') && viewText.includes('ferramenta') || /Material|Ferramenta/i.test(viewText), viewText.slice(0, 500));

  check('Produto A aparece com só 1 unidade vendida (2 - 1 estornada)', /Produto A[\s\S]{0,20}1\b/.test(viewText), viewText.slice(0, 600));

  // A receita atribuída por PRODUTO usa a proporção (ratio) da venda
  // inteira sobre a soma dos lineTotal originais — diferente da receita por
  // VENDEDOR (que usa o total líquido cheio da venda). Com metade da venda
  // 1 estornada, Produto A fica com R$ 50 atribuído (não R$ 100), e Produto
  // B com R$ 10 — cumulativo sobre o totalRevenue real (R$ 110): 50/110 =
  // 45,5% e depois (50+10)/110 = 54,5%, os dois ≤ 80%, então os dois caem
  // na classe A. Confere a linha inteira via API (sem ambiguidade de regex
  // sobre texto corrido da tabela).
  const reportCheck = await apiCall(page, '/api/reports/vendas');
  const prodAReport = reportCheck.body.byProduct.find((p) => p.productId === prodA.id);
  const prodBReport = reportCheck.body.byProduct.find((p) => p.productId === prodB.id);
  check('Curva ABC via API: Produto A (45,5% cumulativo) é classe A', prodAReport?.curveClass === 'A', JSON.stringify(prodAReport));
  check('Curva ABC via API: Produto B (54,5% cumulativo) também é classe A', prodBReport?.curveClass === 'A', JSON.stringify(prodBReport));

  // ---------- Filtro de período personalizado exclui vendas fora do intervalo ----------
  await pickCustomSelect(page, 'period-preset', 'Período personalizado');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.fill('#date-from', twoDaysAgo);
  await page.fill('#date-to', yesterday);
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Período personalizado no passado (antes de hoje) não mostra nenhuma venda de hoje', viewText.includes('Nenhuma venda no período'), viewText.slice(0, 300));

  // ---------- Exportar PDF: gera o conteúdo no print-root sem quebrar ----------
  await pickCustomSelect(page, 'period-preset', 'Desde o início');
  await page.click('#export-report-pdf-btn');
  await page.waitForTimeout(500);
  const printRootText = await page.locator('#print-report-root').innerText().catch(() => '');
  check('Exportar PDF preenche o print-report-root com o relatório (faturamento, vendedores, curva ABC)', printRootText.includes('Relatório de vendas') && /R\$\s*110,00/.test(printRootText), printRootText.slice(0, 300));

  check('Zero erros JS/rede durante o fluxo real (relatório/filtros/exportar PDF)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversária: agregação de verdade, não confiando em nada calculado no cliente ----------
  const reportApi = await apiCall(page, '/api/reports/vendas');
  check(
    'API de relatório: margem = faturamento - custo, batendo com o que a tela mostrou (R$ 110 - custo real)',
    Math.abs(reportApi.body.totalRevenue - 110) < 0.01 && Math.abs(reportApi.body.totalMargin - (reportApi.body.totalRevenue - reportApi.body.totalCost)) < 0.01,
    JSON.stringify({ totalRevenue: reportApi.body.totalRevenue, totalCost: reportApi.body.totalCost, totalMargin: reportApi.body.totalMargin }),
  );

  // ---------- Adversária: gate de permissão ----------
  const vendorNoPerm = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Relatorios', username: 'vendedor.sem.relatorios', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem "relatorios" criado', vendorNoPerm.status === 201, vendorNoPerm.status);
  await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.sem.relatorios', password: 'senhaVendedor1' }) });
  const deniedRead = await apiCall(page, '/api/reports/vendas');
  check('Vendedor SEM "relatorios" toma 403 tentando ler o relatório', deniedRead.status === 403, deniedRead.status);

  const vendorWithPermRes = await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  check('Login de volta como admin funciona (pra criar o próximo vendedor)', vendorWithPermRes.status === 200, vendorWithPermRes.status);
  await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Com Relatorios', username: 'vendedor.com.relatorios', password: 'senhaVendedor1', permissions: { relatorios: true } }),
  });
  await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.com.relatorios', password: 'senhaVendedor1' }) });
  const allowedRead = await apiCall(page, '/api/reports/vendas');
  check('Vendedor COM "relatorios" delegado consegue ler (não é exclusivo de admin)', allowedRead.status === 200, allowedRead.status);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
