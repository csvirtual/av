#!/usr/bin/env node
// Co-piloto Android — build.js
//
// Monta o pacote final (dist/) juntando panel.html + options.html + os
// adaptadores das Fases 1-4 (storage-adapter.js, runtime-adapter.js,
// screen-manager.js, hamburger-menu.js, mobile.css) + o manifesto/service
// worker de PWA, lendo os arquivos de negócio direto de ../co-piloto —
// NUNCA uma cópia hand-made: toda vez que o Co-piloto "de verdade" mudar,
// rodar este script de novo já traz a mudança pro Android, sem precisar
// lembrar de replicar nada à mão. Nenhum arquivo de ../co-piloto é escrito
// por este script.
//
// O que este script muda no texto original (só isso, nada de lógica):
//   1. Remove as tags <script src="..."> dos dois HTMLs (os arquivos
//      entram todos inline, uma vez só, na ordem certa lá embaixo).
//   2. Escopa o <style> de options.html em `@scope (#configApp)`, pra não
//      colidir com classes genéricas que panel.html também usa (ex.: .app).
//   3. Reescreve as 3 linhas de navegação entre as duas telas originais
//      (window.location.href = 'options.html'/'panel.html') pras chamadas
//      equivalentes do gerenciador de telas (window.copilotoIrPara* /
//      window.copilotoVoltarAoPainel) — são strings exatas, achadas e
//      trocadas uma a uma; se uma não for encontrada o build FALHA alto,
//      nunca faz a troca "mais ou menos".
//   4. Escapa "</script" dentro do conteúdo de cada arquivo embutido
//      (nenhum dos .js atuais tem isso hoje, ver auditoria no commit desta
//      fase — mas é uma proteção estrutural barata contra o HTML parser
//      fechar a tag de script na hora errada se algum dia aparecer).

const fs = require('fs');
const path = require('path');

const DIR_CO_PILOTO = path.join(__dirname, '..', 'co-piloto');
const DIR_ANDROID = __dirname;
const DIR_SAIDA = path.join(__dirname, 'dist');
// index.html (não mais copiloto-android.html): dist/ agora é um pacote
// pronto pra hospedar direto num site estático (Netlify etc.) — precisa
// desse nome porque é o que qualquer host de site estático serve por
// padrão na raiz, e é o que o manifest.webmanifest e o sw.js referenciam.
const ARQUIVO_SAIDA = path.join(DIR_SAIDA, 'index.html');

function ler(nomeArquivo, base){
  return fs.readFileSync(path.join(base || DIR_CO_PILOTO, nomeArquivo), 'utf-8');
}

function extrairEntre(texto, marcadorInicio, marcadorFim, rotulo){
  const i = texto.indexOf(marcadorInicio);
  if(i === -1) throw new Error(`[build] não achei "${marcadorInicio}" em ${rotulo}`);
  const f = texto.indexOf(marcadorFim, i + marcadorInicio.length);
  if(f === -1) throw new Error(`[build] não achei "${marcadorFim}" (depois de "${marcadorInicio}") em ${rotulo}`);
  return texto.slice(i + marcadorInicio.length, f);
}

// Troca uma string EXATA, e falha alto se ela não existir — nunca faz uma
// substituição "parecida" ou silenciosamente ignora. `obrigatoria` controla
// se é erro (arquivo mudou de um jeito que quebra a suposição do build) ou
// só um aviso (substituição opcional, ex.: uma linha que só existe numa
// versão do arquivo).
function trocarExato(texto, de, para, rotulo, opts){
  opts = opts || {};
  const vezes = texto.split(de).length - 1;
  if(vezes === 0){
    const msg = `[build] não achei "${de}" em ${rotulo} (esperado ${opts.min || 1}x)`;
    if(opts.obrigatoria === false){ console.warn('AVISO:', msg); return texto; }
    throw new Error(msg);
  }
  if(opts.min && vezes < opts.min){
    throw new Error(`[build] achei "${de}" só ${vezes}x em ${rotulo}, esperava pelo menos ${opts.min}x`);
  }
  return texto.split(de).join(para);
}

function escaparFechamentoDeScript(codigo, rotulo){
  const regex = /<\/script/gi;
  if(regex.test(codigo)){
    console.warn(`[build] AVISO: "${rotulo}" contém "</script" — escapando pra não fechar a tag <script> mais cedo.`);
  }
  return codigo.replace(/<\/script/gi, '<\\/script');
}

function main(){
  const panelHtml = ler('panel.html');
  const optionsHtml = ler('options.html');
  const manifest = JSON.parse(ler('manifest.json'));

  // ---------- <head> ----------
  // styles.css é referenciado hoje por <link>, um arquivo À PARTE — pra
  // virar um único HTML autocontido (CSS embutido, sem depender de baixar
  // mais nada), ele entra inline aqui, no lugar do <link>. As duas fontes
  // que o styles.css referencia (fonts/*.woff2) também viram data URI
  // embutida na própria regra @font-face — senão o arquivo final continuaria
  // dependendo de uma pasta fonts/ ao lado dele, quebrando a promessa de
  // "um único arquivo".
  let stylesCss = ler('styles.css');
  ['fraunces-variable-latin.woff2', 'manrope-variable-latin.woff2'].forEach(nomeFonte => {
    const caminhoOriginal = `fonts/${nomeFonte}`;
    const base64 = fs.readFileSync(path.join(DIR_CO_PILOTO, caminhoOriginal)).toString('base64');
    stylesCss = trocarExato(stylesCss, `url('${caminhoOriginal}')`, `url('data:font/woff2;base64,${base64}')`, `styles.css (inlinando fonte ${nomeFonte})`);
  });

  let panelHead = extrairEntre(panelHtml, '<head>', '</head>', 'panel.html');
  panelHead = trocarExato(panelHead, '<link rel="stylesheet" href="styles.css">', `<style>\n${stylesCss}\n</style>`, 'panel.html (inlinando styles.css)');

  const optionsStyle = extrairEntre(optionsHtml, '<style>', '</style>', 'options.html');
  const mobileCss = ler('mobile.css', DIR_ANDROID);
  const headFinal = `${panelHead}
<meta name="copiloto-versao" content="${manifest.version}">
<!-- PWA: instalabilidade ("Adicionar à tela inicial" no Android). O
     manifest.webmanifest e o sw.js são os 2 únicos arquivos que NÃO dá
     pra embutir no HTML (são referenciados por URL própria, é assim que a
     especificação de Web App Manifest e Service Worker funciona) — por
     isso dist/ vira uma pastinha (index.html + manifest.webmanifest +
     sw.js + icons/), não mais um único arquivo solto. Tudo o resto (CSS,
     JS de negócio, fontes) continua 100% embutido igual antes. -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0A423B">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<style>
/* CSS de options.html, escopado: só se aplica dentro de #configApp (que é
   também a raiz do escopo — @scope inclui a própria raiz, não só os
   descendentes). Sem isto, classes genéricas como .app colidiam com a
   mesma classe em panel.html e uma das duas telas perdia o layout. */
@scope (#configApp) {
${optionsStyle}
}
</style>
<style>
${mobileCss}
</style>`;

  // ---------- corpo do painel (sem os <script src> — entram inline mais embaixo) ----------
  let panelBody = extrairEntre(panelHtml, '<body>', '</body>', 'panel.html');
  [
    '<script src="aba-unica.js"></script>',
    '<script src="funil-padrao.js"></script>',
    '<script src="auth.js"></script>',
    '<script src="perfis.js"></script>',
    '<script src="panel.js"></script>',
    '<script src="panel/importarContatos.js"></script>',
    '<script src="backtotop.js"></script>',
    '<script src="chatbot.js"></script>',
  ].forEach(tag => { panelBody = trocarExato(panelBody, tag, '', 'panel.html (removendo <script src>)'); });

  // ---------- corpo das configurações (idem) ----------
  let optionsBody = extrairEntre(optionsHtml, '<body>', '</body>', 'options.html');
  [
    '<script src="aba-unica.js"></script>',
    '<script src="funil-padrao.js"></script>',
    '<script src="auth.js"></script>',
    '<script src="perfis.js"></script>',
    '<script src="options.js"></script>',
    '<script src="backtotop.js"></script>',
  ].forEach(tag => { optionsBody = trocarExato(optionsBody, tag, '', 'options.html (removendo <script src>)'); });

  // ---------- .js de negócio, verbatim — só as 3 linhas de navegação mudam ----------
  let panelJs = ler('panel.js');
  panelJs = trocarExato(panelJs, "window.location.href = 'options.html';", 'window.copilotoIrParaConfiguracoes();', 'panel.js (navegação sem âncora)');
  panelJs = trocarExato(panelJs, "window.location.href = 'options.html#cardProvedorIA';", "window.copilotoIrParaConfiguracoes('#cardProvedorIA');", 'panel.js (navegação com âncora)');

  let chatbotJs = ler('chatbot.js');
  chatbotJs = trocarExato(chatbotJs, "window.location.href = 'options.html#cardProvedorIA';", "window.copilotoIrParaConfiguracoes('#cardProvedorIA');", 'chatbot.js (navegação com âncora)');

  let optionsJs = ler('options.js');
  optionsJs = trocarExato(optionsJs, "window.location.href = 'panel.html';", 'window.copilotoVoltarAoPainel();', 'options.js (navegação de volta)', { min: 2 });

  const abaUnicaJs = ler('aba-unica.js');
  const funilPadraoJs = ler('funil-padrao.js');
  const authJs = ler('auth.js');
  const perfisJs = ler('perfis.js');
  const importarContatosJs = ler('panel/importarContatos.js');
  const backtotopJs = ler('backtotop.js');

  const storageAdapterJs = ler('storage-adapter.js', DIR_ANDROID);
  const runtimeAdapterJs = ler('runtime-adapter.js', DIR_ANDROID);
  const screenManagerJs = ler('screen-manager.js', DIR_ANDROID);
  const hamburgerMenuJs = ler('hamburger-menu.js', DIR_ANDROID);

  const tag = (nome, codigo) => `<script>\n${escaparFechamentoDeScript(codigo, nome)}\n</script>`;

  const corpoFinal = `
<div id="copilotoContainerAtivo"></div>

<template id="templateTelaPainel">
${panelBody}
</template>

<template id="templateTelaConfiguracoes">
${optionsBody}
</template>

<script type="text/plain" id="fonteOptionsJs">
(function(){
${escaparFechamentoDeScript(optionsJs, 'options.js')}
})();
</script>

${tag('storage-adapter.js', storageAdapterJs)}
${tag('runtime-adapter.js', runtimeAdapterJs)}
${tag('aba-unica.js', abaUnicaJs)}
${tag('funil-padrao.js', funilPadraoJs)}
${tag('auth.js', authJs)}
${tag('perfis.js', perfisJs)}
${tag('screen-manager.js', screenManagerJs)}
${tag('hamburger-menu.js', hamburgerMenuJs)}
${tag('panel.js', panelJs)}
${tag('panel/importarContatos.js', importarContatosJs)}
${tag('backtotop.js', backtotopJs)}
${tag('chatbot.js', chatbotJs)}
<script>
// Registro do service worker (ver sw.js) — só instalabilidade + cache do
// casco do app; nenhuma lógica de negócio mora aqui. Falha em silêncio de
// propósito (ex.: aberto local via file://, onde SW não roda): o app
// inteiro já funciona sem isto, é só a parte de "instalar/usar offline"
// que fica de fora nesse caso.
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => {
      console.warn('[pwa] service worker não registrado (normal se aberto via file://):', e && e.message);
    });
  });
}
</script>
`;

  const htmlFinal = `<!doctype html>
<html lang="pt-BR">
<head>
${headFinal}
</head>
<body>
${corpoFinal}
</body>
</html>
`;

  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  fs.writeFileSync(ARQUIVO_SAIDA, htmlFinal, 'utf-8');
  console.log(`Gerado: ${ARQUIVO_SAIDA} (${(htmlFinal.length / 1024).toFixed(0)} KB, versão ${manifest.version})`);

  // ---------- Pacote PWA: manifest, service worker e ícones, copiados
  // direto (nunca gerados por texto/template — são JSON/JS/PNG prontos) ----------
  fs.copyFileSync(path.join(DIR_ANDROID, 'manifest.webmanifest'), path.join(DIR_SAIDA, 'manifest.webmanifest'));
  fs.copyFileSync(path.join(DIR_ANDROID, 'sw.js'), path.join(DIR_SAIDA, 'sw.js'));
  const dirIconesSaida = path.join(DIR_SAIDA, 'icons');
  fs.mkdirSync(dirIconesSaida, { recursive: true });
  ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'].forEach(nomeIcone => {
    fs.copyFileSync(path.join(DIR_ANDROID, 'icons', nomeIcone), path.join(dirIconesSaida, nomeIcone));
  });
  console.log(`Pacote PWA pronto em: ${DIR_SAIDA}/ (index.html + manifest.webmanifest + sw.js + icons/) — hospede a pasta inteira.`);
}

main();
