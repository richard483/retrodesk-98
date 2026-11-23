// Runs a PS2 game on TabStationToo (PCSX2 compiled to WebAssembly) inside a RetroDesk game window.
// TabStationToo is served from our own origin (/tst/<build>/, mirrored by the server), so this page
// can reach into its frame: it boots our BIOS and disc by URL (?bios= &disc=), saves and loads PCSX2
// states into RetroDesk's server slots, and backs up the memory cards (kept in IndexedDB) to the server.
import { putFile } from '/store.js';
const qs = new URLSearchParams(location.search);
const id = qs.get('id');
const resume = qs.get('resume') === '1';
const frame = document.getElementById('emu');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const post = (msg) => parent !== window && parent.postMessage({ ...msg, gameId: id }, location.origin);
const api = (p, o) => fetch(`/api/games/${id}${p}`, o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function setStatus(html) { statusEl.innerHTML = html; statusEl.style.display = html ? 'flex' : 'none'; }
let toastTimer;
function toast(t, ms = 2500) { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.style.display = 'none'), ms); }

let startedAt = 0;
const W = () => frame.contentWindow;
const vm = () => { try { return W().PCSX2Web?.stats() || {}; } catch { return {}; } };
const disc = () => { try { return W().PCSX2WebDisc?.stats() || {}; } catch { return {}; } };
const running = () => vm().state === 'running';

// ---------------------------------------------------------------- memory cards <-> server
// TabStationToo keeps a library of 8 MB cards in IndexedDB 'pcsx2-web-cards' (stores: cards, bytes, meta).
// We pack the whole library into one blob and keep it on the server, so saves follow you to other browsers.
const CARD_DB = 'pcsx2-web-cards', SYNC_KEY = 'rd-ps2-cards';
function openCards() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CARD_DB, 1);
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('cards', { keyPath: 'id' }); db.createObjectStore('bytes'); db.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('memory cards are open in another tab'));
  });
}
const reqP = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
async function packCards() {
  const db = await openCards();
  try {
    const tx = db.transaction(['cards', 'bytes', 'meta'], 'readonly');
    const cards = await reqP(tx.objectStore('cards').getAll());
    const meta = await reqP(tx.objectStore('meta').get('slots'));
    const parts = [];
    for (const c of cards) {
      const b = await reqP(tx.objectStore('bytes').get(c.id));
      parts.push(b ? new Uint8Array(b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b) : new Uint8Array(0));
    }
    if (!cards.length) return null;
    const head = new TextEncoder().encode(JSON.stringify({ format: 1, meta: meta || null,
      cards: cards.map((c, i) => ({ record: { ...c, handle: null }, length: parts[i].length })) }));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length, true);
    const raw = new Blob([new TextEncoder().encode('RDPS2CARDS\n'), len, head, ...parts]);
    // gzip: an 8 MB card is mostly empty pages, so the upload is usually a few hundred KB
    return await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  } finally { db.close(); }
}
async function unpackCards(buf) {
  let u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const magic = 'RDPS2CARDS\n';
  if (new TextDecoder().decode(u8.subarray(0, magic.length)) !== magic) throw new Error('not a RetroDesk card pack');
  const hl = new DataView(u8.buffer, magic.length, 4).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(magic.length + 4, magic.length + 4 + hl)));
  let off = magic.length + 4 + hl;
  const db = await openCards();
  try {
    const tx = db.transaction(['cards', 'bytes', 'meta'], 'readwrite');
    for (const s of ['cards', 'bytes', 'meta']) tx.objectStore(s).clear();
    for (const c of head.cards) {
      tx.objectStore('cards').put(c.record);
      tx.objectStore('bytes').put(u8.slice(off, off + c.length), c.record.id);
      off += c.length;
    }
    if (head.meta) tx.objectStore('meta').put(head.meta, 'slots');
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error); });
  } finally { db.close(); }
}
// TabStationToo only makes a card when you click a card slot, which the compact view hides, and a PS2
// game cannot save without one. So: if this browser has no card, add "Memory card 1" in slot 1 (a blank
// card is 8 MB of 0xFF, as TabStationToo makes them; the game or the BIOS formats it), and if slot 1 is
// empty, plug in the most recently used card.
async function ensureCard() {
  const db = await openCards();
  try {
    const tx = db.transaction(['cards', 'bytes', 'meta'], 'readwrite');
    const cards = await reqP(tx.objectStore('cards').getAll());
    const meta = (await reqP(tx.objectStore('meta').get('slots'))) || { slots: [null, null], last: [null, null] };
    let made = false;
    if (!cards.length) {
      const id = 'c' + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const c = { id, name: 'Memory card 1', created: Date.now(), used: Date.now(), handle: null, file: null, unlinked: false };
      tx.objectStore('cards').put(c);
      tx.objectStore('bytes').put(new Uint8Array(8650752).fill(0xff), id);
      cards.push(c); made = true;
    }
    if (!meta.slots[0] || !cards.some((c) => c.id === meta.slots[0])) {
      const pick = [...cards].filter((c) => c.id !== meta.slots[1]).sort((a, b) => (b.used || 0) - (a.used || 0))[0];
      if (pick) { meta.slots[0] = meta.last[0] = pick.id; tx.objectStore('meta').put(meta, 'slots'); }
    }
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error); });
    return made;
  } finally { db.close(); }
}

async function fingerprint(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const synced = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; } };
const setSynced = (v) => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(v)); } catch {} };

// Before the emulator starts: take the server's cards if they are newer than what this browser last synced.
async function pullCards() {
  const info = await (await fetch('/api/ps2/cards/info')).json();
  const mine = synced();
  if (!info.version || info.version === mine.version) return;
  const local = await packCards().catch(() => null);
  if (local && mine.sig && (await fingerprint(local)) !== mine.sig) {
    // Both changed since the last sync: keep this browser's copy on the server too, then take the server's.
    await fetch(`/api/ps2/cards?conflict=1`, { method: 'PUT', body: local }).catch(() => {});
  }
  const r = await fetch('/api/ps2/cards');
  if (!r.ok) return;
  await unpackCards(await r.arrayBuffer());
  const pack = await packCards();
  setSynced({ version: info.version, sig: pack ? await fingerprint(pack) : '' });
  toast('Memory cards restored from server');
}

// Cards are copied into IndexedDB by TabStationToo once a game's writes go quiet; wait for that.
async function cardsSettled(timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const m = disc().memcards;
    if (!m || (m.writes === m.savedWrites && !m.syncing)) return true;
    await sleep(200);
  }
  return false;
}
let pushing = null;
function pushCards() {
  pushing ??= (async () => {
    try {
      await cardsSettled();
      const pack = await packCards();
      if (!pack) return;
      const sig = await fingerprint(pack);
      if (sig === synced().sig) return;
      const version = Date.now();
      const r = await fetch(`/api/ps2/cards?version=${version}`, { method: 'PUT', body: pack });
      if (r.ok) { setSynced({ version, sig }); post({ type: 'saved', what: 'save' }); }
    } catch (e) { console.warn('memory card sync', e); }
  })().finally(() => { pushing = null; });
  return pushing;
}

// ---------------------------------------------------------------- save states (PCSX2 .p2s) <-> server slots
function stateOp(save, path) {
  const M = W().Module;
  return new Promise((resolve) => {
    if (!M || typeof M._pcsx2web_state_result !== 'function') return resolve(false);
    const before = M._pcsx2web_state_result() >>> 0;
    if (M.ccall(save ? 'pcsx2web_save_state' : 'pcsx2web_load_state', 'number', ['string'], [path]) !== 0) return resolve(false);
    const t0 = performance.now();
    const check = () => {
      const r = M._pcsx2web_state_result() >>> 0;
      if (r !== before) resolve((r & 1) === 1);
      else if (performance.now() - t0 > 20000) resolve(false);
      else setTimeout(check, 50);
    };
    setTimeout(check, 50);
  });
}
function stateDir() { const FS = W().Module.FS; if (!FS.analyzePath('/states').exists) FS.mkdir('/states'); return FS; }
async function screenshot() {
  try {
    const c = W().document.getElementById('canvas');
    if (!c?.width) return null;
    // copy into our own canvas at a small size (works for the 2D and the WebGPU bitmap canvas)
    const out = document.createElement('canvas'); out.width = 320; out.height = Math.round(320 * c.height / c.width) || 240;
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    return await new Promise((r) => out.toBlob(r, 'image/png'));
  } catch { return null; }
}
let busy = false;
async function saveState(slot, { quiet = false } = {}) {
  if (!running()) { if (!quiet) toast('Start a game first'); return false; }
  if (busy) return false; busy = true;
  try {
    const shot = await screenshot();
    const FS = stateDir(), path = `/states/rd-${slot}.p2s`;
    if (!(await stateOp(true, path))) { if (!quiet) toast('Saving the state failed'); return false; }
    const bytes = FS.readFile(path); try { FS.unlink(path); } catch {}
    try { await putFile(`/api/games/${id}/states/${slot}`, new Blob([bytes])); }
    catch (e) { if (!quiet) toast('Saving the state to the server failed. ' + e.message, 8000); return false; }
    if (shot) await putFile(`/api/games/${id}/states/${slot}/shot`, new Blob([shot])).catch(() => {});
    post({ type: 'saved', what: 'state', slot });
    if (!quiet) toast(slot === 'auto' ? 'Auto-save stored on server' : `State saved to server (slot ${slot})`);
    return true;
  } finally { busy = false; }
}
async function loadState(slot) {
  if (!running()) return toast('Start a game first');
  if (busy) return; busy = true;
  try {
    const r = await api(`/states/${slot}`);
    if (!r.ok) return toast(slot === 'auto' ? 'No auto-save yet' : `Slot ${slot} is empty`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // PCSX2 refuses to load a state just after the game wrote a memory card
    await cardsSettled(); await sleep(300);
    const FS = stateDir(), path = '/states/rd-load.p2s';
    FS.writeFile(path, bytes);
    const ok = await stateOp(false, path);
    try { FS.unlink(path); } catch {}
    toast(ok ? `State loaded (${slot === 'auto' ? 'auto-save' : 'slot ' + slot})` : 'Loading the state failed (is it from this game?)');
  } finally { busy = false; }
}

// ---------------------------------------------------------------- the emulator page
function setCompact(on) {
  try { W().document.documentElement.classList.toggle('rd-compact', on); } catch {}
  try { localStorage.setItem('rd-ps2-panel', on ? '0' : '1'); } catch {}
}
const panelShown = () => { try { return localStorage.getItem('rd-ps2-panel') === '1'; } catch { return false; } };

async function main() {
  const game = await (await api('')).json();
  document.title = game.title;
  if (!crossOriginIsolated) return setStatus('PS2 needs a cross-origin isolated page.<br>Open RetroDesk via http://localhost or HTTPS.');
  setStatus('Preparing the PS2 emulator…');
  const files = await (await fetch(`/api/platforms/${game.platform}/files`)).json();
  if (files.engine !== 'tst') return setStatus('This game is not set to PlayStation 2.');
  if (!files.bios) return setStatus('No PS2 BIOS uploaded. Add one in BIOS Files.');
  await pullCards().catch((e) => console.warn('memory cards', e));
  await ensureCard().catch((e) => console.warn('memory card', e));

  const src = `/tst/${files.build}/index.html?rd=1&bios=${encodeURIComponent(files.bios.url)}&disc=${encodeURIComponent(game.romUrl)}`;
  frame.src = src;
  frame.hidden = false;
  frame.addEventListener('load', () => { setCompact(!panelShown()); setStatus(''); frame.focus(); }, { once: true });
  const notes = [];
  if (!navigator.gpu) notes.push('No WebGPU in this browser: the PS2 is drawn in software, which is slower.');
  if (navigator.maxTouchPoints > 0 && !matchMedia('(pointer:fine)').matches) notes.push('Phones and tablets are not supported by the PS2 emulator yet.');
  if (notes.length) toast(notes.join(' '), 7000);

  // wait for the game to boot, then the extras
  let resumed = !resume;
  const timer = setInterval(async () => {
    const s = vm();
    if (s.state === 'running' && !startedAt) { startedAt = Date.now(); post({ type: 'started' }); }
    if (s.state === 'failed' && !startedAt) { clearInterval(timer); }
    if (!resumed && startedAt && Date.now() - startedAt > 3000 && disc().game?.serial) { resumed = true; loadState('auto'); }
  }, 500);
  setInterval(() => { if (startedAt) pushCards(); }, 30000);
}

// Hold Select+Start (or Home) to leave the game from the couch. Read from the emulator's frame too,
// since it has the focus and a browser may only report gamepads to the focused frame.
let comboSince = 0, comboHinted = false;
setInterval(() => {
  let list = [];
  try { list = [...(W()?.navigator.getGamepads?.() || [])]; } catch {}
  if (!list.some(Boolean)) list = [...(navigator.getGamepads?.() || [])];
  const held = list.filter(Boolean).some((p) => (p.buttons[8]?.pressed && p.buttons[9]?.pressed) || p.buttons[16]?.pressed);
  if (!held) { comboSince = 0; comboHinted = false; return; }
  if (!comboSince) comboSince = Date.now();
  const t = Date.now() - comboSince;
  if (t > 400 && !comboHinted) { comboHinted = true; toast('Keep holding to exit…'); }
  if (t > 1500) { comboSince = Infinity; post({ type: 'requestExit' }); }
}, 50);

addEventListener('message', async (e) => {
  if (e.origin !== location.origin || !e.data?.cmd) return;
  const { cmd, slot } = e.data;
  try {
    if (cmd === 'saveState') await saveState(slot);
    else if (cmd === 'loadState') await loadState(slot);
    else if (cmd === 'syncSave') { await pushCards(); toast('Memory cards synced to server'); }
    else if (cmd === 'panel') { setCompact(!e.data.show); frame.focus(); }
    else if (cmd === 'controls') {
      setCompact(false);
      setTimeout(() => { try { W().document.getElementById('pads')?.scrollIntoView({ block: 'center' }); } catch {} }, 100);
      toast('Click a button on a drawn controller to change it. View → Show emulator panel hides this again.', 6000);
    }
    else if (cmd === 'exit') {
      if (running() && e.data.autoState !== false) await saveState('auto', { quiet: true }).catch(() => {});
      try { W().Module?._pcsx2web_stop?.(); } catch {}  // the page copies the cards to IndexedDB when the PS2 stops
      await pushCards();
      if (startedAt) await api('', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: true, seconds: Math.round((Date.now() - startedAt) / 1000) }) });
      post({ type: 'exited' });
    }
  } catch (err) { toast(err.message); if (cmd === 'exit') post({ type: 'exited' }); }
});

main().catch((e) => { setStatus('Error: ' + esc(e.message)); console.error(e); });
