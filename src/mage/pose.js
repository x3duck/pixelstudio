// Earth mage pose timeline: every channel is a pure function of loop time u in [0, LOOP).
export const LOOP = 8.0;
const TAU = Math.PI * 2;

export const WALK_YAW = 1.15;   // travel direction (radians around Y; mostly screen-right)
export const ROOT_SCALE = 1.0;
export const X0 = -50;

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const wrap = (u) => ((u % LOOP) + LOOP) % LOOP;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const EASE = {
  linear: (t) => t,
  inout: (t) => t * t * (3 - 2 * t),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
};

// Channels. Distances in art pixels (world units), angles in radians.
// Arms are posed by IK: hand target relative to the shoulder in chest space (xH/yH/zH), an elbow pole
// direction (xP..), and the hand orientation in chest space as a finger direction (xF..) + palm normal (xN..).
// 'l' = the magic arm (screen right), 'r' = the hanging claw arm (screen left).
const IDLE = {
  travel: 0, hipY: -2.6, yaw: 0.3, pRoll: 0.06, tPitch: 0.06, tYaw: 0.14, tRoll: -0.06,
  lFx: 15.5, lFz: 2.0, rFx: -13.5, rFz: -2.0, lLift: 0, rLift: 0, lToe: 0, rToe: 0,
  lSw: 0.35, rSw: 0.4, lFy: 0.4, rFy: -0.35,
  // magic hand held out to the side, palm up under the floating rocks
  lHx: 24, lHy: -19, lHz: 7, lPx: 0.15, lPy: -1, lPz: -0.3, lFx_: 1, lFy_: 0.25, lFz_: 0.35, lNx: -0.2, lNy: 1, lNz: 0.1,
  // claw arm hanging, slightly bent, fingers splayed down
  rHx: -7, rHy: -30, rHz: 4, rPx: -0.4, rPy: 0, rPz: -1, rFx_: -0.15, rFy_: -1, rFz_: 0.25, rNx: 0.6, rNy: 0, rNz: 0.8,
  hPitch: 0.04, hYaw: 0.12, hRoll: 0.03,
  breath: 1, cam: 0, cast: 0, squash: 0,
};
const P = (o) => Object.assign({}, IDLE, o);

const FWD = 26;     // forward walk distance

// walking carriage: narrower plants, the magic hand stays up under the rocks
const WALKPOSE = { yaw: 0.62, tPitch: 0.09, tYaw: 0.05, tRoll: 0, pRoll: 0, hipY: -2.5, lFx: 10.5, rFx: -9.5, lSw: 0.1, rSw: 0.12, lFy: 0.15, rFy: -0.1,
  lHx: 20, lHy: -20, lHz: 8 };
const READY = P(WALKPOSE);
const WALKEND = P(Object.assign({}, WALKPOSE, { travel: FWD }));
// gather: the magic hand sweeps up overhead (palm up), the rocks cluster above it; the claw pulls back
const GATHER0 = P({
  travel: FWD, yaw: 0.42, hipY: -3, tPitch: 0.0, tYaw: -0.1, tRoll: 0.06, pRoll: 0.03,
  lHx: 24, lHy: -4, lHz: 3, lPx: 0.3, lPy: -1, lPz: -0.4, lFx_: 1, lFy_: 0.4, lFz_: 0.3, lNx: -0.3, lNy: 1, lNz: 0.1,
  rHx: -12, rHy: -24, rHz: -4, rPx: -0.6, rPy: 0, rPz: -0.8,
  hPitch: -0.08, cast: 0.6, breath: 0.4,
});
const GATHER = P(Object.assign({}, GATHER0, {
  hipY: -5.5, tPitch: -0.1, tYaw: -0.22, tRoll: 0.1,
  lHx: 30, lHy: 4, lHz: 0, lPx: 0.2, lPy: -1, lPz: -0.5, lFx_: 0.8, lFy_: 0.7, lFz_: 0.2, lNx: -0.5, lNy: 0.9, lNz: 0.1,
  rHx: -14, rHy: -22, rHz: -7,
  hPitch: -0.16, cast: 1, breath: 0.2,
}));
const GATHER2 = P(Object.assign({}, GATHER, { hipY: -7.5, tPitch: -0.15, tYaw: -0.3, lHx: 29, lHy: 7, lHz: -5, squash: 1, rHx: -15, rHz: -9 }));
// slam: the arm whips forward-down toward the target on the floor, body lunges, claw swings back
const SLAM = P({
  travel: FWD + 3, yaw: 0.5, hipY: -8, tPitch: 0.32, tYaw: 0.18, tRoll: -0.06, pRoll: -0.02,
  lFx: 16, lFz: 4, rFx: -13, rFz: -3, lSw: 0.3, rSw: 0.3, lFy: 0.2, rFy: -0.35,
  lHx: 26, lHy: -16, lHz: 14, lPx: 0.2, lPy: -1, lPz: -0.6, lFx_: 1, lFy_: -0.5, lFz_: 0.5, lNx: 0.1, lNy: -0.2, lNz: 1,
  rHx: -16, rHy: -18, rHz: -10, rPx: -0.5, rPy: 0.3, rPz: -1, rFx_: -0.6, rFy_: -0.7, rFz_: -0.3,
  hPitch: 0.16, hYaw: 0.2, cast: 1, cam: 1, breath: 0.2,
});
const SLAMHOLD = P(Object.assign({}, SLAM, { hipY: -7, tPitch: 0.26, cam: 0, cast: 0.5, rHx: -14, rHy: -22, rHz: -8 }));
// summon: palm turns up and lifts, calling the rocks back out of the floor
const SUMMON = P({
  travel: FWD + 3, yaw: 0.45, hipY: -4, tPitch: 0.1, tYaw: 0.1, tRoll: -0.02,
  lFx: 16, lFz: 4, rFx: -13, rFz: -3, lFy: 0.2, rFy: -0.35,
  lHx: 25, lHy: -24, lHz: 9, lPx: 0.3, lPy: -1, lPz: -0.4, lFx_: 1, lFy_: 0.2, lFz_: 0.4, lNx: -0.2, lNy: 1, lNz: 0.1,
  rHx: -8, rHy: -29, rHz: 2,
  hPitch: 0.12, hYaw: 0.18, cast: 1, breath: 0.4,
});
const SUMMON2 = P(Object.assign({}, SUMMON, { hipY: -2, tPitch: 0.04, lHx: 23, lHy: -15, lHz: 6, hPitch: 0.02, cast: 0.3, breath: 0.8 }));
const IDLE_R = P({ travel: FWD + 3 });
const BACKREADY = P(Object.assign({}, WALKPOSE, { yaw: 0.4, travel: FWD + 3, lHx: 22, lHy: -21, lHz: 6 }));
const BACKEND = P(Object.assign({}, WALKPOSE, { yaw: 0.4, travel: 0, lHx: 22, lHy: -21, lHz: 6 }));

// [time, pose, ease used from this key to the next]
const KEYS = [
  [0.00, IDLE, 'inout'],
  [1.40, IDLE, 'inout'],
  [1.65, READY, 'linear'],
  [2.95, WALKEND, 'inout'],
  [3.10, GATHER0, 'inout'],
  [3.38, GATHER, 'inout'],
  [3.50, GATHER2, 'out'],
  [3.60, SLAM, 'out'],
  [3.74, SLAMHOLD, 'linear'],
  [4.30, SLAMHOLD, 'inout'],
  [4.55, SUMMON, 'inout'],
  [5.10, SUMMON2, 'inout'],
  [5.45, IDLE_R, 'inout'],
  [5.70, IDLE_R, 'inout'],
  [5.90, BACKREADY, 'linear'],
  [7.10, BACKEND, 'out'],
  [7.55, IDLE, 'linear'],
  [8.00, IDLE, 'linear'],
];

const WALKS = [
  { t0: 1.65, t1: 2.95, n: 3, first: 'l', bob: 3.5 },
  { t0: 5.90, t1: 7.10, n: 3, first: 'r', bob: 3.5 },
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
export const WSX = Math.sin(WALK_YAW), WSZ = Math.cos(WALK_YAW);
function footWorldAt(t, side) {
  const k = keyPose(t);
  const rx = X0 + k.travel * WSX, rz = k.travel * WSZ;
  const fx = k[side + 'Fx'] * ROOT_SCALE, fz = k[side + 'Fz'] * ROOT_SCALE;
  const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
  return [rx + fx * c + fz * s, rz - fx * s + fz * c];
}
function walkMid(w, from, to) {
  const d = (keyPose(w.t1).travel - keyPose(w.t0).travel) * 0.08;
  return [lerp(from[0], to[0], 0.5) + d * WSX, lerp(from[1], to[1], 0.5) + d * WSZ];
}

function buildSchedule() {
  const S = { l: { start: footWorldAt(0, 'l'), steps: [] }, r: { start: footWorldAt(0, 'r'), steps: [] } };
  const last = (side) => { const st = S[side].steps; return st.length ? st[st.length - 1].to : S[side].start; };
  const step = (side, t0, t1, to, h = 4.0, toe = 0.3) => S[side].steps.push({ t0, t1, to, h, toe, from: last(side) });
  const walk = (w, endKeyT, h = 4.0, toe = 0.3) => {
    const A = w.first, B = A === 'l' ? 'r' : 'l';
    const dt = (w.t1 - w.t0) / w.n;
    const a1 = footWorldAt(endKeyT, A), b1 = footWorldAt(endKeyT, B);
    const am = walkMid(w, last(A), a1);
    const sw = 1 / 1.1;
    step(A, w.t0, w.t0 + dt * sw, am, h, toe);
    step(B, w.t0 + dt, w.t0 + dt * (1 + sw), b1, h, toe);
    step(A, w.t0 + 2 * dt, w.t0 + dt * (2 + sw), a1, h, toe);
  };
  walk(WALKS[0], 2.95);
  // gather: the stance widens (rear foot slides back)
  step('r', 3.02, 3.30, footWorldAt(3.40, 'r'), 2.0);
  // slam: front foot stamps forward with the throw
  step('l', 3.47, 3.58, footWorldAt(3.70, 'l'), 3.5);
  // after the summon the feet gather back into the idle stance
  step('r', 5.12, 5.38, footWorldAt(5.6, 'r'), 3.0);
  step('l', 5.30, 5.52, footWorldAt(5.6, 'l'), 3.0);
  walk(WALKS[1], 7.9, 4.0, 0.35);
  return S;
}
const SCHED = buildSchedule();

function footState(side, u, st0) {
  const S = SCHED[side];
  let px = S.start[0], pz = S.start[1];
  st0.lift = 0; st0.toe = 0;
  for (const st of S.steps) {
    if (u >= st.t1) { px = st.to[0]; pz = st.to[1]; continue; }
    if (u > st.t0) {
      const f = (u - st.t0) / (st.t1 - st.t0);
      const e = EASE.inout(f);
      px = lerp(st.from[0], st.to[0], e); pz = lerp(st.from[1], st.to[1], e);
      st0.lift = st.h * Math.sin(Math.PI * f);
      const dx = (st.to[0] - st.from[0]) * WSX + (st.to[1] - st.from[1]) * WSZ;
      st0.toe = -st.toe * Math.sin(Math.PI * f) * Math.sign(dx) * Math.min(1, Math.abs(dx) / 6);
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
    o.travel = a.travel + (b.travel - a.travel) * (k + EASE.inout(f)) / n;
    const bob = Math.pow(Math.sin(Math.PI * f), 0.8);
    let off = -3.0 + w.bob * bob;
    if (k === 0) off = lerp(0.3 * bob, off, sstep(0.0, 0.5, f));
    if (k === n - 1) off = lerp(off, 0, sstep(0.5, 1.0, f));
    o.hipY += off;
    o.walk = sstep(0, 0.35, p) * (1 - sstep(n - 0.35, n, p));
    o.walkDir = Math.sign(b.travel - a.travel);
  }
  // walk-only posture blended smoothly at the boundaries (no pops)
  for (const w of WALKS) {
    const envB = sstep(w.t0 - 0.1, w.t0 + 0.1, u) * (1 - sstep(w.t1 - 0.1, w.t1 + 0.1, u));
    if (envB <= 0) continue;
    o.breath = lerp(o.breath, 0.25, envB);
  }
}

const _fl = {}, _fr = {};
export function pose(uRaw, out = {}) {
  const u = wrap(uRaw);
  const o = keyPose(u, out);
  o.walk = 0; o.walkDir = 0;
  applyWalk(o, u);
  const rx = X0 + o.travel * WSX, rz = o.travel * WSZ;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const fl = footState('l', u, _fl), fr = footState('r', u, _fr);
  let dx = (fl.x - rx) / ROOT_SCALE, dz = (fl.z - rz) / ROOT_SCALE;
  o.lFx = dx * c - dz * s; o.lFz = dx * s + dz * c; o.lLift = fl.lift; o.lToe += fl.toe;
  dx = (fr.x - rx) / ROOT_SCALE; dz = (fr.z - rz) / ROOT_SCALE;
  o.rFx = dx * c - dz * s; o.rFz = dx * s + dz * c; o.rLift = fr.lift; o.rToe += fr.toe;
  if (o.walk > 0) {
    const legDiff = clamp(((fl.x - fr.x) * WSX + (fl.z - fr.z) * WSZ) / 20, -1, 1);
    const w = o.walk;
    // the claw arm swings opposite the legs; the magic hand only sways (it carries the rocks)
    o.rHz += 9 * legDiff * w * o.walkDir;
    o.rHy += 2 * Math.abs(legDiff) * w;
    o.lHz -= 2.5 * legDiff * w * o.walkDir;
    o.lHy += 1.5 * Math.abs(legDiff) * w;
    o.tYaw += 0.12 * legDiff * w;
    o.tRoll += 0.03 * (fl.lift - fr.lift) / 4;
    o.pRoll += 0.03 * (fr.lift - fl.lift) / 4;
  }
  // breathing (4 breaths per loop; all frequencies integer per loop)
  const br = Math.sin(TAU * 4 * u / LOOP);
  o.hipY += 0.7 * br * o.breath;
  o.tPitch += 0.03 * br * o.breath;
  o.lHy += 0.8 * br * o.breath;
  o.hPitch -= 0.03 * br * o.breath;
  o.pRoll += 0.025 * Math.sin(TAU * 2 * u / LOOP + 0.7) * o.breath;
  o.breathPhase = br;
  return o;
}

// Numerical velocity of a few drive signals (cloth / hat lag), pure in u.
const _da = {}, _db = {}, _drv = {};
export function drive(u) {
  const e = 1 / 60;
  const a = pose(u - e, _da), b = pose(u + e, _db);
  _drv.vTravel = (b.travel - a.travel) / (2 * e);
  _drv.vHip = (b.hipY - a.hipY) / (2 * e);
  _drv.vTwist = (b.tYaw - a.tYaw) / (2 * e);
  _drv.vPitch = (b.tPitch - a.tPitch) / (2 * e);
  return _drv;
}

// ---------- the rocks' timeline (pure in u) ----------
export const LAUNCH = [3.53, 3.565, 3.60];   // each rock leaves the gather cluster
export const FLIGHT = 0.1;                    // seconds to the floor
export const SUMMON_T = [4.48, 4.56, 4.64];   // each rock starts rising out of the floor
export const RISE = 0.5;                      // seconds back up to the hand
export const blink = (u) => (u > 0.92 && u < 0.99) || (u > 5.52 && u < 5.59) || (u > 7.3 && u < 7.36);
