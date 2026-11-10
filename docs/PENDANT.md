# Pendant trainer

Design for the hard-key teach pendant mode. Status: in progress on the `pendant-trainer` branch.

## Goal

Students practise real pendant key sequences away from the lab: navigating screens, creating and
editing programs, jogging, recording and touching up points, and step-testing a program against
the simulated arm. Pendant accuracy is the priority; it is the interface the course teaches.
Practice only: no grading or reporting.

## Rules (in addition to CLAUDE.md)

- **The course manual is the authority, not model memory.** Key names and positions, screen
  layouts, menu trees, function-key labels and alarm text come from the manual notes (below).
  Anything the notes don't cover goes in "Open questions" at the end of this file; don't guess.
- **The manual stays out of the repo.** It lives in `../fanuc-tp-trainer/reference/`:
  `pendant-notes.md` (digest written for this work — read this first), `manual.txt` (full text,
  pages separated by form feeds, greppable) and `pages/pNNN.png` (page scans). Record facts in
  your own words; don't copy manual passages or figures into the repo.
- **Out-of-scope screens** show "Not available in the trainer". Never show an invented screen.
- **No build step, classic scripts** — as everywhere else in `site/`.

## Pieces

| File | Role |
|---|---|
| `site/js/controller.js` | Live controller state machine. No DOM, loads in Node. Exposes one global, `TPController`. |
| `site/js/pendant.js` | Draws the pendant face and screen, turns clicks/keys/touches into events. Exposes `TPPendant`. |
| `site/js/app.js`, `index.html`, `css/app.css` | A "Pendant" mode that hosts the pendant beside the existing 3D view. |
| `tests/pendant.test.js` | Key-script tests: a list of events with expected screen text at checkpoints. Node, no deps. |
| `vscode/` | Thin VS Code extension that shows the site in a webview and opens `.ls` files in it. |

`controller.js` reuses `core.js` for parsing, `toLS`, `fk`/`ik`, frames and running programs. It
must not duplicate them. Both new scripts wrap their code in an IIFE so they add only their one
global (see the shared-globals gotcha in CLAUDE.md).

## Contract between controller and pendant

```js
const ctl = TPController.create(host);
ctl.dispatch(event);        // input
ctl.screen();               // -> Screen (below)
ctl.robot();                // -> { q:[6] joints as core.js fk() takes them, tool, moving, servoOn, uf, ut }
ctl.subscribe(fn);          // fn() after any dispatch that changed screen or robot; returns unsubscribe
ctl.switches();             // -> { tpEnable, deadman, estopPendant, estopPanel, mode, shift }  (added: so the
                            //    pendant can draw its switches in the controller's power-up state)
TPController.ROWS, TPController.COLS   // body size: always exactly 12 rows, each padded to 60 characters
```

**host** (supplied by app.js, or a stub in tests):

```js
{ listPrograms(),                 // -> [name]
  getProgram(name),               // -> {name, header, lines[], posText} (app.js workspace shape) or undefined
  saveProgram(prog), deleteProgram(name),
  settings,                       // app.js settings object: tools, uframes, pr, r, inputs, macros, ...
  settingsChanged() }             // optional (added): called after the controller changes settings.r/pr/
                                  //   rCmt/prCmt/inputs, so the host can save them
```

What is built and what isn't, feature by feature, is in [COVERAGE.md](COVERAGE.md).

The controller treats `settings.r`, `settings.pr` and `settings.inputs` as the controller's live
register, position register and simulated-input values: DATA edits, PR RECORD, I/O simulation and
program runs write into them.

**Events**

```js
{type:'keyDown'|'keyUp', key}     // key ids below
{type:'tpEnable', on}             // pendant ON/OFF switch
{type:'deadman', state:'released'|'held'|'clenched'}
{type:'estop', source:'pendant'|'panel', pressed}
{type:'modeSwitch', mode:'T1'|'T2'|'AUTO'}   // controller cabinet key switch
{type:'cycleStart'}               // controller cabinet button
{type:'tick', dtMs}               // the controller's only clock
{type:'text', text}               // added: typing from the software keyboard (Options/Keybd > KEYBOARD);
                                  //   ignored unless a name/comment entry is open
```

Key ids: `PREV NEXT F1..F5 SHIFT MENU SELECT EDIT DATA FCTN DISP UP DOWN LEFT RIGHT STEP HOLD RESET
BACKSPACE ITEM ENTER FWD BWD COORD SPEED_UP SPEED_DOWN D0..D9 DOT COMMA MINUS TOOL1 TOOL2 MOVE_MENU
SETUP STATUS IO POSN GROUP DIAG_HELP I_KEY J1_NEG J1_POS .. J8_NEG J8_POS`. Jog keys are named by
axis number; in Cartesian jog modes 1..6 mean X Y Z W P R. If the manual notes show a key missing
from this list, add it here and say so in your report.

**Screen**

```js
{ status: { indicators: {busy, step, hold, fault, run, io, prod, tcyc},   // booleans
            alarm,            // latest alarm line, '' when none
            program, line,    // selected program and current line (0 = none)
            mode,             // 'T1' | 'T2' | 'AUTO'
            runState,         // 'ABORTED' | 'PAUSED' | 'RUNNING'
            coord,            // 'JOINT' | 'JGFRM' | 'WORLD' | 'TOOL' | 'USER'
            speed,            // 1..100, or 'FINE' | 'VFINE'
            fbd },            // added: true when FWD/BWD are disabled and the TP is enabled ("FBD" upper left)
  title, titleRight,          // title line and its right-hand text (e.g. "1/9")
  body: [ [ {text, style?} ] ],   // rows of fixed-pitch segments; style: 'cursor' | 'dim' | 'alarm' | 'title'
  prompt,                     // message line above the function-key labels
  softkeys: [5 strings],      // F1..F5 labels exactly as shown, '' when blank
  softkeysMore,               // true when NEXT shows more labels
  popup: { columns: [{title, items[]}], cursor: [col, row] } | null }
```

`TPController.screenText(screen)` renders a Screen as plain text (cursor text wrapped in `[[ ]]`)
for the key-script tests. The pendant UI must draw rows fixed-pitch and never reflow them.

Notes on the Screen as the controller fills it: `status.program`/`line` are the executing program
and line while a run is RUNNING or PAUSED, otherwise the selected program and its edit-cursor line.
Popup `items` are display strings with their number already in them (`'1 UTILITIES  >'`); a blank
menu slot is just its number (`'8'`). A popup may come with its own soft keys and prompt (for
example Select Motion shows `ED_DEF`); these are already merged into `softkeys` and `prompt`. While a
name entry is open the `popup` is the `Alpha input 1` list. Only `'cursor'` is used as a style so far.

## Behaviour in scope for v1

1. Power-up state, alarm line, RESET; E-stop and deadman alarms.
2. Pendant enable switch; T1/T2/AUTO and what each allows.
3. Jogging: COORD cycling, speed override keys (with SHIFT steps), SHIFT + jog key with deadman
   held, unreachable positions.
4. POSN screen (joint, user, world).
5. SELECT screen: create, copy, delete, open a program; program-name entry.
6. EDIT screen: record a point (POINT, SHIFT+POINT), default motion formats, cursor editing of
   motion type, speed and termination, TOUCHUP, position detail, comments.
7. EDCMD: insert, delete, copy/paste lines.
8. INST menu: registers, I/O, IF/SELECT, WAIT, JMP/LBL, CALL, UFRAME_NUM/UTOOL_NUM.
9. DATA: registers and position registers.
10. I/O screens: view and simulate digital I/O.
11. Test running: STEP on/off, SHIFT+FWD, SHIFT+BWD, HOLD, release-to-pause, abort from FCTN,
    continuous run, cursor and status tracking.

## Macros (manual ch. 16, image pages p291-p299)

- **Table.** `settings.macros` is `{ 'INSTRUCTION NAME': 'PROGRAM' }` (names normalised by core.js `macroKey`, so upper case) and is the same table as Settings > Macros and the macro lines the simulator runs. Assignments live beside it in `settings.macroAssign = { 'INSTRUCTION NAME': { type, num } }` with `type` one of `--`, `UK`, `SU`, `MF`, `SP`, `DI`, `RI`, `UI`. The controller calls `host.settingsChanged()` after a change; the page then re-runs so the Macros panel follows.
- **SETUP > Macro** (MENU > SETUP > Macro): columns Instruction name / Program / Assign; F4 [CHOICE] on Program lists programs (F2 MACRO: only programs with sub type Macro) and fills the name when the row is empty; F4 on the type column picks UK, SU, MF, SP, DI, RI (page 2: UI); the number is typed; CLEAR empties the row. A program put in the table gets sub type Macro (`/PROG  NAME<TAB>Macro` in the header).
- **[INST] > MACRO** inserts the instruction name as the line; core.js reads it as a macro and it runs like a CALL.
- **Running by hand.** MENU > MANUAL FCTNS lists the MF macros; SHIFT+EXEC (F3) runs one. Teach-pendant keys: TOOL 1, TOOL 2, MOVE MENU, SETUP, STATUS, I/O, POSN are user keys 1-7; pressed alone they run the UK macro (it may not move the robot), with SHIFT the SU macro. A macro runs through the same machinery as SHIFT+FWD: TP on, T1/T2, deadman (SRVO-003 otherwise), no fault. A UK macro needs no SHIFT or deadman once started.
- **Not built:** macros fired by DI/RI/UI/SOP inputs (the assignment is stored only), FLAG/MARKER assignment types, system macros.

Later: frame setup (three-point method), AUTO-mode production start details, lessons with hints.

## Input ergonomics

A real jog holds deadman + SHIFT + a jog key; a mouse holds one thing.

- Deadman and SHIFT latch on click and stay visibly lit until clicked again.
- Every pendant key has a keyboard mapping, active while the pendant has focus, with a cheat sheet
  in the existing help dialog.
- Jog keys and FWD/BWD act only while held (pointer down or key down); release stops motion.
- Multi-touch works on tablets, so real three-finger holds are possible there.

## Open questions

(Agents: add entries here as `- [area] question — what you assumed meanwhile`.)

Each of these is marked `// unverified:` in `site/js/controller.js`. Check them on the real pendant.

**Most important** (they shape the key sequences students practise):

- [run] What does the pendant show when SHIFT is released mid-run, and how does a paused program
  resume? — Status goes to PAUSED with no message; SHIFT+FWD carries on from the line in progress
  (re-running a half-finished move from where the arm stopped).
- [edit] POINT vs SHIFT+POINT: the p179 description says POINT records "with SHIFT"; Procedure 11-4
  says F1 POINT alone opens Select Motion and ENTER there records. — Followed the procedure: POINT
  opens the pop-up and ENTER records (and sets the default); SHIFT+POINT records with the default.
- [jog] Does a jog key pressed without SHIFT (deadman held, TP on) give a message? — No message, no motion.
- [jog] COORD cycle order. — JOINT → JGFRM → WORLD → TOOL → USER → JOINT.
- [jog] +%/-% steps without SHIFT. — VFINE, FINE, 1, 2, 3, 4, 5, then by 5 up to 100; SHIFT steps
  VFINE, FINE, 5, 50, 100 (manual). Power-up override 10 % and coord JOINT (as in the p046 figure).

**Alarms and switches**

- [alarm] E-stop, deadman and reach alarm texts. — `SRVO-001 Operator panel E-stop`,
  `SRVO-002 Teach pendant E-stop`, `SRVO-003 Deadman switch released`, `MOTN-018 Position not
  reachable`. RESET clears a fault only once its cause is gone.
- [alarm] Is SYST-043 shown at power-up when the TP switch is OFF in T1/T2? — Yes, so a fresh start
  needs TP ON, deadman held, RESET.
- [alarm] Code for "Teach Pendant Enabled in AUTO". — Shown without a code.
- [alarm] Codes for the T1 and AUTO "Operation mode … Selected" messages (only T2's SYST-039 is
  legible). — SYST-039 for all three; it is a warning, not a fault.
- [alarm] Is MOTN-018 a fault that needs RESET? — Yes: it stops the jog or run and lights FAULT,
  servo stays on.
- [alarm] Program errors during a test run (bad label, missing data, …): which INTP codes? — The
  alarm line shows `(PROG, line) <simulator message>` with no code, and the run pauses.
- [mode] In T2, releasing the deadman lowers the override (p076); the reduced value isn't given. —
  Not implemented.

**Jogging**

- [jog] Jog speeds at 100 %. — 250 mm/s linear, 30 °/s rotation and joint, scaled by the override;
  FINE/VFINE move one increment per press (0.1 mm / 0.01°, and 0.01 mm / 0.001°).
- [jog] Jog frames (JGFRM) are not set up anywhere in the app. — Jog frame n defaults to World.
- [jog] No joint limits in the arm model, so joint jogging never alarms (only Cartesian reach does).
- [posn] Joint signs and zero positions are the simulator arm's (see ARCHITECTURE), not the real
  arm's; J2/J3 Interaction is shown as J2+J3 (matches the p081 figure's numbers).
- [posn] Does the POSN screen show the Joint box and a Cartesian box together? — JNT shows joints only;
  USER/WORLD show joints plus that Cartesian box (like the p081 figure).
- [move_to] PR MOVE_TO speed. — Joint move at 60 °/s × override while SHIFT is held.

**Program running**

- [run] FINE/VFINE override during a program run. — Treated as 1 %.
- [run] If the cursor is moved while paused, SHIFT+FWD asks "Paused at line N. Run from line M instead?" (YES/NO); after YES, SHIFT+FWD again runs from the cursor line, and NO leaves the program paused — prompt wording and the NO behaviour are assumed.
- [run] When a program runs through [End] the cursor goes back to line 1; FCTN ABORT (ALL) leaves it where it is. In STEP mode the last instruction leaves the program PAUSED on that line and the next SHIFT+FWD ends it — all from general knowledge, not the manual.
- [select] Choosing a different program from SELECT puts its cursor on line 1 and lets go of the deadman (SRVO-003, so grip it again and RESET). The deadman release is a trainer safety choice the owner asked for, not real pendant behaviour; whether the real pendant always opens at line 1 is assumed.
- [run] SHIFT+BWD only walks back along the paused run's own path (the reverse of the last move,
  ending at the previous point); it does nothing after a jog, an edit, or from ABORTED.
- [run] Resuming after a change (edit, register, I/O, jog, STEP toggle) re-simulates from the
  current line. Inside a CALLed program the caller is then not returned to.
- [run] STEP is ignored for an AUTO (CYCLE START) run; AUTO runs at the override with no T1 cap.

**Screens, menus and prompts**

- [screen] Body size 12 rows × 60 columns, picked from the Select / I/O transcriptions.
- [screen] Power-up screen: `UTILITIES Hints` (from the p046 figure); its content shows "Not
  available in the trainer".
- [menu] MENU page 2 numbering: only STATUS (Version ID) and 4D Graphics (Position Display) are
  confirmed, shown unnumbered. SETUP shows only Frames (unnumbered); FILE has no confirmed items.
- [menu] INST page 3/3 is illegible (shown empty). REGISTER value list page 2 (GI, AO, AI, PR[i,j]),
  IF/WAIT variable list (R, DI, DO, RI, RO, GI, GO), WAIT time value list (Constant, R[ ]) and the
  order of the arithmetic templates are guesses.
- [edit] Termination [CHOICE] list. — `FINE`, `CNT` (CNT then asks for the value).
- [edit] Speed when changing J ↔ L/C. — J→L multiplies % by 30 to mm/sec (the manual figure shows
  100% → 3000mm/sec); L→J divides by 30. Changing the unit keeps the number.
- [edit] Speed range. — % is clamped to 1–100; other units accept any positive value. msec is listed
  but not available (the simulator doesn't read it).
- [edit] Editing the four default motion lines (ED_DEF) is not described. — ED_DEF only picks one.
- [edit] TOUCHUP when the point's UF/UT differ from the active ones (p196 prompt) is not modelled;
  the point is re-recorded in the active frames. SHIFT+F5 is TOUCHUP even with the cursor on P[ ].
- [edit] Editing a program with the TP OFF. — Refused ("Teach pendant is disabled"); also refused
  while the program runs ("Program is running").
- [edit] Changing the motion type to Circular makes the old point the via point and the end point
  `P[...]` until it is touched up. Circle Arc is not available.
- [prompt] Prompt texts the manual doesn't give: `Delete <NAME>?` (Select DELETE), `Delete line(s)?`,
  `How many lines to insert?`, `Undo?`, `Enter line number` (ITEM), `Invalid program name`,
  `Program already exists`, `Program is in use`, `Value out of range`, `Position is not recorded`.
- [select] COPY: asks for the new name like CREATE, then copies (no confirmation). The "bytes free"
  figure on the Select header is left out.
- [name] Letter entry: repeated presses of one group key cycle its letters, another key moves on
  (the manual doesn't describe the second stage). Words soft keys: RSR PNS STYLE JOB TEST.
- [edit] EDIT with no program selected opens the Select screen.
- [data] PR CLEAR clears without confirmation.
- [io] Robot I/O shows 8 RI/RO.
- [pendant UI] The scans disagree on the third key of the `0 .` row (comma on p059/p060, minus on p187) and on
  the bottom-left key (minus vs DIAG/HELP). The face follows p187 and splits that cell into `,` and `-` half keys.
- [pendant UI] The status-bar "FBD" marker is drawn in the screen's title bar, not literally at the top-left.

**Macros**

- [macro] Does a macro request while a program is paused (or running) have a defined behaviour? — Refused with PROG-040 / INTP-105 while paused, ignored while running.
- [macro] Table starts empty; the manual's figure shows default rows (Open/Close/Relax hand 1 and 2 on MF 1-3, 11-13). — Not seeded. New entries join the end of the table (the cursor row isn't kept), and a name entered without a program is stored with an empty program.
- [macro] Instruction names are shown upper case (the table is keyed by `macroKey`), where the manual shows mixed case; names are limited to letters, digits, `_` and spaces (so the `.ls` macro line reads back), max 16 characters.
- [macro] Column widths and header spacing of the Macro Command table, which columns show [CHOICE], CLEAR (assumed: empties the whole row), the [TYPE] list on F1, and the ranges for assignment numbers (assumed 1-7 for UK/SU, to 999 otherwise).
- [macro] Assigning the same program twice: the manual says the second name is left blank with a message. — The second entry is refused with that message instead (no blank-name rows).
- [macro] Titles and prompts: the INST > MACRO menu title, "No macros in the macro table", the MANUAL FCTNS screen when nothing is assigned (empty list).
- [macro] UK macros that move the robot: the manual says they cannot; it doesn't say what the pendant shows. — A prompt refuses it; the group-mask rule isn't checked.
- [macro] Releasing SHIFT while an SU / MF macro runs pauses it, as for a test run; the macro program then blocks other programs until aborted.

