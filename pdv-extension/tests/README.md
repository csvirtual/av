# Testes automatizados — PDV - C&S Virtual

Suíte real com `@playwright/test`: sobe um Chromium de verdade com a
extensão carregada como "unpacked" (igual `chrome://extensions` → "Carregar
sem compactação"), completa o wizard de configuração inicial, loga, e testa
a funcionalidade em si — sem mocks, sem stubs, contra o código de verdade.

## Rodar

```
cd pdv-extension/tests
npm install
npx playwright test
```

Sem nenhuma variável de ambiente, usa o Chromium que o próprio Playwright
gerencia (baixado por `npx playwright install chromium`, se ainda não
tiver). Se preferir apontar pra um Chromium já instalado na máquina, defina
`CHROMIUM_PATH` com o caminho do executável antes de rodar. Roda headless
por padrão.

Relatório em HTML depois de rodar:

```
npx playwright show-report
```

## Estrutura

- `fixtures.js` — sobe a extensão, acha a aba do app, expõe `appPage`
  (aba pronta, com detecção de erro de JS não tratado) e `extensionId`.
- `helpers.js` — funções de alto nível reaproveitadas pelos specs:
  completar o wizard de configuração, logar, navegar por hash, cadastrar
  produto/cliente direto pelo repositório (sem passar pela UI de
  cadastro — os specs testam o que vem DEPOIS que o dado existe).
- `specs/` — um arquivo por área testada:
  - `smoke.spec.js` — setup + login + navegação pelas telas principais.
  - `sales.spec.js`, `refunds.spec.js`, `stock-movements.spec.js`,
    `deliveries.spec.js` — proteção contra reenvio duplicado
    (dedupeKey/claimIdempotencyKey) em cada operação que mexe em
    dinheiro/estoque, achada por auditoria adversária: dois cliques
    seguidos (ou duas chamadas concorrentes) não podem duplicar a ação,
    e o fluxo legítimo de um clique só continua funcionando.
  - `held-carts.spec.js` — "Segurar venda" (carrinhos congelados):
    congelar/retomar/descartar, e a reserva de estoque que impede vender
    duas vezes o que já está prometido num carrinho congelado.

## Convenção pros próximos specs

Cada teste de proteção contra duplicidade segue o mesmo par:

1. **Concorrência**: chama a função do repositório duas vezes em paralelo
   com a mesma `dedupeKey` (`Promise.allSettled`) — confirma que só uma
   passa e o estado final (estoque, contagem de registros) é o esperado
   de UMA aplicação só.
2. **Fluxo legítimo**: a mesma ação, uma vez só, pela UI de verdade —
   confirma que a proteção não quebrou o caminho normal.

Ao adicionar uma função nova protegida por dedupeKey, replique esse par.
