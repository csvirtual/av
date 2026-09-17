// Achado de auditoria (DRY): duas formas de resposta de erro apareciam
// copiadas, sem middleware nem helper nenhum por trás, em praticamente
// toda rota do sistema (~46 ocorrências em ~19 arquivos):
//
// 1. Erro de VALIDAÇÃO de negócio — cada `throw new Error(mensagem em
//    português já pronta pro usuário)` dentro de um handler cai num
//    `catch (err) { res.status(400).json({ error: err.message }); }`
//    idêntico, arquivo após arquivo.
// 2. Erro INESPERADO (bug, falha de infra) — sempre a mesma dupla
//    `console.error('[erro inesperado] ...', err)` + `res.status(500)`
//    com uma mensagem genérica seguro-pra-produção (nunca err.message,
//    que poderia vazar detalhe interno).
//
// Nenhuma das duas regras de negócio mudou aqui — é só a MESMA resposta
// (formato, código HTTP, o que loga, o que nunca vaza) deixando de estar
// copiada em cada arquivo de rota.
export function respondValidationError(res, err) {
  res.status(400).json({ error: err.message });
}

export function respondUnexpectedError(res, err, context, fallbackMessage) {
  console.error(`[erro inesperado] ${context}:`, err);
  res.status(500).json({ error: fallbackMessage });
}
