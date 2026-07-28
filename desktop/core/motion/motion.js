// Utilitário central de animação. Usa a Web Animations API (composta
// direto no compositor, evitando reflow/repaint) e as curvas/durações
// definidas nos design tokens (styles/tokens.css) para que toda a
// aplicação se mova de forma consistente, lembrando o "Fluent Motion".
const styles = getComputedStyle(document.documentElement);

function token(name, fallback) {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export const DURATION = {
  fast: parseFloat(token('--duration-fast', '120')),
  normal: parseFloat(token('--duration-normal', '200')),
  slow: parseFloat(token('--duration-slow', '320')),
};

export const EASE = {
  standard: token('--ease-standard', 'cubic-bezier(0.4, 0, 0.2, 1)'),
  decelerate: token('--ease-decelerate', 'cubic-bezier(0.1, 0.9, 0.2, 1)'),
  accelerate: token('--ease-accelerate', 'cubic-bezier(0.7, 0, 1, 0.5)'),
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function run(el, keyframes, options) {
  if (!el || !el.animate) return Promise.resolve();
  if (prefersReducedMotion.matches) {
    Object.assign(el.style, keyframes[keyframes.length - 1]);
    return Promise.resolve();
  }
  const anim = el.animate(keyframes, { duration: DURATION.normal, easing: EASE.standard, fill: 'forwards', ...options });
  return anim.finished.catch(() => {});
}

/** Entrada de janela: aparece com leve escala e fade, como o Windows 11. */
export function windowOpen(el) {
  return run(
    el,
    [
      { opacity: 0, transform: 'scale(0.96) translateY(6px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' },
    ],
    { duration: DURATION.normal, easing: EASE.decelerate }
  );
}

/** Saída de janela ao fechar. Resolve quando a animação termina, para então remover do DOM. */
export function windowClose(el) {
  return run(
    el,
    [
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0, transform: 'scale(0.96) translateY(6px)' },
    ],
    { duration: DURATION.fast, easing: EASE.accelerate }
  );
}

/** Minimizar: encolhe em direção à barra de tarefas. */
export function windowMinimize(el) {
  return run(
    el,
    [
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0, transform: 'scale(0.85) translateY(40px)' },
    ],
    { duration: DURATION.fast, easing: EASE.accelerate }
  );
}

/** Restaurar a partir da barra de tarefas. */
export function windowRestore(el) {
  return run(
    el,
    [
      { opacity: 0, transform: 'scale(0.85) translateY(40px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' },
    ],
    { duration: DURATION.normal, easing: EASE.decelerate }
  );
}

/** Abertura de painéis flutuantes (menu iniciar, menus de contexto, popups). */
export function panelOpen(el) {
  return run(
    el,
    [
      { opacity: 0, transform: 'scale(0.98) translateY(8px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' },
    ],
    { duration: DURATION.fast, easing: EASE.decelerate }
  );
}

/** Fechamento de painéis flutuantes. */
export function panelClose(el) {
  return run(
    el,
    [
      { opacity: 1, transform: 'scale(1) translateY(0)' },
      { opacity: 0, transform: 'scale(0.98) translateY(8px)' },
    ],
    { duration: DURATION.fast, easing: EASE.accelerate }
  );
}

/** Fade genérico (telas de bloqueio, sobreposições). */
export function fadeIn(el, duration = DURATION.normal) {
  return run(el, [{ opacity: 0 }, { opacity: 1 }], { duration, easing: EASE.standard });
}
export function fadeOut(el, duration = DURATION.normal) {
  return run(el, [{ opacity: 1 }, { opacity: 0 }], { duration, easing: EASE.standard });
}
