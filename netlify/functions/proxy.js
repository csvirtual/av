// Proxy reverso para o app Navegador (desktop/apps/browser.js).
//
// Por que existe: navegadores recusam mostrar um site de terceiros dentro de
// um iframe quando o próprio site manda isso via cabeçalho HTTP
// (X-Frame-Options / Content-Security-Policy: frame-ancestors). Isso não dá
// pra contornar do lado do navegador do visitante — é uma decisão do
// servidor de destino, aplicada pelo navegador antes de qualquer JS nosso
// rodar. A única forma real de mostrar esse conteúdo dentro do app é buscar
// a página aqui no servidor (onde esse cabeçalho não tem efeito nenhum) e
// entregar pro navegador do visitante como se fosse conteúdo nosso.
//
// O que este proxy faz:
//   1. Busca a URL pedida.
//   2. Remove os cabeçalhos que bloqueiam a incorporação.
//   3. Se for HTML, injeta <base> (pra CSS/JS/imagens continuarem
//      resolvendo direto no domínio de origem) e reescreve links/forms pra
//      continuar passando por este proxy (senão o clique navegaria o iframe
//      direto pra URL bloqueada de novo).
//
// Limitação real que continua existindo: sites que dependem de sessão/login
// (cookies do domínio original) ou que fazem chamadas de API para caminhos
// absolutos fora do domínio não vão funcionar perfeitamente — isso exigiria
// reescrever também toda chamada fetch/XHR da página, não só a navegação.

const dns = require('dns').promises;
const net = require('net');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 6 * 1024 * 1024;
const PROXY_PATH = '/.netlify/functions/proxy';
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // inclui o metadata endpoint 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = ipv4FromMappedIPv6(v);
    if (mapped) return isPrivateIp(mapped);
    return false;
  }
  return false;
}

// Endereço IPv4 "mapeado" dentro de IPv6 — sem reconhecer isso,
// ::ffff:127.0.0.1 escaparia do bloqueio por não bater com nenhum prefixo
// IPv6 privado acima. O Node normaliza pra dois formatos possíveis
// dependendo de como o valor chegou: "::ffff:a.b.c.d" (dotted) ou
// "::ffff:XXXX:YYYY" (dois grupos hex de 16 bits — é o que a WHATWG URL usa
// quando o host vem de uma URL tipo "http://[::ffff:127.0.0.1]/").
function ipv4FromMappedIPv6(v) {
  let m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  m = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
  }
  return null;
}

// Bloqueia hosts privados/locais pra este proxy não virar uma porta de
// entrada pra rede interna da nuvem onde a função roda. Não é 100% à prova
// de DNS rebinding (o fetch resolve o host de novo depois desta checagem),
// mas cobre o caso real: alguém digitando localhost/IP interno/endpoint de
// metadados na barra de endereço.
async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Apenas endereços http/https são permitidos.');
  // Pra um literal IPv6 na URL (http://[::1]/), a própria WHATWG URL mantém
  // os colchetes dentro de u.hostname ("[::1]") — sem removê-los aqui,
  // net.isIP/isIPv6 nunca reconhecem o valor como IP nenhum e a checagem de
  // IP privado abaixo nunca roda de verdade (o bloqueio "funcionava" só de
  // efeito colateral, porque o dns.lookup barra um hostname com colchetes).
  const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error('Este endereço não pode ser acessado.');
  // Bloqueia formas alternativas de escrever um IPv4 (inteiro decimal puro
  // como "2130706433", ou hexadecimal como "0x7f000001") que alguns
  // resolvedores de sistema ainda aceitam por baixo dos panos — sem isso,
  // dns.lookup poderia devolver um IP interno pra um hostname desse formato
  // sem passar pelo bloqueio de IP literal logo abaixo.
  if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname)) {
    throw new Error('Este endereço não pode ser acessado.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Este endereço não pode ser acessado.');
    return u;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('Não foi possível resolver este endereço.');
  }
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error('Este endereço não pode ser acessado.');
  return u;
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}

function resolveAndProxy(raw, baseHref) {
  const trimmed = (raw || '').trim();
  if (!trimmed || /^(javascript:|mailto:|tel:|data:|#)/i.test(trimmed)) return raw;
  let abs;
  try {
    abs = new URL(trimmed, baseHref).href;
  } catch {
    return raw;
  }
  return `${PROXY_PATH}?url=${encodeURIComponent(abs)}`;
}

// Reescreve só o suficiente pra funcionar dentro do proxy: mantém <base>
// apontando pro site real (assim CSS/JS/imagens/XHR relativos continuam
// carregando do lugar certo, sem passar por aqui) e redireciona links/forms
// de volta pro proxy, senão a próxima navegação escaparia do app e cairia de
// novo no bloqueio original.
function rewriteHtml(html, baseHref) {
  let out = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

  out = out.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, url) => `${pre}${q}${resolveAndProxy(url, baseHref)}${q}`);
  out = out.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, url) => `${pre}${q}${resolveAndProxy(url, baseHref)}${q}`);

  const baseTag = `<base href="${escapeAttr(baseHref)}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}</head>`);
  } else {
    out = `${baseTag}${out}`;
  }
  return out;
}

// Injetado em toda resposta (páginas reais e nossas próprias páginas de
// erro): o app embute o conteúdo proxiado num iframe sandboxed SEM
// allow-same-origin (ver desktop/apps/browser.js), então o app não consegue
// mais ler contentDocument direto — esse scriptzinho manda o título e se é
// uma página de erro nossa via postMessage, que funciona através de
// fronteiras de origem mesmo com o sandbox (é pra isso que postMessage
// existe). Não manda nada sensível, só título e um booleano.
const REPORTER_SCRIPT = `<script>(function(){
function report(){try{window.parent.postMessage({source:'app-browser-proxy',proxyError:document.documentElement.getAttribute('data-proxy-error')==='1',title:document.title||''},'*');}catch(e){}}
report();
document.addEventListener('DOMContentLoaded',report);
window.addEventListener('load',report);
var t=document.querySelector('title');
if(t){try{new MutationObserver(report).observe(t,{childList:true,characterData:true,subtree:true});}catch(e){}}
document.addEventListener('visibilitychange',report);
})();</script>`;

function injectReporter(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${REPORTER_SCRIPT}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${REPORTER_SCRIPT}</head>`);
  return `${REPORTER_SCRIPT}${html}`;
}

function errorResponse(message) {
  const body = `<!DOCTYPE html><html data-proxy-error="1"><head><meta charset="utf-8">${REPORTER_SCRIPT}</head><body style="font:14px sans-serif;padding:2rem;color:#444">${escapeHtml(message)}</body></html>`;
  return {
    statusCode: 502,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

exports.handler = async (event) => {
  const target = event.queryStringParameters && event.queryStringParameters.url;
  if (!target) return errorResponse('Parâmetro "url" ausente.');

  let parsedUrl;
  try {
    parsedUrl = await assertSafeUrl(target);
  } catch (err) {
    return errorResponse(err.message);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(parsedUrl.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': (event.headers && event.headers['user-agent']) || 'Mozilla/5.0',
        'Accept-Language': (event.headers && event.headers['accept-language']) || 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });
  } catch (err) {
    return errorResponse(err.name === 'AbortError' ? 'O site demorou demais para responder.' : 'Não foi possível carregar este site.');
  } finally {
    clearTimeout(timer);
  }

  try {
    await assertSafeUrl(upstream.url);
  } catch {
    return errorResponse('O site redirecionou para um endereço bloqueado.');
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const arrayBuf = await upstream.arrayBuffer();
  if (arrayBuf.byteLength > MAX_BYTES) return errorResponse('Página grande demais para exibir aqui.');
  const buf = Buffer.from(arrayBuf);

  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  if (contentType.includes('text/html')) {
    return {
      statusCode: upstream.status,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      body: injectReporter(rewriteHtml(buf.toString('utf-8'), upstream.url)),
    };
  }

  return {
    statusCode: upstream.status,
    headers: { ...headers, 'Content-Type': contentType },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
