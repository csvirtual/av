// Prova views/logs.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 15. Log do sistema com filtro
// por perfil/usuário/termo/data e paginação real via cursor de chave
// (timestamp, id) — a versão anterior de routes/audit.js#GET / carregava
// a tabela `audit_log` INTEIRA na memória a cada leitura (achado de
// auditoria corrigido neste passo, ver comentário da rota).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-logs.cjs` noutra.
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

// Abre o dropdown estilizado de um filtro (ver components/customSelect.js
// — o <select> nativo fica escondido, page.selectOption não serve) e
// escolhe a opção pelo texto visível.
async function pickCustomSelect(page, selectId, optionText) {
  await page.locator(`#${selectId} + button.custom-select-trigger`).click();
  await page.waitForTimeout(150);
  await page.locator('.custom-select-list.is-open .custom-select-option', { hasText: optionText }).click();
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push('console.error: ' + m.text()); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // Um vendedor com 'logs' (pra provar que a permissão é o que importa,
  // não o role) e um sem nenhuma permissão (pra provar o 403).
  const vendorWithLogs = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Com Logs', username: 'vendedor.com.logs', password: 'senhaVendedor1', permissions: { logs: true } }),
  });
  check('Vendedor com "logs" criado', vendorWithLogs.status === 201, vendorWithLogs.status);
  const vendorNoLogs = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Logs', username: 'vendedor.sem.logs', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem "logs" criado', vendorNoLogs.status === 201, vendorNoLogs.status);

  // Gera bastante entrada de log de verdade (cadastro de usuários acima já
  // gerou 2 pelo servidor... não, cadastro de usuário NÃO loga no servidor
  // por padrão — ver routes/users.js, que loga direto — então já tem
  // entradas). Gera mais algumas explícitas via POST /api/audit (mesmo
  // caminho que auditRepo.js#logAction usa) pra ter volume suficiente pra
  // provar paginação com "Carregar mais".
  for (let i = 0; i < 55; i++) {
    await apiCall(page, '/api/audit', {
      method: 'POST', body: JSON.stringify({ action: `Ação de teste ${i}`, details: `Detalhe da ação ${i}`, entity: 'test', entityId: String(i) }),
    });
  }

  // ---------- Fluxo real: lista, filtro por termo, paginação ----------
  await page.goto(`${BASE}/#/logs`);
  await page.waitForTimeout(700);
  let viewText = await page.locator('#view-root').innerText();
  check('Log do sistema carrega com registros (login + cadastros + as 55 ações de teste)', /registro\(s\)/i.test(viewText) && viewText.includes('Ação de teste 54'), viewText.slice(0, 300));
  check('Tem botão "Carregar mais" (mais de 50 registros no total)', viewText.includes('Carregar mais'));

  await page.click('#load-more-btn');
  await page.waitForTimeout(600);
  viewText = await page.locator('#view-root').innerText();
  check('Carregar mais soma a próxima página (mostra registros mais antigos, ex: "Ação de teste 0")', viewText.includes('Ação de teste 0') || viewText.includes('Ação de teste 4'), viewText.slice(0, 200));

  // ---------- Filtro por termo (busca em ação+detalhes) ----------
  await page.fill('#term-filter', 'Ação de teste 23');
  await page.waitForTimeout(500);
  viewText = await page.locator('#view-root').innerText();
  check('Filtro por termo isola só o registro que bate (ação 23, não 2 nem 3 nem outra)', viewText.includes('Ação de teste 23') && !viewText.includes('Ação de teste 24') && !viewText.includes('Ação de teste 22'), viewText.slice(0, 300));

  await page.fill('#term-filter', '');
  await page.waitForTimeout(500);

  // ---------- Filtro por perfil (dropdown customizado) ----------
  await pickCustomSelect(page, 'role-filter', 'Vendedor');
  viewText = await page.locator('#view-root').innerText();
  check('Filtro por perfil "Vendedor" não mostra nenhuma ação do Administrador (só logins/cadastros são do admin aqui)', !viewText.includes('Ação de teste'), viewText.slice(0, 300));
  await pickCustomSelect(page, 'role-filter', 'Todos os perfis');

  // ---------- Filtro por data ----------
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  await page.fill('#date-from', tomorrowStr);
  await page.waitForTimeout(500);
  viewText = await page.locator('#view-root').innerText();
  check('Filtro "De" amanhã não mostra nenhum registro (todos são de hoje)', viewText.includes('Nenhum registro encontrado'), viewText.slice(0, 200));
  await page.fill('#date-from', '');
  await page.waitForTimeout(500);

  check('Zero erros JS/rede durante o fluxo real (lista/carregar mais/filtros)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversária: paginação de verdade no servidor (não carrega tudo) ----------
  const firstPage = await apiCall(page, '/api/audit?limit=10');
  check('Primeira página respeita o limit (10 itens)', firstPage.body.items.length === 10, firstPage.body.items.length);
  check('Primeira página sinaliza hasMore (tem mais que 10 no total)', firstPage.body.hasMore === true, firstPage.body.hasMore);
  check('Primeira página devolve nextKey/nextId pra continuar', firstPage.body.nextKey != null && firstPage.body.nextId != null, JSON.stringify({ nextKey: firstPage.body.nextKey, nextId: firstPage.body.nextId }));

  const secondPage = await apiCall(page, `/api/audit?limit=10&afterKey=${firstPage.body.nextKey}&afterId=${firstPage.body.nextId}`);
  check('Segunda página (cursor) não repete nenhum item da primeira', secondPage.body.items.every((i) => !firstPage.body.items.some((f) => f.id === i.id)), JSON.stringify(secondPage.body.items.map((i) => i.id)));
  check('Segunda página tem itens mais antigos que o cursor (timestamp <= nextKey da primeira)', secondPage.body.items.every((i) => i.timestamp <= firstPage.body.nextKey), true);

  // ---------- Adversária: gate de permissão — vendedor COM 'logs' funciona, SEM 'logs' toma 403 ----------
  const vendorWithLogsLogin = await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.com.logs', password: 'senhaVendedor1' }) });
  check('Login do vendedor com "logs" funciona', vendorWithLogsLogin.status === 200, vendorWithLogsLogin.status);
  const vendorWithLogsRead = await apiCall(page, '/api/audit?limit=5');
  check('Vendedor COM "logs" consegue ler o log (permissão delegada funciona, não é exclusivo de admin)', vendorWithLogsRead.status === 200, vendorWithLogsRead.status);

  const vendorNoLogsLogin = await apiCall(page, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'vendedor.sem.logs', password: 'senhaVendedor1' }) });
  check('Login do vendedor sem "logs" funciona', vendorNoLogsLogin.status === 200, vendorNoLogsLogin.status);
  const vendorNoLogsRead = await apiCall(page, '/api/audit?limit=5');
  check('Vendedor SEM "logs" toma 403 tentando ler o log', vendorNoLogsRead.status === 403, vendorNoLogsRead.status);

  // POST em /api/audit continua aberto a qualquer autenticado (é só o
  // registro de uma ação que já passou pelo gate certo em outro lugar).
  const vendorNoLogsCanStillLog = await apiCall(page, '/api/audit', { method: 'POST', body: JSON.stringify({ action: 'Ação de um vendedor qualquer', details: '' }) });
  check('Vendedor SEM "logs" ainda consegue GRAVAR uma entrada (POST não exige a permissão, só GET)', vendorNoLogsCanStillLog.status === 201, vendorNoLogsCanStillLog.status);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
