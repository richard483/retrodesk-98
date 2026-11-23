// RetroDesk 98 server: game library + save storage + local mirror of EmulatorJS.
// Games run entirely in the browser; this server only stores files. Zero npm dependencies.
import http from 'node:http';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, readdir, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, RUNTIME_FILES, coreFiles } from './lib/platforms.js';
import { detectFile } from './lib/detect.js';
import { createTstMirror } from './lib/tst.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8098);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
// 4.3.0-pre: PSP hardware rendering works (broken in 4.2.3) and most cores run without Asyncify,
// measured ~50% faster here. Set EJS_VERSION=4.2.3 to go back to the last stable release.
const EJS_VERSION = process.env.EJS_VERSION || '4.3.0-pre';
const EJS_CDN = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;
const PASSWORD = process.env.EMU_PASSWORD || '';
// Browsers download big files in pieces of this size (Range requests), so no single response exceeds a
// proxy's limit (Cloudflare Tunnel: 512 MB). 0 = whole files in one request.
const envMb = (name, def) => { const v = process.env[name]; return Math.max(0, Math.round((v === undefined || v === '' || isNaN(+v) ? def : +v) * 2 ** 20)); };
const DOWNLOAD_CHUNK = envMb('DOWNLOAD_CHUNK_MB', 300);
// Uploads go in pieces of at most this size (Cloudflare Free/Pro: 100 MB per request). When a proxy
// still answers 413, the browser halves the piece and tries again, so stricter limits work too. 0 = one request.
const UPLOAD_CHUNK = envMb('UPLOAD_CHUNK_MB', 90);
const PUBLIC = path.join(ROOT, 'public');
const TST_URL = (process.env.TST_URL || 'https://tabstationtoo.github.io/TabStationToo/').replace(/\/?$/, '/');
const DIRS = { roms: path.join(DATA, 'roms'), saves: path.join(DATA, 'saves'), bios: path.join(DATA, 'bios'), ejs: path.join(DATA, 'ejs', EJS_VERSION), tst: path.join(DATA, 'tst'), incoming: path.join(DATA, 'incoming') };
for (const d of Object.values(DIRS)) await mkdir(d, { recursive: true });

// ---------------- tiny JSON database ----------------
const DB_FILE = path.join(DATA, 'library.json');
let db = existsSync(DB_FILE) ? JSON.parse(await readFile(DB_FILE, 'utf8')) : { games: {}, bios: {} };
let dbWrite = Promise.resolve();
function saveDb() {
  dbWrite = dbWrite.then(async () => {
    await writeFile(DB_FILE + '.tmp', JSON.stringify(db, null, 1));
    await rename(DB_FILE + '.tmp', DB_FILE);
  });
  return dbWrite;
}

// ---------------- helpers ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.zip': 'application/zip', '.data': 'application/octet-stream', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8' };
const send = (res, code, body, type = 'application/json') => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
};
const fail = (res, code, msg) => send(res, code, { error: msg });
const safeName = (n) => path.basename(String(n || 'file')).replace(/[^\w.\- ()[\]!,'&+]/g, '_').slice(0, 200) || 'file';
const titleFromName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*[[(](?!Disc)[^\])]*[\])]/gi, '').replace(/\s+/g, ' ').trim() || n;
async function readBody(req, limit = 64 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('Body too large'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}

// One piece of an upload sent in pieces (?offset=<byte>&total=<size>; without them the body is the whole
// file). The piece is written at `offset` and anything after it from a failed attempt is dropped, so
// retrying a piece is safe. Returns { size, done } once the piece is stored in `tmp`.
async function receivePiece(req, url, tmp) {
  const offset = +(url.searchParams.get('offset') || 0);
  const total = url.searchParams.has('total') ? +url.searchParams.get('total') : null;
  let size = 0; try { size = (await stat(tmp)).size; } catch {}
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw Object.assign(new Error(`Piece at byte ${offset} does not follow the ${size} bytes received`), { code: 409 });
  const fh = await open(tmp, offset === 0 ? 'w' : 'r+');
  try { await fh.truncate(offset); } catch (e) { await fh.close(); throw e; }
  await pipeline(req, fh.createWriteStream({ start: offset })); // closes the handle
  size = (await stat(tmp)).size;
  return { size, done: total === null || size >= total };
}

async function serveFile(req, res, file, { type, cache = 'no-cache', downloadName } = {}) {
  let st;
  try { st = await stat(file); } catch { return fail(res, 404, 'Not found'); }
  if (!st.isFile()) return fail(res, 404, 'Not found');
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const headers = { 'Content-Type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': cache, 'Last-Modified': st.mtime.toUTCString() };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1, code = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? +range[1] : st.size - +range[2];
    end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(file, { start, end }), res).catch(() => {});
}

// ---------------- EmulatorJS mirror (fetched once from the CDN, then served locally) ----------------
const inflight = new Map();
function ejsLocal(rel) {
  const p = path.normalize(path.join(DIRS.ejs, rel));
  if (!p.startsWith(DIRS.ejs + path.sep)) throw Object.assign(new Error('bad path'), { code: 400 });
  return p;
}
async function ensureEjs(rel) {
  const local = ejsLocal(rel);
  if (existsSync(local)) return local;
  if (!inflight.has(rel)) {
    inflight.set(rel, (async () => {
      const r = await fetch(EJS_CDN + rel);
      if (!r.ok) throw Object.assign(new Error(`CDN ${r.status} for ${rel}`), { code: r.status === 404 ? 404 : 502 });
      await mkdir(path.dirname(local), { recursive: true });
      const tmp = local + '.' + randomUUID() + '.part';
      await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
      await rename(tmp, local);
      console.log('[mirror] cached', rel);
      return local;
    })().finally(() => inflight.delete(rel)));
  }
  return inflight.get(rel);
}
// Exact size of a mirrored file. Mirrors it on first ask (the CDN doesn't send
// Content-Length for compressed text files), so later plays are served locally anyway.
async function ejsSize(rel) {
  try { return (await stat(await ensureEjs(rel))).size; } catch (e) { console.warn('[mirror]', e.message); return null; }
}

// ---------------- TabStationToo (PS2) mirror ----------------
const tst = await createTstMirror({ dir: DIRS.tst, source: TST_URL });

// ---------------- library ----------------
function gameView(g) {
  const p = PLATFORMS[g.platform] || PLATFORMS.unknown;
  return { ...g, platformName: p.name, platformShort: p.short, playable: p.playable, romUrl: `/api/games/${g.id}/rom/${encodeURIComponent(g.file)}` };
}

// Pack .cue + its .bin tracks into an uncompressed zip so EmulatorJS gets one file.
async function zipStore(files, out) {
  const ws = createWriteStream(out);
  const write = (b) => new Promise((ok, ko) => ws.write(b, (e) => (e ? ko(e) : ok())));
  const central = []; let offset = 0;
  for (const f of files) {
    let crc = 0; const fh = await open(f.path); const { size } = await fh.stat();
    for await (const chunk of fh.createReadStream()) crc = crc32(chunk, crc);
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    await write(lh); await write(name);
    for await (const chunk of createReadStream(f.path)) await write(chunk);
    central.push({ name, crc, size, offset }); offset += 30 + name.length + size;
  }
  let cdSize = 0;
  for (const c of central) {
    const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x800, 8);
    h.writeUInt32LE(c.crc >>> 0, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24); h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.offset, 42);
    await write(h); await write(c.name); cdSize += 46 + c.name.length;
  }
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length, 8); e.writeUInt16LE(central.length, 10);
  e.writeUInt32LE(cdSize, 12); e.writeUInt32LE(offset, 16);
  await write(e);
  await new Promise((ok) => ws.end(ok));
}

async function addGame(srcPath, name, detectPath = srcPath, detectName = name) {
  const id = randomUUID().slice(0, 8);
  const det = await detectFile(detectPath, detectName).catch((e) => ({ platform: 'unknown', how: 'detection error: ' + e.message }));
  const dir = path.join(DIRS.roms, id);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  await rename(srcPath, dest);
  const { size } = await stat(dest);
  // PS2 volume ids are rarely readable ("SLUS_20946"): use PCSX2's title database, else the file name.
  const title = det.platform === 'ps2' ? (await tst.title(det.serial)) || titleFromName(name)
    : det.title && det.title.length > 2 ? det.title : titleFromName(name);
  const g = {
    id, file: name, size, platform: det.platform, title,
    serial: det.serial || null, detection: det.how, guessed: !!det.guessed, added: Date.now(), lastPlayed: null, playTime: 0,
  };
  db.games[id] = g;
  return g;
}

async function finalizeBatch(batch) {
  const dir = path.join(DIRS.incoming, batch);
  const names = await readdir(dir);
  const used = new Set(); const added = [];
  // cue sheets first: bundle the referenced tracks
  for (const cue of names.filter((n) => /\.cue$/i.test(n))) {
    const text = await readFile(path.join(dir, cue), 'latin1');
    const refs = [...text.matchAll(/FILE\s+"?([^"\r\n]+?)"?\s+(BINARY|MOTOROLA|WAVE|MP3|AIFF)/gi)].map((m) => path.basename(m[1]));
    const present = refs.filter((r) => names.includes(r));
    if (!present.length) continue;
    // PS2 (TabStationToo) reads a single-track .bin directly and cannot read zips: keep the .bin alone.
    if (present.length === 1 && (await detectFile(path.join(dir, present[0]), present[0]).catch(() => ({}))).platform === 'ps2') {
      const g = await addGame(path.join(dir, present[0]), present[0]);
      g.title = titleFromName(cue);
      added.push(g); used.add(cue); used.add(present[0]);
      continue;
    }
    const zipName = cue.replace(/\.cue$/i, '.zip');
    const tmp = path.join(dir, '.bundle-' + randomUUID() + '.zip');
    await zipStore([cue, ...present].map((n) => ({ name: n, path: path.join(dir, n) })), tmp);
    const g = await addGame(tmp, zipName, path.join(dir, present[0]), present[0]);
    g.title = titleFromName(cue); g.bundled = [cue, ...present];
    if (g.platform === 'unknown') Object.assign(g, { platform: 'psx', guessed: true, detection: 'cue/bin bundle (assumed PS1, verify!)' });
    added.push(g); used.add(cue); present.forEach((p) => used.add(p));
  }
  for (const n of names) if (!used.has(n) && !n.startsWith('.')) added.push(await addGame(path.join(dir, n), n));
  await rm(dir, { recursive: true, force: true });
  await saveDb();
  return added;
}

// ---------------- auth (optional, enable with EMU_PASSWORD) ----------------
function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------- router ----------------
async function handle(req, res) {
  // Cross-origin isolation: lets threaded cores (PSP/ppsspp) use SharedArrayBuffer.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="RetroDesk 98"' }); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const M = req.method;
  let m;

  // EmulatorJS 4.3.0-pre fetches PPSSPP's assets from the page-relative "data/cores/ppsspp-assets.zip"
  // instead of its data path (a bug in that release): serve it from the mirror.
  if (p === '/data/cores/ppsspp-assets.zip') return serveFile(req, res, await ensureEjs('cores/ppsspp-assets.zip'), { cache: 'public, max-age=31536000, immutable' });

  // /ejs/<version>/<file>: the version is part of the URL so browser caches never mix releases
  if (p.startsWith('/ejs/')) {
    let rel = p.slice(5);
    if (rel.startsWith(EJS_VERSION + '/')) rel = rel.slice(EJS_VERSION.length + 1);
    else if (/^\d+\.\d+[^/]*\//.test(rel)) return fail(res, 404, `This server runs EmulatorJS ${EJS_VERSION}; reload the page`);
    if (!rel || rel.includes('..')) return fail(res, 400, 'bad path');
    const local = await ensureEjs(rel);
    return serveFile(req, res, local, { cache: 'public, max-age=31536000, immutable' });
  }

  // TabStationToo (PS2), one pinned deploy per build id
  if ((m = p.match(/^\/tst\/([0-9a-f]{6,64})\/(.*)$/))) {
    const [, build, rel] = m;
    if (rel.includes('..')) return fail(res, 400, 'bad path');
    if (rel === '' || rel === 'index.html') {
      await tst.file(build, 'index.html'); // 404 for an old build
      return send(res, 200, await tst.indexHtml(build), 'text/html; charset=utf-8');
    }
    return serveFile(req, res, await tst.file(build, rel), { cache: 'public, max-age=31536000, immutable' });
  }
  if (p === '/api/ps2/emulator' && M === 'GET') return send(res, 200, url.searchParams.has('check') ? await tst.check() : tst.info());
  if (p === '/api/ps2/emulator/update' && M === 'POST') return send(res, 200, await tst.install());

  // PS2 memory cards: the browser's whole card library (TabStationToo keeps it in IndexedDB),
  // packed by the client into one blob. The previous copy is kept as cards.bak.
  if (p === '/api/ps2/cards') {
    const dir = path.join(DIRS.saves, '_ps2'), file = path.join(dir, 'cards.bin');
    if (M === 'GET') {
      if (!existsSync(file)) return fail(res, 404, 'No memory cards on the server yet');
      return serveFile(req, res, file, { cache: 'no-store' });
    }
    if (M === 'PUT') {
      const data = await readBody(req, 256 << 20);
      await mkdir(dir, { recursive: true });
      // A browser whose cards changed while the server's did too keeps its copy here, untouched.
      if (url.searchParams.has('conflict')) { await writeFile(path.join(dir, `cards-conflict-${Date.now()}.bin`), data); return send(res, 200, { kept: true }); }
      if (existsSync(file)) await rename(file, path.join(dir, 'cards.bak'));
      await writeFile(file + '.tmp', data); await rename(file + '.tmp', file);
      db.ps2Cards = { version: +url.searchParams.get('version') || Date.now(), size: data.length, updated: Date.now() }; await saveDb();
      return send(res, 200, db.ps2Cards);
    }
  }
  if (p === '/api/ps2/cards/info' && M === 'GET') return send(res, 200, db.ps2Cards || { version: 0 });

  if (p === '/api/info' && M === 'GET') {
    return send(res, 200, { ejsVersion: EJS_VERSION, platforms: PLATFORMS, runtimeFiles: RUNTIME_FILES, tst: tst.info(), downloadChunk: DOWNLOAD_CHUNK, uploadChunk: UPLOAD_CHUNK });
  }

  // sizes of the emulator files the browser would need for a platform
  if ((m = p.match(/^\/api\/platforms\/([\w]+)\/files$/)) && M === 'GET') {
    const b = db.bios[m[1]];
    const bios = b ? { url: `/api/bios/${m[1]}/${encodeURIComponent(b.file)}?v=${b.mtime}`, size: b.size, file: b.file } : null;
    if (PLATFORMS[m[1]]?.engine === 'tst') {
      await tst.ensure(); // first PS2 game: the server copies the emulator site once (~17 MB)
      return send(res, 200, { engine: 'tst', build: tst.build, core: tst.manifest(), runtime: [], bios });
    }
    const opts = { webgl2: url.searchParams.get('webgl2') !== '0', threads: url.searchParams.get('threads') === '1' };
    const pageRelative = EJS_VERSION.startsWith('4.3') ? new Set(['cores/ppsspp-assets.zip']) : new Set(); // see /data/ route
    const core = await Promise.all(coreFiles(m[1], opts).map(async (f) => ({ path: f, size: await ejsSize(f), ...(pageRelative.has(f) ? { url: '/data/' + f } : {}) })));
    const runtime = await Promise.all(RUNTIME_FILES.map(async (f) => ({ path: f, size: await ejsSize(f) })));
    return send(res, 200, { core, runtime, bios });
  }

  if (p === '/api/games' && M === 'GET') {
    return send(res, 200, Object.values(db.games).map(gameView).sort((a, b) => a.title.localeCompare(b.title)));
  }

  // upload: PUT raw bytes (no multipart) so multi-GB ISOs stream straight to disk
  if (p === '/api/upload' && M === 'PUT') {
    const batch = (url.searchParams.get('batch') || '').replace(/[^\w-]/g, '');
    if (!batch) return fail(res, 400, 'batch required');
    const name = safeName(url.searchParams.get('name'));
    const dir = path.join(DIRS.incoming, batch);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, '.' + name + '.part');
    const r = await receivePiece(req, url, tmp); // a failed piece is resent; finalize ignores leftover .part files
    if (r.done) await rename(tmp, path.join(dir, name));
    return send(res, 200, { ok: true, ...r });
  }
  if (p === '/api/upload/finalize' && M === 'POST') {
    const batch = (url.searchParams.get('batch') || '').replace(/[^\w-]/g, '');
    if (!existsSync(path.join(DIRS.incoming, batch))) return fail(res, 404, 'unknown batch');
    return send(res, 200, (await finalizeBatch(batch)).map(gameView));
  }

  if ((m = p.match(/^\/api\/games\/(\w+)(\/.*)?$/))) {
    const g = db.games[m[1]];
    if (!g) return fail(res, 404, 'No such game');
    const sub = m[2] || '';
    const saveDir = path.join(DIRS.saves, g.id);

    if (!sub && M === 'GET') return send(res, 200, gameView(g));
    if (!sub && M === 'PATCH') {
      const body = JSON.parse((await readBody(req, 1 << 16)).toString() || '{}');
      if (body.title) g.title = String(body.title).slice(0, 200);
      if (body.platform && PLATFORMS[body.platform]) { g.platform = body.platform; g.guessed = false; g.detection = 'set manually'; }
      if (body.played) { g.lastPlayed = Date.now(); g.playTime += Math.max(0, Math.min(+body.seconds || 0, 86400)); }
      await saveDb(); return send(res, 200, gameView(g));
    }
    if (!sub && M === 'DELETE') {
      await rm(path.join(DIRS.roms, g.id), { recursive: true, force: true });
      if (url.searchParams.get('keepSaves') !== '1') await rm(saveDir, { recursive: true, force: true });
      delete db.games[g.id]; await saveDb();
      return send(res, 200, { ok: true });
    }
    if (sub.startsWith('/rom') && (M === 'GET' || M === 'HEAD'))
      return serveFile(req, res, path.join(DIRS.roms, g.id, g.file), { cache: 'no-cache', downloadName: url.searchParams.has('dl') ? g.file : undefined });

    // in-game battery save (SRAM)
    if (sub === '/save') {
      const f = path.join(saveDir, 'save.bin');
      if (M === 'GET') return existsSync(f) ? serveFile(req, res, f) : (res.writeHead(204), res.end());
      if (M === 'PUT' || M === 'POST') { // POST = navigator.sendBeacon on tab close
        const body = await readBody(req);
        await mkdir(saveDir, { recursive: true }); await writeFile(f + '.tmp', body); await rename(f + '.tmp', f);
        g.saveUpdated = Date.now(); await saveDb();
        return send(res, 200, { ok: true, size: body.length });
      }
    }
    // save states, slots 1-9 + "auto"; screenshot stored alongside
    if ((m = sub.match(/^\/states(?:\/(auto|[1-9]))?(\/shot)?$/))) {
      const slot = m[1], shot = !!m[2];
      if (!slot && M === 'GET') {
        const out = [];
        for (const s of ['auto', ...'123456789']) {
          try { const st = await stat(path.join(saveDir, `state-${s}.bin`)); out.push({ slot: s, size: st.size, time: st.mtimeMs, shot: existsSync(path.join(saveDir, `state-${s}.png`)) }); } catch {}
        }
        return send(res, 200, out);
      }
      const f = path.join(saveDir, `state-${slot}.${shot ? 'png' : 'bin'}`);
      if (M === 'GET') return serveFile(req, res, f, { type: shot ? 'image/png' : 'application/octet-stream' });
      if (M === 'PUT') {
        await mkdir(saveDir, { recursive: true });
        const r = await receivePiece(req, url, f + '.part'); // may arrive in pieces (see receivePiece)
        if (!r.done) return send(res, 200, { ok: true, ...r });
        await rename(f + '.part', f);
        if (!shot) { g.stateUpdated = Date.now(); await saveDb(); }
        return send(res, 200, { ok: true });
      }
      if (M === 'DELETE') { await rm(f, { force: true }); await rm(f.replace(/\.bin$/, '.png'), { force: true }); return send(res, 200, { ok: true }); }
    }
    return fail(res, 405, 'Method not allowed');
  }

  // controller mappings, one per console (EmulatorJS control-settings JSON)
  if (p === '/api/controls' && M === 'GET') return send(res, 200, db.controls || {});
  if ((m = p.match(/^\/api\/controls\/(\w+)$/))) {
    if (!PLATFORMS[m[1]]) return fail(res, 404, 'Unknown platform');
    db.controls ||= {};
    if (M === 'GET') return db.controls[m[1]] ? send(res, 200, db.controls[m[1]]) : (res.writeHead(204), res.end());
    if (M === 'PUT') { db.controls[m[1]] = JSON.parse((await readBody(req, 1 << 18)).toString()); await saveDb(); return send(res, 200, { ok: true }); }
    if (M === 'DELETE') { delete db.controls[m[1]]; await saveDb(); return send(res, 200, { ok: true }); }
  }

  // BIOS files (one per platform; zip multiple files together for NDS)
  if (p === '/api/bios' && M === 'GET') return send(res, 200, db.bios);
  if ((m = p.match(/^\/api\/bios\/(\w+)(?:\/.*)?$/))) {
    const plat = m[1];
    if (!PLATFORMS[plat]) return fail(res, 404, 'Unknown platform');
    const dir = path.join(DIRS.bios, plat);
    if (M === 'GET') { const b = db.bios[plat]; return b ? serveFile(req, res, path.join(dir, b.file), { cache: 'public, max-age=31536000, immutable' }) : fail(res, 404, 'No BIOS'); }
    if (M === 'PUT') {
      if (!PLATFORMS[plat].bios) return fail(res, 400, `${PLATFORMS[plat].name} does not use a BIOS`);
      const name = safeName(url.searchParams.get('name'));
      // received next to the folder, so a failed upload leaves the current BIOS in place
      const tmp = path.join(DIRS.bios, `.${plat}.part`);
      const r = await receivePiece(req, url, tmp);
      if (!r.done) return send(res, 200, { ok: true, ...r });
      await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
      await rename(tmp, path.join(dir, name));
      const st = await stat(path.join(dir, name));
      db.bios[plat] = { file: name, size: st.size, mtime: Math.round(st.mtimeMs) }; await saveDb();
      return send(res, 200, db.bios[plat]);
    }
    if (M === 'DELETE') { await rm(dir, { recursive: true, force: true }); delete db.bios[plat]; await saveDb(); return send(res, 200, { ok: true }); }
  }

  if (p.startsWith('/api/')) return fail(res, 404, 'Unknown endpoint');

  // static frontend
  const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!file.startsWith(PUBLIC)) return fail(res, 400, 'bad path');
  return serveFile(req, res, file, { cache: p.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e.code !== 404) console.error(req.method, req.url, e);
    if (!res.headersSent) fail(res, typeof e.code === 'number' ? e.code : 500, e.message);
    else res.destroy();
  });
});
server.requestTimeout = 0; // allow very long uploads
server.listen(PORT, HOST, () => {
  console.log(`RetroDesk 98 running at http://localhost:${PORT}  (data: ${DATA})`);
  if (!PASSWORD) console.log('Tip: set EMU_PASSWORD=... to require a password (recommended if exposed beyond your LAN).');
});
