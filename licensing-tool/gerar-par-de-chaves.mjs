// Gera um par de chaves ECDSA P-256 novo pra assinar licenças do
// Co-piloto de vendas com IA (sales-copilot-extension/licensing/).
//
// Rode isto UMA VEZ (ou sempre que quiser trocar de chave por segurança),
// sempre no seu computador, nunca num ambiente compartilhado. A chave
// PRIVADA salva aqui é o segredo que emite licenças válidas — quem tiver
// esse arquivo consegue gerar licenças em nome do seu produto. NUNCA:
//   - coloque este arquivo dentro de sales-copilot-extension/ (ela vira
//     parte do pacote carregado pelo Chrome se acontecer isso);
//   - suba pro git (confira o .gitignore desta pasta);
//   - mande por e-mail/Slack/qualquer canal não criptografado.
//
// Uso: node gerar-par-de-chaves.mjs

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const ARQUIVO_PRIVADA = 'chave-privada.jwk.json';

if (existsSync(ARQUIVO_PRIVADA)) {
  console.error(`Já existe ${ARQUIVO_PRIVADA} nesta pasta — apagar/trocar a chave privada invalida`);
  console.error('TODAS as licenças já emitidas com ela (a extensão passaria a rejeitar todas). Se');
  console.error('a intenção é mesmo gerar uma chave nova, mova ou apague o arquivo atual primeiro.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const privJwk = privateKey.export({ format: 'jwk' });
const pubJwk = publicKey.export({ format: 'jwk' });
const pubJwkLimpo = { crv: pubJwk.crv, kty: pubJwk.kty, x: pubJwk.x, y: pubJwk.y };

writeFileSync(ARQUIVO_PRIVADA, JSON.stringify(privJwk, null, 2));

console.log(`Chave PRIVADA salva em ./${ARQUIVO_PRIVADA} — guarde com cuidado, nunca a compartilhe.\n`);
console.log('Chave PÚBLICA — cole exatamente este objeto na constante');
console.log('COPILOTO_LICENCA_CHAVE_PUBLICA_JWK em');
console.log('sales-copilot-extension/licensing/license-verifier.js (ela substitui a chave de');
console.log('testes que está lá agora):\n');
console.log(JSON.stringify(pubJwkLimpo, null, 2));
