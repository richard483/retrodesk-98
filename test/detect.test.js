import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { detectFile } from '../lib/detect.js';

const dir = await mkdtemp(path.join(tmpdir(), 'detect-'));
async function check(name, buf, platform) {
  const p = path.join(dir, name);
  await writeFile(p, buf);
  const d = await detectFile(p, name);
  assert.equal(d.platform, platform, `${name}: got ${d.platform} (${d.how})`);
  return d;
}

// Minimal ISO9660 image: files = {NAME: Buffer}; systemId in PVD
function iso(files, systemId = '', sectorSize = 2048) {
  const S = 2048, sectors = [];
  const names = Object.keys(files);
  const total = 20 + names.length * 4;
  for (let i = 0; i < total; i++) sectors.push(Buffer.alloc(S));
  const pvd = sectors[16]; pvd[0] = 1; pvd.write('CD001', 1); pvd.write(systemId.padEnd(32), 8); pvd.write('TESTVOL'.padEnd(32), 40);
  const rec = (lba, size, name, isDir) => { const n = Buffer.from(name); const r = Buffer.alloc(33 + n.length + (n.length % 2 ? 0 : 1)); r[0] = r.length; r.writeUInt32LE(lba, 2); r.writeUInt32LE(size, 10); r[25] = isDir ? 2 : 0; r[32] = n.length; n.copy(r, 33); return r; };
  rec(18, 2048, '\0', true).copy(pvd, 156);
  let off = 0, lba = 20;
  for (const nm of names) {
    const data = files[nm]; const r = rec(lba, data.length, nm + ';1');
    r.copy(sectors[18], off); off += r.length; data.copy(sectors[lba]); lba += 4;
  }
  if (sectorSize === 2048) return Buffer.concat(sectors);
  return Buffer.concat(sectors.map((s) => { const raw = Buffer.alloc(2352); raw.fill(0xff, 1, 11); raw[15] = 2; s.copy(raw, 24); return raw; }));
}

test('cartridges', async () => {
  await check('a.nes', Buffer.concat([Buffer.from('NES\x1a'), Buffer.alloc(40000)]), 'nes');
  const n64 = Buffer.alloc(0x1000); n64.writeUInt32BE(0x80371240, 0); n64.write('SUPER MARIO 64', 0x20); 
  assert.equal((await check('m.z64', n64, 'n64')).title, 'SUPER MARIO 64');
  const gba = Buffer.alloc(0x200); gba.writeUInt32BE(0x24ffae51, 4); gba[0xb2] = 0x96; gba.write('POKEMON EMER', 0xa0);
  await check('p.bin', gba, 'gba');
  const gb = Buffer.alloc(0x8000); gb.writeUInt32BE(0xceed6666, 0x104); gb.write('TETRIS', 0x134);
  await check('t.gb', gb, 'gb');
  const nds = Buffer.alloc(0x1000); nds.writeUInt32BE(0x24ffae51, 0xc0); nds[0x15c] = 0x56; nds[0x15d] = 0xcf;
  await check('x.nds', nds, 'nds');
  const md = Buffer.alloc(0x400); md.write('SEGA MEGA DRIVE ', 0x100); md.write('SONIC THE HEDGEHOG', 0x150);
  await check('s.bin', md, 'segaMD');
  const snes = Buffer.alloc(0x10000); snes.write('SUPER METROID        ', 0x7fc0); snes.writeUInt16LE(0x1234 ^ 0xffff, 0x7fdc); snes.writeUInt16LE(0x1234, 0x7fde);
  await check('sm.smc', snes, 'snes');
  await check('unknown.sfc', Buffer.alloc(100), 'snes'); // falls back to extension
});

test('discs', async () => {
  const d1 = await check('ff7.iso', iso({ 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\SCUS_941.63;1\r\nTCB = 4\r\n') }, 'PLAYSTATION'), 'psx');
  assert.equal(d1.serial, 'SCUS_941.63');
  await check('ff7.bin', iso({ 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\SCUS_941.63;1\r\n') }, 'PLAYSTATION', 2352), 'psx');
  const d2 = await check('gow.iso', iso({ 'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\SCUS_973.99;1\r\nVER = 1.00\r\n') }, 'PLAYSTATION'), 'ps2');
  assert.equal(d2.serial, 'SCUS_973.99');
  await check('psp.iso', iso({ 'UMD_DATA.BIN': Buffer.from('ULUS-10041|0001|G') }, 'PSP GAME'), 'psp');
  const gc = Buffer.alloc(0x10000); gc.write('GALE01', 0); gc.writeUInt32BE(0xc2339f3d, 0x1c); gc.write('Super Smash Bros Melee', 0x20);
  await check('melee.iso', gc, 'gamecube');
  await check('game.cso', Buffer.concat([Buffer.from('CISO'), Buffer.alloc(100)]), 'psp');
});

test('zip and vpk', async () => {
  const zip = (entries) => {
    const parts = [], cd = []; let off = 0;
    for (const [name, data] of entries) {
      const comp = deflateRawSync(data), n = Buffer.from(name);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      parts.push(lh, n, comp);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      cd.push(c, n); off += 30 + n.length + comp.length;
    }
    const cdb = Buffer.concat(cd); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cdb, e]);
  };
  await check('mario.zip', zip([['mario.nes', Buffer.concat([Buffer.from('NES\x1a'), Buffer.alloc(4000)])]]), 'nes');
  await check('game.vpk', zip([['eboot.bin', Buffer.alloc(10)], ['sce_sys/param.sfo', Buffer.alloc(10)]]), 'psvita');
  await check('weird.zip', zip([['weird.gba', Buffer.alloc(10)]]), 'gba');
});

// Compressed ISOs (CSO: deflate, ZSO: LZ4) hold PSP and PS2 games: the ISO inside decides.
function compressed(isoBuf, magic, block = 2048) {
  const n = Math.ceil(isoBuf.length / block);
  const lz4Literal = (b) => { // valid LZ4 block made only of literals
    const out = [Math.min(b.length, 15) << 4];
    if (b.length >= 15) { let rest = b.length - 15; while (rest >= 255) { out.push(255); rest -= 255; } out.push(rest); }
    return Buffer.concat([Buffer.from(out), b]);
  };
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const raw = isoBuf.subarray(i * block, (i + 1) * block);
    blocks.push(magic === 'CISO' ? deflateRawSync(raw) : lz4Literal(raw));
  }
  const header = Buffer.alloc(24); header.write(magic, 0); header.writeUInt32LE(24, 4); header.writeBigUInt64LE(BigInt(isoBuf.length), 8); header.writeUInt32LE(block, 16); header[20] = 1;
  const idx = Buffer.alloc((n + 1) * 4);
  let pos = 24 + idx.length;
  blocks.forEach((b, i) => { idx.writeUInt32LE(pos, i * 4); pos += b.length; });
  idx.writeUInt32LE(pos, n * 4);
  return Buffer.concat([header, idx, ...blocks]);
}

test('compressed discs', async () => {
  const ps2 = iso({ 'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\SLUS_209.46;1\r\n') }, 'PLAYSTATION');
  const psp = iso({ 'UMD_DATA.BIN': Buffer.from('ULUS-10041|0001|G') }, 'PSP GAME');
  assert.equal((await check('ps2.cso', compressed(ps2, 'CISO'), 'ps2')).serial, 'SLUS_209.46');
  await check('psp.cso', compressed(psp, 'CISO'), 'psp');
  await check('ps2.zso', compressed(ps2, 'ZISO'), 'ps2');
  await check('psp.zso', compressed(psp, 'ZISO'), 'psp');
  // CHD: the metadata says CD or DVD
  const chd = (tag, logical) => {
    const h = Buffer.alloc(0x80); h.write('MComprHD', 0); h.writeUInt32BE(124, 8); h.writeUInt32BE(5, 12);
    h.writeBigUInt64BE(BigInt(logical), 0x20); h.writeBigUInt64BE(0x7cn, 0x30); // metadata right after the header
    const m = Buffer.alloc(16); m.write(tag, 0); return Buffer.concat([h.subarray(0, 0x7c), m, Buffer.alloc(64)]);
  };
  await check('big.chd', chd('DVD ', 4.2e9), 'ps2');
  const cd = await check('cd.chd', chd('CHT2', 6e8), 'psx');
  assert.ok(cd.guessed);
});
