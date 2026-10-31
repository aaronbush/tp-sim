// Run with: node tests/core.test.js
const fs = require('fs'), path = require('path');
const c = require('../site/js/core.js');
const ex = path.join(__dirname, '../site/examples');
const load = f => c.parseLS(fs.readFileSync(path.join(ex, f), 'utf8'));
const base = { tools: { 1: [0, 0, 100, 0, 0, 0] }, uframes: {}, pr: {}, r: {}, inputs: {}, comp: 3, tol: 1, maxTime: 120 };
let fails = 0;
const check = (name, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };
const run = (root, progs, st) => c.runSim(root, progs, { ...base, ...st });
const lines = (sim) => sim.steps.map(s => `${s.prog}:${s.line}`);

// FK/IK round trip with a tool offset
{ const tool = { p: [10, -5, 120], R: c.wprToR(0, 0, 30) };
  const q = [12, 25, -20, 8, -65, 40]; const f = c.fk(q, tool); const s = c.ik(f.tip, f.R, tool, q); const f2 = c.fk(s.q, tool);
  check('fk/ik round trip with tool frame', Math.hypot(...f.tip.map((v, i) => v - f2.tip[i])) < 1e-6); }

// box: same findings as before
{ const s = run('BOX_AB', [load('box_ab.ls')]);
  check('box runs to the end', s.stopReason === 'end');
  check('box flags J along the surface', s.issues.some(i => i.line === 7 && /Joint move/.test(i.title)));
  check('box flags the 2 mm closing gap', s.issues.some(i => i.line === 8 && /close/.test(i.title))); }

// loop: three passes, offset shifts by 70 each time
{ const s = run('LOOP_SQUARES', [load('loop_squares.ls')]);
  const corners = s.segs.filter(g => g.line === 9).map(g => g.to.p[1].toFixed(1));
  check('loop draws 3 squares', corners.length === 3, corners.join(', '));
  check('loop offsets by 70 mm', corners.join() === '-120.0,-50.0,20.0');
  check('loop R[1] ends at 3', s.snaps[s.snaps.length - 1].R[1] === 3);
  check('loop has no problems', !s.issues.some(i => i.sev === 'bad'), s.issues.map(i => i.title).join(' | ')); }

// select + call
{ const progs = ['main_select.ls', 'a_square.ls', 'a_triangle.ls'].map(load);
  const s1 = run('MAIN_SELECT', progs, { inputs: { 'GI[1]': { v: 1 } } });
  check('GI=1 calls A_SQUARE', s1.segs.some(g => g.prog === 'A_SQUARE') && !s1.segs.some(g => g.prog === 'A_TRIANGLE'));
  check('returns to main after CALL and ENDs', s1.stopReason === 'end' && lines(s1).includes('MAIN_SELECT:10'));
  const s2 = run('MAIN_SELECT', progs, { inputs: { 'GI[1]': { v: 2 } } });
  check('GI=2 calls A_TRIANGLE', s2.segs.some(g => g.prog === 'A_TRIANGLE'));
  const s3 = run('MAIN_SELECT', progs, { inputs: { 'GI[1]': { v: 7 } } });
  check('GI=7 takes ELSE to LBL[9]', lines(s3).includes('MAIN_SELECT:12') && !s3.segs.some(g => g.prog !== 'MAIN_SELECT'));
  const s4 = run('MAIN_SELECT', [progs[0]], { inputs: { 'GI[1]': { v: 1 } } });
  check('missing CALL target is flagged', s4.issues.some(i => /not loaded/.test(i.title))); }

// pick and place: FOR, WAIT DI, RO, user frame built in the program
{ const p = load('pick_place.ls');
  const s = run('PICK_PLACE', [p], { inputs: { 'DI[1]': { v: 1 } } });
  const places = s.segs.filter(g => g.line === 20).map(g => g.to.p.map(v => v.toFixed(0)).join(','));
  check('pick/place loops 3 times', places.length === 3, places.join(' | '));
  check('place points in world use UFRAME 1 + offset', places[0] === '500,-110,-278' && places[2] === '500,10,-278');
  check('RO[1] toggles', s.ioEvents.filter(e => e.key === 'RO[1]').length === 7);
  check('pick/place has no problems', !s.issues.some(i => i.sev === 'bad'), s.issues.map(i => i.title).join(' | '));
  const s2 = run('PICK_PLACE', [p], { inputs: { 'DI[1]': { v: 0 } } });
  check('DI off -> waits forever', s2.stopReason === 'wait' && s2.issues.some(i => /forever/.test(i.title)));
  const s3 = run('PICK_PLACE', [p], { inputs: { 'DI[1]': { v: 0, at: 3 } } });
  check('DI switching on at 3 s releases the wait', s3.stopReason === 'end');
  const w = s3.steps.find(x => x.kind === 'wait' && x.line === 13);
  check('first WAIT lasts until about 3 s', w && w.dur > 1, w && w.dur.toFixed(2)); }

// expressions and edge cases
{ const mk = (ls, pos = '') => c.makeProgram('T', '', ls, pos);
  const s = run('T', [mk(['R[1]=7', 'R[2]=R[1] DIV 2', 'R[3]=R[1] MOD 2', 'R[4]=(R[1]+1)*2', 'R[5]=R[1]+1*2', 'IF R[1]>5 AND R[3]=1,JMP LBL[2]', 'R[6]=99', 'LBL[2]', 'R[7]=1'])]);
  const R = s.snaps[s.snaps.length - 1].R;
  check('DIV / MOD', R[2] === 3 && R[3] === 1);
  check('mixed logic parentheses', R[4] === 16);
  check('IF ... AND ..., JMP skips line', R[6] === undefined && R[7] === 1);
  check('+ with * without parens is flagged', s.issues.some(i => /Mixes \+/.test(i.title)));
  const s2 = run('T', [mk(['FOR R[1]=3 DOWNTO 1', 'R[2]=R[2]+R[1]', 'ENDFOR'])], { r: { 2: 0 } });
  check('FOR DOWNTO sums 3+2+1', s2.snaps[s2.snaps.length - 1].R[2] === 6);
  const s3 = run('T', [mk(['LBL[1]', 'JMP LBL[1]'])]);
  check('endless logic loop is capped', s3.stopReason === 'steps' && s3.issues.some(i => /forever/.test(i.title)));
  const s4 = run('T', [mk(['JMP LBL[5]'])]);
  check('missing label is an error', s4.issues.some(i => /doesn't exist/.test(i.title)));
  const s5 = run('T', [mk(['IF (R[1]=0) THEN', 'R[2]=1', 'ELSE', 'R[2]=2', 'ENDIF', 'R[3]=R[2]'])]);
  check('IF THEN ELSE ENDIF', s5.snaps[s5.snaps.length - 1].R[3] === 1);
  const s6 = run('T', [mk(['UFRAME_NUM=0', 'J P[1] 100% FINE'], c.formatPosition(1, [450, 0, -250, 180, 0, 0], 2, 1))]);
  check('UF mismatch is flagged', s6.issues.some(i => /user frame 2/.test(i.title)));
  const s7 = run('T', [mk(['WAIT R[3]=1 TIMEOUT,LBL[1]', 'R[9]=1', 'LBL[1]'])], { r: { 3: 0 } });
  check('WAIT TIMEOUT jumps', s7.snaps[s7.snaps.length - 1].R[9] === undefined && s7.issues.some(i => /timed out/.test(i.title)));
  const bad = c.parseLine('R[1]=R[2]+', 1);
  check('parse error reported', bad.type === 'error', bad.error); }

// stack parts: CALL with an argument, macros, IF loop, WAIT, Offset PR, PULSE
{ const progs = ['stack_parts.ls', 'pick_part.ls', 'grip_open.ls', 'grip_close.ls'].map(load);
  const macros = { 'OPEN HAND': 'GRIP_OPEN', 'CLOSE HAND': 'GRIP_CLOSE' };
  const s = run('STACK_PARTS', progs, { inputs: { 'DI[1]': { v: 1 } }, macros });
  const places = s.segs.filter(g => g.prog === 'STACK_PARTS' && g.line === 13).map(g => g.to.p[2].toFixed(0));
  check('stack places 3 parts 20 mm apart', places.join() === '-250,-230,-210', places.join());
  const above = s.segs.find(g => g.prog === 'PICK_PART' && g.line === 4);
  check('AR[1] sets the approach height', above && Math.abs(above.to.p[2] - -190) < 1e-6);
  check('macros run their programs', s.segs.filter(g => g.prog === 'GRIP_CLOSE').length === 3 && s.segs.filter(g => g.prog === 'GRIP_OPEN').length === 4);
  check('stack has no findings', s.issues.length === 0, s.issues.map(i => i.title).join(' | '));
  check('PULSE lasts 0.5 s', s.pulses.length === 3 && s.pulses.every(p => Math.abs(p.t1 - p.t0 - 0.5) < 1e-9));
  const s2 = run('STACK_PARTS', progs, { inputs: { 'DI[1]': { v: 1 } } });
  check('unmapped macro is flagged and skipped', s2.issues.some(i => /OPEN HAND.*isn't set up/.test(i.title)) && !s2.segs.some(g => g.prog === 'GRIP_OPEN'));
  const s3 = run('STACK_PARTS', progs, { inputs: { 'DI[1]': { v: 0 } }, macros, waitTimeout: 5 });
  const w = s3.steps.find(x => x.kind === 'wait' && x.line === 10);
  check('WAIT timeout uses the setting', w && w.dur === 5 && s3.issues.some(i => /5 s timeout/.test(i.detail))); }

// CALL arguments, macros by program name, PULSE timing
{ const mk = (name, ls) => c.makeProgram(name, '', ls, '');
  const sub = mk('ADDER', ['R[1]=AR[1]+AR[2]', 'IF AR[3]=\'hi\',JMP LBL[1]', 'R[2]=1', 'LBL[1]']);
  const s = run('T', [mk('T', ['R[5]=4', 'CALL ADDER(R[5],2.5,\'hi\')']), sub]);
  const R = s.snaps[s.snaps.length - 1].R;
  check('CALL passes numbers and registers', R[1] === 6.5);
  check('text argument compares with =', R[2] === undefined);
  check('AR values are in the snapshot while inside', s.snaps.some(x => x.ar && x.ar[2] === 'hi'));
  const s2 = run('T', [mk('T', ['CALL ADDER(1)']), sub]);
  check('missing AR is an error', s2.stopReason === 'error' && s2.issues.some(i => /AR\[2\] wasn't passed/.test(i.detail)));
  const s3 = run('T', [mk('T', ['IF R[9]=0,CALL ADDER(1,2,3)']), sub]);
  check('IF ...,CALL passes arguments', s3.snaps[s3.snaps.length - 1].R[1] === 3);
  const s4 = run('T', [mk('T', ['MYMAC']), mk('MYMAC', ['R[3]=7'])]);
  check('macro with a program of the same name runs it', s4.snaps[s4.snaps.length - 1].R[3] === 7 && s4.issues.some(i => /as a macro/.test(i.title)));
  check('macro line with spaces parses', c.parseLine('Open hand 1', 1).type === 'macro' && c.parseLine('Open hand 1', 1).name === 'OPEN HAND 1');
  const s5 = run('T', [mk('T', ['DO[1]=PULSE,1.0sec', 'WAIT DO[1]=OFF', 'R[1]=1'])]);
  const w = s5.steps.find(x => x.kind === 'wait');
  check('PULSE output switches off after its time', s5.stopReason === 'end' && w && Math.abs(w.dur - 1) < 1e-9);
  const s6 = run('T', [mk('T', ['DO[1]=PULSE,1.0sec', 'WAIT 2.00(sec)', 'R[1]=DO[1]'])]);
  check('pulse is off after the wait', s6.snaps[s6.snaps.length - 1].R[1] === 0 && s6.snaps.some(x => x.out['DO[1]'] === 1)); }

// .ls round trip
{ const p = load('main_select.ls'); const p2 = c.parseLS(c.toLS(p));
  check('.ls round trip keeps lines', JSON.stringify(p.lines) === JSON.stringify(p2.lines)); }

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
