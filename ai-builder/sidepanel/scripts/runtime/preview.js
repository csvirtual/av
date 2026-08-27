// Owns the sandboxed <iframe>: builds the srcdoc from the same generator
// used for export, and bridges postMessage both ways (errors/console out,
// design-mode selection/hover/measure/navigate in) — see
// codegen/generator.js for why the app code itself never carries this.
import { generateSite, wrapPreviewDocument } from '../codegen/generator.js';

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

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.source !== 'av-preview' || e.source !== iframeEl.contentWindow) return;
    if (d.type === 'console' || d.type === 'error') onConsole?.(d);
    else if (d.type === 'select') onSelect?.(d.nodeId);
    else if (d.type === 'hover') onHover?.(d.nodeId);
    else if (d.type === 'rect') pendingMeasures.get(d.nodeId)?.(d.rect);
  });

  const pendingMeasures = new Map();

  function render(project) {
    lastSite = generateSite(project);
    ready = false;
    iframeEl.srcdoc = wrapPreviewDocument(lastSite, project.name, EXTRA_SCRIPT);
    iframeEl.addEventListener('load', () => { ready = true; }, { once: true });
  }

  function post(message) {
    iframeEl.contentWindow?.postMessage({ source: 'av-builder', ...message }, '*');
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
