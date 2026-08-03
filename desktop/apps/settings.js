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
  if (avatarDataUrl) return `<img class="avatar-img" src="${escapeAttr(avatarDataUrl)}" alt="">`;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="avatar-initial">${escapeAttr(initial)}</div>`;
}

export const WALLPAPERS = [
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

// Configurações é de instância única, igual ao app real do Windows: chamar
// openSettings() de novo enquanto já tem uma janela aberta (por exemplo, o
// menu Iniciar E a tela de segurança automática da 1ª instalação, quase ao
// mesmo tempo) só troca a aba dessa mesma janela e a traz pra frente — não
// abre uma segunda janela duplicada.
let activeSettingsInstance = null;

export function openSettings(ctx, { tab = 'personalization' } = {}) {
  const { windows, getTheme, setTheme, getWallpaper, setWallpaper, changePassword } = ctx;

  if (activeSettingsInstance && windows.listProcesses().some((p) => p.id === activeSettingsInstance.id)) {
    const proc = windows.listProcesses().find((p) => p.id === activeSettingsInstance.id);
    if (proc.minimized || !proc.focused) windows.toggleMinimize(proc.id);
    activeSettingsInstance.switchToTab(tab);
    return activeSettingsInstance.win;
  }

  const root = document.createElement('div');
  root.className = 'settings';
  root.innerHTML = `
    <div class="settings-nav">
      <button data-tab="system">🖥️ Sistema</button>
      <button data-tab="apps">📦 Aplicativos</button>
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

  // ---------------- Aplicativos (desativar/reativar) ----------------
  // "Desativar" nunca desinstala de verdade (não existe onde desinstalar
  // pra — são apps do próprio sistema) — só tira o app do Menu Iniciar, da
  // busca e do "Abrir com", e desafixa da barra de tarefas se estava lá.
  // Reativar traz de volta em todos esses lugares. Explorador e
  // Configurações não têm essa opção, do mesmo jeito que o Windows de
  // verdade não deixa desinstalar o próprio Explorador de Arquivos.
  const PROGRAM_PUBLISHER = 'Windows 11 Web Desktop';
  // Cada app do catálogo corresponde a um módulo .js irmão de settings.js
  // (mesma pasta apps/). O tamanho mostrado é o peso REAL desse arquivo,
  // medido com fetch() — nada de número inventado.
  const APP_SOURCE_FILE = {
    explorer: './apps/explorer.js',
    browser: './apps/browser.js',
    notepad: './apps/notepad.js',
    photos: './apps/photos.js',
    word: './apps/word.js',
    sheet: './apps/sheet.js',
    'video-player': './apps/video-player.js',
    'audio-player': './apps/audio-player.js',
    presentation: './apps/presentation.js',
    calculator: './apps/calculator.js',
    clock: './apps/clock.js',
    terminal: './apps/terminal.js',
    taskmanager: './apps/task-manager.js',
    settings: './apps/settings.js',
  };
  const appSizeCache = new Map();
  async function realSizeFor(appId) {
    if (appSizeCache.has(appId)) return appSizeCache.get(appId);
    const path = APP_SOURCE_FILE[appId];
    let label = 'Tamanho indisponível';
    if (path) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        const buf = await res.arrayBuffer();
        label = formatBytes(buf.byteLength);
      } catch {
        label = 'Tamanho indisponível';
      }
    }
    appSizeCache.set(appId, label);
    return label;
  }

  async function renderPrograms() {
    const apps = ctx.getAppCatalog()
      .filter((app) => !app.hideFromPrograms)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

    content.innerHTML = `
      <h2>Aplicativos instalados</h2>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">
        Desativar um aplicativo o remove do Menu Iniciar, da busca e do "Abrir com" — não apaga nada, e pode ser reativado a qualquer momento. O tamanho exibido é o peso real do arquivo do aplicativo.
      </p>
      <input type="text" data-role="program-search" placeholder="Pesquisar aplicativos" style="margin-bottom:12px">
      <div class="program-list" data-role="program-list"><p class="settings-msg" style="margin:0">Calculando tamanhos…</p></div>
    `;

    const listEl = content.querySelector('[data-role="program-list"]');
    const sizeLabels = {};
    await Promise.all(apps.map(async (app) => { sizeLabels[app.id] = await realSizeFor(app.id); }));

    function renderList(filterText) {
      const q = (filterText || '').trim().toLowerCase();
      const filtered = apps.filter((app) => app.label.toLowerCase().includes(q));
      listEl.innerHTML = filtered.length ? '' : '<p class="settings-msg" style="margin:0">Nenhum aplicativo encontrado.</p>';
      filtered.forEach((app) => {
        const enabled = !ctx.isAppDisabled(app.id);
        const row = document.createElement('div');
        row.className = 'program-row';
        row.innerHTML = `
          <span class="program-glyph">${app.glyph}</span>
          <div class="program-info">
            <div class="program-name">${escapeAttr(app.label)}</div>
            <div class="program-meta">${escapeAttr(PROGRAM_PUBLISHER)} • ${sizeLabels[app.id]}${app.core ? ' • Aplicativo do sistema' : ''}</div>
          </div>
          <label class="toggle-switch" title="${app.core ? 'Aplicativos do sistema não podem ser desativados' : (enabled ? 'Desativar' : 'Ativar')}">
            <input type="checkbox" ${enabled ? 'checked' : ''} ${app.core ? 'disabled' : ''}>
            <span class="toggle-switch-track"></span>
          </label>
        `;
        if (!app.core) {
          row.querySelector('input').addEventListener('change', async (e) => {
            await ctx.setAppDisabled(app.id, !e.target.checked);
          });
        }
        listEl.appendChild(row);
      });
    }
    renderList('');
    content.querySelector('[data-role="program-search"]').addEventListener('input', (e) => renderList(e.target.value));
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
  function roleLabelFor(account) {
    if (account.primary) return 'Administrador Geral';
    return account.role === 'admin' ? 'Administrador' : 'Usuário comum';
  }

  async function renderAccount() {
    const name = await ctx.kv.get('user.name', 'Usuário');
    const avatar = await ctx.getAvatar();
    const email = await ctx.kv.get('auth.email', '');
    const accounts = await ctx.listAccounts();
    const activeId = ctx.getActiveAccountId();
    const me = accounts.find((a) => a.id === activeId);
    const isAdmin = await ctx.getActiveAccountRole() === 'admin';
    content.innerHTML = `
      <h2>Conta</h2>
      <div class="settings-avatar-lg" data-role="avatar-preview">${avatarPreviewHTML(name, avatar)}</div>
      <p style="font-size:13px;color:var(--text-dim)">Usuário: <strong>${name}</strong></p>
      <p style="font-size:13px;color:var(--text-dim)">Tipo de conta: <span class="role-badge">${escapeAttr(me ? roleLabelFor(me) : 'Usuário comum')}</span></p>
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

      <h2 style="margin-top:20px">Outras contas neste dispositivo</h2>
      <p style="font-size:12px;color:var(--text-dim)">Este dispositivo permite no máximo ${ctx.maxAccounts} contas (${accounts.length}/${ctx.maxAccounts}).</p>
      <div data-role="other-accounts"></div>
      ${isAdmin
        ? (accounts.length < ctx.maxAccounts
          ? `<button class="btn" data-action="add-account" style="background:var(--hover);color:var(--text);margin-top:8px">+ Adicionar conta</button>`
          : `<p class="settings-msg" style="margin-top:8px">Limite de ${ctx.maxAccounts} contas atingido.</p>`)
        : `<p class="settings-msg" style="margin-top:8px">Apenas um administrador pode adicionar ou remover contas.</p>`}
    `;
    await renderOtherAccounts();
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

    async function renderOtherAccounts() {
      const holder = content.querySelector('[data-role="other-accounts"]');
      if (!holder) return;
      const accounts = await ctx.listAccounts();
      const activeId = ctx.getActiveAccountId();
      const others = accounts.filter((a) => a.id !== activeId);
      holder.innerHTML = '';
      if (!others.length) {
        const p = document.createElement('p');
        p.style.cssText = 'font-size:13px;color:var(--text-dim)';
        p.textContent = 'Nenhuma outra conta.';
        holder.appendChild(p);
        return;
      }
      const isAdminNow = await ctx.getActiveAccountRole() === 'admin';
      others.forEach((acc) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0';
        row.innerHTML = `
          <span class="avatar-sm">${avatarPreviewHTML(acc.name, acc.avatar)}</span>
          <span style="flex:1;font-size:13px">${escapeAttr(acc.name)}<br><span class="role-badge">${escapeAttr(roleLabelFor(acc))}</span></span>
        `;
        const switchBtn = document.createElement('button');
        switchBtn.className = 'btn';
        switchBtn.style.cssText = 'background:var(--hover);color:var(--text)';
        switchBtn.textContent = 'Trocar para';
        switchBtn.addEventListener('click', () => ctx.switchToAccount(acc.id));
        row.appendChild(switchBtn);
        // Só o Administrador Geral é permanente — as outras 2 contas podem
        // ser promovidas/rebaixadas por quem já for administrador.
        if (isAdminNow && !acc.primary) {
          const roleBtn = document.createElement('button');
          roleBtn.className = 'btn';
          roleBtn.style.cssText = 'background:var(--hover);color:var(--text)';
          const nextRole = acc.role === 'admin' ? 'standard' : 'admin';
          roleBtn.textContent = nextRole === 'admin' ? 'Tornar administrador' : 'Tornar usuário comum';
          roleBtn.addEventListener('click', async () => {
            const ok = await ctx.setAccountRole(acc.id, nextRole);
            if (ok) renderOtherAccounts();
          });
          row.appendChild(roleBtn);
        }
        if (isAdminNow && !acc.primary) {
          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn';
          removeBtn.style.cssText = 'background:#e81123';
          removeBtn.textContent = 'Remover';
          removeBtn.addEventListener('click', async () => {
            const removed = await ctx.removeAccount(acc.id);
            if (removed) renderOtherAccounts();
          });
          row.appendChild(removeBtn);
        }
        holder.appendChild(row);
      });
    }

    content.querySelector('[data-action="add-account"]')?.addEventListener('click', () => ctx.addAccount());
  }

  // ---------------- Privacidade ----------------
  function securityItem(icon, title, desc) {
    return `
      <div style="display:flex;gap:12px;align-items:flex-start;margin-top:14px;max-width:460px">
        <span style="font-size:20px;line-height:1.3">${icon}</span>
        <div>
          <p style="font-size:13px;font-weight:600;margin:0 0 2px">${title}</p>
          <p style="font-size:12px;color:var(--text-dim);line-height:1.5;margin:0">${desc}</p>
        </div>
      </div>
    `;
  }

  function renderPrivacy() {
    content.innerHTML = `
      <h2>Seus dados</h2>
      <p style="font-size:13px;color:var(--text-dim);max-width:440px;line-height:1.6">
        Este aplicativo roda inteiramente no seu navegador. Arquivos, senha,
        papel de parede e todas as outras configurações ficam salvos só neste
        dispositivo (IndexedDB) — nada é enviado a um servidor.
      </p>

      <h2 style="margin-top:24px">Segurança deste sistema</h2>
      <p style="font-size:12px;color:var(--text-dim);max-width:460px">Camadas de proteção que já estão ativas, sem precisar configurar nada:</p>
      ${securityItem('🔐', 'Criptografia dos arquivos', 'O conteúdo de cada arquivo é cifrado com AES-256-GCM antes de ser salvo. A chave de cada conta é derivada da sua senha (PBKDF2-SHA256, 150 mil repetições) — sem a senha certa, o conteúdo salvo não pode ser lido.')}
      ${securityItem('🔑', 'Senha nunca fica em texto puro', 'Sua senha nunca é gravada como digitada. Só é guardado um hash com sal (PBKDF2-SHA256) — nem examinando o armazenamento local dá pra recuperar a senha original.')}
      ${securityItem('⏱️', 'Bloqueio contra tentativas repetidas', 'Depois de algumas tentativas erradas seguidas na tela de bloqueio, o sistema passa a exigir uma espera cada vez maior antes da próxima tentativa, dificultando adivinhação por força bruta.')}
      ${securityItem('🪪', 'Chave de ativação protegida', 'O serial de ativação exigido na primeira instalação não existe em texto puro em nenhum lugar do código — só o resultado de um hash reforçado (PBKDF2, 1 milhão de repetições), tornando inviável descobrir a chave a partir dos arquivos do site.')}
      ${securityItem('🧱', 'Isolamento do Navegador', 'As páginas abertas no app Navegador rodam numa área isolada (sandbox) — sem acesso à área de trabalho, aos seus arquivos ou às outras janelas abertas.')}
      ${securityItem('🌐', 'Cabeçalhos de segurança', 'O site aplica Content-Security-Policy e outros cabeçalhos que bloqueiam scripts, estilos e conexões de origens não autorizadas.')}

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
    apps: renderPrograms,
    personalization: renderPersonalization,
    time: renderTime,
    accessibility: renderAccessibility,
    account: renderAccount,
    privacy: renderPrivacy,
    about: renderAbout,
  };

  function switchToTab(tabName) {
    root.querySelectorAll('.settings-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
    (renderers[tabName] || renderPersonalization)();
  }

  root.querySelectorAll('.settings-nav button').forEach((btn) => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });

  switchToTab(tab);
  activeSettingsInstance = { id: win.id, win, switchToTab };
  win.onClose(() => { activeSettingsInstance = null; });

  return win;
}
