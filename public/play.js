// Runs EmulatorJS for one game and syncs battery saves + save states with the server.
import { gameFile, download, fmt, putFile } from '/store.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id');
const mode = qs.get('mode') || 'keep';   // keep = file is in Cache Storage; stream = memory only
const resume = qs.get('resume') === '1';
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const post = (msg) => parent !== window && parent.postMessage({ ...msg, gameId: id }, location.origin);
const setStatus = (t) => { statusEl.textContent = t; statusEl.style.display = t ? 'flex' : 'none'; };
let toastTimer;
function toast(t, ms = 2500) { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.style.display = 'none'), ms); }

const api = (p, o) => fetch(`/api/games/${id}${p}`, o);
let startedAt = 0, lastSaveSig = '', emu, gm;

// View → Show FPS: frames the emulator really ran per second (60 = full speed for most consoles).
let fpsTimer;
function showFps(on) {
  let el = document.getElementById('fps');
  clearInterval(fpsTimer);
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'fps' });
    el.style.cssText = 'position:absolute;right:6px;top:6px;z-index:99998;background:rgba(0,0,0,.65);color:#7fff7f;font:12px monospace;padding:2px 5px;pointer-events:none';
    document.body.append(el);
  }
  let last = null;
  const tick = () => {
    let n; try { n = gm?.functions?.getFrameNum?.(); } catch {}
    const t = performance.now();
    if (typeof n === 'number' && last && n >= last.n) {
      const fps = ((n - last.n) * 1000) / (t - last.t), target = 60;
      el.textContent = `${fps.toFixed(1)} fps`;
      el.style.color = fps >= target * 0.97 ? '#7fff7f' : fps >= target * 0.85 ? '#ffd060' : '#ff7070';
    } else if (!last) el.textContent = '… fps';
    last = typeof n === 'number' ? { n, t } : null;
  };
  tick(); fpsTimer = setInterval(tick, 1000);
}
const fpsPref = () => { try { return localStorage.getItem('rd-fps') === '1'; } catch { return false; } };

function sig(u8) { // cheap FNV-1a fingerprint to skip uploading unchanged SRAM
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
  return u8.length + ':' + (h >>> 0);
}

async function uploadSave(data) {
  if (!data || !data.length) return;
  const s = sig(data);
  if (s === lastSaveSig) return;
  const r = await api('/save', { method: 'PUT', body: data }).catch(() => null);
  if (r?.ok) { lastSaveSig = s; post({ type: 'saved', what: 'save' }); }
}

async function putState(slot, state, shot) {
  try { await putFile(`/api/games/${id}/states/${slot}`, new Blob([state])); }
  catch (e) { throw new Error('Saving the state to the server failed. ' + e.message); }
  if (shot && (shot.size || shot.length)) await putFile(`/api/games/${id}/states/${slot}/shot`, new Blob([shot])).catch(() => {});
  post({ type: 'saved', what: 'state', slot });
}

async function screenshot() {
  // EmulatorJS 4.2.3 resolves takeScreenshot() with {blob, format}; its own saveState event
  // destructures `screenshot` (always undefined), so we capture it ourselves.
  try {
    const c = emu.capture?.photo || {};
    const r = await emu.takeScreenshot(c.source || 'canvas', 'png', c.upscale ?? 1);
    return r?.blob || r?.screenshot || null;
  } catch { return null; }
}

async function saveState(slot) {
  const state = gm.getState();
  await putState(slot, state, await screenshot());
  toast(`State saved to server (slot ${slot})`);
}
async function loadState(slot) {
  const r = await api(`/states/${slot}`);
  if (!r.ok) return toast(`Slot ${slot} is empty`);
  try { gm.loadState(new Uint8Array(await r.arrayBuffer())); }
  catch { return toast(`Could not load slot ${slot} (made by another emulator version?)`); }
  toast(`State loaded (slot ${slot})`);
}
const currentSlot = () => emu.getSettingValue?.('save-state-slot') || '1';

async function flushAll({ autoState = false } = {}) {
  if (!gm) return;
  try { gm.saveSaveFiles(); } catch {}            // triggers 'saveSaveFiles' → uploadSave
  await uploadSave(gm.getSaveFile(false));
  if (autoState) { try { await putState('auto', gm.getState(), await screenshot()); } catch {} }
}

async function main() {
  const game = await (await api('')).json();
  document.title = game.title;
  const info = await (await fetch('/api/info')).json();
  const plat = info.platforms[game.platform];
  const ejsBase = `/ejs/${info.ejsVersion}/`;
  if (!plat?.playable) { setStatus(`${plat?.name || game.platform} cannot run in the browser.`); return; }

  let file = mode === 'keep' ? await gameFile(game) : null;
  if (!file) {
    setStatus('Downloading game…');
    const blob = await download(game.romUrl, { onProgress: (l, t) => { setStatus(`Downloading game… ${fmt(l)} / ${fmt(t)}`); post({ type: 'progress', loaded: l, total: t }); } });
    file = new File([blob], game.file);
  }
  setStatus('');

  const files = await (await fetch(`/api/platforms/${game.platform}/files`)).json();
  const ctlRes = await fetch(`/api/controls/${game.platform}`);
  const serverControls = ctlRes.status === 200 ? await ctlRes.json() : null;
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: plat.system,
    EJS_gameUrl: file,                 // a File: EmulatorJS reads it straight from memory/cache
    EJS_gameName: game.title,
    EJS_pathtodata: ejsBase,
    EJS_biosUrl: files.bios?.url || '',
    EJS_startOnLoaded: true,
    EJS_threads: !!plat.threads,
    EJS_disableDatabases: true,
    EJS_color: '#000080',
    EJS_backgroundColor: '#000000',
    EJS_language: 'en-US',
    EJS_disableAutoLang: false,        // (sic) EmulatorJS only skips auto-language when this is === false
    EJS_defaultOptions: { 'save-state-location': 'download', ...(plat.options || {}) },
    EJS_onSaveState: async ({ state }) => {
      try { await putState(currentSlot(), state, await screenshot()); toast(`State saved to server (slot ${currentSlot()})`); } catch (e) { toast(e.message, 8000); }
    },
    EJS_onLoadState: () => loadState(currentSlot()),
    EJS_onGameStart: async () => {
      emu = window.EJS_emulator; gm = emu.gameManager;
      startedAt = Date.now();
      emu.on('saveSaveFiles', (data) => uploadSave(data));
      syncControls(game.platform, serverControls);
      setTimeout(applyVpad, 600); // after EmulatorJS restores its own settings
      assignPads(); setTimeout(assignPads, 600);
      // restore battery save from the server
      const r = await api('/save');
      if (r.status === 200) {
        const data = new Uint8Array(await r.arrayBuffer());
        const p = gm.getSaveFilePath(); const parts = p.split('/'); let dir = '';
        for (const seg of parts.slice(0, -1)) { if (!seg) continue; dir += '/' + seg; if (!gm.FS.analyzePath(dir).exists) gm.FS.mkdir(dir); }
        try { gm.FS.unlink(p); } catch {}
        gm.FS.writeFile(p, data); gm.loadSaveFiles();
        lastSaveSig = sig(data);
        toast('Save data restored from server');
      }
      if (resume) setTimeout(() => loadState('auto'), 300);
      setInterval(() => { try { gm.saveSaveFiles(); } catch {} }, 30000);
      if (fpsPref()) showFps(true);
      post({ type: 'started' });
    },
  });
  const s = document.createElement('script');
  s.src = ejsBase + 'loader.js';
  document.body.appendChild(s);
}

// Button mappings: EmulatorJS keeps them per game in this browser's localStorage. We keep one
// mapping per console on the server instead, so a remap applies to every game on every device.
function syncControls(platform, serverControls) {
  const apply = () => {
    if (!serverControls) return;
    emu.controls = structuredClone(serverControls);
    try { emu.setupKeys?.(); emu.checkGamepadInputs?.(); } catch {}
  };
  apply(); setTimeout(apply, 500); // after EmulatorJS has loaded its own per-game settings
  let last = JSON.stringify(serverControls ?? emu.controls);
  const orig = emu.saveSettings.bind(emu);
  emu.saveSettings = (...a) => {
    orig(...a);
    const j = JSON.stringify(emu.controls);
    if (j === last) return;
    last = j;
    fetch(`/api/controls/${platform}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: j }).then(() => toast('Controls saved for this console'));
  };
}

// EmulatorJS only gives a controller a player slot when it sees it *connect* after its menus exist,
// so pads that were already plugged in (e.g. used to browse the library) would be ignored.
// Fill empty player slots with already-connected pads, in controller order: pad 1 = P1, pad 2 = P2…
function assignPads() {
  const sel = emu?.gamepadSelection, known = emu?.gamepad?.gamepads;
  if (!Array.isArray(sel) || !known) return;
  for (const gp of [...known].sort((a, b) => a.index - b.index)) {
    const key = gp.id + '_' + gp.index;
    if (sel.includes(key)) continue;
    const free = sel.indexOf('');
    if (free < 0) break;
    sel[free] = key;
  }
  try { emu.updateGamepadLabels?.(); } catch {}
}

// On-screen (touch) controller. Preference is per device: auto | on | off.
// auto = shown on touch screens, hidden while a physical controller is connected.
const touchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
function applyVpad() {
  if (!emu) return;
  let pref = 'auto'; try { pref = localStorage.getItem('rd-vpad') || 'auto'; } catch {}
  if (!touchDevice && pref !== 'on' && !emu.rdVpadShown) return; // a computer: only when asked for
  const physical = [...(navigator.getGamepads?.() || [])].some(Boolean);
  const on = pref === 'on' || (pref === 'auto' && touchDevice && !physical);
  emu.rdVpadShown = on;
  try {
    emu.toggleVirtualGamepad?.(on);                                        // actually shows/hides it
    emu.changeSettingOption?.('virtual-gamepad', on ? 'enabled' : 'disabled'); // keeps EmulatorJS's own menu in sync
  } catch (e) { console.warn(e); }
}
addEventListener('gamepadconnected', () => applyVpad());
addEventListener('gamepaddisconnected', () => applyVpad());

// Hold Select+Start (or Home) to leave the game from the couch.
let comboSince = 0, comboHinted = false;
setInterval(() => {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  const held = pads.some((p) => (p.buttons[8]?.pressed && p.buttons[9]?.pressed) || p.buttons[16]?.pressed);
  if (!held) { comboSince = 0; comboHinted = false; return; }
  if (!comboSince) comboSince = Date.now();
  const t = Date.now() - comboSince;
  if (t > 400 && !comboHinted) { comboHinted = true; toast('Keep holding to exit…'); }
  if (t > 1500) { comboSince = Infinity; post({ type: 'requestExit' }); }
}, 50);

// commands from the Win98 window menu
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || !e.data?.cmd) return;
  const { cmd, slot } = e.data;
  try {
    if (cmd === 'saveState') await saveState(slot);
    else if (cmd === 'loadState') await loadState(slot);
    else if (cmd === 'syncSave') { await flushAll(); toast('Save data synced'); }
    else if (cmd === 'pause') emu?.pause?.();
    else if (cmd === 'vpad') applyVpad();
    else if (cmd === 'fps') { try { localStorage.setItem('rd-fps', e.data.on ? '1' : '0'); } catch {} showFps(e.data.on); }
    else if (cmd === 'controls') { if (emu?.controlMenu) emu.controlMenu.style.display = ''; else toast('Start the game first'); }
    else if (cmd === 'fullscreen') document.getElementById('game').requestFullscreen?.();
    else if (cmd === 'exit') {
      await flushAll({ autoState: e.data.autoState !== false });
      if (startedAt) await api('', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: true, seconds: Math.round((Date.now() - startedAt) / 1000) }) });
      post({ type: 'exited' });
    }
  } catch (err) { toast(err.message, 8000); if (cmd === 'exit') post({ type: 'exited' }); }
});
addEventListener('pagehide', () => { try { gm?.saveSaveFiles(); const d = gm?.getSaveFile(false); if (d?.length && sig(d) !== lastSaveSig) navigator.sendBeacon?.(`/api/games/${id}/save`, d); } catch {} });

main().catch((e) => { setStatus('Error: ' + e.message); console.error(e); });
