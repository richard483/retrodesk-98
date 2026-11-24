// The desktop: icons you can move, select with a rubber band, add and delete; the wallpaper, colour scheme and
// screen saver (Display Properties); and Active Desktop widgets. The layout is kept on the server (/api/desktop),
// so it is the same on every device; icon places are grid cells, which fit any screen.
export function initDesktop(ctx) {
  const { h, esc, icon, platformIcon, fmt, showMenu, createWindow, closeWin, msgbox, confirmBox, prompt98 } = ctx;
  const $ = (s, r = document) => r.querySelector(s);
  const desk = $('#desktop'), box = $('#icons');
  const CW = 80, CH = 82, PAD = 8;           // grid cell and margin, px
  const MOVE = 6;                             // px a pointer moves before a press becomes a drag

  // ---------------------------------------------------------------- settings
  const APPS = ctx.apps; // { key: { ic, label, action, fixed? } }
  let cfg = null, saveTimer = 0;
  const defaults = () => ({ v: 1, icons: null, autoArrange: false, wallpaper: { id: 'none', color: '#008080', mode: 'stretch' }, scheme: 'standard', saver: { id: 'none', wait: 10 }, widgets: [] });
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => fetch('/api/desktop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }).catch(() => {}), 400); }
  async function load() {
    try { const r = await fetch('/api/desktop'); cfg = r.status === 200 ? { ...defaults(), ...(await r.json()) } : null; } catch { cfg = null; }
    if (!cfg) cfg = defaults();
    if (!cfg.icons) { // first run: the system icons, then the recently played games (what the desktop used to show)
      cfg.icons = Object.keys(APPS).map((key) => ({ key: 'app:' + key }));
      for (const g of ctx.games().filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6)) cfg.icons.push({ key: 'game:' + g.id });
      save();
    }
    applyWallpaper(); applyScheme(); renderWidgets(); render();
  }

  // ---------------------------------------------------------------- icons
  const rowsFit = () => Math.max(1, Math.floor((desk.clientHeight - PAD * 2) / CH));
  const colsFit = () => Math.max(1, Math.floor((desk.clientWidth - PAD * 2) / CW));
  const target = (it) => {
    if (it.key.startsWith('app:')) { const a = APPS[it.key.slice(4)]; return a && { kind: 'app', ic: a.ic, label: it.name || a.label, open: a.action, fixed: a.fixed }; }
    const g = ctx.games().find((x) => x.id === it.key.slice(5));
    return g && { kind: 'game', g, ic: platformIcon(g.platform), label: it.name || g.title, badge: g.platformShort, open: () => ctx.preparePlay(g) };
  };
  // Cells: an icon keeps its cell when the screen has room for it, else it moves to the first free one.
  function layout() {
    const rows = rowsFit(), cols = colsFit(), taken = new Set(), out = [];
    const items = cfg.icons.map((it) => ({ it, t: target(it) })).filter((x) => x.t);
    if (cfg.autoArrange) items.sort(sortBy('type')).forEach((x) => { delete x.it.c; delete x.it.r; });
    const free = () => { for (let c = 0; ; c++) for (let r = 0; r < rows; r++) if (!taken.has(c + ',' + r)) return [c, r]; };
    for (const x of items) {
      let { c, r } = x.it;
      if (c == null || r == null || r >= rows || c >= Math.max(cols, 1) + 2 || taken.has(c + ',' + r)) [c, r] = free();
      x.it.c = c; x.it.r = r; taken.add(c + ',' + r); out.push(x);
    }
    return out;
  }
  function sortBy(how) {
    return (a, b) => how === 'type'
      ? (a.t.kind === b.t.kind ? 0 : a.t.kind === 'app' ? -1 : 1) || (a.t.kind === 'game' ? (a.t.badge || '').localeCompare(b.t.badge || '') : 0) || (a.t.kind === 'app' ? 0 : a.t.label.localeCompare(b.t.label))
      : (a.t.kind === b.t.kind ? 0 : a.t.kind === 'app' ? -1 : 1) || a.t.label.localeCompare(b.t.label);
  }
  const SHORTCUT = '<svg class="arrow" viewBox="0 0 9 9" shape-rendering="crispEdges"><rect x=".5" y=".5" width="8" height="8" fill="#fff" stroke="#000"/><path d="M2 7V4.5Q2 3 3.5 3H6M4.5 1.5L6 3L4.5 4.5" fill="none" stroke="#000"/></svg>';
  function render() {
    if (!cfg) return;
    const selected = new Set([...box.querySelectorAll('.dicon.sel')].map((e) => e.dataset.key));
    box.innerHTML = '';
    for (const { it, t } of layout()) {
      const el = h(`<div class="dicon ${selected.has(it.key) ? 'sel' : ''}" tabindex="0" data-key="${esc(it.key)}" title="${esc(t.label)}">
        <div class="ico">${icon(t.ic)}${t.kind === 'game' ? SHORTCUT + (t.badge ? `<i class="badge">${esc(t.badge)}</i>` : '') : ''}</div><span>${esc(t.label)}</span></div>`);
      el.style.left = PAD + it.c * CW + 'px'; el.style.top = PAD + it.r * CH + 'px';
      el._t = t; el._it = it;
      box.append(el);
    }
  }
  const icons = () => [...box.querySelectorAll('.dicon')];
  const selectedEls = () => icons().filter((e) => e.classList.contains('sel'));
  function select(els, add = false) { if (!add) icons().forEach((e) => e.classList.remove('sel')); els.forEach((e) => e.classList.add('sel')); }

  // press, drag, click, double-click (touch: one tap opens, as before)
  box.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.dicon');
    if (!el || e.button !== 0) return;
    e.stopPropagation(); ctx.closeMenus?.();
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    const wasSel = el.classList.contains('sel');
    if (add) el.classList.toggle('sel'); else if (!wasSel) select([el]);
    el.focus({ preventScroll: true });
    const sx = e.clientX, sy = e.clientY, moving = selectedEls();
    let drag = false;
    const mv = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!drag && Math.hypot(dx, dy) < MOVE) return;
      if (!drag) { drag = true; moving.forEach((m) => m.classList.add('dragging')); }
      moving.forEach((m) => (m.style.transform = `translate(${dx}px, ${dy}px)`));
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (!drag) { if (!add && wasSel && moving.length > 1) select([el]); return; }
      justDragged = true; setTimeout(() => (justDragged = false), 50);
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      drop(moving, dx, dy);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  // The free cell nearest to a wanted one.
  function nearestFree(want, taken) {
    const rows = rowsFit(), cols = colsFit();
    want = [Math.max(0, Math.min(cols - 1, want[0])), Math.max(0, Math.min(rows - 1, want[1]))];
    let best = null, bd = Infinity;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      if (taken.has(c + ',' + r)) continue;
      const d = (c - want[0]) ** 2 + (r - want[1]) ** 2;
      if (d < bd) { bd = d; best = [c, r]; }
    }
    return best;
  }
  // Dropped icons take the nearest free cells, in their order on the screen.
  function drop(moving, dx, dy) {
    const keys = new Set(moving.map((m) => m.dataset.key));
    const taken = new Set(cfg.icons.filter((it) => !keys.has(it.key) && it.c != null).map((it) => it.c + ',' + it.r));
    for (const m of moving.sort((a, b) => a._it.c - b._it.c || a._it.r - b._it.r)) {
      const best = nearestFree([Math.round((m._it.c * CW + dx) / CW), Math.round((m._it.r * CH + dy) / CH)], taken);
      if (best) { [m._it.c, m._it.r] = best; taken.add(best.join(',')); }
    }
    if (cfg.autoArrange) cfg.autoArrange = false; // moving an icon by hand turns auto-arrange off, as in Windows
    save(); render();
  }
  // touch: one tap opens (a long-press is the right-click; app.js swallows the click after it)
  let justDragged = false;
  box.addEventListener('click', (e) => { const el = e.target.closest('.dicon'); if (el && ctx.tapped() && !justDragged && !(e.ctrlKey || e.metaKey || e.shiftKey)) el._t.open(); });
  box.addEventListener('dblclick', (e) => { const el = e.target.closest('.dicon'); if (el && !ctx.tapped()) el._t.open(); });
  box.addEventListener('keydown', (e) => {
    const el = e.target.closest('.dicon');
    if (!el) return;
    if (e.key === 'Enter') el._t.open();
    else if (e.key === 'Delete') removeIcons(selectedEls().length ? selectedEls() : [el]);
    else if (e.key === 'F2') rename(el);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); select(icons()); }
  });
  box.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.dicon');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!el.classList.contains('sel')) select([el]);
    const sel = selectedEls(), t = el._t;
    if (sel.length > 1) return showMenu([{ label: `Delete ${sel.length} shortcuts`, icon: 'trash', action: () => removeIcons(sel) }, { label: 'Line up icons', action: lineUp }], e.clientX, e.clientY);
    showMenu([
      { label: t.kind === 'game' ? 'Play' : 'Open', bold: true, icon: t.kind === 'game' ? 'gamepad' : undefined, action: t.open },
      ...(t.kind === 'game' ? [{ label: 'Saves & states…', icon: 'floppy', action: () => ctx.openGameSaves(t.g) }] : []), '-',
      { label: 'Rename', action: () => rename(el) },
      { label: 'Delete shortcut', icon: 'trash', disabled: t.fixed, action: () => removeIcons([el]) }, '-',
      ...(t.kind === 'game' ? [{ label: 'Properties', action: () => ctx.properties(t.g) }] : [{ label: 'Properties', disabled: true }]),
    ], e.clientX, e.clientY);
  });
  async function rename(el) {
    const n = await prompt98('Shortcut name:', el._t.label);
    if (n == null) return;
    const it = el._it, base = it.key.startsWith('app:') ? APPS[it.key.slice(4)]?.label : ctx.games().find((g) => 'game:' + g.id === it.key)?.title;
    if (n === base) delete it.name; else it.name = n.slice(0, 80);
    save(); render();
  }
  async function removeIcons(els) {
    els = els.filter((e) => !e._t.fixed);
    if (!els.length) return msgbox('My Games cannot be deleted from the desktop.');
    const what = els.length === 1 ? `the shortcut "${els[0]._t.label}"` : `these ${els.length} shortcuts`;
    if (!(await confirmBox(`Are you sure you want to delete ${what}?\n\nOnly the desktop shortcut goes; ${els.some((e) => e._t.kind === 'game') ? 'the games and their saves stay in My Games.' : 'the program stays in the Start menu.'}`, { title: 'Confirm Shortcut Delete' }))) return;
    const keys = new Set(els.map((e) => e.dataset.key));
    cfg.icons = cfg.icons.filter((it) => !keys.has(it.key));
    save(); render();
  }
  // Add a shortcut (to a game, or a program); at a desktop point if given.
  function addShortcut(key, at) {
    if (!cfg) return;
    let it = cfg.icons.find((x) => x.key === key);
    if (!it) { it = { key }; cfg.icons.push(it); }
    if (at) {
      const r = desk.getBoundingClientRect();
      const want = [Math.round((at.x - r.left - PAD - CW / 2) / CW), Math.round((at.y - r.top - PAD - CH / 2) / CH)];
      const best = nearestFree(want, new Set(cfg.icons.filter((x) => x !== it && x.c != null).map((x) => x.c + ',' + x.r)));
      if (best) [it.c, it.r] = best; else { delete it.c; delete it.r; }
      cfg.autoArrange = false;
    }
    save(); render();
    const el = box.querySelector(`[data-key="${CSS.escape(key)}"]`); if (el) select([el]);
  }
  const hasShortcut = (key) => !!cfg?.icons.some((x) => x.key === key);
  function removeShortcut(key) { cfg.icons = cfg.icons.filter((x) => x.key !== key); save(); render(); }
  function lineUp() { const items = layout(); items.forEach(({ it }) => { delete it.c; delete it.r; }); cfg.icons = items.map((x) => x.it).concat(cfg.icons.filter((it) => !items.some((x) => x.it === it))); save(); render(); }
  function arrange(how) {
    const items = cfg.icons.map((it) => ({ it, t: target(it) })).filter((x) => x.t).sort(sortBy(how));
    cfg.icons = items.map((x) => { delete x.it.c; delete x.it.r; return x.it; });
    save(); render();
  }

  // Rubber band: drag on the empty desktop to select icons.
  desk.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target !== desk && e.target !== box && !e.target.closest('#wallpaper'))) return;
    const add = e.ctrlKey || e.metaKey;
    if (!add) select([]);
    const r0 = desk.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    let band = null;
    const mv = (ev) => {
      if (!band && Math.hypot(ev.clientX - sx, ev.clientY - sy) < MOVE) return;
      if (!band) { band = h('<div class="marquee"></div>'); desk.append(band); }
      const x1 = Math.min(sx, ev.clientX), y1 = Math.min(sy, ev.clientY), x2 = Math.max(sx, ev.clientX), y2 = Math.max(sy, ev.clientY);
      Object.assign(band.style, { left: x1 - r0.left + 'px', top: y1 - r0.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      for (const el of icons()) {
        const b = el.getBoundingClientRect();
        const hit = b.right > x1 && b.left < x2 && b.bottom > y1 && b.top < y2;
        if (hit) el.classList.add('sel'); else if (!add) el.classList.remove('sel');
      }
    };
    const up = () => { band?.remove(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });

  // A game dragged from My Games onto the desktop becomes a shortcut there.
  const DT = 'application/x-retrodesk-game';
  desk.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(DT) && !e.target.closest('.window')) { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; } });
  desk.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(DT);
    if (!id || e.target.closest('.window')) return;
    e.preventDefault(); e.stopPropagation();
    addShortcut('game:' + id, { x: e.clientX, y: e.clientY });
  }, true);

  // ---------------------------------------------------------------- desktop menu
  desk.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.window') || e.target.closest('.dicon') || e.target.closest('.widget')) return;
    e.preventDefault();
    const has = (type) => cfg.widgets.some((w) => w.type === type);
    showMenu([
      { label: 'Arrange Icons', sub: [{ label: 'by Name', action: () => arrange('name') }, { label: 'by Type', action: () => arrange('type') }, '-',
        { label: 'Auto Arrange', check: cfg.autoArrange, action: () => { cfg.autoArrange = !cfg.autoArrange; save(); render(); } }] },
      { label: 'Line up Icons', action: lineUp },
      { label: 'Refresh', action: () => ctx.refresh() }, '-',
      { label: 'New', sub: [{ label: 'Shortcut to a game…', icon: 'gamepad', action: newGameShortcut },
        { label: 'Shortcut to a program', sub: Object.entries(APPS).map(([k, a]) => ({ label: a.label, check: hasShortcut('app:' + k), action: () => (hasShortcut('app:' + k) ? (a.fixed ? null : removeShortcut('app:' + k)) : addShortcut('app:' + k, { x: e.clientX, y: e.clientY })) })) },
        { label: 'Sticky note', action: () => addWidget('note', e) }] },
      { label: 'Active Desktop', sub: [...Object.entries(WIDGETS).filter(([k]) => k !== 'note').map(([k, w]) => ({ label: w.name, check: has(k), action: () => (has(k) ? removeWidget(cfg.widgets.find((x) => x.type === k)) : addWidget(k, e)) })),
        { label: 'Sticky note', action: () => addWidget('note', e) }, '-', { label: 'Customize my desktop…', action: () => displayProps('web') }] }, '-',
      { label: 'Upload games…', icon: 'upload', action: ctx.pickFiles },
      { label: 'Arrange windows', sub: [{ label: 'Cascade', action: ctx.cascade }, { label: 'Minimize all', action: ctx.minimizeAll }] }, '-',
      { label: 'Properties', icon: 'display', action: () => displayProps() },
    ], e.clientX, e.clientY);
  });
  function newGameShortcut() {
    const games = ctx.games().slice().sort((a, b) => a.title.localeCompare(b.title));
    const body = h(`<div style="width:380px"><p>Choose the games to put on the desktop:</p>
      <div class="sunken-panel" style="height:240px;overflow:auto;background:#fff;padding:2px">${games.map((g) => `<div class="field-row"><input type="checkbox" id="ns-${g.id}" value="${g.id}" ${hasShortcut('game:' + g.id) ? 'checked disabled' : ''}><label for="ns-${g.id}">${esc(g.title)} <span class="muted">(${esc(g.platformShort)})</span></label></div>`).join('') || '<p class="muted">No games yet.</p>'}</div>
      <div class="buttons"><button class="ok">OK</button><button class="cancel">Cancel</button></div></div>`);
    const win = createWindow({ title: 'Create Shortcut', ic: 'gamepad', w: 410, body, dialog: true });
    body.querySelector('.cancel').onclick = () => closeWin(win);
    body.querySelector('.ok').onclick = () => { body.querySelectorAll('input:checked:not(:disabled)').forEach((i) => addShortcut('game:' + i.value)); closeWin(win); };
  }

  // ---------------------------------------------------------------- wallpaper
  const svg = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const WALLPAPERS = {
    none: { name: '(None)' },
    clouds: { name: 'Clouds', css: () => ({ backgroundImage: 'radial-gradient(ellipse 18% 9% at 20% 30%, #fff 60%, transparent 62%), radial-gradient(ellipse 12% 7% at 27% 27%, #fff 60%, transparent 62%), radial-gradient(ellipse 22% 10% at 70% 62%, #fff 60%, transparent 62%), radial-gradient(ellipse 14% 8% at 78% 58%, #fff 60%, transparent 62%), radial-gradient(ellipse 16% 7% at 45% 85%, #f4f8ff 60%, transparent 62%), linear-gradient(#3a7bd5, #9cc7f5)', backgroundSize: 'cover' }) },
    setup: { name: 'Setup', css: () => ({ backgroundImage: svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000060"/><stop offset="1" stop-color="#0050b0"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><g font-family="Arial Black,Arial" font-weight="900" fill="#fff"><text x="200" y="150" font-size="38" text-anchor="middle" opacity=".92">RetroDesk</text><text x="290" y="182" font-size="30" text-anchor="middle" fill="#ffd200">98</text></g><g opacity=".9"><rect x="96" y="98" width="14" height="14" fill="#f33"/><rect x="112" y="98" width="14" height="14" fill="#3c3"/><rect x="96" y="114" width="14" height="14" fill="#36f"/><rect x="112" y="114" width="14" height="14" fill="#fd0"/></g></svg>`), backgroundSize: 'cover', backgroundPosition: 'center' }) },
    bricks: { name: 'Red Blocks', css: () => ({ backgroundImage: svg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#a03020"/><path d="M0 7.5h32M0 15.5h32M8.5 0v7.5M24.5 8v8" stroke="#d8c8b0" stroke-width="1"/></svg>'), backgroundSize: '32px 16px' }) },
    tiles: { name: 'Black Thatch', css: () => ({ backgroundImage: svg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#000"/><path d="M0 0l4 4M4 8l4-4" stroke="#0a7a7a"/></svg>'), backgroundSize: '8px 8px', imageRendering: 'pixelated' }) },
    waves: { name: 'Waves', css: () => ({ backgroundImage: svg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#004d66"/><path d="M0 20q10-10 20 0t20 0 20 0 20 0" fill="none" stroke="#1a8fb0" stroke-width="3"/><path d="M0 38q10-10 20 0t20 0 20 0 20 0" fill="none" stroke="#0d6a85" stroke-width="3"/></svg>'), backgroundSize: '80px 40px' }) },
    circuit: { name: 'Circuit Board', css: () => ({ backgroundImage: svg('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#0b3d1f"/><g stroke="#2fa35a" stroke-width="2" fill="none"><path d="M0 15h20l10 10v35M60 40H40l-8-8V0M15 60V45h15"/></g><g fill="#c9a227"><circle cx="20" cy="15" r="3"/><circle cx="40" cy="40" r="3"/><circle cx="30" cy="45" r="3"/></g></svg>'), backgroundSize: '60px 60px' }) },
    stars: { name: 'Night Sky', css: () => ({ backgroundImage: 'radial-gradient(1px 1px at 10% 20%, #fff 99%, transparent), radial-gradient(1px 1px at 30% 70%, #fff 99%, transparent), radial-gradient(2px 2px at 55% 35%, #ffe 99%, transparent), radial-gradient(1px 1px at 75% 15%, #fff 99%, transparent), radial-gradient(1px 1px at 85% 80%, #fff 99%, transparent), radial-gradient(2px 2px at 20% 90%, #cdf 99%, transparent), radial-gradient(1px 1px at 65% 60%, #fff 99%, transparent), linear-gradient(#000014, #0a1440)', backgroundSize: '220px 220px, 260px 260px, 300px 300px, 240px 240px, 280px 280px, 320px 320px, 200px 200px, cover' }) },
    sunset: { name: 'Sunset', css: () => ({ backgroundImage: 'radial-gradient(circle at 50% 78%, #ffe27a 0 7%, transparent 7.5%), linear-gradient(transparent 78%, #301040 78%), linear-gradient(#2b1055, #d53a9d 55%, #ff9f43 78%)', backgroundSize: 'cover' }) },
    image: { name: '(Your picture)' },
  };
  function wallpaperStyle(w) {
    const st = { backgroundColor: w.color || '#008080', backgroundImage: 'none', backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: '0 0', imageRendering: 'auto' };
    if (w.id === 'image' && w.image) {
      const mode = { center: ['auto', 'no-repeat', 'center'], tile: ['auto', 'repeat', '0 0'], stretch: ['100% 100%', 'no-repeat', 'center'], fit: ['contain', 'no-repeat', 'center'], fill: ['cover', 'no-repeat', 'center'] }[w.mode || 'fill'];
      Object.assign(st, { backgroundImage: `url("/api/desktop/wallpaper?t=${w.image}")`, backgroundSize: mode[0], backgroundRepeat: mode[1], backgroundPosition: mode[2] });
    } else if (WALLPAPERS[w.id]?.css) Object.assign(st, WALLPAPERS[w.id].css());
    return st;
  }
  function applyWallpaper(w = cfg.wallpaper, el = document.body) { Object.assign(el.style, wallpaperStyle(w)); }

  // ---------------------------------------------------------------- colour schemes
  const SCHEMES = {
    standard: { name: 'Windows Standard', tb: ['#000080', '#1084d0'], sel: '#000080' },
    teal: { name: 'Teal', tb: ['#006060', '#10a0a0'], sel: '#006060' },
    rainy: { name: 'Rainy Day', tb: ['#465a78', '#8ca5c8'], sel: '#465a78' },
    eggplant: { name: 'Eggplant', tb: ['#4b1a4b', '#a05aa0'], sel: '#4b1a4b' },
    brick: { name: 'Brick', tb: ['#800000', '#c85050'], sel: '#800000' },
    pumpkin: { name: 'Pumpkin', tb: ['#8a4500', '#e09020'], sel: '#8a4500' },
    slate: { name: 'Slate', tb: ['#303030', '#909090'], sel: '#404040' },
    lilac: { name: 'Lilac', tb: ['#5a4b9a', '#a99ce0'], sel: '#5a4b9a' },
  };
  function applyScheme(id = cfg.scheme) {
    const s = SCHEMES[id] || SCHEMES.standard, r = document.documentElement.style;
    r.setProperty('--tb1', s.tb[0]); r.setProperty('--tb2', s.tb[1]); r.setProperty('--hilite', s.sel);
  }

  // ---------------------------------------------------------------- screen saver
  const SAVERS = { none: '(None)', starfield: 'Starfield', mystify: 'Mystify', marquee: 'RetroDesk Marquee', pipes: 'Pipes' };
  let lastInput = Date.now(), saverOn = null;
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); if (saverOn && ev !== 'pointermove') stopSaver(); }, { capture: true, passive: true });
  addEventListener('pointermove', (e) => { if (saverOn && Math.hypot(e.movementX, e.movementY) > 3) stopSaver(); }, { capture: true, passive: true });
  setInterval(() => {
    if (saverOn || cfg?.saver?.id === 'none' || !cfg) return;
    if (document.visibilityState !== 'visible' || ctx.gameOpen()) { lastInput = Date.now(); return; } // never over a game
    if (Date.now() - lastInput > cfg.saver.wait * 60000) startSaver(cfg.saver.id);
  }, 5000);
  function startSaver(id, host = document.body, preview = false) {
    const cv = h('<canvas class="saver"></canvas>');
    if (preview) cv.classList.add('preview');
    host.append(cv);
    const g = cv.getContext('2d');
    const size = () => { cv.width = cv.clientWidth * (preview ? 1 : devicePixelRatio); cv.height = cv.clientHeight * (preview ? 1 : devicePixelRatio); };
    size();
    const W = () => cv.width, H = () => cv.height, rnd = (a, b) => a + Math.random() * (b - a);
    let t = 0, raf = 0, stars = [], polys = [], txt = { x: 40, y: 40, dx: 2.2, dy: 1.7, hue: 0 }, pipe = null;
    const step = () => {
      t++;
      if (id === 'starfield') {
        if (!stars.length) stars = Array.from({ length: 300 }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(0.1, 1) }));
        g.fillStyle = '#000'; g.fillRect(0, 0, W(), H());
        for (const s of stars) {
          s.z -= 0.006; if (s.z <= 0.02) { s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = 1; }
          const k = 0.5 / s.z, x = W() / 2 + s.x * k * W() / 2, y = H() / 2 + s.y * k * H() / 2, r = Math.max(0.5, (1 - s.z) * 2.5 * (preview ? 0.5 : devicePixelRatio));
          g.fillStyle = `rgba(255,255,255,${1 - s.z})`; g.fillRect(x, y, r, r);
        }
      } else if (id === 'mystify') {
        if (!polys.length) polys = [0, 1].map((i) => ({ hue: i * 180, pts: Array.from({ length: 4 }, () => ({ x: rnd(0, W()), y: rnd(0, H()), dx: rnd(-3, 3) || 1, dy: rnd(-3, 3) || 1 })), trail: [] }));
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, W(), H());
        for (const p of polys) {
          p.hue = (p.hue + 0.4) % 360;
          for (const q of p.pts) { q.x += q.dx; q.y += q.dy; if (q.x < 0 || q.x > W()) q.dx *= -1; if (q.y < 0 || q.y > H()) q.dy *= -1; }
          g.strokeStyle = `hsl(${p.hue},100%,60%)`; g.lineWidth = preview ? 1 : 1.5 * devicePixelRatio; g.beginPath();
          p.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke();
        }
      } else if (id === 'marquee') {
        g.fillStyle = '#000'; g.fillRect(0, 0, W(), H());
        const fs = Math.round(H() / 9); g.font = `bold ${fs}px Arial Black, Arial`; const tw = g.measureText('RetroDesk 98').width;
        txt.x += txt.dx * (W() / 800); txt.y += txt.dy * (H() / 600); txt.hue = (txt.hue + 0.5) % 360;
        if (txt.x < 0 || txt.x + tw > W()) txt.dx *= -1; if (txt.y < fs || txt.y > H()) txt.dy *= -1;
        g.fillStyle = `hsl(${txt.hue},90%,60%)`; g.fillText('RetroDesk 98', Math.max(0, Math.min(W() - tw, txt.x)), Math.max(fs, Math.min(H(), txt.y)));
      } else if (id === 'pipes') {
        const s = Math.max(6, Math.round(W() / 60));
        if (!pipe || t % 900 === 0) { if (!pipe || t % 900 === 0) { g.fillStyle = '#000'; g.fillRect(0, 0, W(), H()); } pipe = { x: Math.round(rnd(0, W() / s)) * s, y: Math.round(rnd(0, H() / s)) * s, d: 0, hue: rnd(0, 360) }; }
        for (let i = 0; i < 2; i++) {
          if (Math.random() < 0.15) pipe.d = (pipe.d + (Math.random() < 0.5 ? 1 : 3)) % 4;
          const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][pipe.d];
          const grad = g.createLinearGradient(pipe.x - s / 2 * dy, pipe.y - s / 2 * dx, pipe.x + s / 2 * dy, pipe.y + s / 2 * dx);
          grad.addColorStop(0, `hsl(${pipe.hue},70%,25%)`); grad.addColorStop(0.5, `hsl(${pipe.hue},80%,70%)`); grad.addColorStop(1, `hsl(${pipe.hue},70%,25%)`);
          g.fillStyle = grad; g.fillRect(pipe.x - s / 2, pipe.y - s / 2, s * (dx ? 1.6 : 1), s * (dy ? 1.6 : 1));
          pipe.x += dx * s * 0.6; pipe.y += dy * s * 0.6;
          if (pipe.x < 0 || pipe.y < 0 || pipe.x > W() || pipe.y > H()) pipe = { x: Math.round(rnd(0, W() / s)) * s, y: Math.round(rnd(0, H() / s)) * s, d: Math.floor(rnd(0, 4)), hue: rnd(0, 360) };
        }
      }
      raf = requestAnimationFrame(step);
    };
    g.fillStyle = '#000'; g.fillRect(0, 0, W(), H());
    step();
    const stop = () => { cancelAnimationFrame(raf); cv.remove(); };
    if (!preview) { saverOn = stop; cv.addEventListener('pointerdown', stopSaver); }
    return stop;
  }
  function stopSaver() { const s = saverOn; saverOn = null; s?.(); lastInput = Date.now(); }

  // ---------------------------------------------------------------- widgets (Active Desktop)
  const wbox = h('<div id="widgets"></div>');
  desk.prepend(wbox);
  let tick = 0;
  const WIDGETS = {
    clock: { name: 'Clock', w: 150, render(el) {
      el.innerHTML = `<svg viewBox="0 0 100 100" class="clockface"><circle cx="50" cy="50" r="46" fill="#fff" stroke="#000" stroke-width="2"/>${Array.from({ length: 12 }, (_, i) => `<rect x="49" y="7" width="2" height="${i % 3 ? 5 : 9}" transform="rotate(${i * 30} 50 50)"/>`).join('')}<line class="hh" x1="50" y1="50" x2="50" y2="26" stroke="#000" stroke-width="4" stroke-linecap="round"/><line class="mm" x1="50" y1="50" x2="50" y2="15" stroke="#000" stroke-width="3" stroke-linecap="round"/><line class="ss" x1="50" y1="56" x2="50" y2="12" stroke="#c00" stroke-width="1.2"/><circle cx="50" cy="50" r="3"/></svg><div class="clockdate"></div>`;
      const upd = () => {
        const d = new Date(), s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
        el.querySelector('.hh').setAttribute('transform', `rotate(${hr * 30} 50 50)`); el.querySelector('.mm').setAttribute('transform', `rotate(${m * 6} 50 50)`); el.querySelector('.ss').setAttribute('transform', `rotate(${s * 6} 50 50)`);
        el.querySelector('.clockdate').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      };
      upd(); return upd;
    } },
    calendar: { name: 'Calendar', w: 196, render(el, w) {
      const draw = () => {
        const now = new Date(), base = new Date(now.getFullYear(), now.getMonth() + (w.offset || 0), 1);
        const first = (base.getDay() + 6) % 7, days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const cells = Array.from({ length: first }, () => '<td></td>').concat(Array.from({ length: days }, (_, i) => `<td class="${!w.offset && i + 1 === now.getDate() ? 'today' : ''}">${i + 1}</td>`));
        const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
        el.innerHTML = `<div class="calhead"><button class="small prev">◀</button><b>${base.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button class="small next">▶</button></div>
          <table class="cal"><tr>${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<th>${d}</th>`).join('')}</tr>${weeks.join('')}</table>`;
        el.querySelector('.prev').onclick = () => { w.offset = (w.offset || 0) - 1; draw(); };
        el.querySelector('.next').onclick = () => { w.offset = (w.offset || 0) + 1; draw(); };
      };
      draw(); let day = new Date().getDate();
      return () => { if (new Date().getDate() !== day) { day = new Date().getDate(); draw(); } };
    } },
    continue: { name: 'Continue Playing', w: 240, render(el) {
      const draw = () => {
        const sums = ctx.saveSummary() || {};
        const recent = ctx.games().filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 3);
        el.innerHTML = recent.length ? recent.map((g) => {
          const auto = sums[g.id]?.states?.find((s) => s.slot === 'auto');
          return `<div class="cont" data-id="${g.id}" title="${auto ? 'Continue from where you left off' : 'Play'}">${auto?.shot ? `<img src="/api/games/${g.id}/states/auto/shot?t=${auto.time}" alt="">` : `<div class="noshot">${icon(platformIcon(g.platform))}</div>`}
            <div><b>${esc(g.title)}</b><br><span class="muted">${esc(g.platformShort)} · ${auto ? 'resume point saved' : 'played ' + new Date(g.lastPlayed).toLocaleDateString()}</span></div></div>`;
        }).join('') : '<p class="muted" style="margin:4px">Games you play show up here, with the picture of where you left off.</p>';
        el.querySelectorAll('.cont').forEach((c) => (c.onclick = () => ctx.preparePlay(ctx.games().find((g) => g.id === c.dataset.id))));
      };
      draw(); document.addEventListener('library', draw); document.addEventListener('saves', draw);
      return null;
    } },
    note: { name: 'Sticky Note', w: 180, render(el, w) {
      el.innerHTML = '<textarea class="note" placeholder="Type a note…"></textarea>';
      const ta = el.querySelector('textarea'); ta.value = w.text || '';
      ta.oninput = () => { w.text = ta.value.slice(0, 4000); save(); };
      return null;
    } },
    system: { name: 'System Monitor', w: 220, render(el) {
      const draw = async () => {
        const games = ctx.games(), est = await ctx.estimate().catch(() => ({}));
        const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
        el.innerHTML = `<table class="kv"><tr><td>Games on server:</td><td>${games.length} (${fmt(games.reduce((a, g) => a + g.size, 0))})</td></tr>
          <tr><td>Kept in browser:</td><td>${games.filter((g) => g.inBrowser).length}</td></tr><tr><td>Played:</td><td>${games.filter((g) => g.lastPlayed).length}</td></tr>
          <tr><td>Play time:</td><td>${Math.floor(games.reduce((a, g) => a + (g.playTime || 0), 0) / 3600)} h</td></tr></table>
          <div class="muted" style="margin-top:4px">Browser storage: ${fmt(est.usage)} of ${fmt(est.quota)}</div><div class="meter"><div class="fill" style="width:${pct}%"></div></div>`;
      };
      draw(); document.addEventListener('library', draw);
      return null;
    } },
  };
  function renderWidgets() {
    wbox.innerHTML = '';
    for (const w of cfg.widgets) {
      const def = WIDGETS[w.type]; if (!def) continue;
      const el = h(`<div class="widget w-${w.type}" style="width:${def.w}px"><div class="wbar"><span>${esc(def.name)}</span><button aria-label="Close" title="Close">×</button></div><div class="wbody"></div></div>`);
      wbox.append(el);
      el._upd = def.render(el.querySelector('.wbody'), w);
      place(el, w); requestAnimationFrame(() => place(el, w)); // once its content has its size
      el.querySelector('.wbar button').onclick = () => removeWidget(w);
      // drag by the bar
      el.querySelector('.wbar').addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY, x0 = w.x, y0 = w.y;
        const mv = (ev) => { w.x = x0 + ev.clientX - sx; w.y = y0 + ev.clientY - sy; place(el, w); };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); save(); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      });
    }
  }
  function place(el, w) {
    const maxX = desk.clientWidth - el.offsetWidth - 4, maxY = desk.clientHeight - el.offsetHeight - 4;
    if (w.x == null) w.x = maxX; if (w.y == null) w.y = 8;
    el.style.left = Math.max(4, Math.min(maxX, w.x)) + 'px'; el.style.top = Math.max(4, Math.min(maxY, w.y)) + 'px';
  }
  function addWidget(type, e) {
    const r = desk.getBoundingClientRect(), def = WIDGETS[type];
    const w = { type, id: Math.random().toString(36).slice(2, 8) };
    if (e?.clientX) { w.x = e.clientX - r.left; w.y = e.clientY - r.top; }
    else { w.x = desk.clientWidth - def.w - 12; w.y = 8 + cfg.widgets.length * 30; }
    cfg.widgets.push(w); save(); renderWidgets();
  }
  function removeWidget(w) { cfg.widgets = cfg.widgets.filter((x) => x !== w); save(); renderWidgets(); }
  setInterval(() => { // clock and calendar; paused while a game plays so the game gets the time
    if (ctx.gameActive() || document.visibilityState !== 'visible') return;
    tick++; wbox.querySelectorAll('.widget').forEach((el) => el._upd?.());
  }, 1000);

  // ---------------------------------------------------------------- Display Properties
  function displayProps(tab = 'bg') {
    if (ctx.wins.has('display')) return ctx.focusWin(ctx.wins.get('display'));
    const draft = JSON.parse(JSON.stringify({ wallpaper: cfg.wallpaper, scheme: cfg.scheme, saver: cfg.saver }));
    let pendingImage = null, stopPreview = null;
    const body = h(`<div style="width:400px">
      <menu role="tablist"><li role="tab" data-t="bg"><a>Background</a></li><li role="tab" data-t="saver"><a>Screen Saver</a></li><li role="tab" data-t="look"><a>Appearance</a></li><li role="tab" data-t="web"><a>Web</a></li></menu>
      <div class="window" role="tabpanel"><div class="window-body">
        <div class="monitor"><div class="screen"><div class="mini-title">Active Window</div></div><div class="stand"></div></div>
        <div data-p="bg"><div class="field-row-stacked"><label>Wallpaper</label>
          <select size="6" class="wp">${Object.entries(WALLPAPERS).map(([k, w]) => `<option value="${k}">${esc(w.name)}</option>`).join('')}</select></div>
          <div class="field-row" style="margin-top:6px"><button class="browse">Browse…</button><label style="margin-left:8px">Display:</label><select class="mode">${['fill', 'fit', 'stretch', 'center', 'tile'].map((m) => `<option value="${m}">${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select>
          <label style="margin-left:8px">Colour:</label><input type="color" class="color"></div></div>
        <div data-p="saver" hidden><div class="field-row"><label>Screen saver:</label><select class="sv">${Object.entries(SAVERS).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select><button class="pv">Preview</button></div>
          <div class="field-row" style="margin-top:6px"><label>Wait:</label><select class="wait">${[1, 2, 5, 10, 15, 30, 60].map((m) => `<option value="${m}">${m} minute${m > 1 ? 's' : ''}</option>`).join('')}</select></div>
          <p class="muted">The screen saver never starts while a game window is open.</p></div>
        <div data-p="look" hidden><div class="field-row-stacked"><label>Scheme</label><select size="8" class="sch">${Object.entries(SCHEMES).map(([k, s]) => `<option value="${k}">${esc(s.name)}</option>`).join('')}</select></div></div>
        <div data-p="web" hidden><p>Active Desktop items:</p>${Object.entries(WIDGETS).map(([k, w]) => `<div class="field-row"><input type="checkbox" id="wd-${k}" data-w="${k}"><label for="wd-${k}">${esc(w.name)}${k === 'note' ? ' (one more each time)' : ''}</label></div>`).join('')}
          <p class="muted">Drag an item by its title bar. Right-click the desktop → Active Desktop to add or remove items.</p>
          <div class="field-row"><button class="reset-icons">Restore default desktop icons</button></div></div>
      </div></div>
      <div class="buttons"><button class="ok">OK</button><button class="cancel">Cancel</button><button class="apply">Apply</button></div></div>`);
    const win = createWindow({ id: 'display', title: 'Display Properties', ic: 'display', w: 430, body, dialog: true, onClose: () => { stopPreview?.(); } });
    const q = (s) => body.querySelector(s);
    const show = (t) => { body.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', x.dataset.t === t)); body.querySelectorAll('[data-p]').forEach((x) => (x.hidden = x.dataset.p !== t)); body.querySelector('.monitor').hidden = t === 'web'; stopPreview?.(); stopPreview = null; if (t === 'saver') preview(); };
    body.querySelectorAll('[role=tab]').forEach((x) => (x.onclick = () => show(x.dataset.t)));
    const scr = q('.monitor .screen');
    function preview() {
      const w = { ...draft.wallpaper }; if (pendingImage) { w.id = 'image'; w.image = 'pending'; }
      Object.assign(scr.style, wallpaperStyle(w));
      if (pendingImage) scr.style.backgroundImage = `url("${pendingImage.url}")`;
      const s = SCHEMES[draft.scheme] || SCHEMES.standard;
      q('.mini-title').style.setProperty('--a', s.tb[0]); q('.mini-title').style.setProperty('--b', s.tb[1]);
      if (!q('[data-p=saver]').hidden) { stopPreview?.(); stopPreview = draft.saver.id === 'none' ? null : startSaver(draft.saver.id, scr, true); }
    }
    q('.wp').value = draft.wallpaper.id; q('.mode').value = draft.wallpaper.mode || 'fill'; q('.color').value = draft.wallpaper.color || '#008080';
    q('.sv').value = draft.saver.id; q('.wait').value = draft.saver.wait; q('.sch').value = draft.scheme;
    body.querySelectorAll('[data-w]').forEach((c) => (c.checked = c.dataset.w !== 'note' && cfg.widgets.some((w) => w.type === c.dataset.w)));
    q('.wp').onchange = () => { draft.wallpaper.id = q('.wp').value; if (draft.wallpaper.id === 'image' && !draft.wallpaper.image && !pendingImage) q('.browse').click(); if (draft.wallpaper.id !== 'image') pendingImage = null; preview(); };
    q('.mode').onchange = () => { draft.wallpaper.mode = q('.mode').value; preview(); };
    q('.color').oninput = () => { draft.wallpaper.color = q('.color').value; preview(); };
    q('.browse').onclick = () => {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; pendingImage = { file: f, url: URL.createObjectURL(f) }; draft.wallpaper.id = 'image'; q('.wp').value = 'image'; preview(); };
      inp.click();
    };
    q('.sv').onchange = () => { draft.saver.id = q('.sv').value; preview(); };
    q('.wait').onchange = () => { draft.saver.wait = +q('.wait').value; };
    q('.pv').onclick = () => { if (draft.saver.id !== 'none') { lastInput = Date.now(); setTimeout(() => startSaver(draft.saver.id), 300); } };
    q('.sch').onchange = () => { draft.scheme = q('.sch').value; preview(); };
    body.querySelectorAll('[data-w]').forEach((c) => (c.onchange = () => {
      const k = c.dataset.w;
      if (k === 'note') { addWidget('note'); c.checked = false; return; }
      if (c.checked) addWidget(k); else { const w = cfg.widgets.find((x) => x.type === k); if (w) removeWidget(w); }
    }));
    q('.reset-icons').onclick = async () => {
      if (!(await confirmBox('Put the standard icons back on the desktop and line all icons up?', { title: 'Desktop icons' }))) return;
      for (const k of Object.keys(APPS)) if (!hasShortcut('app:' + k)) cfg.icons.push({ key: 'app:' + k });
      lineUp();
    };
    async function apply() {
      if (pendingImage) {
        const r = await fetch('/api/desktop/wallpaper', { method: 'PUT', headers: { 'Content-Type': pendingImage.file.type || 'image/jpeg' }, body: pendingImage.file });
        if (!r.ok) { msgbox('The picture could not be stored: ' + ((await r.json().catch(() => ({}))).error || r.statusText), { ic: 'error' }); return false; }
        draft.wallpaper.image = Date.now(); pendingImage = null;
      }
      if (draft.wallpaper.id === 'image' && !draft.wallpaper.image) draft.wallpaper.id = 'none';
      Object.assign(cfg, JSON.parse(JSON.stringify(draft)));
      applyWallpaper(); applyScheme(); save();
      return true;
    }
    q('.apply').onclick = apply;
    q('.ok').onclick = async () => { if (await apply()) closeWin(win); };
    q('.cancel').onclick = () => closeWin(win);
    show(tab);
    preview();
  }

  addEventListener('resize', () => { clearTimeout(render.t); render.t = setTimeout(() => { render(); wbox.querySelectorAll('.widget').forEach((el, i) => place(el, cfg.widgets[i])); }, 150); });
  document.addEventListener('library', render);

  return { load, render, addShortcut, removeShortcut, hasShortcut, displayProps, startSaver, DT };
}
