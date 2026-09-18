// Mesmo ponto de corte de largura já usado em styles.css pra virar o menu
// lateral numa gaveta (ver `@media (max-width: 900px)`) — abaixo disso o
// app já se trata como "tela de celular/tablet" pra layout, então reusa
// aqui pra decidir comportamento de foco automático também.
export function isMobileViewport() {
  return window.matchMedia('(max-width: 900px)').matches;
}
