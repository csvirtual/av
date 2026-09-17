const { chromium } = require('playwright');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  // Contexts separados = localStorage separado = terminalId diferente pra cada "máquina" (mesmo sem cookies compartilhados).
  const machineA = await browser.newContext();
  const machineB = await browser.newContext();
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();
  const errorsA = [], errorsB = [];
  pageA.on('pageerror', (e) => errorsA.push(e.message));
  pageB.on('pageerror', (e) => errorsB.push(e.message));

  await pageA.goto('http://localhost:3131/test.html');
  await pageB.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageB.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageB.waitForSelector('#ws-status.connected');

  // --- Modo único ---
  await pageA.selectOption('#caixa-mode-select', 'unico');
  await pageA.click('#save-caixa-mode-btn');
  await pageA.waitForTimeout(400);
  const modeB1 = await pageB.locator('#caixa-mode-select').inputValue();
  check('máquina B vê o modo "único" em tempo real (mudou na A)', modeB1 === 'unico', modeB1);

  // Máquina A abre o caixa único da loja
  await pageA.fill('#opening-amount', '100');
  await pageA.click('#open-cash-btn');
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(600);
  const bHasCloseBtn1 = await pageB.locator('#close-cash-btn').count();
  check('máquina B vê o caixa único aberto pela A, em tempo real (sem ação na B)', bHasCloseBtn1 === 1, bHasCloseBtn1);

  // Máquina B faz uma sangria — a A precisa ver o movimento sem recarregar
  await pageB.fill('#mov-amount', '20');
  await pageB.fill('#mov-reason', 'Depósito no banco (teste multi-terminal)');
  await pageB.click('[data-mov="sangria"]');
  await pageA.waitForTimeout(600);
  const movRowsA = await pageA.locator('#cash-mov-tbody tr').count();
  const movTextA = await pageA.locator('#cash-mov-tbody').textContent();
  check('máquina A vê a sangria feita na B em tempo real', movRowsA === 1 && movTextA.includes('20,00'), movTextA.replace(/\s+/g, ' '));

  // Máquina A fecha o caixa (contado = esperado, sem diferença)
  await pageA.click('#close-cash-btn');
  await pageA.waitForTimeout(300);
  await pageA.click('#confirm-close-btn');
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(600);
  const bOpenBtnCount = await pageB.locator('#open-cash-btn').count();
  check('máquina B vê o caixa fechado (voltou pra "abrir caixa") em tempo real', bOpenBtnCount === 1, bOpenBtnCount);

  // --- Modo por terminal ---
  await pageA.selectOption('#caixa-mode-select', 'porTerminal');
  await pageA.click('#save-caixa-mode-btn');
  await pageA.waitForTimeout(400);
  const modeB2 = await pageB.locator('#caixa-mode-select').inputValue();
  check('máquina B vê o modo "por terminal" em tempo real', modeB2 === 'porTerminal', modeB2);

  await pageA.fill('#terminal-name-input', 'Caixa A');
  await pageA.locator('#terminal-name-input').dispatchEvent('change');
  await pageB.fill('#terminal-name-input', 'Caixa B');
  await pageB.locator('#terminal-name-input').dispatchEvent('change');

  // Máquina A abre o caixa DELA — B não deve ver como se fosse seu
  await pageA.fill('#opening-amount', '50');
  await pageA.click('#open-cash-btn');
  await pageA.waitForTimeout(600);
  const bStillShowsOpenBtn = await pageB.locator('#open-cash-btn').count();
  check('máquina B continua vendo "abrir caixa" (o caixa da A é só da A, isolado)', bStillShowsOpenBtn === 1, bStillShowsOpenBtn);

  // Máquina B abre o dela, independente
  await pageB.fill('#opening-amount', '70');
  await pageB.click('#open-cash-btn');
  await pageB.waitForTimeout(400);
  const aInfoText = await pageA.locator('#cash-box').textContent();
  const bInfoText = await pageB.locator('#cash-box').textContent();
  check('caixa da máquina A mostra troco 50,00 (o dela)', aInfoText.includes('50,00'), aInfoText.replace(/\s+/g, ' ').slice(0, 200));
  check('caixa da máquina B mostra troco 70,00 (o dela, independente do da A)', bInfoText.includes('70,00'), bInfoText.replace(/\s+/g, ' ').slice(0, 200));

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — CAIXA MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
