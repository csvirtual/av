// Co-piloto Android — Fase 4: menu hambúrguer mobile.
//
// panel.html tem duas colunas fixas (.sidebar à esquerda com toda a
// navegação — Ajuda, Privacidade, Faturamento, Exportar, Importar,
// Lixeira, Avançado — e .funnel-sidebar à direita, com a contagem de leads
// por estágio) que fazem sentido num monitor largo, mas não cabem numa
// tela de celular. Em vez de reescrever o HTML/CSS de cada uma (arriscado:
// são dezenas de regras espalhadas, escritas pensando em grid de 3
// colunas), este script MOVE (não clona) as duas — elemento físico
// intacto, mesmos listeners, mesmo estado — pra dentro de uma gaveta
// única, deslizando da direita, acionada por um botão de hambúrguer fixo
// no canto superior direito. O CSS que faz a gaveta ficar fora da tela por
// padrão e a largura da .app virar 100% mora em build.js (bloco "Fase 4 —
// layout mobile"), sempre depois do <style> original no <head> — última
// regra do mesmo seletor vence, sem precisar de !important em quase nada.
//
// Por que os elementos criados aqui (hambúrguer, fundo escuro, gaveta)
// entram como filhos de #painelApp, e não direto do <body>: assim herdam
// de graça o display:none/grid que o próprio painel já controla (login,
// logout, bloqueio por inatividade) — sem precisar duplicar essa lógica
// aqui. position:fixed tira os três da grade visualmente, mas continuam
// dentro da árvore do painel, então: (a) somem quando o painel não está
// desbloqueado, exatamente como o resto da tela; (b) são estacionados e
// restaurados automaticamente pelo screen-manager.js (Fase 3) junto com o
// resto do painel ao ir/voltar de Configurações — sem exigir nenhum ajuste
// lá.
(function(){
  'use strict';

  function montar(){
    const painelApp = document.getElementById('painelApp');
    const sidebar = painelApp && painelApp.querySelector('.sidebar');
    const funnelSidebar = painelApp && painelApp.querySelector('.funnel-sidebar');
    if(!painelApp || !sidebar){
      console.error('[hamburger-menu] #painelApp ou .sidebar não encontrado — menu mobile não montado.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'copilotoMenuOverlay';
    overlay.className = 'copiloto-menu-overlay';

    const drawer = document.createElement('div');
    drawer.id = 'copilotoMenuDrawer';
    drawer.className = 'copiloto-menu-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Menu');

    const fecharBtn = document.createElement('button');
    fecharBtn.type = 'button';
    fecharBtn.id = 'copilotoMenuFecharBtn';
    fecharBtn.className = 'copiloto-menu-fechar-btn';
    fecharBtn.setAttribute('aria-label', 'Fechar menu');
    fecharBtn.textContent = '✕';
    drawer.appendChild(fecharBtn);

    // Move (não clona) as duas colunas originais pra dentro da gaveta,
    // sidebar primeiro (navegação), funil depois — mesma ordem de leitura
    // de cima pra baixo que faziam da esquerda pra direita no desktop.
    drawer.appendChild(sidebar);
    if(funnelSidebar) drawer.appendChild(funnelSidebar);

    const hamburgerBtn = document.createElement('button');
    hamburgerBtn.type = 'button';
    hamburgerBtn.id = 'copilotoHamburgerBtn';
    hamburgerBtn.className = 'copiloto-hamburger-btn';
    hamburgerBtn.setAttribute('aria-label', 'Abrir menu');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    hamburgerBtn.textContent = '☰';

    painelApp.appendChild(overlay);
    painelApp.appendChild(drawer);
    painelApp.appendChild(hamburgerBtn);

    function abrir(){
      document.body.classList.add('copiloto-menu-aberto');
      hamburgerBtn.setAttribute('aria-expanded', 'true');
    }
    function fechar(){
      document.body.classList.remove('copiloto-menu-aberto');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
    }

    hamburgerBtn.addEventListener('click', abrir);
    fecharBtn.addEventListener('click', fechar);
    overlay.addEventListener('click', fechar);
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && document.body.classList.contains('copiloto-menu-aberto')) fechar();
    });

    // Tocar em qualquer botão/link DENTRO da gaveta fecha ela sozinha (ex.:
    // abrir "Ajuda" já fecha o menu, em vez de deixar os dois abertos ao
    // mesmo tempo cobrindo a tela toda) — mesmo comportamento de qualquer
    // menu hambúrguer nativo de app mobile. A exceção óbvia é o próprio
    // botão de fechar, mas ele já fecha por conta própria acima; disparar
    // fechar() de novo pra ele não causa problema (é idempotente).
    drawer.addEventListener('click', (e) => {
      if(e.target.closest('button, a')) fechar();
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', montar);
  }else{
    montar();
  }
})();
