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
// única, deslizando da direita.
//
// O botão que abre essa gaveta mora dentro de uma barra de topo própria
// (#copilotoTopoMobile) — não é um botão flutuando isolado por cima de
// qualquer conteúdo que esteja embaixo dele (isso ficava com cara de
// remendo: cobria banners, título, o que estivesse ali). A barra entra no
// fluxo normal do grid (não é position:fixed), então empurra o resto do
// conteúdo pra baixo em vez de sobrepor. Ela também reaproveita a própria
// marca (.brand — "C&S Assistência Virtual", mesmo elemento, mesmo clique
// de "voltar ao início"), movida de dentro da .sidebar pra virar o lado
// esquerdo dessa barra. O CSS de tudo isso mora em build.js (bloco "Fase 4
// — layout mobile"), sempre depois do <style> original no <head> — última
// regra do mesmo seletor vence, sem precisar de !important em quase nada.
//
// Por que os elementos criados aqui (barra de topo, fundo escuro, gaveta)
// entram como filhos de #painelApp, e não direto do <body>: assim herdam
// de graça o display:none/grid que o próprio painel já controla (login,
// logout, bloqueio por inatividade) — sem precisar duplicar essa lógica
// aqui. Overlay e gaveta usam position:fixed (saem da grade visualmente),
// mas continuam dentro da árvore do painel, então: (a) somem quando o
// painel não está desbloqueado, exatamente como o resto da tela; (b) são
// estacionados e restaurados automaticamente pelo screen-manager.js (Fase
// 3) junto com o resto do painel ao ir/voltar de Configurações — sem
// exigir nenhum ajuste lá.
(function(){
  'use strict';

  function montar(){
    const painelApp = document.getElementById('painelApp');
    const sidebar = painelApp && painelApp.querySelector('.sidebar');
    const funnelSidebar = painelApp && painelApp.querySelector('.funnel-sidebar');
    const brand = sidebar && sidebar.querySelector('.brand');
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

    // Barra de topo fixa (fica no fluxo normal do grid — não sobrepõe
    // conteúdo, empurra o resto pra baixo): a marca (movida da .sidebar,
    // mesmo elemento, mesmo clique de "voltar ao início") à esquerda, o
    // hambúrguer à direita, dentro de um cartão branco arredondado — em
    // vez do botão flutuando solto por cima de qualquer conteúdo que
    // esteja embaixo dele.
    const topo = document.createElement('div');
    topo.id = 'copilotoTopoMobile';
    topo.className = 'copiloto-topo-mobile';
    if(brand) topo.appendChild(brand);
    const hamburgerWrap = document.createElement('div');
    hamburgerWrap.className = 'copiloto-hamburger-wrap';
    hamburgerWrap.appendChild(hamburgerBtn);
    topo.appendChild(hamburgerWrap);

    painelApp.insertBefore(topo, painelApp.firstChild);
    painelApp.appendChild(overlay);
    painelApp.appendChild(drawer);

    // A gaveta precisa começar exatamente onde a faixa de topo termina
    // (nunca por cima dela) e ocupar o resto da tela inteira, da direita
    // pra esquerda — não um valor de altura chutado no CSS: a fonte
    // carregando depois, ou o notch/status bar do aparelho, mudam a altura
    // de verdade da faixa. Mede o elemento real e publica como variável
    // CSS (--copiloto-topo-altura, usada em mobile.css).
    //
    // A medição NÃO pode rodar só uma vez aqui no montar() — nesse momento
    // #painelApp ainda está com display:none (ninguém logou ainda), e todo
    // elemento dentro de um ancestral display:none mede 0 de altura,
    // sempre (é assim que o layout do navegador funciona, não é bug de
    // timing). Por isso mede de novo bem na hora de abrir a gaveta —
    // nesse momento #painelApp com certeza já está visível, porque a
    // própria pessoa acabou de tocar num botão que só aparece visível
    // depois do login.
    function medirAlturaDoTopo(){
      document.documentElement.style.setProperty('--copiloto-topo-altura', topo.getBoundingClientRect().height + 'px');
    }
    window.addEventListener('resize', medirAlturaDoTopo);
    window.addEventListener('orientationchange', () => setTimeout(medirAlturaDoTopo, 200));

    function abrir(){
      medirAlturaDoTopo();
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
