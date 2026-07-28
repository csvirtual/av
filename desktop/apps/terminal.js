// Terminal: interpreta comandos de verdade contra o sistema de arquivos
// virtual (o mesmo do Explorador de Arquivos) — não é uma simulação com
// saída fixa.
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
    width: 620,
    height: 420,
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

  async function updatePrompt() {
    const path = await fs.getPath(cwd);
    const label = path.map((n) => n.name).join('\\') || 'C:';
    promptEl.textContent = `${label}>`;
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

  const COMMANDS = {
    async help() {
      println('Comandos disponíveis:');
      println('  ls, dir            lista arquivos e pastas');
      println('  cd <pasta>          entra em uma pasta (cd .. volta)');
      println('  pwd                 mostra o caminho atual');
      println('  cat, type <arquivo> mostra o conteúdo de um arquivo de texto');
      println('  mkdir, md <nome>    cria uma pasta');
      println('  echo <texto>        escreve texto; use > arquivo para salvar');
      println('  rm, del <nome>      move para a Lixeira');
      println('  cls, clear          limpa a tela');
      println('  whoami              mostra o usuário atual');
      println('  date                mostra data e hora');
      println('  ver                 mostra a versão');
      println('  exit                fecha o terminal');
    },
    async ls() {
      const children = await fs.getChildren(cwd);
      if (!children.length) {
        println('(vazio)');
        return;
      }
      children.forEach((c) => println(c.type === 'folder' ? `[${c.name}]` : c.name));
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
      const path = await fs.getPath(cwd);
      println(path.map((n) => n.name).join('\\'));
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
      println(await kv.get('user.name', 'Usuário'));
    },
    async date() {
      println(new Date().toLocaleString('pt-BR'));
    },
    async ver() {
      println('Windows 11 Web Desktop [Simulado, executado no navegador]');
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
      println(`'${cmd}' não é reconhecido como um comando interno. Digite "help".`, 'err');
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

  println('Terminal — digite "help" para ver os comandos disponíveis.');
  updatePrompt();
  setTimeout(() => input.focus(), 50);

  return win;
}
