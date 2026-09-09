// Fase 8 (segurança): política de venda da loja. Cada campo é validado e
// CLAMPADO aqui, na rota que grava de verdade — não só decorado com
// min/max na tela (quando ela existir) — mesmo raciocínio de
// data/companyRepo.js#buildCompanyRecord da extensão: salvo direto por
// fora da tela normal (curl, um bug de UI futuro), um valor extremo não
// pode desativar um teto de segurança ou virar dinheiro de graça.
import { Router } from 'express';
import { getConfig, updateConfig } from '../lib/companyConfig.js';
import { MAX_INSTALLMENTS } from '../lib/pricing.js';
import { requirePermission } from '../lib/permissions.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

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
  };
}

router.get('/', (req, res) => {
  const policies = readPolicies(getConfig());
  // Formato: os campos ficam soltos na raiz (não aninhados em `policies`),
  // igual sempre foi vendorMaxDiscountPercent — data/companyRepo.js#getCompany()
  // da extensão devolve um objeto com `company.policies.X`; o wrapper
  // cliente (public/js/data/companyRepo.js) que aninha isso em `policies`
  // ao montar o objeto pra view, não esta rota.
  res.json(policies);
});

router.put('/', requirePermission('empresa'), (req, res) => {
  const body = req.body || {};
  const patch = {};

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
    const existing = getConfig().creditInterest || {};
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
  // de desconto/juro nunca avisava ninguém quando mudava — um vendedor com
  // o PDV aberto só veria o valor novo depois de um F5 manual, mesmo que a
  // venda em si já respeitasse a política nova a partir da próxima chamada
  // (o servidor nunca confia em política antiga vinda do cliente, ver
  // achado de segurança da Fase 9 anterior). Avisado agora igual ao resto.
  broadcast('company-changed', {});
  res.json(readPolicies(updated));
});

export default router;
