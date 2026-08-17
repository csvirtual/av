// Dados cadastrais da loja — um único registro fixo (id: 'main'), preenchido
// no assistente de configuração inicial e editável depois só pelo admin.
import { dbGet, dbPut } from '../db.js';

const COMPANY_ID = 'main';

export async function getCompany() {
  return dbGet('company', COMPANY_ID);
}

export async function isCompanyRegistered() {
  const company = await getCompany();
  return !!company;
}

export async function saveCompany(data) {
  const existing = await getCompany();
  const record = {
    id: COMPANY_ID,
    cnpj: data.cnpj,
    razaoSocial: data.razaoSocial,
    nomeFantasia: data.nomeFantasia,
    inscricaoEstadual: data.inscricaoEstadual || '',
    inscricaoMunicipal: data.inscricaoMunicipal || '',
    endereco: {
      logradouro: data.endereco?.logradouro || '',
      numero: data.endereco?.numero || '',
      complemento: data.endereco?.complemento || '',
      bairro: data.endereco?.bairro || '',
      cidade: data.endereco?.cidade || '',
      uf: data.endereco?.uf || '',
      cep: data.endereco?.cep || '',
    },
    telefone: data.telefone || '',
    email: data.email || '',
    ramos: data.ramos || [],
    horarioFuncionamento: data.horarioFuncionamento || '',
    // Políticas de venda. Cada campo preserva o valor existente quando quem
    // chama saveCompany não o informa explicitamente (ex: a tela de dados da
    // loja não edita todos de uma vez).
    policies: {
      vendorMaxDiscountPercent: data.policies?.vendorMaxDiscountPercent
        ?? existing?.policies?.vendorMaxDiscountPercent
        ?? 10,
      // Se true, a tela de Nova Venda bloqueia a finalização da venda sem um
      // caixa aberto. Começa desativado (opcional) — dá pra exigir depois
      // que o hábito de abrir/fechar caixa estiver consolidado na loja.
      requireOpenCashSession: data.policies?.requireOpenCashSession
        ?? existing?.policies?.requireOpenCashSession
        ?? false,
      // Fidelidade: pontos ganhos por real gasto (0 = programa desligado) e
      // quantos pontos valem R$1 na hora de resgatar. Só ganha ponto venda
      // com cliente selecionado — venda avulsa não acumula.
      loyaltyPointsPerReal: data.policies?.loyaltyPointsPerReal
        ?? existing?.policies?.loyaltyPointsPerReal
        ?? 0,
      loyaltyRedemptionRate: data.policies?.loyaltyRedemptionRate
        ?? existing?.policies?.loyaltyRedemptionRate
        ?? 100,
    },
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await dbPut('company', record);
  return record;
}
