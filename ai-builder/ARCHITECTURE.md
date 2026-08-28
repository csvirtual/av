# Arquitetura

Módulos ES nativos (`type="module"`), zero bundler, zero dependência de
runtime. Cada arquivo faz uma coisa. Tudo que pode ser feito com API nativa do
navegador é feito com API nativa do navegador (ver decisões abaixo).

## 1. Arquitetura geral

```
Aba própria da extensão (documento privilegiado, chrome-extension://…)
 ├── UI shell (sidepanel/index.html + scripts/main.js)
 ├── State store (pub/sub simples, sem framework)
 ├── Data layer (IndexedDB via data/db.js)
 ├── Component registry + gerador de código
 ├── Builder visual (canvas + layers + propriedades)
 ├── Runtime (iframe sandboxed, srcdoc, sem acesso a chrome.*)
 ├── Camada de IA (provider plugável; local por padrão)
 └── Validador / auto-repair / exportador

Service Worker (background, MV3)
 └── Só o mínimo: abre (ou foca, se já aberta) a aba do builder ao clicar no
     ícone, comandos de teclado. Não guarda estado — todo estado vive no
     IndexedDB, acessível também pela aba diretamente (não há necessidade de
     mensageria constante).
```

## 2. Arquitetura da extensão (Manifest V3)

- A UI abre como **aba própria** (`chrome.tabs.create`), não como popup nem
  como Side Panel do Chrome — um builder visual precisa de largura real para
  caber canvas + camadas + propriedades ao mesmo tempo, e o Side Panel é
  tipicamente estreito demais (e não redimensionável pelo usuário além de um
  limite pequeno) para isso. Clicar no ícone de novo foca a aba já aberta em
  vez de abrir outra (`chrome.tabs.query` + `chrome.tabs.update`).
- `permissions`: `storage`, `downloads`, `tabs`, `commands`. `tabs` é
  necessário especificamente para localizar uma aba já aberta da extensão ao
  clicar no ícone de novo (sem essa permissão, `chrome.tabs.query` não
  encontra nem as próprias abas da extensão — verificado empiricamente, não
  é só documentação) — sem ela o clique duplicaria abas em vez de focar a
  existente.
- `optional_permissions` / `optional_host_permissions`: hosts de provedores de
  IA (`https://api.anthropic.com/*`, `https://api.openai.com/*`) só são
  solicitados quando o usuário configura aquele provedor em Configurações —
  nunca declarados como obrigatórios no install.
- Sem `content_scripts`, sem `<all_urls>`, sem `activeTab` amplo: a extensão
  não precisa ler nem modificar páginas do usuário. Isso elimina uma classe
  inteira de risco de segurança e de revisão na Web Store.
- Nenhum código remoto: sem CDNs, sem `eval`, sem `new Function`. MV3 proíbe
  isso por política e é, de qualquer forma, a escolha certa de segurança.
- `content_security_policy.extension_pages` restritiva (`script-src 'self'`),
  reforçando o que o MV3 já exige.

## 3. Arquitetura do builder

Três camadas que só se comunicam por um modelo de dados imutável (nunca
DOM → modelo, exceto no caminho explícito de reimportação de código):

```
Layers/Canvas (leitura)      Properties Panel (leitura/escrita)
        \                            /
         \                          /
          v                        v
              Component Tree (modelo)
                      |
              Command Stack (undo/redo)
                      |
              Code Generator  ---->  Runtime Preview (iframe)
                      ^
                      |
        DOMParser (reimportação de código editado manualmente)
```

- **Command pattern**: toda mutação (`addNode`, `removeNode`, `moveNode`,
  `updateProps`, `updateStyle`, `duplicateNode`) é um objeto `{do, undo}`
  empilhado em `builder/commands.js`. Undo/redo é sempre `O(1)` — nunca
  recomputa a árvore inteira.
- **Seleção e drag&drop** usam a Drag and Drop API nativa
  (`draggable`, `dragstart/dragover/drop`) mais um fallback por Pointer Events
  para reordenar em telas touch — sem biblioteca de DnD.
- **Renderização do canvas**: o canvas em si é só o `runtime/preview.js`
  (mesmo iframe do preview) mais uma camada de overlay (bordas de seleção,
  alças de resize) desenhada em um `<div>` absoluto por cima, sincronizada via
  `getBoundingClientRect()` do elemento correspondente dentro do iframe. Isso
  garante **um único renderizador** (o HTML real gerado) — o que você edita
  visualmente é literalmente o app, não uma representação separada dele.

## 4. Arquitetura do runtime

- `iframe sandbox="allow-scripts"` com `srcdoc` (nunca `src` remoto).
- Sem acesso a `chrome.*` de dentro do iframe — o runtime é só HTML/CSS/JS
  puros, o mesmo que seria exportado. Isso automaticamente garante que
  "o que você vê no preview é o que você exporta".
- Erros de runtime (`window.onerror`, `unhandledrejection`, `console.*`
  interceptado) são repassados ao painel pai via `postMessage` com um
  protocolo mínimo (`{type: 'av:error'|'av:log', payload}`), alimentando o
  console embutido do preview e o validador.
- Preview multi-dispositivo = o mesmo iframe com `width`/`height` controlados
  por CSS (`resize`, presets mobile/tablet/desktop) — não há necessidade de
  múltiplos iframes nem de reload a cada troca de tamanho, então trocar de
  dispositivo é instantâneo.

## 5. Arquitetura da IA

```
UI (comando em linguagem natural, com ou sem seleção de contexto)
        |
Context Manager  — decide o que entra no prompt (ver §9 economia de tokens)
        |
Planner  — Local (determinístico) por padrão; delega a um Provider só quando
        |   configurado e quando a tarefa realmente se beneficia (nomes,
        |   copy, decisões ambíguas de UX)
        v
AI Provider Abstraction (provider.js: generate(prompt, schema) -> JSON)
        |
   +---------+----------+
   |         |          |
 Local   Anthropic   OpenAI-compat
(grátis) (opcional)   (opcional)
        |
Code Generator (determinístico, nunca a IA escreve HTML/CSS/JS diretamente —
   a IA só devolve *dados estruturados* (plano/props), o gerador é quem
   serializa para código. Isso elimina uma classe inteira de bugs de IA
   "esquecendo" de fechar uma tag ou gerando `eval`.)
        |
Validator -> Repair Engine (mesmo pipeline determinístico, IA nunca aplica
             patch direto no DOM/arquivo — só sugere, o repair mecânico aplica)
```

Trocar de provedor = implementar `generate()` em um novo arquivo dentro de
`ai/providers/`. Nada mais no produto depende do provedor escolhido.

## 6. Modelo de dados

```ts
Project {
  id, name, createdAt, updatedAt, theme: TokenOverrides,
  pages: Page[], entities: Entity[], settings: object
}
Page { id, name, route, tree: ComponentNode, order }
ComponentNode {
  id,            // "c_xxxxx", estável entre edições
  type,          // chave no registry (ex: "Card", "DataTable")
  props,         // dados específicos do componente (schema por tipo)
  style,         // overrides pontuais de tokens (spacing/color/etc.)
  bind?,         // { entity, field } — ligação com dado real (opcional)
  children: ComponentNode[]
}
Entity { id, name, fields: Field[] }  // dado do domínio (Produto, Fornecedor…)
```

Persistência: **IndexedDB** (`data/db.js`), um object store por tipo
(`projects`, `pages`, `snapshots`). `snapshots` guarda versões completas do
projeto (JSON, comprimido com `CompressionStream('gzip')` nativo) para
"Histórico de Versões" / "voltar para ontem" — sem precisar de um servidor.

## 7. Sistema de componentes

`components/registry.js` define o contrato de um componente:

```ts
{
  meta: { label, category, icon },
  defaultProps, propSchema,     // usado para autogerar o painel de propriedades
  a11y: { role?, requiresLabel? },
  render(node, ctx) -> { html, css, js? }  // determinístico, puro
}
```

`components/library.js` implementa ~20 componentes de produção cobrindo os
templates suportados (layout: `Container`, `Grid`, `Stack`, `Sidebar`,
`Navbar`, `Header`, `Footer`; conteúdo: `Card`, `StatCard`, `Badge`, `Alert`,
`EmptyState`, `Table`/`DataTable`, `Breadcrumb`; formulário: `Button`,
`Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Form`; overlay: `Modal`,
`Tabs`, `Toast`). Cada `render()` usa os design tokens via `var(--av-*)` —
nunca um valor mágico — e declara `container-type: inline-size` quando faz
sentido o componente reagir ao próprio container.

## 8. Sistema de geração de código

`codegen/generator.js` percorre a árvore e produz três strings: `html`, `css`
(regras deduplicadas por tipo de componente, não repetidas por instância) e
`js` (delegação de eventos por `data-av-id`, um único listener por tipo de
evento no `document`, nunca um listener por elemento — importante para
projetos com muitos componentes). Todo texto dinâmico passa por
`codegen/sanitize.js::escapeHtml`/`escapeAttr` antes de entrar no template —
não existe caminho de `innerHTML` com string não escapada no produto.

## 9. Sistema de sincronização visual/código

Um único sentido "forte" (modelo → código, sempre determinístico e
reprodutível) e um caminho explícito de "código → modelo" via `DOMParser`
nativo: o HTML gerado sempre carrega `data-av-id`/`data-av-type` nos
elementos que correspondem a um `ComponentNode`; reimportar código lê esses
atributos e reconstrói a árvore, preservando `id`s existentes (o que preserva
histórico/bindings) e criando novos nós para elementos sem atributo
(inseridos manualmente pelo usuário) como nós do tipo `Raw` (HTML literal,
sem propriedades editáveis — degrada graciosamente em vez de corromper o
projeto).

## 10. Sistema de validação

`validate/validator.js` roda regras puras `(project) -> Issue[]`:
referências de `bind` para entidade/campo inexistente, `id`s duplicados,
imagem sem `alt`, controle de formulário sem label associado, contraste
texto/fundo abaixo de WCAG AA (cálculo de luminância nativo, sem lib),
elemento com `overflow` provável fora do container pai (heurística de
larguras fixas em vez de fluidas), nó órfão (fora da árvore da página mas
referenciado). Em projetos grandes, roda dentro de um Web Worker
(`validate/validator.worker.js`) para não travar a UI.

## 11. Sistema de auto-repair

`validate/repair.js` mapeia `Issue.code -> fix(project, issue) -> project'`
só para correções mecanicamente seguras (adicionar `alt=""` + aviso, gerar
`id`/`for` para label órfão, remover binding quebrado com confirmação,
ajustar largura fixa para `min()`/`clamp()`). Depois de aplicar, roda a
mesma regra de novo — só marca "corrigido" se o issue realmente sumiu
(nunca "parece que funciona").

## 12. Sistema de armazenamento

- `IndexedDB` — projetos, páginas, snapshots (fonte de verdade).
- `chrome.storage.local` — preferências pequenas (tema da UI, provedor de IA
  ativo, última página aberta) — nunca o projeto inteiro (limite de quota e
  não é o uso pretendido da API).
- `chrome.storage.session` — chave de API do provedor de IA, quando
  configurada (não persiste em disco entre reinícios do navegador —
  reduz a superfície de um vazamento de segredo).
- `Cache Storage` — reservado para cache de respostas de IA por hash do
  prompt+contexto (evita repagar a mesma pergunta) — implementado em
  `ai/contextManager.js::withCache`.

## 13. Estratégia de performance

- Sem VDOM, sem re-render completo: comandos aplicam patches DOM pontuais no
  iframe (`runtime/preview.js::applyPatch`) quando a mudança é só de
  props/estilo; só regenera HTML completo quando a estrutura da árvore muda.
- CSS gerado é deduplicado por tipo (uma regra `.av-Button{...}` serve todas
  as instâncias) — custo de estilo não cresce linearmente com o número de
  componentes.
- Delegação de eventos (um listener por tipo no `document`) em vez de N
  listeners.
- Validação pesada roda em Worker; UI nunca bloqueia por mais que um frame.

## 14. Estratégia de segurança

- Nunca `eval`/`new Function`/HTML remoto — MV3 já proíbe, o produto reforça.
- Toda string do usuário passa por escape antes de virar HTML.
- `iframe sandbox` sem `allow-same-origin` combinado com `allow-scripts`
  (evita que o conteúdo gerado tenha acesso a `chrome.*` ou ao DOM do
  painel).
- Permissões mínimas + opcionais (ver §2); nenhum host de terceiro no
  manifesto por padrão.
- Chave de API de IA nunca é logada, nunca entra em `console.*`, fica em
  `chrome.storage.session` (não em `local`).

## 15. Estratégia de testes

- `tests/run-tests.mjs`: testes unitários em Node puro (sem `chrome.*`) para
  planner, generator, sanitize, validator, zip writer — os módulos que não
  tocam DOM/IndexedDB são desenhados justamente para serem testáveis assim.
- Verificação manual em Chromium real (via Playwright, disponível no
  ambiente) do `sidepanel/index.html` como documento solo, cobrindo o loop
  prompt → geração → seleção → edição → export.
- Cenários de "nunca quebrar o projeto" (§32 do pedido) ficam garantidos
  estruturalmente pelo command pattern: qualquer mutação que falhe durante
  `do()` não é empilhada, e o estado antes da mutação nunca é descartado até
  o `do()` retornar com sucesso.

## 16. Estratégia de exportação

`export/zip.js` implementa um ZIP writer nativo (store, sem compressão, ou
`CompressionStream('deflate-raw')` quando disponível) — formato ZIP é simples
o bastante (cabeçalhos locais + central directory) para não justificar uma
dependência de ~100KB só para isso. `export/exporter.js` monta
`index.html`/`styles.css`/`app.js`/`README.md`/`manifest.json` (PWA opcional)
a partir do mesmo gerador de código usado no preview — garantindo que o
projeto exportado é *exatamente* o que já foi validado no preview, nunca uma
segunda geração divergente.
