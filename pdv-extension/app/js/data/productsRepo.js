// Catálogo de produtos (estoque). Cada produto tem um código de barras —
// de fábrica (escaneado) ou interno (gerado pelo sistema, ver
// utils/barcode.js) — usado tanto na venda quanto na busca.
import { dbGetAll, dbGet, dbPut, dbAdd, dbDelete, dbGetByIndex, dbUpdate, newId } from '../db.js';
import { assertActingUserHasPermission } from './usersRepo.js';

/** Achado de auditoria (P4): `Math.max(0, Number(x) || 0)` (usado em todo
 * este arquivo) bloqueia negativo e NaN, mas não `Infinity` — sobrevive ao
 * `|| 0` por ser um valor "verdadeiro" em JS. `Number.isFinite` fecha os
 * dois lados de uma vez. Mitigado a jusante (o total de uma venda nunca
 * fica negativo/Infinity mesmo com um preço corrompido, ver
 * utils/pricing.js#applyDiscount), mas o catálogo em si não deveria guardar
 * um preço inválido pra começo de conversa. */
function finiteNonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

const MAX_CUSTOM_FORMS = 7;

/** Produto com unidade 'personalizado': em vez de um preço/custo único,
 * guarda até 7 "formas de venda" (ex: areia vendida à lata, ao metro, à
 * carrada) — cada uma com seu próprio preço, custo e um FATOR de conversão
 * pro estoque, que continua sendo um número único só (ex: em "latas
 * equivalentes"). Vender 1 carrada com fator 40 baixa 40 do estoque; vender
 * 1 lata com fator 1 baixa 1. `customUnitLabel` é só o rótulo dessa
 * quantidade única (ex: "lata"), pra "450 latas em estoque" fazer sentido —
 * ver utils/format.js#displayUnit.
 *
 * Validado aqui, na fonte (não só na tela, mesmo raciocínio de todo o resto
 * deste arquivo): nome de forma vazio ou duplicado, e valor/custo/fator não
 * finito ou fora da faixa esperada, nunca chegam a virar um registro salvo —
 * um `fator` inválido em particular corromperia o estoque de um jeito que
 * não tem como desfazer depois (mesma classe do achado de auditoria da
 * `qty` em stockRepo.js#recordMovement).*/
function parseCustomForms(rawForms) {
  const list = Array.isArray(rawForms) ? rawForms : [];
  if (list.length === 0) throw new Error('Cadastre ao menos uma forma de venda para um produto personalizado.');
  if (list.length > MAX_CUSTOM_FORMS) throw new Error(`No máximo ${MAX_CUSTOM_FORMS} formas de venda por produto.`);
  const seenNames = new Set();
  return list.map((f, i) => {
    const forma = (f?.forma || '').trim();
    if (!forma) throw new Error(`Preencha o nome da forma de venda na linha ${i + 1}.`);
    const key = forma.toLowerCase();
    if (seenNames.has(key)) throw new Error(`A forma de venda "${forma}" está repetida — cada uma precisa de um nome diferente.`);
    seenNames.add(key);
    const valor = Number(f?.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new Error(`Informe um valor de venda válido para "${forma}".`);
    const custo = Number(f?.custo);
    if (!Number.isFinite(custo) || custo < 0) throw new Error(`Informe um preço de custo válido para "${forma}".`);
    const fator = Number(f?.fator);
    if (!Number.isFinite(fator) || fator <= 0) throw new Error(`Informe um fator de conversão de estoque válido para "${forma}".`);
    return { forma, valor, custo, fator };
  });
}

/** Monta os três campos de personalizado (customUnitLabel/customForms, e o
 * `price`/`costPrice` de sempre, sempre 0 nesse modo — não fazem sentido
 * quando cada forma tem seu próprio valor/custo, ver comentário no topo do
 * arquivo) a partir de `data`, ou os zera/anula quando a unidade não é
 * 'personalizado' — mesmo produto nunca fica com formas de venda "órfãs" de
 * uma unidade normal que ele tinha antes de ser editado. */
function resolveCustomUnitFields(data) {
  if (data.unit !== 'personalizado') {
    return { customUnitLabel: null, customForms: null, price: finiteNonNegative(data.price), costPrice: finiteNonNegative(data.costPrice) };
  }
  const customUnitLabel = (data.customUnitLabel || '').trim();
  if (!customUnitLabel) throw new Error('Informe o nome da unidade de estoque (ex: lata) para um produto personalizado.');
  return { customUnitLabel, customForms: parseCustomForms(data.customForms), price: 0, costPrice: 0 };
}

export async function listProducts() {
  const products = await dbGetAll('products');
  return products.sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
}

export async function getProduct(id) {
  return dbGet('products', id);
}

export async function getByBarcode(barcode) {
  return dbGetByIndex('products', 'byBarcode', (barcode || '').trim());
}

/** Busca simples por nome ou código de barras (catálogo de loja é pequeno o
 * bastante para filtrar em memória — não justifica um índice full-text). */
export async function searchProducts(term) {
  const all = await listProducts();
  const q = (term || '').trim().toLowerCase();
  if (!q) return all;
  return all.filter((p) => p.nameLower.includes(q) || p.barcode.toLowerCase().includes(q));
}

/** Achado de auditoria (mesma classe já corrigida em usersRepo.js e nos
 * outros repositórios sensíveis): cadastrar produto era protegido só pela
 * TELA (botão "Novo produto" escondido de quem não tem a permissão
 * 'manageProducts', ver views/products.js) — a função em si aceitava
 * qualquer chamada. Agora reconfere aqui, na fonte, contra a permissão
 * realmente gravada do usuário logado. */
export async function createProduct(data) {
  await assertActingUserHasPermission('manageProducts');
  const barcode = (data.barcode || '').trim();
  if (!barcode) throw new Error('Código de barras é obrigatório.');
  if (await getByBarcode(barcode)) {
    throw new Error('Já existe um produto com esse código de barras.');
  }
  const { customUnitLabel, customForms, price, costPrice } = resolveCustomUnitFields(data);
  const record = {
    id: newId(),
    barcode,
    barcodeIsInternal: !!data.barcodeIsInternal,
    name: (data.name || '').trim(),
    nameLower: (data.name || '').trim().toLowerCase(),
    category: data.category || 'material', // 'material' | 'mercearia'
    unit: data.unit || 'un',
    customUnitLabel,
    customForms,
    // Preço/estoque mínimo: um valor negativo aqui não é só "esquisito" —
    // preço negativo reduz o total de qualquer venda que incluir o produto
    // (linha do carrinho vira valor negativo); `Infinity` (achado de
    // auditoria) corromperia subtotal/relatórios do produto. Em modo
    // 'personalizado' os dois ficam sempre 0 — cada forma de venda tem seu
    // próprio valor/custo (ver resolveCustomUnitFields acima).
    price,
    costPrice,
    // Sempre começa em 0: se houver estoque inicial, quem chama (views/products.js)
    // aplica via stockRepo.recordMovement logo em seguida — é o único caminho que
    // ajusta quantidade, pra manter um único registro de origem (stockMovements) e
    // não contar o estoque inicial em dobro.
    quantity: 0,
    minStock: finiteNonNegative(data.minStock),
    // Fornecedor padrão (opcional) — usado pra agrupar a sugestão de compra
    // automática por fornecedor (ver data/purchasesRepo.js).
    supplierId: data.supplierId || null,
    // Validade e preço promocional por proximidade de vencimento — os três
    // campos só fazem sentido juntos (ver utils/pricing.js#isNearExpiry),
    // mas ficam soltos aqui de propósito: um produto pode ter validade
    // cadastrada só como informação, sem promoção nenhuma configurada ainda.
    // Sempre nulos em modo 'personalizado' (a tela nem mostra esses campos
    // pra esse tipo de produto — não existe UM preço pra aplicar promoção
    // em cima, cada forma de venda tem o seu).
    expiryDate: data.unit === 'personalizado' ? null : (data.expiryDate || null), // 'YYYY-MM-DD' | null
    expiryPromoDays: data.unit !== 'personalizado' && data.expiryDate && data.expiryPromoDays !== '' && data.expiryPromoDays != null
      ? Math.floor(finiteNonNegative(data.expiryPromoDays))
      : null,
    promoPrice: data.unit !== 'personalizado' && data.expiryDate && data.promoPrice !== '' && data.promoPrice != null
      ? finiteNonNegative(data.promoPrice)
      : null,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await dbAdd('products', record);
  return record;
}

// updateProduct/setProductActive usam dbUpdate (get+put na mesma
// transação) em vez de getProduct+dbPut separados — edição administrativa
// concorrente do MESMO produto é rara, mas sem isso duas edições quase
// juntas (ex: um admin corrige o preço enquanto outra aba estava com o
// formulário de edição aberto) apagam uma a outra silenciosamente
// (last-write-wins) em vez de uma delas pelo menos falhar de forma visível
// se checasse o código de barras contra um estado já desatualizado.
//
// Achado de auditoria: até aqui updateProduct não conferia 'manageProducts'
// de propósito — o raciocínio antigo era que ela só existia protegida pela
// TELA (o botão de editar já some pra quem não tem a permissão, ver
// views/products.js) e que exigir a permissão aqui quebraria
// purchasesRepo.js#receivePurchaseOrder, que reaproveitava esta mesma função
// só pra atualizar o preço de custo ao receber uma compra (guardado pela
// permissão 'compras' na ORIGEM, não 'manageProducts'). Só que isso deixava
// updateProduct exatamente na mesma classe de furo já corrigida em
// createProduct/deleteProduct/setProductActive logo abaixo: qualquer
// vendedor logado, sem precisar de 'manageProducts' nenhuma, conseguia
// chamar updateProduct(id, {price: 0}) direto pelo console do navegador e
// mudar preço/nome/categoria de qualquer produto — a tela nunca protegeu
// nada de verdade, só escondeu o botão. Agora updateProduct exige
// 'manageProducts' que nem os outros três; purchasesRepo.js#receivePurchaseOrder
// não depende mais desta função pro caso estreito dela — atualiza o preço
// de custo direto, dentro da própria transação atômica de recebimento (ver
// achado de auditoria extrema lá), sem precisar de nenhuma permissão extra
// além de 'compras', já conferida na origem.
export async function updateProduct(id, data) {
  await assertActingUserHasPermission('manageProducts');
  if (data.barcode) {
    const other = await getByBarcode(data.barcode);
    if (other && other.id !== id) throw new Error('Já existe um produto com esse código de barras.');
  }
  return dbUpdate('products', id, (product) => {
    if (!product) throw new Error('Produto não encontrado.');
    if (data.barcode && data.barcode !== product.barcode) {
      product.barcode = data.barcode.trim();
      product.barcodeIsInternal = !!data.barcodeIsInternal;
    }
    if (data.name !== undefined) {
      product.name = data.name.trim();
      product.nameLower = data.name.trim().toLowerCase();
    }
    if (data.category !== undefined) product.category = data.category;
    // Unidade e os campos de personalizado (customUnitLabel/customForms)
    // sempre viajam juntos — a tela sempre manda os três juntos na edição
    // completa do produto (única chamadora desta função), então recalcula
    // tudo de uma vez com a mesma validação de createProduct. Sem isso, um
    // produto normal editado pra 'personalizado' ficaria sem customForms
    // (preço R$0 pra sempre, sem forma de venda nenhuma), ou um
    // 'personalizado' editado de volta pra unidade normal manteria formas
    // de venda "fantasma" que a tela nem mostra mais.
    if (data.unit !== undefined) {
      const { customUnitLabel, customForms, price, costPrice } = resolveCustomUnitFields(data);
      product.unit = data.unit;
      product.customUnitLabel = customUnitLabel;
      product.customForms = customForms;
      product.price = price;
      product.costPrice = costPrice;
    } else {
      if (data.price !== undefined) product.price = finiteNonNegative(data.price);
      if (data.costPrice !== undefined) product.costPrice = finiteNonNegative(data.costPrice);
    }
    if (data.minStock !== undefined) product.minStock = finiteNonNegative(data.minStock);
    if (data.supplierId !== undefined) product.supplierId = data.supplierId || null;
    const isPersonalizado = product.unit === 'personalizado';
    if (data.expiryDate !== undefined) product.expiryDate = isPersonalizado ? null : (data.expiryDate || null);
    if (data.expiryPromoDays !== undefined) {
      product.expiryPromoDays = !isPersonalizado && product.expiryDate && data.expiryPromoDays !== '' && data.expiryPromoDays != null
        ? Math.floor(finiteNonNegative(data.expiryPromoDays))
        : null;
    }
    if (data.promoPrice !== undefined) {
      product.promoPrice = !isPersonalizado && product.expiryDate && data.promoPrice !== '' && data.promoPrice != null
        ? finiteNonNegative(data.promoPrice)
        : null;
    }
    product.updatedAt = Date.now();
    return product;
  });
}

export async function setProductActive(id, active) {
  await assertActingUserHasPermission('toggleProduct');
  return dbUpdate('products', id, (product) => {
    if (!product) throw new Error('Produto não encontrado.');
    product.active = active;
    product.updatedAt = Date.now();
    return product;
  });
}

export async function deleteProduct(id) {
  await assertActingUserHasPermission('deleteProduct');
  await dbDelete('products', id);
}
