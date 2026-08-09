
// A trava de aba duplicada (copilotoAbaDuplicada /
// copilotoChecagemAbaDuplicada, usadas mais abaixo) vive em aba-unica.js,
// carregado antes deste arquivo nas duas páginas.

// ---------- Área restrita: login (usuário/senha) para acessar Configurações (usa auth.js compartilhado) ----------

function liberarConfig(){
  document.getElementById('configLockScreen').style.display = 'none';
  document.getElementById('configApp').style.display = 'grid';
  init();
  atualizarFaixaAdminImpersonando();
  atualizarMinhaContaForm();
  copilotoMonitorarAtividade();
  copilotoIniciarChecagemInatividade(bloquearConfigPorInatividade);
}

// atualizarFaixaAdminImpersonando vive em auth.js (compartilhada com panel.js).

document.getElementById('adminImpersonandoVoltarBtn').addEventListener('click', async ()=>{
  const admin = await copilotoObterPerfilAdmin();
  if(!admin) return;
  // Mesmo registro de log que panel.js faz em voltarAoMeuPerfilAdmin (via
  // entrarNoPerfil) — sem isto, sair do modo impersonando aqui em
  // Configurações não deixava rastro nenhum no log de auditoria.
  await copilotoRegistrarEventoLog('login', admin);
  await copilotoDefinirPerfilAtivoId(admin.id);
  window.location.reload();
});

// ---------- Minha conta: cada profissional cadastra/troca a própria senha ----------
//
// Uso normal (dono do perfil trocando a própria senha): pede a senha atual
// antes de aceitar a nova. Exceção: quando quem está na tela é o
// administrador geral E está dentro do perfil de OUTRO profissional (modo
// impersonando, ver atualizarFaixaAdminImpersonando) — nesse caso o campo de
// senha atual nem aparece, porque a própria autoridade de admin já é a
// permissão necessária pra redefinir a senha de quem esqueceu a dela.
async function atualizarMinhaContaForm(){
  const perfilAtivo = await copilotoObterPerfilAtivo();
  const nomeEl = document.getElementById('minhaContaNome');
  if(!perfilAtivo){ nomeEl.textContent = '—'; return; }
  nomeEl.textContent = perfilAtivo.nome + (perfilAtivo.admin ? ' (Administrador geral)' : '');

  // O nome é editável pra qualquer perfil, admin incluído — a única coisa
  // que o admin nunca pode fazer com o próprio perfil é excluí-lo (ver
  // copilotoExcluirPerfil em perfis.js).
  document.getElementById('minhaContaNomeInput').value = perfilAtivo.nome;
  document.getElementById('minhaContaNomeMsg').textContent = '';

  const sessaoAdmin = await copilotoSessaoEhAdmin();
  const redefinindoOutroPerfil = sessaoAdmin && !perfilAtivo.admin;
  document.getElementById('minhaContaSenhaAtual').closest('.field').style.display = redefinindoOutroPerfil ? 'none' : 'block';
  document.getElementById('minhaContaSalvarBtn').textContent = redefinindoOutroPerfil ? 'Redefinir senha deste profissional' : 'Alterar senha';
  document.getElementById('minhaContaMsg').textContent = '';

  // PIN alfanumérico: só existe pro admin (é o mesmo código de recuperação
  // dele, ver copilotoGerarCodigoAlfanumerico em perfis.js), e só entra na
  // troca normal da PRÓPRIA senha dele (nunca quando o admin está
  // redefinindo a senha de outro profissional — ali a autoridade de
  // sessão já basta).
  const pedirPin = perfilAtivo.admin && !redefinindoOutroPerfil;
  document.getElementById('minhaContaPinCampo').style.display = pedirPin ? 'block' : 'none';
  if(pedirPin) document.getElementById('minhaContaPinInput').value = '';
}

// mostrarPinAdminModal/mostrarCodigoRecuperacaoModal (e o listener de #palavraChaveCopiarBtn) vivem em auth.js (compartilhados com panel.js).

async function salvarNomeMinhaConta(){
  const perfilAtivo = await copilotoObterPerfilAtivo();
  const msgEl = document.getElementById('minhaContaNomeMsg');
  if(!perfilAtivo) return;

  const novoNome = document.getElementById('minhaContaNomeInput').value;
  const nomeAnterior = perfilAtivo.nome;
  const resultado = await copilotoAlterarNomePerfil(perfilAtivo.id, novoNome);
  if(!resultado.ok){
    msgEl.textContent = resultado.erro;
    msgEl.style.color = '#B3261E';
    return;
  }

  await copilotoRegistrarEventoLog('nome_alterado', resultado.perfil, `Antes: ${nomeAnterior}`);
  toast('Nome atualizado ✓');
  await atualizarMinhaContaForm();
  await atualizarFaixaAdminImpersonando();
}

document.getElementById('minhaContaSalvarNomeBtn').addEventListener('click', salvarNomeMinhaConta);
bindEnterKey('minhaContaNomeInput', salvarNomeMinhaConta);

async function salvarSenhaMinhaConta(){
  const perfilAtivo = await copilotoObterPerfilAtivo();
  const msgEl = document.getElementById('minhaContaMsg');
  if(!perfilAtivo){ return; }

  const sessaoAdmin = await copilotoSessaoEhAdmin();
  const forcar = sessaoAdmin && !perfilAtivo.admin;
  const senhaAtual = document.getElementById('minhaContaSenhaAtual').value;
  const pin = document.getElementById('minhaContaPinInput').value;
  const novaSenha = document.getElementById('minhaContaSenhaNova').value;
  const confirmar = document.getElementById('minhaContaSenhaConfirmar').value;

  if(novaSenha !== confirmar){
    msgEl.textContent = 'As senhas digitadas não são iguais.';
    msgEl.style.color = '#B3261E';
    return;
  }

  const resultado = await copilotoAlterarSenhaPerfil(perfilAtivo.id, { senhaAtual, novaSenha, forcar, pin });
  if(!resultado.ok){
    msgEl.textContent = resultado.erro;
    msgEl.style.color = '#B3261E';
    return;
  }

  await copilotoRegistrarEventoLog(forcar ? 'senha_redefinida_por_admin' : 'senha_alterada', perfilAtivo);
  document.getElementById('minhaContaSenhaAtual').value = '';
  document.getElementById('minhaContaPinInput').value = '';
  document.getElementById('minhaContaSenhaNova').value = '';
  document.getElementById('minhaContaSenhaConfirmar').value = '';
  msgEl.textContent = forcar ? 'Senha redefinida com sucesso.' : 'Senha alterada com sucesso.';
  msgEl.style.color = 'var(--teal-dark)';
  toast(forcar ? 'Senha do profissional redefinida ✓' : 'Senha alterada ✓');

  // Se esta troca é do PRÓPRIO perfil ativo, atualiza o DEK na sessão —
  // ele muda de chave só quando não foi possível recuperar o antigo (ver
  // dadosProtegidosPerdidos abaixo); do contrário é o mesmo DEK de sempre,
  // só reembrulhado, mas guardar de novo não faz mal nenhum.
  if(resultado.dek) await copilotoGuardarDekNaSessao(perfilAtivo.id, resultado.dek);
  if(resultado.amk) await copilotoGuardarAmkNaSessao(resultado.amk);

  // As duas causas são independentes uma da outra (podem acontecer juntas
  // ou separadas) — o aviso avalia CADA UMA, em vez de assumir qual foi
  // pelo valor de `forcar`. Antes disso: um perfil comum trocando a PRÓPRIA
  // senha (forcar=false) que perdesse os próprios dados protegidos
  // (dadosProtegidosPerdidos) recebia uma mensagem só sobre "outros perfis
  // (modo administrador)" — que não faz sentido nenhum pra quem não é
  // admin, e nunca avisava sobre a perda real: os PRÓPRIOS CPF/e-mail/CEP/
  // nascimento/notas/chaves de API, apagados sem volta.
  if(resultado.dadosProtegidosPerdidos || resultado.amkPerdida){
    const partes = [];
    if(resultado.dadosProtegidosPerdidos){
      partes.push('os dados protegidos deste perfil (CPF, e-mail, CEP, nascimento, notas, chaves de API) se perderam — só eram recuperáveis com a senha antiga ou o código de recuperação dele');
    }
    if(resultado.amkPerdida){
      partes.push('sem a chave-mestra disponível, o acesso aos dados protegidos dos outros perfis (modo administrador) ficou temporariamente inacessível — volta conforme cada um trocar a própria senha de novo');
    }
    await copilotoAvisar((forcar ? 'Senha redefinida' : 'Senha alterada') + ', mas ' + partes.join('; e ') + '.',
      { titulo: 'Leia antes de continuar' });
  }

  await copilotoMostrarCodigoRecuperacaoNovo(
    perfilAtivo, resultado.codigoRecuperacaoNovo, 'Gerado na troca de senha');
}

document.getElementById('minhaContaSalvarBtn').addEventListener('click', salvarSenhaMinhaConta);

// Configurações é sempre acessada de dentro de um perfil já escolhido (o
// botão de engrenagem só existe dentro do painel, depois da tela de
// perfis) — se por algum motivo esta página abrir sem um perfil ativo na
// sessão (ex.: link direto, ou sessão de perfil encerrada em outra aba),
// não faz sentido mostrar/gravar configurações "soltas", sem dono: volta
// pro painel, que cuida de escolher o perfil primeiro.
async function exigirPerfilAtivoOuVoltar(){
  const perfil = await copilotoObterPerfilAtivo();
  if(!perfil){
    window.location.href = 'panel.html';
    return false;
  }
  return true;
}

async function bloquearConfigPorInatividade(){
  const app = document.getElementById('configApp');
  if(app.style.display === 'none') return;
  app.style.display = 'none';
  document.getElementById('configPasswordInput').value = '';
  const errorEl = document.getElementById('configLockError');
  errorEl.textContent = 'Sessão expirada por inatividade. Informe usuário e senha para continuar.';
  errorEl.style.display = 'block';
  document.getElementById('configLockScreen').style.display = 'flex';
  // Encerra o perfil escolhido e a eventual autoridade de admin — sem isto,
  // digitar de novo só o usuário/senha GERAL (em exigirPerfilAtivoOuVoltar
  // + liberarConfig, logo abaixo) retomava direto no mesmo perfil de
  // antes (inclusive um perfil de outro profissional, se era isso que
  // estava sendo impersonado), sem nunca pedir a senha DELE — quem soubesse
  // só a credencial geral conseguia voltar a ver/editar os dados de
  // qualquer profissional depois de uma sessão expirar. Mesmo par de
  // chamadas que panel.js já faz em bloquearPainelPorInatividade.
  await copilotoLimparPerfilAtivo();
  await copilotoLimparSessaoAdmin();
  const usuario = await copilotoPreencherUsuarioSalvo('configUserInput');
  const focoId = usuario ? 'configPasswordInput' : 'configUserInput';
  const jaBloqueado = await copilotoChecarBloqueioAreaRestrita('configPasswordInput', 'configUnlockBtn', 'configLockError');
  if(!jaBloqueado) setTimeout(()=>document.getElementById(focoId).focus(), 50);
}

// Usa a função compartilhada de auth.js (verificar -> shake -> limpar -> refocar
// em caso de erro; marcar sessão -> rodar callback em caso de sucesso) em vez
// de repetir essa sequência aqui.
async function tentarDesbloquearConfig(){
  return await copilotoTentarLogin({
    userInputId: 'configUserInput',
    passInputId: 'configPasswordInput',
    errorId: 'configLockError',
    submitBtnId: 'configUnlockBtn',
    shakeEl: document.querySelector('#configLockScreen .avancado-lock'),
    aoAutenticar: async ()=>{
      if(!(await exigirPerfilAtivoOuVoltar())) return;
      liberarConfig();
    }
  });
}

document.getElementById('configUnlockBtn').addEventListener('click', tentarDesbloquearConfig);
// bindEnterKey() vem de auth.js (carregado antes deste arquivo em options.html).
bindEnterKey('configUserInput', tentarDesbloquearConfig);
bindEnterKey('configPasswordInput', tentarDesbloquearConfig);
document.getElementById('configTogglePassBtn').addEventListener('click', ()=>{
  const input = document.getElementById('configPasswordInput');
  input.type = input.type === 'password' ? 'text' : 'password';
});

(async ()=>{
  await copilotoChecagemAbaDuplicada;
  if(copilotoAbaDuplicada) return;

  if(await copilotoEstaAutenticado()){
    if(!(await exigirPerfilAtivoOuVoltar())) return;
    liberarConfig();
  }else{
    const usuario = await copilotoPreencherUsuarioSalvo('configUserInput');
    const focoId = usuario ? 'configPasswordInput' : 'configUserInput';
    const jaBloqueado = await copilotoChecarBloqueioAreaRestrita('configPasswordInput', 'configUnlockBtn', 'configLockError');
    if(!jaBloqueado) setTimeout(()=>document.getElementById(focoId).focus(), 50);
  }
})();

const DEFAULT_FUNIL = {
  instrucoes: DEFAULT_FUNIL_INSTRUCOES
};

// toast() vem de auth.js (carregado antes deste arquivo em options.html).

// Só atualiza a tela (cartão selecionado + campos visíveis) — não grava
// nada. Usado tanto por selectProvider() (clique do usuário) quanto por
// init() (carregamento da página), que não deve escrever no storage só por
// estar mostrando o valor já salvo.
function renderProviderCards(provider){
  document.getElementById('cardClaude').classList.toggle('selected', provider==='claude');
  document.getElementById('cardGemini').classList.toggle('selected', provider==='gemini');
  document.getElementById('claudeFields').style.display = provider==='claude' ? 'block':'none';
  document.getElementById('geminiFields').style.display = provider==='gemini' ? 'block':'none';
}

// Clique num dos cartões: atualiza a tela E já persiste a escolha.
function selectProvider(provider){
  renderProviderCards(provider);
  copilotoStorage.local.set({ provider });
}

// As chaves de API são um campo protegido (ver auth.js) — cifradas com o
// DEK do perfil ativo antes de gravar. Um campo BLOQUEADO (ver init(), que
// desabilita o campo quando não consegue decifrar o valor salvo — DEK
// indisponível nesta sessão) nunca é reescrito: mantém o valor que já
// estava salvo em vez de gravar a string vazia que o campo bloqueado
// mostra por cima. Sem DEK disponível, uma chave NOVA digitada também não
// é salva (nunca em texto puro) — fica assinalado em `bloqueouAlgumaChave`
// pra saveKeys() poder avisar.
async function valorChaveApiParaSalvar(inputId, valorAtualSalvo, dek, avisoRef){
  const input = document.getElementById(inputId);
  if(input.disabled) return valorAtualSalvo || '';
  const digitado = input.value.trim();
  if(!digitado) return '';
  if(!dek){ avisoRef.bloqueou = true; return valorAtualSalvo || ''; }
  return copilotoCifrarAesGcm(dek, digitado);
}

async function saveKeys(){
  const provider = document.getElementById('cardClaude').classList.contains('selected') ? 'claude' : 'gemini';
  const dek = await obterDekAtivo();
  const atual = await copilotoStorage.local.get(['claudeKey','geminiKeyBasico','geminiKeyAvancado']);
  const avisoRef = { bloqueou: false };
  await copilotoStorage.local.set({
    provider,
    claudeKey: await valorChaveApiParaSalvar('claudeKey', atual.claudeKey, dek, avisoRef),
    claudeModel: document.getElementById('claudeModel').value.trim() || 'claude-sonnet-5',
    // Vazio de propósito quando a pessoa deixa em "Desligado": é assim que
    // panel.js sabe que não deve rotear nada (ver callClaudeComTier).
    claudeModeloBasico: document.getElementById('claudeModeloBasico').value.trim(),
    // Gemini agora tem dois níveis (ver comentário em panel.js, escolherTierPorEstagio):
    // básico pra maioria das etapas do funil, avançado só nas de maior risco pra
    // venda. A chave avançada é opcional — se ficar em branco, a básica assume
    // essas etapas também, sempre com o modelo que o humano escolheu pra ela (o
    // modelo nunca troca sozinho). Padrão de fábrica em ambas: o modelo mais
    // econômico — trocar por algo mais robusto é sempre escolha manual.
    geminiKeyBasico: await valorChaveApiParaSalvar('geminiKeyBasico', atual.geminiKeyBasico, dek, avisoRef),
    geminiModeloBasico: document.getElementById('geminiModeloBasico').value.trim() || 'gemini-flash-lite-latest',
    geminiKeyAvancado: await valorChaveApiParaSalvar('geminiKeyAvancado', atual.geminiKeyAvancado, dek, avisoRef),
    geminiModeloAvancado: document.getElementById('geminiModeloAvancado').value.trim() || 'gemini-flash-lite-latest'
  });
  // Migração de verdade (não só leitura com fallback) das chaves legadas
  // "geminiKey"/"geminiModel" (de antes de existir Chave A/B) — sem isto,
  // limpar o campo "Chave A" nunca desativava a chave de verdade: o
  // fallback `data.geminiKeyBasico || data.geminiKey` (ver init() abaixo e
  // panel.js) fazia a chave antiga "ressuscitar" sozinha assim que
  // geminiKeyBasico ficasse vazio, mesmo depois de a pessoa apagá-la e
  // salvar de propósito. Só remove se NADA ficou bloqueado por falta de
  // chave (avisoRef.bloqueou): se algum campo não pôde ser salvo agora
  // (sem DEK disponível), apagar a legada aqui e agora poderia destruir os
  // dois valores de uma vez, sem nenhum pra recuperar depois.
  if(!avisoRef.bloqueou){
    await copilotoStorage.local.remove(['geminiKey', 'geminiModel']);
  }
  if(avisoRef.bloqueou){
    toast('Modelos salvos, mas a(s) chave(s) nova(s) digitada(s) NÃO foram salvas — sem acesso protegido agora');
  }else{
    toast('Chaves e modelos salvos');
  }
}

async function saveFunil(){
  const funil = {
    instrucoes: document.getElementById('funilInstrucoes').value.trim()
  };
  await copilotoStorage.local.set({ funil });
  toast('Seu funil foi salvo');
}

async function savePrecos(){
  const precosToken = {};
  const ci = parseFloat(document.getElementById('precoClaudeInput').value);
  const co = parseFloat(document.getElementById('precoClaudeOutput').value);
  const gi = parseFloat(document.getElementById('precoGeminiInput').value);
  const go = parseFloat(document.getElementById('precoGeminiOutput').value);
  const giAvancado = parseFloat(document.getElementById('precoGeminiAvancadoInput').value);
  const goAvancado = parseFloat(document.getElementById('precoGeminiAvancadoOutput').value);
  // Mesmo fallback de saveKeys() logo acima — as duas leem o MESMO campo
  // <select id="claudeModel"> (que já vem com "Sonnet 5" marcado como
  // selected no HTML). Aqui usava 'claude-haiku-4-5-20251001', sobra de
  // antes do padrão de fábrica ter virado Sonnet 5 como principal: gravar
  // um preço com fallback errado salvaria a estimativa de custo sob o
  // modelo errado, se este campo alguma vez viesse vazio.
  const claudeModel = document.getElementById('claudeModel').value.trim() || 'claude-sonnet-5';
  const geminiModeloBasico = document.getElementById('geminiModeloBasico').value.trim() || 'gemini-flash-lite-latest';
  const geminiModeloAvancado = document.getElementById('geminiModeloAvancado').value.trim() || 'gemini-flash-lite-latest';

  if(!isNaN(ci) || !isNaN(co)){
    precosToken[claudeModel] = { input: isNaN(ci)?0:ci, output: isNaN(co)?0:co };
  }
  if(!isNaN(gi) || !isNaN(go)){
    precosToken[geminiModeloBasico] = { input: isNaN(gi)?0:gi, output: isNaN(go)?0:go };
  }
  // Preço é do MODELO, não da chave — se a Chave A e a Chave B apontarem pro
  // mesmo modelo, os campos das duas já são mantidos sincronizados em tempo
  // real enquanto a pessoa digita (ver sincronizarPrecoGeminiEspelhado
  // abaixo), então as duas gravações a seguir caem na mesma entrada de
  // precosToken com o MESMO valor — nenhuma sobrescreve a outra com dado
  // desatualizado.
  if(!isNaN(giAvancado) || !isNaN(goAvancado)){
    precosToken[geminiModeloAvancado] = { input: isNaN(giAvancado)?0:giAvancado, output: isNaN(goAvancado)?0:goAvancado };
  }
  await copilotoStorage.local.set({ precosToken });
  toast('Preços por token salvos');
}

// Zera só o contador "🧮 respostas geradas" (mês/total) exibido na tela
// principal do painel. Não mexe no histórico de respostas de cada lead nem
// no uso/custo de tokens de "Minha conta" — são três contadores
// independentes, cada um com seu próprio propósito e seu próprio botão de
// zerar. O painel (panel.js) escuta chrome.storage.onChanged e se
// re-renderiza sozinho assim que "usageStats" muda, então não precisa fazer
// nada além de gravar aqui.
async function resetUsageStats(){
  const confirmado = await copilotoConfirmar(
    'Isso vai zerar o contador de "respostas geradas" (mês e total) mostrado na tela principal. Essa ação não pode ser desfeita.',
    { titulo: 'Zerar contador de respostas?', textoConfirmar: 'Zerar contador' });
  if(!confirmado) return;
  await copilotoStorage.local.set({ usageStats: {} });
  toast('Contador de respostas geradas zerado');
}

// Os campos de modelo viraram <select> com uma lista fechada de opções — mas
// alguém pode já ter um modelo salvo de antes (de quando o campo era texto
// livre) que não está nessa lista, seja um modelo mais antigo, seja um
// lançado depois desta versão. Nesses casos, em vez de a seleção ficar em
// branco (e o valor real acabar sendo trocado sozinho na próxima vez que a
// pessoa salvar qualquer coisa nesta tela — trocando o modelo dela sem
// avisar), injeta uma opção extra com o valor exato que já estava salvo, já
// selecionada. A lista curada continua disponível pra quem quiser trocar.
function selecionarPreservandoValor(selectEl, valor){
  selectEl.value = valor;
  if(selectEl.value !== valor){
    const opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = `${valor} (já configurado, fora da lista atual)`;
    selectEl.insertBefore(opt, selectEl.firstChild);
    selectEl.value = valor;
  }
}

// Reflete, em tempo real (a cada digitação nos campos de chave), se o
// roteamento inteligente por estágio está ativo (as duas chaves preenchidas)
// ou não (zero ou uma chave só) — puramente visual, não salva nada.
function atualizarRoteamentoStatus(){
  const el = document.getElementById('geminiRoutingStatus');
  if(!el) return;
  const chaveA = document.getElementById('geminiKeyBasico').value.trim();
  const chaveB = document.getElementById('geminiKeyAvancado').value.trim();
  const ativo = !!(chaveA && chaveB);
  el.classList.toggle('on', ativo);
  el.classList.toggle('off', !ativo);
  document.getElementById('geminiRoutingStatusTitle').textContent = ativo
    ? 'Roteamento inteligente ativo'
    : 'Roteamento inativo';
  document.getElementById('geminiRoutingStatusSub').textContent = ativo
    ? 'Chave A cuida do dia a dia, Chave B das etapas decisivas.'
    : (chaveA || chaveB)
      ? 'Só uma chave configurada — ela responde por todas as etapas.'
      : 'Nenhuma chave configurada ainda.';
}
document.getElementById('geminiKeyBasico').addEventListener('input', atualizarRoteamentoStatus);
document.getElementById('geminiKeyAvancado').addEventListener('input', atualizarRoteamentoStatus);

// Carrega os preços de Chave A e Chave B a partir de precosToken, usando o
// modelo ATUALMENTE selecionado em cada <select> — chamada no init() e de
// novo sempre que a pessoa troca o modelo de uma das chaves, senão o campo
// de preço ficaria mostrando o preço do modelo antigo depois da troca.
async function carregarPrecosGemini(){
  const { precosToken } = await copilotoStorage.local.get(['precosToken']);
  const precos = precosToken || {};
  const modeloBasico = document.getElementById('geminiModeloBasico').value.trim() || 'gemini-flash-lite-latest';
  const modeloAvancado = document.getElementById('geminiModeloAvancado').value.trim() || 'gemini-flash-lite-latest';
  const precoBasico = precos[modeloBasico];
  const precoAvancado = precos[modeloAvancado];
  document.getElementById('precoGeminiInput').value = precoBasico ? (precoBasico.input ?? '') : '';
  document.getElementById('precoGeminiOutput').value = precoBasico ? (precoBasico.output ?? '') : '';
  document.getElementById('precoGeminiAvancadoInput').value = precoAvancado ? (precoAvancado.input ?? '') : '';
  document.getElementById('precoGeminiAvancadoOutput').value = precoAvancado ? (precoAvancado.output ?? '') : '';
}
document.getElementById('geminiModeloBasico').addEventListener('change', carregarPrecosGemini);
document.getElementById('geminiModeloAvancado').addEventListener('change', carregarPrecosGemini);

// Se a Chave A e a Chave B estiverem no MESMO modelo, o preço real cobrado
// pela Google é idêntico nas duas — editar um dos pares de campos espelha o
// valor no outro em tempo real, pra nunca ficarem divergentes no DOM (é o
// que garante o hint da tela e o que deixa savePrecos() seguro, ver
// comentário lá). Quando os modelos são diferentes, cada par vive isolado.
function sincronizarPrecoGeminiEspelhado(origemInputId, origemOutputId, destinoInputId, destinoOutputId){
  const modeloBasico = document.getElementById('geminiModeloBasico').value.trim();
  const modeloAvancado = document.getElementById('geminiModeloAvancado').value.trim();
  if(!modeloBasico || modeloBasico !== modeloAvancado) return;
  document.getElementById(destinoInputId).value = document.getElementById(origemInputId).value;
  document.getElementById(destinoOutputId).value = document.getElementById(origemOutputId).value;
}
document.getElementById('precoGeminiInput').addEventListener('input', ()=>{
  sincronizarPrecoGeminiEspelhado('precoGeminiInput','precoGeminiOutput','precoGeminiAvancadoInput','precoGeminiAvancadoOutput');
});
document.getElementById('precoGeminiOutput').addEventListener('input', ()=>{
  sincronizarPrecoGeminiEspelhado('precoGeminiInput','precoGeminiOutput','precoGeminiAvancadoInput','precoGeminiAvancadoOutput');
});
document.getElementById('precoGeminiAvancadoInput').addEventListener('input', ()=>{
  sincronizarPrecoGeminiEspelhado('precoGeminiAvancadoInput','precoGeminiAvancadoOutput','precoGeminiInput','precoGeminiOutput');
});
document.getElementById('precoGeminiAvancadoOutput').addEventListener('input', ()=>{
  sincronizarPrecoGeminiEspelhado('precoGeminiAvancadoInput','precoGeminiAvancadoOutput','precoGeminiInput','precoGeminiOutput');
});

// Mostra uma chave de API já decifrada num campo — ou, se não puder ser
// decifrada agora (DEK indisponível nesta sessão, ver auth.js — típico caso:
// backup restaurado de OUTRO perfil/instalação, cifrado com um DEK que este
// aqui não tem), deixa o campo vazio e BLOQUEADO (mesma lógica de
// aplicarCampoProtegido em panel.js), pra nunca expor texto cifrado bruto
// nem correr o risco de saveKeys() gravar por cima com um valor errado.
// Guarda o placeholder original em dataset ANTES de sobrescrever — é o que
// liberarCampoChaveApi() usa pra devolvê-lo quando o campo é destravado.
async function preencherCampoChaveApi(inputId, valorSalvo, dek){
  const input = document.getElementById(inputId);
  const aviso = document.getElementById(inputId + 'BloqueadaAviso');
  if(input.dataset.placeholderOriginal === undefined) input.dataset.placeholderOriginal = input.placeholder || '';
  if(!pareceCifrado(valorSalvo)){
    input.value = valorSalvo || '';
    input.disabled = false;
    if(aviso) aviso.style.display = 'none';
    return;
  }
  if(dek){
    try{
      input.value = await copilotoDecifrarAesGcm(dek, valorSalvo);
      input.disabled = false;
      if(aviso) aviso.style.display = 'none';
      return;
    }catch(e){ /* cai pro bloqueio abaixo */ }
  }
  input.value = '';
  input.disabled = true;
  input.placeholder = '🔒 Protegido — sem acesso agora';
  if(aviso) aviso.style.display = 'flex';
}

// Libera um campo BLOQUEADO por preencherCampoChaveApi (chamada pelo botão
// "Digitar uma nova chave" do aviso que aparece nesse caso) — não recupera a
// chave antiga (não dá: foi cifrada com o DEK de OUTRO perfil/instalação,
// que esta sessão não tem, e nunca vai ter), só destrava o campo pra uma
// chave NOVA ser digitada. Ao salvar (saveKeys -> valorChaveApiParaSalvar),
// essa chave nova substitui a antiga de vez — a antiga, de qualquer forma,
// já era inacessível e inutilizável aqui. Deixar em branco e salvar assim
// mesmo também é uma opção válida: equivale a "esquecer" a chave protegida
// e ficar sem nenhuma configurada, até digitar uma de verdade depois.
function liberarCampoChaveApi(inputId){
  const input = document.getElementById(inputId);
  const aviso = document.getElementById(inputId + 'BloqueadaAviso');
  input.disabled = false;
  input.value = '';
  input.placeholder = input.dataset.placeholderOriginal !== undefined ? input.dataset.placeholderOriginal : input.placeholder;
  if(aviso) aviso.style.display = 'none';
  input.focus();
}
['claudeKey', 'geminiKeyBasico', 'geminiKeyAvancado'].forEach((inputId) => {
  const btn = document.getElementById(inputId + 'LiberarBtn');
  if(btn) btn.addEventListener('click', () => liberarCampoChaveApi(inputId));
});

async function init(){
  const data = await copilotoStorage.local.get([
    'provider','claudeKey','claudeModel','claudeModeloBasico',
    'geminiKey','geminiModel', // legado (chave única, de antes deste recurso existir)
    'geminiKeyBasico','geminiModeloBasico','geminiKeyAvancado','geminiModeloAvancado',
    'config','funil','precosToken'
  ]);
  renderProviderCards(data.provider || 'gemini');
  const dekAtivo = await obterDekAtivo();
  await preencherCampoChaveApi('claudeKey', data.claudeKey, dekAtivo);
  if(data.claudeModel) selecionarPreservandoValor(document.getElementById('claudeModel'), data.claudeModel);
  // Mesma distinção do panel.js: undefined é "nunca configurado" (entra o
  // padrão de fábrica), string vazia é "Desligado" escolhido a dedo.
  selecionarPreservandoValor(document.getElementById('claudeModeloBasico'),
    data.claudeModeloBasico === undefined ? 'claude-haiku-4-5-20251001' : data.claudeModeloBasico);

  // Migração: quem configurou o Gemini antes deste recurso existir tinha só
  // uma chave/modelo — isso vira o ponto de partida da Chave A, sem precisar
  // reconfigurar nada. A Chave B começa em branco: até a pessoa configurar
  // uma chave própria pra ela, a Chave A assume sozinha todas as etapas
  // (ver hint da tela).
  const geminiKeyBasicoSalva = data.geminiKeyBasico || data.geminiKey || '';
  const geminiModeloBasico = data.geminiModeloBasico || data.geminiModel || '';
  await preencherCampoChaveApi('geminiKeyBasico', geminiKeyBasicoSalva, dekAtivo);
  if(geminiModeloBasico) selecionarPreservandoValor(document.getElementById('geminiModeloBasico'), geminiModeloBasico);
  await preencherCampoChaveApi('geminiKeyAvancado', data.geminiKeyAvancado, dekAtivo);
  if(data.geminiModeloAvancado) selecionarPreservandoValor(document.getElementById('geminiModeloAvancado'), data.geminiModeloAvancado);
  atualizarRoteamentoStatus();

  const precosToken = data.precosToken || {};
  const claudeModel = data.claudeModel || 'claude-sonnet-5';
  const precoClaude = precosToken[claudeModel];
  if(precoClaude){
    document.getElementById('precoClaudeInput').value = precoClaude.input ?? '';
    document.getElementById('precoClaudeOutput').value = precoClaude.output ?? '';
  }
  await carregarPrecosGemini();

  const funil = data.funil || DEFAULT_FUNIL;
  document.getElementById('funilInstrucoes').value = funil.instrucoes || '';
}

document.getElementById('cardClaude').addEventListener('click', ()=>selectProvider('claude'));
document.getElementById('cardGemini').addEventListener('click', ()=>selectProvider('gemini'));
document.getElementById('saveKeysBtn').addEventListener('click', saveKeys);
document.getElementById('savePrecosBtn').addEventListener('click', savePrecos);
document.getElementById('resetUsageStatsBtn').addEventListener('click', resetUsageStats);
document.getElementById('saveFunilBtn').addEventListener('click', saveFunil);
document.getElementById('backBtn').addEventListener('click', ()=>{
  window.location.href = 'panel.html';
});

// ---------- Navegação lateral direita (pula pra cada seção da página) ----------
// Destaca sozinho, ao rolar, qual seção está no topo da tela agora — mesma
// ideia de scroll-spy usada em telas de configuração de produtos (Notion,
// Stripe etc). rootMargin cria uma faixa fina perto do topo do viewport: só
// o card cruzando essa faixa conta como "ativo" no momento, em vez de tudo
// que está visível na tela ficar marcado ao mesmo tempo.
function initSettingsNav(){
  const links = Array.from(document.querySelectorAll('.settings-nav-link'));
  if(!links.length) return;
  const linkPorId = {};
  links.forEach((a)=>{ linkPorId[a.dataset.target] = a; });

  const observer = new IntersectionObserver((entries)=>{
    entries.forEach((entry)=>{
      const link = linkPorId[entry.target.id];
      if(link) link.classList.toggle('active', entry.isIntersecting);
    });
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });

  Object.keys(linkPorId).forEach((id)=>{
    const el = document.getElementById(id);
    if(el) observer.observe(el);
  });
}
initSettingsNav();

// A credencial inicial de cada instalação nasce na primeira tela de login
// que for aberta — e a página de Configurações é alcançável direto pelo
// menu da extensão, sem passar pelo painel. Sem este bloco, quem abrisse as
// Configurações primeiro numa instalação nova via a trava recusar qualquer
// usuário/senha (nenhuma credencial tinha sido gerada ainda), sem nada na
// tela explicando o porquê. Mesma lógica de panel.js, espelhada aqui.
copilotoExibirCredencialInicialSePendente('configUserInput');

