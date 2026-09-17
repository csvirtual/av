// Personalização — hoje só a aparência (claro/escuro/automático), mas é o
// lugar certo pra qualquer preferência futura que seja "de quem usa o
// computador", não da loja (por isso fica liberado pra admin e vendedor,
// diferente de Dados da loja, que é config da empresa toda).
import { getThemePreference, setThemePreference } from '../theme.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icon.js';

const OPTIONS = [
  { value: 'system', icon: icon('desktop', { size: 30 }), label: 'Automático', desc: 'Segue o tema do sistema operacional' },
  { value: 'light', icon: icon('sun', { size: 30 }), label: 'Claro', desc: 'Sempre com fundo claro' },
  { value: 'dark', icon: icon('moon', { size: 30 }), label: 'Escuro', desc: 'Sempre com fundo escuro' },
];

export async function renderPersonalizacao(container) {
  let current = await getThemePreference();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Personalização</h1>
        <div class="desc">Preferências de exibição do sistema, salvas neste computador.</div>
      </div>
    </div>
    <div class="card" style="max-width:640px;">
      <p class="section-title mt-0">Aparência</p>
      <p class="text-muted" style="font-size:13px;margin-top:-8px;">Escolha como o sistema aparece pra você. A escolha vale pra este computador, mesmo depois de sair e entrar de novo.</p>
      <div class="theme-options" id="theme-options"></div>
    </div>
  `;

  const optionsBox = document.getElementById('theme-options');

  function renderOptions() {
    optionsBox.innerHTML = OPTIONS.map((opt) => `
      <div class="theme-option ${current === opt.value ? 'active' : ''}" data-theme-option="${opt.value}" role="button" tabindex="0">
        <span class="icon">${opt.icon}</span>
        <span class="label">${opt.label}</span>
        <span class="desc">${opt.desc}</span>
        <span class="check">${icon('check', { size: 13 })} Selecionado</span>
      </div>
    `).join('');

    optionsBox.querySelectorAll('[data-theme-option]').forEach((el) => {
      el.addEventListener('click', () => selectOption(el.dataset.themeOption));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(el.dataset.themeOption); }
      });
    });
  }

  async function selectOption(value) {
    if (value === current) return;
    current = value;
    await setThemePreference(value);
    renderOptions();
    const label = OPTIONS.find((o) => o.value === value)?.label || value;
    showToast(`Aparência alterada para "${label}".`, 'success');
  }

  renderOptions();
}
