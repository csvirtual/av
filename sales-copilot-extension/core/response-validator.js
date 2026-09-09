// ---------- Response Validator ----------
//
// Fase 1 da evolução do Copiloto (ver documento de arquitetura da sessão).
// Generaliza panel.js#parseJsonSafely — mesmo espírito de nunca deixar uma
// resposta malformada da IA quebrar a tela ou apagar em silêncio o texto
// gerado, só que como função pura reutilizável por qualquer schema (Gerar
// resposta, Follow-up, e o schema de Next Best Action expandido da fase 6),
// em vez de uma cópia de resgate por fluxo.
//
// Nenhum arquivo existente carrega isto ainda — zero efeito no
// comportamento atual da extensão. panel.js#parseJsonSafely continua
// sendo o que roda de fato até a fase 5/6 decidir migrar os fluxos
// existentes pra cá.
function copilotoLimparBlocoJson(texto) {
  return (texto === null || texto === undefined ? '' : String(texto)).replace(/```json|```/g, '').trim();
}

// `camposObrigatorios`: chaves que precisam existir no objeto (podem vir
// null) pra ele contar como válido pro schema em questão.
// `limitesPorCampo`: { campo: tamanhoMaximo } — evita um campo tipo "chip"
// virar um parágrafo e quebrar a UI, mesmo problema que o corte de 40
// caracteres em panel.js#textoDaIA já resolve pontualmente hoje só pra
// emocao_cliente.
//
// Devolve { valido, faltando, dados } — `dados` sempre é um objeto
// utilizável (nunca null), mesmo quando a IA não devolveu JSON algum: nesse
// caso o texto cru vira o valor do primeiro campo obrigatório (mesmo
// resgate de parseJsonSafely, generalizado pra não presumir o nome do
// campo).
function copilotoValidarRespostaIA(textoCru, opcoes) {
  const cfg = opcoes || {};
  const camposObrigatorios = cfg.camposObrigatorios || [];
  const limitesPorCampo = cfg.limitesPorCampo || {};
  const limpo = copilotoLimparBlocoJson(textoCru);

  let obj = null;
  try {
    const parsed = JSON.parse(limpo);
    // Mesmo cuidado de parseJsonSafely: JSON.parse aceita `"texto"`, `123`
    // e `[...]` como JSON válido — só um objeto simples serve como
    // resposta estruturada, qualquer outra coisa cai no resgate abaixo.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
  } catch (e) {
    /* cai no resgate abaixo */
  }

  if (!obj) {
    obj = {};
    if (camposObrigatorios[0]) obj[camposObrigatorios[0]] = limpo;
  }

  const faltando = camposObrigatorios.filter((c) => !(c in obj));
  Object.keys(limitesPorCampo).forEach((campo) => {
    if (typeof obj[campo] === 'string' && obj[campo].length > limitesPorCampo[campo]) {
      obj[campo] = obj[campo].slice(0, limitesPorCampo[campo]);
    }
  });

  return { valido: faltando.length === 0, faltando, dados: obj };
}
