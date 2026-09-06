// Carreto (entregas) — o achado P2 da segunda auditoria: createDelivery
// não tinha proteção nenhuma contra reenvio (nem dedupeKey). Ver
// deliveriesRepo.js#createDelivery e carreto.js#openNewDeliveryModal.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedCustomer, goTo } = require('../helpers');

test.describe('Carreto — proteção contra reenvio duplicado', () => {
  test('duas chamadas concorrentes de createDelivery com a mesma dedupeKey só criam uma', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    const customerId = await seedCustomer(page, { nome: 'Cliente Teste Concorrência' });

    const result = await page.evaluate(async (customerId) => {
      const { createDelivery } = await import('./js/data/deliveriesRepo.js');
      const { getSessionUserId } = await import('./js/session.js');
      const { getUser } = await import('./js/data/usersRepo.js');
      const userId = await getSessionUserId();
      const user = await getUser(userId);
      const dedupeKey = 'teste-carreto-concorrente';
      const call = () => createDelivery({
        customerId,
        items: [{ name: 'Carga de tijolo', qty: 1, source: 'avulso' }],
        address: 'Rua Teste, 100',
        responsible: 'Motorista Teste',
        userId,
        userName: user?.nome || 'Teste',
        dedupeKey,
      });
      const results = await Promise.allSettled([call(), call()]);
      return {
        fulfilled: results.filter((r) => r.status === 'fulfilled').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      };
    }, customerId);

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toBe(1);

    const count = await page.evaluate(async () => {
      const { listDeliveries } = await import('./js/data/deliveriesRepo.js');
      return (await listDeliveries()).length;
    });
    expect(count).toBe(1);
  });

  test('um carreto legítimo cadastrado pela UI de verdade continua funcionando', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedCustomer(page, { nome: 'Cliente Teste UI' });

    await goTo(page, '#/carreto');
    await page.click('#new-delivery-btn');
    await page.waitForTimeout(400);
    await page.fill('#customer-search', 'Cliente Teste UI');
    await page.waitForTimeout(500);
    await page.locator('[data-pick-customer]').first().click();
    await page.waitForTimeout(300);
    await page.click('#add-avulso-row-btn');
    await page.waitForTimeout(200);
    await page.locator('[data-item-name-input]').last().fill('Carga de areia');
    await page.locator('[data-item-qty]').last().fill('1');
    await page.click('.modal button:has-text("Cadastrar carreto")');
    await page.waitForTimeout(700);

    const count = await page.evaluate(async () => {
      const { listDeliveries } = await import('./js/data/deliveriesRepo.js');
      return (await listDeliveries()).length;
    });
    expect(count).toBe(1);
  });
});
