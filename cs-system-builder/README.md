# C&S System Builder

Extensão de Chrome (Manifest V3) que cria sistemas web — HTML, CSS e
JavaScript — de duas formas complementares, sobre o **mesmo** projeto:

- **Chat com IA**: descreva o que você quer ("um cadastro de clientes com
  tabela de listagem") e a IA gera (ou edita) o sistema.
- **Editor visual (arrastar-e-soltar)**: monte a tela arrastando componentes
  (botões, formulários, tabelas, cartões, listas...) e ajuste cada um num
  painel de propriedades.

Qualquer coisa que a IA gerar fica imediatamente editável no arrastar-e-soltar,
e qualquer coisa montada visualmente vira contexto para o próximo pedido no
chat — as duas frentes trabalham sobre a mesma árvore de componentes.

## Custo de operação: zero

A extensão **não tem backend**. Cada chamada de IA sai direto do navegador
para a API do provedor que você escolher, usando **a sua própria chave**
(BYOK — *bring your own key*). Isso significa:

- Zero custo de operação para quem distribui a extensão (não existe servidor
  pra manter nem chave nossa sendo consumida).
- Você controla o gasto: dá pra usar um provedor com camada gratuita
  ([Groq](https://console.groq.com/keys) ou
  [Google Gemini](https://aistudio.google.com/apikey) têm camadas grátis
  generosas hoje) e não pagar nada, ou plugar OpenAI/Anthropic se preferir.
- Sua chave fica só no seu navegador (`chrome.storage.local`), nunca é
  enviada pra nenhum servidor além da própria API do provedor escolhido.

Provedores suportados: **Groq**, **OpenAI**, **Anthropic (Claude)** e
**Google (Gemini)**.

## Como instalar (modo desenvolvedor)

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta deste
   repositório.
5. Clique no ícone da extensão (ou abra o painel lateral do Chrome) para
   abrir o **C&S System Builder**.
6. Vá na aba **Config**, escolha um provedor, cole sua chave de API e
   salve.

## Como usar

1. Na aba **Chat**, descreva o sistema que você quer ou peça uma alteração
   no projeto atual.
2. Na aba **Editor**, arraste componentes da paleta para o canvas, reordene
   arrastando, e ajuste cada componente selecionado no painel de
   propriedades à direita (cores, espaçamento, texto, links, etc).
3. Na aba **Preview**, veja o sistema funcionando de verdade (num iframe
   isolado) ou alterne para **Código** para copiar/baixar o HTML final,
   pronto pra hospedar em qualquer lugar.
4. Na aba **Projetos**, salve, renomeie, reabra ou exclua projetos —
   tudo fica salvo localmente no seu navegador.

## Como o projeto é modelado

Em vez de a IA gerar HTML solto, ela gera (e o editor visual manipula) uma
**árvore JSON de componentes** com um esquema fechado de tipos (`container`,
`heading`, `text`, `button`, `image`, `link`, `input`, `textarea`, `select`,
`form`, `list`, `table`, `card`, `divider`) e um conjunto fixo de propriedades
de estilo. Esse esquema compartilhado (`sidepanel/schema.js`) é o que permite
o chat e o arrastar-e-soltar editarem exatamente a mesma coisa. A árvore é
serializada para HTML/CSS estático em `sidepanel/render.js` na hora de
exportar ou mostrar o preview.

## Modelo de segurança

- O editor visual nunca executa o JavaScript gerado (`onClick`/`onSubmit`
  ficam só como texto/atributo enquanto você edita).
- Só o **preview** roda o sistema de verdade, e roda dentro de um
  `<iframe sandbox="allow-scripts">` **sem** `allow-same-origin`: o código
  gerado não consegue ler cookies, acessar a extensão, nem navegar a aba
  principal.
- Respostas da IA passam por sanitização (`schema.js: sanitizeProject`) antes
  de virar árvore: tipos de nó e chaves de estilo desconhecidos são
  descartados.
- As chaves de API ficam em `chrome.storage.local` (só neste navegador,
  nunca sincronizadas com a conta Google, nunca enviadas a servidores
  nossos).

## Limitações desta primeira versão

- Um projeto = uma tela (página única). Múltiplas páginas/rotas ficam para
  uma próxima versão.
- Layout é baseado em blocos com flexbox (como um construtor de e-mails),
  não posicionamento livre por pixel.
- A confiabilidade da resposta em JSON varia por provedor/modelo — modelos
  maiores tendem a seguir melhor o esquema pedido.

## Estrutura do código

```
manifest.json           Manifest V3 (side panel, permissões, host_permissions)
background.js            Abre o side panel ao clicar no ícone
sidepanel/
  index.html              Shell da UI (abas: Chat, Editor, Preview, Config, Projetos)
  styles.css              Estilos
  schema.js               Modelo de dados (árvore de componentes) + sanitização
  render.js                Serializa a árvore para HTML/CSS
  storage.js               chrome.storage.local (configurações, projetos)
  providers.js             Chamadas BYOK para Groq/OpenAI/Anthropic/Google
  canvas.js                 Editor visual: paleta, drag-and-drop, camadas, inspetor
  chat.js                   UI do chat
  app.js                    Orquestra tudo em torno do estado do projeto
```

## Licença

MIT — veja [LICENSE](LICENSE).
