// Dois achados da revisão antes de mergear pdv-extension/ pra main —
// nenhum dos dois é sobre dinheiro/estoque diretamente, mas os dois são
// escalada de privilégio de verdade, então entram na mesma régua de rigor.
// Ver usersRepo.js#resetUserPassword e loginLockout.js#keyFor (namespace).
const { test, expect } = require('../fixtures');
const { completeSetupWizard, login, logout, goTo, DEFAULT_ADMIN } = require('../helpers');

/** Cria um vendedor com exatamente as permissões passadas, direto pelo
 * repositório (mais preciso e rápido que passar pela tela de cadastro). */
async function createVendor(page, { username, password, permissions }) {
  return page.evaluate(async ({ username, password, permissions }) => {
    const { createUser } = await import('./js/data/usersRepo.js');
    return createUser({ nome: username, username, password, permissions });
  }, { username, password, permissions });
}

test.describe('Correções de segurança — revisão pré-merge', () => {
  test('vendedor não pode resetar a senha de outro vendedor com MAIS poderes que ele', async ({ appPage: page }) => {
    await completeSetupWizard(page);

    // Bruno tem "financeiro" e "backup" — poderes que Ana não tem.
    await createVendor(page, { username: 'bruno', password: 'senhaBruno123', permissions: { financeiro: true, backup: true } });
    // Ana só tem "usuarios" — o suficiente pra ACESSAR a tela de Usuários,
    // mas não pra herdar poder de ninguém por essa porta.
    await createVendor(page, { username: 'ana', password: 'senhaAna12345', permissions: { usuarios: true } });

    await logout(page);
    await login(page, 'ana', 'senhaAna12345');
    await goTo(page, '#/dashboard'); // sai da Ajuda do primeiro login

    const result = await page.evaluate(async () => {
      const { listUsers, resetUserPassword } = await import('./js/data/usersRepo.js');
      const bruno = (await listUsers()).find((u) => u.username === 'bruno');
      try {
        await resetUserPassword(bruno.id, 'novaSenhaQualquer1');
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err.message };
      }
    });

    expect(result.blocked).toBe(true);
  });

  test('vendedor com os MESMOS poderes (ou menos) pode resetar senha normalmente', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await createVendor(page, { username: 'carlos', password: 'senhaCarlos123', permissions: {} });
    await createVendor(page, { username: 'ana2', password: 'senhaAna12345', permissions: { usuarios: true } });

    await logout(page);
    await login(page, 'ana2', 'senhaAna12345');
    await goTo(page, '#/dashboard');

    const result = await page.evaluate(async () => {
      const { listUsers, resetUserPassword } = await import('./js/data/usersRepo.js');
      const carlos = (await listUsers()).find((u) => u.username === 'carlos');
      try {
        await resetUserPassword(carlos.id, 'novaSenhaQualquer1');
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err.message };
      }
    });

    expect(result.blocked).toBe(false);
  });

  test('errar a senha do admin no modal de confirmação não bloqueia o login de verdade dele', async ({ appPage: page }) => {
    await completeSetupWizard(page);

    // Simula duas tentativas erradas no "namespace" usado pelos modais de
    // confirmação (aprovar desconto/fechar caixa/zerar backup) — sem
    // precisar montar a UI completa de nenhum dos três, já que o que está
    // sendo testado é o isolamento da trava, não a tela em si.
    await page.evaluate(async (username) => {
      const { verifyLogin } = await import('./js/data/usersRepo.js');
      await verifyLogin(username, 'outraSenhaErrada1', { namespace: 'confirmPassword' });
      await verifyLogin(username, 'outraSenhaErrada2', { namespace: 'confirmPassword' });
    }, DEFAULT_ADMIN.username);

    const { confirmLocked, loginLocked } = await page.evaluate(async (username) => {
      const { getLoginLockState } = await import('./js/loginLockout.js');
      const confirmState = await getLoginLockState(username, 'confirmPassword');
      const loginState = await getLoginLockState(username); // namespace padrão = login de verdade
      return { confirmLocked: confirmState.remainingMs > 0, loginLocked: loginState.remainingMs > 0 };
    }, DEFAULT_ADMIN.username);

    expect(confirmLocked).toBe(true); // a trava do modal funcionou (proteção contra força bruta preservada)
    expect(loginLocked).toBe(false); // mas NÃO vazou pro login de verdade do admin
  });
});
