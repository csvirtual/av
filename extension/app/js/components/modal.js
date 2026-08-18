// Modal genérico e diálogo de confirmação reutilizados pelas views (editar
// produto, cadastrar usuário, confirmar exclusão etc.).
export function openModal({ title, bodyHtml, onMount, onSubmit, onCancel, submitLabel = 'Salvar', cancelLabel = 'Cancelar', wide = false, singleButton = false }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <h2>${title}</h2>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        ${singleButton ? '' : `<button type="button" class="btn btn-secondary" data-action="cancel">${cancelLabel}</button>`}
        <button type="button" class="btn" data-action="submit">${submitLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modalEl = backdrop.querySelector('.modal');
  const close = () => backdrop.remove();
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

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="max-width:400px">
        <h2>${title}</h2>
        <p style="color:var(--text-muted);font-size:13.5px;line-height:1.5;">${message}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-action="ok">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false); });
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-action="ok"]').addEventListener('click', () => close(true));
  });
}
