// ---------- Funnel State Machine ----------
//
// Fase 1 da evolução do Copiloto (ver documento de arquitetura da sessão,
// seção "Estratégia do funil"). Espelha, por ora, os mesmos 9 estágios e o
// mesmo critério de tier caro que já existem hardcoded em panel.js
// (ESTAGIO_ORDER via <select id="leadEstagio"> em panel.html, e
// ESTAGIOS_TIER_PAGO) — panel.js continua com os próprios consts (nunca
// migrados pra ler daqui; risco desnecessário pra um dado que já
// funcionava). O que a fase 6 efetivamente usa deste arquivo é
// `acoesComerciais` + `copilotoFunilAcaoValida`, no schema de "próxima
// ação comercial" pedido à IA (ver buildSystemPrompt, panel.js).
//
// Decisão de produto preservada de propósito (já é assim no código atual,
// documentado em vários comentários de panel.js): o ESTÁGIO continua
// SEMPRE escolhido manualmente pelo humano no dropdown. Esta state machine
// nunca força nem sobrescreve essa escolha — ela só formaliza, como dado
// configurável, o que hoje é implícito no código, e dá ao sistema uma
// forma de dizer internamente "esperava uma transição diferente" sem
// travar nada (ver copilotoFunilTransicaoEsperada abaixo).
//
// Nota: a lista de 9 estágios abaixo é a que existe de fato no código hoje
// — não inclui estágios de PAGAMENTO/PÓS-VENDA que apareceram como
// aspiração no pedido original. Adicionar esses estágios é uma decisão de
// produto (o que muda no funil-padrao.js, no schema salvo dos leads
// existentes, etc.) a ser tomada explicitamente numa fase futura, não uma
// suposição feita aqui.
const COPILOTO_FUNIL_PADRAO = {
  estagios: [
    'Primeiro contato',
    'Sondagem',
    'Validação da dor',
    'Apresentação da solução',
    'Condução ao valor',
    'Objeção',
    'Fechamento',
    'Follow-up',
    'Perdido',
  ],

  // Transições esperadas a partir de cada estágio — usado só como sinal
  // ("essa sugestão da IA é uma progressão comum, ou estranha?"), nunca
  // pra bloquear a escolha manual do humano no dropdown, que continua
  // livre pra qualquer estágio a qualquer momento.
  transicoes: {
    'Primeiro contato': ['Sondagem', 'Perdido'],
    Sondagem: ['Validação da dor', 'Perdido', 'Follow-up'],
    'Validação da dor': ['Apresentação da solução', 'Perdido', 'Follow-up'],
    'Apresentação da solução': ['Condução ao valor', 'Objeção', 'Perdido', 'Follow-up'],
    'Condução ao valor': ['Objeção', 'Fechamento', 'Perdido', 'Follow-up'],
    Objeção: ['Condução ao valor', 'Fechamento', 'Perdido', 'Follow-up'],
    Fechamento: ['Perdido'],
    'Follow-up': [
      'Sondagem',
      'Validação da dor',
      'Apresentação da solução',
      'Condução ao valor',
      'Objeção',
      'Fechamento',
      'Perdido',
    ],
    Perdido: [],
  },

  // Mesmo critério de ESTAGIOS_TIER_PAGO em panel.js — estágios de risco
  // usam o modelo/chave principal (mais caro/melhor), o resto usa o
  // econômico.
  tierPorEstagio: {
    'Apresentação da solução': 'avancado',
    'Condução ao valor': 'avancado',
    Objeção: 'avancado',
    Fechamento: 'avancado',
  },

  // Vocabulário de "próxima ação comercial" (fase 6 — Next Best Action).
  // Rótulo de MÁQUINA, sempre acompanhado de um texto livre gerado pela IA
  // (nunca exibido sozinho pro usuário) — dá à UI um valor estável pra
  // decidir ícone/estilo sem depender de casar string livre.
  acoesComerciais: [
    'investigar_dor',
    'apresentar_solucao',
    'conduzir_valor',
    'quebrar_objecao',
    'fechar',
    'retomar_contato',
    'aguardar',
    'nenhuma',
  ],
};

function copilotoFunilTier(estagio, config) {
  const cfg = config || COPILOTO_FUNIL_PADRAO;
  return cfg.tierPorEstagio[estagio] === 'avancado' ? 'avancado' : 'basico';
}

// Diz se estagioAtual -> estagioSugerido é uma progressão esperada do
// funil configurado. Não bloqueia nada — só dá ao chamador o "Estou nesta
// etapa porque..." interno (seção "Estratégia do funil" do plano); quem
// decide de fato o estágio do lead continua sendo sempre o humano.
function copilotoFunilTransicaoEsperada(estagioAtual, estagioSugerido, config) {
  const cfg = config || COPILOTO_FUNIL_PADRAO;
  if (estagioAtual === estagioSugerido) return true;
  const permitidas = cfg.transicoes[estagioAtual];
  return Array.isArray(permitidas) && permitidas.includes(estagioSugerido);
}

// Confere se `tipo` é um dos valores de acoesComerciais configurados —
// usado pra nunca exibir/gravar um rótulo de máquina inventado pela IA
// (ela devolve JSON livre; nada garante que respeitou o enum pedido no
// prompt).
function copilotoFunilAcaoValida(tipo, config) {
  const cfg = config || COPILOTO_FUNIL_PADRAO;
  return cfg.acoesComerciais.includes(tipo);
}
