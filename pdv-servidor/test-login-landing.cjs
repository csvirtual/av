// Prova a regra nova: todo login cai no Painel (nunca herda a última rota
// de quem usou este navegador por último — risco real quando as
// permissões são diferentes), exceto o PRIMEIRO login de verdade de um
// vendedor recém-cadastrado, que cai na Ajuda uma única vez (ver
// routes/auth.js#POST /login e app.js#renderLogin — achado do usuário).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-login-landing.cjs` noutra.
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

async function logout(page) {
  await page.click('#logout-btn');
  await page.waitForTimeout(200);
  // confirmDialog — confirma "Sair"
  await page.click('.modal [data-action="ok"]');
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });

  // ---------- Admin: login sempre cai no Painel ----------
  await login(page, 'admin', 'admin123');
  check('Admin: login cai no Painel', page.url().endsWith('#/dashboard'), page.url());

  // Admin cadastra um vendedor novo (sem nenhuma permissão extra) e navega
  // pra uma tela que esse vendedor NÃO vai poder acessar de verdade —
  // simula o cenário do achado do usuário: o navegador troca de mãos com
  // uma rota "presa" no hash.
  await page.goto(`${BASE}/#/usuarios`);
  await page.waitForTimeout(500);
  await page.click('#new-user-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Vendedor Novato');
  await page.fill('#f-username', 'novato1');
  await page.fill('#f-pass', 'senha123');
  await page.fill('#f-pass2', 'senha123');
  await page.click('.modal [data-action="submit"]');
  await page.waitForTimeout(600);

  // Admin navega pra Backup (rota que o vendedor novo não tem permissão
  // nenhuma pra usar) e sai sem voltar pro Painel — deixa o hash "sujo".
  await page.goto(`${BASE}/#/backup`);
  await page.waitForTimeout(500);
  await logout(page);
  check('Depois do logout, volta pra tela de login', await page.locator('#login-form').count() > 0);

  // ---------- Primeiro login do vendedor novo: cai na Ajuda ----------
  await login(page, 'novato1', 'senha123');
  check('Vendedor (1º login): cai na Ajuda, não herda #/backup do admin', page.url().endsWith('#/ajuda'), page.url());
  const helpText = await page.locator('#view-root').innerText();
  check('Tela realmente é a Ajuda (título "Ajuda" visível)', /Ajuda/.test(helpText));

  await logout(page);

  // ---------- Segundo login do MESMO vendedor: já não é mais "primeira vez" ----------
  await login(page, 'novato1', 'senha123');
  check('Vendedor (2º login): cai no Painel, não mais na Ajuda', page.url().endsWith('#/dashboard'), page.url());

  // Vendedor deixa o hash "sujo" também (numa rota que ele até acessa, pra
  // isolar: o que importa aqui é que o PRÓXIMO login não deve herdar isto).
  await page.goto(`${BASE}/#/estoque`);
  await page.waitForTimeout(400);
  await logout(page);

  // ---------- Admin loga de novo: não herda a rota do vendedor ----------
  await login(page, 'admin', 'admin123');
  check('Admin (login de novo): cai no Painel, não herda #/estoque do vendedor', page.url().endsWith('#/dashboard'), page.url());

  check('Zero erros JS/console inesperados', errors.length === 0, JSON.stringify(errors));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(passed === results.length ? 0 : 1);
})();
