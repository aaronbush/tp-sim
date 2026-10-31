// ===== tp-sim app: workspace, editor wiring, playback, 3D cell, paper view, registers panel =====
'use strict';
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1) => (Math.abs(v) < 0.05 && d <= 1 ? 0 : v).toFixed(d);
const fmtV = v => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : (+v.toFixed(3)).toString());

const store = {
  get(k, d) { try { const v = localStorage.getItem('ppv.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ppv.' + k, JSON.stringify(v)); } catch (e) {} }
};

// ---------- settings ----------
const settings = (() => {
  const s = { tools: { 1: [0, 0, 100, 0, 0, 0] }, uframes: {}, pr: {}, r: {}, inputs: {}, macros: {}, rCmt: {}, prCmt: {}, dataRows: {}, comp: 3, tol: 1, maxTime: 120, waitTimeout: 30, ...store.get('settings2', {}) };
  // migrate v1 settings (tool length + joint-only PRs)
  const oldTool = store.get('tool', null); if (oldTool != null && !store.get('settings2', null)) s.tools[1] = [0, 0, +oldTool, 0, 0, 0];
  const oldPr = store.get('pr', null); if (oldPr && !store.get('settings2', null)) for (const k in oldPr) if (Array.isArray(oldPr[k])) s.pr[k] = { type: 'joint', v: oldPr[k] };
  return s;
})();
const saveSettings = () => store.set('settings2', settings);

// ---------- workspace ----------
// entry: { name, header, lines[], posText, origLines, origPos }
let programs = [], active = -1, sim = null, t = 0, playing = false, speed = 1, pinned = -1, paperDirty = true, lastStepShown = -2;
const cleanLine = l => l.replace(/^\s*\d+:\s?/, '').replace(/\s*;\s*$/, '').trim();
function entryFromText(text) {
  const s = splitLS(text);
  return { name: s.name.toUpperCase(), header: s.header, lines: s.mn, posText: s.posText, origLines: s.mn.join('\n'), origPos: s.posText, errors: s.errors };
}
const parsedOf = e => e._prog || (e._prog = makeProgram(e.name, e.header, e.lines.map(cleanLine), e.posText));
const isEdited = e => e.origLines != null && (e.lines.join('\n') !== e.origLines || e.posText !== e.origPos);
const lsOf = e => toLS(parsedOf(e));
function saveWorkspace() {
  store.set('ws', { active: programs[active] ? programs[active].name : null,
    programs: programs.map(e => ({ ls: toLS({ ...parsedOf(e), lines: e.lines }), origLines: e.origLines, origPos: e.origPos })) });
}
let wsTimer = 0; const saveWorkspaceSoon = () => { clearTimeout(wsTimer); wsTimer = setTimeout(saveWorkspace, 600); };
function addEntry(e, select) {
  const i = programs.findIndex(p => p.name === e.name);
  if (i >= 0) programs[i] = e; else programs.push(e);
  renderTabs();
  if (select) selectProgram(programs.indexOf(e));
  saveWorkspaceSoon();
}
function renderTabs() {
  $('tabs').innerHTML = programs.map((p, i) => `<button class="tab" type="button" role="tab" data-i="${i}" aria-selected="${i === active}" aria-pressed="${i === active}">${isEdited(p) ? '<span class="dot-edit" title="edited"></span>' : ''}${esc(p.name)}<span class="x" data-close="${i}" title="Close" aria-label="Close ${esc(p.name)}">×</span></button>`).join('');
}
let closeArm = null;
$('tabs').addEventListener('click', e => {
  const x = e.target.closest('[data-close]');
  if (x) {
    const i = +x.dataset.close, p = programs[i];
    if (isEdited(p) && closeArm !== i) { closeArm = i; x.textContent = 'close?'; x.title = 'Click again to close and lose edits'; setTimeout(() => { if (closeArm === i) { closeArm = null; renderTabs(); } }, 3000); return; }
    closeArm = null; programs.splice(i, 1);
    if (!programs.length) addEntry(newEntry(), true);
    else selectProgram(Math.max(0, Math.min(active > i || active === programs.length ? active - 1 : active, programs.length - 1)));
    saveWorkspaceSoon(); return;
  }
  const b = e.target.closest('.tab'); if (b) selectProgram(+b.dataset.i);
});
function newEntry() {
  let n = 1; while (programs.some(p => p.name === 'NEW' + n)) n++;
  const lines = ['! New program', 'UFRAME_NUM=0', 'UTOOL_NUM=1', 'J PR[1:HOME] 100% FINE', ''];
  return { name: 'NEW' + n, header: '', lines, posText: '', origLines: null, origPos: null };
}
$('newBtn').addEventListener('click', () => addEntry(newEntry(), true));
$('fileIn').addEventListener('change', async e => {
  const files = [...e.target.files];
  for (let i = 0; i < files.length; i++) {
    const text = await files[i].text(); const en = entryFromText(text);
    if (en.errors.length) { flash(`${files[i].name}: ${en.errors[0]}`); continue; }
    addEntry(en, i === files.length - 1);
  }
  e.target.value = '';
});
// examples
let exampleIndex = [];
async function loadExampleList() {
  try {
    const r = await fetch('examples/index.json'); if (!r.ok) throw 0;
    exampleIndex = (await r.json()).examples;
    $('exampleSel').innerHTML = '<option value="">Examples…</option>' + exampleIndex.map((x, i) => `<option value="${i}">${esc(x.title)}</option>`).join('');
  } catch (e) { $('exampleSel').hidden = true; }
}
async function loadExample(ix, select) {
  const ex = exampleIndex[ix]; if (!ex) return;
  const files = [ex.file, ...(ex.also || [])];
  const texts = await Promise.all(files.map(f => fetch('examples/' + f).then(r => r.text())));
  for (const k in ex.inputs || {}) if (!settings.inputs[k]) settings.inputs[k] = { ...ex.inputs[k] };
  for (const k in ex.macros || {}) if (!settings.macros[k]) settings.macros[k] = ex.macros[k];
  saveSettings();
  texts.forEach((tx, i) => { const en = entryFromText(tx); addEntry(en, false); if (i === 0 && select) selectProgram(programs.findIndex(p => p.name === en.name)); });
}
$('exampleSel').addEventListener('change', async e => { const v = e.target.value; e.target.value = ''; if (v !== '') await loadExample(+v, true); });

function flash(msg) { $('edStatus').textContent = msg; }

// ---------- editors ----------
let edTimer = 0;
const edProg = TPEditor.create($('edProg'), { language: 'tp', counts: true, lint: true, label: 'TP program editor',
  onChange: text => { const e = programs[active]; if (!e) return; e.lines = text.split('\n'); e._prog = null; scheduleRun(); },
  onCursor: line => jumpToLine(line) });
const edPos = TPEditor.create($('edPos'), { language: 'plain', label: 'Positions editor',
  onChange: text => { const e = programs[active]; if (!e) return; e.posText = text; e._prog = null; scheduleRun(); } });
function scheduleRun() { clearTimeout(edTimer); edTimer = setTimeout(() => { programs.forEach(p => { if (p === programs[active]) p._prog = null; }); rerun(true); saveWorkspaceSoon(); updateEditedUI(); renderTabs(); }, 350); }
function setPtab(which) {
  const pos = which === 'pos';
  $('tabProg').setAttribute('aria-selected', !pos); $('tabPos').setAttribute('aria-selected', pos);
  $('edProg').hidden = pos; $('edPos').hidden = !pos;
}
$('tabProg').addEventListener('click', () => setPtab('prog'));
$('tabPos').addEventListener('click', () => setPtab('pos'));
function updateEditedUI() {
  const e = programs[active]; if (!e) return;
  const ed = isEdited(e); $('editedBadge').hidden = !ed; $('revertBtn').hidden = !ed;
}
$('revertBtn').addEventListener('click', () => {
  const e = programs[active]; if (!e || e.origLines == null) return;
  e.lines = e.origLines.split('\n'); e.posText = e.origPos; e._prog = null;
  edProg.setText(e.lines.join('\n')); edPos.setText(e.posText); rerun(true); updateEditedUI(); renderTabs(); saveWorkspaceSoon();
});
$('downloadBtn').addEventListener('click', () => {
  const e = programs[active]; if (!e) return;
  const blob = new Blob([lsOf(e).replace(/\n/g, '\r\n')], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = e.name.toLowerCase() + '.ls';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  flash(`Saved ${e.name.toLowerCase()}.ls. Loading it on a controller needs the ASCII program loader option.`);
});
$('progName').addEventListener('change', () => {
  const e = programs[active]; if (!e) return;
  const v = $('progName').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!/^[A-Z][A-Z0-9_]{0,35}$/.test(v) || programs.some((p, i) => i !== active && p.name === v)) { $('progName').value = e.name; flash('Program names start with a letter and use A–Z, 0–9 and _. Each open program needs its own name.'); return; }
  e.name = v; e._prog = null; renderTabs(); rerun(false); saveWorkspaceSoon();
});

function selectProgram(i) {
  if (i < 0 || i >= programs.length) return;
  active = i; renderTabs();
  const e = programs[i];
  edProg.setText(e.lines.join('\n')); edPos.setText(e.posText);
  $('progName').value = e.name;
  updateEditedUI();
  rerun(false, 0);
  saveWorkspaceSoon();
}

// ---------- simulation ----------
let lastRefsKey = '', comments = {}, progComments = {}, lastPulseEdges = 0;
function settingsForRun(root) {
  const firstPR = root.ins.find(x => x.type === 'motion' && x.tgt.kind === 'PR' && typeof x.tgt.idx === 'number');
  const pr = firstPR && settings.pr[firstPR.tgt.idx];
  return { ...settings, start: pr && pr.type === 'joint' ? pr.v : HOME };
}
function rerun(keepTime, frac) {
  const e = programs[active]; if (!e) return;
  const progs = programs.map(parsedOf);
  const root = parsedOf(e);
  const f = frac != null ? frac : (keepTime && sim ? t / Math.max(sim.total, 1e-6) : 0);
  try { sim = runSim(root.name, progs, settingsForRun(root)); }
  catch (err) { console.error(err); sim = null; $('issues').innerHTML = `<li class="err">Couldn't simulate this program: ${esc(err.message)}</li>`; return; }
  if (sim.error) { $('issues').innerHTML = `<li class="err">${esc(sim.error)}</li>`; sim = null; return; }
  sim.activeName = root.name;
  sim.ptLabels = collectPoints(sim);
  sim.bounds = paperBounds();
  t = Math.min(sim.total, Math.max(0, f * sim.total));
  pinned = t === 0 && sim.steps.length ? 0 : -1; lastStepShown = -2;
  const reach = reachableFrom(root, progs);
  // comments typed in the Data screens win over the ones written in program lines
  progComments = collectComments(reach);
  comments = { ...progComments };
  for (const n in settings.rCmt) comments[`R[${n}]`] = settings.rCmt[n];
  for (const n in settings.prCmt) comments[`PR[${n}]`] = settings.prCmt[n];
  const refs = collectRefs(reach);
  // only ask for starting values the program doesn't set itself
  refs.prNeed = new Set([...refs.PR].filter(n => !reach.some(p => p.ins.some(x => x.type === 'assign' && x.lhs.kind === 'PR' && x.lhs.elem == null && x.lhs.idx === n))));
  refs.rNeed = new Set([...refs.R].filter(n => !reach.some(p => p.ins.some(x => (x.type === 'assign' && x.lhs.kind === 'R' && x.lhs.idx === n) || (x.type === 'for' && x.reg.idx === n)))));
  const key = JSON.stringify({ R: [...refs.rNeed], PR: [...refs.prNeed], UF: [...refs.UF], UT: [...refs.UT], I: [...refs.inputs], O: [...refs.outputs], M: [...refs.macros], P: programs.map(p => p.name) });
  sim.refs = refs;
  if (key !== lastRefsKey) { lastRefsKey = key; renderSettings(refs); }
  renderIssues(); updateData(); buildScene(); paperDirty = true;
  edProg.setDiagnostics(sim.issues.filter(i => i.prog === root.name));
  edProg.setCounts(sim.lineCounts, true);
  $('progMeta').textContent = `${root.name}${root.comment ? ' · "' + root.comment + '"' : ''}`;
}
// program a macro line runs: the macro table, else a loaded program with the same name
const macroTarget = (name, by) => settings.macros[name] || (by[name] ? name : null);
function reachableFrom(root, progs) {
  const by = {}; progs.forEach(p => by[p.name] = p);
  const out = [root], seen = new Set([root.name]);
  for (let k = 0; k < out.length; k++) for (const x of out[k].ins) {
    const name = x.type === 'call' ? x.prog : x.type === 'macro' ? macroTarget(x.name, by) : x.action && x.action.act === 'call' ? x.action.prog : null;
    if (name && by[name] && !seen.has(name)) { seen.add(name); out.push(by[name]); }
  }
  return out;
}
function collectComments(progs) {
  const out = {};
  for (const p of progs) for (const l of p.lines) {
    const re = /\b(R|PR|DI|DO|RI|RO|GI|GO|F|UI|UO)\[(\d+)(?:,\d+)?:([^\]]+)\]/g; let m;
    while ((m = re.exec(l))) { const k = `${m[1]}[${m[2]}]`; if (!out[k]) out[k] = m[3].trim(); }
  }
  return out;
}
function collectPoints(s) {
  const out = [], seen = new Set();
  for (const g of s.segs) {
    if (g.mt === 'W' || !g.to.taught) continue;
    const label = (g.prog !== s.activeName ? g.prog.toLowerCase() + ' ' : '') + g.to.label.replace(/ \+ .*/, '');
    const key = label + '|' + g.to.p.map(v => Math.round(v)).join(',');
    if (seen.has(key)) continue; seen.add(key);
    out.push({ label, p: g.to.p });
    if (g.via && g.via.taught) { const k2 = 'via' + g.via.label + g.via.p.map(v => Math.round(v)).join(','); if (!seen.has(k2)) { seen.add(k2); out.push({ label: g.via.label, p: g.via.p }); } }
  }
  return out;
}

// ---------- steps ----------
function stepAt(tt) {
  const S = sim.steps; if (!S.length) return -1;
  let lo = 0, hi = S.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (S[m].t <= tt + 1e-9) { ans = m; lo = m + 1; } else hi = m - 1; }
  // inside a move or wait, show that line rather than later logic lines at the same instant
  return ans;
}
function currentStep() { return pinned >= 0 ? pinned : stepAt(t); }
function gotoStep(i) {
  if (!sim || i < 0 || i >= sim.steps.length) return;
  const sp = sim.steps[i]; pinned = i; playing = false; updatePlay();
  t = sp.tEnd != null ? sp.tEnd : sp.t; paperDirty = true; lastStepShown = -2;
}
function jumpToLine(line) {
  if (!sim) return;
  if (teachHook && teachHook.active()) { teachHook.onLine(line); return; }
  const S = sim.steps, name = sim.activeName;
  const match = (sp) => sp.prog === name ? sp.line === line : sp.rootLine === line;
  let i = S.findIndex((sp, k) => k > currentStep() && match(sp));
  if (i < 0) i = S.findIndex(match);
  if (i < 0) { flash(`Line ${line} never runs with the current inputs and registers.`); return; }
  flash('Line numbers are the TP line numbers. Edits re-run the simulation.');
  pinned = i; playing = false; updatePlay(); t = S[i].t; paperDirty = true; lastStepShown = -2;
}

// ---------- findings ----------
function renderIssues() {
  const c = { bad: 0, warn: 0, info: 0 }; sim.issues.forEach(i => c[i.sev]++);
  $('issueCount').textContent = sim.issues.length ? `${c.bad} problems · ${c.warn} warnings · ${c.info} notes` : 'none';
  const moves = sim.segs.filter(s => s.mt !== 'W').length;
  const ended = { end: 'ran to the end', abort: 'aborted', error: 'stopped on an error', wait: 'stuck waiting', steps: 'cut off (endless loop)', time: 'cut off (time limit)', moves: 'cut off (move limit)' }[sim.stopReason] || sim.stopReason;
  $('summary').innerHTML = `<span class="chip">cycle ≈ <b>${sim.total.toFixed(1)} s</b></span><span class="chip">moves <b>${moves}</b></span><span class="chip">lines run <b>${sim.steps.length}</b></span><span class="chip">ink <b>${sim.inkLen.toFixed(0)} mm</b></span><span class="chip"><b>${ended}</b></span>`;
  $('issues').innerHTML = sim.issues.length ? sim.issues.map((i, k) => `<li data-k="${k}" tabindex="0"><span class="stripe ${i.sev}"></span><span class="lno">${i.prog !== sim.activeName ? esc(i.prog) + ' ' : ''}L${i.line}</span><div><div class="t">${esc(i.title)}</div><div class="d">${esc(i.detail)}</div></div></li>`).join('')
    : '<li class="empty" style="display:block;cursor:default">No problems found.</li>';
}
const openIssue = li => {
  const is = sim.issues[+li.dataset.k]; if (!is) return;
  if (is.stepIdx != null && is.stepIdx >= 0) { pinned = is.stepIdx; playing = false; updatePlay(); t = sim.steps[is.stepIdx].t; paperDirty = true; lastStepShown = -2; }
  else if (is.t != null) { pinned = -1; t = is.t; paperDirty = true; }
  if (is.prog === sim.activeName) edProg.gotoLine(is.line);
};
$('issues').addEventListener('click', e => { const li = e.target.closest('li[data-k]'); if (li) openIssue(li); });
$('issues').addEventListener('keydown', e => { if (e.key === 'Enter') { const li = e.target.closest('li[data-k]'); if (li) openIssue(li); } });

// ---------- settings panels ----------
const V6H = ['X', 'Y', 'Z', 'W', 'P', 'R'], J6H = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'];
function v6Row(label, id, vals, heads, extra = '') {
  return `<span class="lab">${label}</span>${vals.map((v, j) => `<input class="num" type="number" step="0.1" id="${id}_${j}" data-j="${j}" value="${+(+v).toFixed(3)}" aria-label="${label} ${heads[j]}">`).join('')}${extra}`;
}
function renderSettings(refs) {
  const uts = [...refs.UT].filter(n => n > 0).sort((a, b) => a - b);
  $('toolFields').innerHTML = `<span class="fl">Tool frames (UTOOL)</span><p class="hint">Offset of the tool point from the faceplate. Copy from MENU › SETUP › Frames › Tool Frame on the pendant.</p>
    <div class="v6"><span></span>${V6H.map(h => `<span class="h">${h}</span>`).join('')}${uts.map(n => v6Row('UT ' + n, 'ut' + n, settings.tools[n] || [0, 0, 0, 0, 0, 0], V6H).replace(/data-j/g, `data-ut="${n}" data-j`)).join('')}</div>`;
  const ufs = [...refs.UF].filter(n => n > 0).sort((a, b) => a - b);
  const setByProg = new Set(); reachableFrom(parsedOf(programs[active]), programs.map(parsedOf)).forEach(p => p.ins.forEach(x => { if (x.type === 'setuf') setByProg.add(x.idx); }));
  $('ufFields').innerHTML = ufs.length ? `<span class="fl">User frames (UFRAME)</span><p class="hint">Where each user frame sits in World. Copy from MENU › SETUP › Frames › User Frame.${[...setByProg].length ? ` UF ${[...setByProg].join(', ')} ${setByProg.size > 1 ? 'are' : 'is'} also set by the program, which overrides the value here once that line runs.` : ''}</p>
    <div class="v6"><span></span>${V6H.map(h => `<span class="h">${h}</span>`).join('')}${ufs.map(n => v6Row('UF ' + n, 'uf' + n, settings.uframes[n] || [0, 0, 0, 0, 0, 0], V6H).replace(/data-j/g, `data-uf="${n}" data-j`)).join('')}</div>` : '';
  const ms = [...refs.macros].sort();
  $('macroFields').innerHTML = ms.length ? `<span class="fl">Macros</span><p class="hint">Which program each macro line runs. On the pendant this is the macro table (MENU › SETUP › Macro). Load the macro programs first (Open .ls…).</p>
    <div class="mgrid">${ms.map((n, k) => { const cur = settings.macros[n] || ''; const names = programs.map(p => p.name.toUpperCase());
      return `<label for="mac${k}">${esc(n)}</label><select id="mac${k}" data-mac="${esc(n)}"><option value="">${names.includes(n) ? 'same-named program' : 'not set (skipped)'}</option>${names.map(p => `<option${p === cur ? ' selected' : ''}>${esc(p)}</option>`).join('')}${cur && !names.includes(cur) ? `<option selected value="${esc(cur)}">${esc(cur)} (not loaded)</option>` : ''}</select>`; }).join('')}</div>` : '';
}
$('settings').addEventListener('change', e => {
  const el = e.target; let d = el.dataset;
  if (d.ut) { const v = (settings.tools[d.ut] || [0, 0, 0, 0, 0, 0]).slice(); v[+d.j] = parseFloat(el.value) || 0; settings.tools[d.ut] = v; }
  else if (d.uf) { const v = (settings.uframes[d.uf] || [0, 0, 0, 0, 0, 0]).slice(); v[+d.j] = parseFloat(el.value) || 0; settings.uframes[d.uf] = v; }
  else if (d.mac != null) { if (el.value) settings.macros[d.mac] = el.value; else delete settings.macros[d.mac]; }
  else return;
  saveSettings(); rerun(true);
});

// ---------- data screens (global R[ ] / PR[ ] start values, like DATA on the pendant) ----------
let dataTab = 'R';
const toolOne = () => { const x = settings.tools[1] || [0, 0, 100, 0, 0, 0]; return { p: x.slice(0, 3), R: wprToR(x[3], x[4], x[5]) }; };
// convert a PR between joint and XYZWPR (World, tool 1) so switching type keeps the same pose
function prAs(type, cur) {
  if (!cur) return { type, v: type === 'joint' ? HOME.slice() : (() => { const f = fk(HOME, toolOne()); return poseToV6(f.tip, f.R); })() };
  if (cur.type === type) return cur;
  const v = type === 'cart' ? (() => { const f = fk(cur.v, toolOne()); return poseToV6(f.tip, f.R); })() : ik(cur.v.slice(0, 3), wprToR(cur.v[3], cur.v[4], cur.v[5]), toolOne(), HOME).q;
  return { type, v: v.map(x => +x.toFixed(3)) };
}
const finalSnap = () => sim && sim.snaps.length ? sim.snaps[sim.snaps.length - 1] : null;
function dataRows(kind) {
  const start = kind === 'R' ? settings.r : settings.pr, cmt = settings[kind === 'R' ? 'rCmt' : 'prCmt'], fin = finalSnap();
  const used = sim && sim.refs ? sim.refs[kind] : new Set();
  const idx = [...Object.keys(start), ...Object.keys(cmt), ...used, ...(fin ? Object.keys(fin[kind]) : [])].map(Number).filter(n => n > 0);
  const n = Math.max(10, settings.dataRows[kind] || 0, ...idx);
  return Array.from({ length: n }, (_, i) => i + 1);
}
const prText = pr => pr ? pr.v.map((x, j) => `${(pr.type === 'joint' ? J6H : V6H)[j]} ${fmt(x)}`).join('  ') : 'Uninitialized';
function afterRunR(n) {
  const fin = finalSnap(), v = fin ? fin.R[n] : undefined, s = settings.r[n] ?? 0;
  return { text: v === undefined ? '—' : fmtV(v), chg: v !== undefined && Math.abs(v - s) > 1e-9 };
}
function afterRunPR(n) {
  const fin = finalSnap(), pr = fin ? fin.PR[n] : undefined;
  if (!pr || pr.assumed) return { text: '—', chg: false };
  return { text: prText(pr), chg: JSON.stringify(pr) !== JSON.stringify(settings.pr[n] || null) };
}
function renderData() {
  const refs = sim && sim.refs ? sim.refs : { R: new Set(), PR: new Set(), rNeed: new Set(), prNeed: new Set() };
  const progC = k => progComments[k] || '';
  const tag = (kind, n) => (kind === 'R' ? refs.rNeed : refs.prNeed).has(n) ? ' need' : refs[kind].has(n) ? ' used' : '';
  const tip = (kind, n) => (kind === 'R' ? refs.rNeed : refs.prNeed).has(n) ? ' title="The program reads this before setting it, so it starts from the value here"' : refs[kind].has(n) ? ' title="Used by the program"' : '';
  $('dataR').innerHTML = `<table class="dtab"><thead><tr><th>Reg</th><th>Comment</th><th>Start</th><th>After run</th></tr></thead><tbody>${dataRows('R').map(n => { const a = afterRunR(n);
    return `<tr class="${tag('R', n)}"><td class="rn"${tip('R', n)}>R[${n}]</td><td><input data-drc="${n}" value="${esc(settings.rCmt[n] || '')}" placeholder="${esc(progC('R[' + n + ']'))}" maxlength="16" aria-label="R ${n} comment"></td><td><input class="num" type="number" step="any" data-dr="${n}" value="${settings.r[n] ?? ''}" placeholder="0" aria-label="R ${n} start value"></td><td class="ar${a.chg ? ' chg' : ''}" id="arR${n}">${a.text}</td></tr>`; }).join('')}</tbody></table>`;
  $('dataPR').innerHTML = dataRows('PR').map(n => { const pr = settings.pr[n], heads = pr && pr.type === 'cart' ? V6H : J6H, a = afterRunPR(n);
    return `<div class="dpr${tag('PR', n)}"><div class="dprh"><span class="rn"${tip('PR', n)}>PR[${n}]</span><input data-dprc="${n}" value="${esc(settings.prCmt[n] || '')}" placeholder="${esc(progC('PR[' + n + ']'))}" maxlength="16" aria-label="PR ${n} comment">
      <select data-dprt="${n}" aria-label="PR ${n} type"><option value=""${pr ? '' : ' selected'}>Uninitialized</option><option value="joint"${pr && pr.type === 'joint' ? ' selected' : ''}>Joint</option><option value="cart"${pr && pr.type === 'cart' ? ' selected' : ''}>XYZWPR</option></select></div>
      ${pr ? `<div class="prgrid">${pr.v.map((v, j) => `<label class="pv"><span>${heads[j]}</span><input class="num" type="number" step="0.1" data-dpr="${n}" data-j="${j}" value="${+(+v).toFixed(3)}" aria-label="PR ${n} ${heads[j]}"></label>`).join('')}</div>` : ''}
      <div class="dpar${a.chg ? ' chg' : ''}" id="arPR${n}"><span>after run</span> ${a.text}</div></div>`; }).join('');
}
// refresh only the after-run cells, so typing in a box doesn't lose focus
function refreshAfterRun() {
  for (const n of dataRows('R')) { const el = $('arR' + n); if (el) { const a = afterRunR(n); el.textContent = a.text; el.classList.toggle('chg', a.chg); } }
  for (const n of dataRows('PR')) { const el = $('arPR' + n); if (el) { const a = afterRunPR(n); el.innerHTML = `<span>after run</span> ${a.text}`; el.classList.toggle('chg', a.chg); } }
}
// edits made in the panel itself never change its rows; during their change event focus is already
// on its way to the next box (activeElement is body), so a rebuild there would drop it
let dataEditing = false;
function updateData() { if (dataEditing || $('dataPanel').contains(document.activeElement)) refreshAfterRun(); else renderData(); }
function setDataTab(k) {
  dataTab = k;
  $('dtabR').setAttribute('aria-selected', k === 'R'); $('dtabPR').setAttribute('aria-selected', k === 'PR');
  $('dataR').hidden = k !== 'R'; $('dataPR').hidden = k !== 'PR';
}
$('dtabR').addEventListener('click', () => setDataTab('R'));
$('dtabPR').addEventListener('click', () => setDataTab('PR'));
$('dataMore').addEventListener('click', () => { settings.dataRows[dataTab] = dataRows(dataTab).length + 10; saveSettings(); renderData(); });
$('dataKeep').addEventListener('click', () => {
  const fin = finalSnap(); if (!fin) return;
  let k = 0;
  if (dataTab === 'R') for (const n in fin.R) { if (settings.r[n] !== fin.R[n]) { settings.r[n] = fin.R[n]; k++; } }
  else for (const n in fin.PR) { const pr = fin.PR[n]; if (!pr.assumed && JSON.stringify(settings.pr[n] || null) !== JSON.stringify({ type: pr.type, v: pr.v })) { settings.pr[n] = { type: pr.type, v: pr.v.map(x => +x.toFixed(3)) }; k++; } }
  flash(k ? `Kept ${k} after-run value${k > 1 ? 's' : ''} as start values.` : 'Start values already match the last run.');
  saveSettings(); rerun(true); renderData();
});
$('dataPanel').addEventListener('change', e => {
  const el = e.target, d = el.dataset;
  if (d.dr) { if (el.value === '') delete settings.r[d.dr]; else settings.r[d.dr] = parseFloat(el.value) || 0; }
  else if (d.drc) { if (el.value.trim()) settings.rCmt[d.drc] = el.value.trim(); else delete settings.rCmt[d.drc]; }
  else if (d.dprc) { if (el.value.trim()) settings.prCmt[d.dprc] = el.value.trim(); else delete settings.prCmt[d.dprc]; }
  else if (d.dprt) { if (!el.value) delete settings.pr[d.dprt]; else settings.pr[d.dprt] = prAs(el.value, settings.pr[d.dprt]); saveSettings(); rerun(true); renderData(); return; }
  else if (d.dpr) { const cur = settings.pr[d.dpr]; if (!cur) return; const v = cur.v.slice(); v[+d.j] = parseFloat(el.value) || 0; settings.pr[d.dpr] = { type: cur.type, v }; }
  else return;
  saveSettings(); dataEditing = true; try { rerun(true); } finally { dataEditing = false; }
});
function bindPair(rangeId, numId, key) {
  const r = $(rangeId), n = $(numId);
  r.value = n.value = settings[key];
  const apply = v => { settings[key] = v; r.value = n.value = v; saveSettings(); rerun(true); };
  r.addEventListener('change', () => apply(parseFloat(r.value)));
  r.addEventListener('input', () => { n.value = r.value; });
  n.addEventListener('change', () => apply(Math.max(0, parseFloat(n.value) || 0)));
}
bindPair('comp', 'compN', 'comp');
bindPair('maxTime', 'maxTimeN', 'maxTime');
bindPair('waitTo', 'waitToN', 'waitTimeout');

// ---------- registers & I/O panel ----------
function inputNow(key) {
  const d = settings.inputs[key]; if (!d) return 0;
  if (d.at != null && d.at !== '' && t >= +d.at) return d.to != null && d.to !== '' ? +d.to : (+d.v ? 0 : 1);
  return +d.v || 0;
}
function renderState(si) {
  const sp = sim.steps[si], snap = sp ? sim.snaps[sp.snap] : sim.snaps[0];
  const prev = si > 0 ? sim.snaps[sim.steps[si - 1].snap] : null;
  const refs = sim.refs;
  const where = sp ? (sp.prog !== sim.activeName ? `${esc(sim.activeName)} ${sp.rootLine} › <b>${esc(sp.prog)} ${sp.line}</b>` : `<b>${esc(sp.prog)} ${sp.line}</b>`) : '—';
  let pass = 0; if (sp) for (let k = 0; k <= si; k++) { const x = sim.steps[k]; if (x.prog === sp.prog && x.line === sp.line) pass++; }
  $('statebar').innerHTML = `<span>at ${where}</span>${pass > 1 ? `<span>pass <b>${pass}</b></span>` : ''}<span>UFRAME <b>${snap.uf}</b></span><span>UTOOL <b>${snap.ut}</b></span>${snap.override !== 100 ? `<span>override <b>${snap.override}%</b></span>` : ''}${sp && sp.cond != null ? `<span>condition <b>${sp.cond ? 'true' : 'false'}</b></span>` : ''}`;
  $('stateSub').textContent = pinned >= 0 ? 'stepping' : (playing ? 'running' : '');
  const rs = [...refs.R].sort((a, b) => a - b), prs = [...refs.PR].sort((a, b) => a - b);
  const outs = [...refs.outputs].sort(), ins = [...refs.inputs].sort();
  let html = '';
  if (snap.ar && snap.ar.length) html += `<div class="sgroup"><h3>Arguments <span style="text-transform:none;letter-spacing:0;font-weight:400">(passed to ${esc(sp ? sp.prog : '')})</span></h3><table class="regs">${snap.ar.map((v, j) => `<tr><td>AR[${j + 1}]</td><td class="c"></td><td class="v">${typeof v === 'string' ? "'" + esc(v) + "'" : fmtV(v)}</td></tr>`).join('')}</table></div>`;
  if (rs.length) html += `<div class="sgroup"><h3>Registers</h3><table class="regs">${rs.map(n => { const v = snap.R[n], pv = prev ? prev.R[n] : undefined; const chg = prev && v !== pv;
    return `<tr class="${chg ? 'chg' : ''}"><td>R[${n}]</td><td class="c">${esc(comments['R[' + n + ']'] || '')}</td><td class="v">${v === undefined ? '<span class="empty-s">—</span>' : fmtV(v)}</td></tr>`; }).join('')}</table></div>`;
  if (prs.length) html += `<div class="sgroup"><h3>Position registers</h3><table class="regs">${prs.map(n => { const pr = snap.PR[n], ppr = prev ? prev.PR[n] : undefined; const chg = prev && JSON.stringify(pr) !== JSON.stringify(ppr);
    const heads = pr && pr.type === 'joint' ? J6H : V6H;
    const val = pr ? `<div class="prv">${pr.v.map((x, j) => `<span><span class="empty-s">${heads[j]}</span> ${fmt(x)}</span>`).join('')}</div>` : '<span class="empty-s">not set</span>';
    return `<tr class="${chg ? 'chg' : ''}"><td>PR[${n}]</td><td class="c">${esc(comments['PR[' + n + ']'] || '')}${pr && pr.assumed ? ' (default home)' : ''}</td><td class="v">${val}</td></tr>`; }).join('')}</table></div>`;
  // a pulse that ended during this step (e.g. mid-move) shows as off once playback passes its end
  const pulseOff = k => sp && sim.pulses.some(p => p.key === k && p.t1 > sp.t + 1e-9 && p.t1 <= t + 1e-9);
  if (outs.length) html += `<div class="sgroup"><h3>Outputs</h3><div class="chips">${outs.map(k => { const v = pulseOff(k) ? 0 : snap.out[k] ?? 0; const isNum = /^(GO|AO)/.test(k);
    return `<span class="chip-io ${!isNum && v ? 'on' : ''}">${isNum ? '' : '<i></i>'}${k}${isNum ? ' = ' + fmtV(v) : ''}${comments[k] ? ` <span class="c">${esc(comments[k])}</span>` : ''}</span>`; }).join('')}</div></div>`;
  if (ins.length) html += `<div class="sgroup"><h3>Inputs <span style="text-transform:none;letter-spacing:0;font-weight:400">(you set these)</span></h3><div class="inputs">${ins.map(k => { const d = settings.inputs[k] || { v: 0 }; const isNum = /^(GI|AI)/.test(k); const now = inputNow(k);
    const ctl = isNum ? `<input class="num" type="number" step="1" data-in="${k}" data-f="v" value="${+d.v || 0}" aria-label="${k} value">` : `<button type="button" class="toggle" data-in="${k}" data-f="tog" aria-pressed="${+d.v ? 'true' : 'false'}">${+d.v ? 'ON' : 'OFF'}</button>`;
    return `<div class="inrow"><span class="nm">${k}</span>${ctl}<label class="now">${isNum ? 'becomes' : 'flips at'} ${isNum ? `<input class="num" style="width:6ch" type="number" step="1" data-in="${k}" data-f="to" value="${d.to ?? ''}" aria-label="${k} later value"> at` : ''} <input class="num" style="width:6ch" type="number" step="0.5" min="0" data-in="${k}" data-f="at" value="${d.at ?? ''}" placeholder="—" aria-label="${k} change time"> s</label><span class="now">now ${isNum ? fmtV(now) : now ? 'ON' : 'OFF'}</span>${comments[k] ? `<span class="c">${esc(comments[k])}</span>` : ''}</div>`; }).join('')}</div></div>`;
  if (!html) html = '<p class="empty-s">This program doesn’t use registers or I/O. Try the LBL / JMP / IF or pick-and-place examples.</p>';
  $('statebody').innerHTML = html;
}
$('statebody').addEventListener('click', e => {
  const b = e.target.closest('button[data-f="tog"]'); if (!b) return;
  const k = b.dataset.in, d = settings.inputs[k] || { v: 0 }; settings.inputs[k] = { ...d, v: +d.v ? 0 : 1 }; saveSettings(); rerun(true);
});
$('statebody').addEventListener('change', e => {
  const el = e.target.closest('input[data-in]'); if (!el) return;
  const k = el.dataset.in, f = el.dataset.f, d = { v: 0, ...(settings.inputs[k] || {}) };
  d[f] = el.value === '' ? (f === 'v' ? 0 : null) : parseFloat(el.value);
  settings.inputs[k] = d; saveSettings(); rerun(true);
});

// ---------- transport ----------
function updatePlay() { $('playBtn').textContent = playing ? '❚❚ Pause' : '▶ Play'; }
$('playBtn').addEventListener('click', () => { if (!sim) return; if (t >= sim.total - 1e-6) t = 0; pinned = -1; playing = !playing; updatePlay(); });
$('restartBtn').addEventListener('click', () => { t = 0; pinned = -1; paperDirty = true; lastStepShown = -2; });
$('stepBtn').addEventListener('click', () => { if (sim) gotoStep(currentStep() + 1); });
$('prevBtn').addEventListener('click', () => { if (sim) gotoStep(Math.max(0, currentStep() - 1)); });
$('scrub').addEventListener('input', () => { if (!sim) return; pinned = -1; t = sim.total * $('scrub').value / 1000; paperDirty = true; });
$('speeds').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; speed = +b.dataset.s;
  [...$('speeds').children].forEach(x => x.setAttribute('aria-pressed', x === b));
});
['showAir', 'showGhost'].forEach(id => $(id).addEventListener('change', () => paperDirty = true));
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('.cm-editor, input, textarea, select, button')) return;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); $('stepBtn').click(); }
  if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); $('prevBtn').click(); }
});
function sampleAt(tt) {
  const T = sim.T; let lo = 0, hi = T.t.length - 1;
  if (tt <= T.t[0]) return { i: 0, f: 0 };
  if (tt >= T.t[hi]) return { i: hi, f: 0 };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T.t[m] <= tt) lo = m; else hi = m; }
  const d = T.t[hi] - T.t[lo]; return { i: lo, f: d > 0 ? (tt - T.t[lo]) / d : 0 };
}
const toolAt = (i) => { const sg = sim.segs[sim.T.seg[Math.min(i + 1, sim.T.seg.length - 1)]]; return (sg && sg.toolUsed) || DEFAULT_TOOL; };

// ---------- 3D ----------
let renderer = null, scene, camera, controls, robotParts = null, pathGroup = null, inkObj = null, tipMarker = null, toolAxes = null;
let teachHook = null, teachTip = null; // set by teach.js
const view = $('view3d');
function init3D() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    view.prepend(renderer.domElement);
  } catch (e) { renderer = null; view.insertAdjacentHTML('beforeend', '<div class="err" style="position:absolute;inset:auto 0 50% 0;text-align:center">3D view needs WebGL, which this browser blocked. The paper view still works.</div>'); return; }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(1250, -1050, 620);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.target.set(380, 0, -180);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(600, -900, 1400); scene.add(dl);
  new ResizeObserver(resize3D).observe(view); resize3D();
}
function resize3D() {
  if (!renderer) return;
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
const UPV = new THREE.Vector3(0, 1, 0);
function placeLink(mesh, a, b, r) {
  const va = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(va), L = d.length();
  mesh.position.copy(va).addScaledVector(d, 0.5);
  mesh.scale.set(r, Math.max(L, 0.01), r);
  if (L > 1e-6) mesh.quaternion.setFromUnitVectors(UPV, d.normalize());
}
function labelSprite(text, color, h = 15) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), fs = 40;
  ctx.font = `600 ${fs}px "IBM Plex Mono", monospace`;
  c.width = Math.ceil(ctx.measureText(text).width) + 16; c.height = fs + 12;
  ctx.font = `600 ${fs}px "IBM Plex Mono", monospace`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(h * c.width / c.height, h, 1); s.renderOrder = 5; return s;
}
function axesTriad(size) {
  const g = new THREE.Group();
  [[1, 0, 0, '#e5484d'], [0, 1, 0, '#30a46c'], [0, 0, 1, '#3e63dd']].forEach(([x, y, z, c]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x * size, y * size, z * size)]);
    g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(c) })));
  });
  return g;
}
function setFrameObj(obj, o, R) {
  obj.position.set(...o);
  const m = new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
  obj.quaternion.setFromRotationMatrix(m);
}
function buildScene() {
  if (!renderer || !sim) return;
  if (pathGroup) { scene.remove(pathGroup); pathGroup.traverse(o => { o.geometry && o.geometry.dispose(); o.material && (o.material.map && o.material.map.dispose(), o.material.dispose()); }); }
  if (robotParts) { robotParts.group.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); scene.remove(robotParts.group); }
  scene.background = new THREE.Color(css('--scene'));
  pathGroup = new THREE.Group(); scene.add(pathGroup);
  const T = sim.T, surfZ = sim.surfZ > -1e8 ? sim.surfZ : -280;
  const grid = new THREE.GridHelper(1600, 32, new THREE.Color(css('--grid2')), new THREE.Color(css('--grid')));
  grid.rotation.x = Math.PI / 2; grid.position.set(300, 0, -ROBOT.BASE); pathGroup.add(grid);
  const b = sim.bounds;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX, b.maxY - b.minY),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(css('--paper')), roughness: 1, side: THREE.DoubleSide }));
  sheet.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, surfZ - 0.6); pathGroup.add(sheet);
  const table = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 120, b.maxY - b.minY + 160, 18),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(css('--grid2')), roughness: 0.9 }));
  table.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, surfZ - 10); pathGroup.add(table);
  const kc = { J: css('--mJ'), L: css('--mL'), C: css('--mC'), B: css('--mB'), S: css('--mB'), W: css('--mB') };
  const pos = [], cols = [], cc = {};
  for (const k in kc) cc[k] = new THREE.Color(kc[k]);
  for (let i = 1; i < T.p.length; i++) {
    if (T.kind[i] === 'W') continue;
    const c = cc[T.kind[i]] || cc.B;
    pos.push(...T.p[i - 1], ...T.p[i]); cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  pathGroup.add(new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
  const ip = [], ic = [], iend = [], inkC = new THREE.Color(css('--ink')), badC = new THREE.Color(css('--bad'));
  for (let i = 1; i < T.p.length; i++) if (T.ink[i] && T.ink[i - 1]) {
    const c = T.crash[i] ? badC : inkC;
    ip.push(T.p[i - 1][0], T.p[i - 1][1], surfZ + 0.4, T.p[i][0], T.p[i][1], surfZ + 0.4); ic.push(c.r, c.g, c.b, c.r, c.g, c.b); iend.push(i);
  }
  const ig = new THREE.BufferGeometry();
  ig.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3));
  ig.setAttribute('color', new THREE.Float32BufferAttribute(ic, 3));
  inkObj = new THREE.LineSegments(ig, new THREE.LineBasicMaterial({ vertexColors: true }));
  inkObj.userData.ends = iend; pathGroup.add(inkObj);
  const fg = css('--fg');
  const dotG = new THREE.SphereGeometry(3.2, 12, 8), dotM = new THREE.MeshBasicMaterial({ color: new THREE.Color(fg) });
  sim.ptLabels.forEach((pt, k) => {
    const m = new THREE.Mesh(dotG, dotM); m.position.set(...pt.p); pathGroup.add(m);
    const s = labelSprite(pt.label, fg); s.position.set(pt.p[0], pt.p[1], pt.p[2] + 14 + (k % 2) * 10); pathGroup.add(s);
  });
  // frames: World at the origin, plus every user frame used (final values)
  const wt = axesTriad(90); pathGroup.add(wt);
  const wl = labelSprite('World', css('--muted'), 12); wl.position.set(0, 0, 40); pathGroup.add(wl);
  const ufs = new Set(); sim.snaps.forEach(sn => ufs.add(sn.uf)); for (const p of sim.programs) for (const P of Object.values(p.pos)) ufs.add(P.uf);
  ufs.delete(0);
  ufs.forEach(n => {
    const v = (sim.uframesFinal && sim.uframesFinal[n]) || settings.uframes[n] || [0, 0, 0, 0, 0, 0];
    const F = frameOf(v), tri = axesTriad(70); setFrameObj(tri, F.o, F.R); pathGroup.add(tri);
    const l = labelSprite('UF' + n, css('--fg'), 12); l.position.set(F.o[0], F.o[1], F.o[2] + 22); pathGroup.add(l);
  });
  const group = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: new THREE.Color(css('--robot')), roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(css('--robot-2')), roughness: 0.6 });
  const toolM = new THREE.MeshStandardMaterial({ color: new THREE.Color(css('--ink')), roughness: 0.4 });
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 24), sph = new THREE.SphereGeometry(1, 20, 14);
  const links = [[dark, 62], [dark, 46], [body, 44], [body, 30], [body, 34], [dark, 28], [toolM, 7]].map(([m, r]) => { const x = new THREE.Mesh(cyl, m); x.userData.r = r; group.add(x); return x; });
  const joints = [[dark, 50], [dark, 40], [dark, 34]].map(([m, r]) => { const x = new THREE.Mesh(sph, m); x.scale.setScalar(r); group.add(x); return x; });
  tipMarker = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--accent')) }));
  group.add(tipMarker);
  toolAxes = axesTriad(45); group.add(toolAxes);
  scene.add(group);
  robotParts = { group, links, joints };
}
function poseRobot(q, tool) {
  if (!robotParts) return;
  const f = fk(q, tool), P = f.pts;
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]];
  pairs.forEach(([a, b], k) => placeLink(robotParts.links[k], P[a], P[b], robotParts.links[k].userData.r));
  robotParts.joints[0].position.set(...P[2]); robotParts.joints[1].position.set(...P[3]); robotParts.joints[2].position.set(...P[5]);
  tipMarker.position.set(...P[7]);
  setFrameObj(toolAxes, P[7], f.R);
  return f;
}

// ---------- paper view ----------
function paperBounds() {
  const T = sim.T; let pts = sim.ptLabels.filter(p => p.p[2] <= sim.surfZ + 5).map(p => p.p);
  T.p.forEach((p, i) => { if (T.ink[i]) pts.push(p); });
  if (!pts.length) pts = T.p.length ? T.p : [[400, 0, -278]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
  const m = 30; return { minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };
}
const paper = $('paper');
new ResizeObserver(() => paperDirty = true).observe(paper);
function drawPaper(idx, frac) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = paper.clientWidth, H = paper.clientHeight;
  if (!W || !H) return;
  if (paper.width !== Math.round(W * dpr)) { paper.width = Math.round(W * dpr); paper.height = Math.round(H * dpr); }
  const ctx = paper.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css('--paper'); ctx.fillRect(0, 0, W, H);
  if (!sim || !sim.T.p.length) return;
  const b = sim.bounds, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const s = Math.min(W / (b.maxY - b.minY), H / (b.maxX - b.minX));
  const X = p => W / 2 - (p[1] - cy) * s, Y = p => H / 2 - (p[0] - cx) * s;
  const step = s > 2.5 ? 10 : s > 1 ? 25 : 50;
  $('gridNote').textContent = `grid ${step} mm`;
  const x0 = cx - H / 2 / s, x1 = cx + H / 2 / s, y0 = cy - W / 2 / s, y1 = cy + W / 2 / s;
  ctx.lineWidth = 1;
  const g2 = css('--grid2'), g1 = css('--grid');
  for (let g = Math.ceil(x0 / step) * step; g <= x1; g += step) { ctx.strokeStyle = g % (step * 5) === 0 ? g2 : g1; ctx.beginPath(); ctx.moveTo(0, Y([g, 0])); ctx.lineTo(W, Y([g, 0])); ctx.stroke(); }
  for (let g = Math.ceil(y0 / step) * step; g <= y1; g += step) { ctx.strokeStyle = g % (step * 5) === 0 ? g2 : g1; ctx.beginPath(); ctx.moveTo(X([0, g]), 0); ctx.lineTo(X([0, g]), H); ctx.stroke(); }
  const T = sim.T, n = T.p.length;
  const kc = { J: css('--mJ'), L: css('--mL'), C: css('--mC'), B: css('--mB'), S: css('--mB'), W: css('--mB') };
  if ($('showAir').checked) {
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7;
    for (let i = 1; i < n; i++) if (!(T.ink[i] && T.ink[i - 1]) && T.kind[i] !== 'W') { ctx.strokeStyle = kc[T.kind[i]]; ctx.beginPath(); ctx.moveTo(X(T.p[i - 1]), Y(T.p[i - 1])); ctx.lineTo(X(T.p[i]), Y(T.p[i])); ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if ($('showGhost').checked) {
    ctx.lineWidth = 1; ctx.strokeStyle = g2; ctx.beginPath();
    for (let i = 1; i < n; i++) if (T.ink[i] && T.ink[i - 1]) { ctx.moveTo(X(T.p[i - 1]), Y(T.p[i - 1])); ctx.lineTo(X(T.p[i]), Y(T.p[i])); }
    ctx.stroke();
  }
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ink = css('--ink'), bad = css('--bad');
  const seg = (a, b2, colr) => { ctx.strokeStyle = colr; ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b2), Y(b2)); ctx.stroke(); };
  for (let i = 1; i <= idx && i < n; i++) if (T.ink[i] && T.ink[i - 1]) seg(T.p[i - 1], T.p[i], T.crash[i] ? bad : ink);
  let tip = T.p[idx];
  if (idx + 1 < n) { tip = lerp3(T.p[idx], T.p[idx + 1], frac); if (T.ink[idx] && T.ink[idx + 1]) seg(T.p[idx], tip, T.crash[idx + 1] ? bad : ink); }
  if (teachTip) tip = teachTip;
  ctx.font = `500 11px "IBM Plex Mono", monospace`; ctx.textBaseline = 'middle';
  const placed = [], fgc = css('--fg'), mut = css('--muted');
  sim.ptLabels.forEach(pt => {
    const px = X(pt.p), py = Y(pt.p);
    ctx.fillStyle = fgc; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    let ly = py - 10; while (placed.some(q => Math.abs(q[0] - px) < 40 && Math.abs(q[1] - ly) < 12)) ly += 13;
    placed.push([px, ly]); ctx.fillStyle = mut; ctx.fillText(pt.label, px + 6, ly);
  });
  const h = tip[2] - sim.surfZ, tx = X(tip), ty = Y(tip);
  ctx.strokeStyle = css('--accent'); ctx.fillStyle = css('--accent'); ctx.lineWidth = 2;
  if (h <= settings.tol) { ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill(); }
  else { const r = Math.min(26, 5 + h / 12); ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(tx - 4, ty); ctx.lineTo(tx + 4, ty); ctx.moveTo(tx, ty - 4); ctx.lineTo(tx, ty + 4); ctx.stroke(); }
}

// ---------- readout ----------
function lineText(progName, line) { const e = programs.find(p => p.name === progName); return e ? cleanLine(e.lines[line - 1] || '') : ''; }
function renderReadout(si, q, p, f) {
  const sp = sim.steps[si];
  const snap = sp ? sim.snaps[sp.snap] : sim.snaps[0];
  const uf = snap.uf;
  const F = frameOf(uf === 0 ? [0, 0, 0, 0, 0, 0] : ((sim.uframesFinal && sim.uframesFinal[uf]) || settings.uframes[uf] || [0, 0, 0, 0, 0, 0]));
  const loc = toFrame(F, p, f.R), wpr = rToWpr(loc.R), h = p[2] - sim.surfZ;
  const i = sampleAt(t).i, crash = sim.T.crash[i];
  const state = crash ? '<span class="pen crash">BELOW SURFACE</span>' : h <= settings.tol ? '<span class="pen down">ON SURFACE</span>' : `<span class="pen up">${fmt(h, 0)} mm ABOVE</span>`;
  const head = sp ? `${sp.prog !== sim.activeName ? esc(sp.prog) + ' ' : ''}${sp.line}: ${esc(lineText(sp.prog, sp.line))}` : '';
  $('readout').innerHTML = `<div class="cur">${head}</div>
    <div class="rows"><span class="k" style="grid-column:1/-1">${uf ? 'User frame ' + uf : 'World'} · tool ${snap.ut}</span><span><span class="k">X</span> ${fmt(loc.p[0])}</span><span><span class="k">Y</span> ${fmt(loc.p[1])}</span><span><span class="k">Z</span> ${fmt(loc.p[2])}</span>
    <span><span class="k">W</span> ${fmt(wpr[0])}</span><span><span class="k">P</span> ${fmt(wpr[1])}</span><span><span class="k">R</span> ${fmt(wpr[2])}</span>
    ${q.map((v, j) => `<span><span class="k">J${j + 1}</span> ${fmt(v)}</span>`).join('')}</div>${state}`;
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (teachHook && teachHook.active()) teachHook.frame();
  else if (sim && sim.T.p.length) {
    if (playing) { t += dt * speed; if (t >= sim.total) { t = sim.total; playing = false; updatePlay(); } paperDirty = true; }
    const { i, f } = sampleAt(t), T = sim.T, j = Math.min(i + 1, T.p.length - 1);
    const q = lerpN(T.q[i], T.q[j], f), p = lerp3(T.p[i], T.p[j], f);
    const tool = toolAt(i);
    const fkr = poseRobot(q, tool) || fk(q, tool);
    if (inkObj) { const ends = inkObj.userData.ends; let lo = 0, hi = ends.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ends[m] <= i) lo = m + 1; else hi = m; } inkObj.geometry.setDrawRange(0, lo * 2); }
    if (paperDirty) { drawPaper(i, f); paperDirty = false; }
    const si = currentStep();
    renderReadout(si, q, p, fkr);
    const pe = sim.pulses.reduce((n, p) => n + (p.t1 <= t ? 1 : 0), 0);
    if (si !== lastStepShown || pe !== lastPulseEdges) {
      lastStepShown = si; lastPulseEdges = pe;
      const sp = sim.steps[si];
      if (sp) { const own = sp.prog === sim.activeName; edProg.setExecLine(own ? sp.line : sp.rootLine, !own, playing || pinned >= 0); }
      else edProg.setExecLine(0);
      renderState(si);
    }
    $('scrub').value = Math.round(1000 * t / Math.max(sim.total, 1e-6));
    $('timeOut').textContent = `${t.toFixed(2)} / ${sim.total.toFixed(2)} s`;
  }
  if (renderer) { controls.update(); renderer.render(scene, camera); }
  requestAnimationFrame(frame);
}

// theme changes: rebuild colors
const onTheme = () => { if (sim) { buildScene(); paperDirty = true; } };
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- start ----------
(async function start() {
  init3D();
  await loadExampleList();
  const ws = store.get('ws', null);
  if (ws && ws.programs && ws.programs.length) {
    for (const p of ws.programs) { const en = entryFromText(p.ls); en.origLines = p.origLines; en.origPos = p.origPos; programs.push(en); }
    renderTabs();
    selectProgram(Math.max(0, programs.findIndex(p => p.name === ws.active)));
  } else if (exampleIndex.length) {
    for (let k = 0; k < exampleIndex.length; k++) await loadExample(k, false);
    selectProgram(Math.max(0, programs.findIndex(p => p.name === 'BOX_AB')));
  } else {
    addEntry(newEntry(), true);
    flash('Examples need the page to be served (not opened from disk). Use Open .ls… to load a program.');
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { paperDirty = true; if (sim) buildScene(); });
  requestAnimationFrame(frame);
})();
