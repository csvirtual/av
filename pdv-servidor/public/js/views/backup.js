// Extração PARCIAL de views/backup.js da extensão — só as duas funções
// utilitárias, puras e sem dependência de IndexedDB nenhuma, que
// views/caixa.js precisa (`downloadBlob`, `timestampForFilename`, ver
// import em caixa.js), copiadas byte-a-byte. A tela de Backup real (com
// export/import/preview, gate pela permissão 'backup') ainda não foi
// portada — quando for a vez dela, este arquivo vira a cópia verbatim
// completa da extensão, que já inclui estas duas funções sem mudança
// nenhuma (mesmo padrão incremental já usado em data/cashRepo.js, que
// também nasceu parcial numa fase anterior e foi completado depois).

export function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
