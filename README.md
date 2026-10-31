# tp-sim

A browser-based editor and simulator for industrial robot teach-pendant programs saved as ASCII `.ls` files. Write or load a program, run it on a simulated 6-axis arm, step through it line by line while watching registers and I/O change, and get a list of common mistakes.

**Live page:** https://aaronbush.github.io/tp-sim/

It works with the `.ls` export format used by FANUC controllers. This project is not affiliated with or endorsed by FANUC.

## What it does

- **Editor:** a CodeMirror 6 editor where editor line numbers are the TP line numbers.
  - Syntax highlighting, with J/L/C moves colored to match the path.
  - Suggestions (Ctrl+Space).
  - Problems marked in the gutter, and run counts per line (×3 means it ran three times).
  - Lines that never ran are dimmed.
  - A separate **Positions** tab holds the `/POS` data.
  - **Download .ls** writes the program back out.
- **Interpreter:** runs the program's logic, not just its moves.
  - Data registers: `R[ ]=` with `+ - * /`, `DIV`, `MOD` and parentheses.
  - Position registers: `PR[ ]=P[ ]`, `LPOS`, `JPOS`, `PR[i,j]`, and clearing with `PR[i]-PR[i]`.
  - Branching: `LBL[ ]`, `JMP LBL[ ]` (including `JMP LBL[R[ ]]`).
  - Conditionals: `IF cond,JMP/CALL` with `AND`/`OR`, `IF (…) THEN / ELSE / ENDIF`, and `SELECT R[ ]=…` with `=n,` and `ELSE,` branches.
  - `FOR … TO/DOWNTO … ENDFOR`.
  - Waits: `WAIT n(sec)`, `WAIT cond` and `WAIT … TIMEOUT,LBL[ ]`.
  - Waits: the `TIMEOUT` time is set under **Settings › WAIT timeout** (30 s to start).
  - Outputs: `DO/RO/GO/F[ ]=` and `PULSE` (the output stays on for the pulse time while the program carries on).
  - Program control: `CALL` to other open programs, with arguments (`CALL PICK(60,R[2],'A')`, read with `AR[n]`), `END`, `ABORT`.
  - Macros: a line that is just a macro name (`OPEN HAND`, `GRIP_CLOSE(2)`) runs the program you pick for it under **Settings › Macros**, standing in for the controller's macro table. A loaded program with the same name runs too, with a note.
  - Frames: `UFRAME_NUM`, `UTOOL_NUM`, and `UFRAME[i]=PR[ ]`.
  - `OVERRIDE`.
- **Motion:** simulates `J`, `L` and `C` moves.
  - `FINE` / `CNTn` corner rounding (including `CNT R[ ]`) and register speeds (`R[ ]mm/sec`).
  - `Offset,PR[ ]`, `Tool_Offset,PR[ ]` and `OFFSET CONDITION`.
  - User and tool frames.
- **Registers & I/O panel:** shows register, position register and output values at the current line; changed values are highlighted. Inside a called program it also shows the `AR[ ]` arguments it was given.
- **Inputs:** you set `DI/RI/GI` values here, and can make an input flip after a few seconds so `WAIT DI[ ]=ON` releases.
- **Stepping:** **◀ Line / Line ▶** steps one executed line at a time, through loops and calls. Clicking a line in the editor jumps to where it runs.
- **Teach mode:** press **Teach** to take the arm off playback and position it yourself, then record what you've set up.
  - Drag the yellow handle at the tool tip (X/Y, or Z with **Drag Z** or Shift), or jog with ± buttons in **Joint, World, User or Tool** coordinates, like the pendant's COORD key.
  - **Record new point** adds a `P[n]` in the active user/tool frame and inserts an `L` or `J` move after the cursor line.
  - **Touch up** replaces the point on the cursor line. It takes out the line's `Offset,PR[ ]` if there is one; on a `PR[ ]` line it sets that register's starting value instead.
- **Views:** the arm animates in 3D with World, user-frame and tool-frame axes. A top-down "paper" view shows what the tool draws.
- **Findings:** flags common problems. Motion:
  - a joint move used to draw on the part
  - no approach point above the surface
  - leaving the surface at an angle
  - CNT cutting drawn corners
  - shapes that don't close
  - the tip going below the surface
  - points out of reach

  Logic:
  - jumps to missing labels
  - `CALL` to a program that isn't loaded
  - `AR[n]` read when the `CALL` didn't pass that many arguments
  - macro lines with no program set up
  - waits that would never end
  - endless loops
  - registers read before they're set
  - user/tool frame mismatches
  - mixing `+` with `*`, or `AND` with `OR`, on one line
  - unmatched `IF/ENDIF` and `FOR/ENDFOR`

Your programs never leave your browser. They are saved in the browser's local storage so edits survive a reload.

## Examples

Pick one from **Examples…** on the page. The files are in [`site/examples/`](site/examples/).

| Program | Shows |
|---|---|
| `box_ab.ls` | A box drawn with a mix of motion types (and their problems) |
| `loop_squares.ls` | `LBL` / `JMP` / `IF` with a counter and a stacked `Offset,PR[ ]` |
| `main_select.ls` + `a_square.ls`, `a_triangle.ls` | `SELECT` on a group input and `CALL` to subprograms; change `GI[1]` in the I/O panel |
| `pick_place.ls` | Building a user frame in the program, `FOR` loop, `WAIT DI[ ]`, gripper `RO[ ]`, place offsets |
| `stack_parts.ls` + `pick_part.ls`, `grip_open.ls`, `grip_close.ls` | `CALL` with an argument, `OPEN HAND` / `CLOSE HAND` macros, an `IF` loop, `WAIT … TIMEOUT`, a stacking `Offset,PR[ ]` and `PULSE` |

## Limits

This is a study aid, not a certified simulator.

- **Arm model:** a generic small 6-axis arm (330 mm upper arm, 335 mm forearm), front / elbow-up configuration only.
- **Approximate timing:** CNT blending, acceleration and logic timing are approximations, so corner shapes and cycle times are estimates.
- **Values the `.ls` file doesn't hold:** registers, PRs, frames and inputs live on the controller. Enter them on the page.
- **Not simulated:** system variables, `TIMER`, `PAYLOAD`, `MESSAGE`, `SKIP`, `INC`, string registers (`SR[ ]`), background logic and multiple motion groups. These are skipped and noted in Findings where it matters.
- **WAIT timeouts:** a `WAIT … TIMEOUT,LBL[ ]` times out after the Settings value (30 s to start), standing in for the controller's setting.
- **Exported `.ls` files are not yet verified on a controller.** Loading an `.ls` file on a controller needs the ASCII program loader option.

## Running locally

The site is plain static files in [`site/`](site/). Serve that folder with any web server, for example:

```bash
cd site
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk won't load the examples.

## Tests

```bash
node tests/core.test.js
```

The tests run the interpreter against the example programs and a set of edge cases. GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs both test scripts on every pull request and push to `main`.

`node tests/browser-smoke.js` loads the real page in headless Chromium at desktop and phone width; it needs Playwright. See [`CLAUDE.md`](CLAUDE.md) for contributor notes and [`docs/`](docs/) for architecture and the backlog.

## Layout

- `site/js/core.js`: kinematics, `.ls` parsing, the TP interpreter and motion simulation (no DOM).
- `site/js/editor.js`: CodeMirror setup, including the TP language, suggestions, run counts and the executing-line highlight.
- `site/js/app.js`: page wiring, the 3D view, the paper view and the panels.
- `site/js/teach.js`: teach mode (drag, jog, record and touch up).
- `site/vendor/`: three.js r128, and a CodeMirror 6 bundle built from [`tools/codemirror`](tools/codemirror) (`npm install && npm run build`).

## Deployment

Every push to `main` that changes `site/` is published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## Credits

- 3D rendering: [three.js](https://threejs.org/) r128 (MIT).
- Editor: [CodeMirror 6](https://codemirror.net/) (MIT).

Both are included under [`site/vendor/`](site/vendor/).
