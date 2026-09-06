// Dados cadastrais da loja — um único registro fixo (id: 'main'), preenchido
// no assistente de configuração inicial e editável depois por quem tiver a
// permissão 'empresa' (admin sempre tem; um vendedor só se marcado no
// cadastro dele, ver utils/permissions.js).
import { dbGet, dbUpdate } from '../db.js';
import { hasAnyUser, assertActingUserHasPermission } from './usersRepo.js';
import { MAX_INSTALLMENTS } from '../utils/pricing.js';

const COMPANY_ID = 'main';

export async function getCompany() {
  return dbGet('company', COMPANY_ID);
}

export async function isCompanyRegistered() {
  const company = await getCompany();
  return !!company;
}

/** Achado de auditoria: saveCompany() era só protegido pela TELA ("Dados da
 * loja" restrita a admin) — a função em si aceitava qualquer chamada. Isso
 * era especialmente sério porque `policies.vendorMaxDiscountPercent` mora
 * aqui: um vendedor com acesso ao console podia chamar saveCompany() direto
 * e subir o próprio limite de desconto pra 100%, driblando por completo a
 * exigência de senha de admin que createSale() aplica (ver salesRepo.js) —
 * sem nunca precisar da senha de ninguém. Mesmo raciocínio de
 * usersRepo.js#assertActingUserHasPermission: só libera sem sessão de admin
 * durante o cadastro inicial de verdade (quando ainda não existe usuário
 * nenhum no sistema — setup.js chama saveCompany() ANTES de criar o
 * admin), qualquer chamada depois disso precisa ser da sessão realmente
 * logada como admin agora. */
async function assertAllowedToSaveCompany() {
  if (!(await hasAnyUser())) return; // cadastro inicial de verdade, ainda sem ninguém logado
  await assertActingUserHasPermission('empresa');
}

/** dbUpdate (get+put na mesma transação) em vez de getCompany()+dbPut
 * separados — o merge de `policies` abaixo depende do valor ATUAL de
 * cada política pra preservar o que não foi informado (ver comentário mais
 * abaixo); sem isso, duas edições de "Dados da loja" quase juntas (ou o
 * cadastro inicial cruzando com uma edição, embora raro na prática — é
 * uma tela só-admin) podiam ler o mesmo estado "antes" e uma delas
 * sobrescrever a política que a outra tinha acabado de mudar. */
export async function saveCompany(data) {
  await assertAllowedToSaveCompany();
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
      // Clampado aqui, na função que grava de verdade — não só decorado com
      // min/max no campo da tela (ver views/company.js): salvo direto por
      // fora da tela normal (ex: console do navegador), um valor negativo
      // faria toda venda pedir aprovação de admin à toa, e um valor acima de
      // 100 desativaria o teto de desconto na prática (ver
      // data/salesRepo.js#createSale) mesmo sem ninguém ter mexido ali de
      // propósito.
      vendorMaxDiscountPercent: Math.max(0, Math.min(100, Number(
        data.policies?.vendorMaxDiscountPercent
          ?? existing?.policies?.vendorMaxDiscountPercent
          ?? 10,
      ))),
      // Se true, a tela de Nova Venda bloqueia a finalização da venda sem um
      // caixa aberto. Começa desativado (opcional) — dá pra exigir depois
      // que o hábito de abrir/fechar caixa estiver consolidado na loja.
      requireOpenCashSession: data.policies?.requireOpenCashSession
        ?? existing?.policies?.requireOpenCashSession
        ?? false,
      // Fidelidade: pontos ganhos por real gasto (0 = programa desligado) e
      // quantos pontos valem R$1 na hora de resgatar. Só ganha ponto venda
      // com cliente selecionado — venda avulsa não acumula.
      //
      // Achado de auditoria (P0 — dinheiro de graça): estes dois eram os
      // ÚNICOS campos numéricos de `policies` sem clamp aqui na fonte (todos
      // os outros acima/abaixo já reconferem, mesmo raciocínio de
      // vendorMaxDiscountPercent). `loyaltyRedemptionRate` em especial é
      // grave: views/clientes.js#openRedeemModal calcula o crédito do
      // resgate como `pontos / rate` — um valor salvo como 0 (ou negativo)
      // vira `Infinity`, e como o crédito pendente da sessão SOMA em vez de
      // substituir (ver session.js#addPendingCredit: `existing.amount +
      // amount`), essa sessão do navegador ganha crédito infinito PRA
      // SEMPRE, utilizável em qualquer venda daquele turno, de qualquer
      // cliente — mercadoria de graça indefinidamente até alguém notar.
      // Achado de auditoria (P1, dinheiro não pode ter brecha): o `Math.max`
      // acima já bloqueava negativo, mas não tinha teto de cima nenhum — um
      // valor como `Infinity` (sobrevive ao `|| 0`) passava direto, dando
      // pontos ilimitados em toda venda com cliente. `Math.min(1000, ...)`
      // é generoso o bastante pra qualquer configuração real (1000 pontos
      // por real já é um programa de fidelidade absurdamente generoso) e
      // ainda barra o valor extremo.
      loyaltyPointsPerReal: Math.max(0, Math.min(1000, Number(
        data.policies?.loyaltyPointsPerReal
          ?? existing?.policies?.loyaltyPointsPerReal
          ?? 0,
      ) || 0)),
      loyaltyRedemptionRate: Math.max(1, Number(
        data.policies?.loyaltyRedemptionRate
          ?? existing?.policies?.loyaltyRedemptionRate
          ?? 100,
      ) || 100),
      // Juro de parcelamento no cartão de crédito, repassado pro cliente —
      // configurado só aqui (Administrador Geral), nunca pelo vendedor na
      // hora da venda (ver utils/pricing.js#computeCreditInterest e o
      // tópico "Vendas (PDV)" na Ajuda). 1x nunca tem juro, sempre, não
      // importa esta configuração.
      // Mesmo raciocínio do clamp em vendorMaxDiscountPercent acima: os
      // números abaixo já vêm limitados da própria tela (ver
      // views/company.js), mas quem grava de verdade reconfere de novo, pra
      // nunca depender só do que a tela mandou.
      creditInterest: {
        // Se true, `freeInstallments` parcelas (a partir da 2ª) ficam sem
        // juro antes de começar a cobrar. Se false, qualquer parcelamento
        // (2x em diante) já cobra juro.
        freeInstallmentsEnabled: !!(data.policies?.creditInterest?.freeInstallmentsEnabled
          ?? existing?.policies?.creditInterest?.freeInstallmentsEnabled
          ?? false),
        freeInstallments: Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(
          data.policies?.creditInterest?.freeInstallments
            ?? existing?.policies?.creditInterest?.freeInstallments
            ?? 1,
        )) || 1)),
        // 'monthly' — percentual ao mês, multiplicado pelas parcelas (mais
        // parcelas = mais juro total). 'fixed' — percentual único, igual
        // não importa quantas parcelas.
        type: (data.policies?.creditInterest?.type
          ?? existing?.policies?.creditInterest?.type
          ?? 'monthly') === 'fixed' ? 'fixed' : 'monthly',
        // Achado de auditoria (P1, dinheiro não pode ter brecha): mesmo gap
        // do `loyaltyPointsPerReal` acima — só piso, sem teto. Um erro de
        // digitação plausível (500 em vez de 5) já vira juro grotescamente
        // errado cobrado do cliente automaticamente em toda venda
        // parcelada, sem nenhum teto de sanidade pra pegar isso. 100% já é
        // um juro absurdamente alto pra qualquer configuração real — o
        // teto só existe pra pegar erro de digitação/valor extremo, não pra
        // restringir uma política agressiva legítima.
        monthlyPercent: Math.max(0, Math.min(100, Number(
          data.policies?.creditInterest?.monthlyPercent
            ?? existing?.policies?.creditInterest?.monthlyPercent
            ?? 0,
        ) || 0)),
        fixedPercent: Math.max(0, Math.min(100, Number(
          data.policies?.creditInterest?.fixedPercent
            ?? existing?.policies?.creditInterest?.fixedPercent
            ?? 0,
        ) || 0)),
      },
    },
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  return record;
}
