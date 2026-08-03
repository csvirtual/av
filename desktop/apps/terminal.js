// Terminal: interpreta comandos de verdade contra o sistema de arquivos
// virtual (o mesmo do Explorador de Arquivos) — não é uma simulação com
// saída fixa. Formatação (prompt, "dir", banner, "net user") segue de
// perto o Prompt de Comando de verdade do Windows, inclusive as mensagens
// de erro reais ("Ocorreu o erro do sistema 5. Acesso negado.", etc.).
export function openTerminal(ctx) {
  const { windows, fs, seed, kv } = ctx;

  const root = document.createElement('div');
  root.className = 'terminal';
  root.innerHTML = `
    <div class="terminal-output" data-role="output"></div>
    <div class="terminal-inputline">
      <span class="terminal-prompt" data-role="prompt">C:\\&gt;</span>
      <input type="text" class="terminal-input" data-role="input" autocomplete="off" spellcheck="false">
    </div>
  `;

  const win = windows.createWindow({
    appId: 'terminal',
    title: 'Terminal',
    icon: '💻',
    width: 640,
    height: 440,
    content: root,
  });

  const output = root.querySelector('[data-role="output"]');
  const input = root.querySelector('[data-role="input"]');
  const promptEl = root.querySelector('[data-role="prompt"]');
  let cwd = seed.desktopId;
  const history = [];
  let historyIndex = -1;

  function println(text = '', cls = '') {
    const line = document.createElement('div');
    line.className = `terminal-line ${cls}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  // Reduz o caminho da árvore virtual (que começa em "Este Computador" >
  // "Disco Local (C:)" > ...) pro formato de letra de unidade que um
  // prompt de comando de verdade mostra — "C:\Usuários\Nome\...".
  async function currentPathLabel() {
    const path = await fs.getPath(cwd);
    const segments = path.slice(1).map((n, i) => (i === 0 ? 'C:' : n.name));
    if (segments.length <= 1) return 'C:\\';
    return segments.join('\\');
  }

  async function updatePrompt() {
    promptEl.textContent = `${await currentPathLabel()}>`;
  }

  async function resolveTarget(name) {
    if (name === '..') {
      const node = await fs.getNode(cwd);
      return node?.parentId || cwd;
    }
    if (name === '.' || !name) return cwd;
    const child = await fs.findChildByName(cwd, name);
    return child || null;
  }

  // Mesmo cálculo de "tamanho real" usado no Explorador (apps/explorer.js):
  // pra uma data: URL, o tamanho do binário decodificado, não o tamanho do
  // texto da própria data: URL (~33% maior por causa da codificação base64).
  function contentByteSize(node) {
    const content = node.content || '';
    if (content.startsWith('data:')) {
      const base64 = content.split(',')[1] || '';
      return Math.round((base64.length * 3) / 4);
    }
    return new Blob([content]).size;
  }

  function formatDirDate(ts) {
    const d = new Date(ts || Date.now());
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}  ${hh}:${min}`;
  }

  // Espaço livre de verdade via Storage API, quando o navegador expõe isso
  // (mesma API já usada em main.js pro aviso de armazenamento cheio) — sem
  // isso disponível, omite a informação em vez de inventar um número.
  async function freeBytesEstimate() {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota != null && est?.usage != null) return Math.max(0, est.quota - est.usage);
    } catch { /* API indisponível neste navegador */ }
    return null;
  }

  const COMMANDS = {
    async help() {
      println('Comandos disponíveis:');
      println('  ls, dir              lista arquivos e pastas');
      println('  cd <pasta>           entra em uma pasta (cd .. volta)');
      println('  pwd                  mostra o caminho atual');
      println('  cat, type <arquivo>  mostra o conteúdo de um arquivo de texto');
      println('  mkdir, md <nome>     cria uma pasta');
      println('  echo <texto>         escreve texto; use > arquivo para salvar');
      println('  rm, del <nome>       move para a Lixeira');
      println('  cls, clear           limpa a tela');
      println('  whoami               mostra o usuário atual');
      println('  date                 mostra data e hora');
      println('  ver                  mostra a versão');
      println('  net user             lista as contas locais do dispositivo');
      println('  net user <nome>      mostra informações de uma conta');
      println('  net user <nome> <senha>');
      println('                       redefine a senha de outra conta (admin)');
      println('  exit                 fecha o terminal');
    },
    async ls() {
      const children = await fs.getChildren(cwd);
      const selfNode = await fs.getNode(cwd);
      const label = await currentPathLabel();
      println(' O volume na unidade C não tem nome.');
      println(' O número de série do volume é 5C77-A1B2');
      println('');
      println(` Pasta de ${label}`);
      println('');
      const now = selfNode?.modifiedAt || Date.now();
      println(`${formatDirDate(now)}    <DIR>          .`);
      println(`${formatDirDate(now)}    <DIR>          ..`);
      const folders = children.filter((c) => c.type === 'folder');
      const files = children.filter((c) => c.type === 'file');
      folders.forEach((f) => println(`${formatDirDate(f.modifiedAt)}    <DIR>          ${f.name}`));
      let totalBytes = 0;
      files.forEach((f) => {
        const size = contentByteSize(f);
        totalBytes += size;
        println(`${formatDirDate(f.modifiedAt)}    ${String(size).padStart(14, ' ')} ${f.name}`);
      });
      println(`${String(files.length).padStart(16, ' ')} arquivo(s) ${totalBytes.toLocaleString('pt-BR').padStart(15, ' ')} bytes`);
      const freeBytes = await freeBytesEstimate();
      const freeSuffix = freeBytes != null ? `  ${freeBytes.toLocaleString('pt-BR')} bytes livres` : '';
      println(`${String(folders.length).padStart(16, ' ')} pasta(s)${freeSuffix}`);
    },
    async cd(args) {
      if (!args[0]) return;
      const target = await resolveTarget(args[0]);
      if (!target || (target.type && target.type !== 'folder')) {
        println(`O sistema não pode encontrar o caminho especificado: ${args[0]}`, 'err');
        return;
      }
      cwd = target.id || target;
      await updatePrompt();
    },
    async pwd() {
      println(await currentPathLabel());
    },
    async cat(args) {
      if (!args[0]) { println('Uso: cat <arquivo>', 'err'); return; }
      const node = await resolveTarget(args[0]);
      if (!node || node.type !== 'file') {
        println(`Arquivo não encontrado: ${args[0]}`, 'err');
        return;
      }
      (node.content || '').split('\n').forEach((l) => println(l));
    },
    async mkdir(args) {
      if (!args[0]) { println('Uso: mkdir <nome>', 'err'); return; }
      const existing = await fs.findChildByName(cwd, args[0]);
      if (existing) { println('Já existe um item com esse nome.', 'err'); return; }
      await fs.createNode({ parentId: cwd, name: args[0], type: 'folder' });
      ctx.refreshDesktop?.();
    },
    async echo(args, rawText) {
      const gtIndex = rawText.indexOf('>');
      if (gtIndex === -1) {
        println(rawText);
        return;
      }
      const text = rawText.slice(0, gtIndex).trim();
      const fileName = rawText.slice(gtIndex + 1).trim();
      if (!fileName) { println('Uso: echo <texto> > <arquivo>', 'err'); return; }
      const existing = await fs.findChildByName(cwd, fileName);
      if (existing) await fs.updateNode(existing.id, { content: text });
      else await fs.createNode({ parentId: cwd, name: fileName, type: 'file', content: text });
      ctx.refreshDesktop?.();
    },
    async rm(args) {
      if (!args[0]) { println('Uso: rm <nome>', 'err'); return; }
      const node = await fs.findChildByName(cwd, args[0]);
      if (!node) { println(`Não encontrado: ${args[0]}`, 'err'); return; }
      await fs.trash(node.id, seed.trashId);
      ctx.refreshDesktop?.();
    },
    async cls() {
      output.innerHTML = '';
    },
    async whoami() {
      const name = await kv.get('user.name', 'Usuário');
      const userPart = name.trim().toLowerCase().replace(/\s+/g, '') || 'usuario';
      println(`win11-web\\${userPart}`);
    },
    async date() {
      println(new Date().toLocaleString('pt-BR'));
    },
    async ver() {
      println('');
      println('Windows 11 Web Desktop [Versão 10.0.22631.4317]');
      println('');
    },
    async net(args) {
      if ((args[0] || '').toLowerCase() !== 'user') {
        println(`A opção '${args[0] || ''}' é desconhecida.`, 'err');
        println('Digite NET HELP USER para obter ajuda.', 'err');
        return;
      }
      const name = args[1];
      const newPassword = args[2];

      if (!name) {
        // "net user" sozinho: lista as contas locais, em colunas de 3 —
        // igual ao formato real do Windows.
        const accounts = await ctx.listAccounts();
        println('Contas de usuário para \\\\WIN11-WEB');
        println('');
        println('-------------------------------------------------------------------------------');
        for (let i = 0; i < accounts.length; i += 3) {
          const row = accounts.slice(i, i + 3).map((a) => a.name.padEnd(25, ' ')).join('');
          println(row.trimEnd());
        }
        println('O comando foi concluído com êxito.');
        return;
      }

      const accounts = await ctx.listAccounts();
      const target = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());

      if (!newPassword) {
        // "net user <nome>": mostra as informações reais que temos dessa
        // conta (não inventa campos como "Comentário"/"Expira em" que o
        // Windows de verdade tem mas que não fazem sentido aqui).
        if (!target) {
          println('Ocorreu o erro do sistema 2221.', 'err');
          println('', 'err');
          println('O nome de usuário não pôde ser encontrado.', 'err');
          return;
        }
        const tipo = target.primary ? 'Administrador Geral' : target.role === 'admin' ? 'Administrador' : 'Usuário comum';
        const grupo = target.primary || target.role === 'admin' ? 'Administradores' : 'Usuários';
        println(`Nome de usuário              ${target.name}`);
        println(`Conta ativa                  Sim`);
        println(`Tipo de conta                ${tipo}`);
        println(`Grupos locais                *${grupo}`);
        println('O comando foi concluído com êxito.');
        return;
      }

      // "net user <nome> <senha>": redefine a senha de outra conta — só
      // administradores podem fazer isso, igual ao Windows de verdade.
      if (!target) {
        println('Ocorreu o erro do sistema 2221.', 'err');
        println('', 'err');
        println('O nome de usuário não pôde ser encontrado.', 'err');
        return;
      }
      if (newPassword.length < 4) {
        println('A senha deve ter ao menos 4 caracteres.', 'err');
        return;
      }
      const result = await ctx.netUserSetPassword(name, newPassword);
      if (result === 'forbidden') {
        println('Ocorreu o erro do sistema 5.', 'err');
        println('', 'err');
        println('Acesso negado.', 'err');
        return;
      }
      println('O comando foi concluído com êxito.');
    },
    async exit() {
      win.close();
    },
  };
  COMMANDS.dir = COMMANDS.ls;
  COMMANDS.md = COMMANDS.mkdir;
  COMMANDS.type = COMMANDS.cat;
  COMMANDS.del = COMMANDS.rm;
  COMMANDS.clear = COMMANDS.cls;

  async function runCommand(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const [cmd, ...args] = trimmed.split(/\s+/);
    const handler = COMMANDS[cmd.toLowerCase()];
    if (!handler) {
      println(`'${cmd}' não é reconhecido como um comando interno`, 'err');
      println('ou externo, um programa operável ou um arquivo em lotes.', 'err');
      return;
    }
    const rest = trimmed.slice(cmd.length).trim();
    await handler(args, rest);
  }

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const value = input.value;
      println(`${promptEl.textContent} ${value}`, 'echo');
      if (value.trim()) {
        history.push(value);
        historyIndex = history.length;
      }
      input.value = '';
      await runCommand(value);
    } else if (e.key === 'ArrowUp') {
      if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < history.length - 1) { historyIndex++; input.value = history[historyIndex]; }
      else { historyIndex = history.length; input.value = ''; }
      e.preventDefault();
    }
  });

  root.addEventListener('pointerdown', (e) => {
    if (e.target !== input) input.focus();
  });

  println('Windows 11 Web Desktop [Versão 10.0.22631.4317]');
  println('Todos os direitos reservados.');
  println('');
  println('Digite "help" para ver os comandos disponíveis.');
  println('');
  updatePrompt();
  setTimeout(() => input.focus(), 50);

  return win;
}
