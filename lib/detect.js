// Console detection from file contents (magic bytes / disc filesystems), falling back to
// the file extension. Only reads a few KB from the file, so it's fast even on 8 GB ISOs.
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { EXT_MAP } from './platforms.js';

const ascii = (buf, s = 0, e = buf.length) => buf.toString('latin1', s, e).replace(/\0.*$/s, '').trim();
const printable = (s) => s.replace(/[^\x20-\x7e]/g, '').trim();
const eq = (buf, off, bytes) => bytes.every((b, i) => buf[off + i] === b);

class Reader {
  constructor(fh, size) { this.fh = fh; this.size = size; }
  async read(pos, len) {
    if (pos >= this.size) return Buffer.alloc(0);
    len = Math.min(len, this.size - pos);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await this.fh.read(buf, 0, len, pos);
    return buf.subarray(0, bytesRead);
  }
}

// ---------- ISO 9660 helpers (works for 2048-byte ISOs and raw 2352-byte BIN images) ----------
async function discLayout(r) {
  const head = await r.read(0, 16);
  const sync = [0x00, ...Array(10).fill(0xff), 0x00];
  if (eq(head, 0, sync)) {
    const mode = (await r.read(15, 1))[0];
    return { sector: 2352, offset: mode === 2 ? 24 : 16 };
  }
  return { sector: 2048, offset: 0 };
}

async function readSector(r, L, lba, count = 1) {
  if (L.sector === 2048) return r.read(lba * 2048, 2048 * count);
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(await r.read((lba + i) * L.sector + L.offset, 2048));
  return Buffer.concat(parts);
}

async function isoRootFiles(r, L) {
  const pvd = await readSector(r, L, 16);
  if (pvd.length < 2048 || ascii(pvd, 1, 6) !== 'CD001') return null;
  const systemId = ascii(pvd, 8, 40);
  const volumeId = ascii(pvd, 40, 72);
  const rootLba = pvd.readUInt32LE(156 + 2);
  const rootLen = pvd.readUInt32LE(156 + 10);
  const dir = await readSector(r, L, rootLba, Math.min(Math.ceil(rootLen / 2048), 8));
  const files = {};
  for (let i = 0; i < dir.length;) {
    const len = dir[i];
    if (!len) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
    const nameLen = dir[i + 32];
    const name = ascii(dir, i + 33, i + 33 + nameLen).replace(/;1$/, '').toUpperCase();
    files[name] = { lba: dir.readUInt32LE(i + 2), size: dir.readUInt32LE(i + 10), dir: !!(dir[i + 25] & 2) };
    i += len;
  }
  return { systemId, volumeId, files };
}

async function readIsoFile(r, L, f, max = 4096) {
  const n = Math.ceil(Math.min(f.size, max) / 2048);
  return (await readSector(r, L, f.lba, n)).subarray(0, Math.min(f.size, max));
}

function serialFromSystemCnf(text) {
  const m = text.match(/BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4}[_-]?\d{3}\.?\d{2})/i);
  return m ? m[1].toUpperCase() : null;
}

function parseSfo(buf) {
  if (buf.readUInt32LE(0) !== 0x46535000) return {};
  const keyT = buf.readUInt32LE(8), dataT = buf.readUInt32LE(12), n = buf.readUInt32LE(16);
  const out = {};
  for (let i = 0; i < n; i++) {
    const e = 20 + i * 16;
    const key = ascii(buf, keyT + buf.readUInt16LE(e), keyT + buf.readUInt16LE(e) + 64);
    const fmt = buf.readUInt16LE(e + 2), len = buf.readUInt32LE(e + 4), off = dataT + buf.readUInt32LE(e + 12);
    out[key] = fmt === 0x0404 ? buf.readUInt32LE(off) : ascii(buf, off, off + len);
  }
  return out;
}

async function detectDisc(r) {
  const L = await discLayout(r);
  const first = await readSector(r, L, 0);
  const hdr = ascii(first, 0, 16);
  if (hdr.startsWith('SEGADISCSYSTEM')) return { platform: 'segaCD', title: printable(ascii(first, 0x150, 0x180)), how: 'Sega CD disc header' };
  if (hdr.startsWith('SEGA SEGASATURN')) return { platform: 'segaSaturn', title: printable(ascii(first, 0x60, 0xd0)), serial: printable(ascii(first, 0x20, 0x2a)), how: 'Saturn disc header' };
  // GameCube / Wii (plain ISO only; compressed formats are handled by magic below)
  if (L.sector === 2048 && first.length >= 0x40) {
    if (first.readUInt32BE(0x1c) === 0xc2339f3d) return { platform: 'gamecube', title: printable(ascii(first, 0x20, 0x60)), serial: ascii(first, 0, 6), how: 'GameCube disc magic' };
    if (first.readUInt32BE(0x18) === 0x5d1c9ea3) return { platform: 'wii', title: printable(ascii(first, 0x20, 0x60)), serial: ascii(first, 0, 6), how: 'Wii disc magic' };
  }
  const iso = await isoRootFiles(r, L);
  if (!iso) {
    // 3DO uses the Opera filesystem: record type 1, sync bytes 5x 0x5A
    if (first[0] === 1 && eq(first, 1, [0x5a, 0x5a, 0x5a, 0x5a, 0x5a])) return { platform: '3do', how: '3DO Opera filesystem' };
    return null;
  }
  if (iso.systemId.includes('PSP GAME') || iso.files['UMD_DATA.BIN'] || iso.files['PSP_GAME']) {
    let serial = null, title = null;
    if (iso.files['UMD_DATA.BIN']) serial = ascii(await readIsoFile(r, L, iso.files['UMD_DATA.BIN'], 64)).split('|')[0];
    if (iso.files['PSP_GAME']?.dir) {
      const sub = await readSector(r, L, iso.files['PSP_GAME'].lba);
      for (let i = 0; i < sub.length && sub[i];) {
        const nm = ascii(sub, i + 33, i + 33 + sub[i + 32]).replace(/;1$/, '');
        if (nm === 'PARAM.SFO') {
          const sfo = parseSfo(await readIsoFile(r, L, { lba: sub.readUInt32LE(i + 2), size: sub.readUInt32LE(i + 10) }, 8192));
          title = sfo.TITLE || null; serial = sfo.DISC_ID || serial;
        }
        i += sub[i];
      }
    }
    return { platform: 'psp', title, serial, how: 'PSP UMD filesystem' };
  }
  if (iso.files['SYSTEM.CNF']) {
    const cnf = (await readIsoFile(r, L, iso.files['SYSTEM.CNF'])).toString('latin1');
    const serial = serialFromSystemCnf(cnf);
    if (/BOOT2\s*=/i.test(cnf)) return { platform: 'ps2', serial, title: iso.volumeId || null, how: 'SYSTEM.CNF has BOOT2 (PS2)' };
    if (/BOOT\s*=/i.test(cnf)) return { platform: 'psx', serial, title: iso.volumeId || null, how: 'SYSTEM.CNF has BOOT (PS1)' };
  }
  if (iso.systemId.startsWith('PLAYSTATION')) return { platform: r.size > 900e6 ? 'ps2' : 'psx', title: iso.volumeId, how: 'ISO system id PLAYSTATION' };
  if (iso.files['PSP_GAME']) return { platform: 'psp', how: 'PSP_GAME folder' };
  return null;
}

// ---------- ZIP: inspect entries (central directory) ----------
async function zipEntries(r) {
  const tailLen = Math.min(r.size, 65557);
  const tail = await r.read(r.size - tailLen, tailLen);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  const cd = await r.read(cdOff, Math.min(cdSize, 4 << 20));
  const out = [];
  for (let i = 0, k = 0; k < count && i + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(i) !== 0x02014b50) break;
    const method = cd.readUInt16LE(i + 10), csize = cd.readUInt32LE(i + 20), usize = cd.readUInt32LE(i + 24);
    const nl = cd.readUInt16LE(i + 28), xl = cd.readUInt16LE(i + 30), cl = cd.readUInt16LE(i + 32);
    const local = cd.readUInt32LE(i + 42);
    out.push({ name: cd.toString('utf8', i + 46, i + 46 + nl), method, csize, usize, local });
    i += 46 + nl + xl + cl;
  }
  return out;
}

async function zipEntryHead(r, e, len = 0x10000) {
  const lh = await r.read(e.local, 30);
  const start = e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  if (e.method === 0) return r.read(start, Math.min(len, e.usize));
  if (e.method === 8) {
    const comp = await r.read(start, Math.min(e.csize, 4 << 20));
    try { return inflateRawSync(comp, { finishFlush: 2 /* Z_SYNC_FLUSH */ }).subarray(0, len); } catch { return null; }
  }
  return null;
}

class BufReader { constructor(b) { this.b = b; this.size = b.length; } async read(p, l) { return this.b.subarray(p, p + l); } }

// ---------- cartridge / file magic ----------
function detectBuffer(b, size, ext) {
  if (b.length >= 4 && eq(b, 0, [0x4e, 0x45, 0x53, 0x1a])) return { platform: 'nes', how: 'iNES header' };
  if (b.length >= 4 && eq(b, 0, [0x46, 0x44, 0x53, 0x1a])) return { platform: 'nes', how: 'Famicom Disk System header' };
  if (b.length >= 0x40) {
    const m = b.readUInt32BE(0);
    if (m === 0x80371240) return { platform: 'n64', title: printable(ascii(b, 0x20, 0x34)), serial: ascii(b, 0x3b, 0x3f), how: 'N64 header (big-endian .z64)' };
    if (m === 0x37804012) { const t = Buffer.from(b.subarray(0x20, 0x34)).swap16(); return { platform: 'n64', title: printable(ascii(t)), how: 'N64 header (byte-swapped .v64)' }; }
    if (m === 0x40123780) return { platform: 'n64', how: 'N64 header (little-endian .n64)' };
  }
  if (b.length >= 0x200 && b.readUInt32BE(0xc0) === 0x24ffae51 && b[0x15c] === 0x56 && b[0x15d] === 0xcf)
    return { platform: 'nds', title: printable(ascii(b, 0, 12)), serial: ascii(b, 0x0c, 0x10), how: 'NDS header + logo' };
  if (b.length >= 0xc0 && b.readUInt32BE(0x04) === 0x24ffae51 && b[0xb2] === 0x96)
    return { platform: 'gba', title: printable(ascii(b, 0xa0, 0xac)), serial: ascii(b, 0xac, 0xb0), how: 'GBA header + logo' };
  if (b.length >= 0x150 && b.readUInt32BE(0x104) === 0xceed6666)
    return { platform: 'gb', title: printable(ascii(b, 0x134, 0x143)), how: (b[0x143] & 0x80) ? 'Game Boy Color header' : 'Game Boy header' };
  if (b.length >= 0x200 && ascii(b, 0x100, 0x104) === 'SEGA') {
    const sys = ascii(b, 0x100, 0x110);
    return { platform: /32X/.test(sys) || ext === '32x' ? 'sega32x' : 'segaMD', title: printable(ascii(b, 0x150, 0x180)), serial: printable(ascii(b, 0x180, 0x18e)), how: 'Sega cartridge header' };
  }
  for (const off of [0x7ff0, 0x3ff0, 0x1ff0])
    if (b.length >= off + 8 && ascii(b, off, off + 8) === 'TMR SEGA') return { platform: ext === 'gg' ? 'segaGG' : 'segaMS', how: 'TMR SEGA header' };
  if (b.length >= 4 && eq(b, 0, [0x00, 0x50, 0x42, 0x50])) return null; // PBP handled separately
  if (b.length >= 4 && ascii(b, 0, 4) === 'CISO') return { platform: 'psp', how: 'CSO (compressed ISO) magic' };
  if (b.length >= 4 && ascii(b, 0, 4) === 'ZISO') return { platform: 'psp', how: 'ZSO magic' };
  if (b.length >= 4 && ascii(b, 0, 4) === 'RVZ\x01') return { platform: 'gamecube', how: 'RVZ magic (GameCube/Wii)' };
  if (b.length >= 4 && b.readUInt32LE(0) === 0xb10bc001) return { platform: 'gamecube', how: 'GCZ magic (GameCube/Wii)' };
  if (b.length >= 4 && ascii(b, 0, 4) === 'WBFS') return { platform: 'wii', how: 'WBFS magic' };
  if (b.length >= 4 && ascii(b, 0, 4) === 'LYNX') return { platform: 'lynx', how: 'Lynx header' };
  if (b.length >= 16 && ascii(b, 1, 10) === 'ATARI7800') return { platform: 'atari7800', how: 'A78 header' };
  // SNES: validate checksum/complement pair in LoROM/HiROM header (with/without 512-byte copier header)
  for (const base of [0x7fc0, 0xffc0, 0x81c0, 0x101c0]) {
    if (b.length < base + 0x20) continue;
    const comp = b.readUInt16LE(base + 0x1c), sum = b.readUInt16LE(base + 0x1e);
    if (((comp ^ sum) & 0xffff) === 0xffff && sum !== 0 && sum !== 0xffff)
      return { platform: 'snes', title: printable(ascii(b, base, base + 21)), how: 'SNES internal header checksum' };
  }
  return null;
}

async function detectPbp(r) {
  const h = await r.read(0, 0x28);
  if (!eq(h, 0, [0x00, 0x50, 0x42, 0x50])) return null;
  const sfoOff = h.readUInt32LE(0x08), iconOff = h.readUInt32LE(0x0c);
  const sfo = parseSfo(await r.read(sfoOff, Math.min(iconOff - sfoOff, 16384)));
  const isPs1 = sfo.CATEGORY === 'ME' || (await r.read(h.readUInt32LE(0x24), 8)).toString('latin1') === 'PSISOIMG' || (await r.read(h.readUInt32LE(0x24), 8)).toString('latin1') === 'PSTITLEI';
  return { platform: isPs1 ? 'psx' : 'psp', title: sfo.TITLE || null, serial: sfo.DISC_ID || null, how: isPs1 ? 'PBP EBOOT (PS1 Classic)' : 'PBP EBOOT (PSP)' };
}

export async function detectFile(path, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const r = new Reader(fh, size);
    const head = await r.read(0, 0x10200 + 0x40);

    if (ext === 'chd' || ascii(head, 0, 8) === 'MComprHD') {
      // CHD is compressed; metadata parsing would need a decompressor. Guess by size.
      return { platform: size > 900e6 ? 'ps2' : 'psx', how: 'CHD image (guessed from size, verify!)', guessed: true };
    }
    if (ext === 'cue' || ext === 'm3u') return { platform: 'psx', how: '.cue/.m3u sheet (assumed PS1)', guessed: true };
    const pbp = await detectPbp(r); if (pbp) return pbp;

    if (eq(head, 0, [0x50, 0x4b, 0x03, 0x04])) {
      const entries = await zipEntries(r) || [];
      if (entries.some(e => /^(sce_sys\/|eboot\.bin$)/i.test(e.name))) return { platform: 'psvita', how: 'VPK/zip with sce_sys (PS Vita)' };
      const files = entries.filter(e => !e.name.endsWith('/')).sort((a, b) => b.usize - a.usize);
      for (const e of files.slice(0, 3)) {
        const buf = await zipEntryHead(r, e);
        const iext = e.name.split('.').pop().toLowerCase();
        if (buf) {
          const d = detectBuffer(buf, e.usize, iext) || (['iso', 'bin', 'img'].includes(iext) ? await detectDisc(new BufReader(buf)).catch(() => null) : null);
          if (d) return { ...d, how: `${d.how} (inside zip: ${e.name})` };
        }
        if (EXT_MAP[iext]) return { platform: EXT_MAP[iext], how: `zip contains .${iext}` };
      }
      if (files.some(e => /\.(cue|bin)$/i.test(e.name))) return { platform: 'psx', how: 'zip contains .cue/.bin', guessed: true };
      return { platform: 'arcade', how: 'zip with no recognised ROM inside (assumed arcade set)', guessed: true };
    }

    const cart = detectBuffer(head, size, ext);
    if (cart) return cart;
    if (['iso', 'bin', 'img', 'mdf', 'gcm'].includes(ext) || size > 32 << 20) {
      const d = await detectDisc(r).catch(() => null);
      if (d) return d;
    }
    if (EXT_MAP[ext]) return { platform: EXT_MAP[ext], how: `file extension .${ext}` };
    if (ext === 'iso') return { platform: 'unknown', how: 'ISO with unrecognised filesystem' };
    return { platform: 'unknown', how: 'no match' };
  } finally {
    await fh.close();
  }
}
