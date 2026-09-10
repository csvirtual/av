// Tela "Dados da loja" (public/js/views/company.js) — nova, enxuta: só a
// política de venda (desconto máximo, exigir caixa aberto, juro do
// parcelamento no cartão). routes/company.js já existia desde a Fase 8
// (leitura pra sale.js, escrita já testada por API em test-security.cjs);
// esta tela fecha a lacuna de EDITAR isso sem chamar a API na unha —
// achado real de um usuário tentando configurar o juro do cartão sem
// achar onde. Cadastro/licenciamento (fora de escopo do servidor, ver
// README) continuam sem tela nenhuma — só a política mesmo.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-company.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page) {
  await page.goto(BASE);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
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
  return { status: res.status, body };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401') && !m.text().includes('403')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me') && !res.url().endsWith('/api/company')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page);

  // ---------- Menu mostra "Dados da loja" pro admin ----------
  await page.waitForTimeout(400);
  const navLink = await page.locator('[data-route="empresa"]').count();
  check('Item "Dados da loja" aparece no menu do admin', navLink === 1, navLink);

  // ---------- Navega e confere valores padrão pré-preenchidos ----------
  await page.click('[data-route="empresa"]');
  await page.waitForTimeout(500);
  const vendorMaxDiscountInitial = await page.locator('#vendorMaxDiscount').inputValue();
  check('Campo de desconto máximo vem preenchido (padrão 10)', vendorMaxDiscountInitial === '10', vendorMaxDiscountInitial);

  // ---------- Edita e salva ----------
  await page.fill('#vendorMaxDiscount', '15');
  await page.check('#requireCashSession');
  await page.check('#creditInterestFreeEnabled');
  await page.fill('#creditInterestFreeInstallments', '2');
  await page.check('#creditInterestTypeMonthly');
  await page.fill('#creditInterestMonthlyPercent', '5.5');
  await page.click('#company-save-btn');
  await page.waitForTimeout(500);
  const toastText = await page.locator('.toast').innerText().catch(() => '');
  check('Toast de sucesso ao salvar', /salva/i.test(toastText), toastText);

  // ---------- Confirma no servidor (fonte de verdade), não só na tela ----------
  const afterSave = await apiCall(page, '/api/company');
  check('Servidor gravou o desconto máximo novo', afterSave.body.vendorMaxDiscountPercent === 15, afterSave.body.vendorMaxDiscountPercent);
  check('Servidor gravou "exigir caixa aberto"', afterSave.body.requireOpenCashSession === true, afterSave.body.requireOpenCashSession);
  check('Servidor gravou o juro de 5.5% ao mês', afterSave.body.creditInterest.monthlyPercent === 5.5, afterSave.body.creditInterest.monthlyPercent);
  check('Servidor gravou 2x sem juros', afterSave.body.creditInterest.freeInstallments === 2, afterSave.body.creditInterest.freeInstallments);

  // ---------- Recarrega e confirma que a tela mostra o valor persistido (não o padrão de novo) ----------
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('[data-route="empresa"]');
  await page.waitForTimeout(400);
  const monthlyAfterReload = await page.locator('#creditInterestMonthlyPercent').inputValue();
  check('Depois de recarregar a página, o juro salvo continua lá (não voltou ao padrão)', monthlyAfterReload === '5.5', monthlyAfterReload);

  // ---------- O novo juro já vale numa venda de verdade (fim a fim, não só na tela de configuração) ----------
  // "Exigir caixa aberto" também acabou de ser ligado (checkbox marcado
  // acima) — abre um caixa antes, senão a própria política nova (correta)
  // bloqueia a venda antes de chegar no scan-input.
  await apiCall(page, '/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 100 }) });
  const prod = (await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7822222222222', name: 'Produto Juro', category: 'material', unit: 'un', price: 100, costPrice: 40, minStock: 1 }),
  })).body.product;
  await apiCall(page, `/api/products/${prod.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'entrada', qty: 10, note: 'estoque' }) });

  await page.goto(`${BASE}/#/venda`);
  await page.waitForTimeout(700);
  await page.fill('#scan-input', 'Produto Juro');
  await page.waitForTimeout(500);
  await page.click('[data-pick]');
  await page.waitForTimeout(400);
  await page.click('#add-payment-btn');
  await page.waitForTimeout(300);
  await page.selectOption('.payment-method-select', { label: 'Cartão de crédito' });
  await page.waitForTimeout(300);
  // Muda pra 3x (acima das 2x isentas configuradas) — deve cobrar 3 × 5,5% = 16,5% de juro.
  await page.selectOption('.payment-installments-select', '3').catch(() => {});
  await page.waitForTimeout(300);
  const paymentsBoxText = await page.locator('#payments-box').innerText().catch(() => '');
  check('Venda em 3x já cobra o juro novo (16,5%) configurado agora em Dados da loja', /16[.,]5%/.test(paymentsBoxText), paymentsBoxText.slice(0, 300));

  // ---------- Vendedor sem a permissão "empresa" ----------
  const vendorPass = 'senha12345';
  await apiCall(page, '/api/users', { method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Empresa', username: `semempresa${Date.now()}`, password: vendorPass, permissions: {} }) });
  const created = (await apiCall(page, '/api/users')).body.users.find((u) => u.nome === 'Vendedor Sem Empresa');

  const pageV = await browser.newPage();
  await pageV.goto(BASE);
  await pageV.fill('#username', created.username);
  await pageV.fill('#password', vendorPass);
  await pageV.click('button[type="submit"]');
  await pageV.waitForTimeout(600);

  const navLinkVendor = await pageV.locator('[data-route="empresa"]').count();
  check('Vendedor sem a permissão "empresa" NÃO vê o item no menu', navLinkVendor === 0, navLinkVendor);

  // Mesmo padrão já testado em relatorios/logs/financeiro/backup: deep-link direto ainda renderiza a tela.
  await pageV.goto(`${BASE}/#/empresa`);
  await pageV.waitForTimeout(500);
  const formVisibleForVendor = await pageV.locator('#company-form').count();
  check('Mesmo sem permissão, deep-link direto pra #/empresa ainda mostra o formulário (gate real é o servidor)', formVisibleForVendor === 1, formVisibleForVendor);

  await pageV.fill('#vendorMaxDiscount', '99');
  await pageV.click('#company-save-btn');
  await pageV.waitForTimeout(500);
  const vendorErrText = await pageV.locator('#company-form-error').innerText().catch(() => '');
  check('Vendedor sem permissão recebe erro amigável (403), tela não trava', /permiss/i.test(vendorErrText), vendorErrText);

  const afterVendorAttempt = await apiCall(page, '/api/company');
  check('Tentativa do vendedor sem permissão NÃO alterou o valor real (continua 15)', afterVendorAttempt.body.vendorMaxDiscountPercent === 15, afterVendorAttempt.body.vendorMaxDiscountPercent);

  await pageV.close();

  check('Zero erros JS/rede inesperados', errors.length === 0, JSON.stringify(errors));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
