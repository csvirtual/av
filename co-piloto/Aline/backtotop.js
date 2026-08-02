// Botão flutuante "voltar ao topo" — aparece em qualquer página (painel ou configurações)
// assim que a pessoa rolar a tela pra baixo, e some quando não há como rolar mais pra cima.
(function () {
  function init() {
    const btn = document.createElement('button');
    btn.id = 'backToTopBtn';
    btn.className = 'back-to-top';
    btn.type = 'button';
    btn.title = 'Voltar ao topo';
    btn.setAttribute('aria-label', 'Voltar ao topo');
    btn.innerHTML = '↑';
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    function onScroll() {
      if (window.scrollY > 260) {
        btn.classList.add('show');
      } else {
        btn.classList.remove('show');
      }
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
