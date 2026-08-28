// Native ZIP writer — no dependency (ARCHITECTURE.md §16: the ZIP format is
// simple enough — local headers + central directory + EOCD — that a ~100KB
// library is not justified just for this). Uses CompressionStream('deflate-raw')
// when the runtime has it (real compression); otherwise falls back to the
// ZIP "store" method (0% compression, still a fully valid, readable archive).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  return new Uint8Array([n & 255, (n >> 8) & 255]);
}
function u32(n) {
  return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
}
function concatBytes(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * @param {Array<{name:string, content:string|Uint8Array}>} files
 * @returns {Promise<{blob:Blob, bytes:Uint8Array}>}
 */
export async function createZip(files) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/\\/g, '/'));
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const compressed = await deflateRaw(dataBytes);
    const method = compressed ? 8 : 0;
    const payload = compressed || dataBytes;

    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(time), u16(day),
      u32(crc), u32(payload.length), u32(dataBytes.length), u16(nameBytes.length), u16(0),
    ]);
    localChunks.push(localHeader, nameBytes, payload);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(time), u16(day),
      u32(crc), u32(payload.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
    ]);
    centralChunks.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralBytes = concatBytes(centralChunks);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ]);

  const bytes = concatBytes([...localChunks, centralBytes, eocd]);
  const blob = typeof Blob !== 'undefined' ? new Blob([bytes], { type: 'application/zip' }) : null;
  return { blob, bytes };
}

export { crc32 };
