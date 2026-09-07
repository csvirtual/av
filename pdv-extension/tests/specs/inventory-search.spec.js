// Pedido do usuário: buscar um produto específico no modal de Inventário
// sem precisar rolar a lista inteira num catálogo grande. Ver
// views/products.js#openInventoryModal.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo, seedProduct } = require('../helpers');

test.describe('Inventário — busca dentro do modal', () => {
  test('filtra as linhas por nome/código, e o valor digitado numa linha escondida ainda é aplicado no envio', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '1111', name: 'Cimento CP-II 50kg', qty: 40 });
    await seedProduct(page, { barcode: '2222', name: 'Tijolo Baiano 8 Furos', qty: 3000 });

    await goTo(page, '#/estoque');
    await page.click('#inventory-btn');
    await page.waitForTimeout(300);

    const cimentoRow = page.locator('#inventory-tbody tr', { hasText: 'Cimento CP-II 50kg' });
    const tijoloRow = page.locator('#inventory-tbody tr', { hasText: 'Tijolo Baiano 8 Furos' });
    await expect(cimentoRow).toBeVisible();
    await expect(tijoloRow).toBeVisible();

    await page.fill('#f-inventory-search', 'cimento');
    await page.waitForTimeout(200);
    await expect(cimentoRow).toBeVisible();
    await expect(tijoloRow).toBeHidden();

    // Corrige a contagem do Tijolo ANTES de filtrar por "cimento" — a linha
    // dele fica escondida, mas o valor já digitado não pode sumir nem ser
    // ignorado no envio (é só a VISIBILIDADE que muda, não o dado).
    await page.fill('#f-inventory-search', '');
    await page.waitForTimeout(200);
    await tijoloRow.locator('input[data-count]').fill('2990');
    await page.fill('#f-inventory-search', 'cimento');
    await page.waitForTimeout(200);
    await expect(tijoloRow).toBeHidden();

    // Busca sem resultado nenhum mostra o aviso, sem quebrar a tela.
    await page.fill('#f-inventory-search', 'produto que não existe');
    await page.waitForTimeout(200);
    await expect(cimentoRow).toBeHidden();
    await expect(page.locator('#inventory-no-match')).toBeVisible();

    // Limpa a busca de novo antes de enviar — as duas linhas voltam, e o
    // Cimento continua no valor original (sem diferença = sem ajuste).
    await page.fill('#f-inventory-search', '');
    await page.waitForTimeout(200);
    await page.click('.modal button:has-text("Aplicar ajustes")');
    await page.waitForTimeout(600);

    const products = await page.evaluate(async () => {
      const { listProducts } = await import('./js/data/productsRepo.js');
      return listProducts();
    });
    const cimento = products.find((p) => p.name === 'Cimento CP-II 50kg');
    const tijolo = products.find((p) => p.name === 'Tijolo Baiano 8 Furos');
    expect(cimento.quantity).toBe(40); // sem diferença, não mexeu
    expect(tijolo.quantity).toBe(2990); // aplicado mesmo tendo sido digitado com a linha depois escondida
  });
});
