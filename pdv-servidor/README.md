# pdv-servidor — protótipo multi-terminal (SQL + rede local)

Protótipo de um **produto separado** do PDV - C&S Virtual: em vez da extensão
Chrome atual (100% local, IndexedDB, um navegador só, sem sincronização —
decisão de projeto documentada na política de privacidade), este é um
servidor Node.js que roda numa máquina da loja e serve o sistema, por rede,
pra quantos terminais quiser (outros PCs, Chromebooks, celular) — todos
enxergando o mesmo estoque/vendas/caixa em tempo real, sem instalar nada
neles além de um navegador comum.

**Este código não afeta `pdv-extension/` em nada.** Os dois convivem no
mesmo repositório como produtos distintos.

## Estado atual (resumo pra quem chegar aqui sem contexto)

Construído entre 31/ago e 1º/set (fases 1 a 8 do roteiro abaixo), sem
nenhuma decisão registrada de abandono — o trabalho só parou e o foco
voltou pra extensão Chrome. Ficou **8 sessões inteiras esquecido** num
scratchpad efêmero antes de ser recuperado e trazido pro repositório em
07/set — daí este README existir: pra isso nunca mais acontecer.

**Roda de verdade hoje** (testado antes deste commit): `npm install &&
node seed.js && node server.js` sobe em segundos, `/api/status` responde
`{"ok":true}`.

## Roteiro — 10 fases

| # | Fase | Status |
|---|------|--------|
| 1 | Esqueleto: servidor + SQLite + login compartilhado + Estoque em tempo real | ✅ feita, testada (`demo-fase*` não existe pra 1 — foi o `test-multi-terminal.cjs` inicial) |
| 2 | Vendas (PDV) + Histórico, baixa de estoque atômica | ✅ feita, testada (`demo-fase2.cjs`, `test-sales-*.cjs`) |
| 3 | Caixa — modo Único (loja toda) ou Por terminal, configurável | ✅ feita, testada (`demo-fase3.cjs`, `test-cash*.cjs`) |
| 4 | Clientes e fiado (extrato, limite, pagamento) | ✅ feita, testada (`demo-fase4.cjs`, `test-fiado*.cjs`) |
| 5 | Compras/fornecedores + Financeiro (contas a pagar/receber) | ✅ feita, testada (`demo-fase5.cjs`, `test-purchases-finance*.cjs`) |
| 6 | Carreto (entregas) + Fidelidade (pontos) | ✅ feita, testada (`demo-fase6.cjs`, `test-loyalty-carreto*.cjs`) |
| 7 | Usuários, 13 permissões granulares, log de auditoria | ✅ feita, testada (`demo-fase7.cjs`, `test-users*.cjs`) |
| 8 | Segurança: bloqueio por força bruta, autorização de desconto, backup criptografado round-trip | ✅ feita, testada (`demo-fase8.cjs`, `test-security*.cjs`) |
| 9 | **Interface final** — trocar `public/test.html` (tela de prova de conceito) pelas telas reais da extensão (`pdv-extension/app/js/views/*.js`), com uma camada de dados nova que fala HTTP/WebSocket em vez de IndexedDB | ⚪ não iniciada |
| 10 | Empacotamento — instalador `.exe`, serviço do Windows, ícone de bandeja, pra rodar sem terminal | ⚪ não iniciada |

**Por que views/*.js deve ser reaproveitável quase inteiro na Fase 9:** na
extensão, toda tela só fala com `data/*Repo.js` — nunca direto com
IndexedDB. Trocar o motor por baixo (repo que fala com este servidor em vez
de IndexedDB) não deveria exigir redesenhar nenhuma tela, na maioria dos
casos. Ainda não verificado na prática — é o primeiro risco real da Fase 9.

## Decisões de arquitetura já fechadas

- **Servidor também serve a tela** (não é "extensão fala com servidor") —
  zero instalação nas máquinas-cliente, só abrir o navegador no IP do
  servidor. Evita permissão de rede local no `manifest.json` (que dispararia
  revisão nova da Google Chrome Web Store a cada versão).
- **Caixa configurável**: campo de política nova em Dados da loja —
  **Único** (uma sessão de caixa pra loja toda, qualquer terminal opera
  nela) ou **Por terminal** (cada estação física com seu próprio caixa,
  independente; Painel soma tudo pra visão consolidada). Ligado à
  *máquina*, não ao usuário — o dinheiro físico fica preso à gaveta, não
  anda com o vendedor.
- **Acesso remoto** (fora da rede da loja), se um dia for pedido: Tailscale
  (rede privada virtual, criptografado, sem IP fixo nem porta aberta no
  roteador) — nunca abrir porta + DNS dinâmico, que expõe o servidor à
  internet inteira. Bloqueador antes disso: falta HTTPS de verdade e
  revisão de segurança adicional.
- **Empacotamento** (Fase 10): instalador Windows com Node.js embutido +
  serviço do Windows (liga sozinho, sobrevive a reinício) + ícone de
  bandeja como espelho visual/controle manual.

## Como rodar

```
cd pdv-servidor
npm install
node seed.js      # cria admin/admin123 — troque a senha depois de logar
node server.js    # mostra os endereços de rede (ex: http://192.168.x.x:3131)
```

Abre `http://localhost:3131/test.html` (ou o IP mostrado, de outra
máquina/aba) — é a tela de prova de conceito da Fase 1-8, não a interface
real (isso é a Fase 9).

## Estrutura

- `server.js` — monta o Express, WebSocket, sessão por cookie, todas as rotas.
- `db/schema.sql` + `db/index.js` — schema SQLite (19 tabelas, espelhando
  1:1 os "object stores" do IndexedDB da extensão — ver `pdv-extension/app/js/db.js`).
- `lib/` — auth (mesmo hash PBKDF2 da extensão, 100% compatível), sessão,
  permissões, bloqueio de login, backup/criptografia, broadcast WebSocket,
  config de empresa/fidelidade, ledger de fidelidade, sessão de caixa.
- `routes/` — um arquivo por domínio (auth, products, sales, cash,
  customers, suppliers, purchases, finance, loyalty, deliveries, users,
  audit, company, backup) — 13 domínios, cobrindo praticamente o sistema
  inteiro.
- `test-*.cjs` — testes de regressão reais (rodam contra um servidor de
  verdade em `localhost:3131`, via `fetch`), incluindo a variante
  `*-multiterminal.cjs` de cada um (duas "máquinas" simuladas por conexões
  HTTP/WebSocket separadas, confirmando que uma vê o que a outra fez em
  tempo real). Rodar: sobe o servidor (`node server.js`) numa janela,
  `node test-nome.cjs` noutra.
- `demo-fase*.cjs` — scripts que dirigem a UI de teste via Playwright pra
  gerar as capturas em `demo-screenshots/`, prova visual de cada fase
  funcionando com duas máquinas isoladas vendo o mesmo dado.

## Próximo passo recomendado

Fase 9 (interface real), começando por **uma tela só** como prova — mesmo
espírito da Fase 1 original ("prova que a arquitetura funciona antes de
continuar"). Candidata natural: Estoque, por já ter sido a primeira coisa
provada na Fase 1 aqui do lado do servidor. Precisa de uma camada de dados
nova no lado do cliente (ex: `data/productsRepo.js` alternativo, falando
`fetch`/WebSocket em vez de IndexedDB) que a tela real (`views/products.js`)
consiga usar sem reescrita, validando a promessa de reaproveitamento antes
de investir nas 20+ telas restantes.
