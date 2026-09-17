// Prova a tela "Dados da loja" completa (achado do usuário: cadastro
// fiscal + trava de CNPJ + ativação de licença, igual à extensão) — ver
// routes/company.js, routes/license.js, lib/license.js, views/company.js.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login(page, username, password) {
  await page.goto(BASE);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Filtra também 400/403: este teste dispara essas respostas DE PROPÓSITO
  // (chave inválida, tentativa de mudar CNPJ travado sem token) — o
  // próprio Chrome já loga "Failed to load resource: ..." no console pra
  // qualquer resposta não-2xx, sem relação com um bug de verdade no app.
  page.on('console', (m) => { if (m.type() === 'error' && !/40[013]/.test(m.text())) errors.push('console.error: ' + m.text()); });

  // ---------- Sistema não bloqueado (trial ativo) ----------
  await page.goto(BASE);
  await page.waitForTimeout(600);
  check('Login normal aparece (trial ativo, sem bloqueio)', await page.locator('#login-form').count() > 0);

  await login(page, 'admin', 'admin123');
  await page.goto(`${BASE}/#/empresa`);
  await page.waitForTimeout(700);

  // ---------- Ativação (trial) ----------
  // .innerText reflete o CSS (o badge usa text-transform: uppercase) —
  // compara sem diferenciar maiúsculas/minúsculas de propósito.
  let bodyText = await page.locator('#view-root').innerText();
  check('Card de Ativação mostra "Período de teste"', /per[ií]odo de teste/i.test(bodyText), bodyText.slice(0, 200));
  check('Campo pra colar chave de ativação existe (trial, não definitiva)', await page.locator('#license-input').count() === 1);

  // ---------- CNPJ vem vazio e editável (loja limpa) ----------
  const cnpjDisabledBefore = await page.locator('#cnpj').isDisabled();
  check('CNPJ vem vazio e editável (servidor limpo)', !cnpjDisabledBefore);
  check('Sem toggle de destravar (nada travado ainda)', await page.locator('#cnpj-unlock-toggle').count() === 0);

  // ---------- Preenche cadastro fiscal completo e salva ----------
  await page.fill('#cnpj', '11.222.333/0001-81'); // CNPJ válido (dígitos verificadores corretos)
  await page.fill('#telefone', '71999998888');
  await page.fill('#razaoSocial', 'Loja Teste LTDA');
  await page.fill('#nomeFantasia', 'Loja Teste');
  await page.fill('#logradouro', 'Rua das Flores');
  await page.fill('#numero', '100');
  await page.fill('#bairro', 'Centro');
  await page.fill('#cidade', 'Salvador');
  await page.selectOption('#uf', 'BA');
  await page.fill('#cep', '40000-000');
  await page.click('#ramoMaterial');
  await page.click('#company-save-btn');
  await page.waitForTimeout(700);

  bodyText = await page.locator('.toast, #view-root').allInnerTexts().then((arr) => arr.join(' '));
  check('Toast de sucesso ao salvar cadastro fiscal', bodyText.includes('atualizados') || (await page.locator('.toast-success, .toast').count()) > 0);

  // ---------- CNPJ agora trava ----------
  await page.reload();
  await page.waitForTimeout(700);
  const cnpjDisabledAfter = await page.locator('#cnpj').isDisabled();
  check('CNPJ trava depois de salvo', cnpjDisabledAfter);
  check('Toggle "Desbloquear edição" aparece agora', await page.locator('#cnpj-unlock-toggle').count() === 1);
  const cnpjValueAfterReload = await page.locator('#cnpj').inputValue();
  check('CNPJ persistiu formatado', cnpjValueAfterReload === '11.222.333/0001-81', cnpjValueAfterReload);

  // ---------- Tentar mudar o CNPJ direto na API, sem token — deve ser rejeitado ----------
  const directAttempt = await page.evaluate(async () => {
    const res = await fetch('/api/company', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cnpj: '11.444.777/0001-61' }), // outro CNPJ válido (dígitos verificadores corretos) — testa o TRAVAMENTO, não formato
    });
    return { status: res.status, body: await res.json() };
  });
  check('Servidor rejeita mudar CNPJ sem token de liberação (403)', directAttempt.status === 403, JSON.stringify(directAttempt.body));

  // Confirma que o CNPJ realmente NÃO mudou no servidor
  const afterAttempt = await page.evaluate(async () => (await fetch('/api/company', { credentials: 'include' }).then((r) => r.json())).cnpj);
  check('CNPJ continua o mesmo depois da tentativa direta', afterAttempt === '11.222.333/0001-81', afterAttempt);

  // ---------- Chave de ativação inválida é rejeitada ----------
  await page.fill('#license-input', 'chave-invalida-qualquer.coisa');
  await page.click('#license-activate-btn');
  await page.waitForTimeout(500);
  const activateErr = await page.locator('#license-error').innerText();
  check('Chave inválida mostra erro amigável', activateErr.length > 0, activateErr);

  // ---------- Campos das Políticas de venda continuam funcionando (não quebrou nada da sessão anterior) ----------
  await page.fill('#vendorMaxDiscount', '15');
  await page.click('#company-save-btn');
  await page.waitForTimeout(600);
  const discountAfter = await page.evaluate(async () => (await fetch('/api/company', { credentials: 'include' }).then((r) => r.json())).vendorMaxDiscountPercent);
  check('Política de desconto continua editável e persistindo (15)', discountAfter === 15, discountAfter);

  // ---------- companyRepo.js#getCompany() devolve os campos que
  // components/receipt.js e reportPrint.js já esperavam prontos (achado
  // do usuário: antes desta mudança, sempre vinham undefined) ----------
  const companyShape = await page.evaluate(async () => {
    const mod = await import('/js/data/companyRepo.js');
    return mod.getCompany();
  });
  check('getCompany() devolve nomeFantasia (usado no recibo)', companyShape.nomeFantasia === 'Loja Teste', companyShape.nomeFantasia);
  check('getCompany() devolve cnpj (usado no recibo)', companyShape.cnpj === '11.222.333/0001-81', companyShape.cnpj);
  check('getCompany() devolve razaoSocial (usado no recibo)', companyShape.razaoSocial === 'Loja Teste LTDA', companyShape.razaoSocial);
  check('getCompany() devolve telefone (usado no recibo)', !!companyShape.telefone);
  check('getCompany() ainda devolve policies aninhado (não quebrou consumidores existentes)', companyShape.policies?.vendorMaxDiscountPercent === 15, JSON.stringify(companyShape.policies));

  check('Zero erros JS/console inesperados', errors.length === 0, JSON.stringify(errors));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(passed === results.length ? 0 : 1);
})();
