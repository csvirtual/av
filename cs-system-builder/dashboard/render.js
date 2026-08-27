// Serializa a árvore de componentes (schema.js) para HTML/CSS estáticos —
// usado tanto no preview ao vivo (iframe sandboxed) quanto na exportação
// final do sistema gerado.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function styleToCssText(style) {
  if (!style) return '';
  const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${kebab(k)}: ${v};`)
    .join(' ');
}

const BUTTON_VARIANT_CSS = {
  primary: 'background:#6d5efc;color:#fff;border:none;',
  secondary: 'background:#eef0ff;color:#33307a;border:1px solid #d6d9ff;',
  ghost: 'background:transparent;color:#33307a;border:1px solid transparent;',
  danger: 'background:#ef4444;color:#fff;border:none;',
};

function nodeToHtml(node, indent = 0) {
  if (!node) return '';
  const pad = '  '.repeat(indent);
  const styleAttr = styleToCssText(node.style);
  const styleFrag = styleAttr ? ` style="${escapeAttr(styleAttr)}"` : '';
  const dataAttr = ` data-node-id="${node.id}"`;
  const p = node.props || {};

  const wrapChildren = () => (node.children || []).map((c) => nodeToHtml(c, indent + 1)).join('\n');

  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(p.level) || 2));
      return `${pad}<h${level}${dataAttr}${styleFrag}>${escapeHtml(p.text)}</h${level}>`;
    }
    case 'text':
      return `${pad}<p${dataAttr}${styleFrag}>${escapeHtml(p.text)}</p>`;
    case 'button': {
      const variantCss = BUTTON_VARIANT_CSS[p.variant] || BUTTON_VARIANT_CSS.primary;
      const baseCss = 'padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer;';
      const onclick = p.onClick ? ` onclick="${escapeAttr(p.onClick)}"` : '';
      return `${pad}<button${dataAttr} style="${baseCss}${variantCss} ${styleAttr}"${onclick}>${escapeHtml(p.text)}</button>`;
    }
    case 'image':
      return `${pad}<img${dataAttr}${styleFrag} src="${escapeAttr(p.src)}" alt="${escapeAttr(p.alt)}">`;
    case 'link':
      return `${pad}<a${dataAttr}${styleFrag} href="${escapeAttr(p.href)}">${escapeHtml(p.text)}</a>`;
    case 'input':
      return `${pad}<label${dataAttr} style="display:flex;flex-direction:column;gap:6px;font-size:14px;${styleAttr}">${escapeHtml(p.label)}` +
        `<input type="${escapeAttr(p.inputType || 'text')}" name="${escapeAttr(p.name)}" placeholder="${escapeAttr(p.placeholder)}" style="padding:8px 10px;border:1px solid #d6d9ff;border-radius:6px;"></label>`;
    case 'textarea':
      return `${pad}<label${dataAttr} style="display:flex;flex-direction:column;gap:6px;font-size:14px;${styleAttr}">${escapeHtml(p.label)}` +
        `<textarea name="${escapeAttr(p.name)}" placeholder="${escapeAttr(p.placeholder)}" style="padding:8px 10px;border:1px solid #d6d9ff;border-radius:6px;min-height:80px;"></textarea></label>`;
    case 'select': {
      const opts = (p.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join('');
      return `${pad}<label${dataAttr} style="display:flex;flex-direction:column;gap:6px;font-size:14px;${styleAttr}">${escapeHtml(p.label)}` +
        `<select name="${escapeAttr(p.name)}" style="padding:8px 10px;border:1px solid #d6d9ff;border-radius:6px;">${opts}</select></label>`;
    }
    case 'list': {
      const tag = p.ordered ? 'ol' : 'ul';
      const items = (p.items || []).map((i) => `${pad}  <li>${escapeHtml(i)}</li>`).join('\n');
      return `${pad}<${tag}${dataAttr}${styleFrag}>\n${items}\n${pad}</${tag}>`;
    }
    case 'table': {
      const cols = p.columns || [];
      const rows = p.rows || [];
      const thead = `<tr>${cols.map((c) => `<th style="text-align:left;border-bottom:2px solid #d6d9ff;padding:8px;">${escapeHtml(c)}</th>`).join('')}</tr>`;
      const tbody = rows.map((r) => `<tr>${r.map((cell) => `<td style="padding:8px;border-bottom:1px solid #eef0ff;">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
      return `${pad}<table${dataAttr} style="width:100%;border-collapse:collapse;${styleAttr}"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
    }
    case 'divider':
      return `${pad}<hr${dataAttr} style="border:none;border-top:1px solid #e5e7eb;${styleAttr}">`;
    case 'card':
      return `${pad}<div${dataAttr} style="background:#fff;border:1px solid #eef0ff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);${styleAttr}">\n${wrapChildren()}\n${pad}</div>`;
    case 'form':
      return `${pad}<form${dataAttr}${styleFrag}${p.onSubmit ? ` onsubmit="${escapeAttr(p.onSubmit)}"` : ''}>\n${wrapChildren()}\n${pad}</form>`;
    case 'container':
    default:
      return `${pad}<div${dataAttr}${styleFrag}>\n${wrapChildren()}\n${pad}</div>`;
  }
}

function renderProjectHtml(project) {
  return nodeToHtml(project.tree);
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2340; background: #f7f7fb; }
  img { max-width: 100%; display: block; }
  button { font-family: inherit; }
`;

function buildFullDocument(project, { forExport = false } = {}) {
  const title = escapeHtml(project.meta?.title || project.name || 'Sistema');
  const bodyHtml = renderProjectHtml(project);
  const extraCss = project.css || '';
  const extraJs = project.js || '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${BASE_CSS}\n${extraCss}</style>
</head>
<body>
${bodyHtml}
${forExport ? '' : ''}
<script>${extraJs}</script>
</body>
</html>`;
}

window.CSB_RENDER = { styleToCssText, nodeToHtml, renderProjectHtml, buildFullDocument, escapeHtml };
