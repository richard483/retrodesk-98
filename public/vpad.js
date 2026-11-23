// An on-screen PS2-style controller for touch screens, for emulators that read controllers only through the
// browser's Gamepad API (TabStationToo, the PS2 emulator, has no touch controls of its own).
// It is drawn into the emulator's own document (so a tap keeps the focus there, which the emulator requires
// before it plays input) and shows up in that window's navigator.getGamepads() as one more gamepad with the
// "standard" layout: buttons 0-16 (Cross, Circle, Square, Triangle, L1, R1, L2, R2, Select, Start, L3, R3,
// Up, Down, Left, Right, Home) and axes 0-3 (left stick x/y, right stick x/y).
const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };

const CSS = `
#rd-vpad { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  font: 600 13px system-ui, sans-serif; color: rgba(255,255,255,.85); --s: min(15vmin, 76px); }
#rd-vpad[hidden] { display: none; }
#rd-vpad .c { position: absolute; pointer-events: auto; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  border: 2px solid rgba(255,255,255,.5); background: rgba(0,0,0,.25); }
#rd-vpad .c.on { background: rgba(255,255,255,.4); }
#rd-vpad .face { width: var(--s); height: var(--s); border-radius: 50%; font-size: calc(var(--s) * .42); }
#rd-vpad .sh { width: calc(var(--s) * 1.3); height: calc(var(--s) * .55); border-radius: 10px; }
#rd-vpad .sm { width: calc(var(--s) * 1.05); height: calc(var(--s) * .45); border-radius: 12px; font-size: 11px; }
#rd-vpad .dpad { width: calc(var(--s) * 2.6); height: calc(var(--s) * 2.6); border: 0; background: none; }
#rd-vpad .dpad i { position: absolute; width: 34%; height: 34%; border: 2px solid rgba(255,255,255,.5); background: rgba(0,0,0,.25); box-sizing: border-box; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-style: normal; font-size: calc(var(--s) * .3); color: rgba(255,255,255,.7); }
#rd-vpad .dpad i.on { background: rgba(255,255,255,.4); }
#rd-vpad .stick { width: calc(var(--s) * 1.9); height: calc(var(--s) * 1.9); border-radius: 50%; }
#rd-vpad .stick b { width: 46%; height: 46%; border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid rgba(255,255,255,.6); box-sizing: border-box; }
/* landscape: sides of the picture */
#rd-vpad .l1 { left: max(10px, env(safe-area-inset-left)); top: 10px; } #rd-vpad .l2 { left: calc(max(10px, env(safe-area-inset-left)) + var(--s) * 1.4); top: 10px; }
#rd-vpad .r1 { right: max(10px, env(safe-area-inset-right)); top: 10px; } #rd-vpad .r2 { right: calc(max(10px, env(safe-area-inset-right)) + var(--s) * 1.4); top: 10px; }
#rd-vpad .dpad { left: max(8px, env(safe-area-inset-left)); top: calc(var(--s) * .85); }
#rd-vpad .fbox { position: absolute; right: max(8px, env(safe-area-inset-right)); top: calc(var(--s) * .85); width: calc(var(--s) * 2.7); height: calc(var(--s) * 2.6); pointer-events: none; }
#rd-vpad .triangle { left: 50%; top: 0; transform: translateX(-50%); } #rd-vpad .cross { left: 50%; bottom: 0; transform: translateX(-50%); }
#rd-vpad .square { left: 0; top: 50%; transform: translateY(-50%); } #rd-vpad .circle { right: 0; top: 50%; transform: translateY(-50%); }
#rd-vpad .ls { left: calc(max(8px, env(safe-area-inset-left)) + var(--s) * 2.7); bottom: 8px; }
#rd-vpad .rs { right: calc(max(8px, env(safe-area-inset-right)) + var(--s) * 2.8); bottom: 8px; }
#rd-vpad .select { left: calc(50% - var(--s) * 1.15); bottom: 10px; } #rd-vpad .start { left: calc(50% + var(--s) * .1); bottom: 10px; }
/* portrait: everything below the picture (a 4:3 picture takes the top 75vw) */
@media (orientation: portrait) {
  #rd-vpad { --s: min(13vw, 64px); }
  #rd-vpad .l1, #rd-vpad .l2, #rd-vpad .r1, #rd-vpad .r2 { top: calc(75vw + 10px); }
  #rd-vpad .dpad, #rd-vpad .fbox { top: calc(75vw + var(--s) * 1.1); }
  #rd-vpad .ls { left: 12%; bottom: calc(var(--s) * .9 + 14px); } #rd-vpad .rs { right: 12%; bottom: calc(var(--s) * .9 + 14px); }
}
`;

export function createVpad(win) {
  const doc = win.document;
  const pad = {
    id: 'RetroDesk on-screen controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0], vibrationActuator: null,
  };
  let shown = false;
  const nav = win.navigator;
  const real = nav.getGamepads ? nav.getGamepads.bind(nav) : () => [];
  // our pad takes the first free index
  Object.defineProperty(nav, 'getGamepads', { configurable: true, value: () => {
    const list = Array.from(real());
    if (!shown) return list;
    pad.index = list.findIndex((g) => !g); if (pad.index < 0) pad.index = list.length;
    list[pad.index] = pad;
    return list;
  } });
  const realPads = () => Array.from(real()).filter((g) => g && g.connected);

  const style = doc.createElement('style'); style.textContent = CSS; doc.head.append(style);
  const root = doc.createElement('div'); root.id = 'rd-vpad'; root.hidden = true;
  root.innerHTML = `<div class="c sh l1" data-b="l1">L1</div><div class="c sh l2" data-b="l2">L2</div><div class="c sh r2" data-b="r2">R2</div><div class="c sh r1" data-b="r1">R1</div>
    <div class="c dpad"><i style="left:33%;top:0" data-d="up">▲</i><i style="left:33%;bottom:0" data-d="down">▼</i><i style="left:0;top:33%" data-d="left">◀</i><i style="right:0;top:33%" data-d="right">▶</i></div>
    <div class="fbox"><div class="c face triangle" data-b="triangle">△</div><div class="c face square" data-b="square">□</div><div class="c face circle" data-b="circle">○</div><div class="c face cross" data-b="cross">✕</div></div>
    <div class="c stick ls" data-s="0"><b></b></div><div class="c stick rs" data-s="2"><b></b></div>
    <div class="c sm select" data-b="select">SELECT</div><div class="c sm start" data-b="start">START</div>`;
  doc.body.append(root);
  const dpad = root.querySelector('.dpad');

  // Every finger: what it holds now. A finger can slide from one button to the next; a stick keeps its finger.
  const fingers = new Map(); // pointerId -> { stick: el } | { buttons: Set<index> }
  function setButton(i, on) { const b = pad.buttons[i]; b.pressed = b.touched = on; b.value = on ? 1 : 0; }
  function update() {
    const held = new Set();
    for (const f of fingers.values()) if (f.buttons) f.buttons.forEach((i) => held.add(i));
    for (const [, i] of Object.entries(B)) setButton(i, held.has(i));
    root.querySelectorAll('[data-b]').forEach((el) => el.classList.toggle('on', held.has(B[el.dataset.b])));
    dpad.querySelectorAll('i').forEach((el) => el.classList.toggle('on', held.has(B[el.dataset.d])));
    pad.timestamp = win.performance.now();
  }
  function hit(x, y) { // the buttons under a point
    const out = new Set();
    const r = dpad.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) > r.width * 0.12) { // 8 directions; the diagonals press two
        const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = right, 90 = down
        if (a > -67.5 && a < 67.5) out.add(B.right);
        if (a > 22.5 && a < 157.5) out.add(B.down);
        if (a > 112.5 || a < -112.5) out.add(B.left);
        if (a > -157.5 && a < -22.5) out.add(B.up);
      }
      return out;
    }
    const el = doc.elementFromPoint(x, y)?.closest?.('#rd-vpad [data-b]');
    if (el) out.add(B[el.dataset.b]);
    return out;
  }
  function moveStick(f, x, y) {
    const r = f.stick.getBoundingClientRect(), rad = r.width / 2;
    let dx = (x - (r.left + rad)) / rad, dy = (y - (r.top + rad)) / rad;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    const a = +f.stick.dataset.s; pad.axes[a] = dx; pad.axes[a + 1] = dy;
    f.stick.firstElementChild.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
  }
  function down(e) {
    e.preventDefault(); e.stopPropagation();
    const stick = e.target.closest?.('.stick');
    if (stick) { const f = { stick }; fingers.set(e.pointerId, f); moveStick(f, e.clientX, e.clientY); try { stick.setPointerCapture(e.pointerId); } catch {} }
    else fingers.set(e.pointerId, { buttons: hit(e.clientX, e.clientY) });
    navigator.vibrate?.(8);
    update();
  }
  function move(e) {
    const f = fingers.get(e.pointerId); if (!f) return;
    e.preventDefault(); e.stopPropagation();
    if (f.stick) moveStick(f, e.clientX, e.clientY);
    else { const n = hit(e.clientX, e.clientY); if ([...n].some((i) => !f.buttons.has(i))) navigator.vibrate?.(8); f.buttons = n; }
    update();
  }
  function up(e) {
    const f = fingers.get(e.pointerId); if (!f) return;
    e.stopPropagation();
    if (f.stick) { const a = +f.stick.dataset.s; pad.axes[a] = pad.axes[a + 1] = 0; f.stick.firstElementChild.style.transform = ''; }
    fingers.delete(e.pointerId); update();
  }
  root.addEventListener('pointerdown', down);
  for (const t of ['pointermove']) doc.addEventListener(t, move, { capture: true, passive: false });
  for (const t of ['pointerup', 'pointercancel']) doc.addEventListener(t, up, true);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  function show(on) {
    if (on === shown) return;
    shown = on; root.hidden = !on;
    if (!on) { fingers.clear(); pad.axes.fill(0); update(); }
    // the emulator polls only while it knows a gamepad; tell it one came (or went)
    const ev = new win.Event(on ? 'gamepadconnected' : 'gamepaddisconnected'); Object.defineProperty(ev, 'gamepad', { value: pad });
    win.dispatchEvent(ev);
  }
  return { show, realPads, get shown() { return shown; } };
}
