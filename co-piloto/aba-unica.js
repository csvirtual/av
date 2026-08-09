// --- Trava de aba duplicada (compartilhada por panel.html e options.html) ---
//
// Precisa ser o PRIMEIRO script de cada página. Pergunta pro background.js
// (copilotoRegistrarOuChecarAba) se esta aba é a mesma que o botão da
// extensão abre/foca — se não for (porque foi duplicada, restaurada do
// histórico, ou aberta colando a URL enquanto outra cópia já estava
// aberta), trava a tela aqui mesmo, antes de qualquer dado ser carregado ou
// decifrado. Isso também fecha, de quebra, a pequena janela de corrida
// entre abas na criação da chave de um perfil (ver
// copilotoDesbloquearPerfilComSenha em perfis.js): com esta trava, nunca
// existem duas abas ativas ao mesmo tempo pra correr.
//
// As duas páginas usam chaves SEPARADAS no background (ver PANEL_TAB_KEY e
// OPTIONS_TAB_KEY lá) — por isso a página se identifica abaixo. Options.html
// é alcançado por navegação NA MESMA aba a partir de panel.html
// (window.location.href), então o id da aba não muda; a mesma checagem
// cobre o caso de alguém duplicar a aba com as Configurações abertas.
//
// Este arquivo existe porque panel.js e options.js carregavam, cada um, uma
// cópia literal deste bloco — inclusive o HTML da tela de aviso. Duas
// cópias da mesma trava de segurança é o tipo de coisa que se corrige numa
// e se esquece na outra.
let copilotoAbaDuplicada = false;
const copilotoChecagemAbaDuplicada = (async () => {
  const pagina = location.pathname.endsWith('options.html') ? 'options' : 'painel';
  try {
    const resposta = await chrome.runtime.sendMessage({ tipo: 'copilotoRegistrarAbaPainel', pagina });
    copilotoAbaDuplicada = !!(resposta && resposta.ehAbaOficial === false);
  } catch (e) {
    copilotoAbaDuplicada = false; // falha de comunicação não deve travar quem tem uso legítimo
  }
  if (copilotoAbaDuplicada) {
    document.body.innerHTML = `
      <div style="position:fixed; inset:0; z-index:99999; background:var(--ink,#132420); color:#fff;
                  display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;
                  font-family:'Manrope', sans-serif;">
        <div style="max-width:420px;">
          <div style="font-size:38px; margin-bottom:14px;">🔒</div>
          <h2 style="margin:0 0 10px; font-size:20px;">Esta aba é uma cópia</h2>
          <p style="margin:0; opacity:.85; line-height:1.55; font-size:14.5px;">
            O Co-piloto já está aberto em outra aba. Feche esta aba e continue na aba original —
            assim seus dados ficam sempre em um só lugar, sem risco de conflito.
          </p>
        </div>
      </div>`;
  }
})();
