// ScriptProcessor → AudioWorklet shim for PPSSPP's WebAssembly build.
// From ppsspp-runtime.js of PPSSPP Web by roothunter (https://github.com/root-hunter/ppsspp-web),
// GPL-2.0-or-later like PPSSPP; copied unchanged apart from this header, the two stubs below and the export.
// PPSSPP's SDL audio backend calls the deprecated createScriptProcessor(); this replaces it with an
// AudioWorklet that pulls from a ring buffer kept a little ahead of the hardware playhead.
const log = (msg, level) => { if (level === 'err' || level === 'warn') console.warn('[ppsspp audio] ' + msg); };
const audioDebug = { callbacks: 0, rate: 0, peak: 0, nonsilent: 0, underruns: 0 };
/* ── ScriptProcessor → AudioWorklet polyfill (Chrome 126+ compat) ── */
/* Chrome removed createScriptProcessor; SDL's WASM backend uses it.  */
/* Replacement: AudioWorklet with a hardware-clock playhead.          */
/* It prebuffers a small lookahead, but only generates audio up to    */
/* ctx.currentTime + lookahead so timer jitter cannot make it run hot.*/
const SP_SHIM_WORKLET = `
class PPSSPPSpShim extends AudioWorkletProcessor {
  constructor(opts) {
super(opts);
const p        = opts.processorOptions || {};
this._nCh      = p.channels || 2;
this._cap      = p.cap      || 65536;
this._ctrl     = new Int32Array(p.sab, 0, 8);
this._data     = new Float32Array(p.sab, 32, this._cap * this._nCh);
this._last     = new Float32Array(this._nCh);
this._ramp     = 0;
this._rampFrames = 128;
this._tick     = 0;
  }
  process(inputs, outputs) {
const ch = outputs[0];
if (!ch || !ch[0]) return true;
const n = ch[0].length;
let r = Atomics.load(this._ctrl, 1);
const w = Atomics.load(this._ctrl, 0);
const avail = (w - r + this._cap) % this._cap;
const read  = Math.min(n, avail);
let ramp = this._ramp;
for (let i = 0; i < read; i++) {
  const blend = ramp > 0 ? 1.0 - ramp / this._rampFrames : 1.0;
  for (let c = 0; c < ch.length; c++) {
    const src = this._data[r * this._nCh + Math.min(c, this._nCh - 1)];
    const out = ramp > 0 ? this._last[c] * (1.0 - blend) + src * blend : src;
    ch[c][i] = out;
    this._last[c] = out;
  }
  if (ramp > 0) ramp--;
  r = (r + 1) % this._cap;
}
this._ramp = ramp;
if (read < n) {
  Atomics.add(this._ctrl, 4, 1);
  this._ramp = this._rampFrames;
  for (let i = read; i < n; i++) {
    for (let c = 0; c < ch.length; c++) {
      this._last[c] *= 0.985;
      ch[c][i] = Math.abs(this._last[c]) < 0.00001 ? 0 : this._last[c];
    }
  }
}
Atomics.store(this._ctrl, 1, r);
Atomics.add(this._ctrl, 2, read);
// Report consumed count periodically so main thread can track ring fill.
if ((++this._tick & 15) === 0)
  this.port.postMessage({ type: 'status', avail, underruns: Atomics.load(this._ctrl, 4) });
return true;
  }
}
registerProcessor('ppsspp-sp-shim', PPSSPPSpShim);
`;

const _spModuleCtxSet  = new WeakSet();
const _spModulePending = new WeakMap(); // ctx → Promise

async function ensureSpShimModule(ctx) {
  if (_spModuleCtxSet.has(ctx)) return true;
  if (_spModulePending.has(ctx)) return _spModulePending.get(ctx);
  const p = (async () => {
    try {
      const blob = new Blob([SP_SHIM_WORKLET], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      _spModuleCtxSet.add(ctx);
      log('AUDIO: SP→Worklet shim module loaded.', 'ok');
      return true;
    } catch(e) {
      log('AUDIO: SP shim module failed: ' + (e?.message || e), 'warn');
      return false;
    }
  })();
  _spModulePending.set(ctx, p);
  return p;
}

/* ── makeScriptProcessorShim ──────────────────────────────────────
 * Replaces ScriptProcessorNode with an AudioWorkletNode.
 * The pump is locked to a produced-audio playhead:
 *   - It may prebuffer a small lookahead.
 *   - It never generates past the hardware playhead + lookahead.
 *   - Timer bursts can top up the buffer, but cannot advance audio time.
 * ────────────────────────────────────────────────────────────────*/
function makeScriptProcessorShim(ctx, bufferSize, nIn, nOut) {
  const nCh          = Math.max(1, nOut || 2);
  const bufsz        = bufferSize || 2048;
  const SR           = ctx.sampleRate || 44100;
  const RING_CAP     = 32768;          // ring capacity in frames
  const LOOKAHEAD    = Math.max(SR * 0.070, bufsz * 2);
  const MAX_FILL     = Math.max(SR * 0.180, bufsz * 5);
  const MAX_BURST    = 16;             // max pushes per pump call

  let _handler = null;
  let _wn      = null;
  let _gain    = null;
  let _dest    = null;
  let _timerId = null;
  let _fakeBuf = null;
  let _fakeChannels = [];
  let _ctrl    = null;
  let _data    = null;

  // Clock-sync state (all in frames)
  let _playheadStartTime = 0;
  let _producedFrames = 0;
  let _workletDropped = 0;
  let _lastUnderruns = 0;
  let _adaptiveExtra = 0;
  let _lastUnderrunTime = 0;
  let _pushCount = 0;

  try {
    _fakeBuf = ctx.createBuffer(nCh, bufsz, SR);
    _fakeChannels = Array.from({ length: nCh }, (_, c) => _fakeBuf.getChannelData(c));
  } catch(e) {}

  /* Push ONE SDL callback's worth of audio to the worklet ring */
  function pushOne() {
    if (!_handler || !_fakeBuf || !_wn || !_ctrl || !_data) return false;
    let w = Atomics.load(_ctrl, 0);
    let r = Atomics.load(_ctrl, 1);
    const used = (w - r + RING_CAP) % RING_CAP;
    const free = RING_CAP - 1 - used;
    if (bufsz > free) {
      return false;
    }
    try { _handler({ outputBuffer: _fakeBuf }); } catch(e) { return false; }
    const measurePeak = (_pushCount++ & 15) === 0;
    let peak = 0;
    for (let i = 0; i < bufsz; i++) {
      for (let c = 0; c < nCh; c++) {
        const sample = _fakeChannels[c][i];
        _data[w * nCh + c] = sample;
        if (measurePeak) peak = Math.max(peak, Math.abs(sample));
      }
      w = (w + 1) % RING_CAP;
    }
    audioDebug.callbacks++;
    audioDebug.rate = SR;
    if (measurePeak) {
      audioDebug.peak = Math.round(peak * 32767);
      if (peak > 0) audioDebug.nonsilent++;
    }
    Atomics.store(_ctrl, 0, w);
    _producedFrames += bufsz;
    return true;
  }

  function resetPlayhead(now) {
    _playheadStartTime = now || ctx.currentTime || 0;
    _producedFrames = 0;
  }

  /* Clock-locked pump: safe to call as often as desired. */
  function pump() {
    if (ctx.state !== 'running' || !_handler || !_wn) return;
    if (!_playheadStartTime) resetPlayhead(ctx.currentTime);

    _workletDropped = Atomics.load(_ctrl, 3);
    const underruns = Atomics.load(_ctrl, 4);
    if (underruns !== _lastUnderruns) {
      _lastUnderruns = underruns;
      _lastUnderrunTime = ctx.currentTime;
      _adaptiveExtra = Math.min(SR * 0.120, _adaptiveExtra + bufsz);
      audioDebug.underruns = underruns;
    } else if (_adaptiveExtra > 0 && ctx.currentTime - _lastUnderrunTime > 3.0) {
      _adaptiveExtra = Math.max(0, _adaptiveExtra - bufsz * 0.25);
    }

    const writePos = Atomics.load(_ctrl, 0);
    const readPos = Atomics.load(_ctrl, 1);
    const ringFill = (writePos - readPos + RING_CAP) % RING_CAP;
    const targetFill = LOOKAHEAD + _adaptiveExtra;
    const maxFill = MAX_FILL + _adaptiveExtra;
    if (ringFill > maxFill) return;

    let elapsedFrames = Math.max(0, Math.floor((ctx.currentTime - _playheadStartTime) * SR));
    if (_producedFrames < elapsedFrames - maxFill) {
      resetPlayhead(ctx.currentTime);
      elapsedFrames = 0;
    }
    const targetProducedFrames = elapsedFrames + targetFill;
    const maxProducedFrames = elapsedFrames + maxFill;

    // Push only until the produced playhead reaches the lookahead window.
    let n = 0;
    while (
      _producedFrames + bufsz <= targetProducedFrames &&
      _producedFrames + bufsz <= maxProducedFrames &&
      ringFill + n * bufsz < maxFill &&
      n < MAX_BURST
    ) {
      if (!pushOne()) break;
      n++;
    }
  }

  function startPump() {
    if (_timerId) return;
    pump();
    // Short tick with ring-fill gating: stable under main-thread jitter without over-pushing.
    _timerId = setInterval(pump, 2);
    log('AUDIO SP-shim: pump started (bufsz=' + bufsz + ' SR=' + SR +
        ' lookahead=' + Math.round(LOOKAHEAD) + 'fr / ' +
        (LOOKAHEAD * 1000 / SR).toFixed(0) + 'ms).', 'ok');
  }

  function tryFinalize() {
    if (!_wn || !_dest) return;
    _gain = ctx.createGain();
    _gain.gain.value = 1.0;
    _wn.connect(_gain);
    _gain.connect(_dest);
    if (_handler) startPump();
    log('AUDIO SP-shim: connected to destination.', 'ok');
  }

  (async () => {
    const ok = await ensureSpShimModule(ctx);
    if (!ok) { log('AUDIO: SP shim worklet load failed.', 'warn'); return; }
    try {
      if (typeof SharedArrayBuffer === 'undefined') {
        log('AUDIO: SharedArrayBuffer unavailable, SP shim cannot run without extra copies.', 'err');
        return;
      }
      const sab = new SharedArrayBuffer(32 + RING_CAP * nCh * 4);
      _ctrl = new Int32Array(sab, 0, 8);
      _data = new Float32Array(sab, 32, RING_CAP * nCh);
      _wn = new AudioWorkletNode(ctx, 'ppsspp-sp-shim', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [nCh],
        processorOptions: { channels: nCh, cap: RING_CAP, sab },
      });
      _wn.onprocessorerror = (e) =>
        log('AUDIO: SP shim processor error: ' + (e?.message || e), 'err');
      tryFinalize();
    } catch(e) {
      log('AUDIO: SP shim AudioWorkletNode failed: ' + (e?.message || e), 'err');
    }
  })();

  return {
    get onaudioprocess()   { return _handler; },
    set onaudioprocess(fn) {
      _handler = fn;
      // Handler assigned after connect? Start pump now.
      if (_wn && _dest && !_timerId) startPump();
    },
    connect(dest) { _dest = dest; tryFinalize(); },
    disconnect() {
      if (_timerId) { clearInterval(_timerId); _timerId = null; }
      try { if (_gain) _gain.disconnect(); } catch(e) {}
      try { if (_wn)   _wn.disconnect();   } catch(e) {}
    },
    addEventListener()    {},
    removeEventListener() {},
  };
}

async function installScriptProcessorPolyfill(ctx) {
  if (!ctx || !ctx.audioWorklet) {
    log('AUDIO: AudioWorklet not available — ScriptProcessor polyfill skipped.', 'warn');
    return;
  }
  // Pre-load the shim worklet module NOW (inside user gesture) so it's
  // ready before SDL synchronously calls createScriptProcessor.
  await ensureSpShimModule(ctx);

  // Patch AudioContext.prototype globally — covers SDL's own context too.
  const proto = AudioContext.prototype;
  if (proto._ppssppSpPatched) return;
  proto._ppssppSpPatched = true;

  const _origCreate = proto.createScriptProcessor;
  proto.createScriptProcessor = function(bufSize, nIn, nOut) {
    // Always use the shim — avoids Chrome's deprecated/broken native node
    // and the "onaudioprocess never fires" bug on Chrome 126+.
    // On Firefox/Safari the shim works identically.
    log('AUDIO: createScriptProcessor → WorkletShim (bufSz=' + bufSize +
        ', nCh=' + (nOut || 2) + ').', 'info');
    return makeScriptProcessorShim(this, bufSize, nIn, nOut);
  };
  log('AUDIO: ScriptProcessor→AudioWorklet polyfill active (all browsers).', 'ok');
}

/* ── Gamepad ────────────────────────────────────────────────────── */
const connectedGamepads = new Map();
const GAMEPAD_POLL_MS = 1000;

export { installScriptProcessorPolyfill, audioDebug };
