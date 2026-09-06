// Helpers de alto nível reaproveitados por vários specs — cada um faz uma
// coisa que quase todo teste precisa fazer antes de chegar na
// funcionalidade que está sendo testada de verdade.

const DEFAULT_ADMIN = { nome: 'Roberto Almeida', username: 'roberto', password: 'senha123456' };

/** Preenche o wizard de primeiro uso (dados da loja + Administrador Geral)
 * e deixa a página no Painel, já logado. CNPJ/dados variam por teste só
 * quando o teste precisa disso — por padrão usa um CNPJ válido fixo. */
async function completeSetupWizard(page, overrides = {}) {
  const company = {
    cnpj: '12.345.678/0001-95',
    telefone: '71987654321',
    razaoSocial: 'Depósito Teste Ltda',
    nomeFantasia: 'Depósito Teste',
    logradouro: 'Rua Teste',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Salvador',
    uf: 'BA',
    cep: '41810-021',
    ...overrides.company,
  };
  const admin = { ...DEFAULT_ADMIN, ...overrides.admin };

  await page.click('#choice-new');
  await page.waitForTimeout(250);
  await page.fill('#cnpj', company.cnpj);
  await page.fill('#telefone', company.telefone);
  await page.fill('#razaoSocial', company.razaoSocial);
  await page.fill('#nomeFantasia', company.nomeFantasia);
  await page.fill('#logradouro', company.logradouro);
  await page.fill('#numero', company.numero);
  await page.fill('#bairro', company.bairro);
  await page.fill('#cidade', company.cidade);
  await page.selectOption('#uf', company.uf);
  await page.fill('#cep', company.cep);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);

  await page.fill('#nome', admin.nome);
  await page.fill('#username', admin.username);
  await page.fill('#password', admin.password);
  await page.fill('#confirmPassword', admin.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(900);

  // Primeiro login de cada usuário cai direto na Ajuda — não no Painel —
  // então login() cuida de navegar pra onde o teste precisa depois.
  if (await page.locator('#username').count()) {
    await login(page, admin.username, admin.password);
  }
}

/** Desloga direto pela sessão (sem passar pelo botão "Sair" + confirmação
 * — não é o que está sendo testado nos specs que precisam disso) e espera
 * a tela de login aparecer, pronta pra um próximo login(). */
async function logout(page) {
  await page.evaluate(async () => {
    const { clearSession } = await import('./js/session.js');
    await clearSession();
  });
  await page.waitForSelector('#username', { timeout: 15000 });
}

async function login(page, username, password) {
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(900);
}

async function goTo(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(500);
}

/** Cadastra um produto com estoque já disponível, direto pelo repositório
 * (não pela UI de Estoque) — os specs de PDV/estorno/estoque testam o que
 * acontece DEPOIS que o produto existe, então criar via UI a cada teste só
 * adicionaria passos irrelevantes ao que está sendo verificado. Roda dentro
 * da própria página, reaproveitando a sessão logada de verdade (as funções
 * do repo checam permissão do usuário ativo). */
async function seedProduct(page, { barcode, name, price = 10, qty = 100, minStock = 0 } = {}) {
  return page.evaluate(async ({ barcode, name, price, qty, minStock }) => {
    const { createProduct } = await import('./js/data/productsRepo.js');
    const { recordMovement } = await import('./js/data/stockRepo.js');
    const { getSessionUserId } = await import('./js/session.js');
    const { getUser } = await import('./js/data/usersRepo.js');
    const product = await createProduct({ barcode, name, price, minStock, unit: 'un', category: 'mercearia' });
    const userId = await getSessionUserId();
    const user = await getUser(userId);
    await recordMovement({
      productId: product.id,
      type: 'entrada',
      qty,
      userId,
      userName: user?.nome || 'Teste',
      note: 'Estoque inicial (seed de teste)',
    });
    return product.id;
  }, { barcode, name, price, qty, minStock });
}

/** Cadastra um cliente direto pelo repositório, mesma lógica de seedProduct. */
async function seedCustomer(page, { nome, telefone = '71999999999' } = {}) {
  return page.evaluate(async ({ nome, telefone }) => {
    const { createCustomer } = await import('./js/data/customersRepo.js');
    const customer = await createCustomer({ nome, telefone });
    return customer.id;
  }, { nome, telefone });
}

/** Busca `name` no PDV (Nova venda), adiciona o primeiro resultado ao
 * carrinho e cobre o pagamento com uma linha automática (senão
 * "Finalizar venda" fica desabilitado — ver sale.js#disableFinalize). */
async function addProductToCart(page, name) {
  await page.fill('#scan-input', name);
  await page.waitForTimeout(400); // debounce de busca (220ms) + render
  await page.locator('[data-pick]').first().click();
  await page.waitForTimeout(200);
  await page.click('#add-payment-btn');
  await page.waitForTimeout(150);
}

/** Faz uma venda simples de `productName` do início ao fim pela UI de
 * verdade (Nova venda → Finalizar → fecha o modal de sucesso) e devolve o
 * id dela. Usado por specs que precisam de uma venda real já existente
 * pra testar em cima (estorno, histórico). */
async function makeSimpleSale(page, productName) {
  await goTo(page, '#/venda');
  await addProductToCart(page, productName);
  await page.click('#finalize-btn');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    const { listSales } = await import('./js/data/salesRepo.js');
    const sales = await listSales();
    return sales[sales.length - 1].id;
  });
}

module.exports = { completeSetupWizard, login, logout, goTo, seedProduct, seedCustomer, addProductToCart, makeSimpleSale, DEFAULT_ADMIN };
