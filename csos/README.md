# C&S OS — camada de kiosk

Este diretório **não é uma distro Linux construída do zero** (não gera um
`.iso` instalável) — é uma **camada de provisionamento** que transforma uma
instalação já existente de Debian/Ubuntu (ou qualquer base com `systemd` +
`apt`) num aparelho de único propósito: liga direto em tela cheia no
Chromium, mostrando o "Windows 11 Web Desktop" deste repositório
(`desktop/index.html`) — sem GNOME, KDE, painel de tarefas real ou qualquer
outra coisa do sistema visível.

Pense nisso como o mesmo princípio por trás de aparelhos como Chrome OS ou
totens de autoatendimento: o sistema operacional de baixo continua sendo
Linux de verdade (kernel, systemd, pacotes reais) — só a "cara" que a pessoa
vê ao ligar é substituída por um navegador em modo kiosk apontado pro nosso
app.

## Por que não um `.iso` de verdade

Gerar uma imagem de disco instalável (via `live-build`, `archiso` etc.)
exige um toolchain pesado (debootstrap, squashfs-tools, xorriso...) e só dá
pra validar de verdade testando o boot numa VM ou máquina real — nenhuma das
duas coisas existe neste ambiente de desenvolvimento isolado. Os scripts
aqui, em vez disso, são pensados pra rodar (e serem revisados/testados passo
a passo) numa máquina Debian/Ubuntu de verdade — física ou numa VM — que
você já tenha à mão.

## O que o `install.sh` faz

1. Instala os pacotes necessários: `xserver-xorg`, `xinit`, um navegador
   Chromium (`chromium` ou `chromium-browser`, dependendo da distro) e
   `python3` (servidor estático).
2. Copia o app deste repositório (tudo exceto esta própria pasta `csos/` e
   `.git`) para `/opt/csos-app` (customizável via `APP_DIR=`).
3. Instala e habilita `csos-webserver.service` — serve `desktop/index.html`
   só em `127.0.0.1:8973` (nunca exposto pra fora da máquina).
4. Configura login automático (autologin) do usuário escolhido na tty1.
5. Configura esse mesmo usuário pra subir o X (`startx`) automaticamente ao
   logar na tty1, carregando `kiosk/xinitrc`, que por sua vez roda
   `kiosk/start-kiosk.sh` — o script que detecta o binário certo do
   Chromium e abre em `--kiosk` apontado pro servidor local.
6. Troca `/etc/os-release` por uma versão com `NAME`/`PRETTY_NAME` do C&S OS
   (mantendo `ID_LIKE=debian` intacto, pra não quebrar nada que dependa
   disso) — fazendo backup do original antes.

Tudo é **idempotente** (pode rodar `install.sh` de novo sem duplicar nada) e
**reversível** — `uninstall.sh` desfaz cada passo, restaurando os arquivos
originais a partir do backup que o `install.sh` sempre cria antes de
sobrescrever qualquer coisa.

## Uso

```sh
sudo APP_USER=usuario ./install.sh
```

Se `APP_USER` não for informado, usa `$SUDO_USER` (o usuário que chamou
`sudo`). Depois de rodar, reinicie a máquina — ela deve logar sozinha na
tty1 e abrir direto em tela cheia no C&S OS.

Pra desfazer tudo:

```sh
sudo ./uninstall.sh
```

## Estrutura

```
csos/
  install.sh              # provisiona a máquina
  uninstall.sh             # reverte tudo, restaurando backups
  systemd/
    csos-webserver.service # serve o app estático em 127.0.0.1:8973
  kiosk/
    start-kiosk.sh          # detecta o Chromium e abre em modo kiosk
    xinitrc                 # .xinitrc instalado pro usuário do kiosk
  branding/
    os-release              # /etc/os-release do C&S OS (ID_LIKE=debian preservado)
  config/
    autologin.conf.template # modelo do drop-in de autologin (usuário é substituído pelo install.sh)
```

## Nota sobre Ubuntu e snap

No Ubuntu (desde a 20.04), o pacote `chromium` do `apt` é só um pacote de
transição que aciona a instalação do snap por baixo — se a máquina não tiver
`snapd` ou não tiver rede pra loja de snaps, o `apt install` "funciona" mas
nenhum binário de verdade fica disponível. O `install.sh` detecta esse caso
e para com um erro claro (em vez de deixar a máquina reiniciar pra uma tela
preta sem navegador). Numa base Debian isso não acontece — lá `chromium` é
um pacote real via `apt`.

## Limitações honestas

- Não troca o kernel, não é uma distro "from scratch" — é Debian/Ubuntu de
  verdade por baixo, só com a cara e o comportamento de um aparelho de
  único propósito.
- Não gera imagem `.iso`/`.img` instalável — precisa ser aplicado numa
  instalação já existente.
- Testado quanto à sintaxe e lógica dos scripts (`bash -n`), mas **não
  testado num boot real** neste ambiente — não há como. Revise antes de
  rodar numa máquina que você não pode perder.
