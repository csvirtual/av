// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 60_000,
  // A extensão só roda numa aba por vez (trava de aba única é uma feature
  // do próprio produto — ver app.js) e cada teste sobe seu próprio perfil
  // isolado do Chrome, então rodar specs em paralelo é seguro; mantemos um
  // worker por padrão pra não sobrecarregar o sandbox onde isso roda.
  workers: process.env.CI ? 2 : 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    actionTimeout: 15_000,
  },
});
