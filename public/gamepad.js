// Gamepad polling for the desktop UI (games read the controller through EmulatorJS).
// Uses the W3C "standard" mapping: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Select 9=Start
// 12-15 = D-pad up/down/left/right, 16 = Home/Guide. The left stick acts as a D-pad.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };
const REPEATABLE = new Set([BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT]);
const DELAY = 380, RATE = 110, DEAD = 0.6;

export const pads = () => [...(navigator.getGamepads?.() || [])].filter(Boolean);

function pressedSet(p) {
  const s = new Set();
  p.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) s.add(i); });
  const [x = 0, y = 0] = p.axes;
  if (y < -DEAD) s.add(BTN.UP); if (y > DEAD) s.add(BTN.DOWN);
  if (x < -DEAD) s.add(BTN.LEFT); if (x > DEAD) s.add(BTN.RIGHT);
  return s;
}

// onButton(btn, padIndex) fires on press, and repeatedly while a direction is held.
export function watchGamepads({ onButton, onConnect, onDisconnect, enabled = () => true }) {
  const state = new Map(); // pad index -> Map(btn -> {t0, last})
  addEventListener('gamepadconnected', (e) => onConnect?.(e.gamepad));
  addEventListener('gamepaddisconnected', (e) => { state.delete(e.gamepad.index); onDisconnect?.(e.gamepad); });
  function tick(now) {
    for (const p of pads()) {
      const held = state.get(p.index) || new Map();
      const cur = pressedSet(p);
      for (const b of [...held.keys()]) if (!cur.has(b)) held.delete(b);
      for (const b of cur) {
        const h = held.get(b);
        if (!h) { held.set(b, { t0: now, last: now }); if (enabled()) onButton(b, p.index); }
        else if (REPEATABLE.has(b) && now - h.t0 > DELAY && now - h.last > RATE) { h.last = now; if (enabled()) onButton(b, p.index); }
      }
      state.set(p.index, held);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
