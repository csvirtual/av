// Ajuste manual de estoque — mesma classe de brecha: confirmar "Confirmar
// ajuste" duas vezes não pode aplicar o mesmo ajuste duas vezes. Ver
// stockRepo.js#recordMovement (dedupeKey) e products.js#openAdjustModal.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedProduct, goTo } = require('../helpers');

test.describe('Ajuste de estoque — proteção contra reenvio duplicado', () => {
  test('duas chamadas concorrentes de recordManualAdjustment com a mesma dedupeKey só aplicam uma', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    const productId = await seedProduct(page, { barcode: '7891000300105', name: 'Cal hidratada 20kg', price: 18, qty: 40 });

    const result = await page.evaluate(async (productId) => {
      const { recordManualAdjustment } = await import('./js/data/stockRepo.js');
      const { getSessionUserId } = await import('./js/session.js');
      const userId = await getSessionUserId();
      const dedupeKey = 'teste-ajuste-concorrente';
      const call = () => recordManualAdjustment({
        productId,
        type: 'entrada',
        qty: 10,
        userId,
        userName: 'Teste',
        note: 'Teste automatizado',
        dedupeKey,
      });
      const results = await Promise.allSettled([call(), call()]);
      return {
        fulfilled: results.filter((r) => r.status === 'fulfilled').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      };
    }, productId);

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toBe(1);

    const product = await page.evaluate(async (productId) => {
      const { listProducts } = await import('./js/data/productsRepo.js');
      return (await listProducts()).find((p) => p.id === productId);
    }, productId);
    // 40 iniciais + 10 (uma única vez) = 50, nunca 60.
    expect(product.quantity).toBe(50);
  });

  test('um ajuste legítimo pela UI de verdade continua funcionando', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000300202', name: 'Argamassa AC-I 20kg', price: 24, qty: 30 });

    await goTo(page, '#/estoque');
    await page.fill('#search-input', 'Argamassa');
    await page.waitForTimeout(400);
    await page.locator('[data-options]').first().click();
    await page.waitForTimeout(200);
    await page.locator('.row-options-item', { hasText: 'Ajustar' }).click();
    await page.waitForTimeout(300);
    await page.selectOption('#f-type', 'entrada');
    await page.fill('#f-qty', '5');
    await page.click('.modal button:has-text("Confirmar ajuste")');
    await page.waitForTimeout(700);

    const product = await page.evaluate(async () => {
      const { listProducts } = await import('./js/data/productsRepo.js');
      return (await listProducts()).find((p) => p.name.includes('Argamassa'));
    });
    expect(product.quantity).toBe(35);
  });
});
