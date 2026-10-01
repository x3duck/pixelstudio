// Pose timeline: every channel is a pure function of loop time u in [0, LOOP).
export const LOOP = 8.0;
const TAU = Math.PI * 2;

export const YAW_IDLE = 0.52;
export const YAW_ACT = 0.86;
export const WALK_YAW = 0.86;   // travel direction (radians around Y)

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const wrap = (u) => ((u % LOOP) + LOOP) % LOOP;
const lerp = (a, b, t) => a + (b - a) * t;

const EASE = {
  linear: (t) => t,
  inout: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  inBack: (t) => { const c = 1.4; return (c + 1) * t * t * t - c * t * t; },
};

// Channels. Angles in radians, distances in art pixels (world units).
const IDLE = {
  travel: 0, hipY: -1.5, yaw: YAW_IDLE, pRoll: 0.0,
  tPitch: 0.1, tYaw: 0.0, tRoll: 0.0,
  lFx: 10.5, lFz: 3, rFx: -10, rFz: -2.5, lLift: 0, rLift: 0, lToe: 0, rToe: 0,
  // sword arm (right, near camera)
  rShF: 0.18, rShZ: -0.55, rEl: 0.55, rWr: -1.75, rWrZ: 0.15,
  // off arm (left)
  lShF: 0.1, lShZ: 0.5, lEl: 0.55, lWr: 0.0,
  breath: 1, cam: 0, fxBoost: 0,
};

const P = (o) => Object.assign({}, IDLE, o);

const FWD = 30;        // forward walk distance (travel units)
const LUNGE = 7;

const READY = P({ yaw: YAW_ACT, tPitch: 0.12, hipY: -1, rShF: 0.3, lShF: 0.15 });
const WALKEND = P({ yaw: YAW_ACT, travel: FWD, tPitch: 0.12, hipY: -1, lFz: 4, rFz: -3, rShF: 0.3, lShF: 0.15 });
const ANTIC = P({
  yaw: YAW_ACT + 0.08, travel: FWD - 2, hipY: -7, tPitch: 0.30, tYaw: -0.62, tRoll: 0.06,
  lFz: 8, lFx: 8, rFz: -7, rFx: -8,
  rShF: 2.35, rShZ: -0.6, rEl: 1.25, rWr: -1.15, rWrZ: 0.25,
  lShF: 1.15, lShZ: 0.55, lEl: 0.35, breath: 0.2,
});
const ANTIC2 = P(Object.assign({}, ANTIC, { hipY: -8, tYaw: -0.72, rShF: 2.5, rEl: 1.3, rWr: -1.05, lShF: 1.25, travel: FWD - 2.5 }));
const SLASH = P({
  yaw: YAW_ACT + 0.04, travel: FWD + LUNGE, hipY: -9, tPitch: 0.42, tYaw: 0.62, tRoll: -0.08,
  lFz: 15, lFx: 8, rFz: -13, rFx: -8, lToe: 0, rToe: 0.25,
  rShF: 0.55, rShZ: -0.15, rEl: 0.05, rWr: -1.35, rWrZ: -0.25,
  lShF: -0.75, lShZ: 0.75, lEl: 0.6, breath: 0.2, cam: 1, fxBoost: 1,
});
const FOLLOW = P(Object.assign({}, SLASH, { hipY: -10, tPitch: 0.46, tYaw: 0.68, rShF: 0.45, rWr: -1.5, lShF: -0.85, cam: 0, fxBoost: 0.4 }));
const RECOVER = P({
  yaw: YAW_ACT, travel: FWD + 5, hipY: -3, tPitch: 0.16, tYaw: 0.15,
  lFz: 9, lFx: 8, rFz: -8, rFx: -7.5,
  rShF: 0.35, rShZ: -0.45, rEl: 0.6, rWr: -1.6, rWrZ: 0.1,
  lShF: 0.1, lShZ: 0.4, lEl: 0.5, breath: 0.6,
});
const IDLE_R = P({ travel: FWD + 4, lFz: 3, rFz: -2.5 });
const BACKREADY = P({ yaw: YAW_ACT - 0.1, travel: FWD + 4, tPitch: 0.1, hipY: -1.5, rShF: 0.35, lShF: 0.2, lFz: 3, rFz: -2.5 });
const BACKEND = P({ yaw: YAW_ACT - 0.1, travel: 0, tPitch: 0.1, hipY: -1.5, rShF: 0.35, lShF: 0.2, lFz: 3, rFz: -2.5 });

// [time, pose, ease used from this key to the next]
const KEYS = [
  [0.00, IDLE, 'inout'],
  [1.40, IDLE, 'inout'],
  [1.65, READY, 'linear'],
  [2.95, WALKEND, 'out'],
  [3.38, ANTIC, 'inout'],
  [3.52, ANTIC2, 'outQuart'],
  [3.64, SLASH, 'out'],
  [3.78, FOLLOW, 'linear'],
  [4.20, FOLLOW, 'inout'],
  [4.75, RECOVER, 'inout'],
  [5.20, IDLE_R, 'inout'],
  [5.70, IDLE_R, 'inout'],
  [5.90, BACKREADY, 'linear'],
  [7.10, BACKEND, 'out'],
  [7.55, IDLE, 'linear'],
  [8.00, IDLE, 'linear'],
];

const WALKS = [
  // start, end, steps, first leg ('l'|'r')
  { t0: 1.65, t1: 2.95, n: 3, first: 'r' },
  { t0: 5.90, t1: 7.10, n: 3, first: 'r' },
];

const CH = Object.keys(IDLE);

function keyPose(u) {
  let i = 0;
  while (i < KEYS.length - 2 && u >= KEYS[i + 1][0]) i++;
  const [ta, pa, e] = KEYS[i];
  const [tb, pb] = KEYS[i + 1];
  const s = EASE[e](clamp((u - ta) / (tb - ta), 0, 1));
  const out = {};
  for (const c of CH) out[c] = lerp(pa[c], pb[c], s);
  return out;
}

function applyWalk(o, u) {
  for (const w of WALKS) {
    if (u < w.t0 || u > w.t1) continue;
    const a = keyPose(w.t0), b = keyPose(w.t1);
    const n = w.n;
    const p = clamp((u - w.t0) / (w.t1 - w.t0), 0, 1) * n;
    const k = Math.min(n - 1, Math.floor(p));
    const f = p - k;
    const ef = EASE.inout(f);
    const sA = a.travel, sB = b.travel;
    o.travel = sA + (sB - sA) * (k + ef) / n;
    // world plants for each leg along travel axis
    const legs = { l: { s0: sA + a.lFz, s1: sB + b.lFz }, r: { s0: sA + a.rFz, s1: sB + b.rFz } };
    const A = w.first, B = A === 'l' ? 'r' : 'l';
    // A steps on 0 and 2, B steps on 1 (n = 3)
    const Amid = lerp(legs[A].s0, legs[A].s1, 0.5) + (sB - sA) * 0.08;
    const plant = { l: 0, r: 0 }, lift = { l: 0, r: 0 }, toe = { l: 0, r: 0 };
    const swing = (from, to) => lerp(from, to, EASE.inout(clamp(f * 1.1, 0, 1)));
    if (k === 0) { plant[A] = swing(legs[A].s0, Amid); lift[A] = Math.sin(Math.PI * f); plant[B] = legs[B].s0; }
    else if (k === 1) { plant[A] = Amid; plant[B] = swing(legs[B].s0, legs[B].s1); lift[B] = Math.sin(Math.PI * f); }
    else { plant[A] = swing(Amid, legs[A].s1); lift[A] = Math.sin(Math.PI * f); plant[B] = legs[B].s1; }
    o.lFz = plant.l - o.travel; o.rFz = plant.r - o.travel;
    const dir = Math.sign(sB - sA);
    o.lLift = 4.5 * lift.l; o.rLift = 4.5 * lift.r;
    o.lToe = -0.35 * lift.l * dir; o.rToe = -0.35 * lift.r * dir;
    // bob: high at mid-swing, low at plant
    const bob = Math.pow(Math.sin(Math.PI * f), 0.7);
    o.hipY += -1.5 + 3.0 * bob;
    // arm swing opposite to legs
    const legDiff = (o.lFz - o.rFz) / 20;
    o.rShF += 0.45 * legDiff;
    o.lShF -= 0.55 * legDiff;
    o.tYaw += 0.12 * legDiff;
    o.tRoll += 0.04 * (lift.l - lift.r);
    o.tPitch += 0.05 * dir;
    o.breath = 0.2;
  }
}

export function pose(uRaw) {
  const u = wrap(uRaw);
  const o = keyPose(u);
  applyWalk(o, u);
  // breathing & idle drift (4 breaths per loop, all frequencies integer per loop)
  const br = Math.sin(TAU * 4 * u / LOOP);
  o.hipY += 0.7 * br * o.breath;
  o.tPitch += 0.025 * br * o.breath;
  o.rShZ -= 0.04 * br * o.breath;
  o.lShZ += 0.05 * br * o.breath;
  o.pRoll += 0.03 * Math.sin(TAU * 2 * u / LOOP + 0.7) * o.breath;
  o.tRoll += 0.02 * Math.sin(TAU * 2 * u / LOOP + 2.0) * o.breath;
  o.breathPhase = br;
  return o;
}

// Numerical velocity of a few drive signals (used for cloth lag), pure in u.
export function drive(u) {
  const e = 1 / 60;
  const a = pose(u - e), b = pose(u + e);
  return {
    vTravel: (b.travel - a.travel) / (2 * e),
    vHip: (b.hipY - a.hipY) / (2 * e),
    vTwist: (b.tYaw - a.tYaw) / (2 * e),
    vPitch: (b.tPitch - a.tPitch) / (2 * e),
    vArm: (b.rShF - a.rShF) / (2 * e),
  };
}

// Deterministic hash noise helpers (pure functions)
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
