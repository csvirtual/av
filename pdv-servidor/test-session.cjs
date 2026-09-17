// Testa public/js/session.js isolado, contra um servidor de verdade em
// localhost:3131 — sem depender de nenhuma tela real (Fase 9 ainda não
// portou nenhuma view). Cobre o ponto mais frágil da adaptação
// extensão→web: chrome.storage.onChanged dispara em TODAS as abas,
// inclusive a que fez a mudança; o evento nativo `storage` do navegador
// NUNCA dispara na aba que escreveu — sem compensar isso, login.js (que
// depende de onSessionUserIdChanged reagindo na PRÓPRIA aba) pararia de
// funcionar silenciosamente ao ser portado. Ver comentário no topo de
// public/js/session.js.
//
// Rodar: sobe o servidor (`node server.js`) numa janela, `node
// test-session.cjs` noutra.
const { chromium } = require('playwright');

const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  // UM contexto só (= um "navegador"/perfil só, como duas abas do mesmo
  // Chrome de um terminal físico) com duas páginas — localStorage e
  // cookies são compartilhados entre elas, exatamente o cenário real que
  // este módulo precisa cobrir. Dois `browser.newContext()` separados
  // simulariam dois TERMINAIS diferentes (perfis isolados), não duas
  // abas do mesmo terminal — cenário errado pra este teste específico.
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();

  await tabA.goto(`${BASE}/test-session.html`);
  await tabB.goto(`${BASE}/test-session.html`);

  // --- Estado inicial: ninguém logado ---
  const initialA = await tabA.evaluate(() => window.__session.getSessionUserId());
  check('getSessionUserId() sem login prévio devolve null', initialA === null, initialA);

  // --- Login na aba A ---
  const user = await tabA.evaluate(([u, p]) => window.__loginAndSetSession(u, p), ['admin', 'admin123']);
  check('login retornou o usuário admin', !!user?.id, JSON.stringify(user));

  const sameTabId = await tabA.evaluate(() => window.__session.getSessionUserId());
  check('getSessionUserId() na PRÓPRIA aba que logou já reflete o novo usuário', sameTabId === user.id, sameTabId);

  const sameTabDisplay = await tabA.evaluate(() => document.getElementById('user-id-display').textContent);
  check('onSessionUserIdChanged disparou na PRÓPRIA aba (equivalente ao chrome.storage.onChanged)', sameTabDisplay === user.id, sameTabDisplay);

  // --- Aba B (outra aba do MESMO navegador) precisa perceber o login sozinha ---
  await tabB.waitForFunction(() => document.getElementById('user-id-display').textContent !== 'null', null, { timeout: 3000 }).catch(() => {});
  const otherTabDisplay = await tabB.evaluate(() => document.getElementById('user-id-display').textContent);
  check('aba B (outra aba, mesmo navegador) percebeu o login via evento `storage`', otherTabDisplay === user.id, otherTabDisplay);
  const otherTabGetter = await tabB.evaluate(() => window.__session.getSessionUserId());
  check('getSessionUserId() na aba B também já reflete o novo usuário (cache local atualizado)', otherTabGetter === user.id, otherTabGetter);

  // --- Sessão de verdade no servidor (cookie), não só o cache do cliente ---
  const meRes = await tabA.evaluate(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    return { status: res.status, body: await res.json() };
  });
  check('GET /api/auth/me confirma o cookie de sessão real do servidor (não só o cache local)', meRes.status === 200 && meRes.body.user.id === user.id, JSON.stringify(meRes));

  // --- Crédito de troca pendente ---
  await tabA.evaluate(() => window.__session.setPendingCredit({ amount: 15, sourceSaleId: 's1', sourceRefundId: 'r1', reason: 'Estorno parcial' }));
  const credit1 = await tabA.evaluate(() => window.__session.getPendingCredit());
  check('setPendingCredit/getPendingCredit round-trip', credit1?.amount === 15, JSON.stringify(credit1));

  const credit2 = await tabA.evaluate(() => window.__session.addPendingCredit({ amount: 5, sourceSaleId: 's2', reason: 'Outro estorno' }));
  check('addPendingCredit soma ao invés de sobrescrever', credit2.amount === 20 && credit2.reason.includes('+'), JSON.stringify(credit2));

  // --- Atividade / idle ---
  await tabA.evaluate(() => window.__session.touchActivity());
  const idleA = await tabA.evaluate(() => window.__session.getIdleMs());
  check('getIdleMs() logo após touchActivity() é bem pequeno', idleA < 2000, idleA);
  const idleB = await tabB.evaluate(() => window.__session.getIdleMs());
  check('atividade registrada na aba A também é vista pela aba B (mesmo terminal)', idleB < 2000, idleB);

  // --- Logout ---
  await tabA.evaluate(() => window.__session.clearSession());
  const afterLogoutA = await tabA.evaluate(() => window.__session.getSessionUserId());
  check('getSessionUserId() na própria aba após clearSession() volta a null', afterLogoutA === null, afterLogoutA);

  await tabB.waitForFunction(() => document.getElementById('user-id-display').textContent === 'null', null, { timeout: 3000 }).catch(() => {});
  const afterLogoutB = await tabB.evaluate(() => document.getElementById('user-id-display').textContent);
  check('aba B também percebe o logout (evento `storage` de novo)', afterLogoutB === 'null', afterLogoutB);

  const creditAfterLogout = await tabA.evaluate(() => window.__session.getPendingCredit());
  check('clearSession() também limpa o crédito de troca pendente (não vaza pro próximo usuário do terminal)', creditAfterLogout === null, JSON.stringify(creditAfterLogout));

  const meAfterLogout = await tabA.evaluate(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    return res.status;
  });
  check('cookie de sessão real do servidor também foi invalidado (não só o cache do cliente)', meAfterLogout === 401, meAfterLogout);

  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
