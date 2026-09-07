// Achado de auditoria (pós-refatoração do dropdown de filtro pra
// position:fixed reparentado pro <body>): assim como um modal aberto
// sobrevivia a uma troca de rota sem clique nenhum no meio do caminho (por
// isso app.js já chama closeAllModals() em bootImpl()/renderCurrentRoute()),
// o mesmo bug existia pro dropdown — ele também é reparentado pro <body>,
// fora de #root/#main-content, então root.innerHTML/container.innerHTML
// sendo reescritos não o derrubavam. Alcançável de verdade sem clique algum:
// sessão expirando por inatividade (session.js) enquanto um filtro ficou
// aberto. Corrigido com components/customSelect.js#closeAllCustomSelects,
// chamada nos mesmos dois pontos que já chamam closeAllModals().
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test.describe('Dropdown de filtro — não deve sobreviver a uma troca de rota sem clique', () => {
  test('mudar o hash programaticamente (sem clicar em nada) fecha o dropdown aberto', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    await page.click('.custom-select:has(#status-filter) .custom-select-trigger');
    await page.waitForTimeout(200);
    await expect(page.locator('.custom-select-list.is-open')).toHaveCount(1);

    // Simula o mesmo tipo de troca de rota que uma expiração de sessão por
    // inatividade dispara: nenhum clique acontece antes disto, só o hash
    // mudando (ver app.js#renderCurrentRoute, chamado via window.onhashchange).
    await page.evaluate(() => { location.hash = '#/financeiro'; });
    await page.waitForTimeout(300);

    await expect(page.locator('.custom-select-list.is-open')).toHaveCount(0);
  });
});
