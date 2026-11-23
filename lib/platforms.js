// Platform table. `system` is the EmulatorJS system id; `core` the default libretro core
// EmulatorJS picks for it (see getCores() in emulator.min.js).
// `playable: false` platforms are still detected and stored, but no browser emulator is
// mature enough to run them (yet).

export const PLATFORMS = {
  nes:        { name: 'Nintendo Entertainment System', short: 'NES',       system: 'nes',        core: 'fceumm',           exts: ['nes', 'fds', 'unf', 'unif'] },
  snes:       { name: 'Super Nintendo',               short: 'SNES',      system: 'snes',       core: 'snes9x',           exts: ['sfc', 'smc', 'fig', 'swc', 'bs'] },
  n64:        { name: 'Nintendo 64',                  short: 'N64',       system: 'n64',        core: 'mupen64plus_next', exts: ['z64', 'n64', 'v64'] },
  gb:         { name: 'Game Boy / Game Boy Color',    short: 'GB/GBC',    system: 'gb',         core: 'gambatte',         exts: ['gb', 'gbc', 'sgb'] },
  gba:        { name: 'Game Boy Advance',             short: 'GBA',       system: 'gba',        core: 'mgba',             exts: ['gba', 'agb'],
                bios: { level: 'optional', files: ['gba_bios.bin'], note: 'Optional. mGBA has a built-in HLE BIOS.' } },
  nds:        { name: 'Nintendo DS',                  short: 'NDS',       system: 'nds',        core: 'melonds',          exts: ['nds', 'dsi'],
                bios: { level: 'optional', files: ['bios7.bin', 'bios9.bin', 'firmware.bin'], note: 'Optional (zip them together). melonDS ships FreeBIOS.' } },
  vb:         { name: 'Virtual Boy',                  short: 'VB',        system: 'vb',         core: 'beetle_vb',        exts: ['vb', 'vboy'] },
  psx:        { name: 'PlayStation',                  short: 'PS1',       system: 'psx',        core: 'pcsx_rearmed',     exts: ['cue', 'pbp', 'chd', 'm3u', 'ccd', 'mds'],
                bios: { level: 'recommended', files: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin'], note: 'Recommended for compatibility. PCSX-ReARMed has an HLE BIOS fallback.' } },
  // PSP runs on standalone PPSSPP compiled to WebAssembly (engine 'ppsspp', lib/ppsspp.js, public/psp.js). The rest
  // of this entry is for EmulatorJS's libretro PPSSPP core, used instead when the server runs with PSP_ENGINE=ejs.
  psp:        { name: 'PlayStation Portable',         short: 'PSP',       engine: 'ppsspp',     system: 'psp',        core: 'ppsspp',  exts: ['cso', 'pbp', 'elf', 'prx'],
                threads: true, extraFiles: ['cores/ppsspp-assets.zip'], note: 'Needs a cross-origin-isolated page (the server sends the headers) and WebGL2.',
                // A browser cannot run PPSSPP's JIT: the IR interpreter is its fastest CPU mode there (and what
                // "JIT" falls back to). Pinned so a stray "Interpreter" setting can't make it 2-3x slower.
                //
                // vsync off: EmulatorJS 4.3's sound driver (rwebaudio) only queues ~20 ms ahead when frames are timed
                // by the display, so every slow PSP frame is a dropped frame and a gap in the sound (crackling). With
                // vsync off RetroArch times frames by the sound instead: it runs ahead until 64 ms are queued and
                // catches up after a slow frame. Measured with 60 ms stalls: 15 gaps in 8 s → none, 55.8 → 60 fps.
                // Can still be switched back in the emulator's own menu (Settings → VSync).
                options: { ppsspp_cpu_core: 'IR JIT', vsync: 'disabled' } },
  segaMS:     { name: 'Sega Master System',           short: 'SMS',       system: 'segaMS',     core: 'smsplus',          exts: ['sms'] },
  segaGG:     { name: 'Sega Game Gear',               short: 'GG',        system: 'segaGG',     core: 'genesis_plus_gx',  exts: ['gg'] },
  segaMD:     { name: 'Sega Mega Drive / Genesis',    short: 'Genesis',   system: 'segaMD',     core: 'genesis_plus_gx',  exts: ['md', 'gen', 'smd', 'sg'] },
  sega32x:    { name: 'Sega 32X',                     short: '32X',       system: 'sega32x',    core: 'picodrive',        exts: ['32x'] },
  segaCD:     { name: 'Sega CD / Mega CD',            short: 'Sega CD',   system: 'segaCD',     core: 'genesis_plus_gx',  exts: [],
                bios: { level: 'required', files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'], note: 'Upload the one for your game\'s region (U = USA, E = Europe, J = Japan).' } },
  segaSaturn: { name: 'Sega Saturn',                  short: 'Saturn',    system: 'segaSaturn', core: 'yabause',          exts: [],
                bios: { level: 'optional', files: ['saturn_bios.bin'], note: 'Optional, improves compatibility.' } },
  pce:        { name: 'PC Engine / TurboGrafx-16',    short: 'PCE',       system: 'pce',        core: 'mednafen_pce',     exts: ['pce', 'sgx'] },
  ngp:        { name: 'Neo Geo Pocket / Color',       short: 'NGP',       system: 'ngp',        core: 'mednafen_ngp',     exts: ['ngp', 'ngc'] },
  ws:         { name: 'WonderSwan / Color',           short: 'WS',        system: 'ws',         core: 'mednafen_wswan',   exts: ['ws', 'wsc'] },
  atari2600:  { name: 'Atari 2600',                   short: '2600',      system: 'atari2600',  core: 'stella2014',       exts: ['a26'] },
  atari7800:  { name: 'Atari 7800',                   short: '7800',      system: 'atari7800',  core: 'prosystem',        exts: ['a78'] },
  lynx:       { name: 'Atari Lynx',                   short: 'Lynx',      system: 'lynx',       core: 'handy',            exts: ['lnx'] },
  jaguar:     { name: 'Atari Jaguar',                 short: 'Jaguar',    system: 'jaguar',     core: 'virtualjaguar',    exts: ['j64', 'jag'] },
  '3do':      { name: '3DO',                          short: '3DO',       system: '3do',        core: 'opera',            exts: [],
                bios: { level: 'required', files: ['panafz10.bin'], note: 'The core cannot start games without it.' } },
  arcade:     { name: 'Arcade (FinalBurn Neo)',       short: 'Arcade',    system: 'arcade',     core: 'fbneo',            exts: [],
                bios: { level: 'optional', files: ['neogeo.zip'], note: 'Only for Neo Geo games. Other arcade games need no BIOS.' } },

  ps2:        { name: 'PlayStation 2',                short: 'PS2',       engine: 'tst',        core: 'TabStationToo (PCSX2)', exts: [],
                threads: true, experimental: true,
                bios: { level: 'required', files: ['SCPH-39001.bin', 'SCPH-70012.bin', 'SCPH-77001.bin', '…'],
                        note: 'Dump it from your own PS2. Any region works; one 4 MB .bin file.' },
                note: 'Runs on TabStationToo (PCSX2 compiled to WebAssembly). Experimental: desktop Chrome/Edge recommended, a fast CPU helps, phones are not supported yet.' },

  // Stored + detected, but not runnable in a browser today.
  gamecube:   { name: 'Nintendo GameCube',            short: 'GameCube',  playable: false, exts: ['gcm', 'gcz', 'rvz'],
                note: 'Dolphin has only early, unreleased WebAssembly/WebGPU demos. Not playable in-browser yet.' },
  wii:        { name: 'Nintendo Wii',                 short: 'Wii',       playable: false, exts: ['wbfs', 'wad'],
                note: 'Same status as GameCube (Dolphin), not playable in-browser yet.' },
  psvita:     { name: 'PlayStation Vita',             short: 'PS Vita',   playable: false, exts: ['vpk'],
                note: 'Vita3K has no browser build. Not playable in-browser.' },
  unknown:    { name: 'Unknown',                      short: '?',         playable: false, exts: [],
                note: 'Could not detect the console. Right-click → Properties to set it manually.' },
};

for (const [id, p] of Object.entries(PLATFORMS)) {
  p.id = id;
  if (p.playable === undefined) p.playable = true;
  // bios.level: 'required' | 'recommended' | 'optional'. Platforms without `bios` need none.
  if (p.bios) p.bios.required = p.bios.level === 'required';
}

export const EXT_MAP = {};
for (const p of Object.values(PLATFORMS)) for (const e of p.exts) EXT_MAP[e] = p.id;

// Files the browser must fetch from /ejs/ to run a platform. `webgl2` and `threads` decide
// which core build EmulatorJS requests: <core>[-thread][-legacy]-wasm.data
export const RUNTIME_FILES = ['loader.js', 'emulator.min.js', 'emulator.min.css', 'compression/extractzip.js'];
const WEBGL2_CORES = new Set(['mupen64plus_next', 'melonds', 'desmume', 'desmume2015', 'pcsx_rearmed', 'mednafen_psx_hw', 'ppsspp']);

export function coreFiles(platformId, { webgl2 = true, threads = false } = {}) {
  const p = PLATFORMS[platformId];
  if (!p || !p.playable || p.engine) return []; // engines 'tst' (PS2) and 'ppsspp' (PSP) have their own files
  const useThreads = !!(p.threads || threads);
  const legacy = webgl2 && (WEBGL2_CORES.has(p.core) || p.core === 'ppsspp') ? '' : '-legacy';
  return [
    `cores/reports/${p.core}.json`,
    `cores/${p.core}${useThreads ? '-thread' : ''}${legacy}-wasm.data`,
    ...(p.extraFiles || []),
  ];
}
