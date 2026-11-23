// Local copy of a WebAssembly build of PPSSPP, the PSP emulator (GPL-2.0-or-later, by Henrik Rydgård and
// contributors: https://github.com/hrydgard/ppsspp), used to run PSP games.
//
// PPSSPP has no official browser build. The community fork by roothunter
// (https://github.com/root-hunter/ppsspp-wasm) builds the standalone emulator with Emscripten and publishes it
// with its web shell (https://root-hunter.github.io/ppsspp-web/). We copy only the emulator files of one deploy
// into DATA/ppsspp/<revision>/ and serve them from /ppsspp/<revision>/; RetroDesk's own page (public/psp.html)
// runs them. <revision> is the build id the deploy publishes in build-info.json, so the three files always
// come from the same build, and an update downloads the next build beside it and switches over.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// PPSSPPSDL.data holds PPSSPP's assets (fonts, UI atlas, shaders); a threaded build may add a worker script.
export const PPSSPP_FILES = ['PPSSPPSDL.js', 'PPSSPPSDL.wasm', 'PPSSPPSDL.data'];
const OPTIONAL = ['PPSSPPSDL.worker.js'];
const BUILD_DIR = 'build-wasm/';

const NOTICE = (source, rev) => `This folder is a copy of the emulator files of one deploy of PPSSPP Web (revision ${rev}),
downloaded from ${source}${BUILD_DIR}

PPSSPP is free software under the GNU General Public License v2.0 or later, by Henrik Rydgård and contributors.
Source code: https://github.com/hrydgard/ppsspp
This WebAssembly build comes from the community fork https://github.com/root-hunter/ppsspp-wasm (same license).
Neither project is affiliated with RetroDesk 98. The files are served unchanged.
`;

export async function createPpssppMirror({ dir, source }) {
  await mkdir(dir, { recursive: true });
  const currentFile = path.join(dir, 'current.json');
  let current = null; // { build, fetched, source, files: { name: size } }
  try { current = JSON.parse(await readFile(currentFile, 'utf8')); if (!existsSync(path.join(dir, current.build, PPSSPP_FILES[1]))) current = null; } catch {}
  let installing = null;

  async function fetchTo(url, file) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`PPSSPP build site: HTTP ${r.status} for ${url}`), { code: r.status === 404 ? 404 : 502 });
    const tmp = file + '.' + randomUUID() + '.part';
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    await rename(tmp, file);
  }

  // The revision the site serves now: build-info.json, else a hash of the loader script.
  async function upstreamRevision() {
    try {
      const r = await fetch(source + 'build-info.json', { cache: 'no-store' });
      if (r.ok) { const rev = (await r.json()).revision; if (/^[0-9a-f]{12,64}$/.test(rev || '')) return rev.slice(0, 16); }
    } catch {}
    const r = await fetch(source + BUILD_DIR + PPSSPP_FILES[0], { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`PPSSPP build site: HTTP ${r.status}`), { code: 502 });
    return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex').slice(0, 16);
  }

  // Downloads the build the site serves now, unless it is the one we have. Single-flight.
  function install({ force = false } = {}) {
    if (installing) return installing;
    installing = (async () => {
      const build = await upstreamRevision();
      if (current && current.build === build && !force) return { updated: false, ...info() };
      const tmp = path.join(dir, build + '.part-' + randomUUID().slice(0, 8));
      try {
        await mkdir(tmp, { recursive: true });
        await writeFile(path.join(tmp, 'COPYING-NOTICE.txt'), NOTICE(source, build));
        await Promise.all(PPSSPP_FILES.map((f) => fetchTo(`${source}${BUILD_DIR}${f}?v=${build}`, path.join(tmp, f))));
        for (const f of OPTIONAL) await fetchTo(`${source}${BUILD_DIR}${f}?v=${build}`, path.join(tmp, f)).catch(() => {});
        const files = {};
        for (const f of [...PPSSPP_FILES, ...OPTIONAL]) { try { files[f] = (await stat(path.join(tmp, f))).size; } catch {} }
        const final = path.join(dir, build);
        await rm(final, { recursive: true, force: true });
        await rename(tmp, final);
        const prev = current;
        current = { build, fetched: Date.now(), source, files };
        await writeFile(currentFile + '.tmp', JSON.stringify(current, null, 1));
        await rename(currentFile + '.tmp', currentFile);
        for (const n of await readdir(dir)) if (n !== build && n !== 'current.json' && !n.endsWith('.tmp')) await rm(path.join(dir, n), { recursive: true, force: true });
        console.log(`[ppsspp] installed PPSSPP build ${build}${prev ? ` (was ${prev.build})` : ''}`);
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
    return { installed: true, build: current.build, fetched: current.fetched, source, size, base: `/ppsspp/${current.build}/` };
  }

  async function check() {
    const latest = await upstreamRevision();
    return { ...info(), latest, updateAvailable: !!current && current.build !== latest };
  }

  // Absolute path of /ppsspp/<build>/<name>.
  async function file(build, name) {
    if (!current || build !== current.build) throw Object.assign(new Error('Old or unknown PPSSPP build; reload the game'), { code: 404 });
    if (!(name in current.files) && name !== 'COPYING-NOTICE.txt') throw Object.assign(new Error('Not found'), { code: 404 });
    return path.join(dir, build, name);
  }

  // The files a browser needs, with sizes, for the Start Game dialog.
  function manifest() {
    if (!current) return [];
    return Object.entries(current.files).map(([f, size]) => ({ path: f, size, url: `/ppsspp/${current.build}/${f}`, core: true }));
  }

  return { install, ensure, info, check, file, manifest, get build() { return current?.build || null; } };
}
