// Fase 8 (segurança): política de venda da loja. Cada campo é validado e
// CLAMPADO aqui, na rota que grava de verdade — não só decorado com
// min/max na tela (quando ela existir) — mesmo raciocínio de
// data/companyRepo.js#buildCompanyRecord da extensão: salvo direto por
// fora da tela normal (curl, um bug de UI futuro), um valor extremo não
// pode desativar um teto de segurança ou virar dinheiro de graça.
import { Router } from 'express';
import { getConfig, updateConfig } from '../lib/companyConfig.js';
import { getLoyaltyConfig } from '../lib/loyaltyConfig.js';
import { MAX_INSTALLMENTS } from '../lib/pricing.js';
import { requirePermission } from '../lib/permissions.js';
import { broadcast } from '../lib/broadcast.js';
import { verifyLicenseKey } from '../lib/license.js';
import { onlyDigits, formatCnpj, isValidCnpj, formatCep, isValidCep, isValidEmail } from '../lib/companyValidation.js';
import { UFS } from '../lib/ufs.js';

const router = Router();

/** Dados cadastrais da loja (CNPJ, razão social, endereço...) — usados em
 * recibo/relatório impresso (ver components/receipt.js/reportPrint.js, que
 * já esperavam esses campos, mas nunca eram gravados de verdade) e, cada
 * vez mais, exigidos pra fiscalização. Achado do usuário: sem isto, todo
 * comprovante saía sem nome/CNPJ da loja. Igual à extensão, MAS sem
 * assistente de primeira execução separado (este servidor nunca teve um)
 * — aqui o CNPJ nasce vazio e editável direto nesta mesma tela; assim que
 * for salvo uma vez, TRAVA (não é mais alterável sem um código de
 * liberação assinado, ver PUT abaixo) — mesma trava final da extensão,
 * só que o ponto de entrada (onde ele é digitado a primeira vez) é este
 * mesmo formulário, não uma tela de setup à parte.*/
function readCompanyInfo(cfg) {
  const endereco = cfg.endereco || {};
  const encarregadoLgpd = cfg.encarregadoLgpd || {};
  return {
    cnpj: cfg.cnpj || '',
    cnpjLocked: !!cfg.cnpj,
    razaoSocial: cfg.razaoSocial || '',
    nomeFantasia: cfg.nomeFantasia || '',
    inscricaoEstadual: cfg.inscricaoEstadual || '',
    inscricaoMunicipal: cfg.inscricaoMunicipal || '',
    telefone: cfg.telefone || '',
    email: cfg.email || '',
    ramos: Array.isArray(cfg.ramos) ? cfg.ramos : [],
    horarioFuncionamento: cfg.horarioFuncionamento || '',
    endereco: {
      logradouro: endereco.logradouro || '',
      numero: endereco.numero || '',
      complemento: endereco.complemento || '',
      bairro: endereco.bairro || '',
      cidade: endereco.cidade || '',
      uf: endereco.uf || '',
      cep: endereco.cep || '',
    },
    encarregadoLgpd: {
      nome: encarregadoLgpd.nome || '',
      contato: encarregadoLgpd.contato || '',
    },
  };
}

function readPolicies(cfg) {
  const vendorMaxDiscountPercent = Number(cfg.vendorMaxDiscountPercent);
  const ci = cfg.creditInterest || {};
  return {
    vendorMaxDiscountPercent: Number.isFinite(vendorMaxDiscountPercent) && vendorMaxDiscountPercent >= 0 ? vendorMaxDiscountPercent : 10,
    // Fase 9 (Estoque/PDV): ainda sem tela própria de "Dados da loja" no
    // servidor — exposto aqui, de leitura, pra sale.js#getCompany()
    // funcionar sem reescrita quando for portado. Escrita (PUT abaixo)
    // já existe pra permitir testar/configurar antes da tela existir.
    requireOpenCashSession: !!cfg.requireOpenCashSession,
    creditInterest: {
      freeInstallmentsEnabled: !!ci.freeInstallmentsEnabled,
      freeInstallments: Number.isFinite(Number(ci.freeInstallments)) ? Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(ci.freeInstallments)))) : 1,
      type: ci.type === 'fixed' ? 'fixed' : 'monthly',
      monthlyPercent: Math.max(0, Math.min(100, Number(ci.monthlyPercent) || 0)),
      fixedPercent: Math.max(0, Math.min(100, Number(ci.fixedPercent) || 0)),
    },
    // Achado (Fase 9, ao ligar dashboard.js): na extensão,
    // loyaltyPointsPerReal mora dentro de company.policies (mesmo blob
    // único de config — ver data/companyRepo.js#buildCompanyRecord); aqui
    // ele é escrito por routes/loyalty.js (PUT /api/loyalty/config) na
    // MESMA linha 'config' de company (lib/loyaltyConfig.js), só que essa
    // rota nunca devolvia o valor de volta — dashboard.js#loyaltyOn lê
    // `company.policies.loyaltyPointsPerReal` direto, sem tela própria de
    // "Dados da loja" ainda pra notar a falta. Read-only aqui de propósito
    // (escrita continua só em routes/loyalty.js, fonte única da regra de
    // negócio de fidelidade).
    loyaltyPointsPerReal: getLoyaltyConfig().pointsPerReal,
  };
}

router.get('/', (req, res) => {
  const cfg = getConfig();
  // Formato: os campos ficam soltos na raiz (não aninhados em `policies`
  // nem em `company`) — igual sempre foi vendorMaxDiscountPercent, e agora
  // os dados cadastrais também: data/companyRepo.js#getCompany() da
  // extensão devolve um objeto com `company.policies.X` e `company.cnpj`
  // direto na raiz; o wrapper cliente (public/js/data/companyRepo.js) que
  // reagrupa isso em `{ ...info, policies }` ao montar o objeto pra view,
  // não esta rota.
  res.json({ ...readCompanyInfo(cfg), ...readPolicies(cfg) });
});

router.put('/', requirePermission('empresa'), async (req, res) => {
  const body = req.body || {};
  let cfg = getConfig();
  const patch = {};

  try {
    // Achado do usuário: pra receber comprovante/nota, imprimir cupom, e
    // valer pra fiscalização, faltavam os dados cadastrais de verdade da
    // loja (CNPJ, razão social, endereço...) — só a política de venda
    // tinha tela. Igual à extensão: uma vez salvo um CNPJ não-vazio, ele
    // TRAVA — só muda de novo com um `cnpjUnlockToken` válido (assinado
    // com a mesma chave privada de quem gera as chaves de ativação, tipo
    // 'cnpj-unlock' — ver lib/license.js), conferido AQUI, no servidor —
    // nunca confia só no campo desabilitado da tela (mesmo princípio de
    // sempre, e ainda mais importante aqui: driblar isso destravaria
    // trocar de CNPJ à vontade, inclusive pra tentar reaproveitar a chave
    // de ativação de uma loja diferente).
    if (body.cnpj !== undefined) {
      const cnpjDigits = onlyDigits(body.cnpj);
      if (!isValidCnpj(cnpjDigits)) {
        return res.status(400).json({ error: 'CNPJ inválido. Confira os números digitados.' });
      }
      const nextCnpj = formatCnpj(cnpjDigits);
      if (cfg.cnpj && nextCnpj !== cfg.cnpj) {
        // async de propósito (verifyLicenseKey usa crypto.subtle, que só
        // existe em Promise) — por isso este handler inteiro está dentro
        // de um try/catch: o Express 4 não pega sozinho a rejeição de um
        // handler async, e um erro inesperado aqui derrubaria o processo
        // inteiro (mesmo achado de auditoria já corrigido em
        // routes/auth.js#POST /login).
        const tokenResult = await verifyLicenseKey(body.cnpjUnlockToken, cfg.cnpj);
        if (!tokenResult.valid || tokenResult.tipo !== 'cnpj-unlock') {
          const reason = tokenResult.valid ? 'Esse código não é um código de liberação de CNPJ.' : tokenResult.reason;
          return res.status(403).json({ error: `CNPJ já cadastrado e travado — ${reason}` });
        }
      }
      patch.cnpj = nextCnpj;
    }

    // Achado de auditoria (P2): o único `await` deste handler inteiro fica
    // no bloco do CNPJ acima (verifyLicenseKey) — o resto do handler é
    // síncrono. Mas os campos abaixo (endereço, encarregado de LGPD, juro
    // de crediário) fazem merge com `cfg` pra preencher o que o pedido não
    // mandou (`existing.*`) — se `cfg` continuasse sendo a leitura de ANTES
    // do await, uma segunda edição concorrente (ex: outro admin salvando só
    // o telefone do encarregado de LGPD) que gravasse NESSE meio-tempo
    // seria sobrescrita silenciosamente aqui embaixo, porque este handler
    // usaria um `existing` desatualizado. Relê `cfg` fresco assim que o
    // único ponto de cessão do event loop já passou — daqui pra baixo, o
    // resto do handler roda 100% síncrono até `updateConfig`, então não há
    // mais nenhuma janela de corrida.
    cfg = getConfig();

    if (body.razaoSocial !== undefined) patch.razaoSocial = String(body.razaoSocial).trim();
    if (body.nomeFantasia !== undefined) patch.nomeFantasia = String(body.nomeFantasia).trim();
    if (body.inscricaoEstadual !== undefined) patch.inscricaoEstadual = String(body.inscricaoEstadual).trim();
    if (body.inscricaoMunicipal !== undefined) patch.inscricaoMunicipal = String(body.inscricaoMunicipal).trim();
    if (body.telefone !== undefined) patch.telefone = String(body.telefone).trim();
    if (body.email !== undefined) {
      const email = String(body.email).trim();
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: 'E-mail inválido. Use o formato exemplo@dominio.com.' });
      }
      patch.email = email;
    }
    if (body.ramos !== undefined) {
      patch.ramos = (Array.isArray(body.ramos) ? body.ramos : []).filter((r) => r === 'material' || r === 'mercearia');
    }
    if (body.horarioFuncionamento !== undefined) patch.horarioFuncionamento = String(body.horarioFuncionamento).trim();
    if (body.endereco !== undefined) {
      const e = body.endereco || {};
      if (e.cep !== undefined && String(e.cep).trim() && !isValidCep(e.cep)) {
        return res.status(400).json({ error: 'CEP inválido. Use o formato 00000-000.' });
      }
      if (e.uf !== undefined && String(e.uf).trim() && !UFS.includes(String(e.uf).trim().toUpperCase())) {
        return res.status(400).json({ error: 'UF inválida.' });
      }
      const existing = cfg.endereco || {};
      patch.endereco = {
        logradouro: (e.logradouro ?? existing.logradouro ?? '').toString().trim(),
        numero: (e.numero ?? existing.numero ?? '').toString().trim(),
        complemento: (e.complemento ?? existing.complemento ?? '').toString().trim(),
        bairro: (e.bairro ?? existing.bairro ?? '').toString().trim(),
        cidade: (e.cidade ?? existing.cidade ?? '').toString().trim(),
        uf: (e.uf ?? existing.uf ?? '').toString().trim().toUpperCase(),
        cep: e.cep !== undefined ? formatCep(e.cep) : (existing.cep || ''),
      };
    }
    if (body.encarregadoLgpd !== undefined) {
      const el = body.encarregadoLgpd || {};
      const existing = cfg.encarregadoLgpd || {};
      patch.encarregadoLgpd = {
        nome: (el.nome ?? existing.nome ?? '').toString().trim(),
        contato: (el.contato ?? existing.contato ?? '').toString().trim(),
      };
    }

    if (body.vendorMaxDiscountPercent !== undefined) {
      const value = Number(body.vendorMaxDiscountPercent);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ error: 'Informe um limite de desconto válido (0 ou mais).' });
      }
      patch.vendorMaxDiscountPercent = Math.min(100, value);
    }

    if (body.requireOpenCashSession !== undefined) {
      patch.requireOpenCashSession = !!body.requireOpenCashSession;
    }

    if (body.creditInterest !== undefined) {
      const existing = cfg.creditInterest || {};
      const ci = body.creditInterest || {};
      patch.creditInterest = {
        freeInstallmentsEnabled: !!(ci.freeInstallmentsEnabled ?? existing.freeInstallmentsEnabled ?? false),
        freeInstallments: Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(ci.freeInstallments ?? existing.freeInstallments ?? 1)) || 1)),
        type: (ci.type ?? existing.type ?? 'monthly') === 'fixed' ? 'fixed' : 'monthly',
        monthlyPercent: Math.max(0, Math.min(100, Number(ci.monthlyPercent ?? existing.monthlyPercent ?? 0) || 0)),
        fixedPercent: Math.max(0, Math.min(100, Number(ci.fixedPercent ?? existing.fixedPercent ?? 0) || 0)),
      };
    }

    const updated = updateConfig(patch);
    // Achado (Fase 9, ao ligar atualização em tempo real no PDV): política
    // de desconto/juro nunca avisava ninguém quando mudava — um vendedor
    // com o PDV aberto só veria o valor novo depois de um F5 manual,
    // mesmo que a venda em si já respeitasse a política nova a partir da
    // próxima chamada (o servidor nunca confia em política antiga vinda
    // do cliente, ver achado de segurança da Fase 9 anterior). Avisado
    // agora igual ao resto.
    broadcast('company-changed', {});
    res.json({ ...readCompanyInfo(updated), ...readPolicies(updated) });
  } catch (err) {
    console.error('[erro inesperado] PUT /api/company:', err);
    res.status(500).json({ error: 'Erro inesperado ao salvar. Tente novamente.' });
  }
});

export default router;
