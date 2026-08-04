# C&S OS — imagem instalável (.iso)

Esta pasta gera uma **imagem Debian Live instalável** do C&S OS: um `.iso`
leve que já boota direto em tela cheia no Chromium mostrando o app deste
repositório (`desktop/index.html`), e que pode ser **instalado
permanentemente no disco** rodando um comando de dentro da própria sessão
live — diferente de `csos/install.sh`, que só configura uma máquina
Debian/Ubuntu que alguém já instalou manualmente.

Por baixo é Debian 12 "bookworm" de verdade — isto empacota Debian com o
kiosk pré-configurado, não é uma distro "from scratch".

Não usa o Debian Installer oficial de propósito: pra um aparelho de único
propósito (sem escolha de idioma, particionamento manual, desktop
environment etc.) ele é peso e complexidade desnecessários. Em vez disso,
`csos-install-to-disk` (script próprio, ~100 linhas) simplesmente copia o
sistema live já configurado pro disco — mais rápido de gerar e mais leve
no `.iso` final.

## Como funciona

`build.sh`:

1. Copia o conteúdo deste repositório (exceto `.git`, `.claude` e esta
   própria pasta `csos/iso/`) para `config/includes.chroot/opt/csos-app/`
   — os arquivos que o `live-build` grava dentro do sistema de arquivos da
   imagem.
2. Gera `config/includes.chroot/etc/systemd/system/csos-webserver.service`
   e `config/hooks/live/0100-csos-setup.hook.chroot` a partir dos templates
   em `csos/systemd/` e `hooks-src/`, com usuário/porta já preenchidos.
3. Roda `lb config` (Debian 12 bookworm, amd64, `iso-hybrid`, sem
   `--debian-installer`).
4. Roda `lb build`, que baixa e monta um Debian inteiro dentro do chroot,
   instala os pacotes — kiosk (`xserver-xorg`, `xinit`, `chromium`,
   `python3`, `curl`) e instalador (`gdisk`, `dosfstools`, `parted`,
   `rsync`, `grub-pc-bin`, `grub-efi-amd64-bin`) — aplica o hook (cria o
   usuário de kiosk, autologin na tty1 pro kiosk e na tty2 pra
   manutenção, `.xinitrc`, habilita `csos-webserver.service`, aplica o
   branding de `/etc/os-release`, libera `sudo csos-install-to-disk` sem
   senha só pro usuário de kiosk) e empacota tudo num `.iso`.

## Pré-requisitos

- Uma máquina (ou VM) **Debian ou Ubuntu de verdade**, com privilégio de
  root de fato (chroot/mount/loopback) — **não roda dentro de containers
  sandboxed** como o ambiente onde este código foi escrito.
- Pacote `live-build` instalado (`sudo apt install live-build`).
- Espaço livre em disco pro *workspace* do build (cache de pacotes +
  chroot descompactado — bem mais que o `.iso` final) e acesso à
  internet. O `.iso` final em si é leve (sem Debian Installer nem
  ambiente de desktop, o maior componente é o próprio `chromium`).
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

## Testando / instalando

- **Numa VM** (recomendado antes de gravar em disco físico): abra o `.iso`
  no QEMU, VirtualBox ou VMware.
- **Num pendrive**: `sudo dd if=live-image-amd64.hybrid.iso of=/dev/sdX
  bs=4M status=progress conv=fsync` (confira o dispositivo certo com
  `lsblk` antes — `dd` sobrescreve sem perguntar).
- Ao bootar a mídia, o sistema já sobe direto em tela cheia no C&S OS
  (modo live, nada é gravado ainda). Pra instalar permanentemente:
  1. `Ctrl+Alt+F2` — cai num console de texto já logado (autologin do
     mesmo usuário de kiosk).
  2. `sudo csos-install-to-disk /dev/sdX` (troque `/dev/sdX` pelo disco
     de destino — confira com `lsblk` antes; **isto apaga o disco
     inteiro**, sem opção de particionamento parcial).
  3. Confirme digitando exatamente o que o script pedir.
  4. Ao terminar, desligue, remova a mídia de instalação e ligue de novo
     — a máquina deve bootar direto do disco em tela cheia no C&S OS.

## Limitações honestas

- **Nunca foi de fato construído nem testado num boot real.** Esta
  configuração foi escrita e revisada por leitura (sintaxe validada com
  `bash -n`/`sh -n`), mas gerar e testar um `.iso` de verdade exige
  privilégios de root/chroot que não existem no ambiente onde isto foi
  desenvolvido. Rode `build.sh` numa VM descartável antes de usar em
  qualquer máquina que importe.
- `csos-install-to-disk` assume o **disco inteiro** — sem dual-boot, sem
  redimensionar partição existente, sem criptografia. Adequado pra um
  aparelho de único propósito; não use numa máquina com dados que
  importem sem fazer backup antes.
- `chromium` precisa estar disponível no repositório Debian escolhido; se
  o pacote sair do Debian estável de novo (já aconteceu no passado), o
  build falha em `lb build` e será preciso trocar por
  `chromium-browser`/Firefox ESR no `package-lists/csos.list.chroot`.
- O usuário de kiosk (`APP_USER`, padrão `csos`) é criado **sem senha** —
  adequado pra um aparelho de único propósito com autologin, mas pense
  duas vezes antes de expor esse usuário a login remoto (SSH etc.). Ele
  tem `sudo` sem senha só pro comando `csos-install-to-disk`, não pra
  `ALL` — não é root geral.
