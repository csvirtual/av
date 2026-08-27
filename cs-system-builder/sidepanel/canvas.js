// Editor visual (arrastar-e-soltar). Renderiza a árvore do projeto como DOM
// real dentro do side panel — mas SEM nunca executar o JS gerado (onclick/
// onsubmit ficam só como atributos de dados aqui). Quem realmente roda o JS
// do sistema é o iframe sandboxed do preview (chat.js/app.js), nunca esta
// página da extensão. Isso mantém a edição segura mesmo que o código gerado
// pela IA (ou colado por alguém) seja malicioso.

const PALETTE = [
  { type: 'container', label: 'Bloco (linha/coluna)', icon: '▭' },
  { type: 'card', label: 'Cartão', icon: '▤' },
  { type: 'heading', label: 'Título', icon: 'H' },
  { type: 'text', label: 'Texto', icon: '¶' },
  { type: 'button', label: 'Botão', icon: '⏺' },
  { type: 'image', label: 'Imagem', icon: '🖼' },
  { type: 'link', label: 'Link', icon: '🔗' },
  { type: 'divider', label: 'Divisória', icon: '—' },
  { type: 'form', label: 'Formulário', icon: '📝' },
  { type: 'input', label: 'Campo de texto', icon: '⌨' },
  { type: 'textarea', label: 'Área de texto', icon: '▯' },
  { type: 'select', label: 'Seleção', icon: '▾' },
  { type: 'list', label: 'Lista', icon: '☰' },
  { type: 'table', label: 'Tabela', icon: '▦' },
];

const TYPE_LABEL = Object.fromEntries(PALETTE.map((p) => [p.type, p.label]));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

function renderPalette(container) {
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'panel-title', text: 'Componentes' }));
  const grid = el('div', { class: 'palette-grid' });
  for (const item of PALETTE) {
    const chip = el('div', { class: 'palette-item', draggable: 'true', title: `Arraste para o canvas: ${item.label}` }, [
      el('span', { class: 'palette-icon', text: item.icon }),
      el('span', { text: item.label }),
    ]);
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/csb-new-type', item.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    grid.appendChild(chip);
  }
  container.appendChild(grid);
}

// ---- Renderização da árvore como DOM real (modo de edição) ----

function buildEditableElement(node) {
  const p = node.props || {};
  let tag = 'div';
  let content = null;
  switch (node.type) {
    case 'heading': tag = `h${Math.min(6, Math.max(1, Number(p.level) || 2))}`; content = p.text; break;
    case 'text': tag = 'p'; content = p.text; break;
    case 'button': tag = 'button'; content = p.text; break;
    case 'image': tag = 'img'; break;
    case 'link': tag = 'a'; content = p.text; break;
    case 'input': tag = 'div'; break;
    case 'textarea': tag = 'div'; break;
    case 'select': tag = 'div'; break;
    case 'list': tag = p.ordered ? 'ol' : 'ul'; break;
    case 'table': tag = 'div'; break;
    case 'divider': tag = 'hr'; break;
    case 'form': tag = 'div'; break;
    case 'card': tag = 'div'; break;
    case 'container': default: tag = 'div'; break;
  }
  const domNode = document.createElement(tag);
  if (content !== null) domNode.textContent = content;
  if (node.type === 'image') {
    domNode.src = p.src || '';
    domNode.alt = p.alt || '';
  }
  if (node.type === 'link') domNode.href = '#';
  applyStyle(domNode, node);
  return domNode;
}

function applyStyle(domNode, node) {
  const style = node.style || {};
  const css = window.CSB_RENDER.styleToCssText(style);
  domNode.style.cssText = css;
  domNode.classList.add('csb-node', `csb-type-${node.type}`);
  domNode.dataset.nodeId = node.id;
}

function placeholderFor(node) {
  const p = node.props || {};
  switch (node.type) {
    case 'input': return `⌨ ${p.label || 'Campo'} — ${p.inputType || 'text'}`;
    case 'textarea': return `▯ ${p.label || 'Área de texto'}`;
    case 'select': return `▾ ${p.label || 'Seleção'} (${(p.options || []).join(', ')})`;
    case 'form': return null;
    case 'table': return `▦ Tabela: ${(p.columns || []).join(' | ')}`;
    default: return null;
  }
}

function renderNode(node, ctx) {
  const domNode = buildEditableElement(node);
  const placeholder = placeholderFor(node);
  if (placeholder) {
    domNode.classList.add('csb-placeholder-field');
    domNode.textContent = placeholder;
  }
  if (node.type === 'table') {
    const cols = (node.props.columns || []);
    const rows = (node.props.rows || []);
    const table = el('table', { class: 'csb-mini-table' });
    table.appendChild(el('tr', {}, cols.map((c) => el('th', { text: c }))));
    for (const r of rows) table.appendChild(el('tr', {}, r.map((c) => el('td', { text: c }))));
    domNode.textContent = '';
    domNode.appendChild(table);
  }
  if (node.type === 'list') {
    for (const item of node.props.items || []) domNode.appendChild(el('li', { text: item }));
  }

  const isRoot = node.id === ctx.rootId;
  domNode.classList.toggle('csb-selected', node.id === ctx.selectedId);
  if (!isRoot) domNode.draggable = true;

  domNode.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.onSelect(node.id);
  });

  if (!isRoot) {
    domNode.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/csb-move-id', node.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  }

  const canHaveChildren = window.CSB_SCHEMA.canHaveChildren(node.type);
  if (canHaveChildren) {
    domNode.classList.add('csb-dropzone');
    if (!(node.children && node.children.length)) {
      domNode.classList.add('csb-empty-dropzone');
      domNode.appendChild(el('div', { class: 'csb-empty-hint', text: 'Arraste componentes aqui' }));
    }
    for (const child of node.children || []) {
      domNode.appendChild(renderNode(child, ctx));
    }
    domNode.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      domNode.classList.add('csb-dropzone-active');
    });
    domNode.addEventListener('dragleave', () => domNode.classList.remove('csb-dropzone-active'));
    domNode.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      domNode.classList.remove('csb-dropzone-active');
      const index = computeDropIndex(domNode, e.clientY);
      const newType = e.dataTransfer.getData('text/csb-new-type');
      const moveId = e.dataTransfer.getData('text/csb-move-id');
      if (newType) ctx.onDropNew(node.id, index, newType);
      else if (moveId) ctx.onMoveExisting(moveId, node.id, index);
    });
  }

  return domNode;
}

function computeDropIndex(containerDom, clientY) {
  const children = Array.from(containerDom.children).filter((c) => c.classList?.contains('csb-node'));
  for (let i = 0; i < children.length; i++) {
    const rect = children[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return children.length;
}

function renderCanvas(rootContainer, tree, { selectedId, onSelect, onDropNew, onMoveExisting }) {
  rootContainer.innerHTML = '';
  const ctx = { rootId: tree.id, selectedId, onSelect, onDropNew, onMoveExisting };
  const domTree = renderNode(tree, ctx);
  domTree.classList.add('csb-canvas-root');
  rootContainer.appendChild(domTree);
  rootContainer.onclick = () => onSelect(null);
}

// ---- Painel de camadas (árvore em lista, útil pra navegar estruturas grandes) ----

function renderLayers(container, tree, selectedId, onSelect) {
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'panel-title', text: 'Camadas' }));
  const list = el('div', { class: 'layers-list' });
  const walk = (node, depth) => {
    const row = el('div', {
      class: `layer-row${node.id === selectedId ? ' active' : ''}`,
      style: `padding-left:${depth * 14 + 8}px`,
    }, [el('span', { text: `${TYPE_LABEL[node.type] || node.type}` })]);
    row.addEventListener('click', (e) => { e.stopPropagation(); onSelect(node.id); });
    list.appendChild(row);
    for (const child of node.children || []) walk(child, depth + 1);
  };
  walk(tree, 0);
  container.appendChild(list);
}

// ---- Inspetor de propriedades ----

const PROP_FIELDS = {
  heading: [
    { key: 'level', target: 'props', label: 'Nível', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
    { key: 'text', target: 'props', label: 'Texto', type: 'text' },
  ],
  text: [{ key: 'text', target: 'props', label: 'Texto', type: 'textarea' }],
  button: [
    { key: 'text', target: 'props', label: 'Texto do botão', type: 'text' },
    { key: 'variant', target: 'props', label: 'Estilo', type: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    { key: 'onClick', target: 'props', label: 'Código JS ao clicar (avançado)', type: 'code' },
  ],
  image: [
    { key: 'src', target: 'props', label: 'URL da imagem', type: 'text' },
    { key: 'alt', target: 'props', label: 'Texto alternativo', type: 'text' },
  ],
  link: [
    { key: 'text', target: 'props', label: 'Texto', type: 'text' },
    { key: 'href', target: 'props', label: 'Endereço (URL)', type: 'text' },
  ],
  input: [
    { key: 'label', target: 'props', label: 'Rótulo', type: 'text' },
    { key: 'placeholder', target: 'props', label: 'Texto de exemplo', type: 'text' },
    { key: 'inputType', target: 'props', label: 'Tipo', type: 'select', options: ['text', 'email', 'number', 'password', 'date'] },
    { key: 'name', target: 'props', label: 'Nome do campo', type: 'text' },
  ],
  textarea: [
    { key: 'label', target: 'props', label: 'Rótulo', type: 'text' },
    { key: 'placeholder', target: 'props', label: 'Texto de exemplo', type: 'text' },
    { key: 'name', target: 'props', label: 'Nome do campo', type: 'text' },
  ],
  select: [
    { key: 'label', target: 'props', label: 'Rótulo', type: 'text' },
    { key: 'name', target: 'props', label: 'Nome do campo', type: 'text' },
    { key: 'options', target: 'props', label: 'Opções (uma por linha)', type: 'list' },
  ],
  form: [{ key: 'onSubmit', target: 'props', label: 'Código JS ao enviar (avançado)', type: 'code' }],
  list: [
    { key: 'items', target: 'props', label: 'Itens (um por linha)', type: 'list' },
    { key: 'ordered', target: 'props', label: 'Numerada?', type: 'select', options: ['false', 'true'] },
  ],
  table: [
    { key: 'columns', target: 'props', label: 'Colunas (uma por linha)', type: 'list' },
    { key: 'rows', target: 'props', label: 'Linhas (célula1 | célula2 por linha)', type: 'rows' },
  ],
  card: [], divider: [], container: [],
};

const STYLE_FIELDS_COMMON = [
  { key: 'background', target: 'style', label: 'Cor de fundo', type: 'color' },
  { key: 'color', target: 'style', label: 'Cor do texto', type: 'color' },
  { key: 'padding', target: 'style', label: 'Espaçamento interno', type: 'text', placeholder: 'ex: 16px' },
  { key: 'margin', target: 'style', label: 'Margem', type: 'text', placeholder: 'ex: 0 0 16px 0' },
  { key: 'borderRadius', target: 'style', label: 'Cantos arredondados', type: 'text', placeholder: 'ex: 8px' },
  { key: 'fontSize', target: 'style', label: 'Tamanho da fonte', type: 'text', placeholder: 'ex: 16px' },
  { key: 'fontWeight', target: 'style', label: 'Peso da fonte', type: 'select', options: ['normal', '500', '600', '700'] },
  { key: 'textAlign', target: 'style', label: 'Alinhamento do texto', type: 'select', options: ['left', 'center', 'right'] },
  { key: 'width', target: 'style', label: 'Largura', type: 'text', placeholder: 'ex: 100%' },
];

const STYLE_FIELDS_LAYOUT = [
  { key: 'flexDirection', target: 'style', label: 'Direção', type: 'select', options: ['column', 'row'] },
  { key: 'gap', target: 'style', label: 'Espaço entre itens', type: 'text', placeholder: 'ex: 12px' },
  { key: 'justifyContent', target: 'style', label: 'Distribuir', type: 'select', options: ['flex-start', 'center', 'flex-end', 'space-between'] },
  { key: 'alignItems', target: 'style', label: 'Alinhar', type: 'select', options: ['stretch', 'flex-start', 'center', 'flex-end'] },
];

function getFieldsForNode(node) {
  const propFields = PROP_FIELDS[node.type] || [];
  const layout = window.CSB_SCHEMA.canHaveChildren(node.type) ? STYLE_FIELDS_LAYOUT : [];
  return { propFields, styleFields: [...layout, ...STYLE_FIELDS_COMMON] };
}

function fieldValue(node, field) {
  const bag = field.target === 'props' ? node.props : node.style;
  const v = bag ? bag[field.key] : undefined;
  if (field.type === 'list') return Array.isArray(v) ? v.join('\n') : '';
  if (field.type === 'rows') return Array.isArray(v) ? v.map((r) => r.join(' | ')).join('\n') : '';
  return v ?? '';
}

function renderInspector(container, node, isRoot, handlers) {
  container.innerHTML = '';
  if (!node) {
    container.appendChild(el('div', { class: 'panel-title', text: 'Propriedades' }));
    container.appendChild(el('div', { class: 'inspector-empty', text: 'Selecione um componente no canvas ou nas camadas para editar.' }));
    return;
  }
  const { propFields, styleFields } = getFieldsForNode(node);
  container.appendChild(el('div', { class: 'panel-title', text: `Propriedades — ${TYPE_LABEL[node.type] || node.type}` }));

  if (!isRoot) {
    const actions = el('div', { class: 'inspector-actions' }, [
      el('button', { class: 'btn small', text: '⧉ Duplicar', onclick: () => handlers.onDuplicate(node.id) }),
      el('button', { class: 'btn small', text: '↑', title: 'Mover para cima', onclick: () => handlers.onMove(node.id, -1) }),
      el('button', { class: 'btn small', text: '↓', title: 'Mover para baixo', onclick: () => handlers.onMove(node.id, 1) }),
      el('button', { class: 'btn small danger', text: '✕ Excluir', onclick: () => handlers.onDelete(node.id) }),
    ]);
    container.appendChild(actions);
  }

  const buildField = (field) => {
    const value = fieldValue(node, field);
    let input;
    if (field.type === 'select') {
      input = el('select', { class: 'field-input' }, field.options.map((o) => el('option', { value: o, text: o })));
      input.value = String(value || field.options[0]);
      input.addEventListener('change', () => handlers.onChange(node.id, field, castValue(field, input.value)));
    } else if (field.type === 'textarea' || field.type === 'list' || field.type === 'rows' || field.type === 'code') {
      input = el('textarea', { class: `field-input${field.type === 'code' ? ' code' : ''}`, rows: field.type === 'code' ? '4' : '3' });
      input.value = value;
      input.addEventListener('change', () => handlers.onChange(node.id, field, castValue(field, input.value)));
    } else if (field.type === 'color') {
      const wrap = el('div', { class: 'color-field' });
      const text = el('input', { class: 'field-input', type: 'text', placeholder: field.placeholder || 'ex: #ffffff' });
      text.value = value;
      const swatch = el('input', { type: 'color' });
      swatch.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
      swatch.addEventListener('input', () => { text.value = swatch.value; handlers.onChange(node.id, field, swatch.value); });
      text.addEventListener('change', () => handlers.onChange(node.id, field, text.value));
      wrap.appendChild(text); wrap.appendChild(swatch);
      input = wrap;
    } else {
      input = el('input', { class: 'field-input', type: 'text', placeholder: field.placeholder || '' });
      input.value = value;
      input.addEventListener('change', () => handlers.onChange(node.id, field, castValue(field, input.value)));
    }
    return el('label', { class: 'field-row' }, [el('span', { class: 'field-label', text: field.label }), input]);
  };

  if (propFields.length) {
    container.appendChild(el('div', { class: 'field-group-title', text: 'Conteúdo' }));
    for (const f of propFields) container.appendChild(buildField(f));
  }
  container.appendChild(el('div', { class: 'field-group-title', text: 'Aparência' }));
  for (const f of styleFields) container.appendChild(buildField(f));
}

function castValue(field, raw) {
  if (field.type === 'list') return raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (field.type === 'rows') return raw.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => line.split('|').map((c) => c.trim()));
  if (field.key === 'ordered') return raw === 'true';
  if (field.key === 'level') return Number(raw);
  return raw;
}

window.CSB_CANVAS = { renderPalette, renderCanvas, renderLayers, renderInspector, PALETTE, TYPE_LABEL };
