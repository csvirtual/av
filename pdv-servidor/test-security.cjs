// Fase 8 (segurança): API-level, sem navegador. Cobre: (1) bloqueio por
// força bruta após 2 tentativas de login incorretas seguidas para o mesmo
// usuário; (2) desconto acima do limite da loja exige autorização de
// admin (usuário+senha reconferidos de verdade), com bypass pra quem tem a
// permissão 'unlimitedDiscount' ou é admin; (3) exportar/restaurar backup
// criptografado, round-trip completo, com senha errada rejeitada; (4)
// política da loja (limite de desconto) só editável por quem tem 'empresa'.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function rawLogin(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

function api(cookie) {
  return async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
}

(async () => {
  const adminLogin = await rawLogin('admin', 'admin123');
  check('login do admin funcionou', adminLogin.status === 200, adminLogin.status);
  const callAdmin = api(adminLogin.cookie);

  // --- (1) bloqueio por força bruta ---
  const lockoutRes = await callAdmin('/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Alvo Lockout', username: 'alvolockout', password: 'senhaCerta123', permissions: {} }),
  });
  check('usuário de teste do lockout criado', lockoutRes.status === 201, lockoutRes.status);

  const wrong1 = await rawLogin('alvolockout', 'senhaErrada1');
  const wrong2 = await rawLogin('alvolockout', 'senhaErrada2');
  check('1ª tentativa errada: usuário ou senha incorretos (sem revelar nada)', wrong1.status === 401 && /incorretos/i.test(wrong1.body.error), wrong1.body.error);
  check('2ª tentativa errada também rejeitada normalmente', wrong2.status === 401, wrong2.status);

  const thirdEvenCorrect = await rawLogin('alvolockout', 'senhaCerta123');
  check('3ª tentativa (com a senha CERTA) é bloqueada por força bruta (429)', thirdEvenCorrect.status === 429, thirdEvenCorrect.status);
  check('mensagem de bloqueio menciona tempo de espera', /aguarde/i.test(thirdEvenCorrect.body.error), thirdEvenCorrect.body.error);

  const otherUserUnaffected = await rawLogin('admin', 'admin123');
  check('bloqueio é por usuário — outra conta (admin) loga normalmente', otherUserUnaffected.status === 200, otherUserUnaffected.status);

  // --- (2) aprovação de desconto acima do limite ---
  await callAdmin('/api/company', { method: 'PUT', body: JSON.stringify({ vendorMaxDiscountPercent: 10 }) });

  const sellerRes = await callAdmin('/api/users', {
    method: 'POST', body: JSON.stringify({ nome: 'Vendedor Desconto Teste', username: 'venddesconto', password: 'senha1234', permissions: {} }),
  });
  const sellerLogin = await rawLogin('venddesconto', 'senha1234');
  const callSeller = api(sellerLogin.cookie);

  await callAdmin('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'DESC-TEST-01', name: 'Item desconto', price: 100 }) });
  const product = (await callAdmin('/api/products')).body.products.find((p) => p.barcode === 'DESC-TEST-01');
  await callAdmin(`/api/products/${product.id}/movimentos`, { method: 'POST', body: JSON.stringify({ type: 'ajuste', qty: 100, dedupeKey: crypto.randomUUID() }) });

  // 30% de desconto (bem acima do limite de 10%) sem aprovação nenhuma
  const saleNoApproval = await callSeller('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 100 }],
      overallDiscountAmount: 30,
      payments: [{ method: 'Dinheiro', amount: 70 }],
      dedupeKey: 'dk-sec-sale1-' + Date.now(),
    }),
  });
  check('vendedor sem aprovação: desconto de 30% é rejeitado', saleNoApproval.status === 400 && /peça a autorização/i.test(saleNoApproval.body.error), saleNoApproval.body.error);

  const saleWrongApproval = await callSeller('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 100 }],
      overallDiscountAmount: 30,
      payments: [{ method: 'Dinheiro', amount: 70 }],
      discountApproval: { username: 'admin', password: 'senhaErrada' },
      dedupeKey: 'dk-sec-sale2-' + Date.now(),
    }),
  });
  check('vendedor com senha de admin ERRADA: rejeitado', saleWrongApproval.status === 400 && /inválidos/i.test(saleWrongApproval.body.error), saleWrongApproval.body.error);

  const saleRightApproval = await callSeller('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 100 }],
      overallDiscountAmount: 30,
      payments: [{ method: 'Dinheiro', amount: 70 }],
      discountApproval: { username: 'admin', password: 'admin123' },
      dedupeKey: 'dk-sec-sale3-' + Date.now(),
    }),
  });
  check('vendedor com senha de admin CERTA: desconto de 30% aceito', saleRightApproval.status === 201, saleRightApproval.status);
  check('venda registra quem aprovou o desconto', !!saleRightApproval.body.sale?.discountApprovedBy, saleRightApproval.body.sale && saleRightApproval.body.sale.discountApprovedBy);

  // vendedor com 'unlimitedDiscount' não precisa de aprovação nenhuma
  await callAdmin(`/api/users/${sellerRes.body.user.id}`, { method: 'PUT', body: JSON.stringify({ permissions: { unlimitedDiscount: true } }) });
  const saleBypass = await callSeller('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 100 }],
      overallDiscountAmount: 50,
      payments: [{ method: 'Dinheiro', amount: 50 }],
      dedupeKey: 'dk-sec-sale4-' + Date.now(),
    }),
  });
  check('vendedor com "unlimitedDiscount": desconto de 50% direto, sem aprovação', saleBypass.status === 201, saleBypass.status);

  // admin nunca precisa de aprovação, mesmo com desconto de 90%
  const saleAdminBypass = await callAdmin('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 1, unitPrice: 100 }],
      overallDiscountAmount: 90,
      payments: [{ method: 'Dinheiro', amount: 10 }],
      dedupeKey: 'dk-sec-sale5-' + Date.now(),
    }),
  });
  check('admin faz venda com 90% de desconto direto, sem aprovação nenhuma', saleAdminBypass.status === 201, saleAdminBypass.status);

  // vendedor sem 'empresa' não pode mudar a política de desconto
  const sellerTriesPolicy = await callSeller('/api/company', { method: 'PUT', body: JSON.stringify({ vendorMaxDiscountPercent: 100 }) });
  check('vendedor (sem "empresa") não muda a política de desconto', sellerTriesPolicy.status === 403, sellerTriesPolicy.status);

  // --- (3) backup criptografado ---
  const beforeProducts = (await callAdmin('/api/products')).body.products.length;
  const exportRes = await callAdmin('/api/backup/export', { method: 'POST', body: JSON.stringify({ password: 'backupSenha123' }) });
  check('backup exportado com sucesso', exportRes.status === 200 && !!exportRes.body.envelope, exportRes.status);
  const envelope = exportRes.body.envelope;

  const previewRes = await callAdmin('/api/backup/preview', { method: 'POST', body: JSON.stringify({ envelope, password: 'backupSenha123' }) });
  check('prévia do backup mostra a contagem certa de produtos', previewRes.status === 200 && previewRes.body.fileCounts.products === beforeProducts, previewRes.body.fileCounts && previewRes.body.fileCounts.products);

  const previewWrongPassword = await callAdmin('/api/backup/preview', { method: 'POST', body: JSON.stringify({ envelope, password: 'senhaErrada' }) });
  check('prévia com senha errada é rejeitada', previewWrongPassword.status === 400 && /senha incorreta/i.test(previewWrongPassword.body.error), previewWrongPassword.body.error);

  // Cria mais um produto DEPOIS do backup — a restauração precisa apagar este
  await callAdmin('/api/products', { method: 'POST', body: JSON.stringify({ barcode: 'DESC-TEST-02-POS-BACKUP', name: 'Produto pós-backup', price: 1 }) });
  const afterExtraProduct = (await callAdmin('/api/products')).body.products.length;
  check('produto extra criado depois do backup (pra provar que a restauração desfaz)', afterExtraProduct === beforeProducts + 1, afterExtraProduct);

  const importWrongPassword = await callAdmin('/api/backup/import', { method: 'POST', body: JSON.stringify({ envelope, password: 'senhaErrada' }) });
  check('restaurar com senha errada é rejeitado, nada é alterado', importWrongPassword.status === 400, importWrongPassword.status);
  const stillExtra = (await callAdmin('/api/products')).body.products.length;
  check('produto extra continua lá (restauração com senha errada não mexeu em nada)', stillExtra === beforeProducts + 1, stillExtra);

  const importRes = await callAdmin('/api/backup/import', { method: 'POST', body: JSON.stringify({ envelope, password: 'backupSenha123' }) });
  check('restauração com a senha certa aceita', importRes.status === 200, importRes.status);
  const afterRestore = (await callAdmin('/api/products')).body.products.length;
  check('produto criado depois do backup sumiu — voltou ao estado exportado', afterRestore === beforeProducts, afterRestore);

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
