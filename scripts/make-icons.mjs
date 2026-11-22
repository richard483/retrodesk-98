// Renders the pixel-art gamepad icon to PNG app icons (PWA / home screen). No dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { ART, P } from '../public/icons.js';

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const expand = (c) => (c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c);
const BG = hex('#008080');

function png(size, art, padFrac) {
  const px = Buffer.alloc(size * size * 3);
  const pad = Math.round(size * padFrac), cell = Math.floor((size - 2 * pad) / 16), off = Math.floor((size - cell * 16) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor((x - off) / cell), cy = Math.floor((y - off) / cell);
    const ch = cx >= 0 && cx < 16 && cy >= 0 && cy < 16 ? art[cy][cx] : '.';
    const rgb = P[ch] ? hex(expand(P[ch])) : BG;
    rgb.forEach((v, i) => (px[(y * size + x) * 3 + i] = v));
  }
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/icons/', import.meta.url);
for (const [name, size, pad] of [['icon-180', 180, 0.08], ['icon-192', 192, 0.08], ['icon-512', 512, 0.08], ['icon-512-maskable', 512, 0.2]])
  writeFileSync(new URL(name + '.png', out), png(size, ART.gamepad, pad));
console.log('icons written to public/icons/');
