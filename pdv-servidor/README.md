# pdv-servidor — protótipo multi-terminal (SQL + rede local)

Protótipo de um **produto separado** do PDV - C&S Virtual: em vez da extensão
Chrome atual (100% local, IndexedDB, um navegador só, sem sincronização —
decisão de projeto documentada na política de privacidade), este é um
servidor Node.js que roda numa máquina da loja e serve o sistema, por rede,
pra quantos terminais quiser (outros PCs, Chromebooks, celular) — todos
enxergando o mesmo estoque/vendas/caixa em tempo real, sem instalar nada
neles além de um navegador comum.

**Este código não afeta `pdv-extension/` em nada.** Os dois convivem no
mesmo repositório como produtos distintos.

## Estado atual (resumo pra quem chegar aqui sem contexto)

Construído entre 31/ago e 1º/set (fases 1 a 8 do roteiro abaixo), sem
nenhuma decisão registrada de abandono — o trabalho só parou e o foco
voltou pra extensão Chrome. Ficou **8 sessões inteiras esquecido** num
scratchpad efêmero antes de ser recuperado e trazido pro repositório em
07/set — daí este README existir: pra isso nunca mais acontecer.

**Roda de verdade hoje** (testado antes deste commit): `npm install &&
node seed.js && node server.js` sobe em segundos, `/api/status` responde
`{"ok":true}`.

**Achado (09/set, ao portar productsRepo/stockRepo — ver Fase 9 abaixo):**
rodando a suíte `test-*.cjs` completa NESTE ambiente sandboxed específico,
4 dos testes "-multiterminal" das fases 2, 5, 6 e 8 (`test-sales-multiterminal`,
`test-purchases-finance-multiterminal`, `test-loyalty-carreto-multiterminal`,
`test-security-multiterminal`) falham por timeout — confirmado que já
falhavam do MESMO jeito no código original, sem nenhuma mudança desta
sessão (testado revertendo routes/products.js pro estado do commit
anterior e rodando de novo). Não é regressão de nada feito aqui, e a
versão sem "-multiterminal" de cada um desses 4 passa normalmente — mas é
uma falha real neste ambiente, provavelmente timing de WebSocket/Playwright
específico deste sandbox (o resto da suíte, incluindo outros testes
"-multiterminal" como cash/users, passa). Fica registrado como gap
conhecido a investigar — não interfere no que este passo da Fase 9
entrega, mas não deveria ser esquecido como os problemas anteriores.

## Roteiro — 10 fases

| # | Fase | Status |
|---|------|--------|
| 1 | Esqueleto: servidor + SQLite + login compartilhado + Estoque em tempo real | ✅ feita, testada (`demo-fase*` não existe pra 1 — foi o `test-multi-terminal.cjs` inicial) |
| 2 | Vendas (PDV) + Histórico, baixa de estoque atômica | ✅ feita, testada (`demo-fase2.cjs`, `test-sales-*.cjs`) |
| 3 | Caixa — modo Único (loja toda) ou Por terminal, configurável | ✅ feita, testada (`demo-fase3.cjs`, `test-cash*.cjs`) |
| 4 | Clientes e fiado (extrato, limite, pagamento) | ✅ feita, testada (`demo-fase4.cjs`, `test-fiado*.cjs`) |
| 5 | Compras/fornecedores + Financeiro (contas a pagar/receber) | ✅ feita, testada (`demo-fase5.cjs`, `test-purchases-finance*.cjs`) |
| 6 | Carreto (entregas) + Fidelidade (pontos) | ✅ feita, testada (`demo-fase6.cjs`, `test-loyalty-carreto*.cjs`) |
| 7 | Usuários, 13 permissões granulares, log de auditoria | ✅ feita, testada (`demo-fase7.cjs`, `test-users*.cjs`) |
| 8 | Segurança: bloqueio por força bruta, autorização de desconto, backup criptografado round-trip | ✅ feita, testada (`demo-fase8.cjs`, `test-security*.cjs`) |
| 9 | **Interface final** — trocar `public/test.html` (tela de prova de conceito) pelas telas reais da extensão (`pdv-extension/app/js/views/*.js`), com uma camada de dados nova que fala HTTP/WebSocket em vez de IndexedDB | 🟡 em andamento — `session.js`, `productsRepo.js`, `stockRepo.js`, `suppliersRepo.js` e `auditRepo.js` prontos e testados (09/set); todos os 4 repositórios que `views/products.js` (Estoque) usa direto estão prontos. Faltam os 5 que `views/sale.js` (PDV) puxa (ver abaixo) |
| 10 | Empacotamento — instalador `.exe`, serviço do Windows, ícone de bandeja, pra rodar sem terminal | ⚪ não iniciada |

**Por que views/*.js deve ser reaproveitável quase inteiro na Fase 9:** na
extensão, toda tela só fala com `data/*Repo.js` — nunca direto com
IndexedDB. Trocar o motor por baixo (repo que fala com este servidor em vez
de IndexedDB) não deveria exigir redesenhar nenhuma tela, na maioria dos
casos. Ainda não verificado na prática — é o primeiro risco real da Fase 9.

## Decisões de arquitetura já fechadas

- **Servidor também serve a tela** (não é "extensão fala com servidor") —
  zero instalação nas máquinas-cliente, só abrir o navegador no IP do
  servidor. Evita permissão de rede local no `manifest.json` (que dispararia
  revisão nova da Google Chrome Web Store a cada versão).
- **Caixa configurável**: campo de política nova em Dados da loja —
  **Único** (uma sessão de caixa pra loja toda, qualquer terminal opera
  nela) ou **Por terminal** (cada estação física com seu próprio caixa,
  independente; Painel soma tudo pra visão consolidada). Ligado à
  *máquina*, não ao usuário — o dinheiro físico fica preso à gaveta, não
  anda com o vendedor.
- **Acesso remoto** (fora da rede da loja), se um dia for pedido: Tailscale
  (rede privada virtual, criptografado, sem IP fixo nem porta aberta no
  roteador) — nunca abrir porta + DNS dinâmico, que expõe o servidor à
  internet inteira. Bloqueador antes disso: falta HTTPS de verdade e
  revisão de segurança adicional.
- **Empacotamento** (Fase 10): instalador Windows com Node.js embutido +
  serviço do Windows (liga sozinho, sobrevive a reinício) + ícone de
  bandeja como espelho visual/controle manual.

## Como rodar

```
cd pdv-servidor
npm install
node seed.js      # cria admin/admin123 — troque a senha depois de logar
node server.js    # mostra os endereços de rede (ex: http://192.168.x.x:3131)
```

Abre `http://localhost:3131/test.html` (ou o IP mostrado, de outra
máquina/aba) — é a tela de prova de conceito da Fase 1-8, não a interface
real (isso é a Fase 9).

## Estrutura

- `server.js` — monta o Express, WebSocket, sessão por cookie, todas as rotas.
- `db/schema.sql` + `db/index.js` — schema SQLite (19 tabelas, espelhando
  1:1 os "object stores" do IndexedDB da extensão — ver `pdv-extension/app/js/db.js`).
- `lib/` — auth (mesmo hash PBKDF2 da extensão, 100% compatível), sessão,
  permissões, bloqueio de login, backup/criptografia, broadcast WebSocket,
  config de empresa/fidelidade, ledger de fidelidade, sessão de caixa.
- `routes/` — um arquivo por domínio (auth, products, sales, cash,
  customers, suppliers, purchases, finance, loyalty, deliveries, users,
  audit, company, backup) — 13 domínios, cobrindo praticamente o sistema
  inteiro.
- `test-*.cjs` — testes de regressão reais (rodam contra um servidor de
  verdade em `localhost:3131`, via `fetch`), incluindo a variante
  `*-multiterminal.cjs` de cada um (duas "máquinas" simuladas por conexões
  HTTP/WebSocket separadas, confirmando que uma vê o que a outra fez em
  tempo real). Rodar: sobe o servidor (`node server.js`) numa janela,
  `node test-nome.cjs` noutra.
- `demo-fase*.cjs` — scripts que dirigem a UI de teste via Playwright pra
  gerar as capturas em `demo-screenshots/`, prova visual de cada fase
  funcionando com duas máquinas isoladas vendo o mesmo dado.

## Próximo passo recomendado

**Achado de escopo (07/set, checado antes de começar a codar):** a ideia
original de "uma tela só como prova" (ex: só Estoque) não se sustenta —
`views/products.js` importa `views/sale.js` (pro fluxo de "código de barras
desconhecido durante a venda") e vice-versa (`sale.js` chama
`promptUnknownBarcode` de `products.js`), um import circular real entre as
duas telas. `sale.js` sozinho já puxa 8 módulos de dados diferentes
(`productsRepo`, `salesRepo`, `deliveriesRepo`, `auditRepo`, `companyRepo`,
`cashRepo`, `customersRepo`, e `session.js` pro crédito de troca pendente).
Ou seja: **Estoque e PDV não são fatiáveis um sem o outro** — o primeiro
slice real da Fase 9 é maior do que "uma tela", é esse par acoplado mais uns
8 repositórios reescritos pra falar com o servidor em vez de IndexedDB, e
um `session.js` novo baseado em cookie de sessão em vez de
`chrome.storage.session`.

Isso não invalida a arquitetura (a promessa "a tela só fala com a camada de
dados" continua valendo — nenhuma tela precisa saber IndexedDB vs HTTP) só
avisa que o primeiro corte de validação é maior que o antecipado. Plano
revisado pro início da Fase 9:
1. ✅ **`session.js` novo** (09/set) — `public/js/session.js`, mesmo
   contrato do `session.js` da extensão (`getSessionUserId`,
   `setSessionUserId`, `onSessionUserIdChanged`, `clearSession`,
   `getPendingCredit`/`setPendingCredit`/`clearPendingCredit`/
   `addPendingCredit`, `touchActivity`/`getIdleMs`/`IDLE_LIMIT_MS`),
   backed pelo cookie de sessão do servidor (`/api/auth/*`, que já
   existia desde a Fase 8) em vez de `chrome.storage.session`. Testado em
   `test-session.cjs` (15 asserções, harness em `public/test-session.html`) —
   inclusive o ponto mais frágil do porte: o evento nativo `storage` do
   navegador **não** dispara na aba que fez a mudança (diferente de
   `chrome.storage.onChanged`, que dispara em todas, inclusive a
   escritora) — sem compensar isso com um pub/sub local, `login.js`
   pararia de re-renderizar a própria aba depois do login. Provado: o
   teste falha exatamente nessa asserção se o pub/sub local for removido
   (checado manualmente antes de commitar), passa com ele.
2. ✅ **`productsRepo.js` + `stockRepo.js` novos** (09/set) —
   `public/js/data/productsRepo.js` e `public/js/data/stockRepo.js`, mesmo
   contrato dos repositórios da extensão (`listProducts`, `getProduct`,
   `getByBarcode`, `searchProducts`, `createProduct`, `updateProduct`,
   `setProductActive`, `deleteProduct` / `recordMovement`,
   `listMovementsByProduct`, `recordManualAdjustment`), sobre um
   `apiClient.js` novo compartilhado (fetch + terminal id + dedupeKey,
   extraído do protótipo em `test.html`, reaproveitável pelos próximos
   repositórios). `routes/products.js` deixou de ser o CRUD simplificado
   da Fase 1 e virou o repo de verdade: permissão granular re-conferida
   no servidor por rota (`manageProducts`/`toggleProduct`/`deleteProduct`/
   `adjustStock`, os 4 já previstos em `lib/permissions.js` desde a Fase 7
   mas nunca antes aplicados aqui), suporte a unidade "personalizado"
   (múltiplas formas de venda, mesma validação da extensão), e
   movimentação de estoque de verdade — baixa/alta de `quantity` +
   registro em `stock_movements` na MESMA transação SQLite, com
   `dedupeKey` contra reenvio (mesmo padrão já usado em `sales.js` desde a
   Fase 2). Testado em `test-products-repo.cjs` (42 asserções, harness em
   `public/test-products-repo.html`), cobrindo validação na fonte,
   permissão negada/concedida pra um vendedor real (não só admin),
   atomicidade (tentativa de deixar estoque negativo não muda nada),
   dedupe, e consistência entre duas sessões/máquinas diferentes.
   Achado real corrigido no processo: `getProduct(id)` da extensão
   devolve `null`/`undefined` pra um id inexistente e NUNCA lança erro —
   `salesRepo.js#pricePreview` depende exatamente disso
   (`if (!product) {...}`); a rota GET `/api/products/:id` inicialmente
   devolvia 404, o que viraria uma exceção não tratada quando `sale.js`
   for portado — corrigido pra sempre `200` com `product: null`. Achado
   secundário: reescrever `routes/products.js` quebrou 6 chamadas em
   testes de fases ANTERIORES (`test-cash`, `test-fiado`,
   `test-loyalty-carreto`, `test-sales-concurrency`, `test-security`, e
   `public/test.html`) que usavam o endpoint antigo
   `/ajustar-estoque` — atualizadas pro novo `/movimentos` antes de
   considerar este passo pronto (a suíte inteira das fases 1-8 foi
   rerrodada depois, ver achado no topo deste README sobre 4 testes
   "-multiterminal" que já falhavam antes desta mudança, confirmado por
   comparação direta).
3. ✅ **`suppliersRepo.js` + `auditRepo.js` novos** (09/set) —
   `public/js/data/suppliersRepo.js` e `public/js/data/auditRepo.js`,
   mesmo contrato dos repositórios da extensão (`listSuppliers`,
   `getSupplier`, `createSupplier`, `updateSupplier`,
   `setSupplierActive`, `deleteSupplier` / `logAction`). Testado em
   `test-suppliers-audit-repo.cjs` (24 asserções, harness em
   `public/test-suppliers-audit-repo.html`).
   Dois achados de permissão corrigidos no processo, ambos do mesmo
   formato "leitura/escrita de um recurso precisam de gates diferentes,
   não dá pra usar UM `requirePermission` fixo no mount inteiro" (mesma
   classe do achado da Fase 9 anterior sobre `getProduct`, mas agora do
   lado de acesso, não de forma de resposta):
   - **Fornecedores**: o mount de `/api/suppliers` em `server.js` exigia
     `'compras'` pra TUDO, inclusive listar/ver — mas
     `app/js/data/suppliersRepo.js` da extensão deixa
     `listSuppliers`/`getSupplier` propositalmente sem permissão, porque
     Estoque (`manageProducts`, não `compras`) precisa ler a lista pra
     preencher o fornecedor padrão de um produto. Com o gate antigo, um
     vendedor sem `'compras'` não conseguiria nem abrir o formulário de
     produto direito. Corrigido: gate saiu do mount, foi pra dentro de
     `routes/suppliers.js`, só em POST/PUT/DELETE.
   - **Log de auditoria**: o mount de `/api/audit` exigia `'logs'` pra
     TUDO — mas não existia rota de ESCREVER (POST) até este passo; toda
     escrita de log até agora era feita só de dentro de outras rotas
     (`login`, gestão de usuários, backup). `logAction()` da extensão não
     tem permissão própria (loga a PRÓPRIA ação de quem chama, depois que
     ela já passou pelo gate certo no repositório de origem) — só a
     LEITURA (`views/logs.js`) exige `'logs'`. Adicionado `POST
     /api/audit` sem gate de permissão (só `requireAuth`), com
     `userId`/`userName`/`role` sempre resolvidos da sessão real do
     servidor — testado com `fetch` cru mandando identidade forjada no
     corpo do pedido, confirmando que o servidor ignora e usa a sessão de
     verdade (não só que o módulo cliente "se comporta bem" e nunca manda
     esses campos).
4. Faltam ainda `salesRepo`, `deliveriesRepo`, `companyRepo`, `cashRepo`,
   `customersRepo` (que `sale.js` puxa) — não iniciado.
5. Só então testar Estoque + PDV juntos, multi-terminal, com a UI real —
   mesmo rigor de teste das fases 1-8 (concorrência, dedupe, nada de
   estoque ficando negativo com duas máquinas vendendo ao mesmo tempo).

Passos 4-5 não iniciados ainda — é trabalho de verdade (múltiplas
sessões), não um ajuste, e mexe com dinheiro/estoque, então merece o
mesmo cuidado de teste que o resto do projeto sempre teve antes de
qualquer linha ir pra produção.
