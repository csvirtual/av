// Status e ativação de licença — porta o mesmo mecanismo de
// data/licenseRepo.js/app.js#renderLicenseBlockedScreen da extensão pro
// servidor. SEM requireAuth de propósito (ver server.js): o status
// precisa ser conferido ANTES do login (pra travar o sistema inteiro,
// tela de login incluída, quando o trial/demo expira — ver
// public/js/app.js#bootImpl), e a ativação em si também precisa
// funcionar sem sessão nenhuma, pelo mesmo motivo — quem está bloqueado
// não tem como logar pra "ganhar permissão" de ativar. A chave assinada é
// a única proteção de verdade aqui, não uma sessão.
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getConfig } from '../lib/companyConfig.js';
import { getLicenseStatus, setStoredActivationKey } from '../lib/licenseState.js';
import { verifyLicenseKey } from '../lib/license.js';
import { logAction } from '../lib/audit.js';

const router = Router();

// Versão exibida em Dados da loja, abaixo da situação da licença — lida
// direto do package.json (fonte única, nunca duplicada à mão) pra nunca
// ficar desatualizada num release. Lida uma vez, no arranque — reiniciar o
// servidor já é o próprio evento de "atualizei o sistema".
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

router.get('/status', async (req, res) => {
  try {
    const cfg = getConfig();
    const cnpj = cfg.cnpj || '';
    const status = await getLicenseStatus(cnpj);
    // Achado do usuário: a tela de bloqueio (public/js/app.js#renderLicenseBlockedScreen)
    // roda ANTES de qualquer login — chamar GET /api/company (que exige
    // sessão) pra montar a mensagem de contato do suporte sempre dava 401
    // e travava o boot inteiro em "Carregando…". Aqui, junto do status
    // (já público de propósito, ver comentário no topo do arquivo), vai só
    // o mínimo não-sensível (mesmas informações que já aparecem impressas
    // num comprovante) — nunca o cadastro fiscal completo (endereço,
    // inscrições, LGPD), que continua exigindo login.
    status.company = { nomeFantasia: cfg.nomeFantasia || '', cnpj, email: cfg.email || '' };
    status.version = APP_VERSION;
    res.json(status);
  } catch (err) {
    console.error('[erro inesperado] GET /api/license/status:', err);
    res.status(500).json({ error: 'Erro inesperado ao conferir a licença.' });
  }
});

router.post('/activate', async (req, res) => {
  try {
    const cnpj = getConfig().cnpj || '';
    const result = await verifyLicenseKey(req.body?.key, cnpj);
    // Mesmo achado de auditoria da extensão (ver app.js#renderLicenseBlockedScreen
    // e views/company.js): um código de liberação de CNPJ (tipo
    // 'cnpj-unlock') tem assinatura e CNPJ igualmente válidos — sem checar
    // o tipo aqui, seria aceito como chave de ativação e viraria
    // "Definitiva" pra sempre (getLicenseStatus trata "não é demo" como
    // "é full"). Os dois tipos de código têm o mesmo formato assinado, só
    // o campo `tipo` dentro do payload diferencia.
    if (!result.valid || (result.tipo !== 'demo' && result.tipo !== 'full')) {
      const reason = result.valid ? 'Esse código não é uma chave de ativação (é um código de outro tipo).' : result.reason;
      return res.status(400).json({ error: reason });
    }
    setStoredActivationKey(String(req.body.key).trim());
    logAction({
      userId: req.userId || null, userName: req.userName || 'Ativação (tela de bloqueio)', role: req.userRole || 'admin',
      action: 'Chave de ativação aplicada',
      details: `Licença ativada (tipo: ${result.tipo}) para o CNPJ ${cnpj || '(ainda não cadastrado)'}.`,
      entity: 'license', entityId: 'main',
    });
    const status = await getLicenseStatus(cnpj);
    res.json(status);
  } catch (err) {
    console.error('[erro inesperado] POST /api/license/activate:', err);
    res.status(500).json({ error: 'Erro inesperado ao ativar. Tente novamente.' });
  }
});

export default router;
