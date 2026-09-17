// Achado de auditoria: uma tentativa de login malsucedida ficava só no
// contador efêmero do bloqueio (loginLockout.js) — o Log do sistema
// (permanente) nunca registrava nada. Ver views/login.js#submit.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, logout, DEFAULT_ADMIN } = require('../helpers');

test.describe('Login — tentativas malsucedidas no Log do sistema', () => {
  test('senha errada pra usuário existente gera log com o perfil real; usuário inexistente gera log neutro', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await logout(page);

    // Senha errada pra um usuário que existe de verdade.
    await page.fill('#username', DEFAULT_ADMIN.username);
    await page.fill('#password', 'senhaErrada999');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);

    // Usuário que não existe.
    await page.fill('#username', 'ninguem-existe-aqui');
    await page.fill('#password', 'qualquercoisa123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);

    await page.fill('#username', DEFAULT_ADMIN.username);
    await page.fill('#password', DEFAULT_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(900);

    const entries = await page.evaluate(async () => {
      const { listAuditLogPage } = await import('./js/data/auditRepo.js');
      const page1 = await listAuditLogPage({ limit: 10 });
      return page1.items;
    });

    const wrongPassEntry = entries.find((e) => e.action === 'Login malsucedido' && e.details.includes('senha incorreta'));
    const unknownUserEntry = entries.find((e) => e.action === 'Login malsucedido' && e.details.includes('inexistente'));

    expect(wrongPassEntry).toBeTruthy();
    expect(wrongPassEntry.role).toBe('admin');
    expect(wrongPassEntry.userId).toBeTruthy();
    expect(wrongPassEntry.details).toContain(DEFAULT_ADMIN.nome);

    expect(unknownUserEntry).toBeTruthy();
    expect(unknownUserEntry.role).toBeNull();
    expect(unknownUserEntry.userId).toBeNull();
    expect(unknownUserEntry.details).toContain('ninguem-existe-aqui');

    const successEntry = entries.find((e) => e.action === 'Login' && e.userId);
    expect(successEntry).toBeTruthy();
  });

  test('Log do sistema mostra badge neutro (não "Vendedor") pra tentativa com usuário inexistente', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await logout(page);

    await page.fill('#username', 'fantasma-total');
    await page.fill('#password', 'x123456789');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);

    await page.fill('#username', DEFAULT_ADMIN.username);
    await page.fill('#password', DEFAULT_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(900);

    await page.evaluate(() => { location.hash = '#/logs'; });
    await page.waitForTimeout(500);

    const row = page.locator('tr', { hasText: 'fantasma-total' });
    await expect(row).toBeVisible();
    await expect(row.locator('.badge-gray')).toBeVisible();
    await expect(row.locator('.badge-green')).toHaveCount(0);
    await expect(row.locator('.badge-gold')).toHaveCount(0);
  });
});
