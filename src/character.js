import * as THREE from 'three';
import { pose, drive, LOOP, WALK_YAW, X0, ROOT_SCALE, clamp } from './pose.js';

// Must run before any THREE.Color is created (ES imports are hoisted above main.js code).
THREE.ColorManagement.enabled = false;

const TAU = Math.PI * 2;

// ---------- shared uniforms for all toon materials ----------
export const toonShared = {
  uKey: { value: new THREE.Vector3(-0.3, 0.85, 0.5).normalize() },
  uHeadPos: { value: new THREE.Vector3() },
  uHeadI: { value: 1 },
};

const toonVert = /* glsl */`
varying vec3 vN;
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const toonFrag = /* glsl */`
uniform vec3 uBase; uniform vec3 uShade; uniform vec3 uLite; uniform vec3 uHi; uniform vec3 uDeep;
uniform float uMetal; uniform float uCode; uniform float uHeadMul;
uniform vec3 uKey; uniform vec3 uHeadPos; uniform float uHeadI;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = dot(n, uKey);
  vec3 c = d > 0.62 ? uLite : (d > 0.16 ? uBase : (d > -0.35 ? uShade : uDeep));
  if (uMetal > 0.5) {
    vec3 sl = normalize(vec3(-0.65, 0.7, 0.3));
    vec3 r = reflect(-sl, n);
    if (r.z > 0.975) c = uHi;
  }
  // flame light: warm banded tint on faces turned toward the head
  vec3 L = uHeadPos - vW;
  float dist = length(L);
  float hd = dot(n, L / max(dist, 0.001));
  float att = clamp(1.0 - dist / 30.0, 0.0, 1.0) * uHeadI * uHeadMul;
  float h = hd * att;
  if (h > 0.28) c = mix(c, c * vec3(1.5, 0.8, 0.65) + vec3(0.1, 0.02, 0.01), 0.38);
  if (h > 0.55) c = mix(c, vec3(0.80, 0.36, 0.22), 0.22 * uMetal + 0.08);
  #ifdef DBGN
  c = n * 0.5 + 0.5;
  #endif
  gl_FragColor = vec4(c, uCode);
}`;

function hex(h) { return new THREE.Color(h); }
function toon(base, opt = {}) {
  const b = hex(base);
  const shade = opt.shade ? hex(opt.shade) : b.clone().multiply(new THREE.Color(0.55, 0.55, 0.72));
  const deep = opt.deep ? hex(opt.deep) : shade.clone().multiplyScalar(0.62);
  const lite = opt.lite ? hex(opt.lite) : b.clone().multiplyScalar(1.45).add(new THREE.Color(0.03, 0.03, 0.045));
  const hi = opt.hi ? hex(opt.hi) : new THREE.Color(0.86, 0.89, 0.95);
  return new THREE.ShaderMaterial({
    vertexShader: toonVert, fragmentShader: toonFrag,
    uniforms: {
      uBase: { value: b }, uShade: { value: shade }, uLite: { value: lite }, uHi: { value: hi }, uDeep: { value: deep },
      uMetal: { value: opt.metal ? 1 : 0 }, uCode: { value: opt.code ?? 1.0 }, uHeadMul: { value: opt.noHead ? 0 : 1 },
      ...toonShared,
    },
    side: THREE.DoubleSide,
    defines: location.search.includes('dbgn') ? { DBGN: 1 } : {},
  });
}

// ---------- palette of materials ----------
// Mostly near-black charcoal + slate-purple cloth, dark gunmetal; crimson is the only saturated family.
const M = {
  coat: toon('#211f2c', { lite: '#36334a', shade: '#13121a', deep: '#0a090e' }),
  coat2: toon('#2e2940', { lite: '#4a4262', shade: '#1a1724', deep: '#0e0c13' }),
  plate: toon('#464c60', { lite: '#6a7288', shade: '#2a2e3d', deep: '#14161e', hi: '#8f98ac', metal: true, code: 0.8 }),
  slate: toon('#2b2539', { lite: '#433a5c', shade: '#19151f', deep: '#0e0c13' }),
  slateDark: toon('#25223a', { lite: '#3a3552', shade: '#16141f', deep: '#0d0c13' }),
  metal: toon('#2c303e', { lite: '#4f566b', shade: '#181b24', deep: '#0d0f15', hi: '#dde2ec', metal: true, code: 0.8 }),
  metalDark: toon('#191c26', { lite: '#2e3344', shade: '#10121a', deep: '#0a0b10', hi: '#a9b1c2', metal: true, code: 0.8 }),
  crimson: toon('#a8162a', { lite: '#e8343a', shade: '#5a0c1c', deep: '#340712', code: 0.6 }),
  crimsonDark: toon('#7c1222', { lite: '#a81e2c', shade: '#400a16', deep: '#26060f', code: 0.6 }),
  leather: toon('#262026', { lite: '#3f3139', shade: '#171317', deep: '#0d0a0c' }),
  wrap: toon('#33303f', { lite: '#4e4a60', shade: '#1f1d28', deep: '#131219' }),
  blade: toon('#4e576b', { lite: '#98a2b8', shade: '#2e3444', deep: '#1c2029', hi: '#ffffff', metal: true, code: 0.8 }),
  dark: toon('#121219', { lite: '#1d1d27', shade: '#0b0b10', deep: '#07070a' }),
  collar: toon('#101017', { lite: '#1a1a24', shade: '#0b0b10', deep: '#07070a', noHead: true }),
};

// ---------- geometry helpers (all flat shaded) ----------
function flat(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return ng;
}
// Tapered box. w/d at bottom, scaled by tx/tz at top. pivot: 'top' | 'bottom' | 'center'
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
// Lathe from [r, y] pairs (y downward allowed)
function lathe(profile, segs = 7, phase = 0) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y));
  const g = new THREE.LatheGeometry(pts, segs, phase);
  return flat(g);
}
function dome(r, segs = 7, rings = 3, thetaLen = Math.PI / 2) {
  return flat(new THREE.SphereGeometry(r, segs, rings, 0, TAU, 0, thetaLen));
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

// torn cloth panel: top width w0, bottom width w1, with 2-3 px notches cut into the hem and one side
function raggedPts(w0, w1, len, seed = 0) {
  const sx = (y) => (w0 + (w1 - w0) * (-y / len)) / 2;
  const j = (k) => 0.12 * Math.sin(seed * 7.1 + k * 3.7);
  const nd = Math.min(3.0, len * 0.35);   // notch depth (art px)
  return [
    [-w0 / 2, 0], [w0 / 2, 0],
    [sx(-len * 0.5), -len * 0.5], [sx(-len * 0.58) - 1.8, -len * (0.6 + j(1))], [sx(-len * 0.68), -len * 0.7],
    [w1 * (0.45 + j(2)), -len],
    [w1 * 0.24, -len + nd],
    [w1 * (0.06 + j(3)), -len - 0.6],
    [-w1 * 0.12, -len + nd * 0.8],
    [-w1 * (0.3 + j(4)), -len * 0.97],
    [-w1 * 0.4, -len + nd * 0.7],
    [-w1 / 2, -len * 0.86],
    [sx(-len * 0.4) * -1, -len * 0.4],
  ];
}

// cloth chain: returns array of segment groups (each pivots at its top)
function clothChain(parent, pos, segs, mat, { thick = 1.2, tatter = true, lining = null, seed = 0 } = {}) {
  const out = [];
  let p = group(parent, pos);
  p.rotation.order = 'ZXY';
  for (let i = 0; i < segs.length; i++) {
    const [w0, w1, len] = segs[i];
    const last = i === segs.length - 1;
    let geo;
    if (last && tatter) {
      geo = extrude(raggedPts(w0, w1, len, seed + i), thick);
    } else {
      const g2 = new THREE.BoxGeometry(1, len, thick);
      const pa = g2.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        const top = pa.getY(k) > 0;
        pa.setX(k, pa.getX(k) * (top ? w0 : w1));
      }
      g2.translate(0, -len / 2, 0);
      geo = flat(g2);
    }
    mesh(geo, mat, p);
    if (lining) mesh(geo, lining, p, [0, 0.4, -thick * 0.85], [0, 0, 0], [1.16, 1.07, 0.6]);
    out.push(p);
    if (!last) { const n = group(p, [0, -len + 0.3, 0]); n.rotation.order = 'ZXY'; p = n; }
  }
  return out;
}

// ---------- build ----------
export const DIM = { HIP: 42, HX: 5.5, L1: 17, L2: 17, ANK: 8 };

export function buildCharacter() {
  const R = {};
  const root = new THREE.Group(); root.name = 'CharacterRoot';
  R.root = root;
  const tilt = group(root, [0, 0, 0], 'tilt');
  tilt.rotation.x = 0.1;
  root.scale.setScalar(ROOT_SCALE);
  R.tilt = tilt;

  // pelvis
  const pelvis = group(tilt, [0, DIM.HIP, 0], 'Pelvis');
  R.pelvis = pelvis;
  mesh(tbox(12, 7, 9, { tx: 0.8, tz: 0.9 }), M.slateDark, pelvis, [0, 1, 0]);

  // ---- legs: ballooning slate trousers into heavy boots ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const hip = group(pelvis, [sx * DIM.HX, 0, 0], side + 'Thigh');
    hip.rotation.order = 'ZXY';
    mesh(lathe([[0.1, 1.5], [4.4, 1.5], [5.6, -3], [7.6, -9], [8.5, -13.5], [7.4, -17], [0.1, -18]], 7, side === 'l' ? 0.3 : 0.1),
      M.slate, hip, [0, 0, 0]);
    const knee = group(hip, [0, -DIM.L1, 0], side + 'Shin');
    mesh(lathe([[0.1, 1.5], [7.6, 1.0], [8.0, -2.5], [6.6, -6.5], [4.3, -10.5], [3.4, -13], [0.1, -14]], 7, 0.2),
      M.slate, knee, [0, 0, 0]);
    // dark wrap band where the balloon tucks into the boot
    mesh(lathe([[4.3, -9.6], [5.2, -10.8], [4.1, -12.2]], 7, 0.5), M.dark, knee, [0, 0, 0]);
    const ankle = group(knee, [0, -DIM.L2, 0], side + 'Boot');
    mesh(lathe([[0.1, 6.5], [5.6, 6.5], [5.8, 4.5], [4.6, 3.8], [4.7, -3], [5.1, -6], [0.1, -6]], 6, 0.3), M.leather, ankle, [0, 0, 0]);
    mesh(lathe([[5.7, 6.4], [6.3, 5.2], [5.8, 4.2]], 6, 0.3), M.metalDark, ankle, [0, 0, 0]);
    mesh(tbox(7.8, 5.5, 14.5, { tx: 0.9, tz: 0.75, shiftTopZ: -1.5 }), M.leather, ankle, [0, -5.2, 3.0]);
    mesh(tbox(8.1, 1.7, 15), M.dark, ankle, [0, -7.6, 3.0]);
    mesh(tbox(7.2, 3, 4, { tx: 0.8 }), M.metalDark, ankle, [0, -5.8, 8.6], [0.2, 0, 0]);
    R[side + 'Thigh'] = hip; R[side + 'Shin'] = knee; R[side + 'Boot'] = ankle;
  }

  // ---- waist: cinched dark-crimson sash with a front knot ----
  const sashY = 4.6;
  mesh(lathe([[5.4, 2.6], [6.0, 1], [6.1, -1.5], [5.8, -2.8]], 8, 0.2), M.crimsonDark, pelvis, [0, sashY, 0]);
  mesh(tbox(4.6, 4.2, 3.6, { tx: 0.7 }), M.crimson, pelvis, [3.6, sashY - 0.8, 5.4], [0, 0.35, 0.3]);
  R.sashA = clothChain(pelvis, [4.2, sashY - 2.5, 5.8], [[3.8, 3.4, 6], [3.4, 3.0, 6], [3.0, 2.6, 6]], M.crimsonDark, { seed: 1 });
  R.sashB = clothChain(pelvis, [5.6, sashY - 2.5, 4.2], [[3.0, 2.6, 5], [2.6, 2.3, 5], [2.3, 2.0, 5]], M.crimsonDark, { seed: 2 });
  // belt pouch on the right hip
  mesh(tbox(4, 5, 3.5, { tx: 0.9 }), M.leather, pelvis, [-6.4, sashY - 4.5, 2.5], [0, 0, -0.15]);
  mesh(tbox(4.4, 1.4, 3.9), M.metalDark, pelvis, [-6.4, sashY - 2.2, 2.5], [0, 0, -0.15]);
  // ragged coat skirt: front flap, hip panels, back tails (all torn)
  R.flapF = clothChain(pelvis, [-0.8, 1.5, 6.0], [[8, 7.5, 7], [7.5, 7, 6], [7, 6.5, 7]], M.coat, { thick: 1.0, seed: 3 });
  R.hipL = clothChain(pelvis, [6.4, 2.5, 1.5], [[6, 6.5, 8], [6.5, 6.5, 8]], M.coat2, { thick: 1.0, seed: 4 });
  R.hipR = clothChain(pelvis, [-6.6, 2.5, 1.0], [[6, 6.5, 8], [6.5, 6, 7]], M.coat2, { thick: 1.0, seed: 5 });
  R.tailL = clothChain(pelvis, [3.4, 3, -5.0], [[8, 8, 9], [8, 7, 9], [7, 6.5, 9]], M.coat, { thick: 1.0, seed: 6 });
  R.tailR = clothChain(pelvis, [-3.4, 3, -5.0], [[8, 7.5, 9], [7.5, 7, 8], [7, 6, 9]], M.coat, { thick: 1.0, seed: 7 });

  // ---- spine / chest: strong V taper ----
  const spine = group(pelvis, [0, 5.5, 0], 'Torso');
  spine.rotation.order = 'YXZ';
  R.spine = spine;
  mesh(tbox(8.6, 8, 7.4, { tx: 1.38, tz: 1.15 }), M.coat, spine, [0, 3.5, 0]);
  const chest = group(spine, [0, 7.5, 0], 'Chest');
  R.chest = chest;
  mesh(tbox(12, 14, 10, { tx: 1.95, tz: 1.12 }), M.coat, chest, [0, 6.5, -0.5]);
  // layered breastplate: two angled halves meeting in a centre ridge, pointed lower edge
  const half = [[0, 12.5], [10.6, 11.5], [10.0, 6.0], [6.5, 1.2], [0, -1.6]];
  const bpR = group(chest, [0, 1.8, 6.0]);
  bpR.rotation.x = -0.06;
  mesh(extrude(half.map(([x, y]) => [-x, y]), 3.0), M.plate, bpR, [0, 0, 0], [0, -0.26, 0]);
  mesh(extrude(half, 3.0), M.plate, bpR, [0, 0, 0], [0, 0.26, 0]);
  // dark ridge seam
  mesh(tbox(0.9, 12, 1.2), M.dark, bpR, [0, 5.5, 1.6]);
  // fauld lame below the plate (near-black)
  mesh(tbox(10.5, 2.6, 2.2, { tx: 1.15 }), M.metalDark, chest, [0, 0.0, 5.0], [-0.08, 0, 0]);
  // coat lapels flanking the plate
  mesh(tbox(3.2, 11, 2, { tx: 1.9 }), M.coat2, chest, [-8.6, 7.4, 4.0], [0, 0.45, -0.14]);
  mesh(tbox(3.2, 11, 2, { tx: 1.9 }), M.coat2, chest, [8.8, 7.4, 3.8], [0, -0.45, 0.14]);
  // strap lines: under-chest strap + diagonal baldric
  mesh(tbox(13.4, 1.4, 11.6, { tx: 1.05 }), M.dark, chest, [0, 1.6, -0.4]);
  mesh(tbox(2.0, 25, 1.2), M.dark, chest, [1.2, 6.2, 7.9], [0, 0, 0.62]);
  mesh(tbox(2.6, 2.6, 1.6), M.metal, chest, [-4.8, 12.0, 8.0], [0, 0, 0.62]); // buckle on the strap
  // back plate + shoulder yoke (near-black gorget)
  mesh(tbox(16, 12, 3, { tx: 1.2 }), M.metalDark, chest, [0, 7, -5.8]);
  mesh(tbox(26, 4, 11, { tx: 0.9 }), M.metalDark, chest, [0, 13, -0.5]);

  // collar / neck: dark high collar the flame rises from (no warm band)
  const neck = group(chest, [0, 15, 0.5], 'Neck');
  R.neck = neck;
  mesh(lathe([[6.0, -1.5], [7.4, 0.8], [8.4, 2.8], [7.6, 3.4], [0.1, 1.8]], 7, 0.2), M.collar, neck, [0, 0, 0]);
  mesh(lathe([[7.6, -1.2], [8.6, 0.0], [8.2, 1.4]], 7, 0.0), M.metalDark, neck, [0, 0, 0]);
  const headAnchor = group(neck, [0, 2.6, 0.8], 'HeadEnergyRoot');
  R.head = headAnchor;
  const headLight = group(neck, [0, 10, 1.5], 'HeadLight');
  R.headLight = headLight;

  // scarf: a wrap low on the collar + a long tail hanging off the near shoulder
  mesh(lathe([[7.8, -1.0], [8.9, -2.0], [8.6, -3.6], [7.2, -4.2]], 8, 0.4), M.crimsonDark, neck, [0, 0.0, 0], [0.18, 0, -0.12]);
  R.scarf = clothChain(neck, [-8.0, -1.8, 0.6], [[7, 6.5, 6], [6.5, 6, 6], [6, 5.5, 6], [5.5, 5.5, 6], [5.5, 5, 6], [5, 4.5, 6], [4.5, 4, 6], [4, 4, 6], [4, 3.5, 7]], M.crimson, { thick: 1.3, seed: 8 });
  R.scarf2 = clothChain(neck, [-4.5, -2, -5.0], [[4, 3.6, 6], [3.6, 3.2, 6], [3.2, 2.6, 6], [2.6, 2.4, 6], [2.4, 2.2, 6]], M.crimsonDark, { thick: 1.2, seed: 9 });

  // tattered half-mantle over the near shoulder, crimson lining only at its edges
  R.mantle = clothChain(chest, [-11.5, 14.5, -2.5], [[12, 13, 8], [13, 12.5, 8], [12.5, 11.5, 8], [11.5, 10, 9]], M.coat, { thick: 1.2, lining: M.crimsonDark, seed: 10 });

  // ---- arms ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const sh = group(chest, [sx * 13.0, 11.5, -0.5], side + 'Arm');
    sh.rotation.order = 'ZXY';
    mesh(lathe([[0.1, 2], [3.8, 2], [4.4, -3], [4.2, -8], [3.4, -11.5], [0.1, -12]], 6, 0.3), M.coat2, sh, [0, 0, 0]);
    const el = group(sh, [0, -11.5, 0], side + 'Fore');
    // oversized gauntlet with a hard flared cuff (~1.4x)
    mesh(lathe([[0.1, 1.5], [3.7, 1.5], [4.3, -2], [5.6, -5.5], [7.6, -8.4], [8.0, -10.0], [6.6, -10.9], [0.1, -11.2]], 6, 0.5), M.plate, el, [0, 0, 0]);
    mesh(lathe([[4.0, -2.0], [4.8, -3.2], [4.4, -4.4]], 6, 0.5), M.dark, el, [0, 0, 0]);
    const hand = group(el, [0, -12, 0], side + 'Hand');
    if (side === 'r') {
      // armoured fist around the grip
      mesh(tbox(7.4, 7.6, 8.4, { tx: 0.92 }), M.metalDark, hand, [0, -1.8, 0.4]);
      mesh(tbox(7.8, 2.4, 8.8), M.metal, hand, [0, 1.0, 0.4]);
      mesh(tbox(2.6, 4.2, 3.2), M.metal, hand, [-3.4, -1.0, 2.6], [0, 0, 0.3]);  // thumb plate
    } else {
      // open clawed gauntlet: palm + four splayed, curled fingers with pale claw tips
      mesh(tbox(7.0, 5.6, 7.6, { tx: 0.95 }), M.metalDark, hand, [0, -1.0, 0.3]);
      mesh(tbox(7.4, 2.2, 8.0), M.metal, hand, [0, 1.4, 0.3]);
      const fz = [-2.8, -0.9, 1.0, 2.9];
      for (let i = 0; i < 4; i++) {
        const f = group(hand, [0.4, -3.6, fz[i] + 0.3]);
        f.rotation.set(0.32 * (i - 1.5), 0, 0.15 + 0.06 * i);
        mesh(tbox(1.9, 4.2, 1.7, { pivot: 'top' }), M.metalDark, f, [0, 0, 0]);
        const f2 = group(f, [0, -4.0, 0]);
        f2.rotation.set(0, 0, 0.55);
        mesh(flat(new THREE.ConeGeometry(1.0, 3.6, 4).translate(0, -1.8, 0).rotateX(Math.PI)), M.metal, f2, [0, 0, 0]);
      }
      const th = group(hand, [-2.6, -1.0, 3.4]);
      th.rotation.set(0.5, 0, -0.5);
      mesh(tbox(1.9, 4.6, 1.8, { pivot: 'top' }), M.metalDark, th, [0, 0, 0]);
    }
    R[side + 'Arm'] = sh; R[side + 'Fore'] = el; R[side + 'Hand'] = hand;
  }

  // ---- pauldrons (asymmetric) ----
  // big layered pauldron on the far (left) shoulder with a swept horn crest
  const pl = group(R.lArm, [1.0, 1.5, 0], 'PauldronL');
  pl.rotation.z = -0.35;
  mesh(dome(10.5, 7, 3), M.metal, pl, [1.5, 0, 0], [0, 0, 0], [1.05, 0.72, 1.0]);
  mesh(dome(11.5, 7, 2, Math.PI / 2), M.metalDark, pl, [2.5, -3.6, 0], [0, 0, 0], [1.0, 0.45, 1.0]);
  mesh(dome(11.0, 7, 2, Math.PI / 2), M.metalDark, pl, [3.5, -6.6, 0], [0, 0, 0], [0.95, 0.4, 0.95]);
  // horn: tapered segments curling outward and back
  let hp = group(pl, [4.5, 5.5, -2.0], 'Horn');
  hp.rotation.set(-0.35, 0, -0.55);
  const hornSeg = [[2.6, 2.0, 5], [2.0, 1.3, 5], [1.3, 0.5, 5.5]];
  for (let i = 0; i < hornSeg.length; i++) {
    const [r0, r1, len] = hornSeg[i];
    const g = flat(new THREE.CylinderGeometry(r1, r0, len, 5).translate(0, len / 2, 0));
    mesh(g, i === 0 ? M.metal : M.metalDark, hp, [0, 0, 0]);
    const n = group(hp, [0, len - 0.4, 0]);
    n.rotation.set(-0.25, 0, -0.5);
    hp = n;
  }
  // small pauldron + leather strap on the near (sword) shoulder
  const pr = group(R.rArm, [-0.5, 1.5, 0], 'PauldronR');
  pr.rotation.z = 0.25;
  mesh(dome(6.8, 6, 2), M.metalDark, pr, [-0.8, 0, 0], [0, 0, 0], [1.0, 0.75, 1.0]);
  mesh(tbox(2.5, 9, 7), M.leather, pr, [-3.5, -4, 0], [0, 0, 0.25]);

  // ---- weapon: short, broad, slightly curved blade ----
  const weapon = group(R.rHand, [0, -1.5, 0.4], 'WeaponRoot');
  weapon.rotation.order = 'XZY';
  R.weapon = weapon;
  mesh(tbox(2.2, 2.2, 7), M.crimsonDark, weapon, [0, 0, -0.5]);
  mesh(tbox(3.2, 3.2, 2.4), M.metal, weapon, [0, 0, -4.6]); // pommel
  mesh(tbox(2.6, 9.5, 2.4, { tx: 0.8 }), M.metalDark, weapon, [0, 0.5, 4.2]);
  const s = new THREE.Shape();
  s.moveTo(0, -2.4); s.lineTo(12, -3.0); s.lineTo(19, -3.6); s.lineTo(23.5, -2.0);
  s.lineTo(25.5, 1.4); s.lineTo(20, 2.8); s.lineTo(9, 2.6); s.lineTo(0, 2.4); s.lineTo(0, -2.4);
  let bg = new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: false });
  bg.translate(0, 0, -0.8);
  bg.rotateY(-Math.PI / 2); // shape x -> +z
  bg = flat(bg);
  mesh(bg, M.blade, weapon, [0, 0, 5.2]);
  mesh(tbox(1.9, 1.2, 17), M.metalDark, weapon, [0, 1.6, 13.9]);
  R.bladeTip = group(weapon, [0, 0.5, 29.9], 'tip');
  R.bladeMid = group(weapon, [0, 0, 11.4], 'mid');
  R.bladeEdge = group(weapon, [0, -2.6, 22.0], 'edge');

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return R;
}

// ---------- leg IK ----------
function solveLeg(thigh, shin, boot, hipPos, target, toe) {
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
  thigh.rotation.set(-hipF, 0, gamma);
  shin.rotation.set(knee, 0, 0);
  boot.rotation.set(hipF - knee + toe - 0.1, 0, -gamma * 0.8);
}

// ---------- apply pose ----------
const _hip = new THREE.Vector3(), _tgt = new THREE.Vector3();
const TILT_TAN = Math.tan(0.1);

function setChain(chain, angles) {
  for (let i = 0; i < chain.length; i++) {
    const a = angles[i];
    chain[i].rotation.x = a[0];
    chain[i].rotation.z = a[1];
  }
}

// cloth angles: pure function of u (lagged samples of the drive signals)
function clothAngles(u, n, { ripple = 0, curlZ = 0, zGain = 0, base = 0.0, baseZ = 0, curl = 0.05, gain = 0.012, lag = 0.045, flut = 0.12, flutF = 10, twistGain = 0.08, hipGain = 0.01, phase = 0, sX = 0, sZ = 0, sFlut = 0.25 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = drive(u - lag * (i + 1));
    const k = (i + 1) / n;
    // flag streaming during the strike/hold (lagged per segment so it unrolls)
    const st = d.stream;
    let ax = (i === 0 ? base : curl)
      + gain * d.vTravel * (i === 0 ? 1.0 : 0.3) * (d.vTravel < 0 ? 0.6 : 1.0)
      + hipGain * d.vHip
      + flut * Math.sin(TAU * flutF * u / LOOP - i * 0.9 + phase) * (0.4 + k) + ripple * Math.sin(TAU * (flutF + 4) * u / LOOP - i * 1.6 + phase) * k;
    let az = (i === 0 ? baseZ : curlZ) + zGain * d.vTravel * (0.5 + 0.5 * k) - twistGain * d.vTwist * (0.4 + k) * 0.5
      + flut * 0.6 * Math.sin(TAU * (flutF - 3) * u / LOOP - i * 0.7 + phase * 1.7) + ripple * Math.sin(TAU * flutF * u / LOOP - i * 1.3 + phase * 2.3) * (0.3 + k);
    if (st > 0) {
      const wave = Math.sin(TAU * 24 * u / LOOP - i * 1.25 + phase);
      ax += st * ((i === 0 ? sX : -0.06 * sX) + sFlut * wave * k);
      az += st * ((i === 0 ? sZ : sZ * 0.08) + sFlut * 0.5 * Math.sin(TAU * 20 * u / LOOP - i * 1.1 + phase) * k);
    }
    ax = clamp(ax, -1.3, 1.6); az = clamp(az, -1.4, 1.0);
    out.push([ax, az]);
  }
  return out;
}

export function applyPose(R, u, { cloth = true } = {}) {
  const p = pose(u);
  const sx = Math.sin(WALK_YAW), sz = Math.cos(WALK_YAW);
  R.root.position.set(X0 + p.travel * sx, 0, p.travel * sz);
  R.root.rotation.y = p.yaw;
  R.pelvis.position.y = DIM.HIP + p.hipY;
  R.pelvis.rotation.set(0, 0, p.pRoll);
  R.spine.rotation.set(p.tPitch, p.tYaw, p.tRoll);
  const br = 1 + 0.025 * p.breathPhase * p.breath;
  R.chest.scale.set(br, 1, br);

  for (const side of ['l', 'r']) {
    const sxs = side === 'l' ? 1 : -1;
    _hip.set(sxs * DIM.HX, DIM.HIP + p.hipY, 0);
    _hip.y += sxs * DIM.HX * Math.sin(p.pRoll);
    // compensate the body tilt so planted feet stay on the floor line wherever they are in depth
    _tgt.set(p[side + 'Fx'], DIM.ANK + p[side + 'Lift'] + p[side + 'Fz'] * TILT_TAN, p[side + 'Fz']);
    solveLeg(R[side + 'Thigh'], R[side + 'Shin'], R[side + 'Boot'], _hip, _tgt, p[side + 'Toe']);
    R[side + 'Thigh'].rotation.z -= p.pRoll;
  }

  R.rArm.rotation.set(-p.rShF, 0, p.rShZ);
  R.rFore.rotation.set(-p.rEl, 0, 0);
  R.weapon.rotation.set(-p.rWr, 0, p.rWrZ);
  R.lArm.rotation.set(-p.lShF, 0, p.lShZ);
  R.lFore.rotation.set(-p.lEl, 0, 0);
  R.lHand.rotation.set(-p.lWr, 0, 0);

  if (cloth) {
    setChain(R.scarf, clothAngles(u, R.scarf.length, { ripple: 0.16, curlZ: 0.12, base: -0.05, baseZ: -0.3, curl: 0.03, gain: 0.012, zGain: -0.02, lag: 0.05, flut: 0.11, flutF: 12, twistGain: 0.1, hipGain: 0.006, sX: 1.25, sZ: -0.55, sFlut: 0.3 }));
    setChain(R.scarf2, clothAngles(u, R.scarf2.length, { ripple: 0.15, curlZ: 0.1, base: 0.38, baseZ: -0.25, curl: 0.02, gain: 0.01, zGain: -0.016, lag: 0.055, flut: 0.1, flutF: 13, twistGain: 0.08, phase: 1.3, sX: 1.1, sZ: -0.35, sFlut: 0.28 }));
    setChain(R.mantle, clothAngles(u, R.mantle.length, { ripple: 0.08, curlZ: 0.04, base: 0.22, baseZ: -0.52, curl: 0.04, gain: 0.0045, zGain: -0.004, lag: 0.05, flut: 0.06, flutF: 9, twistGain: 0.08, hipGain: 0.005, phase: 2.6, sX: 0.38, sZ: -0.1, sFlut: 0.22 }));
    setChain(R.sashA, clothAngles(u, R.sashA.length, { base: 0.1, baseZ: 0.18, curl: 0.04, gain: 0.01, lag: 0.04, flut: 0.07, flutF: 9, twistGain: 0.1, phase: 0.4, sX: 0.5, sZ: -0.2 }));
    setChain(R.sashB, clothAngles(u, R.sashB.length, { base: 0.1, baseZ: 0.1, curl: 0.04, gain: 0.01, lag: 0.05, flut: 0.07, flutF: 11, twistGain: 0.1, phase: 2.2, sX: 0.5, sZ: -0.2 }));
    setChain(R.flapF, clothAngles(u, R.flapF.length, { base: -0.12, curl: -0.03, gain: 0.006, lag: 0.04, flut: 0.04, flutF: 8, twistGain: 0.04, phase: 0.9 }));
    setChain(R.hipL, clothAngles(u, R.hipL.length, { base: 0.05, baseZ: 0.12, curl: 0.03, gain: 0.006, lag: 0.04, flut: 0.04, flutF: 9, twistGain: 0.05, phase: 1.7 }));
    setChain(R.hipR, clothAngles(u, R.hipR.length, { base: 0.05, baseZ: -0.12, curl: 0.03, gain: 0.006, lag: 0.045, flut: 0.04, flutF: 10, twistGain: 0.05, phase: 2.9 }));
    setChain(R.tailL, clothAngles(u, R.tailL.length, { base: 0.22, baseZ: 0.08, curl: 0.06, gain: 0.012, lag: 0.05, flut: 0.06, flutF: 9, twistGain: 0.08, phase: 3.0, sX: 0.45 }));
    setChain(R.tailR, clothAngles(u, R.tailR.length, { base: 0.25, baseZ: -0.08, curl: 0.06, gain: 0.012, lag: 0.055, flut: 0.06, flutF: 10, twistGain: 0.08, phase: 4.1, sX: 0.45 }));
    R.flapF[0].rotation.x -= p.tPitch * 0.2;
    // mantle hangs with gravity: counter the torso pitch/twist a little
    R.mantle[0].rotation.x -= p.tPitch * 0.6;
  }
  return p;
}
