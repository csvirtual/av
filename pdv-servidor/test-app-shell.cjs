// Prova o app.js completo (Fase 9, último passo do roteiro): menu lateral
// com as rotas gated por permissão (16 desde que "empresa"/Dados da loja
// ganhou tela), timeout de inatividade (30min),
// trava de aba única (por terminal) e o achado de segurança no caminho —
// uma conta desativada continuava com sessão válida no servidor até o
// cookie expirar sozinho (12h), corrigido no middleware global
// (server.js).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-app-shell.cjs` noutra.
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

async function apiCall(page, path, opts = {}) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    data: opts.body,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // ---------- Sidebar: admin vê as 16 rotas (15 originais + "empresa", telas/company.js) ----------
  const adminLinks = await page.locator('.nav-link').evaluateAll((els) => els.map((e) => e.dataset.route));
  const expectedRoutes = ['dashboard', 'estoque', 'venda', 'vendas', 'caixa', 'clientes', 'carreto', 'compras', 'financeiro', 'relatorios', 'usuarios', 'logs', 'backup', 'empresa', 'personalizacao', 'ajuda'];
  check('Admin vê as 16 rotas no menu lateral', expectedRoutes.every((r) => adminLinks.includes(r)) && adminLinks.length === 16, adminLinks.join(','));

  // ---------- Vendedor sem NENHUMA permissão: só vê as rotas sem gate ----------
  const vendorRes = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Shell', username: 'vendedor.shell', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem permissões criado', vendorRes.status === 201, vendorRes.status);
  const vendorId = vendorRes.body.user.id;

  const browser2 = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page2 = await browser2.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(e.message));
  await login(page2, 'vendedor.shell', 'senhaVendedor1');

  const vendorLinks = await page2.locator('.nav-link').evaluateAll((els) => els.map((e) => e.dataset.route));
  const noGateRoutes = ['dashboard', 'estoque', 'venda', 'vendas', 'caixa', 'clientes', 'carreto', 'personalizacao', 'ajuda'];
  const gatedRoutes = ['compras', 'financeiro', 'relatorios', 'usuarios', 'logs', 'backup'];
  check('Vendedor sem permissão vê só as 9 rotas sem gate', noGateRoutes.every((r) => vendorLinks.includes(r)) && vendorLinks.length === 9, vendorLinks.join(','));
  check('Vendedor sem permissão NÃO vê nenhuma das 6 rotas gated no menu', gatedRoutes.every((r) => !vendorLinks.includes(r)), vendorLinks.join(','));

  // ---------- Vendedor navegando direto (deep-link) pra uma rota gated: a TELA renderiza normalmente ----------
  // De propósito SEM bloqueio de renderização aqui — mesmo padrão já
  // testado e estabelecido em relatorios.js/logs.js/financeiro.js/
  // backup.js (ver test-relatorios.cjs etc.): a proteção de verdade é
  // sempre no SERVIDOR, nunca escondendo a tela. O menu só decide o que
  // aparece na NAVEGAÇÃO, não o que a rota entrega se alguém já sabe o
  // link direto (ex: favorito salvo, ou só digitando o hash).
  await page2.evaluate(() => { location.hash = '#/backup'; });
  await page2.waitForTimeout(500);
  const deepLinkText = await page2.locator('#view-root').innerText();
  check('Deep-link direto pra #/backup sem permissão renderiza a tela normalmente (mesmo padrão de relatorios/logs/financeiro)', deepLinkText.includes('Exportar backup') && !deepLinkText.includes('não tem permissão'), deepLinkText.slice(0, 100));
  const exportAsUngatedVendor = await apiCall(page2, '/api/backup/export', { method: 'POST', body: JSON.stringify({ password: 'qualquerSenha1' }) });
  check('Mas a AÇÃO de verdade (exportar) continua barrada com 403 — o gate real é sempre no servidor', exportAsUngatedVendor.status === 403, exportAsUngatedVendor.status);

  // ---------- Admin concede permissão 'compras' — o LINK só aparece no menu no PRÓXIMO login (mesmo comportamento da extensão) ----------
  await apiCall(page, `/api/users/${vendorId}`, { method: 'PUT', body: JSON.stringify({ permissions: { compras: true } }) });
  await page2.evaluate(() => { location.hash = '#/dashboard'; });
  await page2.waitForTimeout(400);
  const vendorLinksAfterGrant = await page2.locator('.nav-link').evaluateAll((els) => els.map((e) => e.dataset.route));
  check('Link "Compras" ainda não aparece no MENU (só recalculado no próximo login — mesmo comportamento da extensão)', !vendorLinksAfterGrant.includes('compras'), vendorLinksAfterGrant.join(','));
  await apiCall(page, `/api/users/${vendorId}`, { method: 'PUT', body: JSON.stringify({ permissions: { compras: false } }) });

  // ---------- Achado corrigido: desativar a conta derruba a sessão já aberta ----------
  await apiCall(page, `/api/users/${vendorId}/ativo`, { method: 'POST', body: JSON.stringify({ active: false }) });
  const meAfterDeactivate = await apiCall(page2, '/api/auth/me');
  check('GET /api/auth/me com sessão de conta desativada devolve 401 (servidor barra sozinho, sem depender da tela)', meAfterDeactivate.status === 401, meAfterDeactivate.status);
  await page2.evaluate(() => { location.hash = '#/estoque'; });
  await page2.waitForTimeout(600);
  const backAtLogin = await page2.locator('#username').count();
  check('Aba da conta desativada volta pra tela de login sozinha na próxima navegação', backAtLogin === 1, backAtLogin);
  const writeAsDeactivated = await apiCall(page2, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7800000000001', name: 'Não deveria criar', category: 'material', unit: 'un', price: 1, costPrice: 1, minStock: 1 }),
  });
  check('Escrita via API com sessão de conta desativada também é recusada (401, não só a tela)', writeAsDeactivated.status === 401, writeAsDeactivated.status);

  await apiCall(page, `/api/users/${vendorId}/ativo`, { method: 'POST', body: JSON.stringify({ active: true }) });
  await browser2.close();

  // ---------- Timeout de inatividade: simula 30min sem tocar em nada ----------
  const browser3 = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page3 = await browser3.newPage();
  await login(page3, 'admin', 'admin123');
  await page3.waitForTimeout(400);
  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  await page3.evaluate((idleLimit) => {
    localStorage.setItem('session.lastActivityAt', String(Date.now() - idleLimit - 5000));
  }, IDLE_LIMIT_MS);
  // A checagem de inatividade roda a cada 30s (ver app.js) — espera até 35s por ela pegar o timestamp manipulado.
  await page3.waitForSelector('#username', { timeout: 35000 });
  check('Sessão expira sozinha depois de simular 30min sem atividade (checagem periódica, não precisa esperar 30min de verdade)', true, '');
  const auditIdle = await apiCall(page, '/api/audit?limit=10');
  check('Expiração por inatividade registrada no log de auditoria', auditIdle.body.items?.some((e) => e.action === 'Sessão expirada por inatividade'), auditIdle.body.items?.map((e) => e.action));
  await browser3.close();

  // ---------- Trava de aba única: duas ABAS do MESMO terminal (mesmo contexto/localStorage) ----------
  const context4 = await browser.newContext();
  const tabA = await context4.newPage();
  await login(tabA, 'admin', 'admin123');
  await tabA.waitForTimeout(600);
  const tabAHasSidebar = await tabA.locator('#sidebar').count();
  check('Aba A (primeira deste "terminal") roda o app normalmente', tabAHasSidebar === 1, tabAHasSidebar);

  const tabB = await context4.newPage();
  await tabB.goto(BASE);
  // A eleição de tabB precisa confirmar que tabA está mesmo viva antes de
  // decidir (PROBE_MS=2500ms em tabPresence.js) — espera folgado o
  // suficiente pra essa primeira rodada terminar.
  await tabB.waitForTimeout(3500);
  const tabBBlockedText = await tabB.locator('#root').innerText();
  check('Aba B (segunda aba do MESMO terminal) fica bloqueada', /já está aberto em outra janela|Já aberto em outra janela/i.test(tabBBlockedText), tabBBlockedText.slice(0, 150));
  const tabBHasSidebar = await tabB.locator('#sidebar').count();
  check('Aba B bloqueada não monta o app de verdade (sem sidebar)', tabBHasSidebar === 0, tabBHasSidebar);

  await tabA.close();
  // Sem a A batendo mais, B deve liberar sozinha em poucos segundos (STALE_MS/PROBE_MS de tabPresence.js).
  await tabB.waitForSelector('#sidebar', { timeout: 10000 });
  check('Fechando a aba A, a aba B libera sozinha (some o bloqueio) sem precisar recarregar', true, '');
  await context4.close();

  // ---------- Logout / idle-timeout limpam o listener de atividade corretamente em navegações seguidas (sem empilhar) ----------
  const context5 = await browser.newContext();
  const page5 = await context5.newPage();
  await login(page5, 'admin', 'admin123');
  for (let i = 0; i < 5; i++) {
    await page5.evaluate((route) => { location.hash = `#/${route}`; }, i % 2 === 0 ? 'estoque' : 'dashboard');
    await page5.waitForTimeout(200);
  }
  const finalHasSidebar = await page5.locator('#sidebar').count();
  check('Navegar repetidamente entre telas não quebra o shell (sidebar continua de pé)', finalHasSidebar === 1, finalHasSidebar);
  await context5.close();

  check('Zero erros JS/rede no fluxo principal (admin)', errors.length === 0, JSON.stringify(errors));
  check('Zero erros JS no fluxo do vendedor (segunda aba)', errors2.length === 0, JSON.stringify(errors2));

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
