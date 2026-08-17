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

Na primeira vez que o sistema abrir, ele pede:

1. **Dados da loja** — CNPJ (com validação de dígitos verificadores),
   razão social, nome fantasia, endereço completo, telefone, e-mail,
   inscrições, ramo de atuação e horário de funcionamento.
2. **Cadastro do Administrador Geral** — o primeiro usuário do sistema.
   Esse cadastro é obrigatório e só acontece uma vez. Todos os usuários
   cadastrados depois disso (pela tela **Usuários**, só acessível ao admin)
   nascem como **vendedores**.

Depois disso, o sistema sempre abre na tela de **login**.

Um menu de **Ajuda** (disponível para os dois perfis) explica cada parte do
sistema em linguagem simples, separado em tópicos.

## Funcionalidades

- **Estoque** — cadastro de produtos com código de barras (leitor USB ou
  código interno gerado pelo sistema), ajuste manual de entrada/saída,
  histórico completo de movimentação por produto, alerta de estoque baixo e
  inventário/balanço em lote.
- **Vendas (PDV)** — carrinho por código de barras ou busca por nome,
  desconto por item e geral (com teto configurável por vendedor + aprovação
  de administrador acima do limite), pagamento misto (mais de uma forma na
  mesma venda, incluindo fiado e crédito de troca).
- **Estorno e troca** — estorno total ou parcial de uma venda já fechada,
  com devolução automática ao estoque e opção de gerar crédito de troca
  (usável como forma de pagamento na próxima venda) em vez de dinheiro.
- **Caixa** — um caixa único para a loja toda: abertura com troco inicial,
  sangria/suprimento (sempre com motivo obrigatório) e fechamento com
  conferência por forma de pagamento. Pode ser configurado como obrigatório
  para registrar vendas.
- **Clientes e fiado** — cadastro de clientes, venda fiada com limite de
  crédito opcional, extrato completo de dívidas e pagamentos recebidos.
- **Fornecedores e compras** — cadastro de fornecedores, pedidos de compra
  com recebimento total ou parcial (atualiza estoque e preço de custo) e
  sugestão automática de compra para produtos com estoque baixo.
- **Financeiro** — contas a pagar e a receber, com vencimento automático e
  baixa de pagamento.
- **Relatórios** — faturamento, ticket médio, vendas por vendedor e por
  categoria, margem de lucro estimada e curva ABC de produtos, por período.
- **Fidelidade** — programa opcional de pontos por real gasto, resgatável
  como crédito de troca.
- **Log de auditoria** — toda ação relevante do sistema (login, cadastros,
  edições, vendas, estornos, movimentos de caixa etc.) fica registrada com
  usuário, perfil e data/hora — exclusivo do Administrador Geral.

## Perfis de acesso

| Recurso | Administrador | Vendedor |
|---|---|---|
| Painel, estoque, histórico de vendas | ✅ | ✅ |
| Registrar venda, aplicar desconto até o limite configurado | ✅ | ✅ |
| Abrir/fechar caixa, sangria/suprimento | ✅ | ✅ |
| Cadastrar cliente, vender fiado, receber pagamento de fiado | ✅ | ✅ |
| Cadastrar/editar produto, ajustar estoque, inventário | ✅ | ❌ |
| Estornar venda | ✅ | ❌ |
| Fornecedores e pedidos de compra | ✅ | ❌ |
| Financeiro (contas a pagar/receber) e relatórios gerenciais | ✅ | ❌ |
| Cadastrar/gerenciar usuários | ✅ | ❌ |
| Editar dados da loja e políticas de venda | ✅ | ❌ |
| Log do sistema (ações de todos, por perfil) | ✅ | ❌ |

Todo vendedor vê o estoque geral e **quem vendeu o quê e quando** (histórico
de vendas), mas o **log de auditoria** detalhado (login/logout, cadastros,
edições, exclusões — com timestamp e usuário) é exclusivo do administrador.

## Código de barras

O sistema foi pensado para um **leitor de código de barras USB**: ele
funciona como um teclado, "digitando" o código e apertando Enter sozinho —
não precisa de nenhuma configuração. Basta:

- Na tela **Nova venda**, o campo de escaneamento já fica focado — é só
  passar o produto no leitor.
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
- A sessão do usuário logado usa `chrome.storage.session` (efêmero — some ao
  fechar o navegador), então cada início de expediente pede login de novo.
- Não há nenhuma permissão de rede, câmera ou acesso a outras abas — a única
  permissão usada é `storage`.

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
      session.js           Sessão do usuário logado e crédito de troca pendente
      data/                Repositórios: empresa, usuários, produtos, vendas,
                            estoque, auditoria, caixa, clientes/fiado,
                            fornecedores, compras, financeiro, fidelidade,
                            relatórios
      utils/               CNPJ, formatação, leitura de código de barras, cálculo
                            de desconto/totais
      views/               Telas: setup, login, painel, estoque, venda,
                            histórico de vendas, caixa, clientes, compras,
                            financeiro, relatórios, usuários, log, dados da
                            loja, ajuda
      components/          Modal, toast
```
