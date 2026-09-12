const { chromium } = require('playwright');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // Dois "contextos" separados = duas máquinas diferentes de verdade (cada
  // uma com seu próprio cookie jar, sem nada compartilhado entre elas a
  // não ser o servidor).
  const machineA = await browser.newContext();
  const machineB = await browser.newContext();
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();

  const errorsA = [];
  const errorsB = [];
  pageA.on('pageerror', (e) => errorsA.push(e.message));
  pageB.on('pageerror', (e) => errorsB.push(e.message));

  await pageA.goto('http://localhost:3131/test.html');
  await pageB.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);

  // Login em cada máquina
  await pageA.click('#login-btn');
  await pageB.click('#login-btn');
  await pageA.waitForTimeout(500);
  await pageB.waitForTimeout(500);

  check('Máquina A logou (mostra nome do usuário)', (await pageA.locator('#user-name').textContent()).includes('Administrador'));
  check('Máquina B logou (mostra nome do usuário)', (await pageB.locator('#user-name').textContent()).includes('Administrador'));

  // Espera o WebSocket conectar nas duas
  await pageA.waitForSelector('#ws-status.connected', { timeout: 5000 });
  await pageB.waitForSelector('#ws-status.connected', { timeout: 5000 });
  check('WebSocket conectado na máquina A', true);
  check('WebSocket conectado na máquina B', true);

  const rowsA_before = await pageA.locator('#products-tbody tr').count();
  const rowsB_before = await pageB.locator('#products-tbody tr').count();
  check('Estoque começa vazio nas duas máquinas', rowsA_before === 0 && rowsB_before === 0, `A=${rowsA_before} B=${rowsB_before}`);

  // Cadastra um produto NA MÁQUINA A
  await pageA.fill('#f-barcode', 'MT001');
  await pageA.fill('#f-name', 'Cimento Multi-Terminal');
  await pageA.fill('#f-price', '39.90');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);

  const rowsA_after = await pageA.locator('#products-tbody tr').count();
  check('Máquina A vê o produto que ela mesma cadastrou', rowsA_after === 1, rowsA_after);

  // A MÁQUINA B nunca clicou em nada — só espera o WebSocket avisar
  await pageB.waitForTimeout(800);
  const rowsB_after = await pageB.locator('#products-tbody tr').count();
  check('Máquina B recebeu o produto em TEMPO REAL (sem recarregar a página)', rowsB_after === 1, rowsB_after);
  const bText = await pageB.locator('#products-tbody').textContent();
  check('Máquina B mostra o nome certo do produto', bText.includes('Cimento Multi-Terminal'));

  // Agora ajusta estoque NA MÁQUINA B e confere que A também vê
  await pageB.click('[data-entrada]');
  await pageB.waitForTimeout(400);
  await pageA.waitForTimeout(800);
  const qtyTextA = await pageA.locator('#products-tbody tr').first().textContent();
  check('Ajuste de estoque feito na máquina B aparece na máquina A em tempo real', qtyTextA.includes('1'), qtyTextA.replace(/\s+/g, ' '));

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
