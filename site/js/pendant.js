// ===== pendant.js: the on-screen hard-key teach pendant (face, screen, switches) =====
// Classic script exposing one global, TPPendant. No dependency on core.js.
//   const h = TPPendant.mount(containerEl, controller, opts);  h.destroy(); h.focus();
//   opts: { latch: true,   // SHIFT and deadman latch on click (false = momentary)
//           cols: 60,      // screen width in characters (default TPController.COLS; rows are clipped, never wrapped)
//           rows: 12,      // body rows shown (default TPController.ROWS)
//           tick: true,    // drive controller.dispatch({type:'tick', dtMs}) from requestAnimationFrame
//           syncSwitches: true }  // only when the controller has no switches(): send tpEnable:true once at mount
// controller: { dispatch(event), screen(), subscribe(fn) -> unsubscribe, switches()? }  (docs/PENDANT.md)
// While a name/comment entry is open (the Alpha input popup), printable keys are sent as {type:'text'} instead of key shortcuts.
// TPPendant.keymap: [{key, label, pendantKey, code}] for the help dialog.
const TPPendant = (() => {
  const SVG_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 13h5v8h6v-8h5z"/></svg>';
  const SVG_ROT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.6 6.4A3.7 3.7 0 1 1 8.2 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.6 1.2 9.6 2.6 8 5.4z" fill="currentColor"/></svg>';
  const IND = [['busy', 'Busy'], ['step', 'Step'], ['hold', 'Hold'], ['fault', 'Fault'], ['run', 'Run'], ['io', 'I/O'], ['prod', 'Prod'], ['tcyc', 'TCyc']];

  // ---- key table: id, grid row, col, [rowspan], label lines, css classes, accessible name ----
  const K = (id, r, c, l1, l2, cls, aria, extra) => Object.assign({ id, r, c, rs: 1, l1, l2: l2 || '', cls: cls || '', aria: aria || (l1 + (l2 ? ' ' + l2 : '')) }, extra);
  const GRID1 = [
    K('PREV', 1, 1, 'PREV', '', 'fn', 'Previous'), K('F1', 1, 2, 'F1', '', 'fn'), K('F2', 1, 3, 'F2', '', 'fn'), K('F3', 1, 4, 'F3', '', 'fn'),
    K('F4', 1, 5, 'F4', '', 'fn'), K('F5', 1, 6, 'F5', '', 'fn'), K('NEXT', 1, 7, 'NEXT', '', 'fn', 'Next page'),
    K('SHIFT', 2, 1, 'SHIFT', '', 'shift latchable', 'Shift (left)', { latch: true }),
    K('MENU', 2, 2, 'MENU'), K('SELECT', 2, 3, 'SELECT'), K('EDIT', 2, 4, 'EDIT'), K('DATA', 2, 5, 'DATA'), K('FCTN', 2, 6, 'FCTN'),
    K('SHIFT', 2, 7, 'SHIFT', '', 'shift latchable', 'Shift (right)', { latch: true, twin: true }),
  ];
  const jogDefs = [];
  [['X', 1, 0], ['Y', 2, 0], ['Z', 3, 0], ['X', 4, 1], ['Y', 5, 1], ['Z', 6, 1]].forEach(([ax, n, rot], i) => ['NEG', 'POS'].forEach((sg, j) => {
    const s = sg === 'NEG' ? '-' : '+';
    jogDefs.push(K('J' + n + '_' + sg, 1 + i, 6 + j, s + ax, '(J' + n + ')', 'jog', `Jog ${sg === 'NEG' ? 'minus' : 'plus'} ${ax}${rot ? ' rotation' : ''}, axis ${n}`, { rot: !!rot }));
  }));
  [7, 8].forEach((n, i) => ['NEG', 'POS'].forEach((sg, j) => jogDefs.push(
    K('J' + n + '_' + sg, 7 + i, 6 + j, sg === 'NEG' ? '-' : '+', '(J' + n + ')', 'jog', `Jog axis ${n} ${sg === 'NEG' ? 'minus' : 'plus'}`))));
  const GRID2 = [
    K('I_KEY', 1, 1, '', '', 'std', 'i key', { ico: '<span class="ico-i" aria-hidden="true">i</span>' }),
    K('LEFT', 1, 2, '', '', 'arrow l span2', 'Left arrow', { rs: 2, ico: SVG_ARROW }),
    K('UP', 1, 3, '', '', 'arrow', 'Up arrow', { ico: SVG_ARROW }),
    K('RIGHT', 1, 4, '', '', 'arrow r span2', 'Right arrow', { rs: 2, ico: SVG_ARROW }),
    K('STEP', 1, 5, 'STEP'),
    K('DISP', 2, 1, 'DISP', '', '', 'Display', { ico: '<span class="ico-disp" aria-hidden="true"></span>' }),
    K('DOWN', 2, 3, '', '', 'arrow d', 'Down arrow', { ico: SVG_ARROW }),
    K('HOLD', 2, 5, 'HOLD'),
    K('RESET', 3, 1, 'RESET'), K('BACKSPACE', 3, 2, 'BACK', 'SPACE', '', 'Back space'), K('ITEM', 3, 3, 'ITEM'), K('ENTER', 3, 4, 'ENTER'), K('FWD', 3, 5, 'FWD', '', '', 'Forward'),
    K('D7', 4, 1, '7', '', 'num'), K('D8', 4, 2, '8', '', 'num'), K('D9', 4, 3, '9', '', 'num'), K('TOOL1', 4, 4, 'TOOL', '1', '', 'Tool 1'), K('BWD', 4, 5, 'BWD', '', '', 'Backward'),
    K('D4', 5, 1, '4', '', 'num'), K('D5', 5, 2, '5', '', 'num'), K('D6', 5, 3, '6', '', 'num'), K('TOOL2', 5, 4, 'TOOL', '2', '', 'Tool 2'), K('COORD', 5, 5, 'COORD'),
    K('D1', 6, 1, '1', '', 'num'), K('D2', 6, 2, '2', '', 'num'), K('D3', 6, 3, '3', '', 'num'), K('MOVE_MENU', 6, 4, 'MOVE', 'MENU', '', 'Move menu'), K('GROUP', 6, 5, 'GROUP'),
    K('D0', 7, 1, '0', '', 'num'), K('DOT', 7, 2, '.', '', 'num', 'Decimal point'),
    // third key of the numeric block: the scans disagree (comma on p059/p060, minus on p187), so it holds both as half keys
    K('SETUP', 7, 4, 'SET', 'UP', '', 'Set up'), K('SPEED_UP', 7, 5, '', '', '', 'Override up (+%)', { ico: '<span class="tri" aria-hidden="true"></span><span class="l2">+%</span>' }),
    K('DIAG_HELP', 8, 1, 'DIAG', 'HELP', '', 'Diagnostic help'), K('POSN', 8, 2, 'POSN'), K('IO', 8, 3, 'I/O', '', '', 'I O'), K('STATUS', 8, 4, 'STATUS'),
    K('SPEED_DOWN', 8, 5, '', '', '', 'Override down (-%)', { ico: '<span class="tri dn" aria-hidden="true"></span><span class="l2">-%</span>' }),
  ].concat(jogDefs);
  const HALVES = [K('MINUS', 0, 0, '-', '', 'num half', 'Minus'), K('COMMA', 0, 0, ',', '', 'num half', 'Comma')];

  // ---- keyboard map (matched by KeyboardEvent.code so Shift and layouts don't matter) ----
  const KM = [];
  const km = (code, key, label, pk) => KM.push({ key, label, pendantKey: pk, code });
  [['ArrowUp', 'Up Arrow', 'UP'], ['ArrowDown', 'Down Arrow', 'DOWN'], ['ArrowLeft', 'Left Arrow', 'LEFT'], ['ArrowRight', 'Right Arrow', 'RIGHT'],
   ['Enter', 'Enter', 'ENTER'], ['Backspace', 'Backspace', 'BACKSPACE'], ['Period', '.', 'DOT'], ['Comma', ',', 'COMMA'], ['Minus', '-', 'MINUS']
  ].forEach(([c, k, p]) => km(c, k, p, p));
  for (let i = 0; i < 10; i++) km('Digit' + i, String(i), String(i), 'D' + i);
  for (let i = 1; i <= 5; i++) km('F' + i, 'F' + i, 'F' + i, 'F' + i);
  km('PageUp', 'Page Up', 'PREV', 'PREV'); km('PageDown', 'Page Down', 'NEXT', 'NEXT');
  km('ShiftLeft', 'Shift (hold)', 'SHIFT', 'SHIFT');
  km('Space', 'Space (hold)', 'DEADMAN (back of pendant)', 'DEADMAN');
  [['Delete', 'Delete', 'RESET'], ['KeyM', 'M', 'MENU'], ['KeyL', 'L', 'SELECT'], ['KeyK', 'K', 'EDIT'], ['KeyJ', 'J', 'DATA'], ['KeyN', 'N', 'FCTN'],
   ['KeyV', 'V', 'DISP'], ['KeyI', 'I', 'i key'], ['KeyO', 'O', 'ITEM'], ['KeyU', 'U', 'STEP'], ['KeyP', 'P', 'HOLD'], ['KeyX', 'X', 'FWD'], ['KeyZ', 'Z', 'BWD'],
   ['KeyC', 'C', 'COORD'], ['KeyB', 'B', 'GROUP'], ['BracketRight', ']', 'SPEED_UP (+%)'], ['BracketLeft', '[', 'SPEED_DOWN (-%)'],
   ['Semicolon', ';', 'TOOL 1'], ['Quote', "'", 'TOOL 2'], ['Backslash', '\\', 'MOVE MENU'], ['Backquote', '`', 'SET UP'], ['Slash', '/', 'I/O'],
   ['Home', 'Home', 'POSN'], ['End', 'End', 'STATUS'], ['Insert', 'Insert', 'DIAG / HELP']
  ].forEach(([c, k, l]) => { const pk = { 'i key': 'I_KEY', 'SPEED_UP (+%)': 'SPEED_UP', 'SPEED_DOWN (-%)': 'SPEED_DOWN', 'TOOL 1': 'TOOL1', 'TOOL 2': 'TOOL2', 'MOVE MENU': 'MOVE_MENU', 'SET UP': 'SETUP', 'I/O': 'IO', 'DIAG / HELP': 'DIAG_HELP' }[l] || l; km(c, k, l, pk); });
  [['KeyQ', 'KeyA', 1], ['KeyW', 'KeyS', 2], ['KeyE', 'KeyD', 3], ['KeyR', 'KeyF', 4], ['KeyT', 'KeyG', 5], ['KeyY', 'KeyH', 6]].forEach(([p, n, a]) => {
    km(p, p[3], '+J' + a + ' jog', `J${a}_POS`); km(n, n[3], '-J' + a + ' jog', `J${a}_NEG`);
  });
  [['F6', 'J7_NEG', '-J7 jog'], ['F7', 'J7_POS', '+J7 jog'], ['F8', 'J8_NEG', '-J8 jog'], ['F9', 'J8_POS', '+J8 jog']].forEach(([c, p, l]) => km(c, c, l, p));
  const ALIAS = { ShiftRight: 'ShiftLeft', NumpadEnter: 'Enter', NumpadDecimal: 'Period', NumpadSubtract: 'Minus' };
  for (let i = 0; i < 10; i++) ALIAS['Numpad' + i] = 'Digit' + i;
  const BY_CODE = {}; KM.forEach(m => { BY_CODE[m.code] = m; });
  Object.keys(ALIAS).forEach(a => { BY_CODE[a] = BY_CODE[ALIAS[a]]; });
  const keymap = KM.map(m => ({ key: m.key, label: m.label, pendantKey: m.pendantKey, code: m.code }));

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function mount(container, controller, opts) {
    const TC = typeof TPController !== 'undefined' ? TPController : {};
    opts = Object.assign({ latch: true, cols: TC.COLS || 60, rows: TC.ROWS || 12, tick: true, syncSwitches: true }, opts || {});
    const root = container;
    root.classList.add('tp-pendant');
    root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Teach pendant. Focus it to use the keyboard.');
    root.textContent = '';
    const send = e => controller.dispatch(e);

    // ---------- build ----------
    const face = h('div', 'tp-face'); root.appendChild(face);
    const top = h('div', 'tp-top');
    const sw = h('button', 'tp-sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', 'true'); sw.setAttribute('aria-label', 'Pendant enable switch, ON or OFF'); sw.dataset.ctl = 'tpenable';
    sw.innerHTML = '<span class="lab off">OFF</span><span class="knob"></span><span class="lab on">ON</span>';
    const cap = h('div', 'tp-cap', 'Teach pendant');
    const es = h('button', 'tp-estop'); es.type = 'button'; es.dataset.ctl = 'estop-pendant'; es.setAttribute('aria-pressed', 'false'); es.setAttribute('aria-label', 'Pendant emergency stop');
    es.innerHTML = '<span class="cap"></span><span class="t">E-STOP</span>';
    top.append(sw, cap, es); face.appendChild(top);

    // screen
    const scr = h('div', 'tp-screen'); scr.setAttribute('role', 'region'); scr.setAttribute('aria-label', 'Pendant screen');
    scr.style.setProperty('--rows', opts.rows);
    const probe = h('span', 'tp-probe', 'M'.repeat(40)); scr.appendChild(probe);
    const status = h('div', 'tp-status');
    const ind = h('div', 'tp-ind'); const indEls = {};
    IND.forEach(([k, t]) => { const s = h('span', '', t); s.dataset.ind = k; ind.appendChild(s); indEls[k] = s; });
    const stext = h('div', 'tp-stext'); const alarmEl = h('div', 'tp-alarm'); const plineEl = h('div', 'tp-pline');
    const pProg = h('span'), pLine = h('span'), pMode = h('span', 'mode'), pRun = h('span'), pCoord = h('span');
    plineEl.append(pProg, pLine, pMode, pRun, pCoord); stext.append(alarmEl, plineEl);
    const speedEl = h('div', 'tp-speed');
    status.append(ind, stext, speedEl);
    const titleEl = h('div', 'tp-title'); const tL = h('span', 'l'), tR = h('span', 'r'); const fbdEl = h('span', 'fbd', 'FBD'); fbdEl.hidden = true; fbdEl.title = 'FWD/BWD are disabled'; titleEl.append(tL, fbdEl, tR);
    const bodyEl = h('div', 'tp-body');
    const popEl = h('div', 'tp-popup'); popEl.hidden = true;
    const promptEl = h('div', 'tp-prompt');
    const skEl = h('div', 'tp-softkeys');
    const gi = h('span'); gi.innerHTML = '<span class="grid-ico"><i></i><i></i><i></i><i></i></span>'; skEl.appendChild(gi);
    const skCells = []; for (let i = 0; i < 5; i++) { const c = h('span', 'sk'); skCells.push(c); skEl.appendChild(c); }
    const more = h('span'); skEl.appendChild(more);
    scr.append(status, titleEl, bodyEl, promptEl, skEl); bodyEl.appendChild(popEl); face.appendChild(scr);

    const els = {}; // key id -> [elements]
    const reg = (id, el) => { (els[id] = els[id] || []).push(el); };
    function makeKey(d) {
      const b = h('button', 'tp-key ' + d.cls); b.type = 'button'; b.tabIndex = -1;
      if (d.twin) b.dataset.twin = d.id; else b.dataset.key = d.id;
      b.setAttribute('aria-label', d.aria);
      if (d.latch) b.setAttribute('aria-pressed', 'false');
      let inner = '';
      if (d.ico) inner += d.ico;
      if (d.l1) inner += '<span class="l1">' + d.l1 + (d.rot ? SVG_ROT : '') + '</span>';
      if (d.l2) inner += '<span class="l2">' + d.l2 + '</span>';
      b.innerHTML = inner;
      if (d.r) b.style.gridArea = `${d.r} / ${d.c} / span ${d.rs} / span 1`;
      reg(d.id, b); bindKey(b, d);
      return b;
    }
    const g1 = h('div', 'tp-grid'); GRID1.forEach(d => g1.appendChild(makeKey(d))); face.appendChild(g1);
    const leds = h('div', 'tp-leds'); leds.innerHTML = '<span class="tp-led on" data-led="power"><i></i>POWER</span><span class="tp-led fault" data-led="fault"><i></i>FAULT</span>';
    face.appendChild(leds);
    const g2 = h('div', 'tp-grid'); GRID2.forEach(d => g2.appendChild(makeKey(d)));
    const pair = h('div', 'tp-key pair'); pair.style.gridArea = '7 / 3 / span 1 / span 1';
    HALVES.forEach(d => pair.appendChild(makeKey(d)));
    g2.appendChild(pair); face.appendChild(g2);

    // ---------- separate strip: not on the pendant face ----------
    const strip = h('section', 'tp-strip'); strip.setAttribute('aria-label', 'Controls that are not on the pendant face');
    strip.innerHTML =
      '<div class="hd">Not on the pendant face</div>' +
      '<div class="grp"><div class="grp-t">Back of pendant <small>deadman switch (hold it while jogging or testing; keyboard: hold Space)</small></div>' +
      '<button type="button" class="dm" data-ctl="deadman" aria-pressed="false" aria-label="Deadman switch, back of pendant">Deadman: released</button></div>' +
      '<div class="grp"><div class="grp-t">Controller panel <small>cabinet controls</small></div>' +
      '<span class="modes" role="group" aria-label="Mode switch"><button type="button" data-ctl="mode-T1" aria-pressed="false">T1</button><button type="button" data-ctl="mode-T2" aria-pressed="false">T2</button><button type="button" data-ctl="mode-AUTO" aria-pressed="false">AUTO</button></span>' +
      '<button type="button" class="cyc" data-ctl="cycle" aria-label="Cycle start">CYCLE START</button>' +
      '<button type="button" class="pe" data-ctl="estop-panel" aria-pressed="false" aria-label="Controller panel emergency stop">Panel E-STOP</button></div>';
    root.appendChild(strip);
    const dmBtn = strip.querySelector('[data-ctl="deadman"]');
    // faint keyboard hints in the corner of each key (opts.hints: false turns them off); keys whose keyboard key is the obvious one get none
    if (opts.hints !== false) {
      const SHORT = { 'Page Up': 'PgUp', 'Page Down': 'PgDn', 'Delete': 'Del', 'Insert': 'Ins', 'Shift (hold)': 'Shift' };
      const SKIP = /^(D[0-9]|F[1-5]|UP|DOWN|LEFT|RIGHT|ENTER|BACKSPACE|DOT|COMMA|MINUS|DEADMAN)$/;
      KM.forEach(m => {
        if (SKIP.test(m.pendantKey)) return;
        root.querySelectorAll('[data-key="' + m.pendantKey + '"],[data-twin="' + m.pendantKey + '"]').forEach(el => {
          if (el.querySelector('.kh')) return;
          const sp = document.createElement('span'); sp.className = 'kh'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = SHORT[m.key] || m.key; el.appendChild(sp);
        });
      });
    }

    // ---------- hold bookkeeping: one keyDown when the first source presses, one keyUp when the last releases ----------
    const holds = new Map(); // name -> Set(sources)
    const isOn = name => !!(holds.get(name) && holds.get(name).size);
    function paint(name) {
      const on = isOn(name);
      if (name === 'DEADMAN') {
        dmBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); dmBtn.textContent = on ? 'Deadman: held' : 'Deadman: released';
        return;
      }
      (els[name] || []).forEach(el => { el.classList.toggle('is-down', on); if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    }
    function setHold(name, src, on) {
      let s = holds.get(name); if (!s) { s = new Set(); holds.set(name, s); }
      const was = s.size > 0;
      if (on) s.add(src); else s.delete(src);
      const now = s.size > 0;
      if (was === now) return;
      paint(name);
      if (name === 'DEADMAN') send({ type: 'deadman', state: now ? 'held' : 'released' });
      else send({ type: now ? 'keyDown' : 'keyUp', key: name });
    }
    const latches = n => opts.latch && (n === 'SHIFT' || n === 'DEADMAN');
    function releaseWhere(pred) { holds.forEach((s, name) => { [...s].filter(pred).forEach(src => setHold(name, src, false)); }); }

    // ---------- pointer input ----------
    function pointerHold(el, name, e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      root.focus({ preventScroll: true });
      if (latches(name)) { setHold(name, 'latch', !(holds.get(name) && holds.get(name).has('latch'))); return; }
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      const src = 'p' + e.pointerId;
      setHold(name, src, true);
      const end = () => { setHold(name, src, false); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); el.removeEventListener('pointerleave', end); el.removeEventListener('lostpointercapture', end); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('pointerleave', end); el.addEventListener('lostpointercapture', end);
    }
    function bindKey(el, d) { el.addEventListener('pointerdown', e => pointerHold(el, d.id, e)); }
    bindDeadman();
    function bindDeadman() { dmBtn.addEventListener('pointerdown', e => pointerHold(dmBtn, 'DEADMAN', e)); }

    // toggles and one-shots
    let estopP = false, estopC = false, tpOn = true;
    function toggleCtl(el, fn) {
      el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); root.focus({ preventScroll: true }); el.dataset.pd = '1'; fn(); });
      el.addEventListener('click', e => { if (el.dataset.pd) { delete el.dataset.pd; return; } fn(); }); // keyboard activation (no preceding pointerdown)
    }
    const setSw = on => { tpOn = on; sw.setAttribute('aria-checked', on ? 'true' : 'false'); };
    toggleCtl(sw, () => { setSw(!tpOn); send({ type: 'tpEnable', on: tpOn }); });
    toggleCtl(es, () => { estopP = !estopP; es.setAttribute('aria-pressed', estopP ? 'true' : 'false'); send({ type: 'estop', source: 'pendant', pressed: estopP }); });
    const pe = strip.querySelector('[data-ctl="estop-panel"]');
    toggleCtl(pe, () => { estopC = !estopC; pe.setAttribute('aria-pressed', estopC ? 'true' : 'false'); send({ type: 'estop', source: 'panel', pressed: estopC }); });
    const modeBtns = {};
    ['T1', 'T2', 'AUTO'].forEach(m => { const b = strip.querySelector(`[data-ctl="mode-${m}"]`); modeBtns[m] = b; toggleCtl(b, () => { setMode(m); send({ type: 'modeSwitch', mode: m }); }); });
    const setMode = m => Object.keys(modeBtns).forEach(k => modeBtns[k].setAttribute('aria-pressed', k === m ? 'true' : 'false'));
    const cyc = strip.querySelector('[data-ctl="cycle"]');
    cyc.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); root.focus({ preventScroll: true }); cyc.dataset.pd = '1'; cyc.classList.add('is-down'); send({ type: 'cycleStart' }); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cyc.addEventListener(t, () => cyc.classList.remove('is-down')));
    cyc.addEventListener('click', () => { if (cyc.dataset.pd) { delete cyc.dataset.pd; return; } send({ type: 'cycleStart' }); });
    root.addEventListener('contextmenu', e => { if (e.target.closest('.tp-key, .tp-sw, .tp-estop, .tp-strip button')) e.preventDefault(); });

    // ---------- keyboard (only while the pendant has focus) ----------
    const kbdHeld = new Map(); // code -> pendant name
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && t.closest && t.closest('[data-ctl]') && (e.key === 'Enter' || e.key === ' ')) return; // let a focused switch button activate
      if (inText() && e.key && e.key.length === 1) { e.preventDefault(); send({ type: 'text', text: e.key }); return; }
      const m = BY_CODE[e.code]; if (!m) return;
      e.preventDefault();
      if (e.repeat || kbdHeld.has(e.code)) return;
      kbdHeld.set(e.code, m.pendantKey);
      setHold(m.pendantKey, 'k:' + e.code, true);
    }
    function onKeyUp(e) {
      const name = kbdHeld.get(e.code); if (!name) return;
      kbdHeld.delete(e.code); e.preventDefault();
      setHold(name, 'k:' + e.code, false);
    }
    const releaseKbd = () => { kbdHeld.forEach((name, code) => setHold(name, 'k:' + code, false)); kbdHeld.clear(); };
    const onFocusOut = e => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) releaseKbd(); };
    root.addEventListener('keydown', onKeyDown); root.addEventListener('keyup', onKeyUp); root.addEventListener('focusout', onFocusOut);
    window.addEventListener('blur', releaseKbd);

    // ---------- screen rendering ----------
    let lastJson = '', lastScreen = null;
    const inText = () => !!(lastScreen && lastScreen.popup && lastScreen.popup.columns && lastScreen.popup.columns[0] && lastScreen.popup.columns[0].title === 'Alpha input 1');
    function render() {
      const s = controller.screen(); if (!s) return;
      const j = JSON.stringify(s); if (j === lastJson) return; lastJson = j;
      const st = s.status || {}, ii = st.indicators || {};
      IND.forEach(([k]) => indEls[k].classList.toggle('on', !!ii[k]));
      leds.querySelector('[data-led="fault"]').classList.toggle('on', !!ii.fault);
      alarmEl.textContent = st.alarm || '';
      pProg.textContent = st.program == null ? '' : st.program; pLine.textContent = 'LINE ' + (st.line == null ? 0 : st.line);
      pMode.textContent = st.mode || ''; pRun.textContent = st.runState || ''; pCoord.textContent = st.coord || '';
      speedEl.textContent = typeof st.speed === 'number' ? st.speed + ' %' : (st.speed || '');
      if (st.mode && modeBtns[st.mode]) setMode(st.mode);
      tL.textContent = s.title || ''; tR.textContent = s.titleRight || ''; fbdEl.hidden = !st.fbd; lastScreen = s;
      bodyEl.querySelectorAll('.row').forEach(r => r.remove());
      (s.body || []).slice(0, opts.rows).forEach(row => {
        const r = h('div', 'row');
        (row || []).forEach(seg => { const sp = h('span', seg.style || '', seg.text); r.appendChild(sp); });
        if (!r.firstChild) r.textContent = '​';
        bodyEl.insertBefore(r, popEl);
      });
      if (s.popup) {
        popEl.textContent = ''; const cur = s.popup.cursor || [0, 0];
        (s.popup.columns || []).forEach((c, ci) => {
          const col = h('div', 'col'); col.appendChild(h('div', 'pt', c.title || ''));
          (c.items || []).forEach((it, ri) => col.appendChild(h('div', 'it' + (ci === cur[0] && ri === cur[1] ? ' cur' : ''), it)));
          popEl.appendChild(col);
        });
        popEl.hidden = false;
        // The Alpha input box must not hide the field being typed: put it just under the cursor row, or above it when there is no room below.
        const alpha = s.popup.columns && s.popup.columns[0] && s.popup.columns[0].title === 'Alpha input 1';
        const rows = [...bodyEl.querySelectorAll('.row')], ci = rows.findIndex(r => r.querySelector('.cursor'));
        popEl.style.top = '';
        if (alpha && ci >= 0) {
          const rh = rows[0].offsetHeight || 1, ph = popEl.offsetHeight, below = (ci + 1) * rh;
          popEl.style.top = (below + ph <= bodyEl.clientHeight ? below + rh * 0.25 : Math.max(0, ci * rh - ph - rh * 0.25)) + 'px';
        }
        scr.classList.toggle('alpha-popup', !!alpha);
      } else { popEl.hidden = true; scr.classList.remove('alpha-popup'); }
      scr.classList.toggle('has-popup', !!s.popup);
      promptEl.textContent = s.prompt || '';
      skCells.forEach((c, i) => { c.textContent = (s.softkeys && s.softkeys[i]) || ''; });
      more.textContent = s.softkeysMore ? '>' : '';
    }

    // fit the fixed-pitch font so `cols` characters exactly fill the screen width
    let ratio = 0;
    function fit() {
      const w = scr.clientWidth; if (!w) return;
      if (!ratio) { const pw = probe.getBoundingClientRect().width; if (pw) ratio = pw / 40 / 100; }
      if (!ratio) return;
      scr.style.setProperty('--fs', (w / (opts.cols * ratio + 1)).toFixed(3) + 'px');
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(scr);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { ratio = 0; fit(); });
    fit();

    // The controller can let go of the deadman itself (it does when another program is chosen): drop our latch to match, sending nothing.
    function syncDeadman() {
      const sw = controller.switches ? controller.switches() : null;
      if (sw && sw.deadman === 'released' && isOn('DEADMAN')) { holds.get('DEADMAN').clear(); paint('DEADMAN'); }
    }
    const unsub = controller.subscribe ? controller.subscribe(() => { syncDeadman(); render(); }) : null;
    render();
    const sws = controller.switches ? controller.switches() : null;
    if (sws) {
      // draw the switches in the controller's own state; nothing is sent
      setSw(!!sws.tpEnable);
      estopP = !!sws.estopPendant; es.setAttribute('aria-pressed', estopP ? 'true' : 'false');
      estopC = !!sws.estopPanel; pe.setAttribute('aria-pressed', estopC ? 'true' : 'false');
      if (sws.mode) setMode(sws.mode);
      if (sws.deadman === 'held' || sws.deadman === 'clenched') { let s = holds.get('DEADMAN'); if (!s) holds.set('DEADMAN', s = new Set()); s.add('latch'); paint('DEADMAN'); }
      if (sws.shift) { let s = holds.get('SHIFT'); if (!s) holds.set('SHIFT', s = new Set()); s.add('latch'); paint('SHIFT'); }
    } else if (opts.syncSwitches !== false) send({ type: 'tpEnable', on: true });

    // ---------- clock ----------
    let raf = 0, last = 0, alive = true;
    function frame(ts) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden || !root.getClientRects().length) { last = 0; return; }
      if (last) { const dt = Math.min(100, ts - last); if (dt > 0) send({ type: 'tick', dtMs: dt }); }
      last = ts;
    }
    if (opts.tick !== false) raf = requestAnimationFrame(frame);

    return {
      focus() { root.focus({ preventScroll: true }); },
      destroy() {
        alive = false; cancelAnimationFrame(raf);
        releaseKbd(); releaseWhere(() => true);
        root.removeEventListener('keydown', onKeyDown); root.removeEventListener('keyup', onKeyUp); root.removeEventListener('focusout', onFocusOut);
        window.removeEventListener('blur', releaseKbd);
        if (ro) ro.disconnect();
        if (typeof unsub === 'function') unsub();
        root.textContent = ''; root.classList.remove('tp-pendant'); root.removeAttribute('tabindex'); root.removeAttribute('role'); root.removeAttribute('aria-label');
      },
    };
  }

  return { mount, keymap };
})();
