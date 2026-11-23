// Cache-first for emulator system files: once a core/BIOS is downloaded it never hits the
// network again (until you delete it in Storage Manager). Game files are cached explicitly
// by the app, and served from cache here too.
const SYS = 'emu-system-v1';
const GAMES = 'emu-games-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// A cached game answered with only the bytes asked for. The PS2 emulator reads discs in chunks
// (Range requests) instead of loading the whole image, and a Blob slice of a cached response is
// read from disk lazily, so even multi-GB images cost no memory.
async function ranged(hit, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m || (!m[1] && !m[2])) return hit;
  const blob = await hit.blob();
  const size = blob.size;
  let start = m[1] ? +m[1] : size - +m[2];
  let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start < 0) start = 0;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream', 'Content-Length': String(end - start + 1),
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cross-Origin-Resource-Policy': 'same-origin' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const isTst = url.pathname.startsWith('/tst/') && !/\/(index\.html)?$/.test(url.pathname); // the PS2 emulator (build id in the path)
  const isSys = isTst || url.pathname.startsWith('/ppsspp/') || url.pathname.startsWith('/ejs/') || url.pathname.startsWith('/api/bios/') || url.pathname === '/data/cores/ppsspp-assets.zip';
  const isRom = /^\/api\/games\/\w+\/rom\//.test(url.pathname) && !url.searchParams.has('dl');
  if (!isSys && !isRom) return;
  e.respondWith((async () => {
    // TabStationToo adds ?v=<build> to its files; the build is already in our path.
    const hit = await caches.match(url.href, { cacheName: isSys ? SYS : GAMES, ignoreSearch: isRom || isTst });
    if (hit) return isRom ? ranged(hit, e.request.headers.get('Range')) : hit;
    const res = await fetch(e.request, { cache: 'no-store' });
    // Auto-cache system files (small, shared). Game files are only cached when the user chooses.
    if (isSys && res.ok && res.status === 200 && !url.pathname.endsWith('version.json')) {
      const c = await caches.open(SYS);
      await c.put(isTst ? url.origin + url.pathname : e.request, res.clone());
    }
    return res;
  })());
});
