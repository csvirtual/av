# Modelo de segurança

Este documento existe pra deixar explícito o que este projeto garante hoje,
e o que **não** garante — leia antes de rodar isso em produção ou distribuir
pra terceiros.

## O que já está coberto

- **Transporte criptografado ponta a ponta.** WebRTC exige DTLS-SRTP em
  toda mídia e `RTCDataChannel`. O `signaling-server` nunca tem acesso ao
  vídeo, mouse ou teclado — só troca SDP/ICE (metadados de conexão).
- **Código de acesso de uso único.** Um código só serve para uma sessão:
  expira em `CODE_TTL_MS` (padrão 5 min) se ninguém entrar, e é invalidado
  assim que um viewer conecta (ver `signaling-server/server.js`, classe
  `Room`).
- **Rate limiting por IP** nas tentativas de `viewer-join`
  (`MAX_JOIN_ATTEMPTS` por `JOIN_WINDOW_MS`), pra dificultar força bruta do
  código de 6 dígitos.
- **Input só é injetado com sessão ativa.** O `host-agent` só chama
  `input-controller.inject()` depois que o `RTCDataChannel` de input abre
  (`ipcMain.handle('inject-input', …)` checa `isSharing`).
- **Superfície de privilégio mínima na renderer do Electron.**
  `contextIsolation: true` + `nodeIntegration: false`; a única ponte pro
  SO é o `preload.js`, que expõe só 4 funções bem definidas — a renderer
  não tem `require()` nem acesso direto a módulos Node.

## O que é responsabilidade de quem for operar/distribuir isto

- **Rode o `signaling-server` atrás de TLS** (`wss://`), nunca `ws://` puro
  em produção — senão o código de acesso trafega em texto puro.
- **Consentimento explícito.** Ao contrário do Chrome Remote Desktop
  oficial, o `host-agent` aqui **não** pede confirmação visual antes de
  começar a compartilhar/aceitar controle — quem gera o código já está
  compartilhando. Se for distribuir pra usuários finais, adicione uma tela
  de confirmação clara ("Fulano quer se conectar. Aceitar?") antes de abrir
  o `RTCDataChannel` de input.
- **Tamanho/entropia do código.** 6 dígitos (10⁶ combinações) + rate limit
  + expiração de 5 min é aceitável para "suporte remoto pontual" (modelo
  *Remote Support* do CRD), mas é fraco para acesso desatendido de longo
  prazo. Para isso, implemente o modelo *Remote Access* (PIN persistente +
  pareamento único de dispositivo, como o CRD faz), não o código curto.
- **TURN server.** Sem TURN, conexões atrás de NAT simétrico simplesmente
  falham silenciosamente (ICE não conecta). Configure um TURN
  autenticado (ex. coturn com credenciais de curta duração) antes de expor
  isto pra usuários fora da sua rede.
- **Native Messaging Host roda com os privilégios do usuário logado** —
  ele pode iniciar/parar o `host-agent`, mas não escala privilégio algum
  (não roda como admin/root). Ainda assim, trate `host.js` como código que
  roda automaticamente ao clicar na extensão: audite antes de distribuir
  binários assinados.
- **Assinatura de código.** Para distribuição real, assine o `host-agent`
  empacotado (electron-builder suporta `win.certificateFile` /
  notarização no macOS) — SO modernos bloqueiam/alertam sobre executáveis
  não assinados que pedem acessibilidade (necessária pra injeção de
  input no macOS) ou automação.
- **Permissões de acessibilidade (macOS) / X11 (Linux).** Em macOS, o
  `host-agent` vai precisar que o usuário conceda permissão em
  *Preferências do Sistema → Privacidade → Acessibilidade* pra
  `@nut-tree-fork/nut-js` conseguir mover o mouse. Documente isso na hora
  de distribuir.

## Não implementado (fora do escopo do MVP)

- Autenticação de usuário/conta (hoje é só "quem tem o código, entra").
- Auditoria/logs de sessão.
- Gravação de sessão.
- Multi-monitor / seleção de janela específica (só a tela primária inteira).
