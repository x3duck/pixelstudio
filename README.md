# Pixel Wraith

A small Three.js demo: an original flame-headed swordsman in the visual language of Dead Cells,
rendered as genuine pixel art and playing an 8-second seamless loop (idle → 3 steps → coil →
whip slash → hold → recovery → back-steps → idle) in a dark teal dungeon.

## Pages

- `index.html` — the flame-headed swordsman (Ember Revenant).
- `voxel.html` — the earth mage as a voxel puppet (see below).
- `mage.html` — an earth mage in a wide stepped hat, juggling floating rocks: idle → 3 steps → gather →
  slam the rocks into the floor (debris, dust, ground wave) → summon them back out of the floor → back-steps.
  Work in progress: built procedurally like the swordsman; a sprite-based version may replace it.

## Voxel earth mage (voxel.html)

The mage rebuilt voxel-musou style ([mike007jd/voxel-musou](https://github.com/mike007jd/voxel-musou), MIT): every
body part is sculpted in code from boxes in voxel units (1 voxel = 1 pixel of the 55×84 sprite, so proportions come
straight from it), colour given per voxel by a function (hat tiers and seams, pant folds, spiral leg wraps), meshed
once with only exposed faces + per-vertex ambient occlusion, and hung rigidly on its rig joint — no skinning.
The pants use half-size voxels so the balloon steps in finer terraces. Breathing idle with the hat a beat late,
planted feet by two-bone IK, a 12 s camera orbit.

- `src/voxel/vox.js` — box sculpting + exposed-face mesher with AO.
- `src/voxel/mage.js` — the mage's parts, rig and leg IK.
- `src/voxel/main.js` — scene, lights, floor, idle pose, camera; `?pixel=1` renders at ~180 rows with a nearest
  integer upscale (the voxel model as pixel art), `?az=<deg>` fixes the camera, `?t=<s>` freezes a frame.

## Earth mage sprite (assets/earth-mage)

- `earth_mage_55x84.png` — the mage as true 1:1 pixel art (55×84, 28 colours, transparent), recovered from an
  upscaled source by snapping to its ~15 px grid.
- `idle_sheet.png` — 24-frame breathing cycle (1x, transparent): the torso drops 1 px, the head follows a frame
  later, the hat two frames later, the magic hand holds steady. Whole-pixel moves only, no rotation.
- `idle.mp4` — 1920×1080, 8× nearest upscale, 6 s seamless loop (3 breaths, one blink).

- `run_source_8f.png` — the 8 hand-drawn run frames at 1:1 (recovered from a 4× upscale).
- `run_sheet.png` — the cleaned 8-frame run cycle (contact, down, passing, flight × 2): one canonical
  head + hat pasted on every frame at its eye (no hat size drift), second-row shins shortened to match,
  grounded frames on a common baseline, flight frames lifted.
- `run.mp4` — 1920×1080, 8× nearest upscale, 6 s seamless loop, running in place over a scrolling floor.

Regenerate with `python3 tools/mage_idle.py` and `python3 tools/mage_run.py` (needs Python 3 with numpy + Pillow, and ffmpeg with libx264).

## Run

```sh
npm install
npm run dev        # open the printed URL (http://localhost:5173/ or /mage.html)
npm run build      # static build in dist/
```

`?t=<seconds>` renders a single frozen frame of the loop (`window.__ready` is set once it is drawn).

## How it works

- `src/pose.js`: keyed poses, a world-planted foot schedule with leg IK and lagged cloth drivers.
  Every value is a pure function of loop time, so the loop is seamless and any frame can be reproduced.
- `src/character.js`: the procedural, faceted character hierarchy and its banded toon materials.
- `src/composite.js`: a low-res composite pass that draws the stone wall and floor, the 1 px contour,
  rims and seams, the procedural pixel flame head, embers and impact sparks, then quantizes the image to a
  fixed palette.
- `src/main.js`: renders into ~320×180 targets with an orthographic camera, builds the slash smear, and
  upscales with nearest filtering at an integer device-pixel scale.
