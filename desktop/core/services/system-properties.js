// Modal de "Propriedades do Sistema" de Este Computador — igual à tela de
// Propriedades do Sistema do Windows real, mas só com dados que dá pra saber
// de verdade rodando num navegador. Campos que o Windows real mostra mas que
// não têm como ser reais aqui (modelo exato do processador, "Grupo de
// trabalho", tipo de sistema 32/64 bits) ficam de fora, em vez de inventados.
//
// Compartilhado entre o Explorador (botão direito na barra lateral) e o
// ícone "Este Computador" na área de trabalho — cada chamador informa em
// qual elemento o modal deve ser anexado (a janela do Explorador, ou o
// próprio body quando não há janela nenhuma aberta).
export async function showSystemProperties(ctx, container = document.body) {
  const overlay = document.createElement('div');
  overlay.className = 'explorer-modal-overlay';
  const box = document.createElement('div');
  box.className = 'explorer-modal';
  const title = document.createElement('h3');
  title.textContent = 'Propriedades do Sistema';
  box.appendChild(title);

  const accounts = await ctx.listAccounts();
  const primary = accounts.find((a) => a.primary);
  const installedAt = primary?.createdAt ? new Date(primary.createdAt).toLocaleString('pt-BR') : 'desconhecida';
  const cores = navigator.hardwareConcurrency;
  const ram = navigator.deviceMemory;
  const touchPoints = navigator.maxTouchPoints || 0;

  const rows = [
    ['Edição', 'Windows 11 Web Desktop'],
    ['Versão', '10.0.22631.4317'],
    ['Nome do dispositivo', 'WIN11-WEB'],
    ['Processador', cores ? `${cores} núcleos lógicos disponíveis` : 'Não disponível neste navegador'],
    ['Memória instalada (RAM)', ram ? `${ram} GB (aproximado)` : 'Não disponível neste navegador'],
    ['Entrada por caneta e toque', touchPoints > 0 ? `Suporte a toque com ${touchPoints} ${touchPoints === 1 ? 'ponto' : 'pontos'} de toque` : 'Nenhuma entrada de caneta ou toque disponível para esta tela'],
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'explorer-modal-row';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    box.appendChild(row);
  });

  const activationNote = document.createElement('p');
  activationNote.style.cssText = 'font-size:12px;color:#7ee787;margin:14px 0 0';
  activationNote.textContent = '✓ O Windows está ativado.';
  box.appendChild(activationNote);
  const installNote = document.createElement('p');
  installNote.style.cssText = 'font-size:12px;color:var(--text-dim);margin:4px 0 0';
  installNote.textContent = `Instalado em: ${installedAt}`;
  box.appendChild(installNote);

  const actions = document.createElement('div');
  actions.className = 'explorer-modal-actions';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = 'Fechar';
  closeBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(closeBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  function onEscape(e) {
    if (e.key === 'Escape') { overlay.remove(); window.removeEventListener('keydown', onEscape); }
  }
  window.addEventListener('keydown', onEscape);
  container.appendChild(overlay);
}
