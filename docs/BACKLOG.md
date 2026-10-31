# Backlog and known gaps

Status as of the hand-off (2026-10-30). Check open PRs and issues on GitHub first; this file may lag behind.

## Current state

- **PR #1** (interpreter, editor, Registers & I/O panel, teach mode, examples, tests) was merged to `main` on 2026-10-30.
- `macros-callargs-pulse` adds macros, CALL arguments, timed PULSE and a WAIT timeout setting.

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
- **CI:** a GitHub Actions job that runs `node tests/core.test.js`, and optionally the browser smoke test, on PRs.

## Housekeeping

- **License.** The repo has no LICENSE file yet; ask the owner before adding one.
- **Old artifact page.** An older single-file version was published as a claude.ai artifact during early development. The GitHub Pages site supersedes it.
