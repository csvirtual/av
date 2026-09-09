// Emite uma chave de ativação assinada pro Co-piloto de vendas com IA.
// Roda só localmente, com a chave PRIVADA (gerada por
// gerar-par-de-chaves.mjs) — nunca dentro da extensão, nunca num servidor
// exposto sem cuidado extra.
//
// Uso:
//   node gerar-chave-ativacao.mjs --doc 12345678909 --chave ./chave-privada.jwk.json [--tipo full|demo] [--dias 365]
//
//   --doc   CPF (11 dígitos) ou CNPJ (14 dígitos) do titular da licença.
//           Só números ou com máscara — os não-dígitos são ignorados.
//   --chave Caminho do .jwk.json da chave PRIVADA (gerar-par-de-chaves.mjs).
//   --tipo  'full' (licença definitiva) ou 'demo' (licença com prazo,
//           pensada pra deixar alguém testar sem contar como o trial padrão
//           de 14 dias embutido na extensão). Padrão: full.
//   --dias  Validade em dias a partir de agora. Omitido = licença sem
//           validade (só faz sentido pra --tipo full; um 'demo' sem --dias
//           nunca expira, o que provavelmente não é a intenção).

import { readFileSync } from 'node:fs';
import { createPrivateKey, createSign } from 'node:crypto';

function argv(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : process.argv[i + 1];
}

// Mesmo algoritmo padrão da Receita usado em sales-copilot-extension/panel.js
// (cpfEhValido) e options.js (docLicencaEhValido) — repetido aqui de
// propósito: esta ferramenta roda fora da extensão, em Node puro, sem
// nenhum arquivo em comum com ela.
function calcDigitoVerificador(base, pesoInicial) {
  let soma = 0, peso = pesoInicial;
  for (let i = 0; i < base.length; i++) { soma += parseInt(base[i], 10) * peso; peso--; if (peso < 2) peso = 9; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function cpfEhValido(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const base9 = cpf.slice(0, 9);
  const d1 = calcDigitoVerificador(base9, 10);
  const d2 = calcDigitoVerificador(base9 + d1, 11);
  return cpf === base9 + String(d1) + String(d2);
}
function cnpjEhValido(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const base12 = cnpj.slice(0, 12);
  const d1 = calcDigitoVerificador(base12, 5);
  const d2 = calcDigitoVerificador(base12 + d1, 6);
  return cnpj === base12 + String(d1) + String(d2);
}

function b64UrlDeBuffer(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const doc = (argv('doc', '') || '').replace(/\D/g, '');
if (doc.length !== 11 && doc.length !== 14) {
  console.error('--doc precisa ter 11 dígitos (CPF) ou 14 (CNPJ). Recebido:', doc || '(vazio)');
  process.exit(1);
}
if (doc.length === 11 && !cpfEhValido(doc)) {
  console.error('CPF inválido (dígitos verificadores não conferem):', doc);
  process.exit(1);
}
if (doc.length === 14 && !cnpjEhValido(doc)) {
  console.error('CNPJ inválido (dígitos verificadores não conferem):', doc);
  process.exit(1);
}

const tipo = argv('tipo', 'full');
if (tipo !== 'full' && tipo !== 'demo') {
  console.error('--tipo precisa ser "full" ou "demo". Recebido:', tipo);
  process.exit(1);
}

const chavePath = argv('chave');
if (!chavePath) {
  console.error('--chave <caminho do .jwk.json da chave PRIVADA> é obrigatório.');
  process.exit(1);
}

const dias = argv('dias', null);
const payload = {
  doc,
  tipo,
  geradoEm: new Date().toISOString(),
  expiraEm: dias ? new Date(Date.now() + Number(dias) * 86400000).toISOString() : null,
};

const payloadB64 = b64UrlDeBuffer(Buffer.from(JSON.stringify(payload), 'utf8'));
const jwkPrivada = JSON.parse(readFileSync(chavePath, 'utf8'));
const chavePrivada = createPrivateKey({ key: jwkPrivada, format: 'jwk' });
// dsaEncoding: 'ieee-p1363' é o que faz esta assinatura (formato r||s, sem
// envelope ASN.1/DER) ser exatamente o que crypto.subtle.verify espera do
// lado da extensão — sem isto, a extensão nunca aceitaria nenhuma chave
// gerada aqui (formato incompatível, não um bug esporádico).
const assinatura = createSign('SHA256').update(payloadB64).sign({ key: chavePrivada, dsaEncoding: 'ieee-p1363' });

const chaveAtivacao = `${payloadB64}.${b64UrlDeBuffer(assinatura)}`;

console.log('Payload:', payload);
console.log('\nChave de ativação (cole na tela Configurações → Licenciamento):\n');
console.log(chaveAtivacao);
