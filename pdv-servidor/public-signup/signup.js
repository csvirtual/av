// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// vanilla JS puro, sem build nenhum — mesmo estilo de public-admin/admin.js.
(function () {
  // Botão discreto de claro/escuro — mesma chave de localStorage do resto
  // do PDV (public/js/theme.js), só que sozinho aqui em vez de um mecanismo
  // de 3 opções (claro/escuro/automático) como em personalizacao.js: essa
  // tela não tem uma seção de configurações pra abrigar isso, só o ícone.
  const THEME_KEY = 'theme.preference';
  const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="currentColor"/></svg>';
  const themeToggle = document.getElementById('theme-toggle');
  function currentTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function renderThemeToggle() {
    themeToggle.innerHTML = currentTheme() === 'dark' ? SUN : MOON;
  }
  themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    renderThemeToggle();
  });
  renderThemeToggle();

  const form = document.getElementById('signup-form');
  const successCard = document.getElementById('success-card');
  const successLink = document.getElementById('success-link');
  const slugInput = document.getElementById('slug');
  const slugDomainEl = document.getElementById('slug-domain');
  const slugFeedback = document.getElementById('slug-feedback');
  const errorEl = document.getElementById('signup-error');
  const toastRoot = document.getElementById('toast-root');
  const submitBtn = form.querySelector('button[type="submit"]');
  const turnstileWidget = document.getElementById('turnstile-widget');

  const baseHost = window.location.host; // ex: "pdv-csvirtual.com.br" (ou "pdv-csvirtual.com.br:3131" em teste local)
  slugDomainEl.textContent = `.${baseHost}`;

  // Achado do usuário: CAPTCHA (Cloudflare Turnstile) na confirmação do
  // cadastro, contra ataque de robô — ver routes/signup.js pro raciocínio
  // completo. A chave de site é pública (o próprio widget a expõe no
  // HTML de qualquer página que o usa), mas só sabemos se está
  // configurada perguntando ao servidor — sem chave nenhuma, o widget
  // simplesmente não aparece (turnstile-widget continua vazio) e o
  // cadastro segue sem CAPTCHA, exatamente como sempre foi até a loja
  // decidir ligar a proteção.
  let turnstileWidgetId = null;
  (async () => {
    try {
      const res = await fetch('/api/signup/config');
      const { turnstileSiteKey } = await res.json();
      if (!turnstileSiteKey) return;
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        turnstileWidgetId = window.turnstile.render(turnstileWidget, { sitekey: turnstileSiteKey });
      };
      document.head.appendChild(script);
    } catch {
      // Sem CAPTCHA nenhum se a checagem falhar (ex: offline) — o
      // cadastro em si segue tentando normalmente, o servidor reconfere
      // a exigência de qualquer jeito quando a chave está configurada.
    }
  })();

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast error';
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 7000);
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
          slugFeedback.textContent = 'Endereço disponível';
          slugFeedback.className = 'feedback ok';
        } else {
          // Achado do usuário: a razão completa (mesma frase que já
          // aparece de novo embaixo do botão se a pessoa tentar enviar
          // mesmo assim) ficava repetida na tela — aqui, enquanto ainda
          // está digitando, só o rótulo curto; o motivo detalhado (já
          // em uso, formato inválido, etc.) só precisa aparecer uma vez.
          slugFeedback.textContent = 'Endereço indisponível';
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
        turnstileToken: turnstileWidgetId != null ? window.turnstile.getResponse(turnstileWidgetId) : undefined,
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
      // Achado do usuário: um token do Turnstile só serve pra UMA
      // tentativa (usada ou não) — sem resetar aqui, uma segunda tentativa
      // depois de um erro (nome inválido, endereço já em uso etc.) mandava
      // o MESMO token de novo, que a Cloudflare já rejeita como
      // reaproveitado, obrigando a recarregar a página inteira só pra
      // tentar de novo.
      if (turnstileWidgetId != null) window.turnstile.reset(turnstileWidgetId);
    }
  });
})();
