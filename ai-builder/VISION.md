# Visão de Produto

## O que isso é

Não é "um editor de HTML com IA". É uma bancada de engenharia: a IA planeja
como uma engenheira sênior (requisitos → arquitetura → modelo de dados →
componentes → código), não como um chatbot que devolve um bloco de HTML.
O usuário nunca fica preso a um único modo: pode desenhar visualmente, editar
código, ou pedir para a IA mexer só numa parte — os três caminhos convergem
para o mesmo modelo de componentes.

## Princípio central

*"Se o usuário consegue imaginar uma ferramenta web, a plataforma consegue
construir uma primeira versão funcional dela."*

Isso só é sustentável com uma fundação pequena e composicional (poucos tipos de
nó, poucos primitivos de layout, um gerador determinístico) em vez de uma lista
infinita de templates rígidos. A IA combina esses primitivos; não inventa um
sistema novo a cada pedido.

## Por que isso é diferente do que já existe

1. **Planner determinístico como caminho padrão, IA como refinamento.** A
   maioria das ferramentas "prompt → app" depende 100% de um LLM caro rodando
   a cada interação. Aqui, entender "estoque com produtos, fornecedores,
   entradas e saídas" é *engenharia de regras* (extração de entidades por
   padrões + template de CRUD), não uma chamada de IA. O LLM entra só para
   polir nomes/copy/decisões ambíguas — por isso o custo operacional tende a
   zero e a ferramenta funciona 100% offline no modo local.
2. **Sincronização visual↔código via um DOM real, não dois modelos
   paralelos.** Em vez de manter um "component model" e reserializar para
   HTML por conta própria (fonte comum de dessincronização), o código gerado
   *é* a fonte visual: o preview roda o HTML gerado dentro de um iframe
   sandboxed, e editar o código e reimportar usa `DOMParser` nativo lendo os
   atributos `data-av-id`/`data-av-type` de volta para o modelo de árvore.
   Um único caminho de verdade, sem parser customizado para manter.
3. **Container queries como default, não escape hatch.** Todo componente
   composto (`Card`, `DataTable`, `StatCard`, `Sidebar`) declara
   `container-type: inline-size`. Um componente continua correto quando
   movido de uma coluna larga para uma estreita — não só quando a *viewport*
   muda.
4. **Reparo verificável, não "parece que funciona".** O `validator` roda
   regras determinísticas (referências quebradas, labels ausentes, contraste,
   overflow) e o `repair` só marca algo como corrigido depois de rodar a
   mesma regra de novo e ver que ela não dispara mais.
5. **Exportação sem lock-in.** O projeto exportado é HTML/CSS/JS puro. Não
   existe runtime proprietário que precise continuar rodando depois — o app
   exportado funciona para sempre, mesmo se a extensão for desinstalada.

## Onde a régua de qualidade está hoje (honestidade sobre o escopo)

Esta é uma primeira fundação real e funcional, não uma simulação. Mas o
pedido original descreve uma categoria de produto inteira (40 seções, 13
fases, ~40 componentes com todos os estados, múltiplos provedores de IA,
importação de screenshot, engenharia reversa de HTML, etc.). Nenhuma
ferramenta desse porte nasce completa em uma única sessão — e fingir que sim
seria exatamente o tipo de "parece estar funcionando" que a seção 10 do pedido
proíbe. O que está implementado é uma **vertical slice completa e verificável**:

- Prompt → plano de aplicação → árvore de componentes → HTML/CSS/JS reais.
- ~20 componentes de produção (não 40+), escolhidos para cobrir os templates
  Dashboard, Inventário/CRUD genérico e Landing — cada um com variantes,
  estados básicos (default/hover/focus/disabled/loading/empty) e acessibilidade
  (labels, roles, navegação por teclado).
- Canvas com seleção, mover, duplicar, excluir, undo/redo, preview
  responsivo (mobile/tablet/desktop + largura customizada).
- Painel de propriedades ligado ao mesmo modelo que o gerador de código lê.
- Validador com ~10 regras determinísticas + auto-repair para as que têm
  correção segura e mecânica.
- Exportação real em `.zip` (ZIP writer nativo via `CompressionStream`, sem
  dependência) com projeto estático pronto para hospedar.
- Camada de IA plugável (`provider.js`) com um provider local (padrão, grátis)
  e adaptadores para Anthropic/OpenAI-compatível — trocar de provedor não
  exige tocar no resto do produto.

## Fases (mapeamento com a seção 39 do pedido)

| Fase | Entregue nesta sessão |
|---|---|
| 1 Visão | Este documento |
| 2 Arquitetura | `ARCHITECTURE.md` |
| 3 UX | Side panel: entrada única de comando, canvas, layers, propriedades, preview multi-dispositivo, command palette (`Ctrl/Cmd+K`) |
| 4 Modelo de dados | `data/db.js`, `data/project.js` (IndexedDB: Project → Pages → ComponentTree) |
| 5 Engine | `codegen/generator.js`, `components/registry.js`, `runtime/preview.js` |
| 6 IA | `ai/provider.js`, `ai/planner.js`, `ai/contextManager.js`, `ai/providers/*` |
| 7 Builder | `builder/canvas.js`, `builder/tree.js`, `builder/properties.js`, `builder/commands.js` |
| 8 Runtime | `runtime/preview.js` (iframe sandboxed, sem `eval`) |
| 9 Validação | `validate/validator.js`, `validate/repair.js` |
| 10 Export | `export/zip.js`, `export/exporter.js` |
| 11 Hardening | Sanitização central (`codegen/sanitize.js`), CSP do side panel, permissões mínimas + opcionais no `manifest.json` |
| 12 Performance | Sem frameworks, DOM real, workers reservados para validação em projetos grandes (`validate/validator.worker.js`) |
| 13 QA | `tests/run-tests.mjs` (unitário) — testes de estresse de UI real (100–500 componentes, undo/redo em lote) ficam como próximo passo declarado abaixo |

## Próximos passos honestos (não implementados ainda)

- Múltiplas páginas com roteador client-side completo (hoje: N páginas, troca
  por `data-route` simples — suficiente para SPA pequena, não testado com
  dezenas de páginas).
- Importação de HTML existente / ZIP / screenshot → estas são as maiores
  oportunidades de diferenciação citadas na seção 37 e ficam mapeadas em
  `ai/import/` (diretório reservado, vazio) para a próxima iteração.
- Testes de estresse reais de 500 componentes no canvas (a arquitetura foi
  desenhada para suportar — árvore imutável + comandos + `requestAnimationFrame`
  batching — mas não foi medida nesta sessão por falta de um Chrome real no
  ambiente de execução).
- Templates adicionais (CRM, financeiro, agendamento) — a fundação de
  templates (`templates/index.js`) é composicional, então adicionar um novo
  template é declarar um plano de páginas/entidades, não escrever um gerador
  novo.
