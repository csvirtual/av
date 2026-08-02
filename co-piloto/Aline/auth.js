// ---------- Autenticação compartilhada (usada em panel.html e options.html) ----------
// Fonte única da senha e da lógica de sessão — evita ter que atualizar hash em 2 arquivos.

const COPILOTO_CREDENCIAIS_HASH = 'a5c4437b3d408d1c9bb525936758a5ef613e54bbc87f8dab0e956b7983982b9a';
const COPILOTO_SESSAO_AUTH_KEY = 'copilotoAutenticado';
const COPILOTO_SESSAO_ATIVIDADE_KEY = 'copilotoUltimaAtividade';
const COPILOTO_INATIVIDADE_LIMITE_MS = 30 * 60 * 1000; // 30 minutos parado = pede senha de novo
const COPILOTO_ULTIMO_USUARIO_KEY = 'copilotoUltimoUsuario'; // guardado em local (não expira com a sessão)

async function copilotoSha256Hex(texto){
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ---------- Hash de senha robusto (PBKDF2-HMAC-SHA256, salt aleatório) ----------
// SHA-256 de uma rodada só (usado antes, aqui e nas senhas de perfil em
// perfis.js) é rápido demais de força-bruta offline caso alguém tenha
// acesso ao chrome.storage local — PBKDF2 com muitas iterações é desenhado
// pra ser lento de propósito, o padrão recomendado quando não dá pra usar
// bcrypt/scrypt/Argon2 (que não existem nativamente no navegador). Só usa
// SubtleCrypto nativo, sem nenhuma biblioteca nova.
const COPILOTO_PBKDF2_ITERACOES = 210000; // recomendação da OWASP (2023) pra PBKDF2-HMAC-SHA256

async function copilotoGerarSaltHex(tamanhoBytes){
  const bytes = crypto.getRandomValues(new Uint8Array(tamanhoBytes || 16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function copilotoHexParaBytes(hex){
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function copilotoPbkdf2Hex(texto, saltHex, iteracoes){
  const chaveBase = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(texto || ''), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: copilotoHexParaBytes(saltHex), iterations: iteracoes, hash: 'SHA-256' },
    chaveBase, 256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Formato "pbkdf2:<iterações>:<salt em hex>:<hash em hex>" — salt aleatório
// de verdade (16 bytes, gerado com crypto.getRandomValues, um por senha),
// nada a ver com os "sais" antigos que eram só o id do perfil (previsível).
// Usado tanto pra senha de perfil e palavra-chave (perfis.js) quanto, por
// migração automática, pro usuário/senha da Área restrita logo abaixo.
async function copilotoGerarHashSenhaForte(texto){
  const salt = await copilotoGerarSaltHex(16);
  const hash = await copilotoPbkdf2Hex(texto, salt, COPILOTO_PBKDF2_ITERACOES);
  return `pbkdf2:${COPILOTO_PBKDF2_ITERACOES}:${salt}:${hash}`;
}

async function copilotoVerificarHashSenhaForte(texto, hashSalvo){
  const partes = (hashSalvo || '').split(':');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const [, iteracoesStr, salt, hashEsperado] = partes;
  const hash = await copilotoPbkdf2Hex(texto, salt, parseInt(iteracoesStr, 10));
  return hash === hashEsperado;
}

// Versão migrada (PBKDF2) do usuário/senha da Área restrita — o hash fixo
// COPILOTO_CREDENCIAIS_HASH acima é uma constante de código-fonte (não dá
// pra saber a senha em texto puro pra já nascer no formato forte), então a
// migração é automática e sem fricção: no primeiro login certo depois desta
// versão, grava aqui um hash PBKDF2 equivalente; dali em diante só ele é
// usado, e o hash fixo antigo vira só o fallback pra quem ainda não migrou.
//
// O nome da chave inclui um pedaço do próprio COPILOTO_CREDENCIAIS_HASH de
// propósito: se a credencial da Área restrita for trocada de novo no futuro
// (nova constante acima), a chave muda junto automaticamente, e qualquer
// versão migrada antiga (da credencial ANTERIOR) fica órfã/ignorada — sem
// isso, quem já tivesse migrado continuaria autenticando pela credencial
// velha pra sempre, porque o código sempre prioriza o valor já migrado.
const COPILOTO_CREDENCIAIS_HASH_V2_KEY = 'copilotoCredenciaisHashV2_' + COPILOTO_CREDENCIAIS_HASH.slice(0, 8);

// Marca se ESTA instalação já trocou a credencial principal por uma
// própria (ver copilotoAlterarCredenciaisPrincipais, mais abaixo) — usada
// só pra decidir se mostra o aviso "você ainda está usando a senha padrão
// de fábrica" (copilotoCredenciaisSaoPadrao). A troca em si já é garantida
// pela lógica de copilotoVerificarCredenciais logo abaixo (hashV2, uma vez
// sobrescrito com uma credencial nova, nunca mais confere com a antiga) —
// esta chave não participa da autenticação, só do aviso.
const COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY = 'copilotoCredenciaisPersonalizadas';

async function copilotoVerificarCredenciais(usuario, senha){
  const textoCompleto = `${(usuario||'').trim().toLowerCase()}|${senha||''}`;

  try{
    const dataV2 = await chrome.storage.local.get(COPILOTO_CREDENCIAIS_HASH_V2_KEY);
    const hashV2 = dataV2[COPILOTO_CREDENCIAIS_HASH_V2_KEY];
    if(hashV2) return copilotoVerificarHashSenhaForte(textoCompleto, hashV2);
  }catch(e){ /* segue pro fallback abaixo */ }

  const hashAntigo = await copilotoSha256Hex(textoCompleto);
  const ok = hashAntigo === COPILOTO_CREDENCIAIS_HASH;
  if(ok){
    try{
      const hashForte = await copilotoGerarHashSenhaForte(textoCompleto);
      await chrome.storage.local.set({ [COPILOTO_CREDENCIAIS_HASH_V2_KEY]: hashForte });
    }catch(e){}
  }
  return ok;
}

// Verdadeiro se esta instalação nunca trocou a credencial principal — ou
// seja, ainda aceita o usuário/senha padrão de fábrica, IDÊNTICO em toda
// instalação deste Copiloto (o mesmo hash fixo, COPILOTO_CREDENCIAIS_HASH,
// embutido no código-fonte de toda cópia distribuída). Usada só pra decidir
// se mostra o aviso de segurança — ver atualizarFaixaCredenciaisPadrao em
// panel.js.
async function copilotoCredenciaisSaoPadrao(){
  try{
    const data = await chrome.storage.local.get(COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY);
    return !data[COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY];
  }catch(e){ return true; }
}

// Troca o usuário/senha PRINCIPAL da Área restrita — a "chave-mestra" que,
// até esta função existir, era fixa no código-fonte e idêntica em toda
// instalação deste Copiloto, sem nenhuma forma de customizar por empresa.
// Exige a credencial ATUAL certa antes de trocar (a de fábrica serve pra
// isso, na primeira troca). Depois de trocada, a credencial antiga (a
// padrão de fábrica, igual em toda instalação) nunca mais autentica nesta
// instalação — copilotoVerificarCredenciais passa a confiar só no hash
// novo, sem nenhum caminho de volta pro hash fixo do código-fonte.
async function copilotoAlterarCredenciaisPrincipais(usuarioAtual, senhaAtual, novoUsuario, novaSenha){
  const credenciaisOk = await copilotoVerificarCredenciais(usuarioAtual, senhaAtual);
  if(!credenciaisOk) return { ok:false, erro: 'Usuário ou senha atuais incorretos.' };

  const usuarioLimpo = (novoUsuario || '').trim();
  if(!usuarioLimpo) return { ok:false, erro: 'Informe um novo usuário.' };
  if(!novaSenha || novaSenha.length < 6) return { ok:false, erro: 'A nova senha precisa ter pelo menos 6 caracteres.' };
  if(usuarioLimpo.toLowerCase() === (usuarioAtual||'').trim().toLowerCase() && novaSenha === senhaAtual){
    return { ok:false, erro: 'O novo usuário e senha precisam ser diferentes dos atuais.' };
  }

  const textoNovo = `${usuarioLimpo.toLowerCase()}|${novaSenha}`;
  const hashForte = await copilotoGerarHashSenhaForte(textoNovo);
  await chrome.storage.local.set({
    [COPILOTO_CREDENCIAIS_HASH_V2_KEY]: hashForte,
    [COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY]: true
  });
  return { ok:true };
}

async function copilotoMarcarAutenticado(){
  try{
    await chrome.storage.session.set({
      [COPILOTO_SESSAO_AUTH_KEY]: true,
      [COPILOTO_SESSAO_ATIVIDADE_KEY]: Date.now()
    });
  }catch(e){ /* ambiente sem chrome.storage.session — apenas segue sem lembrar sessão */ }
}

async function copilotoEncerrarSessao(){
  try{
    await chrome.storage.session.remove([COPILOTO_SESSAO_AUTH_KEY, COPILOTO_SESSAO_ATIVIDADE_KEY, COPILOTO_SESSAO_MODO_EQUIPE_KEY]);
  }catch(e){}
  await copilotoLimparChavesDaSessao();
}

// Retorna true só se autenticado E dentro do limite de inatividade.
// Se estiver autenticado mas inativo há tempo demais, já encerra a sessão sozinho.
async function copilotoEstaAutenticado(){
  try{
    const data = await chrome.storage.session.get([COPILOTO_SESSAO_AUTH_KEY, COPILOTO_SESSAO_ATIVIDADE_KEY]);
    if(!data[COPILOTO_SESSAO_AUTH_KEY]) return false;
    const ultimaAtividade = data[COPILOTO_SESSAO_ATIVIDADE_KEY] || 0;
    if(Date.now() - ultimaAtividade > COPILOTO_INATIVIDADE_LIMITE_MS){
      await copilotoEncerrarSessao();
      return false;
    }
    return true;
  }catch(e){
    return false;
  }
}

// ---------- Usuário lembrado (nunca a senha) ----------
// Guardado em chrome.storage.local (sobrevive ao fechar o navegador) só pra
// pré-preencher o campo de usuário nas próximas vezes — poupa a pessoa de
// redigitar o usuário toda hora, mantendo a senha sempre em branco.

async function copilotoSalvarUltimoUsuario(usuario){
  try{
    const limpo = (usuario || '').trim();
    if(!limpo) return;
    await chrome.storage.local.set({ [COPILOTO_ULTIMO_USUARIO_KEY]: limpo });
  }catch(e){}
}

async function copilotoObterUltimoUsuario(){
  try{
    const data = await chrome.storage.local.get(COPILOTO_ULTIMO_USUARIO_KEY);
    return data[COPILOTO_ULTIMO_USUARIO_KEY] || '';
  }catch(e){
    return '';
  }
}

// Preenche o campo de usuário indicado com o último usuário salvo (se
// houver e se o campo ainda estiver vazio) — a senha nunca é tocada aqui.
async function copilotoPreencherUsuarioSalvo(userInputId){
  const usuario = await copilotoObterUltimoUsuario();
  if(!usuario) return '';
  const input = document.getElementById(userInputId);
  if(input && !input.value) input.value = usuario;
  return usuario;
}

async function copilotoRegistrarAtividade(){
  try{
    const data = await chrome.storage.session.get(COPILOTO_SESSAO_AUTH_KEY);
    if(data[COPILOTO_SESSAO_AUTH_KEY]){
      await chrome.storage.session.set({ [COPILOTO_SESSAO_ATIVIDADE_KEY]: Date.now() });
    }
  }catch(e){}
}

// Marca atividade a cada interação, mas no máximo 1x a cada 20s (evita gravar sem parar).
// Protegido contra chamadas repetidas: se a pessoa fizer login de novo após a sessão
// expirar (sem recarregar a página), isso NÃO deve registrar os listeners de novo.
let _copilotoUltimoRegistroAtividade = 0;
let _copilotoMonitorandoAtividade = false;
function copilotoMonitorarAtividade(){
  if(_copilotoMonitorandoAtividade) return;
  _copilotoMonitorandoAtividade = true;
  const registrar = ()=>{
    const agora = Date.now();
    if(agora - _copilotoUltimoRegistroAtividade > 20000){
      _copilotoUltimoRegistroAtividade = agora;
      copilotoRegistrarAtividade();
    }
  };
  ['click','keydown','mousemove','scroll'].forEach(evt=>{
    document.addEventListener(evt, registrar, { passive: true });
  });
}

// Verifica periodicamente se a sessão expirou por inatividade; se sim, chama o callback
// (que deve travar a tela de volta). Protegido contra criar mais de um interval por página,
// mesmo que seja chamado de novo após um login repetido na mesma aba.
let _copilotoIntervaloInatividade = null;
function copilotoIniciarChecagemInatividade(callbackBloquear, intervaloMs){
  if(_copilotoIntervaloInatividade) return _copilotoIntervaloInatividade;
  _copilotoIntervaloInatividade = setInterval(async ()=>{
    const ok = await copilotoEstaAutenticado();
    if(!ok) callbackBloquear();
  }, intervaloMs || 60000);
  return _copilotoIntervaloInatividade;
}

// ---------- Criptografia de dados em repouso (AES-256-GCM) ----------
//
// CPF, e-mail, CEP, data de nascimento, notas e objetivo de cada lead, além
// das chaves de API de cada perfil, são guardados CIFRADOS — não só a senha
// (isso já era feito, ver PBKDF2 acima). Cada perfil tem sua própria chave
// de conteúdo (DEK, "Data Encryption Key"), gerada uma vez e nunca alterada
// — só a forma como ela fica "embrulhada" (cifrada por outra chave) muda
// quando a senha troca. Ver perfis.js pra como o DEK de cada perfil é
// embrulhado (pela própria senha, por um código de recuperação, e — pra
// perfis não-admin — também pela chave-mestra do administrador).
//
// A chave em si (DEK ou a chave-mestra do admin) só existe DESEMBRULHADA em
// chrome.storage.session — nunca em .local, nunca em texto puro salva em
// lugar nenhum. Isso derrota o ataque mais grave (abrir o DevTools sem
// nunca ter feito login nenhum: chrome.storage.session começa vazio) sem
// pedir senha de novo a cada troca de tela dentro da mesma sessão já
// autenticada (chrome.storage.session sobrevive à navegação entre
// panel.html e options.html, só some ao fechar o navegador — mesmo
// comportamento que "estou autenticado" já tem hoje).

// Gera uma chave AES-256-GCM nova e aleatória — usada tanto pro DEK de cada
// perfil quanto pra chave-mestra do administrador. Exportável de propósito
// (extractable:true): precisamos poder ler os bytes crus pra "embrulhar"
// (cifrar) essa chave com outra chave, como um cofre dentro de outro cofre.
async function copilotoGerarChaveAesAleatoria(){
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function copilotoExportarChaveHex(chave){
  const bytes = await crypto.subtle.exportKey('raw', chave);
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function copilotoImportarChaveHex(hex){
  return crypto.subtle.importKey('raw', copilotoHexParaBytes(hex), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// Deriva uma chave AES-256-GCM diretamente de um texto (senha, credencial
// geral, código de recuperação) via PBKDF2 — mesma ideia de
// copilotoGerarHashSenhaForte, mas devolvendo uma CHAVE utilizável pra
// cifrar/decifrar, não um hash pra comparar. Usa um salt e um "contexto"
// (`namespace`) próprios, sempre diferentes dos usados pro hash de
// autenticação da mesma senha — são propósitos distintos (provar quem é vs.
// destrancar dado cifrado) e não podem compartilhar material de chave.
async function copilotoDerivarChaveAesDeTexto(texto, saltHex, namespace, iteracoes){
  const chaveBase = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`${texto || ''}|${namespace}`), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: copilotoHexParaBytes(saltHex), iterations: iteracoes || COPILOTO_PBKDF2_ITERACOES, hash: 'SHA-256' },
    chaveBase, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

function copilotoBytesParaBase64(bytes){
  let binario = '';
  bytes.forEach((b) => { binario += String.fromCharCode(b); });
  return btoa(binario);
}

function copilotoBase64ParaBytes(base64){
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for(let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// Reconhece se um valor salvo é um pacote cifrado por copilotoCifrarAesGcm
// (formato "gcm:...") — usado tanto por panel.js (campos do lead) quanto
// por options.js (chaves de API), daí viver aqui, compartilhada.
function pareceCifrado(valor){
  return typeof valor === 'string' && valor.startsWith('gcm:');
}

// Cifra um texto com AES-GCM, devolvendo um pacote auto-contido em formato
// "gcm:<iv em base64>:<texto cifrado em base64>" — o IV (nonce) é aleatório
// a cada chamada (nunca reutilizado com a mesma chave, requisito do GCM) e
// vai junto, sem segredo nenhum nele.
async function copilotoCifrarAesGcm(chave, textoPlano){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytesCifrados = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, chave, new TextEncoder().encode(textoPlano || '')
  );
  return `gcm:${copilotoBytesParaBase64(iv)}:${copilotoBytesParaBase64(new Uint8Array(bytesCifrados))}`;
}

// Decifra um pacote gerado por copilotoCifrarAesGcm. Lança erro se a chave
// estiver errada (GCM detecta adulteração/chave errada por design — nunca
// devolve "lixo" sem avisar) ou se o formato não for reconhecido.
async function copilotoDecifrarAesGcm(chave, textoCifrado){
  const partes = (textoCifrado || '').split(':');
  if(partes.length !== 3 || partes[0] !== 'gcm') throw new Error('Formato cifrado inválido');
  const iv = copilotoBase64ParaBytes(partes[1]);
  const bytesCifrados = copilotoBase64ParaBytes(partes[2]);
  const bytesPlanos = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, chave, bytesCifrados);
  return new TextDecoder().decode(bytesPlanos);
}

// "Embrulha" (cifra) uma chave AES inteira com outra chave AES — é assim
// que o mesmo DEK de um perfil consegue ser aberto por MAIS de um caminho
// (a própria senha, um código de recuperação, a chave-mestra do admin):
// existe um embrulho por caminho, todos guardando a mesma chave por dentro,
// cada um só abrível por quem tem a chave certa daquele caminho específico.
async function copilotoEnvolverChave(chaveASerEnvolvida, chaveEnvolvedora){
  const hex = await copilotoExportarChaveHex(chaveASerEnvolvida);
  return copilotoCifrarAesGcm(chaveEnvolvedora, hex);
}

async function copilotoDesenvolverChave(envelopeCifrado, chaveEnvolvedora){
  const hex = await copilotoDecifrarAesGcm(chaveEnvolvedora, envelopeCifrado);
  return copilotoImportarChaveHex(hex);
}

// Monta o registro completo de um "embrulho por senha/credencial/código"
// (deriva a chave envolvedora do zero, com um salt novo, e já embrulha) —
// evita repetir os 3 passos (gerar salt, derivar, embrulhar) em cada lugar
// que precisa disso (criação de perfil, troca de senha, geração de código
// de recuperação, criação/rotação da chave-mestra do admin).
async function copilotoMontarEnvelopePorTexto(chaveASerEnvolvida, texto, namespace){
  const salt = await copilotoGerarSaltHex(16);
  const chaveEnvolvedora = await copilotoDerivarChaveAesDeTexto(texto, salt, namespace, COPILOTO_PBKDF2_ITERACOES);
  const cifrado = await copilotoEnvolverChave(chaveASerEnvolvida, chaveEnvolvedora);
  return { salt, iter: COPILOTO_PBKDF2_ITERACOES, cifrado };
}

// Desfaz um envelope montado por copilotoMontarEnvelopePorTexto — devolve a
// chave original, ou lança erro se o texto (senha/credencial/código)
// estiver errado.
async function copilotoAbrirEnvelopePorTexto(envelope, texto, namespace){
  const chaveEnvolvedora = await copilotoDerivarChaveAesDeTexto(texto, envelope.salt, namespace, envelope.iter);
  return copilotoDesenvolverChave(envelope.cifrado, chaveEnvolvedora);
}

// ---------- Sessão de chaves (DEK do perfil ativo + chave-mestra do admin) ----------
//
// Vivem só em chrome.storage.session, como hex — nunca em .local. Guardadas
// por perfil (o DEK) e uma só vez pra chave-mestra (não é por perfil, é da
// instalação inteira). Limpas sempre que a sessão de login termina (ver
// copilotoEncerrarSessao, chamado em logout manual, expiração por
// inatividade, e troca de perfil).
function copilotoChaveSessaoDek(perfilId){ return `copilotoDek_${perfilId}`; }
const COPILOTO_SESSAO_AMK_KEY = 'copilotoAmkAtiva';

async function copilotoGuardarDekNaSessao(perfilId, chaveDek){
  const hex = await copilotoExportarChaveHex(chaveDek);
  try{ await chrome.storage.session.set({ [copilotoChaveSessaoDek(perfilId)]: hex }); }catch(e){}
}

async function copilotoObterDekDaSessao(perfilId){
  try{
    const data = await chrome.storage.session.get(copilotoChaveSessaoDek(perfilId));
    const hex = data[copilotoChaveSessaoDek(perfilId)];
    return hex ? copilotoImportarChaveHex(hex) : null;
  }catch(e){ return null; }
}

async function copilotoGuardarAmkNaSessao(chaveAmk){
  const hex = await copilotoExportarChaveHex(chaveAmk);
  try{ await chrome.storage.session.set({ [COPILOTO_SESSAO_AMK_KEY]: hex }); }catch(e){}
}

async function copilotoObterAmkDaSessao(){
  try{
    const data = await chrome.storage.session.get(COPILOTO_SESSAO_AMK_KEY);
    const hex = data[COPILOTO_SESSAO_AMK_KEY];
    return hex ? copilotoImportarChaveHex(hex) : null;
  }catch(e){ return null; }
}

// Limpa só a chave-mestra (AMK) — chamada em copilotoLimparSessaoAdmin
// (perfis.js), quando a AUTORIDADE de admin da sessão é revogada de
// verdade (logout, inatividade). Deliberadamente separada de
// copilotoLimparChavesDaSessao (que limpa tudo, DEKs inclusive, só em fim
// de sessão de verdade): trocar de perfil mantendo a autoridade de admin
// (ver copilotoLimparPerfilAtivo) precisa que a AMK sobreviva a essa troca.
async function copilotoLimparAmkDaSessao(){
  try{ await chrome.storage.session.remove(COPILOTO_SESSAO_AMK_KEY); }catch(e){}
}

// Limpa a DEK de UM perfil específico — chamada em copilotoLimparPerfilAtivo
// (perfis.js) sempre que se sai desse perfil (troca de perfil, bloqueio por
// inatividade, logout). Ao contrário da AMK, a DEK de um perfil não precisa
// sobreviver à troca: o modo administrador não depende dela ficar guardada
// aqui, porque entrarNoPerfil já sabe redesembrulhá-la a partir da AMK
// quando precisa (ver entrarNoPerfil em panel.js). Sem isto, a DEK de
// qualquer perfil já aberto uma vez na sessão ficava disponível pro resto
// da sessão pra quem quer que rodasse código na página (ex.: console do
// navegador) chamar entrarNoPerfil(id) direto e entrar sem senha nenhuma.
async function copilotoLimparDekDaSessao(perfilId){
  try{ await chrome.storage.session.remove(copilotoChaveSessaoDek(perfilId)); }catch(e){}
}

// Limpa TODAS as chaves de sessão guardadas (todos os DEKs + a chave-mestra)
// — chamada junto de copilotoEncerrarSessao, nunca deixando uma chave de um
// perfil anterior sobreviver a um logout/expiração/troca de perfil.
async function copilotoLimparChavesDaSessao(){
  try{
    const tudo = await chrome.storage.session.get(null);
    const chaves = Object.keys(tudo).filter((k) => k.startsWith('copilotoDek_') || k === COPILOTO_SESSAO_AMK_KEY);
    if(chaves.length) await chrome.storage.session.remove(chaves);
  }catch(e){}
}

// Retorna o DEK do perfil ATIVO agora, se estiver disponível na sessão —
// null se não estiver (perfil impersonado que ainda não foi "alcançado"
// pela chave-mestra do admin, ver entrarNoPerfil em panel.js). Compartilhada
// entre panel.js e options.js (chrome.storage.session é o mesmo nas duas
// páginas) — chamada em todo lugar que precisa cifrar/decifrar um campo
// protegido (leads em panel.js, chaves de API em options.js).
async function obterDekAtivo(){
  const id = await copilotoPerfilAtivoId();
  return id ? copilotoObterDekDaSessao(id) : null;
}

// ---------- Acessibilidade dos modais: Tab não escapa pro fundo ----------
// Sem isto, dava pra apertar Tab repetidamente dentro de QUALQUER modal
// aberto (qualquer .modal-overlay do painel, ou o .palavra-chave-overlay
// compartilhado com Configurações) e o foco escapava pros campos da tela de
// trás — ainda totalmente focáveis e digitáveis, só cobertos visualmente
// pelo overlay — produzindo um estado confuso de "digitando em dois
// lugares ao mesmo tempo" sem nenhum indício visual disso. Um único
// listener cobre as duas páginas, porque roda daqui (auth.js).
function copilotoOverlayVisivel(el){
  return !!el && getComputedStyle(el).display !== 'none';
}

function copilotoOverlayAberto(){
  const overlays = document.querySelectorAll('.modal-overlay, .palavra-chave-overlay');
  for(const el of overlays){
    if(copilotoOverlayVisivel(el)) return el;
  }
  return null;
}

function copilotoFocaveisDentroDe(container){
  const seletor = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(seletor)).filter((el) => el.offsetParent !== null);
}

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Tab') return;
  const overlay = copilotoOverlayAberto();
  if(!overlay) return;
  const focaveis = copilotoFocaveisDentroDe(overlay);
  if(!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const focoDentro = overlay.contains(document.activeElement);
  if(e.shiftKey){
    if(!focoDentro || document.activeElement === primeiro){
      e.preventDefault();
      ultimo.focus();
    }
  }else{
    if(!focoDentro || document.activeElement === ultimo){
      e.preventDefault();
      primeiro.focus();
    }
  }
});

// ---------- Pequenos helpers de UI compartilhados entre panel.html e options.html ----------

// Mostra uma mensagem curta e passageira no canto da tela (usa o elemento
// #toast, presente em ambas as páginas).
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

// Faz a tecla Enter, dentro de um campo específico, disparar uma ação
// (ex: confirmar login, adicionar lead).
function bindEnterKey(elementId, fn){
  document.getElementById(elementId).addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') fn();
  });
}

// Faixa de aviso mostrada no topo do painel e de Configurações sempre que o
// administrador geral está dentro do perfil de OUTRO profissional — deixa
// claro, o tempo todo, de quem são os dados na tela agora, pra nunca
// confundir "meus dados" com "dados de quem estou ajudando" (ex.: criar um
// lead sem querer no perfil errado). Presente idêntica nas duas páginas
// (mesmos ids #adminImpersonandoFaixa/#adminImpersonandoTexto).
async function atualizarFaixaAdminImpersonando(){
  const faixa = document.getElementById('adminImpersonandoFaixa');
  if(!faixa) return;
  const [sessaoEhAdmin, perfilAtivo] = await Promise.all([copilotoSessaoEhAdmin(), copilotoObterPerfilAtivo()]);
  const impersonando = sessaoEhAdmin && perfilAtivo && !perfilAtivo.admin;
  faixa.classList.toggle('show', impersonando);
  if(impersonando){
    document.getElementById('adminImpersonandoTexto').textContent =
      `Modo administrador — você está vendo e editando o perfil de ${perfilAtivo.nome}.`;
  }
}

// ---------- Revelação de um código alfanumérico gerado pelo sistema ----------
// Mostra o código uma única vez, num modal por cima de tudo, e só deixa
// fechar depois de marcar "já guardei em local seguro" — não tem botão de
// fechar nem clique fora que pule essa confirmação. Presente idêntica no
// painel e em Configurações (mesmos ids #palavraChaveOverlay etc. — nome
// interno do DOM, mantido como está pra não precisar renomear ids em duas
// telas por um detalhe que não aparece pro usuário). `titulo`/`subtitulo`
// são opcionais — sem eles, mostra um texto genérico. Reaproveitada por
// mostrarCodigoRecuperacaoModal (perfil comum) e mostrarPinAdminModal
// (administrador) logo abaixo, cada uma com o texto certo pro seu caso —
// a mecânica ("mostra uma vez, só fecha confirmando que guardou") é
// idêntica nos dois.
function mostrarPalavraChaveModal(codigo, opcoes){
  opcoes = opcoes || {};
  return new Promise((resolve)=>{
    const overlay = document.getElementById('palavraChaveOverlay');
    const checkbox = document.getElementById('palavraChaveConfirmaCheckbox');
    const fecharBtn = document.getElementById('palavraChaveFecharBtn');
    const tituloEl = document.getElementById('palavraChaveTitulo');
    const subtituloEl = document.getElementById('palavraChaveSub');
    if(tituloEl) tituloEl.textContent = opcoes.titulo || 'Guarde seu código';
    if(subtituloEl) subtituloEl.textContent = opcoes.subtitulo || 'Este código só aparece agora, uma única vez. Guarde em um local seguro.';
    document.getElementById('palavraChaveCodigo').textContent = codigo;
    checkbox.checked = false;
    fecharBtn.disabled = true;
    overlay.classList.add('show');

    const onCheck = () => { fecharBtn.disabled = !checkbox.checked; };
    const onFechar = () => {
      overlay.classList.remove('show');
      checkbox.removeEventListener('change', onCheck);
      fecharBtn.removeEventListener('click', onFechar);
      resolve();
    };
    checkbox.addEventListener('change', onCheck);
    fecharBtn.addEventListener('click', onFechar);
  });
}

// Código de recuperação de um perfil COMUM (não-admin) — permite recuperar
// CPF, e-mail, CEP, nascimento, notas e chaves de API do perfil (dados
// cifrados) se a senha for esquecida, sem precisar do administrador (ver
// copilotoRecuperarSenhaComCodigo em perfis.js).
function mostrarCodigoRecuperacaoModal(codigo){
  return mostrarPalavraChaveModal(codigo, {
    titulo: 'Guarde seu código de recuperação',
    subtitulo: 'Este código só aparece agora, uma única vez. Sem ele, se você esquecer a senha, o administrador pode redefinir seu acesso, mas os dados protegidos deste perfil (CPF, e-mail, CEP, nascimento, notas e chaves de API) podem se perder. Guarde em um local seguro, fora do computador.'
  });
}

// PIN alfanumérico do administrador — o MESMO código de recuperação que
// qualquer perfil ganha (ver copilotoGerarCodigoAlfanumerico em perfis.js),
// só que pro admin ele acumula um segundo uso: além de recuperar o acesso
// se a senha for esquecida (junto com o usuário/senha geral do sistema, na
// tela "Esqueci minha senha" — ver copilotoRecuperarSenhaAdmin), também é
// exigido pra trocar a própria senha normalmente (ver
// copilotoAlterarSenhaPerfil). Não é um segundo segredo pra guardar — é o
// mesmo código com dois usos, por isso um único modal na criação/troca de
// senha do admin, não dois.
function mostrarPinAdminModal(codigo){
  return mostrarPalavraChaveModal(codigo, {
    titulo: 'Salve o seu PIN alfanumérico',
    subtitulo: 'Este PIN só aparece agora, uma única vez. Você vai precisar dele para: trocar sua senha, recuperar o acesso se esquecê-la, e manter o acesso aos dados protegidos dos outros perfis (modo administrador). Guarde em um local seguro, fora do computador.'
  });
}

document.getElementById('palavraChaveCopiarBtn').addEventListener('click', async ()=>{
  const codigo = document.getElementById('palavraChaveCodigo').textContent;
  try{
    await navigator.clipboard.writeText(codigo);
    toast('Copiado');
  }catch(e){
    toast('Não consegui copiar automaticamente — selecione e copie manualmente');
  }
});

// Tenta autenticar com o usuário/senha dos campos indicados. Em caso de
// sucesso, marca a sessão e roda `aoAutenticar`. Em caso de falha, escreve a
// mensagem de erro padrão, dispara a animação de "shake" no elemento
// indicado, limpa e refoca o campo de senha.
//
// Antes esta sequência (verificar -> shake -> limpar -> refocar) estava
// copiada quase igual em 3 lugares (login de tela cheia do painel, modal
// avançado do painel, e login das configurações) — cada cópia com seu
// próprio seletor de DOM, o que é fácil de deixar dessincronizado se o HTML
// de um deles mudar e o dos outros não. Agora é uma função só.
// ---------- Credencial de equipe (acesso restrito, opcional) ----------
//
// Uma SEGUNDA credencial da Área restrita, independente da principal
// (COPILOTO_CREDENCIAIS_HASH) — quem entra com ela vê a tela de perfis SEM
// o perfil administrador (fica oculto) e SEM o botão de cadastrar novo
// perfil. Existe pra dar acesso à equipe sem precisar entregar a
// credencial "raiz" — configurável pelo administrador em Avançado, nunca
// fixa no código (assim dá pra trocar/desligar quando quiser, ex.: quando
// alguém sai da equipe). Não participa da criptografia de dados nenhuma:
// só decide o que aparece na tela de perfis, não abre nenhum DEK/AMK — ver
// COPILOTO_SESSAO_MODO_EQUIPE_KEY logo abaixo.
const COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY = 'copilotoCredenciaisEquipeHash';
const COPILOTO_SESSAO_MODO_EQUIPE_KEY = 'copilotoModoEquipe';

async function copilotoEquipeConfigurada(){
  try{
    const data = await chrome.storage.local.get(COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY);
    return !!data[COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY];
  }catch(e){ return false; }
}

async function copilotoDefinirCredenciaisEquipe(usuario, senha){
  const usuarioLimpo = (usuario||'').trim();
  if(!usuarioLimpo || !senha || senha.length < 4){
    return { ok:false, erro: 'Informe um usuário e uma senha com pelo menos 4 caracteres.' };
  }
  const hash = await copilotoGerarHashSenhaForte(`${usuarioLimpo.toLowerCase()}|${senha}`);
  await chrome.storage.local.set({ [COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY]: hash });
  return { ok:true };
}

async function copilotoRemoverCredenciaisEquipe(){
  try{ await chrome.storage.local.remove(COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY); }catch(e){}
}

async function copilotoVerificarCredenciaisEquipe(usuario, senha){
  const data = await chrome.storage.local.get(COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY);
  const hash = data[COPILOTO_CREDENCIAIS_EQUIPE_HASH_KEY];
  if(!hash) return false;
  const texto = `${(usuario||'').trim().toLowerCase()}|${senha||''}`;
  return copilotoVerificarHashSenhaForte(texto, hash);
}

async function copilotoDefinirModoEquipe(valor){
  try{ await chrome.storage.session.set({ [COPILOTO_SESSAO_MODO_EQUIPE_KEY]: !!valor }); }catch(e){}
}

async function copilotoEstaEmModoEquipe(){
  try{
    const data = await chrome.storage.session.get(COPILOTO_SESSAO_MODO_EQUIPE_KEY);
    return !!data[COPILOTO_SESSAO_MODO_EQUIPE_KEY];
  }catch(e){ return false; }
}

// Chave única de bloqueio por tentativas erradas pra QUALQUER tela que pede
// a credencial geral (usuário/senha da Área restrita, principal ou de
// equipe) — painel, Configurações, Avançado e a confirmação de reset total
// (ver os 4 chamadores de copilotoTentarLogin). De propósito uma chave SÓ,
// compartilhada entre as 4: são a mesma credencial sendo adivinhada, então
// contam pro MESMO limite de 3 tentativas — trocar de tela no meio não pode
// "zerar" o contador, senão o bloqueio vira decorativo. Reaproveita o
// mecanismo já existente pras senhas de perfil (copilotoRegistrarTentativaFalha
// etc., perfis.js) — mesmo limite, mesmo tempo de bloqueio (60s).
const COPILOTO_LOCKOUT_AREA_RESTRITA = 'copiloto_area_restrita';

// Mostra (e conta regressivamente sozinho) o bloqueio por tentativas
// erradas numa tela de login genérica — mesma ideia de mostrarBloqueioSenhaPerfil
// em panel.js, só que parametrizada pelos ids de quem chamou, pra servir
// qualquer uma das 4 telas que usam copilotoTentarLogin.
let _copilotoLockoutInterval = null;
function copilotoMostrarBloqueioAreaRestrita(passInputId, submitBtnId, errorId, restanteMs){
  const input = document.getElementById(passInputId);
  const btn = submitBtnId ? document.getElementById(submitBtnId) : null;
  const errorEl = document.getElementById(errorId);
  input.disabled = true;
  if(btn) btn.disabled = true;

  let restanteSeg = Math.max(1, Math.ceil(restanteMs / 1000));
  const atualizarTexto = () => {
    errorEl.textContent = `Muitas tentativas erradas. Tente novamente em ${restanteSeg}s.`;
    errorEl.style.display = 'block';
  };
  atualizarTexto();

  clearInterval(_copilotoLockoutInterval);
  _copilotoLockoutInterval = setInterval(()=>{
    restanteSeg -= 1;
    if(restanteSeg <= 0){
      clearInterval(_copilotoLockoutInterval);
      input.disabled = false;
      if(btn) btn.disabled = false;
      errorEl.style.display = 'none';
      input.value = '';
      input.focus();
      return;
    }
    atualizarTexto();
  }, 1000);
}

// Chamada quando uma tela de login (Área restrita/Avançado/confirmação de
// reset) abre ou fica visível de novo — se já estava bloqueada por
// tentativas erradas de ANTES (ex.: bloqueou numa tela e a pessoa foi pra
// outra), mostra o cronômetro na hora, em vez de deixar o campo digitável
// até a próxima tentativa falhar.
async function copilotoChecarBloqueioAreaRestrita(passInputId, submitBtnId, errorId){
  const status = await copilotoStatusBloqueioSenha(COPILOTO_LOCKOUT_AREA_RESTRITA);
  if(status.bloqueado) copilotoMostrarBloqueioAreaRestrita(passInputId, submitBtnId, errorId, status.restanteMs);
  return status.bloqueado;
}

async function copilotoTentarLogin({ userInputId, passInputId, errorId, submitBtnId, shakeEl, aoAutenticar }){
  // Confere ANTES de verificar a senha — evita gastar um PBKDF2 (e, mais
  // importante, contar mais uma tentativa) enquanto já está bloqueado.
  const statusAtual = await copilotoStatusBloqueioSenha(COPILOTO_LOCKOUT_AREA_RESTRITA);
  if(statusAtual.bloqueado){
    copilotoMostrarBloqueioAreaRestrita(passInputId, submitBtnId, errorId, statusAtual.restanteMs);
    return false;
  }

  const usuario = document.getElementById(userInputId).value;
  const senha = document.getElementById(passInputId).value;
  let ok = await copilotoVerificarCredenciais(usuario, senha);
  if(ok){
    await copilotoDefinirModoEquipe(false);
  }else{
    // Só tenta a credencial de equipe se a principal falhou — evita duas
    // verificações de hash à toa no caminho comum (login com a credencial
    // real, que é o de longe mais frequente).
    ok = await copilotoVerificarCredenciaisEquipe(usuario, senha);
    if(ok) await copilotoDefinirModoEquipe(true);
  }
  if(ok){
    await copilotoLimparTentativas(COPILOTO_LOCKOUT_AREA_RESTRITA);
    await copilotoMarcarAutenticado();
    await copilotoSalvarUltimoUsuario(usuario);
    if(aoAutenticar) await aoAutenticar();
  }else{
    const estado = await copilotoRegistrarTentativaFalha(COPILOTO_LOCKOUT_AREA_RESTRITA);
    document.getElementById(passInputId).value = '';

    if(estado.bloqueadoAte > Date.now()){
      copilotoMostrarBloqueioAreaRestrita(passInputId, submitBtnId, errorId, estado.bloqueadoAte - Date.now());
    }else{
      const errorEl = document.getElementById(errorId);
      const restantes = COPILOTO_TENTATIVAS_MAX - estado.tentativas;
      // Reescreve sempre a mesma mensagem: o elemento de erro pode estar
      // mostrando outro texto no momento (ex.: "sessão expirada por
      // inatividade"), e uma tentativa de login que falha deve substituir
      // isso pelo aviso de credenciais inválidas.
      errorEl.textContent = `Acesso negado. Mais ${restantes} tentativa${restantes===1?'':'s'} e o campo será bloqueado por 60s.`;
      errorEl.style.display = 'block';
      if(shakeEl){
        shakeEl.classList.remove('shake');
        void shakeEl.offsetWidth;
        shakeEl.classList.add('shake');
      }
      document.getElementById(passInputId).focus();
    }
  }
  return ok;
}
