// Local mirror of TabStationToo (PCSX2 compiled to WebAssembly, GPL-3.0, by the TabStationToo
// developers: https://github.com/TabStationToo/TabStationToo), used to run PS2 games.
//
// The project publishes a static site (GitHub Pages) but no release archives. We copy one deploy of
// that site into DATA/tst/<build>/, where <build> is the build id the site stamps into index.html,
// and serve it from /tst/<build>/. Pinning a whole deploy keeps the page, the wasm module and its
// workers from the same build; an update downloads the next deploy beside it and switches over.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// Every file of the published site (pcsx2-wasm/web/ plus the build outputs), as of the
// 2026-11 deploys. A file a later deploy adds is fetched on first request (see file()).
export const TST_FILES = [
  'index.html', 'app.js', 'style.css', 'isolation.js', 'coi-serviceworker.js', 'disc-worker.js', 'cable-worker.js',
  'audio-tap.js', 'icons.svg', 'favicon.svg', 'game-titles.tsv',
  'pcsx2-wasm.js', 'pcsx2-wasm.wasm', 'pcsx2-wasm.data',
  'fonts/archivo.woff2', 'fonts/chivo-mono.woff2',
  'library/console-bar.css', 'library/console-pads.css', 'library/console-tv.css', 'library/disc-library.css',
  'library/disc-art.js', 'library/disc-clean.js', 'library/disc-info.js', 'library/disc-library.js',
  'library/folder.js', 'library/player-library.js', 'library/ps2.webp',
  'vendor/matter.min.js',
  'COPYING-NOTICE.txt', // written by us, not fetched (see install)
  'coi-serviceworker-LICENSE.txt', 'fonts/Archivo-OFL.txt', 'fonts/ChivoMono-OFL.txt', 'icons/Phosphor-LICENSE.txt',
  'library/ps2-photo.txt', 'vendor/matter-js-LICENSE.txt',
];
const OPTIONAL = new Set(['game-titles.tsv', 'COPYING-NOTICE.txt']);
// The emulator itself; the rest is the page around it.
export const TST_CORE = ['pcsx2-wasm.js', 'pcsx2-wasm.wasm', 'pcsx2-wasm.data'];

const NOTICE = (source, build) => `This folder is a copy of one deploy of TabStationToo (build ${build}),
downloaded from ${source}

TabStationToo is free software under the GNU General Public License v3.0 or later.
Source code: https://github.com/TabStationToo/TabStationToo
It is built on PCSX2 (https://github.com/PCSX2/pcsx2). Neither project is affiliated with RetroDesk 98.

RetroDesk serves these files unchanged, except that index.html gets two extra lines when it is
served (a stylesheet and a class switch for the compact game-window layout, public/tst-embed.css).
`;

// What RetroDesk adds to index.html when serving it: the compact layout for game windows (?rd=1).
const INJECT = `<script>/* RetroDesk 98 */if(new URLSearchParams(location.search).has('rd'))document.documentElement.classList.add('rd-embed','rd-compact')</script><link rel="stylesheet" href="/tst-embed.css">`;

export async function createTstMirror({ dir, source }) {
  await mkdir(dir, { recursive: true });
  const currentFile = path.join(dir, 'current.json');
  let current = null; // { build, fetched, source, files: { rel: size } }
  try { current = JSON.parse(await readFile(currentFile, 'utf8')); if (!existsSync(path.join(dir, current.build, 'index.html'))) current = null; } catch {}
  let installing = null;
  const lazy = new Map();

  async function fetchTo(url, file) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`TabStationToo site: HTTP ${r.status} for ${url}`), { code: r.status === 404 ? 404 : 502 });
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.part';
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    await rename(tmp, file);
  }

  async function upstreamIndex() {
    const r = await fetch(source + 'index.html', { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`TabStationToo site: HTTP ${r.status}`), { code: 502 });
    const html = await r.text();
    const build = (/\?v=([0-9a-f]{6,})/.exec(html) || [])[1] || createHash('sha256').update(html).digest('hex').slice(0, 12);
    return { html, build };
  }

  // Downloads the deploy the site serves now, unless it is the one we have. Single-flight.
  function install({ force = false } = {}) {
    if (installing) return installing;
    installing = (async () => {
      const { html, build } = await upstreamIndex();
      if (current && current.build === build && !force) return { updated: false, ...info() };
      const tmp = path.join(dir, build + '.part-' + randomUUID().slice(0, 8));
      try {
        await mkdir(tmp, { recursive: true });
        await writeFile(path.join(tmp, 'index.html'), html);
        await writeFile(path.join(tmp, 'COPYING-NOTICE.txt'), NOTICE(source, build));
        const queue = TST_FILES.filter((f) => f !== 'index.html' && f !== 'COPYING-NOTICE.txt');
        const files = {};
        const worker = async () => {
          for (let f; (f = queue.shift());) {
            try { await fetchTo(source + f + '?v=' + build, path.join(tmp, f)); }
            catch (e) { if (!OPTIONAL.has(f)) throw e; }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        for (const f of TST_FILES) { try { files[f] = (await stat(path.join(tmp, f))).size; } catch {} }
        const final = path.join(dir, build);
        await rm(final, { recursive: true, force: true });
        await rename(tmp, final);
        const prev = current;
        current = { build, fetched: Date.now(), source, files };
        await writeFile(currentFile + '.tmp', JSON.stringify(current, null, 1));
        await rename(currentFile + '.tmp', currentFile);
        // Old deploys are removed; a game window still open on one keeps what it already loaded.
        for (const n of await readdir(dir)) if (n !== build && n !== 'current.json' && !n.endsWith('.tmp')) await rm(path.join(dir, n), { recursive: true, force: true });
        console.log(`[tst] installed TabStationToo build ${build}${prev ? ` (was ${prev.build})` : ''}`);
        return { updated: true, previous: prev?.build || null, ...info() };
      } catch (e) {
        await rm(tmp, { recursive: true, force: true });
        throw e;
      }
    })().finally(() => { installing = null; });
    return installing;
  }

  const ensure = async () => current || (await install(), current);

  function info() {
    if (!current) return { installed: false, source };
    const size = Object.values(current.files).reduce((a, b) => a + b, 0);
    return { installed: true, build: current.build, fetched: current.fetched, source, size, base: `/tst/${current.build}/` };
  }

  async function check() {
    const { build } = await upstreamIndex();
    return { ...info(), latest: build, updateAvailable: !!current && current.build !== build };
  }

  // Absolute path of /tst/<build>/<rel>, fetching files a newer deploy added on first use.
  async function file(build, rel) {
    if (!current || build !== current.build) throw Object.assign(new Error('Old or unknown TabStationToo build; reload the game'), { code: 404 });
    const base = path.join(dir, build);
    const p = path.normalize(path.join(base, rel));
    if (!p.startsWith(base + path.sep)) throw Object.assign(new Error('bad path'), { code: 400 });
    if (existsSync(p)) return p;
    if (!/^[\w./-]+$/.test(rel) || rel.endsWith('.part')) throw Object.assign(new Error('Not found'), { code: 404 });
    if (!lazy.has(rel)) lazy.set(rel, fetchTo(source + rel + '?v=' + build, p).then(() => p).finally(() => lazy.delete(rel)));
    return lazy.get(rel);
  }

  // index.html with the RetroDesk additions.
  async function indexHtml(build) {
    const html = await readFile(await file(build, 'index.html'), 'utf8');
    return html.includes('</head>') ? html.replace('</head>', INJECT + '</head>') : INJECT + html;
  }

  // The files a browser needs, with sizes, for the Start Game dialog.
  function manifest() {
    if (!current) return [];
    return Object.entries(current.files).filter(([f]) => !f.endsWith('.txt')).map(([f, size]) => ({ path: f, size, url: `/tst/${current.build}/${f}`, core: TST_CORE.includes(f) }));
  }

  // Game title for a PS2 serial ("SLUS_209.46" or "SLUS-20946") from the game-titles.tsv the site
  // ships (an index of PCSX2's game database). null if unknown or the emulator is not downloaded yet.
  let titles = null, titlesBuild = null;
  async function title(serial) {
    if (!current || !serial) return null;
    if (titlesBuild !== current.build) {
      titlesBuild = current.build; titles = new Map();
      try {
        for (const line of (await readFile(path.join(dir, current.build, 'game-titles.tsv'), 'utf8')).split('\n')) {
          const [k, t] = line.split('\t'); if (k && t) titles.set(k, t);
        }
      } catch {}
    }
    const m = /^([A-Z]{4})[_-]?(\d{3})\.?(\d{2})$/i.exec(serial.trim());
    return m ? titles.get(`${m[1].toUpperCase()}-${m[2]}${m[3]}`) || null : null;
  }

  return { install, ensure, info, check, file, indexHtml, manifest, title, get build() { return current?.build || null; } };
}
