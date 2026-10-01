// Pose timeline: every channel is a pure function of loop time u in [0, LOOP).
export const LOOP = 8.0;
const TAU = Math.PI * 2;

// Body facing (radians around Y; 0 = facing the camera, +PI/2 = facing screen right).
export const YAW_IDLE = 0.24;
export const YAW_ACT = 0.5;
export const WALK_YAW = 0.86;   // travel direction (radians around Y)
export const ROOT_SCALE = 1.12;
export const X0 = -34;

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const wrap = (u) => ((u % LOOP) + LOOP) % LOOP;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

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
  // combat-ready stance: wide A-stance (front foot toward the facing), knees bent and bowed outward,
  // hips lowered, chest turned 3/4 and leaning in, near shoulder dropped (contrapposto with the pelvis)
  travel: 0, hipY: -2.6, yaw: 0.34, pRoll: -0.05,
  tPitch: 0.16, tYaw: 0.32, tRoll: 0.09,
  lFx: 14.0, lFz: 4.0, rFx: -12.5, rFz: -3.0, lLift: 0, rLift: 0, lToe: 0, rToe: 0,
  lSw: 0.62, rSw: 0.5, lFy: 0.05, rFy: -0.32,
  // sword arm (right, near camera): elbow bent, fist at the hip, blade angled forward-down and out
  rShF: -0.3, rShZ: -0.5, rEl: 0.93, rWr: -2.6, rWrZ: 0.15,
  // off arm (left): bent, the claw held out from the hip
  lShF: 0.25, lShZ: 0.62, lShY: 0, lEl: 0.9, lWr: 0.0,
  breath: 1, cam: 0, stream: 0, squash: 0,
};

const P = (o) => Object.assign({}, IDLE, o);

const FWD = 30;        // forward walk distance (travel units)
const LUNGE = 9;

// walking carriage: same held-blade arms as the stance, narrower plants, knees still bent and slightly bowed
const WALKPOSE = { yaw: YAW_ACT, tPitch: 0.15, tYaw: 0.12, tRoll: 0.05, pRoll: -0.02, hipY: -4.0, lSw: 0.35, rSw: 0.3, lFy: 0, rFy: -0.15, lFx: 11.5, rFx: -10.5 };
const READY = P(WALKPOSE);
const WALKEND = P(Object.assign({}, WALKPOSE, { travel: FWD, lFz: 4.5, rFz: -3.5 }));
// Sweep into the coil: the blade swings up sideways in the picture plane (tip back past horizontal) instead of
// rotating through the camera axis.
const SWEEP = P(Object.assign({}, WALKPOSE, {
  yaw: YAW_ACT + 0.03, travel: FWD - 1, hipY: -5, tPitch: 0.14, tYaw: -0.12, tRoll: 0.08, lFz: 4.5, rFz: -5, rFx: -9,
  rShF: -0.3, rShZ: -1.5, rEl: 0.93, rWr: -2.6, rWrZ: 0.15,
  lShF: 0.6, lShY: -0.4, lShZ: 0.6, lEl: 1.3, breath: 0.4,
}));
const SWEEP2 = P(Object.assign({}, SWEEP, {
  travel: FWD - 1.6, hipY: -6.2, tYaw: -0.22, tRoll: 0.08, rShF: 1.38, rShZ: -1.73, rEl: 0.29, rWr: -3.6, lShF: 0.95, lShY: -0.7, lShZ: 0.7, lEl: 1.6,
}));
// Coil: blade cocked up and back behind the near shoulder, clear of the flame; chest stays open to camera.
// Off arm tucks into a compact guard fist in front of the chest.
const ANTIC = P({
  yaw: YAW_ACT + 0.05, travel: FWD - 2, hipY: -7, tPitch: 0.16, tYaw: -0.3, tRoll: 0.08, pRoll: 0,
  lFz: 8, lFx: 8, rFz: -7, rFx: -8, lSw: 0.4, rSw: 0.35, lFy: 0, rFy: -0.3,
  rShF: 0.72, rShZ: -2.9, rEl: 0.19, rWr: -2.82, rWrZ: 0.1,
  lShF: 1.2, lShY: -0.9, lShZ: 0.75, lEl: 1.8, breath: 0.2,
});
// Deeper wind-up: lean back, more twist, blade further up and back so the arc passes above the fire.
const ANTIC2 = P(Object.assign({}, ANTIC, {
  hipY: -10, tPitch: 0.05, tYaw: -0.5, rShF: 0.22, rShZ: -2.64, rEl: 1.19, rWr: -3.02, rWrZ: 0.1,
  lShF: 1.25, lEl: 1.85, travel: FWD - 3, squash: 1,
}));
// Strike: chest stays open to camera (low twist, low pitch); the reach lives in the arm and the lunge.
// Off arm bends down and back as a counterbalance.
const SLASH = P({
  yaw: YAW_ACT - 0.08, travel: FWD + LUNGE, hipY: -9, tPitch: 0.22, tYaw: 0.12, tRoll: -0.08, pRoll: 0,
  lFz: 15, lFx: 8, rFz: -13, rFx: -8, lToe: 0, rToe: 0.25, lSw: 0.3, rSw: 0.3, lFy: 0, rFy: -0.3,
  rShF: 0.87, rShZ: 0.8, rEl: 0.18, rWr: -1.88, rWrZ: -1.0,
  lShF: -0.35, lShY: 0.2, lShZ: 0.5, lEl: 0.95, breath: 0.2, cam: 1, stream: 1,
});
// Follow-through hold: blade forward-down (about 30 deg below horizontal), tip clear of the front boot.
const FOLLOW = P(Object.assign({}, SLASH, { hipY: -10, tPitch: 0.25, tYaw: 0.10, rShF: 0.6, rShZ: 1.2, rEl: -0.1, rWr: -1.57, rWrZ: -1.0, lShF: -0.4, lEl: 1.05, cam: 0, stream: 1 }));
const RECOVER = P({
  yaw: YAW_ACT - 0.05, travel: FWD + 5, hipY: -4, tPitch: 0.15, tYaw: 0.15, tRoll: 0.04, pRoll: -0.03,
  lFz: 9, lFx: 8, rFz: -8, rFx: -7.5, lSw: 0.45, rSw: 0.4, rFy: -0.3,
  rShF: -0.2, rShZ: -0.45, rEl: 0.9, rWr: -2.5, rWrZ: 0.1,
  lShF: 0.2, lShZ: 0.6, lEl: 1.0, breath: 0.6, stream: 0.25,
});
const IDLE_R = P({ travel: FWD + 4 });
const BACKREADY = P(Object.assign({}, WALKPOSE, { yaw: YAW_ACT - 0.1, travel: FWD + 4, lFz: 3, rFz: -2.5 }));
const BACKEND = P(Object.assign({}, WALKPOSE, { yaw: YAW_ACT - 0.1, travel: 0, lFz: 3, rFz: -2.5 }));

// [time, pose, ease used from this key to the next]
const KEYS = [
  [0.00, IDLE, 'inout'],
  [1.40, IDLE, 'inout'],
  [1.65, READY, 'linear'],
  [2.95, WALKEND, 'inout'],
  [3.08, SWEEP, 'linear'],
  [3.17, SWEEP2, 'linear'],
  [3.25, ANTIC, 'inout'],
  [3.50, ANTIC2, 'out'],
  [3.60, SLASH, 'out'],
  [3.74, FOLLOW, 'linear'],
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

function keyPose(u, out = {}) {
  let i = 0;
  while (i < KEYS.length - 2 && u >= KEYS[i + 1][0]) i++;
  const [ta, pa, e] = KEYS[i];
  const [tb, pb] = KEYS[i + 1];
  const s = EASE[e](clamp((u - ta) / (tb - ta), 0, 1));
  for (let j = 0; j < CH.length; j++) { const c = CH[j]; out[c] = lerp(pa[c], pb[c], s); }
  return out;
}

// ---------- world-space foot plants ----------
const WSX = Math.sin(WALK_YAW), WSZ = Math.cos(WALK_YAW);
function rootXZ(travel) { return [X0 + travel * WSX, travel * WSZ]; }
// world (x,z) of a foot for the nominal pose at key time t
function footWorldAt(t, side) {
  const k = keyPose(t);
  const [rx, rz] = rootXZ(k.travel);
  const fx = k[side + 'Fx'] * ROOT_SCALE, fz = k[side + 'Fz'] * ROOT_SCALE;
  const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
  return [rx + fx * c + fz * s, rz - fx * s + fz * c];
}
function walkMid(w, side, from, to) {
  const d = (keyPose(w.t1).travel - keyPose(w.t0).travel) * 0.08;
  return [lerp(from[0], to[0], 0.5) + d * WSX, lerp(from[1], to[1], 0.5) + d * WSZ];
}

// Each foot: initial plant + list of steps {t0, t1, to:[x,z], h: lift}
function buildSchedule() {
  const S = { l: { start: footWorldAt(0, 'l'), steps: [] }, r: { start: footWorldAt(0, 'r'), steps: [] } };
  const last = (side) => { const st = S[side].steps; return st.length ? st[st.length - 1].to : S[side].start; };
  const step = (side, t0, t1, to, h = 4.5) => S[side].steps.push({ t0, t1, to, h, from: last(side) });
  const walk = (w, endKeyT) => {
    const A = w.first, B = A === 'l' ? 'r' : 'l';
    const dt = (w.t1 - w.t0) / w.n;
    const a1 = footWorldAt(endKeyT, A), b1 = footWorldAt(endKeyT, B);
    const am = walkMid(w, A, last(A), a1);
    const sw = 1 / 1.1; // swing completes at ~91% of the step window
    step(A, w.t0, w.t0 + dt * sw, am);
    step(B, w.t0 + dt, w.t0 + dt * (1 + sw), b1);
    step(A, w.t0 + 2 * dt, w.t0 + dt * (2 + sw), a1);
  };
  walk(WALKS[0], 2.95);
  // coil: rear foot slides back into a wide stance (low lift)
  step('r', 3.00, 3.26, footWorldAt(3.30, 'r'), 2.0);
  // lunge: front foot strikes forward with the slash
  step('l', 3.48, 3.60, footWorldAt(3.70, 'l'), 3.0);
  // recovery: front foot pulls back, then the rear foot gathers in
  step('l', 4.22, 4.55, footWorldAt(5.3, 'l'), 3.5);
  step('r', 4.55, 4.92, footWorldAt(5.3, 'r'), 3.5);
  // back steps end exactly on the idle plants (so the final turn does not slide the feet)
  walk(WALKS[1], 7.9);
  return S;
}
const SCHED = buildSchedule();

// foot state written into a reusable record (no per-call allocation)
function footState(side, u, st0) {
  const S = SCHED[side];
  let px = S.start[0], pz = S.start[1];
  st0.lift = 0; st0.toe = 0; st0.moving = 0;
  for (const st of S.steps) {
    if (u >= st.t1) { px = st.to[0]; pz = st.to[1]; continue; }
    if (u > st.t0) {
      const f = (u - st.t0) / (st.t1 - st.t0);
      const e = EASE.inout(f);
      px = lerp(st.from[0], st.to[0], e); pz = lerp(st.from[1], st.to[1], e);
      st0.lift = st.h * Math.sin(Math.PI * f);
      const dx = (st.to[0] - st.from[0]) * WSX + (st.to[1] - st.from[1]) * WSZ;
      st0.toe = -0.35 * Math.sin(Math.PI * f) * Math.sign(dx) * Math.min(1, Math.abs(dx) / 6);
      st0.moving = 1;
    }
    break;
  }
  st0.x = px; st0.z = pz;
  return st0;
}

const _ka = {}, _kb = {};
function applyWalk(o, u) {
  for (const w of WALKS) {
    if (u < w.t0 || u > w.t1) continue;
    const a = keyPose(w.t0, _ka), b = keyPose(w.t1, _kb);
    const n = w.n;
    const p = clamp((u - w.t0) / (w.t1 - w.t0), 0, 1) * n;
    const k = Math.min(n - 1, Math.floor(p));
    const f = p - k;
    const ef = EASE.inout(f);
    o.travel = a.travel + (b.travel - a.travel) * (k + ef) / n;
    const dir = Math.sign(b.travel - a.travel);
    // bob: low at contact, high at passing (about 4 art px of travel)
    const bob = Math.pow(Math.sin(Math.PI * f), 0.8);
    let off = -4.0 + 4.5 * bob;
    if (k === 0) off = lerp(0.3 * bob, off, sstep(0.0, 0.5, f));          // ease into the walk (no hip pop)
    if (k === n - 1) off = lerp(off, 0, sstep(0.5, 1.0, f));              // and out of it
    // how far into the walk (for blending the arm-swing posture in/out)
    const env = sstep(0, 0.35, p) * (1 - sstep(n - 0.35, n, p));
    o.hipY += off;
    o.walk = env; o.walkDir = dir;
    o.tPitch += 0.05 * dir;
    o.breath = 0.2;
  }
}

const _fl = {}, _fr = {};
// pose(u[, out]): all channels at loop time u. Pass `out` to reuse a record (no allocation).
export function pose(uRaw, out = {}) {
  const u = wrap(uRaw);
  const o = keyPose(u, out);
  o.walk = 0; o.walkDir = 0;
  applyWalk(o, u);
  // feet: world plants -> root-local targets
  const rx = X0 + o.travel * WSX, rz = o.travel * WSZ;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const fl = footState('l', u, _fl), fr = footState('r', u, _fr);
  let dx = (fl.x - rx) / ROOT_SCALE, dz = (fl.z - rz) / ROOT_SCALE;
  o.lFx = dx * c - dz * s; o.lFz = dx * s + dz * c; o.lLift = fl.lift; o.lToe += fl.toe;
  dx = (fr.x - rx) / ROOT_SCALE; dz = (fr.z - rz) / ROOT_SCALE;
  o.rFx = dx * c - dz * s; o.rFz = dx * s + dz * c; o.rLift = fr.lift; o.rToe += fr.toe;
  if (o.walk > 0) {
    // arms swing opposite to the legs (projected on the travel axis)
    const legDiff = clamp(((fl.x - fr.x) * WSX + (fl.z - fr.z) * WSZ) / (20 * ROOT_SCALE), -1, 1);
    const back = o.walkDir < 0;
    const w = o.walk;
    // sword arm swings at the hip (blade kept out at the side, never across the chest)
    const dSh = (back ? 0.36 : 0.45) * legDiff * w, dEl = 0.15 * Math.max(0, legDiff) * w;
    o.rShF += dSh;
    o.rEl += dEl;
    o.rShZ -= 0.25 * w;
    o.rWr -= (dSh + dEl) * 0.9;     // the blade keeps hanging at the hip instead of swinging across the chest
    o.lShF -= 1.2 * legDiff * w;
    o.lEl += 0.5 * Math.abs(legDiff) * w;
    o.tYaw += 0.2 * legDiff * w;
    o.tRoll += 0.04 * (fl.lift - fr.lift) / 4.5;
    o.pRoll += 0.03 * (fr.lift - fl.lift) / 4.5;
  }
  // breathing & idle drift (4 breaths per loop, all frequencies integer per loop)
  const br = Math.sin(TAU * 4 * u / LOOP);
  o.hipY += 0.4 * br * o.breath;
  o.tPitch += 0.025 * br * o.breath;
  o.rShZ -= 0.04 * br * o.breath;
  o.lShZ += 0.025 * br * o.breath;
  o.pRoll += 0.03 * Math.sin(TAU * 2 * u / LOOP + 0.7) * o.breath;
  o.tRoll += 0.02 * Math.sin(TAU * 2 * u / LOOP + 2.0) * o.breath;
  o.breathPhase = br;
  // the flame follows the breath a beat late (leans ~1 px on the inhale)
  o.breathLate = Math.sin(TAU * 4 * (u - 0.22) / LOOP) * o.breath;
  // coil glint: builds through the wind-up, peaks right before release, gone at the strike
  o.coil = sstep(3.33, 3.49, u) * (1 - sstep(3.497, 3.506, u));
  // impact flash (0..1) at the start of the strike
  o.flash = sstep(3.545, 3.56, u) * (1 - sstep(3.60, 3.625, u));
  return o;
}

// Strike smear: progress (0..1) of the slash arc. The arc is drawn as a designed crescent around the
// shoulder (from the coil tip direction, over the top of the fire, to the strike tip) like a 2D smear frame.
export const SWING_T0 = 3.50, SWING_T1 = 3.575;
export function swingProgress(uRaw) {
  const u = wrap(uRaw);
  if (u < SWING_T0) return 0;
  const x = clamp((u - SWING_T0) / (SWING_T1 - SWING_T0), 0, 1);
  return 1 - Math.pow(1 - x, 1.8);
}
// the blade mesh is replaced by the smear's leading edge while it sweeps
export const bladeHidden = (uRaw) => { const u = wrap(uRaw); return u > SWING_T0 + 0.006 && u < SWING_T1 + 0.004; };

// Numerical velocity of a few drive signals (used for cloth lag), pure in u.
const _da = {}, _db = {}, _drv = {};
export function drive(u) {
  const e = 1 / 60;
  const a = pose(u - e, _da), b = pose(u + e, _db);
  _drv.vTravel = (b.travel - a.travel) / (2 * e);
  _drv.vHip = (b.hipY - a.hipY) / (2 * e);
  _drv.vTwist = (b.tYaw - a.tYaw) / (2 * e);
  _drv.vPitch = (b.tPitch - a.tPitch) / (2 * e);
  _drv.vArm = (b.rShF - a.rShF) / (2 * e);
  _drv.stream = 0.5 * (a.stream + b.stream);
  return _drv;
}

// Deterministic hash noise helpers (pure functions)
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
