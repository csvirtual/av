// Estorno — mesma classe de brecha do PDV, achada na mesma auditoria:
// confirmar "Estornar itens" duas vezes (o mesmo cenário de duplo clique)
// não pode devolver a mercadoria ao estoque duas vezes nem estornar o
// mesmo fiado/pontos de fidelidade duas vezes. Ver
// salesRepo.js#refundSaleItems (dedupeKey) e salesHistory.js
// (dedupeKey gerado uma vez por abertura do modal de estorno).
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedProduct, makeSimpleSale, goTo } = require('../helpers');

test.describe('Estorno — proteção contra reenvio duplicado', () => {
  test('duas chamadas concorrentes de refundSaleItems com a mesma dedupeKey só aplicam uma', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000200104', name: 'Areia lavada m³', price: 55, qty: 50 });
    const saleId = await makeSimpleSale(page, 'Areia');

    const result = await page.evaluate(async (saleId) => {
      const { refundSaleItems } = await import('./js/data/salesRepo.js');
      const dedupeKey = 'teste-refund-concorrente';
      const call = () => refundSaleItems({
        saleId,
        items: [{ itemIndex: 0, qty: 1 }],
        reason: 'Teste automatizado — duplo clique',
        generateCredit: false,
        dedupeKey,
      });
      const results = await Promise.allSettled([call(), call()]);
      return {
        fulfilled: results.filter((r) => r.status === 'fulfilled').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      };
    }, saleId);

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toBe(1);

    const product = await page.evaluate(async () => {
      const { listProducts } = await import('./js/data/productsRepo.js');
      return (await listProducts()).find((p) => p.name.includes('Areia'));
    });
    // 50 iniciais - 1 vendida + 1 devolvida (só UMA vez) = 50, nunca 51.
    expect(product.quantity).toBe(50);
  });

  test('um estorno legítimo pela UI de verdade continua funcionando', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000200201', name: 'Tijolo baiano un', price: 1.2, qty: 500 });
    await makeSimpleSale(page, 'Tijolo');

    await goTo(page, '#/vendas');
    await page.locator('[data-detail]').first().click();
    await page.waitForTimeout(300);
    await page.click('.modal button:has-text("Estornar itens")');
    await page.waitForTimeout(300);
    await page.locator('[data-refund-qty]').first().fill('1');
    await page.fill('#f-reason', 'Teste automatizado — devolução simples');
    await page.click('.modal button:has-text("Confirmar estorno")');
    await page.waitForTimeout(700);

    const product = await page.evaluate(async () => {
      const { listProducts } = await import('./js/data/productsRepo.js');
      return (await listProducts()).find((p) => p.name.includes('Tijolo'));
    });
    expect(product.quantity).toBe(500); // 500 - 1 vendido + 1 estornado
  });
});
