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
  // Fecha por cancelamento (botão "Cancelar" ou clique fora do modal) —
  // diferente de close(), que também é chamado após um submit bem-sucedido.
  // Usado por quem precisa saber que o usuário desistiu (ex: uma Promise
  // que só resolve dentro de onSubmit, como o modal de aprovação de
  // desconto em views/sale.js).
  const cancel = () => { close(); if (onCancel) onCancel(); };

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) cancel();
  });
  backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', cancel);

  const submitBtn = backdrop.querySelector('[data-action="submit"]');
  submitBtn.addEventListener('click', async () => {
    if (onSubmit) {
      const shouldClose = await onSubmit(modalEl, close);
      if (shouldClose !== false) close();
    } else {
      close();
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
