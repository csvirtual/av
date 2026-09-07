const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  const machineB = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();

  await pageA.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');

  // Admin cadastra a Maria como vendedora, só com acesso a Financeiro
  await pageA.fill('#new-user-nome', 'Maria Vendedora');
  await pageA.fill('#new-user-username', 'maria');
  await pageA.fill('#new-user-password', 'senha1234');
  await pageA.check('#new-user-perm-financeiro');
  await pageA.click('#add-user-btn');
  await pageA.waitForTimeout(500);
  await pageA.screenshot({ path: 'demo-usuarios-admin.png' });

  // Maria loga na máquina B
  await pageB.goto('http://localhost:3131/test.html');
  await pageB.waitForTimeout(300);
  await pageB.fill('#username', 'maria');
  await pageB.fill('#password', 'senha1234');
  await pageB.click('#login-btn');
  await pageB.waitForSelector('#ws-status.connected');
  await pageB.waitForTimeout(400);
  await pageB.screenshot({ path: 'demo-usuarios-maria.png' });

  // Admin abre o log de auditoria
  await pageA.click('#audit-refresh-btn');
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: 'demo-log-auditoria.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
