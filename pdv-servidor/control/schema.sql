-- Banco de controle do SaaS multi-tenant (Estratégia B — ver artifact
-- "PDV Multi-Tenant"): fica FORA da pasta de qualquer loja e nunca guarda
-- dado operacional (produto, venda, cliente...) — só a lista de lojas
-- cadastradas e pra onde cada uma aponta. `db/schema.sql` (schema de CADA
-- loja) continua intocado; este arquivo é novo, sem nenhuma relação com
-- aquele.
--
-- Etapa 1 do roteiro: só cria esta estrutura e o script de provisionamento
-- (scripts/createTenant.js) — server.js, db/index.js e routes/*.js ainda
-- não sabem que isto existe. Nada muda no PDV rodando hoje.

CREATE TABLE IF NOT EXISTS tenants (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,       -- "lojax" -> lojax.<dominio>; ver validateSlug() em scripts/createTenant.js
  razao_social   TEXT NOT NULL,
  nome_fantasia  TEXT NOT NULL,
  cnpj           TEXT,                       -- identifica, não isola (isolamento é o arquivo .sqlite3 em si)
  status         TEXT NOT NULL DEFAULT 'trial',  -- trial | ativo | suspenso | cancelado
  plano          TEXT NOT NULL DEFAULT 'trial',  -- genérico de propósito, sem campo de gateway específico ainda
  db_path        TEXT NOT NULL UNIQUE,       -- caminho do dados-da-loja.sqlite3 desta loja
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,                    -- NULL = sem vencimento (plano manual)
  activation_key TEXT
);

-- Índice parcial (não UNIQUE direto na coluna): CNPJ nasce NULL pra loja
-- recém-criada (só é preenchido quando o lojista preenche Dados da loja,
-- dentro do próprio banco do tenant) — um UNIQUE comum rejeitaria a
-- SEGUNDA loja sem CNPJ ainda preenchido. Mesmo padrão já usado em
-- db/index.js (idx_cashsessions_open_user_unique): impede duas lojas
-- DIFERENTES reivindicando o mesmo CNPJ real, sem travar quem ainda não
-- preencheu.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_cnpj_unique
ON tenants(cnpj) WHERE cnpj IS NOT NULL AND cnpj != '';

CREATE TABLE IF NOT EXISTS platform_admins (
  id             TEXT PRIMARY KEY,
  username_lower TEXT NOT NULL UNIQUE,
  password_salt  TEXT NOT NULL,
  password_hash  TEXT NOT NULL,              -- mesmo lib/auth.js (PBKDF2) já usado pros usuários de cada loja
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);

-- Etapa 8 do roteiro multi-tenant (ver artifact "PDV Multi-Tenant"): sessão
-- de login do painel de Super Admin — mesmo formato EXATO da tabela
-- `sessions` de cada loja (db/schema.sql), de propósito: lib/session.js
-- (createSession/resolveSession/destroySession) já é agnóstico de banco
-- (recebe `targetDb` por parâmetro) e de quem é o `user_id` — reaproveitado
-- aqui tal como está, passando `controlDb` no lugar do banco de uma loja,
-- sem duplicar nenhuma lógica de sessão/expiração/TTL.
CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
