// Dados cadastrais da loja — um único registro fixo (id: 'main'), preenchido
// no assistente de configuração inicial e editável depois só pelo admin.
import { dbGet, dbUpdate } from '../db.js';

const COMPANY_ID = 'main';

export async function getCompany() {
  return dbGet('company', COMPANY_ID);
}

export async function isCompanyRegistered() {
  const company = await getCompany();
  return !!company;
}

/** dbUpdate (get+put na mesma transação) em vez de getCompany()+dbPut
 * separados — o merge de `policies` abaixo depende do valor ATUAL de
 * cada política pra preservar o que não foi informado (ver comentário mais
 * abaixo); sem isso, duas edições de "Dados da loja" quase juntas (ou o
 * cadastro inicial cruzando com uma edição, embora raro na prática — é
 * uma tela só-admin) podiam ler o mesmo estado "antes" e uma delas
 * sobrescrever a política que a outra tinha acabado de mudar. */
export async function saveCompany(data) {
  return dbUpdate('company', COMPANY_ID, (existing) => buildCompanyRecord(data, existing));
}

function buildCompanyRecord(data, existing) {
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
    // Encarregado de dados (LGPD, Art. 41) — quem os clientes/funcionários
    // da loja podem procurar sobre uso dos próprios dados pessoais.
    // Totalmente opcional: o sistema funciona normalmente sem preencher,
    // mas fica disponível pra citar no aviso de privacidade da loja pros
    // clientes dela (ver tópico "Privacidade e LGPD" na Ajuda).
    encarregadoLgpd: {
      // Segue o mesmo padrão dos outros campos básicos acima (telefone,
      // email...): a tela de "Dados da loja" sempre reenvia o formulário
      // inteiro, então não precisa do merge-preserva-se-ausente que
      // `policies` usa (ali sim, telas diferentes editam pedaços diferentes).
      nome: data.encarregadoLgpd?.nome || '',
      contato: data.encarregadoLgpd?.contato || '',
    },
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
      // Juro de parcelamento no cartão de crédito, repassado pro cliente —
      // configurado só aqui (Administrador Geral), nunca pelo vendedor na
      // hora da venda (ver utils/pricing.js#computeCreditInterest e o
      // tópico "Vendas (PDV)" na Ajuda). 1x nunca tem juro, sempre, não
      // importa esta configuração.
      creditInterest: {
        // Se true, `freeInstallments` parcelas (a partir da 2ª) ficam sem
        // juro antes de começar a cobrar. Se false, qualquer parcelamento
        // (2x em diante) já cobra juro.
        freeInstallmentsEnabled: data.policies?.creditInterest?.freeInstallmentsEnabled
          ?? existing?.policies?.creditInterest?.freeInstallmentsEnabled
          ?? false,
        freeInstallments: data.policies?.creditInterest?.freeInstallments
          ?? existing?.policies?.creditInterest?.freeInstallments
          ?? 1,
        // 'monthly' — percentual ao mês, multiplicado pelas parcelas (mais
        // parcelas = mais juro total). 'fixed' — percentual único, igual
        // não importa quantas parcelas.
        type: data.policies?.creditInterest?.type
          ?? existing?.policies?.creditInterest?.type
          ?? 'monthly',
        monthlyPercent: data.policies?.creditInterest?.monthlyPercent
          ?? existing?.policies?.creditInterest?.monthlyPercent
          ?? 0,
        fixedPercent: data.policies?.creditInterest?.fixedPercent
          ?? existing?.policies?.creditInterest?.fixedPercent
          ?? 0,
      },
    },
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  return record;
}
