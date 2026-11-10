# Backlog and known gaps

Status as of the hand-off (2026-10-30). Check open PRs and issues on GitHub first; this file may lag behind.

## Current state

- **PR #1** (interpreter, editor, Registers & I/O panel, teach mode, examples, tests) was merged to `main` on 2026-10-30.
- Macros, CALL arguments, timed PULSE and a WAIT timeout setting (PR #2), and a page-scroll fix for phones (PR #3), are merged.
- `data-screens` adds global Registers / Position Reg screens with comments and after-run values.
- **Phone layout** (bottom tabs, pinned 3D view, height strip) is on the `side-view` branch.
- **Phone follow-up:** pendant-style insert buttons in the Program tab (J/L move, `R[ ]=`, `IF`, `WAIT`, `CALL`, `LBL`/`JMP`) so writing a program doesn't need `[ ] = :` from the phone keyboard. Also test on a real iPhone/iPad (Safari's `dvh`, safe-area insets, dragging the handle with a finger).
- **Data screen ideas:** I/O comments (DI/DO) in a third tab, and register comments in editor suggestions.

## Pendant trainer (see docs/PENDANT.md)

In the app as Pendant mode. Known limits:

- **SHIFT+BWD** only walks back within the paused run's path.
- **Re-simulation inside a CALLed program** (after an edit, I/O change or WAIT) doesn't return to the caller.
- **Not available:** editing the default motion instructions, Circle Arc, `FOR`/`ENDFOR`, macros, `SKIP`, Find, Replace and Renumber; frame setup (three-point method); most menu entries (they show "Not available in the trainer").
- **Start values.** Live register / PR / input values written by the pendant are the same values the simulator starts from; there is no separate pendant state yet.
- **Pendant UI:** the third key of the numeric block is a half-key pair (`,` and `-`) because the two scans disagree; the left SHIFT is the one `data-key="SHIFT"`. The software keyboard is the physical keyboard (no on-screen keyboard). Controller cabinet keys have no keyboard shortcuts. Test on real touch hardware.

## Needs verification

- **Exported `.ls` on a real controller.** `toLS()` follows the format of the owner's exported files, but nobody has loaded a downloaded file on a controller yet. Watch especially for line spacing, `C` continuation lines, options on one line versus a `:` continuation, the header fields `PROG_SIZE`/`MEMORY_SIZE`, and the CONFIG string. Loading also needs the controller's ASCII program loader option.
- **iPad / touch.** CodeMirror editing, drag in teach mode, jog button repeat, and the file picker haven't been tested on an iPad. The owner uses Firefox and Chrome on an iPad.
- **Default WAIT timeout.** `WAIT … TIMEOUT,LBL[ ]` starts at 30 s (changeable in Settings). Confirm the controller's default.
- **Macro and argument details.** Not checked against a controller: how macro names with spaces appear in exported `.ls` files, the quote style for text arguments, and whether `IF …,` can take a macro as its action (not supported here).

## Simulation gaps (each is skipped or approximated today)

- **Arm configuration.** Only front / elbow-up / non-flip is solved. The P `CONFIG` string is ignored, there are no joint limits, and there's no singularity handling or warning.
- **Robot dimensions are generic.** A model picker (or editable dimensions) would make J-move paths match a specific cell.
- **Approximate motion.** CNT corner shapes, acceleration and cycle times are rough. Logic lines take zero time.
- **Instructions not simulated:**
  - `INC` (incremental motion)
  - `Skip,LBL` / `SKIP CONDITION`
  - `TIMER[ ]`
  - system variables (`$...`)
  - `MESSAGE`, `PAYLOAD`, `UALM`, `RSR`
  - string registers (`SR[ ]`); text arguments work only for `=` / `<>` checks
  - macros run from DI/UI buttons or the MANUAL FCTNS menu (only macro lines in a program run)
  - background logic
  - multiple motion groups
  - `JMP` into or out of `FOR` blocks (works naively)
- **Indirect position numbers.** `P[R[n]]` / `PR[R[n]]` targets work, but positions aren't labeled well on the paper view when the index is indirect.
- **Group I/O.** `GI` is a plain number; there's no bit mapping to `DI`.

## Ideas the owner has shown interest in

- **More teach-mode controls:** drag in User or Tool directions, not just World; a "move to point" button that jogs to the cursor line's P; and step-back/step-forward jogging.
- **More examples that mirror course exercises:** the IF / DI polling loop (`MAIN1`-style) and a SELECT with a group input (`MAIN2`-style). Write them from scratch; don't copy the manual.

## Housekeeping

- **License.** The repo has no LICENSE file yet; ask the owner before adding one.
- **Old artifact page.** An older single-file version was published as a claude.ai artifact during early development. The GitHub Pages site supersedes it.
