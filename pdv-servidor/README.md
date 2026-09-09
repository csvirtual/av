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

**Suíte completa (22 arquivos `test-*.cjs`) roda 100% verde neste ambiente
hoje** — cada teste isolado, banco e servidor recém-subidos, é sempre a
fonte de verdade. Rodar todos em SEQUÊNCIA numa única bateria, porém,
segue mostrando flutuação de timing pontual neste sandbox específico
(confirmado de novo em 09/set, à tarde: `test-security-multiterminal`,
`test-multi-terminal` e `test-live-updates` "falharam" numa bateria
completa, os três em cliques/esperas do Playwright — nunca em asserção de
dado incorreto — e os três passaram limpos ao rodar de novo sozinhos,
banco fresco, logo em seguida). Continua parecendo timing/recursos deste
sandbox especificamente sob a carga de rodar tudo em sequência, não uma
falha real do código — mas registrado aqui de novo, com mais detalhe,
porque já se repetiu mais de uma vez e não deveria ser esquecido. Se
alguma dessas falhas voltar a acontecer isolada (não só numa bateria
completa), é hora de investigar a fundo.

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
| 9 | **Interface final** — trocar `public/test.html` (tela de prova de conceito) pelas telas reais da extensão (`pdv-extension/app/js/views/*.js`), com uma camada de dados nova que fala HTTP/WebSocket em vez de IndexedDB | 🟡 Estoque+PDV+Histórico de vendas+Clientes+Painel+Carreto+Usuários+Caixa+Compras+Financeiro+Logs+Relatórios completos, com atualização em tempo real, testados (09/set) — `session.js`, 16 repositórios (`productsRepo`, `stockRepo`, `suppliersRepo`, `purchasesRepo`, `financeRepo`, `reportsRepo`, `auditRepo`, `salesRepo`, `deliveriesRepo`, `companyRepo`, `cashRepo`, `customersRepo`, `usersRepo`, `loyaltyRepo`, `backupRepo`), `views/products.js`+`views/sale.js`+`views/salesHistory.js`+`views/clientes.js`+`views/dashboard.js`+`views/carreto.js`+`views/users.js`+`views/caixa.js`+`views/compras.js`+`views/financeiro.js`+`views/logs.js`+`views/relatorios.js` reais rodando contra o servidor sem reescrita, e `public/js/live.js` mantendo Estoque/PDV/Painel/Usuários em sincronia via WebSocket — `test-real-ui.cjs`, `test-live-updates.cjs`, `test-sales-history.cjs`, `test-clientes.cjs`, `test-dashboard.cjs`, `test-carreto.cjs`, `test-users.cjs`, `test-caixa.cjs`, `test-compras.cjs`, `test-financeiro.cjs`, `test-logs.cjs` e `test-relatorios.cjs` verdes. Achados de segurança/correção/performance reais corrigidos no caminho: `POST /:id/redefinir-senha` não tinha a trava contra escalonamento de privilégio que a extensão já tem (ver passo 11); duas rotas novas no Caixa (retificação e backup automático de fechamento) precisaram ser escritas do zero no servidor (ver passo 12); recebimento de pedido de compra corrompia o `costPrice` de produto `'personalizado'`, travado em 0 de propósito (ver passo 13); `GET /api/audit` carregava a tabela de log inteira na memória a cada leitura, corrigido pra scan por cursor (ver passo 15); relatórios ganharam agregação nova no servidor (`routes/reports.js`), nunca trazendo vendas cruas pro cliente (ver passo 16). Falta a última tela e o `app.js` completo (menu lateral, todas as rotas) — ver "Próximo passo recomendado" |
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

Abre `http://localhost:3131/` (ou o IP mostrado, de outra máquina/aba) —
login `admin`/`admin123`, telas reais de Estoque e PDV (ver Fase 9 abaixo;
o resto do sistema ainda não tem tela própria aqui). `test.html` continua
disponível em `http://localhost:3131/test.html`, prova de conceito da Fase
1-8 cobrindo os domínios que ainda não ganharam tela real.

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
4. ✅ **`salesRepo.js`, `deliveriesRepo.js`, `companyRepo.js`, `cashRepo.js`,
   `customersRepo.js` novos** (09/set) — com este commit, os 9
   repositórios que `views/products.js` + `views/sale.js` juntos precisam
   estão todos prontos. Escopo desta primeira fatia: só as funções que
   `sale.js` de fato chama (`createSale`, `createDelivery`, `getCompany`,
   `getOpenSession`, `getCustomerBalance`) — o resto de cada repo
   (`listSales`/`refundSaleItems`, `markDelivered`, `saveCompany`,
   `openSession`/`closeSession`, `createCustomer`/extrato) fica pra quando
   a view DONA de cada um (`salesHistory.js`, `carreto.js`, `company.js`,
   `caixa.js`, `clientes.js`) for a vez. Testado em `test-sale-repos.cjs`
   (23 asserções contra um servidor real, harness em
   `public/test-sale-repos.html`).

   **Dois achados de segurança sérios, não só de forma — dinheiro de
   verdade em risco**, encontrados ao comparar `routes/sales.js` (Fase 2,
   escrito antes de existir unidade "personalizado" ou preço promocional)
   contra o contrato real de `salesRepo.js#createSale` da extensão:
   - **Preço confiado do cliente.** A rota aceitava `item.unitPrice`
     do pedido quase sem reconferir (só checava que era um número finito).
     Um cliente malicioso (ou um bug de UI futuro) podia vender qualquer
     produto pelo preço que quisesse — e como isso nunca passa pelas
     checagens de `discountType`/`discountValue`, nunca aparecia como
     desconto nenhum, então nunca acionava a exigência de autorização de
     admin (que só olha desconto declarado, não o preço-base em si).
     Corrigido: preço agora SEMPRE vem de nova leitura do produto
     (`lib/pricing.js#resolveSaleItemPricing`, porta fiel de
     `resolveSaleItemPricing`/`effectivePrice`/`isNearExpiry` da
     extensão) — preço promocional automático se perto de vencer, ou o
     valor da forma de venda escolhida pra um produto "personalizado",
     nunca o que o pedido mandou. Provado: revertendo a correção, a venda
     de um produto de R$32 por R$0,01 forjado passava — com a correção,
     rejeitada (pagamento não bate com o preço real).
   - **Juro de parcelamento confiado do cliente.** Mesma classe: a rota
     aceitava `payment.interestAmount` do pedido sem recalcular nada — um
     cliente podia zerar o juro (perda de receita) ou inflar (cobrando
     mais do que a política da loja manda) só mudando o número. Corrigido:
     juro sempre recalculado no servidor via
     `lib/pricing.js#computeCreditInterest` (porta fiel, incluindo os
     tetos de sanidade de 100%/1200%), a partir da política gravada em
     Dados da loja — nunca do que o pedido mandou. Também suportado nesse
     mesmo passo: **produto "personalizado"** na venda (preço/custo/fator
     de estoque da forma escolhida, com o mesmo erro se a forma não
     existir mais) e **preço promocional por validade**, nenhum dos dois
     existia na rota antes.

   Achado de permissão, mesmo padrão já corrigido em suppliers/audit: o
   mount de `/api/company` exigia `'empresa'` pra TUDO, inclusive ler —
   mas `getCompany()` da extensão não tem permissão nenhuma (é a base do
   cálculo de desconto/juro que TODA venda precisa, não só quem administra
   a loja). Corrigido: só `PUT` (escrever a política) exige `'empresa'`
   agora; `GET` ficou aberto a qualquer usuário autenticado.

   Achado menor: `routes/deliveries.js` não tinha proteção nenhuma contra
   reenvio (duplo clique em "Criar carreto") — `deliveriesRepo.js#createDelivery`
   da extensão já reivindica um `dedupeKey` pra isso; portado aqui também,
   testado com o mesmo padrão de "primeira chamada aceita, reenvio com a
   mesma chave rejeitado" do resto do sistema.
5. ✅ **Interface real ligada** (09/set) — `public/index.html` +
   `public/js/app.js` (casca mínima, só login + as 2 rotas `#/estoque` e
   `#/venda`, documentada como tal — NÃO é o `app.js` completo da extensão,
   ver nota de escopo abaixo) hospedando `views/products.js` e
   `views/sale.js` **copiados sem nenhuma alteração** de
   `pdv-extension/app/js/views/`, junto com todos os `components/*.js` e
   `utils/*.js` de que dependem e `public/css/styles.css`. Confirma na
   prática a aposta de arquitetura do topo desta fase: as duas telas nunca
   sabem se estão falando com IndexedDB ou HTTP, só importam
   `data/*Repo.js`. Testado em `test-real-ui.cjs` (8 asserções, duas
   "máquinas" reais — contextos de navegador isolados, sem cookie
   compartilhado — cadastrando produto numa e vendendo na outra pela UI de
   produção, mesma metodologia das fases 1-8), incluindo as duas checagens
   adversárias que fecham o círculo dos achados de segurança do passo 4:
   confirma que a TELA em si nunca expõe um campo pra editar o preço
   unitário do item no carrinho, e que o estoque mostrado depois da venda é
   o valor que o SERVIDOR calculou, não o que o navegador imaginava.

   **Achados no processo:**
   - **Bloqueio de força bruta sem namespace, achado ao ligar
     `passwordConfirm.js`.** Sem isolar por namespace, um vendedor errando
     de propósito a senha do admin duas vezes no modal de aprovação de
     desconto trancaria o LOGIN de verdade do admin por 60s, repetível à
     vontade — um jeito fácil de atrapalhar o administrador de fora.
     Corrigido em `lib/loginLockout.js` (`keyFor(username, namespace)` agora
     compõe `` `${namespace}:${username}` ``) e `lib/verifyLogin.js`,
     threading um `namespace` opcional por todas as funções de estado do
     bloqueio; a checagem de senha do modal de aprovação de desconto em
     `routes/sales.js` passou a usar `{namespace: 'confirmPassword'}`,
     isolado do bloqueio do login real. Adicionado `POST /api/auth/verify`
     (confere usuário/senha sem criar sessão nova) pra sustentar esse fluxo
     do lado do cliente, também namespaced.
   - **`icon('logout', {size:14})` — um crash pego antes de rodar
     qualquer teste.** `icon.js` lança `Error` pra qualquer nome fora do
     mapa `PATHS`, e `'logout'` nunca existiu ali (a extensão usa texto
     simples "Sair", sem ícone, no botão de logout de verdade — conferido
     por grep). Um rascunho inicial da casca usou o ícone por engano, o que
     travaria a renderização do shell inteiro no primeiro carregamento.
     Corrigido antes de sequer subir o servidor pra testar, trocando pelo
     texto simples que a extensão de fato usa.
   - **Achado de metodologia de teste (não é bug do app):**
     `page.goto()` do Playwright pra um hash IDÊNTICO ao já aberto não
     dispara `hashchange` — o roteador desta casca mínima reage a esse
     evento, então a Máquina A parecia não ver a baixa de estoque feita
     pela Máquina B. Confirmado via `curl` direto contra o servidor (com
     cookie de sessão) que o dado já estava correto no banco — o bug era só
     na navegação do teste, não no app. Trocado por `page.reload()`, que
     reflete exatamente o que um vendedor real faria (um F5) até a próxima
     fase trazer atualização automática via WebSocket — gap já conhecido e
     documentado abaixo, não escopo deste passo.
   - Corrigido também: um 404 real de `/favicon.ico` (barulho no console,
     inofensivo) com `<link rel="icon" href="data:,">`, e um falso-positivo
     no próprio `test-real-ui.cjs` que contava respostas `HTTP 304` (cache
     de navegador válido após um `reload()`, comportamento normal) como
     erro de rede — `res.ok()` do Playwright trata qualquer status fora de
     200-299 como "não ok", 304 incluído.

   **Nota de escopo, documentada no topo de `public/js/app.js`:** esta
   casca é deliberadamente mínima — só login, `#/estoque` e `#/venda`, sem
   menu lateral completo, sem as ~15 rotas da extensão, sem timeout de
   inatividade, sem trava de aba única. Fica pra uma fase futura: casca
   completa e as demais telas (`salesHistory.js`, `caixa.js`, `clientes.js`,
   `company.js`, `users.js`, `compras.js`, `financeiro.js`, `carreto.js`,
   `logs.js`, `backup.js`, `dashboard.js`, `ajuda.js` — nenhuma ainda
   portada).
6. ✅ **Atualização em tempo real via WebSocket** (09/set) — fecha o gap
   que o passo 5 tinha deixado documentado (cada terminal só via o estado
   novo depois de um F5 manual). `public/js/live.js` novo (conexão ao
   `/ws` que já existe desde a Fase 1 — mesmo canal que `public/test.html`
   usa — com pub/sub simples e reconexão com backoff) mais um pedaço em
   `public/js/app.js`: cada rota escuta só os assuntos relevantes pra ela
   (`LIVE_TOPICS`), com um debounce de 500ms (várias mudanças em sequência,
   ex: uma venda que mexe em produto+cliente ao mesmo tempo, viram um só
   recarregamento) e um guarda simples — não recarrega a tela por baixo de
   um modal aberto (novo produto, ajuste de estoque, aprovação de desconto)
   até ele fechar. Testado em `test-live-updates.cjs` (4 asserções, duas
   máquinas reais): Estoque se atualiza sozinho quando outro terminal
   cadastra um produto ou vende (baixa de estoque aparece sem F5/navegação
   nenhuma), um modal aberto sobrevive a um recarregamento chegando ao
   mesmo tempo, e — a checagem mais importante do lote — o PDV **não** se
   recarrega sozinho.

   **Decisão de design, não bug:** a tela de PDV (`venda`) de propósito
   NÃO escuta `products-changed`. `sale.js` já busca o produto de novo no
   servidor a cada busca/adição ao carrinho — preço e estoque nunca ficam
   desatualizados no que importa, e o servidor revalida tudo de novo no
   fechamento da venda de qualquer jeito (achado de segurança do passo 4).
   Recarregar a tela inteira no meio de uma venda, por causa de uma
   mudança em QUALQUER produto da loja (não necessariamente um que está no
   carrinho), destruiria o foco de quem está digitando e arriscaria perder
   trabalho em andamento — um custo real sem ganho de correção nenhum.
   `venda` escuta só o que legitimamente muda sob os pés de uma venda em
   andamento sem estar no controle do vendedor: cliente (`customers-changed`,
   pro saldo de fiado), caixa (`cash-changed`/`cash-config-changed`) e
   política da loja (`company-changed`, novo — `routes/company.js` nunca
   avisava ninguém quando desconto/juro mudavam, corrigido no mesmo passo).

7. ✅ **`views/salesHistory.js` real ligada** (09/set) — terceira tela real
   (Estoque, PDV, agora Histórico de vendas), **copiada sem nenhuma
   alteração** de `pdv-extension/app/js/views/`, incluindo o fluxo completo
   de estorno (total ou por item). Novo em `public/js/data/`:
   `salesRepo.js#listSalesPage`/`summarizeSales`/`refundSaleItems`/
   `saleStatus` (as 4 funções que a extensão reservava "pra quando essa
   tela for a vez"), `usersRepo.js#listUsers` (filtro de vendedor) e
   `customersRepo.js#listCustomers` (busca de cliente do filtro). Toda a
   lógica pesada do estorno (atomicidade, crédito de estoque, redução
   proporcional de dívida fiada e de pontos de fidelidade, geração de
   crédito de troca) **já existia pronta em `routes/sales.js` desde a Fase
   2** — só faltava a UI real e o wrapper de cliente; nenhuma mudança
   nessa lógica foi necessária. Testado em `test-sales-history.cjs` (13
   asserções): listagem, filtro por vendedor, resumo (contagem + total
   líquido), detalhe de uma venda, estorno de ponta a ponta pela UI
   (crédito de volta ao estoque confirmado), e as adversárias que fecham o
   círculo — o servidor rejeita estornar mais do que foi vendido mesmo
   atacando a API direto (não só o campo `max` do formulário), e reenviar
   a MESMA chave de estorno (dedupeKey) é rejeitado com 409 em vez de
   estornar duas vezes.

   **Achado (pequeno, de forma):** a rota `POST /:id/refund` devolvia só
   `{ sale }` — mas o contrato de `refundSaleItems()` da extensão espera
   `{ sale, refund, debtReduced }` de volta (usado pro toast de
   confirmação: "Estorno de RS confirmado. Dívida do cliente reduzida em
   R$X"). Corrigido devolvendo os três — `refund` é sempre o último item
   de `sale.refunds` (a transação acabou de dar `push` nele), e
   `debtReduced` (calculado internamente pra gravar o lançamento de
   dívida, mas nunca retornado) agora sai da transação também. Achado de
   teste (não de app): `formatMoney()` usa `Intl.NumberFormat('pt-BR',
   ...)`, que separa "R$" do valor com um **espaço não-quebrável**
   (U+00A0), não um espaço comum — uma asserção com `.includes('R$
   20,00')` (espaço literal) nunca bate; corrigido pra regex com `\s`
   (que casa os dois), mesmo padrão que as outras asserções deste arquivo
   já usavam.

   **Decisão de UI, documentada em `public/js/app.js`:** a rota
   `historico` de propósito NÃO entra no `LIVE_TOPICS` da atualização em
   tempo real (passo 6) — filtro (vendedor/cliente/datas) e paginação
   ("Carregar mais") são estado só de tela, perdido a cada recarregamento;
   recarregar a lista inteira debaixo de quem está no meio de uma
   conferência de vendas, só porque outro terminal vendeu algo, custaria
   mais do que ajuda. Mesmo raciocínio já aplicado à tela de PDV no passo
   6.

8. ✅ **`views/clientes.js` real ligada** (09/set) — quarta tela real
   (Estoque, PDV, Histórico, agora Clientes), **copiada sem nenhuma
   alteração** de `pdv-extension/app/js/views/`. Junta 3 domínios: cadastro
   de cliente, extrato de fiado (com registro de pagamento), e fidelidade
   (extrato de pontos + resgate) — o primeiro contato desta fase com
   `loyaltyRepo.js` (novo) e uma leva grande de novas funções em
   `customersRepo.js` (`updateCustomer`, `setCustomerActive`,
   `deleteCustomer`, `listCustomerLedger`, `getAllBalances`,
   `recordPayment`, `isDebtOverdue`). Igual ao passo 7, toda a lógica
   pesada (atomicidade do pagamento/resgate, permissão de exclusão
   reconferida na fonte) já existia pronta em `routes/customers.js` e
   `routes/loyalty.js` desde as Fases 4 e 6 — nenhuma mudança de servidor
   foi necessária, só os wrappers de cliente e os 3 arquivos pequenos que
   faltavam (`components/saleDetail.js`, `components/maskedInput.js`,
   `utils/document.js` — este último com uma dependência escondida,
   `utils/cpf.js`/`utils/cnpj.js`, que não tinham vindo junto e quebravam
   o carregamento do módulo inteiro em produção, mesmo com a tela nunca
   aberta ainda — pego antes de qualquer teste, só checando os imports
   transitivos). Testado em `test-clientes.cjs` (15 asserções): cadastro,
   edição, inativar/reativar, venda fiada gerando dívida visível no
   extrato, pagamento parcial, extrato de pontos ganhos numa venda à
   vista, resgate de pontos, exclusão (com saldo zerado — a tela já
   bloqueia exclusão com dívida em aberto, herdado da extensão sem
   mudança nenhuma), e 4 adversárias: pagamento maior que a dívida
   rejeitado pelo servidor, reenvio da mesma chave de pagamento rejeitado
   (409), resgatar mais pontos do que o cliente tem rejeitado, e um
   vendedor sem a permissão `deleteCustomer` tentando excluir direto pela
   API (403) — não só escondido atrás de um botão que a tela poderia ou
   não mostrar.

   **Achado de arquitetura, não corrigido aqui — documentado em
   `public/js/data/loyaltyRepo.js`:** "crédito de troca" (gerado por um
   estorno com a opção marcada, ou por um resgate de pontos) tem DOIS
   destinos hoje, e eles não se falam. O servidor sempre grava o crédito
   de verdade, persistido e auditável, na tabela `store_credits` (mesmo
   nas rotas herdadas da Fase 2/6, sem mudança nenhuma). Mas
   `session.js#addPendingCredit()` — chamado pelas telas (`salesHistory.js`
   no estorno, `clientes.js` no resgate), sem alteração nenhuma vinda da
   extensão — grava esse mesmo valor só no `localStorage` DESTE terminal
   específico. `sale.js` (também sem alteração) só lê e aplica esse
   `pendingCredit` local como forma de pagamento "Crédito de troca" —
   nunca consulta o saldo persistido do servidor. Resultado prático: o
   crédito gerado num terminal só aparece pra gastar automaticamente
   NAQUELE MESMO terminal/sessão; noutro terminal, fica só no extrato
   (auditável, correto, nunca perdido ou duplicado — não é uma falha de
   integridade de dinheiro), mas sem aparecer como opção de pagamento
   sozinho. Não é um problema de segurança (nada permite gastar o mesmo
   crédito duas vezes — o servidor nunca LÊ o pendingCredit pra decidir
   nada) nem uma perda de dinheiro (o lançamento real nunca desaparece) —
   é uma lacuna de UX entre dois mecanismos válidos que ainda não foram
   unificados. Corrigir de verdade (ex: `sale.js` também consultar o saldo
   de `store_credits` do cliente) provavelmente exige mexer em `sale.js`
   — fora do princípio "portar sem reescrever" desta fase; fica anotado
   como candidato a uma fase futura dedicada a fechar essa lacuna.

9. ✅ **`views/dashboard.js` real ligada** (09/set) — quinta tela real
   (Estoque, PDV, Histórico, Clientes, agora Painel), **copiada sem
   nenhuma alteração** de `pdv-extension/app/js/views/`. É a tela mais
   visitada do sistema (rota padrão ao logar) e a que mais domínios junta
   de uma vez: produtos, vendas, caixa, clientes/fiado, fidelidade,
   empresa e carreto, todos num retrato só, com cartões clicáveis que
   levam pra cada tela (`ctx.navigate('vendas')`, `('caixa')`,
   `('carreto')` etc. — nomes de rota que o `views/dashboard.js` já
   chamava fixos, sem reescrita).

   **Achado real, corrigido antes de qualquer teste — nomes de rota
   divergentes:** ao portar o Histórico de vendas (passo 7), dei o nome
   `historico` à rota no `public/js/app.js` — mas a extensão usa `vendas`
   (conferido no `app.js` dela, `const ROUTES`). `views/dashboard.js`
   (sem alteração nenhuma) chama `ctx.navigate('vendas')` direto — com o
   nome antigo, esse cartão cairia silenciosamente na rota padrão em vez
   de abrir o Histórico (`ctx.navigate` nunca lança erro pra rota
   desconhecida, só não navega pra lugar nenhum útil). Corrigido
   renomeando a rota pra `vendas` (mesmo nome da extensão) antes mesmo do
   primeiro teste — pego só comparando o `app.js` da extensão com o
   daqui, não por um teste falhando. `DEFAULT_ROUTE` também virou
   `dashboard` (era `venda`), igual ao `if (!location.hash) location.hash
   = '#/dashboard'` da extensão.

   **Achado real, corrigido no servidor — campo de fidelidade faltando em
   `company.policies`:** na extensão, `loyaltyPointsPerReal` mora dentro
   do MESMO blob de `company.policies` que `vendorMaxDiscountPercent`
   etc. (ver `data/companyRepo.js#buildCompanyRecord`). Aqui, Fase 6
   (fidelidade) e Fase 8 (`routes/company.js`) evoluíram separadas — os
   dois gravam na mesma linha `config` da tabela `company`
   (`lib/companyConfig.js`), mas `GET /api/company` nunca devolvia o
   campo de fidelidade de volta. `dashboard.js#loyaltyOn` lê
   `company.policies.loyaltyPointsPerReal` pra decidir se mostra o cartão
   de pontos mesmo com 0 pontos ainda ganhos — sem o campo, ficava sempre
   `false` até o primeiro ponto existir (falha silenciosa, sem crash,
   pega revisando os dois `app.js` lado a lado, não por um teste
   falhando). Corrigido acrescentando `loyaltyPointsPerReal` (lido de
   `lib/loyaltyConfig.js#getLoyaltyConfig()`, mesma fonte que
   `routes/loyalty.js` já usa) na resposta de `GET /api/company` —
   só leitura; a escrita continua toda em `routes/loyalty.js`, única fonte
   da regra de negócio de fidelidade.

   Novo em `public/js/data/`: `loyaltyRepo.js#getAllPointsBalances` e
   `deliveriesRepo.js#listDeliveries` (ambos sobre rotas que já existiam
   desde as Fases 6, sem mudança de servidor). `dashboard` também entrou
   no `LIVE_TOPICS` da atualização em tempo real (passo 6) — ao contrário
   de `vendas`/`clientes`, o Painel não tem filtro nem estado nenhum pra
   perder num recarregamento (é só um retrato do momento, recalculado do
   zero a cada render), então é seguro — e é literalmente o propósito da
   tela — atualizar sozinho quando qualquer terminal muda algo relevante.

   Testado em `test-dashboard.cjs` (20 asserções): rota padrão ao logar,
   os 8 cartões numéricos com valores reais (estoque baixo, vendas
   hoje/faturado, fiado, carretos pendentes, perto/fora da validade sem
   contar em dobro, pontos de fidelidade), as tabelas de últimas
   vendas/carretos pendentes, os deep-links de 3 cartões pra suas telas
   (incluindo confirmar que "Estoque baixo" já chega em Estoque
   PRÉ-FILTRADO), um clique no cartão "Caixa" (tela ainda não portada)
   não quebra a página, e — a checagem mais nova do lote — o Painel da
   Máquina A atualiza sozinho (2→3 vendas hoje) quando a Máquina B vende
   algo, sem F5 nenhum.

10. ✅ **`views/carreto.js` real ligada** (09/set) — sexta tela real
    (Estoque, PDV, Histórico, Clientes, Painel, agora Carreto), **copiada
    sem nenhuma alteração** de `pdv-extension/app/js/views/`. Fecha o
    ciclo de vida completo de uma entrega: cadastro (item do estoque via
    busca + item avulso, na mesma lista), detalhe, marcar como entregue,
    cancelar — com o mesmo cliente/servidor que o Painel (passo 9) e
    `sale.js` (passo 4, "Finalizar venda + carreto") já usavam de leitura/
    escrita parcial.

    Novo em `public/js/data/deliveriesRepo.js`: `markDelivered` e
    `cancelDelivery`, sobre `POST /:id/entregar`/`POST /:id/cancelar` que
    já existiam prontos desde a Fase 6 (mesma transação atômica —
    conferir "ainda pendente?" e gravar a transição juntos, pra duas
    máquinas nunca conseguirem entregar E cancelar o mesmo carreto ao
    mesmo tempo). Também copiado `components/productPicker.js` (busca de
    produto do estoque compartilhada entre Carreto e, um dia, Pedido de
    compra) — pequeno, só precisa de `searchProducts` (já existia).
    `carreto` ficou de fora do `LIVE_TOPICS`, mesmo raciocínio de
    `vendas`/`clientes`: tem filtro de status e paginação, estado só de
    tela que um recarregamento automático perderia.

    Testado em `test-carreto.cjs` (11 asserções): cadastro com os dois
    tipos de item (estoque buscado + avulso descrito) na mesma lista,
    detalhe mostrando os itens certos, marcar como entregue (some do
    filtro "Pendentes", aparece em "Entregues"), cancelar (via
    `confirmDialog`, não confirmação nativa do navegador), e duas
    adversárias que fecham o círculo de atomicidade: o servidor rejeita
    marcar como entregue um carreto já cancelado, e rejeita cancelar um
    carreto já entregue — nunca dá pra empurrar um carreto de um estado
    terminal pra outro.

11. ✅ **`views/users.js` real ligada** (09/set) — sétima tela real
    (Estoque, PDV, Histórico, Clientes, Painel, Carreto, agora Usuários),
    **copiada sem nenhuma alteração** de `pdv-extension/app/js/views/`.
    Cadastro/edição de vendedor com os checkboxes das 13 permissões
    granulares, ativar/desativar acesso, redefinir senha — tudo contra o
    mesmo `routes/users.js` que já existia desde a Fase 7 (gating de
    permissões, log de auditoria, clamp de delegação).

    Novo em `public/js/data/usersRepo.js`: `findByUsername` (checagem
    otimista client-side sobre `listUsers()`, mesmo espírito de
    `productsRepo.js#searchProducts` — "catálogo pequeno o bastante"),
    `createUser`, `updateUser`, `setUserActive`, `resetUserPassword`.
    Também copiados `components/maskedInput.js` (reaproveitado, sem
    mudança) e a tela em si. `usuarios` entrou no `LIVE_TOPICS`: a lista
    de vendedores de uma loja é sempre pequena e não tem filtro nem
    paginação — nada de estado de tela pra perder recarregando sozinho.

    **Achado de segurança real, não só de forma — escalonamento de
    privilégio faltando em `POST /:id/redefinir-senha`:** a extensão
    fecha, em `data/usersRepo.js#resetUserPassword`, um caminho lateral de
    escalonamento de privilégio: se um vendedor comum tem a permissão
    `usuarios` (delegável, ver passo de auditoria "Achado de auditoria
    (P1)" no próprio código da extensão), ele consegue redefinir a senha
    de QUALQUER outro vendedor pela tela — inclusive um com MAIS
    permissões que ele. Sem trava, esse vendedor logaria como a vítima e
    herdaria, por essa porta lateral, poderes que nunca teve (ex:
    `deleteCustomer`, `financeiro`). A extensão já calcula isso
    (`hasExtraPower = Object.keys(targetPerms).some((key) => targetPerms[key]
    && !actingPerms[key])`) e recusa com uma mensagem clara. O
    `routes/users.js` do servidor, escrito na Fase 7 — bem antes desta
    tela existir aqui, quando não havia UI nenhuma pra exercitar esse
    caminho — nunca teve essa checagem: qualquer chamada direta à rota
    (curl, ou a própria UI assim que ligada agora) conseguia o
    escalonamento completo. Corrigido copiando a mesma lógica,
    byte-a-byte, pro servidor (`routes/users.js`), com a mesma mensagem de
    erro da extensão. Achado **durante** o trabalho desta tela, não nela —
    o furo já existia há duas fases, só nunca tinha sido alcançável por
    UI nenhuma até agora.

    Achado secundário, mesma auditoria: as duas checagens de tamanho
    mínimo de senha em `routes/users.js` (cadastro e redefinição) tinham
    `4` caracteres soltos no código, sem relação nenhuma com
    `MIN_USER_PASSWORD_LENGTH = 6` que a extensão define e usa
    (`utils/permissions.js`) — quem contornasse a tela só precisava de 4
    caracteres, não 6, a política real divergindo da fonte. Corrigido
    centralizando a mesma constante em `lib/permissions.js` e usando nas
    duas checagens do servidor; conferido por grep que nenhum teste já
    existente usava senha menor que 6 caracteres, então o aperto não
    quebrou nada em produção.

    Testado em `test-users.cjs` (11 asserções): admin aparece na lista
    sem poder ser editado por aqui, cadastro/edição/ativar-desativar de
    vendedor refletem na lista, redefinição de senha realmente funciona
    (login com a senha nova), servidor rejeita senha de cadastro curta
    mesmo contornando a tela, e — a checagem mais importante do lote — um
    "Vendedor B" com só `usuarios` NÃO consegue redefinir a senha de um
    "Vendedor A" com `deleteCustomer` a mais, e a senha original de A
    continua funcionando depois da tentativa (nada foi gravado). A suíte
    de permissões pré-existente (`test-users-permissions.cjs`, da Fase 7)
    tinha uma asserção que assumia o reset "normal" entre dois vendedores
    onde o alvo na verdade tinha mais poder que quem resetava — corrigida
    pra refletir o comportamento correto (bloqueado), com um novo alvo sem
    poder a mais pro caso "normal" de verdade.

12. ✅ **`views/caixa.js` real ligada** (09/set) — oitava tela real
    (Estoque, PDV, Histórico, Clientes, Painel, Carreto, Usuários, agora
    Caixa), **copiada sem nenhuma alteração** de
    `pdv-extension/app/js/views/`. Abertura com troco inicial, sangria/
    suprimento, retificação de lançamento errado, fechamento com
    conferência por forma de pagamento, confirmação por senha de QUALQUER
    conta ativa (não precisa ser admin) e backup automático gerado e
    baixado sozinho nessa hora, histórico paginado de caixas, e o aviso de
    redirecionamento pro PDV quando a política "exigir caixa aberto pra
    vender" está ligada.

    A mais pesada das oito telas em lógica de negócio nova no servidor —
    diferente das anteriores, que só precisavam de wrappers HTTP sobre
    rotas já prontas, faltavam DUAS peças inteiras:

    - **Retificação (`POST /sessions/:id/retificar`, nova em
      `routes/cash.js`):** a extensão fecha um erro de digitação no troco
      inicial/sangria/suprimento com um lançamento tipo `'ajuste'` por
      cima (nunca edita o original), e reconfere a CONCORRÊNCIA dentro da
      própria transação — se duas pessoas abrirem "Retificar" sobre o
      MESMO lançamento quase juntas, a segunda a confirmar é rejeitada se
      o valor efetivo mudou desde que ela abriu o modal (em vez de aplicar
      sua correção sobre uma base já desatualizada pela primeira). Essa
      rota não existia no servidor até agora — `computeExpectedAmounts()`
      nem tratava `'ajuste'` no cálculo de Dinheiro esperado. Portado
      byte-a-byte: a mesma função pura `effectiveAmount()` (também copiada
      pro cliente, `public/js/data/cashRepo.js`, pra alimentar a prévia do
      modal sem round-trip) e a mesma reconferência de concorrência dentro
      da transação SQLite.
    - **Backup automático ao fechar caixa (`POST
      /api/cash/backup-fechamento`, nova, montada sob `/api/cash` e não
      sob `/api/backup`):** a extensão gera esse backup DE PROPÓSITO sem
      exigir a permissão `'backup'` (`data/backupRepo.js#
      buildAutomaticCashCloseBackup`) — fechar caixa é ação de qualquer
      vendedor (`roles: ['admin', 'vendedor']` em `app.js` da extensão,
      sem permissão própria; mesmo `requireAuth` sem permissão adicional
      que `/api/cash` já tinha no servidor), então exigir `'backup'` só
      pra esse backup automático não impediria nada — o mesmo vendedor já
      gera o mesmo dump completo fechando um caixa de verdade pela rota
      normal. Montar a rota nova sob `/api/backup` (que EXIGE `'backup'`
      no mount, ver `server.js`) teria introduzido justamente essa
      diferença indevida em relação à extensão — daí a rota nova, com o
      mesmo núcleo (`buildBackupPayload` + `encryptPayload`) mas fora
      daquele gate.

    Novo em `public/js/data/cashRepo.js`: `listSessions`, `openSession`,
    `listSessionMovements`, `computeExpectedAmounts`, `recordCashMovement`,
    `effectiveAmount`, `recordCashAdjustment`, `closeSession` (só
    `getOpenSession` já existia, da Fase 9 passo 4). Novo
    `public/js/data/backupRepo.js` (`buildAutomaticCashCloseBackup`) e uma
    extração PARCIAL de `public/js/views/backup.js` — só as duas funções
    utilitárias puras que `caixa.js` precisa (`downloadBlob`,
    `timestampForFilename`), sem IndexedDB nenhum envolvido; quando a tela
    de Backup real for portada, este arquivo vira a cópia verbatim
    completa (mesmo padrão incremental já usado em `cashRepo.js` desde a
    Fase 9 passo 4). `caixa` ficou de fora do `LIVE_TOPICS`: o estado
    fechado tem paginação no histórico e um campo de valor inicial que
    pode estar sendo digitado, e o estado aberto tem formulários de
    sangria/suprimento/retificação/fechamento abertos em modais — um
    recarregamento automático no meio de qualquer um desses perderia o
    que a pessoa já tinha preenchido.

    Testado em `test-caixa.cjs` (25 asserções): fluxo completo real
    (abrir, sangria, suprimento, retificar, conferir o Dinheiro esperado
    recalculado certo a cada passo, fechar com confirmação de um VENDEDOR
    sem nenhuma permissão especial), zero erros JS/rede durante todo esse
    fluxo (prova indireta de que o backup automático completou sem
    exceção), retificação concorrente com base desatualizada rejeitada,
    reenvio duplicado (mesma `dedupeKey`) rejeitado tanto pra movimento
    quanto pra retificação, sessão fechada recusa novo movimento/
    retificação/fechamento repetido, backup automático rejeita senha curta
    mas funciona sem a permissão `'backup'`, e o aviso de redirecionamento
    pro PDV aparece e navega quando a política correspondente está ligada.

13. ✅ **`views/compras.js` real ligada** (09/set) — nona tela real
    (Estoque, PDV, Histórico, Clientes, Painel, Carreto, Usuários, Caixa,
    agora Compras), **copiada sem nenhuma alteração** de
    `pdv-extension/app/js/views/`. Duas abas: Fornecedores (CRUD simples,
    leitura aberta a qualquer autenticado — Estoque também lê a lista pra
    preencher o fornecedor padrão de um produto —, escrita exigindo
    `'compras'`) e Pedidos de compra (criar com busca de produto via
    `components/productPicker.js`, recebimento total ou em várias entregas
    parciais creditando estoque+custo, cancelamento só antes de qualquer
    recebimento, sugestão automática de compra agrupada por fornecedor a
    partir dos produtos abaixo do estoque mínimo).

    Diferente das telas anteriores, toda a lógica de negócio pesada
    (transação atômica do recebimento, checagem "não pode cancelar pedido
    já recebido", sugestão automática) já existia pronta no servidor desde
    a **Fase 5** (`routes/suppliers.js`, `routes/purchases.js`) — este
    passo só precisou da camada de tradução HTTP nova
    (`public/js/data/purchasesRepo.js`, novo; `suppliersRepo.js` já
    existia completo) e dos utilitários que faltavam
    (`utils/email.js`, cópia verbatim — `isValidEmail`).

    **Achado real, não só de forma — `costPrice` de produto
    `'personalizado'` corrompido por um recebimento:** a extensão trava de
    propósito o `costPrice` de um produto `'personalizado'` em `0` pra
    sempre (esse tipo de produto não tem UM custo — cada forma de venda
    tem o seu próprio, ver `utils/pricing.js`/`resolveCustomUnitFields`) —
    `data/purchasesRepo.js#receivePurchaseOrder` da extensão tem uma
    checagem explícita (`product.unit === CUSTOM_UNIT_VALUE ? ... :
    ...`) documentada como um achado de auditoria já fechado lá. O
    `routes/purchases.js` do servidor, escrito na Fase 5 — bem antes de
    existir qualquer tela que pudesse comprar um produto personalizado —
    nunca teve essa checagem: `commitReceive` gravava o `unitCost`
    informado no recebimento direto em `product.costPrice`, sem olhar o
    `unit` do produto. Corrigido acrescentando a mesma trava. Achado
    **durante** o trabalho desta tela — o furo já existia há quatro fases,
    só nunca tinha sido alcançável por UI nenhuma até agora (mesma classe
    do achado do passo 11: lógica sensível escrita antes de existir tela
    pra exercitá-la, faltando a mesma trava que a extensão já tinha).

    Testado em `test-compras.cjs` (29 asserções): fluxo completo real de
    fornecedor (cadastro/inativar/reativar, validação de e-mail no
    formulário antes de chamar o servidor) e de pedido (criar com busca de
    produto, receber em duas entregas parciais até fechar, conferindo
    estoque e custo do produto a cada passo), recebimento além do pedido
    rejeitado, reenvio duplicado (`dedupeKey`) rejeitado, cancelamento
    bloqueado depois de qualquer recebimento, recebimento de produto
    personalizado sem corromper o `costPrice` travado em `0` (a prova
    direta do achado acima), sugestão automática agrupando produto abaixo
    do mínimo pelo fornecedor padrão, e o gate de permissão certo pros
    dois lados: vendedor sem `'compras'` ainda lê fornecedores (como
    Estoque precisa) mas toma 403 tanto pra criar fornecedor quanto pra
    ler pedidos de compra (rota inteira atrás da permissão, igual a
    extensão).

14. ✅ **`views/financeiro.js` real ligada** (09/set) — décima tela real
    (Estoque, PDV, Histórico, Clientes, Painel, Carreto, Usuários, Caixa,
    Compras, agora Financeiro), **copiada sem nenhuma alteração** de
    `pdv-extension/app/js/views/`. Contas a pagar/receber com pagamento
    parcial de verdade — uma conta só fecha como "Pago" quando a soma de
    tudo que foi registrado bate o valor total; enquanto sobrar saldo,
    fica etiquetada "Pago parcialmente" com o restante em destaque, nunca
    escondida como se já estivesse quitada. Extrato de pagamentos por
    conta, cada um excluível individualmente (reabre a conta sozinha se
    tirar ela de "paga"), cancelamento só antes de qualquer pagamento,
    filtro por tipo/status, resumo com "a pagar"/"a receber" (somando o
    SALDO restante de uma conta parcial, nunca o valor cheio) e contagem
    de vencidas.

    Mesmo padrão do passo 13 (compras.js): toda a lógica de negócio já
    existia pronta no servidor desde a **Fase 5**
    (`routes/finance.js` — reconferência atômica do restante antes de
    cada pagamento, `dedupeKey` contra reenvio, conta reabrindo sozinha ao
    excluir um pagamento) — este passo só precisou da camada de tradução
    HTTP nova (`public/js/data/financeRepo.js`), reaproveitando
    `suppliersRepo.js` e `components/customSelect.js` que já existiam
    prontos.

    Testado em `test-financeiro.cjs` (19 asserções): fluxo completo real
    (cadastro, pagamento parcial refletindo no resumo pelo saldo restante,
    conclusão do pagamento fechando a conta, exclusão de um pagamento
    reabrindo a conta sozinha), pagar além do restante rejeitado, reenvio
    duplicado (`dedupeKey`) rejeitado, cancelamento bloqueado tanto por
    "tem pagamento parcial" quanto por "já está totalmente paga",
    cancelamento sem pagamento nenhum funcionando normalmente, conta
    vencida calculada e contada certo no resumo, e o gate de permissão
    (`'financeiro'` exigido na rota inteira, leitura incluída, igual a
    extensão).

15. ✅ **`views/logs.js` real ligada** (09/set) — décima primeira tela real
    (Estoque, PDV, Histórico, Clientes, Painel, Carreto, Usuários, Caixa,
    Compras, Financeiro, agora Log do sistema), **copiada sem nenhuma
    alteração** de `pdv-extension/app/js/views/`. Filtro por perfil,
    usuário, termo de busca (ação+detalhes) e intervalo de data, com
    paginação real via cursor (não recarrega tudo a cada "Carregar mais").

    **Achado de performance real — `GET /api/audit` carregava a tabela
    INTEIRA na memória a cada leitura:** `routes/audit.js`, escrito na
    Fase 7 antes de existir qualquer tela que lesse o log de verdade
    (só `POST` era usado, pelas telas já portadas gravando ação), fazia
    `listStmt.all()` (toda a tabela `audit_log`) e filtrava/paginava tudo
    em JavaScript depois — exatamente o mesmo bug de performance já
    corrigido antes em Vendas/Relatórios/Painel na extensão (ver
    `dbScanByIndex` em `db.js` dela), só que faltando aqui. Esse log
    NUNCA é apagado — só cresce com o tempo de operação da loja — então
    seria a tela mais penalizada por isso com o uso real. Corrigido
    reescrevendo a rota pra um scan em ORDEM via cursor de chave
    (`timestamp`, `id`): os filtros que o schema indexa de verdade
    (`user_id`, intervalo de `timestamp`) entram direto no `WHERE` do
    SQL; `role` e `term` (sem coluna própria, só dentro do JSON) continuam
    conferidos registro a registro durante a varredura, mas parando assim
    que encontra `limit + 1` combinações — nunca precisando materializar
    a tabela inteira. Mesmo espírito de
    `app/js/data/auditRepo.js#listAuditLogPage` da extensão (índice +
    predicado por linha + corte cedo), agora espelhado no servidor.
    Resposta mantida retrocompatível (`entries` ao lado de `items`) pros
    dois testes pré-existentes que já liam `.entries` (Fase 7).

    Novo em `public/js/data/auditRepo.js`: `listAuditLogPage` (mesmo
    contrato de paginação por cursor de `salesRepo.js#listSalesPage`).
    `usersRepo.js#listUsers` e `utils/permissions.js#isAdmin` já existiam
    prontos.

    Testado em `test-logs.cjs` (19 asserções): lista carrega com "Carregar
    mais" quando passa de 50 registros, paginação de verdade soma sem
    duplicar, filtro por termo isola só o que bate (sem pegar vizinhos por
    substring), filtro por perfil e por data funcionam, cursor do servidor
    (`nextKey`/`nextId`) nunca repete item entre páginas, e o gate de
    permissão nos dois sentidos: vendedor COM `'logs'` delegado lê
    normalmente (não é exclusivo de admin), vendedor SEM toma 403 — mas
    ainda consegue GRAVAR uma entrada (`POST` continua sem gate próprio,
    igual a extensão).

16. ✅ **`views/relatorios.js` real ligada** (09/set) — décima segunda tela
    real (Estoque, PDV, Histórico, Clientes, Painel, Carreto, Usuários,
    Caixa, Compras, Financeiro, Logs, agora Relatórios), **copiada sem
    nenhuma alteração** de `pdv-extension/app/js/views/`. Faturamento,
    ticket médio, margem estimada, vendas por vendedor/categoria e curva
    ABC de produtos, com filtro de período (presets + personalizado) e
    exportação em PDF via impressão nativa do navegador.

    Diferente do resto da Fase 9 (repositórios que só traduzem chamada
    pra HTTP sobre lógica já pronta no servidor), esta tela precisou de
    lógica de agregação NOVA no servidor — `data/reportsRepo.js#
    computeSalesReport` da extensão nunca tinha equivalente aqui. A
    decisão de propósito: a agregação roda no SERVIDOR
    (`routes/reports.js`, novo), não no navegador — trazer todas as
    vendas cruas do período pro cliente reduzir em JS jogaria fora
    exatamente a otimização que a própria extensão já fez (varrer só o
    intervalo pelo índice de timestamp, nunca a tabela inteira, ver
    comentário dela em `reportsRepo.js`); o servidor já tem a tabela
    local, faz a mesma varredura indexada, e devolve só o relatório
    pronto (poucos KB) — nunca as vendas em si. A fórmula de agregação
    (rateio do desconto geral por item via `ratio`, custo do item de
    produto `'personalizado'` gravado na própria venda em vez do
    `costPrice` atual do produto, curva ABC por percentual cumulativo de
    faturamento) foi portada byte-a-byte.

    Novo em `public/js/data/reportsRepo.js`: `computeSalesReport` (agora
    um wrapper fino sobre a rota nova). Também copiados
    `components/reportPrint.js` (exportação em PDF, reaproveita
    `printRoot.js` compartilhado com o recibo de venda, já pronto desde
    o passo 4) e a tela em si. `relatorios` ficou de fora do
    `LIVE_TOPICS`: o período selecionado é estado só de tela.

    Testado em `test-relatorios.cjs` (20 asserções): faturamento/margem
    corretos com duas vendas de dois vendedores diferentes, estorno
    parcial refletido corretamente tanto na receita por vendedor (total
    líquido cheio da venda) quanto na receita por produto (rateada pela
    proporção da venda, um cálculo genuinamente diferente para o mesmo
    dado — a mesma venda estornada gera R$ 100 líquidos pro vendedor mas
    só R$ 50 atribuídos ao produto específico, matematicamente correto
    pela fórmula da extensão), curva ABC calculada certo via API (sem
    ambiguidade de regex sobre texto de tabela), filtro de período
    personalizado exclui vendas fora do intervalo, exportar PDF preenche
    o `print-report-root` com o relatório certo, e o gate de permissão
    nos dois sentidos (vendedor com `'relatorios'` delegado lê
    normalmente, sem toma 403).

Com os passos 5 a 16 fechados, a Fase 9 está **substancialmente
completa** pro dodeceto Estoque+PDV+Histórico+Clientes+Painel+Carreto+
Usuários+Caixa+Compras+Financeiro+Logs+Relatórios: a hipótese central do
roteiro (telas reais reaproveitáveis sem reescrita) segue provada na
prática mesmo na tela que precisou de agregação nova no servidor, a
promessa de tempo real já é verdade onde faz sentido, e o ciclo
operacional inteiro da loja — vender, repor estoque, fiado, fidelidade,
visão geral, entregar, gerir vendedores, abrir/fechar caixa, comprar de
fornecedor, controlar contas a pagar/receber, auditar tudo isso, e agora
enxergar o desempenho do negócio — já roda pela UI real.
O que falta da Fase 9 (a última tela restante — personalização/backup/
ajuda —, o `app.js` completo com menu lateral, e a lacuna de crédito de
troca cross-terminal documentada no passo 8) é
trabalho real de mais fases, não risco em aberto.
