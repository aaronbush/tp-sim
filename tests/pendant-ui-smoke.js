// Playwright smoke test for the pendant face (tests/pendant-demo.html, mock controller).
//   PLAYWRIGHT_PATH=<path to playwright> node tests/pendant-ui-smoke.js [--shots out-dir]
const http = require('http'), fs = require('fs'), path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = path.join(__dirname, '..');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };

const IDS = ('PREV NEXT F1 F2 F3 F4 F5 SHIFT MENU SELECT EDIT DATA FCTN DISP UP DOWN LEFT RIGHT STEP HOLD RESET BACKSPACE ITEM ENTER FWD BWD COORD ' +
  'SPEED_UP SPEED_DOWN D0 D1 D2 D3 D4 D5 D6 D7 D8 D9 DOT COMMA MINUS TOOL1 TOOL2 MOVE_MENU SETUP STATUS IO POSN GROUP DIAG_HELP I_KEY').split(' ')
  .concat([1, 2, 3, 4, 5, 6, 7, 8].flatMap(n => ['J' + n + '_NEG', 'J' + n + '_POS']));

server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}/tests/pendant-demo.html`;
  const browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  for (const [w, h, scheme] of [[1280, 1400, 'light'], [1280, 1400, 'dark'], [420, 1300, 'light'], [420, 1300, 'dark']]) {
    const tag = `${w}px ${scheme}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: false });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) errs.push(m.text()); });
    await page.route('https://fonts.**', r => r.abort());
    await page.goto(url); await page.waitForFunction('window.__ready || window.__error'); await page.waitForTimeout(400);
    const events = () => page.evaluate(() => window.__events.slice());
    const clear = () => page.evaluate(() => { window.__events.length = 0; });
    const root = page.locator('.tp-pendant');

    check(`${tag}: no page errors on load`, errs.length === 0, errs.join(' | '));
    check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // every contract key id has exactly one element
    const counts = await page.evaluate(ids => ids.map(id => document.querySelectorAll(`[data-key="${id}"]`).length), IDS);
    const bad = IDS.filter((id, i) => counts[i] !== 1);
    check(`${tag}: every contract key has exactly one [data-key]`, bad.length === 0, bad.join(','));
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('[data-key]')].filter(e => !e.getAttribute('aria-label')).length);
    check(`${tag}: every key has an aria-label`, unlabeled === 0);
    check(`${tag}: keymap targets exist`, await page.evaluate(() => TPPendant.keymap.every(m => m.pendantKey === 'DEADMAN' || document.querySelector(`[data-key="${m.pendantKey}"]`))));
    // fixed pitch: no body row wraps or overflows its line box, and the screen fits
    const rowsOk = await page.evaluate(() => [...document.querySelectorAll('.tp-body .row')].every(r => r.scrollHeight <= r.clientHeight + 1));
    check(`${tag}: screen rows do not wrap`, rowsOk);
    const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tp-screen')).fontSize));
    check(`${tag}: screen font fitted`, fs1 > 5, fs1.toFixed(2) + 'px');
    // size of key hit targets
    const sizes = await page.evaluate(() => [...document.querySelectorAll('[data-key]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.key, r.width, r.height]; }));
    const small = sizes.filter(([k, wd, ht]) => k !== 'MINUS' && k !== 'COMMA' && (wd < 36 || ht < 30)).map(s => s[0] + ':' + Math.round(s[1]) + 'x' + Math.round(s[2]));
    const minW = Math.min(...sizes.filter(s => s[0] !== 'MINUS' && s[0] !== 'COMMA').map(s => s[1]));
    check(`${tag}: key targets >= 36px wide`, w > 800 || small.length === 0, `min ${Math.round(minW)}px ${small.join(' ')}`);

    // click -> keyDown then keyUp
    await clear(); await page.click('[data-key="F1"]');
    let ev = await events();
    check(`${tag}: click F1 gives keyDown then keyUp`, ev.length === 2 && ev[0].type === 'keyDown' && ev[1].type === 'keyUp' && ev[0].key === 'F1' && ev[1].key === 'F1', JSON.stringify(ev));
    // key hold: pointer down, move off the key, release outside -> still keyUp (pointer capture)
    await clear();
    const box = await page.locator('[data-key="J1_POS"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2); await page.mouse.up();
    ev = await events();
    check(`${tag}: release outside the key still sends keyUp`, ev.map(e => e.type + ':' + e.key).join() === 'keyDown:J1_POS,keyUp:J1_POS', JSON.stringify(ev));
    // multi-touch style: two keys held at once
    await clear();
    await page.evaluate(() => {
      const a = document.querySelector('[data-key="J2_POS"]'), b = document.querySelector('[data-key="FWD"]');
      const pd = (el, id) => el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, button: 0, isPrimary: id === 11 }));
      const pu = (el, id) => el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true }));
      pd(a, 11); pd(b, 12); window.__mid = window.__events.map(e => e.type + ':' + e.key).join(); pu(a, 11); pu(b, 12);
    });
    check(`${tag}: two keys can be held at once`, (await page.evaluate(() => window.__mid)) === 'keyDown:J2_POS,keyDown:FWD', await page.evaluate(() => window.__mid));

    // SHIFT latch (both physical keys act as one)
    await clear();
    const shift = page.locator('[data-key="SHIFT"]');
    await shift.click();
    check(`${tag}: SHIFT latches lit`, (await shift.getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-twin="SHIFT"]').getAttribute('aria-pressed')) === 'true');
    ev = await events(); check(`${tag}: latching SHIFT sends one keyDown`, ev.length === 1 && ev[0].type === 'keyDown' && ev[0].key === 'SHIFT');
    await page.click('[data-key="F2"]'); await page.waitForTimeout(50);
    check(`${tag}: status shows speed FINE while SHIFT latched`, /FINE/.test(await page.textContent('.tp-speed')));
    await page.click('[data-twin="SHIFT"]');
    ev = await events();
    check(`${tag}: second click unlatches (keyUp SHIFT)`, (await shift.getAttribute('aria-pressed')) === 'false' && ev[ev.length - 1].type === 'keyUp' && ev[ev.length - 1].key === 'SHIFT' && ev.filter(e => e.key === 'SHIFT').length === 2);
    // deadman latch
    await clear();
    const dm = page.locator('[data-ctl="deadman"]');
    await dm.click(); ev = await events();
    check(`${tag}: deadman latches`, (await dm.getAttribute('aria-pressed')) === 'true' && ev.length === 1 && ev[0].type === 'deadman' && ev[0].state === 'held', JSON.stringify(ev));
    await page.waitForTimeout(50);
    check(`${tag}: alarm line follows deadman`, !/DEADMAN/.test(await page.textContent('.tp-alarm')));
    await dm.click(); ev = await events();
    check(`${tag}: deadman unlatches`, (await dm.getAttribute('aria-pressed')) === 'false' && ev[1].state === 'released');
    // switches
    await clear();
    await page.click('[data-ctl="tpenable"]'); await page.click('[data-ctl="estop-pendant"]'); await page.click('[data-ctl="mode-T2"]'); await page.click('[data-ctl="cycle"]'); await page.click('[data-ctl="estop-panel"]');
    ev = await events();
    check(`${tag}: switches send tpEnable/estop/modeSwitch/cycleStart`, JSON.stringify(ev) === JSON.stringify([{ type: 'tpEnable', on: false }, { type: 'estop', source: 'pendant', pressed: true }, { type: 'modeSwitch', mode: 'T2' }, { type: 'cycleStart' }, { type: 'estop', source: 'panel', pressed: true }]), JSON.stringify(ev));
    check(`${tag}: status bar shows T2 and fault lamp`, (await page.textContent('.tp-pline .mode')) === 'T2' && await page.locator('.tp-ind [data-ind="fault"].on').count() === 1);
    await page.click('[data-ctl="tpenable"]'); await page.click('[data-ctl="estop-pendant"]'); await page.click('[data-ctl="estop-panel"]'); await page.click('[data-ctl="mode-T1"]');
    // controls are outside the pendant face
    check(`${tag}: deadman/mode/cycle are not in the key grid`, await page.evaluate(() => !document.querySelector('.tp-face [data-ctl="deadman"], .tp-face [data-ctl="cycle"], .tp-face [data-ctl^="mode-"]')));

    // popup
    await page.click('[data-key="MENU"]'); await page.waitForTimeout(50);
    check(`${tag}: MENU opens popup with cursor item`, (await page.isVisible('.tp-popup')) && (await page.textContent('.tp-popup .it.cur')).includes('UTILITIES'));
    await page.click('[data-key="DOWN"]');
    check(`${tag}: popup cursor moves`, (await page.textContent('.tp-popup .it.cur')).includes('TEST CYCLE'));
    check(`${tag}: prompt echoes key`, /Last key: DOWN/.test(await page.textContent('.tp-prompt')));
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `pendant-popup-${w}-${scheme}.png`), fullPage: true }); }
    await page.click('[data-key="ENTER"]');

    // keyboard
    await page.click('[data-key="D5"]'); // click focuses the pendant container
    check(`${tag}: pendant focusable and focused after click`, await page.evaluate(() => document.activeElement === document.querySelector('.tp-pendant')));
    await clear();
    const press = async (k, expect) => { await clear(); await page.keyboard.down(k); await page.keyboard.up(k); const e = await events(); return e.map(x => x.type + ':' + (x.key || x.state)).join() === expect; };
    check(`${tag}: ArrowUp -> UP`, await press('ArrowUp', 'keyDown:UP,keyUp:UP'));
    check(`${tag}: Enter -> ENTER`, await press('Enter', 'keyDown:ENTER,keyUp:ENTER'));
    check(`${tag}: digit 7 and . and -`, await press('7', 'keyDown:D7,keyUp:D7') && await press('.', 'keyDown:DOT,keyUp:DOT') && await press('-', 'keyDown:MINUS,keyUp:MINUS'));
    check(`${tag}: F3 -> F3, PageDown -> NEXT`, await press('F3', 'keyDown:F3,keyUp:F3') && await press('PageDown', 'keyDown:NEXT,keyUp:NEXT'));
    check(`${tag}: Backspace -> BACKSPACE`, await press('Backspace', 'keyDown:BACKSPACE,keyUp:BACKSPACE'));
    check(`${tag}: jog cluster Q and A`, await press('q', 'keyDown:J1_POS,keyUp:J1_POS') && await press('a', 'keyDown:J1_NEG,keyUp:J1_NEG'));
    check(`${tag}: letter keys: m -> MENU`, await press('m', 'keyDown:MENU,keyUp:MENU'));
    await page.keyboard.press('Enter'); // close popup
    await clear(); await page.keyboard.down('Shift');
    const lit = await shift.getAttribute('aria-pressed'); await page.keyboard.up('Shift');
    ev = await events();
    check(`${tag}: Shift held -> SHIFT down/up and lit while held`, lit === 'true' && ev.map(e => e.type + ':' + e.key).join() === 'keyDown:SHIFT,keyUp:SHIFT' && (await shift.getAttribute('aria-pressed')) === 'false');
    await clear(); await page.keyboard.down('Space');
    const dl = await dm.getAttribute('aria-pressed'); await page.keyboard.up('Space');
    ev = await events();
    check(`${tag}: Space held -> deadman held/released`, dl === 'true' && ev.map(e => e.state).join() === 'held,released', JSON.stringify(ev));
    // auto-repeat: only one keyDown
    await clear(); await page.keyboard.down('ArrowDown'); await page.keyboard.down('ArrowDown'); await page.keyboard.down('ArrowDown'); await page.keyboard.up('ArrowDown');
    ev = await events(); check(`${tag}: auto-repeat ignored`, ev.length === 2, JSON.stringify(ev));
    // blur releases everything held
    await clear(); await page.keyboard.down('w'); await page.keyboard.down('Shift');
    await page.evaluate(() => document.activeElement.blur());
    ev = await events();
    check(`${tag}: blur sends keyUp for held keys`, ev.filter(e => e.type === 'keyUp').map(e => e.key).sort().join() === 'J2_POS,SHIFT', JSON.stringify(ev));
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    // keys not swallowed / not active without focus
    await clear(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    check(`${tag}: no events while pendant is not focused`, (await events()).length === 0);
    check(`${tag}: keys not preventDefault'ed when unfocused`, await page.evaluate(() => { let p; const f = e => { p = e.defaultPrevented; }; window.addEventListener('keydown', f); return new Promise(res => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true })); window.removeEventListener('keydown', f); res(p === false); }); }));
    // unhandled key on focused pendant is not prevented
    check(`${tag}: unmapped key (Tab) not prevented`, await page.evaluate(() => { document.querySelector('.tp-pendant').focus(); const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(ev); return !ev.defaultPrevented; }));
    // tick loop runs
    const t0 = await page.evaluate(() => window.__ticks); await page.waitForTimeout(300);
    check(`${tag}: tick loop dispatches`, (await page.evaluate(() => window.__ticks)) > t0);
    // latch off: momentary SHIFT
    await page.click('#latchBtn'); await clear();
    await page.click('[data-key="SHIFT"]');
    ev = await events();
    check(`${tag}: latch off -> SHIFT is momentary`, ev.map(e => e.type).join() === 'keyDown,keyUp' && (await shift.getAttribute('aria-pressed')) === 'false', JSON.stringify(ev));
    await page.click('#latchBtn');

    check(`${tag}: no horizontal scroll at end`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
    if (shots) {
      await page.evaluate(() => { document.activeElement.blur(); });
      await page.click('[data-key="SELECT"]'); await page.click('[data-key="DOWN"]'); await page.click('[data-key="DOWN"]'); await page.click('[data-key="NEXT"]'); await page.click('[data-key="SHIFT"]');
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(shots, `pendant-${w}-${scheme}.png`), fullPage: true });
      await root.screenshot({ path: path.join(shots, `pendant-only-${w}-${scheme}.png`) });
    }
    await page.close();
  }

  // ---- real controller (?real=1): enable, reset, create a program, record, jog, step ----
  for (const [w, h, scheme] of [[1280, 1400, 'light'], [420, 1300, 'dark']]) {
    const tag = `real ${w}px ${scheme}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) errs.push(m.text()); });
    await page.route('https://fonts.**', r => r.abort());
    await page.goto(url + '?real=1'); await page.waitForFunction('window.__ready || window.__error'); await page.waitForTimeout(300);
    check(`${tag}: loads without error`, !(await page.evaluate(() => window.__error)) && errs.length === 0, errs.join(' | '));
    const body = () => page.textContent('.tp-body');
    const title = () => page.textContent('.tp-title .l');
    const key = id => page.click(`[data-key="${id}"]`);
    check(`${tag}: switches drawn from the controller (TP off at power-up)`, (await page.getAttribute('[data-ctl="tpenable"]', 'aria-checked')) === 'false' && /SYST-043/.test(await page.textContent('.tp-alarm')));
    check(`${tag}: screen is 60 columns wide, 12 rows, nothing clipped`, await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tp-body .row')]; return rows.length === 12 && rows.every(r => r.scrollWidth <= r.clientWidth + 1) && rows.every(r => r.textContent.length === 60); }));
    await page.click('[data-ctl="tpenable"]'); await page.click('[data-ctl="deadman"]'); await key('RESET'); await page.waitForTimeout(100);
    check(`${tag}: enable + deadman + RESET clears the alarm`, (await page.textContent('.tp-alarm')).trim() === '' && !(await page.locator('.tp-ind [data-ind="fault"].on').count()));
    await key('SELECT'); await page.waitForTimeout(50);
    check(`${tag}: SELECT shows the program list`, (await title()) === 'Select' && /BOX_AB/.test(await body()));
    await key('F2'); await page.waitForTimeout(50);
    check(`${tag}: CREATE opens name entry (Alpha input popup)`, /Alpha input 1/.test(await page.textContent('.tp-popup')));
    await page.keyboard.type('zz1'); await page.keyboard.press('Enter'); await page.waitForTimeout(50);
    check(`${tag}: typed name goes in as text`, /ZZ1/.test(await body()) || /ZZ1/.test(await page.textContent('.tp-screen')));
    await key('F3'); await page.waitForTimeout(50);
    check(`${tag}: new program opens in EDIT`, (await title()) === 'ZZ1', await title());
    await page.click('[data-key="SHIFT"]'); await key('F1'); await page.click('[data-key="SHIFT"]'); await page.waitForTimeout(100);
    check(`${tag}: SHIFT+POINT records P[1]`, (await body()).includes('P[1]'), (await body()).slice(0, 200));
    check(`${tag}: the program was saved to the host`, await page.evaluate(() => window.__progs.get('ZZ1').lines.join(' ').includes('P[1]')));
    // keyboard shortcuts still work outside text entry
    await page.keyboard.press('m'); await page.waitForTimeout(50);
    check(`${tag}: M opens the menu again (not typed as text)`, /MENU/.test(await page.textContent('.tp-popup')));
    await page.keyboard.press('PageUp'); await page.waitForTimeout(50);
    // jog J1 and watch POSN change
    await key('POSN'); await page.waitForTimeout(50);
    const j1 = async () => parseFloat((await body()).split('J1:')[1]);
    const a = await j1();
    await page.click('[data-key="SHIFT"]');
    const bx = await page.locator('[data-key="J1_POS"]').boundingBox();
    await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up(); await page.waitForTimeout(100);
    const b = await j1();
    check(`${tag}: jogging J1 changes POSN`, Math.abs(b - a) > 0.05, a + ' -> ' + b);
    // step BOX_AB with SHIFT+FWD
    await key('SELECT'); for (let i = 0; i < 4; i++) await key('UP');
    await key('ENTER'); await page.waitForTimeout(50);
    check(`${tag}: BOX_AB opened from SELECT`, (await title()) === 'BOX_AB', await title());
    await key('STEP');
    check(`${tag}: STEP lights the Step lamp`, (await page.locator('.tp-ind [data-ind="step"].on').count()) === 1);
    const fb = await page.locator('[data-key="FWD"]').boundingBox();
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    await page.waitForFunction(() => /PAUSED/.test(document.querySelector('.tp-pline').textContent), null, { timeout: 30000 }).catch(() => {});
    check(`${tag}: SHIFT+FWD in STEP mode runs a line and pauses`, /PAUSED/.test(await page.textContent('.tp-pline')), await page.textContent('.tp-pline'));
    check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
    if (shots) { await page.evaluate(() => document.activeElement.blur()); await page.screenshot({ path: path.join(shots, `pendant-real-${w}-${scheme}.png`), fullPage: true }); }
    await page.close();
  }
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
});
