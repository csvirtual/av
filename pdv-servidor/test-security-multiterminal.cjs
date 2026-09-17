const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const machineA = await browser.newContext({ acceptDownloads: true });
  const machineB = await browser.newContext();
  const pageA = await machineA.newPage();
  const pageB = await machineB.newPage();
  const errorsA = [], errorsB = [];
  pageA.on('pageerror', (e) => errorsA.push(e.message));
  pageB.on('pageerror', (e) => errorsB.push(e.message));

  await pageA.goto('http://localhost:3131/test.html');
  await pageA.waitForTimeout(300);
  await pageA.click('#login-btn');
  await pageA.waitForSelector('#ws-status.connected');

  // Limite de desconto: 10%
  await pageA.fill('#company-max-discount', '10');
  await pageA.click('#save-company-btn');
  await pageA.waitForTimeout(300);

  // Admin cadastra o vendedor de teste (sem unlimitedDiscount)
  await pageA.fill('#new-user-nome', 'Caixa Sem Aprovação');
  await pageA.fill('#new-user-username', 'caixasemaprov');
  await pageA.fill('#new-user-password', 'senha1234');
  await pageA.click('#add-user-btn');
  await pageA.waitForTimeout(400);

  await pageA.fill('#f-barcode', 'SEC-DEMO-01');
  await pageA.fill('#f-name', 'Produto Desconto Demo');
  await pageA.fill('#f-price', '100');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  await pageA.click('[data-entrada]');
  await pageA.waitForTimeout(200);

  // Máquina B loga como o vendedor sem aprovação
  await pageB.goto('http://localhost:3131/test.html');
  await pageB.waitForTimeout(300);
  await pageB.fill('#username', 'caixasemaprov');
  await pageB.fill('#password', 'senha1234');
  await pageB.click('#login-btn');
  await pageB.waitForSelector('#ws-status.connected');
  await pageB.waitForTimeout(400);

  // B monta a venda com 30% de desconto (acima do limite de 10%)
  await pageB.click('[data-cart]');
  await pageB.waitForTimeout(150);
  await pageB.fill('#sale-discount', '30');
  await pageB.selectOption('#pay-method', 'Dinheiro');
  await pageB.click('#finalize-btn');
  await pageB.waitForTimeout(400);

  const approvalModalVisible = await pageB.locator('#approval-username').isVisible();
  check('vendedor sem permissão: modal de autorização de desconto abre sozinho', approvalModalVisible, approvalModalVisible);

  // Senha errada primeiro
  await pageB.fill('#approval-username', 'admin');
  await pageB.fill('#approval-password', 'senhaErrada');
  await pageB.click('#confirm-approval-btn');
  await pageB.waitForTimeout(400);
  const modalErrorText = await pageB.locator('#modal-error').textContent();
  check('senha de admin errada: modal mostra erro, continua aberto', /inválidos/i.test(modalErrorText), modalErrorText);

  // Agora a senha certa
  await pageB.fill('#approval-password', 'admin123');
  await pageB.click('#confirm-approval-btn');
  await pageB.waitForTimeout(500);
  const modalClosed = await pageB.locator('#approval-username').count();
  check('senha de admin certa: modal fecha, venda concluída', modalClosed === 0, modalClosed);
  const bSaleRowText = await pageB.locator('#sales-tbody tr').first().textContent();
  check('venda com desconto aparece no histórico (total líquido R$ 70,00)', bSaleRowText.includes('70,00'), bSaleRowText.replace(/\s+/g, ' '));

  // --- Backup: exportar na máquina A ---
  await pageA.fill('#backup-password', 'senhaBackup123');
  const [download] = await Promise.all([
    pageA.waitForEvent('download'),
    pageA.click('#backup-export-btn'),
  ]);
  const backupPath = path.join(__dirname, 'test-backup-download.json');
  await download.saveAs(backupPath);
  const backupExists = fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0;
  check('arquivo de backup baixado com conteúdo', backupExists, backupExists);

  // Cria mais um produto DEPOIS do backup, pra provar que restaurar desfaz
  await pageA.fill('#f-barcode', 'SEC-DEMO-02-POS-BACKUP');
  await pageA.fill('#f-name', 'Produto pós-backup');
  await pageA.fill('#f-price', '1');
  await pageA.click('#add-btn');
  await pageA.waitForTimeout(400);
  const productCountBeforeRestore = await pageA.locator('#products-tbody tr').count();
  check('produto extra criado depois do backup (2 produtos no total)', productCountBeforeRestore === 2, productCountBeforeRestore);

  // Restaura o backup
  await pageA.setInputFiles('#backup-file', backupPath);
  await pageA.fill('#backup-import-password', 'senhaBackup123');
  await pageA.click('#backup-preview-btn');
  await pageA.waitForTimeout(400);
  const previewText = await pageA.locator('#backup-preview-box').textContent();
  check('prévia do backup mostra contagem de produtos (1 no arquivo)', /Produtos: 2 → 1/.test(previewText) || /Produtos:\s*2\s*→\s*1/.test(previewText), previewText);

  pageA.once('dialog', (d) => d.accept());
  await pageA.click('#backup-import-btn');
  await pageA.waitForTimeout(1500); // location.reload() acontece aqui

  // Máquina B, sem fazer nada, também recarrega sozinha (WS 'backup-restored')
  await pageB.waitForTimeout(1000);
  const bStillLoggedInAfterReload = await pageB.locator('#login-box').isVisible().catch(() => true);

  await pageA.waitForSelector('#login-box', { state: 'visible', timeout: 10000 }).catch(() => {});
  const productCountAfterRestore = await pageA.locator('#products-tbody tr').count().catch(() => -1);

  console.log('\nerros JS máquina A:', errorsA.length, JSON.stringify(errorsA));
  console.log('erros JS máquina B:', errorsB.length, JSON.stringify(errorsB));
  console.log('B mostra tela de login após o restore (recarregou sozinha):', bStillLoggedInAfterReload);
  const ok = results.every(Boolean) && errorsA.length === 0 && errorsB.length === 0;
  console.log('\n' + (ok ? 'TUDO OK — SEGURANÇA MULTI-TERMINAL FUNCIONANDO' : 'ALGO FALHOU'));
  fs.unlinkSync(backupPath);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
