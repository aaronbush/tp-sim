// ===== tp-sim teach mode: drag or jog the tool, then record / touch up points =====
'use strict';
(() => {
  const st = { on: false, q: null, coord: 'world', step: 10, drag: 'xy', line: 1, handle: null, dragging: null };
  const ZERO6 = [0, 0, 0, 0, 0, 0];

  // ---- context: which user/tool frame a recorded point belongs to ----
  function contextAt(line) {
    const name = sim ? sim.activeName : null;
    let uf = 0, ut = 1, found = false;
    if (sim) {
      const S = sim.steps;
      let k = S.findIndex(s => s.prog === name && s.line === line);
      if (k < 0) for (let i = S.length - 1; i >= 0; i--) if (S[i].prog === name && S[i].line < line) { k = i; break; }
      if (k >= 0) { const sn = sim.snaps[S[k].snap]; uf = sn.uf; ut = sn.ut; found = true; }
    }
    if (!found) {
      const e = programs[active];
      if (e) e.lines.slice(0, line).forEach(l => { let m; if ((m = cleanLine(l).match(/^UFRAME_NUM\s*=\s*(\d+)$/i))) uf = +m[1]; if ((m = cleanLine(l).match(/^UTOOL_NUM\s*=\s*(\d+)$/i))) ut = +m[1]; });
    }
    return { uf, ut };
  }
  const ufVec = n => n === 0 ? ZERO6 : ((sim && sim.uframesFinal && sim.uframesFinal[n]) || settings.uframes[n] || ZERO6);
  const toolOfN = n => { const v = (sim && sim.toolsFinal && sim.toolsFinal[n]) || settings.tools[n] || ZERO6; return { p: v.slice(0, 3), R: wprToR(v[3], v[4], v[5]) }; };
  const ctx = () => contextAt(st.line = edProg.cursorLine());
  const curTool = () => toolOfN(ctx().ut);

  // rotation of angle a (deg) about unit axis k
  function axisRot(k, a) {
    const c = Math.cos(a * D2R), s = Math.sin(a * D2R), v = 1 - c, [x, y, z] = k;
    return [[c + x * x * v, x * y * v - z * s, x * z * v + y * s], [y * x * v + z * s, c + y * y * v, y * z * v - x * s], [z * x * v - y * s, z * y * v + x * s, c + z * z * v]];
  }
  function tryPose(p, R) {
    const s = ik(p, R, curTool(), st.q);
    if (!s.reach) { setHint('Out of reach — the arm can’t get there with this tool.', true); return false; }
    st.q = s.q; setHint(); return true;
  }
  function jog(axis, sign) {
    const step = st.step * sign;
    if (st.coord === 'joint') { st.q = st.q.slice(); st.q[axis] += step; setHint(); return; }
    const f = fk(st.q, curTool());
    const frameR = st.coord === 'world' ? I3 : st.coord === 'user' ? frameOf(ufVec(ctx().uf)).R : f.R;
    const ax = col(frameR, axis % 3);
    if (axis < 3) tryPose(add(f.tip, scl(ax, step)), f.R);
    else tryPose(f.tip, matMul(axisRot(ax, step), f.R));
  }

  // ---- UI ----
  const grid = $('jogGrid');
  function renderGrid() {
    const labs = st.coord === 'joint' ? ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] : ['X', 'Y', 'Z', 'W', 'P', 'R'];
    grid.innerHTML = labs.map((l, i) => `<div class="jax"><button type="button" data-ax="${i}" data-s="-1" aria-label="${l} minus">−</button><span>${l}</span><button type="button" data-ax="${i}" data-s="1" aria-label="${l} plus">+</button></div>`).join('');
    $('jogUnit').textContent = st.coord === 'joint' ? '°' : 'mm / °';
  }
  let rep = 0, repT = 0;
  const stopRep = () => { clearTimeout(repT); clearInterval(rep); };
  grid.addEventListener('pointerdown', e => {
    const b = e.target.closest('button[data-ax]'); if (!b) return;
    e.preventDefault(); const ax = +b.dataset.ax, s = +b.dataset.s;
    jog(ax, s); stopRep(); repT = setTimeout(() => { rep = setInterval(() => jog(ax, s), 110); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => grid.addEventListener(ev, stopRep));
  grid.addEventListener('keydown', e => { const b = e.target.closest('button[data-ax]'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jog(+b.dataset.ax, +b.dataset.s); } });
  $('jogCoord').addEventListener('click', e => {
    const b = e.target.closest('button[data-c]'); if (!b) return; st.coord = b.dataset.c;
    [...$('jogCoord').children].forEach(x => x.setAttribute('aria-pressed', x === b)); renderGrid();
  });
  $('dragMode').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]'); if (!b) return; st.drag = b.dataset.m;
    [...$('dragMode').children].forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  $('jogStep').addEventListener('change', e => { st.step = parseFloat(e.target.value); });
  function setHint(msg, warn) {
    $('jogHint').textContent = msg || 'Drag the yellow handle at the tool tip, or use the jog buttons. Click a program line to choose where a new point goes.';
    $('jogHint').style.color = warn ? 'var(--bad)' : '';
  }

  function cursorMotion() {
    const e = programs[active]; if (!e) return null;
    st.line = edProg.cursorLine();
    const ins = parseLine(cleanLine(e.lines[st.line - 1] || ''), st.line);
    return ins.type === 'motion' && typeof ins.tgt.idx === 'number' ? ins : null;
  }
  function updateRecUI() {
    const c = ctx(), mv = cursorMotion();
    $('recCtx').innerHTML = `After line <b>${st.line}</b> · records in <b>${c.uf ? 'UF ' + c.uf : 'World (UF 0)'}</b> · <b>UT ${c.ut}</b>`;
    const tb = $('recTouch');
    tb.disabled = !mv; tb.textContent = mv ? `Touch up ${mv.tgt.kind}[${mv.tgt.idx}]` : 'Touch up';
    tb.title = mv ? `Replace ${mv.tgt.kind}[${mv.tgt.idx}] on line ${st.line} with the current tool position` : 'Click a motion line in the program to touch up its point';
  }

  // current tool pose expressed in the context user frame, minus a line's Offset if it has one
  function localPose(c, ins) {
    const f = fk(st.q, toolOfN(c.ut));
    const loc = toFrame(frameOf(ufVec(c.uf)), f.tip, f.R);
    let note = '';
    if (ins && ins.opts && ins.opts.offset) {
      const ref = ins.opts.offset === 'cond' ? null : ins.opts.offset;
      let o = null;
      if (ref && typeof ref.idx === 'number' && sim) {
        const k = sim.steps.findIndex(s => s.prog === sim.activeName && s.line === st.line);
        const sn = k >= 0 ? sim.snaps[sim.steps[k].snap] : null;
        o = (sn && sn.PR[ref.idx]) || settings.pr[ref.idx];
      }
      if (o && o.type === 'cart') {
        loc.p = sub(loc.p, o.v.slice(0, 3)); loc.R = matMul(matT(wprToR(o.v[3], o.v[4], o.v[5])), loc.R);
        note = ` The line's Offset,PR[${ref.idx}] (${o.v.slice(0, 3).map(v => fmt(v)).join(', ')}) was taken out so the move lands where the tool is now.`;
      } else note = ' This line uses an Offset whose value isn’t known here, so the point was recorded without removing it.';
    }
    return { v6: poseToV6(loc.p, loc.R), note };
  }
  function nextPIndex(e) {
    let n = 0;
    Object.keys(parsePositions(e.posText)).forEach(k => n = Math.max(n, +k));
    e.lines.forEach(l => { const re = /\bP\[(\d+)/g; let m; while ((m = re.exec(l))) n = Math.max(n, +m[1]); });
    return n + 1;
  }
  function setPositions(e, text) { e.posText = text; e._prog = null; edPos.setText(text); }
  $('recNew').addEventListener('click', () => {
    const e = programs[active]; if (!e) return;
    const c = ctx(), n = nextPIndex(e), { v6 } = localPose(c, null);
    setPositions(e, (e.posText.trim() ? e.posText.trimEnd() + '\n' : '') + formatPosition(n, v6, c.uf, c.ut, ''));
    const mt = $('recType').value;
    const text = `${mt} P[${n}] ${mt === 'J' ? '100%' : '250mm/sec'} FINE`;
    const cur = cleanLine(e.lines[st.line - 1] || '');
    if (!cur) edProg.replaceLine(st.line, text); else edProg.insertLineAfter(st.line, text);
    st.line = edProg.cursorLine();
    updateRecUI();
    setHint(`Recorded P[${n}] and added "${text}" as line ${st.line}.`);
  });
  $('recTouch').addEventListener('click', () => {
    const e = programs[active], ins = cursorMotion(); if (!e || !ins) return;
    const c = ctx(), n = ins.tgt.idx, { v6, note } = localPose(c, ins);
    if (ins.tgt.kind === 'PR') {
      settings.pr[n] = { type: 'cart', v: v6.map(x => +x.toFixed(3)) }; saveSettings();
      lastRefsKey = ''; rerun(true);
      setHint(`PR[${n}] start value set to the current tool position (Data › Position Reg).${note}`); return;
    }
    const old = parsePositions(e.posText)[n];
    const block = formatPosition(n, v6, c.uf, c.ut, old ? old.cmt : '');
    const re = new RegExp(`P\\[${n}(?::[^\\]]*)?\\]\\s*\\{[\\s\\S]*?\\};`);
    setPositions(e, re.test(e.posText) ? e.posText.replace(re, block) : (e.posText.trim() ? e.posText.trimEnd() + '\n' : '') + block);
    rerun(true); updateEditedUI(); renderTabs(); saveWorkspaceSoon();
    setHint(`Touched up P[${n}] in ${c.uf ? 'UF ' + c.uf : 'World'}.${note}`);
  });

  // ---- drag the tool tip ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function makeHandle() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(14, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--accent')), transparent: true, opacity: 0.45, depthTest: false }));
    ball.renderOrder = 6; g.add(ball);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(22, 1.6, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--accent')), depthTest: false }));
    ring.renderOrder = 6; g.add(ring);
    g.userData.ball = ball; g.userData.ring = ring;
    return g;
  }
  view.addEventListener('pointerdown', ev => {
    if (!st.on || !renderer || !st.handle) return;
    pick(ev);
    if (!ray.intersectObject(st.handle.userData.ball, false).length) return;
    ev.stopPropagation(); ev.preventDefault();
    controls.enabled = false;
    const f = fk(st.q, curTool()), tip = new THREE.Vector3(...f.tip);
    const plane = new THREE.Plane();
    if (st.drag === 'xy' && !ev.shiftKey) plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), tip);
    else { const n = camera.position.clone().sub(tip); n.z = 0; if (n.lengthSq() < 1e-6) n.set(1, 0, 0); plane.setFromNormalAndCoplanarPoint(n.normalize(), tip); }
    const hit = new THREE.Vector3(); ray.ray.intersectPlane(plane, hit);
    st.dragging = { plane, z: st.drag === 'z' || ev.shiftKey, start: f.tip.slice(), hit0: hit.clone(), R: f.R, id: ev.pointerId };
    try { view.setPointerCapture(ev.pointerId); } catch (e) {}
  }, true);
  view.addEventListener('pointermove', ev => {
    const d = st.dragging; if (!d) return;
    ev.stopPropagation(); pick(ev);
    const hit = new THREE.Vector3(); if (!ray.ray.intersectPlane(d.plane, hit)) return;
    const snap = v => Math.round(v * (st.step < 1 ? 10 : 1)) / (st.step < 1 ? 10 : 1);
    const p = d.z ? [d.start[0], d.start[1], snap(d.start[2] + hit.z - d.hit0.z)] : [snap(d.start[0] + hit.x - d.hit0.x), snap(d.start[1] + hit.y - d.hit0.y), d.start[2]];
    tryPose(p, d.R);
  }, true);
  const endDrag = ev => { if (!st.dragging) return; try { view.releasePointerCapture(st.dragging.id); } catch (e) {} st.dragging = null; controls.enabled = true; };
  view.addEventListener('pointerup', endDrag, true);
  view.addEventListener('pointercancel', endDrag, true);

  // ---- mode on/off ----
  function setOn(on) {
    st.on = on;
    $('teachBtn').setAttribute('aria-pressed', on);
    $('jogbar').hidden = !on;
    ['playBtn', 'restartBtn', 'prevBtn', 'stepBtn', 'scrub'].forEach(id => $(id).disabled = on);
    if (on) {
      playing = false; updatePlay();
      if (sim && sim.T.p.length) { const { i, f } = sampleAt(t), j = Math.min(i + 1, sim.T.p.length - 1); st.q = lerpN(sim.T.q[i], sim.T.q[j], f); }
      else st.q = HOME.slice();
      st.line = edProg.cursorLine();
      if (renderer) { st.handle = makeHandle(); scene.add(st.handle); }
      renderGrid(); updateRecUI(); setHint();
    } else {
      if (st.handle) { scene.remove(st.handle); st.handle.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); st.handle = null; }
      teachTip = null; paperDirty = true; lastStepShown = -2;
    }
  }
  $('teachBtn').addEventListener('click', () => setOn(!st.on));

  teachHook = {
    active: () => st.on,
    onLine(line) { st.line = line; updateRecUI(); },
    frame() {
      if (edProg.cursorLine() !== st.line) updateRecUI();
      const tool = curTool();
      const f = poseRobot(st.q, tool) || fk(st.q, tool);
      if (st.handle) {
        st.handle.position.set(...f.tip);
        st.handle.userData.ring.rotation.set(st.drag === 'z' ? Math.PI / 2 : 0, 0, st.drag === 'z' ? Math.atan2(camera.position.y - f.tip[1], camera.position.x - f.tip[0]) + Math.PI / 2 : 0);
        if (!scene.children.includes(st.handle)) scene.add(st.handle);
      }
      const moved = !teachTip || teachTip.some((v, k) => Math.abs(v - f.tip[k]) > 1e-6);
      teachTip = f.tip;
      if ((moved || paperDirty) && sim && sim.T.p.length) { drawPaper(sampleAt(t).i, 0); paperDirty = false; }
      const c = ctx(), loc = toFrame(frameOf(ufVec(c.uf)), f.tip, f.R), wpr = rToWpr(loc.R);
      const h = sim ? f.tip[2] - sim.surfZ : 0;
      const state = sim && h < -settings.comp ? '<span class="pen crash">BELOW SURFACE</span>' : sim && h <= settings.tol ? '<span class="pen down">ON SURFACE</span>' : `<span class="pen up">${fmt(h, 0)} mm ABOVE</span>`;
      $('readout').innerHTML = `<div class="cur">TEACH · ${st.coord === 'joint' ? 'joint' : st.coord} jog</div>
        <div class="rows"><span class="k" style="grid-column:1/-1">${c.uf ? 'User frame ' + c.uf : 'World'} · tool ${c.ut}</span><span><span class="k">X</span> ${fmt(loc.p[0])}</span><span><span class="k">Y</span> ${fmt(loc.p[1])}</span><span><span class="k">Z</span> ${fmt(loc.p[2])}</span>
        <span><span class="k">W</span> ${fmt(wpr[0])}</span><span><span class="k">P</span> ${fmt(wpr[1])}</span><span><span class="k">R</span> ${fmt(wpr[2])}</span>
        ${st.q.map((v, j) => `<span><span class="k">J${j + 1}</span> ${fmt(v)}</span>`).join('')}</div>${state}`;
    }
  };
})();
