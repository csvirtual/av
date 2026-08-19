# cs-remote-desktop

Acesso remoto a computadores pelo navegador, no estilo do **Chrome Remote
Desktop**: quem está **vendo/controlando** (o *viewer*) não instala nada —
só abre uma página web no Chrome (ou qualquer navegador com WebRTC) e digita
um código. Quem está **compartilhando a tela** (o *host*) instala um app
leve + uma extensão do Chrome que liga/desliga o compartilhamento.

> ⚠️ **Por que não é "só uma extensão"?** Uma extensão de navegador roda
> isolada dentro do Chrome e não tem permissão pra mexer no sistema
> operacional. Nem o Chrome Remote Desktop de verdade funciona só com
> extensão — ele instala, junto, um **host nativo** (processo fora do
> navegador) responsável por capturar a tela inteira e mover o
> mouse/teclado de verdade. Este projeto segue o mesmo modelo: a extensão é
> a "chave de ignição", o trabalho pesado é feito por um app nativo.

## Como as peças se encaixam

```
┌──────────────┐   código de 6 dígitos    ┌──────────────────┐
│  web-client   │ ───────────────────────▶│ signaling-server │
│ (navegador,   │◀──────────────────────  │  (Node + ws)      │
│  sem install) │   SDP/ICE (relay)        └──────────────────┘
└──────┬────────┘                                   ▲  ▲
       │ WebRTC (vídeo + input) direto, P2P          │  │
       ▼                                             │  │
┌──────────────┐   inicia/para via Native Messaging   │  │
│  host-agent   │◀─────────────────────────────────┐ │  │
│  (Electron:   │                                   │ │  │
│  captura tela │        ┌──────────────────────┐   │ │  │
│  + injeta     │◀───────│ native-messaging-host │◀──┘ │  │
│  mouse/teclado)│       │   (host.js, stdio)     │     │  │
└──────────────┘         └───────────▲───────────┘     │  │
                                      │ nativeMessaging  │  │
                          ┌───────────┴───────────┐     │  │
                          │   chrome-extension     │─────┘  │
                          │  (popup: gerar código,  │        │
                          │   iniciar/parar host)   │────────┘
                          └─────────────────────────┘
```

| Diretório | O que é | Onde roda |
|---|---|---|
| `signaling-server/` | Servidor WebSocket que pareia host↔viewer por código e faz *relay* de SDP/ICE. Nunca vê vídeo/input. | Sua infra (Fly.io, Render, VPS…) |
| `host-agent/` | App Electron: gera o código, captura a tela (`desktopCapturer`), abre a conexão WebRTC e injeta mouse/teclado recebido (`@nut-tree-fork/nut-js`). | PC que vai ser controlado |
| `web-client/` | Página estática (HTML/JS puro). Quem controla abre no navegador, digita o código, vê a tela e manda mouse/teclado por um `RTCDataChannel`. | Qualquer navegador, sem instalar nada |
| `chrome-extension/` | Extensão MV3 com um popup pra iniciar/parar o `host-agent` e mostrar o código, conversando com ele via Native Messaging. | Chrome, na máquina host |

## Rodando localmente (dev)

Pré-requisitos: Node.js ≥ 18.

```bash
# 1) Servidor de sinalização
cd signaling-server
npm install
npm start                     # ws://localhost:8080

# 2) Host agent (em outra máquina/aba de terminal)
cd host-agent
npm install
npm start                     # abre a janela do host, botão "Gerar código"

# 3) Viewer — é só um site estático
cd web-client
python3 -m http.server 5500   # ou qualquer servidor estático
# abra http://localhost:5500 no navegador e digite o código
```

Por padrão tudo aponta pra `ws://localhost:8080`. Pra produção, defina
`CSRD_SIGNALING_URL=wss://sua-instancia.exemplo.com` ao rodar o host-agent, e
preencha o campo "Avançado → Servidor de sinalização" no `web-client` (ou
sirva o `web-client` com `window.CSRD_SIGNALING_URL` já definido num
`<script>` antes de `app.js`).

## Instalando a extensão Chrome + host nativo

1. `chrome://extensions` → ative o **Modo do desenvolvedor** → **Carregar
   sem compactação** → selecione a pasta `chrome-extension/`.
2. Copie o **ID da extensão** que aparece no card dela.
3. Rode o instalador da sua plataforma dentro de
   `chrome-extension/native-messaging-host/`, passando esse ID:
   - Linux: `./install-linux.sh <EXTENSION_ID>`
   - macOS: `./install-mac.sh <EXTENSION_ID>`
   - Windows: `powershell -File install-windows.ps1 -ExtensionId <EXTENSION_ID>`
4. Clique no ícone da extensão → **Iniciar host** → o `host-agent` abre e
   mostra o código de acesso.

O instalador registra, por padrão, `npx electron .` como comando de start
(modo desenvolvimento). Se você empacotar o host-agent com
`npm run dist` (electron-builder), edite
`~/.cs-remote-desktop/launch-config.json` apontando pro executável gerado.

## Segurança (leia antes de expor isso na internet)

Veja [`docs/SECURITY.md`](docs/SECURITY.md) para o modelo de ameaça
completo. Resumo:

- O vídeo e o input trafegam **P2P via WebRTC, criptografados com
  DTLS-SRTP** — o `signaling-server` só troca metadados de conexão (SDP/ICE),
  nunca vê o conteúdo da sessão.
- O código de acesso é de **uso único**: expira em 5 minutos se ninguém
  entrar, e é invalidado assim que um viewer conecta.
- Há *rate limiting* básico por IP contra força bruta do código no
  `signaling-server` — mesmo assim, **rode atrás de HTTPS/WSS** e considere
  reduzir `CODE_TTL_MS` / aumentar o tamanho do código em produção.
- O host-agent só injeta input **enquanto uma sessão WebRTC está
  ativa/conectada** — nunca antes disso.
- Nada aqui pede consentimento explícito na tela do usuário do host antes
  de compartilhar (diferente do Chrome Remote Desktop oficial, que exige
  confirmação visual). Isso é responsabilidade de quem for distribuir este
  app: **use apenas com consentimento explícito da pessoa dona do PC**.

## Limitações conhecidas

- Só a tela **primária** é capturada (sem seletor de monitor/janela ainda).
- Wayland (Linux) tem suporte parcial a injeção de input dependendo do
  compositor — X11 funciona sem ressalvas.
- Sem transferência de arquivos, área de transferência compartilhada ou
  áudio remoto — escopo do MVP é vídeo + mouse/teclado.
- Para redes com NAT simétrico/restritivo, configure um servidor **TURN**
  (ex: [coturn](https://github.com/coturn/coturn)) via as variáveis
  `CSRD_TURN_URL`/`CSRD_TURN_USERNAME`/`CSRD_TURN_CREDENTIAL` no host-agent
  e atualize `ICE_SERVERS` no `web-client/app.js`.

## Licença

Defina a licença que preferir para este repositório.
