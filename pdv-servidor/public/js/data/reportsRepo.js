// Relatórios gerenciais — versão multi-terminal, mesmo contrato de
// app/js/data/reportsRepo.js#computeSalesReport() da extensão. Diferente
// do resto desta camada (repos que só traduzem chamada pra HTTP), a
// agregação em si (soma por vendedor/produto/categoria, curva ABC) roda
// no SERVIDOR (ver routes/reports.js), não aqui — trazer todas as vendas
// do período pro navegador reduzir em JS jogaria fora a otimização que a
// própria extensão já faz (varrer só o intervalo, nunca a tabela
// inteira): o servidor já tem a tabela local, faz a mesma varredura
// indexada, e devolve só o relatório pronto.
import { api } from './apiClient.js';

export async function computeSalesReport({ from = null, to = null } = {}) {
  const params = new URLSearchParams();
  if (from != null) params.set('from', from);
  if (to != null) params.set('to', to);
  return api(`/api/reports/vendas?${params.toString()}`);
}
