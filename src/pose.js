// Pose timeline: every channel is a pure function of loop time u in [0, LOOP).
export const LOOP = 8.0;
const TAU = Math.PI * 2;

// Body facing (radians around Y; 0 = facing the camera, +PI/2 = facing screen right).
export const YAW_IDLE = 0.24;
export const YAW_ACT = 0.5;
export const WALK_YAW = 0.86;   // travel direction (radians around Y)
export const ROOT_SCALE = 1.15;
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
  travel: 0, hipY: -1.5, yaw: YAW_IDLE, pRoll: 0.0,
  tPitch: 0.1, tYaw: 0.0, tRoll: 0.0,
  lFx: 8.8, lFz: 3, rFx: -8.3, rFz: -2.5, lLift: 0, rLift: 0, lToe: 0, rToe: 0,
  // sword arm (right, near camera)
  rShF: 0.18, rShZ: -0.62, rEl: 0.55, rWr: -1.75, rWrZ: 0.15,
  // off arm (left)
  lShF: 0.1, lShZ: 0.55, lEl: 0.5, lWr: 0.0,
  breath: 1, cam: 0, fxBoost: 0, stream: 0, coil: 0,
};

const P = (o) => Object.assign({}, IDLE, o);

const FWD = 30;        // forward walk distance (travel units)
const LUNGE = 7;

const READY = P({ yaw: YAW_ACT, tPitch: 0.12, hipY: -2, rShF: 0.3, lShF: 0.15 });
const WALKEND = P({ yaw: YAW_ACT, travel: FWD, tPitch: 0.12, hipY: -2, lFz: 4, rFz: -3, rShF: 0.3, lShF: 0.15 });
// Coil: blade cocked up and back behind the near shoulder, clear of the flame; chest stays open to camera.
const ANTIC = P({
  yaw: YAW_ACT + 0.05, travel: FWD - 2, hipY: -7, tPitch: 0.22, tYaw: -0.3, tRoll: 0.08,
  lFz: 8, lFx: 8, rFz: -7, rFx: -8,
  rShF: 1.95, rShZ: 0.22, rEl: 0.45, rWr: 0.3, rWrZ: 0.7,
  lShF: 0.95, lShZ: 0.6, lEl: 0.9, breath: 0.2, coil: 0.7,
});
const ANTIC2 = P(Object.assign({}, ANTIC, { hipY: -8, tYaw: -0.36, rShF: 2.18, rShZ: 0.34, rEl: 0.24, rWr: 0.49, rWrZ: 0.83, lShF: 1.05, travel: FWD - 2.5, coil: 1 }));
// Strike: torso twist reduced (0.35), the extension lives in the arm.
const SLASH = P({
  yaw: YAW_ACT + 0.04, travel: FWD + LUNGE, hipY: -9, tPitch: 0.36, tYaw: 0.35, tRoll: -0.08,
  lFz: 15, lFx: 8, rFz: -13, rFx: -8, lToe: 0, rToe: 0.25,
  rShF: 0.95, rShZ: -0.05, rEl: -0.05, rWr: -1.45, rWrZ: -0.3,
  lShF: -0.95, lShZ: 0.8, lEl: 0.7, breath: 0.2, cam: 1, fxBoost: 1, stream: 1,
});
const FOLLOW = P(Object.assign({}, SLASH, { hipY: -10, tPitch: 0.4, tYaw: 0.38, rShF: 0.72, rEl: 0.05, rWr: -1.6, lShF: -1.0, cam: 0, fxBoost: 0.4, stream: 1 }));
const RECOVER = P({
  yaw: YAW_ACT - 0.05, travel: FWD + 5, hipY: -3, tPitch: 0.14, tYaw: 0.05,
  lFz: 9, lFx: 8, rFz: -8, rFx: -7.5,
  rShF: 0.35, rShZ: -0.45, rEl: 0.6, rWr: -1.6, rWrZ: 0.1,
  lShF: 0.1, lShZ: 0.4, lEl: 0.5, breath: 0.6, stream: 0.25,
});
const IDLE_R = P({ travel: FWD + 4, lFz: 3, rFz: -2.5 });
const BACKREADY = P({ yaw: YAW_ACT - 0.1, travel: FWD + 4, tPitch: 0.1, hipY: -2.3, rShF: 0.35, lShF: 0.2, lFz: 3, rFz: -2.5 });
const BACKEND = P({ yaw: YAW_ACT - 0.1, travel: 0, tPitch: 0.1, hipY: -2.3, rShF: 0.35, lShF: 0.2, lFz: 3, rFz: -2.5 });

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
  step('r', 3.02, 3.32, footWorldAt(3.40, 'r'), 2.0);
  // lunge: front foot strikes forward with the slash
  step('l', 3.50, 3.63, footWorldAt(3.70, 'l'), 3.0);
  // recovery: front foot pulls back, then the rear foot gathers in
  step('l', 4.22, 4.55, footWorldAt(5.3, 'l'), 3.5);
  step('r', 4.55, 4.92, footWorldAt(5.3, 'r'), 3.5);
  // back steps end exactly on the idle plants (so the final turn does not slide the feet)
  walk(WALKS[1], 7.9);
  return S;
}
const SCHED = buildSchedule();

function footState(side, u) {
  const S = SCHED[side];
  let pos = S.start, lift = 0, toe = 0, moving = 0;
  for (const st of S.steps) {
    if (u >= st.t1) { pos = st.to; continue; }
    if (u > st.t0) {
      const f = (u - st.t0) / (st.t1 - st.t0);
      const e = EASE.inout(f);
      pos = [lerp(st.from[0], st.to[0], e), lerp(st.from[1], st.to[1], e)];
      lift = st.h * Math.sin(Math.PI * f);
      const dx = (st.to[0] - st.from[0]) * WSX + (st.to[1] - st.from[1]) * WSZ;
      toe = -0.35 * Math.sin(Math.PI * f) * Math.sign(dx) * Math.min(1, Math.abs(dx) / 6);
      moving = 1;
    }
    break;
  }
  return { pos, lift, toe, moving };
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
    o.travel = a.travel + (b.travel - a.travel) * (k + ef) / n;
    const dir = Math.sign(b.travel - a.travel);
    // bob: low at contact, high at passing (about 4 art px of travel)
    const bob = Math.pow(Math.sin(Math.PI * f), 0.8);
    let off = -3.6 + 3.9 * bob;
    if (k === 0) off = lerp(0.3 * bob, off, sstep(0.0, 0.5, f));          // ease into the walk (no hip pop)
    if (k === n - 1) off = lerp(off, 0, sstep(0.5, 1.0, f));              // and out of it
    o.hipY += off;
    o.walk = 1; o.walkDir = dir;
    o.tPitch += 0.05 * dir;
    o.breath = 0.2;
  }
}

export function pose(uRaw) {
  const u = wrap(uRaw);
  const o = keyPose(u);
  o.walk = 0; o.walkDir = 0;
  applyWalk(o, u);
  // feet: world plants -> root-local targets
  const [rx, rz] = rootXZ(o.travel);
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const fw = {};
  for (const side of ['l', 'r']) {
    const st = footState(side, u);
    fw[side] = st;
    const dx = (st.pos[0] - rx) / ROOT_SCALE, dz = (st.pos[1] - rz) / ROOT_SCALE;
    o[side + 'Fx'] = dx * c - dz * s;
    o[side + 'Fz'] = dx * s + dz * c;
    o[side + 'Lift'] = st.lift;
    o[side + 'Toe'] += st.toe;
  }
  if (o.walk) {
    // arms swing opposite to the legs (projected on the travel axis)
    const legDiff = clamp(((fw.l.pos[0] - fw.r.pos[0]) * WSX + (fw.l.pos[1] - fw.r.pos[1]) * WSZ) / (20 * ROOT_SCALE), -1, 1);
    o.rShF += 0.62 * legDiff;
    o.rEl += 0.2 * Math.max(0, legDiff);
    o.lShF -= 0.85 * legDiff;
    o.lEl += 0.35 * Math.max(0, -legDiff);
    o.tYaw += 0.14 * legDiff;
    o.tRoll += 0.04 * (fw.l.lift - fw.r.lift) / 4.5;
    o.pRoll += 0.03 * (fw.r.lift - fw.l.lift) / 4.5;
  }
  // breathing & idle drift (4 breaths per loop, all frequencies integer per loop)
  const br = Math.sin(TAU * 4 * u / LOOP);
  o.hipY += 0.7 * br * o.breath;
  o.tPitch += 0.025 * br * o.breath;
  o.rShZ -= 0.04 * br * o.breath;
  o.lShZ += 0.05 * br * o.breath;
  o.pRoll += 0.03 * Math.sin(TAU * 2 * u / LOOP + 0.7) * o.breath;
  o.tRoll += 0.02 * Math.sin(TAU * 2 * u / LOOP + 2.0) * o.breath;
  o.breathPhase = br;
  // impact flash (0..1) at the start of the strike
  o.flash = sstep(3.545, 3.565, u) * (1 - sstep(3.60, 3.625, u));
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
    stream: 0.5 * (a.stream + b.stream),
  };
}

// Deterministic hash noise helpers (pure functions)
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
