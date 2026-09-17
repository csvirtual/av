// Achado de auditoria (pré-lançamento): o limite padrão do express.json()
// (100kb) era pequeno demais pro corpo de POST /api/backup/preview e
// /api/backup/import (routes/backup.js), que carrega o backup
// CRIPTOGRAFADO INTEIRO da loja em base64 dentro do próprio corpo JSON —
// qualquer loja real, depois de alguns meses de uso, teria um backup maior
// que isso e ficaria incapaz de restaurar o PRÓPRIO backup (413). Ao
// mesmo tempo, o handler de erro PADRÃO do Express (disparado tanto por
// payload grande demais quanto por JSON malformado) devolvia uma página
// HTML com stack trace, vazando o caminho de arquivo no disco do
// servidor. API-level, sem navegador.
const BASE = 'http://localhost:3131';
const results = [];
const check = (label, cond, detail) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label + (detail !== undefined ? ' | ' + detail : '')); };

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

(async () => {
  const cookie = await login();
  await fetch(`${BASE}/api/auth/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ currentPassword: 'admin123', newPassword: 'admin123SenhaNova' }),
  });

  // (1) Envelope de tamanho REALISTA (~200KB) — plausível pra qualquer loja
  // depois de alguns meses de uso. Antes do conserto, tomava 413 aqui
  // mesmo. Agora deve passar do limite de tamanho e falhar só na
  // descriptografia (o ciphertext é fake, é esperado dar "senha incorreta
  // ou arquivo corrompido" — o que importa é NÃO ser 413).
  const realisticCiphertext = Buffer.alloc(150000).toString('base64');
  const realisticRes = await fetch(`${BASE}/api/backup/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ envelope: { ciphertext: realisticCiphertext, salt: 'YWJj', iv: 'ZGVm' }, password: 'qualquer' }),
  });
  const realisticBody = await realisticRes.json().catch(() => ({}));
  check('envelope de tamanho realista (~200KB) NÃO é mais rejeitado por tamanho (413)', realisticRes.status !== 413, realisticRes.status);
  check('mensagem de erro continua vindo em JSON, nunca em HTML', typeof realisticBody.error === 'string', JSON.stringify(realisticBody).slice(0, 100));

  // (2) Payload genuinamente absurdo (~30MB) ainda precisa ser rejeitado —
  // nunca "sem limite nenhum" (isso seria DoS por payload).
  const hugeCiphertext = Buffer.alloc(30 * 1024 * 1024).toString('base64');
  const hugeRes = await fetch(`${BASE}/api/backup/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ envelope: { ciphertext: hugeCiphertext, salt: 'YWJj', iv: 'ZGVm' }, password: 'qualquer' }),
  });
  const hugeBody = await hugeRes.json().catch(() => ({ raw: 'não é JSON' }));
  check('payload absurdo (~30MB) continua sendo rejeitado (413)', hugeRes.status === 413, hugeRes.status);
  check('rejeição de payload grande vem em JSON limpo, nunca em HTML com stack trace', typeof hugeBody.error === 'string' && !JSON.stringify(hugeBody).includes('.js'), JSON.stringify(hugeBody).slice(0, 150));

  // (3) JSON malformado — mesmo raciocínio de não vazar detalhe interno.
  const malformedRes = await fetch(`${BASE}/api/backup/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: '{ isso nao e json valido',
  });
  const malformedBody = await malformedRes.json().catch(() => ({ raw: 'não é JSON' }));
  check('JSON malformado responde 400 (não a página de erro padrão do Express)', malformedRes.status === 400, malformedRes.status);
  check('erro de JSON malformado vem em JSON limpo, sem caminho de arquivo', typeof malformedBody.error === 'string' && !JSON.stringify(malformedBody).includes('/home') && !JSON.stringify(malformedBody).includes('.js:'), JSON.stringify(malformedBody).slice(0, 150));

  console.log('\n' + (results.every(Boolean) ? 'TUDO OK' : 'ALGO FALHOU'));
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
