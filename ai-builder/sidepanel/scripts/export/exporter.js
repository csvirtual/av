// Assembles the exportable project files from the SAME generateSite() output
// used for the live preview (ARCHITECTURE.md §16 — no second, divergent
// generation), then zips and downloads it.
import { generateSite } from '../codegen/generator.js';
import { createZip } from './zip.js';

export function buildExportFiles(project) {
  const site = generateSite(project);
  const indexHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${project.name}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
${site.html}
<script src="app.js"></script>
</body>
</html>
`;
  const readme = `# ${project.name}

Gerado com AV Builder (AI Web Engineering Platform) em ${new Date().toISOString().slice(0, 10)}.

## Como usar

Abra \`index.html\` em qualquer navegador, ou hospede a pasta inteira em
qualquer serviço de arquivos estáticos (GitHub Pages, Netlify, Vercel...).
Não há passo de build — é HTML/CSS/JS puro.

## Estrutura

- \`index.html\` — marcação de todas as páginas (roteamento por hash)
- \`styles.css\` — design tokens + estilos dos componentes
- \`app.js\` — camada de dados local (localStorage) e interações

## Entidades

${(project.entities || []).map((e) => `- **${e.name}**: ${e.fields.map((f) => f.label).join(', ')}`).join('\n') || '(nenhuma)'}
`;
  return [
    { name: 'index.html', content: indexHtml },
    { name: 'styles.css', content: site.css },
    { name: 'app.js', content: site.js },
    { name: 'README.md', content: readme },
  ];
}

export async function exportProjectAsZip(project) {
  const files = buildExportFiles(project);
  return createZip(files);
}

function slugify(name) {
  return (name || 'projeto')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'projeto';
}

export async function downloadProjectZip(project) {
  const { blob } = await exportProjectAsZip(project);
  const filename = `${slugify(project.name)}.zip`;
  const url = URL.createObjectURL(blob);
  try {
    if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
