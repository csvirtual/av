// Backup completo do sistema: junta os dados de todos os object stores do
// IndexedDB num único arquivo criptografado (senha escolhida na hora da
// exportação), pra guardar em outro lugar (pendrive, e-mail pra si mesmo,
// nuvem pessoal) e restaurar depois — inclusive numa instalação nova da
// extensão, em outro computador. É manual por decisão consciente: nada de
// permissão de downloads/alarms pra automatizar isso sozinho (ver README) —
// quem decide quando fazer backup é o lojista.
import { dbCount, dbTransaction, STORE_NAMES } from '../db.js';
import { buildBackupBlob as buildBackupBlobViaWorker, decryptPayload } from '../backupCrypto.js';
import { hasAnyUser, assertActingUserHasPermission } from './usersRepo.js';
import { computeDailySalesRows } from './salesRepo.js';

const BACKUP_FORMAT_VERSION = 1;

export const STORE_LABELS = {
  company: 'Dados da loja',
  users: 'Usuários',
  products: 'Produtos',
  sales: 'Vendas',
  stockMovements: 'Movimentações de estoque',
  auditLog: 'Log de auditoria',
  cashSessions: 'Sessões de caixa',
  cashMovements: 'Movimentações de caixa',
  customers: 'Clientes',
  customerDebts: 'Dívidas de clientes (fiado)',
  suppliers: 'Fornecedores',
  purchaseOrders: 'Pedidos de compra',
  financialEntries: 'Contas financeiras',
  loyaltyEntries: 'Lançamentos de fidelidade',
  deliveries: 'Carretos (entregas)',
};

/** Quantos registros existem hoje em cada store — usado pra mostrar "o que
 * vai ser substituído" antes de uma restauração. */
export async function getCurrentCounts() {
  const counts = {};
  for (const name of STORE_NAMES) counts[name] = await dbCount(name);
  return counts;
}

/** Gera o backup completo (lê o banco, monta e cifra) e devolve um Blob já
 * pronto pra virar arquivo — não mexe em disco nem dispara download nenhum,
 * isso fica por conta da view (facilita reuso e teste). A leitura do banco
 * e a cifra acontecem dentro de uma worker dedicada (ver backupWorker.js),
 * não aqui: com anos de histórico acumulado, montar e cifrar o backup na
 * thread principal travava a aba por vários segundos (achado de auditoria,
 * medido ao vivo com 100 mil vendas).
 *
 * Achado de auditoria (P0 — GRAVE): esta função nunca checou permissão
 * nenhuma — só a TELA "Backup" escondia o botão de quem não tem a
 * permissão 'backup' (ver app.js). Um vendedor com acesso ao console do
 * navegador podia chamar buildBackupBlob() direto, com qualquer senha
 * escolhida por ele mesmo, e baixar o banco inteiro cifrado — clientes,
 * financeiro, e a tabela de usuários com hash de senha de todo mundo,
 * inclusive do Administrador Geral — sem deixar rastro nenhum no log de
 * auditoria. Mesma classe de bug já fechada em applyBackup()/
 * resetOperationalData() logo abaixo (ver assertAllowedToApplyBackup),
 * só que esta tinha ficado destravada no caminho de EXPORTAR. */
export async function buildBackupBlob(password) {
  await assertActingUserHasPermission('backup');
  return buildBackupBlobViaWorker(password);
}

/** Backup de segurança gerado SOZINHO a cada fechamento de caixa (ver
 * views/caixa.js), cifrado com a mesma senha que a pessoa acabou de digitar
 * pra confirmar o fechamento. Usa o MESMO núcleo de buildBackupBlob() acima
 * — a mesma leitura completa do banco —, mas DE PROPÓSITO sem exigir a
 * permissão 'backup': fechar caixa é uma ação que qualquer vendedor já
 * pode fazer (não existe uma permissão "Caixa" separada neste sistema —
 * ver utils/permissions.js), então exigir 'backup' aqui não impediria um
 * vendedor mal-intencionado de nada (ele geraria o mesmo backup fechando o
 * caixa de verdade pela tela normal) — só quebraria essa rede de segurança
 * pra toda loja que não marcou 'backup' pro vendedor que fecha o caixa
 * todo dia, que é a maioria. A proteção de verdade deste caminho é nunca
 * ser uma chamada solta e silenciosa: é sempre efeito colateral de fechar
 * um caixa de verdade, uma ação com consequência real e registrada duas
 * vezes no log de auditoria ("Fechamento de caixa" e "Backup automático
 * (fechamento de caixa)", ver views/caixa.js) — bem diferente de uma
 * chamada crua pelo console, sem rastro nenhum, que é exatamente o que a
 * checagem em buildBackupBlob() acima passou a impedir. */
export async function buildAutomaticCashCloseBackup(password) {
  return buildBackupBlobViaWorker(password);
}

/** Decripta e valida um arquivo de backup, sem gravar nada ainda — devolve
 * os dados junto com a contagem de registros de cada tipo, pra tela mostrar
 * um resumo e pedir confirmação antes de qualquer coisa destrutiva. */
export async function readBackupFile(fileText, password) {
  let envelope;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }
  if (!envelope || typeof envelope !== 'object' || !envelope.ciphertext || !envelope.salt || !envelope.iv) {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }

  let payload;
  try {
    payload = await decryptPayload(envelope, password);
  } catch {
    throw new Error('Não foi possível abrir o backup — senha incorreta ou arquivo corrompido.');
  }
  if (!payload || typeof payload !== 'object' || !payload.stores) {
    throw new Error('Arquivo inválido — não parece ser um backup deste sistema.');
  }
  // O campo é gravado desde sempre (buildBackupEnvelope), mas nunca tinha
  // sido checado aqui — um backup de um formato mais novo (de uma versão
  // futura do sistema, com stores/campos que esta versão não conhece)
  // seria aplicado do mesmo jeito, sem aviso, e o dbTransaction atômico só
  // pegaria o problema na hora de gravar (se pegasse), com um erro cru em
  // vez de uma mensagem clara. Um backup de formato IGUAL ou MAIS ANTIGO
  // continua sendo aceito normalmente — só recusa o que esta versão do
  // sistema não tem como garantir que entende.
  if (typeof payload.backupFormatVersion !== 'number' || payload.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('Este arquivo de backup foi gerado por uma versão mais nova do sistema — atualize a extensão antes de restaurar.');
  }

  const counts = {};
  for (const name of STORE_NAMES) counts[name] = (payload.stores[name] || []).length;
  return { payload, counts };
}

/** Achado de auditoria: applyBackup() era só protegido pela TELA ("Backup"
 * restrita a admin) — a função em si aceitava qualquer chamada. Como ela
 * APAGA TUDO e regrava (é a ação mais destrutiva do sistema inteiro), um
 * vendedor com acesso ao console podia chamar applyBackup() direto com um
 * payload forjado (nem precisa ser um backup de verdade — só um objeto
 * `{ stores: {...} }` qualquer) e zerar a loja inteira sem senha de backup
 * nenhuma, sem senha de admin, sem confirmação nenhuma. Mesmo raciocínio de
 * usersRepo.js/companyRepo.js: só libera sem sessão de admin durante a
 * restauração de verdade numa instalação NOVA (setup.js chama isto antes
 * de existir qualquer usuário) — depois disso, precisa ser a sessão
 * realmente logada como admin agora. */
async function assertAllowedToApplyBackup() {
  if (!(await hasAnyUser())) return; // restauração numa instalação nova de verdade, ainda sem ninguém logado
  await assertActingUserHasPermission('backup');
}

/** Aplica os dados decriptados: apaga tudo que existe hoje e regrava com o
 * conteúdo do backup. Ação destrutiva e irreversível — quem chama isso já
 * confirmou com o usuário antes (ver views/backup.js e views/setup.js).
 *
 * Roda tudo (limpar + regravar os stores, ver STORE_NAMES, MAIS o placar
 * diário derivado — ver comentário abaixo) dentro de UMA ÚNICA transação
 * do IndexedDB, não uma transação separada por store nem uma chamada à
 * parte depois: se qualquer escrita falhar no meio do caminho (registro
 * corrompido, cota de armazenamento estourada), a transação inteira é
 * desfeita e o banco volta exatamente pro estado de antes da restauração —
 * nunca fica com alguns stores já trocados e outros ainda com os dados
 * antigos, nem com os dados já restaurados mas o placar diário ainda
 * refletindo o estado anterior.
 *
 * Achado de auditoria: `dailySales` (o placar diário de vendas, ver
 * db.js#DB_VERSION 7) não faz parte do backup em si — é derivado de
 * `sales`, não fonte de verdade — mas isso não significa que pode ser
 * recalculado por FORA da transação atômica acima. A versão anterior
 * fazia exatamente isso (uma chamada a rebuildDailySales() logo depois da
 * transação de restauração já ter fechado); se o processo fosse
 * interrompido exatamente nesse intervalo entre as duas — janela de
 * poucos milissegundos, sem nenhuma interação do usuário no meio —, os
 * dados restaurados ficavam corretos, mas o placar do Painel/Histórico
 * continuava mostrando os números de ANTES da restauração até uma
 * próxima restauração acontecer (não existe um "recalcular" manual em
 * lugar nenhum da tela). `computeDailySalesRows` (só cálculo puro, sem
 * tocar o banco, ver salesRepo.js) roda ANTES da transação abrir, e as
 * linhas resultantes são gravadas dentro dela — o placar nasce (ou falha
 * em nascer) junto com o resto dos dados, nunca separado. */
export async function applyBackup(payload) {
  await assertAllowedToApplyBackup();
  const dailySalesRows = computeDailySalesRows(payload.stores.sales || []);
  await dbTransaction([...STORE_NAMES, 'dailySales'], 'readwrite', (transaction) => {
    for (const name of STORE_NAMES) {
      const store = transaction.objectStore(name);
      store.clear();
      const records = payload.stores[name] || [];
      for (const record of records) store.put(record);
    }
    const dailyStore = transaction.objectStore('dailySales');
    dailyStore.clear();
    for (const row of dailySalesRows) dailyStore.put(row);
  });
}

// ---------- Reiniciar operação (zerar dados de teste/transição) ----------
// Achado do usuário: depois de um período de teste ou de transição vindo de
// outro sistema de PDV, a loja quer "zerar" pra começar a operar de
// verdade — mas sem perder o CADASTRO que já levou trabalho pra montar.
// Metade dos stores do sistema é cadastro/config (não nasce de vender, só
// muda quando alguém edita de propósito); a outra metade é MOVIMENTO
// (nasce de cada venda, cada abertura de caixa, cada compra) — é só essa
// segunda metade que faz sentido zerar aqui.
//
// De propósito fora da lista (fica tudo intacto): `products` — inclusive a
// quantidade atual de cada um, é o motivo desta função existir — e
// `stockMovements`, o histórico dela (não referencia o id de nenhuma venda
// específica, então continua consistente mesmo com `sales` zerado);
// `company`, `users`, `suppliers` e `customers` (cadastro, não movimento).
// `financialEntries`, `customerDebts` e `loyaltyEntries` não guardam
// nenhum saldo "solto" em cache no cliente/produto — são sempre somados a
// partir do próprio store na hora de mostrar (ver customersRepo.js e
// loyaltyRepo.js) — então limpar cada um aqui já deixa saldo de fiado e
// pontos de fidelidade voltando a zero sozinhos, sem precisar tocar em
// `customers` pra isso.
const RESET_STORE_NAMES = [
  'sales', 'cashSessions', 'cashMovements', 'customerDebts', 'deliveries',
  'auditLog', 'purchaseOrders', 'loyaltyEntries', 'financialEntries',
];

async function assertAllowedToReset() {
  await assertActingUserHasPermission('backup');
}

/** Apaga tudo que é MOVIMENTO (ver RESET_STORE_NAMES acima) — inclusive o
 * placar diário derivado (`dailySales`) e as chaves de idempotência
 * (`idempotencyKeys`, mesmo raciocínio do comentário de STORE_NAMES em
 * db.js: só fazem sentido junto da ação que as gerou). Estoque
 * (produtos + quantidade + histórico de movimentação), dados da loja,
 * usuários, fornecedores e clientes continuam exatamente como estavam.
 *
 * Ação destrutiva e irreversível — quem chama isso já confirmou com o
 * usuário e já gerou um backup de segurança antes (ver views/backup.js).
 * Tudo dentro de uma ÚNICA transação, mesmo raciocínio de applyBackup()
 * logo acima: ou zera tudo da lista, ou (numa falha no meio do caminho)
 * não muda nada — nunca fica pela metade. */
export async function resetOperationalData() {
  await assertAllowedToReset();
  await dbTransaction([...RESET_STORE_NAMES, 'dailySales', 'idempotencyKeys'], 'readwrite', (transaction) => {
    for (const name of RESET_STORE_NAMES) transaction.objectStore(name).clear();
    transaction.objectStore('dailySales').clear();
    transaction.objectStore('idempotencyKeys').clear();
  });
}
