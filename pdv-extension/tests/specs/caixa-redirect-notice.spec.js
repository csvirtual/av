// Pedido do usuário: ao abrir o caixa, se a loja exige caixa aberto pra
// vender, um aviso elegante avisa que vai redirecionar pro PDV em 5s (com
// contagem regressiva) — só nesse caso específico. Sem a política ligada,
// abrir o caixa continua igual (fica na tela de Caixa, sem aviso nenhum).
// Ver views/caixa.js#showRedirectToPdvNotice.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo, enableRequireOpenCashSession } = require('../helpers');

test.describe('Caixa — aviso de redirecionamento pro PDV', () => {
  test('com a política LIGADA: aviso aparece e redireciona pro PDV sozinho', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await enableRequireOpenCashSession(page);
    await goTo(page, '#/caixa');

    await page.click('#open-session-btn');
    await page.waitForTimeout(400);

    await expect(page.locator('.modal h2')).toHaveText('Caixa aberto');
    await expect(page.locator('#redirect-count')).toHaveText('5');

    // Não precisa esperar os 5s de verdade pra confirmar que funciona —
    // clicar "Ir agora" já cobre o caminho de navegação; o timer em si
    // (setInterval) é testado separadamente logo abaixo.
    await page.click('.modal button:has-text("Ir agora")');
    await page.waitForTimeout(400);

    await expect(page).toHaveURL(/#\/venda$/);
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('a contagem regressiva realmente decresce e redireciona sozinha ao chegar em zero', async ({ appPage: page }) => {
    test.setTimeout(15000);
    await completeSetupWizard(page);
    await enableRequireOpenCashSession(page);
    await goTo(page, '#/caixa');

    await page.click('#open-session-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('#redirect-count')).toHaveText('5');

    await page.waitForTimeout(2200);
    await expect(page.locator('#redirect-count')).toHaveText('3');

    await page.waitForTimeout(3200); // passa dos 5s totais
    await expect(page).toHaveURL(/#\/venda$/);
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('com a política DESLIGADA: abrir o caixa não mostra nenhum aviso', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/caixa');

    await page.click('#open-session-btn');
    await page.waitForTimeout(600);

    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/caixa$/);
  });
});
