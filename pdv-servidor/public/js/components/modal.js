// Modal genérico e diálogo de confirmação reutilizados pelas views (editar
// produto, cadastrar usuário, confirmar exclusão etc.).

// Modais abertos no momento (openModal ou confirmDialog) — cada entrada é
// a função que fecha aquele modal específico. Existe só pra permitir
// fechar tudo de uma vez ao trocar de rota (ver closeAllModals, chamado
// pelo roteador em app.js a cada navegação, inclusive via botão
// "Voltar"/"Avançar" do navegador). Sem isso, um modal aberto sobrevivia à
// troca de rota — ele é anexado direto no <body>, fora do container que o
// roteador limpa — e ficava flutuando por cima da tela nova, com o
// formulário e os botões ainda "vivos", ainda referenciando dados de uma
// tela que não existe mais (achado de auditoria, reproduzido com o botão
// "Voltar" do navegador enquanto um modal estava aberto).
const openModals = new Set();

export function closeAllModals() {
  // Cópia porque cada função, ao rodar, se remove do Set original — mexer
  // no Set original durante o for...of pularia entradas.
  for (const forceClose of [...openModals]) forceClose();
}

export function openModal({ title, bodyHtml, onMount, onSubmit, onCancel, submitLabel = 'Salvar', cancelLabel = 'Cancelar', wide = false, singleButton = false, centerTitle = false, centerActions = false }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <h2${centerTitle ? ' style="text-align:center;"' : ''}>${title}</h2>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions"${centerActions ? ' style="justify-content:center;"' : ''}>
        ${singleButton ? '' : `<button type="button" class="btn btn-secondary" data-action="cancel">${cancelLabel}</button>`}
        <button type="button" class="btn" data-action="submit">${submitLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modalEl = backdrop.querySelector('.modal');
  const close = () => {
    backdrop.remove();
    openModals.delete(forceClose);
    document.removeEventListener('keydown', onKeydown);
  };
  // `submitting` é a defesa contra clique duplo/rápido no botão de
  // confirmar — achado de auditoria: como onSubmit é assíncrono (quase
  // sempre grava algo no IndexedDB), sem essa trava um segundo clique
  // antes do primeiro terminar disparava onSubmit() duas vezes em
  // paralelo — as duas liam o mesmo estado "antes" de gravar, então a
  // segunda podia apagar o efeito da primeira (last-write-wins) ou,
  // pior, as duas serem aceitas e o dado ser gravado em dobro (ex:
  // pagamento de fiado registrado duas vezes, estorno duplicado). Esse
  // é o ÚNICO ponto de entrada de todo submit de modal do sistema, então
  // a correção aqui vale pra every modal — não precisa repetir em cada
  // tela que usa openModal.
  let submitting = false;

  // Fecha por cancelamento (botão "Cancelar" ou clique fora do modal) —
  // diferente de close(), que também é chamado após um submit bem-sucedido.
  // Usado por quem precisa saber que o usuário desistiu (ex: uma Promise
  // que só resolve dentro de onSubmit, como o modal de aprovação de
  // desconto em views/sale.js). Ignorado enquanto um submit está em
  // andamento — cancelar no meio de uma gravação em curso deixaria o
  // onSubmit terminando "no escuro", sem modal pra mostrar erro nenhum.
  const cancel = () => {
    if (submitting) return;
    close();
    if (onCancel) onCancel();
  };

  // Esc fecha igual clique fora do modal (mesma função `cancel`, respeita a
  // trava de `submitting`). Em document, não no modal — o foco pode estar
  // em qualquer campo do formulário quando a tecla é apertada.
  const onKeydown = (e) => {
    if (e.key === 'Escape') cancel();
  };
  document.addEventListener('keydown', onKeydown);

  // Usado só por closeAllModals (troca de rota). Sempre tira o modal da
  // tela, mesmo em cima de um submit em andamento — não faria sentido
  // deixar um modal de uma tela que não existe mais flutuando por cima da
  // nova. Só chama onCancel se não houver submit em andamento: se houver,
  // o próprio onSubmit ainda vai terminar em segundo plano (a gravação já
  // foi disparada, não tem como nem por que interrompê-la) e vai chamar
  // close() sozinho depois — chamar onCancel aqui também resolveria uma
  // eventual Promise embrulhada (ver views/sale.js) como "cancelado" bem
  // na hora que a operação está sendo confirmada, o que seria errado.
  const forceClose = () => {
    const wasSubmitting = submitting;
    close();
    if (!wasSubmitting && onCancel) onCancel();
  };
  openModals.add(forceClose);

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) cancel();
  });
  const cancelBtn = backdrop.querySelector('[data-action="cancel"]');
  cancelBtn?.addEventListener('click', cancel);

  const submitBtn = backdrop.querySelector('[data-action="submit"]');
  submitBtn.addEventListener('click', async () => {
    if (submitting) return;
    if (!onSubmit) { close(); return; }
    submitting = true;
    submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      const shouldClose = await onSubmit(modalEl, close);
      if (shouldClose !== false) close();
    } finally {
      // Se o modal já foi fechado (submit bem-sucedido), isso mexe num nó
      // desanexado do DOM — inofensivo. Se ficou aberto (validação
      // falhou), reabilita pro usuário corrigir e tentar de novo.
      submitting = false;
      submitBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });

  if (onMount) onMount(modalEl, close);
  return { close, modalEl };
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="max-width:400px">
        <h2>${title}</h2>
        <div class="modal-body"><p style="color:var(--text-muted);font-size:13.5px;line-height:1.5;">${message}</p></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">${cancelLabel}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-action="ok">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = (result) => {
      backdrop.remove();
      openModals.delete(forceClose);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    // Ao trocar de rota, uma confirmação pendente vira "não confirmado"
    // (false) — a mesma resposta que um clique fora do modal já dava. Nunca
    // deixa a Promise pendurada pra sempre esperando um clique que não vai
    // mais acontecer.
    const forceClose = () => close(false);
    openModals.add(forceClose);
    const onKeydown = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKeydown);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false); });
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-action="ok"]').addEventListener('click', () => close(true));
  });
}
