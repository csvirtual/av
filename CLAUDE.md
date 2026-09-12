# Regra global: paridade visual do pdv-servidor com o pdv-extension

**A aparência do pdv-extension é a referência oficial e definitiva de como o
produto deve parecer.** Especificamente a versão **1.15.63** (confirmada
byte-idêntica ao HEAD atual de `pdv-extension/app/css/styles.css` em
12/set/2026) — telas, modais, cards, botões, espaçamento, tudo. O
pdv-servidor (`pdv-servidor/public/js/views/*.js` + `public/css/styles.css`)
é um produto *derivado* da mesma UI e precisa parecer **exatamente igual**
em qualquer tela ou modal que exista nos dois produtos, em qualquer largura
de tela onde a extensão também apareça daquele jeito (ou seja: fora de
`@media`, tem que ser igual; dentro de `@media (max-width: ...)`, pode
divergir — é onde moram ajustes só de celular).

Achado que originou esta regra: uma edição em `public/css/styles.css`
adicionou `min-height`/`line-height` em `.stat-card .label` **fora** de
qualquer `@media`, pra resolver um alinhamento no card em telas de celular
— mas por não estar escopada, engordou os cards do Painel/Financeiro em
**qualquer** largura, inclusive desktop, deixando-os visivelmente maiores e
menos "harmônicos" que a extensão. O bug passou despercebido porque era uma
propriedade **nova** (a extensão não tinha `min-height` ali), não uma
mudança de valor de algo que já existia — o tipo de coisa fácil de não
perceber olhando só o diff.

## A regra em termos práticos

Antes de qualquer commit que toque `pdv-servidor/public/css/styles.css`:

```
node pdv-servidor/test-css-parity.cjs
```

Esse script compara, propriedade por propriedade, todo seletor CSS que
existe **fora de `@media`** nos dois arquivos (`pdv-extension/app/css/styles.css`
como referência, `pdv-servidor/public/css/styles.css` como candidato). Ele
falha (`exit 1`) se:

- um seletor que a extensão tem fora de `@media` sumiu do servidor no mesmo
  escopo;
- uma propriedade que a extensão define num seletor compartilhado tem valor
  diferente (ou sumiu) no servidor;
- o servidor tem uma propriedade **nova** num seletor que **já existe** nos
  dois produtos — é essa checagem simétrica que teria pego o bug do
  `.stat-card .label` acima.

Ele **não** reclama de:

- seletores 100% novos do servidor (ex: uma classe que só existe porque o
  servidor tem uma feature a mais, tipo multiusuário/multiterminal);
- qualquer coisa dentro de um bloco `@media` — ali vale mexer à vontade,
  inclusive pra ajustes só de celular que não existem na extensão.

## Como resolver uma falha do script

1. **A mudança devia mesmo ser só de celular?** Mova a propriedade pra
   dentro do `@media (max-width: ...)` correspondente, tirando ela do
   escopo global. Foi exatamente o conserto aplicado no achado acima:
   `min-height`/`line-height` voltaram a existir só dentro do
   `@media (max-width: 420px)`.
2. **A mudança é proposital e deveria valer nos dois produtos?** Replique a
   mesma regra em `pdv-extension/app/css/styles.css` também — aí os dois
   voltam a bater e o script passa.
3. **A mudança é uma refatoração que não muda nada renderizado** (ex:
   trocar uma propriedade shorthand por várias longhand equivalentes, ou
   generalizar um seletor pra outro com as mesmas propriedades)? Prove isso
   medindo o elemento de verdade no navegador (não só lendo o CSS — layout
   em cascata engana), documente o porquê, e adicione uma entrada em
   `KNOWN_EXCEPTIONS` dentro de `pdv-servidor/test-css-parity.cjs`. As
   exceções são **por propriedade** (`"seletor::propriedade"`), nunca por
   seletor inteiro — perdoar um seletor inteiro esconderia qualquer
   divergência futura e não relacionada nesse mesmo seletor.

Nunca ignore uma falha do script sem um desses três caminhos. E nunca
enfraqueça a checagem em si (ex: voltar a permitir propriedade nova sem
querer) só pra fazer um commit passar — foi exatamente esse tipo de
"servidor pode só adicionar" que deixou o bug original entrar.

## Contexto: por que dois produtos com o mesmo visual

`pdv-extension` é a extensão Chrome (IndexedDB, um terminal só, um
computador só). `pdv-servidor` é um produto separado — servidor Node numa
máquina da loja, servindo por rede pra vários terminais — construído como
uma "porta" da mesma interface, tela por tela, pra rodar contra um backend
diferente (SQLite/HTTP/WebSocket em vez de IndexedDB). Ver
`pdv-servidor/README.md` pro histórico completo dessa migração. Os dois
compartilham a mesma base de usuários-alvo e a mesma identidade visual por
decisão de produto — não é coincidência, é o ponto.
