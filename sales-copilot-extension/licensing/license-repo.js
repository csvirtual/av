// ---------- Licenciamento: estado de trial e chave de ativação ----------
//
// Fase 9. Mesmo desenho de pdv-extension/app/js/data/licenseRepo.js
// (mesmo repositório), portado pro estilo deste projeto. Usa
// chrome.storage.local direto (não `copilotoStorage`, definido em
// perfis.js — este arquivo carrega ANTES, junto com auth.js, que também
// usa chrome.storage.local puro pelo mesmo motivo de ordem de carga).
//
// Por que fica em chrome.storage.local e não em qualquer estrutura que
// entre em backup/exportação de dados: restaurar o backup de uma
// instalação já ativada nunca pode destravar a licença de uma instalação
// nova sozinho. Esta extensão não tem hoje um mecanismo de backup restaurável
// como o do PDV, mas o princípio vale do mesmo jeito — estado de licença é
// DESTA instalação, nunca viaja com dado de lead/funil.

const COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY = 'copilotoLicencaTrialIniciadoEm';
const COPILOTO_LICENCA_CHAVE_ATIVACAO_KEY = 'copilotoLicencaChaveAtivacao';
const COPILOTO_LICENCA_DOC_KEY = 'copilotoLicencaDoc';

// Placeholder de negócio — nunca validado com o usuário nesta sessão
// (diferente do formato/algoritmo de assinatura, que reaproveita o desenho
// já em produção do PDV). Ajuste livremente antes de usar em produção; não
// afeta quem já tem uma chave definitiva ativada.
const COPILOTO_LICENCA_TRIAL_DURACAO_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

// Só deve ser chamada uma vez, no momento em que uma instalação NOVA gera
// sua credencial-raiz pela primeira vez (ver copilotoGarantirCredencialInicial
// em auth.js) — nunca em qualquer outro boot. Idempotente (não sobrescreve
// se já existir), então chamar de novo por engano não reinicia o relógio.
// Uma instalação que já existia ANTES desta função existir nunca passa por
// aqui — fica pra sempre sem essa chave, ou seja, sem efeito de trial/bloqueio
// nenhum (ver copilotoLicencaObterStatus abaixo — grandfathering deliberado,
// mesma regra do PDV: licenciamento é aditivo, nunca quebra quem já usa a
// extensão hoje sem ter emitido licença nenhuma).
async function copilotoLicencaMarcarInicioTrialSeNecessario() {
  try {
    const dados = await chrome.storage.local.get(COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY);
    if (dados[COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY]) return;
    await chrome.storage.local.set({ [COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY]: Date.now() });
  } catch (e) { /* nunca deixa a criação da credencial-raiz falhar por causa disto */ }
}

async function copilotoLicencaObterDoc() {
  const dados = await chrome.storage.local.get(COPILOTO_LICENCA_DOC_KEY);
  return dados[COPILOTO_LICENCA_DOC_KEY] || '';
}

async function copilotoLicencaSalvarDoc(doc) {
  await chrome.storage.local.set({ [COPILOTO_LICENCA_DOC_KEY]: String(doc || '').replace(/\D/g, '') });
}

async function copilotoLicencaObterChaveSalva() {
  const dados = await chrome.storage.local.get(COPILOTO_LICENCA_CHAVE_ATIVACAO_KEY);
  return dados[COPILOTO_LICENCA_CHAVE_ATIVACAO_KEY] || '';
}

async function copilotoLicencaSalvarChave(chaveTexto) {
  await chrome.storage.local.set({ [COPILOTO_LICENCA_CHAVE_ATIVACAO_KEY]: String(chaveTexto || '').trim() });
}

// Estado completo de licenciamento desta instalação, já resolvido contra o
// doc (CPF/CNPJ) cadastrado. Nunca bloqueia uma instalação que nunca teve
// COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY gravado (ver comentário acima).
// Devolve sempre { ativo, tipo, expiraEm } — tipo é um rótulo pra UI/log,
// nunca pra decisão de bloqueio (só `ativo` decide isso).
async function copilotoLicencaObterStatus() {
  const doc = await copilotoLicencaObterDoc();
  const chaveSalva = await copilotoLicencaObterChaveSalva();
  if (chaveSalva && doc) {
    const resultado = await copilotoLicencaVerificar(chaveSalva, doc);
    if (resultado.valido) {
      return { ativo: true, tipo: resultado.tipo, expiraEm: resultado.expiraEm };
    }
    // Chave guardada parou de valer (doc mudou, expirou etc.) — cai pro
    // trial padrão como se não houvesse chave nenhuma.
  }

  const dados = await chrome.storage.local.get(COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY);
  const trialIniciadoEm = dados[COPILOTO_LICENCA_TRIAL_INICIADO_EM_KEY] || null;
  if (!trialIniciadoEm) return { ativo: true, tipo: 'sem-trial', expiraEm: null }; // instalação anterior a esta função — nunca bloqueia

  const expirado = (Date.now() - trialIniciadoEm) > COPILOTO_LICENCA_TRIAL_DURACAO_MS;
  return expirado
    ? { ativo: false, tipo: 'trial-expirado', expiraEm: null }
    : { ativo: true, tipo: 'trial', expiraEm: trialIniciadoEm + COPILOTO_LICENCA_TRIAL_DURACAO_MS };
}
