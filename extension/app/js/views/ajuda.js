// Ajuda — explica o sistema inteiro em linguagem simples, separado em 7
// tópicos. Disponível pra admin e vendedor: cada um entende não só o que
// pode fazer, mas por que algumas coisas ficam bloqueadas pro seu perfil.
import { escapeHtml } from '../utils/format.js';

const TOPICS = [
  {
    id: 'primeiros-passos',
    icon: '🏁',
    title: 'Primeiros passos',
    html: `
      <h2>Primeiros passos</h2>
      <p class="help-subtitle">Como o sistema começa a funcionar e como você entra todo dia.</p>

      <h3>Cadastro da loja</h3>
      <p>Na primeiríssima vez que o sistema abre, ele pede os dados da empresa (CNPJ, endereço, telefone etc.). Isso só acontece <strong>uma única vez</strong> — depois disso, o sistema nunca mais pede de novo.</p>

      <h3>O Administrador Geral</h3>
      <p>Logo depois de cadastrar a loja, o sistema pede pra cadastrar o primeiro usuário — e esse primeiro usuário é <strong>sempre</strong> o Administrador Geral. Ele é quem tem acesso a tudo: cadastro de produtos, usuários, caixa, log de auditoria, configurações. Só existe um administrador geral na loja.</p>

      <h3>Entrando todo dia (Login)</h3>
      <p>Depois desse cadastro inicial, o sistema sempre abre numa tela de <strong>login</strong>. Cada pessoa que trabalha na loja — administrador ou vendedor — tem seu próprio usuário e senha. Ninguém compartilha login: é assim que o sistema sabe exatamente quem fez cada venda, cada estorno, cada mudança de estoque.</p>

      <div class="tip"><strong>Dica:</strong> a sessão não fica salva pra sempre — se você fechar o navegador, na próxima vez vai pedir login de novo. Isso é proposital, pra loja não ficar logada sem querer com o computador ligado o dia todo.</div>

      <h3>Vendedores</h3>
      <p>Todo usuário cadastrado <em>depois</em> do administrador nasce como <strong>vendedor</strong> — um perfil com menos permissões (veja o tópico 6, "Usuários e permissões", pra entender a diferença completa).</p>
    `,
  },
  {
    id: 'estoque',
    icon: '📦',
    title: 'Estoque',
    html: `
      <h2>Estoque</h2>
      <p class="help-subtitle">Cadastrar produtos, código de barras e controlar quantidade.</p>

      <h3>Cadastrar um produto novo (só administrador)</h3>
      <p>Na tela <strong>Estoque</strong>, clique em <strong>+ Novo produto</strong>. Preencha nome, categoria (material de construção ou mercearia), unidade (un, kg, saco...), código de barras, preço de venda, preço de custo e a quantidade inicial.</p>

      <h3>Código de barras</h3>
      <p>Se você tem um leitor de código de barras USB, é só deixar o campo focado e passar o produto — ele "digita" o código sozinho, não precisa de nenhuma configuração.</p>
      <p>Produto sem código de fábrica (item a granel, por exemplo)? Clique em <strong>Gerar código interno</strong> — o sistema cria um código só dele, que também pode ser escaneado se você imprimir uma etiqueta.</p>

      <h3>Editar, ajustar e inativar (só administrador)</h3>
      <ul>
        <li><strong>Editar</strong> — muda nome, preço, categoria, código de barras etc.</li>
        <li><strong>Ajustar</strong> — usa quando chegou mercadoria nova (entrada) ou quando perdeu/quebrou algo (saída), sem ser uma venda.</li>
        <li><strong>Inativar</strong> — o produto some das vendas, mas o histórico dele continua guardado (melhor que excluir, se ele já teve movimentação).</li>
        <li><strong>Excluir</strong> — remove o produto do catálogo de vez.</li>
      </ul>

      <h3>Histórico do produto (todo mundo pode ver)</h3>
      <p>Todo produto tem um botão <strong>Histórico</strong> — mostra toda entrada, saída, venda, ajuste e estorno que já mexeu na quantidade dele, com data, hora e quem fez.</p>

      <h3>Estoque baixo</h3>
      <p>Cada produto tem um "estoque mínimo" configurável. Quando a quantidade cai igual ou abaixo desse número, ele ganha um selo vermelho de <strong>Estoque baixo</strong> — tanto na lista de produtos quanto no Painel inicial.</p>
    `,
  },
  {
    id: 'vendas',
    icon: '🧾',
    title: 'Vendas (PDV)',
    html: `
      <h2>Vendas (PDV)</h2>
      <p class="help-subtitle">Como registrar uma venda, do escaneamento até o pagamento.</p>

      <h3>Adicionar produtos ao carrinho</h3>
      <p>Na tela <strong>Nova venda</strong>, o campo de busca já fica pronto pra usar. Escaneie o código de barras, ou digite o nome do produto e clique em "Adicionar" na lista que aparece.</p>
      <p>Escaneou o mesmo produto de novo? A quantidade dele no carrinho aumenta sozinha, em vez de criar uma linha nova.</p>

      <h3>Desconto</h3>
      <p>Cada linha do carrinho tem um botão <strong>% desconto</strong> — dá pra descontar em percentual ou em valor fixo (reais), só naquele item. Também existe um <strong>desconto geral</strong>, logo abaixo da lista, que se aplica sobre o total inteiro da venda.</p>
      <div class="warn-box"><strong>Atenção, vendedores:</strong> existe um limite de desconto que dá pra aplicar sozinho (configurado pelo administrador). Passou do limite? Aparece uma tela pedindo pra um administrador digitar a própria senha ali mesmo, autorizando o desconto — sem precisar trocar de login.</div>

      <h3>Pagamento</h3>
      <p>Clique em <strong>+ Forma de pagamento</strong> quantas vezes precisar — dá pra dividir a mesma venda entre dinheiro, cartão de débito, cartão de crédito e Pix, por exemplo metade em dinheiro e metade no cartão. O botão de finalizar só libera quando a soma dos pagamentos bate exatamente com o total.</p>

      <h3>Crédito de troca</h3>
      <p>Se o cliente tiver um crédito de troca disponível (veja o tópico 4), ele aparece como um aviso verde no topo da tela de venda, com um botão pra usar como parte do pagamento.</p>
    `,
  },
  {
    id: 'estorno-troca',
    icon: '↩️',
    title: 'Estorno e troca',
    html: `
      <h2>Estorno e troca</h2>
      <p class="help-subtitle">O que fazer quando o cliente devolve um produto (só administrador).</p>

      <h3>Como estornar</h3>
      <p>Vá em <strong>Histórico de vendas</strong>, clique em "Ver itens" na venda em questão, e depois em <strong>Estornar itens</strong>. Escolha a quantidade de cada item que está sendo devolvida e escreva o motivo (obrigatório) — pode ser um item só ou a venda inteira.</p>
      <p>O estorno devolve a quantidade pro estoque automaticamente e fica registrado no histórico daquele produto e no log de auditoria.</p>

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
    icon: '💰',
    title: 'Caixa',
    html: `
      <h2>Caixa</h2>
      <p class="help-subtitle">Abrir, sangria/suprimento e fechar o caixa com conferência.</p>

      <h3>Abrir o caixa</h3>
      <p>No início do turno, vá em <strong>Caixa</strong> e informe o troco inicial (o dinheiro que já está na gaveta antes de começar a vender). O sistema é de <strong>um caixa só pra loja toda</strong> — não é um caixa por vendedor.</p>

      <h3>Sangria e suprimento</h3>
      <ul>
        <li><strong>Sangria</strong> — retirar dinheiro do caixa durante o turno (ex: levar pro banco). Precisa de motivo.</li>
        <li><strong>Suprimento</strong> — colocar dinheiro a mais no caixa (ex: reforçar o troco). Também precisa de motivo.</li>
      </ul>
      <p>Enquanto o caixa está aberto, a tela mostra o quanto <em>deveria</em> ter em cada forma de pagamento, atualizado a cada venda.</p>

      <h3>Fechar o caixa</h3>
      <p>No fim do turno, clique em <strong>Fechar caixa</strong>. Conte o dinheiro físico da gaveta e digite o valor — os outros métodos (cartão, Pix) são só conferência, não precisam de contagem física. O sistema mostra se <strong>bateu certinho</strong>, <strong>sobrou</strong> ou <strong>faltou</strong> dinheiro.</p>
      <div class="tip"><strong>Dica:</strong> depois de fechado, o caixa não pode ser reaberto — se precisar continuar vendendo, é só abrir um novo.</div>

      <h3>Caixa obrigatório (opcional, configurável)</h3>
      <p>O administrador pode ligar, em <strong>Dados da loja → Políticas de venda</strong>, a opção "Exigir caixa aberto para registrar vendas". Ligada essa opção, ninguém consegue finalizar uma venda sem abrir o caixa primeiro.</p>
    `,
  },
  {
    id: 'usuarios',
    icon: '👥',
    title: 'Usuários e permissões',
    html: `
      <h2>Usuários e permissões</h2>
      <p class="help-subtitle">A diferença entre Administrador e Vendedor.</p>

      <h3>Administrador Geral</h3>
      <p>É único na loja (o primeiro usuário cadastrado). Tem acesso a absolutamente tudo: estoque, vendas, caixa, cadastro de outros usuários, dados da loja e o log de auditoria completo.</p>

      <h3>Vendedor</h3>
      <p>Cadastrado pelo administrador, em <strong>Usuários → + Novo vendedor</strong>. Um vendedor consegue:</p>
      <ul>
        <li>Ver o estoque geral (mas não cadastrar, editar ou ajustar produto)</li>
        <li>Registrar vendas e ver o histórico de vendas de todo mundo</li>
        <li>Abrir/fechar caixa e fazer sangria/suprimento</li>
      </ul>
      <p>E <strong>não</strong> consegue:</p>
      <ul>
        <li>Cadastrar ou editar produto, nem ajustar estoque manualmente</li>
        <li>Estornar uma venda</li>
        <li>Cadastrar ou gerenciar outros usuários</li>
        <li>Ver o log de auditoria ou mudar os dados/políticas da loja</li>
      </ul>

      <h3>Gerenciando vendedores</h3>
      <p>Na tela <strong>Usuários</strong>, o administrador pode desativar um vendedor (ele para de conseguir logar, mas as vendas dele continuam no histórico) e redefinir a senha de qualquer um, sem precisar saber a senha antiga.</p>
    `,
  },
  {
    id: 'historico-log',
    icon: '📊',
    title: 'Histórico e log',
    html: `
      <h2>Histórico e log de auditoria</h2>
      <p class="help-subtitle">Onde conferir tudo que já aconteceu na loja.</p>

      <h3>Histórico de vendas (todo mundo vê)</h3>
      <p>Mostra todas as vendas já feitas, com data, hora, vendedor responsável, forma de pagamento e total. Dá pra filtrar por vendedor e por período, e clicar em "Ver itens" pra abrir o detalhe completo de qualquer venda (incluindo desconto aplicado e estornos, se houver).</p>
      <p>É esse histórico que garante o controle de "quem vendeu o quê e quando" — vendedores veem as vendas uns dos outros também, não só as próprias.</p>

      <h3>Log do sistema (só administrador)</h3>
      <p>Registra <strong>toda ação relevante</strong>: login, logout, cadastro de empresa/usuário/produto, edições, vendas, estornos, abertura/fechamento de caixa, sangria, suprimento — sempre com quem fez, qual o perfil da pessoa, e a data/hora exata.</p>
      <p>Dá pra filtrar por perfil (administrador ou vendedor), por pessoa específica, por texto e por período — útil pra conferir rapidamente o que um vendedor específico andou fazendo num dia.</p>

      <div class="tip"><strong>Por que só o admin vê o log?</strong> O histórico de vendas já mostra pra todo mundo o que foi vendido e por quem. O log de auditoria é mais detalhado (inclui logins, edições, tentativas etc.) — fica restrito ao administrador pra funcionar como uma auditoria de confiança de verdade.</div>
    `,
  },
];

export async function renderAjuda(container, ctx) {
  let activeId = TOPICS[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Ajuda</h1>
        <div class="desc">Um guia rápido de como usar cada parte do sistema.</div>
      </div>
    </div>
    <div class="help-layout">
      <nav class="help-topics" id="help-topics"></nav>
      <div class="card help-content" id="help-content"></div>
    </div>
  `;

  const topicsNav = document.getElementById('help-topics');
  const contentBox = document.getElementById('help-content');

  topicsNav.innerHTML = TOPICS.map((t, idx) => `
    <button class="help-topic-btn" data-topic="${t.id}">
      <span class="help-topic-icon">${t.icon}</span>
      <span>${idx + 1}. ${escapeHtml(t.title)}</span>
    </button>
  `).join('');

  function renderTopic(id) {
    activeId = id;
    const topic = TOPICS.find((t) => t.id === id);
    contentBox.innerHTML = topic.html;
    topicsNav.querySelectorAll('.help-topic-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.topic === id);
    });
  }

  topicsNav.querySelectorAll('.help-topic-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderTopic(btn.dataset.topic));
  });

  renderTopic(activeId);
}
