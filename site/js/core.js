// ===== tp-sim core: math, kinematics, .ls parsing, TP interpreter, motion simulation (no DOM) =====
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
// Generic small 6-axis arm dimensions (mm). World origin sits on the J1 axis at J2 height.
const ROBOT = { A1: 50, A2: 330, A3: 35, D4: 335, D6: 80, BASE: 330,
  vmax: [450, 380, 520, 550, 545, 1000], maxLin: 2000 };
const HOME = [0, 0, 0, 0, -90, 0];
const LIMITS = { steps: 20000, moves: 3000 };
const WAIT_TIMEOUT_DEFAULT = 30;
const DEFAULT_TOOL = { p: [0, 0, 100], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }; // seconds, stands in for the controller's $WAITTMOUT

// ---------- vectors / matrices / quaternions ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return scl(a, 1 / l); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerpN = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const matMul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const matT = M => [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
const matVec = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
const col = (M, j) => [M[0][j], M[1][j], M[2][j]];
const fromCols = (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const Rx = a => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const Ry = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const Rz = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
// WPR: fixed-axis rotations about X (W), then Y (P), then Z (R)
function wprToR(w, p, r) { return matMul(Rz(r * D2R), matMul(Ry(p * D2R), Rx(w * D2R))); }
function rToWpr(R) {
  const p = Math.atan2(-R[2][0], Math.hypot(R[0][0], R[1][0]));
  return [Math.atan2(R[2][1], R[2][2]) * R2D, p * R2D, Math.atan2(R[1][0], R[0][0]) * R2D];
}
function quatFromR(m) {
  const tr = m[0][0] + m[1][1] + m[2][2]; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s]; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s]; }
  const l = Math.hypot(...q); return q.map(v => v / l);
}
function quatToR(q) {
  const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t); const l = Math.hypot(...r); return r.map(v => v / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
const quatAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

// Frames are stored as [x, y, z, w, p, r]
const frameOf = v => ({ R: wprToR(v[3], v[4], v[5]), o: [v[0], v[1], v[2]] });
const toWorld = (F, p, R) => ({ p: add(matVec(F.R, p), F.o), R: matMul(F.R, R) });
const toFrame = (F, p, R) => ({ p: matVec(matT(F.R), sub(p, F.o)), R: matMul(matT(F.R), R) });
const poseToV6 = (p, R) => [...p, ...rToWpr(R)];

// ---------- kinematics ----------
// q in degrees. J2 from vertical (+ forward); J3 forearm angle from horizontal (+ up).
// tool = { p: [x,y,z], R } offset of the tool frame from the faceplate.
function fk(q, tool) {
  const [q1, q2, q3, q4, q5, q6] = q.map(d => d * D2R);
  const c1 = Math.cos(q1), s1 = Math.sin(q1);
  const er = [c1, s1, 0], et = [-s1, c1, 0], ez = [0, 0, 1];
  const base = [0, 0, -ROBOT.BASE], j1 = [0, 0, 0], j2 = scl(er, ROBOT.A1);
  const a1 = Math.PI / 2 - q2;
  const E = add(j2, add(scl(er, ROBOT.A2 * Math.cos(a1)), scl(ez, ROBOT.A2 * Math.sin(a1))));
  const u = add(scl(er, Math.cos(q3)), scl(ez, Math.sin(q3)));
  const n = add(scl(er, -Math.sin(q3)), scl(ez, Math.cos(q3)));
  const F3 = add(E, scl(n, ROBOT.A3)), W = add(F3, scl(u, ROBOT.D4));
  const yw = scl(et, -1), xw = cross(yw, u);
  const Rf = matMul(fromCols(xw, yw, u), matMul(Rz(q4), matMul(Ry(q5), Rz(q6))));
  const flange = add(W, scl(col(Rf, 2), ROBOT.D6));
  const tip = add(flange, matVec(Rf, tool.p));
  return { pts: [base, j1, j2, E, F3, W, flange, tip], R: matMul(Rf, tool.R), Rf, tip };
}
const wrapNear = (a, ref) => { while (a - ref > 180) a -= 360; while (a - ref < -180) a += 360; return a; };
// Inverse kinematics: front, elbow up; wrist solution nearest the reference joints.
function ik(p, R, tool, ref) {
  ref = ref || HOME;
  const Rf = matMul(R, matT(tool.R));
  const flange = sub(p, matVec(Rf, tool.p));
  const W = sub(flange, scl(col(Rf, 2), ROBOT.D6));
  const q1 = Math.atan2(W[1], W[0]);
  const r = Math.hypot(W[0], W[1]) - ROBOT.A1, zz = W[2];
  const Le = Math.hypot(ROBOT.D4, ROBOT.A3), phi = Math.atan2(ROBOT.A3, ROBOT.D4);
  let D = Math.hypot(r, zz), reach = true;
  if (D > ROBOT.A2 + Le - 0.01) { reach = false; D = ROBOT.A2 + Le - 0.01; }
  if (D < Math.abs(ROBOT.A2 - Le) + 0.01) { reach = false; D = Math.abs(ROBOT.A2 - Le) + 0.01; }
  const ang = Math.atan2(zz, r);
  const cA = Math.max(-1, Math.min(1, (ROBOT.A2 ** 2 + D * D - Le * Le) / (2 * ROBOT.A2 * D)));
  const a1 = ang + Math.acos(cA);
  const wr = D * Math.cos(ang), wz = D * Math.sin(ang);
  const beta = Math.atan2(wz - ROBOT.A2 * Math.sin(a1), wr - ROBOT.A2 * Math.cos(a1));
  const q2 = Math.PI / 2 - a1, q3 = beta - phi;
  const c1 = Math.cos(q1), s1 = Math.sin(q1);
  const er = [c1, s1, 0], et = [-s1, c1, 0];
  const u = add(scl(er, Math.cos(q3)), [0, 0, Math.sin(q3)]);
  const yw = scl(et, -1), xw = cross(yw, u);
  const M = matMul(matT(fromCols(xw, yw, u)), Rf);
  const s = Math.hypot(M[0][2], M[1][2]);
  let sols;
  if (s < 1e-6) {
    const a = ref[3] * D2R;
    sols = M[2][2] > 0 ? [[a, 0, Math.atan2(M[1][0], M[0][0]) - a]] : [[a, Math.PI, a + Math.atan2(M[0][1], -M[0][0])]];
  } else {
    sols = [[Math.atan2(M[1][2], M[0][2]), Math.atan2(s, M[2][2]), Math.atan2(M[2][1], -M[2][0])],
            [Math.atan2(-M[1][2], -M[0][2]), Math.atan2(-s, M[2][2]), Math.atan2(-M[2][1], M[2][0])]];
  }
  let best = null, bc = Infinity;
  for (const so of sols) {
    const q4 = wrapNear(so[0] * R2D, ref[3]), q5 = so[1] * R2D, q6 = wrapNear(so[2] * R2D, ref[5]);
    const c = Math.abs(q4 - ref[3]) + Math.abs(q5 - ref[4]) + Math.abs(q6 - ref[5]);
    if (c < bc) { bc = c; best = [q4, q5, q6]; }
  }
  return { q: [wrapNear(q1 * R2D, ref[0]), q2 * R2D, q3 * R2D, ...best], reach };
}
function circle3(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), nn = dot(n, n);
  if (nn < 1e-6) return null;
  const center = add(a, scl(add(scl(cross(n, ab), dot(ac, ac)), scl(cross(ac, n), dot(ab, ab))), 1 / (2 * nn)));
  const e1 = nrm(sub(a, center)), e2 = nrm(cross(nrm(n), e1)), r = len(sub(a, center));
  let sweep = Math.atan2(dot(sub(c, center), e2), dot(sub(c, center), e1));
  if (sweep <= 0) sweep += 2 * Math.PI;
  return { center, e1, e2, r, sweep };
}

// ---------- .ls file ----------
// Splits a .ls file into header text, instruction lines (without numbers) and the /POS text.
function splitLS(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const iMN = lines.findIndex(l => /^\/MN\b/.test(l.trim()));
  const iPOS = lines.findIndex(l => /^\/POS\b/.test(l.trim()));
  const iEND = lines.findIndex((l, i) => i > Math.max(iMN, iPOS) && /^\/END\b/.test(l.trim()));
  const nameM = text.match(/\/PROG\s+(\S+)/);
  const out = { name: nameM ? nameM[1] : 'PROGRAM', header: '', mn: [], posText: '', errors: [] };
  if (iMN < 0) { out.errors.push('No /MN section found. Is this an ASCII .ls program (not a binary .tp)?'); return out; }
  out.header = lines.slice(0, iMN).join('\n');
  const stop = iPOS > iMN ? iPOS : (iEND > 0 ? iEND : lines.length);
  let cur = null;
  for (let i = iMN + 1; i < stop; i++) {
    const l = lines[i]; let m;
    if ((m = l.match(/^\s*(\d+):(.*)$/))) { cur = { num: +m[1], raw: m[2] }; out.mn.push(cur); }
    else if ((m = l.match(/^\s*:(.*)$/)) && cur) cur.raw += ' ' + m[1];
  }
  out.mn = out.mn.map(x => x.raw.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim());
  if (iPOS >= 0) out.posText = lines.slice(iPOS + 1, iEND > iPOS ? iEND : lines.length).join('\n').replace(/^\n+|\s+$/g, '');
  return out;
}
function parsePositions(posText) {
  const pos = {};
  const re = /P\[(\d+)(?::\s*"?([^"\]]*)"?)?\]\s*\{([\s\S]*?)\};/g; let pm;
  while ((pm = re.exec(posText || ''))) {
    const body = pm[3];
    const num = k => { const x = body.match(new RegExp('\\b' + k + '\\s*=\\s*([-+]?\\d*\\.?\\d+)')); return x ? parseFloat(x[1]) : null; };
    const uf = (body.match(/UF\s*:\s*(\d+)/) || [])[1], ut = (body.match(/UT\s*:\s*(\d+)/) || [])[1];
    const P = { n: +pm[1], cmt: pm[2] || '', uf: uf != null ? +uf : 0, ut: ut != null ? +ut : 1,
      config: (body.match(/CONFIG\s*:\s*'([^']*)'/) || [])[1] || '' };
    if (num('X') !== null) P.cart = ['X', 'Y', 'Z', 'W', 'P', 'R'].map(k => num(k) ?? 0);
    else if (num('J1') !== null) P.joints = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map(k => num(k) ?? 0);
    pos[P.n] = P;
  }
  return pos;
}
// Build a program from editable parts. lines[i] is TP line i+1.
function makeProgram(name, header, lines, posText) {
  const prog = { name: (name || 'PROGRAM').toUpperCase(), header: header || '', lines: lines.slice(), posText: posText || '', errors: [] };
  prog.pos = parsePositions(prog.posText);
  prog.ins = prog.lines.map((t, i) => parseLine(t, i + 1));
  analyzeStructure(prog);
  const cm = prog.header.match(/COMMENT\s*=\s*"([^"]*)"/); prog.comment = cm ? cm[1] : '';
  return prog;
}
function parseLS(text) {
  const s = splitLS(text);
  const prog = makeProgram(s.name, s.header, s.mn, s.posText);
  prog.errors.push(...s.errors);
  return prog;
}
function fmtNum(v, w = 9) { return (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3).replace(/^(-?)0\./, '$1.').padStart(w); }
// Serialize back to .ls text
function toLS(prog) {
  let header = prog.header && prog.header.trim() ? prog.header : defaultHeader(prog.name);
  header = header.replace(/\/PROG\s+\S+/, '/PROG  ' + prog.name)
    .replace(/LINE_COUNT\s*=\s*\d+;/, `LINE_COUNT\t= ${prog.lines.length};`);
  const mn = prog.lines.map((t, i) => {
    const n = String(i + 1).padStart(4) + ':';
    const s = t.trim();
    if (!s) return n + '   ;';
    let m = s.match(/^C\s+(P|PR)(\[[^\]]*\])\s+(.*)$/);
    if (m) { const rest = m[3].match(/^((?:P|PR)\[[^\]]*\])\s*(.*)$/); if (rest) return `${n}C ${m[1]}${m[2]}    \n    :  ${rest[1]} ${rest[2]}    ;`; }
    if (/^[JLCA]\s/.test(s)) return `${n}${s}    ;`;
    return `${n}  ${s} ;`;
  });
  const pos = (prog.posText || '').trim();
  return `${header.trimEnd()}\n/MN\n${mn.join('\n')}\n/POS\n${pos ? pos + '\n' : ''}/END\n`;
}
function defaultHeader(name) {
  return `/PROG  ${name}\n/ATTR\nOWNER\t\t= MNEDITOR;\nCOMMENT\t\t= "";\nPROG_SIZE\t= 0;\nFILE_NAME\t= ;\nVERSION\t\t= 0;\nLINE_COUNT\t= 0;\nMEMORY_SIZE\t= 0;\nPROTECT\t\t= READ_WRITE;\nTCD:  STACK_SIZE\t= 0,\n      TASK_PRIORITY\t= 50,\n      TIME_SLICE\t= 0,\n      BUSY_LAMP_OFF\t= 0,\n      ABORT_REQUEST\t= 0,\n      PAUSE_REQUEST\t= 0;\nDEFAULT_GROUP\t= 1,*,*,*,*;\nCONTROL_CODE\t= 00000000 00000000;\n/APPL`;
}
function formatPosition(n, v6, uf, ut, cmt) {
  const [x, y, z, w, p, r] = v6;
  return `P[${n}${cmt ? ':"' + cmt + '"' : ''}]{\n   GP1:\n\tUF : ${uf}, UT : ${ut},\t\tCONFIG : 'N U T, 0, 0, 0',\n\tX = ${fmtNum(x)}  mm,\tY = ${fmtNum(y)}  mm,\tZ = ${fmtNum(z)}  mm,\n\tW = ${fmtNum(w)} deg,\tP = ${fmtNum(p)} deg,\tR = ${fmtNum(r)} deg\n};`;
}

// ---------- expression lexer / parser ----------
const REF_KINDS = ['TIMER', 'PR', 'AR', 'SR', 'DI', 'DO', 'RI', 'RO', 'GI', 'GO', 'UI', 'UO', 'SI', 'SO', 'AI', 'AO', 'R', 'P', 'F', 'M', 'LBL'];
const IO_BITS = new Set(['DI', 'DO', 'RI', 'RO', 'UI', 'UO', 'SI', 'SO', 'F', 'M']);
const INPUT_KINDS = new Set(['DI', 'RI', 'UI', 'SI', 'GI', 'AI']);
class TPError extends Error {}
function lex(s) {
  const toks = []; let i = 0;
  const kw = /^(AND|OR|NOT|DIV|MOD|ON|OFF|LPOS|JPOS|TO|DOWNTO|THEN|ELSE|TIMEOUT|JMP|CALL|PULSE)\b/i;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(/^([A-Za-z]+)\[/)) && REF_KINDS.includes(m[1].toUpperCase())) {
      const r = lexRef(s, i); toks.push({ t: 'ref', ref: r.ref }); i = r.end; continue;
    }
    if ((m = rest.match(/^(\d+\.?\d*|\.\d+)/))) { toks.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
    if ((m = rest.match(kw))) { toks.push({ t: 'kw', v: m[1].toUpperCase() }); i += m[1].length; continue; }
    if ((m = rest.match(/^(<=|>=|<>|=|<|>|\+|-|\*|\/|\(|\)|,|!)/))) { toks.push({ t: 'op', v: m[1] }); i += m[1].length; continue; }
    if ((m = rest.match(/^([A-Za-z_$][\w$.]*)/))) { toks.push({ t: 'id', v: m[1] }); i += m[1].length; continue; }
    throw new TPError(`Unexpected "${c}"`);
  }
  return toks;
}
// Parses REG[idx(,elem)(:comment)] starting at s[i]. idx may itself be R[n] (indirect).
function lexRef(s, i) {
  const m = s.slice(i).match(/^([A-Za-z]+)\[/);
  const kind = m[1].toUpperCase(); let j = i + m[0].length;
  let idx;
  const inner = s.slice(j).match(/^\s*([A-Za-z]+)\[/);
  if (inner && inner[1].toUpperCase() === 'R') { const r = lexRef(s, j + s.slice(j).indexOf(inner[1])); idx = r.ref; j = r.end; }
  else { const d = s.slice(j).match(/^\s*(\d+)/); if (!d) throw new TPError(`${kind}[ ] needs a number`); idx = +d[1]; j += d[0].length; }
  let elem = null;
  const e = s.slice(j).match(/^\s*,\s*(\d+)/); if (e) { elem = +e[1]; j += e[0].length; }
  let cmt = '';
  const c = s.slice(j).match(/^\s*:([^\]]*)/); if (c) { cmt = c[1].trim(); j += c[0].length; }
  const close = s.slice(j).match(/^\s*\]/);
  if (!close) throw new TPError(`Missing ] after ${kind}[`);
  j += close[0].length;
  return { ref: { kind, idx, elem, cmt }, end: j };
}
function parseExpr(src) {
  const toks = lex(src); let k = 0;
  const flags = { addsub: false, muldiv: false, and: false, or: false, parens: false };
  let depth = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const isOp = (v) => toks[k] && toks[k].t === 'op' && toks[k].v === v;
  const isKw = (v) => toks[k] && toks[k].t === 'kw' && toks[k].v === v;
  function pOr() { let l = pAnd(); while (isKw('OR')) { next(); if (!depth) flags.or = true; l = { op: 'OR', a: l, b: pAnd() }; } return l; }
  function pAnd() { let l = pNot(); while (isKw('AND')) { next(); if (!depth) flags.and = true; l = { op: 'AND', a: l, b: pNot() }; } return l; }
  function pNot() { if (isKw('NOT') || isOp('!')) { next(); return { op: 'NOT', a: pNot() }; } return pCmp(); }
  function pCmp() {
    const l = pAdd(); const t = peek();
    if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { next(); return { op: t.v, a: l, b: pAdd() }; }
    return l;
  }
  function pAdd() { let l = pMul(); while (isOp('+') || isOp('-')) { const o = next().v; if (!depth) flags.addsub = true; l = { op: o, a: l, b: pMul() }; } return l; }
  function pMul() { let l = pUn(); while (isOp('*') || isOp('/') || isKw('DIV') || isKw('MOD')) { const o = next().v; if (!depth) flags.muldiv = true; l = { op: o, a: l, b: pUn() }; } return l; }
  function pUn() { if (isOp('-')) { next(); return { op: 'NEG', a: pUn() }; } if (isOp('+')) { next(); return pUn(); } return pPrim(); }
  function pPrim() {
    const t = next();
    if (!t) throw new TPError('Expression ends too early');
    if (t.t === 'num') return { num: t.v };
    if (t.t === 'ref') return { ref: t.ref };
    if (t.t === 'kw' && (t.v === 'ON' || t.v === 'OFF')) return { num: t.v === 'ON' ? 1 : 0 };
    if (t.t === 'kw' && (t.v === 'LPOS' || t.v === 'JPOS')) return { pos: t.v };
    if (t.t === 'op' && t.v === '(') { depth++; flags.parens = true; const e = pOr(); depth--; if (!isOp(')')) throw new TPError('Missing )'); next(); return e; }
    if (t.t === 'id' && t.v.startsWith('$')) return { sysvar: t.v };
    throw new TPError(`Didn't expect "${t.v ?? t.t}"`);
  }
  const ast = pOr();
  if (k < toks.length) throw new TPError(`Unexpected "${toks[k].v ?? toks[k].t}"`);
  return { ast, flags };
}
// Split at the first top-level occurrence of a separator (ignores brackets and parens)
function splitTop(s, sep) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') d++; else if (c === ']' || c === ')') d--;
    else if (!d && s.startsWith(sep, i)) {
      if (sep === '=' && (s[i - 1] === '<' || s[i - 1] === '>' || s[i + 1] === '>')) continue;
      return [s.slice(0, i), s.slice(i + sep.length)];
    }
  }
  return null;
}
function lastTopComma(s) {
  let d = 0, at = -1;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '[' || c === '(') d++; else if (c === ']' || c === ')') d--; else if (c === ',' && !d) at = i; }
  return at;
}
const refText = r => r ? `${r.kind}[${typeof r.idx === 'object' ? refText(r.idx) : r.idx}${r.elem != null ? ',' + r.elem : ''}${r.cmt ? ':' + r.cmt : ''}]` : '';
const refShort = r => r ? `${r.kind}[${typeof r.idx === 'object' ? refShort(r.idx) : r.idx}${r.elem != null ? ',' + r.elem : ''}]` : '';

function parseAction(s) {
  s = s.trim(); let m;
  if ((m = s.match(/^JMP\s+(LBL\[.*\])$/i))) return { act: 'jmp', lbl: lexRef(m[1], 0).ref };
  if ((m = s.match(/^CALL\s+([A-Za-z0-9_]+)\s*(\(.*\))?$/i))) return { act: 'call', prog: m[1].toUpperCase() };
  throw new TPError(`Unknown action "${s}" (expected JMP LBL[ ] or CALL program)`);
}

// ---------- instruction parser ----------
function parseLine(text, num) {
  const t = (text || '').trim();
  const ins = { num, text: t, type: 'other' };
  try { classify(ins, t); }
  catch (e) { ins.type = 'error'; ins.error = e instanceof TPError ? e.message : 'Could not read this line'; }
  return ins;
}
function classify(ins, t) {
  let m;
  if (!t) { ins.type = 'empty'; return; }
  if (t.startsWith('!')) { ins.type = 'comment'; return; }
  if (t.startsWith('//')) { ins.type = 'remark'; return; }
  if (/^[JLC]\s/i.test(t) && /^[JLC]\s+(P|PR)\[/i.test(t)) return parseMotion(ins, t);
  if ((m = t.match(/^LBL\[(\d+)(?::[^\]]*)?\]$/i))) { ins.type = 'lbl'; ins.lbl = +m[1]; return; }
  if ((m = t.match(/^JMP\s+(LBL\[.*\])$/i))) { ins.type = 'jmp'; ins.lbl = lexRef(m[1], 0).ref; return; }
  if ((m = t.match(/^CALL\s+([A-Za-z0-9_]+)\s*(\(.*\))?$/i))) { ins.type = 'call'; ins.prog = m[1].toUpperCase(); return; }
  if (/^END$/i.test(t)) { ins.type = 'end'; return; }
  if (/^ABORT$/i.test(t)) { ins.type = 'abort'; return; }
  if (/^PAUSE$/i.test(t)) { ins.type = 'pause'; return; }
  if (/^ELSE$/i.test(t)) { ins.type = 'else'; return; }
  if (/^ENDIF$/i.test(t)) { ins.type = 'endif'; return; }
  if (/^ENDFOR$/i.test(t)) { ins.type = 'endfor'; return; }
  if ((m = t.match(/^IF\s*(.*)\s*THEN$/i))) { ins.type = 'ifthen'; ins.cond = parseExpr(m[1]); return; }
  if ((m = t.match(/^IF\s+(.*)$/i))) {
    const body = m[1], c = lastTopComma(body);
    if (c < 0) throw new TPError('IF needs ",JMP LBL[ ]" or ",CALL program" after the condition');
    ins.type = 'if'; ins.cond = parseExpr(body.slice(0, c)); ins.action = parseAction(body.slice(c + 1)); return;
  }
  if ((m = t.match(/^SELECT\s+(.*)$/i))) {
    const body = m[1], c = lastTopComma(body); if (c < 0) throw new TPError('SELECT needs ",JMP LBL[ ]" or ",CALL program"');
    const eq = splitTop(body.slice(0, c), '='); if (!eq) throw new TPError('SELECT needs R[ ]=value');
    const reg = parseExpr(eq[0]); if (!reg.ast.ref || reg.ast.ref.kind !== 'R') throw new TPError('SELECT works on a register R[ ]');
    ins.type = 'select'; ins.reg = reg.ast.ref; ins.value = parseExpr(eq[1]); ins.action = parseAction(body.slice(c + 1)); return;
  }
  if ((m = t.match(/^=\s*(.*)$/))) {
    const c = lastTopComma(m[1]); if (c < 0) throw new TPError('Expected "=value,JMP LBL[ ]"');
    ins.type = 'selcase'; ins.value = parseExpr(m[1].slice(0, c)); ins.action = parseAction(m[1].slice(c + 1)); return;
  }
  if ((m = t.match(/^ELSE\s*,\s*(.*)$/i))) { ins.type = 'selelse'; ins.action = parseAction(m[1]); return; }
  if ((m = t.match(/^FOR\s+(.*?)\s*=\s*(.+?)\s+(TO|DOWNTO)\s+(.+)$/i))) {
    const reg = parseExpr(m[1]); if (!reg.ast.ref || reg.ast.ref.kind !== 'R') throw new TPError('FOR counts with a register R[ ]');
    ins.type = 'for'; ins.reg = reg.ast.ref; ins.from = parseExpr(m[2]); ins.down = /DOWNTO/i.test(m[3]); ins.to = parseExpr(m[4]); return;
  }
  if ((m = t.match(/^WAIT\s+(.*)$/i))) {
    const body = m[1].trim();
    let w;
    if ((w = body.match(/^(\d*\.?\d+|R\[[^\]]*\])\s*\(sec\)$/i))) { ins.type = 'waitt'; ins.time = parseExpr(w[1]); return; }
    let cond = body, to = null;
    if ((w = body.match(/^(.*?)\s*TIMEOUT\s*,\s*(LBL\[.*\])$/i))) { cond = w[1]; to = lexRef(w[2], 0).ref; }
    ins.type = 'waitc'; ins.cond = parseExpr(cond); ins.timeoutLbl = to; return;
  }
  if ((m = t.match(/^(TOOL_)?OFFSET\s+CONDITION\s+(PR\[.*?\])/i))) { ins.type = m[1] ? 'toffcond' : 'offcond'; ins.pr = lexRef(m[2], 0).ref; return; }
  if ((m = t.match(/^OVERRIDE\s*=\s*(\d+)\s*%$/i))) { ins.type = 'override'; ins.val = +m[1]; return; }
  if ((m = t.match(/^(UFRAME_NUM|UTOOL_NUM)\s*=\s*(.+)$/i))) { ins.type = m[1].toUpperCase() === 'UFRAME_NUM' ? 'ufnum' : 'utnum'; ins.expr = parseExpr(m[2]); return; }
  if ((m = t.match(/^(UFRAME|UTOOL)\[(\d+)(?::[^\]]*)?\]\s*=\s*(.+)$/i))) { ins.type = m[1].toUpperCase() === 'UFRAME' ? 'setuf' : 'setut'; ins.idx = +m[2]; ins.expr = parseExpr(m[3]); return; }
  if (/^(PAYLOAD|MESSAGE|TIMER|UALM|RSR|JOINT_MAX_SPEED|LINEAR_MAX_SPEED|SKIP\s+CONDITION|\$)/i.test(t)) { ins.type = 'ignored'; return; }
  const eq = splitTop(t, '=');
  if (eq) {
    const lhs = parseExpr(eq[0]);
    if (!lhs.ast.ref) throw new TPError(`Can't assign to "${eq[0].trim()}"`);
    const ref = lhs.ast.ref;
    if (['R', 'PR', 'DO', 'RO', 'GO', 'F', 'AO', 'UO', 'SO'].indexOf(ref.kind) < 0) throw new TPError(`${ref.kind}[ ] can't be set by the program`);
    ins.type = 'assign'; ins.lhs = ref;
    let rhs = eq[1].trim(), pm;
    if ((pm = rhs.match(/^PULSE\s*(?:,\s*(\d*\.?\d+)\s*sec)?$/i))) { ins.pulse = pm[1] ? +pm[1] : 0.5; ins.rhs = null; return; }
    ins.rhs = parseExpr(rhs);
    return;
  }
  ins.type = 'unknown';
}
function parseMotion(ins, t) {
  const m = t.match(/^([JLC])\s+(.*)$/i);
  ins.type = 'motion'; ins.mt = m[1].toUpperCase();
  let rest = m[2];
  const takeRef = () => {
    const mm = rest.match(/^\s*(P|PR)\[/i); if (!mm) throw new TPError('Expected a position P[ ] or PR[ ]');
    const r = lexRef(rest, rest.indexOf(mm[1])); rest = rest.slice(r.end); return r.ref;
  };
  if (ins.mt === 'C') { ins.via = takeRef(); }
  ins.tgt = takeRef();
  rest = rest.trim();
  // speed
  let sm;
  ins.speed = { kind: 'pct', val: 100 };
  if ((sm = rest.match(/^(R\[[^\]]*\]|\d*\.?\d+)\s*(%|mm\/sec|cm\/min|inch\/min|deg\/sec|sec)/i))) {
    const unit = sm[2].toLowerCase(), isReg = /^R\[/i.test(sm[1]);
    ins.speed = { kind: unit === '%' ? 'pct' : unit === 'deg/sec' ? 'deg' : unit === 'sec' ? 'time' : 'lin', unit,
      val: isReg ? null : parseFloat(sm[1]), reg: isReg ? lexRef(sm[1], 0).ref : null };
    rest = rest.slice(sm[0].length).trim();
  } else if ((sm = rest.match(/^max_speed/i))) { ins.speed = { kind: 'max', val: ROBOT.maxLin }; rest = rest.slice(sm[0].length).trim(); }
  // termination
  ins.term = { kind: 'FINE', val: 0 };
  if ((sm = rest.match(/^(FINE|CNT\s*(\d+|R\[[^\]]*\])|CR\s*\d*)/i))) {
    if (/^CNT/i.test(sm[1])) ins.term = /R\[/i.test(sm[2]) ? { kind: 'CNT', reg: lexRef(sm[2], 0).ref, val: 100 } : { kind: 'CNT', val: Math.min(100, +sm[2]) };
    rest = rest.slice(sm[0].length).trim();
  }
  // options
  ins.opts = { offset: null, toolOffset: null, ignored: [] };
  while (rest) {
    let om;
    if ((om = rest.match(/^Tool_Offset(\s*,\s*(PR\[[^\]]*(?:\][^\]]*)?\]))?/i))) { ins.opts.toolOffset = om[2] ? lexRef(om[2], 0).ref : 'cond'; rest = rest.slice(om[0].length).trim(); continue; }
    if ((om = rest.match(/^Offset(\s*,\s*(PR\[[^\]]*(?:\][^\]]*)?\]))?/i))) { ins.opts.offset = om[2] ? lexRef(om[2], 0).ref : 'cond'; rest = rest.slice(om[0].length).trim(); continue; }
    if ((om = rest.match(/^(ACC\s*\d+|Wjnt|INC|TB\s*[\d.]+sec[^ ]*|TA\s*[\d.]+sec[^ ]*|DB\s*[\d.]+mm[^ ]*|Skip\s*,\s*LBL\[[^\]]*\](?:\s*,\s*PR\[[^\]]*\]=LPOS)?|PTH|COORD|RTCP|BREAK)/i))) { ins.opts.ignored.push(om[1]); rest = rest.slice(om[0].length).trim(); continue; }
    ins.opts.ignored.push(rest); rest = '';
  }
}
// Labels, IF/ELSE/ENDIF and FOR/ENDFOR matching, SELECT groups
function analyzeStructure(prog) {
  prog.labels = {}; prog.structErrors = [];
  const ifs = [], fors = [];
  prog.ins.forEach((ins, i) => {
    if (ins.type === 'lbl') { if (prog.labels[ins.lbl] != null) prog.structErrors.push({ line: ins.num, msg: `LBL[${ins.lbl}] is defined twice; jumps go to the first one (line ${prog.ins[prog.labels[ins.lbl]].num}).` }); else prog.labels[ins.lbl] = i; }
    if (ins.type === 'ifthen') ifs.push(i);
    if (ins.type === 'else') { const o = ifs[ifs.length - 1]; if (o == null) prog.structErrors.push({ line: ins.num, msg: 'ELSE without IF ... THEN.' }); else prog.ins[o].elseAt = i, ins.ifAt = o; }
    if (ins.type === 'endif') { const o = ifs.pop(); if (o == null) prog.structErrors.push({ line: ins.num, msg: 'ENDIF without IF ... THEN.' }); else { prog.ins[o].endAt = i; if (prog.ins[o].elseAt != null) prog.ins[prog.ins[o].elseAt].endAt = i; } }
    if (ins.type === 'for') fors.push(i);
    if (ins.type === 'endfor') { const o = fors.pop(); if (o == null) prog.structErrors.push({ line: ins.num, msg: 'ENDFOR without FOR.' }); else { prog.ins[o].endAt = i; ins.forAt = o; } }
    if (ins.type === 'select') {
      ins.cases = [i]; let j = i + 1;
      while (j < prog.ins.length && (prog.ins[j].type === 'selcase' || prog.ins[j].type === 'selelse')) { ins.cases.push(j); prog.ins[j].selectAt = i; j++; if (prog.ins[j - 1].type === 'selelse') break; }
      ins.groupEnd = j - 1;
    }
    if ((ins.type === 'selcase' || ins.type === 'selelse') && ins.selectAt == null) {
      const p = prog.ins[i - 1]; if (!p || (p.selectAt == null && p.type !== 'select')) prog.structErrors.push({ line: ins.num, msg: 'This SELECT branch isn’t right after a SELECT line.' });
    }
  });
  ifs.forEach(i => prog.structErrors.push({ line: prog.ins[i].num, msg: 'IF ... THEN has no matching ENDIF.' }));
  fors.forEach(i => prog.structErrors.push({ line: prog.ins[i].num, msg: 'FOR has no matching ENDFOR.' }));
}
// Registers, positions and I/O a program refers to (for the settings panels)
function collectRefs(progs) {
  const out = { R: new Set(), PR: new Set(), inputs: new Set(), outputs: new Set(), UF: new Set([0]), UT: new Set([1]) };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.ref) addRef(node.ref);
    if (node.ast) visit(node.ast);
    for (const k of ['a', 'b']) if (node[k]) visit(node[k]);
  };
  const addRef = (r) => {
    if (typeof r.idx === 'object') addRef(r.idx);
    const idx = typeof r.idx === 'number' ? r.idx : null; if (idx == null) return;
    if (r.kind === 'R') out.R.add(idx);
    else if (r.kind === 'PR') out.PR.add(idx);
    else if (INPUT_KINDS.has(r.kind)) out.inputs.add(`${r.kind}[${idx}]`);
    else if (['DO', 'RO', 'GO', 'F', 'AO', 'UO', 'SO', 'M'].includes(r.kind)) out.outputs.add(`${r.kind}[${idx}]`);
  };
  for (const prog of progs) {
    for (const P of Object.values(prog.pos)) { out.UF.add(P.uf); out.UT.add(P.ut); }
    for (const ins of prog.ins) {
      for (const k of ['cond', 'value', 'from', 'to', 'time', 'expr', 'rhs']) if (ins[k]) visit(ins[k]);
      for (const k of ['tgt', 'via', 'reg', 'lhs', 'pr', 'lbl']) if (ins[k] && typeof ins[k] === 'object') addRef(ins[k]);
      if (ins.speed && ins.speed.reg) addRef(ins.speed.reg);
      if (ins.term && ins.term.reg) addRef(ins.term.reg);
      if (ins.opts) for (const k of ['offset', 'toolOffset']) if (ins.opts[k] && typeof ins.opts[k] === 'object') addRef(ins.opts[k]);
      if (ins.type === 'ufnum' && ins.expr.ast.num != null) out.UF.add(ins.expr.ast.num);
      if (ins.type === 'utnum' && ins.expr.ast.num != null) out.UT.add(ins.expr.ast.num);
      if (ins.type === 'setuf') out.UF.add(ins.idx);
      if (ins.type === 'setut') out.UT.add(ins.idx);
    }
  }
  return out;
}

// ---------- motion segments ----------
function pathLen(sm) { let s = 0; for (let i = 1; i < sm.length; i++) s += len(sub(sm[i].p, sm[i - 1].p)); return s; }
function interpSample(a, b, f) {
  return { p: lerp3(a.p, b.p, f), quat: slerp(a.quat, b.quat, f), q: a.q && b.q ? lerpN(a.q, b.q, f) : null, tau: a.tau + (b.tau - a.tau) * f };
}
function trimStart(sm, r) {
  let acc = 0;
  for (let k = 1; k < sm.length; k++) {
    const d = len(sub(sm[k].p, sm[k - 1].p));
    if (acc + d >= r) { const f = d > 0 ? (r - acc) / d : 0; return [interpSample(sm[k - 1], sm[k], f), ...sm.slice(k)]; }
    acc += d;
  }
  return [sm[sm.length - 1]];
}
function trimEnd(sm, r) { return trimStart(sm.slice().reverse(), r).reverse(); }
function distToSeg(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab); if (l2 < 1e-9) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)); return len(sub(p, add(a, scl(ab, t))));
}
// cur/tgt: { p, R, q } in world. speed: resolved { kind, val }. override in %.
function buildMotion(mt, cur, tgt, via, speed, tool, override) {
  const seg = { mt, samples: [] };
  const ov = Math.max(1, override) / 100;
  if (mt === 'J') {
    const qa = cur.q; let qb = tgt.q, reach = true;
    if (!qb) { const s = ik(tgt.p, tgt.R, tool, qa); qb = s.q; reach = s.reach; }
    const dq = qb.map((v, k) => Math.abs(v - qa[k]));
    let dur;
    if (speed.kind === 'pct') dur = Math.max(...dq.map((d, k) => d / (ROBOT.vmax[k] * Math.max(speed.val, 1) / 100 * ov)));
    else if (speed.kind === 'time') dur = speed.val;
    else dur = len(sub(tgt.p, cur.p)) / ((speed.val || 250) * ov);
    dur = Math.max(dur, 0.08) + 0.15;
    const N = Math.min(400, Math.max(16, Math.ceil(Math.max(...dq) / 0.5)));
    for (let k = 0; k <= N; k++) {
      const s = k / N, q = lerpN(qa, qb, s), f = fk(q, tool);
      seg.samples.push({ p: f.tip, quat: quatFromR(f.R), q, tau: s * dur });
    }
    seg.dur = dur; seg.reach = reach; seg.endQ = qb; seg.endP = seg.samples[N].p; seg.endR = quatToR(seg.samples[N].quat);
  } else {
    const qa = quatFromR(cur.R), qb = quatFromR(tgt.R);
    let pts = null, plen = len(sub(tgt.p, cur.p));
    if (mt === 'C' && via) {
      const c = circle3(cur.p, via.p, tgt.p);
      if (c) {
        plen = c.r * c.sweep; seg.circle = c;
        const N = Math.max(12, Math.ceil(plen / 2)); pts = [];
        for (let k = 0; k <= N; k++) { const a = c.sweep * k / N; pts.push({ p: add(c.center, add(scl(c.e1, c.r * Math.cos(a)), scl(c.e2, c.r * Math.sin(a)))), s: k / N }); }
      } else seg.badArc = true;
    }
    if (!pts) { const N = Math.max(2, Math.ceil(plen / 2)); pts = []; for (let k = 0; k <= N; k++) pts.push({ p: lerp3(cur.p, tgt.p, k / N), s: k / N }); }
    const angle = quatAngle(qa, qb) * R2D;
    const v = (speed.kind === 'lin' || speed.kind === 'max' ? speed.val : speed.kind === 'pct' ? ROBOT.maxLin * speed.val / 100 : 250) * ov;
    let dur = speed.kind === 'time' ? speed.val : speed.kind === 'deg' ? Math.max(angle / (speed.val * ov), plen / ROBOT.maxLin) : Math.max(plen / Math.max(v, 0.1), angle / 180) + v / 4000;
    dur = Math.max(dur, 0.05);
    seg.samples = pts.map(o => ({ p: o.p, quat: slerp(qa, qb, o.s), q: null, tau: o.s * dur }));
    seg.dur = dur;
    const s = ik(tgt.p, tgt.R, tool, cur.q); seg.reach = s.reach; seg.endQ = s.q; seg.endP = tgt.p; seg.endR = tgt.R;
  }
  seg.len = pathLen(seg.samples); seg.v = seg.len / seg.dur; seg.full = seg.samples;
  return seg;
}

// ---------- interpreter ----------
// settings: { tools:{n:[6]}, uframes:{n:[6]}, pr:{n:{type,v}}, r:{n:num}, inputs:{'DI[1]':{v,at,to}}, comp, tol, maxTime, start }
function simulate(rootName, programs, st) {
  const byName = {}; programs.forEach(p => byName[p.name.toUpperCase()] = p);
  const root = byName[rootName.toUpperCase()];
  const issues = [], segs = [], steps = [], snaps = [], ioEvents = [];
  const issueKeys = new Set();
  const flag = (prog, line, sev, title, detail, key) => {
    const k = key || `${prog}|${line}|${title}`; if (issueKeys.has(k)) return; issueKeys.add(k);
    issues.push({ prog, line, sev, title, detail, t: tExec, stepIdx: steps.length - 1 });
  };
  // machine state
  const S = {
    R: {}, PR: {}, out: {}, uf: 0, ut: 1, override: 100, offCond: null, toolOffCond: null,
    uframes: {}, tools: {}, rSet: new Set()
  };
  for (const k in st.r || {}) S.R[k] = +st.r[k] || 0;
  for (const k in st.pr || {}) if (st.pr[k]) S.PR[k] = { type: st.pr[k].type, v: st.pr[k].v.slice() };
  for (const k in st.uframes || {}) S.uframes[k] = st.uframes[k].slice();
  for (const k in st.tools || {}) S.tools[k] = st.tools[k].slice();
  if (!S.tools[1]) S.tools[1] = [0, 0, 100, 0, 0, 0];
  const toolOf = n => { const v = S.tools[n] || [0, 0, 0, 0, 0, 0]; return { p: [v[0], v[1], v[2]], R: wprToR(v[3], v[4], v[5]) }; };
  const ufOf = n => frameOf(n === 0 ? [0, 0, 0, 0, 0, 0] : (S.uframes[n] || [0, 0, 0, 0, 0, 0]));
  let tExec = 0;
  const snapshot = () => { snaps.push({ R: { ...S.R }, PR: JSON.parse(JSON.stringify(S.PR)), out: { ...S.out }, uf: S.uf, ut: S.ut, override: S.override }); };
  snapshot();
  const inputVal = (key, t) => {
    const d = (st.inputs || {})[key]; if (!d) return 0;
    if (d.at != null && d.at !== '' && t >= +d.at) return d.to != null && d.to !== '' ? +d.to : (+d.v ? 0 : 1);
    return +d.v || 0;
  };
  const nextInputChange = (t) => {
    let best = null;
    for (const k in st.inputs || {}) { const d = st.inputs[k]; if (d.at != null && d.at !== '' && +d.at > t + 1e-9 && (best == null || +d.at < best)) best = +d.at; }
    return best;
  };
  // current robot pose
  const q0 = (st.start || HOME).slice();
  let cur = (() => { const f = fk(q0, toolOf(1)); return { p: f.tip, R: f.R, q: q0, label: 'start' }; })();
  if (!root) return { error: `Program ${rootName} isn't loaded.` };
  let curProgName = root.name, curLine = 0;

  // evaluation
  const idxOf = (r) => typeof r.idx === 'object' ? Math.round(readRef(r.idx)) : r.idx;
  const warnUninitR = (n) => { if (!S.rSet.has(n) && !(st.r && n in st.r)) flag(curProgName, curLine, 'info', `R[${n}] is used before it is set`, `The program reads R[${n}] before giving it a value, so the controller would use whatever it held from the last run. The simulator starts it at 0; set a starting value under Registers if your cell holds something else.`, 'uninitR' + n); };
  const prGet = (n) => {
    if (!S.PR[n]) { flag(curProgName, curLine, 'info', `PR[${n}] has no value yet`, `PR[${n}] is used before the program gives it a value. On a real controller it holds whatever was stored there (or is uninitialized). The simulator treats it as all zeros; enter its value under Position registers.`, 'uninitPR' + n); S.PR[n] = { type: 'cart', v: [0, 0, 0, 0, 0, 0] }; }
    return S.PR[n];
  };
  function readRef(r) {
    const n = idxOf(r);
    switch (r.kind) {
      case 'R': if (!(n in S.R)) { warnUninitR(n); S.R[n] = 0; } return S.R[n];
      case 'PR': { const pr = prGet(n); if (r.elem != null) return pr.v[r.elem - 1] ?? 0; return { pr: { type: pr.type, v: pr.v.slice() } }; }
      case 'P': { const P = (byName[curProgName].pos || {})[n]; if (!P) throw new TPError(`P[${n}] has no position data`); return { pr: P.cart ? { type: 'cart', v: P.cart.slice() } : { type: 'joint', v: P.joints.slice() } }; }
      case 'AR': return 0;
      default: {
        const key = `${r.kind}[${n}]`;
        if (INPUT_KINDS.has(r.kind)) return inputVal(key, tExec);
        return S.out[key] ?? 0;
      }
    }
  }
  function prAdd(a, b, sign) {
    if (a.type !== b.type) {
      const toCart = (x) => x.type === 'cart' ? x : (() => { const f = fk(x.v, toolOf(S.ut)); const loc = toFrame(ufOf(S.uf), f.tip, f.R); return { type: 'cart', v: poseToV6(loc.p, loc.R) }; })();
      a = toCart(a); b = toCart(b);
    }
    return { type: a.type, v: a.v.map((x, i) => x + sign * b.v[i]) };
  }
  function evalNode(n) {
    if (n.num != null) return n.num;
    if (n.ref) return readRef(n.ref);
    if (n.pos) {
      if (n.pos === 'JPOS') return { pr: { type: 'joint', v: cur.q.slice() } };
      const loc = toFrame(ufOf(S.uf), cur.p, cur.R); return { pr: { type: 'cart', v: poseToV6(loc.p, loc.R) } };
    }
    if (n.sysvar) return 0;
    const a = n.a ? evalNode(n.a) : null;
    if (n.op === 'NEG') return a && a.pr ? { pr: { type: a.pr.type, v: a.pr.v.map(x => -x) } } : -a;
    if (n.op === 'NOT') return a ? 0 : 1;
    if (n.op === 'AND') return a && evalNode(n.b) ? 1 : 0;
    if (n.op === 'OR') return a || evalNode(n.b) ? 1 : 0;
    const b = evalNode(n.b);
    if (a && a.pr || b && b.pr) {
      if (!(a && a.pr && b && b.pr) || (n.op !== '+' && n.op !== '-')) throw new TPError('Position registers can only be added to or subtracted from other positions');
      return { pr: prAdd(a.pr, b.pr, n.op === '+' ? 1 : -1) };
    }
    switch (n.op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': if (b === 0) throw new TPError('Division by zero'); return a / b;
      case 'DIV': if (b === 0) throw new TPError('Division by zero'); return Math.trunc(a / b);
      case 'MOD': if (b === 0) throw new TPError('Division by zero'); return a - Math.trunc(a / b) * b;
      case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0; case '<>': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
      case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b + 1e-9 ? 1 : 0; case '>=': return a >= b - 1e-9 ? 1 : 0;
    }
    throw new TPError('Unknown operator ' + n.op);
  }
  const evalE = (e) => evalNode(e.ast);
  const checkFlags = (e, prog, line, isCond) => {
    if (!e || !e.flags || e.flags.parens) return;
    if (e.flags.addsub && e.flags.muldiv) flag(prog, line, 'warn', 'Mixes + or − with * or /', 'The standard register instruction can’t mix + / − with * / / on one line (operations run left to right). Put the expression in parentheses (mixed logic) or split it into two lines. The simulator uses normal math precedence here.');
    if (isCond && e.flags.and && e.flags.or) flag(prog, line, 'warn', 'Mixes AND with OR', 'An IF or WAIT condition can use AND or OR, but not both on the same line. Use parentheses (mixed logic) or split the condition.');
  };

  // targets
  function poseFor(ref, progName, line, ins) {
    const n = idxOf(ref), prog = byName[progName];
    let local = null, world = null, q = null, label = `${ref.kind}[${n}]`;
    if (ref.kind === 'P') {
      const P = prog.pos[n];
      if (!P) throw new TPError(`P[${n}] is used but has no position data`);
      if (P.cart) {
        if (P.uf !== S.uf) flag(progName, line, 'bad', `${label} was taught in user frame ${P.uf}, but UFRAME_NUM is ${S.uf}`, `The controller stops with a frame mismatch alarm when a point's user frame doesn't match the active UFRAME_NUM. Add UFRAME_NUM=${P.uf} before this move, or re-teach the point. The simulator uses the point's own frame.`, 'ufm' + progName + n + S.uf);
        if (P.ut !== S.ut) flag(progName, line, 'bad', `${label} was taught with tool frame ${P.ut}, but UTOOL_NUM is ${S.ut}`, `The controller stops with a tool frame mismatch alarm. Add UTOOL_NUM=${P.ut} before this move, or re-teach the point.`, 'utm' + progName + n + S.ut);
        local = { p: P.cart.slice(0, 3), R: wprToR(P.cart[3], P.cart[4], P.cart[5]), uf: P.uf };
      } else q = P.joints.slice();
    } else {
      // A PR with no stored value used as a target is treated as the default home (joints)
      if (!S.PR[n]) S.PR[n] = { type: 'joint', v: (st.start || HOME).slice(), assumed: true };
      const pr = S.PR[n];
      if (pr.type === 'cart') local = { p: pr.v.slice(0, 3), R: wprToR(pr.v[3], pr.v[4], pr.v[5]), uf: S.uf };
      else q = pr.v.slice();
    }
    const tool = toolOf(S.ut);
    const offRef = ins && ins.opts ? (ins.opts.offset === 'cond' ? S.offCond : ins.opts.offset) : null;
    const toffRef = ins && ins.opts ? (ins.opts.toolOffset === 'cond' ? S.toolOffCond : ins.opts.toolOffset) : null;
    if (ins && ins.opts && ins.opts.offset === 'cond' && !S.offCond) flag(progName, line, 'bad', 'Offset with no OFFSET CONDITION', 'This move says "Offset" without a PR, but no OFFSET CONDITION PR[ ] was set earlier. Add OFFSET CONDITION PR[n] before it or write Offset,PR[n].');
    if (ins && ins.opts && ins.opts.toolOffset === 'cond' && !S.toolOffCond) flag(progName, line, 'bad', 'Tool_Offset with no TOOL_OFFSET CONDITION', 'Add TOOL_OFFSET CONDITION PR[n] before this move or write Tool_Offset,PR[n].');
    if ((offRef || toffRef) && q && !local) {
      const f = fk(q, tool); const loc = toFrame(ufOf(S.uf), f.tip, f.R); local = { p: loc.p, R: loc.R, uf: S.uf }; q = null;
    }
    if (offRef) {
      const o = prGet(idxOf(offRef));
      if (o.type !== 'cart') flag(progName, line, 'bad', `Offset PR[${idxOf(offRef)}] holds joint values`, 'An offset must be a Cartesian (XYZWPR) position register.');
      else { local.p = add(local.p, o.v.slice(0, 3)); local.R = matMul(wprToR(o.v[3], o.v[4], o.v[5]), local.R); }
      label += ` + PR[${idxOf(offRef)}]`;
    }
    if (local) world = toWorld(ufOf(local.uf), local.p, local.R);
    if (toffRef) {
      const o = prGet(idxOf(toffRef));
      if (o.type === 'cart') { world.p = add(world.p, matVec(world.R, o.v.slice(0, 3))); world.R = matMul(world.R, wprToR(o.v[3], o.v[4], o.v[5])); }
      label += ` + tool PR[${idxOf(toffRef)}]`;
    }
    if (!world) { const f = fk(q, tool); world = { p: f.tip, R: f.R }; }
    return { p: world.p, R: world.R, q, label, isPR: ref.kind === 'PR', taught: ref.kind === 'P' };
  }

  const stack = [{ prog: root.name, pc: 0, rootLine: null }];
  let stopReason = null, moveCount = 0;
  const rootLineNow = () => stack.length === 1 ? curLine : stack[0].callLine;
  const pushStep = (kind, extra) => steps.push({ prog: curProgName, line: curLine, kind, t: tExec, snap: snaps.length - 1, seg: segs.length, depth: stack.length, rootLine: rootLineNow(), ...extra });
  const changed = () => snapshot();
  const addDwell = (dur, kind) => {
    const s = { p: cur.p, quat: quatFromR(cur.R), q: cur.q, tau: 0 };
    segs.push({ mt: 'W', kind, prog: curProgName, line: curLine, rootLine: rootLineNow(), toolUsed: toolOf(S.ut), from: cur, to: cur, term: { kind: 'FINE', val: 0 },
      samples: [s, { ...s, tau: dur }], full: [s, { ...s, tau: dur }], dur, len: 0, v: 0, reach: true });
    tExec += dur;
  };
  const jumpTo = (frame, prog, lblRef) => {
    const n = idxOf(lblRef);
    const at = prog.labels[n];
    if (at == null) { flag(prog.name, curLine, 'bad', `LBL[${n}] doesn't exist`, `The jump goes to LBL[${n}], but no line in ${prog.name} defines it. The controller stops here with an alarm.`); stopReason = 'error'; return false; }
    frame.pc = at; return true;
  };
  const doCall = (name) => {
    const p = byName[name];
    if (!p) { flag(curProgName, curLine, 'bad', `CALL ${name}: program not loaded`, `Load ${name}.ls (Open .ls…) so the simulator can run it. For now the call is skipped.`); return; }
    if (stack.length > 30) { flag(curProgName, curLine, 'bad', 'Too many nested CALLs', 'Programs call each other more than 30 deep, which usually means a program calls itself. Stopped.'); stopReason = 'error'; return; }
    if (stack.length === 1) stack[0].callLine = curLine;
    stack.push({ prog: p.name, pc: 0 });
  };
  const doAction = (frame, prog, action, after) => {
    if (action.act === 'jmp') return jumpTo(frame, prog, action.lbl);
    frame.pc = after; doCall(action.prog); return true;
  };
  for (const p of programs) for (const se of p.structErrors || []) flag(p.name, se.line, 'bad', 'Program structure', se.msg);

  while (!stopReason) {
    if (steps.length >= LIMITS.steps) { stopReason = 'steps'; break; }
    if (tExec >= (st.maxTime || 120)) { stopReason = 'time'; break; }
    if (moveCount >= LIMITS.moves) { stopReason = 'moves'; break; }
    const frame = stack[stack.length - 1];
    const prog = byName[frame.prog];
    if (frame.pc >= prog.ins.length) { stack.pop(); if (!stack.length) { stopReason = 'end'; break; } continue; }
    const ins = prog.ins[frame.pc];
    curProgName = prog.name; curLine = ins.num;
    try {
      switch (ins.type) {
        case 'empty': case 'comment': case 'remark': case 'lbl': case 'endif':
          pushStep('logic'); frame.pc++; break;
        case 'error':
          flag(prog.name, ins.num, 'bad', 'Can’t read this line', ins.error); pushStep('logic'); frame.pc++; break;
        case 'unknown':
          flag(prog.name, ins.num, 'info', 'Instruction not simulated', `"${ins.text}" isn't something the simulator understands yet, so it is skipped.`); pushStep('logic'); frame.pc++; break;
        case 'ignored':
          pushStep('logic'); frame.pc++; break;
        case 'pause':
          flag(prog.name, ins.num, 'info', 'PAUSE', 'The real program would pause here until restarted. The simulator carries on.'); pushStep('logic'); frame.pc++; break;
        case 'abort':
          pushStep('logic'); stopReason = 'abort'; break;
        case 'end':
          pushStep('logic'); stack.pop(); if (!stack.length) stopReason = 'end'; break;
        case 'jmp':
          pushStep('logic'); jumpTo(frame, prog, ins.lbl); break;
        case 'call':
          pushStep('logic'); frame.pc++; doCall(ins.prog); break;
        case 'if': {
          checkFlags(ins.cond, prog.name, ins.num, true);
          const v = evalE(ins.cond); pushStep('logic', { cond: !!v });
          if (v) doAction(frame, prog, ins.action, frame.pc + 1); else frame.pc++;
          break;
        }
        case 'ifthen': {
          const v = evalE(ins.cond); pushStep('logic', { cond: !!v });
          if (v) frame.pc++;
          else frame.pc = ins.elseAt != null ? ins.elseAt + 1 : (ins.endAt != null ? ins.endAt + 1 : frame.pc + 1);
          break;
        }
        case 'else': pushStep('logic'); frame.pc = ins.endAt != null ? ins.endAt + 1 : frame.pc + 1; break;
        case 'select': {
          const v = readRef(ins.reg); let taken = null;
          for (const ci of ins.cases) {
            const c = prog.ins[ci];
            if (c.type === 'selelse' || (c.type === 'select' ? Math.abs(evalE(c.value) - v) < 1e-9 : Math.abs(evalE(c.value) - v) < 1e-9)) { taken = c; break; }
          }
          pushStep('logic', { cond: !!taken });
          const after = ins.groupEnd + 1;
          if (taken) { if (taken !== ins) { curLine = taken.num; steps.push({ ...steps[steps.length - 1], line: taken.num, rootLine: rootLineNow() }); } doAction(frame, prog, taken.action, after); }
          else frame.pc = after;
          break;
        }
        case 'selcase': case 'selelse': pushStep('logic'); frame.pc++; break;
        case 'for': {
          const from = evalE(ins.from), to = evalE(ins.to), n = idxOf(ins.reg);
          S.R[n] = from; S.rSet.add(n); changed(); pushStep('logic');
          const ok = ins.down ? from >= to : from <= to;
          frame.pc = ok ? frame.pc + 1 : (ins.endAt != null ? ins.endAt + 1 : frame.pc + 1);
          break;
        }
        case 'endfor': {
          const f = prog.ins[ins.forAt]; if (!f) { pushStep('logic'); frame.pc++; break; }
          const n = idxOf(f.reg), to = evalE(f.to);
          S.R[n] = (S.R[n] || 0) + (f.down ? -1 : 1); changed(); pushStep('logic');
          const ok = f.down ? S.R[n] >= to : S.R[n] <= to;
          frame.pc = ok ? ins.forAt + 1 : frame.pc + 1;
          break;
        }
        case 'waitt': {
          const d = Math.max(0, evalE(ins.time)); pushStep('wait', { dur: d }); addDwell(d, 'time'); frame.pc++; break;
        }
        case 'waitc': {
          checkFlags(ins.cond, prog.name, ins.num, true);
          const t0 = tExec, limit = ins.timeoutLbl ? WAIT_TIMEOUT_DEFAULT : Infinity;
          let ok = !!evalE(ins.cond), tt = t0;
          while (!ok) {
            const nx = nextInputChange(tt);
            if (nx == null || nx - t0 > limit) break;
            tt = nx; tExec = tt; ok = !!evalE(ins.cond); tExec = t0;
          }
          if (ok) { const d = tt - t0; pushStep('wait', { dur: d, cond: true }); if (d > 0) addDwell(d, 'cond'); frame.pc++; }
          else if (ins.timeoutLbl) { pushStep('wait', { dur: limit, cond: false }); addDwell(limit, 'timeout'); flag(prog.name, ins.num, 'info', 'WAIT timed out', `The condition never came true, so after the ${WAIT_TIMEOUT_DEFAULT} s timeout the program jumps to LBL[${idxOf(ins.timeoutLbl)}]. (The real timeout comes from $WAITTMOUT.)`); jumpTo(frame, prog, ins.timeoutLbl); }
          else { pushStep('wait', { dur: 2, cond: false }); addDwell(2, 'forever'); flag(prog.name, ins.num, 'bad', 'Waits forever', `"${ins.text}" never becomes true with the inputs as set, so the robot would sit here forever. Change the input under Inputs, or set it to switch on after a few seconds.`); stopReason = 'wait'; }
          break;
        }
        case 'offcond': S.offCond = ins.pr; pushStep('logic'); frame.pc++; break;
        case 'toffcond': S.toolOffCond = ins.pr; pushStep('logic'); frame.pc++; break;
        case 'override': S.override = ins.val; changed(); pushStep('logic'); frame.pc++; break;
        case 'ufnum': S.uf = Math.round(evalE(ins.expr)); changed(); pushStep('logic'); frame.pc++; break;
        case 'utnum': S.ut = Math.round(evalE(ins.expr)); if (!S.tools[S.ut]) flag(prog.name, ins.num, 'warn', `Tool frame ${S.ut} isn't set up`, `Enter tool frame ${S.ut} under Settings › Tool frames. Until then it is treated as the bare faceplate.`, 'ut' + S.ut); changed(); pushStep('logic'); frame.pc++; break;
        case 'setuf': case 'setut': {
          const v = evalE(ins.expr); if (!v || !v.pr || v.pr.type !== 'cart') throw new TPError('Frames must be set from a Cartesian position register');
          (ins.type === 'setuf' ? S.uframes : S.tools)[ins.idx] = v.pr.v.slice(); changed(); pushStep('logic'); frame.pc++; break;
        }
        case 'assign': {
          const L = ins.lhs, n = idxOf(L);
          if (ins.pulse != null) {
            const key = `${L.kind}[${n}]`; S.out[key] = 1; changed(); ioEvents.push({ key, t: tExec, v: 1, pulse: ins.pulse }); pushStep('logic'); frame.pc++; S.out[key] = 0; changed(); break;
          }
          checkFlags(ins.rhs, prog.name, ins.num, false);
          const ra = ins.rhs.ast;
          // PR[i]=PR[i]-PR[i] is the standard way to clear a register; don't warn about its old value
          if (L.kind === 'PR' && L.elem == null && ra.op === '-' && ra.a.ref && ra.b.ref && ra.a.ref.kind === 'PR' && ra.b.ref.kind === 'PR' && ra.a.ref.elem == null && ra.b.ref.elem == null && idxOf(ra.a.ref) === n && idxOf(ra.b.ref) === n) {
            const old = S.PR[n]; S.PR[n] = { type: old ? old.type : 'cart', v: [0, 0, 0, 0, 0, 0] }; changed(); pushStep('logic'); frame.pc++; break;
          }
          const v = evalE(ins.rhs);
          if (L.kind === 'R') { if (v && v.pr) throw new TPError('Can’t store a whole position in R[ ]; use PR[ ] or pick one element like PR[1,3]'); S.R[n] = v; S.rSet.add(n); }
          else if (L.kind === 'PR') {
            if (L.elem != null) { if (v && v.pr) throw new TPError('PR[i,j] holds a single number'); const pr = prGet(n); pr.v[L.elem - 1] = v; }
            else { if (!(v && v.pr)) throw new TPError('PR[ ] needs a position (P[ ], PR[ ], LPOS or JPOS)'); S.PR[n] = { type: v.pr.type, v: v.pr.v.slice() }; }
          } else { const key = `${L.kind}[${n}]`; S.out[key] = L.kind === 'GO' || L.kind === 'AO' ? v : (v ? 1 : 0); ioEvents.push({ key, t: tExec, v: S.out[key] }); }
          changed(); pushStep('logic'); frame.pc++; break;
        }
        case 'motion': {
          const speed = { ...ins.speed };
          if (speed.reg) speed.val = readRef(speed.reg);
          const term = { ...ins.term }; if (term.reg) term.val = Math.max(0, Math.min(100, readRef(term.reg)));
          const tgt = poseFor(ins.tgt, prog.name, ins.num, ins);
          const via = ins.mt === 'C' ? poseFor(ins.via, prog.name, ins.num, null) : null;
          if (ins.opts.ignored.length) flag(prog.name, ins.num, 'info', 'Motion option not simulated', `"${ins.opts.ignored.join(' ')}" is ignored; the move is shown without it.`);
          const tool = toolOf(S.ut);
          const seg = buildMotion(ins.mt, cur, tgt, via, speed, tool, S.override);
          if (seg.badArc) flag(prog.name, ins.num, 'warn', 'Circle points are in a line', 'The start, via and end points don’t define an arc, so this is drawn straight.');
          Object.assign(seg, { prog: prog.name, line: ins.num, rootLine: rootLineNow(), ins, from: cur, to: tgt, term, via, toolUsed: tool });
          pushStep('move');
          segs.push(seg); moveCount++;
          tExec += seg.dur;
          cur = { p: seg.endP, R: seg.endR, q: seg.endQ, label: tgt.label, taught: tgt.taught, isPR: tgt.isPR };
          tgt.p = seg.endP; tgt.q = seg.endQ;
          frame.pc++; break;
        }
        default: pushStep('logic'); frame.pc++;
      }
    } catch (e) {
      const msg = e instanceof TPError ? e.message : (e && e.message) || String(e);
      flag(prog.name, ins.num, 'bad', 'Stopped with an error', msg); pushStep('logic'); stopReason = 'error';
    }
  }
  if (stopReason === 'steps') flag(root.name, curLine, segs.some(s => s.mt !== 'W') ? 'info' : 'warn', 'Program loops forever', `The simulator stopped after ${LIMITS.steps.toLocaleString()} lines. ${segs.length ? 'This is normal for a program that loops until an input changes; ' : 'The loop never moves or waits, so the real controller would just spin here. '}the playback shows the first part.`, 'cap');
  if (stopReason === 'time') flag(root.name, curLine, 'info', 'Program keeps running', `The simulator stopped after ${st.maxTime || 120} s of program time. Programs that loop forever (like waiting for an input) are cut off here. Change "Simulate up to" in Settings for a longer run.`, 'cap');
  if (stopReason === 'moves') flag(root.name, curLine, 'info', 'Program keeps running', `The simulator stopped after ${LIMITS.moves} moves.`, 'cap');
  return finishSim({ root, programs, byName, segs, steps, snaps, issues, ioEvents, st, stopReason, start: cur, uframesFinal: S.uframes, toolsFinal: S.tools });
}

// Blending, timeline, motion findings
function finishSim(R) {
  const { segs, steps, issues, st } = R;
  const moves = segs.filter(s => s.mt !== 'W');
  const zs = moves.map(s => s.to.p[2]);
  const surfZ = zs.length ? Math.min(...zs) : -1e9;
  const onSurf = p => p[2] <= surfZ + (st.tol ?? 1);
  // CNT blending between consecutive motion segments (a WAIT dwell breaks the blend)
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], b = segs[i + 1];
    if (a.mt === 'W' || b.mt === 'W' || a.term.kind !== 'CNT' || a.term.val <= 0) continue;
    const r = (a.term.val / 100) * Math.min(a.len * 0.5, b.len * 0.5, Math.max(2, 0.4 * a.v));
    if (r < 0.3) continue;
    a.blendR = r; a.trimE = r; b.trimS = r;
  }
  for (const s of segs) {
    if (s.trimS) s.samples = trimStart(s.samples, s.trimS);
    if (s.trimE) s.samples = trimEnd(s.samples, s.trimE);
  }
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], b = segs[i + 1]; if (!a.blendR) continue;
    const A = a.samples[a.samples.length - 1], B = b.samples[0], C = a.full[a.full.length - 1];
    const M = Math.max(8, Math.ceil((len(sub(C.p, A.p)) + len(sub(B.p, C.p))) / 2));
    const out = [];
    const tool = a.toolUsed || DEFAULT_TOOL;
    for (let k = 0; k <= M; k++) {
      const t = k / M;
      if (A.q && B.q && C.q) {
        const q = A.q.map((v, j) => (1 - t) * (1 - t) * v + 2 * t * (1 - t) * C.q[j] + t * t * B.q[j]);
        const f = fk(q, tool); out.push({ p: f.tip, quat: quatFromR(f.R), q });
      } else {
        const p = add(add(scl(A.p, (1 - t) * (1 - t)), scl(C.p, 2 * t * (1 - t))), scl(B.p, t * t));
        out.push({ p, quat: slerp(A.quat, B.quat, t), q: null });
      }
    }
    const vb = Math.max(1, (a.v + b.v) / 2); let tau = 0; out[0].tau = 0;
    for (let k = 1; k < out.length; k++) { tau += len(sub(out[k].p, out[k - 1].p)) / vb; out[k].tau = tau; }
    b.blend = out;
  }
  // flatten
  const T = { p: [], quat: [], q: [], t: [], line: [], kind: [], seg: [], prog: [] };
  let t = 0;
  const push = (s, seg, kind, si) => { T.p.push(s.p); T.quat.push(s.quat); T.q.push(s.q); T.t.push(t); T.line.push(seg ? seg.line : 0); T.kind.push(kind); T.seg.push(si); T.prog.push(seg ? seg.prog : R.root.name); };
  const s0 = segs[0] ? segs[0].full[0] : { p: R.start.p, quat: quatFromR(R.start.R), q: R.start.q };
  push({ p: s0.p, quat: s0.quat, q: s0.q }, segs[0], 'S', 0);
  segs.forEach((s, si) => {
    s.tStart = t; s.iStart = T.t.length - 1;
    if (s.blend) for (let k = 1; k < s.blend.length; k++) { t += Math.max(0, s.blend[k].tau - s.blend[k - 1].tau); push(s.blend[k], s, 'B', si); }
    const sm = s.samples;
    for (let k = 1; k < sm.length; k++) { t += Math.max(0, sm[k].tau - sm[k - 1].tau); push(sm[k], s, s.mt, si); }
    if (!s.blendR && s.mt !== 'W') { t += s.term.kind === 'FINE' ? 0.12 : 0.02; push(sm[sm.length - 1], s, s.mt, si); }
    s.tEnd = t; s.iEnd = T.t.length - 1;
  });
  const total = t;
  // tool for IK of Cartesian samples: use the tool active for that segment
  let prevQ = T.q[0] || HOME; T.reach = [];
  for (let i = 0; i < T.p.length; i++) {
    if (!T.q[i]) {
      const seg = segs[T.seg[i]]; const tool = (seg && seg.toolUsed) || DEFAULT_TOOL;
      const s = ik(T.p[i], quatToR(T.quat[i]), tool, prevQ); T.q[i] = s.q; T.reach[i] = s.reach;
    } else T.reach[i] = true;
    prevQ = T.q[i];
  }
  T.ink = T.p.map(p => onSurf(p));
  T.crash = T.p.map(p => p[2] < surfZ - (st.comp ?? 3));
  // step times on the final timeline
  for (const sp of steps) {
    if (sp.kind === 'move' || (sp.kind === 'wait' && sp.dur > 0)) { const sg = segs[sp.seg]; sp.t = sg ? sg.tStart : total; sp.tEnd = sg ? sg.tEnd : total; }
    else { const sg = segs[sp.seg]; sp.t = sg ? sg.tStart : total; sp.tEnd = sp.t; }
  }
  for (const is of issues) { const sp = steps[is.stepIdx]; is.t = sp ? sp.t : 0; }
  motionFindings(R, segs, onSurf, surfZ, T);
  const sevRank = { bad: 0, warn: 1, info: 2 };
  issues.sort((x, y) => (x.prog === R.root.name ? 0 : 1) - (y.prog === R.root.name ? 0 : 1) || x.prog.localeCompare(y.prog) || x.line - y.line || sevRank[x.sev] - sevRank[y.sev]);
  let ink = 0;
  for (let i = 1; i < T.p.length; i++) if (T.ink[i] && T.ink[i - 1]) ink += len(sub(T.p[i], T.p[i - 1]));
  const lineCounts = {};
  for (const sp of steps) if (sp.prog === R.root.name) lineCounts[sp.line] = (lineCounts[sp.line] || 0) + 1;
  return { ...R, T, total, surfZ, inkLen: ink, lineCounts, prog: R.root };
}
function motionFindings(R, segs, onSurf, surfZ, T) {
  const issues = R.issues, seen = new Set();
  const add1 = (s, sev, title, detail) => { const k = s.prog + '|' + s.line + '|' + title; if (seen.has(k)) return; seen.add(k); issues.push({ prog: s.prog, line: s.line, sev, title, detail, t: s.tStart }); };
  const moves = segs.filter(s => s.mt !== 'W');
  moves.forEach((s, mi) => {
    const a = s.from.p, b = s.to.p, aOn = onSurf(a), bOn = onSurf(b);
    const horiz = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!s.reach) add1(s, 'bad', `${s.to.label} is out of reach`, `This arm model can’t reach ${s.to.label} with the active tool frame. Check the tool and user frames in Settings.`);
    if (s.mt === 'J' && aOn && bOn) {
      let dev = 0, lo = 0, hi = 0;
      for (const sm of s.full) { dev = Math.max(dev, distToSeg(sm.p, a, b)); lo = Math.min(lo, sm.p[2] - surfZ); hi = Math.max(hi, sm.p[2] - surfZ); }
      let extra = '';
      if (hi > 0.5) extra += ` It lifts up to ${hi.toFixed(1)} mm off the surface.`;
      if (lo < -0.5) extra += ` It pushes ${(-lo).toFixed(1)} mm into the surface.`;
      if (dev > 0.5) add1(s, 'warn', 'Joint move used to draw a side', `J ${s.to.label} moves each axis independently, so the tip strays up to ${dev.toFixed(1)} mm from the straight line between ${s.from.label} and ${s.to.label}.${extra} Use L for anything drawn on the part.`);
    }
    if (!aOn && bOn && horiz > 10) add1(s, 'warn', `No approach point above ${s.to.label}`, `${s.mt} ${s.to.label} comes in from ${s.from.label} at an angle: ${horiz.toFixed(0)} mm sideways while dropping ${(a[2] - b[2]).toFixed(0)} mm. Add a point directly above (or an Offset) and come straight down with L … FINE.` + (s.blendR ? ` The CNT${s.term.val} also makes the tip touch down before it reaches ${s.to.label}.` : ''));
    if (aOn && !bOn && horiz > 10) add1(s, 'warn', 'Leaves the surface at an angle', `The move to ${s.to.label} drags off ${s.from.label} sideways. Lift straight up with an L move first.`);
    const nx = moves[mi + 1];
    if (s.blendR && bOn && aOn && nx && segs[segs.indexOf(s) + 1] === nx && onSurf(nx.to.p)) add1(s, 'info', `CNT${s.term.val} rounds the corner at ${s.to.label}`, `The tip starts turning about ${s.blendR.toFixed(1)} mm before ${s.to.label} and never touches the corner itself. Use FINE if the corner must be sharp.`);
  });
  const crashBy = {};
  T.crash.forEach((c, i) => { if (c) { const sg = segs[T.seg[i]]; const k = sg.prog + '|' + sg.line; const d = surfZ - T.p[i][2]; if (!crashBy[k] || d > crashBy[k].d) crashBy[k] = { d, s: sg }; } });
  for (const k in crashBy) add1(crashBy[k].s, 'bad', 'Tip goes below the surface', `On this line the tip reaches ${crashBy[k].d.toFixed(1)} mm below the work surface. A pen in a spring holder may survive that; a rigid tool would crash.`);
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const first = run[0].from, last = run[run.length - 1].to, gap = len(sub(last.p, first.p)), nv = run.length + 1;
      const s = run[run.length - 1];
      if (gap > 0.05 && gap < 8) add1(s, 'warn', 'Shape doesn’t close exactly', `It ends on ${last.label}, ${gap.toFixed(1)} mm from where it started at ${first.label}. Reuse ${first.label} as the last point instead of teaching a new one near it.`);
      else if (gap >= 8 && nv >= 4) add1(s, 'info', `Open path from ${first.label} to ${last.label}`, `This stretch on the surface ends ${gap.toFixed(0)} mm from where it started. If it’s meant to be a closed shape, add a move back to ${first.label}.`);
    }
    run = [];
  };
  for (const s of segs) { if (s.mt !== 'W' && onSurf(s.from.p) && onSurf(s.to.p)) run.push(s); else flush(); }
  flush();
}

// public entry: run a program and return the full simulation
function runSim(rootName, programs, st) {
  const res = simulate(rootName, programs, st);
  return res;
}

if (typeof module !== 'undefined') module.exports = { parseLS, splitLS, makeProgram, parsePositions, toLS, formatPosition, runSim, simulate, fk, ik, wprToR, rToWpr, frameOf, toWorld, toFrame, poseToV6, collectRefs, parseLine, parseExpr, refShort, HOME, ROBOT, quatToR, lerp3, lerpN };
