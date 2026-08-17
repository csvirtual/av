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
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await dbPut('company', record);
  return record;
}
