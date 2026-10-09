# tp-sim

A browser-based viewer for industrial robot teach-pendant programs saved as ASCII `.ls` files. Load a program and watch a simulated 6-axis arm run it, see a top-down view of what the tool draws on the work surface, and get a list of common motion mistakes.

**Live page:** https://aaronbush.github.io/tp-sim/

It works with the `.ls` export format used by FANUC controllers. This project is not affiliated with or endorsed by FANUC.

## What it does

- Parses the `/MN` and `/POS` sections of a `.ls` program.
- Simulates `J` (joint), `L` (linear) and `C` (circular) moves, including `FINE` vs `CNTn` corner rounding, and estimates cycle time.
- Animates the arm in 3D and shows the tool path on a top-down "paper" view.
- Flags common problems, such as:
  - a joint move used to draw on the part
  - no approach point above the first point on the surface
  - leaving the surface at an angle
  - CNT corners cut on drawn shapes
  - shapes that don't close on their first point
  - the tip going below the surface
  - points that are out of reach

Your files never leave your browser. **Open .ls…** reads them locally; nothing is uploaded.

## Limits

This is a study aid, not a certified simulator.

- **Arm model:** a generic small 6-axis arm (330 mm upper arm, 335 mm forearm), front / elbow-up configuration only.
- **Frames:** World frame only. Tool frame 1 is a straight offset along the faceplate Z axis; set its length in Settings.
- **Position registers:** PR values aren't stored in `.ls` files. Enter them as joint angles in Settings.
- **Approximate motion:** CNT blending and acceleration are approximations, so corner shapes and cycle times are estimates.
- **Instructions it doesn't simulate:** offsets, I/O, CALL, labels and jumps. The program is run top to bottom.

## Example

[`examples/box_ab.ls`](examples/box_ab.ls) is the program loaded by default: a box drawn with a deliberate mix of motion types.

## Running locally

The site is plain static files in [`site/`](site/). Serve that folder with any web server, for example:

```bash
cd site
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk may not work in every browser.

## Deployment

Every push to `main` that changes `site/` is published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## Credits

3D rendering uses [three.js](https://threejs.org/) r128 (MIT license), included under [`site/vendor/`](site/vendor/).
