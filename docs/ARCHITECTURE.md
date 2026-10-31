# Architecture

How tp-sim turns a `.ls` file into an animated, steppable simulation. File references are to `site/js/` unless noted.

## Data flow

```
.ls text ──splitLS──▶ {name, header, mn[] (instruction text per line), posText}
                         │  (editor shows mn[] one per line; Positions tab shows posText)
                         ▼
               makeProgram(name, header, lines, posText)
                 ├─ parsePositions(posText) → pos{n: {cart:[x,y,z,w,p,r] | joints:[6], uf, ut, cmt, config}}
                 ├─ parseLine(text, num) per line → ins{type, ...}   (errors become type 'error')
                 └─ analyzeStructure → labels{}, IF/ELSE/ENDIF + FOR/ENDFOR matching, SELECT groups, structErrors
                         ▼
               runSim(rootName, allOpenPrograms, settings)  = simulate() → finishSim()
                         ▼
               sim = { segs, steps, snaps, issues, T (sampled timeline), total, surfZ, lineCounts, ... }
                         ▼
   app.js: 3D scene + paper view + readout + Registers & I/O panel + findings + editor lint/counts
```

The whole pipeline re-runs on every edit (debounced 350 ms in `app.js` `scheduleRun`) and on every settings or input change. Programs are small, so re-running from scratch is simpler than incremental updates and fast enough.

## core.js

### Kinematics

- **Arm model.** The arm is generic. `ROBOT` holds its dimensions in mm (`A1` 50 shoulder offset, `A2` 330 upper arm, `A3` 35 forearm offset, `D4` 335 forearm, `D6` 80 wrist to faceplate) and joint speed limits. The World origin is on the J1 axis at J2 height, so a table near the base has negative Z.
- **`fk(q, tool)`.** `q` is in degrees: J2 is measured from vertical (+ is forward), J3 is the forearm angle from horizontal (+ is up), and J4–J6 are a ZYZ wrist. It returns joint points for drawing, `tip` and `R`. `tool = {p:[x,y,z], R}` is the tool frame relative to the faceplate.
- **`ik(p, R, tool, ref)`.** It solves only the front / elbow-up configuration, picks the wrist solution nearest `ref`, and returns `{q, reach}`.
- **Signs differ from the pendant.** These joint sign conventions are internal and may not match the pendant's displayed values.
- **Orientation.** WPR is fixed-axis X then Y then Z (`wprToR`, `rToWpr`).
- **Frames.** Frames are `[x,y,z,w,p,r]` arrays; `frameOf`, `toWorld` and `toFrame` convert between them.

### Parser

- **Instruction types.** `parseLine` / `classify` assign each line one of these types: `empty comment remark lbl jmp call end abort pause if ifthen else endif select selcase selelse for endfor waitt waitc offcond toffcond override ufnum utnum setuf setut assign motion macro ignored unknown error`.
- **Macros.** A line that is only a name, optionally with `(args)`, is a `macro`. `ins.name` is `macroKey(text)`: upper case with single spaces, so `Open hand 1` becomes `OPEN HAND 1`. It is tried after everything else, so a misspelled instruction also lands here and gets the "isn't set up" finding.
- **Arguments.** `parseArgs` turns `(1,R[2],'A')` on a `CALL`, an `IF …,CALL` action or a macro into a list of parsed expressions. Quoted text lexes as a `str` token, which can only be compared with `=` / `<>`.
- **Expressions.** These go through `lex` and `parseExpr`, a recursive-descent parser with precedence `OR < AND < NOT < compare < +,- < *,/,DIV,MOD < unary`. The returned `flags` record whether `+/-` was mixed with `*,/` and `AND` with `OR` at the top level, without parentheses. The real pendant forbids both, so the interpreter warns.
- **Register references.** `lexRef` handles `KIND[idx(,elem)(:comment)]`. The index can be indirect (`R[R[1]]`, `PR[R[2]]`). Comments may contain spaces.
- **Motion lines.** `parseMotion` reads the target (`P` or `PR`, a via point for `C`), speed (`%`, `mm/sec`, `cm/min`, `inch/min`, `deg/sec`, `sec`, `max_speed`, or a register `R[n]`), termination (`FINE`, `CNTn` or `CNT R[n]`), and options. `Offset` and `Tool_Offset` (with or without a PR) are simulated; `ACC`, `TB`/`TA`, `Skip`, `INC` and similar are collected in `opts.ignored`.
- **Pendant formats.** In `.ls` files, `SELECT` branch lines are separate numbered lines: `=2,CALL X` and `ELSE,JMP LBL[9]`. Long lines wrap onto `   :  ...` continuation lines; `splitLS` joins them back together.

### Interpreter — `simulate()`

- **Machine state `S`.** It holds `R{}` (registers), `PR{}` (`{type:'cart'|'joint', v[6], assumed?}`), `out{}` (outputs keyed like `'RO[1]'`), the active `uf`/`ut`, `override`, offset conditions, and the runtime `uframes{}`/`tools{}` (seeded from settings; `UFRAME[i]=PR[j]` changes them).
- **Call stack.** Frames are `{prog, pc, callLine, args}`. `args` holds the evaluated arguments, read by `AR[n]`; reading past the end stops with an error, as the controller alarms. `stack[0].callLine` is the root-program line that made the current call, which lets the editor highlight the CALL line while a subprogram runs.
- **Execution loop.** One instruction per iteration. Each executed line pushes a **step** onto `steps`: `{prog, line, kind:'logic'|'move'|'wait', t, snap, seg, rootLine, cond?, dur?}`.
- **Snapshots.** Any state change calls `changed()`, which pushes a copy of `R/PR/out/uf/ut/override` and `ar` (the current frame's arguments) onto `snaps`. Entering and leaving a program also takes a snapshot.
- **Macros.** A `macro` line runs `settings.macros[name]` like a CALL. With no entry, a loaded program of that name runs (info finding); otherwise the line is skipped (info finding).
- **PULSE.** `DO[n]=PULSE,t` turns the output on and records `{key, until}` in `pulses`. `expirePulses()` runs before each line and switches expired ones off, and `WAIT` treats a pulse end as a time when a condition can change. `sim.pulses` lists `{key, t0, t1}` for every pulse so the panel can show an output going off in the middle of a move. Each step stores `snap`, the index of the snapshot current when it ran.
- **Moves.** `poseFor()` resolves the target into world coordinates. It applies the point's user frame (P) or the active user frame (Cartesian PR), then `Offset`, then `Tool_Offset`. It flags a mismatch between a P's UF/UT and the active `UFRAME_NUM`/`UTOOL_NUM`. `buildMotion()` then produces a segment with samples and a duration.
- **WAIT.** A wait becomes a dwell segment (`mt:'W'`). `WAIT cond` advances time to the next scheduled input change (`settings.inputs[key].at`) until the condition is true. It times out after `settings.waitTimeout` seconds (30 when unset) when `TIMEOUT,LBL` is given; otherwise it stops with "Waits forever".
- **Limits.** Execution stops at 20,000 steps, 3,000 moves, or `settings.maxTime` seconds, and reports why in `stopReason`: `end abort error wait steps time moves`.
- **Unset values.** A PR with no value that is used as a motion target defaults to home joints (`assumed:true`). Reading an unset `R[]` gives 0 plus an info finding.

### Timeline — `finishSim()`

1. **Surface.** `surfZ` is the lowest Z among move targets. The tip counts as "on the surface" within `settings.tol`, and as a "crash" below `surfZ − settings.comp`.
2. **CNT blending.** Each segment ending in CNTn is trimmed by `r = (n/100)·min(lenIn/2, lenOut/2, max(2, 0.4·vIn))`. A quadratic Bézier joins the two segments (in joint space when both are J moves). Dwell segments break blending.
3. **Flattening.** All segments become `T = {p[], quat[], q[], t[], line[], kind[], seg[], prog[], ink[], crash[], reach[]}`. Cartesian samples get joints from `ik`, seeded by the previous sample.
4. **Step timing.** Each step gets a time on the final timeline. Move and wait steps get their segment's `tStart`/`tEnd`; logic steps get the `tStart` of the next segment. Logic lines take zero time, so during playback they flash past; line stepping shows each one.
5. **Motion findings.** `motionFindings()` adds them: a joint move used to draw, no approach point, leaving the surface at an angle, CNT cutting a drawn corner, a shape not closing, the tip below the surface, and points out of reach.

**Issue shape:** `{prog, line, sev:'bad'|'warn'|'info', title, detail, t, stepIdx?}`.

### Serialization

- **`toLS(prog)`.** It rebuilds the `.ls` text: header (a default one if missing; it updates `/PROG` and `LINE_COUNT`), numbered `/MN` lines, `/POS`, `/END`.
- **`formatPosition()`.** It writes one `P[n]{...}` block. The CONFIG string is always written as `'N U T, 0, 0, 0'`.
- **Not verified on a controller.** Exported files haven't been loaded on a real controller (see BACKLOG).

## editor.js

- **`TPEditor.create(parent, opts)`.** It builds a CodeMirror 6 view. Its methods are `setText`, `getText`, `setExecLine(line, sub, scroll)`, `setCounts(counts, ran)`, `setDiagnostics(issues)`, `gotoLine`, `cursorLine`, `insertLineAfter` and `replaceLine`.
- **Language.** A `StreamLanguage` with custom tags: J/L/C get their own colors matching the path colors, positions, I/O, terminations and options are tagged, and highlighting uses CSS variables.
- **Gutters and decorations.** A run-count gutter, a dim decoration for lines that never ran, a line highlight for the executing line (lighter while inside a CALL), and the lint gutter, fed from `sim.issues` through `setDiagnostics`.
- **Callbacks.** `opts.onChange` fires on user edits but not on `setText`. `opts.onCursor` fires only on pointer selection; that is how a click on a line jumps playback.
- **Rebuilding the bundle.** `site/vendor/codemirror.min.js` is an esbuild IIFE exposing `window.CM`; `tools/codemirror/entry.js` lists its exports. To use another CodeMirror API, add it to `entry.js` and rebuild.

## app.js

- **Workspace.** `programs[]` entries are `{name, header, lines[], posText, origLines, origPos, _prog}`. `_prog` is the parsed cache, cleared on edit. The workspace is saved to `localStorage['ppv.ws']`; settings are saved to `localStorage['ppv.settings2']`, migrated from the v1 keys `ppv.tool`/`ppv.pr`.
- **Settings shape.**

  ```js
  { tools: {n: [6]}, uframes: {n: [6]}, pr: {n: {type:'joint'|'cart', v:[6]}}, r: {n: number},
    inputs: {'DI[1]': {v, at?, to?}}, macros: {'OPEN HAND': 'GRIP_OPEN'}, comp, tol, maxTime, waitTimeout }
  ```

  `settingsForRun()` adds `start`, the home joints taken from the first PR the root program moves to.
- **Which program runs.** The active tab is the root program. Every open program can be the target of a CALL or a macro. `reachableFrom()` (following macros through `macroTarget()`) limits the settings panels and the Registers & I/O panel to programs the root actually calls.
- **Settings panels.** They only ask for starting values the program doesn't set itself (`refs.prNeed`, `refs.rNeed`), and are rebuilt only when that set changes, so typing in settings doesn't lose focus.
- **Playback.**
  - `t` is the time; `sampleAt(t)` gives the timeline sample.
  - `currentStep()` is the pinned step when stepping, otherwise `stepAt(t)`.
  - `gotoStep()` and `jumpToLine()` handle line stepping and clicks on lines.
  - `frame()` runs the requestAnimationFrame loop. It updates the robot, the ink draw range and the paper view, and refreshes the readout every frame. The editor highlight and the state panel update only when the step changes.
- **3D.** The scene is rebuilt per simulation by `buildScene()`. The robot is cylinders between FK points. Paths are colored by motion type, ink is revealed over time, and axes are drawn for World, every user frame used, and the tool. `poseRobot(q, tool)` positions the arm.
- **Paper view.** A 2D canvas top-down view (+X up, +Y left), with bounds from points near the surface. It draws air moves dashed, a ghost of the full drawing, the ink drawn so far, and the tip.
- **Hooks for teach mode.** `teachHook` and `teachTip` are globals that `teach.js` fills in. `frame()` and `jumpToLine()` defer to the hook while teach mode is on.

## teach.js

- **Jog state.** Its own joint vector `st.q`.
- **Context.** The UF/UT for recording comes from the snapshot at the editor cursor line. If that line never ran, it falls back to the last executed line before it, then to literal `UFRAME_NUM=` / `UTOOL_NUM=` lines above.
- **Jogging.** Joint mode adds to `q`. World and User modes translate along, or rotate about, that frame's axes at the tool point; Tool mode uses the tool's own axes. Each jog is solved with `ik` and refused if out of reach.
- **Dragging.** A capture-phase pointer listener on `#view3d` hit-tests the handle sphere and drags on a World XY plane, or a vertical plane facing the camera for Z. It snaps to 1 mm, or 0.1 mm for small steps.
- **Recording.** **Record** appends `formatPosition(nextIndex, …)` to `posText` and inserts an `L`/`J` line after the cursor line. **Touch up** replaces that `P[n]` block, subtracting a known `Offset,PR[]`; for a PR target it sets `settings.pr[n]` instead.

## Examples

`site/examples/index.json` lists the examples, in this format:

```json
{ "examples": [ { "file": "main_select.ls", "title": "SELECT + CALL", "also": ["a_square.ls"], "inputs": {"GI[1]": {"v": 1}} } ] }
```

- **`also`:** extra programs to load alongside the main one.
- **`inputs`:** preset input values, applied only if the user hasn't set that input yet.
- **`macros`:** preset macro table entries (`{"OPEN HAND": "GRIP_OPEN"}`), applied the same way.
- **First visit:** all examples are loaded when there is no saved workspace.
- **Adding an example:** add an interpreter test for it in `tests/core.test.js`.
