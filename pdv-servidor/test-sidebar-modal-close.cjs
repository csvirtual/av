// Prova o achado do usuário (celular): abrir a gaveta do menu e tocar em
// "Sair" (que abre um confirmDialog) deve fechar a gaveta sozinha — ver
// components/modal.js (evento pdv:modal-open-change) e app.js (renderShell,
// listener que chama closeSidebar()).
const { chromium } = require('playwright');
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(BASE);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);

  // Abre a gaveta do menu
  await page.click('#menu-toggle-btn');
  await page.waitForTimeout(300);
  const sidebarOpenBefore = await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'));
  check('Gaveta abre ao clicar no hambúrguer', sidebarOpenBefore);

  // Clica em "Sair" (dentro da gaveta) — abre confirmDialog
  await page.click('#logout-btn');
  await page.waitForTimeout(300);
  const modalVisible = await page.locator('.modal-backdrop').count();
  check('Modal de confirmação "Sair do sistema" abriu', modalVisible === 1);

  const sidebarOpenAfterModal = await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'));
  check('Gaveta fechou sozinha ao abrir o modal', !sidebarOpenAfterModal);

  const overlayOpenAfterModal = await page.locator('#sidebar-overlay').evaluate((el) => el.classList.contains('open'));
  check('Véu por trás da gaveta também fechou', !overlayOpenAfterModal);

  await page.screenshot({ path: '/tmp/claude-0/-home-user-av/de84328f-14a9-5089-b716-6fc101b8d01f/scratchpad/sidebar-modal-close.png' });

  // Cancela o modal e confirma que a tela volta ao normal
  await page.click('.modal [data-action="cancel"]');
  await page.waitForTimeout(300);
  check('Ainda logado depois de cancelar (não deslogou por engano)', await page.locator('#logout-btn').count() === 1);

  check('Zero erros JS inesperados', errors.length === 0, JSON.stringify(errors));

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passaram.`);
  process.exit(passed === results.length ? 0 : 1);
})();
