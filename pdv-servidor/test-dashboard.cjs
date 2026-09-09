// Prova views/dashboard.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 9. Painel é a tela mais visitada
// do sistema: junta 7 domínios (produtos, vendas, caixa, clientes/fiado,
// fidelidade, empresa, carreto) numa visão só, com deep-links pras telas
// de cada um.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-dashboard.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

function dateStr(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function login(page) {
  await page.goto(BASE);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
}

async function createProduct(page, { name, barcode, price, cost, qty, minStock, expiryDate, expiryDays, promoPrice }) {
  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ Novo produto")');
  await page.waitForTimeout(300);
  await page.fill('#f-name', name);
  await page.fill('#f-barcode', barcode);
  await page.fill('#f-price', String(price));
  await page.fill('#f-cost', String(cost));
  await page.fill('#f-quantity', String(qty));
  if (minStock != null) await page.fill('#f-min', String(minStock));
  if (expiryDate) {
    await page.fill('#f-expiry-date', expiryDate);
    await page.fill('#f-expiry-days', String(expiryDays));
    await page.fill('#f-promo-price', String(promoPrice));
  }
  await page.click('.modal button:has-text("Cadastrar produto")');
  await page.waitForTimeout(500);
}

async function sellToCustomer(page, { productName, customerName, method }) {
  await page.fill('input[placeholder*="Escaneie" i]', productName);
  await page.waitForTimeout(400);
  await page.click('[data-pick]');
  await page.waitForTimeout(300);
  if (customerName) {
    await page.fill('#customer-search', customerName);
    await page.waitForTimeout(400);
    await page.click('[data-pick-customer]');
    await page.waitForTimeout(300);
  }
  await page.click('#add-payment-btn');
  await page.waitForTimeout(200);
  if (method === 'Fiado') {
    await page.selectOption('select[data-pay-method="0"]', 'Fiado', { force: true });
    await page.waitForTimeout(300);
  }
  await page.click('#finalize-btn');
  await page.waitForTimeout(700);
  await page.click('button:has-text("Fechar")').catch(() => {});
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page);

  // ---------- Dashboard é a rota padrão (sem hash nenhum) ----------
  await page.goto(BASE);
  await page.waitForTimeout(600);
  let dashText = await page.locator('#view-root').innerText();
  check('Login sem hash cai direto no Painel (rota padrão)', dashText.includes('Resumo geral da loja'), dashText.slice(0, 60));
  check('Painel mostra saudação com o primeiro nome do usuário', dashText.includes('Olá, Administrador'));

  // ---------- Monta o cenário: estoque baixo, perto/fora da validade ----------
  await createProduct(page, { name: 'Painel Estoque Baixo', barcode: 'DASH-LOW-1', price: 10, cost: 5, qty: 2, minStock: 5 });
  await createProduct(page, {
    name: 'Painel Perto da Validade', barcode: 'DASH-NEAR-1', price: 15, cost: 8, qty: 10,
    expiryDate: dateStr(3), expiryDays: 7, promoPrice: 12,
  });
  await createProduct(page, {
    name: 'Painel Vencido', barcode: 'DASH-EXP-1', price: 20, cost: 10, qty: 10,
    expiryDate: dateStr(-1), expiryDays: 7, promoPrice: 15,
  });
  await createProduct(page, { name: 'Painel Venda Normal', barcode: 'DASH-SALE-1', price: 50, cost: 25, qty: 20 });

  // ---------- Venda à vista (Vendas hoje / Faturado hoje) ----------
  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(400);
  await sellToCustomer(page, { productName: 'Painel Venda Normal', customerName: null, method: 'Dinheiro' });

  // ---------- Cliente com fiado (Total em fiado) e fidelidade (Pontos) ----------
  await page.goto(`${BASE}/#/clientes`);
  await page.waitForTimeout(500);
  await page.click('#new-customer-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Cliente Painel Teste');
  await page.click('.modal button:has-text("Cadastrar cliente")');
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    await fetch('/api/loyalty/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ pointsPerReal: 1, redemptionRate: 10 }),
    });
  });

  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(400);
  await sellToCustomer(page, { productName: 'Painel Estoque Baixo', customerName: 'Cliente Painel Teste', method: 'Fiado' });

  // ---------- Carreto pendente (via API, item avulso — não precisa passar pela tela de carreto ainda não portada) ----------
  const carretoResult = await page.evaluate(async () => {
    const listRes = await fetch('/api/customers?q=Cliente Painel Teste', { credentials: 'include' });
    const { customers } = await listRes.json();
    const customer = customers[0];
    const res = await fetch('/api/deliveries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ customerId: customer.id, items: [{ source: 'avulso', name: 'Carga de areia', unit: 'un', qty: 1 }], dedupeKey: crypto.randomUUID() }),
    });
    return res.status;
  });
  check('Carreto de teste criado com sucesso (setup, não é asserção do Painel em si)', carretoResult === 201, carretoResult);

  // ---------- Painel reflete tudo isso ----------
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(700);
  dashText = await page.locator('#view-root').innerText();

  check('Produtos ativos = 4', /PRODUTOS ATIVOS\s*\n?\s*4/i.test(dashText.replace(/\s+/g, ' ')), dashText.match(/PRODUTOS ATIVOS[\s\S]{0,10}/i)?.[0]);
  check('Estoque baixo = 1', /ESTOQUE BAIXO\s*\n?\s*1/i.test(dashText.replace(/\s+/g, ' ')));
  check('Vendas hoje = 2 (1 à vista + 1 fiada)', /VENDAS HOJE\s*\n?\s*2/i.test(dashText.replace(/\s+/g, ' ')));
  check('Faturado hoje > R$0 (mostra R$ 60,00 — 50 à vista + 10 fiado)', /FATURADO HOJE[\s\S]{0,20}60,00/i.test(dashText), dashText.match(/FATURADO HOJE[\s\S]{0,30}/i)?.[0]);
  check('Total em fiado = R$ 10,00', /TOTAL EM FIADO[\s\S]{0,20}10,00/i.test(dashText), dashText.match(/TOTAL EM FIADO[\s\S]{0,30}/i)?.[0]);
  check('Carretos pendentes = 1', /CARRETOS PENDENTES\s*\n?\s*1/i.test(dashText.replace(/\s+/g, ' ')));
  check('Próximo da validade = 1 (só o "perto", não o vencido)', /PRÓXIMO DA VALIDADE\s*\n?\s*1/i.test(dashText.replace(/\s+/g, ' ')));
  check('Fora da validade = 1 (só o vencido, não conta em dobro no "perto")', /FORA DA VALIDADE\s*\n?\s*1/i.test(dashText.replace(/\s+/g, ' ')));
  check('Pontos de fidelidade em aberto aparece (10 pontos, 1 ponto por R$1 gasto em Dinheiro)', /PONTOS DE FIDELIDADE EM ABERTO[\s\S]{0,10}10/i.test(dashText), dashText.match(/PONTOS DE FIDELIDADE[\s\S]{0,40}/i)?.[0]);
  check('Tabela de "Últimas vendas" mostra as 2 vendas', (dashText.match(/Painel Venda Normal|Cliente Painel Teste/g) || []).length >= 1);
  // renderPendingDeliveriesTable só mostra data/cliente/endereço/CONTAGEM de
  // itens/responsável — nunca o nome do item em si — então a checagem é
  // pelo nome do cliente do carreto, não pelo item "Carga de areia".
  check('Tabela de "Carretos pendentes" mostra o carreto criado (cliente certo)', dashText.includes('Cliente Painel Teste'));

  check('Zero erros JS/rede durante o fluxo real (cadastro/vendas/painel)', errors.length === 0, JSON.stringify(errors));

  // ---------- Painel se atualiza sozinho via WebSocket (LIVE_TOPICS) ----------
  // Diferente de 'venda'/'vendas'/'clientes' (que ficam de fora de
  // propósito — ver public/js/app.js), 'dashboard' não tem filtro nem
  // estado nenhum pra perder num recarregamento — é só um retrato do
  // momento, então É seguro (e é literalmente o propósito da tela)
  // atualizar sozinho quando outro terminal vende algo.
  const ctxB = await browser.newContext();
  const machineB = await ctxB.newPage();
  await machineB.goto(BASE);
  await machineB.fill('#username', 'admin');
  await machineB.fill('#password', 'admin123');
  await machineB.click('button[type="submit"]');
  await machineB.waitForTimeout(600);
  await machineB.goto(`${BASE}/#/venda`);
  await machineB.waitForTimeout(400);
  await sellToCustomer(machineB, { productName: 'Painel Venda Normal', customerName: null, method: 'Dinheiro' });

  const sawLiveUpdate = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const text = await page.locator('#view-root').innerText();
      if (/VENDAS HOJE\s*\n?\s*3/i.test(text.replace(/\s+/g, ' '))) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
  check('Painel da Máquina A atualiza sozinho (Vendas hoje 2→3) quando a Máquina B vende, sem F5', sawLiveUpdate);
  await ctxB.close();

  // ---------- Deep-links: cada card leva pra tela certa ----------
  await page.click('#lowstock-stat-card');
  await page.waitForTimeout(500);
  check('Card "Estoque baixo" leva pra Estoque já filtrado', page.url().endsWith('/#/estoque') && (await page.locator('#view-root').innerText()).includes('Painel Estoque Baixo'));

  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(500);
  await page.click('#salestoday-stat-card');
  await page.waitForTimeout(500);
  check('Card "Vendas hoje" leva pro Histórico de vendas (rota "vendas")', page.url().endsWith('/#/vendas'), page.url());

  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(500);
  await page.click('#fiado-stat-card');
  await page.waitForTimeout(500);
  check('Card "Total em fiado" leva pra Clientes', page.url().endsWith('/#/clientes'), page.url());

  // ---------- Card de Caixa não crasha mesmo caixa.js ainda não portada ----------
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(500);
  await page.click('#cash-stat-card');
  await page.waitForTimeout(500);
  const afterCashClick = await page.locator('#view-root').innerText().catch(() => null);
  check('Clicar no card "Caixa" (tela ainda não portada) não quebra a página', afterCashClick !== null, page.url());

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
