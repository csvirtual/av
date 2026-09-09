// Testa public/js/data/suppliersRepo.js e auditRepo.js isolados, contra
// um servidor de verdade em localhost:3131 — sem depender de nenhuma tela
// real. Mesmo espírito de test-products-repo.cjs: validação na fonte,
// permissão re-conferida no servidor (inclusive a leitura x escrita terem
// gates DIFERENTES, o achado real desta dupla), e nunca confiar em
// identidade que o cliente afirma ser a sua.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-suppliers-audit-repo.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function rawApi(page, path, opts = {}) {
  return page.evaluate(async ([p, o]) => {
    const res = await fetch(p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }, [path, opts]);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/test-suppliers-audit-repo.html`);
  await admin.evaluate(() => window.__login('admin', 'admin123'));

  const semCompras = await rawApi(admin, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Sem Compras', username: 'semcompras', password: 'senha1234', permissions: {} }),
  });
  check('seed: vendedor sem "compras" nem "logs" criado', semCompras.status === 201, JSON.stringify(semCompras.body));

  const comCompras = await rawApi(admin, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Com Compras', username: 'comcompras', password: 'senha1234', permissions: { compras: true } }),
  });
  check('seed: vendedor com "compras" (mas sem "logs") criado', comCompras.status === 201, JSON.stringify(comCompras.body));
  const comComprasId = comCompras.body.user.id;

  const semComprasCtx = await browser.newContext();
  const semComprasPage = await semComprasCtx.newPage();
  await semComprasPage.goto(`${BASE}/test-suppliers-audit-repo.html`);
  await semComprasPage.evaluate(() => window.__login('semcompras', 'senha1234'));

  const comComprasCtx = await browser.newContext();
  const comComprasPage = await comComprasCtx.newPage();
  await comComprasPage.goto(`${BASE}/test-suppliers-audit-repo.html`);
  await comComprasPage.evaluate(() => window.__login('comcompras', 'senha1234'));

  // ---------- suppliersRepo: CRUD básico ----------

  const initialList = await admin.evaluate(() => window.__suppliersRepo.listSuppliers());
  check('listSuppliers() começa vazio', initialList.length === 0, initialList.length);

  const noName = await admin.evaluate(() => window.__suppliersRepo.createSupplier({ telefone: '71988887777' }).catch((e) => ({ __error: e.message })));
  check('createSupplier sem nome é rejeitado', noName.__error === 'Nome do fornecedor é obrigatório.', JSON.stringify(noName));

  const fornecedor = await admin.evaluate(() => window.__suppliersRepo.createSupplier({ nome: 'Depósito Central', telefone: '71988887777', email: 'contato@deposito.com' }));
  check('createSupplier cria com sucesso', fornecedor.nome === 'Depósito Central' && fornecedor.active === true, JSON.stringify(fornecedor));

  const gotById = await admin.evaluate((id) => window.__suppliersRepo.getSupplier(id), fornecedor.id);
  check('getSupplier(id) devolve o fornecedor certo', gotById?.id === fornecedor.id, gotById?.id);

  const gotMissing = await admin.evaluate(() => window.__suppliersRepo.getSupplier('id-que-nao-existe'));
  check('getSupplier(id inexistente) devolve null, NUNCA lança erro (purchasesRepo.js depende disto)', gotMissing === null, gotMissing);

  const updated = await admin.evaluate((id) => window.__suppliersRepo.updateSupplier(id, { telefone: '71999998888' }), fornecedor.id);
  check('updateSupplier altera só o campo mandado', updated.telefone === '71999998888' && updated.nome === 'Depósito Central', updated.telefone);

  const deactivated = await admin.evaluate((id) => window.__suppliersRepo.setSupplierActive(id, false), fornecedor.id);
  check('setSupplierActive(id, false) desativa', deactivated.active === false, deactivated.active);
  const reactivated = await admin.evaluate((id) => window.__suppliersRepo.setSupplierActive(id, true), fornecedor.id);
  check('setSupplierActive(id, true) reativa', reactivated.active === true, reactivated.active);

  // ---------- suppliersRepo: leitura aberta, escrita gated por "compras" ----------

  const listAsSemCompras = await semComprasPage.evaluate(() => window.__suppliersRepo.listSuppliers());
  check('vendedor SEM "compras" ainda pode listar fornecedores (Estoque precisa disso pro fornecedor padrão)', listAsSemCompras.length === 1, listAsSemCompras.length);

  const getAsSemCompras = await semComprasPage.evaluate((id) => window.__suppliersRepo.getSupplier(id), fornecedor.id);
  check('vendedor SEM "compras" ainda pode ver um fornecedor específico', getAsSemCompras?.id === fornecedor.id, getAsSemCompras?.id);

  const createDenied = await semComprasPage.evaluate(() => window.__suppliersRepo.createSupplier({ nome: 'Não deveria criar' }).catch((e) => ({ __error: e.message })));
  check('createSupplier sem "compras" é negado', createDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(createDenied));

  const updateDenied = await semComprasPage.evaluate((id) => window.__suppliersRepo.updateSupplier(id, { nome: 'Hackeado' }).catch((e) => ({ __error: e.message })), fornecedor.id);
  check('updateSupplier sem "compras" é negado', updateDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(updateDenied));

  const deleteDenied = await semComprasPage.evaluate((id) => window.__suppliersRepo.deleteSupplier(id).catch((e) => ({ __error: e.message })), fornecedor.id);
  check('deleteSupplier sem "compras" é negado', deleteDenied.__error === 'Você não tem permissão para fazer isso.', JSON.stringify(deleteDenied));

  const createAllowed = await comComprasPage.evaluate(() => window.__suppliersRepo.createSupplier({ nome: 'Criado por vendedor com compras' }));
  check('createSupplier com "compras" funciona pra um vendedor (não só admin)', createAllowed.nome === 'Criado por vendedor com compras', createAllowed.nome);

  const deleteAllowed = await comComprasPage.evaluate((id) => window.__suppliersRepo.deleteSupplier(id), createAllowed.id);
  const afterDelete = await admin.evaluate((id) => window.__suppliersRepo.getSupplier(id), createAllowed.id);
  check('deleteSupplier com "compras" remove de verdade', afterDelete === null, afterDelete);

  // ---------- auditRepo: grava, nunca confia em quem o cliente afirma ser ----------

  const loggedByAdmin = await admin.evaluate(() => window.__auditRepo.logAction({
    userId: 'id-forjado-que-nao-existe', userName: 'Nome Forjado', role: 'admin', // tentativa deliberada de mentir sobre a identidade
    action: 'Teste de auditoria', details: 'Ação de teste', entity: 'test', entityId: 'x1',
  }));
  check('logAction grava a entrada', loggedByAdmin.action === 'Teste de auditoria', JSON.stringify(loggedByAdmin));
  check('cliente (auditRepo.js) nem SEQUER manda userId/userName/role no pedido', loggedByAdmin.userId !== 'id-forjado-que-nao-existe', loggedByAdmin.userId);

  // O check acima só prova que o CLIENTE se comporta bem — não que o
  // SERVIDOR recusaria um pedido malicioso vindo de fora do site (ex:
  // curl direto, sem passar pelo módulo). Testa isso com fetch cru,
  // mandando userId/userName/role forjados DE VERDADE no corpo, pra
  // confirmar que routes/audit.js#POST ignora esses campos na fonte —
  // não só porque o cliente "de boa vontade" nunca os manda.
  const forgedRaw = await rawApi(admin, '/api/audit', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'id-forjado-de-verdade', userName: 'Forjado De Verdade', role: 'admin',
      action: 'Teste de forjamento cru', details: '', entity: '', entityId: '',
    }),
  });
  check('POST /api/audit cru com userId/userName forjados no corpo: servidor IGNORA e usa a sessão real', forgedRaw.body.entry?.userId !== 'id-forjado-de-verdade' && forgedRaw.body.entry?.userName === 'Administrador', JSON.stringify(forgedRaw.body.entry));

  // Um vendedor SEM 'logs' (não pode LER o log) ainda precisa poder GRAVAR
  // nele — é o mesmo raciocínio de logAction() na extensão (loga a
  // própria ação, não uma permissão à parte). Usa o vendedor "compoderes"
  // pra gravar uma ação de verdade (criação de fornecedor) com a IDENTIDADE
  // dele mesmo, sem forjar nada.
  const loggedByVendedor = await comComprasPage.evaluate(() => window.__auditRepo.logAction({
    action: 'Cadastro de fornecedor', details: 'Fornecedor X cadastrado', entity: 'supplier', entityId: 'y1',
  }));
  check('vendedor SEM "logs" ainda consegue GRAVAR uma entrada (escrita não exige "logs")', loggedByVendedor.userId === comComprasId, JSON.stringify(loggedByVendedor));
  check('a entrada gravada pelo vendedor tem o NOME real dele (não vazio, não forjável)', loggedByVendedor.userName === 'Vendedor Com Compras', loggedByVendedor.userName);

  // Leitura (GET) continua exigindo 'logs' — vendedor sem essa permissão
  // não deveria conseguir listar, mesmo tendo 'compras'.
  const readAsSemLogs = await rawApi(comComprasPage, '/api/audit');
  check('GET /api/audit sem "logs" é negado, mesmo pra quem tem "compras"', readAsSemLogs.status === 403, readAsSemLogs.status);

  const readAsAdmin = await rawApi(admin, '/api/audit');
  check('GET /api/audit como admin funciona e mostra as entradas gravadas acima', readAsAdmin.status === 200 && readAsAdmin.body.entries.some((e) => e.action === 'Teste de auditoria') && readAsAdmin.body.entries.some((e) => e.action === 'Cadastro de fornecedor'), readAsAdmin.body.entries?.length);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
