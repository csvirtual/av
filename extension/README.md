# Gestão de Loja — Estoque & Vendas (extensão do Chrome)

Extensão para Google Chrome que controla **estoque, vendas, caixa, clientes,
fornecedores e financeiro** de uma loja de material de construção + mercearia.
Roda **100% local**: todos os dados ficam salvos no IndexedDB do próprio
navegador, nada é enviado para nenhum servidor.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** ("Load unpacked").
4. Selecione a pasta `extension/` deste repositório.
5. Clique no ícone da extensão na barra do Chrome — o sistema abre em uma
   nova aba, em tela cheia.

Não é necessário build, npm install, nem nenhuma ferramenta extra — é
JavaScript puro (ES modules), HTML e CSS.

## Primeiro uso

Na primeira vez que o sistema abrir, a tela de boas-vindas já deixa escolher
a **aparência** (claro/escuro/automático — pode trocar quando quiser depois,
em Personalização) e pergunta: **cadastrar do zero** ou **restaurar de um
backup**?

Cadastrando do zero, pede:

1. **Dados da loja** — CNPJ (com validação de dígitos verificadores),
   razão social, nome fantasia, endereço completo, telefone, e-mail,
   inscrições, ramo de atuação e horário de funcionamento.
2. **Cadastro do Administrador Geral** — o primeiro usuário do sistema.
   Esse cadastro é obrigatório e só acontece uma vez. Todos os usuários
   cadastrados depois disso (pela tela **Usuários**, só acessível ao admin)
   nascem como **vendedores**.

Escolhendo restaurar, basta selecionar o arquivo de backup e digitar a
senha — o cadastro inteiro é pulado, os dados vêm todos do arquivo.

Depois disso, o sistema sempre abre na tela de **login**.

Um menu de **Ajuda** (disponível para os dois perfis) explica cada parte do
sistema em linguagem simples, separado em tópicos. **No primeiríssimo login
de cada usuário** (o Administrador Geral recém-cadastrado, ou qualquer
vendedor cadastrado depois), o sistema já abre direto nessa tela de Ajuda em
vez do Painel, pra ele aprender a usar o sistema antes de mais nada — só
acontece uma vez na vida de cada conta; da segunda vez em diante, o login
cai no Painel normalmente.

## Funcionalidades

- **Estoque** — cadastro de produtos com código de barras (leitor USB ou
  código interno gerado pelo sistema), ajuste manual de entrada/saída,
  histórico completo de movimentação por produto, alerta de estoque baixo e
  inventário/balanço em lote.
- **Vendas (PDV)** — carrinho por código de barras ou busca por nome,
  desconto por item e geral (com teto configurável por vendedor + aprovação
  de administrador acima do limite), pagamento misto (mais de uma forma na
  mesma venda, incluindo fiado e crédito de troca), com parcelamento (1x a
  12x) pra pagamento em cartão de crédito. O carrinho não se perde ao trocar
  de tela (só some ao finalizar a venda, deslogar, ou pelo botão **Limpar
  carrinho**, que pede confirmação antes).
- **Juro no parcelamento do cartão (opcional)** — configurável em Dados da
  loja → Políticas de venda, exclusivo do Administrador Geral: até quantas
  parcelas ficam isentas de juro (1x sempre é isento, não importa a
  configuração) e a taxa acima disso, em % ao mês (multiplica pelas
  parcelas) ou % fixo (igual não importa a quantidade). O vendedor nunca
  digita nem edita essa taxa — ela é calculada sozinha ao escolher Cartão
  de crédito e o número de parcelas, aparece na tela de venda, no recibo e
  no histórico, e conta como faturamento normal nos relatórios. É o juro
  que a própria loja decide repassar — diferente do juro que o banco
  emissor do cartão do cliente pode aplicar por conta própria, que o
  sistema não tem como saber (isso só a maquininha mostra, na hora).
- **Impressão de recibo** — ao finalizar a venda, um aviso oferece imprimir
  o recibo na hora (ou reimprimir depois, pelo Histórico de vendas). Usa o
  diálogo de impressão do próprio navegador, então funciona com qualquer
  impressora já instalada (térmica de cupom 58/80mm, comum A4/Carta, ou
  "Salvar como PDF") sem nenhuma configuração extra — o layout se adapta
  automaticamente ao tamanho do papel escolhido. É um comprovante de venda,
  não um documento fiscal (o sistema não emite NFe/NFC-e).
- **Estorno e troca** — estorno total ou parcial de uma venda já fechada,
  com devolução automática ao estoque e opção de gerar crédito de troca
  (usável como forma de pagamento na próxima venda) em vez de dinheiro.
- **Caixa** — um caixa único para a loja toda: abertura com troco inicial,
  sangria/suprimento (sempre com motivo obrigatório) e fechamento com
  conferência por forma de pagamento. Pode ser configurado como obrigatório
  para registrar vendas.
- **Clientes e fiado** — cadastro de clientes, venda fiada com limite de
  crédito opcional, extrato completo de dívidas e pagamentos recebidos.
- **Carreto (entregas)** — registro organizado do que vai em cada entrega
  pro cliente (comum em loja de material de construção), com itens vindos
  do estoque ou avulsos (descrição livre, ex: "carga de areia"), endereço,
  responsável e status (pendente/entregue/cancelado). É só um checklist de
  logística — não mexe em estoque nem em dinheiro; a baixa de estoque
  continua acontecendo normalmente na tela de Venda. Além da tela própria,
  dá pra gerar direto da Nova venda com o botão **Finalizar venda +
  carreto**, que registra a venda e cadastra o carreto na sequência só com
  os itens marcados numa lista (todos marcados por padrão).
- **Fornecedores e compras** — cadastro de fornecedores, pedidos de compra
  com recebimento total ou parcial (atualiza estoque e preço de custo) e
  sugestão automática de compra para produtos com estoque baixo.
- **Financeiro** — contas a pagar e a receber, com vencimento automático e
  baixa de pagamento.
- **Relatórios** — faturamento, ticket médio, vendas por vendedor e por
  categoria, margem de lucro estimada e curva ABC de produtos, por período.
  Dá pra exportar em PDF (botão **Exportar PDF**, ao lado do seletor de
  período) — mesmo diálogo de impressão do navegador usado no recibo,
  formatado pra folha A4/Carta.
- **Fidelidade** — programa opcional de pontos por real gasto, resgatável
  como crédito de troca.
- **Log de auditoria** — toda ação relevante do sistema (login, cadastros,
  edições, vendas, estornos, movimentos de caixa etc.) fica registrada com
  usuário, perfil e data/hora — exclusivo do Administrador Geral.
- **Personalização** — aparência claro/escuro, independente do sistema
  operacional (menu **Personalização**, disponível pros dois perfis). A
  escolha inicial já é feita na própria tela de boas-vindas da configuração
  inicial, antes até de decidir entre cadastrar do zero ou restaurar backup
  — pode ser trocada a qualquer momento depois.
- **Backup** — exportação e restauração de todos os dados do sistema num
  arquivo único protegido por senha (AES-256-GCM, chave derivada via
  PBKDF2), pra guardar em outro lugar e restaurar depois — inclusive numa
  instalação nova, em outro computador. Exportar é exclusivo do
  Administrador Geral; restaurar também pode ser feito direto na primeira
  tela do sistema (antes até de cadastrar a empresa), sem limite de
  tentativas de senha e sem nunca bloquear a opção de cadastrar do zero.
  É manual por decisão de projeto: automatizar isso em segundo plano exigiria
  pedir permissões novas ao Chrome (`downloads`/`alarms`), o que vai contra
  o princípio de pedir o mínimo possível — quem decide quando fazer backup
  é o lojista.

## Perfis de acesso

| Recurso | Administrador | Vendedor |
|---|---|---|
| Painel, estoque, histórico de vendas | ✅ | ✅ |
| Registrar venda, aplicar desconto até o limite configurado | ✅ | ✅ |
| Abrir/fechar caixa, sangria/suprimento | ✅ | ✅ |
| Cadastrar cliente, vender fiado, receber pagamento de fiado | ✅ | ✅ |
| Estornar venda (total ou por item) | ✅ | ✅ |
| Carreto: cadastrar, marcar entregue, cancelar | ✅ | ✅ |
| Cadastrar/editar produto, ajustar estoque, inventário | ✅ | ❌ |
| Fornecedores e pedidos de compra | ✅ | ❌ |
| Financeiro (contas a pagar/receber) e relatórios gerenciais | ✅ | ❌ |
| Cadastrar/gerenciar usuários | ✅ | ❌ |
| Editar dados da loja e políticas de venda | ✅ | ❌ |
| Log do sistema (ações de todos, por perfil) | ✅ | ❌ |

Todo vendedor vê o estoque geral e **quem vendeu o quê e quando** (histórico
de vendas), mas o **log de auditoria** detalhado (login/logout, cadastros,
edições, exclusões — com timestamp e usuário) é exclusivo do administrador.

## Código de barras

O sistema é compatível com **qualquer leitor de código de barras** (USB ou
Bluetooth) configurado em modo teclado/HID — é assim que a grande maioria
dos leitores de mercado e loja de material vem de fábrica: ele "digita" o
código e aperta Enter sozinho, sem driver nem configuração nenhuma. Se o seu
leitor tiver um modo "porta serial/COM" em vez de "teclado/HID", troque —
é o único requisito.

- Na tela **Nova venda**, o campo de escaneamento já fica focado — é só
  passar o produto no leitor. Mesmo que o foco esteja em outro campo no
  momento (aconteceu de clicar em outro lugar da tela), o sistema reconhece
  o scan do mesmo jeito, como reforço.
- Na tela **Estoque**, ao cadastrar um produto, também dá pra escanear o
  código de barras direto no campo correspondente.
- Produtos sem código de fábrica (itens a granel, sem embalagem padrão)
  podem receber um **código interno gerado automaticamente** pelo sistema
  (botão "Gerar código interno" no cadastro do produto).
- Em qualquer tela de busca, também é possível digitar o **nome do produto**
  em vez do código.

## Dados e privacidade

- Tudo é armazenado localmente via **IndexedDB**, no perfil do Chrome onde a
  extensão foi instalada.
- Senhas nunca são gravadas em texto puro — usam **PBKDF2** (Web Crypto API,
  150.000 iterações) com salt único por usuário.
- **Bloqueio contra força bruta na tela de login** — depois de 2 tentativas
  de senha incorretas seguidas para o mesmo usuário, o campo de senha fica
  bloqueado por 60 segundos (com contagem regressiva na tela) antes de
  liberar de novo.
- A sessão do usuário logado usa `chrome.storage.session` (efêmero — some ao
  fechar o navegador), então cada início de expediente pede login de novo.
- **Sessão expira sozinha depois de 30 minutos sem uso** — sem nenhum
  clique, tecla ou movimento de mouse nesse tempo, o sistema desloga
  automaticamente e volta pro login, avisando o motivo. Se houver mais de
  uma aba aberta, mexer em qualquer uma delas conta como uso — só expira
  de verdade quando NENHUMA aba tiver atividade recente.
- Não há nenhuma permissão de rede, câmera ou acesso a outras abas — a única
  permissão usada é `storage`.
- **Sem backup, os dados não sobrevivem à perda do computador/perfil do
  Chrome.** Use a tela **Backup** (Administrador Geral) regularmente —
  veja a seção "Funcionalidades" acima.
- **LGPD** — o sistema guarda dado pessoal de clientes (nome, telefone,
  endereço, histórico de fiado), então a Lei Geral de Proteção de Dados se
  aplica, mesmo com tudo local. Quem é o responsável legal por esses dados
  é a **loja** (o sistema é só a ferramenta), não quem desenvolveu o
  software. A tela **Ajuda → "Privacidade e LGPD"** explica isso em
  detalhe e já vem com um aviso de privacidade pronto pra imprimir/entregar
  ao cliente, preenchido automaticamente com o nome da loja e (se
  cadastrado em **Dados da loja**) o nome e contato do encarregado.

## Confiabilidade e integridade dos dados

Pensado pra ser usado como caixa/PDV principal numa loja de verdade, com
gente clicando rápido e mais de uma aba/tela aberta às vezes:

- **Proteção contra clique duplo** — todo botão de confirmar (finalizar
  venda, cadastrar, estornar, registrar pagamento etc.) desabilita assim
  que é clicado e só volta a ficar disponível depois da operação terminar
  — clicar de novo por impaciência ou nervosismo na correria do balcão não
  duplica a ação.
- **Sem "corrida" entre ações concorrentes** — estornar uma venda, receber
  um pedido de compra, registrar pagamento de fiado, abrir o caixa e
  editar cadastros (produto, cliente, fornecedor, usuário) sempre leem e
  gravam o estado mais atual dentro de uma única operação no banco — duas
  tentativas quase simultâneas sobre o mesmo registro (duplo clique restante
  ou duas abas) nunca resultam em dado duplicado ou perdido; a segunda
  tentativa é recusada com um aviso claro, não falha em silêncio.
- **Só uma aba opera por vez** — abrir o sistema numa segunda aba (ou
  duplicar a que já está aberta) mostra um aviso e bloqueia essa segunda
  aba de verdade, sem menu nem nenhum jeito de mexer no sistema por ali —
  evita duas telas mexendo na mesma loja ao mesmo tempo sem ninguém
  perceber. Fechou a aba errada, ou decidiu continuar na nova? A outra
  libera sozinha em poucos segundos, sem precisar recarregar nada.
- **Sessão sincronizada** — deslogar (ou ser desativado por um
  administrador) reflete automaticamente em qualquer aba que existir,
  sem precisar recarregar a página.
- **Uma venda com carreto associado nunca fica "pela metade"** — se o
  carreto falhar por algum motivo depois da venda já ter sido registrada,
  a venda continua valendo (o cliente já pagou e o estoque já baixou) e o
  sistema avisa claramente que só o carreto precisa ser cadastrado de
  novo, na tela própria.
- **Venda com fiado ou fidelidade nunca fica "pela metade"** — a baixa de
  estoque, a gravação da venda, a dívida de fiado (se houver) e o ganho de
  pontos de fidelidade (se houver) acontecem todos dentro de uma única
  transação atômica do banco: ou a venda inteira existe, com tudo isso
  junto, ou nada dela existe — nunca uma venda "paga em Fiado" sem a
  dívida correspondente lançada no extrato do cliente.
- **Movimentação de estoque nunca fica sem explicação** — toda mudança na
  quantidade de um produto (venda, ajuste manual, entrada de compra,
  crédito de estorno) grava a nova quantidade E o registro no histórico de
  movimentações na mesma transação — nunca um estoque que mudou sem
  nenhuma movimentação que explique por quê.
- **O Administrador Geral nunca fica sem admin nenhum** — não é possível
  desativar o único administrador ativo do sistema (a tela nem mostra essa
  opção pra ele, e a função por trás também recusa) — evita um beco sem
  saída onde ninguém mais consegue reativar usuários nem restaurar um
  backup (as duas coisas exigem um admin ativo logado).
- **Crédito de troca aplicado numa venda que falha não se perde** — usar
  um crédito de troca como pagamento deduz o saldo pendente na hora; se a
  venda falhar por qualquer motivo depois disso, o valor volta sozinho pro
  saldo pendente do cliente, sem precisar de nenhuma ação manual.
- **Extensão atualizada sozinha em segundo plano não passa em branco** —
  se o Chrome atualizar a extensão enquanto uma aba do sistema continua
  aberta (comum numa aba de PDV que fica ligada o turno inteiro), aparece
  um aviso claro pedindo pra recarregar a aba, em vez de a aba continuar
  tentando funcionar com erros genéricos e sem explicação.

## Estrutura de pastas

```
extension/
  manifest.json         Manifesto da extensão (Manifest V3)
  background.js         Service worker: abre/foca a aba do app ao clicar no ícone
  icons/                 Ícones da extensão
  app/
    index.html           Página principal do sistema (abre em nova aba)
    css/styles.css        Estilos
    js/
      app.js               Roteamento e shell do app pós-login
      db.js                Acesso baixo nível ao IndexedDB
      auth.js              Hash de senha (PBKDF2)
      backupCrypto.js      Criptografia (AES-GCM + PBKDF2) do arquivo de backup
      session.js           Sessão do usuário logado e crédito de troca pendente
      data/                Repositórios: empresa, usuários, produtos, vendas,
                            estoque, auditoria, caixa, clientes/fiado,
                            fornecedores, compras, financeiro, fidelidade,
                            relatórios, backup, carretos (deliveriesRepo.js)
      utils/               CNPJ, formatação, leitura de código de barras, cálculo
                            de desconto/totais
      views/               Telas: setup, login, painel, estoque, venda,
                            histórico de vendas, caixa, clientes, carreto,
                            compras, financeiro, relatórios, usuários, log,
                            dados da loja, backup, personalização, ajuda
      components/          Modal, toast, recibo de venda (impressão)
```
