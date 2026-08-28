// Selection/hover overlay drawn over the preview iframe. The iframe itself
// is the only renderer (ARCHITECTURE.md §3) — this module never draws the
// app, only the thin chrome (selection box + label) on top of it, positioned
// from rects the iframe measures and reports via postMessage.
//
// Positions are set via the CSSOM (`el.style.left = ...`), never via an
// inline `style="..."` attribute in an HTML string — the latter is exactly
// what the extension's `style-src 'self'` CSP (no `unsafe-inline`) blocks.
// Individual property assignment through the CSSOM isn't governed by CSP,
// so this keeps the overlay working without loosening the policy.

function applyRect(el, rect) {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

export function createCanvasOverlay(overlayEl) {
  const hoverBox = document.createElement('div');
  hoverBox.className = 'av-hover-box';
  hoverBox.hidden = true;

  const selectionBox = document.createElement('div');
  selectionBox.className = 'av-selection-box';
  selectionBox.hidden = true;
  const selectionLabel = document.createElement('span');
  selectionLabel.className = 'av-selection-box__label';
  selectionBox.appendChild(selectionLabel);

  overlayEl.append(hoverBox, selectionBox);

  function paint({ selectedRect, selectedLabel, hoverRect }) {
    hoverBox.hidden = !hoverRect;
    if (hoverRect) applyRect(hoverBox, hoverRect);

    selectionBox.hidden = !selectedRect;
    if (selectedRect) {
      applyRect(selectionBox, selectedRect);
      selectionLabel.textContent = selectedLabel || '';
    }
  }

  function clear() {
    hoverBox.hidden = true;
    selectionBox.hidden = true;
  }

  return { paint, clear };
}
