const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const machineB = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();

  await pageA.goto('http://localhost:3131/test.html');
  await pageB.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageB.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageB.waitForSelector('#ws-status.connected');

  // --- Modo único: A abre e movimenta, B só observa ---
  await pageA.selectOption('#caixa-mode-select', 'unico');
  await pageA.click('#save-caixa-mode-btn');
  await pageA.waitForTimeout(300);

  await pageA.fill('#opening-amount', '200');
  await pageA.click('#open-cash-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#mov-amount', '50');
  await pageA.fill('#mov-reason', 'Depósito no banco');
  await pageA.click('[data-mov="sangria"]');
  await pageA.waitForTimeout(500);

  await pageB.waitForTimeout(600);
  await pageB.screenshot({ path: 'demo-caixa-unico-maquina-b.png' });

  // Fecha o caixa único pra deixar o terreno limpo pro modo por-terminal
  await pageB.click('#close-cash-btn');
  await pageB.waitForTimeout(300);
  await pageB.click('#confirm-close-btn');
  await pageA.waitForTimeout(600);

  // --- Modo por terminal: cada máquina abre o seu, isolado ---
  await pageA.selectOption('#caixa-mode-select', 'porTerminal');
  await pageA.click('#save-caixa-mode-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#terminal-name-input', 'Caixa 1 — Balcão');
  await pageA.locator('#terminal-name-input').dispatchEvent('change');
  await pageB.fill('#terminal-name-input', 'Caixa 2 — Depósito');
  await pageB.locator('#terminal-name-input').dispatchEvent('change');

  await pageA.fill('#opening-amount', '150');
  await pageA.click('#open-cash-btn');
  await pageA.waitForTimeout(400);

  await pageB.fill('#opening-amount', '80');
  await pageB.click('#open-cash-btn');
  await pageB.waitForTimeout(400);

  await pageA.screenshot({ path: 'demo-caixa-terminal-a.png' });
  await pageB.screenshot({ path: 'demo-caixa-terminal-b.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
