import { icon, platformIcon } from '/icons.js';
import * as store from '/store.js';
import { watchGamepads, pads, BTN } from '/gamepad.js';
const { fmt } = store;

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const api = async (p, o = {}) => {
  const r = await fetch('/api' + p, o);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.status === 204 ? null : r.json();
};

let INFO, GAMES = [], CACHED = new Set();
// ---- device / mobile helpers ----
const COARSE = matchMedia('(pointer: coarse)').matches;
const isMobile = () => innerWidth <= 760 || (COARSE && innerHeight <= 520);
const isStandalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let lastPointer = 'mouse';
addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true);
const tapped = () => lastPointer === 'touch' || lastPointer === 'pen';

// Long-press = right-click on touch screens (iOS Safari never fires contextmenu by itself).
// We synthesise it ourselves and swallow the browser's native one to avoid duplicates.
let lpTimer = null, lpFired = false, lpStart = null;
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  lpFired = false; lpStart = { x: e.clientX, y: e.clientY, t: e.target };
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpFired = true;
    lpStart.t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lpStart.x, clientY: lpStart.y }));
  }, 550);
}, true);
addEventListener('pointermove', (e) => { if (lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) clearTimeout(lpTimer); }, true);
addEventListener('pointerup', () => clearTimeout(lpTimer), true);
addEventListener('pointercancel', () => clearTimeout(lpTimer), true);
addEventListener('contextmenu', (e) => { if (e.isTrusted && tapped()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
addEventListener('click', (e) => { if (lpFired) { lpFired = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

// ---- fullscreen ----
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
async function enterFullscreen(el) {
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fsSupported() || !req) return fullscreenHelp();
  try { await req.call(el, { navigationUI: 'hide' }); } catch { fullscreenHelp(); }
}
const exitFullscreen = () => (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
function fullscreenHelp() {
  if (isIOS && !isStandalone()) return msgbox('iPhone Safari does not let web pages go full screen.<br><br>For a full-screen, app-like experience: tap <b>Share</b> → <b>Add to Home Screen</b>, then open RetroDesk from the new home-screen icon. It runs without Safari\'s address bar and toolbar.', { html: true, title: 'Full screen' });
  if (isStandalone()) return msgbox('You are already running RetroDesk as an app. On iPhone this is as full screen as iOS allows.', { title: 'Full screen' });
  msgbox('This browser does not allow full screen here. Try Chrome or Firefox, or install RetroDesk as an app (Start → Install as app).', { ic: 'warn', title: 'Full screen' });
}
// Game full screen: the game window covers the whole screen (no title bar, menus or taskbar), the browser goes full
// screen where it allows it, and phones turn to landscape where the browser allows locking the orientation
// (Android Chrome/Edge/Firefox in full screen; not iPhone, which shows a "turn your phone" hint instead).
// The whole document goes full screen, not the game iframe, so RetroDesk's own message boxes stay visible.
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const fsAuto = () => pref('rd-fs-start', COARSE ? '1' : '0') === '1';  // start games in full screen
const fsLand = () => pref('rd-fs-landscape', '1') === '1';             // ... turned to landscape
let fsWin = null;
function browserFullscreen() { // call within a tap/click; resolves when the browser is in full screen (or cannot be)
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fsElement() || !fsSupported() || !req) return Promise.resolve();
  return Promise.resolve(req.call(el, { navigationUI: 'hide' })).catch(() => {});
}
async function lockLandscape(win) {
  win.el.classList.remove('want-landscape', 'hint-off');
  if (!fsLand()) return;
  try { await screen.orientation.lock('landscape'); }
  catch { if (COARSE || navigator.maxTouchPoints > 0) win.el.classList.add('want-landscape'); } // CSS shows the hint only in portrait
}
async function gameFullscreen(win, on = !win.el.classList.contains('fs'), { browser = true } = {}) {
  if (on) {
    if (fsWin && fsWin !== win) fsWin.el.classList.remove('fs', 'want-landscape');
    fsWin = win;
    win.el.classList.add('fs'); document.body.classList.add('game-fs'); focusWin(win);
    if (browser) await browserFullscreen();
    await lockLandscape(win);
  } else {
    win.el.classList.remove('fs', 'want-landscape');
    if (fsWin === win) { fsWin = null; document.body.classList.remove('game-fs'); }
    try { screen.orientation.unlock(); } catch {}
    if (fsElement()) await exitFullscreen()?.catch?.(() => {});
  }
  win.frame?.focus();
}
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => {
  // leaving browser full screen (Back, Esc, the browser's own button) also leaves game full screen
  if (!fsElement() && fsWin) gameFullscreen(fsWin, false);
});
const FS_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path class="in" d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"/><path class="out" d="M5 1v4H1M15 5h-4V1M11 15v-4h4M1 11h4v4"/></svg>';
function fsMenu(win) {
  return [{ label: win.el.classList.contains('fs') ? 'Exit full screen' : 'Full screen', action: () => gameFullscreen(win) },
    { label: 'Start games in full screen', check: fsAuto(), action: () => setPref('rd-fs-start', fsAuto() ? '0' : '1') },
    { label: 'Landscape in full screen (phones, tablets)', check: fsLand(), action: () => { setPref('rd-fs-landscape', fsLand() ? '0' : '1'); if (win.el.classList.contains('fs')) { if (fsLand()) lockLandscape(win); else { try { screen.orientation.unlock(); } catch {} win.el.classList.remove('want-landscape'); } } } }];
}
// The on-screen controller, for every console (rd-vpad: auto | on | off). On a computer "Always show" is offered
// too, for touch-screen laptops and for trying it out.
function vpadMenu(send) {
  const v = pref('rd-vpad', 'auto');
  const setV = (x) => { setPref('rd-vpad', x); send({ cmd: 'vpad' }); };
  return [{ label: 'On-screen controller', sub: [
    { label: 'Auto (touch screens, hidden while a controller is connected)', check: v === 'auto', action: () => setV('auto') },
    { label: 'Always show', check: v === 'on', action: () => setV('on') },
    { label: 'Hide', check: v === 'off', action: () => setV('off') }] }];
}
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
async function installApp() {
  if (isStandalone()) return msgbox('RetroDesk is already installed and running as an app.');
  if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }
  msgbox(isIOS ? 'In Safari: tap <b>Share</b> → <b>Add to Home Screen</b>.' : 'Use your browser menu: <b>Install app</b> or <b>Add to Home screen</b>.<br><br>Installing needs HTTPS (or http://localhost).', { html: true, title: 'Install as app' });
}
if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(console.warn);

// ======================= window manager =======================
let zTop = 10, winSeq = 0;
const wins = new Map();

function createWindow({ id, title, ic = 'folder', w = 640, hgt = 440, body, menubar, cls = '', resizable = true, onClose, x, y, dialog = false }) {
  if (id && wins.has(id)) { focusWin(wins.get(id)); return wins.get(id); }
  const wid = id || 'w' + ++winSeq;
  const vw = innerWidth, vh = innerHeight - 28;
  w = Math.min(w, vw - 8); hgt = Math.min(hgt, vh - 8);
  const el = h(`<div class="window app ${cls} ${dialog ? 'dialog' : ''} ${!dialog && isMobile() ? 'max' : ''}" style="width:${w}px;height:${dialog ? 'auto' : hgt + 'px'};left:${x ?? Math.max(4, (vw - w) / 2 + (winSeq % 6) * 18 - 45)}px;top:${y ?? Math.max(4, (vh - hgt) / 2 + (winSeq % 6) * 18 - 45)}px">
    <div class="title-bar"><div class="title-bar-text">${icon(ic)}<span>${esc(title)}</span></div>
      <div class="title-bar-controls">${dialog ? '' : '<button aria-label="Minimize"></button><button aria-label="Maximize"></button>'}<button aria-label="Close"></button></div></div>
    ${menubar ? '<div class="menubar"></div>' : ''}
    <div class="window-body"></div>${resizable && !dialog ? '<div class="resize"></div>' : ''}</div>`);
  const win = { id: wid, el, title, ic, onClose, dialog };
  wins.set(wid, win);
  const bodyEl = $('.window-body', el);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  if (menubar) buildMenubar($('.menubar', el), menubar);
  $('#desktop').append(el);
  el.addEventListener('pointerdown', () => focusWin(win));
  $('[aria-label=Close]', el).onclick = () => closeWin(win);
  $('[aria-label=Minimize]', el)?.addEventListener('click', (e) => { e.stopPropagation(); el.classList.add('min'); el.classList.remove('active'); renderTasks(); });
  const maxBtn = $('[aria-label=Maximize]', el);
  const toggleMax = () => { el.classList.toggle('max'); if (maxBtn) maxBtn.setAttribute('aria-label', el.classList.contains('max') ? 'Restore' : 'Maximize'); };
  maxBtn?.addEventListener('click', toggleMax);
  win.toggleMax = toggleMax;
  const tb = $('.title-bar', el);
  if (!dialog) tb.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(); });
  drag(tb, (dx, dy, st) => { if (el.classList.contains('max')) return; el.style.left = st.l + dx + 'px'; el.style.top = Math.max(0, st.t + dy) + 'px'; }, () => ({ l: el.offsetLeft, t: el.offsetTop }));
  const rz = $('.resize', el);
  if (rz) drag(rz, (dx, dy, st) => { el.style.width = Math.max(240, st.w + dx) + 'px'; el.style.height = Math.max(120, st.h + dy) + 'px'; }, () => ({ w: el.offsetWidth, h: el.offsetHeight }));
  focusWin(win);
  if (!dialog) renderTasks();
  if (dialog) setTimeout(() => { if (!el.contains(document.activeElement)) $('.buttons button:not([disabled])', el)?.focus(); });
  win.body = bodyEl;
  win.setTitle = (t) => { win.title = t; $('.title-bar-text span', el).textContent = t; renderTasks(); };
  return win;
}

function drag(handle, move, start) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY, st = start();
    // shield iframes so drags over a game window don't get swallowed
    const shield = h('<div style="position:fixed;inset:0;z-index:999999;cursor:inherit"></div>');
    document.body.append(shield);
    const mv = (ev) => move(ev.clientX - sx, ev.clientY - sy, st);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); shield.remove(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
    e.preventDefault();
  });
}

function focusWin(win) {
  for (const w of wins.values()) w.el.classList.remove('active');
  win.el.classList.remove('min');
  win.el.classList.add('active');
  win.el.style.zIndex = ++zTop;
  renderTasks();
}
async function closeWin(win) {
  if (win.onClose && (await win.onClose()) === false) return;
  if (fsWin === win) gameFullscreen(win, false);
  win.el.remove(); wins.delete(win.id); renderTasks();
}

function renderTasks() {
  const aw = [...wins.values()].find((w) => w.el.classList.contains('active') && !w.el.classList.contains('min'));
  document.body.classList.toggle('gaming', !!aw?.id.startsWith('game-') && isMobile());
  const t = $('#tasks'); t.innerHTML = '';
  for (const w of wins.values()) {
    if (w.dialog) continue;
    const b = h(`<button class="${w.el.classList.contains('active') ? 'active' : ''}">${icon(w.ic)}<span>${esc(w.title)}</span></button>`);
    b.onclick = () => { if (w.el.classList.contains('active')) { w.el.classList.add('min'); w.el.classList.remove('active'); renderTasks(); } else focusWin(w); };
    t.append(b);
  }
}

// ======================= menus =======================
let openMenu = null;
function closeMenus() { openMenu?.remove(); openMenu = null; document.querySelectorAll('.menubar .open').forEach((e) => e.classList.remove('open')); $('#start').classList.remove('active'); $('#startmenu')?.remove(); }
addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('#start') && !e.target.closest('.menubar')) closeMenus(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
addEventListener('blur', closeMenus);

// items: [{label, action, disabled, bold, check, sub:[...], icon}] | '-'
function showMenu(items, x, y, { parent } = {}) {
  const m = h('<div class="menu"></div>');
  for (const it of items) {
    if (it === '-') { m.append(h('<hr>')); continue; }
    if (!it) continue;
    const el = h(`<div class="item ${it.disabled ? 'disabled' : ''} ${it.bold ? 'bold' : ''} ${it.check ? 'check' : ''} ${it.sub ? 'sub' : ''}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}</div>`);
    if (it.sub) {
      let child;
      el.addEventListener('pointerenter', () => {
        m.querySelectorAll('.hot').forEach((e) => e.classList.remove('hot'));
        m._child?.remove(); el.classList.add('hot');
        const r = el.getBoundingClientRect();
        child = showMenu(it.sub, r.right - 3, r.top - 3, { parent: m }); m._child = child;
      });
    } else {
      el.addEventListener('pointerenter', () => { m._child?.remove(); m.querySelectorAll('.hot').forEach((e) => e.classList.remove('hot')); });
      el.addEventListener('click', () => { if (it.disabled) return; closeMenus(); it.action?.(); });
    }
    m.append(el);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(0, Math.min(x, innerWidth - r.width)) + 'px';
  m.style.top = Math.max(0, Math.min(y, innerHeight - r.height)) + 'px';
  if (!parent) { openMenu?.remove(); openMenu = m; } else { const orig = parent.remove.bind(parent); parent.remove = () => { m.remove(); orig(); }; }
  return m;
}

function buildMenubar(bar, spec) {
  for (const [label, items] of Object.entries(spec)) {
    const el = h(`<div>${esc(label)}</div>`);
    const open = () => {
      closeMenus(); el.classList.add('open');
      const r = el.getBoundingClientRect();
      showMenu(typeof items === 'function' ? items() : items, r.left, r.bottom);
    };
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.classList.contains('open') ? closeMenus() : open(); });
    el.addEventListener('pointerenter', () => { if (bar.querySelector('.open') && !el.classList.contains('open')) open(); });
    bar.append(el);
  }
}

// ======================= dialogs =======================
function msgbox(text, { title = 'RetroDesk 98', ic = 'info', buttons = ['OK'], html = false } = {}) {
  return new Promise((resolve) => {
    const body = h(`<div><div class="row">${icon(ic)}<div style="padding-top:8px;max-width:380px${html ? "" : ";white-space:pre-line"}">${html ? text : esc(text)}</div></div><div class="buttons"></div></div>`);
    const win = createWindow({ title, ic, w: 360, body, dialog: true, onClose: () => resolve(null) });
    buttons.forEach((b, i) => {
      const btn = h(`<button>${esc(b)}</button>`);
      btn.onclick = () => { win.onClose = null; closeWin(win); resolve(b); };
      $('.buttons', body).append(btn);
      if (i === 0) setTimeout(() => btn.focus());
    });
  });
}
const confirmBox = async (text, opts = {}) => (await msgbox(text, { ic: 'warn', buttons: ['Yes', 'No'], ...opts })) === 'Yes';
function prompt98(label, value = '', title = 'Rename') {
  return new Promise((resolve) => {
    const body = h(`<div><div class="field-row-stacked" style="width:300px"><label>${esc(label)}</label><input type="text"></div><div class="buttons"><button class="ok">OK</button><button class="cancel">Cancel</button></div></div>`);
    const win = createWindow({ title, ic: 'info', w: 330, body, dialog: true, onClose: () => resolve(null) });
    const inp = $('input', body); inp.value = value; setTimeout(() => inp.select());
    const done = (v) => { win.onClose = null; closeWin(win); resolve(v); };
    $('.ok', body).onclick = () => done(inp.value.trim() || null);
    $('.cancel', body).onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); };
  });
}

// ======================= data =======================
async function refresh() {
  [GAMES] = await Promise.all([api('/games')]);
  const cached = await store.list(store.GAMES).catch(() => []);
  CACHED = new Set(cached.map((c) => decodeURIComponent(c.path)));
  for (const g of GAMES) g.inBrowser = CACHED.has(decodeURIComponent(g.romUrl));
  document.dispatchEvent(new Event('library'));
}

// ======================= library (explorer) =======================
function openLibrary() {
  let filter = 'all', query = '', sel = null, sortKey = 'title', sortDir = 1;
  const body = h(`<div style="display:contents">
    <div class="toolbar">
      <button data-a="upload" title="Upload">${icon('upload')}<span class="lbl">Upload</span></button>
      <button data-a="play" disabled title="Play">${icon('gamepad')}<span class="lbl">Play</span></button>
      <button data-a="props" disabled title="Properties">${icon('info')}<span class="lbl">Properties</span></button>
      <div class="sep"></div>
      <button data-a="storage" title="Storage">${icon('drive')}<span class="lbl">Storage</span></button>
      <button data-a="bios" title="BIOS">${icon('chip')}<span class="lbl">BIOS</span></button>
      <select class="mobile-filter" title="Folder"></select>
      <input type="text" placeholder="Search…">
    </div>
    <div class="explorer"><div class="tree sunken-panel"></div><div class="list sunken-panel"></div></div>
    <div class="status-bar"><p class="status-bar-field s1"></p><p class="status-bar-field s2"></p><p class="status-bar-field s3"></p></div></div>`);
  const win = createWindow({
    id: 'library', title: 'My Games', ic: 'folder', w: 860, hgt: 540, body,
    menubar: {
      File: () => [{ label: 'Upload games…', icon: 'upload', action: pickFiles }, '-', { label: 'Play', bold: true, disabled: !cur(), action: () => preparePlay(cur()) }, { label: 'Properties', disabled: !cur(), action: () => properties(cur()) }, '-', { label: 'Close', action: () => closeWin(win) }],
      View: () => [{ label: 'Refresh', action: refresh }, '-', ...[['title', 'Name'], ['platformShort', 'Console'], ['size', 'Size'], ['lastPlayed', 'Last played']].map(([k, l]) => ({ label: 'Sort by ' + l, check: sortKey === k, action: () => { sortKey = k; render(); } }))],
      Tools: () => [{ label: 'Storage Manager', icon: 'drive', action: openStorage }, { label: 'BIOS Files', icon: 'chip', action: openBios }, { label: 'Controllers', icon: 'gamepad', action: openControllers }],
      Help: () => [{ label: 'About RetroDesk 98', action: about }],
    },
  });
  const tree = $('.tree', body), list = $('.list', body);
  const cur = () => GAMES.find((g) => g.id === sel);
  $('input', body).oninput = (e) => { query = e.target.value.toLowerCase(); render(); };
  body.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => ({ upload: pickFiles, play: () => preparePlay(cur()), props: () => properties(cur()), storage: openStorage, bios: openBios })[b.dataset.a]()));

  function renderTree() {
    const counts = {};
    for (const g of GAMES) counts[g.platform] = (counts[g.platform] || 0) + 1;
    const li = (key, label, ic, n) => `<li data-f="${key}" class="${filter === key ? 'sel' : ''}">${icon(ic)}<span>${esc(label)}</span><span class="count">${n ?? ''}</span></li>`;
    const plats = Object.values(INFO.platforms).filter((p) => counts[p.id]).sort((a, b) => a.name.localeCompare(b.name));
    tree.innerHTML = `<ul>${li('all', 'All Games', 'computer', GAMES.length)}${li('browser', 'In this browser', 'drive', GAMES.filter((g) => g.inBrowser).length)}${li('recent', 'Recently played', 'gamepad', GAMES.filter((g) => g.lastPlayed).length)}
      <li class="group">Consoles</li>${plats.map((p) => li(p.id, p.name, platformIcon(p.id), counts[p.id])).join('') || '<li class="muted">(empty)</li>'}</ul>`;
    tree.querySelectorAll('[data-f]').forEach((e) => (e.onclick = () => { filter = e.dataset.f; sel = null; render(); }));
    const mf = $('.mobile-filter', body);
    mf.innerHTML = [...tree.querySelectorAll('[data-f]')].map((e) => `<option value="${e.dataset.f}" ${e.dataset.f === filter ? 'selected' : ''}>${esc(e.querySelector('span').textContent)} (${e.querySelector('.count').textContent})</option>`).join('');
    mf.onchange = () => { filter = mf.value; sel = null; render(); };
  }

  function rows() {
    let r = GAMES.filter((g) => filter === 'all' || (filter === 'browser' ? g.inBrowser : filter === 'recent' ? g.lastPlayed : g.platform === filter));
    if (query) r = r.filter((g) => (g.title + ' ' + g.file + ' ' + (g.serial || '') + ' ' + g.platformShort).toLowerCase().includes(query));
    if (filter === 'recent') return r.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return r.sort((a, b) => { const x = a[sortKey] ?? 0, y = b[sortKey] ?? 0; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir; });
  }

  function render() {
    renderTree();
    const r = rows();
    if (!GAMES.length) list.innerHTML = `<div class="empty">${icon('upload')}<p>No games yet.</p><p>Drag &amp; drop ROM / ISO files here,<br>or click <b>Upload</b>. The console is detected automatically.</p></div>`;
    else {
      const th = (k, l, cls = '') => `<th data-k="${k}" class="${cls}">${l}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      list.innerHTML = `<table><thead><tr>${th('title', 'Name')}${th('platformShort', 'Console')}${th('size', 'Size')}${th('inBrowser', 'In browser')}${th('lastPlayed', 'Last played')}</tr></thead><tbody>${r.map((g) => `
        <tr data-id="${g.id}" class="${g.id === sel ? 'sel' : ''} ${g.playable ? '' : 'unplayable'}" title="${esc(g.file)}">
          <td>${icon(platformIcon(g.platform))}${esc(g.title)}</td><td>${esc(g.platformShort)}${g.guessed ? ' (?)' : ''}</td>
          <td style="text-align:right">${fmt(g.size)}</td><td>${g.inBrowser ? '✓ Stored' : ''}</td><td>${g.lastPlayed ? new Date(g.lastPlayed).toLocaleDateString() : ''}</td></tr>`).join('')}</tbody></table>`;
      list.querySelectorAll('th').forEach((t) => (t.onclick = () => { if (sortKey === t.dataset.k) sortDir *= -1; else { sortKey = t.dataset.k; sortDir = 1; } render(); }));
      list.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.onclick = () => { const again = sel === tr.dataset.id; sel = tr.dataset.id; render(); if (again && tapped()) preparePlay(cur()); };
        tr.ondblclick = () => preparePlay(cur());
        tr.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); sel = tr.dataset.id; render(); gameMenu(cur(), e.clientX, e.clientY); };
      });
    }
    $('[data-a=play]', body).disabled = !cur()?.playable;
    $('[data-a=props]', body).disabled = !cur();
    $('.s1', body).textContent = `${r.length} object(s)`;
    $('.s2', body).textContent = fmt(r.reduce((a, g) => a + g.size, 0)) + ' on server';
    $('.s3', body).textContent = cur() ? `${cur().platformName}${cur().playable ? '' : ' — not playable in browser'}` : '';
  }
  list.oncontextmenu = (e) => { e.preventDefault(); showMenu([{ label: 'Upload games…', icon: 'upload', action: pickFiles }, { label: 'Refresh', action: refresh }, '-', { label: 'Storage Manager', action: openStorage }], e.clientX, e.clientY); };
  list.onclick = (e) => { if (!e.target.closest('tr')) { sel = null; render(); } };
  list.addEventListener('keydown', () => {});
  dropZone(list);
  win.pad = (b) => {
    const r = rows(); let i = r.findIndex((g) => g.id === sel);
    if (b === BTN.UP || b === BTN.DOWN) {
      i = i < 0 ? 0 : Math.max(0, Math.min(r.length - 1, i + (b === BTN.UP ? -1 : 1)));
      sel = r[i]?.id ?? null; render(); list.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); return true;
    }
    if (b === BTN.LB || b === BTN.RB || b === BTN.LEFT || b === BTN.RIGHT) {
      const keys = [...tree.querySelectorAll('[data-f]')].map((e) => e.dataset.f);
      filter = keys[(keys.indexOf(filter) + (b === BTN.RB || b === BTN.RIGHT ? 1 : -1) + keys.length) % keys.length]; sel = null; render(); return true;
    }
    if (b === BTN.A) { if (cur()) preparePlay(cur()); return true; }
    if (b === BTN.X) { const tr = list.querySelector('tr.sel'); if (cur() && tr) { const rc = tr.getBoundingClientRect(); gameMenu(cur(), rc.left + 40, rc.bottom); } return true; }
    if (b === BTN.Y) { if (cur()) properties(cur()); return true; }
    return b === BTN.B;
  };
  const onLib = () => { if (!GAMES.find((g) => g.id === sel)) sel = null; render(); };
  document.addEventListener('library', onLib);
  if (COARSE) $('.status-bar .s3', body).title = 'Tap a game to select, tap again to play, long-press for more';
  win.onClose = () => document.removeEventListener('library', onLib);
  render();
}

function gameMenu(g, x, y) {
  if (!g) return;
  const plats = Object.values(INFO.platforms).sort((a, b) => a.name.localeCompare(b.name));
  showMenu([
    { label: 'Play', bold: true, icon: 'gamepad', disabled: !g.playable, action: () => preparePlay(g) },
    g.inBrowser ? { label: 'Remove from this browser', action: () => uncacheGame(g) } : { label: 'Keep in this browser (download)', disabled: !g.playable, action: () => cacheGameDialog(g) },
    '-',
    { label: 'Save to my computer', action: () => saveGameToDisk(g) },
    { label: 'Rename…', action: async () => { const t = await prompt98('Game title:', g.title); if (t) { await api(`/games/${g.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) }); refresh(); } } },
    { label: 'Change console', sub: plats.map((p) => ({ label: p.name, check: p.id === g.platform, action: async () => { await api(`/games/${g.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: p.id }) }); refresh(); } })) },
    '-',
    { label: 'Delete from server…', icon: 'trash', action: () => deleteGame(g) },
    '-',
    { label: 'Properties', action: () => properties(g) },
  ], x, y);
}

async function deleteGame(g) {
  if (!(await confirmBox(`Delete "${g.title}" from the server? Its save files and states will be deleted too.`, { title: 'Confirm Delete' }))) return;
  await store.remove(store.GAMES, g.romUrl);
  await api(`/games/${g.id}`, { method: 'DELETE' });
  refresh();
}
async function uncacheGame(g) {
  await store.remove(store.GAMES, g.romUrl);
  refresh();
}

// ======================= upload =======================
function pickFiles() { $('#picker').click(); }
$('#picker').onchange = (e) => { if (e.target.files.length) upload([...e.target.files]); e.target.value = ''; };
function dropZone(el) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); const f = [...e.dataTransfer.files]; if (f.length) upload(f); });
}
dropZone($('#desktop'));

async function upload(files) {
  const total = files.reduce((a, f) => a + f.size, 0);
  const body = h(`<div style="width:380px"><div class="row">${icon('upload')}<div style="flex:1"><p class="t">Uploading ${files.length} file(s), ${fmt(total)}…</p><p class="f muted"></p>
    <div class="progress-indicator segmented"><span class="progress-indicator-bar" style="width:0%"></span></div><p class="n muted"></p></div></div></div>`);
  const win = createWindow({ title: 'Copying…', ic: 'upload', w: 420, body, dialog: true });
  const batch = crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
  let done = 0; const t0 = Date.now();
  try {
    for (const f of files) {
      $('.f', body).textContent = f.name;
      await store.putFile(`/api/upload?batch=${batch}&name=${encodeURIComponent(f.name)}`, f, { onProgress: (l) => {
        const sent = done + l, pct = (sent / total) * 100, rate = sent / ((Date.now() - t0) / 1000 || 1);
        $('.progress-indicator-bar', body).style.width = pct + '%';
        $('.n', body).textContent = `${fmt(sent)} of ${fmt(total)} (${fmt(rate)}/s)`;
      } });
      done += f.size;
    }
    $('.t', body).textContent = 'Detecting consoles…';
    const added = await api(`/upload/finalize?batch=${batch}`, { method: 'POST' });
    win.onClose = null; closeWin(win);
    await refresh();
    uploadReport(added);
  } catch (e) {
    win.onClose = null; closeWin(win);
    msgbox('Upload failed: ' + e.message, { ic: 'error' });
  }
}

function uploadReport(added) {
  const plats = Object.values(INFO.platforms).sort((a, b) => a.name.localeCompare(b.name));
  const body = h(`<div style="width:560px"><p>${added.length} game(s) added to your library. Check the detected consoles:</p>
    <div class="sunken-panel" style="max-height:300px;overflow:auto"><table class="need"><thead><tr><th>Game</th><th>Console</th><th>Detected by</th></tr></thead><tbody>
    ${added.map((g) => `<tr><td>${icon(platformIcon(g.platform)).replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:4px"')}${esc(g.title)}${g.serial ? ` <span class="muted">${esc(g.serial)}</span>` : ''}</td>
      <td><select data-id="${g.id}">${plats.map((p) => `<option value="${p.id}" ${p.id === g.platform ? 'selected' : ''}>${esc(p.short)}</option>`).join('')}</select></td>
      <td class="${g.guessed || g.platform === 'unknown' ? 'warn' : 'muted'}">${esc(g.detection)}</td></tr>`).join('')}</tbody></table></div>
    ${added.some((g) => !g.playable) ? `<p class="warn">Some games are on consoles that can't run in a browser yet (${[...new Set(added.filter((g) => !g.playable).map((g) => g.platformShort))].map(esc).join(', ')}). They are stored on the server for safekeeping.</p>` : ''}
    <div class="buttons"><button class="ok">OK</button></div></div>`);
  const win = createWindow({ title: 'Upload Complete', ic: 'info', w: 600, body, dialog: true });
  body.querySelectorAll('select').forEach((s) => (s.onchange = async () => { await api(`/games/${s.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: s.value }) }); refresh(); }));
  $('.ok', body).onclick = () => closeWin(win);
}

// ======================= play preparation: what needs downloading =======================
async function requirements(g) {
  const p = INFO.platforms[g.platform];
  const threads = !!p.threads;
  const files = await api(`/platforms/${g.platform}/files?webgl2=${store.webgl2() ? 1 : 0}&threads=${threads ? 1 : 0}`);
  const sys = files.engine === 'tst' || files.engine === 'ppsspp'
    ? files.core.map((f) => ({ ...f, group: f.core ? 'core' : 'runtime' }))   // PS2: TabStationToo's module + its page; PSP: PPSSPP
    : [...files.runtime.map((f) => ({ ...f, group: 'runtime' })), ...files.core.map((f) => ({ ...f, group: 'core' }))].map((f) => ({ ...f, url: f.url || `/ejs/${INFO.ejsVersion}/${f.path}` }));
  if (files.bios) sys.push({ path: files.bios.file, url: files.bios.url, size: files.bios.size, group: 'bios' });
  await Promise.all(sys.map(async (f) => { f.cached = (await store.cachedSize(store.SYS, f.url)) != null; }));
  const game = { url: g.romUrl, size: g.size, cached: g.inBrowser };
  const est = await store.estimate();
  if (files.build && files.engine === 'tst') INFO.tst = { ...INFO.tst, installed: true, build: files.build };
  if (files.build && files.engine === 'ppsspp') INFO.ppsspp = { ...INFO.ppsspp, installed: true, build: files.build };
  return { p, sys, game, est, threads, bios: files.bios, engine: files.engine || 'ejs', build: files.build };
}

async function preparePlay(g) {
  if (!g) return;
  const p = INFO.platforms[g.platform];
  if (!p.playable) return msgbox(`${p.name}: ${p.note || 'not playable in the browser.'}\n\nThe file is safely stored on the server.`, { title: g.title, ic: 'warn' });
  if (p.threads && !crossOriginIsolated) return msgbox(`${p.name} needs SharedArrayBuffer (cross-origin isolation). Open RetroDesk via http://localhost or HTTPS so the browser enables it.`, { ic: 'error' });
  if (p.bios?.required && !(await api('/bios'))[g.platform]) {
    if ((await msgbox(`${p.name} needs a BIOS file (${p.bios.files.join(', ')}). Upload one in BIOS Files first.`, { ic: 'warn', buttons: ['Open BIOS Files', 'Cancel'] })) === 'Open BIOS Files') openBios();
    return;
  }
  const states = await api(`/games/${g.id}/states`).catch(() => []);
  const auto = states.find((s) => s.slot === 'auto');
  const R = await requirements(g);
  const groups = R.engine === 'tst'
    ? { core: 'PS2 emulator: TabStationToo (PCSX2)', runtime: 'TabStationToo page (interface, fonts, title list)', bios: 'BIOS' }
    : R.engine === 'ppsspp' ? { core: 'PSP emulator: PPSSPP (WebAssembly)' }
    : { runtime: 'EmulatorJS runtime (shared)', core: `Emulator core: ${p.core}`, bios: 'BIOS' };
  const sum = (arr) => arr.reduce((a, f) => a + (f.size || 0), 0);
  const sysNeed = R.sys.filter((f) => !f.cached);
  const rowsHtml = Object.entries(groups).map(([k, label]) => {
    const fs = R.sys.filter((f) => f.group === k);
    if (!fs.length) return '';
    const need = fs.filter((f) => !f.cached);
    const names = fs.length > 4 ? `${fs.length} files` : fs.map((f) => esc(f.path.split('/').pop())).join(', ');
    return `<tr><td>${esc(label)}<br><span class="muted">${names}</span></td><td class="num">${fmt(sum(fs))}</td><td>${need.length ? `<span class="warn">Download ${fmt(sum(need))}</span>` : '<span class="ok">✓ In browser</span>'}</td></tr>`;
  }).join('');
  const needSys = sum(sysNeed), needGame = R.game.cached ? 0 : R.game.size;
  const memNote = R.engine === 'tst'
    ? `<p class="muted">The PS2 emulator reads the disc in pieces as the game needs them, so “Play without keeping” streams from your server and loads nothing big into memory.</p>
       <p class="warn">${esc(p.note)}${navigator.gpu ? '' : ' This browser has no WebGPU, so the picture is drawn in software (slower).'}</p>`
    : R.game.size > 1.5 * 2 ** 30 ? `<p class="warn">Note: ${R.engine === 'ppsspp' ? 'PPSSPP' : 'EmulatorJS'} loads the whole game into RAM (${fmt(R.game.size)}). Large games need a 64-bit browser with plenty of memory.</p>` : '';
  const body = h(`<div style="width:540px">
    <div class="row">${icon(platformIcon(g.platform))}<div><b>${esc(g.title)}</b><br><span class="muted">${esc(p.name)} · ${esc(g.file)}</span></div></div>
    <fieldset style="margin-top:10px"><legend>Data this browser needs</legend>
      <table class="need"><thead><tr><th>Component</th><th class="num">Size</th><th>Status</th></tr></thead><tbody>${rowsHtml}
      <tr><td>Game file</td><td class="num">${fmt(R.game.size)}</td><td>${R.game.cached ? '<span class="ok">✓ In browser</span>' : '<span class="warn">Download ' + fmt(R.game.size) + '</span>'}</td></tr>
      <tr class="total"><td>To download now</td><td class="num">${fmt(needSys + needGame)}</td><td></td></tr></tbody></table>
    </fieldset>
    <fieldset style="margin-top:8px"><legend>Browser storage</legend>
      ${meterHtml(R.est, needSys + needGame)}
      ${R.est.quota && needSys + needGame > R.est.free ? '<p class="warn">Not enough free browser storage to keep this game. Use “Play without keeping”, or free space in Storage Manager.</p>' : ''}
      ${R.est.persisted ? '' : '<p class="muted">Storage is “best effort”: the browser may evict it under pressure. <a href="#" class="persist">Make storage persistent</a></p>'}
    </fieldset>${memNote}
    <div class="field-row" style="margin-top:8px">${auto ? `<input type="checkbox" id="resume" checked><label for="resume">Resume where I left off (auto-save ${new Date(auto.time).toLocaleString()})</label>` : `<span class="muted">${R.engine === 'tst' ? 'Memory cards &amp; states' : 'Saves &amp; states'} sync to the server automatically.</span>`}</div>
    <div class="buttons"><button class="keep" ${R.est.quota && needSys + needGame > R.est.free ? 'disabled' : ''}><b>${needGame ? 'Download &amp; Play' : 'Play'}</b></button>
      ${R.game.cached ? '' : '<button class="stream">Play without keeping</button>'}<button class="cancel">Cancel</button></div></div>`);
  const win = createWindow({ title: 'Start Game', ic: 'gamepad', w: 580, body, dialog: true });
  $('.persist', body)?.addEventListener('click', async (e) => { e.preventDefault(); const ok = await store.requestPersist(); e.target.parentElement.textContent = ok ? '✓ Storage is now persistent.' : 'The browser declined (Chrome grants it to sites you use often / install; Firefox asks).'; });
  $('.cancel', body).onclick = () => closeWin(win);
  const go = async (keep) => {
    if (fsAuto()) browserFullscreen(); // needs this tap; the game window fills the screen when it opens
    closeWin(win);
    const resume = !!$('#resume', body)?.checked;
    const ok = await downloadWithProgress(g, sysNeed, keep && !R.game.cached);
    if (ok) { if (keep) await refresh(); launch(g, keep || R.game.cached ? 'keep' : 'stream', resume); }
  };
  $('.keep', body).onclick = () => go(true);
  $('.stream', body)?.addEventListener('click', () => go(false));
}

function meterHtml(est, adding = 0) {
  if (!est.quota) return '<p class="muted">Storage quota unknown in this browser.</p>';
  const used = (est.usage / est.quota) * 100, add = Math.min(100 - used, (adding / est.quota) * 100);
  return `<div class="meter sunken-panel"><div class="fill" style="width:${used}%"></div><div class="fill after" style="left:${used}%;width:${add}%"></div></div>
    <div class="legend"><span><i style="background:#000080"></i>Used ${fmt(est.usage)}</span>${adding ? `<span><i style="background:#808000"></i>This game +${fmt(adding)}</span>` : ''}<span><i style="background:#fff;border:1px solid #808080"></i>Free ${fmt(est.free)}</span><span class="muted">of ${fmt(est.quota)}</span></div>`;
}

async function downloadWithProgress(g, sysFiles, withGame) {
  const jobs = [...sysFiles.map((f) => ({ label: f.path.split('/').pop(), url: f.url, size: f.size || 0, cache: store.SYS })), ...(withGame ? [{ label: g.file, url: g.romUrl, size: g.size, cache: store.GAMES }] : [])];
  if (!jobs.length) return true;
  const total = jobs.reduce((a, j) => a + j.size, 0);
  const ac = new AbortController();
  const body = h(`<div style="width:380px"><div class="row">${icon('drive')}<div style="flex:1"><p>Downloading to this browser…</p><p class="f muted"></p>
    <div class="progress-indicator segmented"><span class="progress-indicator-bar" style="width:0%"></span></div><p class="n muted"></p></div></div><div class="buttons"><button class="cancel">Cancel</button></div></div>`);
  const win = createWindow({ title: 'Downloading', ic: 'drive', w: 420, body, dialog: true, onClose: () => ac.abort() });
  $('.cancel', body).onclick = () => closeWin(win);
  let done = 0; const t0 = Date.now();
  try {
    for (const j of jobs) {
      $('.f', body).textContent = j.label;
      await store.download(j.url, { cacheName: j.cache, signal: ac.signal, onProgress: (l) => {
        const s = done + l; $('.progress-indicator-bar', body).style.width = (total ? (s / total) * 100 : 0) + '%';
        $('.n', body).textContent = `${fmt(s)} of ${fmt(total)} (${fmt(s / ((Date.now() - t0) / 1000 || 1))}/s)`;
      } });
      done += j.size;
    }
    win.onClose = null; closeWin(win); return true;
  } catch (e) {
    win.onClose = null; closeWin(win);
    await store.remove(store.GAMES, g.romUrl).catch(() => {});
    if (e.name !== 'AbortError') msgbox('Download failed: ' + e.message + (e.name === 'QuotaExceededError' ? '\nThe browser ran out of storage space.' : ''), { ic: 'error' });
    return false;
  }
}

// Downloads the game file to the computer, in pieces (see store.chunkedStream), with a progress dialog.
async function saveGameToDisk(g) {
  const ac = new AbortController();
  const body = h(`<div style="width:380px"><div class="row">${icon('drive')}<div style="flex:1"><p>Saving to your computer…</p><p class="f muted">${esc(g.file)}</p>
    <div class="progress-indicator segmented"><span class="progress-indicator-bar" style="width:0%"></span></div><p class="n muted"></p></div></div><div class="buttons"><button class="cancel">Cancel</button></div></div>`);
  let win = null; const t0 = Date.now();
  const show = () => { win ??= createWindow({ title: 'Saving', ic: 'drive', w: 420, body, dialog: true, onClose: () => ac.abort() }); $('.cancel', body).onclick = () => closeWin(win); };
  try {
    const ok = await store.saveToDisk(g.romUrl, g.file, { signal: ac.signal, onProgress: (l, t) => {
      show();
      $('.progress-indicator-bar', body).style.width = (t ? (l / t) * 100 : 0) + '%';
      $('.n', body).textContent = `${fmt(l)} of ${fmt(t)} (${fmt(l / ((Date.now() - t0) / 1000 || 1))}/s)`;
    } });
    if (win) { win.onClose = null; closeWin(win); }
    if (ok) balloon(`Saved ${g.file}`);
  } catch (e) {
    if (win) { win.onClose = null; closeWin(win); }
    if (e.name !== 'AbortError') msgbox('Download failed: ' + e.message, { ic: 'error' });
  }
}

async function cacheGameDialog(g) {
  const R = await requirements(g);
  const need = R.sys.filter((f) => !f.cached);
  const add = need.reduce((a, f) => a + (f.size || 0), 0) + g.size;
  const body = h(`<div style="width:420px"><p>Keep <b>${esc(g.title)}</b> in this browser so it starts instantly and works offline?</p>${meterHtml(R.est, add)}
    <p>Downloads ${fmt(add)} (game ${fmt(g.size)}${need.length ? ` + emulator ${fmt(add - g.size)}` : ''}).</p><div class="buttons"><button class="ok">Download</button><button class="cancel">Cancel</button></div></div>`);
  const win = createWindow({ title: 'Keep in Browser', ic: 'drive', w: 460, body, dialog: true });
  $('.cancel', body).onclick = () => closeWin(win);
  $('.ok', body).onclick = async () => { closeWin(win); if (await downloadWithProgress(g, need, true)) refresh(); };
}

// ======================= game window =======================
function launch(g, mode, resume) {
  const id = 'game-' + g.id;
  if (wins.has(id)) return focusWin(wins.get(id));
  const engine = INFO.platforms[g.platform]?.engine;
  const ps2 = engine === 'tst', psp = engine === 'ppsspp';
  const page = ps2 ? '/ps2.html' : psp ? '/psp.html' : '/play.html';
  const frame = h(`<iframe allow="fullscreen; gamepad; autoplay; cross-origin-isolated" src="${page}?id=${g.id}&mode=${mode}${resume ? '&resume=1' : ''}"></iframe>`);
  const send = (msg) => frame.contentWindow.postMessage(msg, location.origin);
  let exiting = false;
  const slotItems = (cmd) => ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((s) => ({ label: 'Slot ' + s, action: () => frame.contentWindow.postMessage({ cmd, slot: s }, location.origin) }));
  const win = createWindow({
    id, title: g.title, ic: 'gamepad', w: 800, hgt: 640, cls: 'game', body: frame,
    menubar: {
      Game: [{ label: 'Save state', sub: slotItems('saveState') }, { label: 'Load state', sub: slotItems('loadState') }, { label: 'Load auto-save', action: () => frame.contentWindow.postMessage({ cmd: 'loadState', slot: 'auto' }, location.origin) }, '-',
        { label: ps2 ? 'Sync memory cards now' : 'Sync save data now', action: () => frame.contentWindow.postMessage({ cmd: 'syncSave' }, location.origin) }, '-',
        { label: 'Controls / remap buttons…', action: () => frame.contentWindow.postMessage({ cmd: 'controls' }, location.origin) }, '-', { label: 'Exit  (hold Select+Start)', action: () => closeWin(win) }],
      View: ps2 ? () => {
        let panel = false; try { panel = localStorage.getItem('rd-ps2-panel') === '1'; } catch {}
        return [...fsMenu(win),
          { label: 'Maximize', check: win.el.classList.contains('max'), action: () => win.toggleMax() }, '-',
          ...vpadMenu(send), '-',
          { label: 'Show emulator panel (TV, console, remote, controllers)', check: panel, action: () => send({ cmd: 'panel', show: !panel }) }, '-',
          { label: `PS2 emulator: TabStationToo ${INFO.tst?.build || ''}`, disabled: true },
          { label: 'Check for emulator update…', action: ps2Update }];
      } : () => {
        const fps = pref('rd-fps', '0') === '1';
        return [...fsMenu(win),
          { label: 'Maximize', check: win.el.classList.contains('max'), action: () => win.toggleMax() }, '-',
          ...vpadMenu(send), '-',
          { label: 'Show FPS', check: fps, action: () => frame.contentWindow.postMessage({ cmd: 'fps', on: !fps }, location.origin) },
          ...(psp ? ['-', { label: `PSP emulator: PPSSPP ${INFO.ppsspp?.build?.slice(0, 8) || ''}`, disabled: true },
            { label: 'PPSSPP menu (settings, graphics)…', action: () => send({ cmd: 'menu' }) },
            { label: 'Check for emulator update…', action: pspUpdate }] : [])];
      },
    },
    onClose: () => {
      if (exiting) return false;
      exiting = true; win.setTitle(g.title + ' — saving…');
      return new Promise((resolve) => {
        const fin = () => { removeEventListener('message', onMsg); clearTimeout(t); resolve(true); refresh(); };
        const onMsg = (e) => { if (e.data?.type === 'exited' && e.data.gameId === g.id) fin(); };
        addEventListener('message', onMsg);
        const t = setTimeout(fin, ps2 || psp ? 25000 : 8000); // a PS2/PSP state is tens of MB
        frame.contentWindow.postMessage({ cmd: 'exit' }, location.origin);
      });
    },
  });
  win.frame = frame;
  // a full-screen button over the game on touch screens, where the menu bar is small and full screen hides it
  const fsBtn = h(`<button class="fs-btn" title="Full screen" aria-label="Full screen">${FS_ICON}</button>`);
  fsBtn.onclick = (e) => { e.stopPropagation(); gameFullscreen(win); };
  const hint = h('<div class="rotate-hint"><div>⟳</div>Turn your device sideways for the full-size picture.<br><small>(tap to hide)</small></div>');
  hint.onclick = () => win.el.classList.add('hint-off');
  win.body.append(fsBtn, hint);
  win.el.addEventListener('pointerdown', () => setTimeout(() => frame.focus()));
  if (isMobile()) win.el.classList.add('max');
  if (fsAuto()) gameFullscreen(win, true);
  setTimeout(() => frame.focus(), 300);
}
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'saved') trayBlink();
  if (e.data?.type === 'requestExit') { const w = wins.get('game-' + e.data.gameId); if (w) closeWin(w); }
});
function trayBlink() { const t = $('#tray-icons'); t.innerHTML = icon('upload'); t.title = 'Saved to server ' + new Date().toLocaleTimeString(); clearTimeout(trayBlink.t); trayBlink.t = setTimeout(() => (t.innerHTML = ''), 2500); }

// TabStationToo is updated often; the server keeps one deploy and can fetch the newest.
async function ps2Update() {
  let c;
  try { c = await api('/ps2/emulator?check=1'); } catch (e) { return msgbox('Could not reach the TabStationToo site: ' + e.message, { ic: 'error' }); }
  if (!c.installed) return msgbox('The PS2 emulator is downloaded the first time you start a PS2 game.', { title: 'PS2 emulator' });
  if (!c.updateAvailable) return msgbox(`The PS2 emulator is up to date.\n\nTabStationToo build ${c.build}, downloaded ${new Date(c.fetched).toLocaleString()}.`, { title: 'PS2 emulator' });
  if ((await msgbox(`A newer TabStationToo build is available (${c.latest}; you have ${c.build}).\n\nUpdate now? PS2 games that are open keep running on the old build until you close them.`, { title: 'PS2 emulator', buttons: ['Update', 'Cancel'] })) !== 'Update') return;
  try {
    const r = await api('/ps2/emulator/update', { method: 'POST' });
    INFO.tst = r;
    // the old build's files in this browser's cache are no longer used
    for (const f of await store.list(store.SYS)) if (f.path.startsWith('/tst/') && !f.path.startsWith(`/tst/${r.build}/`)) await store.remove(store.SYS, f.url);
    msgbox(`Updated to TabStationToo build ${r.build}.`, { title: 'PS2 emulator' });
  } catch (e) { msgbox('Update failed: ' + e.message, { ic: 'error' }); }
}

// PPSSPP's web build: the server keeps one build and can fetch the newest.
async function pspUpdate() {
  let c;
  try { c = await api('/psp/emulator?check=1'); } catch (e) { return msgbox('Could not reach the PPSSPP build site: ' + e.message, { ic: 'error' }); }
  if (!c.installed) return msgbox('The PSP emulator is downloaded the first time you start a PSP game.', { title: 'PSP emulator' });
  if (!c.updateAvailable) return msgbox(`The PSP emulator is up to date.\n\nPPSSPP build ${c.build}, downloaded ${new Date(c.fetched).toLocaleString()}.`, { title: 'PSP emulator' });
  if ((await msgbox(`A newer PPSSPP build is available (${c.latest}; you have ${c.build}).\n\nUpdate now? PSP games that are open keep running on the old build until you close them. Save states from an older build usually still load, but not always.`, { title: 'PSP emulator', buttons: ['Update', 'Cancel'] })) !== 'Update') return;
  try {
    const r = await api('/psp/emulator/update', { method: 'POST' });
    INFO.ppsspp = r;
    for (const f of await store.list(store.SYS)) if (f.path.startsWith('/ppsspp/') && !f.path.startsWith(`/ppsspp/${r.build}/`)) await store.remove(store.SYS, f.url);
    msgbox(`Updated to PPSSPP build ${r.build}.`, { title: 'PSP emulator' });
  } catch (e) { msgbox('Update failed: ' + e.message, { ic: 'error' }); }
}

// ======================= properties =======================
async function properties(g) {
  if (!g) return;
  const p = INFO.platforms[g.platform];
  const states = await api(`/games/${g.id}/states`).catch(() => []);
  const body = h(`<div style="width:460px">
    <menu role="tablist"><li role="tab" aria-selected="true" data-t="gen"><a>General</a></li><li role="tab" data-t="saves"><a>Saves</a></li></menu>
    <div class="window" role="tabpanel"><div class="window-body">
      <div data-p="gen"><div class="row">${icon(platformIcon(g.platform))}<b style="padding-top:8px">${esc(g.title)}</b></div><hr>
        <table class="kv"><tr><td>Console:</td><td>${esc(p.name)} ${p.playable ? '' : '<span class="warn">(not playable in browser)</span>'}</td></tr>
        <tr><td>Detected by:</td><td>${esc(g.detection)}</td></tr>${g.serial ? `<tr><td>Serial:</td><td>${esc(g.serial)}</td></tr>` : ''}
        <tr><td>File:</td><td>${esc(g.file)}</td></tr>${g.bundled ? `<tr><td>Contains:</td><td>${g.bundled.map(esc).join('<br>')}</td></tr>` : ''}
        <tr><td>Size:</td><td>${fmt(g.size)} (${g.size.toLocaleString()} bytes)</td></tr>
        <tr><td>In this browser:</td><td>${g.inBrowser ? 'Yes' : 'No'}</td></tr>
        ${p.playable ? `<tr><td>Emulator:</td><td>${p.engine === 'tst' ? `TabStationToo ${esc(INFO.tst?.build || '(downloads on first play)')} (PCSX2, WebAssembly)` : p.engine === 'ppsspp' ? `PPSSPP ${esc(INFO.ppsspp?.build?.slice(0, 8) || '(downloads on first play)')} (WebAssembly)` : `${esc(p.core)} (EmulatorJS ${esc(INFO.ejsVersion)})`}</td></tr>` : ''}
        <tr><td>Added:</td><td>${new Date(g.added).toLocaleString()}</td></tr>
        <tr><td>Last played:</td><td>${g.lastPlayed ? new Date(g.lastPlayed).toLocaleString() : 'Never'}</td></tr>
        <tr><td>Play time:</td><td>${Math.floor(g.playTime / 3600)}h ${Math.floor((g.playTime % 3600) / 60)}m</td></tr></table>
        ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}</div>
      <div data-p="saves" hidden><p>Battery save: ${g.saveUpdated ? 'synced ' + new Date(g.saveUpdated).toLocaleString() : 'none yet'}</p>
        <div class="shots">${states.map((s) => `<figure>${s.shot ? `<img src="/api/games/${g.id}/states/${s.slot}/shot?t=${s.time}" loading="lazy">` : '<div class="muted">(no screenshot)</div>'}<figcaption>${s.slot === 'auto' ? 'Auto-save' : 'Slot ' + s.slot}<br><span class="muted">${new Date(s.time).toLocaleString()}</span><br><button data-del="${s.slot}">Delete</button></figcaption></figure>`).join('') || '<p class="muted">No save states.</p>'}</div></div>
    </div></div>
    <div class="buttons"><button class="ok">OK</button></div></div>`);
  const win = createWindow({ title: g.title + ' Properties', ic: 'info', w: 500, body, dialog: true });
  body.querySelectorAll('[role=tab]').forEach((t) => (t.onclick = () => { body.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', x === t)); body.querySelectorAll('[data-p]').forEach((x) => (x.hidden = x.dataset.p !== t.dataset.t)); }));
  body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await fetch(`/api/games/${g.id}/states/${b.dataset.del}`, { method: 'DELETE' }); b.closest('figure').remove(); }));
  $('.ok', body).onclick = () => closeWin(win);
}

// ======================= storage manager =======================
const CORE_RE = /^\/(?:ejs\/(?:[^/]+\/)?|data\/)cores\/(?:reports\/)?([a-z0-9_]+?)(?:-thread)?(?:-legacy)?(?:-wasm\.data|\.json|-assets\.zip)$/;
async function openStorage() {
  const win = createWindow({ id: 'storage', title: 'Storage Manager', ic: 'drive', w: 620, hgt: 480, body: '<div class="scroll" style="flex:1;padding:8px;background:silver"></div>' });
  const root = $('.scroll', win.body);
  async function render() {
    const [est, sys, games] = await Promise.all([store.estimate(), store.list(store.SYS), store.list(store.GAMES)]);
    const byGroup = {};
    for (const f of sys) {
      const name = f.path.startsWith('/api/bios/') ? 'BIOS: ' + f.path.split('/')[3] : f.path.startsWith('/tst/') ? 'PS2 emulator: TabStationToo ' + f.path.split('/')[2] : f.path.startsWith('/ppsspp/') ? 'PSP emulator: PPSSPP ' + f.path.split('/')[2].slice(0, 8) : (CORE_RE.exec(f.path)?.[1] ? 'Core: ' + CORE_RE.exec(f.path)[1] : 'EmulatorJS runtime');
      (byGroup[name] ||= []).push(f);
    }
    const sum = (a) => a.reduce((x, f) => x + f.size, 0);
    const gameRows = games.map((f) => ({ f, g: GAMES.find((g) => decodeURIComponent(g.romUrl) === decodeURIComponent(f.path)) }));
    root.innerHTML = `
      <fieldset><legend>This browser</legend>${meterHtml(est)}
        <p>Emulators &amp; BIOS: <b>${fmt(sum(sys))}</b> · Games: <b>${fmt(sum(games))}</b> · Persistent: <b>${est.persisted ? 'Yes' : 'No'}</b>
        ${est.persisted ? '' : ' <button class="persist">Make persistent</button>'}</p>
        <p class="muted">Game files live on your server; this browser only keeps copies of what you choose. Saves are always on the server.</p></fieldset>
      <fieldset style="margin-top:8px"><legend>Emulator data (${fmt(sum(sys))})</legend>
        <table class="need"><thead><tr><th>Component</th><th>Files</th><th class="num">Size</th><th></th></tr></thead><tbody>
        ${Object.entries(byGroup).sort().map(([k, fs]) => `<tr><td>${esc(k)}</td><td>${fs.length}</td><td class="num">${fmt(sum(fs))}</td><td><button data-sys="${esc(k)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing downloaded yet.</td></tr>'}</tbody></table></fieldset>
      <fieldset style="margin-top:8px"><legend>Games kept in this browser (${fmt(sum(games))})</legend>
        <table class="need"><thead><tr><th>Game</th><th>Console</th><th class="num">Size</th><th></th></tr></thead><tbody>
        ${gameRows.map(({ f, g }) => `<tr><td>${esc(g?.title || decodeURIComponent(f.path.split('/').pop()))}</td><td>${esc(g?.platformShort || '')}</td><td class="num">${fmt(f.size)}</td><td><button data-game="${esc(f.url)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No games stored. Right-click a game → “Keep in this browser”.</td></tr>'}</tbody></table></fieldset>
      <div class="buttons"><button class="clear">Clear everything</button><button class="close">Close</button></div>`;
    root.querySelector('.persist')?.addEventListener('click', async () => { await store.requestPersist(); render(); });
    root.querySelectorAll('[data-sys]').forEach((b) => (b.onclick = async () => { for (const f of byGroup[b.dataset.sys]) await store.remove(store.SYS, f.url); render(); }));
    root.querySelectorAll('[data-game]').forEach((b) => (b.onclick = async () => { await store.remove(store.GAMES, b.dataset.game); await refresh(); render(); }));
    root.querySelector('.close').onclick = () => closeWin(win);
    root.querySelector('.clear').onclick = async () => {
      if (!(await confirmBox('Remove all emulators and games from this browser? (Nothing on the server is touched.)'))) return;
      await caches.delete(store.SYS); await caches.delete(store.GAMES); await refresh(); render();
    };
  }
  const onLib = () => wins.has('storage') && render();
  document.addEventListener('library', onLib);
  const oc = win.onClose; win.onClose = () => { document.removeEventListener('library', onLib); return oc?.(); };
  render();
}

// ======================= BIOS =======================
async function openBios() {
  const win = createWindow({ id: 'bios', title: 'BIOS Files', ic: 'chip', w: 700, hgt: 560, body: '<div class="scroll" style="flex:1;padding:8px;background:silver"></div>' });
  const root = $('.scroll', win.body);
  // Every console is listed, so nobody reads this as "the supported consoles". Sorted by how much the BIOS matters.
  const LEVELS = {
    required:    { rank: 0, label: '<b>Required</b>' },
    recommended: { rank: 1, label: 'Recommended' },
    optional:    { rank: 2, label: 'Optional' },
    none:        { rank: 3, label: '<span class="muted">Not needed</span>' },
    unplayable:  { rank: 4, label: '<span class="muted">Not playable in browser</span>' },
  };
  const levelOf = (p) => (!p.playable ? 'unplayable' : p.bios ? p.bios.level : 'none');
  async function render() {
    const have = await api('/bios');
    const plats = Object.values(INFO.platforms).filter((p) => p.id !== 'unknown')
      .sort((a, b) => LEVELS[levelOf(a)].rank - LEVELS[levelOf(b)].rank || a.name.localeCompare(b.name));
    const row = (p) => {
      const lv = levelOf(p), h = have[p.id];
      const files = p.bios ? `${p.bios.files.map(esc).join(', ')}<br><span class="muted">${esc(p.bios.note)}</span>`
        : `<span class="muted">${lv === 'none' ? 'The emulator has everything built in.' : 'No browser emulator yet, so no BIOS is used.'}</span>`;
      const status = !p.bios ? '<span class="muted">—</span>'
        : h ? `<span class="ok">✓ ${esc(h.file)}</span><br><span class="muted">${fmt(h.size)}</span>`
        : lv === 'required' ? '<span class="warn">Missing</span>' : '<span class="muted">Not uploaded</span>';
      const btns = p.bios ? `<button data-up="${p.id}">Upload…</button>${h ? ` <button data-rm="${p.id}">Remove</button>` : ''}` : '';
      return `<tr><td>${esc(p.name)}</td><td>${LEVELS[lv].label}</td><td class="wrap">${files}</td><td${p.bios ? "" : " class=\"nobios\""}>${status}</td><td>${btns}</td></tr>`;
    };
    root.innerHTML = `<p>Some consoles need a BIOS dumped from the original hardware. Upload your own dump (one file per console; zip several files together).
      Consoles marked <i>Not needed</i> play without one.</p>
      <table class="need bios"><thead><tr><th>Console</th><th>BIOS</th><th>Expected file(s)</th><th>Status</th><th></th></tr></thead><tbody>
      ${plats.map(row).join('')}</tbody></table>`;
    root.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => {
      const pk = $('#biospicker');
      pk.onchange = async () => {
        const f = pk.files[0]; pk.value = ''; if (!f) return;
        const plat = b.dataset.up, cell = b.closest('tr').children[3], name = INFO.platforms[plat]?.name || plat;
        root.querySelectorAll('button').forEach((x) => (x.disabled = true));
        cell.innerHTML = `<span class="muted">Uploading ${esc(f.name)}…</span>`;
        try {
          await store.putFile(`/api/bios/${plat}?name=${encodeURIComponent(f.name)}`, f, {
            onProgress: (l, t) => (cell.innerHTML = `<span class="muted">Uploading… ${t ? Math.floor((l / t) * 100) : 100}%</span>`),
          });
        } catch (e) {
          await render();
          msgbox(`The ${name} BIOS (${f.name}, ${fmt(f.size)}) was not uploaded.\n\n${e.message}${have[plat] ? `\n\nThe BIOS already on the server (${have[plat].file}) was kept.` : ''}`, { title: 'BIOS upload failed', ic: 'error' });
          return;
        }
        render();
      };
      pk.click();
    }));
    root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      try { await api(`/bios/${b.dataset.rm}`, { method: 'DELETE' }); } catch (e) { msgbox('The BIOS was not removed: ' + e.message, { ic: 'error' }); }
      render();
    }));
  }
  render();
}

function about() {
  msgbox(`<b>RetroDesk 98</b><br>Your own game library, played locally in the browser.<br><br>Emulation: <a href="https://emulatorjs.org" target="_blank" rel="noopener">EmulatorJS</a> ${esc(INFO.ejsVersion)} (libretro cores)<br>Theme: <a href="https://jdan.github.io/98.css/" target="_blank" rel="noopener">98.css</a><br><br>${GAMES.length} games on server.`, { html: true, title: 'About' });
}

// ======================= desktop, start menu, taskbar =======================
const DESK = [
  { ic: 'computer', label: 'My Games', action: openLibrary },
  { ic: 'drive', label: 'Storage Manager', action: openStorage },
  { ic: 'upload', label: 'Upload Games', action: pickFiles },
  { ic: 'chip', label: 'BIOS Files', action: openBios },
  { ic: 'gamepad', label: 'Controllers', action: openControllers },
];
function renderDesktop() {
  const box = $('#icons'); box.innerHTML = '';
  for (const d of DESK) {
    const el = h(`<div class="dicon" tabindex="0">${icon(d.ic)}<span>${esc(d.label)}</span></div>`);
    el.onclick = (e) => { e.stopPropagation(); box.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); if (tapped()) d.action(); };
    el.ondblclick = d.action;
    el.onkeydown = (e) => { if (e.key === 'Enter') d.action(); };
    el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showMenu([{ label: 'Open', bold: true, action: d.action }], e.clientX, e.clientY); };
    box.append(el);
  }
  // recently played games as desktop shortcuts
  for (const g of GAMES.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6)) {
    const el = h(`<div class="dicon" tabindex="0">${icon(platformIcon(g.platform))}<span>${esc(g.title)}</span></div>`);
    el.onclick = (e) => { e.stopPropagation(); box.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); if (tapped()) preparePlay(g); };
    el.ondblclick = () => preparePlay(g);
    el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); gameMenu(g, e.clientX, e.clientY); };
    box.append(el);
  }
}
document.addEventListener('library', renderDesktop);
$('#desktop').addEventListener('click', (e) => { if (e.target.id === 'desktop' || e.target.id === 'icons') document.querySelectorAll('.dicon.sel').forEach((x) => x.classList.remove('sel')); });
$('#desktop').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.window')) { if (!e.target.closest('input,textarea')) e.preventDefault(); return; }
  e.preventDefault();
  showMenu([{ label: 'Upload games…', icon: 'upload', action: pickFiles }, { label: 'Refresh', action: refresh }, '-',
    { label: 'Arrange windows', sub: [{ label: 'Cascade', action: cascade }, { label: 'Minimize all', action: () => { wins.forEach((w) => w.el.classList.add('min')); renderTasks(); } }] }, '-',
    { label: 'Storage Manager', icon: 'drive', action: openStorage }, { label: 'Properties', action: about }], e.clientX, e.clientY);
});
function cascade() { let i = 0; for (const w of wins.values()) { w.el.classList.remove('min', 'max'); w.el.style.left = 20 + i * 24 + 'px'; w.el.style.top = 20 + i * 24 + 'px'; focusWin(w); i++; } }

const startBtn = $('#start');
startBtn.innerHTML = icon('start') + 'Start';
startBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if ($('#startmenu')) return closeMenus();
  closeMenus(); startBtn.classList.add('active');
  const recent = GAMES.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
  const m = h(`<div id="startmenu" class="menu"><div class="band"><b>RetroDesk</b>98</div><div class="items"></div></div>`);
  const items = [
    { ic: 'computer', label: 'My Games', action: openLibrary },
    { ic: 'gamepad', label: 'Recent Games', sub: recent.length ? recent.map((g) => ({ label: g.title, action: () => preparePlay(g) })) : [{ label: '(none)', disabled: true }] },
    { ic: 'upload', label: 'Upload Games…', action: pickFiles }, '-',
    { ic: 'drive', label: 'Storage Manager', action: openStorage },
    { ic: 'chip', label: 'BIOS Files', action: openBios },
    { ic: 'gamepad', label: 'Controllers', action: openControllers },
    { ic: 'info', label: 'About', action: about }, '-',
    { ic: 'computer', label: fsElement() ? 'Exit full screen' : 'Full screen mode', action: () => (fsElement() ? exitFullscreen() : enterFullscreen(document.documentElement)) },
    ...(isStandalone() ? [] : [{ ic: 'upload', label: 'Install as app…', action: installApp }]), '-',
    { ic: 'computer', label: 'Shut Down…', action: shutdown },
  ];
  for (const it of items) {
    if (it === '-') { $('.items', m).append(h('<hr>')); continue; }
    const el = h(`<div class="item ${it.sub ? 'sub' : ''}">${icon(it.ic)}${esc(it.label)}</div>`);
    if (it.sub) el.addEventListener('pointerenter', () => { openMenu?.remove(); const r = el.getBoundingClientRect(); showMenu(it.sub, r.right - 3, r.top); });
    else { el.addEventListener('pointerenter', () => { openMenu?.remove(); openMenu = null; }); el.onclick = () => { closeMenus(); it.action(); }; }
    $('.items', m).append(el);
  }
  document.body.append(m);
});
function shutdown() {
  const s = h('<div id="shutdown">It\'s now safe to turn off<br>your computer.<br><br><small style="font-size:12px;color:#888">(click to restart)</small></div>');
  s.onclick = () => s.remove(); document.body.append(s);
}

addEventListener('resize', () => {
  if (isMobile()) for (const w of wins.values()) if (!w.dialog) w.el.classList.add('max');
  renderTasks();
});

const clock = () => ($('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
clock(); setInterval(clock, 15000);

// ======================= controllers =======================
const BTN_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Home'];
async function openControllers() {
  const body = h(`<div class="scroll" style="flex:1;padding:8px;background:silver">
    <fieldset><legend>Connected controllers</legend><div class="pads"></div></fieldset>
    <fieldset style="margin-top:8px"><legend>Button mappings (saved on the server, per console)</legend><div class="maps"></div></fieldset>
    <fieldset style="margin-top:8px"><legend>Using a controller</legend>
      <table class="kv"><tr><td>D-pad / stick</td><td>Move selection, menus and buttons</td></tr><tr><td>A</td><td>Play / OK</td></tr><tr><td>B</td><td>Back / Close dialog</td></tr>
      <tr><td>X</td><td>Game menu (right-click)</td></tr><tr><td>Y</td><td>Properties</td></tr><tr><td>LB / RB</td><td>Switch console folder</td></tr><tr><td>Start</td><td>Start menu</td></tr>
      <tr><td>Hold Select+Start</td><td>Exit the game (saves first)</td></tr></table>
      <p class="muted">To remap buttons for a console: in a game, choose <b>Game → Controls / remap buttons…</b>. The mapping is saved on the server and used for every game of that console, on every device.</p></fieldset></div>`);
  const win = createWindow({ id: 'controllers', title: 'Controllers', ic: 'gamepad', w: 600, hgt: 520, body });
  const padsEl = $('.pads', body);
  let raf;
  const draw = () => {
    if (!wins.has('controllers')) return cancelAnimationFrame(raf);
    const ps = pads();
    padsEl.innerHTML = ps.length ? ps.map((p) => `<div style="margin-bottom:8px"><b>Player ${p.index + 1}:</b> ${esc(p.id)} <span class="${p.mapping === 'standard' ? 'ok' : 'warn'}">(${p.mapping === 'standard' ? 'standard layout' : 'non-standard layout: remap it in-game'})</span>
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">${p.buttons.slice(0, 17).map((b, i) => `<span class="sunken-panel" style="padding:1px 4px;min-width:34px;text-align:center;${b.pressed ? 'background:#000080;color:#fff' : 'background:#fff'}">${BTN_NAMES[i] || i}</span>`).join('')}</div>
      <div class="muted">Sticks: ${p.axes.map((a) => a.toFixed(2)).join(' / ')}</div></div>`).join('')
      : '<p>No controller detected. Connect one (USB or Bluetooth) and <b>press any button</b>. Browsers only reveal a controller after you press a button.</p>';
    raf = requestAnimationFrame(draw);
  };
  draw();
  const renderMaps = async () => {
    const maps = await api('/controls');
    const ids = Object.keys(maps);
    $('.maps', body).innerHTML = ids.length ? `<table class="need"><tbody>${ids.map((id) => `<tr><td>${esc(INFO.platforms[id]?.name || id)}</td><td class="muted">custom mapping</td><td><button data-reset="${esc(id)}">Reset to default</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No custom mappings. All consoles use their emulator\'s default buttons.</p>';
    body.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => { await api('/controls/' + b.dataset.reset, { method: 'DELETE' }); renderMaps(); }));
  };
  renderMaps();
}

// ======================= gamepad: drive the desktop =======================
const isVisible = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
function activeWin() { for (const w of wins.values()) if (w.el.classList.contains('active') && !w.el.classList.contains('min')) return w; return null; }

function menuNav(b) {
  const menus = [...document.querySelectorAll('.menu')];
  let cur = menus[menus.length - 1];
  // the deepest menu that already has a highlighted item, or the newest one
  for (let i = menus.length - 1; i >= 0; i--) { if (menus[i].querySelector('.item.hot')) { cur = menus[i]; break; } }
  const items = [...cur.querySelectorAll(':scope .item:not(.disabled)')].filter((e) => e.closest('.menu') === cur);
  const hot = cur.querySelector('.item.hot');
  let i = items.indexOf(hot);
  const setHot = (el, open = false) => { items.forEach((x) => x.classList.remove('hot')); el.classList.add('hot'); if (!el.classList.contains('sub') || open) el.dispatchEvent(new Event('pointerenter')); el.classList.add('hot'); };
  const enterSub = () => { setHot(hot, true); const child = [...document.querySelectorAll('.menu')].pop(); child?.querySelector('.item:not(.disabled)')?.classList.add('hot'); };
  if (b === BTN.UP || b === BTN.DOWN) { i = i < 0 ? (b === BTN.UP ? items.length - 1 : 0) : (i + (b === BTN.UP ? -1 : 1) + items.length) % items.length; setHot(items[i]); }
  else if ((b === BTN.RIGHT || b === BTN.A) && hot?.classList.contains('sub')) enterSub();
  else if (b === BTN.A && hot) hot.click();
  else if (b === BTN.LEFT && menus.length > 1 && cur !== menus[0]) { cur.remove(); if (openMenu === cur) openMenu = null; }
  else if (b === BTN.B || b === BTN.START) closeMenus();
}

function focusNav(w, b) {
  const els = [...w.el.querySelectorAll('.window-body button:not([disabled]), .window-body input:not([type=checkbox]):not([type=radio]):not([disabled]), .window-body select, .window-body a[href], .window-body label[for], .window-body [role=tab]')].filter(isVisible);
  const a = document.activeElement;
  let i = els.indexOf(a);
  if (a?.tagName === 'SELECT' && (b === BTN.LEFT || b === BTN.RIGHT)) {
    a.selectedIndex = Math.max(0, Math.min(a.options.length - 1, a.selectedIndex + (b === BTN.LEFT ? -1 : 1))); a.dispatchEvent(new Event('change')); return;
  }
  if ([BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT].includes(b) && els.length) { i = i < 0 ? 0 : (i + (b === BTN.UP || b === BTN.LEFT ? -1 : 1) + els.length) % els.length; els[i].focus(); els[i].scrollIntoView({ block: 'nearest' }); }
  else if (b === BTN.A) { if (i >= 0) a.click(); else els[0]?.focus(); }
  else if (b === BTN.B) closeWin(w);
  else if (b === BTN.LB || b === BTN.RB) { const tabs = [...w.el.querySelectorAll('[role=tab]')]; const t = tabs.findIndex((x) => x.getAttribute('aria-selected') === 'true'); tabs[(t + (b === BTN.RB ? 1 : -1) + tabs.length) % tabs.length]?.click(); }
}

function padButton(b) {
  if (openMenu || $('#startmenu')) return menuNav(b);
  const w = activeWin();
  if (w?.id.startsWith('game-')) return;               // EmulatorJS owns the controller while playing
  if (b === BTN.START || b === BTN.HOME) { startBtn.dispatchEvent(new PointerEvent('pointerdown')); return; }
  if (!w) { if (b === BTN.A) openLibrary(); return; }
  if (w.pad?.(b)) return;
  focusNav(w, b);
}

function balloon(text) {
  document.querySelector('.balloon')?.remove();
  const el = h(`<div class="balloon">${icon('gamepad')}<div>${esc(text)}</div></div>`);
  el.onclick = () => el.remove();
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}
function trayPad() {
  const ps = pads(), t = $('#tray-pad');
  t.innerHTML = ps.length ? icon('gamepad') : '';
  t.title = ps.map((p) => `Player ${p.index + 1}: ${p.id}`).join('\n');
  t.onclick = openControllers;
}
watchGamepads({
  onButton: padButton,
  onConnect: (p) => { trayPad(); balloon(`Controller connected: ${p.id.replace(/\s*\(.*$/, '')}`); },
  onDisconnect: (p) => { trayPad(); balloon(`Controller disconnected: ${p.id.replace(/\s*\(.*$/, '')}`); },
  enabled: () => document.visibilityState === 'visible' && fsElement()?.tagName !== 'IFRAME',
  paused: () => !openMenu && !$('#startmenu') && (fsElement()?.tagName === 'IFRAME' || !!activeWin()?.id.startsWith('game-')),
});

// ======================= boot =======================
INFO = await api('/info');
// Emulator files cached for another EmulatorJS release (or before versioned URLs), or for an older PPSSPP build,
// are never used again.
store.list(store.SYS).then(async (files) => {
  for (const f of files) if ((f.path.startsWith('/ejs/') && !f.path.startsWith(`/ejs/${INFO.ejsVersion}/`)) || (f.path.startsWith('/data/') && !INFO.ejsVersion.startsWith('4.3'))
    || (f.path.startsWith('/ppsspp/') && INFO.ppsspp?.build && !f.path.startsWith(`/ppsspp/${INFO.ppsspp.build}/`))) await store.remove(store.SYS, f.url);
}).catch(() => {});
await refresh();
openLibrary();
