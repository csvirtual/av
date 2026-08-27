// Component tree -> {html, css, js}. Deterministic and pure: same tree in,
// same code out, every time — this is what makes preview and export "the
// same generation" (ARCHITECTURE.md §16) instead of two code paths that can
// drift apart.
import { getComponent } from '../components/registry.js';
import { styleToInlineCss, escapeAttr } from './sanitize.js';
import { resolveTokens, tokensToCss } from '../design/tokens.js';

function buildAttrs(node) {
  const style = styleToInlineCss(node.style);
  return `data-av-id="${escapeAttr(node.id)}" data-av-type="${escapeAttr(node.type)}"${style ? ` style="${style}"` : ''}`;
}

/** Renders one tree, collecting per-type css/js into the maps passed in (dedup by type). */
export function renderTree(tree, cssMap = new Map(), jsMap = new Map()) {
  function walk(node) {
    const def = getComponent(node.type);
    const childrenHtml = (node.children || []).map(walk).join('');
    const { html, css, js } = def.render(node, childrenHtml, { attrs: buildAttrs(node) });
    if (css && !cssMap.has(node.type)) cssMap.set(node.type, css);
    if (js && !jsMap.has(node.type)) jsMap.set(node.type, js);
    return html;
  }
  return { html: walk(tree), cssMap, jsMap };
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box;}
body{margin:0;font-family:var(--av-font-family);font-size:var(--av-font-md);color:var(--av-color-text);background:var(--av-color-background);line-height:1.5;}
.av-page[hidden]{display:none;}
img{max-width:100%;display:block;}
:focus-visible{outline:2px solid var(--av-color-info);outline-offset:2px;}`;

const RUNTIME_JS = `window.AV=window.AV||{};AV.init=AV.init||{};
AV.store=(function(){
  var mem={};
  function hasLocalStorage(){try{var k='__av_t';localStorage.setItem(k,'1');localStorage.removeItem(k);return true;}catch(e){return false;}}
  var useLS=hasLocalStorage();
  function key(entity){return 'av_data_'+entity;}
  function read(entity){if(useLS){try{return JSON.parse(localStorage.getItem(key(entity))||'[]');}catch(e){return [];}}return mem[entity]||[];}
  function write(entity,rows){if(useLS){localStorage.setItem(key(entity),JSON.stringify(rows));}else{mem[entity]=rows;}}
  return {
    list:function(entity){return read(entity);},
    seedIfEmpty:function(entity,rows){if(read(entity).length===0)write(entity,rows);},
    create:function(entity,row){var rows=read(entity);row.id=row.id||('r_'+Math.random().toString(36).slice(2,10));rows.push(row);write(entity,rows);return row;},
    update:function(entity,id,patch){var rows=read(entity).map(function(r){return r.id===id?Object.assign({},r,patch):r;});write(entity,rows);},
    remove:function(entity,id){write(entity,read(entity).filter(function(r){return r.id!==id;}));},
  };
})();
AV.toast=function(message,variant){
  var host=document.getElementById('av-toast-host');
  if(!host){host=document.createElement('div');host.id='av-toast-host';host.style.cssText='position:fixed;inset-block-end:1rem;inset-inline-end:1rem;display:flex;flex-direction:column;gap:8px;z-index:9999;';document.body.appendChild(host);}
  var el=document.createElement('div');
  el.textContent=message;
  el.style.cssText='padding:10px 16px;border-radius:8px;color:#fff;font:14px var(--av-font-family, sans-serif);box-shadow:0 4px 16px rgba(0,0,0,.2);background:'+(variant==='danger'?'#c73434':variant==='success'?'#1f8a53':'#212c50')+';';
  host.appendChild(el);
  setTimeout(function(){el.remove();},3200);
};
AV.router=(function(){
  var pages=Array.prototype.slice.call(document.querySelectorAll('.av-page'));
  function show(route){
    var target=pages.find(function(p){return p.dataset.avPage===route;})||pages[0];
    pages.forEach(function(p){p.hidden=(p!==target);});
    if(target){document.title=target.dataset.avPageTitle||document.title;}
  }
  function current(){return (location.hash||'').replace(/^#/,'')||(pages[0]&&pages[0].dataset.avPage)||'/';}
  window.addEventListener('hashchange',function(){show(current());});
  return {init:function(){show(current());}};
})();
if(window.parent!==window){
  window.addEventListener('error',function(e){window.parent.postMessage({source:'av-preview',type:'error',message:e.message,filename:e.filename,lineno:e.lineno},'*');});
  window.addEventListener('unhandledrejection',function(e){window.parent.postMessage({source:'av-preview',type:'error',message:'Promise rejeitada: '+(e.reason&&e.reason.message||e.reason)},'*');});
  ['log','warn','error','info'].forEach(function(level){
    var orig=console[level];
    console[level]=function(){window.parent.postMessage({source:'av-preview',type:'console',level:level,args:Array.prototype.slice.call(arguments).map(String)},'*');orig.apply(console,arguments);};
  });
}`;

const BOOTSTRAP_JS = `document.addEventListener('DOMContentLoaded',function(){
  AV.router.init();
  document.querySelectorAll('[data-av-type]').forEach(function(el){
    var fn=AV.init[el.dataset.avType];
    if(fn){try{fn(el);}catch(err){console.error('Falha ao inicializar '+el.dataset.avType+': '+err.message);}}
  });
});`;

/**
 * Builds the whole site (all pages, one router) as {html, css, js}.
 * `html` is only the page sections — the caller wraps it in a full document
 * (preview) or writes it into index.html (export) so both paths share this
 * exact output.
 */
function safeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function generateSite(project) {
  const cssMap = new Map();
  const jsMap = new Map();
  const pagesHtml = project.pages
    .map((page) => {
      const { html } = renderTree(page.tree, cssMap, jsMap);
      return `<section class="av-page" data-av-page="${escapeAttr(page.route)}" data-av-page-title="${escapeAttr(`${page.name} · ${project.name}`)}" hidden>\n${html}\n</section>`;
    })
    .join('\n');

  const tokens = resolveTokens(project.theme);
  const css = [tokensToCss(tokens), BASE_CSS, ...cssMap.values()].join('\n\n');

  const seedJs = Object.entries(project.seedData || {})
    .map(([entity, rows]) => `AV.store.seedIfEmpty(${safeInlineJson(entity)}, ${safeInlineJson(rows)});`)
    .join('\n');

  const js = [RUNTIME_JS, seedJs, ...jsMap.values(), BOOTSTRAP_JS].join('\n\n');
  return { html: pagesHtml, css, js };
}

/**
 * Single-file HTML for the sandboxed preview iframe (srcdoc needs one
 * string). `extraScript`, when given, is design-tooling instrumentation
 * (click-to-select, hover highlight — see runtime/preview.js) appended AFTER
 * the real app script. It is never part of `js` itself and never ships in
 * export/exporter.js, so what gets exported is exactly the app, nothing the
 * builder added on top.
 */
export function wrapPreviewDocument({ html, css, js }, title, extraScript = '') {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeAttr(title)}</title>
<style>${css}</style>
</head>
<body>
${html}
<script>${js}<\/script>
${extraScript ? `<script>${extraScript}<\/script>` : ''}
</body>
</html>`;
}
