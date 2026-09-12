// Exportar/Importar CSV de produtos — a ponte de migração de catálogo com
// o pdv-servidor (mesmo formato de colunas nos dois, ver
// app/js/utils/csv.js). Cobre: exportação com o conteúdo certo, importação
// cria produto novo com estoque inicial, reimportar um código de barras já
// existente só atualiza cadastro (nunca mexe na quantidade), linha
// malformada é reportada sem travar as linhas válidas, e categoria que só
// existe no pdv-servidor ('loja') cai pra 'material' em vez de quebrar.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedProduct, goTo } = require('../helpers');

test.describe('Estoque — Exportar/Importar CSV', () => {
  test('Exportar CSV baixa um arquivo com o produto certo', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400101', name: 'Cimento CPII 50kg', price: 32.5, qty: 12, minStock: 5 });
    await goTo(page, '#/estoque');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-csv-btn'),
    ]);
    const path = await download.path();
    const text = require('fs').readFileSync(path, 'utf-8').replace(/^﻿/, '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,expiryDate,expiryPromoDays,promoPrice,customForms');
    const row = lines.find((l) => l.includes('7891000400101'));
    expect(row).toContain('Cimento CPII 50kg');
    expect(row).toContain('12'); // quantidade
    expect(row).toContain('5'); // estoque mínimo
  });

  test('Importar CSV cria produto novo com estoque inicial', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const csv = [
      'barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,expiryDate,expiryPromoDays,promoPrice,customForms',
      '7891000400202,Areia média m³,material,un,,45.9,30,8,2,,,,',
    ].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('1 produto(s) criado(s)');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      return getByBarcode('7891000400202');
    });
    expect(product.name).toBe('Areia média m³');
    expect(product.price).toBe(45.9);
    expect(product.quantity).toBe(8);
    expect(product.minStock).toBe(2);
  });

  test('Reimportar o mesmo código de barras atualiza cadastro mas NUNCA mexe na quantidade', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400303', name: 'Tijolo 6 furos', price: 0.85, qty: 500 });
    await goTo(page, '#/estoque');

    // CSV com preço novo e uma quantidade BEM diferente (10) — a quantidade
    // real (500, já vendida/movimentada de verdade desde o cadastro) tem
    // que sobreviver intacta a uma reimportação que só corrige o preço.
    const csv = [
      'barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,expiryDate,expiryPromoDays,promoPrice,customForms',
      '7891000400303,Tijolo 6 furos,material,un,,0.95,0.6,10,0,,,,',
    ].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('0 produto(s) criado(s), 1 atualizado(s)');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      return getByBarcode('7891000400303');
    });
    expect(product.price).toBe(0.95);
    expect(product.quantity).toBe(500); // intocado
  });

  test('Linha sem código de barras é reportada como erro, sem travar as outras linhas', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const csv = [
      'barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,expiryDate,expiryPromoDays,promoPrice,customForms',
      ',Produto sem código,material,un,,10,5,1,0,,,,',
      '7891000400404,Prego 18x27,material,un,,12,8,20,3,,,,',
    ].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('1 produto(s) criado(s)');
    await expect(page.locator('.modal')).toContainText('1 linha(s) com erro');
    await expect(page.locator('.modal')).toContainText('código de barras vazio');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      return getByBarcode('7891000400404');
    });
    expect(product).toBeTruthy();
  });

  test('Categoria "loja" (só existe no pdv-servidor) cai pra "material" em vez de quebrar', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const csv = [
      'barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,expiryDate,expiryPromoDays,promoPrice,customForms',
      '7891000400505,Chaveiro promocional,loja,un,,3,1,50,10,,,,',
    ].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('1 produto(s) criado(s)');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      return getByBarcode('7891000400505');
    });
    expect(product.category).toBe('material');
  });
});
