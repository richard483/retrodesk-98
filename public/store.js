// Browser-side storage. Everything lives in Cache Storage (handles multi-GB files on disk,
// works in every modern browser, and is measurable/deletable per file).
//   SYS   – EmulatorJS runtime, cores, BIOS (filled by the service worker and by prefetch)
//   GAMES – game files you chose to keep in this browser
export const SYS = 'emu-system-v1';
export const GAMES = 'emu-games-v1';

export const fmt = (n) => {
  if (n == null || isNaN(n)) return '?';
  const u = ['bytes', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + ' ' + u[i];
};

export async function estimate() {
  const e = (await navigator.storage?.estimate?.()) || {};
  const persisted = (await navigator.storage?.persisted?.()) || false;
  return { usage: e.usage || 0, quota: e.quota || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)), persisted };
}
export const requestPersist = () => navigator.storage?.persist?.() ?? Promise.resolve(false);

const abs = (u) => new URL(u, location.origin).href;

export async function cachedSize(cacheName, url) {
  const c = await caches.open(cacheName);
  const r = await c.match(abs(url), { ignoreSearch: cacheName === GAMES });
  if (!r) return null;
  return +r.headers.get('content-length') || (await r.clone().blob()).size;
}

export async function list(cacheName) {
  const c = await caches.open(cacheName);
  const out = [];
  for (const req of await c.keys()) {
    const r = await c.match(req);
    out.push({ url: req.url, path: new URL(req.url).pathname, size: +r.headers.get('content-length') || (await r.clone().blob()).size });
  }
  return out;
}

export async function remove(cacheName, url) {
  const c = await caches.open(cacheName);
  return c.delete(abs(url), { ignoreSearch: true });
}

// Large files are fetched in pieces (HTTP Range requests) so each response stays under a proxy's size
// limit: Cloudflare Tunnel, for example, will not pass a single response over 512 MB. The piece size comes
// from the server (DOWNLOAD_CHUNK_MB, default 300; 0 = one request). A piece that fails is retried from
// the byte where it stopped, so a dropped connection costs at most one retry, not the whole download.
let chunkCfg;
export function chunkSize() {
  chunkCfg ??= fetch('/api/info').then((r) => r.json()).then((i) => i.downloadChunk ?? 300 * 2 ** 20).catch(() => 300 * 2 ** 20);
  return chunkCfg;
}

async function fetchPiece(url, start, end, signal) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { signal, cache: 'no-store', headers: { Range: `bytes=${start}-${end}` } });
      if (r.status !== 206 && !(r.status === 200 && start === 0)) throw new Error(`${r.status} ${r.statusText} for ${url}`);
      return r;
    } catch (e) {
      if (e.name === 'AbortError' || attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * attempt));
    }
  }
}

// A ReadableStream of the whole file, fetched piece by piece. Resolves to { stream, total, type, headers }.
export async function chunkedStream(url, { signal } = {}) {
  const chunk = await chunkSize();
  const first = chunk > 0 ? await fetchPiece(url, 0, chunk - 1, signal) : await fetch(url, { signal, cache: 'no-store' });
  if (!first.ok) throw new Error(`${first.status} ${first.statusText} for ${url}`);
  const range = /\/(\d+)$/.exec(first.headers.get('content-range') || '');
  const total = range ? +range[1] : +first.headers.get('content-length') || 0;
  let pos = 0, reader = first.body.getReader(), pieceEnd = range ? Math.min(chunk, total) : Infinity;
  const stream = new ReadableStream({
    async pull(ctl) {
      for (;;) {
        if (!reader) {
          if (pos >= total) return ctl.close();
          pieceEnd = Math.min(pos + chunk, total);
          reader = (await fetchPiece(url, pos, pieceEnd - 1, signal)).body.getReader();
        }
        let res;
        try { res = await reader.read(); }
        catch (e) { // connection dropped mid-piece: continue from where it stopped
          if (e.name === 'AbortError' || !range) throw e;
          reader = null; pieceEnd = pos; continue;
        }
        if (res.done) {
          reader = null;
          if (!range) return ctl.close();      // the server sent the whole file in one response
          if (pos < pieceEnd) { pieceEnd = pos; } // piece ended early: fetch the rest
          continue;
        }
        pos += res.value.length;
        ctl.enqueue(res.value);
        return;
      }
    },
    cancel() { reader?.cancel().catch(() => {}); },
  });
  return { stream, total, type: first.headers.get('content-type') || 'application/octet-stream', headers: first.headers };
}

// Download a URL with progress. If cacheName is given it is streamed into Cache Storage
// (never held fully in memory); otherwise returns a Blob.
export async function download(url, { cacheName, onProgress, signal } = {}) {
  const { stream, total, type, headers: src } = await chunkedStream(url, { signal });
  let loaded = 0;
  const counted = stream.pipeThrough(new TransformStream({
    transform(piece, ctl) { loaded += piece.length; onProgress?.(loaded, total); ctl.enqueue(piece); },
  }));
  const headers = new Headers({ 'Content-Type': type });
  if (total) headers.set('Content-Length', total);
  // Keep the isolation headers: a worker script served from the cache without COEP is blocked
  // in a cross-origin isolated page (the PS2 emulator's threads load pcsx2-wasm.js this way).
  for (const h of ['Cross-Origin-Embedder-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy']) {
    const v = src.get(h); if (v) headers.set(h, v);
  }
  if (cacheName) {
    const c = await caches.open(cacheName);
    await c.put(abs(url), new Response(counted, { headers }));
    return null;
  }
  return new Response(counted).blob();
}

// "Save to my computer" for files of any size: pieces are written straight to the chosen file where the
// browser allows it (Chrome/Edge), otherwise collected into a Blob (Chrome keeps big Blobs on disk) first.
export async function saveToDisk(url, filename, { onProgress, signal } = {}) {
  if (window.showSaveFilePicker) {
    let handle;
    try { handle = await window.showSaveFilePicker({ suggestedName: filename }); }
    catch (e) { if (e.name === 'AbortError') return false; handle = null; }
    if (handle) {
      const { stream, total } = await chunkedStream(url, { signal });
      let loaded = 0;
      await stream.pipeThrough(new TransformStream({ transform(p, ctl) { loaded += p.length; onProgress?.(loaded, total); ctl.enqueue(p); } }))
        .pipeTo(await handle.createWritable());
      return true;
    }
  }
  const blob = await download(url, { onProgress, signal });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}

export async function gameFile(game) {
  const c = await caches.open(GAMES);
  const r = await c.match(abs(game.romUrl), { ignoreSearch: true });
  return r ? new File([await r.blob()], game.file) : null;
}

export const webgl2 = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } };
