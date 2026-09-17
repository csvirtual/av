// Leitura de código de barras.
//
// Um leitor USB físico funciona como um teclado: ele "digita" os dígitos do
// código muito rápido e manda Enter no final. Não precisa de nenhuma lib ou
// permissão de câmera — só precisamos de um campo de texto focado e ouvir o
// Enter. É isso que bindBarcodeInput faz.
//
// installGlobalScannerListener é um reforço para telas como o PDV, onde o
// foco pode escapar do campo de busca (ex.: usuário clicou em outro lugar):
// ele detecta uma rajada de teclas rápida (típica de scanner, não de
// digitação humana) terminando em Enter, em qualquer lugar da página.
export function bindBarcodeInput(inputEl, onScan) {
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = inputEl.value.trim();
      if (value) {
        onScan(value);
      }
      inputEl.value = '';
      e.preventDefault();
    }
  });
}

// Folga generosa acima do que qualquer leitor USB real leva pra "digitar"
// um código inteiro (a grande maioria emite cada tecla em poucos
// milissegundos) — cobre até leitores mais lentos/baratos sem deixar de
// distinguir de digitação humana sustentada, que raramente mantém menos de
// 60ms entre teclas por um código inteiro de 8 a 13 dígitos.
const SCAN_GAP_MS = 60;
const MIN_SCAN_LENGTH = 4;

export function installGlobalScannerListener(onScan) {
  let buffer = '';
  let lastKeyTime = 0;

  function handler(e) {
    // Não interfere quando o usuário está digitando/selecionando num campo
    // focado (input, textarea ou select — esse campo já deve ter seu
    // próprio bindBarcodeInput se precisar) nem quando algum modal está
    // aberto — não faz sentido um scan em segundo plano adicionar item ao
    // carrinho por trás de um diálogo que está bloqueando a tela.
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.modal-backdrop')) return;

    const now = Date.now();
    if (now - lastKeyTime > SCAN_GAP_MS) {
      buffer = '';
    }
    lastKeyTime = now;

    if (e.key === 'Enter') {
      if (buffer.length >= MIN_SCAN_LENGTH) {
        onScan(buffer);
      }
      buffer = '';
      return;
    }
    if (e.key.length === 1) {
      buffer += e.key;
    }
  }

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/** Gera um código interno para produtos sem código de barras de fábrica
 * (granel, itens sem embalagem padrão etc.). Prefixo "INT" garante que
 * nunca colida visualmente com um EAN de fábrica (só números). */
export function generateInternalBarcode() {
  const time36 = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `INT${time36}${rand}`;
}
