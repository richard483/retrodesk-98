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
                bios: { required: false, files: ['gba_bios.bin'], note: 'Optional. mGBA has a built-in HLE BIOS.' } },
  nds:        { name: 'Nintendo DS',                  short: 'NDS',       system: 'nds',        core: 'melonds',          exts: ['nds', 'dsi'],
                bios: { required: false, files: ['bios7.bin', 'bios9.bin', 'firmware.bin'], note: 'Optional (zip them together). melonDS ships FreeBIOS.' } },
  vb:         { name: 'Virtual Boy',                  short: 'VB',        system: 'vb',         core: 'beetle_vb',        exts: ['vb', 'vboy'] },
  psx:        { name: 'PlayStation',                  short: 'PS1',       system: 'psx',        core: 'pcsx_rearmed',     exts: ['cue', 'pbp', 'chd', 'm3u', 'ccd', 'mds'],
                bios: { required: false, files: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin'], note: 'Recommended for compatibility. PCSX-ReARMed has an HLE BIOS fallback.' } },
  psp:        { name: 'PlayStation Portable',         short: 'PSP',       system: 'psp',        core: 'ppsspp',           exts: ['cso', 'pbp', 'elf', 'prx'],
                threads: true, extraFiles: ['cores/ppsspp-assets.zip'], note: 'Needs a cross-origin-isolated page (the server sends the headers) and WebGL2.' },
  segaMS:     { name: 'Sega Master System',           short: 'SMS',       system: 'segaMS',     core: 'smsplus',          exts: ['sms'] },
  segaGG:     { name: 'Sega Game Gear',               short: 'GG',        system: 'segaGG',     core: 'genesis_plus_gx',  exts: ['gg'] },
  segaMD:     { name: 'Sega Mega Drive / Genesis',    short: 'Genesis',   system: 'segaMD',     core: 'genesis_plus_gx',  exts: ['md', 'gen', 'smd', 'sg'] },
  sega32x:    { name: 'Sega 32X',                     short: '32X',       system: 'sega32x',    core: 'picodrive',        exts: ['32x'] },
  segaCD:     { name: 'Sega CD / Mega CD',            short: 'Sega CD',   system: 'segaCD',     core: 'genesis_plus_gx',  exts: [],
                bios: { required: true, files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'], note: 'Required.' } },
  segaSaturn: { name: 'Sega Saturn',                  short: 'Saturn',    system: 'segaSaturn', core: 'yabause',          exts: [],
                bios: { required: false, files: ['saturn_bios.bin'], note: 'Optional, improves compatibility.' } },
  pce:        { name: 'PC Engine / TurboGrafx-16',    short: 'PCE',       system: 'pce',        core: 'mednafen_pce',     exts: ['pce', 'sgx'] },
  ngp:        { name: 'Neo Geo Pocket / Color',       short: 'NGP',       system: 'ngp',        core: 'mednafen_ngp',     exts: ['ngp', 'ngc'] },
  ws:         { name: 'WonderSwan / Color',           short: 'WS',        system: 'ws',         core: 'mednafen_wswan',   exts: ['ws', 'wsc'] },
  atari2600:  { name: 'Atari 2600',                   short: '2600',      system: 'atari2600',  core: 'stella2014',       exts: ['a26'] },
  atari7800:  { name: 'Atari 7800',                   short: '7800',      system: 'atari7800',  core: 'prosystem',        exts: ['a78'] },
  lynx:       { name: 'Atari Lynx',                   short: 'Lynx',      system: 'lynx',       core: 'handy',            exts: ['lnx'] },
  jaguar:     { name: 'Atari Jaguar',                 short: 'Jaguar',    system: 'jaguar',     core: 'virtualjaguar',    exts: ['j64', 'jag'] },
  '3do':      { name: '3DO',                          short: '3DO',       system: '3do',        core: 'opera',            exts: [],
                bios: { required: true, files: ['panafz10.bin'], note: 'Required.' } },
  arcade:     { name: 'Arcade (FinalBurn Neo)',       short: 'Arcade',    system: 'arcade',     core: 'fbneo',            exts: [] },

  // Stored + detected, but not runnable in a browser today.
  ps2:        { name: 'PlayStation 2',                short: 'PS2',       playable: false, exts: [],
                note: 'No production-ready browser PS2 emulator yet. Play! has an experimental WebAssembly build (playjs.purei.org) that runs few games.' },
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
}

export const EXT_MAP = {};
for (const p of Object.values(PLATFORMS)) for (const e of p.exts) EXT_MAP[e] = p.id;

// Files the browser must fetch from /ejs/ to run a platform. `webgl2` and `threads` decide
// which core build EmulatorJS requests: <core>[-thread][-legacy]-wasm.data
export const RUNTIME_FILES = ['loader.js', 'emulator.min.js', 'emulator.min.css', 'compression/extractzip.js'];
const WEBGL2_CORES = new Set(['mupen64plus_next', 'melonds', 'desmume', 'desmume2015', 'pcsx_rearmed', 'mednafen_psx_hw', 'ppsspp']);

export function coreFiles(platformId, { webgl2 = true, threads = false } = {}) {
  const p = PLATFORMS[platformId];
  if (!p || !p.playable) return [];
  const useThreads = !!(p.threads || threads);
  const legacy = webgl2 && (WEBGL2_CORES.has(p.core) || p.core === 'ppsspp') ? '' : '-legacy';
  return [
    `cores/reports/${p.core}.json`,
    `cores/${p.core}${useThreads ? '-thread' : ''}${legacy}-wasm.data`,
    ...(p.extraFiles || []),
  ];
}
