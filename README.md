# Pixel Wraith

A small Three.js demo: an original flame-headed swordsman in the visual language of Dead Cells,
rendered as genuine pixel art and playing an 8-second seamless loop (idle → 3 steps → coil →
whip slash → hold → recovery → back-steps → idle) in a dark teal dungeon.

## Run

```sh
npm install
npm run dev        # open the printed URL (http://localhost:5173/)
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
