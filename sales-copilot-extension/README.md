# Co-piloto de vendas com IA - C&S Virtual (extensão do Chrome)

Extensão para Google Chrome que funciona como **assistente de vendas
consultivas pelo WhatsApp**, usando IA (Anthropic Claude e/ou Google
Gemini, conforme configurado em Opções) para ajudar o vendedor a conduzir
a conversa: funil de vendas, perfis de cliente, chatbot de apoio e
histórico de leads.

Código-fonte extraído do pacote `.crx` distribuído (v2.49.5) — sem
minificação, pronto para desenvolvimento.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** ("Load unpacked").
4. Selecione a pasta `sales-copilot-extension/` deste repositório.
5. Clique no ícone da extensão na barra do Chrome — o Copiloto abre em uma
   aba normal (a mesma aba é reaproveitada em cliques seguintes, nunca
   abre duplicada).

Não é necessário build nem npm install — é JavaScript puro, HTML e CSS.

## Estrutura

- `manifest.json` — Manifest V3. Permissões: `storage`, `unlimitedStorage`,
  `clipboardRead`. Host permissions para `api.anthropic.com` e
  `generativelanguage.googleapis.com` (chamadas diretas às APIs de IA).
- `background.js` — service worker: abre/foca a aba única do painel e das
  opções, e coordena (via fila serializada por chave) a geração da
  credencial inicial para não haver corrida entre abas.
- `panel.html` / `panel.js` — tela principal: funil de vendas, lista de
  leads, histórico de conversa.
- `options.html` / `options.js` — configurações (chaves de API, perfis).
- `auth.js` — autenticação/criptografia local (PBKDF2) das credenciais.
- `perfis.js` — perfis de atendimento/vendedor.
- `funil-padrao.js` — definição do funil de vendas padrão.
- `chatbot.js` — lógica de chat com o provedor de IA configurado.
- `aba-unica.js` / `backtotop.js` — utilitários de UI compartilhados entre
  `panel.html` e `options.html`.
- `shared/`, `core/`, `content/` — evolução em andamento pra ler o WhatsApp
  Web automaticamente (ver seção **Evolução: leitura do WhatsApp Web**
  abaixo). `panel.js` já consome `core/conversation-context.js` (fase 4)
  pra auto-preencher `pasteBox` — o resto (funil como dado, validador de
  resposta) ainda não é usado pelo painel principal.

## Evolução: leitura do WhatsApp Web (em andamento, por fases)

Documento de arquitetura completo na sessão que iniciou isto — resumo do
que já existe:

- **`shared/logger.js`** — log estruturado por nível (DEBUG/INFO/WARN/ERROR).
- **`shared/messaging.js`** — contrato de mensagens entre o content script do
  WhatsApp, o `background.js` e o painel.
- **`core/`** — lógica pura (sem DOM, sem `chrome.*`), testável isoladamente:
  normalização de mensagens, contexto/janela por lead, funil como dado,
  validador de resposta de IA.
- **`content/whatsapp-adapter.js`** + **`content/selectors.js`** — content
  script injetado em `https://web.whatsapp.com/*` (declarado em
  `manifest.json`). **Fases 2+3** (escopo atual): observa, loga, e repassa
  (via `background.js`) conversa ativa/mensagens novas pra aba do painel,
  **se ela estiver aberta** — `panel.js` ainda não faz nada com isso (fase
  4). Nunca dispara chamada de IA, nunca escreve no DOM do WhatsApp nem
  intercepta envio de mensagem. Inclui um health-check periódico (5s) que
  reconecta o `MutationObserver` se o WhatsApp Web substituir o container
  do painel inteiro (comum em apps React) — sem isso a extensão ficaria
  "cega" silenciosamente até a página recarregar.

  **Segurança**: `chrome.runtime.sendMessage` transmite pra todo listener
  vivo da extensão ao mesmo tempo — não existe "só o background recebe e
  decide". `background.js` valida a origem antes de repassar
  (`_copilotoOrigemEhWhatsApp`) e `panel.js` (fase 4) repete a mesma
  validação no próprio listener (`_copilotoWaMensagemConfiavel`), já que
  ele também pode receber a transmissão bruta diretamente. Ver aviso
  completo em `shared/messaging.js`.

- **`panel.js` (fases 4+5)** — escuta `CONVERSA_MUDOU`/`MENSAGENS_NOVAS` e
  preenche `pasteBox` automaticamente, no lugar do botão "Colar" manual —
  **nunca chama a IA sozinho**, isso continua exigindo clique humano em
  "Gerar resposta", como sempre. Nunca sobrescreve uma edição manual do
  atendente no campo (só reescreve enquanto o conteúdo ainda é exatamente o
  que o próprio mecanismo escreveu da última vez). Sem WhatsApp
  aberto/detectando nada, o fluxo manual de colar continua funcionando
  exatamente como hoje — o Adapter é só um atalho a mais, nunca a única
  forma de preencher o campo.

  **Fase 5 — a qual lead a conversa pertence**: um `Conversation Context`
  (`core/conversation-context.js`) **por contato** detectado no WhatsApp,
  nunca um único contexto ambiente global — troca de conversa no WhatsApp
  Web sem trocar de lead no painel (ou vice-versa) nunca mistura o texto de
  uma pessoa com o cadastro de outra (`_copilotoWaLeadCombinaComContato`):
  - Lead normal sem nome ainda: adota a identidade do contato detectado.
  - Lead normal já com nome: só auto-preenche se o nome bater
    (case-insensitive); se não bater, **não mexe no campo** e avisa por
    toast — nunca risca a hipótese de colar a conversa de um cliente na
    ficha de outro.
  - Central de mensagens (`lead.fixo`, `@csvirtual`): a mensagem sempre
    pode entrar (é pra isso que a Central existe), mas o **nome da pessoa**
    (`personNameInput`) nunca é preenchido por este mecanismo — continua
    100% manual, porque é o campo que decide casamento de
    histórico/estágio (ver `preencherEstagioPorNomeConhecido` em
    `panel.js`), e esse é justamente o tipo de erro que não pode acontecer
    por uma leitura errada do DOM.

  **Importante — seletores não verificados contra o WhatsApp Web ao vivo**:
  os seletores em `content/selectors.js` foram escritos com base em
  conhecimento geral da estrutura do WhatsApp Web (que muda sem aviso, sem
  API pública). Depois de carregar a extensão com o WhatsApp Web aberto e
  logado, rode no console **da aba do WhatsApp** (não do painel):
  ```js
  copilotoWhatsAppDiagnostico()
  ```
  Isso mostra uma tabela com qual seletor bateu (e em que posição da lista
  de fallback) para cada conceito — painel de mensagens, bolha de mensagem,
  nome do contato etc. — ou `"MISS"` se nenhum bateu. Qualquer `MISS`, ou
  "bateu só no último fallback", é sinal de que `content/selectors.js`
  precisa de ajuste para a versão atual do WhatsApp Web.

## Dados e IA

Como no PDV, os dados de leads/funil ficam salvos localmente (IndexedDB /
`chrome.storage`) — o único tráfego de rede é a chamada direta às APIs de
IA definidas em `host_permissions`, usando a chave configurada pelo
usuário em Opções.
