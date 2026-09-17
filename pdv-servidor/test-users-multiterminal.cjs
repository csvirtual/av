const { chromium } = require('playwright');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext();
  const machineB = await browser.newContext();
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();
  const errorsA = [], errorsB = [];
  pageA.on('pageerror', (e) => errorsA.push(e.message));
  pageB.on('pageerror', (e) => errorsB.push(e.message));

  // Máquina A loga como admin
  await pageA.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');

  const aComprasVisible = await pageA.locator('#compras-section').isVisible();
  const aUsersVisible = await pageA.locator('#users-section').isVisible();
  check('admin vê Compras e Usuários (acesso total)', aComprasVisible && aUsersVisible, `compras=${aComprasVisible} usuarios=${aUsersVisible}`);

  // Admin cadastra um "Gerente" só com a permissão 'usuarios'
  await pageA.fill('#new-user-nome', 'Gerente Loja');
  await pageA.fill('#new-user-username', 'gerente');
  await pageA.fill('#new-user-password', 'senha1234');
  await pageA.check('#new-user-perm-usuarios');
  await pageA.click('#add-user-btn');
  await pageA.waitForTimeout(500);

  // Máquina B loga como o Gerente
  await pageB.goto('http://localhost:3131/test.html');
  await pageB.waitForTimeout(300);
  await pageB.fill('#username', 'gerente');
  await pageB.fill('#password', 'senha1234');
  await pageB.click('#login-btn');
  await pageB.waitForSelector('#ws-status.connected');
  await pageB.waitForTimeout(300);

  const bComprasVisible = await pageB.locator('#compras-section').isVisible();
  const bFinanceiroVisible = await pageB.locator('#financeiro-section').isVisible();
  const bUsersVisible = await pageB.locator('#users-section').isVisible();
  check('gerente NÃO vê Compras nem Financeiro (não concedidos)', !bComprasVisible && !bFinanceiroVisible, `compras=${bComprasVisible} financeiro=${bFinanceiroVisible}`);
  check('gerente VÊ Usuários (permissão concedida)', bUsersVisible, bUsersVisible);

  // Gerente (via B) cadastra um "Estagiário" novo
  await pageB.fill('#new-user-nome', 'Estagiário');
  await pageB.fill('#new-user-username', 'estagiario');
  await pageB.fill('#new-user-password', 'senha1234');
  await pageB.click('#add-user-btn');
  await pageB.waitForTimeout(500);

  // Máquina A (admin) vê o Estagiário aparecer na lista, em tempo real
  await pageA.waitForTimeout(700);
  const aUserRows = await pageA.locator('#users-tbody tr').count();
  check('admin vê o "Estagiário" cadastrado pelo Gerente, em tempo real (3 usuários: admin+gerente+estagiario)', aUserRows === 3, aUserRows);

  // Log de auditoria do admin mostra os logins e cadastros
  await pageA.click('#audit-refresh-btn');
  await pageA.waitForTimeout(300);
  const auditRows = await pageA.locator('#audit-tbody tr').count();
  check('log de auditoria do admin tem várias entradas (logins + cadastros)', auditRows >= 4, auditRows);

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — USUÁRIOS/PERMISSÕES/LOG MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
