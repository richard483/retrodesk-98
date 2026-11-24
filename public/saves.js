// Save Data: what is saved for each game, on the server, and what you can do with it.
//   Game save    the game's own save (memory card, battery save, PSP SAVEDATA); every start loads it, so the
//                game's Continue / Load menu works as on the console. PS2 games share memory cards, like a PS2.
//   Save states  snapshots of the whole console at one moment, in slots 1-9; "Resume point" (slot auto) is made
//                when you close a game, and the Start Game dialog offers to continue from it.
export function initSaves(ctx) {
  const { h, esc, icon, platformIcon, fmt, api, createWindow, closeWin, focusWin, wins, msgbox, confirmBox, showMenu, putFile } = ctx;
  const $ = (s, r = document) => r.querySelector(s);
  const when = (t) => (t ? new Date(t).toLocaleString() : '');
  const ago = (t) => {
    if (!t) return '';
    const s = (Date.now() - t) / 1000;
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
  };
  const SLOTS = ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const slotName = (s) => (s === 'auto' ? 'Resume point' : `Slot ${s}`);

  // What a console's own save is, in words.
  function saveKind(g) {
    const engine = ctx.info().platforms[g.platform]?.engine;
    if (engine === 'tst') return { name: 'PS2 memory cards', what: 'Shared by all PS2 games, like the memory cards in a real PS2. Use the game\'s own Save and Load menus.', ext: '.rdps2cards', shared: true };
    if (engine === 'ppsspp') return { name: 'PSP save data', what: 'The game\'s own saves (PSP/SAVEDATA). Loaded every time the game starts: use the game\'s Continue or Load menu.', ext: '.rdpspsave' };
    if (g.platform === 'psx') return { name: 'Memory card', what: 'The game\'s own saves on its memory card. Loaded every time the game starts: use the game\'s Continue or Load menu.', ext: '.srm' };
    return { name: 'Battery save', what: 'The game\'s own save (the save chip in the cartridge). Loaded every time the game starts.', ext: '.srm' };
  }

  // ---------------------------------------------------------------- one game
  async function openGameSaves(g) {
    if (!g) return;
    const id = 'saves-' + g.id;
    if (wins.has(id)) { focusWin(wins.get(id)); return wins.get(id).reload?.(); }
    const kind = saveKind(g);
    const body = h(`<div class="scroll saves-win" style="flex:1;padding:8px;background:silver"></div>`);
    const win = createWindow({ id, title: `Saves — ${g.title}`, ic: 'floppy', w: 640, hgt: 560, body,
      menubar: { File: () => [{ label: 'Play', bold: true, icon: 'gamepad', action: () => ctx.preparePlay(g) }, '-', { label: 'Refresh', action: () => reload() }, { label: 'Close', action: () => closeWin(win) }],
        Help: () => [{ label: 'About saves and states', action: explain }] } });

    async function reload() {
      const [states, sum] = await Promise.all([api(`/games/${g.id}/states`).catch(() => []), api('/saves').catch(() => ({ games: {} }))]);
      const save = kind.shared ? sum.ps2Cards : sum.games[g.id]?.save;
      const by = Object.fromEntries(states.map((s) => [s.slot, s]));
      body.innerHTML = `
        <div class="saves-head">${icon(platformIcon(g.platform))}<div><b>${esc(g.title)}</b><br><span class="muted">${esc(g.platformName)}</span></div>
          <button class="play"><b>Play</b></button></div>
        <fieldset><legend>Game save</legend>
          <div class="save-row">${icon('floppy')}<div style="flex:1"><b>${esc(kind.name)}</b> — ${save ? `${fmt(save.size)}, synced ${esc(ago(save.time))} <span class="muted">(${esc(when(save.time))})</span>` : '<span class="muted">nothing saved yet</span>'}
            <br><span class="muted">${esc(kind.what)}</span></div></div>
          <div class="buttons left"><button class="dl-save" ${save ? '' : 'disabled'}>Download…</button><button class="up-save">Replace from file…</button>${kind.shared ? '' : `<button class="del-save" ${save ? '' : 'disabled'}>Delete</button>`}</div>
        </fieldset>
        <fieldset style="margin-top:8px"><legend>Save states (snapshots of the exact moment)</legend>
          <p class="muted" style="margin:0 0 6px">Save a state in a game with <b>Game → Save state</b>. The <b>resume point</b> is made by itself when you close the game, and the Start Game dialog offers to continue from it.</p>
          <div class="state-grid">${SLOTS.map((s) => card(s, by[s])).join('')}</div>
        </fieldset>`;
      $('.play', body).onclick = () => ctx.preparePlay(g);
      $('.dl-save', body).onclick = () => download(kind.shared ? '/api/ps2/cards?dl=1' : `/api/games/${g.id}/save?dl=1`);
      $('.up-save', body).onclick = () => replaceSave();
      $('.del-save', body)?.addEventListener('click', async () => {
        if (!(await confirmBox(`Delete the ${kind.name.toLowerCase()} of "${g.title}" from the server?\n\nThe game starts with no saves next time. This cannot be undone (download a copy first if unsure).`, { title: 'Delete game save' }))) return;
        await fetch(`/api/games/${g.id}/save`, { method: 'DELETE' }); reload(); ctx.changed();
      });
      body.querySelectorAll('.state').forEach((el) => {
        const s = el.dataset.slot, st = by[s];
        el.querySelector('.go')?.addEventListener('click', () => ctx.preparePlay(g, { slot: s }));
        el.querySelector('.dl')?.addEventListener('click', () => download(`/api/games/${g.id}/states/${s}?dl=1`));
        el.querySelector('.up')?.addEventListener('click', () => uploadState(s));
        el.querySelector('.del')?.addEventListener('click', async () => {
          if (!(await confirmBox(`Delete ${slotName(s).toLowerCase()} of "${g.title}"?`, { title: 'Delete save state' }))) return;
          await fetch(`/api/games/${g.id}/states/${s}`, { method: 'DELETE' }); reload(); ctx.changed();
        });
        el.oncontextmenu = (e) => {
          e.preventDefault(); e.stopPropagation();
          showMenu(st ? [{ label: 'Play from here', bold: true, action: () => ctx.preparePlay(g, { slot: s }) }, '-', { label: 'Download…', action: () => download(`/api/games/${g.id}/states/${s}?dl=1`) },
            { label: 'Replace from file…', action: () => uploadState(s) }, '-', { label: 'Delete', action: () => el.querySelector('.del').click() }]
            : [{ label: 'Put a state file here…', action: () => uploadState(s) }], e.clientX, e.clientY);
        };
        el.ondblclick = () => { if (st) ctx.preparePlay(g, { slot: s }); };
      });
    }
    function card(s, st) {
      if (!st) return `<div class="state empty" data-slot="${s}"><div class="shot">${s === 'auto' ? 'No resume point yet' : 'Empty'}</div><div class="cap"><b>${slotName(s)}</b><br><button class="up small">Put file…</button></div></div>`;
      return `<div class="state" data-slot="${s}" title="Double-click to play from here">
        <div class="shot">${st.shot ? `<img src="/api/games/${g.id}/states/${s}/shot?t=${st.time}" loading="lazy" alt="">` : '<span>(no picture)</span>'}</div>
        <div class="cap"><b>${slotName(s)}</b> <span class="muted">${fmt(st.size)}</span><br><span title="${esc(when(st.time))}">${esc(ago(st.time))}</span><br>
          <button class="go small"><b>Play from here</b></button><button class="dl small ico-btn" title="Download">${icon('floppy')}</button><button class="del small" title="Delete">✕</button></div></div>`;
    }
    function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }
    function pick(accept) {
      return new Promise((resolve) => {
        const inp = Object.assign(document.createElement('input'), { type: 'file', accept });
        inp.onchange = () => resolve(inp.files[0] || null);
        inp.click();
      });
    }
    async function replaceSave() {
      if (wins.has('game-' + g.id)) return msgbox('Close the game first: while it runs, it keeps writing its own save over this one.', { ic: 'warn' });
      const f = await pick(kind.shared ? '.rdps2cards' : kind.ext === '.srm' ? '.srm,.sav,.mcr,.mcd,.bin' : kind.ext);
      if (!f) return;
      if (!(await confirmBox(`Replace the ${kind.name.toLowerCase()}${kind.shared ? ' (all PS2 games)' : ` of "${g.title}"`} with "${f.name}" (${fmt(f.size)})?\n\nThe current one is overwritten.`, { title: 'Replace game save' }))) return;
      try {
        const r = kind.shared ? await fetch(`/api/ps2/cards?version=${Date.now()}`, { method: 'PUT', body: f }) : await fetch(`/api/games/${g.id}/save`, { method: 'PUT', body: f });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        msgbox(`${kind.name} replaced. The game uses it from its next start.`); reload(); ctx.changed();
      } catch (e) { msgbox('Upload failed: ' + e.message, { ic: 'error' }); }
    }
    async function uploadState(s) {
      const f = await pick('.state,.bin,.p2s,.ppst');
      if (!f) return;
      try { await putFile(`/api/games/${g.id}/states/${s}`, f); reload(); ctx.changed(); }
      catch (e) { msgbox('Upload failed: ' + e.message, { ic: 'error' }); }
    }
    win.reload = reload;
    reload();
    return win;
  }

  function explain() {
    msgbox(`<b>Game save</b> is what the game saves by itself: its memory card, battery save or PSP save data. RetroDesk keeps it on the server and loads it every time you start the game, on any device. Continue the way you would on the console: through the game's own Continue or Load menu.<br><br>
      <b>Save states</b> are snapshots of the whole console at one exact moment, also kept on the server:<br>
      • <b>Resume point</b>: made by itself when you close a game. The Start Game dialog offers "Continue from where I left off".<br>
      • <b>Slots 1–9</b>: yours, through <b>Game → Save state / Load state</b> in the game window.<br><br>
      States belong to one emulator version; if a state ever fails to load after an emulator update, your game save is still there.`, { html: true, title: 'About saves and states', ic: 'floppy' });
  }

  // ---------------------------------------------------------------- all games
  async function openSaveData() {
    if (wins.has('savedata')) { focusWin(wins.get('savedata')); return wins.get('savedata').reload(); }
    const body = h(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="toolbar"><button data-a="open" disabled>${icon('floppy')}<span class="lbl">Open</span></button><button data-a="play" disabled>${icon('gamepad')}<span class="lbl">Play</span></button><span class="sep"></span><button data-a="help">${icon('info')}<span class="lbl">About saves</span></button></div>
      <div class="list" tabindex="0"></div>
      <div class="status-bar"><p class="status-bar-field s1"></p><p class="status-bar-field s2"></p></div></div>`);
    const win = createWindow({ id: 'savedata', title: 'Save Data', ic: 'floppy', w: 720, hgt: 460, body });
    let sel = null, rows = [];
    const list = $('.list', body);
    const cur = () => rows.find((r) => r.g.id === sel)?.g;
    body.querySelector('[data-a=open]').onclick = () => openGameSaves(cur());
    body.querySelector('[data-a=play]').onclick = () => ctx.preparePlay(cur());
    body.querySelector('[data-a=help]').onclick = explain;
    async function reload() {
      const sum = await api('/saves').catch(() => ({ games: {} }));
      const games = ctx.games();
      rows = games.map((g) => {
        const e = sum.games[g.id] || { save: null, states: [] };
        const shared = ctx.info().platforms[g.platform]?.engine === 'tst';
        const save = shared ? sum.ps2Cards : e.save;
        const last = Math.max(save?.time || 0, ...e.states.map((s) => s.time));
        return { g, save, shared, states: e.states, auto: e.states.find((s) => s.slot === 'auto'), last };
      }).filter((r) => (r.save && !r.shared) || r.states.length || (r.shared && r.g.lastPlayed)).sort((a, b) => b.last - a.last);
      list.innerHTML = rows.length ? `<table><thead><tr><th>Game</th><th>Console</th><th>Game save</th><th>Save states</th><th>Resume point</th><th>Last saved</th></tr></thead><tbody>${rows.map((r) => `
        <tr data-id="${r.g.id}" class="${r.g.id === sel ? 'sel' : ''}"><td>${icon(platformIcon(r.g.platform))}${esc(r.g.title)}</td><td>${esc(r.g.platformShort)}</td>
        <td>${r.save ? `${icon('floppy')}${fmt(r.save.size)}${r.shared ? ' (shared cards)' : ''}` : '<span class="muted">—</span>'}</td>
        <td>${r.states.filter((s) => s.slot !== 'auto').length || '<span class="muted">—</span>'}</td>
        <td>${r.auto ? esc(ago(r.auto.time)) : '<span class="muted">—</span>'}</td><td>${r.last ? esc(when(r.last)) : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${icon('floppy')}<p>No saves yet.</p><p>Saves appear here as soon as a game saves, or when you close a game (its resume point).</p></div>`;
      list.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.onclick = () => { const again = sel === tr.dataset.id; sel = tr.dataset.id; mark(); if (again && ctx.tapped()) openGameSaves(cur()); };
        tr.ondblclick = () => openGameSaves(cur());
        tr.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); sel = tr.dataset.id; mark();
          showMenu([{ label: 'Open', bold: true, icon: 'floppy', action: () => openGameSaves(cur()) }, { label: 'Play', icon: 'gamepad', action: () => ctx.preparePlay(cur()) }, '-', { label: 'Properties', action: () => ctx.properties(cur()) }], e.clientX, e.clientY); };
      });
      const total = rows.reduce((a, r) => a + (r.shared ? 0 : r.save?.size || 0) + r.states.reduce((x, s) => x + s.size, 0), 0) + (sum.ps2Cards?.size || 0);
      $('.s1', body).textContent = `${rows.length} game(s) with saves`;
      $('.s2', body).textContent = `${fmt(total)} on server`;
      mark();
    }
    function mark() {
      list.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === sel));
      body.querySelector('[data-a=open]').disabled = body.querySelector('[data-a=play]').disabled = !cur();
    }
    win.reload = reload;
    reload();
  }

  return { openGameSaves, openSaveData, explain, saveKind };
}
