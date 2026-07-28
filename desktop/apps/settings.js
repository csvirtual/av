// Configurações: Sistema, Personalização, Hora e idioma, Acessibilidade,
// Contas, Privacidade e Sobre — cada tela é funcional e persiste no
// IndexedDB deste navegador. Não há telas de Bluetooth/Rede/Jogos/
// Atualizações: como o app roda inteiramente no navegador, sem acesso a
// hardware real, essas categorias seriam apenas decorativas — preferimos
// não incluir telas que não fazem nada de verdade.
function escapeAttr(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarPreviewHTML(name, avatarDataUrl) {
  if (avatarDataUrl) return `<img class="avatar-img" src="${avatarDataUrl}" alt="">`;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar-initial">${initial}</div>`;
}

const WALLPAPERS = [
  { id: 'win11-blue', value: 'linear-gradient(135deg, #0f3057 0%, #1a5088 45%, #2c7fb8 100%)' },
  { id: 'sunset', value: 'linear-gradient(135deg, #ff8a65 0%, #ff5e62 50%, #8e2de2 100%)' },
  { id: 'forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { id: 'midnight', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { id: 'graphite', value: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
];

const ACCENT_COLORS = ['#0067c0', '#744da9', '#107c10', '#ca5010', '#c42b1c', '#e3008c', '#008272'];

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function openSettings(ctx, { tab = 'personalization' } = {}) {
  const { windows, getTheme, setTheme, getWallpaper, setWallpaper, changePassword } = ctx;

  const root = document.createElement('div');
  root.className = 'settings';
  root.innerHTML = `
    <div class="settings-nav">
      <button data-tab="system">🖥️ Sistema</button>
      <button data-tab="personalization" class="active">🎨 Personalização</button>
      <button data-tab="time">🕒 Hora e idioma</button>
      <button data-tab="accessibility">♿ Acessibilidade</button>
      <button data-tab="account">👤 Contas</button>
      <button data-tab="privacy">🔒 Privacidade</button>
      <button data-tab="about">ℹ️ Sobre</button>
    </div>
    <div class="settings-content" data-role="content"></div>
  `;

  const win = windows.createWindow({
    appId: 'settings',
    title: 'Configurações',
    icon: '⚙️',
    width: 680,
    height: 480,
    content: root,
  });

  const content = root.querySelector('[data-role="content"]');

  // ---------------- Sistema ----------------
  async function renderSystem() {
    const notificationsEnabled = await ctx.kv.get('settings.notificationsEnabled', true);
    const estimate = (await navigator.storage?.estimate?.()) || null;
    content.innerHTML = `
      <h2>Notificações</h2>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-role="notifications-toggle" ${notificationsEnabled ? 'checked' : ''}>
        Permitir sons e avisos deste aplicativo
      </label>

      <h2 style="margin-top:24px">Bateria</h2>
      <p data-role="battery-info" style="font-size:13px;color:var(--text-dim)">Verificando…</p>

      <h2 style="margin-top:24px">Armazenamento</h2>
      <p style="font-size:13px;color:var(--text-dim)">
        ${estimate ? `${formatBytes(estimate.usage)} usados de ${formatBytes(estimate.quota)} disponíveis neste navegador` : 'Não foi possível estimar o uso de armazenamento neste navegador.'}
      </p>
      ${estimate ? `<div style="background:var(--hover);border-radius:var(--radius-pill);height:8px;width:280px;overflow:hidden;margin:8px 0 16px">
        <div style="background:var(--accent-2);height:100%;width:${Math.min(100, (estimate.usage / Math.max(estimate.quota, 1)) * 100)}%"></div>
      </div>` : ''}
      <button class="btn" data-action="clear-cache" style="background:var(--hover);color:var(--text)">Limpar cache do app</button>
      <p class="settings-msg" data-role="cache-msg"></p>
    `;

    content.querySelector('[data-role="notifications-toggle"]').addEventListener('change', async (e) => {
      await ctx.kv.set('settings.notificationsEnabled', e.target.checked);
    });

    if (navigator.getBattery) {
      navigator.getBattery().then((battery) => {
        const el = content.querySelector('[data-role="battery-info"]');
        if (!el) return;
        const update = () => {
          el.textContent = `${Math.round(battery.level * 100)}%${battery.charging ? ' — carregando' : ''}`;
        };
        update();
        battery.addEventListener('levelchange', update);
        battery.addEventListener('chargingchange', update);
      });
    } else {
      const el = content.querySelector('[data-role="battery-info"]');
      if (el) el.textContent = 'Não disponível neste navegador/dispositivo.';
    }

    content.querySelector('[data-action="clear-cache"]').addEventListener('click', async () => {
      const msg = content.querySelector('[data-role="cache-msg"]');
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      msg.textContent = 'Cache limpo. Os seus arquivos e configurações não foram afetados.';
      msg.className = 'settings-msg ok';
    });
  }

  // ---------------- Personalização ----------------
  async function renderPersonalization() {
    const currentWallpaper = await getWallpaper();
    const currentTheme = await getTheme();
    const currentAccent = await ctx.getAccentColor();
    const currentScale = await ctx.getScale();
    const currentOrientation = await ctx.getOrientation();
    const autoArrange = await ctx.getAutoArrange();
    content.innerHTML = `
      <h2>Plano de fundo</h2>
      <div class="wallpaper-grid" data-role="wallpapers"></div>
      <label style="display:block;margin:10px 0;font-size:13px;color:var(--text-dim)">Ou envie uma imagem do seu computador:</label>
      <input type="file" accept="image/*" data-role="wallpaper-upload">

      <h2 style="margin-top:24px">Tema</h2>
      <div class="theme-toggle" data-role="theme-toggle">
        <button data-theme-choice="light">☀️ Claro</button>
        <button data-theme-choice="dark">🌙 Escuro</button>
      </div>

      <h2 style="margin-top:24px">Cor de destaque</h2>
      <div class="wallpaper-grid" data-role="accents"></div>

      <h2 style="margin-top:24px">Escala da interface</h2>
      <div class="theme-toggle" data-role="scale-toggle">
        <button data-scale="1">100%</button>
        <button data-scale="1.15">115%</button>
        <button data-scale="1.3">130%</button>
      </div>

      <h2 style="margin-top:24px">Orientação da tela</h2>
      <p style="font-size:12px;color:var(--text-dim);margin:-6px 0 8px">Ao instalar como aplicativo, a tela gira e trava no modo escolhido.</p>
      <div class="theme-toggle" data-role="orientation-toggle">
        <button data-orientation="landscape">🖥️ Paisagem</button>
        <button data-orientation="portrait">📱 Retrato</button>
        <button data-orientation="auto">🔄 Automática</button>
      </div>

      <h2 style="margin-top:24px">Ícones da área de trabalho</h2>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-role="auto-arrange-toggle" ${autoArrange ? 'checked' : ''}>
        Organizar ícones automaticamente
      </label>
    `;
    const grid = content.querySelector('[data-role="wallpapers"]');
    WALLPAPERS.forEach((wp) => {
      const el = document.createElement('div');
      el.className = 'wallpaper-swatch' + (currentWallpaper === wp.value ? ' active' : '');
      el.style.background = wp.value;
      el.addEventListener('click', async () => {
        await setWallpaper(wp.value);
        renderPersonalization();
      });
      grid.appendChild(el);
    });
    content.querySelector('[data-role="wallpaper-upload"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        await setWallpaper(reader.result);
        renderPersonalization();
      };
      reader.readAsDataURL(file);
    });
    content.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeChoice === currentTheme);
      btn.addEventListener('click', async () => {
        await setTheme(btn.dataset.themeChoice);
        renderPersonalization();
      });
    });

    const accentsGrid = content.querySelector('[data-role="accents"]');
    ACCENT_COLORS.forEach((color) => {
      const el = document.createElement('div');
      el.className = 'accent-swatch' + (currentAccent === color ? ' active' : '');
      el.style.background = color;
      el.addEventListener('click', async () => {
        await ctx.setAccentColor(color);
        renderPersonalization();
      });
      accentsGrid.appendChild(el);
    });

    content.querySelectorAll('[data-scale]').forEach((btn) => {
      btn.classList.toggle('active', parseFloat(btn.dataset.scale) === currentScale);
      btn.addEventListener('click', async () => {
        await ctx.setScale(parseFloat(btn.dataset.scale));
        renderPersonalization();
      });
    });

    content.querySelectorAll('[data-orientation]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.orientation === currentOrientation);
      btn.addEventListener('click', async () => {
        await ctx.setOrientation(btn.dataset.orientation);
        renderPersonalization();
      });
    });

    content.querySelector('[data-role="auto-arrange-toggle"]').addEventListener('change', async (e) => {
      await ctx.setAutoArrange(e.target.checked);
    });
  }

  // ---------------- Hora e idioma ----------------
  async function renderTime() {
    const currentFormat = ctx.getTimeFormat();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    content.innerHTML = `
      <h2>Fuso horário</h2>
      <p style="font-size:13px;color:var(--text-dim)">${timeZone} (detectado automaticamente pelo navegador)</p>

      <h2 style="margin-top:24px">Formato de hora</h2>
      <div class="theme-toggle" data-role="format-toggle">
        <button data-format="24h">24 horas</button>
        <button data-format="12h">12 horas (AM/PM)</button>
      </div>

      <h2 style="margin-top:24px">Idioma</h2>
      <p style="font-size:13px;color:var(--text-dim)">Português (Brasil) — único idioma disponível por enquanto.</p>
    `;
    content.querySelectorAll('[data-format]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.format === currentFormat);
      btn.addEventListener('click', async () => {
        await ctx.setTimeFormat(btn.dataset.format);
        renderTime();
      });
    });
  }

  // ---------------- Acessibilidade ----------------
  async function renderAccessibility() {
    const reduceMotion = await ctx.getReduceMotion();
    const theme = await getTheme();
    content.innerHTML = `
      <h2>Movimento</h2>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-role="motion-toggle" ${reduceMotion ? 'checked' : ''}>
        Reduzir animações
      </label>

      <h2 style="margin-top:24px">Contraste</h2>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-role="contrast-toggle" ${theme === 'contrast' ? 'checked' : ''}>
        Alto contraste
      </label>

      <h2 style="margin-top:24px">Navegação</h2>
      <p style="font-size:13px;color:var(--text-dim);max-width:400px;line-height:1.6">
        Todos os botões e campos deste aplicativo podem ser navegados com Tab
        e mostram um contorno de foco visível.
      </p>
    `;
    content.querySelector('[data-role="motion-toggle"]').addEventListener('change', async (e) => {
      await ctx.setReduceMotion(e.target.checked);
    });
    content.querySelector('[data-role="contrast-toggle"]').addEventListener('change', async (e) => {
      if (e.target.checked) {
        await ctx.kv.set('settings.themeBeforeContrast', theme === 'contrast' ? 'light' : theme);
        await setTheme('contrast');
      } else {
        const previous = await ctx.kv.get('settings.themeBeforeContrast', 'light');
        await setTheme(previous);
      }
    });
  }

  // ---------------- Contas ----------------
  async function renderAccount() {
    const name = await ctx.kv.get('user.name', 'Usuário');
    const avatar = await ctx.getAvatar();
    const email = await ctx.kv.get('auth.email', '');
    content.innerHTML = `
      <h2>Conta</h2>
      <div class="settings-avatar-lg" data-role="avatar-preview">${avatarPreviewHTML(name, avatar)}</div>
      <p style="font-size:13px;color:var(--text-dim)">Usuário: <strong>${name}</strong></p>
      <input type="file" accept="image/*" data-role="avatar-upload" class="hidden">
      <div style="display:flex;gap:8px;margin:10px 0 4px">
        <button class="btn" data-action="change-photo">Alterar foto</button>
        <button class="btn" style="background:var(--hover);color:var(--text)" data-action="use-initial">Usar inicial</button>
      </div>
      <h2 style="margin-top:20px">E-mail de recuperação</h2>
      <p style="font-size:13px;color:var(--text-dim);max-width:380px;line-height:1.5">
        Usado só para redefinir sua senha localmente neste navegador, caso você a esqueça —
        não enviamos nenhum e-mail de verdade, é apenas uma confirmação local.
      </p>
      <input type="email" placeholder="seu@email.com" data-role="recovery-email" value="${escapeAttr(email)}">
      <button class="btn" data-action="save-email">Salvar e-mail</button>
      <p class="settings-msg" data-role="email-msg"></p>
      <h2 style="margin-top:20px">Alterar senha</h2>
      <input type="password" placeholder="Senha atual" data-role="old-pass">
      <input type="password" placeholder="Nova senha" data-role="new-pass">
      <input type="password" placeholder="Confirmar nova senha" data-role="new-pass2">
      <button class="btn" data-action="change-pass">Alterar senha</button>
      <p class="settings-msg" data-role="pass-msg"></p>
    `;
    content.querySelector('[data-action="save-email"]').addEventListener('click', async () => {
      const value = content.querySelector('[data-role="recovery-email"]').value.trim();
      const msg = content.querySelector('[data-role="email-msg"]');
      await ctx.kv.set('auth.email', value);
      msg.textContent = value ? 'E-mail de recuperação salvo.' : 'E-mail de recuperação removido.';
      msg.className = 'settings-msg ok';
    });
    content.querySelector('[data-action="change-pass"]').addEventListener('click', async () => {
      const oldPass = content.querySelector('[data-role="old-pass"]').value;
      const newPass = content.querySelector('[data-role="new-pass"]').value;
      const newPass2 = content.querySelector('[data-role="new-pass2"]').value;
      const msg = content.querySelector('[data-role="pass-msg"]');
      if (newPass.length < 4) {
        msg.textContent = 'A nova senha deve ter ao menos 4 caracteres.';
        msg.className = 'settings-msg err';
        return;
      }
      if (newPass !== newPass2) {
        msg.textContent = 'As senhas não coincidem.';
        msg.className = 'settings-msg err';
        return;
      }
      const ok = await changePassword(oldPass, newPass);
      if (ok) {
        msg.textContent = 'Senha alterada com sucesso.';
        msg.className = 'settings-msg ok';
        content.querySelector('[data-role="old-pass"]').value = '';
        content.querySelector('[data-role="new-pass"]').value = '';
        content.querySelector('[data-role="new-pass2"]').value = '';
      } else {
        msg.textContent = 'Senha atual incorreta.';
        msg.className = 'settings-msg err';
      }
    });

    const preview = content.querySelector('[data-role="avatar-preview"]');
    const uploadInput = content.querySelector('[data-role="avatar-upload"]');
    content.querySelector('[data-action="change-photo"]').addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        await ctx.setAvatar(reader.result);
        preview.innerHTML = avatarPreviewHTML(name, reader.result);
      };
      reader.readAsDataURL(file);
    });
    content.querySelector('[data-action="use-initial"]').addEventListener('click', async () => {
      await ctx.setAvatar(null);
      preview.innerHTML = avatarPreviewHTML(name, null);
    });
  }

  // ---------------- Privacidade ----------------
  function renderPrivacy() {
    content.innerHTML = `
      <h2>Seus dados</h2>
      <p style="font-size:13px;color:var(--text-dim);max-width:440px;line-height:1.6">
        Este aplicativo roda inteiramente no seu navegador. Arquivos, senha,
        papel de parede e todas as outras configurações ficam salvos só neste
        dispositivo (IndexedDB) — nada é enviado a um servidor.
      </p>
      <h2 style="margin-top:24px">Apagar dados</h2>
      <p style="font-size:13px;color:var(--text-dim);max-width:440px">
        Isso apaga permanentemente todos os seus arquivos, senha e preferências
        deste aplicativo neste navegador. Não pode ser desfeito.
      </p>
      <button class="btn" data-action="wipe" style="background:#e81123;margin-top:8px">Apagar todos os dados deste aplicativo</button>
    `;
    content.querySelector('[data-action="wipe"]').addEventListener('click', async () => {
      if (!confirm('Tem certeza? Todos os seus arquivos, senha e configurações deste aplicativo serão apagados permanentemente.')) return;
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      indexedDB.deleteDatabase('win11-web-os');
      location.reload();
    });
  }

  // ---------------- Sobre ----------------
  function renderAbout() {
    content.innerHTML = `
      <h2>Sobre este sistema</h2>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6;max-width:400px">
        Interface inspirada no Windows 11, executada inteiramente no seu navegador.
        Todos os arquivos e configurações são salvos localmente (IndexedDB) neste
        dispositivo/navegador — nada é enviado a um servidor.
      </p>

      <h2 style="margin-top:24px">Desenvolvedor</h2>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6;max-width:400px">
        Criado por <strong>Samuel Dos Santos Teixeira</strong> como um projeto pessoal para
        estudar e demonstrar, na prática, como recriar a experiência de um sistema
        operacional moderno inteiramente com tecnologias web — HTML, CSS e JavaScript,
        sem frameworks pesados — com foco em arquitetura, desempenho e fidelidade visual
        ao Windows 11.
      </p>
    `;
  }

  const renderers = {
    system: renderSystem,
    personalization: renderPersonalization,
    time: renderTime,
    accessibility: renderAccessibility,
    account: renderAccount,
    privacy: renderPrivacy,
    about: renderAbout,
  };

  root.querySelectorAll('.settings-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.settings-nav button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderers[btn.dataset.tab]();
    });
  });

  root.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  root.querySelectorAll('.settings-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  (renderers[tab] || renderPersonalization)();

  return win;
}
