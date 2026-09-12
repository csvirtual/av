// Exportar/Importar CSV de produtos — a ponte de migração de catálogo com
// o pdv-servidor (mesmo formato de colunas nos dois, ver
// app/js/utils/csv.js). Cobre: exportação com o conteúdo certo (inclusive
// fornecedor e status ativo/inativo), importação cria produto novo com
// estoque inicial, reimportar um código de barras já existente só atualiza
// cadastro (nunca mexe na quantidade), linha malformada é reportada sem
// travar as linhas válidas, categoria que só existe no pdv-servidor
// ('loja') cai pra 'material' em vez de quebrar, fornecedor casado por
// nome, fornecedor desconhecido vira aviso (não erro), e status
// ativo/inativo é aplicado no cadastro/atualização.
const { test, expect } = require('../fixtures');
const { completeSetupWizard, seedProduct, goTo } = require('../helpers');

const HEADER = 'barcode,name,category,unit,customUnitLabel,price,costPrice,quantity,minStock,supplierName,active,expiryDate,expiryPromoDays,promoPrice,customForms';

test.describe('Estoque — Exportar/Importar CSV', () => {
  test('Exportar CSV baixa um arquivo com o produto certo, incluindo fornecedor e status', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    const productId = await seedProduct(page, { barcode: '7891000400101', name: 'Cimento CPII 50kg', price: 32.5, qty: 12, minStock: 5 });
    await page.evaluate(async ({ productId }) => {
      const { createSupplier } = await import('./js/data/suppliersRepo.js');
      const { updateProduct } = await import('./js/data/productsRepo.js');
      const supplier = await createSupplier({ nome: 'Fornecedor Teste CSV' });
      await updateProduct(productId, { supplierId: supplier.id });
    }, { productId });
    await goTo(page, '#/estoque');

    await page.click('#csv-menu-btn');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.row-options-item:has-text("Exportar CSV")'),
    ]);
    const path = await download.path();
    const text = require('fs').readFileSync(path, 'utf-8').replace(/^﻿/, '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(HEADER);
    const row = lines.find((l) => l.includes('7891000400101'));
    expect(row).toContain('Cimento CPII 50kg');
    expect(row).toContain('Fornecedor Teste CSV');
    expect(row).toContain(',sim,'); // ativo
  });

  test('Importar CSV cria produto novo com estoque inicial', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const csv = [HEADER, '7891000400202,Areia média m³,material,un,,45.9,30,8,2,,,,,,'].join('\r\n');
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
    expect(product.active).toBe(true);
  });

  test('Reimportar o mesmo código de barras atualiza cadastro mas NUNCA mexe na quantidade', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await seedProduct(page, { barcode: '7891000400303', name: 'Tijolo 6 furos', price: 0.85, qty: 500 });
    await goTo(page, '#/estoque');

    // CSV com preço novo e uma quantidade BEM diferente (10) — a quantidade
    // real (500, já vendida/movimentada de verdade desde o cadastro) tem
    // que sobreviver intacta a uma reimportação que só corrige o preço.
    const csv = [HEADER, '7891000400303,Tijolo 6 furos,material,un,,0.95,0.6,10,0,,,,,,'].join('\r\n');
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
      HEADER,
      ',Produto sem código,material,un,,10,5,1,0,,,,,,',
      '7891000400404,Prego 18x27,material,un,,12,8,20,3,,,,,,',
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

    const csv = [HEADER, '7891000400505,Chaveiro promocional,loja,un,,3,1,50,10,,,,,,'].join('\r\n');
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

  test('Fornecedor é casado por nome (existente) e produto entra inativo quando a coluna active diz "não"', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await page.evaluate(async () => {
      const { createSupplier } = await import('./js/data/suppliersRepo.js');
      await createSupplier({ nome: 'Distribuidora ABC' });
    });
    await goTo(page, '#/estoque');

    const csv = [HEADER, '7891000400606,Pia de granito,material,un,,220,150,3,1,Distribuidora ABC,não,,,,'].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('1 produto(s) criado(s)');
    // Sem aviso: fornecedor existe, casou certo.
    await expect(page.locator('.modal')).not.toContainText('não encontrado');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      const { listSuppliers } = await import('./js/data/suppliersRepo.js');
      const p = await getByBarcode('7891000400606');
      const suppliers = await listSuppliers();
      return { ...p, supplierNome: suppliers.find((s) => s.id === p.supplierId)?.nome };
    });
    expect(product.supplierNome).toBe('Distribuidora ABC');
    expect(product.active).toBe(false);
  });

  test('Fornecedor desconhecido no CSV vira aviso (não erro) e o produto é criado sem fornecedor', async ({ appPage: page }) => {
    await completeSetupWizard(page);
    await goTo(page, '#/estoque');

    const csv = [HEADER, '7891000400707,Torneira cromada,material,un,,45,25,10,2,Fornecedor Inexistente,,,,,'].join('\r\n');
    await page.setInputFiles('#csv-import-input', {
      name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForSelector('.modal:has-text("Resultado da importação")');
    await expect(page.locator('.modal')).toContainText('1 produto(s) criado(s)');
    await expect(page.locator('.modal')).toContainText('1 aviso(s)');
    await expect(page.locator('.modal')).toContainText('Fornecedor Inexistente" não encontrado');
    await page.click('.modal button:has-text("Fechar")');

    const product = await page.evaluate(async () => {
      const { getByBarcode } = await import('./js/data/productsRepo.js');
      return getByBarcode('7891000400707');
    });
    expect(product.supplierId).toBeNull();
    expect(product.active).toBe(true);
  });

  test('Exportar CSV protege contra injeção de fórmula (nome começando com =, +, -, @)', async ({ appPage: page }) => {
    // Achado de auditoria (Red Team): sem essa proteção, um produto
    // cadastrado com nome `=cmd|'/c calc'!A1` saía CRU no CSV exportado —
    // Excel/Sheets/LibreOffice interpretam isso como fórmula ao abrir o
    // arquivo, não como texto. Mitigação: prefixo de aspas simples (padrão
    // OWASP) força a planilha a tratar como texto puro.
    await completeSetupWizard(page);
    await page.evaluate(async () => {
      const { createProduct } = await import('./js/data/productsRepo.js');
      await createProduct({ barcode: '7891000400808', name: '=cmd|\'/c calc\'!A1', price: 10, category: 'material', unit: 'un' });
      await createProduct({ barcode: '7891000400809', name: '+HYPERLINK("http://evil.example")', price: 10, category: 'material', unit: 'un' });
    });
    await goTo(page, '#/estoque');

    await page.click('#csv-menu-btn');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.row-options-item:has-text("Exportar CSV")'),
    ]);
    const path = await download.path();
    const text = require('fs').readFileSync(path, 'utf-8').replace(/^﻿/, '');
    const line1 = text.split('\r\n').find((l) => l.includes('7891000400808'));
    const line2 = text.split('\r\n').find((l) => l.includes('7891000400809'));
    expect(line1).toContain(",'=cmd|");
    expect(line2).toContain('\'+HYPERLINK(');
  });
});
