// Config de fidelidade — mesma linha 'config' de company usada pelo modo de
// caixa (ver lib/cashSession.js), lida a cada requisição.
import { getConfig } from './companyConfig.js';

export function getLoyaltyConfig() {
  const cfg = getConfig();
  const pointsPerReal = Number(cfg.loyaltyPointsPerReal);
  const redemptionRate = Number(cfg.loyaltyRedemptionRate);
  return {
    pointsPerReal: Number.isFinite(pointsPerReal) && pointsPerReal >= 0 ? pointsPerReal : 0,
    redemptionRate: Number.isFinite(redemptionRate) && redemptionRate > 0 ? redemptionRate : 100,
  };
}
