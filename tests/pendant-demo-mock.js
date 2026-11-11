// Mock controller for tests/pendant-demo.html. Implements the controller<->pendant contract from
// docs/PENDANT.md just well enough to exercise the face: two fake screens, a popup menu, echoing keys
// into the prompt line, and switch state reflected in the status bar.
const PendantMock = (() => {
  function create() {
    const st = { tp: true, mode: 'T1', estopP: false, estopC: false, dead: 'released', down: new Set(), last: '', typed: '', screen: 'select', cursor: 1,
      popup: null, page: 0, ticks: 0, ms: 0, step: false, speed: 10, coord: 'JOINT' };
    const subs = new Set();
    const PROGS = ['TEST1', 'LOOP_SQUARES', 'STACK_PARTS', 'PICK_PART', 'HOME'];
    const MENU = ['UTILITIES', 'TEST CYCLE', 'MANUAL FCTNS', 'ALARM', 'I/O', 'SETUP', 'FILE', '', 'USER'];
    const notify = () => subs.forEach(f => f());
    function alarm() {
      if (st.estopP || st.estopC) return 'SRVO-001 Operator panel E-stop';
      if (!st.tp) return 'SYST-043 TP disabled';
      return st.dead === 'held' ? '' : 'SYST-042 DEADMAN defeated';
    }
    function screen() {
      const status = {
        indicators: { busy: st.down.size > 0, step: st.step, hold: false, fault: st.estopP || st.estopC, run: false, io: false, prod: false, tcyc: false },
        alarm: alarm(), program: PROGS[st.cursor - 1], line: 0, mode: st.mode, runState: 'ABORTED', coord: st.coord,
        speed: st.down.has('SHIFT') ? 'FINE' : st.speed };
      let body, title, titleRight, softkeys;
      if (st.screen === 'select') {
        title = 'Select'; titleRight = st.cursor + '/' + PROGS.length;
        body = [[{ text: '  All        685812 bytes free', style: 'dim' }], [{ text: '  No.   Program name        Comment', style: 'title' }]]
          .concat(PROGS.map((p, i) => {
            const t = String(i + 1).padStart(5) + '   ' + p.padEnd(18) + '[' + ' '.repeat(18) + ']';
            return i + 1 === st.cursor ? [{ text: String(i + 1).padStart(5), style: 'cursor' }, { text: t.slice(5) }] : [{ text: t }];
          }));
        softkeys = st.page ? ['COPY', 'DETAIL', 'LOAD', 'SAVE AS', 'PRINT'] : ['[ TYPE ]', 'CREATE', 'DELETE', 'MONITOR', '[ ATTR ]'];
      } else {
        title = 'POSITION'; titleRight = 'Tool: 1';
        body = [[{ text: ' Joint', style: 'dim' }], [{ text: '   J1:  -16.820    J2:   17.136    J3:  -12.672' }], [{ text: '   J4:  -31.584    J5:  -34.272    J6:  -62.304' }], [],
          [{ text: ' World', style: 'dim' }], [{ text: '   Configuration: N U T, 0, 0, 0' }], [{ text: '   x:  2320.994    y:  -507.511    z:   556.943' }],
          [{ text: '   w:    48.591    p:    10.990    r:   -93.546' }], [], [{ text: ' ticks: ' + st.ticks + '  (' + Math.round(st.ms) + ' ms)', style: 'dim' }]];
        softkeys = ['[ TYPE ]', 'JNT', 'USER', 'WORLD', ''];
      }
      return { status, title, titleRight, body,
        prompt: st.typed ? 'Entered: ' + st.typed : (st.last ? 'Last key: ' + st.last + (st.down.size ? '   held: ' + [...st.down].join('+') : '') : 'Press a key'),
        softkeys, softkeysMore: true,
        popup: st.popup ? { columns: [{ title: 'MENU   1', items: MENU.map((m, i) => (m ? (i + 1) % 10 + ' ' + m : (i + 1) + '')).concat(['0 -- NEXT --']) }], cursor: [0, st.popup.row] } : null };
    }
    function key(k) {
      st.last = k;
      if (/^D\d$/.test(k)) st.typed += k[1]; else if (k === 'DOT') st.typed += '.'; else if (k === 'MINUS') st.typed += '-'; else if (k === 'COMMA') st.typed += ',';
      else if (k === 'BACKSPACE') st.typed = st.typed.slice(0, -1);
      if (k === 'MENU') st.popup = st.popup ? null : { row: 0 };
      else if (st.popup && k === 'DOWN') st.popup.row = Math.min(9, st.popup.row + 1);
      else if (st.popup && k === 'UP') st.popup.row = Math.max(0, st.popup.row - 1);
      else if (st.popup && (k === 'ENTER' || k === 'PREV')) st.popup = null;
      else if (k === 'SELECT') st.screen = 'select';
      else if (k === 'POSN') st.screen = 'posn';
      else if (k === 'DOWN') st.cursor = Math.min(PROGS.length, st.cursor + 1);
      else if (k === 'UP') st.cursor = Math.max(1, st.cursor - 1);
      else if (k === 'NEXT') st.page = 1 - st.page;
      else if (k === 'STEP') st.step = !st.step;
      else if (k === 'COORD') st.coord = { JOINT: 'JGFRM', JGFRM: 'WORLD', WORLD: 'TOOL', TOOL: 'USER', USER: 'JOINT' }[st.coord];
      else if (k === 'ENTER') st.typed = '';
    }
    return {
      dispatch(e) {
        if (e.type === 'tick') { st.ticks++; st.ms += e.dtMs; if (st.ticks % 30 === 0 && st.screen === 'posn') notify(); window.__ticks = st.ticks; return; }
        if (e.type === 'keyDown') { st.down.add(e.key); key(e.key); }
        else if (e.type === 'keyUp') st.down.delete(e.key);
        else if (e.type === 'tpEnable') st.tp = e.on;
        else if (e.type === 'deadman') st.dead = e.state;
        else if (e.type === 'estop') { if (e.source === 'panel') st.estopC = e.pressed; else st.estopP = e.pressed; }
        else if (e.type === 'modeSwitch') st.mode = e.mode;
        notify();
      },
      screen, robot: () => ({ q: [0, 0, 0, 0, 0, 0], tool: 1, moving: false, servoOn: st.dead === 'held' && st.tp, uf: 0, ut: 1 }),
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    };
  }
  return { create };
})();
