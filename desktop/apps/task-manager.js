// Gerenciador de Tarefas: monitora de verdade a própria PWA — janelas
// abertas (processos reais desta aplicação, encerráveis de verdade) e uso
// de memória do navegador quando a API está disponível. Não exibe números
// de CPU/RAM inventados: quando um dado real não existe no navegador, diz
// isso explicitamente em vez de fingir.
function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}min ${s}s`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}
function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function openTaskManager(ctx) {
  const { windows } = ctx;

  const root = document.createElement('div');
  root.className = 'taskmgr';
  root.innerHTML = `
    <div class="clockapp-tabs">
      <button data-tab="processes" class="active">📋 Processos</button>
      <button data-tab="performance">📈 Desempenho</button>
    </div>
    <div class="clockapp-content" data-role="content"></div>
  `;

  const win = windows.createWindow({
    appId: 'taskmanager',
    title: 'Gerenciador de Tarefas',
    icon: '📊',
    width: 480,
    height: 480,
    content: root,
  });

  const content = root.querySelector('[data-role="content"]');
  const memorySamples = [];
  const timers = [];
  let unsubscribe = null;
  win.onClose(() => {
    timers.forEach(clearInterval);
    unsubscribe?.();
  });

  function getMemory() {
    return performance.memory ? performance.memory.usedJSHeapSize : null;
  }

  function renderProcesses() {
    const processes = windows.listProcesses().filter((p) => p.id !== win.id);
    const memory = getMemory();
    content.innerHTML = `
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px">
        Ativo há ${formatUptime(Date.now() - ctx.getBootTime())} ·
        ${processes.length} janela(s) aberta(s) ·
        Memória: ${memory != null ? formatMB(memory) : 'não disponível neste navegador'}
      </p>
      <div class="taskmgr-list" data-role="list"></div>
    `;
    const list = content.querySelector('[data-role="list"]');
    if (!processes.length) {
      list.innerHTML = '<p style="color:var(--text-dim);font-size:13px">Nenhum outro aplicativo aberto.</p>';
      return;
    }
    processes.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'taskmgr-row';
      row.innerHTML = `
        <span class="taskmgr-icon">${p.icon}</span>
        <span class="taskmgr-info">
          <span class="taskmgr-title"></span>
          <span class="taskmgr-sub">${p.minimized ? 'Minimizado' : 'Em execução'} · aberto há ${formatUptime(Date.now() - p.openedAt)}</span>
        </span>
        <button class="btn" style="background:#e81123" data-id="${p.id}">Encerrar tarefa</button>
      `;
      // Via textContent: p.title pode conter um nome de arquivo/pasta
      // escolhido pelo usuário.
      row.querySelector('.taskmgr-title').textContent = p.title;
      row.querySelector('button').addEventListener('click', () => {
        windows.closeWindow(p.id);
        ctx.notify?.({ appId: 'taskmanager', icon: '📊', title: 'Tarefa encerrada', body: `"${p.title}" foi fechado pelo Gerenciador de Tarefas.` });
      });
      list.appendChild(row);
    });
  }

  function renderPerformance() {
    const memory = getMemory();
    content.innerHTML = `
      <p style="font-size:13px;color:var(--text-dim)">
        ${memory != null
          ? 'Uso de memória do JavaScript deste app ao longo do tempo (dado real do navegador).'
          : 'Este navegador não expõe a API de memória (performance.memory) — disponível principalmente em Chrome/Edge.'}
      </p>
      <canvas data-role="chart" width="400" height="180" style="width:100%;height:180px;margin-top:12px"></canvas>
      <p class="taskmgr-current" data-role="current"></p>
    `;
    drawChart();
  }

  function drawChart() {
    const canvas = content.querySelector('[data-role="chart"]');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    if (!memorySamples.length) return;
    const max = Math.max(...memorySamples, 1);
    ctx2d.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#0067c0';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    memorySamples.forEach((v, i) => {
      const x = (i / Math.max(memorySamples.length - 1, 1)) * w;
      const y = h - (v / max) * h * 0.9 - 4;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();
    const current = content.querySelector('[data-role="current"]');
    if (current && memorySamples.length) {
      current.textContent = `Atual: ${formatMB(memorySamples[memorySamples.length - 1])}`;
    }
  }

  const renderers = { processes: renderProcesses, performance: renderPerformance };
  let activeTab = 'processes';
  root.querySelectorAll('.clockapp-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.clockapp-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderers[activeTab]();
    });
  });

  timers.push(setInterval(() => {
    const mem = getMemory();
    if (mem != null) {
      memorySamples.push(mem);
      if (memorySamples.length > 60) memorySamples.shift();
    }
    if (activeTab === 'processes') renderProcesses();
    else drawChart();
  }, 1000));

  unsubscribe = windows.onWindowsChange(() => {
    // Adiado para o próximo tick: focar esta própria janela (ao clicar em
    // qualquer botão aqui dentro) também dispara este evento — se
    // renderizássemos de forma síncrona, o botão clicado seria destruído
    // antes do seu próprio evento de clique terminar de disparar.
    if (activeTab === 'processes') setTimeout(() => renderProcesses(), 0);
  });

  renderProcesses();
  return win;
}
