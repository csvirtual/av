// Config de fidelidade — mesma linha 'config' de company usada pelo modo de
// caixa (ver lib/cashSession.js), lida a cada requisição.
import { getConfig } from './companyConfig.js';

// `targetDb` opcional (etapa 5 do roteiro multi-tenant, ver artifact "PDV
// Multi-Tenant") — repassado direto pra getConfig(), que já tem seu
// próprio default (banco fixo do processo) quando não informado.
export function getLoyaltyConfig(targetDb) {
  const cfg = getConfig(targetDb);
  const pointsPerReal = Number(cfg.loyaltyPointsPerReal);
  const redemptionRate = Number(cfg.loyaltyRedemptionRate);
  return {
    pointsPerReal: Number.isFinite(pointsPerReal) && pointsPerReal >= 0 ? pointsPerReal : 0,
    redemptionRate: Number.isFinite(redemptionRate) && redemptionRate > 0 ? redemptionRate : 100,
  };
}
