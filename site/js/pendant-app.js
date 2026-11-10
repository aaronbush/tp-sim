// ===== tp-sim pendant mode: the on-screen teach pendant driving the 3D arm and the workspace =====
// Classic script, loaded after teach.js. Adds no globals; it plugs into app.js through `pendantHook`
// (same pattern as teach.js's `teachHook`): while the mode is on, app.js's frame loop calls pendantHook.frame()
// instead of playing the simulation, and the arm is posed from the live controller via poseRobot().
// The controller (controller.js) reads and writes programs through the `host` object below, which maps to
// app.js's programs[] and settings, so a program edited on the pendant shows up in the editor and vice versa.
'use strict';
(() => {
  const PLAYBACK = ['playBtn', 'restartBtn', 'prevBtn', 'stepBtn', 'scrub'];
  const ZERO6 = [0, 0, 0, 0, 0, 0];
  const panel = $('pendantPanel'), mount = $('pendantMount'), btn = $('pendantBtn');
  let ctl = null, on = false, status = null, lastSel = '', syncTimer = 0, dataTimer = 0, lastPoll = 0, lastSig = '', lastReadout = '';

  // ---- host: the workspace as the controller sees it ----
  // Pendant edits arrive one step at a time; re-simulating after every one would be wasteful, so the
  // editor/Findings refresh waits until the pendant has been quiet for a moment.
  function syncSoon() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { rerun(true); renderTabs(); updateEditedUI(); saveWorkspaceSoon(); }, 500);
  }
  function dataSoon() {
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => { lastSig = sigOfData(); saveSettings(); updateData(); }, 150);
  }
  const sigOfData = () => JSON.stringify([settings.r, settings.pr, settings.inputs, settings.rCmt, settings.prCmt]);
  const host = {
    listPrograms: () => programs.map(p => p.name),
    getProgram(name) {
      const e = programs.find(p => p.name === name);
      return e ? { name: e.name, header: e.header || '', lines: e.lines.slice(), posText: e.posText || '' } : undefined;
    },
    saveProgram(p) {
      const header = p.header || '', lines = p.lines.slice(), posText = p.posText || '';
      let e = programs.find(x => x.name === p.name);
      if (!e) { e = { name: p.name, header, lines, posText, origLines: null, origPos: null }; programs.push(e); renderTabs(); }
      else {
        if (e.header === header && e.posText === posText && e.lines.join('\n') === lines.join('\n')) return;
        e.header = header; e.lines = lines; e.posText = posText;
      }
      e._prog = null;
      if (programs[active] === e) { edProg.setText(lines.join('\n')); edPos.setText(posText); }   // setText doesn't fire onChange
      syncSoon();
    },
    deleteProgram(name) {
      const i = programs.findIndex(p => p.name === name); if (i < 0) return;
      programs.splice(i, 1);
      if (!programs.length) addEntry(newEntry(), true);
      else if (i === active) selectProgram(Math.min(i, programs.length - 1));
      else { if (i < active) active--; renderTabs(); }
      saveWorkspaceSoon();
    },
    settings,
    // registers, position registers and simulated inputs changed on the pendant: keep and show them (no re-simulation)
    settingsChanged: dataSoon
  };

  // ---- follow the pendant's selected program with the editor tab ----
  function onCtl() {
    status = ctl.screen().status;
    const sel = status.runState === 'ABORTED' ? (status.program || '') : lastSel;   // while running, status.program is the executing one
    if (sel === lastSel) return;
    lastSel = sel;
    const i = programs.findIndex(p => p.name === sel);
    if (i >= 0 && i !== active) selectProgram(i);
  }

  function ensure() {
    if (ctl) return;
    ctl = TPController.create(host);
    TPPendant.mount(mount, ctl, {});
    status = ctl.screen().status; lastSel = status.program || '';   // power-up state: nothing selected, so nothing is auto-selected
    ctl.subscribe(onCtl);
  }

  // ---- mode on / off ----
  function setOn(v, quiet) {
    v = !!v; if (v === on) return;
    if (v) {
      if (teachHook && teachHook.active()) $('teachBtn').click();
      panel.hidden = false;
      ensure();
    }
    on = v;
    document.body.classList.toggle('pendant-mode', on);
    btn.setAttribute('aria-pressed', on);
    if (on) {
      playing = false; updatePlay();
      PLAYBACK.forEach(id => $(id).disabled = true);
      lastReadout = ''; lastSig = sigOfData();
      if (!phoneMQ.matches && !quiet) mount.focus({ preventScroll: true });
    } else {
      panel.hidden = true;
      { const t = !!(teachHook && teachHook.active()); PLAYBACK.forEach(id => $(id).disabled = t); }
      // the controller wrote live register / PR / input values into the settings: show and keep them, then re-simulate once
      saveSettings(); lastRefsKey = ''; rerun(true); paperDirty = true; lastStepShown = -2;
    }
  }
  btn.addEventListener('click', () => { setOn(!on); store.set('pendant', on); });   // remember the choice for next time
  // Teach mode and Pendant mode both own the arm: starting Teach leaves Pendant first
  $('teachBtn').addEventListener('click', () => { if (on) setOn(false); }, true);
  phoneMQ.addEventListener('change', () => { if (phoneMQ.matches) setOn(document.body.dataset.pane === 'pendant'); });

  // ---- per frame: pose the arm from the controller ----
  const rowsOf = (loc, wpr, q) => `<span><span class="k">X</span> ${fmt(loc.p[0])}</span><span><span class="k">Y</span> ${fmt(loc.p[1])}</span><span><span class="k">Z</span> ${fmt(loc.p[2])}</span>
        <span><span class="k">W</span> ${fmt(wpr[0])}</span><span><span class="k">P</span> ${fmt(wpr[1])}</span><span><span class="k">R</span> ${fmt(wpr[2])}</span>
        ${q.map((v, j) => `<span><span class="k">J${j + 1}</span> ${fmt(v)}</span>`).join('')}`;
  pendantHook = {
    active: () => on,
    setOn,
    frame() {
      const r = ctl.robot();
      const f = poseRobot(r.q, r.tool) || fk(r.q, r.tool);
      const now = performance.now();
      if (now - lastPoll > 500) {   // live R / PR / input values written by a running program: save, and refresh the Data panel without rebuilding it under the user's cursor
        lastPoll = now; const sig = sigOfData();
        if (sig !== lastSig) { lastSig = sig; saveSettings(); updateData(); }
      }
      const uf = r.uf || 0, F = frameOf(uf ? (settings.uframes[uf] || ZERO6) : ZERO6);
      const loc = toFrame(F, f.tip, f.R), wpr = rToWpr(loc.R);
      const st = status || {};
      const html = `<div class="cur">PENDANT · ${st.mode || ''} · ${st.coord || ''} jog</div>
        <div class="rows"><span class="k" style="grid-column:1/-1">${uf ? 'User frame ' + uf : 'World'} · tool ${r.ut || 1}</span>${rowsOf(loc, wpr, r.q)}</div>
        <span class="pen ${r.servoOn ? 'down' : 'up'}">SERVO ${r.servoOn ? 'ON' : 'OFF'}</span>`;
      if (html !== lastReadout) { lastReadout = html; $('readout').innerHTML = html; }
    }
  };

  // ---- help: keyboard cheat sheet from the pendant's own key map ----
  (() => {
    const box = $('pendantKeys'); if (!box) return;
    box.innerHTML = TPPendant.keymap.map(m => `<span class="pk"><kbd>${esc(m.key)}</kbd><span>${esc(m.label)}</span></span>`).join('');
  })();
  // The pendant is what the course teaches, so wider screens start in Pendant mode unless it was switched off last time.
  if (!phoneMQ.matches && store.get('pendant', true)) setOn(true, true);
})();
