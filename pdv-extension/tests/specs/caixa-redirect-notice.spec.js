// Pedido do usuário: ao abrir o caixa, se a loja exige caixa aberto pra
// vender, um aviso elegante avisa que vai redirecionar pro PDV em 7s (com
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
    await expect(page.locator('#redirect-count')).toHaveText('7');

    // Não precisa esperar os 7s de verdade pra confirmar que funciona —
    // clicar "Ir agora" já cobre o caminho de navegação; o timer em si
    // (setInterval) é testado separadamente logo abaixo.
    await page.click('.modal button:has-text("Ir agora")');
    await page.waitForTimeout(400);

    await expect(page).toHaveURL(/#\/venda$/);
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('a contagem regressiva realmente decresce e redireciona sozinha ao chegar em zero', async ({ appPage: page }) => {
    test.setTimeout(20000);
    await completeSetupWizard(page);
    await enableRequireOpenCashSession(page);
    await goTo(page, '#/caixa');

    await page.click('#open-session-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('#redirect-count')).toHaveText('7');

    await page.waitForTimeout(2200);
    await expect(page.locator('#redirect-count')).toHaveText('5');

    await page.waitForTimeout(5200); // passa dos 7s totais
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

  test('"Ficar aqui" cancela o redirecionamento e não navega sozinho depois', async ({ appPage: page }) => {
    test.setTimeout(20000);
    await completeSetupWizard(page);
    await enableRequireOpenCashSession(page);
    await goTo(page, '#/caixa');

    await page.click('#open-session-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('.modal h2')).toHaveText('Caixa aberto');

    await page.click('.modal button:has-text("Ficar aqui")');
    await page.waitForTimeout(400);
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/caixa$/);

    // Confirma que cancelar de fato para o timer — sem isso, o próprio
    // setInterval ainda navegaria sozinho pro PDV ao chegar em zero, mesmo
    // com o modal já fechado.
    await page.waitForTimeout(7500);
    await expect(page).toHaveURL(/#\/caixa$/);
  });
});
