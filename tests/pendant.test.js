// Run with: node tests/pendant.test.js
// Key-script tests for the live pendant controller (site/js/controller.js). Node, no dependencies.
const fs = require('fs'), path = require('path');
const core = require('../site/js/core.js');
const TP = require('../site/js/controller.js');
const ex = path.join(__dirname, '../site/examples');

let fails = 0;
const check = (name, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra && !cond ? '\n' + extra : '')); if (!cond) fails++; };

// ---- host stub: the app.js workspace shape ----
function makeHost(files, settings) {
  const store = {};
  for (const f of files || []) { const s = core.splitLS(fs.readFileSync(path.join(ex, f), 'utf8')); store[s.name] = { name: s.name, header: s.header, lines: s.mn, posText: s.posText }; }
  return {
    store,
    listPrograms: () => Object.keys(store),
    getProgram: n => (store[n] ? JSON.parse(JSON.stringify(store[n])) : undefined),
    saveProgram: p => { store[p.name] = JSON.parse(JSON.stringify(p)); },
    deleteProgram: n => { delete store[n]; },
    settings: { tools: { 1: [0, 0, 100, 0, 0, 0] }, uframes: {}, pr: {}, r: {}, inputs: {}, comp: 3, tol: 1, ...(settings || {}) }
  };
}

// ---- key-script helper ----
const DIG = { 0: 'D0', 1: 'D1', 2: 'D2', 3: 'D3', 4: 'D4', 5: 'D5', 6: 'D6', 7: 'D7', 8: 'D8', 9: 'D9', '.': 'DOT', '-': 'MINUS' };
function rig(files, settings) {
  const host = makeHost(files, settings), ctl = TP.create(host), c = ctl._ctl;
  const ev = e => ctl.dispatch(e);
  const h = {
    host, ctl, c,
    down: k => ev({ type: 'keyDown', key: k }), up: k => ev({ type: 'keyUp', key: k }),
    // press('F1', 'SHIFT+F5', ...): each key down and up; "SHIFT+" holds SHIFT around it
    press(...keys) {
      for (const k of keys) {
        if (k.startsWith('SHIFT+')) { h.down('SHIFT'); h.down(k.slice(6)); h.up(k.slice(6)); h.up('SHIFT'); }
        else { h.down(k); h.up(k); }
      }
      return h;
    },
    type(s) { for (const ch of String(s)) h.press(DIG[ch]); return h; },
    num(s) { h.type(s); h.press('ENTER'); return h; },
    tp: on => ev({ type: 'tpEnable', on }), dm: state => ev({ type: 'deadman', state }),
    mode: m => ev({ type: 'modeSwitch', mode: m }), estop: (source, pressed) => ev({ type: 'estop', source, pressed }),
    tick(ms, n) { for (let i = 0; i < (n || 1); i++) ev({ type: 'tick', dtMs: ms }); return h; },
    tickUntil(fn, ms, max) { for (let i = 0; i < (max || 5000) && !fn(); i++) ev({ type: 'tick', dtMs: ms || 100 }); return fn(); },
    text: () => TP.screenText(ctl.screen()),
    st: () => ctl.screen().status,
    has: s => TP.screenText(ctl.screen()).includes(s),
    // TP enabled, deadman held, faults reset: ready to jog / test
    ready() { h.tp(true); h.dm('held'); h.press('RESET'); return h; },
    lines: name => host.store[name].lines,
    tip: () => core.fk(ctl.robot().q, ctl.robot().tool).tip
  };
  return h;
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) < (tol || 1e-6));

// ===== 1. Power-up, alarm line, RESET, E-stop, deadman =====
{ const h = rig();
  check('1 power-up: TP off in T1 shows SYST-043 and FAULT', h.st().alarm === 'SYST-043 TP disabled in T1/T2 mode' && h.st().indicators.fault);
  check('1 power-up: JOINT, 10 %, ABORTED, UTILITIES Hints screen', h.st().coord === 'JOINT' && h.st().speed === 10 && h.st().runState === 'ABORTED' && h.has('UTILITIES Hints'));
  h.press('RESET');
  check('1 RESET does not clear a fault whose cause remains', h.st().indicators.fault);
  h.tp(true);
  check('1 enabling the TP with the deadman released raises SRVO-003', h.st().alarm === 'SRVO-003 Deadman switch released');
  h.press('RESET');
  check('1 RESET with the deadman still released keeps SRVO-003', h.st().alarm === 'SRVO-003 Deadman switch released' && !h.ctl.robot().servoOn);
  h.dm('held'); h.press('RESET');
  check('1 deadman held + RESET clears every fault and servo comes on', h.st().alarm === '' && !h.st().indicators.fault && h.ctl.robot().servoOn);
  h.dm('clenched');
  check('1 squeezing the deadman fully is a release: SRVO-003', h.st().alarm === 'SRVO-003 Deadman switch released' && h.st().indicators.fault);
  h.dm('held'); h.press('RESET');
  h.estop('pendant', true);
  check('1 pendant E-stop: SRVO-002, servo off', h.st().alarm === 'SRVO-002 Teach pendant E-stop' && !h.ctl.robot().servoOn);
  h.press('RESET');
  check('1 RESET while the E-stop is pressed keeps the fault', h.st().indicators.fault);
  h.estop('pendant', false); h.press('RESET');
  check('1 releasing the E-stop then RESET clears it', !h.st().indicators.fault);
  h.estop('panel', true);
  check('1 operator panel E-stop: SRVO-001', h.st().alarm === 'SRVO-001 Operator panel E-stop');
  h.estop('panel', false); h.press('RESET');
  check('1 history logs RESET', h.c.hist.includes('R E S E T')); }

// ===== 2. Enable switch and T1 / T2 / AUTO =====
{ const h = rig().ready();
  h.mode('T2');
  check('2 mode change shows the operation-mode message', h.st().alarm === 'SYST-039 Operation mode T2 Selected' && h.st().mode === 'T2' && !h.st().indicators.fault);
  h.mode('AUTO');
  check('2 AUTO with TP enabled faults', h.c.alarms.some(a => a.text === 'Teach Pendant Enabled in AUTO') && h.st().indicators.fault);
  check('2 AUTO with deadman held: SYST-042 DEADMAN defeated', h.c.alarms.some(a => a.text === 'SYST-042 DEADMAN defeated'));
  h.tp(false); h.press('RESET');
  check('2 RESET keeps SYST-042 while the deadman is still held', h.c.alarms.some(a => a.text === 'SYST-042 DEADMAN defeated'));
  h.dm('released'); h.press('RESET');
  check('2 AUTO, TP off, deadman released: no faults', !h.st().indicators.fault);
  h.down('SHIFT'); h.down('J1_POS'); h.tick(500); h.up('J1_POS'); h.up('SHIFT');
  check('2 no jogging in AUTO', near(h.ctl.robot().q, core.HOME));
  h.mode('T1');
  check('2 back to T1 with TP off: SYST-043', h.st().alarm === 'SYST-043 TP disabled in T1/T2 mode'); }

// ===== 3. Jogging: deadman, SHIFT, TP, COORD, speed keys, reach =====
{ const h = rig();
  h.down('SHIFT'); h.down('J1_POS'); h.tick(500); h.up('J1_POS');
  check('3 jog with TP off is refused and re-raises SYST-043', near(h.ctl.robot().q, core.HOME) && h.st().alarm === 'SYST-043 TP disabled in T1/T2 mode');
  h.up('SHIFT');
  h.tp(true); h.press('RESET');
  h.down('SHIFT'); h.down('J1_POS'); h.tick(500); h.up('J1_POS'); h.up('SHIFT');
  check('3 jog without deadman is refused: SRVO-003', near(h.ctl.robot().q, core.HOME) && h.st().alarm === 'SRVO-003 Deadman switch released');
  h.dm('held'); h.press('RESET');
  h.down('J1_POS'); h.tick(500); h.up('J1_POS');
  check('3 jog key without SHIFT does nothing (no alarm)', near(h.ctl.robot().q, core.HOME) && !h.st().indicators.fault);
  h.down('SHIFT'); h.down('J1_POS'); h.tick(100, 10);
  const q1 = h.ctl.robot().q;
  check('3 SHIFT + J1+ in JOINT at 10 % turns J1 about 3 deg/s', Math.abs(q1[0] - 3) < 1e-6 && q1.slice(1).every((v, i) => v === core.HOME[i + 1]), q1.join(','));
  check('3 busy indicator while jogging', h.st().indicators.busy);
  h.up('J1_POS'); h.tick(500);
  check('3 releasing the jog key stops motion', Math.abs(h.ctl.robot().q[0] - 3) < 1e-6);
  h.down('J1_POS'); h.dm('released'); h.tick(500); h.up('J1_POS'); h.up('SHIFT');
  check('3 releasing the deadman mid-jog stops and alarms', Math.abs(h.ctl.robot().q[0] - 3) < 1e-6 && h.st().alarm === 'SRVO-003 Deadman switch released');
  h.dm('held'); h.press('RESET');
  const seen = []; for (let i = 0; i < 5; i++) { h.press('COORD'); seen.push(h.st().coord); }
  check('3 COORD cycles JGFRM WORLD TOOL USER JOINT', seen.join() === 'JGFRM,WORLD,TOOL,USER,JOINT', seen.join());
  h.press('COORD', 'COORD');
  const t0 = h.tip();
  h.down('SHIFT'); h.down('J1_POS'); h.tick(100, 10); h.up('J1_POS'); h.up('SHIFT');
  const t1 = h.tip();
  check('3 WORLD X+ moves the tool 25 mm along X only', Math.abs(t1[0] - t0[0] - 25) < 1e-6 && Math.abs(t1[1] - t0[1]) < 1e-6 && Math.abs(t1[2] - t0[2]) < 1e-6, t1.map((v, i) => v - t0[i]).join(','));
  h.down('SHIFT'); h.down('J3_NEG'); h.tick(100, 4); h.up('J3_NEG'); h.up('SHIFT');
  check('3 WORLD Z- moves down', Math.abs(h.tip()[2] - (t1[2] - 10)) < 1e-6);
  // speed keys
  h.press('SPEED_UP'); const a = h.st().speed;
  h.press('SPEED_DOWN', 'SPEED_DOWN'); const b = h.st().speed;
  h.press('SPEED_DOWN', 'SPEED_DOWN', 'SPEED_DOWN', 'SPEED_DOWN', 'SPEED_DOWN', 'SPEED_DOWN'); const c2 = h.st().speed;
  check('3 +%/-% step 10->15, 15->5, then 4 3 2 1 FINE VFINE', a === 15 && b === 5 && c2 === 'VFINE', [a, b, c2].join());
  const up = []; for (let i = 0; i < 5; i++) { h.press('SHIFT+SPEED_UP'); up.push(h.st().speed); }
  check('3 SHIFT + +% steps FINE 5 50 100', up.join() === 'FINE,5,50,100,100', up.join());
  h.press('SHIFT+SPEED_DOWN', 'SHIFT+SPEED_DOWN');
  check('3 SHIFT + -% steps back 50, 5', h.st().speed === 5);
  h.press('SHIFT+SPEED_DOWN');
  const tf = h.tip(); h.down('SHIFT'); h.down('J2_POS'); h.tick(100, 10); h.up('J2_POS'); h.up('SHIFT');
  check('3 FINE jog moves one small increment per press', Math.abs(h.tip()[1] - tf[1] - 0.1) < 1e-6 && h.st().speed === 'FINE');
  // out of reach
  for (let i = 0; i < 3; i++) h.press('SHIFT+SPEED_UP');
  h.down('SHIFT'); h.down('J1_POS'); h.tick(100, 200); h.up('J1_POS'); h.up('SHIFT');
  check('3 jogging out of reach stops with MOTN-018', h.st().alarm === 'MOTN-018 Position not reachable' && h.st().indicators.fault);
  h.press('RESET');
  check('3 RESET clears MOTN-018', !h.st().indicators.fault);
  h.press('SHIFT+COORD');
  check('3 SHIFT+COORD opens the jog menu', h.has('Tool (.=10)  1') && h.has('Jog Coordinate System (press and hold to set)') && h.has('[JOINT] [JGFRM] [WORLD] [TOOL] [USER]'));
  h.press('DOWN', 'DOWN'); h.num(2); h.press('F5', 'PREV');
  check('3 jog menu sets the user frame number and coordinate', h.c.uf === 2 && h.st().coord === 'USER'); }

// ===== 4. POSN screen =====
{ const h = rig().ready();
  h.press('POSN');
  check('4 POSN shows joint and world boxes', h.has('== POSITION') && h.has('J1:') && h.has('J2/J3 Interaction') && h.has(' World') && h.has('[[ TYPE ]] [JNT] [USER] [WORLD]'.replace('[[', '[')));
  h.press('F2');
  check('4 JNT shows joints only', h.has('J5:') && !h.has(' World'));
  h.press('F3');
  check('4 USER shows the user frame position', h.has(' User') && h.has('Frame: 0'));
  const before = h.text();
  h.down('SHIFT'); h.down('J1_POS'); h.tick(100, 5); h.up('J1_POS'); h.up('SHIFT');
  check('4 POSN updates live while jogging', h.text() !== before); }

// ===== 5. SELECT: create, open, copy, delete, detail; name entry =====
{ const h = rig().ready();
  h.press('SELECT');
  check('5 SELECT lists programs with soft keys', h.has('== Select') && h.has('[[ TYPE ]] [CREATE] [DELETE] [MONITOR] [[ ATTR ]] >'));
  h.press('F2');
  check('5 CREATE shows the name entry and Alpha input menu', h.has('--- Create Teach Pendant Program ---') && h.has('Enter program name') && h.has('## Alpha input 1') && h.has('[ABCDEF] [GHIJKL]'));
  h.press('F1', 'F1', 'F1', 'F4', 'F4');   // multi-tap: C then T (F4 STUVWX: S, T)
  h.type('1');
  h.press('ENTER');
  check('5 typed name accepted, then Select function', h.has('Select function') && h.has('[DETAIL] [EDIT]') && h.has('CT1'));
  h.press('F3');
  check('5 F3 EDIT creates and opens the empty program', h.has('== CT1  1/1') && h.has('[[[End]]]') && h.host.store.CT1 && h.st().program === 'CT1');
  h.press('SELECT', 'F2');
  h.ctl.dispatch({ type: 'text', text: 'bad name' }); h.press('ENTER');
  check('5 a name with a space is refused', h.has('Invalid program name') && !h.host.store['BAD NAME']);
  h.press('PREV');
  h.press('SELECT', 'F2'); h.press('DOWN'); h.press('F3');   // Lower Case: F3 = mnopqr
  h.press('ENTER');
  check('5 lower case letters become upper case after create', h.has('Select function'));
  h.press('F2');
  check('5 F2 DETAIL opens Program detail', h.has('== Program detail') && h.has('[END] [PREV] [NEXT] [[CHOICE]]') && h.host.store.M);
  h.press('DOWN', 'DOWN', 'ENTER'); h.ctl.dispatch({ type: 'text', text: 'Drawing' }); h.press('ENTER');
  check('5 comment set from the detail screen', /COMMENT\s*=\s*"Drawing"/.test(h.host.store.M.header) && h.has('Drawing'));
  h.press('F1');
  check('5 END goes to the edit screen', h.has('== M  1/1'));
  h.press('SELECT');
  check('5 Select shows the comment', h.has('[Drawing         ]'));
  // copy
  h.press('NEXT');
  check('5 NEXT shows page 2', h.has('[COPY] [DETAIL] [LOAD] [SAVE AS] [PRINT]'));
  h.press('F1'); h.ctl.dispatch({ type: 'text', text: 'CT2' }); h.press('ENTER');
  check('5 COPY makes a new program', !!h.host.store.CT2 && h.has('CT2'));
  h.press('NEXT');
  const row = h.ctl._ctl.top().list().indexOf('CT2'); h.ctl._ctl.top().row = row;
  h.press('F3');
  check('5 DELETE asks YES/NO', h.has('Delete CT2?') && h.has('[YES] [NO]'));
  h.press('F4');
  check('5 YES deletes', !h.host.store.CT2);
  h.press('MENU');
  check('5 MENU page 1 matches the manual', h.has('## MENU   1') && h.has('1 UTILITIES  >') && h.has('4 ALARM  >') && h.has('0 -- NEXT --'));
  h.press('D2');
  check('5 unknown menu items say Not available', h.has('Not available in the trainer')); }

// ===== 6. EDIT: record, default motion, cursor editing, TOUCHUP, position detail, comments =====
function newProgram(h, name) {
  h.press('SELECT', 'F2'); h.ctl.dispatch({ type: 'text', text: name }); h.press('ENTER', 'F3');
}
function jog(h, key, ms) { h.down('SHIFT'); h.down(key); h.tick(100, ms / 100); h.up(key); h.up('SHIFT'); }
{ const h = rig().ready();
  newProgram(h, 'PTS');
  h.press('SHIFT+F1'); jog(h, 'J1_POS', 1000); h.press('SHIFT+F1'); jog(h, 'J2_POS', 1000); h.press('SHIFT+F1');
  check('6 SHIFT+POINT records three points with the default J P[] 100% FINE', h.lines('PTS').join('|') === 'J P[1] 100% FINE|J P[2] 100% FINE|J P[3] 100% FINE', h.lines('PTS').join('|'));
  const pos = core.parsePositions(h.host.store.PTS.posText);
  check('6 three /POS blocks in UF 0 / UT 1', Object.keys(pos).length === 3 && pos[3].uf === 0 && pos[3].ut === 1);
  check('6 edit screen shows the lines and @ at the current point', h.has('   3:J @P[3] 100% FINE') && h.has('   1:J  P[1] 100% FINE'), h.text());
  const rt = core.parseLS(core.toLS(core.makeProgram('PTS', h.host.store.PTS.header, h.lines('PTS'), h.host.store.PTS.posText)));
  check('6 saved program round-trips through toLS/parseLS', JSON.stringify(rt.lines) === JSON.stringify(h.lines('PTS')) && Object.keys(rt.pos).length === 3);
  const p2 = pos[2].cart;
  check('6 P[2] matches the arm pose where it was recorded', near(p2.slice(0, 3), core.fk([3, 0, 0, 0, -90, 0], { p: [0, 0, 100], R: core.wprToR(0, 0, 0) }).tip, 0.001));
  // POINT without SHIFT: Select Motion pop-up, pick a default and record with it
  h.press('F1');
  check('6 POINT opens Select Motion with the four defaults', h.has('## Select Motion 1/1') && h.has('1: J P[] 100% FINE') && h.has('4: L P[] 100mm/sec CNT100') && h.has('[ED_DEF]'));
  h.press('DOWN', 'DOWN', 'ENTER');
  check('6 ENTER records with that default', h.lines('PTS')[3] === 'L P[4] 100mm/sec FINE');
  h.press('SHIFT+F1');
  check('6 it becomes the default for SHIFT+POINT', h.lines('PTS')[4] === 'L P[5] 100mm/sec FINE');
  h.press('F1', 'F1');
  check('6 ED_DEF opens Edit Default Motion', h.has('== Edit Default Motion') && h.has('[DONE]'));
  h.press('UP', 'UP', 'F4');
  check('6 DONE sets the default without recording', h.c.defIdx === 0 && h.lines('PTS').length === 5);
  // cursor editing of line 1
  h.press('ITEM'); h.num(1);
  h.press('RIGHT');
  check('6 cursor on the motion type offers [CHOICE]', h.has('[[J]]') && h.has('[POINT] [] [] [[CHOICE]] [TOUCHUP]'));
  h.press('F4');
  check('6 Motion Modify pop-up', h.has('## Motion Modify 1/1') && h.has('1 Joint') && h.has('4 Circle Arc'));
  h.press('D2');
  check('6 J -> L converts the speed (manual figure)', h.lines('PTS')[0] === 'L P[1] 3000mm/sec FINE', h.lines('PTS')[0]);
  h.press('RIGHT');
  check('6 cursor on the position offers POSITION', h.has('[[P[1]]]') && h.has('[[CHOICE]] [POSITION]'));
  h.press('RIGHT'); h.num(500);
  check('6 typing a speed changes it', h.lines('PTS')[0] === 'L P[1] 500mm/sec FINE');
  h.press('F4', 'D2');
  check('6 speed units for L', h.lines('PTS')[0] === 'L P[1] 500cm/min FINE');
  h.press('RIGHT', 'F4', 'D2'); h.num(50);
  check('6 termination FINE -> CNT50', h.lines('PTS')[0] === 'L P[1] 500cm/min CNT50', h.lines('PTS')[0]);
  h.press('LEFT', 'LEFT', 'F5');
  check('6 POSITION shows the point detail', h.has('Position Detail') && h.has('P[1]  UF:0  UT:1') && h.has('X') && h.has('[DONE]'));
  h.press('F4');
  // TOUCHUP line 2
  h.press('DOWN'); jog(h, 'J3_POS', 1000);
  const old2 = core.parsePositions(h.host.store.PTS.posText)[2].cart;
  h.press('SHIFT+F5');
  const new2 = core.parsePositions(h.host.store.PTS.posText)[2].cart;
  check('6 TOUCHUP rewrites P[2] and confirms', h.has('Position has been recorded to P[2].') && !near(old2, new2, 0.01) && /J @(\[\[)?P\[2\]/.test(h.text()));
  check('6 TOUCHUP keeps motion type, speed and termination', h.lines('PTS')[1] === 'J P[2] 100% FINE');
  // shared ID -> Set New ID
  h.host.store.PTS.lines.push('J P[2] 50% FINE'); h.press('ITEM'); h.num(6); jog(h, 'J3_POS', 500);
  h.press('SHIFT+F5');
  check('6 TOUCHUP of a shared position asks Set New ID', h.has('Set New ID') && h.has('[YES] [NO]'));
  h.press('F4');
  check('6 YES gives the line a new ID', h.lines('PTS')[5] === 'J P[6] 50% FINE' && h.has('Position has been recorded to P[6].'));
  // comments
  h.host.store.PTS.lines.push('J PR[4:HOME] 100% FINE');
  h.press('ITEM'); h.num(7);
  check('6 position-register comments shown', h.has('PR[4:HOME]'));
  h.press('NEXT', 'F5', 'D7');
  check('6 EDCMD Comment hides them', h.has('Comment Disabled') && h.has('PR[4]') && !h.has('PR[4:HOME]'));
  h.press('F5', 'D7'); }

// ===== 7. EDCMD: insert, delete, copy/paste, undo, remark =====
{ const h = rig().ready();
  newProgram(h, 'ED');
  for (let i = 0; i < 3; i++) { h.press('SHIFT+F1'); jog(h, 'J1_POS', 300); }
  h.press('ITEM'); h.num(2);
  h.press('NEXT', 'F5');
  check('7 EDCMD pop-up matches the manual', h.has('## EDCMD   1') && h.has('1 Insert') && h.has('3 Copy/Cut') && h.has('9 Remark'));
  h.press('D1'); h.num(2);
  check('7 Insert adds blank lines above the cursor', h.lines('ED').join('|') === 'J P[1] 100% FINE|||J P[2] 100% FINE|J P[3] 100% FINE', h.lines('ED').join('|'));
  h.press('F5', 'D2');
  check('7 Delete asks for confirmation', h.has('Delete line(s)?') && h.has('[YES] [NO]'));
  h.press('DOWN', 'F4');
  check('7 Delete removes the selected range', h.lines('ED').join('|') === 'J P[1] 100% FINE|J P[2] 100% FINE|J P[3] 100% FINE');
  h.press('ITEM'); h.num(1);
  h.press('F5', 'D3', 'F2', 'DOWN', 'F2');
  check('7 Copy keeps the lines on the clipboard', h.c.clip && h.c.clip.lines.length === 2);
  h.press('ITEM'); h.num(4);
  h.press('F5');
  check('7 PASTE offers the paste methods', h.has('[LOGIC] [POS-ID] [POSITION] [CANCEL]'));
  h.press('F3');
  check('7 POS-ID paste keeps the position numbers', h.lines('ED').slice(3).join('|') === 'J P[1] 100% FINE|J P[2] 100% FINE', h.lines('ED').join('|'));
  h.press('F5', 'F4');
  const L = h.lines('ED');
  check('7 POSITION paste renumbers and copies the data', L.length === 7 && /P\[4\]/.test(L[5]) && /P\[5\]/.test(L[6]) && !!core.parsePositions(h.host.store.ED.posText)[5], L.join('|'));
  h.press('F5', 'F2');
  check('7 LOGIC paste leaves positions blank', h.lines('ED').filter(t => t.includes('P[...]')).length === 2);
  h.press('PREV');
  h.press('F5', 'D8', 'F4');
  check('7 Undo reverts the last change', h.lines('ED').length === 7);
  h.press('ITEM'); h.num(1); h.press('F5', 'D9', 'F4');
  check('7 Remark comments the line out with //', h.lines('ED')[0] === '//J P[1] 100% FINE'); }

// ===== 8. INST: registers, I/O, IF/SELECT, WAIT, JMP/LBL, CALL, frames =====
{ const h = rig().ready();
  newProgram(h, 'SUBA'); newProgram(h, 'INS');
  const inst = (...keys) => { h.press('ITEM'); h.num(h.lines('INS').length + 1); h.press('F1', ...keys); };
  h.press('NEXT', 'F1');
  check('8 INST pop-up page 1', h.has('## Instruction 1/3') && h.has('1 Registers') && h.has('7 Miscellaneous') && h.has('8 --next page--'));
  h.press('D1');
  check('8 Registers templates', h.has('## REGISTER statement 1/2') && h.has('1 ...=...'));
  h.press('D1');
  check('8 LHS type pop-up', h.has('1 R[ ]') && h.has('3 PR[i,j]'));
  h.press('D1'); h.num(1);
  check('8 value type pop-up', h.has('2 Constant') && h.has('R[1]=[[...]]'));
  h.press('D2'); h.num(5);
  check('8 R[1]=5 built from the pop-ups', h.lines('INS')[0] === 'R[1]=5', h.lines('INS').join('|'));
  inst('D1', 'D2', 'D1'); h.num(2); h.press('D1'); h.num(1); h.press('D2'); h.num(1);
  check('8 R[2]=R[1]+1', h.lines('INS')[1] === 'R[2]=R[1]+1', h.lines('INS').join('|'));
  inst('D5', 'D2'); h.num(3);
  check('8 LBL[3]', h.lines('INS')[2] === 'LBL[3]');
  inst('D2', 'D1'); h.num(2); h.press('D1');
  check('8 DO[2]=ON via I/O statement', h.lines('INS')[3] === 'DO[2]=ON');
  inst('D4', 'D2', 'D2'); h.num(1); h.press('D1');
  check('8 WAIT DI[1]=ON', h.lines('INS')[4] === 'WAIT DI[1]=ON');
  inst('D4', 'D1', 'D1'); h.num(0.5);
  check('8 WAIT 0.50(sec)', h.lines('INS')[5] === 'WAIT 0.50(sec)');
  inst('D3', 'D4', 'D1'); h.num(2); h.press('D2'); h.num(3); h.press('D1'); h.num(3);
  check('8 IF R[2]<3,JMP LBL[3]', h.lines('INS')[6] === 'IF R[2]<3,JMP LBL[3]', h.lines('INS').join('|'));
  inst('D3', 'D8', 'D4'); h.num(1); h.num(5); h.press('D2');
  check('8 CALL picks from the program list', h.has('## PROGRAM 1/1') && h.has('[PROGRAM] [MACRO]'));
  h.press('D2');
  check('8 SELECT R[1]=5,CALL SUBA', h.lines('INS')[7] === 'SELECT R[1]=5,CALL SUBA', h.lines('INS').join('|'));
  inst('D3', 'D8', 'D6', 'D1'); h.num(3);
  check('8 <select> ELSE,JMP LBL[3]', h.lines('INS')[8] === 'ELSE,JMP LBL[3]');
  inst('D8', 'D3', 'D2', 'D2'); h.num(0);
  check('8 UFRAME_NUM=0 via Offset/Frames', h.lines('INS')[9] === 'UFRAME_NUM=0');
  inst('D8', 'D3', 'D3', 'D2'); h.num(1);
  check('8 UTOOL_NUM=1', h.lines('INS')[10] === 'UTOOL_NUM=1');
  inst('D6', 'D1', 'D2');
  check('8 CALL SUBA', h.lines('INS')[11] === 'CALL SUBA');
  inst('D5', 'D1'); h.num(3);
  check('8 JMP LBL[3]', h.lines('INS')[12] === 'JMP LBL[3]');
  inst('D7', 'D5'); h.ctl.dispatch({ type: 'text', text: 'done' }); h.press('ENTER');
  check('8 Remark from Miscellaneous', h.lines('INS')[13] === '!done');
  inst('D1', 'D1', 'D1');
  h.press('ITEM'); h.num(2);
  check('8 an unfinished line keeps its ... placeholders', h.lines('INS')[14] === 'R[...]=...');
  const p = core.makeProgram('INS', '', h.lines('INS').slice(0, 14), '');
  check('8 every finished instruction parses', p.ins.every(i => i.type !== 'error' && i.type !== 'unknown'), p.ins.filter(i => i.type === 'error').map(i => i.text + ': ' + i.error).join('; '));
  h.press('RIGHT'); h.num(9);
  check('8 cursor editing a register index', h.lines('INS')[1] === 'R[9]=R[1]+1'); }

// ===== 9. DATA: registers and position registers =====
{ const h = rig().ready();
  h.press('DATA');
  check('9 DATA Registers', h.has('== DATA Registers  1/200') && h.has('R[   1:'));
  h.num(7);
  check('9 typing a value sets R[1]', h.host.settings.r[1] === 7 && h.has(']=[[7]]'));
  h.press('LEFT', 'ENTER'); h.ctl.dispatch({ type: 'text', text: 'Count' }); h.press('ENTER');
  check('9 register comment', h.host.settings.rCmt[1] === 'Count' && /R\[   1:(\[\[)?Count/.test(h.text()));
  h.press('F1', 'D2');
  check('9 TYPE -> Position Reg', h.has('== DATA Position Reg  1/100') && h.has('PR[   1:') && h.has(']=*') && h.has('[MOVE_TO] [RECORD] [POSITION] [CLEAR]'));
  h.press('F3');
  check('9 RECORD needs SHIFT', !h.host.settings.pr[1]);
  h.press('SHIFT+F3');
  check('9 SHIFT+RECORD stores the current position', h.host.settings.pr[1] && h.host.settings.pr[1].type === 'cart' && h.has(']=R') && h.has('Position has been recorded to PR[1].'));
  h.press('F4');
  check('9 POSITION shows PR detail with UF:F UT:F', h.has('PR[1]  UF:F  UT:F') && h.has('X'));
  h.num(500);
  check('9 editing X in the PR detail', h.host.settings.pr[1].v[0] === 500);
  h.press('F4');
  jog(h, 'J1_POS', 1000);
  h.press('RIGHT', 'UP');
  h.ctl._ctl.top().row = 0;
  h.down('SHIFT'); h.down('F2'); h.tick(100, 100); h.up('F2'); h.up('SHIFT');
  const w = core.toWorld(core.frameOf([0, 0, 0, 0, 0, 0]), h.host.settings.pr[1].v.slice(0, 3), core.wprToR(...h.host.settings.pr[1].v.slice(3)));
  check('9 SHIFT+MOVE_TO drives to the PR', Math.hypot(...core.fk(h.ctl.robot().q, h.ctl.robot().tool).tip.map((v, i) => v - w.p[i])) < 0.01); }

// ===== 10. I/O: view and simulate =====
{ const h = rig().ready();
  h.press('IO');
  check('10 I/O Digital Out', h.has('== I/O Digital Out  1/512') && h.has('DO[     1]') && h.has('[ON] [OFF]'));
  h.press('F4');
  check('10 F4 ON forces DO[1]', h.c.out['DO[1]'] === 1 && h.has('[[ON ]]'));
  h.press('F3');
  check('10 IN/OUT -> Digital In', h.has('== I/O Digital In') && h.has('[SIMULATE] [UNSIM]'));
  h.press('LEFT', 'F4');
  check('10 SIMULATE marks S', h.has('[[S]]') && h.c.simIO.has('DI[1]'));
  h.press('RIGHT');
  check('10 simulated input offers ON/OFF', h.has('[ON] [OFF]'));
  h.press('F4');
  check('10 simulated DI[1] ON', h.host.settings.inputs['DI[1]'].v === 1 && h.has('[[ON ]]'));
  h.press('FCTN', 'D0', 'D6');
  check('10 FCTN UNSIM ALL I/O', !h.c.simIO.size && h.has('  U     OFF')); }

// ===== 11. Test running =====
function progHost(h, name, lines, posText) { h.host.store[name] = { name, header: '', lines, posText: posText || '' }; }
{ const h = rig().ready();
  newProgram(h, 'RUN');
  h.press('SHIFT+F1'); jog(h, 'J1_POS', 1000); h.press('SHIFT+F1'); jog(h, 'J2_POS', 1000); h.press('SHIFT+F1');
  h.host.store.RUN.lines.splice(1, 0, 'R[1]=R[1]+1');   // 1 J P[1], 2 R[1]=..., 3 J P[2], 4 J P[3]
  const P = core.parsePositions(h.host.store.RUN.posText);
  const atP = n => near(core.fk(h.ctl.robot().q, h.ctl.robot().tool).tip, core.toWorld(core.frameOf([0, 0, 0, 0, 0, 0]), P[n].cart.slice(0, 3), core.wprToR(...P[n].cart.slice(3))).p, 0.01);
  jog(h, 'J3_NEG', 1000);
  h.press('ITEM'); h.num(1);
  h.press('STEP');
  check('11 STEP lights the Step indicator', h.st().indicators.step);
  h.down('SHIFT'); h.press('FWD');
  check('11 SHIFT+FWD starts line 1', h.st().runState === 'RUNNING' && h.st().line === 1);
  h.tickUntil(() => h.st().runState !== 'RUNNING');
  check('11 STEP: line 1 runs to P[1] and pauses', h.st().runState === 'PAUSED' && h.st().line === 1 && atP(1));
  h.press('FWD'); h.tickUntil(() => h.st().runState !== 'RUNNING');
  check('11 STEP: line 2 (logic) runs on its own', h.st().line === 2 && h.host.settings.r[1] === 1);
  h.press('FWD'); h.tick(100, 3);
  check('11 cursor tracks the executing line', h.ctl._ctl.cursorOf('RUN').line === 3 && h.has('== RUN  3/5'));
  h.up('SHIFT');
  check('11 releasing SHIFT mid-move pauses', h.st().runState === 'PAUSED' && !atP(1) && !atP(2));
  const mid = h.ctl.robot().q; h.tick(100, 5);
  check('11 paused robot stays still', near(mid, h.ctl.robot().q));
  h.down('SHIFT'); h.press('FWD');
  h.press('HOLD');
  check('11 HOLD pauses and lights Hold', h.st().runState === 'PAUSED' && h.st().indicators.hold);
  h.press('FWD'); h.tickUntil(() => h.st().runState !== 'RUNNING');
  check('11 FWD resumes the move to P[2]', atP(2) && h.st().line === 3);
  h.press('FWD'); h.tickUntil(() => h.st().runState !== 'RUNNING');
  check('11 line 4 reaches P[3]', atP(3) && h.st().line === 4);
  h.press('BWD'); h.tickUntil(() => h.st().runState !== 'RUNNING');
  check('11 SHIFT+BWD walks back to P[2]', atP(2) && h.st().line === 3 && h.st().runState === 'PAUSED');
  h.up('SHIFT');
  h.press('FCTN');
  check('11 FCTN menu', h.has('## FUNCTION   1') && h.has('1 ABORT (ALL)') && h.has('2 Disable FWD/BWD'));
  h.press('D1');
  check('11 ABORT (ALL) aborts', h.st().runState === 'ABORTED');
  // continuous run, SHIFT must stay held; deadman release faults
  h.press('STEP'); h.press('ITEM'); h.num(1);
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 3);
  h.dm('released');
  check('11 deadman release during a run pauses with SRVO-003', h.st().runState === 'PAUSED' && h.st().alarm === 'SRVO-003 Deadman switch released');
  h.dm('held'); h.press('RESET'); h.press('FWD');
  h.tickUntil(() => h.st().runState === 'ABORTED');
  check('11 continuous run ends at P[3], ABORTED', atP(3) && h.st().runState === 'ABORTED');
  check('11 running through [End] puts the cursor back on line 1', h.st().line === 1 && h.text().includes('[[   1:'), h.text());
  h.up('SHIFT');
  h.press('FCTN', 'D2');
  check('11 Disable FWD/BWD shows FBD and blocks SHIFT+FWD', h.st().fbd && (h.press('ITEM'), h.num(1), h.down('SHIFT'), h.press('FWD'), h.st().runState === 'ABORTED'));
  h.up('SHIFT'); h.press('FCTN', 'D2'); }

// INTP-105 when another program is selected while one is paused
{ const h = rig().ready();
  progHost(h, 'AA', ['WAIT 1.00(sec)', 'R[1]=1']); progHost(h, 'BB', ['R[2]=2']);
  h.c.selectProgram('AA'); h.press('EDIT');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 2); h.up('SHIFT');
  check('11 WAIT time paused by SHIFT release', h.st().runState === 'PAUSED' && h.st().program === 'AA');
  h.press('SELECT'); h.c.top().row = h.c.top().list().indexOf('BB'); h.press('ENTER');
  check('11 choosing another program lets go of the deadman', h.c.switches().deadman === 'released' && h.st().alarm === 'SRVO-003 Deadman switch released');
  h.dm('held'); h.press('RESET');
  h.down('SHIFT'); h.press('FWD'); h.up('SHIFT');
  check('11 starting another program while one is paused: INTP-105 / PROG-040', h.st().alarm === 'INTP-105 (BB, 1) Run request failed' && h.c.alarms.some(a => a.text === 'PROG-040 Already locked by other task'));
  h.press('FCTN', 'D1', 'RESET'); h.down('SHIFT'); h.press('FWD'); h.tickUntil(() => h.st().runState === 'ABORTED'); h.up('SHIFT');
  check('11 after ABORT (ALL) the new program runs', h.host.settings.r[2] === 2); }

// WAIT on an input: the run sits on the line until the input is simulated on
{ const h = rig().ready();
  progHost(h, 'WT', ['WAIT DI[3]=ON', 'R[5]=1']);
  h.c.selectProgram('WT'); h.press('EDIT');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 20);
  check('11 WAIT DI[3]=ON waits (RUNNING on line 1)', h.st().runState === 'RUNNING' && h.st().line === 1 && h.host.settings.r[5] === undefined);
  const c = h.c; c.setSim('DI[3]', true); c.setIO('DI[3]', true);
  h.tickUntil(() => h.st().runState === 'ABORTED');
  check('11 simulating DI[3] ON releases the wait', h.host.settings.r[5] === 1);
  h.up('SHIFT'); }

// box_ab continuous to the end; final pose matches core runSim
{ const h = rig(['box_ab.ls']).ready();
  h.mode('T2'); h.press('RESET'); for (let i = 0; i < 4; i++) h.press('SHIFT+SPEED_UP');
  h.press('SELECT', 'ENTER'); h.dm('held'); h.press('RESET');   // choosing a program lets go of the deadman
  check('11 box_ab opened from SELECT', h.has('== BOX_AB  1/10') && h.has('J  PR[4:HOME_AB] 100% FINE'));
  h.down('SHIFT'); h.press('FWD');
  let lines = new Set(); const ok = h.tickUntil(() => { lines.add(h.st().line); return h.st().runState === 'ABORTED'; }, 50, 20000);
  h.up('SHIFT');
  const sim = core.runSim('BOX_AB', [core.parseLS(fs.readFileSync(path.join(ex, 'box_ab.ls'), 'utf8'))], { tools: { 1: [0, 0, 100, 0, 0, 0] }, uframes: {}, pr: {}, r: {}, inputs: {}, comp: 3, tol: 1, start: core.HOME });
  const qEnd = sim.T.q[sim.T.q.length - 1];
  check('11 box_ab runs continuously to the end', ok && [1, 3, 5, 9].every(n => lines.has(n)), [...lines].join(','));
  check('11 final pose matches core runSim', near(h.ctl.robot().q, qEnd, 1e-6), h.ctl.robot().q.join(',') + ' vs ' + qEnd.join(',')); }

// T1 speed cap: an L move at 2000 mm/sec takes at least distance / 250 mm/sec
{ const h = rig().ready();
  for (let i = 0; i < 4; i++) h.press('SHIFT+SPEED_UP');
  const f = core.fk(core.HOME, { p: [0, 0, 100], R: core.wprToR(0, 0, 0) }), v = core.poseToV6(f.tip, f.R);
  progHost(h, 'FAST', ['L P[1] 2000mm/sec FINE'], core.formatPosition(1, [v[0], v[1] + 200, v[2], v[3], v[4], v[5]], 0, 1));
  h.c.selectProgram('FAST'); h.press('EDIT');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 7);
  check('11 T1 caps the tool at 250 mm/sec', h.st().runState === 'RUNNING' && Math.abs(h.tip()[1] - (f.tip[1] + 175)) < 1, String(h.tip()[1] - f.tip[1]));
  h.tickUntil(() => h.st().runState === 'ABORTED'); h.up('SHIFT'); }

// AUTO: TP off, CYCLE START runs the selected program
{ const h = rig().ready();
  progHost(h, 'AU', ['R[7]=3', 'WAIT 0.50(sec)', 'R[7]=4']);
  h.c.selectProgram('AU');
  h.tp(false); h.dm('released'); h.mode('AUTO'); h.press('RESET');
  h.ctl.dispatch({ type: 'cycleStart' }); h.tick(100);
  check('11 AUTO: CYCLE START runs without SHIFT or deadman', h.st().runState === 'RUNNING' && h.host.settings.r[7] === 3);
  h.tickUntil(() => h.st().runState === 'ABORTED');
  check('11 AUTO run completes', h.host.settings.r[7] === 4); }

// unreachable target during a run
{ const h = rig().ready();
  progHost(h, 'FAR', ['J P[1] 100% FINE'], core.formatPosition(1, [2000, 0, 0, 180, 0, 0], 0, 1));
  h.c.selectProgram('FAR'); h.press('EDIT');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 3); h.up('SHIFT');
  check('11 unreachable point stops the run with MOTN-018', h.st().alarm === 'MOTN-018 Position not reachable' && h.st().runState === 'PAUSED' && near(h.ctl.robot().q, core.HOME)); }

// subscribe fires on change only
{ const h = rig(); let n = 0; const off = h.ctl.subscribe(() => n++);
  h.tick(100); const a = n; h.press('POSN'); const b = n; off(); h.press('SELECT');
  check('subscribe: no call on an idle tick, call on change, unsubscribe works', a === 0 && b > 0 && n === b); }

// screen shape is constant
{ const h = rig(); const s = h.ctl.screen();
  check('screen body is always ROWS x COLS', s.body.length === TP.ROWS && s.body.every(r => r.reduce((n, sg) => n + sg.text.length, 0) === TP.COLS) && s.softkeys.length === 5); }

// Choosing another program starts it at line 1; moving the cursor while paused asks before running from there
{ const h = rig().ready();
  progHost(h, 'AA', ['R[1]=1', 'WAIT 1.00(sec)', 'R[1]=R[1]+1', 'R[3]=7']); progHost(h, 'BB', ['R[2]=2', 'R[2]=3']);
  h.c.selectProgram('BB'); h.c.cursorOf('BB').line = 2;
  h.press('SELECT'); h.c.top().row = h.c.top().list().indexOf('AA'); h.press('ENTER');
  h.press('SELECT'); h.c.top().row = h.c.top().list().indexOf('BB'); h.press('ENTER');
  check('5 switching to another program puts the cursor on line 1', h.c.cursorOf('BB').line === 1);
  h.press('SELECT'); h.c.top().row = h.c.top().list().indexOf('AA'); h.press('ENTER');
  h.dm('held'); h.press('RESET');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 3); h.up('SHIFT');
  check('11 paused in the WAIT on line 2', h.st().runState === 'PAUSED' && h.st().line === 2);
  h.press('DOWN', 'DOWN');
  h.down('SHIFT'); h.press('FWD'); h.tick(100, 2);
  check('11 SHIFT+FWD from a moved cursor asks first', h.st().runState === 'PAUSED' && /Run from line 4 instead?/.test(h.text()) && !h.host.settings.r[3]);
  h.press('F5'); h.press('FWD'); 
  check('11 NO leaves it paused and asks again next time', h.st().runState === 'PAUSED' && /Run from line 4 instead?/.test(h.text()));
  h.press('F4'); h.press('FWD'); h.tickUntil(() => h.st().runState === 'ABORTED'); h.up('SHIFT');
  check('11 YES then SHIFT+FWD runs from the cursor line', h.host.settings.r[3] === 7 && h.host.settings.r[1] === 1); }
// Register comments from the DATA screens show in program lines
{ const h = rig().ready();
  progHost(h, 'NM', ['J PR[1] 100% FINE', 'L P[1] 100mm/sec FINE Offset,PR[10:old]', 'R[2]=R[2]+1']);
  h.host.settings.prCmt = { 1: 'HOME', 10: 'shift' }; h.host.settings.rCmt = { 2: 'count' };
  h.c.selectProgram('NM'); h.press('EDIT');
  check('6 PR and R comments from DATA show in the program', h.has('PR[1:HOME] 100% FINE') && h.has('Offset,PR[10:shift]') && h.has('R[2:count]=R[2:count]+1'), h.text());
  check('6 the stored line is unchanged', h.host.getProgram('NM').lines[0] === 'J PR[1] 100% FINE'); }
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
