// Calculadora: aritmética básica real (não decorativa), com suporte a
// teclado físico quando a janela está em foco.
function formatNumber(value) {
  if (!isFinite(value)) return 'Erro';
  const str = value.toString();
  if (str.length > 14) return value.toPrecision(10).replace(/\.?0+$/, '').replace(/\.?0+e/, 'e');
  return str;
}

export function openCalculator(ctx) {
  const { windows } = ctx;

  const root = document.createElement('div');
  root.className = 'calculator';
  root.innerHTML = `
    <div class="calc-display" data-role="display">0</div>
    <div class="calc-grid">
      <button data-action="clear" class="calc-fn">C</button>
      <button data-action="sign" class="calc-fn">±</button>
      <button data-action="percent" class="calc-fn">%</button>
      <button data-op="/" class="calc-op">÷</button>

      <button data-digit="7">7</button>
      <button data-digit="8">8</button>
      <button data-digit="9">9</button>
      <button data-op="*" class="calc-op">×</button>

      <button data-digit="4">4</button>
      <button data-digit="5">5</button>
      <button data-digit="6">6</button>
      <button data-op="-" class="calc-op">−</button>

      <button data-digit="1">1</button>
      <button data-digit="2">2</button>
      <button data-digit="3">3</button>
      <button data-op="+" class="calc-op">+</button>

      <button data-digit="0" class="calc-zero">0</button>
      <button data-action="decimal">,</button>
      <button data-action="backspace">⌫</button>
      <button data-action="equals" class="calc-eq">=</button>
    </div>
  `;

  const win = windows.createWindow({
    appId: 'calculator',
    title: 'Calculadora',
    icon: '🧮',
    width: 300,
    height: 440,
    content: root,
  });
  win.el.classList.add('calculator-window');

  const display = root.querySelector('[data-role="display"]');
  let current = '0';
  let previous = null;
  let operator = null;
  let overwrite = true;

  function render() {
    display.textContent = current.replace('.', ',');
  }

  function inputDigit(d) {
    if (overwrite) {
      current = d === ',' ? '0,' : d;
      overwrite = false;
    } else if (current.length < 14) {
      current += d;
    }
    render();
  }

  function inputDecimal() {
    if (overwrite) {
      current = '0.';
      overwrite = false;
    } else if (!current.includes('.')) {
      current += '.';
    }
    render();
  }

  function clearAll() {
    current = '0';
    previous = null;
    operator = null;
    overwrite = true;
    render();
  }

  function backspace() {
    if (overwrite) return;
    current = current.slice(0, -1) || '0';
    if (current === '-' || current === '') current = '0';
    render();
  }

  function toggleSign() {
    if (current === '0') return;
    current = current.startsWith('-') ? current.slice(1) : `-${current}`;
    render();
  }

  function applyPercent() {
    current = String(parseFloat(current) / 100);
    render();
  }

  function compute(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
      default: return b;
    }
  }

  function chooseOperator(op) {
    if (operator && !overwrite) {
      equals();
      previous = parseFloat(current);
    } else {
      previous = parseFloat(current);
    }
    operator = op;
    overwrite = true;
  }

  function equals() {
    if (operator == null || previous == null) return;
    const result = compute(previous, parseFloat(current), operator);
    current = formatNumber(result);
    previous = null;
    operator = null;
    overwrite = true;
    render();
  }

  root.querySelectorAll('[data-digit]').forEach((btn) => {
    btn.addEventListener('click', () => inputDigit(btn.dataset.digit));
  });
  root.querySelectorAll('[data-op]').forEach((btn) => {
    btn.addEventListener('click', () => chooseOperator(btn.dataset.op));
  });
  root.querySelector('[data-action="clear"]').addEventListener('click', clearAll);
  root.querySelector('[data-action="backspace"]').addEventListener('click', backspace);
  root.querySelector('[data-action="sign"]').addEventListener('click', toggleSign);
  root.querySelector('[data-action="percent"]').addEventListener('click', applyPercent);
  root.querySelector('[data-action="decimal"]').addEventListener('click', inputDecimal);
  root.querySelector('[data-action="equals"]').addEventListener('click', equals);

  function onKeydown(e) {
    if (!win.el.classList.contains('focused')) return;
    if (e.key >= '0' && e.key <= '9') inputDigit(e.key);
    else if (e.key === '.' || e.key === ',') inputDecimal();
    else if (['+', '-', '*', '/'].includes(e.key)) chooseOperator(e.key);
    else if (e.key === 'Enter' || e.key === '=') equals();
    else if (e.key === 'Backspace') backspace();
    else if (e.key === 'Escape') clearAll();
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKeydown);
  win.onClose(() => window.removeEventListener('keydown', onKeydown));

  render();
  return win;
}
