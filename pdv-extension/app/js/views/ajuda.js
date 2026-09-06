// Ajuda — explica o sistema inteiro em linguagem simples, separado por
// tópicos. Disponível pra admin e vendedor: cada um entende não só o que
// pode fazer, mas por que algumas coisas ficam bloqueadas pro seu perfil.
import { escapeHtml } from '../utils/format.js';
import { icon } from '../components/icon.js';

/** Conteúdo do tópico F.A.Q, à parte de TOPICS (ver renderFaqAccordion logo
 * abaixo) — cada pergunta vira um item de acordeão (botão + resposta
 * escondida por padrão), em vez de texto corrido com um <h3> por pergunta.
 * Guardar como dado (pergunta/resposta) em vez de HTML solto evita repetir
 * a marcação do acordeão umas 30 vezes à mão. */
const FAQ_CATEGORIES = [
  {
    label: 'Vendas (PDV)',
    items: [
      {
        q: '"X está sem estoque disponível" / "Estoque disponível de X: N"',
        a: 'Aparece ao tentar adicionar mais unidades de um produto do que existe no Estoque no momento — seja escaneando/buscando de novo, seja editando a quantidade já no carrinho. Confira o saldo real na tela <strong>Estoque</strong> e ajuste a quantidade, ou faça entrada de mercadoria antes de continuar vendendo.',
      },
      {
        q: '"X está inativo e não pode ser vendido"',
        a: 'O produto foi <strong>inativado</strong> no Estoque (veja o tópico Estoque) — continua no cadastro, mas some das vendas. Reative-o na tela Estoque se ele voltou a ser vendido.',
      },
      {
        q: '"não existe mais no Estoque — remova o item do carrinho e adicione de novo"',
        a: 'Esse é o mais confuso de entender na hora, porque não parece ter relação com o que você está fazendo: o carrinho de uma venda <strong>não se limpa sozinho ao trocar de tela</strong> — só ao finalizar a venda ou ao deslogar (veja "O carrinho não some se você trocar de tela" no tópico Vendas). Se, com itens já no carrinho, alguém for no Estoque e <strong>excluir</strong> um desses produtos, ao voltar pra "Nova venda" e tentar finalizar, o sistema corretamente barra a venda — mas antes disso a mensagem dizia só "Produto não encontrado no carrinho", sem indicar qual item nem o que fazer. Agora ela nomeia o produto certo. Nos dois casos, a solução é a mesma: clique no <strong>×</strong> pra remover aquele item específico do carrinho e adicione o produto de novo pela busca — a venda fecha normal depois disso.<div class="tip"><strong>Dica:</strong> desde a v1.15.26, tentar <strong>excluir</strong> um produto no Estoque enquanto ele está parado num carrinho aberto já mostra um aviso na hora, antes de excluir de verdade — evita cair nessa situação.</div>',
      },
      {
        q: '"A forma de venda Y de X não existe mais — remova o item do carrinho e adicione de novo"',
        a: 'Mesma ideia do aviso acima, só que específico de produto <strong>Personalizado</strong> (várias formas de venda, ver tópico Estoque): a forma escolhida (ex: "Carrada") foi removida ou renomeada na edição do produto depois que o item já estava no carrinho. Solução igual: remova o item e adicione de novo, escolhendo a forma atual.',
      },
      {
        q: '"Estoque insuficiente de X (disponível: N)"',
        a: 'Diferente do primeiro aviso desta lista: esse aparece só na hora de <strong>finalizar</strong>, não ao adicionar — quer dizer que o estoque mudou entre você montar o carrinho e clicar em "Finalizar venda" (por exemplo, outra venda consumiu o que sobrava enquanto você ainda decidia a forma de pagamento). Ajuste a quantidade desse item no carrinho pro que realmente está disponível agora.',
      },
      {
        q: '"Estoque disponível de X: N (parte já está reservada num carrinho congelado)"',
        a: 'Aparece quando parte do estoque desse produto já está guardada num <strong>carrinho congelado</strong> (veja "Congelar" mais acima) — o sistema não deixa vender de novo o que já foi prometido a outro cliente esperando na fila. O número mostrado já é o que realmente sobra pra este carrinho, descontando o que está congelado; se aquele outro atendimento acabar não fechando, descarte o carrinho congelado (ícone de lixeira no cartão dele, abaixo do campo Cliente) pra liberar o estoque de novo.',
      },
      {
        q: '"Selecione um cliente para vender fiado"',
        a: 'Toda venda com alguma forma de pagamento "Fiado" precisa de um cliente selecionado no campo <strong>Cliente</strong>, no topo da tela — é o cadastro que recebe a dívida. Busque ou cadastre o cliente ali antes de finalizar.',
      },
      {
        q: '"Com essa venda, X vai ficar devendo..., acima do limite cadastrado. Continuar mesmo assim?"',
        a: 'Não é um erro que trava a venda — é uma confirmação (janela amarela, não vermelha) quando o cliente selecionado tem um <strong>limite de crédito</strong> cadastrado (tópico Clientes e fiado) e essa venda faria a dívida dele passar desse limite. Clique em "Vender fiado assim mesmo" pra continuar, ou cancele pra ajustar a venda.',
      },
      {
        q: '"Os pagamentos (...) não somam o total da venda (...)"',
        a: 'A soma de todas as formas de pagamento adicionadas precisa bater com o total exato da venda (com até 1 centavo de tolerância pra arredondamento). Confira os valores de cada forma de pagamento na lista — sobrou ou faltou alguns centavos/reais pra fechar.',
      },
      {
        q: '"Esse desconto passa do limite de N% — peça a autorização de um administrador" / "Usuário ou senha de administrador inválidos"',
        a: 'Vendedores sem a permissão de desconto ilimitado (tópico Usuários e permissões) têm um teto de desconto configurado em Dados da loja. Passando desse teto, o sistema abre um modal pedindo <strong>usuário e senha de um administrador</strong> pra autorizar — sem essa confirmação, a venda não fecha. O segundo aviso é só quando os dados digitados nesse modal estão errados; confira e tente de novo.',
      },
      {
        q: '"O caixa foi fechado enquanto esta venda estava sendo montada. Abra o caixa novamente para finalizar"',
        a: 'Só acontece se a loja exige caixa aberto pra vender (Dados da loja) e alguém fechou o caixa <strong>depois</strong> que você começou a montar essa venda, mas <strong>antes</strong> de clicar em Finalizar. Abra o caixa de novo (tópico Caixa) e finalize — nada do carrinho se perde nesse meio-tempo.',
      },
      {
        q: '"Venda finalizada: R$.... O carreto NÃO foi cadastrado (...)"',
        a: 'Só aparece usando "Finalizar venda + carreto". Diferente de todos os avisos acima, esse <strong>não é um erro que impede nada</strong> — a venda já foi registrada normalmente (estoque baixado, pagamento gravado), só o cadastro do carreto que falhou depois. Vá em <strong>Carreto</strong> e cadastre a entrega manualmente pra essa venda.',
      },
    ],
  },
  {
    label: 'Estoque',
    items: [
      {
        q: '"Já existe um produto com esse código de barras"',
        a: 'Cada código de barras (de fábrica ou interno, ver tópico Estoque) só pode pertencer a <strong>um</strong> produto por vez, cadastrado ou em edição. Confira se o produto já não existe (busque pelo código antes de cadastrar de novo) ou gere/edite pra um código diferente.',
      },
      {
        q: 'Avisos ao cadastrar um produto "Personalizado"',
        a: 'Todas as formas de venda (tópico Estoque) precisam ter: um <strong>nome</strong> preenchido e não repetido entre as formas do mesmo produto, um <strong>valor de venda</strong> maior que zero, um <strong>custo</strong> válido (pode ser zero, não negativo) e um <strong>fator de conversão</strong> maior que zero. Falta algum desses quatro numa das linhas, ou tentou deixar mais de <strong>7 formas</strong> no mesmo produto? O cadastro não salva até corrigir a linha apontada na mensagem.',
      },
    ],
  },
  {
    label: 'Clientes e fiado',
    items: [
      {
        q: '"Não é possível excluir: X ainda deve R$Y. Quite o fiado primeiro ou inative o cliente"',
        a: 'Um cliente com saldo devedor em aberto não pode ser excluído — apagaria o rastro de uma dívida real. Registre o pagamento do fiado (zerando o saldo) antes de excluir, ou use <strong>Inativar</strong> no lugar (esconde da lista de venda sem apagar o histórico nem a dívida).',
      },
      {
        q: '"O cliente deve R$X — não é possível registrar um pagamento maior que a dívida"',
        a: 'Aparece ao tentar registrar um pagamento de fiado maior que o saldo devedor atual daquele cliente — o sistema não permite deixar o cliente com "crédito negativo" por engano de digitação. Confira o saldo real (mostrado no próprio cliente) e ajuste o valor do pagamento.',
      },
    ],
  },
  {
    label: 'Caixa',
    items: [
      {
        q: '"Já existe um caixa aberto. Feche-o antes de abrir um novo"',
        a: 'A loja só opera com <strong>um</strong> caixa aberto por vez, mesmo com mais de um vendedor usando o sistema em momentos diferentes do dia. Se você não abriu o caixa hoje mas o sistema diz que já tem um aberto, é porque alguém (outro turno, por exemplo) abriu e ainda não fechou — confira com a equipe antes de insistir.',
      },
      {
        q: '"Informe um valor de abertura válido"',
        a: 'O troco inicial da gaveta (valor de abertura) precisa ser um número igual ou maior que zero — não aceita vazio, negativo, nem texto.',
      },
      {
        q: '"Este caixa não está mais aberto"',
        a: 'Pode acontecer se você deixou a tela de fechamento (ou de sangria/suprimento) aberta por um tempo e, nesse meio-tempo, <strong>alguém já fechou esse mesmo caixa</strong> por outro caminho. Recarregue a tela Caixa pra ver o estado atual antes de tentar de novo.',
      },
      {
        q: '"O valor corrigido é igual ao valor atual — nada a retificar"',
        a: 'Ao usar "Retificar" um lançamento de caixa, o sistema espera um valor <strong>diferente</strong> do atual — se o valor digitado for igual ao que já está lá, não há o que corrigir (e não gera um registro de retificação vazio no log).',
      },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      {
        q: '"Não é possível cancelar uma conta já paga"',
        a: 'Uma conta a pagar/receber marcada como <strong>paga</strong> (quitada 100%) não pode mais ser cancelada — só uma conta ainda em aberto ou parcialmente paga. Se o pagamento foi um engano, exclua o pagamento primeiro (o próximo aviso explica essa ordem).',
      },
      {
        q: '"Esta conta já tem pagamento(s) registrado(s) — exclua os pagamentos antes de cancelar"',
        a: 'Cancelar uma conta que já recebeu algum pagamento (mesmo parcial) apagaria esse dinheiro sem deixar rastro. Exclua cada pagamento registrado primeiro (zerando o valor pago) e só depois cancele a conta.',
      },
    ],
  },
  {
    label: 'Compras e fornecedores',
    items: [
      {
        q: '"Cadastre um fornecedor antes de criar um pedido"',
        a: 'Todo pedido de compra precisa estar amarrado a um fornecedor já cadastrado — não dá pra criar um pedido "solto". Cadastre o fornecedor na aba <strong>Fornecedores</strong> (dentro de Compras) primeiro.',
      },
      {
        q: '"Não é possível cancelar um pedido que já teve itens recebidos"',
        a: 'Assim que o primeiro item de um pedido de compra é marcado como recebido (e o estoque já sobe com ele), o pedido inteiro deixa de poder ser cancelado — cancelar apagaria o rastro de uma entrada de estoque real já aplicada. Pedidos ainda 100% pendentes (nada recebido) continuam podendo ser cancelados normalmente.',
      },
    ],
  },
  {
    label: 'Carreto (entregas)',
    items: [
      {
        q: '"Selecione um cliente para o carreto" / "Adicione ao menos um item ao carreto"',
        a: 'Todo carreto precisa de um cliente de destino e pelo menos um item pra entregar — os dois campos são obrigatórios pra cadastrar, seja pelo carreto avulso (tela Carreto) ou junto de uma venda ("Finalizar venda + carreto").',
      },
      {
        q: '"Este carreto não está mais pendente" / "Só é possível cancelar um carreto pendente"',
        a: 'Um carreto já marcado como <strong>entregue</strong> (ou já cancelado antes) não pode ser marcado como entregue de novo, nem cancelado — os dois só se aplicam a um carreto ainda pendente. Confira o status atual na lista antes de agir.',
      },
    ],
  },
  {
    label: 'Estorno e troca',
    items: [
      {
        q: '"Informe o motivo do estorno" / "Selecione ao menos um item para estornar"',
        a: 'Todo estorno precisa de um motivo escrito (fica gravado no histórico da venda e no log, pra auditoria futura) e pelo menos um item marcado com quantidade pra devolver — sem os dois, o sistema não deixa confirmar.',
      },
    ],
  },
  {
    label: 'Usuários e login',
    items: [
      {
        q: '"Usuário ou senha inválidos, ou usuário desativado"',
        a: 'Mensagem de propósito genérica — o sistema não diz qual dos três é (usuário errado, senha errada, ou usuário existente mas desativado por um admin), pra não dar pista a quem estiver tentando adivinhar credenciais de outra pessoa. Confira os três com quem administra o sistema.',
      },
      {
        q: '"Você não pode editar as próprias permissões — peça pra outra pessoa com acesso a Usuários fazer isso"',
        a: 'Ninguém pode aumentar (ou reduzir) o próprio nível de acesso sozinho, nem o Administrador Geral — sempre precisa de outra pessoa com a permissão "Gerenciar usuários" pra fazer essa mudança. É uma proteção contra erro e contra abuso.',
      },
      {
        q: '"Apenas o Administrador Geral pode fazer isso" / "Você não tem permissão para fazer isso" / "Sessão inválida — faça login novamente"',
        a: 'Os dois primeiros aparecem se você tentar uma ação que sua conta não tem liberada (confira com um admin quais permissões o seu usuário tem marcadas). O terceiro é raro — normalmente quer dizer que a sessão expirou ou foi encerrada em outra aba/dispositivo nesse meio-tempo; faça login de novo.',
      },
    ],
  },
  {
    label: 'Backup',
    items: [
      {
        q: '"Arquivo inválido — não parece ser um backup deste sistema"',
        a: 'O arquivo selecionado não tem o formato esperado de um backup desta extensão — confira se escolheu o arquivo certo (a extensão gerada é sempre a mesma, baixada pela própria tela Backup).',
      },
      {
        q: '"Não foi possível abrir o backup — senha incorreta ou arquivo corrompido"',
        a: 'O arquivo até parece um backup válido, mas não conseguiu ser decifrado com a senha digitada. Confira a senha (maiúsculas/minúsculas importam) e tente de novo — se continuar falhando com uma senha que você tem certeza que está certa, o arquivo pode estar corrompido ou incompleto (ex: download interrompido no meio).',
      },
      {
        q: '"Este arquivo de backup foi gerado por uma versão mais nova do sistema — atualize a extensão antes de restaurar"',
        a: 'Só acontece restaurando um backup feito numa instalação já atualizada pra uma versão mais nova do que a que está tentando abrir ele. Atualize a extensão (tópico Licença e ativação → "Verificar se há uma versão nova") e tente restaurar de novo.',
      },
    ],
  },
  {
    label: 'Um padrão que se repete em várias telas',
    items: [
      {
        q: '"Este [movimento / pagamento / retificação / recebimento / resgate] já foi registrado — evite reenviar"',
        a: 'Esse aviso aparece em Caixa, Clientes (pagamento de fiado), Financeiro, Compras (recebimento) e Fidelidade (resgate de pontos) — sempre com a mesma ideia: o sistema detectou que essa ação específica <strong>já foi concluída com sucesso</strong> uma vez (proteção contra clicar duas vezes, ou reenviar depois de uma tela travar/recarregar) e recusa registrar de novo. Não é erro — é o oposto: sinal de que a ação já está gravada. Confira o registro na lista correspondente antes de tentar de novo; se realmente precisar fazer uma <strong>nova</strong> ação igual (ex: outra sangria do mesmo valor), feche o modal e abra de novo — cada abertura gera uma nova tentativa válida.',
      },
    ],
  },
];

/** Gera o acordeão do F.A.Q a partir de FAQ_CATEGORIES — cada pergunta
 * nasce fechada (`hidden` no HTML, não só via CSS, pra nunca "piscar"
 * aberta antes do JS rodar). A abertura/fechamento em si é feita por
 * wireFaqAccordion(), chamada pelo renderTopic() logo abaixo. */
function renderFaqAccordion() {
  return FAQ_CATEGORIES.map((cat) => `
    <p class="faq-section-label">${escapeHtml(cat.label)}</p>
    ${cat.items.map((item) => `
      <div class="faq-item">
        <button type="button" class="faq-question">
          <span>${item.q}</span>
          <span class="faq-chevron">${icon('arrowRight', { size: 14 })}</span>
        </button>
        <div class="faq-answer" hidden><p>${item.a}</p></div>
      </div>
    `).join('')}
  `).join('');
}

/** Comportamento de sanfona (acordeão) do F.A.Q: clicar numa pergunta
 * fechada abre ela e fecha qualquer outra que estivesse aberta, na hora —
 * achado do usuário, pra não empilhar um texto gigante com todas as
 * respostas abertas ao mesmo tempo. Clicar na que já está aberta fecha ela
 * sozinha (nenhuma fica presa aberta). `hidden` (não `style.display`) é o
 * que já esconde/mostra de verdade — a troca da classe `open` no item é só
 * pra girar a setinha (`.faq-chevron`) e destacar a pergunta ativa. */
function wireFaqAccordion(root) {
  root.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const wasOpen = !answer.hidden;
      root.querySelectorAll('.faq-item').forEach((other) => {
        other.classList.remove('open');
        other.querySelector('.faq-answer').hidden = true;
      });
      if (!wasOpen) {
        item.classList.add('open');
        answer.hidden = false;
      }
    });
  });
}

const TOPICS = [
  {
    id: 'primeiros-passos',
    icon: icon('flag', { size: 16 }),
    title: 'Primeiros passos',
    html: `
      <h2>Primeiros passos</h2>
      <p class="help-subtitle">Como o sistema começa a funcionar e como você entra todo dia.</p>

      <h3>Cadastro da loja</h3>
      <p>Na primeiríssima vez que o sistema abre, a própria tela de boas-vindas já deixa escolher a <strong>aparência</strong> (claro, escuro ou automático) antes de perguntar se é cadastro novo ou restauração de backup; escolhendo cadastro novo, o passo seguinte pede os dados da empresa (CNPJ, endereço, telefone etc.). Isso só acontece <strong>uma única vez</strong> — depois disso, o sistema nunca mais pede de novo. Começou o cadastro e lembrou que na verdade tem um backup pra restaurar? O botão <strong>"Voltar"</strong>, no rodapé do formulário de dados da loja, leva de volta pra escolha inicial — se algum campo já tiver conteúdo digitado, confirma antes de descartar.</p>
      <p>Alguns campos se formatam sozinhos enquanto você digita e só aceitam o formato certo: <strong>CNPJ</strong> ("xx.xxx.xxx/xxxx-xx", com dígito verificador conferido de verdade, igual a Receita faz), <strong>telefone</strong> — celular vira "(xx) x xxxx-xxxx", fixo vira "(xx) xxxx-xxxx" —, e <strong>CEP</strong> ("xxxxx-xxx"). O mesmo vale pro <strong>e-mail</strong>, se preenchido. Esses campos aparecem de novo em Clientes, Fornecedores e Dados da loja (edição) — sempre com a mesma formatação e validação.</p>

      <h3>O Administrador Geral</h3>
      <p>Logo depois de cadastrar a loja, o sistema pede pra cadastrar o primeiro usuário — e esse primeiro usuário é <strong>sempre</strong> o Administrador Geral. Ele é quem tem acesso a tudo: cadastro de produtos, usuários, caixa, log de auditoria, configurações. Só existe um administrador geral na loja.</p>

      <h3>Entrando todo dia (Login)</h3>
      <p>Depois desse cadastro inicial, o sistema sempre abre numa tela de <strong>login</strong>. Cada pessoa que trabalha na loja — administrador ou vendedor — tem seu próprio usuário e senha. Ninguém compartilha login: é assim que o sistema sabe exatamente quem fez cada venda, cada estorno, cada mudança de estoque.</p>
      <div class="tip"><strong>Errou a senha 2 vezes seguidas?</strong> O campo de senha fica bloqueado por 60 segundos (com contagem regressiva na tela) antes de liberar de novo — é uma proteção contra tentativa de adivinhar a senha de outra pessoa no teclado. Não afeta o usuário digitado nem apaga nada; é só esperar a contagem zerar.</div>

      <div class="tip"><strong>Dica:</strong> a sessão não fica salva pra sempre — se você fechar o navegador, na próxima vez vai pedir login de novo. Isso é proposital, pra loja não ficar logada sem querer com o computador ligado o dia todo.</div>

      <div class="tip"><strong>Ficou parado 30 minutos?</strong> O sistema desloga sozinho depois de meia hora sem nenhum uso (mouse, teclado etc.), voltando pro login — é uma proteção pra quem sai do balcão e esquece o sistema logado. Se tiver mais de uma aba aberta, mexer em qualquer uma delas conta como uso; só desloga de verdade quando nenhuma aba tiver atividade recente.</div>

      <h3>Primeiro login de cada usuário</h3>
      <p>Na <strong>primeiríssima vez</strong> que qualquer usuário loga — o Administrador Geral logo depois do cadastro inicial, ou um vendedor recém-cadastrado — o sistema abre direto na tela de <strong>Ajuda</strong> (esta aqui!) em vez do Painel, pra já dar uma primeira olhada em como tudo funciona. Da segunda vez que essa mesma pessoa logar em diante, cai no Painel normalmente — é coisa de uma vez só na vida de cada conta.</p>

      <h3>Vendedores</h3>
      <p>Todo usuário cadastrado <em>depois</em> do administrador nasce como <strong>vendedor</strong> — um perfil com menos permissões (veja o tópico "Usuários e permissões" pra entender a diferença completa).</p>

      <h3>Tela cheia e mais de uma aba aberta</h3>
      <p>Clicando no ícone da extensão, o sistema abre numa <strong>aba normal</strong> do navegador, igual qualquer site. Quem preferir usar em tela cheia (sem barra de abas nem de endereço) pode ligar isso na hora: na tela de <strong>login</strong>, o botão <strong>${icon('fullscreen', { size: 14 })}</strong> no canto superior direito do card entra e sai da tela cheia nativa do navegador — o ícone troca conforme o estado, e também reconhece se você saiu apertando Esc.</p>
      <p>O sistema roda numa aba de cada vez, de propósito — não dá pra usar em duas ao mesmo tempo. Se você tentar abrir uma segunda (ex: digitando o endereço direto numa aba nova), aparece um aviso e essa segunda fica <strong>bloqueada</strong>, mostrando só uma mensagem explicando a situação: continue usando a original.</p>
      <p>Fechou a original por engano, ou decidiu continuar na nova mesmo? Sem problema — feche a que não quer mais usar e a outra libera <strong>sozinha</strong>, em poucos segundos, sem precisar recarregar nada.</p>

      <h3>Aparência (claro ou escuro)</h3>
      <p>Além da tela de configuração inicial, dá pra trocar quando quiser em <strong>Personalização</strong>, no menu lateral — escolha entre fundo claro, escuro, ou automático (seguindo o tema do computador). É uma preferência de quem está usando aquele computador naquele momento — cada máquina guarda a sua.</p>

      <h3>Listas grandes (Estoque, Clientes, Caixa, Carreto, Compras, Financeiro)</h3>
      <p>Embaixo dessas listas tem uma barra de paginação: escolha quantos itens mostrar por vez em <strong>Mostrar</strong> (10, 25, 50, 75 ou 100 — o padrão é 10) e navegue entre as páginas com <strong>Anterior</strong>/<strong>Próxima</strong>, ou clicando direto no número de uma página. Trocar o "Mostrar" sempre volta pra primeira página.</p>
      <p class="text-muted" style="font-size:12.5px;">Histórico de vendas e Log do sistema funcionam diferente — veja "Carregar mais" no tópico "Histórico e log".</p>
    `,
  },
  {
    id: 'licenca',
    icon: icon('key', { size: 16 }),
    title: 'Licença e ativação',
    html: `
      <h2>Licença e ativação</h2>
      <p class="help-subtitle">Como funciona o período de teste e o que fazer quando pedir ativação.</p>

      <h3>Período de teste</h3>
      <p>Ao concluir o cadastro da loja (do zero ou restaurando um backup), o sistema libera <strong>1 hora de uso</strong> sem pedir nada. Depois desse tempo, aparece uma tela pedindo uma <strong>chave de ativação</strong> antes de continuar usando.</p>

      <h3>Como conseguir a chave</h3>
      <p>Quando o teste encerra, a própria tela de bloqueio tem dois botões — <strong>WhatsApp</strong> e <strong>E-mail</strong> — que já preenchem o nome da loja e o CNPJ na mensagem sozinhos, então é só clicar, conferir e enviar. Se preferir falar direto: WhatsApp <strong>(71) 98646-1027</strong> ou e-mail <a href="mailto:csvirtual.av@gmail.com">csvirtual.av@gmail.com</a>, informando o CNPJ cadastrado da loja. Ela é única pra esta loja, amarrada a esse CNPJ.</p>

      <h3>Onde colar a chave</h3>
      <p>Se o teste encerrou, a própria tela de bloqueio tem um campo pra colar a chave, embaixo dos botões de contato. Se ainda estiver dentro do período de teste e já tiver recebido a chave, não precisa esperar — vá em <strong>Dados da loja → Ativação</strong>, no menu lateral, e cole lá a qualquer momento.</p>
      <p>Existem dois tipos de chave: uma <strong>demo</strong>, que estende o uso por um período combinado, e uma <strong>definitiva</strong>, que não expira. Depois de ativar com a definitiva, a tela de "Ativação" mostra "Definitiva — ativada" e o assunto não aparece mais.</p>

      <div class="tip"><strong>Errou o CNPJ no cadastro?</strong> Por segurança, o campo de CNPJ não pode ser editado sozinho depois de salvo (veja o aviso ao lado do campo, em Dados da loja). Se precisar corrigir, envie um e-mail para <a href="mailto:csvirtual.av@gmail.com">csvirtual.av@gmail.com</a> pedindo um código de liberação — ele destrava o campo uma única vez, só pra você corrigir.</div>

      <h3>Verificar se há uma versão nova</h3>
      <p>Na mesma tela <strong>Dados da loja → Ativação</strong>, ao lado do número da versão instalada, o botão <strong>Verificar atualização</strong> pede pro Chrome checar na hora se existe uma versão mais nova do sistema — sem esperar a checagem automática dele, que roda sozinha de tempos em tempos em segundo plano. Se já tiver uma versão nova baixada, aparece um aviso oferecendo aplicar na hora.</p>
      <div class="tip"><strong>Aplicar a atualização recarrega o sistema na hora.</strong> Nada que já foi salvo é afetado (vendas, estoque, caixa, clientes etc.) — só uma venda com itens no carrinho ainda não finalizada seria perdida, então é melhor fechar o carrinho antes de atualizar.</div>
    `,
  },
  {
    id: 'estoque',
    icon: icon('box', { size: 16 }),
    title: 'Estoque',
    html: `
      <h2>Estoque</h2>
      <p class="help-subtitle">Cadastrar produtos, código de barras, validade e controlar quantidade.</p>

      <h3>Cadastrar um produto novo</h3>
      <p>Na tela <strong>Estoque</strong>, clique em <strong>+ Novo produto</strong> (só aparece pra quem tem a permissão "Cadastrar/editar produto" — veja o tópico "Usuários e permissões"). Preencha nome, categoria (material de construção ou mercearia), unidade (un, kg, saco...), código de barras, preço de venda, preço de custo, quantidade inicial e, se quiser, fornecedor padrão.</p>

      <h3>Produto vendido de mais de um jeito — unidade "Personalizado"</h3>
      <p>Pra produto vendido em <strong>formas diferentes</strong> ao mesmo tempo — o exemplo clássico é areia, vendida à lata, ao metro ou à carrada, cada forma com um preço próprio — não precisa cadastrar um produto separado pra cada forma. Escolha <strong>Personalizado</strong> no campo Unidade: aparece um campo <strong>Unidade de medida raiz</strong> (uma lista com as mesmas unidades de sempre, mais "Outra" pra digitar algo como "lata", que não é uma unidade padrão) — é nela que o estoque único do produto é contado. Logo abaixo, o preço único vira uma lista de até <strong>7 formas de venda</strong>, cada uma com 4 campos:</p>
      <ul>
        <li><strong>Forma</strong> — o nome que aparece pro vendedor escolher na hora da venda (ex: "Lata", "Metro", "Carrada")</li>
        <li><strong>Valor de venda</strong> — o preço daquela forma específica</li>
        <li><strong>Custo</strong> — o custo daquela forma específica (usado nos relatórios de margem)</li>
        <li><strong>Equivalência</strong> — quantas unidades da unidade de medida raiz do produto (ex: "lata") cada venda dessa forma consome. Preenche com uma conta que você já sabe de cor, em duas caixas ligadas por "=" (ex: "1 Metro = 56 lata") — o app calcula sozinho. Uma "Lata" normalmente é "1 Lata = 1 lata".</li>
      </ul>
      <p>O produto continua tendo <strong>um único número de estoque</strong> (na unidade raiz que você escolher, ex: "lata") — cada forma vendida desconta dele pela própria equivalência. Use o botão <strong>+ Forma de venda</strong> pra adicionar mais linhas (até 7) e o <strong>✕</strong> ao lado de cada uma pra remover. Produto personalizado não tem os campos de validade/promoção por vencimento (não existe um preço único pra promoção incidir em cima).</p>

      <h3>Código de barras — compatibilidade com o leitor</h3>
      <p>O sistema não conversa diretamente com o leitor (nenhum driver, nenhuma permissão especial) — ele funciona com <strong>qualquer leitor USB (ou Bluetooth) configurado no modo "teclado" (HID)</strong>, que é o modo padrão de fábrica de praticamente todo leitor vendido pra mercado ou loja hoje em dia, seja de pistola (laser) ou de câmera (imager). Nesse modo, o leitor não é visto como um "leitor" pelo computador — ele é visto como um teclado, e "digita" os números do código muito rápido, terminando com a tecla Enter. O sistema só precisa disso: um campo de texto recebendo essas teclas.</p>
      <p>Na prática, isso quer dizer: <strong>se o leitor já funciona digitando o código em qualquer programa comum (Bloco de Notas, uma planilha, a barra de endereço do navegador) e aperta Enter sozinho no final, ele funciona aqui também</strong> — sem nenhum ajuste. É assim que a esmagadora maioria dos leitores de mercado/loja de material vem configurada de fábrica.</p>
      <p>O campo de busca da própria tela <strong>Estoque</strong> também aceita bipe direto (além de buscar por nome/código enquanto digita), do mesmo jeito que a tela de venda.</p>
      <p>Na tela <strong>Nova venda</strong>, dá pra escanear com o campo de busca focado <em>ou não</em> — se o foco escapar do campo (você clicou em outro lugar da tela sem querer), o sistema ainda reconhece o scan em qualquer ponto da página, contanto que nenhum campo de texto ou janela esteja aberta na frente.</p>
      <div class="tip"><strong>Leitor não funciona?</strong> Confira duas coisas na configuração dele (geralmente ajustadas escaneando um "código de configuração" que vem no manual do aparelho): (1) que está no modo <strong>teclado/HID</strong>, não em modo "porta serial/COM virtual" (esse exige driver e não funciona aqui); (2) que o <strong>sufixo é Enter</strong> (às vezes chamado de "CR" ou "Carriage Return") — não Tab nem "nenhum". Testando num campo de texto qualquer fora do sistema (como a busca do navegador) você já descobre se o problema é do leitor ou de outra coisa.</div>
      <p>Produto sem código de fábrica (item a granel, por exemplo)? Clique em <strong>Gerar código interno</strong> — o sistema cria um código só dele, que também pode ser escaneado se você imprimir uma etiqueta (qualquer leitor comum lê tanto código de barras numérico quanto os alfanuméricos gerados aqui).</p>

      <h3>Bipou (ou buscou) um código que não existe?</h3>
      <p>Tanto no <strong>Estoque</strong> quanto na <strong>Nova venda</strong>, se o código não corresponder a nenhum produto cadastrado (nem por código de barras, nem por nome), aparece um aviso perguntando se você quer <strong>cadastrar agora</strong> ou <strong>ignorar</strong>. Cadastrando a partir da Nova venda, o produto recém-criado já entra direto no carrinho — não precisa bipar de novo. Quem não tem a permissão "Cadastrar/editar produto" só vê a explicação, sem a opção de cadastrar.</p>

      <h3>Validade e preço promocional</h3>
      <p>No formulário de cadastro/edição do produto, tem uma seção opcional <strong>"Validade e promoção por vencimento"</strong> com três campos: <strong>Data de validade</strong>, <strong>Dias de antecedência</strong> (quantos dias antes do vencimento a promoção já começa a valer) e <strong>Preço promocional</strong>. Preenchendo os três, o produto passa a vender sozinho pelo preço promocional assim que entrar nessa janela — no PDV (bipando ou buscando por nome) e com a etiqueta <span class="badge badge-gold">Próximo da validade</span> no Estoque e no Painel inicial. Depois que a data de validade passa de verdade, a etiqueta muda para <span class="badge badge-red">Fora da validade</span> no lugar do preço, em todas essas telas.</p>
      <p>O botão <strong>"?"</strong> ao lado do título dessa seção abre um guia de referência com faixas típicas de mercado (ultra-perecíveis, resfriados, mercearia seca, mercearia pesada) pra ajudar a decidir os dias e o desconto — é só um guia informativo, o sistema não calcula nem aplica nada sozinho a partir dele; quem decide os números de cada produto é sempre quem cadastra.</p>
      <p>Deixando os três campos em branco, o produto continua vendendo pelo preço normal pra sempre, sem nenhuma etiqueta.</p>

      <h3>Editar, ajustar e inativar</h3>
      <p>Essas quatro ações ficam agrupadas atrás do botão <strong>Opções</strong>, na última coluna de cada linha da tabela — clique nele e as que você tiver permissão pra fazer aparecem numa listinha, uma abaixo da outra:</p>
      <ul>
        <li><strong>Editar</strong> — muda nome, preço, categoria, código de barras, validade etc. (permissão "Cadastrar/editar produto")</li>
        <li><strong>Ajustar</strong> — usa quando chegou mercadoria nova (entrada) ou quando perdeu/quebrou algo (saída), sem ser uma venda (permissão "Ajustar estoque manualmente e fazer inventário")</li>
        <li><strong>Inativar</strong> — o produto some das vendas, mas o histórico dele continua guardado, melhor que excluir se ele já teve movimentação (permissão "Inativar/reativar produto")</li>
        <li><strong>Excluir</strong> — remove o produto do catálogo de vez (permissão "Excluir produto")</li>
      </ul>
      <p>Cada uma dessas quatro ações tem sua própria permissão — o administrador decide, vendedor por vendedor, quais delas cada um pode fazer (veja o tópico "Usuários e permissões"); sem NENHUMA delas marcada, o botão "Opções" nem aparece na linha. Já <strong>Fazer inventário</strong> (ajusta vários produtos de uma vez, comparando com uma contagem física) usa a mesma permissão de "Ajustar", mas continua sendo um botão à parte, no topo da tela — não fica dentro do menu "Opções".</p>

      <h3>Histórico do produto (todo mundo pode ver)</h3>
      <p>Todo produto tem um botão <strong>Histórico</strong>, ao lado de "Opções" mas fora dele de propósito — mostra toda entrada, saída, venda, ajuste e estorno que já mexeu na quantidade dele, com data, hora e quem fez. Por ser só consulta (não muda nada) e liberado pra qualquer perfil, não faz sentido escondê-lo atrás de mais um clique junto das outras ações.</p>

      <h3>Estoque baixo</h3>
      <p>Cada produto tem um "estoque mínimo" configurável. Quando a quantidade cai igual ou abaixo desse número, ele ganha um selo vermelho de <strong>Estoque baixo</strong> — tanto na lista de produtos quanto no Painel inicial.</p>

      <h3>Filtro de status</h3>
      <p>Ao lado do filtro de categoria, na tela <strong>Estoque</strong>, tem um filtro de status com as mesmas situações mostradas nos selos de cada produto: <strong>Disponível</strong>, <strong>Estoque baixo</strong>, <strong>Inativo</strong>, <strong>Próximo da validade</strong> e <strong>Fora da validade</strong>. Os indicadores correspondentes no <strong>Painel inicial</strong> (Estoque baixo, Próximo da validade, Fora da validade) são clicáveis — clicando neles, a tela Estoque já abre com aquele filtro aplicado, sem precisar escolher de novo.</p>
    `,
  },
  {
    id: 'vendas',
    icon: icon('receipt', { size: 16 }),
    title: 'Vendas (PDV)',
    html: `
      <h2>Vendas (PDV)</h2>
      <p class="help-subtitle">Como registrar uma venda, do escaneamento até o pagamento.</p>

      <h3>Adicionar produtos ao carrinho</h3>
      <p>Na tela <strong>Nova venda</strong>, o campo de busca já fica pronto pra usar. Escaneie o código de barras, ou digite o nome do produto e clique em "Adicionar" na lista que aparece.</p>
      <p>Escaneou o mesmo produto de novo? A quantidade dele no carrinho aumenta sozinha, em vez de criar uma linha nova.</p>
      <p>O campo <strong>Qtd.</strong> de cada linha do carrinho aceita fração, não só número inteiro — dá pra digitar "0,5" pra vender meio metro de areia, 1,5 kg de cimento a granel, e por aí vai. O preço cobrado e o estoque descontado seguem a fração certinho (0,5 metro cobra metade do preço de 1 metro).</p>
      <p>Bipou ou buscou um código/nome que não corresponde a nenhum produto? Aparece um aviso perguntando se quer <strong>cadastrar agora</strong> ou <strong>ignorar</strong> — veja "Bipou um código que não existe?" no tópico Estoque. Cadastrando por aqui, o produto já entra direto no carrinho, sem precisar bipar de novo.</p>
      <p>Produto cadastrado como <strong>Personalizado</strong> (veja "Produto vendido de mais de um jeito" no tópico Estoque) não vai direto pro carrinho — bipando ou buscando por nome, aparece o nome do produto e, abaixo, uma linha por forma de venda cadastrada, cada uma com seu preço e seu próprio botão <strong>Adicionar</strong>. Escolha a forma que corresponde à venda de verdade (ex: "Carrada" ou "Lata").</p>
      <div class="tip"><strong>O carrinho não some se você trocar de tela.</strong> Precisou conferir algo em Estoque ou olhar o Painel no meio de uma venda? Pode ir e voltar à vontade — o carrinho, o desconto e as formas de pagamento continuam exatamente do jeito que estavam. Ele só é esvaziado de verdade ao finalizar a venda, ao deslogar, ou clicando no botão <strong>${icon('trash', { size: 14 })} Limpar</strong> (canto superior direito do carrinho, aparece só quando tem pelo menos 1 item) — que pede confirmação antes, pra não perder a venda sem querer.</div>

      <h3>Congelar (Pix caiu, cartão travou, fila esperando)</h3>
      <p>O botão <strong>${icon('hourglass', { size: 14 })} Congelar</strong>, ao lado do <strong>Limpar</strong> (aparece com pelo menos 1 item no carrinho), congela o carrinho inteiro — itens, cliente selecionado, desconto e pagamentos já adicionados — e libera a tela zerada na hora, pronta pra atender o próximo cliente da fila. É pensado exatamente pro momento em que um pagamento trava no meio da venda (Pix sem internet, maquininha sem sinal) e não faz sentido segurar todo mundo esperando: congela aquele carrinho, atende quem está atrás, e volta pra ele quando o problema se resolver.</p>
      <p>Os carrinhos congelados aparecem como uma lista de cartões logo abaixo do campo <strong>Cliente</strong>, um abaixo do outro, cada um com o nome do cliente (ou "Carrinho congelado #N", se nenhum cliente foi selecionado), quantidade de itens, total e há quanto tempo foi congelado. A barrinha colorida do lado esquerdo de cada cartão muda sozinha conforme o tempo passa — verde logo depois de congelar, dourada depois de alguns minutos, vermelha esperando muito tempo — só pra ajudar a perceber de relance qual atendimento está parado há mais tempo, quando há mais de um. Dois botões por cartão: <strong>${icon('check', { size: 13 })}</strong> — traz aquele carrinho de volta a ser o ativo, pronto pra finalizar — e <strong>${icon('trash', { size: 13 })}</strong> — descarta o carrinho congelado de vez, sem registrar venda nenhuma (pede confirmação antes).</p>
      <div class="tip"><strong>E se eu clicar em "Retomar" com outro atendimento em andamento?</strong> Se o carrinho ativo no momento também tiver algo (item, cliente, pagamento parcial...), o sistema avisa e, confirmando, congela esse atendimento em andamento automaticamente antes de trazer o outro — nada se perde, dá pra ir alternando entre vários clientes esperando ao mesmo tempo.</div>
      <div class="tip"><strong>Estoque reservado.</strong> Um produto com pouca quantidade sobrando não pode ser vendido duas vezes: se 3 das 5 unidades de um produto já estão num carrinho congelado, o próximo cliente só consegue levar as 2 que sobraram — o sistema mostra esse número já descontado e avisa se tentar pegar mais do que isso.</div>
      <div class="tip"><strong>Não fica salvo se fechar o navegador.</strong> Carrinho congelado vive só enquanto a sessão está aberta — some ao deslogar ou trocar de usuário, igual o carrinho normal. Não é lugar pra guardar uma venda de um dia pro outro.</div>

      <h3>Preço promocional por validade</h3>
      <p>Produto cadastrado com validade e preço promocional (veja "Validade e preço promocional" no tópico Estoque) entra sozinho no carrinho já com o preço promocional, assim que estiver dentro da janela configurada — bipando ou buscando por nome, tanto faz. O item aparece com a etiqueta <span class="badge badge-gold">Próximo da validade</span> no carrinho e na lista de resultados de busca, pra ficar claro pro vendedor (e pro cliente, se a tela estiver visível) por que o preço está diferente do normal.</p>

      <h3>Desconto</h3>
      <p>Cada linha do carrinho tem um botão <strong>% desconto</strong> — dá pra descontar em percentual ou em valor fixo (reais), só naquele item. Também existe um <strong>desconto geral</strong>, logo abaixo da lista, que se aplica sobre o total inteiro da venda.</p>
      <div class="warn-box"><strong>Atenção, vendedores:</strong> existe um limite de desconto que dá pra aplicar sozinho (configurado pelo administrador em Dados da loja → Políticas de venda). Passou do limite? Aparece uma tela pedindo pra um administrador digitar a própria senha ali mesmo, autorizando o desconto — sem precisar trocar de login. Isso não vale pra quem tem a permissão "Aplicar desconto acima do limite sem aprovação" (veja "Usuários e permissões") — pra esse vendedor específico, não existe teto nenhum, igual admin.</div>

      <h3>Pagamento</h3>
      <p>Clique em <strong>+ Forma de pagamento</strong> quantas vezes precisar — dá pra dividir a mesma venda entre dinheiro, cartão de débito, cartão de crédito e Pix, por exemplo metade em dinheiro e metade no cartão. O botão de finalizar só libera quando a soma dos pagamentos bate exatamente com o total.</p>
      <p>Escolheu <strong>Cartão de crédito</strong>? Aparece um seletor de <strong>parcelas</strong> (1x até 12x) do lado. A maquininha em si continua sendo um aparelho separado, sem nenhuma conexão com o sistema (veja por quê no tópico abaixo) — mas se a loja configurar um juro de parcelamento próprio (veja "Juro no parcelamento", logo adiante), ele já aparece calculado ali mesmo, embaixo da forma de pagamento.</p>

      <h3>Juro no parcelamento</h3>
      <p>Isso é opcional, e só quem tem a permissão "Acessar Dados da loja" configura — em <strong>Dados da loja → Juros no parcelamento do cartão de crédito</strong>. O vendedor nunca vê nem edita essa taxa na hora da venda: ela entra sozinha, calculada, ao escolher Cartão de crédito e o número de parcelas.</p>
      <p><strong>1x (à vista no cartão) nunca tem juro</strong>, não importa a configuração — não é parcelamento de verdade, é só aceitar o cartão como forma de pagamento.</p>
      <p>Duas coisas pra configurar:</p>
      <ul>
        <li><strong>Até quantas vezes sem juros</strong> (opcional) — marque a caixinha e diga até que parcela fica isento (ex: até 3x sem juros). Desmarcada, qualquer parcelamento (2x em diante) já cobra juro.</li>
        <li><strong>Tipo de juro</strong> — <em>% ao mês</em> (multiplica pela quantidade de parcelas: mais parcelas, mais juro total, como financiamento de verdade) ou <em>% fixo</em> (o mesmo valor, não importa se são 2x ou 12x). Só um dos dois vale por vez.</li>
      </ul>
      <p>O juro calculado aparece na tela de venda, no recibo impresso e no detalhe da venda no Histórico — sempre discriminado à parte do valor dos produtos. Ele conta como faturamento normal nos relatórios, porque é dinheiro que realmente entra na loja.</p>
      <div class="tip"><strong>Atenção:</strong> esse juro é o que a <em>loja</em> decide repassar — diferente do juro que o banco emissor do cartão do cliente pode aplicar por conta própria (esse aí o sistema nunca sabe, nem tem como calcular — só aparece direto na maquininha, na hora da transação). Configure aqui só se a sua loja realmente cobra juro próprio no parcelamento; se o parcelamento já é "sem juros" (o custo fica só com a loja, prática mais comum), deixe tudo zerado.</div>

      <h3>Imprimir recibo</h3>
      <p>Assim que a venda é finalizada, aparece um aviso com o botão <strong>${icon('printer', { size: 14 })} Imprimir recibo</strong> — ele abre o diálogo de impressão do próprio navegador, onde você escolhe a impressora (inclusive impressora térmica de cupom, se o computador já tiver uma instalada) ou "Salvar como PDF". Não precisa de nenhuma configuração extra no sistema: qualquer impressora que já funciona no computador funciona aqui.</p>
      <p>Precisa reimprimir uma venda mais tarde? Vá em <strong>Histórico de vendas</strong>, abra "Ver itens" na venda e clique em <strong>${icon('printer', { size: 14 })} Imprimir recibo</strong> lá também — o recibo é o mesmo, a qualquer momento.</p>
      <div class="tip"><strong>Importante:</strong> esse recibo é um comprovante de venda, não um documento fiscal — o sistema não emite nota fiscal eletrônica (NFe/NFC-e).</div>

      <h3>Crédito de troca</h3>
      <p>Se o cliente tiver um crédito de troca disponível (veja o tópico "Estorno e troca"), ele aparece como um aviso verde no topo da tela de venda, com um botão pra usar como parte do pagamento.</p>

      <h3>Fiado</h3>
      <p>Fiado também é uma forma de pagamento, igual dinheiro ou cartão — só que em vez de receber na hora, o valor vira uma dívida na conta do cliente. Pra usar, é preciso selecionar o cliente no campo <strong>Cliente</strong>, no canto superior esquerdo da tela (veja o tópico "Clientes e fiado" pra entender o resto).</p>

      <h3>Finalizar venda + carreto</h3>
      <p>Quando a venda vai ser entregue (comum em loja de material de construção), use o botão <strong>Finalizar venda + carreto</strong>, logo abaixo do "Finalizar venda" normal — só fica disponível com um cliente selecionado. Ele abre uma lista com todos os itens do carrinho, cada um com uma caixinha de marcação (todos vêm marcados por padrão): desmarque só o que <em>não</em> vai nesta entrega — por exemplo, um item que o próprio cliente já levou na hora. Ao confirmar, a venda é registrada normalmente e, na sequência, um carreto já nasce pronto só com os itens marcados, com o endereço do cliente pré-preenchido (editável) e campo pra responsável pela entrega e observações.</p>
      <p class="text-muted" style="font-size:12.5px;">Cancelar esse modal não registra nada — nem a venda, nem o carreto. Veja o tópico "Carreto (entregas)" pra entender o resto da tela.</p>
    `,
  },
  {
    id: 'clientes-fiado',
    icon: icon('user', { size: 16 }),
    title: 'Clientes e fiado',
    html: `
      <h2>Clientes e fiado</h2>
      <p class="help-subtitle">Cadastrar clientes e controlar quem deve o quê.</p>

      <h3>Cadastrar um cliente</h3>
      <p>Vá em <strong>Clientes → + Novo cliente</strong>, ou cadastre na hora: durante uma venda, ao buscar um cliente que ainda não existe, aparece a opção "Cadastrar como novo cliente" direto na tela.</p>
      <p>O campo <strong>CPF/CNPJ</strong> aceita os dois — reconhece sozinho qual é pela quantidade de números digitados (11 vira CPF, 14 vira CNPJ) e confere o dígito verificador de verdade, não só a quantidade de números. O <strong>telefone</strong> também se formata sozinho enquanto digita. Os dois são opcionais.</p>

      <h3>Vendendo fiado</h3>
      <p>Na tela <strong>Nova venda</strong>, selecione o cliente no campo próprio e, na hora do pagamento, escolha <strong>Fiado</strong> como forma de pagamento (pode ser só uma parte do valor, combinado com dinheiro ou cartão no resto). O valor entra automaticamente na conta do cliente como uma dívida — não precisa fazer mais nada.</p>

      <h3>Limite de crédito (opcional)</h3>
      <p>No cadastro do cliente, dá pra definir um limite de crédito. Se a nova venda fiada for deixar o cliente devendo mais que esse limite, o sistema avisa e pede confirmação antes de continuar — não bloqueia, só chama atenção.</p>

      <h3>Vencimento do saldo (lembrete, opcional)</h3>
      <p>Também no cadastro do cliente dá pra marcar uma data de "vencimento do saldo" — <strong>não é parcelamento</strong> (o fiado continua sendo um saldo único em aberto, sem dividir em parcelas com vencimentos separados), é só um lembrete de até quando cobrar o que está em aberto. Passada a data sem o saldo zerado, o cliente aparece com a etiqueta <strong>"Vencido"</strong> na lista de Clientes e numa seção própria no Painel ("Fiado vencido", com um link <strong>"Ver tudo →"</strong> que já leva direto pra esta tela). Pode editar ou apagar essa data a qualquer momento, mesmo com saldo ainda em aberto.</p>

      <h3>Recebendo o pagamento do fiado</h3>
      <p>Vá em <strong>Clientes</strong>, clique em <strong>Extrato</strong> no cliente que pagou, e depois em <strong>Registrar pagamento</strong>. Informe o valor (pode ser parcial) e a forma de pagamento. O extrato do cliente mostra todo o histórico: o que foi fiado e o que já foi pago, com data e quem registrou cada lançamento.</p>

      <div class="tip"><strong>Dica:</strong> se o pagamento do fiado for em dinheiro e o caixa estiver aberto, esse valor já entra automaticamente na conferência de fechamento do caixa — não precisa lançar de novo em nenhum outro lugar.</div>

      <h3>O que o cliente já comprou</h3>
      <p>O botão <strong>Extrato</strong> mostra só o lado financeiro (o que ele deve e já pagou). Pra ver os produtos comprados, use o botão <strong>Ver compras</strong>, na mesma linha do cliente — lista todas as vendas dele (qualquer forma de pagamento, não só fiado), e cada uma tem seu próprio "Ver itens" com o detalhe completo, sem precisar ir até "Histórico de vendas" e filtrar manualmente.</p>

      <h3>Saldo devedor no Painel</h3>
      <p>O Painel inicial mostra um card com o <strong>total em fiado</strong> de todos os clientes somados — um jeito rápido de acompanhar quanto a loja tem "a receber" no fiado.</p>
    `,
  },
  {
    id: 'lgpd',
    icon: icon('lock', { size: 16 }),
    title: 'Privacidade e LGPD',
    // Único tópico com conteúdo dinâmico — puxa o nome da loja e do
    // encarregado direto do cadastro (ver views/company.js), pra não
    // obrigar copiar/colar manualmente esses dados no aviso de privacidade
    // pronto. Os outros tópicos são texto fixo; ver renderTopic() mais
    // abaixo pra como isso é tratado nos dois casos.
    html: (company) => {
      const nomeLoja = company?.nomeFantasia || '[nome da loja]';
      const encNome = company?.encarregadoLgpd?.nome;
      const encContato = company?.encarregadoLgpd?.contato;
      const linhaEncarregado = encNome
        ? `Responsável pelos seus dados nesta loja: ${encNome}${encContato ? ` — ${encContato}` : ''}.`
        : '[Se quiser, informe aqui quem é o responsável por dúvidas de privacidade — preencha em Dados da loja → Privacidade e LGPD.]';
      return `
      <h2>Privacidade e LGPD</h2>
      <p class="help-subtitle">O sistema é 100% local, mas isso não tira a responsabilidade da loja sobre os dados dos clientes.</p>

      <h3>Quem é o responsável pelos dados</h3>
      <p>A Lei Geral de Proteção de Dados (LGPD) se aplica sempre que dado pessoal é tratado — nome, telefone, endereço, histórico de fiado — <strong>mesmo guardado só localmente</strong>, sem sair do computador. Pela lei, quem decide coletar e usar esse dado é o <strong>"controlador"</strong> — e esse é <strong>o dono da loja</strong>, não o sistema em si. O sistema é só a ferramenta; a responsabilidade de informar os clientes e atender pedidos deles sobre os próprios dados é da loja.</p>

      <div class="tip"><strong>O que o sistema já ajuda:</strong> tudo fica só neste computador (nada sobe pra nuvem nem é compartilhado com ninguém), senha nunca é gravada em texto puro, backup só sai criptografado, e toda ação fica registrada no Log de auditoria. Isso reduz bastante o risco, mas não substitui avisar o cliente sobre o que é feito com o dado dele.</div>

      <h3>Aviso de privacidade pronto pra usar</h3>
      <p>Texto pra afixar no balcão ou entregar ao cliente — pode copiar, adaptar e imprimir como quiser:</p>
      <div class="template-box">AVISO DE PRIVACIDADE — ${escapeHtml(nomeLoja)}

Seus dados (nome, telefone, endereço) são usados só para controle de vendas, fiado e entregas desta loja. Ficam guardados de forma segura, apenas no computador da loja — não são enviados para a internet nem compartilhados com terceiros.

Você pode pedir a qualquer momento para ver, corrigir ou apagar seus dados. Registros de venda podem precisar ser mantidos por um tempo por exigência fiscal, mesmo após um pedido de exclusão.

${escapeHtml(linhaEncarregado)}</div>

      <h3>Direitos do cliente sobre os próprios dados</h3>
      <p>Pela LGPD (Art. 18), o cliente pode pedir pra <strong>ver</strong>, <strong>corrigir</strong> ou <strong>apagar</strong> os dados que a loja tem sobre ele. Na prática, no sistema:</p>
      <ul>
        <li><strong>Ver e corrigir</strong> — tela <strong>Clientes → Editar</strong>, a qualquer momento.</li>
        <li><strong>Apagar</strong> — o cadastro pode ser <strong>desativado</strong> (some das buscas, não recebe mais venda fiada), mas o <strong>histórico de vendas e fiado já registrado continua guardado</strong> — não é falha do sistema, é a própria LGPD (Art. 16) que permite manter esse tipo de registro por obrigação legal/fiscal, mesmo depois de um pedido de exclusão.</li>
      </ul>

      <h3>Encarregado de dados (opcional, mas recomendado)</h3>
      <p>A LGPD prevê a figura de um <strong>encarregado</strong> — a pessoa de contato pra dúvidas sobre dados pessoais na loja (pode ser o próprio dono). Dá pra cadastrar em <strong>Dados da loja → Privacidade e LGPD</strong>; uma vez preenchido, o nome e contato aparecem automaticamente no aviso de privacidade acima.</p>
    `;
    },
  },
  {
    id: 'carreto',
    icon: icon('truck', { size: 16 }),
    title: 'Carreto (entregas)',
    html: `
      <h2>Carreto (entregas)</h2>
      <p class="help-subtitle">Organizar o que precisa ser entregue pro cliente — disponível pros dois perfis.</p>

      <h3>Pra que serve</h3>
      <p>Em loja de material de construção é comum o "carreto" — o veículo que leva a mercadoria até a obra ou a casa do cliente. Essa tela é só um <strong>registro organizado</strong> do que vai em cada entrega, pra quem, e se já saiu ou não. Ela <strong>não mexe em estoque nem em dinheiro</strong> — a baixa de estoque de verdade acontece na tela <strong>Nova venda</strong>, como sempre. O carreto é só um checklist de logística por cima disso.</p>

      <h3>Cadastrar um carreto novo</h3>
      <p>Vá em <strong>Carreto → + Novo carreto</strong>. Escolha o cliente (busca o cadastro já existente ou cadastra um novo ali mesmo, igual na tela de venda) e adicione os itens de duas formas:</p>
      <ul>
        <li><strong>Item do estoque</strong> — busca um produto já cadastrado, pra manter o item rastreável.</li>
        <li><strong>Item avulso</strong> — descrição livre com unidade própria, pra cobrir o que não é produto de prateleira (ex: "carga de areia", "entulho", "carga de tijolo a granel").</li>
      </ul>
      <p>O endereço de entrega vem preenchido automaticamente com o endereço cadastrado do cliente, mas pode ser trocado — a entrega às vezes é num endereço diferente (a obra, por exemplo). Dá pra anotar também quem é o responsável pelo carreto e observações gerais.</p>

      <h3>Status do carreto</h3>
      <ul>
        <li><span class="badge badge-gray">Pendente</span> — ainda não saiu pra entrega.</li>
        <li><span class="badge badge-green">Entregue</span> — marcado como entregue, com data/hora e quem confirmou.</li>
        <li><span class="badge badge-red">Cancelado</span> — não vai mais ser entregue.</li>
      </ul>
      <p>Só um carreto <strong>pendente</strong> pode virar entregue ou ser cancelado — depois de marcado, o status fica travado (se precisar corrigir algo, cadastre um carreto novo).</p>
      <p>O Painel inicial mostra um card com a <strong>quantidade de carretos pendentes</strong> e, mais abaixo, uma lista com os mais recentes — um jeito rápido de ver o que ainda precisa sair pra entrega sem precisar abrir a tela Carreto pra conferir. Os dois são clicáveis (o card, e o link <strong>"Ver tudo →"</strong> no canto da lista) e levam direto pra esta tela.</p>

      <h3>Relação com a Venda</h3>
      <p>O carreto é independente da venda — dá pra cadastrar antes, depois ou até sem nenhuma venda vinculada (por exemplo, entrega de uma troca ou de um material já pago por fora). Por isso ele não desconta do estoque sozinho: se os itens do carreto também precisam sair do estoque, registre a venda normalmente na tela própria — ou use o atalho abaixo, que faz as duas coisas de uma vez.</p>

      <h3>Atalho: gerar direto da Nova venda</h3>
      <p>Na tela <strong>Nova venda</strong>, o botão <strong>Finalizar venda + carreto</strong> (abaixo do "Finalizar venda" normal) registra a venda e já cadastra o carreto na sequência, com os itens que você marcar numa lista — poupa ter que abrir a tela Carreto separadamente logo depois de vender. Um carreto cadastrado assim mostra "gerado junto com uma venda" no detalhe. Veja o tópico "Vendas (PDV)" pra mais detalhes desse atalho.</p>
    `,
  },
  {
    id: 'estorno-troca',
    icon: icon('undo', { size: 16 }),
    title: 'Estorno e troca',
    html: `
      <h2>Estorno e troca</h2>
      <p class="help-subtitle">O que fazer quando o cliente devolve um produto — disponível pros dois perfis.</p>

      <h3>Como estornar</h3>
      <p>Vá em <strong>Histórico de vendas</strong>, clique em "Ver itens" na venda em questão, e depois em <strong>Estornar itens</strong>. Escolha a quantidade de cada item que está sendo devolvida e escreva o motivo (obrigatório) — pode ser um item só ou a venda inteira.</p>
      <p>O estorno devolve a quantidade pro estoque automaticamente e fica registrado no histórico daquele produto e no log de auditoria.</p>

      <div class="warn-box"><strong>Se a venda teve juro no parcelamento do cartão</strong> (veja "Juro no parcelamento" no tópico Vendas): o estorno devolve só o valor dos <em>produtos</em> — o juro já cobrado na maquininha não é reduzido nem rateado automaticamente, estorno total ou parcial. Isso é porque a extensão não tem nenhuma conexão com a maquininha nem com a operadora do cartão pra saber quanto de juro ela devolveria. Se a loja decidir devolver o juro também, é um acerto manual, fora do sistema.</div>

      <h3>Venda paga em fiado</h3>
      <p>Se a venda estornada tinha sido paga (total ou parcialmente) em <strong>Fiado</strong>, a dívida do cliente é reduzida automaticamente na mesma proporção do que foi devolvido — devolver metade dos produtos reduz metade do valor que aquela venda tinha gerado de dívida, não o valor cheio. Isso aparece no extrato do cliente (tela Clientes) como um lançamento <span class="badge badge-gold">Estorno</span>, separado dos pagamentos recebidos — não conta como dinheiro que entrou no caixa.</p>

      <h3>Devolver dinheiro ou virar crédito de troca?</h3>
      <p>Ao estornar, tem uma opção <strong>"Gerar crédito de troca"</strong>. Marque quando o cliente vai levar outro produto em vez do dinheiro de volta — o valor fica guardado e aparece como forma de pagamento disponível na próxima venda (dá até pra usar só uma parte e guardar o resto pra depois).</p>
      <p>Se não marcar essa opção, o sistema entende que o dinheiro foi devolvido na hora, em espécie.</p>

      <h3>Status da venda</h3>
      <ul>
        <li><span class="badge badge-green">Completa</span> — nada foi estornado.</li>
        <li><span class="badge badge-gold">Parcialmente estornada</span> — só parte dos itens/quantidade voltou.</li>
        <li><span class="badge badge-red">Estornada</span> — tudo foi devolvido.</li>
      </ul>
    `,
  },
  {
    id: 'caixa',
    icon: icon('moneybag', { size: 16 }),
    title: 'Caixa',
    html: `
      <h2>Caixa</h2>
      <p class="help-subtitle">Abrir, sangria/suprimento, retificar um valor errado e fechar o caixa com conferência.</p>

      <h3>Abrir o caixa</h3>
      <p>No início do turno, vá em <strong>Caixa</strong> e informe o troco inicial (o dinheiro que já está na gaveta antes de começar a vender). O sistema é de <strong>um caixa só pra loja toda</strong> — não é um caixa por vendedor.</p>

      <h3>Sangria e suprimento</h3>
      <ul>
        <li><strong>Sangria</strong> — retirar dinheiro do caixa durante o turno (ex: levar pro banco). Precisa de motivo.</li>
        <li><strong>Suprimento</strong> — colocar dinheiro a mais no caixa (ex: reforçar o troco). Também precisa de motivo.</li>
      </ul>
      <p>Enquanto o caixa está aberto, a tela mostra o quanto <em>deveria</em> ter em cada forma de pagamento, atualizado a cada venda.</p>

      <h3>Retificar (corrigir um valor lançado errado)</h3>
      <p>Errou o valor do troco inicial, de uma sangria ou de um suprimento? O botão <strong>Retificar</strong>, ao lado de "Fechar caixa", corrige isso sem mexer em nenhuma venda registrada. Escolha o que quer corrigir (o troco ou o lançamento específico), informe o valor certo e o motivo — o sistema calcula a diferença sozinho.</p>
      <p>O lançamento errado <strong>nunca é apagado nem editado</strong>: a retificação entra como um registro à parte, referenciando o que foi corrigido, de/para e o motivo — tudo com o nome de quem corrigiu e a data/hora, igual toda ação de caixa. Assim o histórico completo fica preservado (o valor errado que foi lançado e a correção em cima dele), em vez de reescrever silenciosamente o que já tinha sido registrado.</p>

      <h3>Fechar o caixa</h3>
      <p>No fim do turno, clique em <strong>Fechar caixa</strong>. Conte o dinheiro físico da gaveta e digite o valor — os outros métodos (cartão, Pix) são só conferência, não precisam de contagem física. O sistema mostra se <strong>bateu certinho</strong>, <strong>sobrou</strong> ou <strong>faltou</strong> dinheiro.</p>
      <div class="tip"><strong>Dica:</strong> depois de fechado, o caixa não pode ser reaberto — se precisar continuar vendendo, é só abrir um novo.</div>

      <h3>Confirmação por senha e backup automático</h3>
      <p>Antes de confirmar o fechamento, o sistema pede pra digitar <strong>usuário e senha de qualquer conta ativa</strong> — não precisa ser administrador, nem precisa ser a mesma pessoa que está logada na aba. É só uma confirmação de que alguém autorizado está de fato fechando o caixa naquele momento.</p>
      <p>Assim que a senha é aceita, o sistema já <strong>gera e baixa sozinho um backup completo e atualizado</strong> de tudo (a mesma senha digitada criptografa o arquivo, sem pedir uma segunda) — uma segurança extra de fim de turno, sem precisar lembrar de ir na tela <strong>Backup</strong> fazer isso à parte. Se por algum motivo o backup não puder ser gerado, o caixa fecha normalmente do mesmo jeito — só aparece um aviso pra gerar um backup manual depois.</p>

      <h3>Caixa obrigatório (opcional, configurável)</h3>
      <p>O administrador pode ligar, em <strong>Dados da loja → Políticas de venda</strong>, a opção "Exigir caixa aberto para registrar vendas". Ligada essa opção, ninguém consegue finalizar uma venda sem abrir o caixa primeiro.</p>

      <div class="tip"><strong>Fiado não conta como dinheiro no caixa</strong> — uma venda fiada não entra na conferência, porque é uma promessa de pagamento, não dinheiro na gaveta. Só quando o cliente vem pagar o fiado (veja o tópico "Clientes e fiado") é que o valor entra no caixa, na hora do pagamento.</div>

      <h3>Estorno e a conferência do caixa</h3>
      <p>Um estorno (veja "Estorno e troca") entra na conferência do caixa que estiver <strong>aberto na hora do estorno</strong> — não na do caixa da venda original. Ou seja: se um cliente devolve hoje algo que comprou semana passada, é o caixa de <strong>hoje</strong> que espera esse dinheiro sair da gaveta (supondo que não foi marcado "Gerar crédito de troca").</p>
      <p>Se a venda estornada tinha sido paga (total ou parcialmente) em Fiado, só a parte paga em dinheiro/cartão/Pix é que sai da gaveta na conferência — a parte fiada nunca entrou como dinheiro, então devolvê-la só reduz a dívida do cliente (veja "Venda paga em fiado" no tópico "Estorno e troca"), sem mexer no caixa.</p>
    `,
  },
  {
    id: 'usuarios',
    icon: icon('users', { size: 16 }),
    title: 'Usuários e permissões',
    html: `
      <h2>Usuários e permissões</h2>
      <p class="help-subtitle">A diferença entre Administrador e Vendedor, e como conceder poderes extras.</p>

      <h3>Administrador Geral</h3>
      <p>É único na loja (o primeiro usuário cadastrado). Tem acesso a absolutamente tudo, sempre — nenhuma permissão marcável se aplica a ele, porque não faz sentido: ele já pode tudo por ser admin.</p>

      <h3>Vendedor — o básico que todo mundo tem</h3>
      <p>Cadastrado por quem tem a permissão "Acessar Usuários" (o administrador sempre tem), em <strong>Usuários → + Novo vendedor</strong>. Todo vendedor, sem exceção, já nasce podendo:</p>
      <ul>
        <li>Ver o estoque geral (consultar produto, preço, quantidade)</li>
        <li>Registrar vendas e ver o histórico de vendas de todo mundo, e estornar uma venda (total ou por item)</li>
        <li>Abrir/fechar caixa, fazer sangria/suprimento e retificar um valor lançado errado</li>
        <li>Cadastrar e editar cliente, vender fiado e receber pagamento de fiado</li>
        <li>Cadastrar e organizar carreto (entregas)</li>
        <li>Mexer na própria Personalização (tema claro/escuro) e ver a Ajuda</li>
      </ul>
      <p>Além disso, um vendedor <strong>não tem nenhum poder extra por padrão</strong> — cada um dos poderes abaixo só existe pra ele se o admin (ou outra pessoa com a permissão certa) marcar a caixinha correspondente, no cadastro ou na edição dele.</p>

      <h3>Poderes concedidos individualmente</h3>
      <p>Ao cadastrar ou editar um vendedor, aparece uma lista de checkboxes agrupada — marque só o que aquele vendedor específico precisar. Nenhum vem marcado por padrão:</p>
      <p><strong>Telas</strong> (acesso à tela inteira, incluindo tudo que ela permite fazer):</p>
      <ul>
        <li><strong>Acessar Compras</strong> — fornecedores e pedidos de compra</li>
        <li><strong>Acessar Financeiro</strong> — contas a pagar/receber</li>
        <li><strong>Acessar Relatórios</strong></li>
        <li><strong>Acessar Usuários</strong> — cadastrar/editar vendedor, redefinir senha, ativar/desativar (veja os limites logo abaixo)</li>
        <li><strong>Acessar Log do sistema</strong></li>
        <li><strong>Acessar Dados da loja</strong></li>
        <li><strong>Acessar Backup</strong> — exportar e restaurar backup manualmente</li>
      </ul>
      <p><strong>Estoque</strong> (a tela em si todo vendedor já vê — isto libera as ações dentro dela):</p>
      <ul>
        <li><strong>Cadastrar/editar produto</strong></li>
        <li><strong>Ajustar estoque manualmente e fazer inventário</strong></li>
        <li><strong>Inativar/reativar produto</strong></li>
        <li><strong>Excluir produto</strong></li>
      </ul>
      <p><strong>Clientes</strong> (cadastrar/editar cliente já é liberado por padrão — isto é só a exclusão):</p>
      <ul><li><strong>Excluir cliente</strong></li></ul>
      <p><strong>Vendas</strong>:</p>
      <ul><li><strong>Aplicar desconto acima do limite sem aprovação</strong> — pra esse vendedor, o teto de desconto configurado em Dados da loja deixa de valer (veja "Desconto" no tópico Vendas)</li></ul>

      <div class="tip"><strong>Uma caixinha desmarcada trava dos dois lados</strong> — o botão/menu correspondente nem aparece pra esse vendedor, e a ação em si é recusada mesmo que tentada por fora da tela normal. Não é só "esconder o botão".</div>

      <h3>Limites de quem gerencia "Usuários" sem ser admin</h3>
      <p>A permissão "Acessar Usuários" pode ser delegada, mas com travas pra não virar um jeito indireto de qualquer vendedor se tornar admin de fato:</p>
      <ul>
        <li>Um vendedor com essa permissão só pode <strong>repassar pra outro vendedor os poderes que ele mesmo já tem</strong> — as caixinhas de um poder que ele não possui aparecem travadas (${icon('lock', { size: 13 })}) no formulário, tanto ao cadastrar quanto ao editar.</li>
        <li>Ninguém consegue editar as <strong>próprias</strong> permissões, nem o administrador consegue ser editado por essa tela — precisa ser outra pessoa com a permissão.</li>
        <li>Redefinir a senha do <strong>Administrador Geral</strong> continua exclusivo de quem já é admin de verdade, mesmo com essa permissão marcada.</li>
      </ul>

      <h3>Gerenciando vendedores</h3>
      <p>Na tela <strong>Usuários</strong>: <strong>Editar</strong> muda nome e as permissões do vendedor; <strong>Desativar</strong> impede login (as vendas dele continuam no histórico) e pode ser revertido em <strong>Reativar</strong>; <strong>Redefinir senha</strong> troca a senha de qualquer vendedor sem precisar saber a antiga.</p>
    `,
  },
  {
    id: 'compras',
    icon: icon('cart', { size: 16 }),
    title: 'Fornecedores e compras',
    html: `
      <h2>Fornecedores e compras</h2>
      <p class="help-subtitle">Como repor o estoque de forma organizada — exige a permissão "Acessar Compras".</p>

      <h3>Cadastrar fornecedor</h3>
      <p>Vá em <strong>Compras → Fornecedores → + Novo fornecedor</strong>. Vale a pena vincular cada produto ao fornecedor de costume dele — isso é feito no próprio cadastro do produto, em <strong>Estoque</strong>, no campo "Fornecedor padrão". É esse vínculo que faz a sugestão automática de compra funcionar.</p>
      <p>Telefone, e-mail e CPF/CNPJ do fornecedor seguem a mesma formatação e validação automática do cadastro de cliente (veja o tópico "Clientes e fiado") — todos opcionais.</p>

      <h3>Criar um pedido de compra</h3>
      <p>Em <strong>Compras → Pedidos de compra → + Novo pedido</strong>, escolha o fornecedor e adicione os produtos (buscando pelo nome), com quantidade e custo unitário combinado. O pedido fica com status <strong>Aberto</strong> até alguém receber a mercadoria.</p>

      <h3>Sugestão automática</h3>
      <p>O botão <strong>Sugestão automática</strong> olha todos os produtos com estoque baixo que já têm um fornecedor padrão cadastrado, agrupa por fornecedor e sugere uma quantidade de reposição — é só um ponto de partida, dá pra ajustar tudo antes de confirmar o pedido.</p>

      <h3>Recebendo a mercadoria</h3>
      <p>Quando a entrega chegar, abra o pedido e clique em <strong>Receber mercadoria</strong>. Pode ser tudo de uma vez ou aos poucos (entregas parciais) — o sistema só dá entrada no estoque na quantidade que você confirmar receber, e atualiza o preço de custo do produto com o valor informado na nota.</p>
      <p>O pedido muda de status sozinho: <span class="badge badge-gray">Aberto</span> → <span class="badge badge-gold">Recebido parcialmente</span> → <span class="badge badge-green">Recebido</span>. Um pedido que ainda não recebeu nada pode ser cancelado.</p>

      <h3>Inventário / balanço</h3>
      <p>Em <strong>Estoque → Fazer inventário</strong>, dá pra contar fisicamente todos os produtos de uma vez e digitar o valor encontrado — o sistema ajusta sozinho só os produtos com diferença, registrando tudo no histórico de cada um. O valor contado também aceita fração (ex: 77,5), pra produtos medidos em kg, litro ou metro.</p>
    `,
  },
  {
    id: 'financeiro-fidelidade',
    icon: icon('dollar', { size: 16 }),
    title: 'Financeiro e fidelidade',
    html: `
      <h2>Financeiro, relatórios e fidelidade</h2>
      <p class="help-subtitle">Contas a pagar/receber (com pagamento parcial), relatórios gerenciais e pontos.</p>

      <h3>Contas a pagar e a receber</h3>
      <p>Em <strong>Financeiro → + Nova conta</strong> (exige a permissão "Acessar Financeiro"), cadastre uma conta com descrição, valor e vencimento. Uma conta pendente vira <span class="badge badge-red">Vencida</span> sozinha quando passa da data — não precisa fazer nada pra isso acontecer.</p>
      <p>Quando alguém pagar (ou você receber), clique em <strong>Registrar pagamento</strong> e informe o valor e a forma de pagamento. O valor <strong>pode ser menor</strong> que o total da conta — nesse caso ela ganha a etiqueta <span class="badge badge-gold">Pago parcialmente</span>, com o quanto ainda falta em destaque, e continua contando no resumo de "a pagar/a receber" pelo saldo restante (nunca pelo valor cheio, que já daria a entender que nada foi pago). Volte quantas vezes precisar em <strong>Concluir pagamento</strong> pra ir registrando o resto — a conta só vira <span class="badge badge-green">Pago</span> de verdade quando a soma bater com o total.</p>
      <p>O botão <strong>Ver pagamentos</strong> mostra o histórico completo de uma conta (data, valor, forma, quem registrou) e permite <strong>excluir</strong> um pagamento lançado por engano — o valor volta sozinho pro saldo em aberto, e uma conta já "Pago" pode voltar a ficar parcial ou pendente se isso acontecer. Acesso a Financeiro já é restrito a quem tem a permissão, então essa correção não passa por mais burocracia — mas fica registrada no log de auditoria, com quem excluiu e o quê.</p>
      <div class="tip"><strong>Atenção:</strong> registrar um pagamento aqui não mexe automaticamente no caixa — são controles independentes nesta versão. Se o pagamento saiu/entrou em espécie da gaveta, registre a sangria ou suprimento correspondente na tela Caixa também.</div>
      <p class="text-muted" style="font-size:12.5px;">Uma conta só pode ser <strong>cancelada</strong> enquanto não tiver nenhum pagamento registrado contra ela — excluindo os pagamentos existentes, dá pra cancelar normalmente depois.</p>

      <h3>Relatórios</h3>
      <p>Exige a permissão "Acessar Relatórios" — é separada de "Acessar Financeiro", então um vendedor pode ter uma sem a outra. Em <strong>Relatórios</strong>, escolha um período (hoje, últimos 7/30 dias, personalizado ou desde o início) e veja: faturamento total, número de vendas, ticket médio, vendas por vendedor, vendas por categoria, e a <strong>curva ABC</strong> de produtos — os itens que mais geram receita (A), os intermediários (B) e os que menos vendem (C).</p>
      <p>A margem de lucro mostrada é uma <strong>estimativa</strong>: usa o preço de custo atual de cada produto, mesmo pra vendas antigas — se o custo mudou desde então, o valor exato daquela época pode ser um pouco diferente.</p>
      <p>Quer guardar ou enviar o relatório? Clique em <strong>${icon('printer', { size: 14 })} Exportar PDF</strong>, ao lado do seletor de período — abre o diálogo de impressão do navegador, já formatado pra folha (A4/Carta), com todas as tabelas do período escolhido. Escolha "Salvar como PDF" no próprio diálogo, ou uma impressora de verdade se preferir uma cópia em papel.</p>

      <h3>Programa de fidelidade</h3>
      <p>Fica desligado por padrão. Pra ativar, vá em <strong>Dados da loja → Políticas de venda → Fidelidade</strong> e defina quantos pontos o cliente ganha por real gasto. A partir daí, toda venda com cliente selecionado já soma pontos sozinha — não precisa de nenhuma ação extra na hora de vender.</p>
      <p>Pra usar os pontos, vá no <strong>extrato do cliente</strong> (tela Clientes) e clique em <strong>Resgatar pontos</strong>. Eles viram um crédito de troca, disponível como forma de pagamento na próxima venda — o mesmo mecanismo já usado pelas trocas (veja o tópico "Estorno e troca").</p>
    `,
  },
  {
    id: 'historico-log',
    icon: icon('chart', { size: 16 }),
    title: 'Histórico e log',
    html: `
      <h2>Histórico e log de auditoria</h2>
      <p class="help-subtitle">Onde conferir tudo que já aconteceu na loja.</p>

      <h3>Histórico de vendas (todo mundo vê)</h3>
      <p>Mostra todas as vendas já feitas, com data, hora, vendedor responsável, forma de pagamento e total. Dá pra filtrar por vendedor, por cliente (busca por nome) e por período, e clicar em "Ver itens" pra abrir o detalhe completo de qualquer venda (incluindo desconto aplicado e estornos, se houver).</p>
      <p>É esse histórico que garante o controle de "quem vendeu o quê e quando" — vendedores veem as vendas uns dos outros também, não só as próprias.</p>

      <h3>Log do sistema (exige a permissão "Acessar Log do sistema")</h3>
      <p>Registra <strong>toda ação relevante</strong>: login, logout, cadastro de empresa/usuário/produto, edições, vendas, estornos, abertura/fechamento de caixa (inclusive o backup automático gerado nesse momento), sangria, suprimento, retificação de caixa, pagamento financeiro (inclusive exclusão de pagamento) — sempre com quem fez, qual o perfil da pessoa, e a data/hora exata.</p>
      <p>Dá pra filtrar por perfil (administrador ou vendedor), por pessoa específica, por texto e por período — útil pra conferir rapidamente o que um vendedor específico andou fazendo num dia.</p>

      <h3>"Carregar mais" — diferente das outras listas</h3>
      <p>Histórico de vendas e Log do sistema não usam a paginação numerada ("Mostrar 10/25/50...") do resto do sistema (veja "Listas grandes" no tópico Primeiros passos) — em vez disso, carregam <strong>50 registros por vez</strong>, com um botão <strong>Carregar mais</strong> no final da lista quando ainda tem mais além do que já apareceu. É proposital: são as duas listas que só crescem com o tempo (uma linha por venda, uma por ação) e podem ficar bem grandes numa loja com anos de uso — carregar tudo de uma vez de propósito deixaria a tela lenta. Aplicar um filtro (vendedor, cliente, período, texto) sempre recomeça do primeiro lote de 50 que bater com aquele filtro.</p>

      <div class="tip"><strong>Por que não é liberado por padrão?</strong> O histórico de vendas já mostra pra todo mundo o que foi vendido e por quem. O log de auditoria é bem mais detalhado (inclui logins, edições, tentativas etc.) — fica restrito a quem tiver essa permissão marcada (admin sempre tem) pra funcionar como uma auditoria de confiança de verdade.</div>
    `,
  },
  {
    id: 'backup',
    icon: icon('save', { size: 16 }),
    title: 'Backup',
    html: `
      <h2>Backup e restauração</h2>
      <p class="help-subtitle">Como proteger os dados da loja contra perda — exige a permissão "Acessar Backup".</p>

      <p>Todos os dados do sistema (estoque, vendas, clientes, financeiro, usuários...) ficam salvos só no computador onde a extensão está instalada. Se esse computador quebrar, for formatado, ou o Chrome for reinstalado, esses dados <strong>não têm como ser recuperados</strong> a não ser que exista um backup feito antes.</p>

      <div class="tip"><strong>Também existe um backup automático:</strong> toda vez que o caixa é fechado, o sistema já gera e baixa sozinho um backup completo, sem precisar vir nesta tela — veja "Confirmação por senha e backup automático" no tópico Caixa. Isso não substitui fazer backup manual com regularidade (nem todo mundo fecha caixa todo dia), só é uma rede de segurança a mais.</div>

      <h3>Exportar backup</h3>
      <p>Na tela <strong>Backup</strong>, defina uma senha e clique em <strong>Gerar backup</strong>. O sistema baixa um arquivo com todos os dados da loja, protegido por essa senha — sem ela, o arquivo é ilegível pra qualquer pessoa, inclusive pra você. Guarde esse arquivo em outro lugar (pendrive, e-mail pra você mesmo, nuvem pessoal) e anote a senha num lugar seguro.</p>
      <div class="tip"><strong>Não existe "esqueci a senha" aqui.</strong> Como o sistema é 100% local (sem servidor nenhum por trás), ninguém — nem o desenvolvedor do sistema — consegue recuperar um backup se a senha for perdida. É o preço de ser realmente privado.</div>

      <h3>Restaurar backup</h3>
      <p>Selecione o arquivo de backup, digite a senha e clique em <strong>Ler backup</strong>. O sistema mostra uma prévia comparando os dados atuais com os do arquivo antes de mexer em qualquer coisa. Só depois de confirmar (duas vezes, de propósito) é que a restauração realmente acontece.</p>
      <div class="warn-box"><strong>Atenção:</strong> restaurar um backup <strong>apaga todos os dados atuais</strong> e substitui pelos dados do arquivo — não tem como desfazer.</div>
      <p>Depois de restaurar, o sistema desloga automaticamente — faça login de novo com um usuário que exista no backup restaurado.</p>

      <h3>Restaurar numa instalação nova</h3>
      <p>Numa extensão recém-instalada (sem loja cadastrada ainda), a primeira tela já pergunta: <strong>"Cadastrar do zero"</strong> ou <strong>"Já tenho um backup"</strong>. Escolhendo a segunda opção, você seleciona o arquivo e digita a senha ali mesmo — o sistema pula o cadastro inteiro (empresa e administrador não precisam ser digitados de novo, já vêm do backup) e vai direto pro login.</p>
      <p>Errar a senha nessa tela não bloqueia nada: mostra o erro e deixa tentar de novo quantas vezes precisar, e a opção "Cadastrar do zero" continua sempre disponível, clicando em "Voltar".</p>

      <h3>Zerar dados e reiniciar a operação</h3>
      <p>Feito pra depois de um período de teste ou de transição vindo de outro sistema de PDV: na tela <strong>Backup</strong>, a seção <strong>"Zerar dados e reiniciar a operação"</strong> apaga vendas, caixa, financeiro, fiado (o saldo de cada cliente volta a zero), carretos, compras, fidelidade e o log de auditoria — mas <strong>mantém intactos</strong> o estoque (produtos e a quantidade atual de cada um), os dados da loja, os usuários, os fornecedores e os clientes. Não precisa refazer nenhum cadastro pra começar a operar de verdade.</p>
      <p>Digite usuário e senha de qualquer conta ativa pra confirmar — a mesma senha protege um backup completo, gerado e baixado automaticamente <strong>antes</strong> de qualquer coisa ser apagada (é um pré-requisito: se o backup não sair, nada é zerado). Depois de zerar, use <strong>"Fazer inventário"</strong> na tela Estoque pra corrigir as quantidades com uma contagem física, se precisar, e comece a vender normalmente.</p>
      <div class="warn-box"><strong>Atenção:</strong> assim como restaurar um backup, zerar os dados <strong>não pode ser desfeito</strong> — o backup automático gerado antes é a única forma de voltar atrás, se precisar.</div>

      <h3>Backup é manual, de propósito</h3>
      <p>O sistema não faz backup sozinho, automaticamente, em segundo plano. Isso é intencional: rodar backup automático sem ninguém abrir o sistema exigiria pedir permissões novas ao Chrome (pra salvar arquivo e "acordar" a extensão em horário fixo) — e esse sistema é feito pra pedir o mínimo possível. Faça backup manualmente com a frequência que fizer sentido pra sua loja (ex: toda semana).</p>
    `,
  },
  {
    id: 'faq',
    icon: icon('question', { size: 16 }),
    title: 'Perguntas frequentes (F.A.Q)',
    html: `
      <h2>Perguntas frequentes (F.A.Q)</h2>
      <p class="help-subtitle">Todo aviso vermelho (ou amarelo) previsto no sistema, tela por tela — o que cada um significa e o que fazer.</p>
      <p>Tudo abaixo é o sistema travando algo de propósito, antes de gravar um dado errado — nunca aparece sozinho por acaso. Se algo <strong>diferente</strong> do que está listado aqui aparecer, aí sim vale anotar o texto exato e chamar o suporte (veja o tópico "Licença e ativação" pros contatos).</p>

      ${renderFaqAccordion()}
    `,
  },
];

/** Tira as tags HTML de um texto pra virar só o texto puro pesquisável —
 * usada só pra montar `searchText` (índice de busca) a partir do próprio
 * `html` de cada tópico/resposta, nunca pra exibir nada na tela. Como toda
 * entrada aqui é conteúdo estático desta própria tela (nunca dado de
 * usuário/banco), uma troca por regex simples já basta — não precisa de
 * um parser de verdade só pra isto. */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

/** Índice de busca da Ajuda — achado do usuário: com 15 tópicos e 34
 * perguntas de F.A.Q, navegar só pelo menu lateral demorava demais pra
 * achar algo específico. `searchText` cobre título/pergunta E o corpo da
 * resposta/tópico inteiro (sem tags) — uma palavra que só aparece dentro
 * do texto corrido (ex: "gaveta", que só existe na resposta sobre abertura
 * de caixa, não na pergunta em si) agora encontra o resultado do mesmo
 * jeito; `label` continua sendo só o título/pergunta, usado pra EXIBIR o
 * resultado (ver renderTopic/runSearch mais abaixo). O único tópico com
 * `html` como função (LGPD, precisa dos dados da loja pra render de
 * verdade) é indexado chamando a função com um objeto vazio — os campos
 * opcionais (`company?.nomeFantasia` etc.) já têm fallback, então isso não
 * quebra, só indexa o texto com os placeholders genéricos no lugar dos
 * dados reais da loja (irrelevante pra busca, ninguém pesquisa por
 * "[nome da loja]"). `faqIndex` é a posição (0-based, na ordem em que
 * renderFaqAccordion() gera os itens) usada pra abrir a pergunta certa
 * depois de trocar pro tópico F.A.Q — ver openFaqItem(). */
const SEARCH_INDEX = TOPICS.map((t) => {
  const bodyHtml = typeof t.html === 'function' ? t.html({}) : t.html;
  return { type: 'topic', topicId: t.id, label: t.title, searchText: `${t.title} ${stripHtml(bodyHtml)}`.toLowerCase() };
});
{
  let faqIndex = 0;
  for (const cat of FAQ_CATEGORIES) {
    for (const item of cat.items) {
      SEARCH_INDEX.push({
        type: 'faq', topicId: 'faq', category: cat.label, label: item.q, faqIndex,
        searchText: `${item.q} ${stripHtml(item.a)}`.toLowerCase(),
      });
      faqIndex++;
    }
  }
}

/** Deixa em negrito a parte do LABEL (título/pergunta) que bateu com
 * alguma das palavras digitadas — só a primeira que achar, pra não poluir
 * o resultado com negrito espalhado. Se nenhuma palavra da busca aparecer
 * no label (o que bateu foi só no corpo do texto, via `searchText`), o
 * resultado ainda aparece na lista, só sem destaque nenhum — não tem como
 * "grifar" um trecho que não está sendo exibido. `text` é sempre conteúdo
 * estático desta própria tela, nunca dado de usuário/banco, então não
 * passa por escapeHtml aqui — mesmo padrão já usado no resto do arquivo. */
function highlightMatch(text, words) {
  const lower = text.toLowerCase();
  for (const w of words) {
    const idx = lower.indexOf(w);
    if (idx !== -1) return `${text.slice(0, idx)}<strong>${text.slice(idx, idx + w.length)}</strong>${text.slice(idx + w.length)}`;
  }
  return text;
}

export async function renderAjuda(container, ctx) {
  let activeId = TOPICS[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Ajuda</h1>
        <div class="desc">Um guia rápido de como usar cada parte do sistema.</div>
      </div>
    </div>
    <div class="help-search-box">
      <span class="help-search-icon">${icon('search', { size: 16 })}</span>
      <input id="help-search-input" type="text" placeholder="Buscar na Ajuda... (ex: fiado, caixa, backup)" autocomplete="off">
      <div id="help-search-results" class="help-search-results" hidden></div>
    </div>
    <div class="help-layout">
      <nav class="help-topics" id="help-topics"></nav>
      <div class="card help-content" id="help-content"></div>
    </div>
  `;

  const topicsNav = document.getElementById('help-topics');
  const contentBox = document.getElementById('help-content');
  const searchInput = document.getElementById('help-search-input');
  const searchResults = document.getElementById('help-search-results');

  topicsNav.innerHTML = TOPICS.map((t, idx) => `
    <button class="help-topic-btn" data-topic="${t.id}">
      <span class="help-topic-icon">${t.icon}</span>
      <span>${idx + 1}. ${escapeHtml(t.title)}</span>
    </button>
  `).join('');

  function renderTopic(id) {
    activeId = id;
    const topic = TOPICS.find((t) => t.id === id);
    // Só o tópico de LGPD tem `html` como função (precisa dos dados da
    // loja pra preencher o aviso de privacidade) — os demais são string
    // fixa, ver comentário junto do tópico 'lgpd' acima.
    contentBox.innerHTML = typeof topic.html === 'function' ? topic.html(ctx.company) : topic.html;
    // Só o tópico F.A.Q tem os botões de acordeão — a busca por
    // '.faq-question' não encontra nada (e não faz nada) nos outros 14.
    wireFaqAccordion(contentBox);
    topicsNav.querySelectorAll('.help-topic-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.topic === id);
    });
    // Volta pro topo ao trocar de tópico — sem isso, quem estava lendo o
    // fim de um tópico longo e clica noutro (às vezes bem mais curto)
    // ficava na mesma posição de rolagem de antes, longe do título novo.
    window.scrollTo(0, 0);
  }

  // Abre a pergunta `faqIndex` do F.A.Q já com o tópico renderizado —
  // reaproveita o mesmo click que wireFaqAccordion já escuta em vez de
  // duplicar a lógica de abrir/fechar (só clica de verdade no botão).
  function openFaqItem(faqIndex) {
    const item = contentBox.querySelectorAll('.faq-item')[faqIndex];
    if (!item) return;
    item.querySelector('.faq-question').click();
    item.scrollIntoView({ block: 'center' });
  }

  topicsNav.querySelectorAll('.help-topic-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderTopic(btn.dataset.topic));
  });

  // Busca: acha por título de tópico ou pergunta do F.A.Q (ver SEARCH_INDEX
  // acima) — nunca no texto corrido das respostas, de propósito. Clicar
  // num resultado de tópico só troca de tópico; um de F.A.Q troca pro
  // tópico F.A.Q E já abre a pergunta certa, sem o vendedor precisar catar
  // ela na lista de 33 depois.
  function closeSearchResults() {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
  }

  function runSearch() {
    const query = searchInput.value.trim();
    if (!query) { closeSearchResults(); return; }
    // Achado do usuário: buscar pela FRASE inteira como um substring só
    // (comportamento de antes) não achava nada se a palavra digitada
    // estivesse só dentro do corpo da resposta (ex: buscar "gaveta" não
    // achava a pergunta sobre abertura de caixa, porque "gaveta" só
    // aparece na resposta). Agora cada PALAVRA digitada é conferida
    // separado contra searchText (título+corpo inteiro) — resultado bate
    // se TODAS as palavras aparecerem em algum lugar do texto, não
    // precisando estar juntas nem na mesma ordem.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = SEARCH_INDEX.filter((entry) => words.every((w) => entry.searchText.includes(w)));
    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="help-search-empty">Nenhum resultado encontrado.</div>';
      searchResults.hidden = false;
      return;
    }
    const topicMatches = matches.filter((m) => m.type === 'topic');
    const faqMatches = matches.filter((m) => m.type === 'faq');
    searchResults.innerHTML = `
      ${topicMatches.length > 0 ? `
        <div class="help-search-group-label">Tópicos</div>
        ${topicMatches.map((m) => `<button type="button" class="help-search-result" data-topic="${m.topicId}">${highlightMatch(m.label, words)}</button>`).join('')}
      ` : ''}
      ${faqMatches.length > 0 ? `
        <div class="help-search-group-label">Perguntas frequentes</div>
        ${faqMatches.map((m) => `<button type="button" class="help-search-result" data-faq-index="${m.faqIndex}">${highlightMatch(m.label, words)}</button>`).join('')}
      ` : ''}
    `;
    searchResults.hidden = false;
  }

  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) runSearch(); });
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { searchInput.blur(); closeSearchResults(); }
  });
  searchResults.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.help-search-result');
    if (!btn) return;
    if (btn.dataset.topic) {
      renderTopic(btn.dataset.topic);
    } else if (btn.dataset.faqIndex !== undefined) {
      renderTopic('faq');
      openFaqItem(Number(btn.dataset.faqIndex));
    }
    searchInput.value = '';
    closeSearchResults();
  });
  // Clicar fora fecha o dropdown sem mexer no texto digitado — quem
  // clicou fora não necessariamente quer apagar a busca, só ver a tela.
  // Fica em `document` (não em `container`) pra fechar mesmo clicando no
  // menu lateral do app inteiro — por isso precisa do cleanup no final
  // desta função: sem isso, cada visita a "Ajuda" empilharia mais um
  // listener igual (o router só limpa o que a própria view devolver).
  const closeOnOutsideClick = (ev) => {
    if (!ev.target.closest('.help-search-box')) closeSearchResults();
  };
  document.addEventListener('click', closeOnOutsideClick);

  renderTopic(activeId);

  return () => {
    document.removeEventListener('click', closeOnOutsideClick);
  };
}
