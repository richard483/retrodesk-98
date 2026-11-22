// Cache-first for emulator system files: once a core/BIOS is downloaded it never hits the
// network again (until you delete it in Storage Manager). Game files are cached explicitly
// by the app, and served from cache here too.
const SYS = 'emu-system-v1';
const GAMES = 'emu-games-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const isSys = url.pathname.startsWith('/ejs/') || url.pathname.startsWith('/api/bios/');
  const isRom = /^\/api\/games\/\w+\/rom\//.test(url.pathname) && !url.searchParams.has('dl');
  if (!isSys && !isRom) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { cacheName: isSys ? SYS : GAMES, ignoreSearch: isRom });
    if (hit) return hit;
    const res = await fetch(e.request, { cache: 'no-store' });
    // Auto-cache system files (small, shared). Game files are only cached when the user chooses.
    if (isSys && res.ok && res.status === 200 && !url.pathname.endsWith('version.json')) {
      const c = await caches.open(SYS);
      await c.put(e.request, res.clone());
    }
    return res;
  })());
});
