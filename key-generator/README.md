# Gerador de Chaves — PDV C&S Virtual

Ferramenta local, separada da extensão, para gerar as chaves de ativação
verificadas por `pdv-extension/app/js/license.js`. Roda 100% no navegador
(HTML + JS puro, sem build), sem nenhuma chamada de rede — abra
`index.html` direto do disco.

## O que ela faz

- Gera (uma única vez) o par de chaves ECDSA P-256 usado para assinar
  chaves de ativação. A chave privada fica só neste computador,
  criptografada (AES-256-GCM, senha derivada via PBKDF2) numa entrada do
  `localStorage` do navegador; nunca é gravada em texto puro em nenhum
  arquivo.
- A chave pública gerada é a mesma já embutida em `PUBLIC_KEY_JWK` em
  `pdv-extension/app/js/license.js` — só serve para conferir assinatura,
  não é secreta.
- Emite chaves de ativação (`demo`, com expiração de 1h, ou `full`,
  definitiva) e códigos de liberação de edição de CNPJ (`cnpj-unlock`,
  expira em 24h), cada um amarrado a um CNPJ específico e assinado com a
  chave privada.
- Mantém um registro local das chaves já emitidas (busca, paginação,
  exportar/importar).

## Uso

1. Abra `index.html` num navegador, direto do arquivo (sem servidor).
2. Na primeira vez, defina uma senha mestra e gere o par de chaves — ou
   restaure um backup de chave privada já existente.
3. Preencha o CNPJ do cliente, escolha o tipo de chave e confirme.
4. Copie a chave gerada e envie ao cliente para ele colar em
   **Dados da loja** na extensão.

## Importante

- **Nunca comite ou compartilhe o backup da chave privada** (o arquivo
  baixado em "Exportar chave privada"). Mesmo criptografado com senha,
  ele é o único jeito de emitir chaves válidas para os clientes — se
  vazar, alguém pode tentar quebrar a senha offline. Guarde-o fora deste
  repositório, num lugar seguro (ex.: gerenciador de senhas, backup
  criptografado à parte).
- Gerar um novo par de chaves **invalida todas as chaves já emitidas**
  (a extensão só aceita assinaturas da chave pública embutida nela). Se
  já existe um par em uso, sempre restaure o backup em vez de gerar um
  novo.
- Esta pasta não faz parte da extensão nem do site publicado — não deve
  ser incluída ao empacotar a extensão para a Chrome Web Store nem
  referenciada em nenhuma página pública.
