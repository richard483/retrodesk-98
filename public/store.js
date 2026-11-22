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

// Download a URL with progress. If cacheName is given it is streamed into Cache Storage
// (never held fully in memory); otherwise returns a Blob.
export async function download(url, { cacheName, onProgress, signal } = {}) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const total = +res.headers.get('content-length') || 0;
  let loaded = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctl) { loaded += chunk.length; onProgress?.(loaded, total); ctl.enqueue(chunk); },
  }));
  const headers = new Headers({ 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' });
  if (total) headers.set('Content-Length', total);
  // Keep the isolation headers: a worker script served from the cache without COEP is blocked
  // in a cross-origin isolated page (the PS2 emulator's threads load pcsx2-wasm.js this way).
  for (const h of ['Cross-Origin-Embedder-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy']) {
    const v = res.headers.get(h); if (v) headers.set(h, v);
  }
  if (cacheName) {
    const c = await caches.open(cacheName);
    await c.put(abs(url), new Response(counted, { headers }));
    return null;
  }
  return new Response(counted).blob();
}

export async function gameFile(game) {
  const c = await caches.open(GAMES);
  const r = await c.match(abs(game.romUrl), { ignoreSearch: true });
  return r ? new File([await r.blob()], game.file) : null;
}

export const webgl2 = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } };
