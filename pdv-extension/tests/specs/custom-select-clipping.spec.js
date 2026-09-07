// Achado do usuário: o dropdown de filtro (Financeiro, Estoque etc.)
// aparecia cortado quando a tela tinha pouco/nenhum conteúdo (ex: "Nenhuma
// conta encontrada"). Causa: `.main` tem `overflow-x:auto`, que por regra
// do CSS força `overflow-y` a virar `auto` também — a lista, antes
// `position:absolute`, ficava presa a essa altura curta. Corrigido em
// components/customSelect.js: a lista vira `position:fixed`, reparentada
// pro <body> enquanto aberta, escapando desse overflow — mesmo padrão já
// usado em views/products.js#row-options-menu.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test.describe('Dropdown de filtro — não deve cortar em tela com pouco conteúdo', () => {
  test('Financeiro sem nenhuma conta cadastrada: lista do filtro de status cabe inteira na janela', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/financeiro');
    await expect(page.locator('.table-empty')).toBeVisible(); // confirma o cenário exato do achado: tela vazia

    await page.click('.custom-select:has(#status-filter) .custom-select-trigger');
    await page.waitForTimeout(200);

    const list = page.locator('.custom-select-list.is-open');
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    const viewport = page.viewportSize();
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // Confirma que a última opção da lista está realmente visível, não só
    // que a caixa "cabe" matematicamente — verifica o texto de verdade.
    await expect(list).toContainText('Pago');
  });

  test('Estoque sem nenhum produto cadastrado: lista do filtro de status cabe inteira na janela', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');
    await expect(page.locator('.table-empty')).toBeVisible();

    await page.click('.custom-select:has(#status-filter) .custom-select-trigger');
    await page.waitForTimeout(200);

    const list = page.locator('.custom-select-list.is-open');
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    const viewport = page.viewportSize();
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });

  test('escolher uma opção continua funcionando e fecha a lista', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/financeiro');

    await page.click('.custom-select:has(#status-filter) .custom-select-trigger');
    await page.waitForTimeout(200);
    await page.locator('.custom-select-option', { hasText: 'Vencido' }).click();
    await page.waitForTimeout(200);

    await expect(page.locator('.custom-select-list.is-open')).toHaveCount(0);
    const selectedValue = await page.locator('#status-filter').inputValue();
    expect(selectedValue).toBe('vencido');
  });

  test('opção mais larga que o gatilho (Estoque: "Próximo da validade") não fica cortada', async ({ appPage: page }) => {
    // Achado do usuário: `list.style.width` fixo (= largura do gatilho)
    // cortava horizontalmente qualquer opção mais larga que o texto atual
    // do gatilho — "Todos os status" é bem mais curto que "Próximo da
    // validade" ou "Fora da validade". Corrigido pra `min-width` (cresce
    // pra caber o conteúdo, nunca menor que o gatilho).
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    await page.click('.custom-select:has(#status-filter) .custom-select-trigger');
    await page.waitForTimeout(200);

    const list = page.locator('.custom-select-list.is-open');
    const overflowsHorizontally = await list.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflowsHorizontally).toBe(false);

    const longOption = page.locator('.custom-select-option', { hasText: 'Próximo da validade' });
    await expect(longOption).toBeVisible();
    const listBox = await list.boundingBox();
    const optionBox = await longOption.boundingBox();
    expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
  });
});
