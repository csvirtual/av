// PDV (Nova venda) — cobre a brecha P0 encontrada em auditoria: cliques
// duplicados no botão "Finalizar venda" (impaciência do vendedor, duplo
// clique físico, ou o mesmo carrinho reenviado por qualquer motivo) não
// podem gerar duas vendas a partir do mesmo carrinho. Ver
// salesRepo.js#createSale (dedupeKey) e sale.js (saleDedupeKey).
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo, seedProduct, addProductToCart } = require('../helpers');

test.describe('PDV — proteção contra venda duplicada', () => {
  test.beforeEach(async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000100103', name: 'Cimento CP-II 50kg', price: 32.9, qty: 200 });
    await goTo(page, '#/venda');
  });

  test('clicar duas vezes seguidas em "Finalizar venda" gera só UMA venda', async ({ appPage: page }) => {
    await addProductToCart(page, 'Cimento');
    await expect(page.locator('#finalize-btn')).toBeEnabled();

    // Dois cliques o mais simultâneos possível — o cenário real que
    // motivou a correção (impaciência/nervosismo no balcão).
    await Promise.all([
      page.click('#finalize-btn'),
      page.click('#finalize-btn').catch(() => {}), // pode já estar disabled no 2º clique — tudo bem
    ]);
    await page.waitForTimeout(1200);

    const salesCount = await page.evaluate(async () => {
      const { listSales } = await import('./js/data/salesRepo.js');
      return (await listSales()).length;
    });
    expect(salesCount).toBe(1);
  });

  test('uma venda legítima simples continua funcionando normalmente', async ({ appPage: page }) => {
    await addProductToCart(page, 'Cimento');
    await page.click('#finalize-btn');
    await page.waitForTimeout(1000);

    const salesCount = await page.evaluate(async () => {
      const { listSales } = await import('./js/data/salesRepo.js');
      return (await listSales()).length;
    });
    expect(salesCount).toBe(1);

    // Modal de "Venda finalizada" confirma que o fluxo terminou certo, não
    // travou num erro engolido silenciosamente.
    await expect(page.locator('.modal-title, .modal h2, .modal').filter({ hasText: 'Venda finalizada' }).first()).toBeVisible();
  });

  test('duas vendas seguidas e independentes (carrinho novo) funcionam — a proteção não trava vendas legítimas', async ({ appPage: page }) => {
    await addProductToCart(page, 'Cimento');
    await page.click('#finalize-btn');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape'); // fecha o modal de "Venda finalizada"
    await page.waitForTimeout(300);

    await addProductToCart(page, 'Cimento');
    await expect(page.locator('#finalize-btn')).toBeEnabled();
    await page.click('#finalize-btn');
    await page.waitForTimeout(1000);

    const salesCount = await page.evaluate(async () => {
      const { listSales } = await import('./js/data/salesRepo.js');
      return (await listSales()).length;
    });
    expect(salesCount).toBe(2);
  });
});
