// Detecção e cálculo das zonas de encaixe (Snap) do gerenciador de janelas:
// arrastar uma janela até a borda da tela encaixa em metade, quarto ou tela
// cheia — como o Snap do Windows 11.
const EDGE_THRESHOLD = 24;
const CORNER_RATIO = 0.4; // 40% superior/inferior da borda conta como "canto"

function taskbarHeight() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--taskbar-height').trim();
  return parseFloat(value) || 48;
}

/** Retorna a zona de encaixe sob o ponteiro, ou null se não houver nenhuma. */
export function detectZone(clientX, clientY) {
  const width = window.innerWidth;
  const height = window.innerHeight - taskbarHeight();

  if (clientY <= 4) return 'maximize';

  const nearLeft = clientX <= EDGE_THRESHOLD;
  const nearRight = clientX >= width - EDGE_THRESHOLD;
  if (!nearLeft && !nearRight) return null;

  const ratio = clientY / height;
  if (ratio <= CORNER_RATIO) return nearLeft ? 'top-left' : 'top-right';
  if (ratio >= 1 - CORNER_RATIO) return nearLeft ? 'bottom-left' : 'bottom-right';
  return nearLeft ? 'left' : 'right';
}

/** Retorna o retângulo (em px, relativo à área útil) de uma zona de encaixe. */
export function computeZoneRect(zone) {
  const width = window.innerWidth;
  const height = window.innerHeight - taskbarHeight();
  const halfW = width / 2;
  const halfH = height / 2;
  switch (zone) {
    case 'left': return { left: 0, top: 0, width: halfW, height };
    case 'right': return { left: halfW, top: 0, width: halfW, height };
    case 'top-left': return { left: 0, top: 0, width: halfW, height: halfH };
    case 'top-right': return { left: halfW, top: 0, width: halfW, height: halfH };
    case 'bottom-left': return { left: 0, top: halfH, width: halfW, height: halfH };
    case 'bottom-right': return { left: halfW, top: halfH, width: halfW, height: halfH };
    case 'maximize': return { left: 0, top: 0, width, height };
    default: return null;
  }
}

/** A zona "espelhada" usada pelo assistente de encaixe (sugerir preencher o outro lado). */
export function opposingZone(zone) {
  const map = { left: 'right', right: 'left' };
  return map[zone] || null;
}
