# Copiloto de Vendas — C&S Virtual

Extensão de Chrome (Manifest V3) que ajuda a responder mensagens de WhatsApp
de vendas consultivas com apoio de IA (Claude ou Gemini). O painel abre como
uma aba normal do Chrome (`panel.html`), não como popup.

## Arquitetura em resumo

- **Sem servidor.** Tudo fica em `chrome.storage` (local + session), no
  computador de quem usa. Não existe backend do Co-piloto recebendo nada.
- **Perfis isolados por profissional.** Cada pessoa cadastrada tem senha
  própria; os dados dela (leads, histórico, funil, campanha, chaves de API)
  ficam prefixados por id de perfil em `chrome.storage.local`
  (`copilotoChaveComEscopo`/`copilotoStorage.local`, em `perfis.js`) — um
  perfil nunca lê/grava os dados de outro sem passar pelo modo administrador.
- **Criptografia por perfil (DEK) + chave-mestra do admin (AMK).** Campos
  sensíveis do lead (CPF, e-mail, CEP, nascimento, notas) e as chaves de API
  ficam cifrados (AES-256-GCM) com uma chave derivada da senha do perfil
  (PBKDF2, `auth.js`). O admin tem uma chave-mestra (AMK) que consegue
  desembrulhar a DEK de qualquer perfil, sem saber a senha dele — é o que
  permite "modo administrador" (entrar noutro perfil pra ajudar) sem abrir
  mão do isolamento normal.
- **Funil de vendas = um texto só.** Não existe mais script por etapa — toda
  a "expertise de vendas" que a IA usa vem do campo único Configurações →
  Funil de vendas (`funil.instrucoes`, injetado em todo prompt via
  `buildBlocoEstaticoFunil`, `panel.js`). Se estiver vazio, cai num padrão
  genérico (`DEFAULT_FUNIL_INSTRUCOES`, `funil-padrao.js`).
- **Central de mensagens compartilhada.** Um lead fixo e não-removível
  (`FIXED_LEAD_ID`) pra colar mensagens de gente que ainda não virou lead
  próprio — cada mensagem colada ali exige o campo "Nome da pessoa desta
  mensagem", pra não misturar o histórico/contexto de pessoas diferentes
  dentro do mesmo registro.

## Coisa pra ficar de olho ao mexer no código

**Padrão de bug já visto mais de uma vez aqui:** uma variável captura "o
lead/perfil atual" antes de um `await` (chamada de IA, verificação de senha
etc.), e o código usa essa variável depois do `await` como se nada tivesse
mudado enquanto esperava. Só que a pessoa pode trocar de lead, trocar de
perfil, ou reabrir a aba nesse meio-tempo. Já apareceu em:

- `sugerirEstagioComIA` / `preencherEstagioPorNomeConhecido` (gravava a
  sugestão de estágio no lead ERRADO se a pessoa trocasse de lead enquanto a
  IA respondia).
- `confirmarSenhaPerfilClick` / `recuperarSenhaComCodigoClick` (podia gravar
  a chave de um perfil sob o id de outro, se a pessoa voltasse e trocasse de
  perfil no meio da checagem de senha).
- `lastGeneratedHistoryId` em `panel.js` (apontava pro item errado do
  histórico depois de trocar de lead e voltar, ou recarregar a aba).

A correção padrão: capturar o id logo no início (`const leadId = lead.id`
ou `const perfilAlvo = _perfilEmConfirmacao`), e depois do `await` **reler o
estado atual pelo id capturado** (nunca confiar de novo numa variável global
tipo `currentLeadId`/`_perfilEmConfirmacao` sem checar se ela ainda é a
mesma) antes de tocar em DOM ou persistir dado.

**DEK na sessão não pode sobreviver a uma troca de perfil.** Antes tinha um
jeito de, com o console do navegador, reentrar num perfil já desbloqueado
nessa sessão sem senha nenhuma — porque a DEK dele ficava esquecida em
`chrome.storage.session` mesmo depois de sair do perfil. Corrigido em
`copilotoLimparPerfilAtivo` (`perfis.js`), que agora sempre limpa a DEK do
perfil que está saindo (nunca a AMK, que precisa sobreviver pro modo
administrador continuar funcionando). Se algum fluxo novo guardar DEK na
sessão, garanta que ele passa por esse mesmo ponto de limpeza ao trocar de
perfil.

## Convenção de entrega

Ver `/CLAUDE.md` na raiz do repositório — sempre dois zips (fonte +
minificado) e sempre subir a versão do `manifest.json` a cada mudança.
