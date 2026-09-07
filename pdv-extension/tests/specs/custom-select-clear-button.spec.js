// Pedido do usuário: um botão "x" ao lado de cada filtro de tela de lista,
// visível só quando o filtro não está no valor padrão (a 1ª <option>, ex:
// "Todos os status"), que volta o filtro pro padrão com um clique. Ver
// components/customSelect.js (clearBtn).
const { test, expect } = require('../fixtures');
const { completeSetupWizard, goTo } = require('../helpers');

test.describe('Filtro — botão de limpar (x)', () => {
  test('fica escondido no padrão, aparece ao escolher outro valor, e some de novo ao limpar', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const wrap = page.locator('.custom-select:has(#status-filter)');
    const clearBtn = wrap.locator('.custom-select-clear');

    await expect(clearBtn).toBeHidden();

    await wrap.locator('.custom-select-trigger').click();
    await page.waitForTimeout(200);
    await page.locator('.custom-select-option', { hasText: 'Disponível' }).click();
    await page.waitForTimeout(200);

    await expect(clearBtn).toBeVisible();
    await expect(page.locator('#status-filter')).toHaveValue('available');

    await clearBtn.click();
    await page.waitForTimeout(200);

    await expect(clearBtn).toBeHidden();
    await expect(page.locator('#status-filter')).toHaveValue('');
    await expect(wrap.locator('.custom-select-label')).toHaveText('Todos os status');
  });

  test('clicar no x não abre a lista do dropdown', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/financeiro');

    const wrap = page.locator('.custom-select:has(#status-filter)');
    await wrap.locator('.custom-select-trigger').click();
    await page.waitForTimeout(200);
    await page.locator('.custom-select-option', { hasText: 'Vencido' }).click();
    await page.waitForTimeout(200);

    await wrap.locator('.custom-select-clear').click();
    await page.waitForTimeout(200);

    await expect(page.locator('.custom-select-list.is-open')).toHaveCount(0);
  });
});
