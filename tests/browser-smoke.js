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
  const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, scheme] of [[1360, 1500, 'light'], [420, 900, 'dark']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) errs.push(m.text()); });
    await page.route('https://fonts.**', r => r.abort()); // fonts may be unreachable in sandboxes
    await page.goto(url); await page.waitForTimeout(1500);
    const tabs = await page.$$eval('.tab', e => e.map(x => x.textContent.replace('×', '').trim()));
    check(`${w}px: examples load as tabs`, tabs.length >= 6, tabs.join(' '));
    for (const name of tabs) {
      await page.click(`.tab:has-text("${name}")`); await page.waitForTimeout(250);
      for (let k = 0; k < 5; k++) await page.click('#stepBtn');
    }
    check(`${w}px: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // edit a line and expect a parse error finding, then undo it
    await page.click('.tab:has-text("LOOP_SQUARES")'); await page.waitForTimeout(250);
    const lines = await page.$$('#edProg .cm-line');
    await lines[15].click(); await page.keyboard.press('End'); await page.keyboard.type('+'); await page.waitForTimeout(700);
    check(`${w}px: typo shows a finding`, (await page.$$eval('#issues li .t', e => e.map(x => x.textContent))).some(t => /read this line/.test(t)));
    await page.keyboard.press('Backspace'); await page.waitForTimeout(700);
    // macros and CALL arguments
    await page.click('.tab:has-text("STACK_PARTS")'); await page.waitForTimeout(400);
    const macs = await page.$$eval('#macroFields select', e => e.map(x => x.value));
    check(`${w}px: macro table filled from the example`, macs.join() === 'GRIP_CLOSE,GRIP_OPEN', macs.join());
    let args = false;
    for (let k = 0; k < 30 && !args; k++) { await page.click('#stepBtn'); args = /AR\[1\]/.test(await page.textContent('#statebody')); }
    check(`${w}px: arguments show inside PICK_PART`, args);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `args-${w}-${scheme}.png`), fullPage: true }); }
    // playing must not scroll the page to the editor (phones stack the panels)
    await page.evaluate(() => document.getElementById('view3d').scrollIntoView({ block: 'start' }));
    const y0 = await page.evaluate(() => scrollY);
    await page.click('#playBtn'); await page.waitForTimeout(3000);
    const y1 = await page.evaluate(() => scrollY); await page.click('#playBtn');
    check(`${w}px: playback leaves the page where it is`, Math.abs(y1 - y0) < 2, `${y0} -> ${y1}`);
    // teach mode
    await page.click('#teachBtn'); await page.waitForTimeout(200);
    await page.click('#jogGrid button[data-ax="0"][data-s="1"]');
    check(`${w}px: teach readout`, /TEACH/.test(await page.textContent('#readout')));
    await page.click('#teachBtn');
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `smoke-${w}-${scheme}.png`), fullPage: true }); }
    check(`${w}px: no page errors`, !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed'); process.exit(fails ? 1 : 0);
});
