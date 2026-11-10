// ===== tp-sim controller: live teach-pendant state machine (no DOM) =====
// Classic script (shares the page's global scope with core.js) and a Node module for the tests.
// Exposes one global, TPController. Pendant behaviour follows the course-manual notes; anything the
// notes don't settle is marked "unverified:" and listed under Open questions in docs/PENDANT.md.
'use strict';
const TPController = (() => {
  // core.js names are globals in the browser; in Node they come from require().
  const C = typeof parseLS === 'function'
    ? { parseLS, makeProgram, parseLine, parsePositions, toLS, formatPosition, runSim, fk, ik, wprToR, rToWpr,
        frameOf, toWorld, toFrame, poseToV6, HOME, ROBOT, add, sub, scl, matMul, matT, col, I3, D2R, defaultHeader }
    : require('./core.js');

  // ---------- constants ----------
  const ROWS = 12, COLS = 60;            // fixed body size, from the manual's screen transcriptions
  const MODES = ['T1', 'T2', 'AUTO'];
  const COORDS = ['JOINT', 'JGFRM', 'WORLD', 'TOOL', 'USER'];   // unverified: COORD cycle order
  const SPEEDS = ['VFINE', 'FINE', 1, 2, 3, 4, 5];               // unverified: +%/-% steps below 5%
  for (let v = 10; v <= 100; v += 5) SPEEDS.push(v);
  const SHIFT_SPEEDS = ['VFINE', 'FINE', 5, 50, 100];            // manual: SHIFT + +%/-% steps
  const T1_CAP = 250;                    // mm/sec, T1 mode limit (manual)
  const JOG_LIN = 250, JOG_ROT = 30, JOG_JOINT = 30;             // unverified: jog rates at 100% (mm/s, deg/s)
  const INC = { FINE: { lin: 0.1, ang: 0.01 }, VFINE: { lin: 0.01, ang: 0.001 } };   // unverified: incremental jog steps
  const NA = 'Not available in the trainer';
  const DEFAULT_MOTIONS = ['J P[] 100% FINE', 'J P[] 100% CNT100', 'L P[] 100mm/sec FINE', 'L P[] 100mm/sec CNT100'];
  const DIGIT = { D0: '0', D1: '1', D2: '2', D3: '3', D4: '4', D5: '5', D6: '6', D7: '7', D8: '8', D9: '9', DOT: '.', MINUS: '-', COMMA: ',' };
  const JOGKEY = /^J([1-8])_(NEG|POS)$/;
  const ALARM = {
    E_PANEL: 'SRVO-001 Operator panel E-stop',      // unverified: alarm text (manual gives none)
    E_TP: 'SRVO-002 Teach pendant E-stop',          // unverified
    DEADMAN: 'SRVO-003 Deadman switch released',    // unverified
    REACH: 'MOTN-018 Position not reachable',       // unverified
    TP_OFF: 'SYST-043 TP disabled in T1/T2 mode',   // manual (alarm history figure)
    DM_AUTO: 'SYST-042 DEADMAN defeated',           // manual
    TP_AUTO: 'Teach Pendant Enabled in AUTO',       // manual text; unverified: alarm code not legible
    LOCKED: 'PROG-040 Already locked by other task' // manual
  };
  const ROBOT_IO = 8;                    // unverified: number of RI/RO shown
  const DIGITAL_IO = 512;                // manual figure (1/512)

  // ---------- small helpers ----------
  const S = (text, style) => (style ? { text, style } : { text });
  const padL = (s, n) => String(s).padStart(n), padR = (s, n) => String(s).padEnd(n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt3 = v => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3);
  const numText = v => { if (typeof v !== 'number') return String(v); if (Number.isInteger(v)) return String(v); return String(+v.toFixed(6)); };
  const cleanLine = l => String(l || '').replace(/^\s*\d+:\s?/, '').replace(/\s*;\s*$/, '').trim();
  const posBlockRe = n => new RegExp(`P\\[${n}(?::[^\\]]*)?\\]\\s*\\{[\\s\\S]*?\\};\\n?`);
  const axisRot = (k, a) => {     // rotation of a degrees about unit axis k (as teach.js)
    const c = Math.cos(a * C.D2R), s = Math.sin(a * C.D2R), v = 1 - c, [x, y, z] = k;
    return [[c + x * x * v, x * y * v - z * s, x * z * v + y * s], [y * x * v + z * s, c + y * y * v, y * z * v - x * s], [z * x * v - y * s, z * y * v + x * s, c + z * z * v]];
  };
  function normRows(rows) {
    const out = [];
    for (let i = 0; i < ROWS; i++) {
      let r = rows[i] || [];
      if (typeof r === 'string') r = [S(r)];
      const segs = []; let n = 0;
      for (const sg of r) {
        if (n >= COLS) break;
        const t = String(sg.text).slice(0, COLS - n);
        if (!t.length) continue;
        segs.push(sg.style ? { text: t, style: sg.style } : { text: t }); n += t.length;
      }
      if (n < COLS) segs.push(S(' '.repeat(COLS - n)));
      out.push(segs);
    }
    return out;
  }
  // Motion line text <-> parts
  function splitMotion(text) {
    const m = String(text).match(/^([JLCA])\s+((?:P|PR)\[[^\]]*\])\s*(.*)$/i); if (!m) return null;
    const o = { mt: m[1].toUpperCase(), via: null, pos: m[2], speed: '', term: '', opts: '' };
    let rest = m[3];
    if (o.mt === 'C') { const m2 = rest.match(/^((?:P|PR)\[[^\]]*\])\s*(.*)$/i); if (m2) { o.via = o.pos; o.pos = m2[1]; rest = m2[2]; } }
    const sm = rest.match(/^((?:R\[[^\]]*\]|\d*\.?\d+)\s*(?:%|mm\/sec|cm\/min|inch\/min|deg\/sec|msec|sec)|max_speed)\s*(.*)$/i);
    if (sm) { o.speed = sm[1]; rest = sm[2]; }
    const tm = rest.match(/^(FINE|CNT\s*(?:\d+|R\[[^\]]*\])|CR\s*\d*)\s*(.*)$/i);
    if (tm) { o.term = tm[1]; rest = tm[2]; }
    o.opts = rest.trim();
    return o;
  }
  const joinMotion = m => [m.mt, m.via, m.pos, m.speed, m.term, m.opts].filter(Boolean).join(' ');
  const refNum = r => { const m = String(r || '').match(/^(P|PR)\[(\d+)/i); return m ? { kind: m[1].toUpperCase(), n: +m[2] } : null; };

  // ---------- INST templates: {slot} markers; menu slots expand to sub-templates ----------
  function parseTpl(s) {
    const out = [], re = /\{(\w+)\}/g; let last = 0, m;
    while ((m = re.exec(s))) { if (m.index > last) out.push({ lit: s.slice(last, m.index) }); out.push({ slot: m[1], val: null, sub: null }); last = re.lastIndex; }
    if (last < s.length) out.push({ lit: s.slice(last) });
    return out;
  }
  const LEAF = { i: 1, n: 1, t: 1, p: 1, rem: 1, pct: 1 };
  const renderTpl = toks => toks.map(t => t.lit != null ? t.lit : t.sub ? renderTpl(t.sub) : t.val != null ? t.val : '...').join('');
  function tplFields(toks, parent, acc) {   // leaf slots in display order (unfilled menu slots count as a field)
    acc = acc || [];
    for (const t of toks) {
      if (t.lit != null) continue;
      if (!LEAF[t.slot] && t.sub) tplFields(t.sub, t, acc); else acc.push({ tok: t, parent });
    }
    return acc;
  }
  const subHead = t => (t && t.sub && t.sub[0] && t.sub[0].lit) || '';
  const isBitIO = h => /^(DI|DO|RI|RO|UI|UO|SI|SO|F)\[/.test(h);
  const it = (label, tpl) => ({ label, tpl });
  function slotMenu(kind, toks) {
    const find = name => toks.find(t => t.slot === name);
    switch (kind) {
      case 'lhs': return { title: 'REGISTER statement', pages: [[it('R[ ]', 'R[{i}]'), it('PR[ ]', 'PR[{i}]'), it('PR[i,j]', 'PR[{i},{i}]'), it('SR[ ]', null)]] };
      case 'val': {
        const lhs = subHead(find('lhs'));
        if (lhs === 'PR[' && find('lhs').sub.length === 3)   // whole PR: position values
          return { title: 'REGISTER statement', pages: [[it('LPOS', 'LPOS'), it('JPOS', 'JPOS'), it('PR[ ]', 'PR[{i}]'), it('P[ ]', 'P[{i}]'), it('UFRAME[ ]', null), it('UTOOL[ ]', null)]] };
        return { title: 'REGISTER statement', next: 8, pages: [
          [it('R[ ]', 'R[{i}]'), it('Constant', '{n}'), it('DO[ ]', 'DO[{i}]'), it('DI[ ]', 'DI[{i}]'), it('RO[ ]', 'RO[{i}]'), it('RI[ ]', 'RI[{i}]'), it('GO[ ]', 'GO[{i}]')],
          [it('GI[ ]', 'GI[{i}]'), it('AO[ ]', 'AO[{i}]'), it('AI[ ]', 'AI[{i}]'), it('PR[i,j]', 'PR[{i},{i}]')]] };   // unverified: page 2 contents
      }
      case 'iov': return { title: 'I/O statement', pages: [[it('On', 'ON'), it('Off', 'OFF'), it('Pulse (,width)', 'PULSE')]] };
      case 'gval': case 'nv0': return { title: 'I/O statement', pages: [[it('R[ ]', 'R[{i}]'), it('Constant', '{n}')]] };
      case 'cv': return { title: 'IF statement', pages: [[it('R[ ]', 'R[{i}]'), it('DI[ ]', 'DI[{i}]'), it('DO[ ]', 'DO[{i}]'), it('RI[ ]', 'RI[{i}]'), it('RO[ ]', 'RO[{i}]'), it('GI[ ]', 'GI[{i}]'), it('GO[ ]', 'GO[{i}]')]] };   // unverified: list
      case 'cval': {
        const h = subHead(find('cv'));
        if (isBitIO(h)) return { title: 'IF statement', pages: [[it('On', 'ON'), it('Off', 'OFF'), it('R[ ]', 'R[{i}]')]] };
        return { title: 'IF statement', pages: [[it('R[ ]', 'R[{i}]'), it('Constant', '{n}')]] };
      }
      case 'op': return { title: 'IF statement', pages: [[it('=', '='), it('<>', '<>'), it('<', '<'), it('>', '>'), it('<=', '<='), it('>=', '>=')]] };
      case 'act': return { title: 'IF statement', pages: [[it('JMP LBL[ ]', 'JMP LBL[{i}]'), it('CALL program', 'CALL {p}'), it('CALL program()', null), it('AND', null), it('OR', null)]] };
      case 'nv': return { title: 'Offset/Frames', pages: [[it('R[ ]', 'R[{i}]'), it('Constant', '{n}'), it('AR[ ]', 'AR[{i}]')]] };
      case 'tv': return { title: 'Wait statements', pages: [[it('Constant', '{t}'), it('R[ ]', 'R[{i}]')]] };   // unverified
    }
    return null;
  }
  const INST = {
    title: 'Instruction', next: 8, pages: [
      [it('Registers', 'M:reg'), it('I/O', 'M:io'), it('IF/SELECT', 'M:if'), it('WAIT', 'M:wait'), it('JMP/LBL', 'M:jmp'), it('CALL', 'M:call'), it('Miscellaneous', 'M:misc')],
      [it('Skip', null), it('Payload', null), it('Offset/Frames', 'M:frames'), it('Multiple control', null), it('Program control', null), it('MACRO', null), it('FOR/ENDFOR', null)],
      []]   // page 3/3 is illegible in the manual
  };
  const INST_SUB = {
    reg: { title: 'REGISTER statement', next: 8, pages: [[it('...=...', '{lhs}={val}'), it('...=...+...', '{lhs}={val}+{val}'), it('...=...-...', '{lhs}={val}-{val}'),
      it('...=...*...', '{lhs}={val}*{val}'), it('...=.../...', '{lhs}={val}/{val}'), it('...=...DIV...', '{lhs}={val} DIV {val}'), it('...=...MOD...', '{lhs}={val} MOD {val}')],
      [it('...=(...)', null)]] },   // unverified: order of the arithmetic templates
    io: { title: 'I/O statement', next: 8, pages: [[it('DO[ ]=...', 'DO[{i}]={iov}'), it('R[ ]=DI[ ]', 'R[{i}]=DI[{i}]'), it('RO[ ]=...', 'RO[{i}]={iov}'), it('R[ ]=RI[ ]', 'R[{i}]=RI[{i}]'),
      it('GO[ ]=...', 'GO[{i}]={gval}'), it('R[ ]=GI[ ]', 'R[{i}]=GI[{i}]'), it('AO[ ]=...', 'AO[{i}]={gval}')], [it('R[ ]=AI[ ]', 'R[{i}]=AI[{i}]')]] },
    if: { title: 'IF statement', next: 8, pages: [[it('IF ...=...', 'IF {cv}={cval},{act}'), it('IF ...<>...', 'IF {cv}<>{cval},{act}'), it('IF ...>...', 'IF {cv}>{cval},{act}'),
      it('IF ...<...', 'IF {cv}<{cval},{act}'), it('IF ...>=...', 'IF {cv}>={cval},{act}'), it('IF ...<=...', 'IF {cv}<={cval},{act}'), it('IF (...)', null)],
      [it('IF (...) THEN', 'IF ({cv}{op}{cval}) THEN'), it('ELSE', 'ELSE'), it('ENDIF', 'ENDIF'), it('SELECT R[ ]=...', 'SELECT R[{i}]={n},{act}'), it('<select> =...', '={n},{act}'), it('<select> ELSE', 'ELSE,{act}')]] },
    wait: { title: 'Wait statements', pages: [[it('WAIT ...(sec)', 'WAIT {tv}(sec)'), it('WAIT ...=...', 'WAIT {cv}={cval}')]] },
    jmp: { title: 'JMP/LBL statement', pages: [[it('JMP LBL[ ]', 'JMP LBL[{i}]'), it('LBL[ ]', 'LBL[{i}]')]] },
    call: { title: 'CALL statement', pages: [[it('CALL program', 'CALL {p}')]] },
    misc: { title: 'Miscellaneous statements', next: 8, pages: [[it('RSR[ ]', null), it('UALM[ ]', null), it('TIMER[ ]', null), it('OVERRIDE', 'OVERRIDE={pct}%'), it('Remark', '!{rem}'), it('Message', null), it('Parameter name', null)], []] },
    frames: { title: 'Offset/Frames', pages: [[it('OFFSET CONDITION', 'OFFSET CONDITION PR[{i}]'), it('UFRAME_NUM=...', 'UFRAME_NUM={nv}'), it('UTOOL_NUM=...', 'UTOOL_NUM={nv}'),
      it('UFRAME[ ]=...', 'UFRAME[{i}]=PR[{i}]'), it('UTOOL[ ]=...', 'UTOOL[{i}]=PR[{i}]')]] }
  };

  // ---------- popup menu widget ----------
  // spec: { title, pages: [[{label, num?, fly?, act?, tpl?, blank?}]], next?: number (auto-numbered lists),
  //         titleFmt?(page, pages), onPick(item), softkeys?, prompt?, fkey?(n) }
  class Menu {
    constructor(spec) {
      this.spec = spec; this.page = 0; this.row = 0; this.focus = 0; this.frow = 0;
      this.pages = spec.pages.map((items, pi) => {
        if (spec.next == null) return items.map((x, i) => ({ num: x.num !== undefined ? x.num : i + 1, ...x }));
        const out = items.map((x, i) => ({ num: i + 1, ...x }));
        if (spec.pages.length > 1) out.push({ num: spec.next, label: '--next page--', act: 'next' });
        return out;
      });
      this.firstRow();
    }
    items() { return this.pages[this.page] || []; }
    firstRow() { const its = this.items(); this.row = Math.max(0, its.findIndex(x => !x.blank)); }
    move(d) {
      const its = this.items(); if (!its.length) return;
      let r = this.row;
      for (let k = 0; k < its.length; k++) { r = (r + d + its.length) % its.length; if (!its[r].blank) break; }
      this.row = r;
    }
    title() {
      const n = this.pages.length;
      return this.spec.titleFmt ? this.spec.titleFmt(this.page + 1, n) : `${this.spec.title} ${this.page + 1}/${n}`;
    }
    label(x) { return x.blank ? (x.num != null ? `${x.num}` : '') : `${x.num != null ? x.num + ' ' : '  '}${x.label}${x.fly ? '  >' : ''}`; }
    render() {
      const its = this.items();
      const cols = [{ title: this.title(), items: its.map(x => this.label(x)) }];
      const cur = its[this.row];
      if (cur && cur.fly) cols.push({ title: cur.label, items: cur.fly.map(x => this.label(x)) });
      return { columns: cols, cursor: this.focus ? [1, this.frow] : [0, this.row] };
    }
    pick(x) {
      if (!x || x.blank) return;
      if (x.act === 'next') { this.page = (this.page + 1) % this.pages.length; this.firstRow(); return; }
      if (x.fly && this.focus === 0) { if (!x.fly.length) return this.spec.onPick({ ...x, tpl: null, fly: null }); this.focus = 1; this.frow = 0; return; }
      this.spec.onPick(x);
    }
    key(k) {
      const its = this.items();
      if (this.focus) {
        const fly = its[this.row].fly;
        if (k === 'UP') this.frow = (this.frow - 1 + fly.length) % fly.length;
        else if (k === 'DOWN') this.frow = (this.frow + 1) % fly.length;
        else if (k === 'LEFT' || k === 'PREV') this.focus = 0;
        else if (k === 'ENTER') this.spec.onPick(fly[this.frow]);
        else if (DIGIT[k] && /\d/.test(DIGIT[k])) { const f = fly.find(x => x.num === +DIGIT[k]); if (f) this.spec.onPick(f); }
        return true;
      }
      if (k === 'UP') this.move(-1);
      else if (k === 'DOWN') this.move(1);
      else if (k === 'RIGHT') { const x = its[this.row]; if (x && x.fly) this.pick(x); }
      else if (k === 'ENTER') this.pick(its[this.row]);
      else if (DIGIT[k] && /\d/.test(DIGIT[k])) { const i = its.findIndex(x => x.num === +DIGIT[k] && !x.blank); if (i >= 0) { this.row = i; this.pick(its[i]); } }
      else if (/^F[1-5]$/.test(k) && this.spec.fkey) this.spec.fkey(+k[1]);
      else if (k === 'PREV') return false;   // controller closes it
      return true;
    }
  }

  // ---------- the controller ----------
  class Ctl {
    constructor(host) {
      this.host = host || {};
      this.subs = new Set();
      this.powerUp();
    }
    get settings() {
      const s = this.host.settings || (this.host.settings = {});
      if (!s.r) s.r = {}; if (!s.pr) s.pr = {}; if (!s.inputs) s.inputs = {};
      return s;
    }
    powerUp() {
      this.mode = this.mode || 'T1'; this.tpOn = !!this.tpOn; this.deadman = this.deadman || 'released';
      this.estop = this.estop || { pendant: false, panel: false };
      this.shift = false; this.down = new Set();
      this.alarms = []; this.hist = [];
      this.coord = 'JOINT'; this.speedIdx = SPEEDS.indexOf(10);   // manual figure after power-up: JOINT, 10 %
      this.q = this.q || C.HOME.slice(); this.uf = 0; this.ut = 1; this.jf = 1;
      this.stepMode = false; this.fbd = false;
      this.selected = null; this.cursors = {};
      this.run = { state: 'ABORTED' }; this.execProg = null; this.execLine = 0;
      this.defaults = DEFAULT_MOTIONS.slice(); this.defIdx = 0;
      this.out = {}; this.simIO = new Set(Object.keys(this.settings.inputs).filter(k => this.settings.inputs[k] && this.settings.inputs[k].v != null));
      this.cache = {}; this.undo = {}; this.clip = null; this.showCmt = true;
      this.jog = null; this.moveTo = null;
      this.history = []; this.stack = [new InfoScreen(this, 'UTILITIES Hints')];   // manual figure: power-up screen title
      this.popup = null; this.text = null; this.num = null; this.confirm = null; this.msg = '';
      this.ioView = { kind: 'D', dir: 'out' }; this.dataType = 'R';
      this.checkSwitches(true);
    }

    // ----- alarms -----
    raise(text, level, cond) {
      this.alarms = this.alarms.filter(a => a.text !== text);
      this.alarms.push({ text, level, cond });
      this.hist.push(text);
      if (level !== 'warn') { this.pause(); this.jog = null; this.moveTo = null; }
    }
    hasFault() { return this.alarms.some(a => a.level !== 'warn'); }
    servoOn() { return !this.alarms.some(a => a.level === 'servo') && !this.estop.pendant && !this.estop.panel; }
    reset() {
      this.alarms = this.alarms.filter(a => a.cond && a.cond());
      this.hist.push('R E S E T');
      if (this.run.state === 'PAUSED' && this.run.held) this.run.held = false;
    }
    // Raise the faults that follow from the switch positions (power-up, mode change, TP switch)
    checkSwitches(init) {
      const tpOff = () => !this.tpOn && this.mode !== 'AUTO';
      if (tpOff()) this.raise(ALARM.TP_OFF, 'servo', tpOff);   // unverified: raised at power-up too
      if (this.tpOn && this.mode === 'AUTO') this.raise(ALARM.TP_AUTO, 'servo', () => this.tpOn && this.mode === 'AUTO');
      if (!init && this.tpOn && this.mode !== 'AUTO' && this.deadman !== 'held') this.raiseDeadman();
    }
    raiseDeadman() { this.raise(ALARM.DEADMAN, 'servo', () => this.tpOn && this.mode !== 'AUTO' && this.deadman !== 'held'); }
    // Manual motion / TP test run allowed?
    tpMotionOK() { return this.mode !== 'AUTO' && this.tpOn && this.deadman === 'held' && !this.hasFault() && this.servoOn(); }

    // ----- public API -----
    subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    dispatch(ev) {
      if (!ev || !ev.type) return;
      const idleTick = ev.type === 'tick' && !this.jog && !this.moveTo && this.run.state !== 'RUNNING';
      if (idleTick) return;
      const before = this.sig();
      switch (ev.type) {
        case 'keyDown': this.keyDown(ev.key); break;
        case 'keyUp': this.keyUp(ev.key); break;
        case 'tpEnable': this.setTP(!!ev.on); break;
        case 'deadman': this.setDeadman(ev.state); break;
        case 'estop': this.setEstop(ev.source, !!ev.pressed); break;
        case 'modeSwitch': this.setMode(ev.mode); break;
        case 'cycleStart': this.cycleStart(); break;
        case 'tick': this.tick(Math.max(0, +ev.dtMs || 0)); break;
        case 'text': if (this.text) this.text.typeText(String(ev.text || '')); break;
      }
      if (this.sig() !== before) for (const fn of [...this.subs]) { try { fn(); } catch (e) { /* listener errors don't stop the controller */ } }
    }
    sig() { return JSON.stringify(this.screen()) + '|' + this.q.map(v => v.toFixed(4)).join(',') + '|' + this.servoOn(); }
    switches() { return { tpEnable: this.tpOn, deadman: this.deadman, estopPendant: this.estop.pendant, estopPanel: this.estop.panel, mode: this.mode, shift: this.shift }; }
    toolVec(n) { const t = (this.settings.tools || {})[n]; return t || (n === 1 ? [0, 0, 100, 0, 0, 0] : [0, 0, 0, 0, 0, 0]); }
    tool(n) { const v = this.toolVec(n == null ? this.ut : n); return { p: v.slice(0, 3), R: C.wprToR(v[3], v[4], v[5]) }; }
    ufVec(n) { return n ? ((this.settings.uframes || {})[n] || [0, 0, 0, 0, 0, 0]) : [0, 0, 0, 0, 0, 0]; }
    robot() {
      return { q: this.q.slice(), tool: this.tool(), moving: !!(this.jog && this.jog.moving) || !!this.moveTo || (this.run.state === 'RUNNING' && !this.run.waiting),
        servoOn: this.servoOn(), uf: this.uf, ut: this.ut };
    }
    speedVal() { return SPEEDS[this.speedIdx]; }
    ovr() { const v = this.speedVal(); return typeof v === 'number' ? v / 100 : 0.01; }   // unverified: FINE/VFINE run as 1 %
    statusLine() {
      const running = this.run.state !== 'ABORTED';
      const program = running ? this.execProg : this.selected;
      const line = running ? this.execLine : (this.selected ? Math.min(this.cursorOf(this.selected).line, this.lineCount(this.selected)) : 0);
      const top = this.alarms[this.alarms.length - 1];
      return {
        indicators: { busy: this.run.state === 'RUNNING' || !!this.jog || !!this.moveTo, step: this.stepMode, hold: !!this.run.held,
          fault: this.hasFault(), run: this.run.state === 'RUNNING', io: false, prod: false, tcyc: false },
        alarm: top ? top.text : '', program: program || '', line: line || 0, mode: this.mode, runState: this.run.state,
        coord: this.coord, speed: this.speedVal(), fbd: this.fbd && this.tpOn
      };
    }
    screen() {
      const s = this.top();
      const ov = this.text || this.confirm;
      let softkeys = ov ? ov.softkeys() : (this.popup && this.popup.spec && this.popup.spec.softkeys) || (this.popup && this.popup.softkeys) || s.softkeys();
      softkeys = [0, 1, 2, 3, 4].map(i => softkeys[i] || '');
      const prompt = this.msg || (this.text && this.text.prompt) || (this.num && this.num.prompt) || (this.confirm && this.confirm.prompt) ||
        (this.popup && ((this.popup.spec && this.popup.spec.prompt) || this.popup.prompt)) || (s.prompt ? s.prompt() : '') || '';
      const popup = this.text ? this.text.renderPopup() : this.popup ? this.popup.render() : null;
      return { status: this.statusLine(), title: s.title(), titleRight: s.titleRight ? s.titleRight() : '', body: normRows(s.body()),
        prompt, softkeys, softkeysMore: !ov && !this.popup && !!(s.more && s.more()), popup };
    }

    // ----- screen stack -----
    top() { return this.stack[this.stack.length - 1]; }
    open(scr) { this.closeOverlays(); this.history.push(this.top()); if (this.history.length > 20) this.history.shift(); this.stack = [scr]; if (scr.onOpen) scr.onOpen(); }
    back() { if (this.history.length) this.stack = [this.history.pop()]; }
    closeOverlays() { this.popup = null; if (this.text) this.text.cancel(); this.text = null; if (this.num) this.num.cancel(); this.num = null; this.confirm = null; }
    na(title) { this.open(new InfoScreen(this, title || 'Not available')); }
    showMenu(spec) { this.popup = new Menu(spec); }
    ask(prompt, yes, no) { this.confirm = { prompt, softkeys: () => ['', '', '', 'YES', 'NO'], yes, no }; }
    startNum(o) { this.num = { buf: o.init || '', prompt: o.prompt || 'Enter value', target: o.target, done: o.done, cancel: o.cancel || (() => {}) }; }
    startText(o) { this.text = new TextEntry(this, o); }
    canEdit() {
      if (!this.tpOn) { this.msg = 'Teach pendant is disabled'; return false; }   // unverified: prompt text (manual: OFF = background edit only)
      if (this.run.state === 'RUNNING') { this.msg = 'Program is running'; return false; }   // unverified: prompt text
      return true;
    }

    // ----- switches -----
    setTP(on) {
      if (on === this.tpOn) return;
      this.tpOn = on;
      if (!on) { this.jog = null; this.moveTo = null; if (this.mode !== 'AUTO') this.pause(); }
      else if (this.mode === 'AUTO') this.pause();
      this.checkSwitches();
    }
    setDeadman(state) {
      if (!['released', 'held', 'clenched'].includes(state)) return;
      const was = this.deadman; this.deadman = state;
      if (was === 'held' && state !== 'held' && this.tpOn && this.mode !== 'AUTO') this.raiseDeadman();
    }
    setEstop(source, pressed) {
      if (source === 'panel') this.estop.panel = pressed; else this.estop.pendant = pressed;
      if (pressed) {
        if (source === 'panel') this.raise(ALARM.E_PANEL, 'servo', () => this.estop.panel);
        else this.raise(ALARM.E_TP, 'servo', () => this.estop.pendant);
      }
    }
    setMode(mode) {
      if (!MODES.includes(mode) || mode === this.mode) return;
      this.mode = mode; this.pause(); this.jog = null; this.moveTo = null;
      this.raise(`SYST-039 Operation mode ${mode} Selected`, 'warn');   // unverified: code 039 is legible only for T2
      if (mode === 'AUTO' && this.deadman === 'held') this.raise(ALARM.DM_AUTO, 'servo', () => this.deadman === 'held');
      this.checkSwitches();
    }

    // ----- keys -----
    keyDown(k) {
      if (k === 'SHIFT') { this.shift = true; return; }
      this.down.add(k);
      if (JOGKEY.test(k)) return this.jogDown(k);
      if (k === 'FWD' || k === 'BWD') { if (this.shift) this.runKey(k === 'FWD' ? 'fwd' : 'bwd'); return; }
      if (k === 'HOLD') { this.hold(); return; }
      if (k === 'RESET') { this.reset(); return; }
      if (k === 'STEP') { this.stepMode = !this.stepMode; if (this.run.sim) this.run.dirty = true; return; }
      if (k === 'SPEED_UP' || k === 'SPEED_DOWN') { this.speedKey(k === 'SPEED_UP'); return; }
      if (k === 'COORD') {
        if (this.shift) { this.closeOverlays(); this.popup = new JogMenu(this); }
        else if (this.popup instanceof JogMenu) this.popup = null;
        else this.coord = COORDS[(COORDS.indexOf(this.coord) + 1) % COORDS.length];
        return;
      }
      this.msg = '';
      if (this.text) { if (this.text.key(k)) return; }
      if (this.num && this.numKey(k)) return;
      if (this.confirm) {
        if (k === 'F4') { const c = this.confirm; this.confirm = null; c.yes && c.yes(); return; }
        if (k === 'F5' || k === 'PREV') { const c = this.confirm; this.confirm = null; c.no && c.no(); return; }
        if (!this.hardKey(k, true)) { const t = this.top(); if (t.selKey && t.selKey(k)) return; }
        return;
      }
      if (this.popup && !this.isHard(k)) {
        if (this.popup.key(k) !== false) return;
        this.popup = null; return;   // PREV closes the popup
      }
      if (this.hardKey(k)) return;
      if (k === 'PREV') { const t = this.top(); if (t.prev && t.prev()) return; this.back(); return; }
      if (k === 'NEXT') { const t = this.top(); if (t.next) t.next(); return; }
      this.top().key(k, this.shift);
    }
    isHard(k) { return ['MENU', 'FCTN', 'SELECT', 'EDIT', 'DATA', 'POSN', 'IO', 'SETUP', 'STATUS', 'TOOL1', 'TOOL2', 'MOVE_MENU', 'DIAG_HELP', 'DISP'].includes(k); }
    hardKey(k, probeOnly) {
      if (!this.isHard(k)) return false;
      if (probeOnly) this.confirm = null;
      if (k === 'MENU') { const was = this.popup && this.popup.spec && this.popup.spec.id === 'menu'; this.closeOverlays(); if (!was) this.showMenu(menuSpec(this)); return true; }
      if (k === 'FCTN') { const was = this.popup && this.popup.spec && this.popup.spec.id === 'fctn'; this.closeOverlays(); if (!was) this.showMenu(fctnSpec(this)); return true; }
      if (k === 'DISP') { this.closeOverlays(); if (this.shift) this.showMenu(dispSpec(this)); return true; }
      switch (k) {
        case 'SELECT': this.open(new SelectScreen(this)); break;
        case 'EDIT': if (this.selected && this.loadProg(this.selected)) this.open(new EditScreen(this, this.selected)); else this.open(new SelectScreen(this)); break;   // unverified: EDIT with no program selected
        case 'DATA': this.open(new DataScreen(this, this.dataType)); break;
        case 'POSN': this.open(new PosnScreen(this)); break;
        case 'IO': this.open(new IOScreen(this)); break;
        case 'SETUP': this.na('SETUP'); break;
        case 'STATUS': this.na('STATUS'); break;
        case 'TOOL1': this.na('TOOL 1'); break;
        case 'TOOL2': this.na('TOOL 2'); break;
        case 'MOVE_MENU': this.na('MOVE MENU'); break;   // manual: not supported for HandlingTool
        case 'DIAG_HELP': this.na('HELP'); break;
      }
      return true;
    }
    keyUp(k) {
      if (k === 'SHIFT') {
        this.shift = false; this.jog = null; this.moveTo = null;
        if (this.run.state === 'RUNNING' && this.run.byTP) this.pause();   // releasing SHIFT pauses a TP test run
        return;
      }
      this.down.delete(k);
      if (this.jog && this.jog.key === k) this.jog = null;
    }
    numKey(k) {
      const n = this.num;
      if (DIGIT[k]) {
        const ch = DIGIT[k];
        if (ch === '-') n.buf = n.buf.startsWith('-') ? n.buf.slice(1) : '-' + n.buf;
        else if (ch === '.' ) { if (!n.buf.includes('.')) n.buf += '.'; }
        else if (ch !== ',') n.buf += ch;
        return true;
      }
      if (k === 'BACKSPACE') { n.buf = n.buf.slice(0, -1); return true; }
      if (k === 'ENTER') { this.num = null; if (n.buf === '' || n.buf === '-' || n.buf === '.') n.cancel(); else n.done(n.buf); return true; }
      if (k === 'PREV') { this.num = null; n.cancel(); return true; }
      this.num = null; n.cancel(); return false;   // other keys cancel the entry and act normally
    }
    speedKey(up) {
      const cur = this.speedVal();
      if (this.shift) {
        const rank = v => typeof v === 'number' ? v : v === 'FINE' ? 0.5 : 0.1, r = rank(cur);
        const nv = up ? (SHIFT_SPEEDS.find(v => rank(v) > r + 1e-9) ?? 100) : ([...SHIFT_SPEEDS].reverse().find(v => rank(v) < r - 1e-9) ?? 'VFINE');
        this.speedIdx = SPEEDS.indexOf(nv);
      } else this.speedIdx = clamp(this.speedIdx + (up ? 1 : -1), 0, SPEEDS.length - 1);
    }

    // ----- jogging -----
    jogDown(k) {
      const m = k.match(JOGKEY), axis = +m[1] - 1, sign = m[2] === 'POS' ? 1 : -1;
      if (this.mode === 'AUTO') return;
      if (!this.tpOn) { this.raise(ALARM.TP_OFF, 'servo', () => !this.tpOn && this.mode !== 'AUTO'); return; }
      if (this.estop.pendant || this.estop.panel) return;
      if (this.deadman !== 'held') { this.raiseDeadman(); return; }
      if (this.hasFault() || !this.shift || this.run.state === 'RUNNING') return;   // unverified: no message for a jog key without SHIFT
      if (axis > 5) return;   // J7/J8: no extended axes on this arm
      const v = this.speedVal();
      if (typeof v !== 'number') {   // FINE / VFINE: one increment per press
        const inc = INC[v];
        this.jogStep(axis, sign * (this.coord === 'JOINT' || axis > 2 ? inc.ang : inc.lin));
        this.markMoved();
        return;
      }
      this.jog = { key: k, axis, sign, moving: false };
    }
    markMoved() { if (this.run.sim) this.run.dirty = true; }
    jogStep(axis, d) {
      if (this.coord === 'JOINT') { this.q = this.q.slice(); this.q[axis] += d; return true; }
      const tool = this.tool(), f = C.fk(this.q, tool);
      const R = this.coord === 'WORLD' ? C.I3 : this.coord === 'USER' ? C.frameOf(this.ufVec(this.uf)).R
        : this.coord === 'TOOL' ? f.R : C.frameOf(((this.settings.jogframes || {})[this.jf]) || [0, 0, 0, 0, 0, 0]).R;
      const ax = C.col(R, axis % 3);
      const p = axis < 3 ? C.add(f.tip, C.scl(ax, d)) : f.tip, Rt = axis < 3 ? f.R : C.matMul(axisRot(ax, d), f.R);
      const s = C.ik(p, Rt, tool, this.q);
      if (!s.reach) { this.raise(ALARM.REACH, 'stop'); return false; }
      this.q = s.q; return true;
    }
    tickJog(dt) {
      const j = this.jog;
      if (!this.tpMotionOK() || !this.shift) { this.jog = null; return; }
      const rate = (this.coord === 'JOINT' ? JOG_JOINT : j.axis < 3 ? JOG_LIN : JOG_ROT) * this.ovr();
      let total = rate * dt * j.sign;
      const maxStep = this.coord === 'JOINT' || j.axis > 2 ? 1 : 5;
      while (Math.abs(total) > 1e-12 && this.jog) {
        const d = Math.sign(total) * Math.min(Math.abs(total), maxStep);
        if (!this.jogStep(j.axis, d)) break;
        total -= d; j.moving = true;
      }
      this.markMoved();
    }
    tickMoveTo(dt) {
      const m = this.moveTo;
      if (!this.tpMotionOK() || !this.shift) { this.moveTo = null; return; }
      const dq = m.q.map((v, i) => v - this.q[i]), far = Math.max(...dq.map(Math.abs));
      if (far < 1e-6) { this.moveTo = null; return; }
      const stepDeg = JOG_JOINT * this.ovr() * dt * 2, f = Math.min(1, stepDeg / far);   // unverified: MOVE_TO speed
      this.q = this.q.map((v, i) => v + dq[i] * f);
      this.markMoved();
      if (f >= 1) this.moveTo = null;
    }
    tick(ms) {
      let left = ms / 1000;
      while (left > 1e-9) {
        const dt = Math.min(left, 0.05); left -= dt;
        if (this.jog) this.tickJog(dt);
        if (this.moveTo) this.tickMoveTo(dt);
        if (this.run.state === 'RUNNING') this.tickRun(dt);
      }
    }

    // ----- programs -----
    lineCount(name) { const e = this.loadProg(name); return e ? e.lines.length : 0; }
    cursorOf(name) { return this.cursors[name] || (this.cursors[name] = { line: 1, col: 0 }); }
    loadProg(name) {
      if (!name || !this.host.getProgram) return null;
      const src = this.host.getProgram(name);
      if (!src) { delete this.cache[name]; return null; }
      const sig = JSON.stringify([src.header, src.lines, src.posText]);
      const c = this.cache[name];
      if (c && c.sig === sig) return c;
      const e = { name: src.name || name, header: src.header || '', posText: src.posText || '', lines: (src.lines || []).map(t => ({ text: cleanLine(t), tpl: null })), sig };
      this.cache[name] = e;
      return e;
    }
    texts(e) { return e.lines.map(l => (l.tpl ? renderTpl(l.tpl) : l.text)); }
    saveProg(e) {
      const prog = { name: e.name, header: e.header, lines: this.texts(e), posText: e.posText };
      if (this.host.saveProgram) this.host.saveProgram(prog);
      e.sig = JSON.stringify([prog.header, prog.lines, prog.posText]);
      this.cache[e.name] = e;
      if (this.run.sim) this.run.dirty = true;
    }
    snapshotUndo(e) { this.undo[e.name] = { header: e.header, posText: e.posText, lines: e.lines.map(l => ({ text: l.tpl ? renderTpl(l.tpl) : l.text, tpl: null })) }; }
    parsed(name) { const e = this.loadProg(name); return e ? C.makeProgram(e.name, e.header, this.texts(e), e.posText) : null; }
    allParsed() { return (this.host.listPrograms ? this.host.listPrograms() : []).map(n => this.parsed(n)).filter(Boolean); }
    commentOf(name) { const e = this.loadProg(name); const m = e && e.header.match(/COMMENT\s*=\s*"([^"]*)"/); return m ? m[1] : ''; }
    nextP(e) {
      let n = 0;
      Object.keys(C.parsePositions(e.posText)).forEach(k => { n = Math.max(n, +k); });
      this.texts(e).forEach(l => { const re = /\bP\[(\d+)/g; let m; while ((m = re.exec(l))) n = Math.max(n, +m[1]); });
      return n + 1;
    }
    // Drop /POS blocks no line refers to any more (the controller deletes unused position data)
    cleanPositions(e) {
      const used = new Set(); this.texts(e).forEach(l => { const re = /\bP\[(\d+)/g; let m; while ((m = re.exec(l))) used.add(+m[1]); });
      for (const k of Object.keys(C.parsePositions(e.posText))) if (!used.has(+k)) e.posText = e.posText.replace(posBlockRe(k), '');
      e.posText = e.posText.replace(/\n{2,}/g, '\n').trim();
    }
    setPosBlock(e, n, v6, uf, ut, keepCmt) {
      const old = C.parsePositions(e.posText)[n];
      const block = C.formatPosition(n, v6, uf, ut, keepCmt && old ? old.cmt : '');
      const re = new RegExp(`P\\[${n}(?::[^\\]]*)?\\]\\s*\\{[\\s\\S]*?\\};`);
      e.posText = re.test(e.posText) ? e.posText.replace(re, block) : (e.posText.trim() ? e.posText.trimEnd() + '\n' : '') + block;
    }
    // Current tool pose in a user frame, as [x,y,z,w,p,r]
    poseIn(uf, ut) {
      const f = C.fk(this.q, this.tool(ut)), loc = C.toFrame(C.frameOf(this.ufVec(uf)), f.tip, f.R);
      return C.poseToV6(loc.p, loc.R);
    }
    atPosition(e, ref) {   // the "@" position indicator
      const r = refNum(ref); if (!r) return false;
      if (r.kind === 'P') {
        const P = C.parsePositions(e.posText)[r.n]; if (!P) return false;
        if (P.joints) return P.joints.every((v, i) => Math.abs(v - this.q[i]) < 0.01);
        const w = C.toWorld(C.frameOf(this.ufVec(P.uf)), P.cart.slice(0, 3), C.wprToR(P.cart[3], P.cart[4], P.cart[5]));
        const f = C.fk(this.q, this.tool(P.ut));
        return Math.hypot(...C.sub(w.p, f.tip)) < 0.1 && w.R.every((row, i) => row.every((v, j) => Math.abs(v - f.R[i][j]) < 1e-3));
      }
      const pr = this.settings.pr[r.n]; if (!pr) return false;
      if (pr.type === 'joint') return pr.v.every((v, i) => Math.abs(v - this.q[i]) < 0.01);
      const v6 = this.poseIn(this.uf, this.ut);
      return v6.slice(0, 3).every((v, i) => Math.abs(v - pr.v[i]) < 0.1);
    }
    selectProgram(name) { this.selected = name; }
    // R[ ] and PR[ ] are shown with the comment set on the DATA screens, e.g. PR[1:HOME]; a comment written in the line is kept when the register has none
    named(text) {
      const s = this.settings;
      return text.replace(/\b(PR|R)\[(\d+)((?:,\d+)?)(?::[^\]]*)?\]/g, (all, k, n, el) => { const cm = ((k === 'R' ? s.rCmt : s.prCmt) || {})[n]; return cm ? `${k}[${n}${el}:${cm}]` : all; });
    }
    // Choosing a different program on the pendant: start at line 1, and let go of the deadman so the
    // student has to grip it again on purpose before anything moves.
    switchProgram(name) {
      if (name !== this.selected) { this.cursorOf(name).line = 1; this.cursorOf(name).col = 0; this.setDeadman('released'); }   // unverified: trainer safety choice, not pendant behaviour
      this.selectProgram(name);
    }

    // ----- registers / I/O -----
    inputsLive() {
      const out = {};
      for (const k of Object.keys(this.settings.inputs)) out[k] = { v: this.simIO.has(k) ? (+this.settings.inputs[k].v || 0) : 0 };
      return out;
    }
    ioValue(key) {
      if (/^(DI|RI)\[/.test(key)) { const d = this.settings.inputs[key]; return this.simIO.has(key) && d ? (+d.v ? 1 : 0) : 0; }
      return this.out[key] ? 1 : 0;
    }
    setIO(key, on) {
      if (/^(DI|RI)\[/.test(key)) { const d = this.settings.inputs[key] || (this.settings.inputs[key] = {}); d.v = on ? 1 : 0; delete d.at; delete d.to; }
      else this.out[key] = on ? 1 : 0;
      this.ioChanged();
    }
    setSim(key, on) {
      if (on) { this.simIO.add(key); if (/^(DI|RI)\[/.test(key) && !this.settings.inputs[key]) this.settings.inputs[key] = { v: 0 }; }
      else { this.simIO.delete(key); if (/^(DI|RI)\[/.test(key) && this.settings.inputs[key]) this.settings.inputs[key].v = 0; }
      this.ioChanged();
    }
    ioChanged() {
      if (this.host.settingsChanged) this.host.settingsChanged();
      if (!this.run.sim) return;
      this.run.dirty = true;   // a running program picks the change up at its next line
      if (this.run.state === 'RUNNING' && this.run.waiting) this.resim(this.run.waitAt.prog, this.run.waitAt.line);
    }
    regChanged() { if (this.host.settingsChanged) this.host.settingsChanged(); if (this.run.sim) this.run.dirty = true; }

    // ----- program execution: a player over core.js runSim results -----
    hold() { if (this.run.state === 'RUNNING') { this.pause(); this.run.held = true; } }
    pause() { if (this.run.state === 'RUNNING') { this.run.state = 'PAUSED'; this.run.go = null; this.run.waiting = false; } }
    abortAll() { this.run = { state: 'ABORTED' }; }
    cycleStart() {
      if (this.mode !== 'AUTO' || this.tpOn || this.hasFault() || !this.servoOn() || !this.selected) return;
      if (this.run.state === 'RUNNING') return;
      this.startRun('cont', false);
    }
    runKey(dir) {
      if (this.mode === 'AUTO' || !this.tpOn || this.fbd) return;
      if (this.deadman !== 'held') { this.raiseDeadman(); return; }
      if (this.hasFault() || !this.servoOn() || !this.selected || this.run.state === 'RUNNING') return;
      if (dir === 'bwd') return this.startBwd();
      this.startRun(this.stepMode ? 'step' : 'cont', true);
    }
    // Where a paused run would carry on: the line in progress, else the next line
    resumePoint() {
      const r = this.run, st = r.sim.steps;
      if (r.cur >= 0 && st[r.cur]) return { prog: st[r.cur].prog, line: st[r.cur].line };
      if (st[r.next]) return { prog: st[r.next].prog, line: st[r.next].line };
      return r.sim.resume ? { prog: r.sim.resume.prog, line: r.sim.resume.line } : null;
    }
    startRun(mode, byTP) {
      const r = this.run;
      if (r.state === 'PAUSED' && r.sim) {
        if (this.selected !== r.root) {   // another program selected while one is paused
          this.raise(ALARM.LOCKED, 'stop');
          this.raise(`INTP-105 (${this.selected}, ${this.cursorOf(this.selected).line}) Run request failed`, 'stop');
          return;
        }
        let at = this.resumePoint();
        const cur = this.cursorOf(this.execProg || r.root);
        if (r.cursorMoved && cur && at && cur.line === at.line) r.cursorMoved = false;   // moved away and back: nothing to confirm
        if (r.cursorMoved && cur) {
          if (!r.cursorOK) {   // unverified: prompt wording, and that NO leaves everything as it was
            this.ask(`Paused at line ${at ? at.line : '?'}. Run from line ${cur.line} instead?`, () => { if (this.run === r) r.cursorOK = true; this.msg = 'Press SHIFT+FWD to run from the cursor line'; });
            return;
          }
          at = { prog: this.execProg || r.root, line: cur.line }; r.dirty = true;
        }
        if (!at) { this.abortAll(); return; }
        if (r.dirty) { if (!this.resim(at.prog, at.line, mode, byTP)) return; }
        else { r.state = 'RUNNING'; r.held = false; r.cursorMoved = false; }
        this.run.go = mode; this.run.byTP = byTP; this.run.stepDone = false;
        return;
      }
      const name = this.selected, line = this.cursorOf(name).line;
      if (line > this.lineCount(name)) return;   // cursor on [End]
      if (!this.resim(name, line, mode, byTP, true)) return;
    }
    // (Re)simulate from a program line with the live state and start playing it
    resim(prog, line, mode, byTP, fresh) {
      const prev = this.run;
      const s = this.settings;
      const st = { ...s, inputs: this.inputsLive(), start: this.q.slice(), startLine: line, startUf: this.uf, startUt: this.ut,
        outInit: { ...this.out }, forceFine: this.stepMode && !!(byTP != null ? byTP : prev.byTP),   // STEP test: every termination runs as FINE
        maxTime: 600 };
      const sim = C.runSim(prog, this.allParsed(), st);
      if (!sim || sim.error) { this.msg = sim && sim.error ? sim.error : 'Program not found'; return false; }
      this.run = { state: 'RUNNING', sim, root: fresh ? prog : (prev.root || prog), cur: -1, next: 0, t: 0, i: 0,
        go: mode || prev.go || 'cont', byTP: byTP != null ? byTP : prev.byTP, dirty: false, held: false, cursorMoved: false, waiting: false };
      this.execProg = prog; this.execLine = line;
      return true;
    }
    applyStep(sp) {
      const sn = this.run.sim.snaps[sp.snap];
      if (sn) {
        const s = this.settings;
        for (const k in sn.R) s.r[k] = sn.R[k];
        for (const k in sn.PR) if (!sn.PR[k].assumed) s.pr[k] = { type: sn.PR[k].type, v: sn.PR[k].v.slice() };
        this.out = { ...sn.out }; this.uf = sn.uf; this.ut = sn.ut;
      }
      this.execProg = sp.prog; this.execLine = sp.line;
      const c = this.cursors[sp.prog]; if (c) { c.line = sp.line; c.col = 0; }   // cursor follows execution
    }
    segUnreachable(sp) {
      const sim = this.run.sim, sg = sim.segs[sp.seg]; if (!sg) return false;
      if (sg.reach === false) return true;
      for (let i = sg.iStart; i <= sg.iEnd; i++) if (sim.T.reach[i] === false) return true;
      return false;
    }
    poseAt(t) {
      const T = this.run.sim.T; if (!T.t.length) return;
      let i = clamp(this.run.i || 0, 0, T.t.length - 1);
      while (i > 0 && T.t[i] > t) i--;
      while (i < T.t.length - 1 && T.t[i + 1] <= t) i++;
      this.run.i = i;
      const j = Math.min(i + 1, T.t.length - 1), span = T.t[j] - T.t[i], f = span > 0 ? clamp((t - T.t[i]) / span, 0, 1) : 0;
      this.q = T.q[i].map((v, k) => v + (T.q[j][k] - v) * f);
    }
    // Advance sim time toward tLimit using up to dt real seconds; returns real time left over
    advance(dt, tLimit, dir) {
      const T = this.run.sim.T, r = this.run, N = T.t.length;
      while (dt > 1e-12) {
        if (dir > 0 ? r.t >= tLimit - 1e-12 : r.t <= tLimit + 1e-12) { r.t = tLimit; break; }
        this.poseAt(r.t);
        let i = r.i;
        if (dir < 0) while (i > 0 && T.t[i] >= r.t - 1e-12) i--;
        const j = i + 1;
        if (j >= N) { r.t = tLimit; break; }
        const span = T.t[j] - T.t[i];
        const edge = dir > 0 ? Math.min(T.t[j], tLimit) : Math.max(T.t[i], tLimit);
        if (span <= 1e-12) { r.t = edge; if (dir < 0 && i === 0) { r.t = tLimit; } continue; }
        const v = Math.hypot(...C.sub(T.p[j], T.p[i])) / span;
        let rate = T.kind[j] === 'W' ? 1 : this.ovr();   // a WAIT lasts its own time; motion scales with the override
        if (this.mode === 'T1' && v * rate > T1_CAP) rate = T1_CAP / v;   // T1: 250 mm/sec or less
        rate = Math.max(rate, 1e-4);
        const need = Math.abs(edge - r.t) / rate;
        if (need <= dt) { r.t = edge; dt -= need; } else { r.t += dir * dt * rate; dt = 0; }
      }
      this.poseAt(r.t);
      return dt;
    }
    tickRun(dt) {
      let r = this.run;
      if (r.waiting) return;
      if (r.byTP && (!this.tpMotionOK() || !this.shift)) { this.pause(); return; }
      if (!r.byTP && (this.hasFault() || !this.servoOn() || this.tpOn || this.mode !== 'AUTO')) { this.pause(); return; }
      if (r.go === 'bwd') {
        const left = this.advance(dt, r.bwdT, -1);
        if (r.t <= r.bwdT + 1e-9) {
          const sp = r.sim.steps[r.bwdStep];
          r.cur = -1; r.next = r.bwdStep + 1; this.applyStep(sp);
          r.state = 'PAUSED'; r.go = null;
        }
        void left; return;
      }
      let steps = r.sim.steps;
      let guard = 0;
      while (dt > 1e-12 || guard === 0) {
        if (++guard > 100000) break;
        if (r.cur >= 0) {
          const sp = steps[r.cur];
          if (r.t < sp.tEnd - 1e-9) { dt = this.advance(dt, sp.tEnd, 1); if (r.t < sp.tEnd - 1e-9) return; }
          r.cur = -1;
          if (r.go === 'step') { r.state = 'PAUSED'; r.go = null; return; }
          continue;
        }
        if (r.dirty && steps[r.next]) {   // program, registers or I/O changed: re-simulate from this line with the live state
          const at = steps[r.next];
          if (!this.resim(at.prog, at.line)) { this.pause(); return; }
          r = this.run; steps = r.sim.steps; continue;
        }
        if (r.next >= steps.length) { this.finishRun(); return; }
        const sp = steps[r.next], last = r.next === steps.length - 1;
        if (last && r.sim.stopReason === 'wait') {   // WAIT whose condition isn't true: sit here until the I/O changes
          this.applyStep(sp); r.waiting = true; r.waitAt = { prog: sp.prog, line: sp.line }; return;
        }
        if (last && r.sim.stopReason === 'error') {
          this.applyStep(sp);
          const is = r.sim.issues.filter(x => x.sev === 'bad' && x.line === sp.line).pop();
          r.cur = -1; r.next = steps.length; r.dirty = true;   // stays at the failing line; a restart runs it again
          this.raise(`(${sp.prog}, ${sp.line}) ${is ? (is.detail || is.title) : 'Program stopped'}`, 'stop');   // unverified: no INTP code
          return;
        }
        if (sp.kind === 'move' && this.segUnreachable(sp)) { this.applyStep(sp); this.raise(ALARM.REACH, 'stop'); return; }
        r.cur = r.next++; this.applyStep(sp);
        if (r.t < sp.t) r.t = sp.t;
        if (dt <= 1e-12 && sp.tEnd > sp.t) return;
      }
    }
    finishRun() {
      const r = this.run, sim = r.sim;
      if (['steps', 'time', 'moves'].includes(sim.stopReason) && sim.resume) {   // long loop: keep going from where the run was cut off
        const go = r.go, byTP = r.byTP, root = r.root;
        if (this.resim(sim.resume.prog, sim.resume.line, go, byTP)) this.run.root = root;
        return;
      }
      if (sim.stopReason === 'end' && r.root) { const c = this.cursorOf(r.root); c.line = 1; c.col = 0; }   // unverified: running through [End] puts the cursor back on line 1
      this.run = { state: 'ABORTED' };
    }
    startBwd() {
      const r = this.run;
      if (!(r.state === 'PAUSED' && r.sim) || r.dirty) return;   // unverified: BWD only walks back over the paused run's path
      const st = r.sim.steps, eps = 1e-6;
      let j = -1;
      for (let i = 0; i < st.length; i++) if (st[i].kind === 'move' && st[i].t <= r.t - eps) j = i;
      if (j < 0) return;
      let m = -1;
      for (let i = 0; i < j; i++) if (st[i].kind === 'move') m = i;
      if (m < 0) return;
      r.state = 'RUNNING'; r.go = 'bwd'; r.byTP = true; r.bwdT = st[m].tEnd; r.bwdStep = m;
    }
    releaseWait() {
      const r = this.run;
      if (r.state === 'RUNNING' && r.waiting) this.resim(r.waitAt.prog, r.waitAt.line + 1);
    }
  }

  // ---------- text entry (program names, comments) ----------
  const ALPHA = { upper: ['ABCDEF', 'GHIJKL', 'MNOPQR', 'STUVWX', 'YZ_@'], lower: ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz_@'] };
  const WORDS = ['RSR', 'PNS', 'STYLE', 'JOB', 'TEST'];   // unverified: preformed words
  const MODES_ALPHA = ['Words', 'Upper Case', 'Lower Case', 'Options/Keybd'];
  class TextEntry {
    constructor(ctl, o) {
      this.ctl = ctl; this.o = o; this.buf = o.init || ''; this.pos = this.buf.length; this.mode = 1;
      this.prompt = o.prompt || ''; this.tap = null; this.over = false;
    }
    cancel() { if (this.o.cancel) this.o.cancel(); }
    softkeys() {
      if (this.mode === 0) return WORDS;
      if (this.mode === 3) return ['OVRSTRK', 'INSERT', 'CLEAR', 'SPACE', 'KEYBOARD'];
      return ALPHA[this.mode === 1 ? 'upper' : 'lower'];
    }
    renderPopup() { return { columns: [{ title: 'Alpha input 1', items: MODES_ALPHA }], cursor: [0, this.mode] }; }
    segments(width) {
      const b = this.buf, p = this.pos;
      return [S(b.slice(0, p)), S(b[p] || ' ', 'cursor'), S(b.slice(p + 1).padEnd(Math.max(0, (width || 0) - b.length - 1)))];
    }
    put(ch) {
      if (this.buf.length >= (this.o.max || 36) && !(this.over && this.pos < this.buf.length)) return false;
      if (this.over && this.pos < this.buf.length) this.buf = this.buf.slice(0, this.pos) + ch + this.buf.slice(this.pos + 1);
      else this.buf = this.buf.slice(0, this.pos) + ch + this.buf.slice(this.pos);
      return true;
    }
    typeText(s) { for (const ch of s) { this.tap = null; if (this.put(ch)) this.pos++; } }
    key(k) {
      if (k === 'UP') { this.mode = (this.mode + 3) % 4; this.tap = null; return true; }
      if (k === 'DOWN') { this.mode = (this.mode + 1) % 4; this.tap = null; return true; }
      if (k === 'LEFT') { this.tap = null; this.pos = Math.max(0, this.pos - 1); return true; }
      if (k === 'RIGHT') { this.tap = null; this.pos = Math.min(this.buf.length, this.pos + 1); return true; }
      if (k === 'BACKSPACE') { this.tap = null; if (this.pos > 0) { this.buf = this.buf.slice(0, this.pos - 1) + this.buf.slice(this.pos); this.pos--; } return true; }
      if (k === 'ENTER') { const t = this.ctl.text; this.ctl.text = null; if (this.o.done(this.buf) === false) this.ctl.text = t; return true; }
      if (k === 'PREV') { this.ctl.text = null; this.cancel(); return true; }
      if (DIGIT[k]) { this.typeText(DIGIT[k]); return true; }
      const f = /^F([1-5])$/.exec(k); if (!f) return !this.ctl.isHard(k) && k !== 'NEXT' ? true : (this.ctl.text = null, this.cancel(), false);
      const n = +f[1] - 1;
      if (this.mode === 0) { this.typeText(WORDS[n]); return true; }
      if (this.mode === 3) {
        if (n === 0) this.over = true; else if (n === 1) this.over = false;
        else if (n === 2) { this.buf = ''; this.pos = 0; } else if (n === 3) this.typeText(' ');
        else this.ctl.msg = 'Type on the keyboard';   // KEYBOARD: the pendant UI forwards typing as {type:'text'}
        return true;
      }
      // unverified: multi-tap letter entry - repeated presses of a group key cycle its letters; another key moves on
      const g = ALPHA[this.mode === 1 ? 'upper' : 'lower'][n];
      if (this.tap && this.tap.n === n && this.pos === this.tap.pos + 1) {
        this.tap.i = (this.tap.i + 1) % g.length;
        this.buf = this.buf.slice(0, this.tap.pos) + g[this.tap.i] + this.buf.slice(this.tap.pos + 1);
      } else if (this.put(g[0])) { this.tap = { n, i: 0, pos: this.pos }; this.pos++; }
      return true;
    }
  }
  const validName = s => /^[A-Za-z][A-Za-z0-9_]{0,35}$/.test(s);   // manual: letter first, no @ * or spaces, max 36

  // ---------- jog menu (SHIFT + COORD) ----------
  class JogMenu {
    constructor(ctl) { this.ctl = ctl; this.row = 0; this.prompt = 'Jog Coordinate System (press and hold to set)'; this.softkeys = ['JOINT', 'JGFRM', 'WORLD', 'TOOL', 'USER']; }
    render() {
      const c = this.ctl, n = c.num && c.num.target === 'jog' + this.row ? c.num.buf : null;
      const vals = [c.ut, c.jf, c.uf].map((v, i) => (i === this.row && n != null ? n + '_' : String(v)));
      return { columns: [{ title: '', items: [`Tool (.=10)  ${vals[0]}`, `Jog          ${vals[1]}`, `User         ${vals[2]}`] }], cursor: [0, this.row] };
    }
    key(k) {
      const c = this.ctl;
      if (k === 'UP') this.row = (this.row + 2) % 3;
      else if (k === 'DOWN') this.row = (this.row + 1) % 3;
      else if (/^F[1-5]$/.test(k)) c.coord = COORDS[+k[1] - 1];
      else if (k === 'PREV' || k === 'ENTER') return false;
      else if (DIGIT[k]) {
        const row = this.row;
        if (row === 0 && k === 'DOT') { c.ut = 10; return true; }
        c.startNum({ init: DIGIT[k] === '.' ? '' : DIGIT[k], target: 'jog' + row, prompt: 'Enter value',
          done: v => { const n = Math.round(+v); if (!(n >= 0 && n <= 10)) return; if (row === 0) { if (n >= 1) c.ut = n; } else if (row === 1) { if (n >= 1) c.jf = n; } else c.uf = n; } });
      }
      return true;
    }
  }

  // ---------- menus ----------
  const naItems = labels => labels.map((l, i) => (l == null ? { blank: true, num: i + 1 } : { label: l, num: i + 1, act: 'na' }));
  function menuSpec(ctl) {
    const io = [{ label: 'Cell Intface', act: 'na' }, { label: 'Custom', act: 'na' }, { label: 'Digital', act: 'io:D' }, { label: 'Analog', act: 'na' },
      { label: 'Group', act: 'na' }, { label: 'Robot', act: 'io:R' }, { label: 'UOP', act: 'na' }, { label: 'SOP', act: 'na' }, { label: 'Interconnect', act: 'na' }].map((x, i) => ({ ...x, num: i + 1 }));
    const page1 = [
      { num: 1, label: 'UTILITIES', fly: naItems(['Home', 'Hints', 'iRCalibration', 'Robot Condition', 'Prog Adjust', 'Program Shift', 'Mirror Image Shift', 'Tool Offset', 'Frame Offset']) },
      { num: 2, label: 'TEST CYCLE', act: 'na' }, { num: 3, label: 'MANUAL FCTNS', act: 'na' },
      { num: 4, label: 'ALARM', fly: [{ num: 1, label: 'Alarm Log', act: 'alarm' }, ...naItems([null, 'Motion Log', 'System Log', 'Appl Log', 'Comm Log']).slice(1)] },
      { num: 5, label: 'I/O', fly: io },
      { num: 6, label: 'SETUP', fly: [{ num: null, label: 'Frames', act: 'na' }] },   // only Frames is confirmed by the manual
      { num: 7, label: 'FILE', fly: [] },   // contents not in the manual
      { num: 8, blank: true }, { num: 9, label: 'USER', act: 'na' }, { num: 0, label: '-- NEXT --', act: 'next' }];
    const page2 = [   // unverified: only the two items the manual names, positions unknown
      { num: null, label: 'STATUS', fly: [{ num: null, label: 'Version ID', act: 'na' }] },
      { num: null, label: '4D Graphics', fly: [{ num: null, label: 'Position Display', act: 'posn' }] },
      { num: 0, label: '-- NEXT --', act: 'next' }];
    return { id: 'menu', titleFmt: p => `MENU   ${p}`, pages: [page1, page2], onPick: x => {
      const a = x.act;
      if (a === 'alarm') ctl.open(new AlarmScreen(ctl));
      else if (a === 'posn') ctl.open(new PosnScreen(ctl));
      else if (a && a.startsWith('io:')) { ctl.ioView = { kind: a[3], dir: ctl.ioView.dir }; ctl.open(new IOScreen(ctl)); }
      else ctl.na(x.label);
    } };
  }
  function fctnSpec(ctl) {
    const b = n => ({ num: n, blank: true });
    const page1 = [{ num: 1, label: 'ABORT (ALL)', act: 'abort' }, { num: 2, label: 'Disable FWD/BWD', act: 'fbd' }, b(3), { num: 4, label: 'WRIST JOG', act: 'na' },
      b(5), b(6), { num: 7, label: 'RELEASE WAIT', act: 'rwait' }, b(8), b(9), { num: 0, label: '-- NEXT --', act: 'next' }];
    const page2 = [{ num: 1, label: 'QUICK/FULL MENUS', act: 'na' }, { num: 2, label: 'SAVE', act: 'na' }, { num: 3, label: 'PRINT SCREEN', act: 'na' }, { num: 4, label: 'PRINT', act: 'na' },
      b(5), { num: 6, label: 'UNSIM ALL I/O', act: 'unsim' }, b(7), { num: 8, label: 'CYCLE POWER', act: 'power' }, { num: 9, label: 'ENABLE HMI MENUS', act: 'na' }, { num: 0, label: '-- NEXT --', act: 'next' }];
    return { id: 'fctn', titleFmt: p => `FUNCTION   ${p}`, pages: [page1, page2], onPick: x => {
      ctl.popup = null;
      switch (x.act) {
        case 'abort': ctl.abortAll(); break;
        case 'fbd': ctl.fbd = !ctl.fbd; break;
        case 'rwait': ctl.releaseWait(); break;
        case 'unsim': [...ctl.simIO].forEach(k => ctl.setSim(k, false)); break;
        case 'power':
          if (!ctl.tpOn) { ctl.msg = 'Teach pendant is disabled'; break; }   // manual: TP must be enabled
          ctl.ask('This will cycle power. Are you sure?', () => { ctl.run = { state: 'ABORTED' }; ctl.powerUp(); });
          break;
        default: ctl.na(x.label);
      }
    } };
  }
  function dispSpec(ctl) {
    const labels = ['Single', 'Double', 'Triple', 'TreeView', 'Single Wide', 'Double Horizontal', 'Triple Horizontal', 'Help/Diagnostics'];
    const p1 = labels.map((l, i) => ({ num: i + 1, label: l, act: i === 0 ? 'single' : 'na' })).concat([{ num: 0, label: '-- NEXT --', act: 'next' }]);
    const p2 = ['Status/Single', 'Menu History', 'User Views', 'Menu Favorites', 'Related Views', 'Maximize/Restore', 'Zoom'].map((l, i) => ({ num: i + 1, label: l, act: 'na' })).concat([{ num: 0, label: '-- NEXT --', act: 'next' }]);
    return { id: 'disp', titleFmt: p => `DISPLAY   ${p}`, pages: [p1, p2], onPick: x => { ctl.popup = null; if (x.act !== 'single') ctl.na(x.label); } };
  }

  // ---------- screens ----------
  class InfoScreen {
    constructor(ctl, title) { this.ctl = ctl; this.t = title; }
    title() { return this.t; }
    body() { return ['', '  ' + NA]; }
    softkeys() { return []; }
    key() {}
  }

  class SelectScreen {
    constructor(ctl) { this.ctl = ctl; this.row = 0; this.page = 1; this.top = 0; const i = this.list().indexOf(ctl.selected); if (i >= 0) this.row = i; }
    list() { return (this.ctl.host.listPrograms ? this.ctl.host.listPrograms() : []).slice().sort(); }
    title() { return 'Select'; }
    titleRight() { const n = this.list().length; return n ? `${Math.min(this.row + 1, n)}/${n}` : '0/0'; }
    body() {
      const L = this.list(); this.row = clamp(this.row, 0, Math.max(0, L.length - 1));
      const vis = ROWS - 2;
      if (this.row < this.top) this.top = this.row; if (this.row >= this.top + vis) this.top = this.row - vis + 1;
      const rows = ['  All', '  No.   Program name        Comment'];   // unverified: bytes-free figure left out
      for (let i = this.top; i < Math.min(L.length, this.top + vis); i++) {
        const name = L[i];
        rows.push([S(padL(i + 1, 5) + '   '), S(padR(name, 18), i === this.row ? 'cursor' : undefined), S(`  [${padR(this.ctl.commentOf(name).slice(0, 16), 16)}]`)]);
      }
      return rows;
    }
    more() { return true; }
    next() { this.page = this.page === 1 ? 2 : 1; }
    softkeys() { return this.page === 1 ? ['[ TYPE ]', 'CREATE', 'DELETE', 'MONITOR', '[ ATTR ]'] : ['COPY', 'DETAIL', 'LOAD', 'SAVE AS', 'PRINT']; }
    key(k) {
      const c = this.ctl, L = this.list(), name = L[this.row];
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row = Math.min(L.length - 1, this.row + 1);
      else if (k === 'ENTER' && name) { c.switchProgram(name); c.open(new EditScreen(c, name)); }
      else if (/^F[1-5]$/.test(k)) {
        const lab = this.softkeys()[+k[1] - 1];
        if (lab === 'CREATE') c.open(new CreateScreen(c, 'create'));
        else if (lab === 'DELETE' && name) {
          if (c.run.state !== 'ABORTED' && c.run.root === name) { c.msg = 'Program is in use'; return; }   // unverified: prompt text
          c.ask(`Delete ${name}?`, () => { if (c.host.deleteProgram) c.host.deleteProgram(name); delete c.cache[name]; if (c.selected === name) c.selected = null; });   // unverified: prompt text
        } else if (lab === 'COPY' && name) c.open(new CreateScreen(c, 'copy', name));
        else if (lab === 'DETAIL' && name) c.open(new DetailScreen(c, name));
        else if (lab) c.na(lab === '[ TYPE ]' ? 'Select' : lab);
      }
    }
  }

  class CreateScreen {
    constructor(ctl, kind, src) {
      this.ctl = ctl; this.kind = kind; this.src = src; this.name = ''; this.phase = 'name';
    }
    onOpen() { this.begin(); }
    begin() {
      const c = this.ctl;
      c.startText({ prompt: 'Enter program name', max: 36, done: s => {
        if (!validName(s)) { c.msg = 'Invalid program name'; return false; }   // unverified: prompt text
        const nm = s.toUpperCase();
        if ((c.host.listPrograms ? c.host.listPrograms() : []).includes(nm)) { c.msg = 'Program already exists'; return false; }   // unverified
        this.name = nm;
        if (this.kind === 'copy') {   // unverified: copy steps (manual gives only the soft key)
          const e = c.loadProg(this.src);
          if (e) c.host.saveProgram({ name: nm, header: e.header.replace(/\/PROG\s+\S+/, '/PROG  ' + nm), lines: c.texts(e), posText: e.posText });
          c.back(); const t = c.top(); if (t instanceof SelectScreen) t.row = t.list().indexOf(nm);
          return true;
        }
        this.phase = 'fn'; return true;
      }, cancel: () => {} });
    }
    title() { return 'Select'; }
    body() {
      const t = this.ctl.text;
      const nameRow = t ? [S('  '), ...t.segments(36)] : [S('  ' + this.name)];
      return [this.kind === 'copy' ? ' --- Copy Teach Pendant Program ---' : ' --- Create Teach Pendant Program ---', ' Program Name:', nameRow, '', '', padL('-- End --', 50)];
    }
    prompt() { return this.phase === 'fn' ? 'Select function' : ''; }
    softkeys() { return this.phase === 'fn' ? ['', 'DETAIL', 'EDIT', '', ''] : []; }
    create() {
      const c = this.ctl;
      c.host.saveProgram({ name: this.name, header: C.defaultHeader(this.name), lines: [], posText: '' });
      c.selectProgram(this.name); c.cursorOf(this.name).line = 1;
    }
    key(k) {
      const c = this.ctl;
      if (this.phase !== 'fn') { if (k === 'ENTER' || /^F/.test(k)) this.begin(); return; }
      if (k === 'F2') { this.create(); c.open(new DetailScreen(c, this.name)); }
      else if (k === 'F3') { this.create(); c.open(new EditScreen(c, this.name)); }
    }
  }

  class DetailScreen {
    constructor(ctl, name) { this.ctl = ctl; this.name = name; this.row = 0; }
    title() { return 'Program detail'; }
    titleRight() { return `${this.row + 1}/8`; }
    body() {
      const c = this.ctl, e = c.loadProg(this.name);
      if (!e) return ['', '  Program not found'];
      const npos = Object.keys(C.parsePositions(e.posText)).length;
      const size = C.toLS({ name: e.name, header: e.header, lines: c.texts(e), posText: e.posText }).length;
      const t = c.text;
      const f = (i, label, val) => {
        const v = i === this.row && t ? t.segments(16) : [S(val, i === this.row ? 'cursor' : undefined)];
        return [S(`   ${i + 1} ${padR(label, 16)}`), ...(i === 0 ? v : [S('['), ...v, S(']')])];
      };
      return ['  Creation Date:', '  Modification Date:', '  Copy Source:', `  Positions: ${npos ? 'TRUE ' : 'FALSE'}   Size: ${padL(size, 6)} Byte`, '  Program name:',
        f(0, '', e.name), f(1, 'Sub type:', padR('None', 16)), f(2, 'Comment:', padR(c.commentOf(this.name), 16)), f(3, 'Group mask:', padR('1,*,*,*,*,*,*,*', 16)),
        f(4, 'Write protect:', padR('OFF', 16)), f(5, 'Ignore pause:', padR('OFF', 16)), f(6, 'Stack size:', padR(' 500', 16))];   // row 8 (Collection) is off screen
    }
    softkeys() { return ['END', 'PREV', 'NEXT', '[CHOICE]', '']; }
    key(k) {
      const c = this.ctl;
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row = Math.min(7, this.row + 1);
      else if (k === 'F1') { if (c.loadProg(this.name)) { c.switchProgram(this.name); c.open(new EditScreen(c, this.name)); } }
      else if (k === 'F2' || k === 'F3') {
        const L = (c.host.listPrograms ? c.host.listPrograms() : []).slice().sort(), i = L.indexOf(this.name);
        const j = clamp(i + (k === 'F2' ? -1 : 1), 0, L.length - 1); if (L[j]) this.name = L[j];
      } else if (k === 'F4') { if (this.row !== 0 && this.row !== 2) c.msg = NA; }
      else if (k === 'ENTER') {
        if (!c.canEdit()) return;
        const e = c.loadProg(this.name); if (!e) return;
        if (this.row === 0) c.startText({ init: e.name, max: 36, prompt: 'Enter program name', done: s => this.rename(s) });
        else if (this.row === 2) c.startText({ init: c.commentOf(this.name), max: 16, prompt: 'Enter comment', done: s => this.setComment(s) });   // manual: 1-16 characters
        else c.msg = NA;
      }
    }
    rename(s) {
      const c = this.ctl;
      if (!validName(s)) { c.msg = 'Invalid program name'; return false; }
      const nm = s.toUpperCase(), e = c.loadProg(this.name); if (!e || nm === e.name) return true;
      if ((c.host.listPrograms ? c.host.listPrograms() : []).includes(nm)) { c.msg = 'Program already exists'; return false; }
      c.host.saveProgram({ name: nm, header: e.header.replace(/\/PROG\s+\S+/, '/PROG  ' + nm), lines: c.texts(e), posText: e.posText });
      if (c.host.deleteProgram) c.host.deleteProgram(this.name);
      delete c.cache[this.name];
      if (c.selected === this.name) c.selected = nm;
      if (c.cursors[this.name]) { c.cursors[nm] = c.cursors[this.name]; delete c.cursors[this.name]; }
      this.name = nm; return true;
    }
    setComment(s) {
      const c = this.ctl, e = c.loadProg(this.name); if (!e) return true;
      let h = e.header && e.header.trim() ? e.header : C.defaultHeader(e.name);
      h = /COMMENT\s*=/.test(h) ? h.replace(/COMMENT(\s*)=\s*"[^"]*"/, `COMMENT$1= "${s.replace(/"/g, "'")}"`) : h.replace(/\/ATTR/, `/ATTR\nCOMMENT\t\t= "${s}";`);
      e.header = h; c.saveProg(e); return true;
    }
  }

  // Edit screen: program lines with field cursor
  class EditScreen {
    constructor(ctl, name) { this.ctl = ctl; this.name = name; this.page = 1; this.top = 0; this.sel = null; this.copy = null; }
    get ed() { return this.ctl.loadProg(this.name); }
    get cur() { return this.ctl.cursorOf(this.name); }
    title() { return this.name; }
    titleRight() { const e = this.ed; if (!e) return ''; const n = e.lines.length; return `${Math.min(this.cur.line, n + 1)}/${n + 1}`; }
    // fields + display parts for line i (0-based)
    lineInfo(i) {
      const c = this.ctl, e = this.ed, L = e.lines[i], n = i + 1;
      const fields = [{ kind: 'num' }], rows = [[{ text: `${padL(n, 4)}:`, f: 0 }]];
      const add = (text, field, row) => { const r = rows[row || 0] || (rows[row || 0] = []); if (field) { fields.push(field); r.push({ text, f: fields.length - 1 }); } else r.push({ text }); };
      const disp = r => (c.showCmt ? c.named(r) : r.replace(/:[^\]]*\]/g, ']'));
      if (L.tpl) {
        add('   ');
        const walk = (toks, parent) => {
          for (const t of toks) {
            if (t.lit != null) add(t.lit);
            else if (!LEAF[t.slot] && t.sub) walk(t.sub, t);
            else add(t.val != null ? t.val : '...', { kind: 'slot', tok: t, parent });
          }
        };
        walk(L.tpl, null);
        return { fields, rows };
      }
      const t = L.text, m = splitMotion(t);
      if (m) {
        const at = c.atPosition(e, m.pos) ? '@' : ' ';
        add(m.mt, { kind: 'mt' }); add(' ');
        if (m.via) {
          add((c.atPosition(e, m.via) ? '@' : ' ')); add(disp(m.via), { kind: 'pos', which: 'via' });
          rows[1] = [{ text: '     :  ' }];
          add(disp(m.pos), { kind: 'pos', which: 'pos' }, 1);
          if (m.speed) { add(' ', null, 1); add(m.speed, { kind: 'speed' }, 1); }
          if (m.term) { add(' ', null, 1); add(m.term, { kind: 'term' }, 1); }
          if (m.opts) add(' ' + disp(m.opts), null, 1);
        } else {
          add(at); add(disp(m.pos), { kind: 'pos', which: 'pos' });
          if (m.speed) { add(' '); add(m.speed, { kind: 'speed' }); }
          if (m.term) { add(' '); add(m.term, { kind: 'term' }); }
          if (m.opts) add(' ' + disp(m.opts));
        }
        return { fields, rows, m };
      }
      add('   ');
      if (!t || /^(!|\/\/)/.test(t)) { add(t); return { fields, rows }; }
      const gf = genericFields(t);
      let p = 0;
      for (const g of gf) {
        if (g.s > p) add(disp(t.slice(p, g.s)));
        add(t.slice(g.s, g.e), { kind: g.kind, s: g.s, e: g.e }); p = g.e;
        if (g.kind !== 'idx' || !c.showCmt) continue;
        // the number is its own field, so the DATA-screen comment is added to the text after it: R[2 -> R[2:count]
        const reg = /(?:^|[^A-Za-z])(PR|R)\[$/.exec(t.slice(0, g.s)), tail = /^((?:,\d+)?)(?::[^\]]*)?\]/.exec(t.slice(p));
        const cm = reg && tail && ((reg[1] === 'R' ? c.settings.rCmt : c.settings.prCmt) || {})[t.slice(g.s, g.e)];
        if (cm) { add(`${tail[1]}:${cm}]`); p += tail[0].length; }
      }
      if (p < t.length) add(disp(t.slice(p)));
      return { fields, rows };
    }
    body() {
      const c = this.ctl, e = this.ed;
      if (!e) return ['', '  Program not found'];
      const cur = this.cur, n = e.lines.length;
      cur.line = clamp(cur.line, 1, n + 1);
      const all = []; let curRow = 0;
      for (let i = 0; i < n; i++) {
        const info = this.lineInfo(i), isCur = cur.line === i + 1;
        if (isCur) { cur.col = clamp(cur.col, 0, info.fields.length - 1); curRow = all.length; }
        const inSel = this.sel && i + 1 >= Math.min(this.sel.anchor, cur.line) && i + 1 <= Math.max(this.sel.anchor, cur.line);
        info.rows.forEach(r => all.push(r.map(p => {
          let text = p.text;
          if (isCur && p.f === cur.col && c.num && c.num.target === `${this.name}:${i + 1}:${p.f}`) text = c.num.buf + '_';
          if (isCur && p.f === cur.col && c.text && this.textField === `${i + 1}:${p.f}`) return c.text.segments().map(s => s);
          return S(text || ' ', inSel || (isCur && p.f === cur.col && !this.sel) ? 'cursor' : undefined);
        }).flat()));
      }
      if (cur.line === n + 1) curRow = all.length;
      all.push([S('[End]', cur.line === n + 1 ? 'cursor' : undefined)]);
      if (curRow < this.top) this.top = curRow;
      if (curRow >= this.top + ROWS) this.top = curRow - ROWS + 1;
      this.top = clamp(this.top, 0, Math.max(0, all.length - 1));
      return all.slice(this.top, this.top + ROWS);
    }
    field() { const e = this.ed, cur = this.cur; if (!e || cur.line > e.lines.length) return { kind: 'end' }; const info = this.lineInfo(cur.line - 1); return { ...info.fields[clamp(cur.col, 0, info.fields.length - 1)], info }; }
    more() { return !this.sel && !this.copy; }
    next() { if (!this.sel && !this.copy) this.page = this.page === 1 ? 2 : 1; }
    prompt() {
      if (this.sel && this.sel.kind === 'delete') return 'Delete line(s)?';   // unverified: prompt text
      if (this.sel && this.sel.kind === 'remark') return 'Select lines';      // unverified
      if (this.copy && this.copy.paste) return 'Select paste method';         // unverified
      return '';
    }
    softkeys() {
      if (this.sel) {
        if (this.sel.kind === 'delete') return ['', '', '', 'YES', 'NO'];
        if (this.sel.kind === 'remark') return ['', '', '', 'REMARK', 'UNREMARK'];
        if (this.sel.kind === 'copy') return ['', 'COPY', 'CUT', '', ''];
      }
      if (this.copy) return this.copy.paste ? ['', 'LOGIC', 'POS-ID', 'POSITION', 'CANCEL'] : ['', 'SELECT', '', '', this.ctl.clip ? 'PASTE' : ''];
      if (this.page === 2) return ['[INST]', '', '', '', '[EDCMD]'];
      const f = this.field();
      const choice = ['mt', 'pos', 'speed', 'term', 'onoff'].includes(f.kind) || (f.kind === 'slot' && (!LEAF[f.tok.slot] || f.parent));
      return ['POINT', '', '', choice ? '[CHOICE]' : '', f.kind === 'pos' ? 'POSITION' : 'TOUCHUP'];
    }
    prev() {
      if (this.sel) { this.sel = null; return true; }
      if (this.copy) { if (this.copy.paste) this.copy.paste = false; else this.copy = null; return true; }
      return false;
    }
    moveLine(d) {
      const e = this.ed, cur = this.cur, n = e.lines.length;
      const nl = clamp(cur.line + d, 1, n + 1);
      if (nl !== cur.line) { cur.line = nl; if (this.ctl.run.state === 'PAUSED' && this.ctl.execProg === this.name) { this.ctl.run.cursorMoved = true; this.ctl.run.cursorOK = false; } }
    }
    selKey(k) { if (k === 'UP' || k === 'DOWN') { this.moveLine(k === 'UP' ? -1 : 1); return true; } return false; }
    key(k, shift) {
      const c = this.ctl, e = this.ed; if (!e) return;
      const cur = this.cur;
      if (k === 'UP' || k === 'DOWN') { this.moveLine((k === 'UP' ? -1 : 1) * (shift ? ROWS - 1 : 1)); return; }
      if (k === 'LEFT') { cur.col = Math.max(0, cur.col - 1); return; }
      if (k === 'RIGHT') { const f = this.field(); cur.col = f.info ? Math.min(f.info.fields.length - 1, cur.col + 1) : 0; return; }
      if (k === 'ITEM') { c.startNum({ prompt: 'Enter line number', done: v => { cur.line = clamp(Math.round(+v), 1, e.lines.length + 1); cur.col = 0; } }); return; }   // unverified: prompt text
      if (this.sel) return this.selFkey(k);
      if (this.copy) return this.copyFkey(k);
      if (k === 'F1') { if (this.page === 1) { if (shift) this.record(c.defIdx); else this.pointMenu(); } else this.instMenu(); return; }
      if (k === 'F5') {
        if (this.page === 2) return this.edcmdMenu();
        const f = this.field();
        if (shift) { this.touchup(); return; }   // SHIFT+F5 is TOUCHUP wherever the cursor is on the line
        if (f.kind === 'pos') { const r = refNum(f.which === 'via' ? f.info.m.via : f.info.m.pos); if (r) c.open(new PosDetailScreen(c, r.kind, r.n, this.name)); else c.msg = 'Position is not recorded'; return; }   // unverified
        return;
      }
      if (k === 'F4' && this.page === 1) return this.choice();
      if (k === 'ENTER') { const f = this.field(); if (f.kind === 'slot' && !f.tok.sub && !LEAF[f.tok.slot]) this.activateSlot(); else if (f.kind === 'slot' && LEAF[f.tok.slot] && f.tok.val == null) this.activateSlot(); return; }
      if (DIGIT[k] && /[\d.-]/.test(DIGIT[k])) return this.digit(DIGIT[k]);
    }
    // ----- modifications -----
    modify(fn) {
      const c = this.ctl, e = this.ed;
      if (!c.canEdit()) return false;
      c.snapshotUndo(e); fn(e); c.saveProg(e); return true;
    }
    lineObj() { const e = this.ed; return e.lines[this.cur.line - 1]; }
    writeLine(text, tpl) {   // new instructions overwrite the cursor line; on [End] they are added
      const e = this.ed, cur = this.cur;
      if (cur.line > e.lines.length) e.lines.push({ text, tpl: tpl || null });
      else e.lines[cur.line - 1] = { text, tpl: tpl || null };
    }
    pointMenu() {
      const c = this.ctl;
      c.showMenu({ title: 'Select Motion', pages: [this.ctl.defaults.map((d, i) => ({ num: null, label: `${i + 1}: ${d}` }))],
        titleFmt: () => 'Select Motion 1/1', softkeys: ['ED_DEF', '', '', '', ''],
        onPick: x => { c.popup = null; const i = c.defaults.findIndex((d, j) => x.label === `${j + 1}: ${d}`); c.defIdx = i; this.record(i); },
        fkey: n => { if (n === 1) { c.popup = null; c.open(new DefaultMotionScreen(c)); } } });
    }
    record(defIdx) {
      const c = this.ctl;
      this.modify(e => {
        const n = c.nextP(e), v6 = c.poseIn(c.uf, c.ut);
        c.setPosBlock(e, n, v6, c.uf, c.ut, false);
        const text = c.defaults[defIdx].replace('P[]', `P[${n}]`);
        this.writeLine(text);
        c.cleanPositions(e);
        this.cur.line++; this.cur.col = 0;
      });
    }
    touchup() {
      const c = this.ctl, f = this.field(); if (!f.info || !f.info.m) return;
      const m = f.info.m, which = f.kind === 'pos' && f.which === 'via' ? 'via' : 'pos', ref = m[which];
      const r = refNum(ref);
      const offs = (() => { const o = m.opts.match(/(?:^|\s)Offset\s*,\s*PR\[(\d+)/i); return o ? c.settings.pr[+o[1]] : null; })();
      const pose = () => {   // current pose in the active user frame, minus a cartesian Offset,PR[] on the line (as teach.js)
        let v6 = c.poseIn(c.uf, c.ut);
        if (offs && offs.type === 'cart') {
          const f2 = C.fk(c.q, c.tool(c.ut)), loc = C.toFrame(C.frameOf(c.ufVec(c.uf)), f2.tip, f2.R);
          loc.p = C.sub(loc.p, offs.v.slice(0, 3)); loc.R = C.matMul(C.matT(C.wprToR(offs.v[3], offs.v[4], offs.v[5])), loc.R);
          v6 = C.poseToV6(loc.p, loc.R);
        }
        return v6;
      };
      if (r && r.kind === 'PR') {
        if (!c.canEdit()) return;
        c.settings.pr[r.n] = { type: 'cart', v: pose().map(x => +x.toFixed(3)) }; c.regChanged();
        c.msg = `Position has been recorded to PR[${r.n}].`; return;
      }
      const setNew = e => {
        const n = c.nextP(e); m[which] = `P[${n}]`; e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null };
        c.setPosBlock(e, n, pose(), c.uf, c.ut, false); return n;
      };
      if (!r) { let n; if (this.modify(e => { n = setNew(e); })) c.msg = `Position has been recorded to P[${n}].`; return; }
      const e = this.ed, users = c.texts(e).filter(t => new RegExp(`\\bP\\[${r.n}(?![\\d])`).test(t)).length;
      const doShared = () => { if (this.modify(e2 => c.setPosBlock(e2, r.n, pose(), c.uf, c.ut, true))) c.msg = `Position has been recorded to P[${r.n}].`; };
      if (users > 1) {
        if (!c.canEdit()) return;
        c.ask('Set New ID', () => { let n; if (this.modify(e2 => { n = setNew(e2); })) c.msg = `Position has been recorded to P[${n}].`; }, doShared);
      } else doShared();
    }
    choice() {
      const c = this.ctl, f = this.field();
      if (f.kind === 'slot') { if (f.parent) this.openSlotMenu(f.parent); else if (!LEAF[f.tok.slot]) this.activateSlot(); return; }
      if (!f.info) return;
      const m = f.info.m;
      const pick = (title, labels, fn) => c.showMenu({ title, pages: [labels.map(l => (l == null ? { blank: true } : { label: l }))], onPick: x => { c.popup = null; fn(x.label, labels.indexOf(x.label)); } });
      if (f.kind === 'mt') return pick('Motion Modify', ['Joint', 'Linear', 'Circular', 'Circle Arc'], (l, i) => this.changeType(['J', 'L', 'C', 'A'][i]));
      if (f.kind === 'speed') {
        const units = m.mt === 'J' ? ['%', 'sec', 'msec'] : ['mm/sec', 'cm/min', 'inch/min', 'deg/sec', 'sec', 'msec'];
        return pick('Motion Modify', units, l => {
          if (l === 'msec') { c.msg = NA; return; }   // the simulator doesn't read msec speeds
          const num = (m.speed.match(/^(\d*\.?\d+)/) || [])[1] || (l === '%' ? '100' : '100');
          this.modify(e => { m.speed = num + (l === 'sec' ? 'sec' : l); e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null }; });   // unverified: value kept when the unit changes
        });
      }
      if (f.kind === 'term') return pick('Motion Modify', ['FINE', 'CNT'], l => {   // unverified: [CHOICE] list for termination
        this.modify(e => { m.term = l === 'FINE' ? 'FINE' : (/^CNT/.test(m.term) ? m.term : 'CNT100'); e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null }; });
        if (l === 'CNT') c.startNum({ prompt: 'Enter value', target: `${this.name}:${this.cur.line}:${this.cur.col}`, done: v => this.setTerm(v) });
      });
      if (f.kind === 'pos') return pick('Motion Modify', ['P[ ]', 'PR[ ]'], l => {
        if (l === 'PR[ ]') {
          c.startNum({ prompt: 'Enter value', target: `${this.name}:${this.cur.line}:${this.cur.col}`, done: v => this.modify(e => { m[f.which] = `PR[${Math.round(+v)}]`; e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null }; c.cleanPositions(e); }) });
        } else this.modify(e => { if (!/^P\[/.test(m[f.which])) m[f.which] = `P[${c.nextP(e)}]`; e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null }; });
      });
      if (f.kind === 'onoff') return pick('I/O statement', ['On', 'Off'], l => this.modify(e => {
        const t = e.lines[this.cur.line - 1].text; e.lines[this.cur.line - 1] = { text: t.slice(0, f.s) + l.toUpperCase() + t.slice(f.e), tpl: null };
      }));
    }
    changeType(mt) {
      const c = this.ctl, f = this.field(), m = f.info.m;
      if (mt === 'A') { c.msg = NA; return; }
      if (mt === m.mt) return;
      this.modify(e => {
        const sp = m.speed.match(/^(\d*\.?\d+)\s*(.*)$/), val = sp ? +sp[1] : 100, unit = sp ? sp[2] : '%';
        if (mt === 'J' && unit !== '%') m.speed = `${clamp(Math.round(val / 30), 1, 100)}%`;        // unverified: speed conversion between J and L/C
        if (mt !== 'J' && m.mt === 'J') m.speed = unit === '%' ? `${Math.round(val * 30)}mm/sec` : m.speed;   // manual figure: 100% -> 3000mm/sec
        if (mt === 'C' && !m.via) { m.via = m.pos; m.pos = 'P[...]'; }   // the old point becomes the via point; the end point is taught with TOUCHUP
        if (mt !== 'C' && m.via) { if (!refNum(m.pos)) m.pos = m.via; m.via = null; }
        m.mt = mt;
        e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null };
        c.cleanPositions(e);
      });
    }
    setTerm(v) {
      const f = this.field(); if (!f.info || !f.info.m) return;
      const m = f.info.m, n = Math.round(+v);
      if (!(n >= 0 && n <= 100)) { this.ctl.msg = 'Value out of range'; return; }   // unverified: prompt text
      this.modify(e => { m.term = `CNT${n}`; e.lines[this.cur.line - 1] = { text: joinMotion(m), tpl: null }; });
    }
    digit(ch) {
      const c = this.ctl, f = this.field(), cur = this.cur, target = `${this.name}:${cur.line}:${cur.col}`;
      const line = cur.line;
      const done = fn => v => { if (this.cur.line === line) fn(v); };
      if (f.kind === 'slot') { if (LEAF[f.tok.slot] && f.tok.slot !== 'p' && f.tok.slot !== 'rem') this.numForSlot(f.tok, ch); return; }
      if (!['pos', 'speed', 'term', 'idx', 'const', 'time'].includes(f.kind)) return;
      if (!c.canEdit()) return;
      const m = f.info.m;
      c.startNum({ init: ch, target, done: done(v => {
        if (f.kind === 'pos') { const r = refNum(m[f.which]); const kind = r ? r.kind : (/^PR/.test(m[f.which]) ? 'PR' : 'P'); this.modify(e => { m[f.which] = `${kind}[${Math.round(Math.abs(+v))}]`; e.lines[line - 1] = { text: joinMotion(m), tpl: null }; c.cleanPositions(e); }); }
        else if (f.kind === 'speed') {
          const unit = (m.speed.match(/^(?:R\[[^\]]*\]|\d*\.?\d+)\s*(.*)$/) || [])[1] || (m.mt === 'J' ? '%' : 'mm/sec');
          let x = Math.abs(+v); if (unit === '%') x = clamp(Math.round(x), 1, 100);   // unverified: range handling
          if (!(x > 0)) return;
          this.modify(e => { m.speed = (m.speed === 'max_speed' ? (m.mt === 'J' ? '100%' : `${numText(x)}mm/sec`) : `${numText(x)}${unit}`); e.lines[line - 1] = { text: joinMotion(m), tpl: null }; });
        } else if (f.kind === 'term') { if (/^CNT/i.test(m.term)) this.setTerm(v); }
        else this.modify(e => {
          const t = e.lines[line - 1].text, nv = f.kind === 'time' ? (+v).toFixed(2) : f.kind === 'idx' ? String(Math.round(Math.abs(+v))) : numText(+v);
          e.lines[line - 1] = { text: t.slice(0, f.s) + nv + t.slice(f.e), tpl: null };
        });
      }) });
    }
    // ----- INST templates -----
    instMenu() {
      const c = this.ctl;
      if (!c.canEdit()) return;
      const pickSub = spec => c.showMenu({ ...spec, onPick: x => this.instPick(x) });
      c.showMenu({ ...INST, onPick: x => { if (!x.tpl) { c.popup = null; c.msg = NA; return; } pickSub(INST_SUB[x.tpl.slice(2)]); } });
    }
    instPick(x) {
      const c = this.ctl; c.popup = null;
      if (!x.tpl) { c.msg = NA; return; }
      const toks = parseTpl(x.tpl);
      this.modify(e => { this.writeLine('', toks.some(t => t.slot) ? toks : null); if (!toks.some(t => t.slot)) e.lines[this.cur.line - 1] = { text: x.tpl, tpl: null }; });
      this.cur.col = 1;
      this.nextSlot();
    }
    tplFieldsOf() { const L = this.lineObj(); return L && L.tpl ? tplFields(L.tpl) : []; }
    // Move to the first unfilled slot on the line and start it; finish the line when all are filled
    nextSlot() {
      const L = this.lineObj(); if (!L || !L.tpl) return;
      const fs = tplFields(L.tpl), i = fs.findIndex(f => (LEAF[f.tok.slot] ? f.tok.val == null : !f.tok.sub));
      if (i < 0) { L.text = renderTpl(L.tpl); L.tpl = null; this.ctl.saveProg(this.ed); this.cur.col = 0; return; }
      this.cur.col = i + 1; this.activateSlot();
    }
    activateSlot() {
      const f = this.field(); if (f.kind !== 'slot') return;
      const t = f.tok, c = this.ctl;
      if (!LEAF[t.slot]) return this.openSlotMenu(t);
      if (t.slot === 'p') {
        const L = (c.host.listPrograms ? c.host.listPrograms() : []).slice().sort();
        const pages = []; for (let i = 0; i < Math.max(1, L.length); i += 7) pages.push(L.slice(i, i + 7).map(n => ({ label: n })));
        c.showMenu({ title: 'PROGRAM', next: 8, pages, softkeys: ['PROGRAM', 'MACRO', 'COLLECT', 'INDIRECT', 'STRINGS'],
          onPick: x => { c.popup = null; this.fillLeaf(t, x.label); } });
        return;
      }
      if (t.slot === 'rem') { this.textField = `${this.cur.line}:${this.cur.col}`; c.startText({ init: t.val || '', max: 32, prompt: 'Enter comment', done: s => { this.textField = null; this.fillLeaf(t, s); }, cancel: () => { this.textField = null; } }); return; }
      c.startNum({ prompt: 'Enter value', target: `${this.name}:${this.cur.line}:${this.cur.col}`, done: v => this.fillNum(t, v) });
    }
    numForSlot(t, ch) { this.ctl.startNum({ init: ch, prompt: 'Enter value', target: `${this.name}:${this.cur.line}:${this.cur.col}`, done: v => this.fillNum(t, v) }); }
    fillNum(t, v) {
      const x = +v; if (!isFinite(x)) return;
      const val = t.slot === 'i' ? String(Math.round(Math.abs(x))) : t.slot === 't' ? Math.abs(x).toFixed(2) : t.slot === 'pct' ? String(clamp(Math.round(x), 0, 100)) : numText(x);
      this.fillLeaf(t, val);
    }
    fillLeaf(t, val) { t.val = val; this.ctl.saveProg(this.ed); this.nextSlot(); }
    openSlotMenu(t) {
      const c = this.ctl, L = this.lineObj(); if (!L || !L.tpl) return;
      const spec = slotMenu(t.slot, L.tpl); if (!spec) return;
      c.showMenu({ ...spec, onPick: x => {
        c.popup = null;
        if (!x.tpl) { c.msg = NA; return; }
        t.sub = parseTpl(x.tpl); c.saveProg(this.ed);
        if (!t.sub.some(s => s.slot)) { /* a fixed choice like ON */ }
        this.nextSlot();
      } });
    }
    // ----- EDCMD -----
    edcmdMenu() {
      const c = this.ctl;
      const p1 = ['Insert', 'Delete', 'Copy/Cut', 'Find', 'Replace', 'Renumber', 'Comment', 'Undo', 'Remark'].map((l, i) => ({ num: i + 1, label: l })).concat([{ num: 0, label: '-- NEXT --', act: 'next' }]);
      const p2 = ['Icon Editor', 'Color', 'IO Status'].map((l, i) => ({ num: i + 1, label: l })).concat([{ num: 0, label: '-- NEXT --', act: 'next' }]);
      c.showMenu({ titleFmt: p => `EDCMD   ${p}`, pages: [p1, p2], onPick: x => { c.popup = null; this.edcmd(x.label); } });
    }
    edcmd(label) {
      const c = this.ctl, e = this.ed, cur = this.cur;
      switch (label) {
        case 'Insert':
          if (!c.canEdit()) return;
          c.startNum({ prompt: 'How many lines to insert?', done: v => {   // unverified: prompt text (illegible in the manual)
            const n = clamp(Math.round(+v), 0, 99); if (!n) return;
            this.modify(e2 => { e2.lines.splice(cur.line - 1, 0, ...Array.from({ length: n }, () => ({ text: '', tpl: null }))); cur.col = 0; });
          } });
          return;
        case 'Delete': if (cur.line <= e.lines.length && c.canEdit()) this.sel = { kind: 'delete', anchor: cur.line }; return;
        case 'Remark': if (cur.line <= e.lines.length && c.canEdit()) this.sel = { kind: 'remark', anchor: cur.line }; return;
        case 'Copy/Cut': this.copy = { paste: false }; return;
        case 'Comment': c.showCmt = !c.showCmt; c.msg = c.showCmt ? 'Comment Enabled' : 'Comment Disabled'; return;
        case 'Undo': {
          const u = c.undo[this.name]; if (!u || !c.canEdit()) return;
          c.ask('Undo?', () => {   // unverified: prompt text
            const now = { header: e.header, posText: e.posText, lines: c.texts(e).map(text => ({ text, tpl: null })) };
            e.header = u.header; e.posText = u.posText; e.lines = u.lines.map(l => ({ ...l })); c.undo[this.name] = now; c.saveProg(e);
          });
          return;
        }
        default: c.msg = NA;
      }
    }
    range() { const a = this.sel.anchor, b = this.cur.line, n = this.ed.lines.length; return [Math.min(a, b), Math.min(n, Math.max(a, b))]; }
    selFkey(k) {
      const c = this.ctl, [a, b] = this.range();
      if (this.sel.kind === 'delete') {
        if (k === 'F4') { this.sel = null; this.modify(e => { e.lines.splice(a - 1, b - a + 1); c.cleanPositions(e); this.cur.line = a; this.cur.col = 0; }); }
        else if (k === 'F5') this.sel = null;
      } else if (this.sel.kind === 'remark') {
        if (k === 'F4' || k === 'F5') {
          const on = k === 'F4'; this.sel = null;
          this.modify(e => { for (let i = a - 1; i < b; i++) { const t = c.texts(e)[i]; e.lines[i] = { text: on ? (t.startsWith('//') ? t : '//' + t) : t.replace(/^\/\//, ''), tpl: null }; } });
        }
      } else if (this.sel.kind === 'copy') {
        if (k === 'F2' || k === 'F3') {
          const e = this.ed, lines = c.texts(e).slice(a - 1, b), pos = {};
          lines.forEach(t => { const re = /\bP\[(\d+)/g; let m; while ((m = re.exec(t))) { const blk = (e.posText.match(posBlockRe(m[1])) || [])[0]; if (blk) pos[m[1]] = blk.trim(); } });
          c.clip = { lines, pos };
          this.sel = null;
          if (k === 'F3') this.modify(e2 => { e2.lines.splice(a - 1, b - a + 1); c.cleanPositions(e2); this.cur.line = a; });
        }
      }
    }
    copyFkey(k) {
      const c = this.ctl;
      if (!this.copy.paste) {
        if (k === 'F2') this.sel = { kind: 'copy', anchor: this.cur.line };
        else if (k === 'F5' && c.clip) { if (c.canEdit()) this.copy.paste = true; }
        return;
      }
      if (k === 'F5') { this.copy.paste = false; return; }
      if (!['F2', 'F3', 'F4'].includes(k)) return;
      const how = { F2: 'logic', F3: 'posid', F4: 'position' }[k];
      this.modify(e => {
        let lines = c.clip.lines.slice();
        if (how === 'logic') lines = lines.map(t => t.replace(/\bP\[\d+(?::[^\]]*)?\]/g, 'P[...]'));
        if (how === 'position') {
          const map = {}; let n = c.nextP(e);
          lines = lines.map(t => t.replace(/\bP\[(\d+)((?::[^\]]*)?)\]/g, (all, d, cm) => { if (!map[d]) map[d] = n++; return `P[${map[d]}${cm}]`; }));
          for (const d in map) { const blk = c.clip.pos[d]; if (blk) e.posText = (e.posText.trim() ? e.posText.trimEnd() + '\n' : '') + blk.replace(/^P\[\d+/, `P[${map[d]}`); }
        }
        if (how === 'posid') for (const d in c.clip.pos) if (!C.parsePositions(e.posText)[d]) e.posText = (e.posText.trim() ? e.posText.trimEnd() + '\n' : '') + c.clip.pos[d];
        e.lines.splice(this.cur.line - 1, 0, ...lines.map(text => ({ text, tpl: null })));   // pastes above the cursor line
        this.cur.line += lines.length;
      });
      this.copy.paste = false;
    }
  }
  function genericFields(t) {
    const out = []; let m, re;
    re = /\[(\d+)/g; while ((m = re.exec(t))) out.push({ s: m.index + 1, e: m.index + 1 + m[1].length, kind: 'idx' });
    re = /(=|<>|<=|>=|<|>)(-?\d+(?:\.\d+)?)(?=$|[\s,)%])/g; while ((m = re.exec(t))) out.push({ s: m.index + m[1].length, e: m.index + m[0].length, kind: 'const' });
    re = /^WAIT\s+(\d*\.?\d+)(?=\s*\(sec\))/i; if ((m = re.exec(t))) out.push({ s: m[0].length - m[1].length, e: m[0].length, kind: 'time' });
    re = /\b(ON|OFF)\b/g; while ((m = re.exec(t))) out.push({ s: m.index, e: m.index + m[1].length, kind: 'onoff' });
    out.sort((a, b) => a.s - b.s);
    return out.filter((f, i) => !i || f.s >= out[i - 1].e);
  }

  class DefaultMotionScreen {
    constructor(ctl) { this.ctl = ctl; this.row = ctl.defIdx; }
    title() { return 'Edit Default Motion'; }
    titleRight() { return `${this.row + 1}/4`; }
    body() { return this.ctl.defaults.map((d, i) => [S('  '), S(`${i + 1}:`, i === this.row ? 'cursor' : undefined), S(` ${d}`)]); }
    softkeys() { return ['', '', '', 'DONE', '']; }
    key(k) {
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row = Math.min(3, this.row + 1);
      else if (k === 'F4') { this.ctl.defIdx = this.row; this.ctl.back(); }   // unverified: editing the default lines themselves
    }
  }

  // P[n] (in a program) or PR[n] position detail
  class PosDetailScreen {
    constructor(ctl, kind, n, prog) { this.ctl = ctl; this.kind = kind; this.n = n; this.prog = prog; this.row = 0; }
    data() {
      const c = this.ctl;
      if (this.kind === 'PR') { const pr = c.settings.pr[this.n]; return pr ? { joint: pr.type === 'joint', v: pr.v, uf: 'F', ut: 'F' } : null; }
      const e = c.loadProg(this.prog); const P = e && C.parsePositions(e.posText)[this.n];
      return P ? { joint: !!P.joints, v: P.joints || P.cart, uf: P.uf, ut: P.ut, cmt: P.cmt } : null;
    }
    title() { return this.kind === 'PR' ? 'DATA Position Reg' : this.prog; }
    titleRight() { return ''; }
    body() {
      const d = this.data(), c = this.ctl;
      const head = ` ${this.kind}[${this.n}]  UF:${d ? d.uf : '*'}  UT:${d ? d.ut : '*'}     CONF:NUT 000`;
      if (!d) return [' Position Detail', head, '', '   Uninitialized'];   // unverified
      const names = d.joint ? ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] : ['X', 'Y', 'Z', 'W', 'P', 'R'];
      const unit = i => (d.joint ? 'deg' : i < 3 ? 'mm ' : 'deg');
      const cell = i => {
        const buf = c.num && c.num.target === `pd:${i}` ? c.num.buf + '_' : null;
        return [S(`   ${padR(names[i], 3)}`), S(padL(buf != null ? buf : fmt3(d.v[i]), 10), i === this.row ? 'cursor' : undefined), S(` ${unit(i)}    `)];
      };
      return [' Position Detail', head, '', [...cell(0), ...cell(3)], [...cell(1), ...cell(4)], [...cell(2), ...cell(5)]];
    }
    softkeys() { return ['', '', '', 'DONE', '[REPRE]']; }
    key(k) {
      const c = this.ctl, order = [0, 3, 1, 4, 2, 5], at = order.indexOf(this.row);
      if (k === 'UP' || k === 'LEFT') this.row = order[Math.max(0, at - 1)];
      else if (k === 'DOWN' || k === 'RIGHT') this.row = order[Math.min(5, at + 1)];
      else if (k === 'F4') c.back();
      else if (k === 'F5') c.msg = NA;
      else if (DIGIT[k] && DIGIT[k] !== ',') {
        const d = this.data(); if (!d) return;
        if (this.kind === 'P' && !c.canEdit()) return;
        const row = this.row;
        c.startNum({ init: DIGIT[k], target: `pd:${row}`, done: v => {
          const x = +v; if (!isFinite(x)) return;
          const nv = d.v.slice(); nv[row] = x;
          if (this.kind === 'PR') { c.settings.pr[this.n] = { type: d.joint ? 'joint' : 'cart', v: nv }; c.regChanged(); return; }
          const e = c.loadProg(this.prog); c.snapshotUndo(e);
          if (d.joint) { e.posText = e.posText.replace(posBlockRe(this.n), m => m.replace(new RegExp(`J${row + 1}\\s*=\\s*[-+]?\\d*\\.?\\d+`), `J${row + 1} = ${fmt3(x)}`)); }
          else c.setPosBlock(e, this.n, nv, d.uf, d.ut, true);
          c.saveProg(e);
        } });
      }
    }
  }

  class PosnScreen {
    constructor(ctl) { this.ctl = ctl; this.view = 'WORLD'; }
    title() { return 'POSITION'; }
    body() {
      const c = this.ctl, q = c.q, f = (v, w) => padL(fmt3(v), w || 9);
      const joint = [` Joint${padL(`Tool: ${c.ut}`, 52)}`,
        `   J1: ${f(q[0])}    J2: ${f(q[1])}    J3: ${f(q[2])}`,
        `   J4: ${f(q[3])}    J5: ${f(q[4])}    J6: ${f(q[5])}`,
        `   J2/J3 Interaction: ${f(q[1] + q[2])}`];   // unverified: joint signs/zero are this arm model's, not the real pendant's
      if (this.view === 'JNT') return joint;
      const uf = this.view === 'USER' ? c.uf : 0, v = c.poseIn(uf, c.ut);
      return [...joint, '', ` ${this.view === 'USER' ? 'User' : 'World'}${padL(this.view === 'USER' ? `Frame: ${uf}` : '', 50)}`, '   Configuration: N U T, 0, 0, 0',
        `   x: ${f(v[0], 10)}    y: ${f(v[1], 10)}    z: ${f(v[2], 10)}`,
        `   w: ${f(v[3], 10)}    p: ${f(v[4], 10)}    r: ${f(v[5], 10)}`];
    }
    softkeys() { return ['[ TYPE ]', 'JNT', 'USER', 'WORLD', '']; }
    key(k) { if (k === 'F2') this.view = 'JNT'; else if (k === 'F3') this.view = 'USER'; else if (k === 'F4') this.view = 'WORLD'; else if (k === 'F1') this.ctl.msg = NA; }
  }

  class DataScreen {
    constructor(ctl, type) { this.ctl = ctl; this.type = type; this.row = 0; this.col = 1; this.top = 0; }
    count() { return this.type === 'R' ? 200 : 100; }   // manual figures: 1/200 and 1/100
    title() { return this.type === 'R' ? 'DATA Registers' : 'DATA Position Reg'; }
    titleRight() { return `${this.row + 1}/${this.count()}`; }
    prompt() { return this.type === 'PR' ? 'Press ENTER' : ''; }
    body() {
      const c = this.ctl, s = c.settings, rows = [], vis = ROWS - 1;
      if (this.row < this.top) this.top = this.row; if (this.row >= this.top + vis) this.top = this.row - vis + 1;
      for (let i = this.top; i < Math.min(this.count(), this.top + vis); i++) {
        const n = i + 1, isRow = i === this.row;
        const cmt = ((this.type === 'R' ? s.rCmt : s.prCmt) || {})[n] || '';
        const cmtSeg = isRow && this.col === 0 && c.text ? c.text.segments(16) : [S(padR(cmt.slice(0, 16), 16), isRow && this.col === 0 ? 'cursor' : undefined)];
        let val;
        if (this.type === 'R') { const nb = c.num && c.num.target === `R${n}` ? c.num.buf + '_' : null; val = nb != null ? nb : numText(s.r[n] != null ? +s.r[n] : 0); }
        else val = s.pr[n] ? 'R' : '*';
        rows.push([S(`  ${this.type}[${padL(n, 4)}:`), ...cmtSeg, S(']='), S(val, isRow && this.col === 1 ? 'cursor' : undefined)]);
      }
      return rows;
    }
    softkeys() { return this.type === 'R' ? ['[ TYPE ]', '', '', '', ''] : ['[ TYPE ]', 'MOVE_TO', 'RECORD', 'POSITION', 'CLEAR']; }
    key(k, shift) {
      const c = this.ctl, s = c.settings, n = this.row + 1;
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row = Math.min(this.count() - 1, this.row + 1);
      else if (k === 'LEFT') this.col = 0;
      else if (k === 'RIGHT') this.col = 1;
      else if (k === 'F1') c.showMenu({ titleFmt: () => 'TYPE   1', pages: [['Registers', 'Position Reg', 'String Reg', 'KAREL Vars', 'KAREL Posns'].map((l, i) => ({ num: i + 1, label: l }))],
        onPick: x => { c.popup = null; if (x.num === 1 || x.num === 2) { this.type = x.num === 1 ? 'R' : 'PR'; c.dataType = this.type; this.row = 0; this.top = 0; } else c.na(`DATA ${x.label}`); } });
      else if (k === 'ENTER' && this.col === 0) {
        const key = this.type === 'R' ? 'rCmt' : 'prCmt';
        c.startText({ init: (s[key] || {})[n] || '', max: 16, prompt: 'Enter comment', done: v => { (s[key] || (s[key] = {}))[n] = v; c.regChanged(); } });
      } else if (this.type === 'R' && this.col === 1 && DIGIT[k] && DIGIT[k] !== ',') {
        c.startNum({ init: DIGIT[k], target: `R${n}`, done: v => { const x = +v; if (isFinite(x)) { s.r[n] = x; c.regChanged(); } } });
      } else if (this.type === 'PR') {
        if (k === 'F3' && shift) { const v = c.poseIn(c.uf, c.ut); s.pr[n] = { type: 'cart', v: v.map(x => +x.toFixed(3)) }; c.regChanged(); c.msg = `Position has been recorded to PR[${n}].`; }
        else if (k === 'F4') c.open(new PosDetailScreen(c, 'PR', n));
        else if (k === 'F5') { delete s.pr[n]; c.regChanged(); }   // unverified: no confirmation
        else if (k === 'F2' && shift) {
          const pr = s.pr[n]; if (!pr || !c.tpMotionOK()) { if (c.tpOn && c.mode !== 'AUTO' && c.deadman !== 'held') c.raiseDeadman(); return; }
          let q = pr.v.slice();
          if (pr.type === 'cart') {
            const w = C.toWorld(C.frameOf(c.ufVec(c.uf)), pr.v.slice(0, 3), C.wprToR(pr.v[3], pr.v[4], pr.v[5]));
            const sol = C.ik(w.p, w.R, c.tool(), c.q); if (!sol.reach) { c.raise(ALARM.REACH, 'stop'); return; } q = sol.q;
          }
          c.moveTo = { q };
        }
      }
    }
  }

  class IOScreen {
    constructor(ctl) { this.ctl = ctl; this.row = 0; this.col = 1; this.top = 0; }
    get v() { return this.ctl.ioView; }
    kinds() { return this.v.kind === 'R' ? (this.v.dir === 'out' ? 'RO' : 'RI') : (this.v.dir === 'out' ? 'DO' : 'DI'); }
    count() { return this.v.kind === 'R' ? ROBOT_IO : DIGITAL_IO; }
    title() { return `I/O ${this.v.kind === 'R' ? 'Robot' : 'Digital'} ${this.v.dir === 'out' ? 'Out' : 'In'}`; }
    titleRight() { return `${this.row + 1}/${this.count()}`; }
    body() {
      const c = this.ctl, k = this.kinds(), rows = ['            #    SIM   STATUS'], vis = ROWS - 2;
      if (this.row < this.top) this.top = this.row; if (this.row >= this.top + vis) this.top = this.row - vis + 1;
      for (let i = this.top; i < Math.min(this.count(), this.top + vis); i++) {
        const key = `${k}[${i + 1}]`, cur = i === this.row;
        rows.push([S(`    ${k}[${padL(i + 1, 6)}]    `), S(c.simIO.has(key) ? 'S' : 'U', cur && this.col === 0 ? 'cursor' : undefined), S('     '),
          S(c.ioValue(key) ? 'ON ' : 'OFF', cur && this.col === 1 ? 'cursor' : undefined), S(`    [${' '.repeat(16)}]`)]);
      }
      if (this.top + vis >= this.count()) rows.push('    Sorted by port number.');
      return rows;
    }
    more() { return true; }
    softkeys() {
      const k = this.kinds(), isIn = k === 'DI' || k === 'RI', key = `${k}[${this.row + 1}]`;
      if (this.col === 0) return ['[ TYPE ]', 'CONFIG', 'IN/OUT', 'SIMULATE', 'UNSIM'];
      if (isIn && !this.ctl.simIO.has(key)) return ['[ TYPE ]', 'CONFIG', 'IN/OUT', 'SIMULATE', 'UNSIM'];
      return ['[ TYPE ]', 'CONFIG', 'IN/OUT', 'ON', 'OFF'];
    }
    key(k) {
      const c = this.ctl, kind = this.kinds(), key = `${kind}[${this.row + 1}]`;
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row = Math.min(this.count() - 1, this.row + 1);
      else if (k === 'LEFT') this.col = 0;
      else if (k === 'RIGHT') this.col = 1;
      else if (k === 'F3') { c.ioView = { kind: this.v.kind, dir: this.v.dir === 'out' ? 'in' : 'out' }; this.row = 0; this.top = 0; }
      else if (k === 'F2') c.na('I/O Config');
      else if (k === 'F1') c.showMenu({ ...menuSpec(c).pages[0][4], titleFmt: () => 'TYPE   1', pages: [menuSpec(c).pages[0][4].fly], onPick: x => {
        c.popup = null; if (x.act === 'io:D' || x.act === 'io:R') { c.ioView = { kind: x.act[3], dir: this.v.dir }; this.row = 0; this.top = 0; } else c.na(`I/O ${x.label}`); } });
      else if (k === 'F4' || k === 'F5') {
        const lab = this.softkeys()[+k[1] - 1];
        if (lab === 'SIMULATE') c.setSim(key, true);
        else if (lab === 'UNSIM') c.setSim(key, false);
        else if (lab === 'ON' || lab === 'OFF') c.setIO(key, lab === 'ON');
      }
    }
  }

  class AlarmScreen {
    constructor(ctl) { this.ctl = ctl; this.view = 'active'; this.row = 0; }
    list() { return this.view === 'active' ? this.ctl.alarms.slice().reverse().map(a => a.text) : this.ctl.hist.slice().reverse(); }
    title() { return this.view === 'active' ? 'Alarm : Active' : 'Alarm : Hist'; }
    titleRight() { const n = this.list().length; return n ? `${this.row + 1}/${n}` : ''; }
    body() {
      const L = this.list();
      if (!L.length && this.view === 'active') return ['  There are no active alarms.', '  Press F3(HIST) to enter alarm history screen.'];
      this.row = clamp(this.row, 0, Math.max(0, L.length - 1));
      const top = Math.max(0, this.row - ROWS + 1);
      return L.slice(top, top + ROWS).map((t, i) => [S(`${padL(top + i + 1, 3)}   `), S(t, top + i === this.row ? 'cursor' : undefined)]);
    }
    softkeys() { return this.view === 'active' ? ['[ TYPE ]', '[ VIEW ]', 'HIST', 'RES_1CH', ''] : ['[ TYPE ]', '[ VIEW ]', 'ACTIVE', 'CLEAR', 'DETAIL']; }
    key(k) {
      const c = this.ctl;
      if (k === 'UP') this.row = Math.max(0, this.row - 1);
      else if (k === 'DOWN') this.row++;
      else if (k === 'F3') { this.view = this.view === 'active' ? 'hist' : 'active'; this.row = 0; }
      else if (k === 'F4' && this.view === 'hist') c.hist = [];
      else if (/^F[1-5]$/.test(k) && this.softkeys()[+k[1] - 1]) c.msg = NA;
    }
  }

  // ---------- plain-text rendering for tests ----------
  function screenText(sc) {
    const st = sc.status, L = [];
    const ind = Object.keys(st.indicators).filter(k => st.indicators[k]).join(' ');
    L.push(`ALARM: ${st.alarm || ''}`);
    L.push(`${st.fbd ? 'FBD ' : ''}${st.program || '-'} LINE ${st.line} ${st.mode} ${st.runState} ${st.coord} ${st.speed}${typeof st.speed === 'number' ? '%' : ''} [${ind}]`);
    L.push(`== ${sc.title}${sc.titleRight ? '  ' + sc.titleRight : ''}`);
    for (const r of sc.body) L.push(r.map(s => (s.style === 'cursor' ? `[[${s.text}]]` : s.text)).join('').replace(/\s+$/, ''));
    L.push(`> ${sc.prompt || ''}`);
    L.push(sc.softkeys.map(s => `[${s}]`).join(' ') + (sc.softkeysMore ? ' >' : ''));
    if (sc.popup) sc.popup.columns.forEach((cl, ci) => {
      L.push(`## ${cl.title}`);
      cl.items.forEach((x, ri) => L.push(sc.popup.cursor[0] === ci && sc.popup.cursor[1] === ri ? `[[${x}]]` : `  ${x}`));
    });
    return L.join('\n');
  }

  function create(host) {
    const c = new Ctl(host);
    return {
      dispatch: ev => c.dispatch(ev),
      screen: () => c.screen(),
      robot: () => c.robot(),
      switches: () => c.switches(),
      subscribe: fn => c.subscribe(fn),
      _ctl: c   // for tests and debugging only
    };
  }
  return { create, screenText, ROWS, COLS };
})();
if (typeof module !== 'undefined') module.exports = TPController;
