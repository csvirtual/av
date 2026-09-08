// Botão flutuante "voltar ao topo" — aparece em qualquer página (painel ou configurações)
// assim que a pessoa rolar a tela pra baixo, e some quando não há como rolar mais pra cima.
//
// O botão do chat (C&S - BOT, ver chatbot.js/panel.html) fica ao lado dele e
// segue exatamente o mesmo gatilho de scroll — os dois só aparecem quando a
// página é rolada pra baixo, e ambos ficam fixos (position:fixed) no canto
// inferior direito enquanto visíveis.
(function () {
  function init() {
    const btn = document.createElement('button');
    btn.id = 'backToTopBtn';
    btn.className = 'back-to-top';
    btn.type = 'button';
    btn.title = 'Voltar ao topo';
    btn.setAttribute('aria-label', 'Voltar ao topo');
    // SVG inline, não o caractere "↑": um glifo de texto herda a fonte do
    // sistema, então o contorno/espessura (feito antes via
    // -webkit-text-stroke) nunca ficava exatamente igual em telas/SOs
    // diferentes. Como um desenho vetorial próprio, sai sempre idêntico —
    // mesmo par preenchimento branco / contorno preto do ícone do chat (ver
    // #chatFloatBtn em panel.html).
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
      + '<path d="M12 4 L19 12 L14.5 12 L14.5 20 L9.5 20 L9.5 12 L5 12 Z" fill="#fff" stroke="#140828" stroke-width="1.3" stroke-linejoin="round"/>'
      + '</svg>';
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    // Botão do chat já existe no HTML (panel.html) — só reaproveita aqui
    // pra alternar a mesma classe .show no mesmo scroll, se ele existir
    // nesta página (algumas páginas, como options.html, não têm chat).
    const chatBtn = document.getElementById('chatFloatBtn');

    function onScroll() {
      const rolou = window.scrollY > 260;
      btn.classList.toggle('show', rolou);
      if (chatBtn) chatBtn.classList.toggle('show', rolou);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
