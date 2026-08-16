# Co-piloto Android

Versão do Co-piloto de vendas com IA (`../co-piloto`) empacotada como um
único arquivo HTML autocontido (CSS, fontes e JS embutidos), com um layout
próprio pra celular, pra rodar como PWA no Android — sem depender de
instalar como extensão de navegador.

**Este projeto não compartilha nenhum arquivo com `../co-piloto`.** Tudo
aqui é gerado a partir de lá (`build.js`) ou é um adaptador que faz o
código de negócio original rodar sem alteração de lógica fora de uma
extensão.

## Como gerar o build

```
node build.js
```

Gera `dist/copiloto-android.html` — um arquivo só, pronto pra hospedar em
qualquer lugar com HTTPS (necessário pra IndexedDB/WebCrypto/Web Locks
funcionarem sem restrição, e pra instalar como PWA). Rodar de novo a
qualquer momento traz automaticamente qualquer mudança feita em
`../co-piloto` — não precisa (e não deve) editar `dist/` à mão.

## Como está organizado

- **`storage-adapter.js`** (Fase 1) — `chrome.storage.local/session/
  onChanged` reimplementados sobre IndexedDB + sessionStorage, mesma API.
- **`runtime-adapter.js`** (Fase 2) — substitui `background.js` (que não
  existe fora de extensão): versão via `<meta>`, trava de aba duplicada e
  disputa de geração da credencial inicial via Web Locks API.
- **`screen-manager.js`** (Fase 3) — dobra `options.html` (Configurações)
  pra dentro da mesma página que `panel.html`, como uma segunda tela — só
  a tela ativa fica no DOM (a outra é estacionada numa `<template>`),
  evitando colisão de ids que as duas páginas nunca precisaram evitar
  antes.
- **`hamburger-menu.js` + `mobile.css`** (Fase 4) — as duas colunas fixas
  do desktop (`.sidebar` e `.funnel-sidebar`) viram uma gaveta única,
  acionada por um botão no canto superior direito. Layout sempre mobile
  neste build (sem media query).
- **`manifest.webmanifest` + `sw.js` + `icons/`** — PWA: instalabilidade
  ("Adicionar à tela inicial" no Android) e funcionamento offline depois
  da primeira visita. São os únicos arquivos que não dá pra embutir no
  HTML (manifest/service worker são referenciados por URL própria, é
  assim que a especificação funciona) — por isso `dist/` é uma pastinha,
  não mais um único arquivo solto.
- **`build.js`** — monta tudo isso em `dist/` (`index.html` + os 3
  arquivos acima), lendo os arquivos reais de `../co-piloto` (nunca uma
  cópia à mão).

## Verificado (Fase 5)

Bateria via Playwright, emulando um Android real (viewport Pixel 5):
instalação nova completa (credencial inicial → login → criação de perfil
→ PIN de recuperação → onboarding automático), todos os itens do menu
(Como usar, Privacidade, Faturamento, Ver/exportar leads, Importar
contatos, Lixeira, Avançado — cada um abrindo/fechando sem erro e sem
overflow horizontal), Chat rápido (com a API mockada), rotação pra
paisagem, e persistência via IndexedDB depois de um reload completo da
página (login + perfil + um lead criado na sessão anterior, tudo
sobrevive). 3 rodadas de cada teste, zero erro de console.

Verificado também (PWA): manifest carrega e tem os 3 ícones certos,
service worker registra e ativa, app abre mesmo com a rede desligada
depois da primeira visita — testado com `Content-Type` correto pra cada
arquivo (é isso que faz o navegador aceitar registrar o service worker).

## Como hospedar (Netlify)

`dist/` inteira é o site: suba a pasta com `index.html`,
`manifest.webmanifest`, `sw.js` e `icons/` juntos, na raiz (não só o
`index.html` sozinho — os outros 3 são obrigatórios pra instalabilidade
funcionar). Precisa ser HTTPS (Netlify já serve assim por padrão) —
IndexedDB, WebCrypto e Web Locks não funcionam de forma confiável fora de
um contexto seguro.

## Pendências conhecidas / próximos passos possíveis

- **APK instalável de verdade**: o que existe hoje é uma PWA (instala como
  ícone na tela, abre em tela cheia, funciona offline) — não é a mesma
  coisa que um arquivo `.apk` pra baixar e instalar direto. Gerar um APK
  de verdade a partir de uma PWA é um passo À PARTE (normalmente via
  Bubblewrap/PWABuilder, exige SDK Android + assinatura própria) — ver
  conversa sobre isso antes de assumir que já está pronto.
- **Auditoria visual fina**: a Fase 4 cobriu o essencial (grade→coluna
  única, gaveta, dvh) e testou uma amostra representativa de telas — não
  houve uma passada pixel a pixel em cada um dos ~20 modais individualmente.
- A credencial inicial só aparece UMA VEZ por instalação (fica marcada no
  IndexedDB) — reabrir o mesmo arquivo, no mesmo navegador/origem, depois
  de já ter passado por ela mostra direto a tela de login normal. Isso é
  esperado, não um bug.
