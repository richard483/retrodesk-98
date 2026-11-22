# RetroDesk 98

Your own game library, served from your machine and **emulated locally in the browser**. Nothing
is streamed as video. The server only stores your games, BIOS files and saves. The UI is a Windows 98 desktop.

```
npm start            # or: node server.js   (Node 22+, no npm install needed)
open http://localhost:8098
```

| env var        | default   | meaning |
|----------------|-----------|---------|
| `PORT`         | `8098`    | HTTP port |
| `HOST`         | `0.0.0.0` | bind address |
| `DATA_DIR`     | `./data`  | games, saves, BIOS, emulator mirror, `library.json` |
| `EMU_PASSWORD` | (none)    | if set, the server requires HTTP Basic auth (any username) |
| `EJS_VERSION`  | `4.2.3`   | EmulatorJS release to mirror |

## What came from the community and what is new

| Piece | Source |
|---|---|
| Emulator cores and player | [EmulatorJS](https://emulatorjs.org) (libretro cores compiled to WebAssembly). The server downloads each file from the EmulatorJS CDN **once**, then serves it from `data/ejs/`. |
| Win98 look | [98.css](https://jdan.github.io/98.css/), vendored in `public/vendor/98css` (MIT) |
| Console detection, library, save sync, browser storage manager, Win98 desktop shell | written for this project |

The closest existing project is [RomM](https://github.com/rommapp/romm). It also uses EmulatorJS,
but it is much heavier (Python, MariaDB, Redis) and has no per-game control over browser storage. RomM is worth a look if you want metadata scraping from IGDB.

## Console support

| Console | In-browser? | Core |
|---|---|---|
| NES, SNES, N64, GB/GBC, GBA, NDS, Virtual Boy | ✅ | fceumm, snes9x, mupen64plus_next, gambatte, mgba, melonDS, beetle_vb |
| PlayStation 1 | ✅ | pcsx_rearmed (BIOS optional, recommended) |
| PSP | ✅ (needs WebGL2 + cross-origin isolation, which the server provides) | PPSSPP |
| Sega MS/GG/Genesis/32X/CD/Saturn, PC Engine, NGP, WonderSwan, Atari 2600/7800/Lynx/Jaguar, 3DO, Arcade | ✅ | various |
| PlayStation 2 | ❌ stored only | No mature browser emulator yet (Play! has an experimental WASM build) |
| GameCube / Wii | ❌ stored only | Dolphin has only unreleased WebAssembly demos |
| PS Vita | ❌ stored only | Vita3K has no browser build |

Unsupported consoles are still detected and kept safe on the server. To enable one later, add its
core to `lib/platforms.js`.

## How it works

**Upload.** Drag files onto the desktop or the *My Games* window. Uploads are raw `PUT` streams, so
multi-GB ISOs go straight to disk. A `.cue` uploaded with its `.bin` tracks is bundled into one zip.

**Detection** (`lib/detect.js`) reads only a few KB of each file:
cartridge headers (iNES, N64 in all 3 byte orders, GB/GBA/NDS logos, SEGA header, SNES checksum), ISO-9660
contents (`SYSTEM.CNF` with `BOOT2` → PS2, with `BOOT` → PS1, `UMD_DATA.BIN` → PSP, raw 2352-byte BIN supported),
GameCube/Wii disc magic, CSO/RVZ/GCZ/WBFS magic, PBP EBOOT (PS1 classic vs PSP), and the contents of zip files
(VPK → Vita). If nothing matches, it falls back to the file extension. Uncertain matches are marked `(?)`, and you can
change the console from the right-click menu.

**Before playing**, the *Start Game* dialog lists what the browser must download:
the shared EmulatorJS runtime, the console's core, the BIOS and the game file. Each item shows its size and whether
it is already stored, next to a gauge of the browser's storage quota. Choose one of:
- **Download & Play**: keeps the game in the browser, so it starts instantly next time and works offline.
- **Play without keeping**: the game is held in memory only. The core is still cached because it is small and shared.

**Browser storage** uses Cache Storage, which streams to disk and handles multi-GB files. Emulator files
are cached by a service worker (`public/sw.js`). **Storage Manager** lists every core, BIOS and game with its
size, lets you delete each one, and can request *persistent* storage so the browser won't evict it.

**Saves.** Battery saves (SRAM) upload every 30 s, on exit and on tab close. Save states (slots 1–9,
with screenshots) are stored on the server. When you close a game window an auto-save state is written,
and the next launch offers to resume from it.

## Game controllers

Any controller the browser's Gamepad API recognises works: Xbox, PS4/PS5, Switch Pro, 8BitDo and others, over
USB or Bluetooth. Browsers only reveal a controller **after you press a button**. The tray then shows a controller icon.

- **In games**, EmulatorJS reads the controller directly. Choose **Game → Controls / remap buttons…** to remap.
  RetroDesk stores the mapping **per console on the server**, so it applies to every game of that console on every
  device (EmulatorJS on its own would keep it per game, per browser).
- **On the desktop**: D-pad/stick to move, A to play/OK, B to go back, X opens the game menu, Y opens Properties,
  LB/RB switch console folder, and Start opens the Start menu.
- **Hold Select+Start (or Home) for 1.5 s** to exit a game. Saves are flushed first.
- **Start → Controllers** shows connected pads with a live button test, and lets you reset saved mappings.

Controllers marked "non-standard layout" (some generic DirectInput pads) still work, but may need a one-time remap.

## Layout

```
server.js            HTTP server, API, EmulatorJS mirror (zero dependencies)
lib/platforms.js     console table: core, BIOS, extensions, playability
lib/detect.js        console auto-detection
public/              Win98 frontend (vanilla JS, no build step)
  app.js             desktop, windows, library, upload, play dialog, storage/BIOS managers
  play.html/js       emulator page (runs inside a game window), save sync
  store.js, sw.js    browser storage + service worker
  gamepad.js         controller polling for desktop navigation
test/                node --test
```

## Notes

- Use `http://localhost` or HTTPS. Service workers and cross-origin isolation (needed for PSP) only work in a
  secure context. To reach it from another device, put it behind HTTPS, for example with Caddy or Tailscale.
- EmulatorJS loads the whole game into RAM, so very large PSP ISOs (1.5 GB+) need plenty of memory.
- Only play games you own, and use BIOS dumps from your own consoles.
