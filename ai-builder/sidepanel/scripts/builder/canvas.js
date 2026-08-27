// Selection/hover overlay drawn over the preview iframe. The iframe itself
// is the only renderer (ARCHITECTURE.md §3) — this module never draws the
// app, only the thin chrome (selection box + label) on top of it, positioned
// from rects the iframe measures and reports via postMessage.
import { escapeHtml } from '../codegen/sanitize.js';

export function createCanvasOverlay(overlayEl) {
  function paint({ selectedRect, selectedLabel, hoverRect }) {
    let html = '';
    if (hoverRect) {
      html += `<div class="av-hover-box" style="left:${hoverRect.x}px;top:${hoverRect.y}px;width:${hoverRect.width}px;height:${hoverRect.height}px"></div>`;
    }
    if (selectedRect) {
      html += `<div class="av-selection-box" style="left:${selectedRect.x}px;top:${selectedRect.y}px;width:${selectedRect.width}px;height:${selectedRect.height}px">
        <span class="av-selection-box__label">${escapeHtml(selectedLabel || '')}</span>
      </div>`;
    }
    overlayEl.innerHTML = html;
  }

  function clear() {
    overlayEl.innerHTML = '';
  }

  return { paint, clear };
}
