// One-off generator for placeholder extension icons (solid rounded square,
// brand navy background + gold "A"). Pure Node (zlib), no dependency.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function makePng(size) {
  const bg = [0x21, 0x2c, 0x50]; // navy
  const fg = [0xc6, 0xa7, 0x5e]; // gold
  const raw = Buffer.alloc(size * (1 + size * 4));
  const pad = Math.round(size * 0.2);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      // simple "A" glyph approximation: diagonal stripes forming a triangle
      const inPad = x < pad || x >= size - pad || y < pad || y >= size - pad;
      const cx = size / 2;
      const distFromCenterLine = Math.abs(x - cx) - (y * 0.35);
      const isGlyph = !inPad && Math.abs(distFromCenterLine) < size * 0.09;
      const c = isGlyph ? fg : bg;
      raw[px] = c[0];
      raw[px + 1] = c[1];
      raw[px + 2] = c[2];
      raw[px + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), makePng(size));
  console.log(`icon-${size}.png written`);
}
