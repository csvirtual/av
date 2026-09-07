// Fase 8 (segurança): política de venda da loja — hoje só o limite de
// desconto que um vendedor sem a permissão 'unlimitedDiscount' pode aplicar
// sozinho (ver routes/sales.js). Fica na mesma linha 'config' de company
// (lib/companyConfig.js) — igual modo de caixa e taxas de fidelidade.
import { Router } from 'express';
import { getConfig, updateConfig } from '../lib/companyConfig.js';

const router = Router();

router.get('/', (req, res) => {
  const cfg = getConfig();
  const vendorMaxDiscountPercent = Number(cfg.vendorMaxDiscountPercent);
  res.json({
    vendorMaxDiscountPercent: Number.isFinite(vendorMaxDiscountPercent) && vendorMaxDiscountPercent >= 0 ? vendorMaxDiscountPercent : 10,
  });
});

router.put('/', (req, res) => {
  const value = Number(req.body.vendorMaxDiscountPercent);
  if (!Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: 'Informe um limite de desconto válido (0 ou mais).' });
  }
  updateConfig({ vendorMaxDiscountPercent: value });
  res.json({ vendorMaxDiscountPercent: value });
});

export default router;
