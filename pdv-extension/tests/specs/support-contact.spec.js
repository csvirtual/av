// Pedido do usuário: um atalho em Dados da loja, ao lado do botão "Ativar",
// pra pedir a chave de ativação ao suporte a qualquer momento — antes disso
// só existia (só) na tela de bloqueio por trial expirado. Ver
// components/supportContact.js#openSupportContactChoiceModal.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test.describe('Dados da loja — atalho "Solicitar chave"', () => {
  test('abre o modal de escolha, e cada opção leva ao modal correto sem mencionar "trial encerrado"', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/empresa');

    const requestBtn = page.locator('#request-key-btn');
    await expect(requestBtn).toBeVisible();
    await requestBtn.click();
    await page.waitForTimeout(200);

    await expect(page.locator('.modal h2')).toHaveText('Solicitar chave de ativação');
    const whatsappBtn = page.locator('#support-choice-whatsapp-btn');
    const emailBtn = page.locator('#support-choice-email-btn');
    await expect(whatsappBtn).toBeVisible();
    await expect(emailBtn).toBeVisible();

    await whatsappBtn.click();
    await page.waitForTimeout(200);
    await expect(page.locator('.modal h2')).toHaveText('Contato via WhatsApp');
    // Achado do usuário: a mensagem original ("meu período de teste
    // encerrou") seria falsa vinda daqui — o trial pode continuar
    // perfeitamente válido quando alguém clica em "Solicitar chave".
    await expect(page.locator('.modal')).not.toContainText('encerrou');
    await expect(page.locator('.modal')).toContainText('solicitar minha chave de ativação definitiva');
  });

  test('a opção de e-mail leva ao modal de e-mail, com o campo pra confirmar o contato', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/empresa');

    await page.click('#request-key-btn');
    await page.waitForTimeout(200);
    await page.click('#support-choice-email-btn');
    await page.waitForTimeout(200);

    await expect(page.locator('.modal h2')).toHaveText('Contato por e-mail');
    await expect(page.locator('#support-contact-email')).toBeVisible();
    await expect(page.locator('.modal')).not.toContainText('encerrou');
  });
});
