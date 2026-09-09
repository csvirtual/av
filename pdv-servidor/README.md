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

**Suíte completa (19 arquivos `test-*.cjs`, incluindo `test-real-ui.cjs`)
roda 100% verde neste ambiente hoje** (confirmado de novo em 09/set, banco
e servidor recém-subidos pra cada teste, depois de ligar a interface real —
ver Fase 9 abaixo). Um achado anterior (09/set, ainda de manhã) tinha
registrado 4 testes "-multiterminal" falhando por timeout neste sandbox
específico — não reproduziu na rodada mais recente, então parece ter sido
flutuação de timing pontual, não uma falha persistente do ambiente. Se
voltar a acontecer, vale registrar de novo aqui com mais detalhe antes de
investigar a fundo.

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
| 9 | **Interface final** — trocar `public/test.html` (tela de prova de conceito) pelas telas reais da extensão (`pdv-extension/app/js/views/*.js`), com uma camada de dados nova que fala HTTP/WebSocket em vez de IndexedDB | 🟡 Estoque+PDV completos e testados (09/set) — `session.js`, os 9 repositórios (`productsRepo`, `stockRepo`, `suppliersRepo`, `auditRepo`, `salesRepo`, `deliveriesRepo`, `companyRepo`, `cashRepo`, `customersRepo`) e `views/products.js`+`views/sale.js` reais rodando contra o servidor, sem reescrita, `test-real-ui.cjs` verde. Faltam as ~11 telas restantes, o `app.js` completo (menu lateral, todas as rotas) e atualização em tempo real via WebSocket nas telas (ver "Próximo passo recomendado") |
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
   inatividade, sem trava de aba única, e **sem atualização em tempo real
   via WebSocket** nas telas (o servidor já transmite `broadcast.js` a cada
   mutação, mas nada ainda escuta do lado do shell/telas) — cada terminal
   só vê o estado mais novo depois de um F5 de verdade, não
   automaticamente. Nenhuma dessas lacunas é bug: é o corte certo pra
   provar que a arquitetura funciona com as telas REAIS antes de investir
   no resto. Fica pra uma fase futura: casca completa, as demais telas
   (`salesHistory.js`, `caixa.js`, `clientes.js`, `company.js`, `users.js`,
   `compras.js`, `financeiro.js`, `carreto.js`, `logs.js`, `backup.js`,
   `dashboard.js`, `ajuda.js` — nenhuma ainda portada) e o WebSocket
   ligando as telas de verdade.

Com o passo 5 fechado, a Fase 9 está **substancialmente completa** pro par
Estoque+PDV: a hipótese central do roteiro (telas reais reaproveitáveis
sem reescrita) está provada na prática, não só na teoria. O que falta da
Fase 9 (as ~11 telas restantes, o `app.js` completo, WebSocket) é trabalho
real de mais fases, não um risco em aberto.
