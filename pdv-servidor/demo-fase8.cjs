const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const pageA = await machineA.newPage();

  await pageA.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');

  await pageA.fill('#company-max-discount', '10');
  await pageA.click('#save-company-btn');
  await pageA.waitForTimeout(300);

  await pageA.fill('#new-user-nome', 'Pedro Vendedor');
  await pageA.fill('#new-user-username', 'pedro');
  await pageA.fill('#new-user-password', 'senha1234');
  await pageA.click('#add-user-btn');
  await pageA.waitForTimeout(400);

  // Simula login com 2 senhas erradas para o "pedro" pra provar o bloqueio
  await pageA.click('#logout-btn');
  await pageA.waitForTimeout(300);
  for (let i = 0; i < 2; i++) {
    await pageA.fill('#username', 'pedro');
    await pageA.fill('#password', 'senhaErrada');
    await pageA.click('#login-btn');
    await pageA.waitForTimeout(200);
  }
  await pageA.fill('#password', 'senha1234'); // até com a senha CERTA agora
  await pageA.click('#login-btn');
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: 'demo-lockout.png' });

  // Volta como admin pra continuar o cenário de desconto
  await pageA.fill('#username', 'admin');
  await pageA.fill('#password', 'admin123');
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageA.waitForTimeout(300);

  await pageA.fill('#f-barcode', 'FASE8-DEMO-01');
  await pageA.fill('#f-name', 'Furadeira de impacto');
  await pageA.fill('#f-price', '250');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(300);
  await pageA.click('[data-entrada]');
  await pageA.waitForTimeout(200);
  await pageA.click('#logout-btn');
  await pageA.waitForTimeout(300);

  // Pedro (já destravado, passou 60s? não — pra demo, o lockout de "pedro" já
  // expira sozinho depois de 60s; aqui simplesmente cadastra outro vendedor
  // limpo pra não esperar) — usa a MESMA conta "pedro" já que a última
  // tentativa (senha certa) tinha sido bloqueada; aguarda o suficiente.
  await pageA.waitForTimeout(60000);
  await pageA.fill('#username', 'pedro');
  await pageA.fill('#password', 'senha1234');
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageA.waitForTimeout(300);

  await pageA.click('[data-cart]');
  await pageA.waitForTimeout(150);
  await pageA.fill('#sale-discount', '40');
  await pageA.click('#finalize-btn');
  await pageA.waitForTimeout(400);
  await pageA.screenshot({ path: 'demo-aprovacao-desconto.png' });

  await pageA.fill('#approval-username', 'admin');
  await pageA.fill('#approval-password', 'admin123');
  await pageA.click('#confirm-approval-btn');
  await pageA.waitForTimeout(500);

  await pageA.click('#logout-btn');
  await pageA.waitForTimeout(300);
  await pageA.fill('#username', 'admin');
  await pageA.fill('#password', 'admin123');
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: 'demo-backup-secao.png' });

  console.log('screenshots salvos.');
  await browser.close();
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
