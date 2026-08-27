// Modelo de dados do projeto: uma árvore de "nós" (componentes) que tanto o
// editor visual (arrastar-e-soltar) quanto a IA leem e escrevem. É essa
// árvore compartilhada — e não HTML solto — que faz o chat e o drag-and-drop
// serem duas frentes do mesmo sistema, em vez de dois recursos separados.

const NODE_TYPES = [
  'container', 'heading', 'text', 'button', 'image', 'link',
  'input', 'textarea', 'select', 'form', 'list', 'table', 'card', 'divider',
];

// Estilos aceitos por qualquer nó. Lista fechada de propósito: mantém a IA
// e o inspetor visual restritos a um CSS previsível, fácil de renderizar
// tanto no DOM do editor quanto na exportação final.
const STYLE_KEYS = [
  'padding', 'margin', 'background', 'color', 'fontSize', 'fontWeight',
  'textAlign', 'borderRadius', 'border', 'boxShadow', 'gap',
  'flexDirection', 'justifyContent', 'alignItems', 'width', 'maxWidth',
  'display',
];

function uid(prefix = 'n') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyStyle() {
  return {};
}

function defaultPropsFor(type) {
  switch (type) {
    case 'heading': return { level: 2, text: 'Título' };
    case 'text': return { text: 'Texto do parágrafo.' };
    case 'button': return { text: 'Clique aqui', variant: 'primary', onClick: '' };
    case 'image': return { src: 'https://placehold.co/600x300', alt: 'Imagem' };
    case 'link': return { text: 'Link', href: '#' };
    case 'input': return { label: 'Campo', placeholder: '', inputType: 'text', name: 'campo' };
    case 'textarea': return { label: 'Mensagem', placeholder: '', name: 'mensagem' };
    case 'select': return { label: 'Opção', name: 'opcao', options: ['Opção 1', 'Opção 2'] };
    case 'form': return { onSubmit: '' };
    case 'list': return { items: ['Item 1', 'Item 2', 'Item 3'], ordered: false };
    case 'table': return { columns: ['Coluna 1', 'Coluna 2'], rows: [['Valor 1', 'Valor 2']] };
    case 'card': return {};
    case 'divider': return {};
    case 'container':
    default: return {};
  }
}

function canHaveChildren(type) {
  return type === 'container' || type === 'form' || type === 'card';
}

function createNode(type, overrides = {}) {
  const node = {
    id: uid(),
    type,
    props: { ...defaultPropsFor(type), ...(overrides.props || {}) },
    style: { ...emptyStyle(), ...(overrides.style || {}) },
    children: canHaveChildren(type) ? (overrides.children || []) : undefined,
  };
  return node;
}

function createRoot() {
  return createNode('container', {
    style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px', maxWidth: '760px' },
    children: [
      createNode('heading', { props: { level: 1, text: 'Meu novo sistema' } }),
      createNode('text', { props: { text: 'Descreva no chat o que você quer construir, ou arraste componentes aqui ao lado.' } }),
    ],
  });
}

function createProject(name = 'Novo projeto') {
  return {
    id: uid('proj'),
    name,
    meta: { title: name, description: '' },
    tree: createRoot(),
    css: '',
    js: '',
    updatedAt: Date.now(),
  };
}

// Sana uma árvore vinda da IA (ou de import): remove tipos/estilos
// desconhecidos, garante ids únicos e limita profundidade/tamanho — a IA
// pode alucinar campos fora do esquema ou (em teoria) tentar gerar uma
// árvore absurdamente grande/funda.
function sanitizeNode(raw, depth = 0) {
  if (!raw || typeof raw !== 'object' || depth > 12) return null;
  const type = NODE_TYPES.includes(raw.type) ? raw.type : 'container';
  const props = { ...defaultPropsFor(type) };
  if (raw.props && typeof raw.props === 'object') {
    for (const key of Object.keys(props)) {
      if (key in raw.props) props[key] = raw.props[key];
    }
  }
  const style = {};
  if (raw.style && typeof raw.style === 'object') {
    for (const key of STYLE_KEYS) {
      if (typeof raw.style[key] === 'string' && raw.style[key].length <= 200) {
        style[key] = raw.style[key];
      }
    }
  }
  const node = { id: uid(), type, props, style };
  if (canHaveChildren(type)) {
    const rawChildren = Array.isArray(raw.children) ? raw.children.slice(0, 60) : [];
    node.children = rawChildren.map((c) => sanitizeNode(c, depth + 1)).filter(Boolean);
  }
  return node;
}

function sanitizeProject(raw, fallbackName) {
  const tree = sanitizeNode(raw && raw.tree) || createRoot();
  return {
    id: uid('proj'),
    name: (raw && raw.name) || fallbackName || 'Projeto gerado',
    meta: {
      title: (raw && raw.meta && raw.meta.title) || fallbackName || 'Projeto gerado',
      description: (raw && raw.meta && raw.meta.description) || '',
    },
    tree,
    css: typeof (raw && raw.css) === 'string' ? raw.css.slice(0, 20000) : '',
    js: typeof (raw && raw.js) === 'string' ? raw.js.slice(0, 20000) : '',
    updatedAt: Date.now(),
  };
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function findNode(root, id) {
  if (root.id === id) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(root, id, parent = null) {
  if (root.id === id) return parent;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findParent(child, id, root);
    if (found !== null) return found;
  }
  return null;
}

function removeNode(root, id) {
  const parent = findParent(root, id);
  if (!parent) return false;
  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  parent.children.splice(idx, 1);
  return true;
}

window.CSB_SCHEMA = {
  NODE_TYPES, STYLE_KEYS, uid, createNode, createRoot, createProject,
  sanitizeNode, sanitizeProject, cloneNode, findNode, findParent, removeNode,
  canHaveChildren, defaultPropsFor,
};
