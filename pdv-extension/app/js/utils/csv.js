// Formato CSV compartilhado com o pdv-servidor (public/js/utils/csv.js) —
// mesmas colunas nos dois produtos, de propósito: um CSV exportado de um
// serve de entrada pro outro. É a ponte real de migração de catálogo entre
// os dois, já que o backup de cada um (cifrado, mas com formato interno
// diferente — object store do IndexedDB aqui, tabela SQL lá) não é.
export const PRODUCT_CSV_COLUMNS = [
  'barcode', 'name', 'category', 'unit', 'customUnitLabel',
  'price', 'costPrice', 'quantity', 'minStock',
  'expiryDate', 'expiryPromoDays', 'promoPrice', 'customForms',
];

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function stringifyCsv(columns, rows) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map((col) => csvEscape(row[col])).join(','));
  return lines.join('\r\n');
}

// Parser RFC 4180 mínimo: aspas duplas escapam com "", campo pode conter
// vírgula/quebra de linha se estiver entre aspas. De propósito não usa
// split(',') ingênuo — quebraria silenciosamente em qualquer nome de
// produto com vírgula (ex: `Parafuso, 3/4`) ou aspas.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

// BOM (﻿) na frente do arquivo: sem isso o Excel abre um CSV UTF-8 com
// acento (nome de produto é o caso comum: "Argamassa ACIII") interpretando
// como Latin-1 e mostrando lixo no lugar de cada char acentuado.
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
