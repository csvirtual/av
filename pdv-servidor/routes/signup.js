// Etapa 9 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"):
// cadastro self-service de loja nova — até aqui, provisionar uma loja
// exigia acesso à máquina onde o servidor roda (CLI, ver
// scripts/createTenant.js). Esta rota é só um wrapper HTTP fino sobre a
// MESMA função (`createNewTenant`) — nenhuma lógica de provisionamento
// duplicada; a diferença é só quem pode chamar (qualquer visitante do
// domínio-base, sem login) e a trava de abuso (checkSignupRateLimit,
// já que isto é alcançável por qualquer um na internet).
//
// De propósito SEM cobrança/pagamento nenhum — toda loja nasce em
// "trial" (mesmo default de createNewTenant), sem vencimento. Ligar um
// gateway de pagamento de verdade (Stripe, Pagar.me etc.) é uma decisão
// de negócio que exige credenciais reais de uma conta que este código não
// tem — fora de escopo desta etapa (ver README, seção "Modo multi-tenant
// (SaaS)" → "O que falta pra produção de verdade").
import { Router } from 'express';
import { createNewTenant, validateSlug } from '../scripts/createTenant.js';
import { checkSignupRateLimit } from '../lib/signupRateLimit.js';
import { respondValidationError } from '../lib/httpResponses.js';

const router = Router();

const MAX_NAME_LENGTH = 120;

// Usado pelo formulário pra dar feedback em tempo real (slug já em uso,
// formato inválido, palavra reservada) enquanto a pessoa ainda está
// digitando — nunca cria nada, só valida. Sem trava de taxa: é uma
// consulta só de leitura, sem efeito nenhum no banco.
router.get('/check-slug/:slug', (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  try {
    validateSlug(slug);
    res.json({ available: true });
  } catch (err) {
    res.json({ available: false, reason: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const rate = checkSignupRateLimit(req.ip);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `Muitos cadastros a partir deste endereço. Aguarde ${Math.ceil(rate.remainingMs / 60000)}min antes de tentar de novo.`,
      });
    }
    const slug = String(req.body?.slug || '').trim().toLowerCase();
    const razaoSocial = String(req.body?.razaoSocial || '').trim();
    const nomeFantasia = String(req.body?.nomeFantasia || '').trim();
    if (!razaoSocial || razaoSocial.length > MAX_NAME_LENGTH) {
      throw new Error(`Informe a razão social (até ${MAX_NAME_LENGTH} caracteres).`);
    }
    if (!nomeFantasia || nomeFantasia.length > MAX_NAME_LENGTH) {
      throw new Error(`Informe o nome fantasia (até ${MAX_NAME_LENGTH} caracteres).`);
    }
    const tenant = await createNewTenant(slug, razaoSocial, nomeFantasia);
    res.status(201).json({
      slug: tenant.slug,
      // Mesma credencial padrão de sempre (lib/seedAdmin.js,
      // scripts/createTenant.js) — troca de senha obrigatória no
      // primeiro login, nunca dispensada aqui.
      loginHint: { username: 'admin', password: 'admin123', mustChangePassword: true },
    });
  } catch (err) {
    respondValidationError(res, err);
  }
});

export default router;
