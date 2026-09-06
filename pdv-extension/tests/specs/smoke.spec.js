// Smoke test: setup do zero, login, e navegação pelas telas principais.
// Se isso quebrar, praticamente todo o resto da suíte quebra junto — é o
// primeiro sinal de que algo estrutural mudou (rota, seletor, wizard).
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test('setup do zero, login e navegação pelas telas principais', async ({ appPage: page }) => {
  await expect(page).toHaveTitle('PDV - C&S Virtual');

  await completeSetupWizard(page);

  // Primeiro login de uma conta nova cai na Ajuda, não no Painel — só
  // confirma que renderizou algo, sem travar em qual tela é.
  await expect(page.locator('#root')).not.toBeEmpty();

  const screens = ['#/dashboard', '#/estoque', '#/venda', '#/clientes', '#/carreto', '#/caixa', '#/relatorios'];
  for (const hash of screens) {
    await goTo(page, hash);
    // Cada tela deve renderizar algo visível no root, sem tela em branco.
    await expect(page.locator('#root')).not.toBeEmpty();
  }
});
