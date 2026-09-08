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

## Dados e IA

Como no PDV, os dados de leads/funil ficam salvos localmente (IndexedDB /
`chrome.storage`) — o único tráfego de rede é a chamada direta às APIs de
IA definidas em `host_permissions`, usando a chave configurada pelo
usuário em Opções.
