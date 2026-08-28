// Production component library (~24 components). Every render() is a pure
// function — no DOM access, no globals besides what's passed in ctx — so it
// can run identically in the extension and in the Node test suite.
import { registerComponent } from './registry.js';
import { escapeHtml, escapeAttr } from '../codegen/sanitize.js';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];

function field(key, label, type, extra = {}) {
  return { key, label, type, ...extra };
}

// ---------------------------------------------------------------- Layout ---

registerComponent('Container', {
  meta: { label: 'Container', category: 'Layout', icon: '▭' },
  defaultProps: { maxWidth: '72rem' },
  propSchema: [field('maxWidth', 'Largura máxima', 'text')],
  render(node, childrenHtml, ctx) {
    const mw = escapeAttr(node.props.maxWidth || '72rem');
    return {
      html: `<div class="av-Container" ${ctx.attrs} data-av-slot="children" style="--av-c-maxw:${mw}">${childrenHtml}</div>`,
      css: `.av-Container{width:100%;max-width:var(--av-c-maxw);margin-inline:auto;padding-inline:var(--av-space-4);container-type:inline-size;}`,
    };
  },
});

registerComponent('Stack', {
  meta: { label: 'Pilha (Stack)', category: 'Layout', icon: '≡' },
  defaultProps: { direction: 'column', gap: '4' },
  propSchema: [
    field('direction', 'Direção', 'select', { options: ['column', 'row'] }),
    field('gap', 'Espaçamento', 'select', { options: ['1', '2', '3', '4', '5', '6'] }),
  ],
  render(node, childrenHtml, ctx) {
    const dir = node.props.direction === 'row' ? 'row' : 'column';
    const gap = escapeAttr(node.props.gap || '4');
    return {
      html: `<div class="av-Stack" data-dir="${dir}" ${ctx.attrs} data-av-slot="children" style="--av-s-gap:var(--av-space-${gap})">${childrenHtml}</div>`,
      css: `.av-Stack{display:flex;flex-wrap:wrap;gap:var(--av-s-gap);}.av-Stack[data-dir="column"]{flex-direction:column;}`,
    };
  },
});

registerComponent('Grid', {
  meta: { label: 'Grade (Grid)', category: 'Layout', icon: '▦' },
  defaultProps: { minColumnWidth: '220px', gap: '4' },
  propSchema: [
    field('minColumnWidth', 'Largura mínima da coluna', 'text'),
    field('gap', 'Espaçamento', 'select', { options: ['2', '3', '4', '5', '6'] }),
  ],
  render(node, childrenHtml, ctx) {
    const min = escapeAttr(node.props.minColumnWidth || '220px');
    const gap = escapeAttr(node.props.gap || '4');
    return {
      html: `<div class="av-Grid" ${ctx.attrs} data-av-slot="children" style="--av-g-min:${min};--av-g-gap:var(--av-space-${gap})">${childrenHtml}</div>`,
      css: `.av-Grid{display:grid;gap:var(--av-g-gap);grid-template-columns:repeat(auto-fit,minmax(min(var(--av-g-min),100%),1fr));container-type:inline-size;}`,
    };
  },
});

registerComponent('Header', {
  meta: { label: 'Cabeçalho de página', category: 'Layout', icon: '▔' },
  defaultProps: { title: 'Título da página', subtitle: '' },
  propSchema: [field('title', 'Título', 'text'), field('subtitle', 'Subtítulo', 'text')],
  render(node, childrenHtml, ctx) {
    const { title = '', subtitle = '' } = node.props;
    return {
      html: `<header class="av-Header" ${ctx.attrs}><div><h1 class="av-Header__title">${escapeHtml(title)}</h1>${subtitle ? `<p class="av-Header__subtitle">${escapeHtml(subtitle)}</p>` : ''}</div><div class="av-Header__actions" data-av-slot="children">${childrenHtml}</div></header>`,
      css: `.av-Header{display:flex;align-items:center;justify-content:space-between;gap:var(--av-space-4);flex-wrap:wrap;padding-block:var(--av-space-5);}.av-Header__title{font-size:var(--av-font-xl);font-weight:700;margin:0;}.av-Header__subtitle{color:var(--av-color-muted);margin:.25rem 0 0;}.av-Header__actions{display:flex;gap:var(--av-space-2);}`,
    };
  },
});

registerComponent('Sidebar', {
  meta: { label: 'Barra lateral', category: 'Layout', icon: '▤' },
  defaultProps: { title: 'App', links: [{ label: 'Dashboard', href: '#/' }] },
  propSchema: [field('title', 'Título', 'text')],
  render(node, childrenHtml, ctx) {
    const { title = 'App', links = [] } = node.props;
    const items = links
      .map((l) => `<a class="av-Sidebar__link" href="${escapeAttr(l.href || '#')}" data-route="${escapeAttr(l.href || '#')}">${escapeHtml(l.label || '')}</a>`)
      .join('');
    return {
      html: `<nav class="av-Sidebar" ${ctx.attrs} aria-label="Navegação principal"><div class="av-Sidebar__title">${escapeHtml(title)}</div><div class="av-Sidebar__links">${items}</div><div data-av-slot="children">${childrenHtml}</div></nav>`,
      css: `.av-Sidebar{display:flex;flex-direction:column;gap:var(--av-space-1);padding:var(--av-space-4);background:var(--av-color-surface);border-inline-end:1px solid var(--av-color-border);min-width:200px;}.av-Sidebar__title{font-weight:700;margin-block-end:var(--av-space-3);}.av-Sidebar__link{padding:var(--av-space-2) var(--av-space-3);border-radius:var(--av-radius-md);color:var(--av-color-text);text-decoration:none;}.av-Sidebar__link:hover,.av-Sidebar__link.is-active{background:color-mix(in srgb, var(--av-color-primary) 12%, transparent);color:var(--av-color-primary);}`,
      js: `AV.init.Sidebar=function(root){root.addEventListener('click',function(e){var a=e.target.closest('.av-Sidebar__link');if(!a)return;root.querySelectorAll('.av-Sidebar__link').forEach(function(l){l.classList.remove('is-active')});a.classList.add('is-active');});};`,
    };
  },
});

registerComponent('Navbar', {
  meta: { label: 'Barra de navegação', category: 'Layout', icon: '▬' },
  defaultProps: { brand: 'App' },
  propSchema: [field('brand', 'Marca', 'text')],
  render(node, childrenHtml, ctx) {
    return {
      html: `<nav class="av-Navbar" ${ctx.attrs}><span class="av-Navbar__brand">${escapeHtml(node.props.brand || 'App')}</span><div class="av-Navbar__items" data-av-slot="children">${childrenHtml}</div></nav>`,
      css: `.av-Navbar{display:flex;align-items:center;justify-content:space-between;padding:var(--av-space-3) var(--av-space-5);background:var(--av-color-surface);border-block-end:1px solid var(--av-color-border);}.av-Navbar__brand{font-weight:700;}.av-Navbar__items{display:flex;gap:var(--av-space-3);align-items:center;}`,
    };
  },
});

registerComponent('Footer', {
  meta: { label: 'Rodapé', category: 'Layout', icon: '▁' },
  defaultProps: { text: '© 2026' },
  propSchema: [field('text', 'Texto', 'text')],
  render(node, childrenHtml, ctx) {
    return {
      html: `<footer class="av-Footer" ${ctx.attrs}>${escapeHtml(node.props.text || '')}<div data-av-slot="children">${childrenHtml}</div></footer>`,
      css: `.av-Footer{padding:var(--av-space-5);text-align:center;color:var(--av-color-muted);font-size:var(--av-font-sm);}`,
    };
  },
});

registerComponent('Breadcrumb', {
  meta: { label: 'Trilha (Breadcrumb)', category: 'Navegação', icon: '›' },
  defaultProps: { items: [{ label: 'Início', href: '#/' }] },
  propSchema: [],
  render(node, _c, ctx) {
    const items = node.props.items || [];
    const lis = items
      .map((it, i) => {
        const isLast = i === items.length - 1;
        const label = escapeHtml(it.label || '');
        return isLast
          ? `<li aria-current="page">${label}</li>`
          : `<li><a href="${escapeAttr(it.href || '#')}">${label}</a></li>`;
      })
      .join('<li class="av-Breadcrumb__sep" aria-hidden="true">/</li>');
    return {
      html: `<nav ${ctx.attrs} aria-label="breadcrumb"><ol class="av-Breadcrumb">${lis}</ol></nav>`,
      css: `.av-Breadcrumb{display:flex;gap:var(--av-space-2);list-style:none;padding:0;margin:0;font-size:var(--av-font-sm);color:var(--av-color-muted);}.av-Breadcrumb a{color:inherit;text-decoration:none;}.av-Breadcrumb a:hover{color:var(--av-color-primary);}`,
    };
  },
});

// --------------------------------------------------------------- Content ---

registerComponent('Card', {
  meta: { label: 'Cartão (Card)', category: 'Conteúdo', icon: '▢' },
  defaultProps: { title: '', padded: true },
  propSchema: [field('title', 'Título', 'text'), field('padded', 'Com espaçamento interno', 'boolean')],
  render(node, childrenHtml, ctx) {
    const { title = '' } = node.props;
    return {
      html: `<section class="av-Card" ${ctx.attrs}>${title ? `<h3 class="av-Card__title">${escapeHtml(title)}</h3>` : ''}<div class="av-Card__body" data-av-slot="children">${childrenHtml}</div></section>`,
      css: `.av-Card{background:var(--av-color-surface);border:1px solid var(--av-color-border);border-radius:var(--av-radius-lg);padding:var(--av-space-5);box-shadow:var(--av-elevation-1);container-type:inline-size;}.av-Card__title{margin:0 0 var(--av-space-3);font-size:var(--av-font-lg);font-weight:600;}`,
    };
  },
});

registerComponent('StatCard', {
  meta: { label: 'Cartão de indicador (KPI)', category: 'Conteúdo', icon: '◔' },
  defaultProps: { label: 'Total', value: '0', trend: '', variant: 'neutral' },
  propSchema: [
    field('label', 'Rótulo', 'text'),
    field('value', 'Valor', 'text'),
    field('trend', 'Tendência (ex: +12%)', 'text'),
    field('variant', 'Variante', 'select', { options: ['neutral', 'success', 'warning', 'danger'] }),
  ],
  render(node, _c, ctx) {
    const { label = '', value = '0', trend = '', variant = 'neutral' } = node.props;
    const bindAttr = node.bind ? ` data-av-entity="${escapeAttr(node.bind.entity)}" data-av-agg="${escapeAttr(node.bind.agg || 'count')}" data-av-field="${escapeAttr(node.bind.field || '')}"` : '';
    return {
      html: `<div class="av-StatCard" data-variant="${escapeAttr(variant)}" ${ctx.attrs}${bindAttr}><span class="av-StatCard__label">${escapeHtml(label)}</span><strong class="av-StatCard__value">${escapeHtml(value)}</strong>${trend ? `<span class="av-StatCard__trend">${escapeHtml(trend)}</span>` : ''}</div>`,
      css: `.av-StatCard{display:flex;flex-direction:column;gap:4px;background:var(--av-color-surface);border:1px solid var(--av-color-border);border-radius:var(--av-radius-lg);padding:var(--av-space-4);container-type:inline-size;}.av-StatCard__label{font-size:var(--av-font-sm);color:var(--av-color-muted);}.av-StatCard__value{font-size:var(--av-font-2xl);font-weight:700;}.av-StatCard__trend{font-size:var(--av-font-xs);color:var(--av-color-success);}.av-StatCard[data-variant="danger"] .av-StatCard__trend{color:var(--av-color-danger);}.av-StatCard[data-variant="warning"] .av-StatCard__trend{color:var(--av-color-warning);}@container (min-width:200px){.av-StatCard{padding:var(--av-space-5);}.av-StatCard__value{font-size:2.5rem;}}`,
      js: `AV.init.StatCard=function(root){var entity=root.dataset.avEntity;if(!entity)return;var agg=root.dataset.avAgg||'count';var f=root.dataset.avField;var rows=AV.store.list(entity);var out=agg==='count'?rows.length:rows.reduce(function(s,r){return s+(Number(r[f])||0)},0);var el=root.querySelector('.av-StatCard__value');if(el)el.textContent=String(out);};`,
    };
  },
});

registerComponent('Badge', {
  meta: { label: 'Selo (Badge)', category: 'Conteúdo', icon: '●' },
  defaultProps: { text: 'Novo', variant: 'info' },
  propSchema: [field('text', 'Texto', 'text'), field('variant', 'Variante', 'select', { options: ['info', 'success', 'warning', 'danger', 'muted'] })],
  render(node, _c, ctx) {
    return {
      html: `<span class="av-Badge" data-variant="${escapeAttr(node.props.variant || 'info')}" ${ctx.attrs}>${escapeHtml(node.props.text || '')}</span>`,
      css: `.av-Badge{display:inline-flex;align-items:center;padding:2px 10px;border-radius:var(--av-radius-full);font-size:var(--av-font-xs);font-weight:600;background:color-mix(in srgb, var(--av-color-info) 15%, transparent);color:var(--av-color-info);}.av-Badge[data-variant="success"]{background:color-mix(in srgb, var(--av-color-success) 15%, transparent);color:var(--av-color-success);}.av-Badge[data-variant="warning"]{background:color-mix(in srgb, var(--av-color-warning) 15%, transparent);color:var(--av-color-warning);}.av-Badge[data-variant="danger"]{background:color-mix(in srgb, var(--av-color-danger) 15%, transparent);color:var(--av-color-danger);}.av-Badge[data-variant="muted"]{background:color-mix(in srgb, var(--av-color-muted) 15%, transparent);color:var(--av-color-muted);}`,
    };
  },
});

registerComponent('Alert', {
  meta: { label: 'Alerta', category: 'Conteúdo', icon: '⚠' },
  defaultProps: { text: 'Mensagem importante.', variant: 'info' },
  propSchema: [field('text', 'Texto', 'textarea'), field('variant', 'Variante', 'select', { options: ['info', 'success', 'warning', 'danger'] })],
  render(node, _c, ctx) {
    return {
      html: `<div class="av-Alert" data-variant="${escapeAttr(node.props.variant || 'info')}" role="alert" ${ctx.attrs}>${escapeHtml(node.props.text || '')}</div>`,
      css: `.av-Alert{padding:var(--av-space-3) var(--av-space-4);border-radius:var(--av-radius-md);border:1px solid;background:color-mix(in srgb, var(--av-color-info) 10%, var(--av-color-surface));border-color:color-mix(in srgb, var(--av-color-info) 35%, transparent);color:var(--av-color-info);}.av-Alert[data-variant="success"]{background:color-mix(in srgb, var(--av-color-success) 10%, var(--av-color-surface));border-color:color-mix(in srgb, var(--av-color-success) 35%, transparent);color:var(--av-color-success);}.av-Alert[data-variant="warning"]{background:color-mix(in srgb, var(--av-color-warning) 10%, var(--av-color-surface));border-color:color-mix(in srgb, var(--av-color-warning) 35%, transparent);color:var(--av-color-warning);}.av-Alert[data-variant="danger"]{background:color-mix(in srgb, var(--av-color-danger) 10%, var(--av-color-surface));border-color:color-mix(in srgb, var(--av-color-danger) 35%, transparent);color:var(--av-color-danger);}`,
    };
  },
});

registerComponent('EmptyState', {
  meta: { label: 'Estado vazio', category: 'Conteúdo', icon: '◌' },
  defaultProps: { title: 'Nada por aqui ainda', description: 'Assim que houver dados, eles aparecem aqui.', actionLabel: '' },
  propSchema: [field('title', 'Título', 'text'), field('description', 'Descrição', 'textarea'), field('actionLabel', 'Texto do botão (opcional)', 'text')],
  render(node, _c, ctx) {
    const { title = '', description = '', actionLabel = '' } = node.props;
    return {
      html: `<div class="av-EmptyState" ${ctx.attrs}><p class="av-EmptyState__title">${escapeHtml(title)}</p><p class="av-EmptyState__desc">${escapeHtml(description)}</p>${actionLabel ? `<button class="av-Button" data-variant="primary" type="button">${escapeHtml(actionLabel)}</button>` : ''}</div>`,
      css: `.av-EmptyState{text-align:center;padding:var(--av-space-7) var(--av-space-4);color:var(--av-color-muted);}.av-EmptyState__title{font-weight:600;color:var(--av-color-text);margin:0 0 4px;}.av-EmptyState__desc{margin:0 0 var(--av-space-4);}`,
    };
  },
});

// ----------------------------------------------------------------- Data ---

registerComponent('DataTable', {
  meta: { label: 'Tabela de dados', category: 'Dados', icon: '▦' },
  defaultProps: { columns: [{ key: 'name', label: 'Nome' }], pageSize: 10, searchable: true },
  propSchema: [field('pageSize', 'Itens por página', 'number'), field('searchable', 'Com busca', 'boolean')],
  a11y: { role: 'table' },
  render(node, _c, ctx) {
    const entity = node.bind?.entity || '';
    const columns = node.props.columns || [];
    const pageSize = Number(node.props.pageSize) || 10;
    const searchable = node.props.searchable !== false;
    return {
      html: `<div class="av-DataTable" ${ctx.attrs} data-av-entity="${escapeAttr(entity)}" data-av-columns="${escapeAttr(JSON.stringify(columns))}" data-av-pagesize="${pageSize}">
  ${searchable ? `<div class="av-DataTable__toolbar"><input type="search" class="av-Input" placeholder="Pesquisar…" data-role="search" aria-label="Pesquisar"></div>` : ''}
  <div class="av-DataTable__scroll"><table class="av-DataTable__table"><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label || c.key)}</th>`).join('')}</tr></thead><tbody data-role="tbody"></tbody></table></div>
  <div class="av-DataTable__empty" data-role="empty" hidden>Nenhum registro encontrado.</div>
  <div class="av-DataTable__pagination" data-role="pagination"></div>
</div>`,
      css: `.av-DataTable{container-type:inline-size;background:var(--av-color-surface);border:1px solid var(--av-color-border);border-radius:var(--av-radius-lg);overflow:hidden;}.av-DataTable__toolbar{padding:var(--av-space-3);border-block-end:1px solid var(--av-color-border);}.av-DataTable__scroll{overflow-x:auto;}.av-DataTable__table{width:100%;border-collapse:collapse;font-size:var(--av-font-sm);}.av-DataTable__table th,.av-DataTable__table td{text-align:start;padding:var(--av-space-2) var(--av-space-3);border-block-end:1px solid var(--av-color-border);}.av-DataTable__table th{color:var(--av-color-muted);font-weight:600;background:var(--av-color-background);position:sticky;top:0;}.av-DataTable__empty{padding:var(--av-space-6);text-align:center;color:var(--av-color-muted);}.av-DataTable__pagination{display:flex;justify-content:flex-end;gap:var(--av-space-2);padding:var(--av-space-2) var(--av-space-3);}`,
      js: `AV.init.DataTable=function(root){
  var entity=root.dataset.avEntity;var columns=JSON.parse(root.dataset.avColumns||'[]');var pageSize=Number(root.dataset.avPagesize)||10;
  var tbody=root.querySelector('[data-role=tbody]');var search=root.querySelector('[data-role=search]');
  var emptyEl=root.querySelector('[data-role=empty]');var pager=root.querySelector('[data-role=pagination]');
  var state={query:'',page:1};
  function rows(){var all=entity?AV.store.list(entity):[];if(!state.query)return all;var q=state.query.toLowerCase();return all.filter(function(r){return columns.some(function(c){return String(r[c.key]||'').toLowerCase().indexOf(q)>-1});});}
  function render(){
    var all=rows();var totalPages=Math.max(1,Math.ceil(all.length/pageSize));state.page=Math.min(state.page,totalPages);
    var slice=all.slice((state.page-1)*pageSize,state.page*pageSize);
    tbody.innerHTML='';
    slice.forEach(function(r){var tr=document.createElement('tr');columns.forEach(function(c){var td=document.createElement('td');td.textContent=r[c.key]==null?'':String(r[c.key]);tr.appendChild(td);});tbody.appendChild(tr);});
    emptyEl.hidden=slice.length>0;
    pager.innerHTML='';
    if(totalPages>1){for(var i=1;i<=totalPages;i++){var b=document.createElement('button');b.type='button';b.className='av-Button av-Button--small';b.textContent=String(i);b.setAttribute('data-variant',i===state.page?'primary':'ghost');b.addEventListener('click',(function(p){return function(){state.page=p;render();}})(i));pager.appendChild(b);}}
  }
  if(search)search.addEventListener('input',function(e){state.query=e.target.value;state.page=1;render();});
  document.addEventListener('av:data-changed',function(e){if(!e.detail||e.detail.entity===entity)render();});
  render();
};`,
    };
  },
});

// ----------------------------------------------------------------- Form ---

registerComponent('Button', {
  meta: { label: 'Botão', category: 'Formulário', icon: '▮' },
  defaultProps: { label: 'Enviar', variant: 'primary', type: 'button' },
  propSchema: [field('label', 'Texto', 'text'), field('variant', 'Variante', 'select', { options: VARIANTS }), field('type', 'Tipo', 'select', { options: ['button', 'submit'] })],
  render(node, _c, ctx) {
    const { label = 'Botão', variant = 'primary', type = 'button' } = node.props;
    return {
      html: `<button class="av-Button" data-variant="${escapeAttr(variant)}" type="${escapeAttr(type)}" ${ctx.attrs}>${escapeHtml(label)}</button>`,
      css: `.av-Button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:var(--av-space-2) var(--av-space-4);border-radius:var(--av-radius-md);border:1px solid transparent;font-weight:600;font-size:var(--av-font-sm);cursor:pointer;transition:filter .12s;}.av-Button:hover{filter:brightness(0.95);}.av-Button:disabled{opacity:.5;cursor:not-allowed;}.av-Button--small{padding:4px 10px;font-size:var(--av-font-xs);}.av-Button[data-variant="primary"]{background:var(--av-color-primary);color:#fff;}.av-Button[data-variant="secondary"]{background:var(--av-color-secondary);color:#fff;}.av-Button[data-variant="ghost"]{background:transparent;border-color:var(--av-color-border);color:var(--av-color-text);}.av-Button[data-variant="danger"]{background:var(--av-color-danger);color:#fff;}`,
    };
  },
});

registerComponent('Input', {
  meta: { label: 'Campo de texto', category: 'Formulário', icon: '▯' },
  defaultProps: { label: 'Campo', name: 'campo', placeholder: '', inputType: 'text', required: false },
  propSchema: [
    field('label', 'Rótulo', 'text'), field('name', 'Nome do campo', 'text'),
    field('placeholder', 'Placeholder', 'text'),
    field('inputType', 'Tipo', 'select', { options: ['text', 'email', 'number', 'date', 'password', 'tel'] }),
    field('required', 'Obrigatório', 'boolean'),
  ],
  a11y: { requiresLabel: true },
  render(node, _c, ctx) {
    const { label = '', name = 'campo', placeholder = '', inputType = 'text', required = false } = node.props;
    const inputId = `${node.id}-input`;
    return {
      html: `<div class="av-Field" ${ctx.attrs}>${label ? `<label class="av-Field__label" for="${escapeAttr(inputId)}">${escapeHtml(label)}${required ? ' *' : ''}</label>` : ''}<input class="av-Input" id="${escapeAttr(inputId)}" name="${escapeAttr(name)}" type="${escapeAttr(inputType)}" placeholder="${escapeAttr(placeholder)}"${required ? ' required' : ''}></div>`,
      css: `.av-Field{display:flex;flex-direction:column;gap:4px;}.av-Field__label{font-size:var(--av-font-sm);font-weight:600;}.av-Input,.av-Textarea,.av-Select{padding:var(--av-space-2) var(--av-space-3);border:1px solid var(--av-color-border);border-radius:var(--av-radius-md);font-size:var(--av-font-sm);background:var(--av-color-surface);color:var(--av-color-text);}.av-Input:focus,.av-Textarea:focus,.av-Select:focus{outline:2px solid var(--av-color-info);outline-offset:1px;}.av-Input:invalid:not(:placeholder-shown){border-color:var(--av-color-danger);}`,
    };
  },
});

registerComponent('Textarea', {
  meta: { label: 'Área de texto', category: 'Formulário', icon: '▯' },
  defaultProps: { label: 'Observações', name: 'obs', rows: 4 },
  propSchema: [field('label', 'Rótulo', 'text'), field('name', 'Nome do campo', 'text'), field('rows', 'Linhas', 'number')],
  render(node, _c, ctx) {
    const { label = '', name = 'obs', rows = 4 } = node.props;
    const inputId = `${node.id}-input`;
    return {
      html: `<div class="av-Field" ${ctx.attrs}>${label ? `<label class="av-Field__label" for="${escapeAttr(inputId)}">${escapeHtml(label)}</label>` : ''}<textarea class="av-Textarea" id="${escapeAttr(inputId)}" name="${escapeAttr(name)}" rows="${Number(rows) || 4}"></textarea></div>`,
    };
  },
});

registerComponent('Select', {
  meta: { label: 'Seleção (Select)', category: 'Formulário', icon: '▾' },
  defaultProps: { label: 'Opção', name: 'opcao', options: [{ value: '1', label: 'Opção 1' }] },
  propSchema: [field('label', 'Rótulo', 'text'), field('name', 'Nome do campo', 'text')],
  render(node, _c, ctx) {
    const { label = '', name = 'opcao', options = [] } = node.props;
    const inputId = `${node.id}-input`;
    const opts = options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    return {
      html: `<div class="av-Field" ${ctx.attrs}>${label ? `<label class="av-Field__label" for="${escapeAttr(inputId)}">${escapeHtml(label)}</label>` : ''}<select class="av-Select" id="${escapeAttr(inputId)}" name="${escapeAttr(name)}">${opts}</select></div>`,
    };
  },
});

registerComponent('Checkbox', {
  meta: { label: 'Caixa de seleção', category: 'Formulário', icon: '☑' },
  defaultProps: { label: 'Concordo', name: 'check' },
  propSchema: [field('label', 'Rótulo', 'text'), field('name', 'Nome do campo', 'text')],
  render(node, _c, ctx) {
    const { label = '', name = 'check' } = node.props;
    const inputId = `${node.id}-input`;
    return {
      html: `<label class="av-Checkbox" ${ctx.attrs} for="${escapeAttr(inputId)}"><input type="checkbox" id="${escapeAttr(inputId)}" name="${escapeAttr(name)}"><span>${escapeHtml(label)}</span></label>`,
      css: `.av-Checkbox{display:inline-flex;align-items:center;gap:8px;font-size:var(--av-font-sm);}`,
    };
  },
});

registerComponent('Switch', {
  meta: { label: 'Alternador (Switch)', category: 'Formulário', icon: '⏻' },
  defaultProps: { label: 'Ativo', name: 'ativo' },
  propSchema: [field('label', 'Rótulo', 'text'), field('name', 'Nome do campo', 'text')],
  render(node, _c, ctx) {
    const { label = '', name = 'ativo' } = node.props;
    const inputId = `${node.id}-input`;
    return {
      html: `<label class="av-Switch" ${ctx.attrs} for="${escapeAttr(inputId)}"><input type="checkbox" role="switch" id="${escapeAttr(inputId)}" name="${escapeAttr(name)}"><span class="av-Switch__track" aria-hidden="true"></span><span>${escapeHtml(label)}</span></label>`,
      css: `.av-Switch{display:inline-flex;align-items:center;gap:8px;font-size:var(--av-font-sm);cursor:pointer;}.av-Switch input{position:absolute;opacity:0;width:1px;height:1px;}.av-Switch__track{width:2.25rem;height:1.25rem;border-radius:var(--av-radius-full);background:var(--av-color-border);position:relative;transition:background .15s;}.av-Switch__track::after{content:'';position:absolute;inset-block:2px;inset-inline-start:2px;width:1rem;height:1rem;border-radius:50%;background:#fff;transition:transform .15s;}.av-Switch input:checked+.av-Switch__track{background:var(--av-color-primary);}.av-Switch input:checked+.av-Switch__track::after{transform:translateX(1rem);}.av-Switch input:focus-visible+.av-Switch__track{outline:2px solid var(--av-color-info);outline-offset:2px;}`,
    };
  },
});

registerComponent('Form', {
  meta: { label: 'Formulário', category: 'Formulário', icon: '▤' },
  defaultProps: { submitLabel: 'Salvar' },
  propSchema: [],
  render(node, childrenHtml, ctx) {
    const entity = node.bind?.entity || '';
    return {
      html: `<form class="av-Form" ${ctx.attrs} data-av-entity="${escapeAttr(entity)}" data-av-slot="children" novalidate>${childrenHtml}</form>`,
      css: `.av-Form{display:flex;flex-direction:column;gap:var(--av-space-3);}`,
      js: `AV.init.Form=function(root){root.addEventListener('submit',function(e){e.preventDefault();var entity=root.dataset.avEntity;if(!entity)return;var data=Object.fromEntries(new FormData(root).entries());AV.store.create(entity,data);root.reset();document.dispatchEvent(new CustomEvent('av:data-changed',{detail:{entity:entity}}));AV.toast('Salvo com sucesso.');});};`,
    };
  },
});

// -------------------------------------------------------------- Overlay ---

registerComponent('Modal', {
  meta: { label: 'Modal', category: 'Overlay', icon: '▣' },
  defaultProps: { title: 'Título', triggerLabel: 'Abrir' },
  propSchema: [field('title', 'Título', 'text'), field('triggerLabel', 'Texto do botão que abre', 'text')],
  render(node, childrenHtml, ctx) {
    const { title = '', triggerLabel = 'Abrir' } = node.props;
    const dialogId = `${node.id}-dialog`;
    return {
      html: `<span ${ctx.attrs}><button type="button" class="av-Button" data-variant="primary" data-role="open" aria-haspopup="dialog" aria-controls="${escapeAttr(dialogId)}">${escapeHtml(triggerLabel)}</button><dialog id="${escapeAttr(dialogId)}" class="av-Modal"><form method="dialog" class="av-Modal__box"><header class="av-Modal__header"><h2>${escapeHtml(title)}</h2><button type="submit" class="av-Button av-Button--small" data-variant="ghost" aria-label="Fechar">✕</button></header><div class="av-Modal__body" data-av-slot="children">${childrenHtml}</div></form></dialog></span>`,
      css: `.av-Modal{border:0;border-radius:var(--av-radius-lg);padding:0;box-shadow:var(--av-elevation-3);max-width:min(90vw,32rem);}.av-Modal::backdrop{background:rgba(10,12,20,.45);}.av-Modal__box{padding:var(--av-space-5);}.av-Modal__header{display:flex;align-items:center;justify-content:space-between;margin-block-end:var(--av-space-3);}.av-Modal__header h2{font-size:var(--av-font-lg);margin:0;}`,
      js: `AV.init.Modal=function(root){var btn=root.querySelector('[data-role=open]');var dlg=root.querySelector('dialog');if(!btn||!dlg||typeof dlg.showModal!=='function')return;btn.addEventListener('click',function(){dlg.showModal();});};`,
    };
  },
});

registerComponent('Tabs', {
  meta: { label: 'Abas (Tabs)', category: 'Overlay', icon: '▭▭' },
  defaultProps: { tabs: [{ id: 'tab1', label: 'Aba 1' }, { id: 'tab2', label: 'Aba 2' }] },
  propSchema: [],
  render(node, childrenHtml, ctx) {
    const tabs = node.props.tabs || [];
    const tablist = tabs
      .map((t, i) => `<button type="button" class="av-Tabs__tab" role="tab" aria-selected="${i === 0}" data-tab="${escapeAttr(t.id)}">${escapeHtml(t.label)}</button>`)
      .join('');
    return {
      html: `<div class="av-Tabs" ${ctx.attrs}><div class="av-Tabs__list" role="tablist">${tablist}</div><div class="av-Tabs__panels" data-av-slot="children">${childrenHtml}</div></div>`,
      css: `.av-Tabs__list{display:flex;gap:var(--av-space-2);border-block-end:1px solid var(--av-color-border);}.av-Tabs__tab{padding:var(--av-space-2) var(--av-space-3);border:0;background:none;border-bottom:2px solid transparent;color:var(--av-color-muted);font-weight:600;font-size:var(--av-font-sm);}.av-Tabs__tab[aria-selected="true"]{color:var(--av-color-primary);border-color:var(--av-color-primary);}.av-Tabs__panels>[data-tab-panel]{display:none;padding-block-start:var(--av-space-4);}.av-Tabs__panels>[data-tab-panel].is-active{display:block;}`,
      js: `AV.init.Tabs=function(root){var tabs=root.querySelectorAll('.av-Tabs__tab');var panels=root.querySelectorAll('[data-tab-panel]');function activate(id){tabs.forEach(function(t){t.setAttribute('aria-selected',String(t.dataset.tab===id));});panels.forEach(function(p){p.classList.toggle('is-active',p.dataset.tabPanel===id);});}
  root.querySelector('.av-Tabs__list').addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(b)activate(b.dataset.tab);});
  if(tabs[0])activate(tabs[0].dataset.tab);};`,
    };
  },
});

registerComponent('Raw', {
  meta: { label: 'HTML literal', category: 'Avançado', icon: '{ }' },
  defaultProps: { html: '' },
  propSchema: [field('html', 'HTML', 'textarea')],
  render(node, _c, ctx) {
    // Deliberately NOT escaped: this is the escape hatch for content imported
    // via code-mode reimport (see codegen/import.js). It is still sandboxed by
    // the preview iframe (no allow-same-origin), the same boundary that
    // contains any other script on the page.
    return { html: `<div ${ctx.attrs}>${node.props.html || ''}</div>` };
  },
});
