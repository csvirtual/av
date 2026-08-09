// ---------- Autenticação compartilhada (usada em panel.html e options.html) ----------
// Fonte única da senha e da lógica de sessão — evita ter que atualizar hash em 2 arquivos.

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

// Versão forte (PBKDF2) do usuário/senha da Área restrita — cada instalação
// gera a sua própria já no primeiro uso (ver copilotoGarantirCredencialInicial,
// mais abaixo) ou quando o admin troca por conta própria
// (copilotoAlterarCredenciaisPrincipais). Não existe mais nenhum hash fixo
// de fábrica no código-fonte: sem este valor gravado, não há credencial
// válida nenhuma pra esta instalação.
const COPILOTO_CREDENCIAIS_HASH_V2_KEY = 'copilotoCredenciaisHashV2';

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
  }catch(e){ /* sem hash gravado ainda ou storage indisponível — sem credencial válida */ }

  return false;
}

// Verdadeiro se esta instalação ainda usa a credencial aleatória gerada
// automaticamente no primeiro uso (ver copilotoGarantirCredencialInicial) —
// ou seja, o admin nunca trocou por uma própria. Usada só pra decidir se
// mostra o aviso de segurança — ver atualizarFaixaCredenciaisPadrao em
// panel.js.
async function copilotoCredenciaisSaoPadrao(){
  try{
    const data = await chrome.storage.local.get(COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY);
    return !data[COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY];
  }catch(e){ return true; }
}

// Troca o usuário/senha PRINCIPAL da Área restrita — a "chave-mestra" desta
// instalação, gerada aleatoriamente no primeiro uso (ver
// copilotoGarantirCredencialInicial). Exige a credencial ATUAL certa antes
// de trocar. Depois de trocada, a credencial anterior nunca mais autentica
// nesta instalação — copilotoVerificarCredenciais passa a confiar só no
// hash novo.
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

// ---------- Credencial inicial gerada por instalação ----------
//
// Cada instalação nova gera sua PRÓPRIA credencial aleatória já no primeiro
// uso (nunca duas instalações compartilham a mesma senha) e já grava direto
// o hash forte (PBKDF2) como a única credencial V2 válida — não existe mais
// nenhum hash fixo no código-fonte, nem caminho de fallback: sem este
// registro gravado, nenhum usuário/senha autentica nesta instalação. A
// senha em texto puro é mostrada pro admin exatamente uma vez, na tela de
// login, e apagada do storage assim que confirmada ou usada no primeiro
// login (nunca persiste em disco depois disso).
const COPILOTO_CREDENCIAL_INICIAL_KEY = 'copilotoCredencialInicialPendente'; // chrome.storage.local — texto puro, só até ser vista/confirmada
const COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY = 'copilotoCredencialInicialJaGerada'; // marca que esta instalação já passou por aqui — nunca gera (nem troca) duas vezes

function copilotoGerarSenhaAleatoria(tamanho){
  // Alfabeto sem caracteres ambíguos (0/O, 1/l/I) — esta senha é lida e
  // digitada por humano, direto da tela.
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  // Rejeição de amostra: 256 não é múltiplo de 54, então `byte % 54` puro
  // deixaria os primeiros 40 caracteres do alfabeto um pouco mais prováveis
  // que os 14 últimos. Descartar os bytes acima do maior múltiplo de 54
  // (216) tira esse viés — a senha fica com os 5,75 bits por caractere
  // cheios, sem depender de sorte.
  const limite = Math.floor(256 / alfabeto.length) * alfabeto.length;
  let senha = '';
  while(senha.length < tamanho){
    const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
    for(let i = 0; i < bytes.length && senha.length < tamanho; i++){
      if(bytes[i] < limite) senha += alfabeto[bytes[i] % alfabeto.length];
    }
  }
  return senha;
}

// Chamada no boot do painel/configurações, antes de mostrar a tela de
// login. Idempotente: só gera (e só grava hash novo) na PRIMEIRA vez que
// roda numa instalação — se já gerou antes, ou se o admin já tem uma
// credencial própria/migrada, não faz nada e devolve null.
//
// RISCO DE CORRIDA ENTRE ABAS, tratado abaixo: panel.html e options.html
// são páginas DIFERENTES, cada uma com sua própria trava de "aba
// duplicada" (ver aba-unica.js) — então nada impede as duas de estarem
// oficialmente abertas AO MESMO TEMPO (ex.: o Chrome restaura as duas ao
// reabrir depois de fechar, ou a pessoa abre Configurações numa aba nova
// bem no instante em que o painel também está carregando pela primeira
// vez). Se as duas chamarem esta função quase juntas, cada uma lê "nada
// gerado ainda", e cada uma gera E GRAVA sua própria senha aleatória — a
// leitura de PBKDF2 (210 mil iterações) entre o "cheguei primeiro" e o
// "gravei" alarga essa janela o bastante pra isso acontecer na prática,
// não só em teoria. Sem tratamento, uma das duas abas mostra (e a pessoa
// copia) uma senha que NÃO é a que ficou gravada de fato — instalação nova
// trancada pela própria extensão, antes mesmo do primeiro uso.
//
// chrome.storage não oferece uma trava atômica entre abas — não existe
// "escreva só se ninguém escreveu depois que eu li" nesta API. A correção
// possível do lado do cliente é RECONCILIAR depois de escrever: relê a
// chave logo após o set() e devolve o que estiver gravado DE FATO, nunca o
// valor que esta chamada gerou localmente. Não fecha 100% a janela (ainda
// existe uma fração de segundo entre o set() e o get() de conferência),
// mas encolhe o problema de "duas senhas divergentes coexistindo" para "a
// última escrita vence, e todo mundo que checa depois dela concorda" — que
// é o que já vale, sem trava nenhuma, pro resto do chrome.storage.
async function copilotoGarantirCredencialInicial(){
  try{
    const dados = await chrome.storage.local.get([
      COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY,
      COPILOTO_CREDENCIAIS_HASH_V2_KEY,
      COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY
    ]);
    if(dados[COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY]) return null;
    if(dados[COPILOTO_CREDENCIAIS_HASH_V2_KEY]) return null; // já tem credencial gravada (gerada antes, ou trocada pelo admin)
    if(dados[COPILOTO_CREDENCIAIS_PERSONALIZADAS_KEY]) return null;

    // panel.html e options.html podem estar as duas oficialmente abertas ao
    // mesmo tempo (são páginas diferentes — ver aba-unica.js, que só evita
    // DUPLICATA da MESMA página). Sem uma trava real, as duas fariam a
    // checagem acima juntas, cada uma leria "ainda não existe" e cada uma
    // geraria/gravaria sua própria senha — confirmado com um teste antes
    // desta correção. Por isso quem decide QUEM gera é o service worker
    // (background.js), o único ponto que as duas páginas de fato
    // compartilham, via uma fila que serializa de verdade (não uma
    // reconciliação depois do fato, que não fecha a janela). Se a
    // mensageria falhar por algum motivo (raro), segue como se tivesse
    // vencido — mesma filosofia de "não travar quem tem uso legítimo" da
    // checagem de aba duplicada.
    let vencedor = true;
    try{
      const resposta = await chrome.runtime.sendMessage({ tipo: 'copilotoReivindicarGeracaoCredencialInicial' });
      vencedor = !!(resposta && resposta.vencedor);
    }catch(e){ /* sem mensageria — segue sozinha, como sempre foi */ }

    if(!vencedor){
      // Perdeu a corrida: outra aba está gerando (ou acabou de gerar) agora
      // mesmo. Nunca gera a própria — espera a dela aparecer no storage.
      return await copilotoEsperarCredencialInicialPendente();
    }

    // "@root" e não "admin": deixa claro, só de olhar, que esta é a
    // credencial-raiz da INSTALAÇÃO — a que abre a Área restrita — e não a
    // senha de um perfil administrador, que é outra coisa e vem depois. Os
    // dois conceitos convivem no produto, e chamar este de "admin" fazia os
    // dois disputarem o mesmo nome.
    const usuario = '@root';
    const senha = copilotoGerarSenhaAleatoria(12);
    // .toLowerCase() aqui porque copilotoVerificarCredenciais SEMPRE
    // normaliza o que foi digitado antes de comparar. Enquanto o usuário
    // padrão foi 'admin' os dois batiam por acaso (já era minúsculo); um
    // padrão futuro com maiúscula geraria um hash que nenhum login
    // conseguiria reproduzir — instalação nova, credencial correta na mão,
    // e "usuário ou senha incorretos" pra sempre.
    const hashForte = await copilotoGerarHashSenhaForte(`${usuario.toLowerCase()}|${senha}`);

    await chrome.storage.local.set({
      [COPILOTO_CREDENCIAIS_HASH_V2_KEY]: hashForte,
      [COPILOTO_CREDENCIAL_INICIAL_GERADA_KEY]: true,
      [COPILOTO_CREDENCIAL_INICIAL_KEY]: { usuario, senha }
    });
    return { usuario, senha };
  }catch(e){ return null; }
}

// Usada só por quem PERDEU a reivindicação acima: a credencial já está
// sendo gerada por outra aba, mas o PBKDF2 (210 mil iterações) leva um
// instante — espera aparecer no storage em vez de devolver null na hora
// (o que faria esta aba simplesmente não mostrar credencial nenhuma).
// ~6s de tentativas, bem acima do que PBKDF2 leva em qualquer máquina
// real; se mesmo assim não aparecer (a aba vencedora travou ou fechou no
// meio do caminho), desiste e devolve null — próxima vez que qualquer aba
// checar, a reivindicação expirada (ver COPILOTO_CRED_INICIAL_CLAIM_EXPIRA_MS
// em background.js) libera alguém pra tentar de novo.
async function copilotoEsperarCredencialInicialPendente(){
  for(let i = 0; i < 40; i++){
    const pendente = await copilotoLerCredencialInicialPendente();
    if(pendente) return pendente;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

// Lê (sem apagar) a credencial recém-gerada ainda pendente de exibição —
// usada pra desenhar o aviso na tela de login mesmo que a pessoa tenha
// recarregado a página antes de copiar/guardar a senha. null se não houver
// nenhuma pendente.
async function copilotoLerCredencialInicialPendente(){
  try{
    const data = await chrome.storage.local.get(COPILOTO_CREDENCIAL_INICIAL_KEY);
    return data[COPILOTO_CREDENCIAL_INICIAL_KEY] || null;
  }catch(e){ return null; }
}

// Apaga o texto puro da credencial inicial do storage — chamada quando o
// admin confirma que já copiou/guardou a senha, e também automaticamente
// no primeiro login bem-sucedido (só teria conseguido logar com ela lendo
// da tela). Garante que a senha em texto puro nunca fica em disco além do
// estritamente necessário.
async function copilotoConfirmarCredencialInicialVista(){
  try{ await chrome.storage.local.remove(COPILOTO_CREDENCIAL_INICIAL_KEY); }catch(e){}
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
  // Um confirm()/alert() NATIVO travava a aba inteira — nenhum outro
  // código (inclusive o timer de inatividade) rodava enquanto um estivesse
  // aberto, então a sessão nunca expirava "por baixo" de um diálogo. O
  // modal próprio (copilotoConfirmar/copilotoAvisar, logo abaixo) é
  // assíncrono de propósito — mas isso abre uma janela real: se a
  // inatividade vencer (ou alguém clicar "Sair") com um "Excluir perfil?"
  // ainda aberto na tela, sem isto aqui o diálogo continuaria visível E
  // CLICÁVEL por cima da tela de login que reaparece atrás dele. A ação
  // em si já seria barrada (toda função sensível de perfis.js confere a
  // própria autoridade de novo, não confia só na tela ter checado antes)
  // — mas um botão de exclusão permanente clicável em cima de uma sessão
  // que já devia estar trancada é exatamente o tipo de coisa que não pode
  // sobrar, mesmo com a rede de segurança por trás. Fecha primeiro,
  // resolvendo como cancelado — só depois derruba a sessão.
  copilotoFecharModalDecisaoAberto();
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

// ---------- Modal da credencial inicial (bloqueante) ----------
//
// Esta senha existe UMA vez. Depois de confirmada ela é apagada, e não há
// como recuperá-la: o reset geral também exige a credencial, e "Esqueci
// minha senha" só cobre a senha de perfil. Perder esta tela = instalação
// inacessível, com os dados intactos e inalcançáveis do outro lado.
//
// Por isso ela não é mais um aviso ao lado do formulário, que dava pra
// ignorar e sair digitando: é um modal que cobre a tela inteira e não fecha
// por Esc, nem por clique fora, nem por botão de X — só pela sequência
// copiar → já guardei. O "Já guardei" nasce desabilitado justamente pra
// que confirmar sem ter copiado não seja um clique possível.
//
// Vive aqui, em auth.js, porque as DUAS telas de login (painel e
// Configurações) precisam dele — e antes cada uma carregava a sua própria
// cópia do markup e dos handlers.

function copilotoMontarModalCredencialInicial(){
  if(document.getElementById('credencialInicialOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'cred-inicial-overlay';
  overlay.id = 'credencialInicialOverlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'credencialInicialTitulo');
  overlay.innerHTML = `
    <div class="cred-inicial-card">
      <div class="cred-inicial-icone">🔑</div>
      <h2 class="cred-inicial-titulo" id="credencialInicialTitulo">Guarde a credencial desta instalação</h2>
      <p class="cred-inicial-sub">Ela foi gerada agora, só para este computador, e aparece <b>uma única vez</b>. É com ela que você entra no Co-piloto.</p>

      <div class="cred-inicial-campos">
        <div class="cred-inicial-campo">
          <span class="cred-inicial-rotulo">Usuário:</span>
          <span class="cred-inicial-valor" id="credencialInicialUsuario"></span>
        </div>
        <div class="cred-inicial-campo">
          <span class="cred-inicial-rotulo">Senha:</span>
          <span class="cred-inicial-valor" id="credencialInicialSenha"></span>
        </div>
      </div>

      <div class="cred-inicial-alerta">
        <b>Não existe como recuperá-la.</b> Se esta senha se perder, a instalação fica inacessível — os dados continuam aqui, mas ninguém abre.
      </div>

      <button type="button" class="btn secondary cred-inicial-btn" id="credencialInicialCopiarBtn">📋 Copiar usuário e senha</button>
      <button type="button" class="btn purple cred-inicial-btn" id="credencialInicialOkBtn" disabled>Já guardei em lugar seguro</button>
      <div class="cred-inicial-dica" id="credencialInicialDica">Copie primeiro — é o que libera o botão acima.</div>
    </div>`;
  document.body.appendChild(overlay);
}

// Mostra o modal e só resolve quando a pessoa concluir a sequência. Recebe
// o id do campo de usuário da tela que chamou, pra já deixá-lo preenchido
// quando o modal sair da frente.
function copilotoAbrirModalCredencialInicial(pendente, usuarioInputId){
  return new Promise((resolve)=>{
    copilotoMontarModalCredencialInicial();
    const overlay  = document.getElementById('credencialInicialOverlay');
    const copiarBtn = document.getElementById('credencialInicialCopiarBtn');
    const okBtn     = document.getElementById('credencialInicialOkBtn');
    const dica      = document.getElementById('credencialInicialDica');
    document.getElementById('credencialInicialUsuario').textContent = pendente.usuario;
    document.getElementById('credencialInicialSenha').textContent = pendente.senha;
    overlay.classList.add('show');
    document.body.classList.add('modal-open');
    document.body.classList.add('cred-inicial-aberto');
    // Foco no próximo quadro, não num setTimeout de milissegundos chutados:
    // o overlay acabou de sair de display:none e só é focável depois que o
    // estilo é recalculado. requestAnimationFrame espera exatamente isso —
    // nem um quadro a mais, nem o risco de o número chutado ser curto demais
    // numa máquina lenta e o foco cair no corpo da página.
    requestAnimationFrame(()=>copiarBtn.focus());

    const liberar = (mensagem, classe) => {
      okBtn.disabled = false;
      dica.textContent = mensagem;
      dica.className = 'cred-inicial-dica ' + (classe || 'ok');
    };

    const onCopiar = async () => {
      const texto = `Co-piloto de vendas — credencial da Área restrita\nUsuário: ${pendente.usuario}\nSenha: ${pendente.senha}`;
      try{
        await navigator.clipboard.writeText(texto);
        copiarBtn.textContent = '✅ Copiado';
        liberar('Copiado. Cole agora em um gerenciador de senhas ou anote — a área de transferência se perde fácil.', 'ok');
      }catch(e){
        // A escrita na área de transferência pode falhar (permissão negada,
        // foco perdido). Se o botão continuasse travado nesse caso, a pessoa
        // ficaria presa nesta tela pra sempre, com a instalação nova
        // inutilizável — o oposto do que este modal existe pra evitar. Então
        // seleciona o texto pra ela copiar na mão e libera assim mesmo.
        copilotoSelecionarTextoDoElemento(document.querySelector('.cred-inicial-campos'));
        copiarBtn.textContent = '📋 Tentar copiar de novo';
        liberar('Não consegui copiar sozinho — o texto acima já está selecionado, use Ctrl+C (ou ⌘+C).', 'aviso');
      }
    };

    const onOk = async () => {
      if(okBtn.disabled) return;
      await copilotoConfirmarCredencialInicialVista();
      overlay.classList.remove('show');
      document.body.classList.remove('modal-open');
      document.body.classList.remove('cred-inicial-aberto');
      copiarBtn.removeEventListener('click', onCopiar);
      okBtn.removeEventListener('click', onOk);
      document.removeEventListener('keydown', onTecla, true);
      const campoUsuario = usuarioInputId ? document.getElementById(usuarioInputId) : null;
      if(campoUsuario){
        campoUsuario.value = pendente.usuario;
        campoUsuario.focus();
      }
      resolve();
    };

    // Esc não fecha (é a saída fácil que anularia a trava) e o Tab fica
    // preso nos três elementos do card — sem isso o foco escaparia pros
    // campos de login atrás do fundo escurecido, que é justamente o que
    // este modal existe pra impedir.
    const onTecla = (ev) => {
      if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); return; }
      if(ev.key !== 'Tab') return;
      const focaveis = [copiarBtn, okBtn].filter((el) => !el.disabled);
      if(!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if(ev.shiftKey && document.activeElement === primeiro){ ev.preventDefault(); ultimo.focus(); }
      else if(!ev.shiftKey && document.activeElement === ultimo){ ev.preventDefault(); primeiro.focus(); }
      else if(!focaveis.includes(document.activeElement)){ ev.preventDefault(); primeiro.focus(); }
    };

    // Clicar no fundo escurecido não fecha (de propósito) — mas, sem isto,
    // o clique tirava o foco do card e jogava no corpo da página, deixando
    // quem navega por teclado sem ponto de partida até apertar Tab. O
    // preventDefault no mousedown segura o foco onde ele está.
    overlay.addEventListener('mousedown', (ev) => {
      if(ev.target === overlay) ev.preventDefault();
    });

    copiarBtn.addEventListener('click', onCopiar);
    okBtn.addEventListener('click', onOk);
    document.addEventListener('keydown', onTecla, true);
  });
}

function copilotoSelecionarTextoDoElemento(el){
  if(!el) return;
  try{
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){}
}

// ---------- Confirmar/Avisar — substitui confirm()/alert() nativos ----------
//
// Os diálogos nativos do navegador (confirm/alert) mostram o nome da
// extensão no título ("Mensagem da extensão Co-piloto de vendas...") e o
// visual padrão do Chrome — pra quem está vendendo o produto como uma
// plataforma profissional, isso destoa do resto da interface (que tem
// marca, cor, tipografia próprias). Os dois componentes abaixo substituem
// os dois casos de uso: uma decisão sim/não (copilotoConfirmar) e um aviso
// de leitura única (copilotoAvisar) — mesma API de Promise que confirm()/
// alert() já tinham, então trocar uma chamada pela outra é `await` + nome
// novo, sem mudar a lógica de quem chama.
//
// Fecha no Esc e no clique fora — ao contrário do modal da credencial
// inicial (que é deliberadamente inescapável): aqui fechar sem escolher
// SEMPRE equivale a cancelar/só ler, o caminho seguro por padrão.

// null quando nenhum copiloto-decisao-overlay está aberto; enquanto um
// estiver, guarda a função que o fecha (ver copilotoAbrirModalDecisao,
// mais abaixo) — é o que permite copilotoFecharModalDecisaoAberto()
// (chamada por copilotoEncerrarSessao) encerrar um diálogo esquecido
// aberto sem precisar de nenhuma referência prévia a ele.
let _copilotoDecisaoFinalizarAtiva = null;

// Fecha, se houver, o modal de confirmação/aviso aberto agora — resolvendo
// como cancelado (o padrão seguro). Chamada por copilotoEncerrarSessao
// sempre que a sessão termina (inatividade ou "Sair" manual), pra nenhum
// "Excluir perfil?"/"Restaurar backup?" continuar clicável por cima da
// tela de login que reaparece atrás dele.
function copilotoFecharModalDecisaoAberto(){
  if(_copilotoDecisaoFinalizarAtiva) _copilotoDecisaoFinalizarAtiva(false);
}

function copilotoMontarModalDecisao(){
  if(document.getElementById('copilotoDecisaoOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'copiloto-decisao-overlay';
  overlay.id = 'copilotoDecisaoOverlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'copilotoDecisaoTitulo');
  overlay.innerHTML = `
    <div class="copiloto-decisao-card">
      <div class="copiloto-decisao-icone" id="copilotoDecisaoIcone">⚠️</div>
      <h2 class="copiloto-decisao-titulo" id="copilotoDecisaoTitulo"></h2>
      <p class="copiloto-decisao-msg" id="copilotoDecisaoMsg"></p>
      <div class="copiloto-decisao-botoes" id="copilotoDecisaoBotoes">
        <button type="button" class="btn secondary" id="copilotoDecisaoCancelarBtn"></button>
        <button type="button" class="btn purple" id="copilotoDecisaoConfirmarBtn"></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// Núcleo compartilhado pelas duas funções públicas abaixo — `opcoes.somenteOk`
// esconde o botão Cancelar e faz Esc/clique-fora resolverem como aceite (é
// o caso do aviso de leitura única).
function copilotoAbrirModalDecisao(mensagem, opcoes){
  opcoes = opcoes || {};
  return new Promise((resolve)=>{
    copilotoMontarModalDecisao();
    const overlay = document.getElementById('copilotoDecisaoOverlay');
    const icone = document.getElementById('copilotoDecisaoIcone');
    const tituloEl = document.getElementById('copilotoDecisaoTitulo');
    const msgEl = document.getElementById('copilotoDecisaoMsg');
    const botoesEl = document.getElementById('copilotoDecisaoBotoes');
    const cancelarBtn = document.getElementById('copilotoDecisaoCancelarBtn');
    const confirmarBtn = document.getElementById('copilotoDecisaoConfirmarBtn');

    icone.textContent = opcoes.icone || (opcoes.perigo ? '🗑️' : '⚠️');
    icone.classList.toggle('perigo', !!opcoes.perigo);
    tituloEl.textContent = opcoes.titulo || (opcoes.somenteOk ? 'Aviso' : 'Confirmar ação');
    msgEl.textContent = mensagem || '';
    // Frase curta centraliza (o padrão, e o que fica melhor pros outros 12
    // casos do projeto). Parágrafo de verdade (tem quebra dupla de linha,
    // ou passou de ~200 caracteres — caso do aviso de restaurar backup)
    // vira alinhado à esquerda: texto longo centralizado é ilegível, vira
    // parede de texto com bordas irregulares dos dois lados.
    const ehParagrafoLongo = (mensagem || '').includes('\n\n') || (mensagem || '').length > 200;
    msgEl.classList.toggle('longa', ehParagrafoLongo);
    confirmarBtn.textContent = opcoes.textoConfirmar || (opcoes.somenteOk ? 'Entendi' : 'Confirmar');
    confirmarBtn.classList.toggle('danger-solid', !!opcoes.perigo);
    confirmarBtn.classList.toggle('purple', !opcoes.perigo);
    cancelarBtn.textContent = opcoes.textoCancelar || 'Cancelar';
    cancelarBtn.style.display = opcoes.somenteOk ? 'none' : '';
    botoesEl.classList.toggle('somente-ok', !!opcoes.somenteOk);
    overlay.classList.add('show');
    requestAnimationFrame(()=>confirmarBtn.focus());

    let resolvido = false;
    const finalizar = (valor) => {
      if(resolvido) return;
      resolvido = true;
      overlay.classList.remove('show');
      cancelarBtn.removeEventListener('click', onCancelar);
      confirmarBtn.removeEventListener('click', onConfirmar);
      overlay.removeEventListener('mousedown', onCliqueFora);
      document.removeEventListener('keydown', onTecla, true);
      // Só desregistra se ainda for ESTE modal o "ativo" — evita que o
      // fechamento normal de um modal apague, por engano, o registro de
      // um segundo modal que já tenha aberto por cima (não deveria
      // acontecer na prática, mas closures não custam nada de garantia
      // extra aqui).
      if(_copilotoDecisaoFinalizarAtiva === finalizar) _copilotoDecisaoFinalizarAtiva = null;
      resolve(valor);
    };
    // Registrado GLOBALMENTE (não só dentro deste closure) pra
    // copilotoFecharModalDecisaoAberto() — chamada por copilotoEncerrarSessao
    // — conseguir fechar este modal de FORA, sem precisar de uma
    // referência que só quem abriu tem.
    _copilotoDecisaoFinalizarAtiva = finalizar;
    const onCancelar = () => finalizar(false);
    const onConfirmar = () => finalizar(true);
    // Aviso de leitura única não tem "não" — clicar fora ou Esc equivale a
    // ter lido. Confirmação normal trata as duas saídas como cancelar,
    // igual ao confirm() nativo que está substituindo.
    const onCliqueFora = (ev) => { if(ev.target === overlay) finalizar(!!opcoes.somenteOk); };
    const onTecla = (ev) => {
      if(ev.key === 'Escape'){ ev.preventDefault(); finalizar(!!opcoes.somenteOk); return; }
      if(ev.key !== 'Tab') return;
      const focaveis = opcoes.somenteOk ? [confirmarBtn] : [cancelarBtn, confirmarBtn];
      const primeiro = focaveis[0], ultimo = focaveis[focaveis.length-1];
      if(ev.shiftKey && document.activeElement === primeiro){ ev.preventDefault(); ultimo.focus(); }
      else if(!ev.shiftKey && document.activeElement === ultimo){ ev.preventDefault(); primeiro.focus(); }
    };
    cancelarBtn.addEventListener('click', onCancelar);
    confirmarBtn.addEventListener('click', onConfirmar);
    overlay.addEventListener('mousedown', onCliqueFora);
    document.addEventListener('keydown', onTecla, true);
  });
}

// Substitui confirm(mensagem) — devolve true/false. `opcoes`: { titulo,
// textoConfirmar, textoCancelar, perigo (deixa o botão de confirmar e o
// ícone em vermelho, para ações destrutivas/irreversíveis) }.
function copilotoConfirmar(mensagem, opcoes){
  return copilotoAbrirModalDecisao(mensagem, opcoes || {});
}

// Substitui alert(mensagem) — devolve uma Promise que resolve quando a
// pessoa fecha o aviso (só existe o caminho "li e entendi"). `opcoes`:
// { titulo, textoConfirmar }.
async function copilotoAvisar(mensagem, opcoes){
  await copilotoAbrirModalDecisao(mensagem, Object.assign({ somenteOk: true }, opcoes || {}));
}

// Ponto de entrada das duas telas de login: gera a credencial se esta
// instalação ainda não tiver uma, e mostra o modal se houver uma pendente
// de confirmação. Sai calada quando não há nada pendente — que é o caso de
// toda instalação já em uso.
async function copilotoExibirCredencialInicialSePendente(usuarioInputId){
  const gerada = await copilotoGarantirCredencialInicial();
  const pendente = gerada || await copilotoLerCredencialInicialPendente();
  if(!pendente) return;
  await copilotoAbrirModalCredencialInicial(pendente, usuarioInputId);
}

// ---------- Credencial de equipe (acesso restrito, opcional) ----------
//
// Uma SEGUNDA credencial da Área restrita, independente da principal (a
// gerada em copilotoGarantirCredencialInicial/trocada pelo admin) — quem entra com ela vê a tela de perfis SEM
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
// Um timer POR TELA (chaveado pelo id do campo de erro), não um só global.
// Com um único `let` global, abrir uma segunda tela de login bloqueada
// matava o cronômetro da primeira com clearInterval — e a primeira ficava
// com o campo `disabled` sem nada pra reabilitá-lo. Cada tela agora cuida
// do próprio relógio; começar de novo na MESMA tela continua substituindo
// o timer dela, que é o comportamento desejado.
const _copilotoLockoutIntervals = new Map();
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

  clearInterval(_copilotoLockoutIntervals.get(errorId));
  _copilotoLockoutIntervals.set(errorId, setInterval(()=>{
    restanteSeg -= 1;
    if(restanteSeg <= 0){
      clearInterval(_copilotoLockoutIntervals.get(errorId));
      _copilotoLockoutIntervals.delete(errorId);
      input.disabled = false;
      if(btn) btn.disabled = false;
      errorEl.style.display = 'none';
      input.value = '';
      input.focus();
      return;
    }
    atualizarTexto();
  }, 1000));
}

// Para o cronômetro de UMA tela sem esperar ele chegar a zero sozinho —
// usada quando a pessoa NAVEGA PRA LONGE da tela bloqueada (volta pra
// grade de perfis, abre "esqueci minha senha" etc.) antes do bloqueio
// acabar. Sem isto, o timer de setInterval continua rodando escondido,
// escrevendo num elemento de erro que ninguém mais vê — inofensivo (só
// reabilita um campo invisível quando zera), mas é lixo de execução que
// não precisa existir, e panel.js chamava isto em 5 pontos diferentes.
function copilotoCancelarBloqueioAreaRestrita(errorId){
  clearInterval(_copilotoLockoutIntervals.get(errorId));
  _copilotoLockoutIntervals.delete(errorId);
}

// Mostrar/esconder a mensagem de erro embaixo de um campo. Duas linhas que
// apareciam literalmente iguais em dezenas de pontos das telas de senha,
// nos três arquivos — e a versão "esconder" era esquecida com facilidade,
// deixando o erro anterior na tela depois de uma tentativa bem-sucedida.
function copilotoMostrarErroNoCampo(errorEl, mensagem){
  if(!errorEl) return;
  errorEl.textContent = mensagem;
  errorEl.style.display = 'block';
}
function copilotoLimparErroDoCampo(errorEl){
  if(!errorEl) return;
  errorEl.textContent = '';
  errorEl.style.display = 'none';
}

// --- Código de recuperação recém-gerado -------------------------------
// Um perfil pode ganhar um código de recuperação em dois momentos bem
// diferentes: ao trocar a senha em Configurações (options.js) e no
// primeiro acesso de um perfil antigo, cadastrado antes da criptografia
// existir (panel.js). Nos dois casos a regra é a mesma — o admin vê a tela
// de PIN, qualquer outro perfil vê a de código — e a regra vivia duplicada
// nos dois arquivos. `origemLog` é o único texto que muda entre eles.
async function copilotoMostrarCodigoRecuperacaoNovo(perfil, codigo, origemLog){
  if(!codigo) return;
  if(perfil.admin){
    await copilotoRegistrarEventoLog('pin_admin_gerado', perfil, origemLog);
    await mostrarPinAdminModal(codigo);
  }else{
    await mostrarCodigoRecuperacaoModal(codigo);
  }
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
