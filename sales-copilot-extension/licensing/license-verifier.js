// ---------- Licenciamento: verificação de chave de ativação ----------
//
// Fase 9 da evolução do Copiloto. Mesmo desenho já validado e em produção
// em pdv-extension/app/js/license.js (mesmo repositório) — reaproveitado
// aqui em vez de inventar um formato novo, só generalizando `cnpj` para
// `doc` (CPF de profissional autônomo OU CNPJ de empresa, ver
// license-repo.js). Portado pro estilo deste projeto (script clássico,
// sem import/export, globals prefixados `copiloto`) em vez do ES module
// original.
//
// Assinatura assimétrica ECDSA P-256 + SHA-256. A chave abaixo é só a
// PÚBLICA (não é segredo — serve só pra CONFERIR, nunca pra gerar). A
// privada correspondente nunca entra neste arquivo nem em nenhum arquivo
// carregado pela extensão — mora só em licensing-tool/ (raiz do
// repositório, fora de sales-copilot-extension/, nunca referenciada por
// manifest.json), rodada localmente por quem emite as chaves.
//
// Formato da chave de ativação: `<payload_base64url>.<assinatura_base64url>`
// payload (JSON, UTF-8): { doc, tipo, geradoEm, expiraEm }
//   doc: CPF ou CNPJ (só dígitos) do titular da licença
//   tipo: 'full' | 'demo' (rótulo livre pra exibição/lógica de UI)
//   expiraEm: ISO 8601, ou ausente/null = sem validade (licença definitiva)
//
// PLACEHOLDER DE TESTES — troque antes de emitir qualquer licença real
// (ver licensing-tool/README.md). A chave privada correspondente a esta
// pública de teste está documentada só nos testes deste repositório, nunca
// em produção.
const COPILOTO_LICENCA_CHAVE_PUBLICA_JWK = {
  crv: 'P-256', kty: 'EC',
  x: 'T0WE1a5Dd5dySvUGPE8BdApJGX_106r-Jtm6MA5pyKw',
  y: 'jInDdMlYVTWsQwzaKKcJI7whlZ0K9K_I7-2UkTW1pm8',
};

function _copilotoLicencaB64UrlParaBuffer(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

let _copilotoLicencaChavePublicaCache = null;
async function _copilotoLicencaObterChavePublica() {
  if (!_copilotoLicencaChavePublicaCache) {
    _copilotoLicencaChavePublicaCache = await crypto.subtle.importKey(
      'jwk', COPILOTO_LICENCA_CHAVE_PUBLICA_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
  }
  return _copilotoLicencaChavePublicaCache;
}

// Confere uma chave de ativação contra o documento (CPF/CNPJ, só dígitos)
// cadastrado nesta instalação. Nunca lança — sempre devolve
// { valido, motivo } (motivo só quando valido é false), pra quem chama
// nunca precisar de try/catch pra um caso totalmente esperado (colou algo
// errado, chave de outro titular, chave vencida).
async function copilotoLicencaVerificar(chaveTexto, doc) {
  try {
    const bruta = String(chaveTexto || '').trim();
    const partes = bruta.split('.');
    if (partes.length !== 2) return { valido: false, motivo: 'Chave em formato inválido.' };
    const [payloadB64, assinaturaB64] = partes;

    const payloadBuf = _copilotoLicencaB64UrlParaBuffer(payloadB64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBuf));

    const chavePublica = await _copilotoLicencaObterChavePublica();
    const assinaturaBuf = _copilotoLicencaB64UrlParaBuffer(assinaturaB64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      chavePublica,
      assinaturaBuf,
      new TextEncoder().encode(payloadB64)
    );
    if (!ok) return { valido: false, motivo: 'Chave inválida — assinatura não confere.' };

    if (String(payload.doc || '') !== String(doc || '')) {
      return { valido: false, motivo: 'Essa chave não corresponde ao CPF/CNPJ cadastrado nesta instalação.' };
    }
    if (payload.expiraEm && new Date(payload.expiraEm).getTime() < Date.now()) {
      return { valido: false, motivo: 'Essa chave já expirou. Peça uma nova.' };
    }

    return { valido: true, motivo: null, tipo: payload.tipo || 'full', expiraEm: payload.expiraEm || null };
  } catch (e) {
    return { valido: false, motivo: 'Chave em formato inválido.' };
  }
}
