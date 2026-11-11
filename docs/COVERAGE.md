# Coverage matrix

What the trainer covers and what it doesn't, one row per feature, so every gap is visible at a glance. It was built from the code (every `'na'` item, `it(label, null)` and "Not available in the trainer" path in `site/js/controller.js`, plus the instruction types and limits in `docs/BACKLOG.md` "Simulation gaps"), not from memory. Update a row when a gap closes.

**Legend.** Status values: `Done` (works as the manual describes), `Partial` (works for the common case; the Notes column says what is missing), `Not available` (pendant: shows "Not available in the trainer"; simulator: skipped, flagged or absent), `n/a` (doesn't apply there). *Manual ref* uses image-page numbers (`pNNN`, as in the digest `pendant-notes.md`; printed page = image page - 16); "not in manual" means the course manual doesn't describe it. *Pendant mode* is the on-screen pendant (`controller.js`). *Simulator view* is the editor plus run/playback side (`core.js`, `app.js`).

## Suggested next

Ordered by value to a student working through the course labs:

1. **Miscellaneous instructions**: `SKIP`/`SKIP CONDITION`, `TIMER[ ]`, `MESSAGE`, `PAYLOAD`, `INC` (chapter 17 labs). Neither side simulates them.
2. **`FOR`/`ENDFOR`, `IF (...)` with AND/OR and `CALL program()` on the pendant** (chapter 15). The simulator already runs `FOR`; the pendant can't insert it.
3. **Group, analog and UOP I/O screens** (chapter 14), with GI/GO bit mapping to DI/DO.
4. **Auto-mode macros** (DI/RI/UI/SOP triggers, chapter 16): the table accepts the assignment but nothing fires it.
5. **Find, Replace, Renumber** in EDCMD (chapter 13), and **editing the default motion lines** (ED_DEF).
7. **Program detail fields** (group mask, write protect, ignore pause, stack size) and SELECT `[ATTR]`, `LOAD`, `SAVE AS`.
8. **Circle Arc motion and CONFIG-aware solutions** (arm configuration is ignored today).

## Screens & menus

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| MENU key, page 1 and 2 pop-up with fly-outs | p062, p120 | Partial | n/a | Menu draws; most entries open the "Not available" screen |
| MENU > UTILITIES fly-out (Home, Hints, Robot Condition, Prog Adjust, Program Shift, Mirror Image Shift, Tool Offset, Frame Offset, ...) | p254 | Not available | Not available | Power-up shows an empty "UTILITIES Hints" title only |
| MENU > TEST CYCLE | p254 | Not available | n/a | Test-cycle set-up screen not described in the notes |
| MENU > MANUAL FCTNS (macros) | p294 | Done | n/a | Lists MF macros, SHIFT+EXEC runs; see Running & testing |
| MENU > ALARM > Alarm Log | p119-p122 | Done | n/a | Active and history views |
| MENU > ALARM > Motion / System / Appl / Comm Log | p120 | Not available | n/a | Only the alarm log is built |
| MENU > I/O > Digital, Robot | p243-p257 | Done | n/a | See Data & I/O |
| MENU > I/O > Cell Intface, Custom, Analog, Group, UOP, SOP, Interconnect | p254 | Not available | n/a | See Data & I/O |
| MENU > SETUP > Macro | p295 | Done | Done | Instruction name, program, assignment type and number; shared with Settings > Macros |
| MENU > SETUP > Frames | p134-p176 | Done | Partial | Tool, jog and user lists via [OTHER], DETAIL, CLEAR (confirmation text unverified), SETIND; the simulator view still takes typed values in Settings |
| MENU > SETUP > Prog Select, ZDT Client, General, Ref Position, Port Init, Ovrd Select, User Alarm | p295 figure | Not available | Not available | Listed from the manual's figure; no screens |
| MENU > FILE | not in manual | Not available | Partial | Fly-out empty; the page's Open / download of `.ls` files stands in |
| MENU > USER | p254 | Not available | n/a | |
| MENU page 2: STATUS > Version ID | p254 | Not available | n/a | Position uncertain (see Open questions) |
| MENU page 2: 4D Graphics > Position Display | p254 | Done | n/a | Opens the POSN screen |
| FCTN: ABORT (ALL), Disable FWD/BWD, RELEASE WAIT, UNSIM ALL I/O, CYCLE POWER | p067, p257 | Done | n/a | |
| FCTN: WRIST JOG | p068 | Not available | n/a | |
| FCTN: QUICK/FULL MENUS, SAVE, PRINT SCREEN, PRINT, ENABLE HMI MENUS | p067 | Not available | n/a | |
| DISP menu: Single | p062 | Done | n/a | Only the single-window layout exists |
| DISP menu: Double, Triple, TreeView, Wide/Horizontal layouts, Help/Diagnostics, Status/Single, Menu History, User Views, Favorites, Related Views, Maximize, Zoom | p062 | Not available | n/a | Split screens not built |
| Hard keys SELECT, EDIT, DATA, POSN, I/O | p058-p061 | Done | n/a | |
| Hard key SETUP, STATUS, HELP/DIAG | p058-p061 | Not available | n/a | SETUP/STATUS act as user keys UK[4]/UK[5] when a macro is assigned |
| Hard keys TOOL 1, TOOL 2 | p277 | Partial | n/a | Run assigned UK/SU macros; otherwise "Not available" (no tool-frame function built) |
| Hard key MOVE MENU | p058 | Not available | n/a | Manual: not supported for HandlingTool; also a user key (UK[3]) |
| Hard keys GROUP, I_KEY | p058 | Not available | n/a | Keys exist on the face but the controller ignores them |
| Alarm screen: [TYPE], [VIEW], RES_1CH, DETAIL | p119-p122 | Not available | n/a | HIST / ACTIVE / CLEAR work |
| Status bar indicators (BUSY, STEP, HOLD, FAULT, RUN) | p061 | Done | n/a | I/O, PROD, TCYC lights are never lit |

## Program editing

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| SELECT list, open a program | p177-p181 | Done | Done | Editor tabs follow the pendant's selection |
| SELECT: CREATE, DELETE, COPY, DETAIL | p179-p186 | Done | Done | |
| SELECT: [TYPE], MONITOR, [ATTR], LOAD, SAVE AS, PRINT | p177-p181 | Not available | Partial | Open / download `.ls` in the page stands in for LOAD / SAVE AS |
| Program detail: name, comment, sub type (None, Macro) | p181-p186, p292 | Done | n/a | Sub type shown in the `/PROG` line (`Macro`) |
| Program detail: sub type Cond, Collection | p183 | Not available | n/a | |
| Program detail: group mask, write protect, ignore pause, stack size | p184-p186 | Not available | n/a | Shown, not editable |
| EDIT: cursor movement, ITEM go-to-line, line view | p162, p189-p192 | Done | Done | |
| EDIT: POINT / SHIFT+POINT recording, Select Motion pop-up | p189-p190 | Done | n/a | |
| EDIT: ED_DEF (edit default motion lines) | p190 | Partial | n/a | Pick which default is used; editing the four lines isn't built |
| EDIT: TOUCHUP, Position detail (P[ ], PR[ ]) | p194-p196 | Done | Done (Teach) | [REPRE] (representation change) not available |
| EDIT: [CHOICE] on motion type, speed, termination, position type | p206, p214, p216 | Done | n/a | |
| Motion Circle Arc (A) | p206 | Not available | Not available | Circular (C) works |
| Speed unit msec | p214 | Not available | Not available | |
| [INST] > Registers (`R[ ]=`, `PR[ ]=`, arithmetic) | p269 | Partial | Done | `SR[ ]`, `UFRAME[ ]`/`UTOOL[ ]` values and `...=(...)` not available on the pendant |
| [INST] > I/O (DO, RO, GO, AO and reads) | p269 | Done | Done | |
| [INST] > IF/SELECT | p269-p280 | Partial | Done | `IF (...)`, AND, OR not available on the pendant |
| [INST] > WAIT | p269 | Done | Done | |
| [INST] > JMP/LBL | p269 | Done | Done | |
| [INST] > CALL program | p266 | Done | Done | `CALL program()` (arguments) not available on the pendant; works in the editor |
| [INST] > Miscellaneous: Remark, OVERRIDE | p313 | Done | Done | |
| [INST] > Miscellaneous: RSR, UALM, TIMER, Message, Parameter name | p313 | Not available | Not available | See Instructions |
| [INST] > Offset/Frames (OFFSET CONDITION, UFRAME_NUM, UTOOL_NUM, UFRAME[ ]=, UTOOL[ ]=) | p313 | Done | Done | |
| [INST] > MACRO | p298-p299 | Done | Done | Line is the macro's instruction name; runs like a CALL |
| [INST] > Skip, Payload, Multiple control, Program control, FOR/ENDFOR | p255, p313 | Not available | Partial | The editor and simulator handle `FOR`; the rest are skipped |
| [INST] page 3/3 | p255 | Not available | n/a | Illegible in the manual scan |
| [EDCMD]: Insert, Delete, Copy/Cut/Paste, Comment, Undo, Remark | p225-p242 | Done | n/a | Paste: LOGIC, POS-ID, POSITION |
| [EDCMD]: Find, Replace, Renumber | p225-p242 | Not available | n/a | |
| [EDCMD] page 2: Icon Editor, Color, IO Status | p226 | Not available | n/a | |
| Text entry (Alpha input: Words, Upper, Lower, Options/Keybd) | p182-p184 | Done | n/a | Keyboard typing forwarded as text |

## Instructions

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| Motion J / L / C with speed, CNT / FINE, Offset, Tool_Offset options | p205-p224 | Partial | Partial | Motion model is approximate on purpose; unsupported options pass through as text |
| Register and PR arithmetic, `PR[i,j]`, DIV, MOD | p263-p290 | Done | Done | |
| IF / SELECT / JMP / LBL / CALL with arguments | p263-p290 | Partial | Done | See Program editing |
| `FOR` / `ENDFOR` | p313 | Not available | Done | Pendant can't insert it |
| WAIT (time, condition, TIMEOUT) | p263-p290 | Done | Done | |
| PULSE | p243-p262 | Done | Done | |
| Macro lines (`OPEN HAND`, `GRIP_CLOSE(2)`) | p298 | Done | Done | Needs the macro table; falls back to a same-named program with a note |
| `INC` (incremental motion) | not in manual | Not available | Not available | Skipped |
| `SKIP CONDITION`, `Skip,LBL` | p313 | Not available | Not available | Skipped |
| `TIMER[ ]` | p313 | Not available | Not available | Skipped |
| System variables (`$...`) | not in manual | Not available | Not available | |
| `MESSAGE`, `PAYLOAD`, `UALM`, `RSR` | p313 | Not available | Not available | |
| String registers `SR[ ]`; text arguments | not in manual | Not available | Partial | Text arguments only for `=` / `<>` checks |
| Group I/O bit mapping (GI/GO to DI/DO) | p243-p262 | Not available | Not available | GI/GO are plain numbers |
| Indirect positions `P[R[n]]`, `PR[R[n]]` | p205-p224 | Not available | Partial | Run works; paper view labels are poor |
| Background logic, multiple motion groups | not in manual | Not available | Not available | |
| `JMP` into / out of `FOR` blocks | p313 | n/a | Partial | Works naively |

## Running & testing

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| SHIFT+FWD test run (continuous) | p190-p193 | Done | Done (Play) | Release SHIFT / deadman pauses |
| STEP mode (line by line, FINE terminations) | p175-p178 | Done | Done | |
| SHIFT+BWD | p191 | Partial | Not available | Only walks back over the paused run's path |
| HOLD, FCTN ABORT, RELEASE WAIT | p060, p067 | Done | n/a | |
| Resume after pause / cursor moved | p192 | Partial | n/a | Behaviour unverified (Open questions) |
| Re-simulation inside a CALLed program | p192 | Partial | n/a | After an edit it doesn't return to the caller |
| AUTO mode CYCLE START | p045-p046 | Partial | n/a | Starts the selected program; production start (PROD, RSR/PNS) not built |
| TEST CYCLE | p254 | Not available | n/a | |
| T1 250 mm/s cap, override scaling | p076 | Done | Partial | Simulator shows approximate times only |
| T2 deadman release lowers override | p076 | Not available | n/a | Reduced value not in the notes |
| Manual-function macros (MF), run with SHIFT+EXEC | p294 | Done | n/a | Refused while a program is paused (PROG-040 / INTP-105) |
| User-key macros: UK (alone), SU (with SHIFT) on TOOL 1/2, MOVE MENU, SETUP, STATUS, I/O, POSN | p293 | Done | n/a | UK macros that move the robot are refused, per the manual |
| Auto-mode macros: DI, RI, UI, SP (SOP) triggers | p278, p293 | Not available | Not available | Assignment can be stored; nothing fires it |
| Macro lines in a program (SHIFT+FWD, step and continuous) | p298-p299 | Done | Done | Step enters the macro's program like a CALL |
| Running a program from the editor (Play, scrub, step) | not in manual | n/a | Done | Simulator-only playback |
| Findings (plain-language checks) | not in manual | n/a | Done | Simulator-only |

## Jogging & frames

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| Jog keys J1-J6 with SHIFT + deadman, FINE / VFINE increments | p076, p078-p081 | Done | Done (Teach) | |
| J7 / J8 (extended axes) | p078 | Not available | n/a | |
| COORD cycling, SHIFT+COORD jog menu | p076, p137 | Done | Partial | Cycle order is unverified |
| Speed override keys, SHIFT steps | p059-p060 | Done | n/a | |
| WRIST JOG | p068 | Not available | n/a | |
| Jog frames (JGFRM) | p137, p163-p169 | Done | Not available | Jog frame n is taught on the pendant (Three Point or Direct Entry); an untaught one is World. The Settings panel has no jog frame rows |
| User frame use (UFRAME_NUM, UF in jog / POSN) | p134-p160 | Done | Done | |
| Frame setup: tool Three / Four / Six Point (XZ, XY), user Three / Four Point, jog Three Point, Direct Entry for all | p117-p169 | Done | Partial | Tool Two Point + Z is not in the course manual (shows "Not available in the trainer"). Settings panel takes typed values only and shows the frames the open program uses |
| Saving and restoring frame data (FILE, FRAMEVAR.VR / SYSFRAME.SV) | p169-p172 | Not available | n/a | The page saves frames with the other settings |
| POSN screen: JNT, USER, WORLD | p080-p081 | Done | Done (readout) | [TYPE] list not available; joint zero/sign is this arm model's |
| Unreachable position (MOTN-018) | not in manual | Partial | Done | Alarm text unverified |
| Arm configuration (CONFIG, flip / elbow) | p205-p224 | Not available | Not available | Only front / elbow-up / non-flip is solved |
| Joint limits, singularities | not in manual | Not available | Not available | |
| Robot dimensions | not in manual | n/a | Partial | One generic arm |
| MOVE_TO (DATA > Position Reg, SHIFT+MOVE_TO) | p212-p215 | Done | n/a | |

## Data & I/O

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| DATA > Registers (values, comments) | p211, p070 | Done | Done (Data panel) | |
| DATA > Position Reg (RECORD, MOVE_TO, POSITION, CLEAR) | p212-p215 | Done | Done | |
| DATA > String Reg, KAREL Vars, KAREL Posns | p070 | Not available | Not available | |
| I/O > Digital In/Out (monitor, simulate, force) | p243-p257 | Done | Partial | Simulator side: preset input values and timed changes |
| I/O > Robot In/Out | p243-p257 | Done | Partial | 8 signals shown |
| I/O > Analog, Group, UOP, SOP, Cell Intface, Custom, Interconnect | p254 | Not available | Partial | GI is a plain number; AI/AO read as plain values |
| I/O CONFIG, signal comments | p243-p262 | Not available | Not available | |
| UNSIM ALL I/O | p257 | Done | n/a | |
| Macro table (SETUP > Macro) storage | p295-p297 | Done | Done | Shared `settings.macros` plus `settings.macroAssign` |

## Files & system

| Feature | On the real pendant | Pendant mode | Simulator view | Notes / what's needed |
|---|---|---|---|---|
| Load / save programs as `.ls` | p085-p106 | Not available | Done | Open and download in the page; FILE menu on the pendant is empty |
| Backup / restore, file manager | p085-p106 | Not available | Not available | |
| Power-up state, CYCLE POWER | p257 | Done | n/a | |
| Switches: TP ON/OFF, deadman, T1/T2/AUTO, E-stops | p056-p057 | Done | n/a | Pendant strip draws them |
| Alarm texts (SRVO, SYST, MOTN, INTP, PROG) | p119-p128 | Partial | n/a | Several texts are unverified; program errors show no code |
| STATUS menu (Version ID, system status) | not in manual | Not available | n/a | |
| Initial setup (axis limits, payload, mastering) | p107-p118 | Not available | Not available | |
| System variables screen | not in manual | Not available | Not available | |
| Saved workspace and settings | not in manual | n/a | Done | Stored in the browser only |
