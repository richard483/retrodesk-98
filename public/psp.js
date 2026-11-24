// Runs a PSP game on PPSSPP (the standalone emulator compiled to WebAssembly, see lib/ppsspp.js) inside a
// RetroDesk game window, and keeps its data on the server:
//   game saves   PSP/SAVEDATA on PPSSPP's memory stick, packed into the game's save file on the server
//   save states  PPSSPP's own Save/Load State (F2/F4), whose files we move to and from the server's slots
//   settings     PSP/SYSTEM/ppsspp.ini and controls.ini, shared by all PSP games (stored as the PSP
//                controller mapping), so a change in PPSSPP's menu sticks
// Everything lives in Emscripten's in-memory file system for the session; the server is the real storage.
import { gameFile, download, fmt, putFile } from '/store.js';
import { installScriptProcessorPolyfill } from '/vendor/ppsspp-web/sp-shim.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id');
const mode = qs.get('mode') || 'keep';
// ?resume=1 continues from the auto-save made when the game was last closed; ?resume=<1-9> from that state slot.
const resume = ((r) => (r === '1' ? 'auto' : /^[1-9]$|^auto$/.test(r || '') ? r : null))(qs.get('resume'));
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const post = (msg) => parent !== window && parent.postMessage({ ...msg, gameId: id }, location.origin);
const api = (p, o) => fetch(`/api/games/${id}${p}`, o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function setStatus(html) { statusEl.innerHTML = html; statusEl.style.display = html ? 'flex' : 'none'; }
let toastTimer;
function toast(t, ms = 2500) { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.style.display = 'none'), ms); }
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

// PPSSPP's memory stick on Emscripten is $HOME/.config/ppsspp.
const STICK = '/home/web_user/.config/ppsspp';
const SAVEDATA = STICK + '/PSP/SAVEDATA', STATES = STICK + '/PSP/PPSSPP_STATE', SYSTEM = STICK + '/PSP/SYSTEM';
const GAME_DIR = '/games';

let Module, FS, booted = false, startedAt = 0, game;
const logLines = [];
window.__pspLog = logLines; // for diagnostics from the console

// ---------------------------------------------------------------- settings (ppsspp.ini)
// [section, key, value, force]. force = set every start; otherwise only when the key is missing, so a change
// made in PPSSPP's own menu is kept.
function iniDefaults() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const vpad = pref('rd-vpad', 'auto');
  return [
    ['General', 'CurrentDirectory', GAME_DIR, true],
    ['General', 'FirstRun', 'False', true],
    ['General', 'CheckForNewVersion', 'False', true],
    ['General', 'AutoLoadSaveState', '0', true],      // RetroDesk does resume from its own auto-save
    ['General', 'StateSlot', '0', true],              // the slot F2/F4 use; RetroDesk keeps the 9 slots itself
    ['General', 'IgnoreBadMemAccess', 'True', false],
    ['CPU', 'FastMemoryAccess', 'True', false],
    // Timing and audio, as tuned by the web build's author (ppsspp-web's WEB_NATIVE_TIMING_CONFIG)
    ['General', 'ForceLagSync2', 'True', false],
    ['Graphics', 'DisplayRefreshRate', '60', false],
    ['Graphics', 'FrameSkip', '0', false],
    ['Graphics', 'AutoFrameSkip', 'False', false],
    ['Graphics', 'VerticalSync', 'True', false],
    ['Graphics', 'LowLatencyPresent', 'False', false],
    ['Sound', 'Enable', 'True', false],
    ['Sound', 'ExtraAudioBuffering', 'False', false],
    ['Sound', 'AudioBufferSize', '1024', false],
    ['Sound', 'FillAudioGaps', 'True', false],
    ['Sound', 'AudioSyncMode', '0', false],
    // View → Show FPS: PPSSPP's own counter (FPS + speed)
    ['Graphics', 'iShowStatusFlags', pref('rd-fps', '0') === '1' ? '6' : '0', true],
    // View → On-screen controller: PPSSPP's own touch controls
    ['Control', 'ShowTouchControls', vpad === 'on' || (vpad === 'auto' && touch) ? 'True' : 'False', true],
  ];
}
function patchIni(text, section, key, value, force) {
  const lines = text ? text.split(/\r?\n/) : [];
  let start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); lines.push(`[${section}]`, `${key} = ${value}`); return lines.join('\n'); }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l)); if (end < 0) end = lines.length;
  const i = lines.findIndex((l, j) => j > start && j < end && l.split('=')[0].trim().toLowerCase() === key.toLowerCase());
  if (i >= 0) { if (force) lines[i] = `${key} = ${value}`; }
  else { let at = end; while (at > start + 1 && lines[at - 1].trim() === '') at--; lines.splice(at, 0, `${key} = ${value}`); }
  return lines.join('\n');
}

// PPSSPP's default controller mapping (keyboard + first gamepad, generated from its KeyMapDefaults.cpp), plus
// F2 = Save State and F4 = Load State, which this page presses to make states. PPSSPP has no keyboard
// shortcut for them by default, and with a [ControlMapping] section present an action missing from it is
// left unmapped, so the whole table is written out.
const CONTROLS_DEFAULT = `[ControlMapping]
Up = 1-19,10-19
Down = 1-20,10-20
Left = 1-21,10-21
Right = 1-22,10-22
Circle = 1-52,10-190
Cross = 1-54,10-189
Square = 1-29,10-191
Triangle = 1-47,10-188
Start = 1-62,10-197
Select = 1-66,10-196
L = 1-45,10-194
R = 1-51,10-195
Home = 
An.Up = 1-37,10-4003
An.Down = 1-39,10-4002
An.Left = 1-38,10-4001
An.Right = 1-40,10-4000
Rotate Analog (CW) = 
Rotate Analog (CCW) = 
Analog limiter = 1-60
RapidFire = 1-59
Axis swap (hold) = 
Axis swap (toggle) = 
Fast-forward = 1-61
Pause = 1-111,10-109,10-104,10-4034
Pause (no menu) = 1-138
SpeedToggle = 1-68
Alt speed 1 = 
Alt speed 2 = 
Analog speed = 10-4036
Reset = 
Frame Advance = 
Rewind = 1-67
Save State = 1-132
Load State = 1-134
Previous Slot = 
Next Slot = 
Toggle Fullscreen = 
Toggle Debugger = 1-142
Toggle tilt control = 
DevMenu = 
Texture Dumping = 
Texture Replacement = 
Screenshot = 
Mute toggle = 
Create frame dump = 
VR camera adjust = 
VR camera reset = 
Display Portrait = 
Display Portrait Reversed = 
Display Landscape = 
Display Landscape Reversed = 
Toggle WLAN = 
Exit App = 
Toggle mouse input = 
Toggle touch controls = 
RightAn.Up = 10-4029
RightAn.Down = 10-4028
RightAn.Left = 10-4023
RightAn.Right = 10-4022
Hold = 
Wlan = 
Remote hold = 
Vol + = 
Vol - = 
Screen = 
Note = 
Dev-kit L2 = 
Dev-kit L3 = 
Dev-kit R2 = 
Dev-kit R3 =
`;
const STATE_KEYS = [['Save State', '1-132'], ['Load State', '1-134']];
function withStateKeys(ini) {
  if (!/^\[ControlMapping\]/m.test(ini)) return CONTROLS_DEFAULT;
  for (const [name, code] of STATE_KEYS) {
    const m = new RegExp(`^${name} = (.*)$`, 'm').exec(ini);
    if (!m) ini = patchIni(ini, 'ControlMapping', name, code, false);
    else if (!m[1].split(',').includes(code)) ini = ini.replace(m[0], `${name} = ${m[1] ? m[1] + ',' : ''}${code}`);
  }
  return ini;
}

// ---------------------------------------------------------------- files in Emscripten's FS
function mkdirp(p) { let cur = ''; for (const seg of p.split('/').filter(Boolean)) { cur += '/' + seg; if (!FS.analyzePath(cur).exists) FS.mkdir(cur); } }
function walk(dir, out = []) {
  if (!FS.analyzePath(dir).exists) return out;
  for (const n of FS.readdir(dir)) {
    if (n === '.' || n === '..') continue;
    const p = dir + '/' + n, st = FS.stat(p);
    if (FS.isDir(st.mode)) walk(p, out); else out.push({ path: p, size: st.size, mtime: +st.mtime });
  }
  return out;
}
const readText = (p) => { try { return new TextDecoder().decode(FS.readFile(p)); } catch { return ''; } };

// A folder tree as one gzip blob: 'RDPSPSAVE\n', u32 header length, JSON [{path, size}], then the bytes.
const MAGIC = 'RDPSPSAVE\n';
async function packDir(dir) {
  const files = walk(dir);
  if (!files.length) return null;
  const parts = files.map((f) => FS.readFile(f.path));
  const head = new TextEncoder().encode(JSON.stringify(files.map((f, i) => ({ path: f.path.slice(dir.length + 1), size: parts[i].length }))));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length, true);
  return new Response(new Blob([new TextEncoder().encode(MAGIC), len, head, ...parts]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function unpackDir(buf, dir) {
  let u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if (new TextDecoder().decode(u8.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('not a RetroDesk PSP save');
  const hl = new DataView(u8.buffer, u8.byteOffset + MAGIC.length, 4).getUint32(0, true);
  let off = MAGIC.length + 4;
  const list = JSON.parse(new TextDecoder().decode(u8.subarray(off, off + hl))); off += hl;
  for (const f of list) {
    if (f.path.split('/').includes('..')) continue;
    const p = dir + '/' + f.path;
    mkdirp(p.slice(0, p.lastIndexOf('/')));
    FS.writeFile(p, u8.slice(off, off + f.size)); off += f.size;
  }
  return list.length;
}

// ---------------------------------------------------------------- game saves <-> server
let saveSig = '';
const sigOf = (files) => files.map((f) => `${f.path}:${f.size}:${f.mtime}`).join('|');
async function pushSaves({ force = false } = {}) {
  if (!FS) return false;
  const sig = sigOf(walk(SAVEDATA));
  if (!sig || (sig === saveSig && !force)) return false;
  const blob = await packDir(SAVEDATA);
  await putFile(`/api/games/${id}/save`, blob);
  saveSig = sig;
  post({ type: 'saved', what: 'save' });
  return true;
}

// PSP saves made with the EmulatorJS core live in this browser only, in IndexedDB "/data/saves" (its IDBFS
// mount). The first time a game runs here without server saves, its folders are copied from there.
async function legacySaves(serial) {
  const key = (serial || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (key.length < 9 || !indexedDB.databases) return 0;
  if (!(await indexedDB.databases()).some((d) => d.name === '/data/saves')) return 0;
  const db = await new Promise((ok, ko) => { const r = indexedDB.open('/data/saves'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  try {
    if (!db.objectStoreNames.contains('FILE_DATA')) return 0;
    const store = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA');
    const [keys, vals] = await Promise.all([store.getAllKeys(), store.getAll()].map((r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); })));
    let n = 0;
    keys.forEach((k, i) => {
      const m = /\/PSP\/SAVEDATA\/(([^/]+)\/.+)$/.exec(String(k));
      if (!m || !m[2].toUpperCase().startsWith(key) || !vals[i]?.contents) return;
      const p = SAVEDATA + '/' + m[1];
      mkdirp(p.slice(0, p.lastIndexOf('/')));
      FS.writeFile(p, new Uint8Array(vals[i].contents)); n++;
    });
    return n;
  } finally { db.close(); }
}

// ---------------------------------------------------------------- settings <-> server
// Stored through the per-console controller-mapping endpoint: { ppssppIni, controlsIni }.
let settingsSig = '';
async function pushSettings() {
  if (!FS) return;
  const ini = readText(SYSTEM + '/ppsspp.ini').replace(/\n\[Recent\][^[]*/, '\n'), controls = readText(SYSTEM + '/controls.ini');
  const sig = ini + '\0' + controls;
  if (!ini || sig === settingsSig) return;
  const r = await fetch('/api/controls/psp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ppssppIni: ini, controlsIni: controls }) });
  if (r.ok) settingsSig = sig;
}

// ---------------------------------------------------------------- save states
// PPSSPP saves a state with F2 and loads one with F4, from the current slot (0) of
// PSP/PPSSPP_STATE/<disc id>_<disc version>_0.ppst, with a .jpg screenshot beside it. The disc id is
// learned from the first state written; to load before that, a state is saved first to create the file.
let stateBase = null, busy = false;
function key(code, keyCode) {
  for (const type of ['keydown', 'keyup']) {
    const e = new KeyboardEvent(type, { key: code, code, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => keyCode }); Object.defineProperty(e, 'which', { get: () => keyCode });
    window.dispatchEvent(e);
  }
}
const stateFiles = () => walk(STATES).filter((f) => f.path.endsWith('_0.ppst'));
async function waitForState(prev, ms = 20000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    await sleep(100);
    const f = stateFiles().find((x) => { const p = prev.get(x.path); return !p || p.mtime !== x.mtime || p.size !== x.size; });
    if (f) { await sleep(300); const g = walk(STATES).find((x) => x.path === f.path); if (g && g.size === f.size) return g; }
  }
  return null;
}
async function ppssppSave() {
  const prev = new Map(stateFiles().map((f) => [f.path, f]));
  key('F2', 113);
  const f = await waitForState(prev);
  if (f) stateBase = f.path.slice(0, -'_0.ppst'.length);
  return f;
}
async function saveState(slot, { quiet = false } = {}) {
  if (!booted) { if (!quiet) toast('Start a game first'); return false; }
  if (busy) return false; busy = true;
  try {
    const f = await ppssppSave();
    if (!f) { if (!quiet) toast('Saving the state failed (PPSSPP cannot save in its menus)'); return false; }
    try { await putFile(`/api/games/${id}/states/${slot}`, new Blob([FS.readFile(f.path)])); }
    catch (e) { if (!quiet) toast('Saving the state to the server failed. ' + e.message, 8000); return false; }
    const jpg = stateBase + '_0.jpg';
    if (FS.analyzePath(jpg).exists) await putFile(`/api/games/${id}/states/${slot}/shot`, new Blob([FS.readFile(jpg)], { type: 'image/jpeg' })).catch(() => {});
    post({ type: 'saved', what: 'state', slot });
    if (!quiet) toast(slot === 'auto' ? 'Auto-save stored on server' : `State saved to server (slot ${slot})`);
    return true;
  } finally { busy = false; }
}
async function loadState(slot) {
  if (!booted) return toast('Start a game first');
  if (busy) return; busy = true;
  try {
    const r = await api(`/states/${slot}`);
    if (!r.ok) return toast(slot === 'auto' ? 'No auto-save yet' : `Slot ${slot} is empty`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!stateBase && !(await ppssppSave())) return toast('Loading the state failed: the game has to be running (not in PPSSPP\'s menu)');
    FS.writeFile(stateBase + '_0.ppst', bytes);
    key('F4', 115);
    toast(`State loaded (${slot === 'auto' ? 'auto-save' : 'slot ' + slot})`);
  } finally { busy = false; }
}

// ---------------------------------------------------------------- start
async function main() {
  game = await (await api('')).json();
  document.title = game.title;
  if (!crossOriginIsolated) return setStatus('PSP needs a cross-origin isolated page.<br>Open RetroDesk via http://localhost or HTTPS.');
  if (!document.createElement('canvas').getContext('webgl2')) return setStatus('PSP needs WebGL2, which this browser does not offer.');
  const files = await (await fetch(`/api/platforms/${game.platform}/files`)).json();
  if (files.engine !== 'ppsspp') return setStatus('This game is not set to PSP.');
  const base = `/ppsspp/${files.build}/`;

  let file = mode === 'keep' ? await gameFile(game) : null;
  if (!file) {
    setStatus('Downloading game…');
    const blob = await download(game.romUrl, { onProgress: (l, t) => { setStatus(`Downloading game… ${fmt(l)} / ${fmt(t)}`); post({ type: 'progress', loaded: l, total: t }); } });
    file = new File([blob], game.file);
  }
  setStatus('Starting PPSSPP…');
  const [saveRes, settings] = await Promise.all([api('/save'), fetch('/api/controls/psp').then((r) => (r.status === 200 ? r.json() : null)).catch(() => null)]);
  const serverSave = saveRes.status === 200 ? await saveRes.arrayBuffer() : null;
  const gameBytes = new Uint8Array(await file.arrayBuffer()); // PPSSPP reads the disc from memory, like EmulatorJS did
  const gamePath = `${GAME_DIR}/${game.file.replace(/[^\w.\- ()[\]]/g, '_')}`;

  // Audio: PPSSPP's SDL backend uses the old ScriptProcessorNode; the shim swaps in an AudioWorklet.
  let audioContext = null;
  try {
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    await installScriptProcessorPolyfill(audioContext);
    audioContext.resume().catch(() => {});
    const unlock = () => { if (audioContext.state !== 'running') audioContext.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true });
  } catch (e) { console.warn('audio', e); }

  Module = window.Module = {
    canvas,
    webglContextAttributes: { powerPreference: 'high-performance', alpha: false, antialias: false, depth: true, stencil: true, preserveDrawingBuffer: false },
    SDL2: audioContext ? { audioContext } : {},
    arguments: [gamePath],
    locateFile: (p) => base + p,
    print: (t) => onLog(t), printErr: (t) => onLog(t),
    preRun: [() => {
      FS = Module.FS;
      mkdirp(SYSTEM); mkdirp(SAVEDATA); mkdirp(STATES); mkdirp(GAME_DIR);
      let ini = settings?.ppssppIni || '';
      for (const [s, k, v, force] of iniDefaults()) ini = patchIni(ini, s, k, v, force);
      FS.writeFile(SYSTEM + '/ppsspp.ini', ini);
      FS.writeFile(SYSTEM + '/controls.ini', withStateKeys(settings?.controlsIni || ''));
      settingsSig = '';
      FS.writeFile(gamePath, gameBytes, { canOwn: true });
    }],
    onAbort: (what) => setStatus('The emulator stopped: ' + esc(String(what || 'error'))),
  };
  // Restore game saves before PPSSPP starts: preRun callbacks run first to last, and the run dependency
  // holds main() back until the (async) restore is done.
  Module.preRun.unshift(() => {
    Module.addRunDependency('rd-saves');
    (async () => {
      FS = Module.FS; mkdirp(SAVEDATA);
      try {
        if (serverSave) toast(`Game saves restored from server (${await unpackDir(serverSave, SAVEDATA)} files)`);
        else { const n = await legacySaves(game.serial).catch(() => 0); if (n) { toast(`Imported ${n} save files from the previous PSP emulator`); saveSig = ''; } }
      } catch (e) { console.warn('saves', e); toast('Could not restore game saves: ' + e.message, 6000); }
      saveSig = serverSave ? sigOf(walk(SAVEDATA)) : '';
      Module.removeRunDependency('rd-saves');
    })();
  });

  const s = document.createElement('script');
  s.src = base + 'PPSSPPSDL.js';
  s.onerror = () => setStatus('Could not load the PSP emulator files.');
  document.body.append(s);
  canvas.focus();
}

function onLog(t) {
  logLines.push(t); if (logLines.length > 300) logLines.shift();
  if (!booted && /N\[BOOT\]: .*Booted /.test(t)) onBooted();
  if (/E\[LOADER\]|Failed to load|Game file not found/i.test(t) && !booted) console.warn('[ppsspp]', t);
}
function onBooted() {
  booted = true; startedAt = Date.now();
  setStatus('');
  canvas.focus();
  post({ type: 'started' });
  if (resume) setTimeout(() => loadState(resume), 4000);
  // game saves: pushed shortly after the game writes them; settings: when they change
  setInterval(() => { pushSaves().catch((e) => console.warn('save sync', e)); pushSettings().catch(() => {}); }, 10000);
}

// Hold Select+Start (or Home) to leave the game from the couch.
let comboSince = 0, comboHinted = false;
setInterval(() => {
  const list = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  const held = list.some((p) => (p.buttons[8]?.pressed && p.buttons[9]?.pressed) || p.buttons[16]?.pressed);
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
    else if (cmd === 'syncSave') { const sent = await pushSaves({ force: true }); await pushSettings(); toast(sent ? 'Game saves synced to server' : 'No game saves yet'); }
    else if (cmd === 'menu' || cmd === 'controls') {
      key('Escape', 27); canvas.focus();
      if (cmd === 'controls') toast('In PPSSPP\'s menu: Settings → Controls → Control mapping. Changes are kept for all PSP games.', 7000);
    }
    else if (cmd === 'fps') { try { localStorage.setItem('rd-fps', e.data.on ? '1' : '0'); } catch {} toast('PPSSPP shows FPS and speed from the next game start', 4000); }
    else if (cmd === 'vpad') toast('The on-screen controller changes from the next game start', 4000);
    else if (cmd === 'exit') {
      if (booted && e.data.autoState !== false) await saveState('auto', { quiet: true }).catch(() => {});
      await pushSaves().catch(() => {});
      await pushSettings().catch(() => {});
      if (startedAt) await api('', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: true, seconds: Math.round((Date.now() - startedAt) / 1000) }) });
      post({ type: 'exited' });
    }
  } catch (err) { toast(err.message, 6000); if (cmd === 'exit') post({ type: 'exited' }); }
});
addEventListener('pagehide', () => { try { pushSaves(); } catch {} });

main().catch((e) => { setStatus('Error: ' + esc(e.message)); console.error(e); });
