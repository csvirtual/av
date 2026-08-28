// Owns the sandboxed <iframe>: points it at preview-shell.html (a page the
// manifest declares under `sandbox.pages`, so it alone gets a CSP that
// allows the inline <script>/<style> a generated app needs — see
// preview-shell.js for why that's safe) and posts the generated site to it,
// and bridges postMessage both ways (errors/console out, design-mode
// selection/hover/measure/navigate in). codegen/generator.js is why the app
// code itself never carries the design-mode instrumentation below.
import { generateSite } from '../codegen/generator.js';

const SHELL_URL = 'preview-shell.html';

const EXTRA_SCRIPT = `(function(){
  var designMode = true;
  function elFor(id){ try { return document.querySelector('[data-av-id="'+CSS.escape(id)+'"]'); } catch(e){ return null; } }
  document.addEventListener('click', function(e){
    if (!designMode) return;
    var el = e.target.closest('[data-av-id]');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    window.parent.postMessage({source:'av-preview', type:'select', nodeId: el.dataset.avId}, '*');
  }, true);
  document.addEventListener('mouseover', function(e){
    if (!designMode) return;
    var el = e.target.closest('[data-av-id]');
    if (el) window.parent.postMessage({source:'av-preview', type:'hover', nodeId: el.dataset.avId}, '*');
  }, true);
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.source !== 'av-builder') return;
    if (d.type === 'set-design-mode') designMode = !!d.value;
    if (d.type === 'navigate') location.hash = d.route;
    if (d.type === 'measure') {
      var el = elFor(d.nodeId);
      if (el) {
        var r = el.getBoundingClientRect();
        window.parent.postMessage({source:'av-preview', type:'rect', nodeId:d.nodeId, rect:{x:r.x,y:r.y,width:r.width,height:r.height}}, '*');
      } else {
        window.parent.postMessage({source:'av-preview', type:'rect', nodeId:d.nodeId, rect:null}, '*');
      }
    }
  });
})();`;

export function createPreview(iframeEl, { onConsole, onSelect, onHover } = {}) {
  let lastSite = null;
  let ready = false;
  let pendingPayload = null;
  const pendingMeasures = new Map();

  function post(message) {
    iframeEl.contentWindow?.postMessage({ source: 'av-builder', ...message }, '*');
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || e.source !== iframeEl.contentWindow) return;
    if (d.source === 'av-preview-shell' && d.type === 'ready') {
      ready = true;
      if (pendingPayload) {
        post(pendingPayload);
        pendingPayload = null;
      }
      return;
    }
    if (d.source !== 'av-preview') return;
    if (d.type === 'console' || d.type === 'error') onConsole?.(d);
    else if (d.type === 'select') onSelect?.(d.nodeId);
    else if (d.type === 'hover') onHover?.(d.nodeId);
    else if (d.type === 'rect') pendingMeasures.get(d.nodeId)?.(d.rect);
  });

  function render(project) {
    lastSite = generateSite(project);
    ready = false;
    pendingPayload = { type: 'load', title: project.name, html: lastSite.html, css: lastSite.css, js: lastSite.js, extraScript: EXTRA_SCRIPT };
    // Always a fresh navigation (cache-busted), never a reused live
    // instance: the generated app's own script re-registers global
    // listeners (AV.router's hashchange, wrapped console.*) on every render,
    // which would pile up duplicates if the same shell document survived
    // across edits instead of starting from a clean global scope each time.
    iframeEl.src = `${SHELL_URL}?r=${Date.now().toString(36)}`;
  }

  function navigate(route) {
    post({ type: 'navigate', route });
  }

  function measure(nodeId) {
    return new Promise((resolve) => {
      pendingMeasures.set(nodeId, (rect) => {
        pendingMeasures.delete(nodeId);
        resolve(rect);
      });
      post({ type: 'measure', nodeId });
      setTimeout(() => {
        if (pendingMeasures.has(nodeId)) {
          pendingMeasures.delete(nodeId);
          resolve(null);
        }
      }, 400);
    });
  }

  return { render, navigate, measure, getLastSite: () => lastSite, isReady: () => ready };
}
