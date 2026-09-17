// Prova views/personalizacao.js e views/ajuda.js (copiadas sem alteração
// da extensão) contra o servidor multi-terminal — Fase 9, passo 17.
// Personalização: preferência de tema (claro/escuro/automático) por
// NAVEGADOR (localStorage, nunca no servidor — é escolha "deste
// computador", não da loja). Ajuda: conteúdo estático com busca — só
// precisa de ctx.company (com fallback seguro, já que o servidor ainda
// não tem "Dados da loja" portado).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-personalizacao-ajuda.cjs` noutra.
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

  // ---------- Personalização: tema padrão, trocar, persistir ----------
  await page.goto(`${BASE}/#/personalizacao`);
  await page.waitForTimeout(600);
  let viewText = await page.locator('#view-root').innerText();
  check('Tela abre com "Automático" selecionado por padrão', /Automático[\s\S]{0,60}Selecionado/.test(viewText), viewText.slice(0, 300));
  let dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Sem preferência salva, <html> não tem data-theme (deixa o @media decidir)', dataTheme === null, dataTheme);

  await page.click('[data-theme-option="dark"]');
  await page.waitForTimeout(300);
  dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Selecionar "Escuro" aplica data-theme="dark" na hora', dataTheme === 'dark', dataTheme);
  viewText = await page.locator('#view-root').innerText();
  check('Card "Escuro" mostra "Selecionado" depois de escolhido', /Escuro[\s\S]{0,60}Selecionado/.test(viewText), viewText.slice(0, 300));

  const storedValue = await page.evaluate(() => localStorage.getItem('theme.preference'));
  check('Preferência gravada em localStorage (não em cookie/servidor — é só deste navegador)', storedValue === 'dark', storedValue);

  await page.reload();
  await page.waitForTimeout(700);
  dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Tema persiste depois de recarregar a página (sem novo login)', dataTheme === 'dark', dataTheme);

  await page.click('[data-theme-option="light"]');
  await page.waitForTimeout(300);
  dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Selecionar "Claro" muda pra data-theme="light"', dataTheme === 'light', dataTheme);

  await page.click('[data-theme-option="system"]');
  await page.waitForTimeout(300);
  dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Voltar pra "Automático" remove o atributo data-theme de novo', dataTheme === null, dataTheme);

  // ---------- Ajuda: conteúdo estático, tópicos, busca ----------
  await page.goto(`${BASE}/#/ajuda`);
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Tela de Ajuda carrega com a lista de tópicos', viewText.includes('Primeiros passos') && viewText.includes('Perguntas frequentes'), viewText.slice(0, 300));

  await page.fill('#help-search-input', 'fiado');
  await page.waitForTimeout(400);
  const searchVisible = await page.locator('#help-search-results').isVisible();
  check('Busca por "fiado" mostra resultados (tópicos + FAQ)', searchVisible, searchVisible);
  const searchText = await page.locator('#help-search-results').innerText();
  check('Resultado da busca inclui a pergunta certa do FAQ sobre fiado', /vender fiado/i.test(searchText), searchText.slice(0, 300));

  await page.fill('#help-search-input', 'termo-que-nao-existe-em-lugar-nenhum-xyz');
  await page.waitForTimeout(400);
  const noResultsText = await page.locator('#help-search-results').innerText();
  check('Busca sem nenhum resultado mostra aviso de "nada encontrado" (não trava nem some)', /nenhum resultado|nada encontrado|não encontr/i.test(noResultsText), noResultsText.slice(0, 200));

  check('Zero erros JS/rede durante o fluxo real (tema/persistência/busca de ajuda)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversária: as duas telas não exigem permissão nenhuma (qualquer logado acessa) ----------
  const vendorRes = await page.request.fetch(`${BASE}/api/users`, {
    method: 'POST', data: JSON.stringify({ nome: 'Vendedor Sem Permissoes', username: 'vendedor.sem.permissoes', password: 'senhaVendedor1', permissions: {} }),
    headers: { 'Content-Type': 'application/json' },
  });
  check('Vendedor sem NENHUMA permissão criado', vendorRes.status() === 201, vendorRes.status());

  const browser2 = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page2 = await browser2.newPage();
  await login(page2, 'vendedor.sem.permissoes', 'senhaVendedor1');
  await page2.goto(`${BASE}/#/personalizacao`);
  await page2.waitForTimeout(600);
  const vendorPersView = await page2.locator('#view-root').innerText();
  check('Vendedor sem NENHUMA permissão ainda acessa Personalização (roles: admin+vendedor, sem permission própria)', vendorPersView.includes('Aparência'), vendorPersView.slice(0, 200));

  await page2.goto(`${BASE}/#/ajuda`);
  await page2.waitForTimeout(600);
  const vendorAjudaView = await page2.locator('#view-root').innerText();
  check('Vendedor sem NENHUMA permissão ainda acessa Ajuda (mesmo raciocínio)', vendorAjudaView.includes('Primeiros passos'), vendorAjudaView.slice(0, 200));
  await browser2.close();

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
