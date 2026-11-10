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
- **Live-controller options.** For the pendant trainer, settings may also carry `startLine` (1-based line of the root program to start at), `startUf`/`startUt` (active frames at the start; the start pose uses `startUt`'s tool), `outInit` (output values at the start) and `forceFine` (every termination runs as FINE, as in a STEP test). The result's `resume` is `{prog, line, depth}` for the line that would run next, or `null` when the program ended.

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
- **Callbacks.** `opts.onChange` fires on user edits but not on `setText`. `opts.onLineClick` fires on a click in the line-number gutter; that is how playback jumps to a line. A click in the text only moves the cursor.
- **Rebuilding the bundle.** `site/vendor/codemirror.min.js` is an esbuild IIFE exposing `window.CM`; `tools/codemirror/entry.js` lists its exports. To use another CodeMirror API, add it to `entry.js` and rebuild.

## app.js

- **Workspace.** `programs[]` entries are `{name, header, lines[], posText, origLines, origPos, _prog}`. `_prog` is the parsed cache, cleared on edit. The workspace is saved to `localStorage['ppv.ws']`; settings are saved to `localStorage['ppv.settings2']`, migrated from the v1 keys `ppv.tool`/`ppv.pr`.
- **Settings shape.**

  ```js
  { tools: {n: [6]}, uframes: {n: [6]}, pr: {n: {type:'joint'|'cart', v:[6]}}, r: {n: number},
    rCmt: {n: text}, prCmt: {n: text}, dataRows: {R?: n, PR?: n},
    inputs: {'DI[1]': {v, at?, to?}}, macros: {'OPEN HAND': 'GRIP_OPEN'}, comp, tol, maxTime, waitTimeout }
  ```

  `settingsForRun()` adds `start`, the home joints taken from the first PR the root program moves to.
- **Which program runs.** The active tab is the root program. Every open program can be the target of a CALL or a macro. `reachableFrom()` (following macros through `macroTarget()`) limits the settings panels and the Registers & I/O panel to programs the root actually calls.
- **Settings panels.** Tool frames, user frames and macros. They are rebuilt only when the set of frames/macros the program uses changes, so typing in settings doesn't lose focus.
- **Data screens.** `settings.r` / `settings.pr` are global start values shared by every program, edited in the Data panel (`renderData`). Rows run from 1 to the highest register used, set or commented (at least 10, more with **+10 rows**). The After run column reads the last snapshot of `sim.snaps`. `updateData()` rebuilds the panel on each run unless the change came from the panel itself (`dataEditing`) or a box in it has focus; then only the after-run cells update, so Tab moves between boxes normally. Comments in `rCmt`/`prCmt` override the ones collected from program lines (`progComments`). `refs.rNeed`/`refs.prNeed` (read before set) mark rows with a •.
- **Playback.**
  - `t` is the time; `sampleAt(t)` gives the timeline sample.
  - `currentStep()` is the pinned step when stepping, otherwise `stepAt(t)`.
  - `gotoStep()` and `jumpToLine()` handle line stepping and clicks on line numbers.
  - `frame()` runs the requestAnimationFrame loop. It updates the robot, the ink draw range and the paper view, and refreshes the readout every frame. The editor highlight and the state panel update only when the step changes.
- **3D.** The scene is rebuilt per simulation by `buildScene()`. The robot is cylinders between FK points. Paths are colored by motion type, ink is revealed over time, and axes are drawn for World, every user frame used, and the tool. `poseRobot(q, tool)` positions the arm.
- **Paper view.** A 2D canvas top-down view (+X up, +Y left), with bounds from points near the surface. It draws air moves dashed, a ghost of the full drawing, the ink drawn so far, and the tip.
- **Height strip.** `drawSide(tip)` draws `#sideZ`, called alongside `drawPaper` from `frame()` and teach's frame. It is linear from the crash limit up to just above the taught heights and squeezed (square-root) above a break, so start/home moves don't flatten the working zone. It publishes `sideMap = {hOf, sz}` so teach.js can turn a drag in the strip into a World Z target.
- **Phone layout.** Below 700 px (`phoneMQ`) CSS makes the grid wrappers `display: contents`, pins `#view3d` with `position: sticky`, and shows only the elements whose `data-pane` matches `body[data-pane]` (Run, Teach, Program, Data, More), picked from the fixed `#phoneTabs` bar. `placeSide()` moves `#sideZ` onto the 3D view there. Choosing the Teach tab turns teach mode on; leaving it turns it off. Wider screens ignore `data-pane`.
- **Hooks for teach and pendant mode.** `teachHook` and `teachTip` are globals that `teach.js` fills in; `pendantHook` is filled in by `pendant-app.js`. `frame()` defers to `pendantHook` (then `teachHook`) while a mode is on, and `jumpToLine()` defers to the teach hook. On a phone `setPane('pendant')` calls `pendantHook.setOn()`.

## teach.js

- **Jog state.** Its own joint vector `st.q`.
- **Context.** The UF/UT for recording comes from the snapshot at the editor cursor line. If that line never ran, it falls back to the last executed line before it, then to literal `UFRAME_NUM=` / `UTOOL_NUM=` lines above.
- **Jogging.** Joint mode adds to `q`. World and User modes translate along, or rotate about, that frame's axes at the tool point; Tool mode uses the tool's own axes. Each jog is solved with `ik` and refused if out of reach.
- **Dragging.** A capture-phase pointer listener on `#view3d` hit-tests the handle sphere and drags on a World XY plane, or a vertical plane facing the camera for Z. It snaps to 1 mm, or 0.1 mm for small steps.
- **Height strip and line picker.** Dragging in `#sideZ` keeps the grab offset and maps the pointer through `sideMap.hOf` to a World Z target. **▲ ▼** move the editor cursor (`setCursorLine`, which doesn't scroll the page) to choose the record line without touching the editor.
- **Recording.** **Record** appends `formatPosition(nextIndex, …)` to `posText` and inserts an `L`/`J` line after the cursor line. **Touch up** replaces that `P[n]` block, subtracting a known `Offset,PR[]`; for a PR target it sets `settings.pr[n]` instead.

## controller.js

The live teach-pendant controller behind the pendant trainer (design and contract in `docs/PENDANT.md`). No DOM; it loads as a classic script (one global, `TPController`) and as a Node module for `tests/pendant.test.js`. It reuses core.js for parsing, `toLS`/`formatPosition`, `fk`/`ik`, frames and running programs.

- **State.** One `Ctl` object holds the switches (TP enable, deadman, E-stops, mode), SHIFT, the active alarms (`{text, level, cond}`; `level` is `warn`, `stop` or `servo`, and `cond()` says whether the cause is still there) and the alarm history, the jog coordinate system and override index, the arm's joints `q`, the active UF/UT/jog frame numbers, STEP and FWD/BWD-disable flags, the selected program, one edit cursor per program (`{line, col}`), the run (below), the four default motion lines, outputs and the set of simulated inputs. Registers, position registers and input values live in the host's `settings.r` / `settings.pr` / `settings.inputs`.
- **Time.** Only `{type:'tick', dtMs}` moves anything. Ticks are cut into ≤ 50 ms slices; each slice advances a held jog key, a PR MOVE_TO and the run. No timers, `Date` or randomness.
- **Faults.** `raise()` adds an alarm; any non-warning alarm pauses a run and stops jogging. RESET drops alarms whose `cond()` is false. Servo power is off while a `servo` alarm or an E-stop is active. `checkSwitches()` raises the faults that follow from the switch positions (TP off in T1/T2, TP on in AUTO, deadman not held with the TP on).
- **Screens.** `stack` holds the current screen; hard keys `open()` a new one and push the old one onto `history`, which PREV pops. A screen object has `title()`, `titleRight()`, `body()` (rows of `{text, style}` segments, normalised to exactly `ROWS`×`COLS`), `softkeys()`, optional `more()`/`next()` (NEXT pages), `prompt()`, `prev()` and `key(k, shift)`. Screens: `InfoScreen` ("Not available in the trainer"), `SelectScreen`, `CreateScreen`, `DetailScreen`, `EditScreen`, `DefaultMotionScreen`, `PosDetailScreen` (P[n] or PR[n]), `PosnScreen`, `DataScreen`, `IOScreen`, `AlarmScreen`.
- **Overlays.** In priority order a key goes to: the name/comment `TextEntry` (Alpha input list, multi-tap letter groups, Words, Options), the numeric entry (`num`: digits, `.`, `-`, BACKSPACE, ENTER), a YES/NO confirm (F4/F5), then the popup (`Menu` widget: numbered items, digit shortcuts, `--next page--`/`-- NEXT --` paging, one level of fly-out; or the `JogMenu` from SHIFT+COORD), then hard keys, then the screen. Overlays can replace the soft keys and the prompt.
- **Edit screen.** Each program line is split into fields (line number, motion type, P/PR, speed, termination; or register indexes, constants and ON/OFF on other lines). The cursor is `{line, col}`; `[CHOICE]`, digits and ENTER act on the field under it. New instructions overwrite the cursor line, or are added at `[End]`. INST instructions are templates such as `{lhs}={val}` or `IF {cv}={cval},{act}`: menu slots open the pop-up the manual shows and expand into sub-templates, leaf slots take a number, program name or text, and unfilled slots show `...`. The line is saved after every step and becomes plain text once complete. EDCMD Insert/Delete/Copy/Cut/Paste (LOGIC, POS-ID, POSITION)/Undo/Remark/Comment work on the line list; unused `/POS` blocks are dropped. Every change is written back with `host.saveProgram()`.
- **Execution.** The controller is a player over a `runSim` result. SHIFT+FWD (or CYCLE START in AUTO) simulates from the cursor line with the live state (`start` = current joints, `startLine`, `startUf`/`startUt`, `outInit`, registers, simulated inputs; `forceFine` in STEP mode) and plays the steps in order: each step applies its snapshot (registers, outputs, frames), moves the cursor, and plays its stretch of the timeline `T`. Time scales with the override; in T1 the tool is held to 250 mm/s; WAIT dwell runs in real time. STEP pauses after each step. Releasing SHIFT or the deadman, HOLD, a mode/TP change or any fault pauses. A move into an unreachable segment stops with MOTN-018 before it starts. A run stuck on a WAIT stays RUNNING on that line until the I/O changes, then re-simulates. Edits, register or I/O changes, jogs and STEP toggles mark the run dirty: it re-simulates from its next line (when running) or on resume. Capped runs (step/time/move limits) continue from `sim.resume`. SHIFT+BWD plays the timeline backwards to the previous move's end.
- **Macros.** `MacroScreen` (SETUP > Macro), `ManualMacroScreen` (MANUAL FCTNS), `EditScreen.macroInst()` ([INST] > MACRO) and `Ctl.runMacro()` / `userKeyMacro()` (user keys). The table is `settings.macros` plus `settings.macroAssign`; edits call `regChanged()`, and pendant-app.js re-runs the page when the table changed. A hand-run macro is a fresh `resim()` of the macro's program (`run.noShift` for user keys pressed alone). Sub type lives in the `/PROG` header line (`subtypeOf`, `setSubtype`). Details in `docs/PENDANT.md`; gaps in `docs/COVERAGE.md`.
- **Contract extras.** `switches()`, `status.fbd`, the `{type:'text'}` event and the optional `host.settingsChanged()`; see `docs/PENDANT.md`.

## pendant.js and pendant-mode (pendant-app.js)

- **pendant.js** (global `TPPendant`, `mount(el, controller, opts)` and `keymap`). It builds the face (screen, F-key row, key grid with the jog column, ON/OFF switch, pendant E-stop) and a separate strip for what isn't on the face (deadman, T1/T2/AUTO, CYCLE START, panel E-stop). It redraws from `controller.screen()` on `subscribe`, draws its switches from `controller.switches()` (nothing is sent at mount), and runs the clock with `requestAnimationFrame` ticks (dt capped at 100 ms, paused when hidden).
- **Input.** Each key keeps a set of hold sources (pointer ids, keyboard codes, a latch). One keyDown goes out when the first source presses and one keyUp when the last releases, so multi-touch and mixed mouse/keyboard work. SHIFT and the deadman latch by default (`opts.latch`). Keyboard input is active only while the pendant has focus and is matched by `KeyboardEvent.code`; while the controller shows the Alpha input popup, printable keys go out as `{type:'text'}` instead of shortcuts. Blur releases everything held.
- **Screen.** The font is fitted in px so exactly `TPController.COLS` (60) characters fill the screen width; rows are clipped, never wrapped. Softkey labels use the same seven grid columns as the keys, so they sit over F1–F5.
- **pendant-app.js** adds no globals. `host` maps the controller's program calls to `programs[]` (new programs become tabs; saves update the open editor with `setText`, which doesn't fire `onChange`; deletes close tabs) and `settings`. Pendant edits re-run the simulation after 500 ms of quiet. The controller re-reads programs through `getProgram` and caches by content, so editor edits need no notification. `settingsChanged` and a 2 Hz poll save settings and refresh the Data panel through `updateData()`, which never rebuilds it under focus. The pendant mode follows the pendant's selected program with the editor tab, only when that selection changes. `pendantHook.frame()` poses the arm from `ctl.robot()` with `poseRobot()` and writes the readout; leaving the mode saves settings and re-simulates once.

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
