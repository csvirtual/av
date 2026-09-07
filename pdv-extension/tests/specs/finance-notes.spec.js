// Achado do usuário: a "Observação" de uma conta financeira era salva no
// banco (ver data/financeRepo.js#createEntry) mas não aparecia em NENHUMA
// tela nem no log de auditoria — parecia ter sumido, mesmo sendo
// Administrador Geral. Corrigido em views/financeiro.js: aparece no modal
// "Registrar pagamento" e no log de auditoria da criação da conta.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test.describe('Financeiro — observação da conta não deve mais sumir', () => {
  test('observação aparece no modal de registrar pagamento e no log de auditoria', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/financeiro');

    await page.click('#new-entry-btn');
    await page.waitForTimeout(300);
    await page.selectOption('#f-type', 'pagar');
    await page.fill('#f-description', 'Aluguel de setembro');
    await page.fill('#f-amount', '1500');
    await page.fill('#f-duedate', '2026-12-31');
    await page.fill('#f-notes', 'Combinado pagar em duas parcelas com o síndico');
    await page.click('.modal button:has-text("Cadastrar conta")');
    await page.waitForTimeout(600);

    // Modal de "Registrar pagamento" — a observação precisa aparecer aqui.
    await page.click('button:has-text("Registrar pagamento")');
    await page.waitForTimeout(300);
    await expect(page.locator('.modal')).toContainText('Combinado pagar em duas parcelas com o síndico');
    await page.click('.modal button:has-text("Cancelar")');
    await page.waitForTimeout(200);

    // Log de auditoria — a observação também precisa constar ali.
    await goTo(page, '#/logs');
    await expect(page.locator('table')).toContainText('Combinado pagar em duas parcelas com o síndico');
  });
});
