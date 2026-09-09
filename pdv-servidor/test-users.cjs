// Prova views/users.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 11. Cobre cadastro/edição/
// inativação de vendedor, redefinição de senha, e a checagem mais séria
// deste lote: um achado de segurança real (não só de forma) encontrado ao
// portar esta tela — faltava, no servidor, a mesma trava contra
// escalonamento de privilégio que a extensão já tinha em
// resetUserPassword.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-users.cjs` noutra.
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

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // ---------- Admin aparece na lista, sem botão de editar/desativar ----------
  await page.goto(`${BASE}/#/usuarios`);
  await page.waitForTimeout(600);
  let listText = await page.locator('#view-root').innerText();
  check('Administrador aparece na lista', listText.includes('admin') && /ADMINISTRADOR/i.test(listText));

  // ---------- Cadastro de vendedor ----------
  await page.click('button:has-text("+ Novo vendedor")');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Vendedor Teste Users');
  await page.fill('#f-username', 'vendedor.teste.users');
  await page.fill('#f-pass', 'senha123');
  await page.fill('#f-pass2', 'senha123');
  await page.check('[data-perm="deleteCustomer"]');
  await page.click('.modal button:has-text("Cadastrar vendedor")');
  await page.waitForTimeout(600);

  listText = await page.locator('#view-root').innerText();
  check('Vendedor recém-cadastrado aparece na lista (VENDEDOR, ATIVO)', listText.includes('Vendedor Teste Users') && /VENDEDOR/i.test(listText), listText.slice(0, 300));

  // ---------- Edição: muda nome + tira a permissão ----------
  await page.click('tr:has-text("Vendedor Teste Users") [data-edit]');
  await page.waitForTimeout(300);
  await page.fill('#f-nome', 'Vendedor Teste Users (editado)');
  await page.click('.modal button:has-text("Salvar")');
  await page.waitForTimeout(600);
  listText = await page.locator('#view-root').innerText();
  check('Edição de nome reflete na lista', listText.includes('Vendedor Teste Users (editado)'));

  // ---------- Desativar / reativar ----------
  // toggleUser() envolve a ação num confirmDialog() com o MESMO texto do
  // botão que disparou (ver views/users.js) — o botão de confirmação e o
  // de origem coexistem no DOM (modais grudam em document.body), então um
  // clique por texto ficaria ambíguo; clica o gatilho por atributo e a
  // confirmação por [data-action="ok"], mesmo padrão já usado pro fluxo de
  // cancelamento de carreto.js.
  await page.click('tr:has-text("Vendedor Teste Users (editado)") [data-toggle]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);
  let row = await page.locator('tr', { hasText: 'Vendedor Teste Users (editado)' }).innerText();
  check('Desativar vendedor muda o status pra INATIVO', /INATIVO/i.test(row), row);
  await page.click('tr:has-text("Vendedor Teste Users (editado)") [data-toggle]');
  await page.waitForTimeout(300);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(600);
  row = await page.locator('tr', { hasText: 'Vendedor Teste Users (editado)' }).innerText();
  check('Reativar volta o status pra ATIVO', /\bATIVO\b/i.test(row) && !/INATIVO/i.test(row), row);

  // ---------- Redefinir senha, confirma que a nova senha funciona ----------
  await page.click('tr:has-text("Vendedor Teste Users (editado)") [data-reset]');
  await page.waitForTimeout(300);
  await page.fill('#f-pass', 'novaSenha123');
  await page.fill('#f-pass2', 'novaSenha123');
  await page.click('.modal button:has-text("Redefinir senha")');
  await page.waitForTimeout(600);

  check('Zero erros JS/rede durante o fluxo real (cadastro/edição/senha)', errors.length === 0, JSON.stringify(errors));

  const ctxV = await browser.newContext();
  const vendorPage = await ctxV.newPage();
  await login(vendorPage, 'vendedor.teste.users', 'novaSenha123');
  const vendorHome = await vendorPage.locator('#view-root').innerText().catch(() => null);
  check('Login com a senha redefinida funciona de verdade', vendorHome !== null && !vendorHome.includes('Entrar'), vendorHome?.slice(0, 60));
  await ctxV.close();

  // ---------- Adversário: servidor rejeita senha curta, mesmo passando da UI ----------
  const shortPasswordResult = await page.evaluate(async () => {
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ nome: 'Tentativa Senha Curta', username: 'tentativa.senha.curta', password: '123', permissions: {} }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  });
  check('Servidor rejeita senha de cadastro com menos de 6 caracteres', shortPasswordResult.status >= 400 && /pelo menos 6/i.test(shortPasswordResult.body.error || ''), JSON.stringify(shortPasswordResult));

  // ---------- Achado de segurança: escalonamento de privilégio no reset de senha ----------
  // Vendedor A tem 'deleteCustomer' (um poder que B não tem) + 'usuarios'
  // (só pra poder logar e ver a tela — precisa da permissão de acesso
  // normal). Vendedor B só tem 'usuarios'. Sem a trava corrigida em
  // routes/users.js, B conseguiria redefinir a senha de A e, a partir daí,
  // logar como A e herdar 'deleteCustomer' — um poder que B nunca teve.
  const setupResult = await page.evaluate(async () => {
    const resA = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ nome: 'Vendedor A (mais poder)', username: 'vendedor.a.escalada', password: 'senhaVendedorA', permissions: { deleteCustomer: true, usuarios: true } }),
    });
    const resB = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ nome: 'Vendedor B (menos poder)', username: 'vendedor.b.escalada', password: 'senhaVendedorB', permissions: { usuarios: true } }),
    });
    const userA = (await resA.json()).user;
    return { userAId: userA.id, resAStatus: resA.status, resBStatus: resB.status };
  });
  check('Setup: Vendedor A (deleteCustomer+usuarios) e Vendedor B (só usuarios) criados', setupResult.resAStatus === 201 && setupResult.resBStatus === 201, JSON.stringify(setupResult));

  const escalationAttempt = await page.evaluate(async (userAId) => {
    // Troca a sessão desta mesma aba pra Vendedor B.
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ username: 'vendedor.b.escalada', password: 'senhaVendedorB' }),
    });
    const res = await fetch(`/api/users/${userAId}/redefinir-senha`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ newPassword: 'senhaRoubadaPorB' }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, setupResult.userAId);
  check(
    'Servidor IMPEDE Vendedor B (menos poder) de redefinir a senha de Vendedor A (mais poder) — sem essa trava, B herdaria deleteCustomer logando como A',
    escalationAttempt.status >= 400 && /mais poderes que você/i.test(escalationAttempt.body.error || ''),
    JSON.stringify(escalationAttempt),
  );

  // Confirma que a senha de A NÃO mudou (a tentativa de B realmente não gravou nada).
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
  });
  const ctxCheckA = await browser.newContext();
  const checkAPage = await ctxCheckA.newPage();
  await login(checkAPage, 'vendedor.a.escalada', 'senhaVendedorA');
  const stillOriginalPassword = await checkAPage.locator('#view-root').innerText().catch(() => null);
  check('Senha original de Vendedor A continua funcionando (o ataque não gravou nada)', stillOriginalPassword !== null && !stillOriginalPassword.includes('Entrar'), stillOriginalPassword?.slice(0, 60));
  await ctxCheckA.close();

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
