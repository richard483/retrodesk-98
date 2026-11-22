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
| `EJS_VERSION`  | `4.3.0-pre` | EmulatorJS release to mirror (see [Performance](#performance)); `4.2.3` is the last stable one |
| `TST_URL`      | `https://tabstationtoo.github.io/TabStationToo/` | where the PS2 emulator (TabStationToo) is copied from |

### Docker

```
docker compose up -d --build      # then open http://localhost:8098
```

or without compose:

```
docker build -t retrodesk98 .
docker run -d --name retrodesk98 -p 8098:8098 -v retrodesk-data:/data --restart unless-stopped retrodesk98
```

- Everything the server stores (games, saves, BIOS, the EmulatorJS mirror, `library.json`) is in `/data`.
  Keep it on a volume, or it is lost when the container is removed.
- To use a host folder instead of a named volume, run `mkdir -p data` and mount `-v ./data:/data`. The container
  runs as uid 1000, so the folder must be writable by that user.
- Pass settings with `-e`, for example `-e EMU_PASSWORD=secret`. The env vars are listed in the table above.
- The first time each console is played, the container downloads its core from the EmulatorJS CDN, so it needs outbound internet.
- For phones or other machines, put HTTPS in front of it (see [Mobile](#mobile-phones--tablets)).

## What came from the community and what is new

| Piece | Source |
|---|---|
| Emulator cores and player | [EmulatorJS](https://emulatorjs.org) (libretro cores compiled to WebAssembly). The server downloads each file from the EmulatorJS CDN **once**, then serves it from `data/ejs/`. |
| PS2 emulator | [TabStationToo](https://github.com/TabStationToo/TabStationToo) (PCSX2 compiled to WebAssembly, GPL-3.0). The server copies one build of its site into `data/tst/<build>/` and serves it from there. |
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
| PlayStation 2 | ⚠️ experimental (desktop Chrome/Edge, BIOS required) | TabStationToo (PCSX2). See [PlayStation 2](#playstation-2) |
| GameCube / Wii | ❌ stored only | Dolphin has only unreleased WebAssembly demos |
| PS Vita | ❌ stored only | Vita3K has no browser build |

Unsupported consoles are still detected and kept safe on the server. To enable one later, add its
core to `lib/platforms.js`.

## How it works

**Upload.** Drag files onto the desktop or the *My Games* window. Uploads are raw `PUT` streams, so
multi-GB ISOs go straight to disk. A `.cue` uploaded with its `.bin` tracks is bundled into one zip.

**Detection** (`lib/detect.js`) reads only a few KB of each file:
cartridge headers (iNES, N64 in all 3 byte orders, GB/GBA/NDS logos, SEGA header, SNES checksum), ISO-9660
contents, also inside CSO/ZSO compressed images (`SYSTEM.CNF` with `BOOT2` → PS2, with `BOOT` → PS1, `UMD_DATA.BIN` → PSP, raw 2352-byte BIN supported),
CHD metadata (DVD → PS2), GameCube/Wii disc magic, RVZ/GCZ/WBFS magic, PBP EBOOT (PS1 classic vs PSP), and the contents of zip files
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

## PlayStation 2

PS2 games run on [TabStationToo](https://github.com/TabStationToo/TabStationToo), which is PCSX2 compiled to
WebAssembly. It is early and experimental, but games play.

**What you need**
- A **PS2 BIOS** dumped from your own console (one 4 MB `.bin`, any region). Upload it in **BIOS Files**.
- **Desktop Chrome or Edge**. Firefox works too. A fast CPU helps: heavy scenes run below full speed on slower machines.
  With WebGPU the hardware renderer is used; without it (Linux usually, or older browsers) the picture is drawn in
  software, which is slower. Phones and tablets are not supported yet: the emulator reserves 512 MB of memory at start,
  and it has no touch controls.
- Disc images: `.iso`, single-track `.bin` (a `.cue` with one `.bin` is stored as the `.bin`), `.chd`, `.cso`, `.zso`.
  Multi-track BIN/CUE and CHDs with a parent are not supported by TabStationToo yet.

**How it works in RetroDesk**
- The first time you play a PS2 game, the server copies the TabStationToo site (about 17 MB) from GitHub Pages into
  `data/tst/<build>/`. After that, nothing is fetched from the internet. The browser caches those files like the other cores.
- The disc is **never loaded into memory**. TabStationToo reads the parts the game asks for, so *Play without keeping*
  streams them from your server, and *Download & Play* reads them from the browser's cache.
- The game window shows only the picture. **View → Show emulator panel** brings back TabStationToo's own interface:
  TV, console, remote, graphics menu, memory card slots, and the drawn controllers where you remap keys and buttons.
  **Game → Controls / remap buttons…** opens it at the controllers.
- **Save states** use RetroDesk's slots 1–9 and the auto-save, stored on the server like other consoles, with
  resume on the next launch.
- **Memory cards**: if a browser has none, RetroDesk creates *Memory card 1* in slot 1, because a PS2 game cannot
  save without a card. The cards are backed up to the server (gzip, usually a few hundred KB) every 30 s and when the
  game closes. A browser that has not seen the latest copy takes it before the game starts. If both changed, the
  browser's copy is kept on the server as `data/saves/_ps2/cards-conflict-<time>.bin` and the server's copy wins.
- **Updates**: TabStationToo changes often. **View → Check for emulator update…** in a PS2 game window downloads
  the newest build beside the old one and switches over.
- Game titles come from PCSX2's database (shipped with TabStationToo), looked up by the disc's serial.

**What RetroDesk changes.** Nothing in TabStationToo's files. When `index.html` is served, two lines are added: a
stylesheet (`public/tst-embed.css`) and a class switch for the compact view. Source and licence:
[github.com/TabStationToo/TabStationToo](https://github.com/TabStationToo/TabStationToo) (GPL-3.0). It is built on
[PCSX2](https://github.com/PCSX2/pcsx2). Neither project is affiliated with RetroDesk.

**Why TabStationToo and not Play!.js.** [Play!](https://github.com/jpd002/Play-) has an official browser build
([playjs.purei.org](https://playjs.purei.org/)) that needs no BIOS. Its own site says it is "not meant to play all
games", and it has no URL or API for loading a disc from another page. TabStationToo runs PCSX2's core, with
WebAssembly JITs for all four PS2 processors, a WebGPU renderer, and many games at or near full speed. It can boot a
BIOS and disc by URL, which is what makes it possible to embed it.

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

## Multiplayer

**Local multiplayer (same screen): supported, up to 4 players.** Connect a controller per player. The first
controller is Player 1, the second is Player 2, and so on. This also covers controllers that were already
connected before the game started. EmulatorJS on its own ignores those, so RetroDesk assigns them at game start.
To change who is which player, open **Game → Controls / remap buttons…** and pick a controller per player.
Each player has their own mapping, and the whole set is saved per console on the server. How many players a
game allows depends on the console and the game (for example N64 supports 4, NES and SNES 2).

PS2 games have 2 players (ports 1 and 2, no multitap). Assign pads in the emulator panel.

**Online netplay: not available yet.** EmulatorJS 4.2.3 (the last stable release) ships its netplay
switched off. It is only reachable in debug mode behind an experimental flag. When tested here, even with
those flags on the netplay button stayed hidden, and EmulatorJS's public relay server
(`netplay.emulatorjs.org`) returned HTTP 525. EmulatorJS 4.3.0-pre (now the default here) adds netplay over WebRTC, which RetroDesk does not wire up yet.
It would also need a relay ([EmulatorJS-Netplay](https://github.com/EmulatorJS/EmulatorJS-Netplay)) and a
RetroDesk address both players can reach.

## Performance

**Why a game can lag while Task Manager looks idle.** An emulator runs the console's CPU on **one** thread. On an
8-core/16-thread CPU, one thread at 100 % shows as about 6 % in Task Manager's total. The game is held back by
that single thread, not by the machine as a whole. Look at the per-core graphs to see it.

What RetroDesk does about it:
- **EmulatorJS 4.3.0-pre by default.** It is a pre-release, but measured here (NES, speed limit off) it emulates
  **~52 % faster** than 4.2.3 (1524 vs 999 frames/s), because most cores no longer run through Asyncify. For PSP it is
  the fix that matters: in 4.2.3 PPSSPP's hardware rendering is broken, so PSP games are drawn in software on one
  thread. 4.3 fixes hardware rendering, and EmulatorJS's notes call PSP "significantly more playable". To go back,
  set `EJS_VERSION=4.2.3`. Emulator files are cached per version, so switching is clean. Save states made by one
  version's cores may not load in the other; battery saves are not affected.
- **PSP** is pinned to PPSSPP's IR interpreter, its fastest CPU mode in a browser (a browser cannot run its JIT).
- **Threads stay off except for PSP.** Every core has a threaded build in 4.3, but measured here the threaded NES core
  was slower (1279 vs 1524 frames/s). You can still turn it on per game in the emulator's own menu (Settings → Threads).
- **The desktop stops polling controllers while a game is in front.** The game's frame shares the browser's main
  thread with the desktop.

What you can check on your side:
- **Chrome's Energy Saver** caps pages at 30 frames per second. Turn it off in *Settings → Performance*,
  or keep the laptop plugged in.
- **Windows power mode**: set *Best performance* (Settings → System → Power).
- **Hardware acceleration**: `chrome://gpu` should say *WebGL2: Hardware accelerated*. If it says software,
  turn on *Settings → System → Use graphics acceleration*.
- For PSP, keep *Internal resolution* at 1× (480×272) in the emulator menu. Each step up costs GPU time.

## Mobile (phones & tablets)

RetroDesk works on phones and tablets, in portrait and landscape. It re-lays out when you rotate.

- **Layout:** windows open maximised. The console tree becomes a drop-down in the toolbar, toolbar buttons
  shrink to icons, and dialogs fit the screen width. Touch targets are larger on touch screens.
- **Touch:** tap a game to select it, tap it again to play. **Long-press** acts as right-click: it opens the
  game menu (Keep in browser, Rename, Change console, Delete, Properties). Desktop icons open with one tap.
- **While playing**, the game takes the whole screen and the taskbar hides. Minimise the game window to get
  the taskbar back.
- **On-screen controller:** use **View → On-screen controller** in the game window:
  - *Auto* (default): shown on touch screens, hidden automatically while a physical controller is connected.
  - *Always show* / *Hide*.

  The choice is remembered per device. The touch controls sit under the picture in portrait and beside it in landscape.
- **Physical controllers** (Bluetooth or USB-C) work on mobile exactly as on desktop.

### Full screen on mobile: what's possible

| Device / browser | True full screen? | How |
|---|---|---|
| Android: Chrome, Edge, Samsung Internet, Firefox | ✅ Yes | In a game: **View → Full screen**. For the whole desktop: **Start → Full screen mode**. Swipe from the edge or press Back to leave. |
| Android, installed as an app | ✅ Yes, always | **Start → Install as app…** (or browser menu → *Install app* / *Add to Home screen*). It then opens full screen with no browser bars. |
| iPad: Safari | ✅ Yes | **View → Full screen** works the same as on Android. |
| iPhone: Safari, Chrome, any browser | ❌ Not for web pages | Apple only lets videos go full screen on iPhone. Use **Share → Add to Home Screen** and open RetroDesk from that icon. It runs without Safari's address bar and toolbar, which is as close to full screen as iOS allows. |

How to install on each platform:

1. **Android (Chrome):** open RetroDesk → **Start → Install as app…** → *Install*. Or use the browser menu ⋮ → *Install app*.
2. **iPhone / iPad (Safari):** open RetroDesk → tap **Share** (□↑) → **Add to Home Screen** → *Add*.
3. Launch it from the new **RetroDesk** icon on your home screen.

> Installing and full screen need a **secure context**: `https://…`, or `http://localhost` on the same machine.
> On a phone, `http://192.168.x.x:8098` loads, but browsers block service workers, installing, and
> PSP's threaded core there. The easiest fix is [Tailscale](https://tailscale.com) (`tailscale serve 8098`
> gives you an HTTPS URL) or a reverse proxy such as Caddy with a real certificate.

## Layout

```
server.js            HTTP server, API, EmulatorJS mirror (zero dependencies)
lib/platforms.js     console table: core, BIOS, extensions, playability
lib/detect.js        console auto-detection (also looks inside CSO/ZSO, reads CHD metadata)
lib/tst.js           TabStationToo (PS2) mirror: download, pin, update, serve
public/              Win98 frontend (vanilla JS, no build step)
  app.js             desktop, windows, library, upload, play dialog, storage/BIOS managers
  play.html/js       emulator page (runs inside a game window), save sync
  ps2.html/js        PS2 page: hosts TabStationToo, state slots, memory card sync
  tst-embed.css      compact game-window layout for TabStationToo
  store.js, sw.js    browser storage + service worker
  gamepad.js         controller polling for desktop navigation
  manifest.webmanifest, icons/   installable app (PWA) metadata and icons
scripts/make-icons.mjs  regenerates the PNG app icons from the pixel art
test/                node --test
Dockerfile, compose.yaml  container image + compose setup
```

## Notes

- Use `http://localhost` or HTTPS. Service workers and cross-origin isolation (needed for PSP) only work in a
  secure context. To reach it from another device, put it behind HTTPS, for example with Caddy or Tailscale.
- EmulatorJS loads the whole game into RAM, so very large PSP ISOs (1.5 GB+) need plenty of memory.
- Only play games you own, and use BIOS dumps from your own consoles.
