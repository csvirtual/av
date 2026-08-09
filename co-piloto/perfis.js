// ---------- Perfis isolados por profissional (usado em panel.html, options.html e no service worker) ----------
//
// Acima do login geral do sistema (auth.js) existe agora um segundo nível:
// cada instalação pode ter vários PERFIS cadastrados, um por profissional de
// nutrição atendido — cada um com seus próprios leads, histórico, funil,
// campanha, chaves de API e configurações, totalmente isolados uns dos
// outros. A lista de perfis em si (nome, id, quem é admin, hash da senha) é
// global — só os DADOS de cada perfil são separados.
//
// Regras de privilégio (pedidas explicitamente pelo cliente):
//  - Um perfil comum só tem poder sobre os PRÓPRIOS dados: só lê e só grava
//    nas próprias chaves (ver copilotoStorage abaixo), nunca nas de outro
//    perfil, e não tem acesso ao reset geral.
//  - O perfil administrador geral (sempre o primeiro cadastrado na
//    instalação — sem tela pra marcar isso manualmente, pra nunca haver mais
//    de um por engano) tem poder total sobre si mesmo E sobre todos os
//    demais: pode entrar em qualquer perfil sem saber a senha dele (ver
//    copilotoSessaoEhAdmin), ver/editar os dados de qualquer profissional e
//    tirar backup de todos os perfis de uma vez (inclusive dos que vierem a
//    ser cadastrados depois).
//  - Essa autoridade de admin é uma flag DA SESSÃO (copilotoSessaoEhAdmin),
//    separada de "qual perfil estou vendo agora" (copilotoPerfilAtivoId) —
//    assim o admin pode entrar no perfil de outro profissional pra
//    ajudar/editar sem perder a própria autoridade, e sem que os dados dos
//    dois perfis jamais se misturem: em qualquer momento, toda leitura/
//    escrita de dado (leads, funil, campanha, chaves) é filtrada por UM
//    perfil só — o que estiver ativo no momento (copilotoStorage).
//  - O admin também decide, perfil por perfil, se a TROCA RÁPIDA (trocar de
//    perfil sem sair do login geral) pode entrar num perfil sem pedir a
//    senha dele (copilotoDefinirTrocaSemSenha) — o próprio perfil admin
//    nunca entra nessa exceção, sempre pede a própria senha.
//  - Todo login/logout (e outras ações sensíveis) fica registrado num log
//    de auditoria que só o admin consegue ver (copilotoRegistrarEventoLog),
//    guardado por até 90 dias.
//  - Se o admin esquecer a própria senha, dá pra redefini-la com o
//    usuário/senha GERAL do sistema (copilotoRecuperarSenhaAdmin) — sem
//    isso, seria um beco sem saída (reset geral também exige autoridade de
//    admin de sessão).
//  - Só o admin tem PIN alfanumérico (copilotoGerarCodigoAlfanumerico): o
//    mesmo código de recuperação de qualquer perfil, só que pra ele também
//    é exigido pra trocar a própria senha (não pra entrar), renovado a cada
//    troca. Não é um segredo separado — é a mesma chave que já desembrulha
//    o DEK dele por recuperação (ver copilotoAlterarSenhaPerfil).
//  - Toda tentativa errada de senha (qualquer perfil) conta pra um bloqueio
//    de 60s depois de 3 erros seguidos (copilotoRegistrarTentativaFalha).
//
// Roda tanto em páginas normais (panel.html/options.html — depende de
// auth.js já carregado antes, pelo hash de senha) quanto dentro do service
// worker (importScripts em background.js, onde as funções de senha
// simplesmente não chegam a ser chamadas) — por isso usa só funções simples
// no escopo global, sem import/export.

const COPILOTO_PERFIS_KEY = 'copilotoPerfis'; // chrome.storage.local — lista global de perfis
const COPILOTO_AMK_ENVELOPE_KEY = 'copilotoAmkEnvelope'; // chrome.storage.local — chave-mestra do admin, embrulhada (ver mais abaixo)
const COPILOTO_PERFIL_ATIVO_KEY = 'copilotoPerfilAtivoId'; // chrome.storage.session — perfil sendo visualizado/editado agora
const COPILOTO_SESSAO_ADMIN_KEY = 'copilotoSessaoAdminId'; // chrome.storage.session — id do admin autenticado nesta sessão (se houver)
const COPILOTO_PREFIXO_ESCOPO = 'perfil__';
const COPILOTO_SENHA_PERFIL_MIN = 4;
const COPILOTO_TENTATIVAS_KEY = 'copilotoTentativasSenha'; // chrome.storage.local — bloqueio por excesso de tentativas
const COPILOTO_TENTATIVAS_MAX = 3;
const COPILOTO_BLOQUEIO_MS = 60 * 1000;

// ---------- Serialização de leitura+escrita por chave (mesma aba) ----------
//
// chrome.storage.local não garante atomicidade entre um get() e o set() que
// vem depois: se duas chamadas à mesma chave (ex.: duplo Enter numa senha
// errada, dois cliques rápidos num toggle) executam quase ao mesmo tempo,
// as duas podem ler o mesmo estado antigo e a segunda escrita sobrescreve a
// primeira, perdendo uma mutação (contador de tentativas, entrada de log,
// alteração na lista de perfis). A fila abaixo é generalizada por chave:
// cada tarefa só começa depois que a anterior da MESMA chave terminou.
//
// Não cobre duas ABAS diferentes escrevendo ao mesmo tempo (cada aba tem sua
// própria fila, em memória) — mas isso não é um fluxo normal desta extensão:
// o próprio painel navega dentro da MESMA aba entre painel.html e
// options.html (ver window.location.href em ambos), então só existe mais de
// uma aba aberta se alguém duplicar a aba manualmente.
const _copilotoFilasEscrita = {};
function copilotoSerializarPorChave(chave, tarefa) {
  const anterior = _copilotoFilasEscrita[chave] || Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  _copilotoFilasEscrita[chave] = atual.catch(() => {});
  return atual;
}

function copilotoGerarIdPerfil() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- Lista de perfis (chrome.storage.local, sem escopo — é a lista em si) ----------

async function copilotoListarPerfis() {
  try {
    const data = await chrome.storage.local.get(COPILOTO_PERFIS_KEY);
    return data[COPILOTO_PERFIS_KEY] || [];
  } catch (e) {
    return [];
  }
}

async function copilotoSalvarListaPerfis(lista) {
  await chrome.storage.local.set({ [COPILOTO_PERFIS_KEY]: lista });
}

async function copilotoObterPerfilPorId(id) {
  if (!id) return null;
  const lista = await copilotoListarPerfis();
  return lista.find((p) => p.id === id) || null;
}

async function copilotoObterPerfilAdmin() {
  const lista = await copilotoListarPerfis();
  return lista.find((p) => p.admin) || null;
}

// ---------- Senha individual de cada perfil ----------
//
// Cada profissional cadastra a própria senha na criação do perfil e pode
// trocá-la depois (ver copilotoAlterarSenhaPerfil) — ela protege o perfil
// mesmo de quem também conhece o usuário/senha geral do sistema (auth.js).
// Hash forte (PBKDF2, salt aleatório de verdade — ver copilotoGerarHashSenhaForte
// em auth.js), não depende mais do id do perfil como "sal" como na versão
// antiga (previsível, e um SHA-256 de rodada única).
async function copilotoHashSenhaPerfil(senha) {
  return copilotoGerarHashSenhaForte(senha || '');
}

function copilotoValidarSenhaPerfil(senha) {
  if (!senha || senha.length < COPILOTO_SENHA_PERFIL_MIN) {
    return `A senha precisa ter pelo menos ${COPILOTO_SENHA_PERFIL_MIN} caracteres.`;
  }
  return null;
}

// ---------- Código alfanumérico (código de recuperação de qualquer perfil, PIN do admin) ----------
//
// Gerado pelo PRÓPRIO sistema (ninguém digita o seu) em dois momentos: na
// criação do perfil, e toda vez que a senha dele é trocada (rotação — o
// código anterior para de valer). Mostrado em texto puro uma única vez, na
// hora, com aviso pra guardar em local seguro — depois disso não fica
// salvo em lugar nenhum: só existe como a chave que embrulha o DEK do
// perfil (dekEnvelopeRecuperacao, ver copilotoMontarEnvelopePorTexto em
// auth.js), nunca como hash à parte. Pra qualquer perfil comum, serve só
// pra recuperação. Pro admin, o mesmo código também é exigido pra trocar a
// própria senha normalmente (ver copilotoAlterarSenhaPerfil) — não é um
// segundo segredo, é o mesmo, com um uso a mais.
function copilotoGerarCodigoAlfanumerico() {
  // Alfabeto sem caracteres fáceis de confundir (0/O, 1/I/L) — é pra ser
  // escrito à mão ou digitado depois, não só copiado e colado.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bruto = '';
  for (let i = 0; i < bytes.length; i++) {
    bruto += alfabeto[bytes[i] % alfabeto.length];
  }
  return bruto.match(/.{1,4}/g).join('-'); // formato XXXX-XXXX-XXXX
}

// ---------- Chave-mestra do administrador (AMK) ----------
//
// Existe só pra o admin poder ver/editar os campos protegidos (CPF, e-mail,
// CEP, nascimento, notas, chaves de API) de QUALQUER perfil no "modo
// administrador" (entrar sem saber a senha de outro profissional) — sem
// ela, o admin só enxergaria os campos NÃO protegidos de quem está
// impersonando. Gerada uma única vez, na criação do primeiro perfil (ver
// copilotoCriarPerfil) e embrulhada por dois caminhos independentes: a
// própria senha do admin (uso do dia a dia) e o código de recuperação dele
// (se um dia ele perder a senha — mesmo mecanismo usado no DEK de qualquer
// perfil, ver copilotoMontarEnvelopePorTexto em auth.js). Guardada global,
// não por perfil, porque é uma coisa só da instalação inteira.
async function copilotoObterEnvelopeAmk() {
  try {
    const data = await chrome.storage.local.get(COPILOTO_AMK_ENVELOPE_KEY);
    return data[COPILOTO_AMK_ENVELOPE_KEY] || null;
  } catch (e) {
    return null;
  }
}

async function copilotoSalvarEnvelopeAmk(envelope) {
  await chrome.storage.local.set({ [COPILOTO_AMK_ENVELOPE_KEY]: envelope });
}

// Desembrulha a AMK usando a senha do admin — chamada no login normal do
// perfil admin, pra guardar a AMK desembrulhada na sessão (ver
// copilotoGuardarAmkNaSessao em auth.js) e permitir impersonar outros
// perfis dali em diante, sem precisar pedir senha de novo a cada troca.
async function copilotoObterAmkComSenhaAdmin(senhaAdmin) {
  const envelope = await copilotoObterEnvelopeAmk();
  if (!envelope || !envelope.porSenha) return null;
  return copilotoAbrirEnvelopePorTexto(envelope.porSenha, senhaAdmin, 'amk-por-senha-admin').catch(() => null);
}

async function copilotoObterAmkComCodigoRecuperacao(codigoRecuperacao) {
  const envelope = await copilotoObterEnvelopeAmk();
  if (!envelope || !envelope.porRecuperacao) return null;
  const codigoNormalizado = (codigoRecuperacao || '').toUpperCase().trim();
  return copilotoAbrirEnvelopePorTexto(envelope.porRecuperacao, codigoNormalizado, 'amk-por-recuperacao').catch(() => null);
}

// Cria os dois embrulhos completos da AMK (senha + código de recuperação) a
// partir da chave já em mãos — usada na criação do admin e sempre que a
// senha/código de recuperação do admin mudam (pra manter os embrulhos em
// dia com o segredo mais recente).
async function copilotoMontarEnvelopesAmk(amk, senhaAdmin, codigoRecuperacao) {
  return {
    porSenha: await copilotoMontarEnvelopePorTexto(amk, senhaAdmin, 'amk-por-senha-admin'),
    porRecuperacao: await copilotoMontarEnvelopePorTexto(amk, codigoRecuperacao, 'amk-por-recuperacao')
  };
}

// Cria um novo perfil, já com senha própria. O primeiro perfil cadastrado na
// instalação vira automaticamente o administrador geral — não existe tela
// pra marcar isso manualmente, evitando ter mais de um admin por engano.
// Retorna { ok:true, perfil } ou { ok:false, erro }.
async function copilotoCriarPerfil(nome, senha) {
  const nomeLimpo = (nome || '').trim();
  if (!nomeLimpo) return { ok: false, erro: 'Informe o nome do profissional.' };
  if (nomeLimpo.length < 2) return { ok: false, erro: 'Nome muito curto.' };
  const erroSenha = copilotoValidarSenhaPerfil(senha);
  if (erroSenha) return { ok: false, erro: erroSenha };

  // Ver copilotoSerializarPorChave acima: sem isto, duas chamadas quase
  // simultâneas (ex.: duplo clique em "Cadastrar") poderiam ler a mesma
  // lista antiga e uma sobrescrever o perfil que a outra acabou de criar.
  return copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const jaExiste = lista.some((p) => p.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());
    if (jaExiste) return { ok: false, erro: 'Já existe um profissional cadastrado com esse nome.' };

    const id = copilotoGerarIdPerfil();
    const ehAdmin = lista.length === 0;

    // DEK ("Data Encryption Key"): chave que cifra os campos protegidos
    // deste perfil (CPF, e-mail, CEP, nascimento, notas e objetivo de cada
    // lead, e as chaves de API — ver panel.js/options.js). Embrulhada pela
    // própria senha (uso normal) e por um código de recuperação (se a senha
    // for esquecida) — ver o comentário de copilotoMontarEnvelopePorTexto
    // em auth.js pra como isso funciona.
    const dek = await copilotoGerarChaveAesAleatoria();
    const dekEnvelopeSenha = await copilotoMontarEnvelopePorTexto(dek, senha, 'dek-por-senha');
    const codigoRecuperacao = copilotoGerarCodigoAlfanumerico();
    const dekEnvelopeRecuperacao = await copilotoMontarEnvelopePorTexto(dek, codigoRecuperacao, 'dek-por-recuperacao');

    const perfil = {
      id,
      nome: nomeLimpo,
      admin: ehAdmin,
      criadoEm: new Date().toISOString(),
      senhaHash: await copilotoHashSenhaPerfil(senha),
      // Por padrão, todo perfil pede a própria senha ao ser aberto — inclusive
      // na troca rápida (ver copilotoDefinirTrocaSemSenha). Fica mais frouxo
      // só se o administrador decidir, perfil por perfil, o contrário.
      permitirTrocaSemSenha: false,
      dekEnvelopeSenha,
      dekEnvelopeRecuperacao,
      // Dispara a sequência de boas-vindas (Privacidade, depois Como usar)
      // uma única vez, na primeira entrada DESTE perfil — ver liberarPainel
      // em panel.js. De propósito um campo que só existe (true) em perfis
      // criados a partir desta versão: perfis de instalações mais antigas,
      // que nunca tiveram este campo gravado, ficam com valor undefined
      // (falsy) e por isso nunca disparam a sequência retroativamente.
      boasVindasPendentes: true
    };

    let amkNova = null;
    if (ehAdmin) {
      // Chave-mestra (AMK) só nasce com o admin — ver o comentário dela
      // acima. Usa o mesmo código de recuperação do próprio DEK do admin
      // como segundo caminho de acesso, pra não empilhar mais um segredo
      // novo pra pessoa guardar (esse MESMO código, codigoRecuperacao, é o
      // PIN que a tela mostra pro admin — ver criarNovoPerfilClick em
      // panel.js).
      amkNova = await copilotoGerarChaveAesAleatoria();
      const amkEnvelopes = await copilotoMontarEnvelopesAmk(amkNova, senha, codigoRecuperacao);
      await copilotoSalvarEnvelopeAmk(amkEnvelopes);
    } else if (typeof copilotoObterAmkDaSessao === 'function') {
      // Se há uma sessão de admin ativa agora (ex.: o próprio admin está
      // cadastrando este novo profissional), já embrulha o DEK também pela
      // AMK — sem isso, o admin só ganharia acesso aos campos protegidos
      // deste perfil na primeira vez que a senha dele fosse trocada (ver
      // copilotoAlterarSenhaPerfil, que faz esse mesmo embrulho de forma
      // tardia/oportunista quando a AMK não estava disponível aqui).
      const amk = await copilotoObterAmkDaSessao();
      if (amk) perfil.dekEnvelopeAmk = await copilotoEnvolverChave(dek, amk);
    }

    lista.push(perfil);
    await copilotoSalvarListaPerfis(lista);
    // dek/amkNova (a chave CRUA, não o embrulho) voltam pra quem chamou
    // poder guardar direto na sessão (ver copilotoGuardarDekNaSessao em
    // auth.js) sem precisar "logar de novo" logo depois de cadastrar.
    return { ok: true, perfil, codigoRecuperacao, dek, amkNova };
  });
}

// Apaga a marca de "boas-vindas pendentes" (ver copilotoCriarPerfil acima) —
// chamada assim que a sequência (Privacidade, depois Como usar) é disparada
// pela primeira e única vez pra este perfil, em liberarPainel (panel.js).
async function copilotoLimparBoasVindasPendentes(id) {
  return copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const alvo = lista.find((p) => p.id === id);
    if (!alvo || !alvo.boasVindasPendentes) return;
    delete alvo.boasVindasPendentes;
    await copilotoSalvarListaPerfis(lista);
  });
}

// Renomeia um perfil — inclusive o administrador geral (a única coisa que o
// admin nunca pode fazer com o próprio perfil é excluí-lo, ver
// copilotoExcluirPerfil; o nome dele é editável como o de qualquer outro
// profissional). Quem garante que a instalação sempre tem UM admin não é o
// nome dele ficar fixo, é o próprio perfil nunca poder ser apagado — a
// identidade "raiz" de verdade é o usuário/senha da Área restrita
// (auth.js), que não tem relação nenhuma com o nome de nenhum perfil.
async function copilotoAlterarNomePerfil(id, novoNome) {
  // Só o próprio perfil (o ativo na sessão agora) ou o admin conseguem
  // renomear — sem isto, chamar esta função direto (ex.: console do
  // navegador) com o id de QUALQUER outro perfil renomeava ele, mesmo sem
  // senha nem autoridade nenhuma.
  const perfilAtivoId = await copilotoPerfilAtivoId();
  const souAdminSessao = await copilotoSessaoEhAdmin();
  if (id !== perfilAtivoId && !souAdminSessao) {
    return { ok: false, erro: 'Você não tem privilégios suficientes para esta ação. Ligue como administrador geral.' };
  }
  return copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const alvo = lista.find((p) => p.id === id);
    if (!alvo) return { ok: false, erro: 'Perfil não encontrado.' };

    const nomeLimpo = (novoNome || '').trim();
    if (!nomeLimpo) return { ok: false, erro: 'Informe o nome do profissional.' };
    if (nomeLimpo.length < 2) return { ok: false, erro: 'Nome muito curto.' };

    const jaExiste = lista.some((p) => p.id !== id && p.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());
    if (jaExiste) return { ok: false, erro: 'Já existe um profissional cadastrado com esse nome.' };

    alvo.nome = nomeLimpo;
    await copilotoSalvarListaPerfis(lista);
    return { ok: true, perfil: alvo };
  });
}

// Liga/desliga, para UM perfil específico, se a troca rápida (trocar de
// perfil sem sair da sessão do login geral — ver trocarPerfilClick em
// panel.js) pode entrar nele sem pedir a senha desse perfil. Configurável só
// pelo administrador geral (checagem de quem pode chamar isto é feita por
// quem chama, na tela de gerenciar perfis — ver copilotoSessaoEhAdmin).
//
// O perfil administrador geral nunca aceita essa exceção, mesmo que alguém
// tente ligar — ele sempre pede a própria senha, em qualquer entrada,
// porque é o que concede a autoridade de admin da sessão (ver
// copilotoSessaoEhAdmin); abrir uma exceção pra ele derrubaria essa garantia.
async function copilotoDefinirTrocaSemSenha(id, permitir) {
  // Confere de novo, aqui dentro — mesmo motivo do "forcar:true" em
  // copilotoAlterarSenhaPerfil: não dá pra confiar só em quem chamou já ter
  // checado copilotoSessaoEhAdmin() na tela (ver excluirPerfilClick/o
  // listener do toggle em panel.js). Uma chamada direta a esta função (ex.:
  // console do navegador, sem passar pela tela nenhuma) chegaria aqui sem
  // nenhuma autoridade de verdade — sem esta checagem, qualquer perfil
  // comum conseguia se marcar (ou marcar outro perfil) pra entrar na troca
  // rápida sem senha nenhuma.
  if (!(await copilotoSessaoEhAdmin())) {
    return { ok: false, erro: 'Você não tem privilégios suficientes para esta ação. Ligue como administrador geral.' };
  }
  return copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const alvo = lista.find((p) => p.id === id);
    if (!alvo) return { ok: false, erro: 'Perfil não encontrado.' };
    if (alvo.admin) return { ok: false, erro: 'O perfil administrador geral sempre pede a própria senha.' };

    alvo.permitirTrocaSemSenha = !!permitir;
    await copilotoSalvarListaPerfis(lista);
    return { ok: true };
  });
}

// Confere a senha de um perfil. Perfis antigos, cadastrados antes desta
// versão (sem senha própria ainda), não têm "senhaHash" — nesse caso trata
// como "sem senha" e libera a entrada, só pra não travar quem já usava a
// extensão; a própria tela sugere cadastrar uma senha assim que entrar.
async function copilotoVerificarSenhaPerfil(perfilId, senha) {
  const perfil = await copilotoObterPerfilPorId(perfilId);
  if (!perfil) return false;
  if (!perfil.senhaHash) return true;

  if (perfil.senhaHash.startsWith('pbkdf2:')) {
    return copilotoVerificarHashSenhaForte(senha, perfil.senhaHash);
  }

  // Formato antigo (SHA-256 salgado com o id do perfil) — ainda aceito pra
  // não deslogar ninguém de uma hora pra outra. Se a senha bater, já migra
  // pro hash forte (PBKDF2) na hora, sem exigir nada extra da pessoa — a
  // próxima verificação já usa o formato novo.
  const hashAntigo = await copilotoSha256Hex(`${perfilId}|${senha || ''}`);
  const ok = hashAntigo === perfil.senhaHash;
  if (ok) {
    await copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
      const lista = await copilotoListarPerfis();
      const alvo = lista.find((p) => p.id === perfilId);
      if (alvo && alvo.senhaHash === hashAntigo) {
        alvo.senhaHash = await copilotoHashSenhaPerfil(senha);
        await copilotoSalvarListaPerfis(lista);
      }
    });
  }
  return ok;
}

// Confere a senha e, se estiver certa, também desembrulha o DEK do perfil
// (a chave que cifra os campos protegidos — ver copilotoCriarPerfil) e, se
// for o perfil admin, a chave-mestra (AMK) também. Chamada em todo login
// normal de qualquer perfil (ver panel.js). Quem chamar é responsável por
// guardar o resultado na sessão (copilotoGuardarDekNaSessao/
// copilotoGuardarAmkNaSessao, em auth.js) — esta função só lê/prepara.
//
// Perfis cadastrados ANTES desta versão não têm DEK ainda — nesse caso um
// é criado agora mesmo, na hora do primeiro login depois da atualização,
// sem exigir nenhuma ação extra da pessoa (não existe nada pra "migrar":
// como a criptografia não existia antes, não há dado antigo cifrado com
// outra chave pra reconciliar). `codigoRecuperacaoNovo` vem preenchido só
// nesse caso específico — quem chamou deve mostrar esse código pra pessoa
// guardar, do mesmo jeito que uma palavra-chave nova.
async function copilotoDesbloquearPerfilComSenha(perfilId, senha) {
  const ok = await copilotoVerificarSenhaPerfil(perfilId, senha);
  if (!ok) return { ok: false, dek: null, amk: null, codigoRecuperacaoNovo: null };

  const perfil = await copilotoObterPerfilPorId(perfilId);
  if (!perfil) return { ok: false, dek: null, amk: null, codigoRecuperacaoNovo: null };

  let dek = null;
  let codigoRecuperacaoNovo = null;

  if (perfil.dekEnvelopeSenha) {
    dek = await copilotoAbrirEnvelopePorTexto(perfil.dekEnvelopeSenha, senha, 'dek-por-senha').catch(() => null);
  } else {
    const resultado = await copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
      const lista = await copilotoListarPerfis();
      const alvo = lista.find((p) => p.id === perfilId);
      if (!alvo) return null;
      if (alvo.dekEnvelopeSenha) {
        // outra chamada concorrente já criou entre o tempo — só reaproveita.
        return { existente: true };
      }
      const novaDek = await copilotoGerarChaveAesAleatoria();
      const novoCodigo = copilotoGerarCodigoAlfanumerico();
      alvo.dekEnvelopeSenha = await copilotoMontarEnvelopePorTexto(novaDek, senha, 'dek-por-senha');
      alvo.dekEnvelopeRecuperacao = await copilotoMontarEnvelopePorTexto(novaDek, novoCodigo, 'dek-por-recuperacao');
      await copilotoSalvarListaPerfis(lista);
      return { dek: novaDek, codigo: novoCodigo };
    });
    if (!resultado) {
      // Perfil foi excluído concorrentemente enquanto isto rodava (ex.: o
      // admin excluiu este profissional bem no meio desta checagem de
      // senha) — sem isto, a função caía pra fora sem preencher `dek` e
      // ainda assim devolvia { ok:true, dek:null }, como se o desbloqueio
      // tivesse dado certo.
      return { ok: false, dek: null, amk: null, codigoRecuperacaoNovo: null };
    }
    if (resultado.existente) {
      const perfilAtualizado = await copilotoObterPerfilPorId(perfilId);
      dek = await copilotoAbrirEnvelopePorTexto(perfilAtualizado.dekEnvelopeSenha, senha, 'dek-por-senha').catch(() => null);
    } else {
      dek = resultado.dek;
      codigoRecuperacaoNovo = resultado.codigo;
    }
  }

  let amk = null;
  if (perfil.admin) {
    amk = await copilotoObterAmkComSenhaAdmin(senha);
  }

  return { ok: true, dek, amk, codigoRecuperacaoNovo };
}

// ---------- Bloqueio por excesso de tentativas erradas ----------
//
// Vale pra qualquer perfil (a checagem de senha no passo de confirmação da
// tela de perfis passa por aqui pra todos — não só o admin, mas é
// especialmente importante pra ele, já que a senha do admin é a chave pra
// tudo). Depois de COPILOTO_TENTATIVAS_MAX erros seguidos, o campo de senha
// fica bloqueado por COPILOTO_BLOQUEIO_MS — guardado em chrome.storage.local
// (não session) de propósito, pra sobreviver a um recarregamento da aba ou
// reabertura do navegador: só recarregar a página não pode ser usado pra
// zerar o contador e continuar tentando.
async function copilotoObterTentativas(perfilId) {
  try {
    const data = await chrome.storage.local.get(COPILOTO_TENTATIVAS_KEY);
    const todas = data[COPILOTO_TENTATIVAS_KEY] || {};
    return todas[perfilId] || { tentativas: 0, bloqueadoAte: 0 };
  } catch (e) {
    return { tentativas: 0, bloqueadoAte: 0 };
  }
}

// { bloqueado, restanteMs } — restanteMs só é maior que 0 quando bloqueado.
async function copilotoStatusBloqueioSenha(perfilId) {
  const estado = await copilotoObterTentativas(perfilId);
  const restante = estado.bloqueadoAte - Date.now();
  if (restante > 0) return { bloqueado: true, restanteMs: restante };
  return { bloqueado: false, restanteMs: 0 };
}

// Chamada a cada tentativa de senha ERRADA. Ao atingir o limite, já bloqueia
// e zera o contador (pro próximo ciclo, depois que o bloqueio passar, voltar
// a ter as tentativas cheias de novo). Retorna o novo estado, pra quem
// chamou decidir se mostra "faltam N tentativas" ou já o cronômetro de
// bloqueio.
async function copilotoRegistrarTentativaFalha(perfilId) {
  // Ver copilotoSerializarPorChave acima: sem isto, duas submissões quase
  // simultâneas da mesma senha errada (ex.: Enter segurado disparando duas
  // vezes) podiam ler o mesmo contador antigo e uma pisar na outra, deixando
  // o bloqueio de 3 tentativas exigir mais tentativas do que devia.
  return copilotoSerializarPorChave(COPILOTO_TENTATIVAS_KEY, async () => {
    const data = await chrome.storage.local.get(COPILOTO_TENTATIVAS_KEY);
    const todas = data[COPILOTO_TENTATIVAS_KEY] || {};
    const estado = todas[perfilId] || { tentativas: 0, bloqueadoAte: 0 };
    estado.tentativas += 1;
    if (estado.tentativas >= COPILOTO_TENTATIVAS_MAX) {
      estado.bloqueadoAte = Date.now() + COPILOTO_BLOQUEIO_MS;
      estado.tentativas = 0;
    }
    todas[perfilId] = estado;
    await chrome.storage.local.set({ [COPILOTO_TENTATIVAS_KEY]: todas });
    return estado;
  });
}

// Chamada depois de uma senha CERTA — zera qualquer contador de tentativas
// erradas anterior daquele perfil.
async function copilotoLimparTentativas(perfilId) {
  return copilotoSerializarPorChave(COPILOTO_TENTATIVAS_KEY, async () => {
    const data = await chrome.storage.local.get(COPILOTO_TENTATIVAS_KEY);
    const todas = data[COPILOTO_TENTATIVAS_KEY] || {};
    if (!(perfilId in todas)) return;
    delete todas[perfilId];
    await chrome.storage.local.set({ [COPILOTO_TENTATIVAS_KEY]: todas });
  });
}

// Troca a senha de um perfil. Uso normal (o próprio dono trocando a senha):
// passe senhaAtual, ela é conferida antes de aceitar a nova — e, se o
// perfil for o administrador geral, TAMBÉM é exigido o PIN alfanumérico
// atual (mesmo código de recuperação dele, ver copilotoGerarCodigoAlfanumerico
// e o comentário de copilotoAlterarSenhaPerfil abaixo). Uso admin
// (redefinindo a senha de OUTRO profissional que esqueceu a dele): passe
// forcar:true, que pula as duas conferências — só faz sentido pra quem já
// tem autoridade de admin na sessão (a checagem de "pode fazer isso" é
// feita por quem chama, na tela; ver copilotoSessaoEhAdmin).
//
// Núcleo comum de "definir uma senha nova pra um perfil, preservando o DEK
// (a chave de conteúdo protegido) se possível": grava o hash da senha nova
// e reembrulha o DEK — usando a `dekConhecida` já desembrulhada, se ela foi
// passada (ninguém perde nada), ou gerando uma DEK NOVA do zero, se não
// (os campos protegidos ANTIGOS deste perfil ficam ilegíveis pra sempre —
// `dadosProtegidosPerdidos` avisa isso pra quem chamou mostrar na tela). O
// código de recuperação sempre roda de novo, junto da senha — evita ficar
// com um código velho, de uma senha que já não vale mais, ainda válido por
// aí. Se for o perfil admin, cuida também da chave-mestra (AMK): usa a
// `amkConhecida` se veio alguma, ou gera uma nova (idem, com aviso).
// Não faz NENHUMA checagem de autoridade — quem chama já garantiu isso.
async function _copilotoRegravarSenhaEDek(perfilId, novaSenha, dekConhecida, amkConhecidaSeAdmin) {
  return copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const alvo = lista.find((p) => p.id === perfilId);
    if (!alvo) return { ok: false, erro: 'Perfil não encontrado.' };

    alvo.senhaHash = await copilotoHashSenhaPerfil(novaSenha);

    let dek = dekConhecida;
    const dadosProtegidosPerdidos = !dek && !!alvo.dekEnvelopeSenha;
    if (!dek) dek = await copilotoGerarChaveAesAleatoria();

    const codigoRecuperacaoNovo = copilotoGerarCodigoAlfanumerico();
    alvo.dekEnvelopeSenha = await copilotoMontarEnvelopePorTexto(dek, novaSenha, 'dek-por-senha');
    alvo.dekEnvelopeRecuperacao = await copilotoMontarEnvelopePorTexto(dek, codigoRecuperacaoNovo, 'dek-por-recuperacao');

    // Se há uma AMK disponível nesta sessão (ex.: foi o admin quem fez esta
    // troca), (re)embrulha o DEK por ela também — é o que dá ao admin
    // acesso aos campos protegidos deste perfil no modo impersonando.
    const amkDaSessao = typeof copilotoObterAmkDaSessao === 'function' ? await copilotoObterAmkDaSessao() : null;
    if (amkDaSessao) {
      alvo.dekEnvelopeAmk = await copilotoEnvolverChave(dek, amkDaSessao);
    } else if (dek !== dekConhecida) {
      // Chegou aqui com um DEK NOVO (o antigo se perdeu, ver
      // dadosProtegidosPerdidos) e sem AMK nesta sessão pra reembrulhar:
      // o dekEnvelopeAmk guardado embrulha o DEK VELHO, que não abre mais
      // nada. Não é vazamento — o GCM rejeita a chave errada e o campo
      // continua "🔒 protegido" — mas é um envelope que promete um acesso
      // que deixou de existir. Some com ele, pra que o estado gravado
      // diga a verdade: o admin precisa reembrulhar este perfil (basta
      // ele redefinir a senha do perfil estando logado como admin).
      delete alvo.dekEnvelopeAmk;
    }

    let amkPerdida = false;
    let amkFinal = null;
    if (alvo.admin) {
      amkFinal = amkConhecidaSeAdmin;
      if (!amkFinal) {
        const amkExistia = !!(await copilotoObterEnvelopeAmk());
        amkFinal = await copilotoGerarChaveAesAleatoria();
        amkPerdida = amkExistia; // só é "perda" se já existia uma AMK de verdade antes
      }
      await copilotoSalvarEnvelopeAmk(await copilotoMontarEnvelopesAmk(amkFinal, novaSenha, codigoRecuperacaoNovo));
    }

    await copilotoSalvarListaPerfis(lista);
    // dek/amkFinal (as chaves CRUAS) voltam pra quem chamou poder guardar
    // direto na sessão (copilotoGuardarDekNaSessao/copilotoGuardarAmkNaSessao
    // em auth.js), sem precisar de mais um passo de "desbloqueio" logo
    // depois de trocar a senha.
    return { ok: true, codigoRecuperacaoNovo, dadosProtegidosPerdidos, amkPerdida, dek, amk: amkFinal };
  });
}

async function copilotoAlterarSenhaPerfil(perfilId, { senhaAtual, novaSenha, forcar, pin } = {}) {
  const perfil = await copilotoObterPerfilPorId(perfilId);
  if (!perfil) return { ok: false, erro: 'Perfil não encontrado.' };

  let dek = null;
  let amkConhecida = null;

  if (!forcar) {
    const senhaOk = await copilotoVerificarSenhaPerfil(perfilId, senhaAtual);
    if (!senhaOk) return { ok: false, erro: 'Senha atual incorreta.' };

    // Pro admin, o PIN alfanumérico (o mesmo código de recuperação dele —
    // ver copilotoGerarCodigoAlfanumerico) também é exigido pra trocar a
    // senha normalmente. Sem hash guardado à parte: a verificação é
    // tentar desembrulhar o próprio DEK com o PIN digitado — se
    // destravar, é porque está certo. Mesmo mecanismo já usado na
    // recuperação self-service de qualquer perfil (ver
    // copilotoRecuperarSenhaComCodigo), só reaproveitado aqui, então não
    // existe um segundo segredo separado pra guardar/vazar. Um admin sem
    // dekEnvelopeRecuperacao ainda (não deveria acontecer com perfis
    // desta versão) não é bloqueado — mesma lógica de compatibilidade de
    // copilotoVerificarSenhaPerfil.
    if (perfil.admin && perfil.dekEnvelopeRecuperacao) {
      const pinNormalizado = (pin || '').toUpperCase().trim();
      const dekViaPin = await copilotoAbrirEnvelopePorTexto(perfil.dekEnvelopeRecuperacao, pinNormalizado, 'dek-por-recuperacao').catch(() => null);
      if (!dekViaPin) return { ok: false, erro: 'PIN incorreto.' };
    }

    if (perfil.dekEnvelopeSenha) {
      dek = await copilotoAbrirEnvelopePorTexto(perfil.dekEnvelopeSenha, senhaAtual, 'dek-por-senha').catch(() => null);
    }
    if (perfil.admin) {
      amkConhecida = await copilotoObterAmkComSenhaAdmin(senhaAtual);
    }
  } else {
    // forcar:true pula a senha atual (e o PIN) inteiramente — não dá pra
    // confiar só em quem chamou já ter checado copilotoSessaoEhAdmin() na
    // tela: uma chamada direta a esta função (ex.: console do navegador),
    // sem passar pela tela nenhuma, chegaria aqui com forcar:true sem
    // nenhuma autoridade de verdade. Confere de novo, aqui dentro, antes de
    // aceitar o atalho — sem isso, qualquer perfil comum trocava a senha de
    // QUALQUER outro perfil (inclusive o admin) sem saber senha nenhuma.
    if (!(await copilotoSessaoEhAdmin())) {
      return { ok: false, erro: 'Você não tem privilégios suficientes para esta ação. Ligue como administrador geral.' };
    }
    // Recupera o DEK sem precisar da senha antiga, pela chave-mestra (AMK)
    // já desembrulhada nesta sessão. Sem ela disponível, os campos
    // protegidos antigos deste perfil se perdem (ver dadosProtegidosPerdidos).
    if (perfil.dekEnvelopeAmk && typeof copilotoObterAmkDaSessao === 'function') {
      const amk = await copilotoObterAmkDaSessao();
      if (amk) dek = await copilotoDesenvolverChave(perfil.dekEnvelopeAmk, amk).catch(() => null);
    }
  }

  const erroSenha = copilotoValidarSenhaPerfil(novaSenha);
  if (erroSenha) return { ok: false, erro: erroSenha };

  return _copilotoRegravarSenhaEDek(perfilId, novaSenha, dek, amkConhecida);
}

// Recuperação de senha SEM precisar do admin — só com o código de
// recuperação do PRÓPRIO perfil (mostrado uma única vez na criação, e de
// novo a cada troca de senha — ver copilotoCriarPerfil e
// _copilotoRegravarSenhaEDek). O código em si já É a prova de identidade
// aqui: se ele conseguir abrir o DEK do perfil, a pessoa tem autoridade de
// trocar a senha — não precisa de mais nada. Serve pra qualquer perfil,
// inclusive o admin (mas o admin também tem o caminho por usuário/senha
// geral, ver copilotoRecuperarSenhaAdmin, útil se ele perder o código E a
// senha ao mesmo tempo).
async function copilotoRecuperarSenhaComCodigo(perfilId, codigoRecuperacao, novaSenha) {
  const perfil = await copilotoObterPerfilPorId(perfilId);
  if (!perfil) return { ok: false, erro: 'Perfil não encontrado.' };
  if (!perfil.dekEnvelopeRecuperacao) {
    return { ok: false, erro: 'Este perfil ainda não tem um código de recuperação — peça pro administrador redefinir sua senha.' };
  }

  // Mesmo bloqueio por tentativas erradas usado pra senha normal deste
  // perfil (copilotoStatusBloqueioSenha/copilotoRegistrarTentativaFalha) —
  // antes só era conferido no callsite da senha normal (ver
  // desbloquearPerfilClick em panel.js), nunca aqui. Sem isto, o código de
  // recuperação (também um segredo que desembrulha o mesmo DEK) podia ser
  // adivinhado sem limite nenhum de tentativas, mesmo com o resto do
  // sistema todo protegido por esse bloqueio de 60s a cada 3 erros.
  const statusAtual = await copilotoStatusBloqueioSenha(perfilId);
  if (statusAtual.bloqueado) return { ok: false, erro: 'Muitas tentativas erradas. Tente novamente em instantes.' };

  const codigoNormalizado = (codigoRecuperacao || '').toUpperCase().trim();
  const dek = await copilotoAbrirEnvelopePorTexto(perfil.dekEnvelopeRecuperacao, codigoNormalizado, 'dek-por-recuperacao').catch(() => null);
  if (!dek) {
    await copilotoRegistrarTentativaFalha(perfilId);
    return { ok: false, erro: 'Código de recuperação incorreto.' };
  }

  const erroSenha = copilotoValidarSenhaPerfil(novaSenha);
  if (erroSenha) return { ok: false, erro: erroSenha };

  const amk = perfil.admin ? await copilotoObterAmkComCodigoRecuperacao(codigoNormalizado) : null;
  return _copilotoRegravarSenhaEDek(perfilId, novaSenha, dek, amk);
}

// Recuperação da senha do administrador geral — a última "porta dos
// fundos" desta instalação, pro caso de esquecer a senha E/OU perder o
// código de recuperação (sem os dois, uma troca normal de senha não é
// possível — ver copilotoAlterarSenhaPerfil/copilotoRecuperarSenhaComCodigo
// acima). Sem isto, seria um beco sem saída: o reset geral também exige
// autoridade de admin de sessão (ver copilotoSessaoEhAdmin), então nem ele
// resolveria. Reaproveita o usuário/senha GERAL do sistema (auth.js) como
// segundo fator — só quem já tem esse acesso consegue redefinir a senha do
// admin, sem precisar saber a antiga.
//
// `codigoRecuperacao` é opcional aqui: se informado (e ainda válido),
// recupera o DEK e a AMK certinhos, sem perder nenhum campo protegido nem
// derrubar o acesso do admin aos perfis dos outros profissionais. Sem ele,
// uma DEK e uma AMK novas são geradas — os campos protegidos do PRÓPRIO
// perfil admin se perdem, e o acesso às dos outros perfis só volta
// conforme cada um trocar a própria senha de novo (ver
// _copilotoRegravarSenhaEDek).
async function copilotoRecuperarSenhaAdmin(usuarioGeral, senhaGeral, novaSenha, codigoRecuperacao) {
  // Mesmo bloqueio por tentativas erradas que protege usuário/senha GERAL em
  // todo outro lugar que os confere (login normal, Avançado, confirmação de
  // reset total — ver COPILOTO_LOCKOUT_AREA_RESTRITA e seus chamadores em
  // auth.js). Esta tela de recuperação confere a MESMA credencial, mas
  // ficava fora desse bloqueio compartilhado — na prática, uma quinta porta
  // pra adivinhar usuário/senha geral sem limite nenhum de tentativas.
  if (typeof COPILOTO_LOCKOUT_AREA_RESTRITA !== 'undefined') {
    const statusAtual = await copilotoStatusBloqueioSenha(COPILOTO_LOCKOUT_AREA_RESTRITA);
    if (statusAtual.bloqueado) return { ok: false, erro: 'Muitas tentativas erradas. Tente novamente em instantes.' };
  }

  const credenciaisOk = await copilotoVerificarCredenciais(usuarioGeral, senhaGeral);
  if (!credenciaisOk) {
    if (typeof COPILOTO_LOCKOUT_AREA_RESTRITA !== 'undefined') {
      await copilotoRegistrarTentativaFalha(COPILOTO_LOCKOUT_AREA_RESTRITA);
    }
    return { ok: false, erro: 'Usuário ou senha geral do sistema incorretos.' };
  }
  if (typeof COPILOTO_LOCKOUT_AREA_RESTRITA !== 'undefined') {
    await copilotoLimparTentativas(COPILOTO_LOCKOUT_AREA_RESTRITA);
  }

  const admin = await copilotoObterPerfilAdmin();
  if (!admin) return { ok: false, erro: 'Nenhum administrador cadastrado ainda.' };

  const erroSenha = copilotoValidarSenhaPerfil(novaSenha);
  if (erroSenha) return { ok: false, erro: erroSenha };

  let dek = null;
  let amk = null;
  if (codigoRecuperacao) {
    const codigoNormalizado = (codigoRecuperacao || '').toUpperCase().trim();
    if (admin.dekEnvelopeRecuperacao) {
      dek = await copilotoAbrirEnvelopePorTexto(admin.dekEnvelopeRecuperacao, codigoNormalizado, 'dek-por-recuperacao').catch(() => null);
    }
    amk = await copilotoObterAmkComCodigoRecuperacao(codigoNormalizado);
  }

  const resultado = await _copilotoRegravarSenhaEDek(admin.id, novaSenha, dek, amk);
  if (!resultado.ok) return resultado;
  return {
    ok: true,
    perfil: admin,
    codigoRecuperacaoNovo: resultado.codigoRecuperacaoNovo,
    dadosProtegidosPerdidos: resultado.dadosProtegidosPerdidos,
    amkPerdida: resultado.amkPerdida,
    dek: resultado.dek,
    amk: resultado.amk
  };
}

// Remove um perfil (e todos os dados isolados dele). Só quem já é
// administrador geral pode chamar isto — confere de novo aqui dentro (mesmo
// motivo do "forcar:true" em copilotoAlterarSenhaPerfil e de
// copilotoDefinirTrocaSemSenha acima): uma chamada direta a esta função
// (console do navegador, sem passar pela tela de perfis) chegaria aqui sem
// nenhuma autoridade de verdade. Por segurança dupla, também nunca permite
// excluir o próprio perfil admin (a instalação sempre precisa ter um).
async function copilotoExcluirPerfil(id) {
  if (!(await copilotoSessaoEhAdmin())) {
    return { ok: false, erro: 'Você não tem privilégios suficientes para esta ação. Ligue como administrador geral.' };
  }
  const resultado = await copilotoSerializarPorChave(COPILOTO_PERFIS_KEY, async () => {
    const lista = await copilotoListarPerfis();
    const alvo = lista.find((p) => p.id === id);
    if (!alvo) return { ok: false, erro: 'Perfil não encontrado.' };
    if (alvo.admin) return { ok: false, erro: 'O perfil administrador geral não pode ser excluído.' };

    const novaLista = lista.filter((p) => p.id !== id);
    await copilotoSalvarListaPerfis(novaLista);
    return { ok: true };
  });
  if (!resultado.ok) return resultado;

  await copilotoRemoverDadosDoPerfil(id);
  await copilotoLimparTentativas(id); // não deixa órfão o contador de bloqueio de um perfil que não existe mais

  const ativo = await copilotoPerfilAtivoId();
  if (ativo === id) await copilotoLimparPerfilAtivo();
  const sessaoAdminId = await copilotoSessaoAdminIdAtual();
  if (sessaoAdminId === id) await copilotoLimparSessaoAdmin();

  return { ok: true };
}

// ---------- Perfil ativo na sessão atual (chrome.storage.session — some ao fechar o navegador) ----------

async function copilotoPerfilAtivoId() {
  try {
    const data = await chrome.storage.session.get(COPILOTO_PERFIL_ATIVO_KEY);
    return data[COPILOTO_PERFIL_ATIVO_KEY] || null;
  } catch (e) {
    return null;
  }
}

async function copilotoDefinirPerfilAtivoId(id) {
  try {
    await chrome.storage.session.set({ [COPILOTO_PERFIL_ATIVO_KEY]: id });
  } catch (e) {}
}

// Limpa qual perfil está ativo E a DEK desse perfil que está saindo (nunca a
// AMK — ver copilotoLimparChavesDaSessao em auth.js pra limpeza completa).
// Poupar a AMK é de propósito: quem chama isto pra trocar de perfil mantendo
// a autoridade de admin (ver trocarPerfilClick em panel.js) depende
// explicitamente da chave-mestra continuar disponível pro próximo perfil que
// for aberto — se ela fosse limpa aqui, o "modo administrador" pararia de
// dar acesso aos campos protegidos de qualquer outro perfil, e pior:
// redefinir a senha de um profissional que esqueceu a dele (options.js,
// salvarSenhaMinhaConta com forcar:true) perderia os dados protegidos dele
// de vez, por não achar mais a AMK que os recuperaria.
// Já a DEK do perfil que está saindo não precisa desse mesmo cuidado:
// entrarNoPerfil já sabe redesembrulhá-la a partir da AMK quando quem está
// entrando tem autoridade de admin (ver lá). Sem limpar aqui, a DEK de
// qualquer perfil já aberto uma vez nesta sessão do navegador ficava
// disponível pro resto dela pra quem quer que rodasse código na página
// (ex.: console do navegador) chamar entrarNoPerfil(id) direto e entrar sem
// senha nenhuma — mesmo sem autoridade de admin.
async function copilotoLimparPerfilAtivo() {
  const idQueSaiu = await copilotoPerfilAtivoId();
  try {
    await chrome.storage.session.remove(COPILOTO_PERFIL_ATIVO_KEY);
  } catch (e) {}
  if (idQueSaiu && typeof copilotoLimparDekDaSessao === 'function') {
    await copilotoLimparDekDaSessao(idQueSaiu);
  }
}

async function copilotoObterPerfilAtivo() {
  const id = await copilotoPerfilAtivoId();
  if (!id) return null;
  const perfil = await copilotoObterPerfilPorId(id);
  if (!perfil) {
    // Perfil ativo foi excluído (ex.: em outra aba) — limpa a referência órfã.
    await copilotoLimparPerfilAtivo();
    return null;
  }
  return perfil;
}

// ---------- Autoridade de administrador na sessão (independente do perfil sendo visto agora) ----------
//
// Fica marcada assim que alguém entra com sucesso no perfil administrador
// geral (senha do próprio admin conferida) e continua valendo a sessão
// inteira — inclusive enquanto esse admin estiver "dentro" do perfil de
// outro profissional (ver copilotoPerfilAtivoId), pra poder ver/editar os
// dados dele. É o que libera: reset geral, backup de todos os perfis de uma
// vez, entrar em qualquer perfil sem saber a senha dele, redefinir a senha
// de outro profissional e excluir perfis.

async function copilotoDefinirSessaoAdmin(id) {
  try {
    await chrome.storage.session.set({ [COPILOTO_SESSAO_ADMIN_KEY]: id });
  } catch (e) {}
}

async function copilotoSessaoAdminIdAtual() {
  try {
    const data = await chrome.storage.session.get(COPILOTO_SESSAO_ADMIN_KEY);
    return data[COPILOTO_SESSAO_ADMIN_KEY] || null;
  } catch (e) {
    return null;
  }
}

// Revoga a autoridade de admin da sessão — e, junto, a chave-mestra (AMK)
// que essa autoridade concedia (ver copilotoLimparAmkDaSessao em auth.js):
// sem autoridade de admin, não faz sentido nenhum ainda ter a chave que só
// existe pra servir essa autoridade. copilotoLimparAmkDaSessao só existe em
// páginas normais (auth.js não é carregado no service worker) — daí o
// "typeof", já que este arquivo também roda dentro do background.
async function copilotoLimparSessaoAdmin() {
  try {
    await chrome.storage.session.remove(COPILOTO_SESSAO_ADMIN_KEY);
  } catch (e) {}
  if (typeof copilotoLimparAmkDaSessao === 'function') {
    await copilotoLimparAmkDaSessao();
  }
}

async function copilotoSessaoEhAdmin() {
  const id = await copilotoSessaoAdminIdAtual();
  if (!id) return false;
  const perfil = await copilotoObterPerfilPorId(id);
  return !!(perfil && perfil.admin);
}

// ---------- Isolamento de dados: chave por perfil e wrapper de chrome.storage.local ----------

// chave='' devolve só o prefixo (útil pra checar "essa chave é deste perfil?").
function copilotoChaveComEscopo(perfilId, chave) {
  return perfilId ? `${COPILOTO_PREFIXO_ESCOPO}${perfilId}__${chave}` : chave;
}

// Envolve chrome.storage.local prefixando automaticamente toda chave (leitura,
// escrita e remoção) com o id do perfil ativo no momento da chamada — cada
// profissional cadastrado só enxerga e só grava os próprios dados (leads,
// histórico, funil, campanha, chaves de API, estatísticas). A lista de
// perfis em si (COPILOTO_PERFIS_KEY) e as chaves de autenticação/sessão
// nunca passam por aqui, de propósito — continuam usando chrome.storage
// direto.
const copilotoStorage = {
  local: {
    async get(chaves) {
      const perfilId = await copilotoPerfilAtivoId();
      const lista = Array.isArray(chaves) ? chaves : [chaves];
      const mapaChaves = {};
      lista.forEach((k) => {
        mapaChaves[copilotoChaveComEscopo(perfilId, k)] = k;
      });
      const bruto = await chrome.storage.local.get(Object.keys(mapaChaves));
      const resultado = {};
      Object.entries(bruto).forEach(([chaveComEscopo, valor]) => {
        resultado[mapaChaves[chaveComEscopo]] = valor;
      });
      return resultado;
    },
    async set(obj) {
      const perfilId = await copilotoPerfilAtivoId();
      const comEscopo = {};
      Object.entries(obj).forEach(([k, v]) => {
        comEscopo[copilotoChaveComEscopo(perfilId, k)] = v;
      });
      return chrome.storage.local.set(comEscopo);
    },
    async remove(chaves) {
      const perfilId = await copilotoPerfilAtivoId();
      const lista = Array.isArray(chaves) ? chaves : [chaves];
      return chrome.storage.local.remove(lista.map((k) => copilotoChaveComEscopo(perfilId, k)));
    }
  }
};

// Apaga todas as chaves gravadas por um perfil específico (usado ao excluir
// um perfil). Varre todas as chaves do storage porque os nomes de chave
// dentro de um perfil são dinâmicos (ex.: "hist:<leadId>"), não uma lista fixa.
async function copilotoRemoverDadosDoPerfil(perfilId) {
  if (!perfilId) return;
  const prefixo = copilotoChaveComEscopo(perfilId, '');
  const tudo = await chrome.storage.local.get(null);
  const chavesDoPerfil = Object.keys(tudo).filter((k) => k.startsWith(prefixo));
  if (chavesDoPerfil.length) await chrome.storage.local.remove(chavesDoPerfil);
}

// Extrai, de um snapshot já lido do storage inteiro, só as chaves de UM
// perfil — com o prefixo removido, ou seja, de volta aos nomes "lógicos" de
// sempre (leads_all, funil, hist:<id>...). Usada tanto pro backup de um
// perfil só quanto pro backup de todos de uma vez, sempre a partir do MESMO
// snapshot lido
// uma única vez — evita inconsistência entre perfis por causa de escritas
// acontecendo no meio da leitura.
function copilotoExtrairDadosDoPerfil(snapshotStorage, perfilId) {
  const prefixo = copilotoChaveComEscopo(perfilId, '');
  const dados = {};
  Object.entries(snapshotStorage).forEach(([chave, valor]) => {
    if (prefixo && chave.startsWith(prefixo)) {
      dados[chave.slice(prefixo.length)] = valor;
    }
  });
  return dados;
}

// ---------- Log de auditoria (sessões e ações sensíveis) — só o admin vê ----------
//
// Guardado numa chave global (chrome.storage.local, sem prefixo de perfil —
// mesmo motivo da lista de perfis: precisa listar entradas de TODOS os
// perfis de uma vez pro administrador, então não faz sentido escopar por
// perfil ativo). A visibilidade é controlada só na tela (Avançado → Log de
// sessões, atrás de copilotoSessaoEhAdmin) — um perfil comum não tem como
// abrir essa tela, mas o registro em si guarda eventos de TODOS os perfis,
// admin incluído.
//
// Retenção: no máximo 90 dias. Tanto ler quanto gravar já descartam de
// cara qualquer entrada mais velha que isso, então o log nunca cresce sem
// limite e nunca guarda nada além do prazo — sem depender de um alarme ou
// de o service worker estar acordado numa hora certa pra fazer a limpeza.
//
// Tipos de evento usados: 'login', 'logout_manual', 'logout_inatividade',
// 'perfil_criado', 'perfil_excluido', 'senha_alterada',
// 'senha_redefinida_por_admin', 'senha_admin_recuperada', 'nome_alterado',
// 'troca_rapida_alterada', 'log_excluido', 'pin_admin_gerado',
// 'acesso_dados_protegidos_admin', 'acesso_equipe_alterado',
// 'backup_realizado', 'backup_todos_perfis_realizado', 'backup_restaurado',
// 'backup_enviado_email', 'relatorio_leads_exportado', 'ficha_lead_exportada',
// 'log_auditoria_exportado', 'lead_criado', 'lead_campo_alterado',
// 'lead_excluido', 'lead_restaurado', 'leads_importados'. (O reset geral
// não gera entrada: ele já apaga o
// storage inteiro, log incluso — é o único evento sem exceção.)
//
// Os eventos de lead nunca guardam o CONTEÚDO de campo protegido — ver
// registrarAlteracaoLeadNoLog em panel.js pro porquê.

const COPILOTO_LOG_KEY = 'copilotoLogAuditoria';
const COPILOTO_LOG_RETENCAO_DIAS = 90;

// ---------- Identificador desta instalação (não é IP nem MAC — não dá pra
// obter nenhum dos dois de dentro de uma extensão, e nenhum dos dois
// mudaria de valor entre acessos, já que só existe UM computador rodando
// os dados por vez) ----------
//
// Um código curto, sorteado uma única vez, na primeira vez que o log é
// usado nesta instalação, e guardado só localmente (nunca em rede
// nenhuma). Serve pra uma coisa específica: como o Co-piloto tem
// backup/restauração entre computadores (ver Avançado), esse código muda
// quando os dados passam a ser abertos numa instalação DIFERENTE da que
// os criou — um sinal que nem IP nem MAC dariam aqui, já que os dois
// seriam sempre o mesmo valor num app de computador único.
const COPILOTO_INSTALACAO_ID_KEY = 'copilotoInstalacaoId';

function copilotoGerarIdInstalacao() {
  // Mesmo alfabeto sem caracteres ambíguos (0/O, 1/I/L) do código de
  // recuperação (ver copilotoGerarCodigoAlfanumerico) — só que bem mais
  // curto, porque aqui não é um segredo criptográfico, é só um rótulo
  // pra reconhecer visualmente "é o mesmo computador de sempre?" no log.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < bytes.length; i++) id += alfabeto[bytes[i] % alfabeto.length];
  return id;
}

async function copilotoObterOuCriarInstalacaoId() {
  try {
    const data = await chrome.storage.local.get(COPILOTO_INSTALACAO_ID_KEY);
    if (data[COPILOTO_INSTALACAO_ID_KEY]) return data[COPILOTO_INSTALACAO_ID_KEY];
    const novoId = copilotoGerarIdInstalacao();
    await chrome.storage.local.set({ [COPILOTO_INSTALACAO_ID_KEY]: novoId });
    return novoId;
  } catch (e) {
    return null;
  }
}

// Sistema operacional resumido (Windows/macOS/Linux/ChromeOS/Android) — só a
// família, nunca a string de user-agent inteira (bem mais verbosa e
// identificável do que o log precisa). Lido na hora, não guardado — não
// muda entre chamadas na mesma instalação, então não faz sentido persistir.
function copilotoDetectarSistemaOperacional() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Desconhecido';
}

// Fuso horário do sistema (ex.: "America/Sao_Paulo") — sinal de região
// aproximada, 100% local (Intl já vem embutido no navegador), sem nenhuma
// chamada de rede nem permissão pedida. Diferente do identificador de
// instalação: o computador pode ser o mesmo e o fuso mudar (viagem, troca
// de fuso do sistema, VPN que também ajusta o relógio) — por isso os dois
// sinais são guardados separados, cada um pode disparar sozinho.
function copilotoObterFusoHorario() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

function copilotoLogDentroDaRetencao(evento) {
  const limite = Date.now() - COPILOTO_LOG_RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  return new Date(evento.quando).getTime() >= limite;
}

// Leitura crua, sem filtrar por retenção nem gravar nada — só quem já está
// dentro da fila de COPILOTO_LOG_KEY (copilotoRegistrarEventoLog,
// copilotoExcluirLogAuditoria) deve usar esta, nunca copilotoListarLogAuditoria:
// chamar a versão com poda de dentro da própria fila seria reentrante (a
// tarefa de fora ficaria esperando a de dentro, que só roda depois que a de
// fora terminar — trava pra sempre).
async function copilotoListarLogAuditoriaBruto() {
  try {
    const data = await chrome.storage.local.get(COPILOTO_LOG_KEY);
    return data[COPILOTO_LOG_KEY] || [];
  } catch (e) {
    return [];
  }
}

async function copilotoListarLogAuditoria() {
  return copilotoSerializarPorChave(COPILOTO_LOG_KEY, async () => {
    const log = await copilotoListarLogAuditoriaBruto();
    const dentroDoPrazo = log.filter(copilotoLogDentroDaRetencao);
    if (dentroDoPrazo.length !== log.length) {
      await chrome.storage.local.set({ [COPILOTO_LOG_KEY]: dentroDoPrazo });
    }
    return dentroDoPrazo;
  });
}

async function copilotoRegistrarEventoLog(tipo, perfil, detalhe) {
  try {
    // Ver copilotoSerializarPorChave acima: sem isto, dois eventos
    // registrados quase ao mesmo tempo (ex.: login seguido de perfil_criado)
    // podiam ler o mesmo log antigo e um sobrescrever o outro, perdendo uma
    // entrada de auditoria.
    const instalacaoId = await copilotoObterOuCriarInstalacaoId();
    const so = copilotoDetectarSistemaOperacional();
    const fusoHorario = copilotoObterFusoHorario();
    await copilotoSerializarPorChave(COPILOTO_LOG_KEY, async () => {
      const log = (await copilotoListarLogAuditoriaBruto()).filter(copilotoLogDentroDaRetencao);
      log.push({
        id: copilotoGerarIdPerfil(),
        tipo,
        perfilId: perfil ? perfil.id : null,
        perfilNome: perfil ? perfil.nome : '(perfil removido)',
        quando: new Date().toISOString(),
        detalhe: detalhe || null,
        instalacaoId,
        so,
        fusoHorario
      });
      await chrome.storage.local.set({ [COPILOTO_LOG_KEY]: log });
    });
  } catch (e) {}
}

// Sem perfilId: apaga o log inteiro (todos os perfis). Com perfilId: apaga
// só as entradas daquele perfil, mantendo as dos demais — é o filtro
// escolhido na tela (ver panel.js).
async function copilotoExcluirLogAuditoria(perfilId) {
  // A tela que chama isto (excluirLogAuditoriaClick, panel.js) já confere
  // copilotoSessaoEhAdmin() antes — mas confere de novo AQUI DENTRO, mesmo
  // motivo de toda outra função sensível deste arquivo (ver
  // copilotoExcluirPerfil, copilotoDefinirTrocaSemSenha,
  // copilotoAlterarSenhaPerfil com forcar:true): uma chamada direta pelo
  // console do navegador, sem passar pela tela nenhuma, chegaria aqui sem
  // nenhuma autoridade de verdade. Sem esta checagem, QUALQUER perfil
  // logado (não só o admin) apagava o log de auditoria inteiro — inclusive
  // pra cobrir o próprio rastro, o oposto exato do que um log de auditoria
  // existe pra impedir.
  if (!(await copilotoSessaoEhAdmin())) {
    return { ok: false, erro: 'Você não tem privilégios suficientes para esta ação. Ligue como administrador geral.' };
  }
  return copilotoSerializarPorChave(COPILOTO_LOG_KEY, async () => {
    if (!perfilId) {
      await chrome.storage.local.remove(COPILOTO_LOG_KEY);
      return { ok: true };
    }
    const log = (await copilotoListarLogAuditoriaBruto()).filter(copilotoLogDentroDaRetencao);
    const restante = log.filter((e) => e.perfilId !== perfilId);
    await chrome.storage.local.set({ [COPILOTO_LOG_KEY]: restante });
    return { ok: true };
  });
}
