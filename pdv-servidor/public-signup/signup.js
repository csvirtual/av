// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// vanilla JS puro, sem build nenhum — mesmo estilo de public-admin/admin.js.
(function () {
  const form = document.getElementById('signup-form');
  const successCard = document.getElementById('success-card');
  const successLink = document.getElementById('success-link');
  const slugInput = document.getElementById('slug');
  const slugDomainEl = document.getElementById('slug-domain');
  const slugFeedback = document.getElementById('slug-feedback');
  const errorEl = document.getElementById('signup-error');
  const toastRoot = document.getElementById('toast-root');
  const submitBtn = form.querySelector('button[type="submit"]');

  const baseHost = window.location.host; // ex: "pdv-csvirtual.com.br" (ou "pdv-csvirtual.com.br:3131" em teste local)
  slugDomainEl.textContent = `.${baseHost}`;

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast error';
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // Só deixa digitar o formato que um slug pode ter — mesma validação de
  // scripts/createTenant.js#validateSlug, aplicada cedo (antes até de
  // consultar o servidor) pra feedback instantâneo.
  slugInput.addEventListener('input', () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });

  let checkTimer = null;
  slugInput.addEventListener('input', () => {
    clearTimeout(checkTimer);
    const slug = slugInput.value.trim();
    if (!slug) { slugFeedback.textContent = ''; slugFeedback.className = 'feedback'; return; }
    slugFeedback.textContent = 'Verificando...';
    slugFeedback.className = 'feedback';
    checkTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signup/check-slug/${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (data.available) {
          slugFeedback.textContent = `Disponível: ${slug}.${baseHost}`;
          slugFeedback.className = 'feedback ok';
        } else {
          slugFeedback.textContent = data.reason || 'Este endereço não está disponível.';
          slugFeedback.className = 'feedback bad';
        }
      } catch {
        slugFeedback.textContent = '';
        slugFeedback.className = 'feedback';
      }
    }, 400);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    try {
      const body = {
        nomeFantasia: document.getElementById('nome-fantasia').value,
        razaoSocial: document.getElementById('razao-social').value,
        slug: slugInput.value.trim(),
      };
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);

      const url = `${window.location.protocol}//${data.slug}.${baseHost}`;
      successLink.href = url;
      successLink.textContent = url;
      form.hidden = true;
      successCard.hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      toast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
