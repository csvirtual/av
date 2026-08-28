// Property panel: auto-generated from each component's propSchema (spec §6
// "cada componente deve possuir propriedades... edição visual"). A generic
// panel driven by data instead of one hand-written form per component is
// what makes adding a 21st component free — no UI code to write for it.
import { getComponent } from '../components/registry.js';
import { escapeHtml, escapeAttr } from '../codegen/sanitize.js';

const STYLE_FIELDS = [
  ['padding', 'Espaçamento interno'], ['margin', 'Margem'], ['gap', 'Espaço entre itens'],
  ['width', 'Largura'], ['maxWidth', 'Largura máxima'], ['textAlign', 'Alinhamento de texto'],
  ['backgroundColor', 'Cor de fundo'], ['color', 'Cor do texto'],
];

function fieldInput(key, field, value) {
  const v = value ?? '';
  if (field.type === 'boolean') {
    return `<label class="av-prop-checkbox"><input type="checkbox" data-field="${key}" ${v ? 'checked' : ''}> ${escapeHtml(field.label)}</label>`;
  }
  if (field.type === 'select') {
    const opts = (field.options || []).map((o) => `<option value="${escapeAttr(o)}" ${o === v ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
    return `<label class="av-label">${escapeHtml(field.label)}</label><select class="av-select" data-field="${key}">${opts}</select>`;
  }
  if (field.type === 'textarea') {
    return `<label class="av-label">${escapeHtml(field.label)}</label><textarea class="av-textarea" data-field="${key}" rows="3">${escapeHtml(v)}</textarea>`;
  }
  if (field.type === 'number') {
    return `<label class="av-label">${escapeHtml(field.label)}</label><input class="av-input" type="number" data-field="${key}" value="${escapeAttr(v)}">`;
  }
  return `<label class="av-label">${escapeHtml(field.label)}</label><input class="av-input" type="text" data-field="${key}" value="${escapeAttr(v)}">`;
}

export function renderProperties(container, node, project) {
  if (!node) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  let def;
  try {
    def = getComponent(node.type);
  } catch {
    container.innerHTML = `<p class="av-prop-empty">Tipo de componente desconhecido: ${escapeHtml(node.type)}</p>`;
    return;
  }

  const propsHtml = def.propSchema
    .map((f) => `<div class="av-prop-field" data-scope="props">${fieldInput(f.key, f, node.props[f.key])}</div>`)
    .join('');

  const showBind = ['DataTable', 'Form', 'StatCard'].includes(node.type);
  const entityOptions = (project.entities || []).map((e) => `<option value="${escapeAttr(e.name)}" ${node.bind?.entity === e.name ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('');
  const bindHtml = showBind
    ? `<div class="av-prop-field" data-scope="bind"><label class="av-label">Entidade</label><select class="av-select" data-bind="entity"><option value="">— nenhuma —</option>${entityOptions}</select></div>`
    : '';

  const styleHtml = STYLE_FIELDS.map(([key, label]) => `<div class="av-prop-field" data-scope="style"><label class="av-label">${escapeHtml(label)}</label><input class="av-input" type="text" data-style="${key}" value="${escapeAttr(node.style?.[key] || '')}"></div>`).join('');

  container.innerHTML = `
    <h3 class="av-label">${escapeHtml(def.meta.label)}</h3>
    ${propsHtml || '<p class="av-hint">Este componente não tem propriedades editáveis.</p>'}
    ${bindHtml ? `<h3 class="av-label">Dados</h3>${bindHtml}` : ''}
    <details><summary class="av-label">Estilo</summary>${styleHtml}</details>
    <details><summary class="av-label">Avançado (JSON)</summary>
      <textarea class="av-textarea" data-role="json" rows="6">${escapeHtml(JSON.stringify(node.props, null, 2))}</textarea>
      <button class="av-btn av-btn--small av-mt-1" data-action="apply-json">Aplicar JSON</button>
    </details>
  `;
}

/** Wires delegated change/input events once; container is repainted by renderProperties(). */
export function initPropertiesPanel(container, handlers) {
  container.addEventListener('change', (e) => {
    const field = e.target.closest('[data-field]');
    const bind = e.target.closest('[data-bind]');
    const style = e.target.closest('[data-style]');
    if (field) {
      const key = field.dataset.field;
      const value = field.type === 'checkbox' ? field.checked : field.value;
      handlers.onChangeProps?.({ [key]: value });
    } else if (bind) {
      handlers.onChangeBind?.({ entity: bind.value || undefined });
    } else if (style) {
      handlers.onChangeStyle?.({ [style.dataset.style]: style.value });
    }
  });
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="apply-json"]')) {
      const textarea = container.querySelector('[data-role="json"]');
      try {
        const parsed = JSON.parse(textarea.value);
        handlers.onReplaceProps?.(parsed);
      } catch {
        handlers.onError?.('JSON inválido — nada foi aplicado.');
      }
    }
  });
}
