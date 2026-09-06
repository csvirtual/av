// Fixture compartilhada por toda a suíte: sobe um Chromium real com a
// extensão carregada como "unpacked" (igual o usuário faria em
// chrome://extensions), acha a aba do app e devolve pronta pra uso — cada
// spec só chama completeSetupWizard()/login() (ver helpers.js) e testa a
// funcionalidade em si, sem repetir esse boilerplate.
const base = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT_PATH = path.join(__dirname, '..');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const test = base.test.extend({
  context: async ({}, use) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-ext-profile-'));
    const context = await base.chromium.launchPersistentContext(profileDir, {
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
      viewport: { width: 1280, height: 900 },
    });
    await use(context);
    await context.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    await use(sw.url().split('/')[2]);
  },

  // Aba do app já em foco, pronta pra interagir — abas extras (ex: a de
  // boas-vindas que o Chrome às vezes abre sozinho) são fechadas. Qualquer
  // erro de JS não tratado durante o teste (page.pageErrors) reprova o
  // teste no final, mesmo que a asserção principal do spec tenha passado —
  // um bug real da aplicação nunca deve passar em silêncio.
  appPage: async ({ context, extensionId }, use) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    let page = context.pages().find((p) => p.url().includes(`chrome-extension://${extensionId}/app/`));
    if (!page) page = await context.waitForEvent('page', { timeout: 15000 });
    for (const p of context.pages()) {
      if (p !== page) await p.close().catch(() => {});
    }
    page.pageErrors = [];
    page.on('pageerror', (err) => page.pageErrors.push(err.message));
    await page.bringToFront();
    await page.waitForTimeout(400);
    await use(page);
    if (page.pageErrors.length > 0) {
      throw new Error(`Erro(s) de JS não tratado(s) na página durante o teste:\n${page.pageErrors.join('\n')}`);
    }
  },
});

module.exports = { test, expect: base.expect };
