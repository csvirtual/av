// Prova views/caixa.js (copiada sem alteração da extensão) contra o
// servidor multi-terminal — Fase 9, passo 12. Cobre abertura, sangria/
// suprimento, retificação (novo endpoint POST /retificar, que não
// existia no servidor até este passo), fechamento com confirmação de
// senha de QUALQUER conta ativa + backup automático (novo endpoint POST
// /api/cash/backup-fechamento, de propósito sem gate de permissão
// 'backup'), aviso de redirecionamento pro PDV quando a política exige
// caixa aberto, e as adversárias de concorrência/duplicidade que o
// endpoint de retificação precisa ter (mesma classe de proteção que
// sangria/suprimento já tinham desde a Fase 3).
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-caixa.cjs` noutra.
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

// Usa o APIRequestContext do Playwright (page.request), não
// page.evaluate(fetch(...)) — chamadas por ali passam pelo próprio motor
// de rede da página e aparecem em page.on('response')/console, poluindo a
// checagem de "zero erros" do fluxo real com respostas 400/409
// INTENCIONAIS destas adversárias. page.request compartilha os mesmos
// cookies da página (mesmo contexto de navegador), mas fica fora do radar
// de rede da página em si.
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

  // Um vendedor sem NENHUMA permissão — prova que 'caixa' não exige
  // permissão nenhuma além de estar logado (mesmo `roles: ['admin',
  // 'vendedor']` da extensão, sem chave própria em utils/permissions.js).
  const vendorSetup = await apiCall(page, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Vendedor Caixa Teste', username: 'vendedor.caixa.teste', password: 'senhaVendedor1', permissions: {} }),
  });
  check('vendedor sem permissões criado (pra confirmar fechamento depois)', vendorSetup.status === 201, vendorSetup.status);

  // ---------- Estado fechado ----------
  await page.goto(`${BASE}/#/caixa`);
  await page.waitForTimeout(600);
  let viewText = await page.locator('#view-root').innerText();
  check('Estado inicial: nenhum caixa aberto', viewText.includes('Nenhum caixa aberto'));

  // ---------- Abrir caixa ----------
  await page.fill('#opening-amount', '100');
  await page.click('#open-session-btn');
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Caixa aberto com troco inicial R$ 100,00', /R\$\s*100,00/.test(viewText) && viewText.includes('DINHEIRO'));

  // Sessão aberta pro resto do teste (pega o id via API).
  const openState = await apiCall(page, '/api/cash/open');
  const sessionId = openState.body.session.id;
  check('Sessão de caixa tem id', !!sessionId, sessionId);

  // ---------- Sangria ----------
  await page.click('#sangria-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-amount', '30');
  await page.fill('#f-reason', 'depósito no banco');
  await page.click('.modal button:has-text("Confirmar")');
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Sangria de R$ 30 registrada, Dinheiro esperado cai pra R$ 70,00', /R\$\s*70,00/.test(viewText) && /SANGRIA/i.test(viewText), viewText.slice(0, 200));

  // ---------- Suprimento ----------
  await page.click('#suprimento-btn');
  await page.waitForTimeout(300);
  await page.fill('#f-amount', '15');
  await page.fill('#f-reason', 'reforço de troco');
  await page.click('.modal button:has-text("Confirmar")');
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  check('Suprimento de R$ 15 registrado, Dinheiro esperado sobe pra R$ 85,00', /R\$\s*85,00/.test(viewText) && /SUPRIMENTO/i.test(viewText));

  // Movimento da sangria (pra reconferir depois na adversária de concorrência).
  const movementsBefore = await apiCall(page, `/api/cash/sessions/${sessionId}`);
  const sangriaMovement = movementsBefore.body.movements.find((m) => m.type === 'sangria');
  check('Movimento de sangria encontrado', !!sangriaMovement, sangriaMovement && sangriaMovement.id);

  // ---------- Retificar a sangria: R$ 30 → R$ 40 (achado errado, corrigido pra mais) ----------
  await page.click('#adjust-btn');
  await page.waitForTimeout(300);
  await page.selectOption('#f-target', `sangria:${sangriaMovement.id}`);
  await page.waitForTimeout(200);
  await page.fill('#f-corrected', '40');
  await page.fill('#f-reason', 'digitei 30, era 40 de sangria');
  await page.click('.modal button:has-text("Confirmar retificação")');
  await page.waitForTimeout(700);
  viewText = await page.locator('#view-root').innerText();
  // Sangria maior (R$ 40 em vez de R$ 30) tira MAIS dinheiro esperado: 85 - 10 = 75.
  check('Retificação da sangria (30→40) reduz Dinheiro esperado pra R$ 75,00', /R\$\s*75,00/.test(viewText) && /RETIFICAÇÃO/i.test(viewText), viewText.slice(0, 300));
  check('Descrição da retificação mostra de/para e motivo', /R\$\s*30,00/.test(viewText) && /R\$\s*40,00/.test(viewText) && viewText.includes('digitei 30, era 40 de sangria'));

  // ---------- Adversária: concorrência na retificação ----------
  // Simula duas pessoas abrindo "Retificar" quase ao mesmo tempo sobre a
  // MESMA sangria: a primeira retificação (acima, 30→40) já mudou o valor
  // efetivo pra 40. Uma segunda tentativa que ainda acha que o "atual" é
  // 30 (valor que o navegador tinha em memória ANTES da primeira) precisa
  // ser rejeitada — sem essa reconferência, a segunda pisaria na primeira
  // e o cálculo de Dinheiro esperado ficaria errado sem avisar ninguém.
  const staleAdjustment = await apiCall(page, `/api/cash/sessions/${sessionId}/retificar`, {
    method: 'POST',
    body: JSON.stringify({
      targetType: 'sangria', targetMovementId: sangriaMovement.id,
      originalAmount: 30, correctedAmount: 35, reason: 'segunda pessoa, base desatualizada',
      dedupeKey: 'stale-adjustment-key',
    }),
  });
  check(
    'Servidor REJEITA retificação com base desatualizada (concorrência)',
    staleAdjustment.status === 400 && /mudou desde que essa correção foi aberta/i.test(staleAdjustment.body.error || ''),
    JSON.stringify(staleAdjustment),
  );

  // ---------- Adversária: reenvio duplicado (sangria) ----------
  const dupeKey = 'dupe-sangria-key';
  const firstSangria = await apiCall(page, `/api/cash/sessions/${sessionId}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 5, reason: 'sangria dedupe', dedupeKey: dupeKey }),
  });
  const secondSangria = await apiCall(page, `/api/cash/sessions/${sessionId}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 5, reason: 'sangria dedupe', dedupeKey: dupeKey }),
  });
  check('Primeira sangria com dedupeKey passa', firstSangria.status === 201, firstSangria.status);
  check('Reenvio da MESMA sangria (mesma dedupeKey) é rejeitado', secondSangria.status === 409, secondSangria.status);

  // ---------- Adversária: reenvio duplicado (retificação) ----------
  const adjDupeKey = 'dupe-adjust-key';
  const firstAdjust = await apiCall(page, `/api/cash/sessions/${sessionId}/retificar`, {
    method: 'POST', body: JSON.stringify({ targetType: 'abertura', originalAmount: 100, correctedAmount: 100.01, reason: 'ajuste mínimo', dedupeKey: adjDupeKey }),
  });
  const secondAdjust = await apiCall(page, `/api/cash/sessions/${sessionId}/retificar`, {
    method: 'POST', body: JSON.stringify({ targetType: 'abertura', originalAmount: 100, correctedAmount: 100.01, reason: 'ajuste mínimo', dedupeKey: adjDupeKey }),
  });
  check('Primeira retificação do troco com dedupeKey passa', firstAdjust.status === 201, firstAdjust.status);
  check('Reenvio da MESMA retificação (mesma dedupeKey) é rejeitado', secondAdjust.status === 409, secondAdjust.status);

  // ---------- Fechar caixa: confirmação com senha de um VENDEDOR (não admin) ----------
  await page.goto(`${BASE}/#/caixa`);
  await page.waitForTimeout(600);
  await page.click('#close-session-btn');
  await page.waitForTimeout(300);
  // Conta certinho pra cada forma, igual ao esperado, pra fechar "bateu certinho".
  const expectedNow = (await apiCall(page, `/api/cash/sessions/${sessionId}`)).body.expected;
  for (const method of Object.keys(expectedNow)) {
    const input = page.locator(`[data-count="${method}"]`);
    if (await input.count()) await input.fill(String(expectedNow[method]));
  }
  await page.fill('#f-confirm-user', 'vendedor.caixa.teste');
  await page.fill('#f-confirm-pass', 'senhaVendedor1');
  await page.click('.modal button:has-text("Confirmar fechamento")');
  await page.waitForTimeout(400);
  await page.click('[data-action="ok"]');
  await page.waitForTimeout(1200);
  viewText = await page.locator('#view-root').innerText();
  check('Depois de fechar, volta pro estado "nenhum caixa aberto"', viewText.includes('Nenhum caixa aberto'));
  check('Histórico mostra o caixa fechado, bateu certinho (confirmado por vendedor sem ser admin)', /BATEU CERTINHO/i.test(viewText), viewText.slice(0, 400));

  check('Zero erros JS/rede durante o fluxo real (abrir/sangria/suprimento/retificar/fechar+backup)', errors.length === 0, JSON.stringify(errors));

  // ---------- Adversária: sessão já fechada rejeita novas ações ----------
  const movementOnClosed = await apiCall(page, `/api/cash/sessions/${sessionId}/movimento`, {
    method: 'POST', body: JSON.stringify({ type: 'sangria', amount: 1, reason: 'depois de fechado' }),
  });
  check('Servidor rejeita sangria numa sessão já fechada', movementOnClosed.status === 400 && /não está mais aberto/i.test(movementOnClosed.body.error || ''), JSON.stringify(movementOnClosed));

  const adjustOnClosed = await apiCall(page, `/api/cash/sessions/${sessionId}/retificar`, {
    method: 'POST', body: JSON.stringify({ targetType: 'abertura', originalAmount: 100, correctedAmount: 99, reason: 'depois de fechado' }),
  });
  check('Servidor rejeita retificação numa sessão já fechada', adjustOnClosed.status === 400 && /não está mais aberto/i.test(adjustOnClosed.body.error || ''), JSON.stringify(adjustOnClosed));

  const closeAgain = await apiCall(page, `/api/cash/sessions/${sessionId}/fechar`, {
    method: 'POST', body: JSON.stringify({ countedAmounts: {} }),
  });
  check('Servidor rejeita fechar a mesma sessão duas vezes', closeAgain.status === 400 && /não está mais aberto/i.test(closeAgain.body.error || ''), JSON.stringify(closeAgain));

  // ---------- Adversária: backup automático exige senha, mas não exige permissão 'backup' ----------
  const shortPasswordBackup = await apiCall(page, '/api/cash/backup-fechamento', {
    method: 'POST', body: JSON.stringify({ password: '12' }),
  });
  check('Backup automático rejeita senha curta (menos de 4 caracteres)', shortPasswordBackup.status === 400, shortPasswordBackup.status);

  const noPermBackup = await apiCall(page, '/api/cash/backup-fechamento', {
    method: 'POST', body: JSON.stringify({ password: 'qualquerSenha123' }),
  });
  check(
    'Backup automático funciona pra admin SEM a permissão "backup" verificada aqui (rota fora do gate de /api/backup, de propósito — ver comentário da rota)',
    noPermBackup.status === 200 && !!noPermBackup.body.envelope && !!noPermBackup.body.envelope.ciphertext,
    JSON.stringify(noPermBackup).slice(0, 200),
  );

  // ---------- Aviso de redirecionamento pro PDV quando a política exige caixa aberto ----------
  const policyUpdate = await apiCall(page, '/api/company', {
    method: 'PUT', body: JSON.stringify({ requireOpenCashSession: true }),
  });
  check('Política "exigir caixa aberto" ligada', policyUpdate.status === 200, policyUpdate.status);

  // Já estávamos em #/caixa (última tela renderizada, do fechamento
  // acima) — navegar pro MESMO hash de novo não dispara onhashchange
  // nenhum (URL idêntica), então renderClosedState() não re-renderiza e a
  // política nova (lida de getCompany() só na hora do render) ficaria
  // presa no valor antigo, de antes do PUT. Passa por outra rota primeiro
  // pra forçar uma renderização de verdade com o dado fresco.
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/#/caixa`);
  await page.waitForTimeout(600);
  await page.fill('#opening-amount', '50');
  await page.click('#open-session-btn');
  await page.waitForTimeout(1000);
  // .last() porque openModal() empilha em document.body — se sobrar algum
  // backdrop de um passo anterior (não deveria, mas o seletor genérico
  // '.modal' seria ambíguo em modo estrito), o modal de redirecionamento é
  // sempre o mais recente a entrar no DOM.
  const redirectModal = page.locator('.modal').last();
  let redirectModalText = await redirectModal.innerText().catch((e) => `ERRO: ${e.message}`);
  check('Abrir caixa com a política ligada mostra o aviso de redirecionamento pro PDV', redirectModalText.includes('Redirecionando para o PDV'), redirectModalText.slice(0, 150));
  await redirectModal.locator('button:has-text("Ir agora")').click();
  await page.waitForTimeout(500);
  check('"Ir agora" navega direto pro PDV (Nova venda)', page.url().includes('#/venda'), page.url());

  // Desliga a política de novo, pra não vazar estado pros outros testes da suíte.
  await apiCall(page, '/api/company', { method: 'PUT', body: JSON.stringify({ requireOpenCashSession: false }) });

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
