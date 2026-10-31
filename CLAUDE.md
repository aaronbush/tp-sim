# tp-sim — notes for Claude Code

A static, no-build web app for editing and simulating industrial robot teach-pendant (TP) programs saved as ASCII `.ls` files. It was built as a study aid for a HandlingTool operations course: students load or write a program, watch a simulated 6-axis arm run it, step through the logic, see registers and I/O change, and get plain-language findings about common mistakes.

- **Live site:** https://aaronbush.github.io/tp-sim/ (GitHub Pages, deployed from `main`)
- **Owner:** Aaron (`aaronbush`). He is a student in the course, not a professional robot programmer, and has an engineering/manufacturing background. He reviews and merges PRs himself.
- **Read next:** `docs/ARCHITECTURE.md` for how the code works and `docs/BACKLOG.md` for open work and known gaps.

## Ground rules

- **Work on a branch and open a PR.** Never push to `main`: every push to `main` that touches `site/` deploys the live site.
- **Never use "FANUC" in names, titles, branding or UI copy.** It is a trademark and this project is unaffiliated. The README carries the one allowed line ("works with the `.ls` export format used by FANUC controllers… not affiliated"). Generic terms are fine: TP, teach pendant, `.ls`, HandlingTool-style. Don't name specific robot models (e.g. LR Mate) or vendor software (e.g. ROBOGUIDE) in the UI either; describe them generically.
- **Never commit course material or personal data.** That covers the course manual (copyrighted), classmates' names (one was scrubbed from `box_ab.ls`'s COMMENT), and the owner's own class files.
- **No build step for the site.** It is plain HTML/CSS and classic `<script>` tags. Keep it that way unless the owner asks otherwise. The only build is the vendored CodeMirror bundle (see below).
- **Vendor dependencies.** Don't load scripts from CDNs; vendor them into `site/vendor/`. Only Google Fonts load from outside, and the page has fallbacks.
- **Your files never leave the browser.** No backend, no analytics, no uploads. Keep it that way.

## Layout

```
site/                  # everything that gets published
  index.html           # markup; loads vendor libs, then js/core.js, js/editor.js, js/app.js, js/teach.js (order matters)
  css/app.css          # all styles; theme tokens on :root with light/dark variants
  js/core.js           # NO DOM. math, kinematics, .ls parse/serialize, TP interpreter, motion sim, findings
  js/editor.js         # CodeMirror 6 setup: TP language, highlighting, autocomplete, lint, run counts, exec-line highlight
  js/app.js            # workspace/tabs, settings, panels, playback, 3D (three.js), paper view, readout
  js/teach.js          # teach mode: drag/jog the tool, record new point, touch up
  examples/            # example .ls programs + index.json manifest (titles, extra files, preset inputs)
  vendor/              # three.js r128 + OrbitControls, codemirror.min.js bundle, licenses
tests/core.test.js     # node, no deps: interpreter + kinematics + .ls round-trip tests
tests/browser-smoke.js # Playwright smoke test of the real page (desktop light + 420px dark)
tools/codemirror/      # entry.js + package.json to rebuild site/vendor/codemirror.min.js
.github/workflows/pages.yml  # deploys site/ to Pages on push to main
.github/workflows/ci.yml     # core tests + browser smoke test on every PR and push to main
docs/                  # ARCHITECTURE.md, BACKLOG.md
```

## Commands

```bash
node tests/core.test.js                       # must pass before any PR
cd site && python3 -m http.server 8000        # run locally -> http://localhost:8000 (examples need http, not file://)
PLAYWRIGHT_PATH=<path to playwright> node tests/browser-smoke.js --shots /tmp/shots   # browser check
cd tools/codemirror && npm install && npm run build   # only when changing the CodeMirror bundle
```

- **Browser smoke test:** it needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`, or point `PLAYWRIGHT_PATH` at an existing install). It serves `site/` itself.
- **3D in headless Chromium:** WebGL needs the swiftshader flags, which the script already sets.
- **Sandboxes:** Google Fonts are often blocked, and the smoke test aborts those requests on purpose.

## Before you open a PR

1. **Tests:** `node tests/core.test.js` passes. Add tests for interpreter or parser changes; new example programs get a test too.
2. **Browser check:** `tests/browser-smoke.js` passes (no page errors, no horizontal scroll at 420px). Look at the screenshots in both themes for any UI change.
3. **Docs:** update `README.md` (user-facing features and limits) and `docs/ARCHITECTURE.md` / `docs/BACKLOG.md` if you changed how things work or closed a gap.
4. **PR description:** say what to try, and give Aaron the local-preview commands (below).

## How the owner previews a PR

Aaron runs Windows with WSL (mirrored networking, firewall rule for port 8000 already set up) and often uses an iPad on the same network:

```bash
git clone -b <branch> https://github.com/aaronbush/tp-sim.git ~/tp-sim   # or: cd ~/tp-sim && git fetch && git checkout <branch> && git pull
cd ~/tp-sim/site && python3 -m http.server 8000
# PC: http://localhost:8000   iPad: http://<PC IPv4>:8000
```

Browser storage is per address, so edits made locally don't touch the live site's saved work. Mention a hard refresh if old files might be cached.

## Gotchas

- **Shared globals.** All scripts are classic scripts sharing one global lexical scope. `core.js` declares many top-level names (`add`, `sub`, `len`, `col`, `fk`, `ik`, `HOME`, `ROBOT`, `I3`, `toLS`, …), and `app.js` / `teach.js` must not redeclare them. Check `grep -n "^const \|^function \|^let " site/js/core.js` before adding top-level names.
- **`core.js` must stay DOM-free and Node-loadable.** It ends with a `module.exports` guard used by the tests.
- **Line numbers.** Editor line numbers are the TP line numbers. The editor shows instructions without the `n:` prefix or trailing `;`. `toLS()` adds them back, and splits `C` moves onto a `:` continuation line.
- **The `[hidden]` rule.** `css/app.css` sets `[hidden] { display: none !important }`. Elements with their own `display` (e.g. `.jogbar`) rely on it; don't remove it.
- **Theme colors.** All colors are CSS tokens on `:root`, redefined in two dark blocks (`prefers-color-scheme` and `[data-theme="dark"]`). three.js and canvas colors are read from those tokens at build time, and the scene is rebuilt on theme change.
- **No `alert`/`confirm`/`prompt`.** Tab close uses a click-twice pattern instead.
- **Findings copy.** Keep the existing voice: plain language, says what happens on the real controller and how to fix it, no jargon dumps. Severity is `bad` (would alarm or crash), `warn` (runs but not what you meant) or `info`.
- **The motion model is approximate on purpose.** Don't present cycle times or CNT corner shapes as exact anywhere in the UI.
