// Achado de auditoria (DRY): os três valores de status de um carreto
// ('pendente'/'entregue'/'cancelado') viviam como literal solto tanto no
// backend (routes/deliveries.js, que os grava) quanto no frontend
// (views/carreto.js e views/dashboard.js, que comparam contra eles pra
// decidir o que mostrar) — mesmo risco de divergência silenciosa já
// corrigido pros tópicos de WebSocket (ver utils/liveTopics.js).
export const DELIVERY_STATUS_PENDING = 'pendente';
export const DELIVERY_STATUS_DELIVERED = 'entregue';
export const DELIVERY_STATUS_CANCELLED = 'cancelado';
