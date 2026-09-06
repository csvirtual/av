// "Segurar venda" (carrinhos congelados) — congelar o carrinho atual pra
// atender outro cliente, sem perder nenhum dos dois, e sem deixar vender o
// mesmo estoque duas vezes enquanto ele está reservado num carrinho
// congelado. Ver sale.js (heldSales) e ajuda.js pela documentação da
// feature pro usuário final.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedProduct, goTo, addProductToCart } = require('../helpers');

test.describe('Segurar venda — carrinhos congelados', () => {
  test('congelar, atender outro cliente e retomar preserva o carrinho original', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400106', name: 'Telha cerâmica un', price: 2.5, qty: 1000 });
    await goTo(page, '#/venda');

    await addProductToCart(page, 'Telha');
    await page.click('#hold-cart-btn');
    await page.waitForTimeout(400);

    // Carrinho ativo esvaziou e o card do carrinho congelado apareceu.
    await expect(page.locator('.held-sale-card')).toHaveCount(1);
    await expect(page.locator('#finalize-btn')).toBeDisabled();

    // Atende OUTRA venda enquanto isso — independente do carrinho congelado.
    await addProductToCart(page, 'Telha');
    await page.click('#finalize-btn');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Retoma o carrinho congelado — o item continua lá, pronto pra finalizar.
    await page.click('[data-resume-held]');
    await page.waitForTimeout(400);
    await expect(page.locator('.held-sale-card')).toHaveCount(0);
    await expect(page.locator('#finalize-btn')).toBeEnabled();
    await page.click('#finalize-btn');
    await page.waitForTimeout(1000);

    const salesCount = await page.evaluate(async () => {
      const { listSales } = await import('./js/data/salesRepo.js');
      return (await listSales()).length;
    });
    expect(salesCount).toBe(2); // a venda "do meio" + a que estava congelada
  });

  test('descartar um carrinho congelado não registra venda nenhuma', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400203', name: 'Telha colonial un', price: 3.1, qty: 1000 });
    await goTo(page, '#/venda');

    await addProductToCart(page, 'Telha colonial');
    await page.click('#hold-cart-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('.held-sale-card')).toHaveCount(1);

    await page.click('[data-discard-held]');
    await page.waitForTimeout(200);
    await page.click('.modal button:has-text("Descartar carrinho")');
    await page.waitForTimeout(400);

    await expect(page.locator('.held-sale-card')).toHaveCount(0);
    const salesCount = await page.evaluate(async () => {
      const { listSales } = await import('./js/data/salesRepo.js');
      return (await listSales()).length;
    });
    expect(salesCount).toBe(0);
  });

  test('estoque reservado num carrinho congelado não pode ser vendido duas vezes', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400300', name: 'Vergalhão 3/8 un', price: 15, qty: 3 });
    await goTo(page, '#/venda');

    // Congela um carrinho levando 2 das 3 unidades disponíveis.
    await page.fill('#scan-input', 'Vergalhão');
    await page.waitForTimeout(400);
    await page.locator('[data-pick]').first().click();
    await page.waitForTimeout(200);
    await page.fill('#cart-qty-0', '2');
    await page.locator('#cart-qty-0').blur();
    await page.waitForTimeout(200);
    await page.click('#hold-cart-btn');
    await page.waitForTimeout(400);

    // Um novo carrinho só pode pegar a 1 unidade que sobrou — não as 3
    // originais, porque 2 já estão reservadas no carrinho congelado.
    await page.fill('#scan-input', 'Vergalhão');
    await page.waitForTimeout(400);
    await page.locator('[data-pick]').first().click();
    await page.waitForTimeout(200);
    const maxAttr = await page.locator('#cart-qty-0').getAttribute('max');
    expect(Number(maxAttr)).toBe(1);
  });
});
