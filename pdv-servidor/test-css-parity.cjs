// Guarda-corpo automático pro achado do usuário (Painel com cards maiores
// que a extensão, causa raiz: public/css/styles.css#.stat-card .label
// ganhou min-height SEM media query, engordando o card em QUALQUER largura
// de tela, inclusive desktop, onde a extensão nunca teve esse problema).
//
// Regra: a aparência de um elemento que já existe nos dois produtos
// (mesmo seletor CSS) não pode mudar FORA de um @media — é exatamente
// esse "fora de @media" que vaza pro desktop e quebra a paridade visual
// que o usuário quer preservar (pdv-extension 1.15.63 é a referência
// declarada). Dentro de @media vale à vontade — é onde a maioria das
// correções de celular mora, e não afeta desktop nenhum.
//
// Não compara os dois arquivos como texto (isso bloquearia toda extensão
// legítima de servidor: classe nova tipo .notice-card, propriedade nova
// dentro de @media etc.) — só as propriedades de um seletor que JÁ EXISTE
// nos dois, no escopo SEM media query. Propriedade nova ali (ex: uma
// variável CSS a mais em :root) passa; propriedade que muda de valor, ou
// aparece só de um lado, falha.
//
// Rodar: node test-css-parity.cjs (sem servidor nenhum rodando — é só
// leitura de arquivo, nenhuma rede envolvida).
const fs = require('fs');
const path = require('path');

const EXT_CSS = path.join(__dirname, '..', 'pdv-extension', 'app', 'css', 'styles.css');
const SRV_CSS = path.join(__dirname, 'public', 'css', 'styles.css');

/** Extrai só as regras de escopo TOPO (fora de qualquer @media) de um CSS —
 * devolve um Map seletor -> Map propriedade -> valor. Ignora blocos
 * @media inteiros (o conteúdo deles nunca entra no resultado, mas o
 * parser ainda precisa "pular" por cima pra continuar contando chaves
 * certo pro resto do arquivo). Ignora comentários /* ... * /. */
function parseTopLevelRules(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map();
  let i = 0;
  const n = noComments.length;
  while (i < n) {
    // Acha o próximo '{' fora de qualquer coisa — junto com tudo antes dele
    // desde o último ponto de parada, que é o "cabeçalho" (seletor ou @media).
    const braceIdx = noComments.indexOf('{', i);
    if (braceIdx === -1) break;
    const header = noComments.slice(i, braceIdx).trim();
    // Acha o '}' que fecha ESTE bloco, contando aninhamento de chaves.
    let depth = 1;
    let j = braceIdx + 1;
    while (j < n && depth > 0) {
      if (noComments[j] === '{') depth++;
      else if (noComments[j] === '}') depth--;
      j++;
    }
    const body = noComments.slice(braceIdx + 1, j - 1);
    if (header.startsWith('@')) {
      // @media, @keyframes, @font-face etc. — todo o conteúdo é "escopado",
      // nunca entra no Map de topo. Não recursa pra dentro de propósito:
      // regra dentro de @media pode divergir livremente.
    } else if (header) {
      // Um ou mais seletores separados por vírgula podem compartilhar o
      // mesmo bloco de declarações (ex: "a, b { cor: vermelho }") — trata
      // cada seletor como uma entrada própria, igual o navegador enxerga.
      const props = new Map();
      for (const decl of body.split(';')) {
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) continue;
        const prop = decl.slice(0, colonIdx).trim();
        const value = decl.slice(colonIdx + 1).trim();
        if (prop) props.set(prop, value);
      }
      for (const sel of header.split(',').map((s) => s.trim()).filter(Boolean)) {
        // Seletor repetido no mesmo arquivo (raro, mas existe: :root
        // aparece mais de uma vez pra temas) — junta as propriedades, a
        // declaração mais recente no arquivo vence (mesma regra do CSS).
        const existing = rules.get(sel) || new Map();
        for (const [k, v] of props) existing.set(k, v);
        rules.set(sel, existing);
      }
    }
    i = j;
  }
  return rules;
}

const extRules = parseTopLevelRules(fs.readFileSync(EXT_CSS, 'utf-8'));
const srvRules = parseTopLevelRules(fs.readFileSync(SRV_CSS, 'utf-8'));

// Exceções conhecidas e já verificadas visualmente — cada uma é uma
// melhoria deliberada do servidor que MUDA a regra CSS mas NÃO muda a
// aparência renderizada de nada que a extensão já usa. Propositalmente
// GRANULAR (por propriedade, não por seletor inteiro): perdoar um
// seletor inteiro esconderia qualquer divergência FUTURA e não relacionada
// nesse mesmo seletor — foi quase assim que o bug original passou batido
// (uma exceção larga demais teria escondido o min-height/line-height
// novos junto com o resto). Toda entrada nova aqui precisa do mesmo tipo
// de prova que estas tiveram: medir o elemento de verdade no navegador,
// não só ler o CSS.
const KNOWN_EXCEPTIONS = {
  // Seletor que a extensão tem em escopo global e o servidor não tem no
  // mesmo escopo — mas porque foi generalizado pra outro seletor, não
  // porque sumiu de verdade.
  missingSelector: {
    // Extensão usa `.field .hint` (só dentro de .field); servidor generalizou
    // pra `.hint` solto (qualquer lugar) com as MESMAS propriedades —
    // qualquer elemento que a extensão estiliza continua estilizado igual,
    // a regra nova só amplia onde funciona, não muda como fica.
    '.field .hint': 'generalizada pra `.hint` solto no servidor, mesmas propriedades — ver .hint',
  },
  // Propriedade específica de um seletor compartilhado que diverge (ou é
  // nova de um lado) sem mudar a aparência renderizada. Chave:
  // "seletor::propriedade".
  property: {
    '.table-wrap::background': 'virou background-color + background-image (sombra de rolagem) — mesma cor de fundo, extensão usava o shorthand',
    '.table-wrap::background-color': 'parte do shorthand `background` da extensão quebrada em longhand — mesma cor (var(--surface))',
    '.table-wrap::background-repeat': 'longhand novo, necessário pro gradiente da sombra de rolagem não repetir',
    '.table-wrap::background-size': 'longhand novo, controla a área de cada camada de sombra de rolagem',
    '.table-wrap::background-position': 'longhand novo, posiciona cada camada de sombra de rolagem',
    '.table-wrap::background-attachment': 'longhand novo, faz a sombra de fundo ficar fixa e o gradiente de sombra rolar com o conteúdo',
    '.table-wrap::background-image': 'longhand novo — os gradientes que implementam a sombra de rolagem em si',
    ':root::--scroll-shadow': 'variável nova que só alimenta a exceção de .table-wrap acima — não estiliza nada sozinha',
    ':root[data-theme="dark"]::--scroll-shadow': 'idem, versão do tema escuro',
    '.utility-bar::flex-wrap': 'permite quebrar linha quando o conteúdo não cabe — mesmo conteúdo dos dois produtos (ver views/*.js), então só entra em ação numa largura onde já ia vazar/cortar; nas larguras onde os dois cabem numa linha só (inclusive 1.15.63), não muda nada',
    '.utility-bar::gap': 'espaçamento entre itens só quando a quebra acima ocorre de verdade — mesmo raciocínio',
  },
};

const violations = [];
for (const [selector, extProps] of extRules) {
  const srvProps = srvRules.get(selector);
  if (!srvProps) {
    if (KNOWN_EXCEPTIONS.missingSelector[selector]) continue;
    // Seletor que a extensão tem em escopo global e o servidor não tem
    // ali (só dentro de @media, ou sumiu) — também é uma divergência
    // real de aparência, vale reportar.
    violations.push({ selector, issue: 'existe na extensão (fora de @media) mas não no servidor no mesmo escopo' });
    continue;
  }
  for (const [prop, extValue] of extProps) {
    if (KNOWN_EXCEPTIONS.property[`${selector}::${prop}`]) continue;
    const srvValue = srvProps.get(prop);
    if (srvValue === undefined) {
      violations.push({ selector, issue: `propriedade "${prop}" existe na extensão mas não no servidor (mesmo escopo)`, extValue });
    } else if (srvValue !== extValue) {
      violations.push({ selector, issue: `propriedade "${prop}" diverge`, extValue, srvValue });
    }
  }
  // Propriedade NOVA no servidor, num seletor que JÁ EXISTE nos dois —
  // achado real de auditoria: foi exatamente assim que o bug do
  // .stat-card .label entrou (min-height/line-height ADICIONADOS ali,
  // nenhuma propriedade da extensão foi removida ou mudou de valor, mas
  // o card engordou mesmo assim). Deixar "servidor pode só adicionar"
  // passar batido é o buraco por onde esse bug passou — por isso aqui é
  // simétrico: um seletor que os dois produtos já compartilham não pode
  // ganhar propriedade nova de um lado só, salvo exceção documentada
  // acima. Seletor 100% novo do servidor (que a extensão nem tem) continua
  // livre — nunca passa por aqui.
  for (const prop of srvProps.keys()) {
    if (extProps.has(prop)) continue;
    if (KNOWN_EXCEPTIONS.property[`${selector}::${prop}`]) continue;
    violations.push({ selector, issue: `propriedade "${prop}" existe no servidor mas não na extensão (mesmo escopo, seletor compartilhado)`, srvValue: srvProps.get(prop) });
  }
}

if (violations.length > 0) {
  console.log(`FAIL - ${violations.length} divergência(s) de aparência entre pdv-servidor e pdv-extensão fora de @media:\n`);
  for (const v of violations) {
    console.log(`  ${v.selector}`);
    console.log(`    ${v.issue}`);
    if (v.extValue !== undefined) console.log(`    extensão: ${v.extValue}`);
    if (v.srvValue !== undefined) console.log(`    servidor: ${v.srvValue}`);
  }
  console.log('\nSe a mudança for proposital (ex: nova permissão de negócio, não visual),');
  console.log('replique em pdv-extension/app/css/styles.css também, ou mova a regra pra');
  console.log('dentro de um @media (max-width: ...) se for só pra celular.');
  process.exit(1);
} else {
  console.log(`OK - nenhuma divergência de aparência fora de @media entre os dois produtos (${extRules.size} seletores conferidos).`);
  process.exit(0);
}
