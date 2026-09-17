// Achado de auditoria (DRY): o nome de cada tópico do WebSocket (o que
// routes/*.js manda em broadcast(topic, ...) e o que public/js/app.js
// confere em LIVE_TOPICS) vivia só como literal de string solto nos dois
// lados — nada impedia uma renomeação de um lado sem a outra, silenciosa
// (o live-refresh daquela tela simplesmente para de funcionar, sem erro
// nenhum pra avisar). Fonte única agora: backend (routes/*.js) e frontend
// (app.js) importam as MESMAS constantes deste arquivo — um typo vira erro
// de import (variável indefinida), não um comportamento quebrado em
// silêncio. Puro JS sem framework nos dois lados (Node ESM lê este arquivo
// direto do disco; o navegador via <script type="module">, servido de
// public/), então um import relativo simples já basta — sem bundler,
// sem build step.
export const TOPIC_PRODUCTS_CHANGED = 'products-changed';
export const TOPIC_SUPPLIERS_CHANGED = 'suppliers-changed';
export const TOPIC_PURCHASES_CHANGED = 'purchases-changed';
export const TOPIC_SALES_CHANGED = 'sales-changed';
export const TOPIC_CUSTOMERS_CHANGED = 'customers-changed';
export const TOPIC_DELIVERIES_CHANGED = 'deliveries-changed';
export const TOPIC_FINANCE_CHANGED = 'finance-changed';
export const TOPIC_CASH_CHANGED = 'cash-changed';
export const TOPIC_CASH_CONFIG_CHANGED = 'cash-config-changed';
export const TOPIC_COMPANY_CHANGED = 'company-changed';
export const TOPIC_LOYALTY_CONFIG_CHANGED = 'loyalty-config-changed';
export const TOPIC_USERS_CHANGED = 'users-changed';
// Recarregam a página inteira em todo terminal (ver app.js) — não fazem
// parte de nenhum LIVE_TOPICS por tela, tratados à parte.
export const TOPIC_BACKUP_RESTORED = 'backup-restored';
export const TOPIC_DATA_RESET = 'data-reset';
