// Configurações: personalização (papel de parede, tema) e conta (trocar senha).
const WALLPAPERS = [
  { id: 'win11-blue', value: 'linear-gradient(135deg, #0f3057 0%, #1a5088 45%, #2c7fb8 100%)' },
  { id: 'sunset', value: 'linear-gradient(135deg, #ff8a65 0%, #ff5e62 50%, #8e2de2 100%)' },
  { id: 'forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { id: 'midnight', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { id: 'graphite', value: 'linear-gradient(135deg, #232526 0%, #414345 100%)' },
];

export function openSettings(ctx, { tab = 'personalization' } = {}) {
  const { windows, getTheme, setTheme, getWallpaper, setWallpaper, changePassword } = ctx;

  const root = document.createElement('div');
  root.className = 'settings';
  root.innerHTML = `
    <div class="settings-nav">
      <button data-tab="personalization" class="active">🎨 Personalização</button>
      <button data-tab="account">👤 Conta</button>
      <button data-tab="about">ℹ️ Sobre</button>
    </div>
    <div class="settings-content" data-role="content"></div>
  `;

  const win = windows.createWindow({
    appId: 'settings',
    title: 'Configurações',
    icon: '⚙️',
    width: 620,
    height: 440,
    content: root,
  });

  const content = root.querySelector('[data-role="content"]');

  async function renderPersonalization() {
    const currentWallpaper = await getWallpaper();
    const currentTheme = await getTheme();
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
  }

  async function renderAccount() {
    const name = await ctx.kv.get('user.name', 'Usuário');
    content.innerHTML = `
      <h2>Conta</h2>
      <p style="font-size:13px;color:var(--text-dim)">Usuário: <strong>${name}</strong></p>
      <h2 style="margin-top:20px">Alterar senha</h2>
      <input type="password" placeholder="Senha atual" data-role="old-pass">
      <input type="password" placeholder="Nova senha" data-role="new-pass">
      <input type="password" placeholder="Confirmar nova senha" data-role="new-pass2">
      <button class="btn" data-action="change-pass">Alterar senha</button>
      <p class="settings-msg" data-role="pass-msg"></p>
    `;
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
  }

  function renderAbout() {
    content.innerHTML = `
      <h2>Sobre este sistema</h2>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6;max-width:400px">
        Interface inspirada no Windows 11, executada inteiramente no seu navegador.
        Todos os arquivos e configurações são salvos localmente (IndexedDB) neste
        dispositivo/navegador — nada é enviado a um servidor.
      </p>
    `;
  }

  const renderers = { personalization: renderPersonalization, account: renderAccount, about: renderAbout };

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
