# Backlog and known gaps

Status as of the hand-off (2026-10-30). Check open PRs and issues on GitHub first; this file may lag behind.

## Current state

- `main` holds v1, the read-only path viewer.
- **PR #1** (`interpreter-and-editor`) adds the interpreter, the CodeMirror editor, the Registers & I/O panel, teach mode, the examples and the tests. It was **open and unmerged** at hand-off. Aaron has been previewing it locally. Build new work on top of it, by branching from `interpreter-and-editor` or from `main` once it's merged, rather than redoing it.

## Needs verification

- **Exported `.ls` on a real controller.** `toLS()` follows the format of the owner's exported files, but nobody has loaded a downloaded file on a controller yet. Watch especially for line spacing, `C` continuation lines, options on one line versus a `:` continuation, the header fields `PROG_SIZE`/`MEMORY_SIZE`, and the CONFIG string. Loading also needs the controller's ASCII program loader option.
- **iPad / touch.** CodeMirror editing, drag in teach mode, jog button repeat, and the file picker haven't been tested on an iPad. The owner uses Firefox and Chrome on an iPad.
- **Default WAIT timeout.** `WAIT … TIMEOUT,LBL[ ]` uses 30 s in place of `$WAITTMOUT`. Confirm the controller's default.

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
  - `CALL` arguments (`AR[ ]` reads as 0)
  - macros
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
