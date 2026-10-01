import * as THREE from 'three';
import { pose, drive, LOOP, WALK_YAW, X0, ROOT_SCALE, clamp } from './pose.js';

// Must run before any THREE.Color is created (ES imports are hoisted above main.js code).
THREE.ColorManagement.enabled = false;

const TAU = Math.PI * 2;

// ---------- shared uniforms for all toon materials ----------
export const toonShared = {
  uKey: { value: new THREE.Vector3(0.5, 0.8, 0.38).normalize() },   // key light from the upper right (the rocks' side)
  uPelvis: { value: new THREE.Vector3() },
};

const toonVert = /* glsl */`
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vO = position;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const toonFrag = /* glsl */`
uniform vec3 uBase; uniform vec3 uShade; uniform vec3 uLite; uniform vec3 uDeep;
uniform float uId; uniform float uBias;
uniform vec3 uKey;
uniform float uFold; uniform float uFoldK; uniform float uOcc; uniform vec3 uPelvis;
varying vec3 vN; varying vec3 vW; varying vec3 vO;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = dot(n, uKey) + uBias;
  // band index: 0 deep, 1 shade, 2 base, 3 lite
  float b = d > 0.6 ? 3.0 : (d > 0.12 ? 2.0 : (d > -0.35 ? 1.0 : 0.0));
  if (uOcc > 0.5) {
    // inner thighs fall into shadow
    vec2 tp = uPelvis.xz - vW.xz;
    float inner = dot(normalize(n.xz + vec2(1e-4)), normalize(tp + vec2(1e-4))) * step(0.25, length(n.xz));
    if (inner > 0.55 && vW.y > uPelvis.y - 26.0) b = min(b, 1.0);
  }
  if (uFold > 0.5) {
    // cloth folds: stepped creases from the lathe angle + a slow wobble along the leg
    float a = atan(vO.x, vO.z);
    float f = fract(a * uFoldK / 6.2832 + 0.1 * sin(vO.y * 0.27 + a * 2.0) + 0.06 * sin(vO.y * 0.71 + 1.7));
    if (f < 0.16 && b > 0.5) b -= 1.0;
    else if (f > 0.52 && f < 0.64 && b > 1.5) b += 1.0;
  }
  b = clamp(b, 0.0, 3.0);
  vec3 c = b > 2.5 ? uLite : (b > 1.5 ? uBase : (b > 0.5 ? uShade : uDeep));
  // alpha carries the material id + a 'faces up' bit for the composite (edge lines, rim rules)
  float up = n.y > 0.3 ? 1.0 : 0.0;
  gl_FragColor = vec4(c, (uId * 2.0 + up + 4.0) / 64.0);
}`;

function hex(h) { return new THREE.Color(h); }
// Material ids (must match the composite): 6 = rock (clipped below the floor)
function toon(id, base, opt = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: toonVert, fragmentShader: toonFrag,
    uniforms: {
      uBase: { value: hex(base) }, uShade: { value: hex(opt.shade) }, uLite: { value: hex(opt.lite) }, uDeep: { value: hex(opt.deep) },
      uId: { value: id }, uBias: { value: opt.bias ?? 0 },
      uFold: { value: opt.fold ?? 0 }, uFoldK: { value: opt.foldK ?? 3 }, uOcc: { value: opt.occ ? 1 : 0 },
      ...toonShared,
    },
    side: THREE.DoubleSide,
  });
}

// ---------- palette of materials (sampled from the reference sheet) ----------
const M = {
  skin: toon(0, '#2e1d27', { lite: '#45303b', shade: '#20141c', deep: '#150c12' }),
  face: toon(1, '#22141d', { lite: '#2f1d29', shade: '#1a0f16', deep: '#120a0f' }),
  hat: toon(2, '#a8402c', { lite: '#c85a38', shade: '#7a2c20', deep: '#3c1614', bias: 0.05 }),
  gold: toon(3, '#c17b2c', { lite: '#e2a446', shade: '#8a5420', deep: '#55321a', bias: 0.05 }),
  cream: toon(4, '#d4bf98', { lite: '#efdcb6', shade: '#a68c68', deep: '#725b41', fold: 1, foldK: 3, occ: true }),
  sash: toon(5, '#e6d4ae', { lite: '#f4e6c6', shade: '#b8a07c', deep: '#7c6648' }),
  green: toon(7, '#354a3e', { lite: '#4b6a55', shade: '#24342b', deep: '#17211c' }),
  rock: toon(6, '#8a6244', { lite: '#b3825a', shade: '#664433', deep: '#432b20', bias: 0.04 }),
  sole: toon(8, '#1a1014', { lite: '#2a1c22', shade: '#120a0e', deep: '#0c070a' }),
  shirt: toon(9, '#1d1419', { lite: '#2b1f26', shade: '#150e12', deep: '#0e090c' }),
};

// ---------- geometry helpers (all flat shaded) ----------
function flat(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return ng;
}
function tbox(w, h, d, { tx = 1, tz = 1, pivot = 'center', shiftTopZ = 0, shiftTopX = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * tx + shiftTopX);
      p.setZ(i, p.getZ(i) * tz + shiftTopZ);
    }
  }
  if (pivot === 'top') g.translate(0, -h / 2, 0);
  if (pivot === 'bottom') g.translate(0, h / 2, 0);
  return flat(g);
}
function lathe(profile, segs = 7, phase = 0) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y));
  return flat(new THREE.LatheGeometry(pts, segs, phase));
}
function extrude(pts, depth) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.lineTo(pts[0][0], pts[0][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return flat(g);
}
function mesh(geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scl);
  parent.add(m);
  return m;
}
function group(parent, pos = [0, 0, 0], name = '') {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...pos);
  parent.add(g);
  return g;
}
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// cloth strip chain (each segment pivots at its top); the last segment gets a notched end
function clothChain(parent, pos, segs, mat, thick = 1.0) {
  const out = [];
  let p = group(parent, pos);
  p.rotation.order = 'ZXY';
  for (let i = 0; i < segs.length; i++) {
    const [w0, w1, len] = segs[i];
    const last = i === segs.length - 1;
    const pts = last
      ? [[-w0 / 2, 0], [w0 / 2, 0], [w1 / 2, -len], [w1 * 0.1, -len + Math.min(2.2, len * 0.4)], [-w1 / 2, -len * 0.92]]
      : [[-w0 / 2, 0], [w0 / 2, 0], [w1 / 2, -len], [-w1 / 2, -len]];
    mesh(extrude(pts, thick), mat, p);
    out.push(p);
    if (!last) { const n = group(p, [0, -len + 0.3, 0]); n.rotation.order = 'ZXY'; p = n; }
  }
  return out;
}

// irregular rock block: a box with deterministic corner jitter (chunky, faceted)
function rockGeo(seed) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (x > 0 ? 1 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 4 : 0);
    const j = 0.09;
    p.setXYZ(i, x + (hash(seed * 13 + k) - 0.5) * j * 2, y + (hash(seed * 17 + k + 3) - 0.5) * j * 2, z + (hash(seed * 19 + k + 7) - 0.5) * j * 2);
  }
  return flat(g);
}

// ---------- build ----------
export const DIM = { HIP: 64, HX: 4.2, L1: 29, L2: 28, ANK: 6.5, UA: 17, FA: 16 };

export function buildCharacter() {
  const R = {};
  const root = new THREE.Group(); root.name = 'CharacterRoot';
  R.root = root;
  const tilt = group(root, [0, 0, 0], 'tilt');
  tilt.rotation.x = 0.05;   // seen slightly from above, so the hat shows its top tiers
  root.scale.setScalar(ROOT_SCALE);

  const pelvis = group(tilt, [0, DIM.HIP, 0], 'Pelvis');
  R.pelvis = pelvis;
  // seat of the pants (cream) joining the two balloons
  mesh(tbox(11, 7, 8.5, { tx: 0.9 }), M.cream, pelvis, [0, -0.5, 0]);

  // ---- legs: cream harem pants ballooning to the knee, wrapped shins, pointed heeled shoes ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const hip = group(pelvis, [sx * DIM.HX, 0, 0], side + 'Thigh');
    hip.rotation.order = 'ZXY';
    mesh(lathe([[0.1, 3], [5.0, 3], [6.2, -3], [7.6, -10], [8.8, -17], [9.1, -22], [8.4, -25.5], [6.2, -28], [3.6, -29.4], [0.1, -29.6]], 9, side === 'l' ? 0.35 : 0.1),
      M.cream, hip, [0, 0, 0]);
    const knee = group(hip, [0, -DIM.L1, 0], side + 'Shin');
    // gathered cuff at the knee
    mesh(lathe([[3.6, 1.2], [4.4, 0.0], [3.4, -1.6]], 8, 0.2), M.cream, knee, [0, 0, 0]);
    // thin dark shin with gold wraps (stripes)
    mesh(lathe([[0.1, 0], [2.4, -0.5], [2.2, -12], [1.7, -26], [0.1, -28]], 6, 0.3), M.skin, knee, [0, 0, 0]);
    for (let k = 0; k < 7; k++) {
      const y = -3.2 - k * 3.3, r = 2.75 - k * 0.09;
      mesh(lathe([[r - 0.2, y + 0.9], [r + 0.15, y], [r - 0.15, y - 1.2]], 6, 0.3 + k * 0.4), M.gold, knee, [0, 0, 0], [0.12 * (k % 2 ? 1 : -1), 0, 0]);
    }
    const ankle = group(knee, [0, -DIM.L2, 0], side + 'Foot');
    // pointed gold shoe with a dark heel
    mesh(tbox(4.0, 3.2, 8.5, { tx: 0.75, tz: 0.6, shiftTopZ: -1.2 }), M.gold, ankle, [0, -4.4, 1.8]);
    mesh(flat(new THREE.ConeGeometry(2.0, 5.0, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4)), M.gold, ankle, [0, -5.2, 7.6], [0.05, 0, 0], [1, 0.75, 1]);
    mesh(tbox(4.4, 1.0, 10.5), M.sole, ankle, [0, -6.1, 2.6]);
    mesh(tbox(2.2, 2.8, 2.0), M.sole, ankle, [0, -4.9, -2.0]);
    mesh(lathe([[2.4, 0.5], [3.0, -0.6], [2.6, -1.8]], 6, 0.4), M.gold, ankle, [0, -1.2, 0]);
    R[side + 'Thigh'] = hip; R[side + 'Shin'] = knee; R[side + 'Foot'] = ankle;
  }

  // ---- waist: wide cream sash over a green belt, knot + tails on the left hip ----
  mesh(lathe([[5.6, 6.5], [6.3, 5.0], [6.4, 2.0], [6.0, 0.8]], 9, 0.2), M.sash, pelvis, [0, 2.2, 0]);
  mesh(lathe([[6.1, 1.0], [6.6, 0.2], [6.6, -1.2], [6.1, -1.8]], 9, 0.2), M.green, pelvis, [0, 2.2, 0]);
  mesh(tbox(2.6, 2.4, 1.6), M.green, pelvis, [3.6, 2.0, 5.6], [0, 0.5, 0.2]);
  R.tailA = clothChain(pelvis, [3.4, 1.0, 5.4], [[2.0, 1.8, 4.5], [1.8, 1.6, 4.5]], M.green);
  R.tailB = clothChain(pelvis, [4.4, 1.2, 4.8], [[1.8, 1.6, 4.0], [1.6, 1.3, 3.5]], M.green);

  // ---- torso: slim dark shirt, V-taper ----
  const spine = group(pelvis, [0, 6.5, 0], 'Torso');
  spine.rotation.order = 'YXZ';
  R.spine = spine;
  mesh(tbox(8.6, 8, 6.0, { tx: 1.12, tz: 1.05 }), M.shirt, spine, [0, 3.5, 0]);
  const chest = group(spine, [0, 7.0, 0], 'Chest');
  R.chest = chest;
  mesh(tbox(8.4, 13, 6.2, { tx: 1.4, tz: 1.12 }), M.shirt, chest, [0, 6.5, -0.2]);

  // gold mantle collar: lapels forming a V down to the sash, stiff pointed shoulder flaps, high collar
  mesh(tbox(3.6, 15, 1.4, { tx: 1.5 }), M.gold, chest, [-3.3, 5.6, 3.8], [0.06, 0.25, 0.32]);
  mesh(tbox(3.6, 15, 1.4, { tx: 1.5 }), M.gold, chest, [3.3, 5.6, 3.8], [0.06, -0.25, -0.32]);
  const flap = [[0, -1.2], [8.6, -2.6], [11.2, 2.6], [7.4, 2.2], [3.0, 4.6], [0, 4.2]];
  R.flapL = group(chest, [5.6, 10.8, 0.2]);
  mesh(extrude(flap, 7.6), M.gold, R.flapL, [0, 0, 0], [0, 0, 0.12]);
  R.flapR = group(chest, [-5.6, 10.8, 0.2]);
  mesh(extrude(flap.map(([x, y]) => [-x * 1.12, y * 1.1]), 7.8), M.gold, R.flapR, [0, 0, 0], [0, 0, -0.12]);
  mesh(tbox(2.2, 3.4, 5.0, { tx: 1.2 }), M.gold, chest, [3.6, 13.6, 0.0], [0, 0, -0.3]);
  mesh(tbox(2.2, 3.4, 5.0, { tx: 1.2 }), M.gold, chest, [-3.6, 13.6, 0.0], [0, 0, 0.3]);

  // ---- neck + head: long thin neck, narrow head with a pointed chin, face in the hat's shadow ----
  const neck = group(chest, [0, 13.0, 0.4], 'Neck');
  R.neck = neck;
  mesh(lathe([[1.9, 0], [1.7, 4.8], [0.1, 5.0]], 6, 0.2), M.skin, neck, [0, 0, 0]);
  const head = group(neck, [0, 3.8, 0.5], 'Head');
  head.rotation.order = 'YXZ';
  R.head = head;
  mesh(lathe([[0.1, 0], [1.8, 0.8], [4.2, 3.4], [5.3, 6.2], [5.3, 9.4], [4.4, 11.6], [0.1, 12.4]], 8, 0.2), M.face, head, [0, 0, 0], [0, 0, 0], [1, 1, 0.9]);
  R.eyeL = group(head, [2.4, 5.6, 4.8], 'eyeL');
  R.eyeR = group(head, [-2.4, 5.6, 4.8], 'eyeR');

  // ---- hat: wide shallow stepped cone (pagoda tiers), radial facets ----
  const hat = group(head, [0, 11.0, 0], 'Hat');
  hat.rotation.order = 'ZXY';
  R.hat = hat;
  mesh(lathe([
    [0.1, 18.5], [1.4, 18.1], [2.0, 16.6],
    [7.6, 13.4], [7.2, 12.4],
    [13.6, 9.8], [13.2, 8.8],
    [19.8, 6.4], [19.4, 5.4],
    [26.0, 3.4], [25.6, 2.4],
    [32.0, 1.0], [31.8, 0.2],
    [24.0, -0.2], [9.0, 0.2], [4.6, 0.6], [0.1, 0.8],
  ], 14, 0.11), M.hat, hat, [0, 0, 0]);

  // ---- arms: long, thin, dark; gold bracelets; IK-posed ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const sh = group(chest, [sx * 8.6, 11.0, -0.4], side + 'Arm');
    mesh(lathe([[0.1, 1.8], [2.4, 1.2], [2.3, -5], [1.9, -15.5], [0.1, -17]], 6, 0.3), M.skin, sh, [0, 0, 0]);
    const el = group(sh, [0, -DIM.UA, 0], side + 'Fore');
    mesh(lathe([[0.1, 1.2], [2.0, 0.4], [1.8, -8], [1.45, -15.2], [0.1, -16]], 6, 0.3), M.skin, el, [0, 0, 0]);
    mesh(lathe([[1.8, -11.6], [2.4, -12.4], [2.0, -13.3]], 6, 0.5), M.gold, el, [0, 0, 0]);
    mesh(lathe([[1.6, -13.8], [2.2, -14.5], [1.8, -15.3]], 6, 0.5), M.gold, el, [0, 0, 0]);
    const hand = group(el, [0, -DIM.FA, 0], side + 'Hand');
    // claw hand: fingers along -y, palm facing +z, fingers curl toward the palm
    mesh(tbox(5.0, 4.6, 2.2, { tx: 0.85 }), M.skin, hand, [0, -2.1, 0]);
    const fx = [-1.5, -0.5, 0.5, 1.5];
    for (let i = 0; i < 4; i++) {
      const f = group(hand, [fx[i] * 1.4, -4.2, 0]);
      f.rotation.set(0.35, 0, (i - 1.5) * 0.3);
      mesh(tbox(1.7, 5.0, 1.7, { pivot: 'top' }), M.skin, f, [0, 0, 0]);
      const f2 = group(f, [0, -4.8, 0]);
      f2.rotation.set(0.65, 0, 0);
      mesh(flat(new THREE.ConeGeometry(0.95, 4.6, 4).translate(0, -2.3, 0).rotateX(Math.PI)), M.skin, f2, [0, 0, 0]);
    }
    const th = group(hand, [sx * 2.6, -1.2, 0.7]);
    th.rotation.set(0.5, 0, sx * 0.85);
    mesh(tbox(1.5, 4.4, 1.5, { pivot: 'top' }), M.skin, th, [0, 0, 0]);
    R[side + 'Arm'] = sh; R[side + 'Fore'] = el; R[side + 'Hand'] = hand;
  }
  // point above the magic palm the rocks float around
  R.palm = group(R.lHand, [0, -3.0, 4.0], 'palm');

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  // ---- the three floating rocks (world space; positioned by main.js) ----
  R.rocks = [13, 11.5, 8.5].map((s, i) => {
    const m = new THREE.Mesh(rockGeo(i + 1), M.rock);
    m.scale.setScalar(s);
    m.userData.size = s;
    m.frustumCulled = false;
    return m;
  });
  return R;
}

// ---------- leg IK (same solver as the revenant) ----------
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _ax = new THREE.Vector3(), _eu = new THREE.Euler(), _ez = new THREE.Euler();
function solveLeg(thigh, shin, foot, hipPos, target, toe, swivel, footYaw, roll) {
  const { L1, L2 } = DIM;
  const vx = target.x - hipPos.x, vy = target.y - hipPos.y, vz = target.z - hipPos.z;
  const gamma = Math.atan2(vx, -vy);
  const down = Math.sqrt(vx * vx + vy * vy);
  let L = Math.sqrt(down * down + vz * vz);
  L = clamp(L, 6, L1 + L2 - 0.15);
  const alpha = Math.atan2(vz, down);
  const a1 = Math.acos(clamp((L1 * L1 + L * L - L2 * L2) / (2 * L1 * L), -1, 1));
  const kneeInt = Math.acos(clamp((L1 * L1 + L2 * L2 - L * L) / (2 * L1 * L2), -1, 1));
  const knee = Math.PI - kneeInt;
  const hipF = alpha + a1;
  _eu.set(-hipF, 0, gamma, 'ZXY'); _qa.setFromEuler(_eu);
  _ax.set(vx, vy, vz).normalize(); _qb.setFromAxisAngle(_ax, swivel);
  _qb.multiply(_qa);
  shin.rotation.set(knee, 0, 0);
  _eu.set(toe - 0.08, footYaw, 0.2 * gamma, 'YXZ'); _qc.setFromEuler(_eu);
  _qa.copy(_qb).multiply(shin.quaternion).invert();
  foot.quaternion.multiplyQuaternions(_qa, _qc);
  _ez.set(0, 0, -roll); _qa.setFromEuler(_ez);
  thigh.quaternion.multiplyQuaternions(_qa, _qb);
}

// ---------- arm IK: hand target + elbow pole + hand orientation, all in chest space ----------
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _E = new THREE.Vector3(), _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _qh = new THREE.Quaternion(), _qs = new THREE.Quaternion();
function solveArm(sh, fore, hand, p, s) {
  const L1 = DIM.UA, L2 = DIM.FA;
  _S.copy(sh.position);
  _T.set(_S.x + p[s + 'Hx'], _S.y + p[s + 'Hy'], _S.z + p[s + 'Hz']);
  _d.subVectors(_T, _S);
  const D = clamp(_d.length(), 4, L1 + L2 - 0.2);
  _d.normalize();
  _n.set(p[s + 'Px'], p[s + 'Py'], p[s + 'Pz']);
  _n.addScaledVector(_d, -_n.dot(_d)).normalize();
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _E.copy(_S).addScaledVector(_d, a).addScaledVector(_n, h);
  _T.copy(_S).addScaledVector(_d, D);
  _u1.subVectors(_E, _S).normalize();
  _u2.subVectors(_T, _E).normalize();
  _X.crossVectors(_u1, _u2);
  if (_X.lengthSq() < 1e-6) _X.crossVectors(_u1, _n);
  _X.normalize();
  _Y.copy(_u1).negate();
  _Z.crossVectors(_X, _Y);
  _m.makeBasis(_X, _Y, _Z);
  sh.quaternion.setFromRotationMatrix(_m);
  fore.rotation.set(Math.atan2(-_u2.dot(_Z), -_u2.dot(_Y)), 0, 0);
  // hand: fingers along -Y toward (F), palm normal (N) as +Z
  _Y.set(p[s + 'Fx_'], p[s + 'Fy_'], p[s + 'Fz_']).normalize().negate();
  _Z.set(p[s + 'Nx'], p[s + 'Ny'], p[s + 'Nz']);
  _Z.addScaledVector(_Y, -_Z.dot(_Y)).normalize();
  _X.crossVectors(_Y, _Z);
  _m.makeBasis(_X, _Y, _Z);
  _qh.setFromRotationMatrix(_m);
  _qs.copy(sh.quaternion).multiply(fore.quaternion).invert();
  hand.quaternion.multiplyQuaternions(_qs, _qh);
}

// ---------- apply pose ----------
const _hip = new THREE.Vector3(), _tgt = new THREE.Vector3();
const HAT_TILT = 0.06;
const TILT = 0.05, TILT_C = Math.cos(TILT), TILT_S = Math.sin(TILT), ANK_W = DIM.ANK * TILT_C;

// sash tails: pure functions of u (lagged drive samples)
function clothApply(chain, u, phase, lag) {
  const n = chain.length;
  for (let i = 0; i < n; i++) {
    const d = drive(u - lag * (i + 1));
    const k = (i + 1) / n;
    const vTr = Math.abs(d.vTravel);
    chain[i].rotation.x = clamp(0.06 + 0.012 * vTr * (i === 0 ? 1 : 0.4) + 0.015 * d.vHip + 0.1 * Math.sin(TAU * 9 * u / LOOP - i * 0.9 + phase) * (0.4 + k), -1.2, 1.4);
    chain[i].rotation.z = clamp(0.1 - 0.12 * d.vTwist * (0.4 + k) + 0.07 * Math.sin(TAU * 7 * u / LOOP - i * 0.7 + phase * 1.7), -1.0, 1.0);
  }
}

const _p = {};
const LEGS = ['l', 'r'].map((sd) => ({ sx: sd === 'l' ? 1 : -1, fx: sd + 'Fx', fz: sd + 'Fz', lift: sd + 'Lift', toe: sd + 'Toe', sw: sd + 'Sw', fy: sd + 'Fy', thigh: sd + 'Thigh', shin: sd + 'Shin', foot: sd + 'Foot' }));
// applyPose(R, u, {cloth, snap}): snap(x) returns the pixel-snapped root x; planted feet are counter-shifted
export function applyPose(R, u, { cloth = true, snap = null } = {}) {
  const p = pose(u, _p);
  const sx = Math.sin(WALK_YAW), sz = Math.cos(WALK_YAW);
  const rawX = X0 + p.travel * sx;
  const rx = snap ? snap(rawX) : rawX;
  R.root.position.set(rx, 0, p.travel * sz);
  R.root.rotation.y = p.yaw;
  const dxw = (rx - rawX) / ROOT_SCALE;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  R.pelvis.position.y = DIM.HIP + p.hipY;
  R.pelvis.rotation.set(0, 0, p.pRoll);
  R.spine.rotation.set(p.tPitch, p.tYaw, p.tRoll);
  const br = 1 + 0.03 * p.breathPhase * p.breath;
  R.chest.scale.set(br * (1 + 0.03 * p.squash), 1 - 0.05 * p.squash, br);

  for (let j = 0; j < 2; j++) {
    const L = LEGS[j];
    _hip.set(L.sx * DIM.HX, DIM.HIP + p.hipY, 0);
    _hip.y += L.sx * DIM.HX * Math.sin(p.pRoll);
    const fx = p[L.fx] - dxw * cy, fz = p[L.fz] - dxw * sy;
    const wy = ANK_W + p[L.lift];
    _tgt.set(fx, wy * TILT_C + fz * TILT_S, -wy * TILT_S + fz * TILT_C);
    solveLeg(R[L.thigh], R[L.shin], R[L.foot], _hip, _tgt, p[L.toe], -L.sx * p[L.sw], p[L.fy], p.pRoll);
  }

  // shoulders rise a little on the inhale
  const inh = p.breathPhase * p.breath;
  R.lArm.position.y = 11.0 + 0.6 * inh;
  R.rArm.position.y = 11.0 + 0.6 * inh;
  solveArm(R.lArm, R.lFore, R.lHand, p, 'l');
  solveArm(R.rArm, R.rFore, R.rHand, p, 'r');

  R.head.rotation.set(p.hPitch, p.hYaw, p.hRoll);
  if (cloth) {
    // the wide hat lags behind the head's motion (tilts against travel, bobs with the hips)
    const d = drive(u - 0.08);
    // the brim keeps a fixed small world tilt (it would otherwise inherit body + head pitch and hide the face)
    R.hat.rotation.set(HAT_TILT - TILT - p.tPitch - p.hPitch + clamp(0.004 * d.vHip, -0.06, 0.06) + clamp(0.3 * d.vPitch, -0.06, 0.06), 0, clamp(-0.0025 * d.vTravel + 0.12 * d.vTwist, -0.1, 0.1) - p.hRoll);
    clothApply(R.tailA, u, 0.4, 0.045);
    clothApply(R.tailB, u, 2.1, 0.05);
  }
  return p;
}
