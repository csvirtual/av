-- Espelha 1:1 os "object stores" do IndexedDB da extensão (ver app/js/db.js,
-- DB_VERSION 8) — um registro por linha, guardado como JSON (`data`), com as
-- colunas dos campos que hoje têm índice extraídas à parte só pra permitir
-- WHERE/ORDER BY eficiente (mesmo papel que os índices do IndexedDB faziam).
-- Fase 1 só usa de verdade a tabela `products` (prova de conceito de Estoque
-- compartilhado) — as demais já entram criadas pra não precisar de uma
-- migração nova a cada fase seguinte (vendas, caixa, financeiro...).
--
-- Achado de auditoria (P3, decisão registrada — sem mudança de schema):
-- como o registro de verdade de cada linha é o JSON em `data` (não colunas
-- tipadas), FOREIGN KEY/CHECK não têm onde morder a maioria dos campos que
-- importariam (ex.: productId dentro de um item de venda) — só valeriam
-- pras poucas colunas extraídas à parte, e mesmo essas relações já são
-- garantidas no código (toda gravação passa por um único caminho em
-- routes/*.js, nunca INSERT solto). Adicionar isso agora arriscaria quebrar
-- a leitura de um banco de loja já em produção sem um ganho real de
-- segurança — decisão consciente de NÃO migrar o schema pra isso, não um
-- descuido.

CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username_lower TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  barcode TEXT UNIQUE,
  name_lower TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name_lower);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  customer_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stockmov_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stockmov_timestamp ON stock_movements(timestamp);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  user_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auditlog_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_auditlog_user ON audit_log(user_id);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  terminal_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cashsessions_openedat ON cash_sessions(opened_at);
CREATE INDEX IF NOT EXISTS idx_cashsessions_status ON cash_sessions(status);
CREATE INDEX IF NOT EXISTS idx_cashsessions_terminal ON cash_sessions(terminal_id);
-- Achado de auditoria (P3): routes/cash.js#openCashSession já impede duas
-- aberturas simultâneas no MESMO terminal (modo "porTerminal") dentro de um
-- db.transaction() síncrono — já atômico contra qualquer outra requisição
-- neste processo único (mesmo raciocínio de todo db.transaction() do
-- servidor). Este índice é defesa em profundidade: uma restrição de
-- verdade no banco, caso algum caminho futuro grave numa sessão fora dessa
-- função. `terminal_id IS NOT NULL` deixa de fora o modo "único" de
-- propósito — lá `terminal_id` é sempre NULL em toda sessão (aberta ou
-- fechada), e SQLite não indexa NULL num índice parcial com esta condição,
-- então esta restrição não se aplica a esse modo (que segue só com a
-- proteção por código, mesma decisão já documentada na auditoria — um
-- "único aberto em toda a loja" globalmente é bem mais complexo de expressar
-- só com SQL puro).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cashsessions_open_terminal_unique
  ON cash_sessions(terminal_id) WHERE status = 'aberto' AND terminal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cashmov_session ON cash_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_cashmov_timestamp ON cash_movements(timestamp);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name_lower TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name_lower);

CREATE TABLE IF NOT EXISTS customer_debts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custdebts_customer ON customer_debts(customer_id);
CREATE INDEX IF NOT EXISTS idx_custdebts_timestamp ON customer_debts(timestamp);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name_lower TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name_lower);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchorders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchorders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchorders_createdat ON purchase_orders(created_at);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  due_date INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finentries_status ON financial_entries(status);
CREATE INDEX IF NOT EXISTS idx_finentries_duedate ON financial_entries(due_date);

CREATE TABLE IF NOT EXISTS loyalty_entries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_timestamp ON loyalty_entries(timestamp);

-- Crédito de troca: na extensão single-machine isso vive em
-- chrome.storage.session (efêmero, preso à aba/turno de quem estornou ou
-- resgatou os pontos — ver app/js/session.js). Num servidor multi-terminal
-- isso não faz sentido: o crédito nasceu de UM cliente (resgate de pontos
-- dele, ou estorno de uma compra dele) e precisa poder ser usado em
-- QUALQUER terminal na próxima venda DESSE cliente — não só na máquina onde
-- foi gerado. Por isso vira um extrato por cliente, igual fiado (mesmo
-- princípio de saldo = soma do extrato, nunca um número solto).
CREATE TABLE IF NOT EXISTS store_credits (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_storecredits_customer ON store_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_storecredits_timestamp ON store_credits(timestamp);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON deliveries(customer_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_createdat ON deliveries(created_at);

-- Achado de auditoria (P4): tabela não usada por nenhuma rota/lib deste
-- servidor no momento (nenhum código lê ou grava nela) — mantida por
-- compatibilidade com o formato de backup da extensão original (que tinha
-- um placar diário pré-calculado) e reservada pra um possível uso futuro
-- (ex.: um placar diário com cache, como o `daily_sales` da extensão).
-- Não é dado morto por engano; é dado reservado de propósito.
CREATE TABLE IF NOT EXISTS daily_sales (
  date TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Sessão de login por terminal (substitui o chrome.storage.session de cada
-- navegador — aqui precisa ser o SERVIDOR quem sabe quem está logado em
-- cada terminal, já que o "usuário" agora é compartilhado entre máquinas).
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Estado do trial/ativação de licença (ver lib/license.js, lib/licenseState.js)
-- — equivalente ao chrome.storage.local da extensão (app/js/data/licenseRepo.js),
-- que por sua vez é deliberadamente separado do IndexedDB (o que viaja no
-- backup) pelo MESMO motivo daqui: se isto morasse na tabela `company` (que
-- entra em todo backup, ver lib/backup.js#BACKUP_TABLES), restaurar um
-- backup tirado durante o trial "resetaria o relógio" de qualquer instalação
-- nova sozinho, sem chave nenhuma — furo que a extensão evita mantendo o
-- estado da licença fora do que é salvo/restaurado. Aqui o equivalente é:
-- esta tabela existe, mas de propósito NUNCA aparece em BACKUP_TABLES.
CREATE TABLE IF NOT EXISTS license_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
