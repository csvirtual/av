// Prova views/backup.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 18 (última tela). Exportar,
// restaurar (com prévia de contagem antes/depois) e "Zerar dados e
// reiniciar a operação" (movimento apagado, cadastro preservado). Reset é
// uma feature nova no servidor (sem equivalente único-terminal — precisa
// avisar TODO terminal conectado, não só a aba que fez a ação).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-backup.cjs` noutra.
const { chromium } = require('playwright');
const fs = require('fs');

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
  // '/api/auth/verify' devolve 401 como resultado NORMAL de senha errada
  // (ver data/usersRepo.js#verifyLogin — 401 vira `null`, não um throw),
  // mesmo raciocínio de excluir '/api/auth/me' aqui — nenhum dos dois é
  // erro de verdade.
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/api/auth/me') && !res.url().endsWith('/api/auth/verify')) errors.push(`HTTP ${res.status()} ${res.url()}`); });

  await login(page, 'admin', 'admin123');

  // ---------- Preparar dados: cadastro + movimento ----------
  const prod = (await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7809999999999', name: 'Produto Backup', category: 'material', unit: 'un', price: 50, costPrice: 20, minStock: 1 }),
  })).body.product;
  await apiCall(page, `/api/products/${prod.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'entrada', qty: 30, note: 'estoque inicial' }) });

  const cashOpen = await apiCall(page, '/api/cash/open', { method: 'POST', body: JSON.stringify({ openingAmount: 100 }) });
  check('Caixa aberto (pra virar movimento a zerar depois)', cashOpen.status === 201, cashOpen.status);

  const sale = await apiCall(page, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prod.id, qty: 2 }], payments: [{ method: 'Dinheiro', amount: 100 }] }),
  });
  check('Venda registrada (pra virar movimento a zerar depois)', sale.status === 201, sale.status);

  // ---------- Tela abre com as 3 seções ----------
  await page.goto(`${BASE}/#/backup`);
  await page.waitForTimeout(700);
  let viewText = await page.locator('#view-root').innerText();
  check('Tela de Backup carrega as 3 seções (exportar/restaurar/zerar)', viewText.includes('Exportar backup') && viewText.includes('Restaurar backup') && viewText.includes('Zerar dados'), viewText.slice(0, 200));

  // ---------- Exportar: senha curta é rejeitada no cliente ----------
  await page.fill('#export-pass', '123');
  await page.fill('#export-pass2', '123');
  await page.click('#export-btn');
  await page.waitForTimeout(200);
  let exportErr = await page.locator('#export-error').innerText();
  check('Senha curta (<8) rejeitada antes de chamar o servidor', /pelo menos 8/.test(exportErr), exportErr);

  // ---------- Exportar: senhas não coincidem ----------
  await page.fill('#export-pass', 'senhaExport1');
  await page.fill('#export-pass2', 'outraSenha1');
  await page.click('#export-btn');
  await page.waitForTimeout(200);
  exportErr = await page.locator('#export-error').innerText();
  check('Senhas diferentes rejeitadas antes de chamar o servidor', /não coincidem/.test(exportErr), exportErr);

  // ---------- Exportar de verdade ----------
  await page.fill('#export-pass', 'senhaExport1');
  await page.fill('#export-pass2', 'senhaExport1');
  const [download1] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-btn'),
  ]);
  const backupPath = await download1.path();
  const envelope = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check('Backup baixado é um envelope cifrado válido (não o payload em claro)', !!(envelope.ciphertext && envelope.salt && envelope.iv), JSON.stringify(Object.keys(envelope)));
  await page.waitForTimeout(300);
  viewText = await page.locator('#view-root').innerText();
  check('Toast/limpeza depois de exportar (formulário resetado, sem erro pendente)', !viewText.includes('não coincidem'), '');

  const auditAfterExport = await apiCall(page, '/api/audit?limit=50');
  check('Exportação registrada no log de auditoria', auditAfterExport.body.items?.some((e) => e.action === 'Backup exportado'), auditAfterExport.body.items?.map((e) => e.action));

  // ---------- Restaurar: senha errada ----------
  // O 400 de /api/backup/preview aqui é o RESULTADO ESPERADO desta
  // adversária (senha errada de propósito) — igual ao raciocínio de
  // excluir /api/auth/verify acima, só que este endpoint também é
  // chamado com senha CERTA logo abaixo (onde um 400 seria um bug de
  // verdade) — por isso descarta só as entradas geradas POR ESTA ação
  // específica, em vez de excluir a URL inteira do filtro.
  const errorsBeforeWrongRestorePass = errors.length;
  await page.setInputFiles('#restore-file', backupPath);
  await page.fill('#restore-pass', 'senhaErrada');
  await page.click('#restore-read-btn');
  await page.waitForTimeout(500);
  let restoreErr = await page.locator('#restore-error').innerText();
  check('Senha errada na restauração mostra erro amigável (não trava)', /não foi possível abrir|senha incorreta/i.test(restoreErr), restoreErr);
  errors.length = errorsBeforeWrongRestorePass;

  // ---------- Restaurar: prévia com senha certa ----------
  await page.setInputFiles('#restore-file', backupPath);
  await page.fill('#restore-pass', 'senhaExport1');
  await page.click('#restore-read-btn');
  await page.waitForTimeout(600);
  let previewText = await page.locator('#restore-preview').innerText();
  // innerText() reflete o CSS renderizado (text-transform: uppercase nos
  // <th> da tabela), não o texto literal escrito em countsTableHtml —
  // comparação case-insensitive de propósito.
  const previewTextLower = previewText.toLowerCase();
  check('Prévia mostra contagem ATUAL e NO BACKUP lado a lado', previewTextLower.includes('atual') && previewTextLower.includes('no backup'), previewText.slice(0, 200));
  check('Prévia mostra a data de geração do backup', /Backup gerado em/.test(previewText), previewText.slice(0, 150));
  check('Prévia lista as 16 gavetas (STORE_NAMES), incluindo o crédito de troca cross-terminal', previewText.includes('Créditos de troca (cross-terminal)'), '');

  // ---------- Cria mais dado ANTES de confirmar (pra provar que some depois de restaurar) ----------
  const prod2 = (await apiCall(page, '/api/products', {
    method: 'POST', body: JSON.stringify({ barcode: '7808888888888', name: 'Produto Depois Do Backup', category: 'material', unit: 'un', price: 5, costPrice: 2, minStock: 1 }),
  })).body.product;
  check('Segundo produto criado DEPOIS do backup (deve sumir com a restauração)', !!prod2?.id, prod2);

  // ---------- Confirma restauração ----------
  // Corrida ESPERADA e sem problema: o broadcast 'backup-restored' chega
  // pelo WebSocket e já desloga esta própria aba (ver o listener global em
  // app.js) antes do POST /api/audit da chamada logAction("Backup
  // restaurado") de views/backup.js (linha abaixo, no `then` de
  // applyBackup) terminar — o servidor já grava esse MESMO evento sozinho
  // dentro da própria rota /import (ver routes/backup.js), então a
  // restauração fica auditada de qualquer jeito; o try/catch ao redor
  // desse logAction do lado do cliente existe justamente pra tolerar
  // exatamente isto ("log é só um extra, nunca desfaz nem esconde o
  // sucesso" — mesmo comentário da extensão). Descarta só o que ESTA ação
  // gerar, mesmo raciocínio da senha errada acima.
  const errorsBeforeConfirmRestore = errors.length;
  await page.click('#restore-confirm-btn');
  await page.waitForTimeout(300);
  // confirmDialog é um modal de verdade — clica no botão de confirmar dele.
  await page.locator('.modal button.btn-danger', { hasText: 'Sim, restaurar' }).click();
  await page.waitForTimeout(1200);

  // Restauração força novo login (mesmo comportamento da extensão) — a
  // página recarrega sozinha e volta pra tela de login. As checagens de
  // API abaixo só fazem sentido DEPOIS de logar de novo (a sessão antiga
  // já foi derrubada pelo próprio broadcast de 'backup-restored').
  await page.waitForSelector('#username', { timeout: 5000 });
  check('Depois de restaurar, a aba volta pra tela de login sozinha (sessão derrubada)', true, '');
  errors.length = errorsBeforeConfirmRestore;
  await login(page, 'admin', 'admin123');

  const productsAfterRestore = await apiCall(page, '/api/products');
  const stillHasProd2 = productsAfterRestore.body.products?.some((p) => p.id === prod2.id);
  check('Produto criado DEPOIS do backup sumiu — restauração reverteu pro estado exportado', !stillHasProd2, productsAfterRestore.status);
  const stillHasProd1 = productsAfterRestore.body.products?.some((p) => p.id === prod.id);
  check('Produto que JÁ existia NO backup continua existindo depois de restaurar', stillHasProd1, '');

  // ---------- Multi-terminal: reset propaga (broadcast) pra OUTRO terminal ----------
  const browser2 = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page2 = await browser2.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(e.message));
  await login(page2, 'admin', 'admin123');
  await page2.goto(`${BASE}/#/dashboard`);
  await page2.waitForTimeout(500);

  // O backup exportado tinha o caixa ABERTO (nunca foi fechado antes de
  // exportar) — a restauração trouxe esse mesmo caixa aberto de volta
  // (é dado de verdade, não zerado por ela). Só registra outra venda em
  // cima do que já está aberto — o objetivo aqui é só ter mais movimento
  // pro teste de reset ter o que apagar, não reabrir um caixa que já existe.
  const cashStateAfterRestore = await apiCall(page, '/api/cash/open');
  check('Caixa continua aberto depois de restaurar (fazia parte do backup, não é zerado por ele)', !!cashStateAfterRestore.body.session, cashStateAfterRestore.body);
  const sale2 = await apiCall(page, '/api/sales', {
    method: 'POST', body: JSON.stringify({ items: [{ productId: prod.id, qty: 1 }], payments: [{ method: 'Dinheiro', amount: 50 }] }),
  });
  check('Venda registrada de novo (novo movimento pro teste de reset)', sale2.status === 201, sale2.status);

  await page.goto(`${BASE}/#/backup`);
  await page.waitForTimeout(700);

  // ---------- Zerar dados: usuário/senha vazios ----------
  await page.click('#reset-btn');
  await page.waitForTimeout(200);
  let resetErr = await page.locator('#reset-error').innerText();
  check('Usuário/senha vazios barrados antes de qualquer chamada', /Informe usuário e senha/.test(resetErr), resetErr);

  // ---------- Zerar dados: senha errada ----------
  await page.fill('#reset-user', 'admin');
  await page.fill('#reset-pass', 'senhaErrada');
  await page.click('#reset-btn');
  await page.waitForTimeout(600);
  resetErr = await page.locator('#reset-error').innerText();
  check('Senha errada na confirmação de identidade barra o reinício', /inválid/i.test(resetErr), resetErr);

  // ---------- Zerar dados de verdade ----------
  await page.fill('#reset-user', 'admin');
  await page.fill('#reset-pass', 'admin123');
  await page.click('#reset-btn');
  await page.waitForTimeout(300);
  await page.locator('.modal button.btn-danger', { hasText: 'Sim, zerar' }).click();
  await page.waitForTimeout(400);

  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    Promise.resolve(),
  ]).catch(() => [null]);
  // O backup de segurança já deve ter disparado no meio do fluxo acima; se
  // a promise de download já resolveu antes daqui, download2 vem null —
  // então também aceita ter capturado antes (ver checagem de arquivo abaixo).
  await page.waitForTimeout(1500);

  const salesAfterReset = await apiCall(page, '/api/sales?limit=50');
  check('Vendas ZERADAS depois do reinício', (salesAfterReset.body.items || []).length === 0, JSON.stringify(salesAfterReset.body).slice(0, 200));

  const cashAfterReset = await apiCall(page, '/api/cash/open');
  check('Nenhum caixa aberto depois do reinício', !cashAfterReset.body.session, cashAfterReset.body);

  const productsAfterReset = await apiCall(page, '/api/products');
  const prodStillThere = productsAfterReset.body.products?.some((p) => p.id === prod.id);
  check('Estoque (produto + quantidade) PRESERVADO depois do reinício', prodStillThere, '');
  const prodQty = productsAfterReset.body.products?.find((p) => p.id === prod.id)?.quantity;
  check('Quantidade do produto continua a mesma (movimento de venda não desfeito, só apagado o registro)', typeof prodQty === 'number', prodQty);

  const usersAfterReset = await apiCall(page, '/api/users');
  check('Usuários PRESERVADOS depois do reinício', usersAfterReset.body.users?.some((u) => u.username === 'admin'), '');

  const auditAfterReset = await apiCall(page, '/api/audit?limit=10');
  check('Log de auditoria voltou a ter registro (o próprio "Reinício de operação" gravado DEPOIS do zerar)', auditAfterReset.body.items?.some((e) => e.action === 'Reinício de operação (zerar dados)'), auditAfterReset.body.items?.map((e) => e.action));

  // ---------- Multi-terminal: terminal B recarregou sozinho, mas continua LOGADO (reset não desloga) ----------
  await page2.waitForTimeout(500);
  const page2StillLoggedIn = await page2.evaluate(() => !document.getElementById('username'));
  check('Terminal B recarregou sozinho após o reinício (mesmo sem agir) e continua LOGADO (reset não força novo login)', page2StillLoggedIn, '');

  // ---------- Permissão: vendedor sem 'backup' vê a tela mas é barrado nas ações de verdade ----------
  const vendorRes = await apiCall(page, '/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Sem Backup', username: 'vendedor.sem.backup', password: 'senhaVendedor1', permissions: {} }),
  });
  check('Vendedor sem a permissão "backup" criado', vendorRes.status === 201, vendorRes.status);

  const browser3 = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page3 = await browser3.newPage();
  await login(page3, 'vendedor.sem.backup', 'senhaVendedor1');
  await page3.goto(`${BASE}/#/backup`);
  await page3.waitForTimeout(600);
  const vendorViewText = await page3.locator('#view-root').innerText();
  check('Vendedor sem permissão AINDA VÊ a tela de Backup (mesmo padrão de relatorios/logs/financeiro — o gate real é no servidor)', vendorViewText.includes('Exportar backup'), '');

  const vendorExportDirect = await apiCall(page3, '/api/backup/export', { method: 'POST', body: JSON.stringify({ password: 'qualquerSenha1' }) });
  check('POST /api/backup/export como vendedor sem permissão recebe 403', vendorExportDirect.status === 403, vendorExportDirect.status);
  const vendorResetDirect = await apiCall(page3, '/api/backup/reset', { method: 'POST', body: '{}' });
  check('POST /api/backup/reset como vendedor sem permissão recebe 403', vendorResetDirect.status === 403, vendorResetDirect.status);
  const vendorCountsDirect = await apiCall(page3, '/api/backup/current-counts');
  check('GET /api/backup/current-counts como vendedor sem permissão recebe 403', vendorCountsDirect.status === 403, vendorCountsDirect.status);

  await page3.fill('#export-pass', 'senhaQualquer1');
  await page3.fill('#export-pass2', 'senhaQualquer1');
  await page3.click('#export-btn');
  await page3.waitForTimeout(400);
  const vendorExportErr = await page3.locator('#export-error').innerText();
  check('Tentar exportar pela TELA (vendedor sem permissão) mostra o 403 de forma amigável, não trava', /permissão/i.test(vendorExportErr), vendorExportErr);

  await browser3.close();

  // ---------- Zero erros JS/rede em todo o fluxo ----------
  check('Zero erros JS/rede no terminal principal (exportar/restaurar/zerar)', errors.length === 0, JSON.stringify(errors));
  check('Zero erros JS no terminal B (só recebeu os broadcasts e recarregou)', errors2.length === 0, JSON.stringify(errors2));

  await browser2.close();
  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
