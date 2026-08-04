# C&S OS — imagem instalável (.iso)

Esta pasta gera uma **imagem Debian Live instalável** do C&S OS: um `.iso`
que já boota direto em tela cheia no Chromium mostrando o app deste
repositório (`desktop/index.html`), e que pode ser **instalado
permanentemente no disco** pelo menu "Install" do próprio boot da imagem —
diferente de `csos/install.sh`, que só configura uma máquina Debian/Ubuntu
que alguém já instalou manualmente.

Por baixo é Debian 12 "bookworm" de verdade — isto empacota Debian com o
kiosk pré-configurado, não é uma distro "from scratch".

## Como funciona

`build.sh`:

1. Copia o conteúdo deste repositório (exceto `.git`, `.claude` e esta
   própria pasta `csos/iso/`) para `config/includes.chroot/opt/csos-app/`
   — os arquivos que o `live-build` grava dentro do sistema de arquivos da
   imagem.
2. Gera `config/includes.chroot/etc/systemd/system/csos-webserver.service`
   e `config/hooks/live/0100-csos-setup.hook.chroot` a partir dos templates
   em `csos/systemd/` e `hooks-src/`, com usuário/porta já preenchidos.
3. Roda `lb config` (Debian 12 bookworm, amd64, `iso-hybrid`,
   `--debian-installer live` — inclui o instalador de disco padrão do
   Debian, que instala copiando o sistema live já customizado, preservando
   o kiosk).
4. Roda `lb build`, que baixa e monta um Debian inteiro dentro do chroot,
   instala os pacotes (`xserver-xorg`, `xinit`, `chromium`, `python3`,
   `curl`), aplica o hook (cria o usuário de kiosk, autologin na tty1,
   `.xinitrc`, habilita `csos-webserver.service`, aplica o branding de
   `/etc/os-release`) e empacota tudo num `.iso`.

## Pré-requisitos

- Uma máquina (ou VM) **Debian ou Ubuntu de verdade**, com privilégio de
  root de fato (chroot/mount/loopback) — **não roda dentro de containers
  sandboxed** como o ambiente onde este código foi escrito.
- Pacote `live-build` instalado (`sudo apt install live-build`).
- Uns 10-15 GB de espaço livre em disco e acesso à internet (o build baixa
  o repositório Debian inteiro na primeira vez).
- Tempo: de 15 a 40 minutos dependendo da conexão e da máquina.

## Uso

```sh
sudo ./build.sh
```

Variáveis opcionais:

```sh
sudo APP_USER=csos PORT=8973 ./build.sh
```

Ao final, o `.iso` fica em `csos/iso/live-image-amd64.hybrid.iso` (nome
gerado pelo `live-build`; renomeie como quiser).

Pra limpar e recomeçar do zero (ex: depois de mudar a versão do Debian):

```sh
sudo lb clean --purge
```

## Testando

- **Numa VM** (recomendado antes de gravar em disco físico): abra o `.iso`
  no QEMU, VirtualBox ou VMware.
- **Num pendrive**: `sudo dd if=live-image-amd64.hybrid.iso of=/dev/sdX
  bs=4M status=progress conv=fsync` (confira o dispositivo certo com
  `lsblk` antes — `dd` sobrescreve sem perguntar).
- No menu de boot da imagem, escolha **"Live"** pra rodar sem instalar
  (bom pra testar) ou **"Install"** pra instalar permanentemente no disco
  da máquina (apaga o disco escolhido durante o instalador — like sempre
  num instalador de SO).

## Limitações honestas

- **Nunca foi de fato construído nem testado num boot real.** Esta
  configuração foi escrita e revisada por leitura (sintaxe dos hooks
  validada com `sh -n`), mas gerar e testar um `.iso` de verdade exige
  privilégios de root/chroot que não existem no ambiente onde isto foi
  desenvolvido. Rode `build.sh` numa VM descartável antes de usar em
  qualquer máquina que importe.
- O instalador embutido é o Debian Installer padrão (texto/semi-gráfico),
  não algo customizado tipo Calamares — funciona, mas não é bonito.
- `chromium` precisa estar disponível no repositório Debian escolhido; se
  o pacote sair do Debian estável de novo (já aconteceu no passado), o
  build falha em `lb build` e será preciso trocar por
  `chromium-browser`/Firefox ESR no `package-lists/csos.list.chroot`.
- O usuário de kiosk (`APP_USER`, padrão `csos`) é criado **sem senha** —
  adequado pra um aparelho de único propósito com autologin, mas pense
  duas vezes antes de expor esse usuário a login remoto (SSH etc.).
