# Ferramenta de licenciamento (offline, fora da extensão)

Emite as chaves de ativação verificadas por
`sales-copilot-extension/licensing/license-verifier.js` (Fase 9 da evolução
do Copiloto). Fica de propósito **fora** de `sales-copilot-extension/` — nada
aqui é carregado pela extensão, e é assim que a chave privada nunca entra no
pacote que roda no navegador do cliente.

Mesmo desenho (ECDSA P-256 + SHA-256, formato `payload.assinatura` em
base64url) já usado em produção por `pdv-extension/app/js/license.js`, só
generalizando `cnpj` para `doc` (CPF de autônomo OU CNPJ de empresa).

## Uso

1. **Uma única vez** (ou pra trocar de chave por segurança — invalida toda
   licença já emitida com a anterior):
   ```
   node gerar-par-de-chaves.mjs
   ```
   Salva `chave-privada.jwk.json` aqui (nunca comitar — ver `.gitignore`
   desta pasta) e imprime a chave pública a colar em
   `sales-copilot-extension/licensing/license-verifier.js`.

2. **Emitir uma licença**:
   ```
   node gerar-chave-ativacao.mjs --doc 12345678909 --chave ./chave-privada.jwk.json --tipo full
   node gerar-chave-ativacao.mjs --doc 12345678000190 --chave ./chave-privada.jwk.json --tipo demo --dias 30
   ```
   A chave impressa é o que o cliente cola em **Configurações →
   Licenciamento**, junto com o mesmo CPF/CNPJ passado em `--doc`.

## Segurança

- `chave-privada.jwk.json` é o segredo inteiro do sistema — quem tiver esse
  arquivo emite licença válida em nome do seu produto. Nunca em disco
  compartilhado, nunca em mensagem sem criptografia, nunca dentro de
  `sales-copilot-extension/`.
- A chave pública (a que vai para dentro da extensão) não é secreta —
  serve só pra **conferir** assinatura, nunca pra gerar uma.
- Trocar a chave privada invalida instantaneamente toda chave de ativação
  emitida com a anterior (a extensão só confia na chave pública que está
  hardcoded nela no momento).
