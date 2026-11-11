// Browser smoke test: serves site/, loads every example, steps lines, edits, uses teach mode,
// and fails on any page error. Needs Playwright with a Chromium build:
//   npm i -D playwright && npx playwright install chromium   (or set PLAYWRIGHT_PATH to an existing install)
//   node tests/browser-smoke.js [--shots out-dir]
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = path.join(__dirname, '..', 'site');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ls': 'text/plain', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };
server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}/`;
  const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  for (const [w, h, scheme] of [[1360, 1500, 'light'], [420, 900, 'dark']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) errs.push(m.text()); });
    await page.route('https://fonts.**', r => r.abort()); // fonts may be unreachable in sandboxes
    await page.goto(url); await page.waitForTimeout(1500);
    // narrow screens use the phone layout: bottom tabs pick what shows under the 3D view
    const phone = await page.isVisible('#phoneTabs');
    if (!phone) {   // wider screens open in Pendant mode; the checks below start from the simulator view
      check(`${w}px ${scheme}: opens in Pendant mode`, await page.evaluate(() => document.body.classList.contains('pendant-mode')));
      await page.click('#pendantBtn');
    }
    const pane = async p => { if (phone) { await page.click(`#phoneTabs [data-pane="${p}"]`); await page.waitForTimeout(150); } };
    const teach = async on => { if (phone) await pane(on ? 'teach' : 'run'); else await page.click('#teachBtn'); await page.waitForTimeout(200); };
    const tabs = await page.$$eval('.tab', e => e.map(x => x.textContent.replace('×', '').trim()));
    check(`${w}px: examples load as tabs`, tabs.length >= 6, tabs.join(' '));
    for (const name of tabs) {
      await page.click(`.tab:has-text("${name}")`); await page.waitForTimeout(250);
      for (let k = 0; k < 5; k++) await page.click('#stepBtn');
    }
    check(`${w}px: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // edit a line and expect a parse error finding, then undo it
    await page.click('.tab:has-text("LOOP_SQUARES")'); await page.waitForTimeout(250);
    await pane('program');
    const lines = await page.$$('#edProg .cm-line');
    await lines[15].click(); await page.keyboard.press('End'); await page.keyboard.type('+'); await page.waitForTimeout(700);
    check(`${w}px: typo shows a finding`, (await page.$$eval('#issues li .t', e => e.map(x => x.textContent))).some(t => /read this line/.test(t)));
    await page.keyboard.press('Backspace'); await page.waitForTimeout(700);
    // clicking program text only places the cursor; a line number jumps playback
    const pos = () => page.evaluate(() => [t, currentStep()]);
    const before = await pos();
    await (await page.$$('#edProg .cm-line'))[8].click(); await page.waitForTimeout(150);
    check(`${w}px: clicking text leaves playback alone`, (await pos()).join() === before.join());
    await page.locator('#edProg .cm-lineNumbers .cm-gutterElement', { hasText: /^9$/ }).click(); await page.waitForTimeout(150);
    check(`${w}px: clicking a line number jumps there`, await page.evaluate(() => sim.steps[currentStep()].line === 9 && edProg.cursorLine() === 9));
    await pane('run');
    // macros and CALL arguments
    await page.click('.tab:has-text("STACK_PARTS")'); await page.waitForTimeout(400);
    const macs = await page.$$eval('#macroFields select', e => e.map(x => x.value));
    check(`${w}px: macro table filled from the example`, macs.join() === 'GRIP_CLOSE,GRIP_OPEN', macs.join());
    let args = false;
    for (let k = 0; k < 30 && !args; k++) { await page.click('#stepBtn'); args = /AR\[1\]/.test(await page.textContent('#statebody')); }
    check(`${w}px: arguments show inside PICK_PART`, args);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `args-${w}-${scheme}.png`), fullPage: true }); }
    // data screens: after-run values, keep them, comments, PR rows
    await pane('data');
    check(`${w}px: data screen shows R[1] after run`, (await page.textContent('#arR1')).trim() === '3');
    await page.click('#dataKeep'); await page.waitForTimeout(400);
    check(`${w}px: keep copies after-run values to start`, await page.inputValue('[data-dr="1"]') === '3');
    await page.fill('[data-dr="1"]', ''); await page.fill('[data-drc="1"]', 'parts'); await page.press('[data-drc="1"]', 'Enter'); await page.waitForTimeout(500);
    check(`${w}px: data comment shows in the I/O panel`, /parts/.test(await page.textContent('#statebody')));
    await page.click('#dtabPR'); await page.selectOption('[data-dprt="1"]', 'joint'); await page.waitForTimeout(400);
    check(`${w}px: PR row gets six values`, (await page.$$('[data-dpr="1"]')).length === 6);
    await page.click('#dtabR');
    if (phone) {
      // the 3D view stays on screen while the page scrolls, and the height strip sits on its edge
      await page.evaluate(() => scrollTo(0, 400)); await page.waitForTimeout(150);
      const v = await page.evaluate(() => { const r = document.getElementById('view3d').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
      check(`${w}px: 3D view stays at the top when scrolled`, v[0] <= 1 && v[1] > 200, v.join(','));
      check(`${w}px: height strip is on the 3D view`, await page.evaluate(() => document.getElementById('sideZ').parentNode.id === 'view3d'));
      check(`${w}px: other panes are hidden`, !(await page.isVisible('#editorPanel')) && !(await page.isVisible('#findingsPanel')));
    }
    await pane('run');
    // playing must not scroll the page to the editor (phones stack the panels)
    await page.evaluate(() => document.getElementById('view3d').scrollIntoView({ block: 'start' }));
    const y0 = await page.evaluate(() => scrollY);
    await page.click('#playBtn'); await page.waitForTimeout(3000);
    const y1 = await page.evaluate(() => scrollY); await page.click('#playBtn');
    check(`${w}px: playback leaves the page where it is`, Math.abs(y1 - y0) < 2, `${y0} -> ${y1}`);
    // teach mode
    await teach(true);
    if (phone) {
      const before = await page.evaluate(() => edProg.cursorLine());
      await page.click('#recNext'); await page.waitForTimeout(100);
      check(`${w}px: line picker moves the record line`, await page.evaluate(() => edProg.cursorLine()) === before + 1);
    }
    await page.click('#jogGrid button[data-ax="0"][data-s="1"]');
    check(`${w}px: teach readout`, /TEACH/.test(await page.textContent('#readout')));
    await page.click('[data-help="help-teach"]'); await page.waitForTimeout(200);
    const teachHelp = await page.evaluate(() => { const d = document.getElementById('helpDlg'), r = document.getElementById('help-teach').getBoundingClientRect(), b = d.querySelector('.help-b').getBoundingClientRect(); return d.open && r.top >= b.top - 2 && r.top < b.bottom; });
    check(`${w}px: teach ? opens help at the teach section`, teachHelp);
    if (shots) await page.screenshot({ path: path.join(shots, `help-${w}-${scheme}.png`) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    if (shots && phone) await page.screenshot({ path: path.join(shots, `phone-teach-${scheme}.png`) });
    await teach(false);
    // pendant mode: enable, deadman, reset, SHIFT + jog key moves the 3D arm
    if (phone) await pane('pendant'); else await page.click('#pendantBtn');
    await page.waitForTimeout(400);
    check(`${w}px: pendant mode shows the pendant`, await page.isVisible('#pendantMount .tp-face') && await page.isVisible('#pendantMount .tp-screen'));
    check(`${w}px: pendant screen fits 60 columns without clipping`, await page.evaluate(() => { const r = [...document.querySelectorAll('#pendantMount .tp-body .row')]; return r.length === 12 && r.every(x => x.scrollWidth <= x.clientWidth + 1); }));
    const tip = () => page.evaluate(() => tipMarker.position.toArray());
    await page.click('#pendantMount [data-ctl="tpenable"]'); await page.click('#pendantMount [data-ctl="deadman"]'); await page.click('#pendantMount [data-key="RESET"]');
    await page.waitForTimeout(100);
    const tip0 = await tip();
    await page.click('#pendantMount [data-key="SHIFT"]');
    await page.evaluate(() => scrollTo(0, 250)); await page.waitForTimeout(100);   // keep the key clear of the pinned 3D view and the tab bar
    const jb = await page.locator('#pendantMount [data-key="J1_POS"]').boundingBox();
    await page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up(); await page.waitForTimeout(150);
    const tip1 = await tip();
    check(`${w}px: pendant jog moves the 3D arm`, tip0.some((v, k) => Math.abs(v - tip1[k]) > 0.5), tip0.map(Math.round) + ' -> ' + tip1.map(Math.round));
    check(`${w}px: pendant readout in 3D view`, /PENDANT/.test(await page.textContent('#readout')));
    check(`${w}px: pendant mode has no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `pendant-mode-${w}-${scheme}.png`), fullPage: true }); }
    await page.click('#pendantMount [data-key="SHIFT"]'); await page.click('#pendantMount [data-ctl="deadman"]');
    if (phone) await pane('run'); else await page.click('#pendantBtn');
    await page.waitForTimeout(300);
    check(`${w}px: leaving pendant mode restores the app`, !(await page.isVisible('#pendantMount')) && !(await page.isDisabled('#playBtn')));
    await page.click('#helpBtn'); await page.waitForTimeout(150);
    const opened = await page.evaluate(() => document.getElementById('helpDlg').open);
    await page.click('#helpClose');
    check(`${w}px: ? button opens and closes help`, opened && !(await page.evaluate(() => document.getElementById('helpDlg').open)));
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `smoke-${w}-${scheme}.png`), fullPage: true }); }
    check(`${w}px: no page errors`, !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0);
});
