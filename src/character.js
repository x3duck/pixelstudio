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
uniform float uMetal; uniform float uId; uniform float uHeadMul; uniform float uBias;
uniform vec3 uKey; uniform vec3 uHeadPos; uniform float uHeadI;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = dot(n, uKey) + uBias;
  vec3 c = d > 0.62 ? uLite : (d > 0.16 ? uBase : (d > -0.35 ? uShade : uDeep));
  if (uMetal > 0.5) {
    vec3 sl = normalize(vec3(-0.65, 0.7, 0.3));
    vec3 r = reflect(-sl, n);
    if (r.z > 0.975) c = uHi;
  }
  // flame light: warm banded tint only on faces close to (and turned toward) the head
  vec3 L = uHeadPos - vW;
  float dist = length(L);
  float hd = dot(n, L / max(dist, 0.001));
  float att = clamp(1.0 - dist / 17.0, 0.0, 1.0) * uHeadI * uHeadMul;
  float h = hd * att;
  if (h > 0.22) c = mix(c, c * vec3(1.45, 0.82, 0.68) + vec3(0.08, 0.02, 0.01), 0.36);
  if (h > 0.5) c = mix(c, vec3(0.80, 0.36, 0.22), 0.2 * uMetal + 0.06);
  // alpha carries the material id + a 'faces up' bit for the composite (edge lines, rim rules)
  float up = n.y > 0.3 ? 1.0 : 0.0;
  gl_FragColor = vec4(c, (uId * 2.0 + up + 4.0) / 64.0);
}`;

function hex(h) { return new THREE.Color(h); }
// Material ids (must match MID_* in composite.js): metal = 2,5,6,11,15,17 ; crimson = 7,8
function toon(id, base, opt = {}) {
  const b = hex(base);
  const shade = opt.shade ? hex(opt.shade) : b.clone().multiply(new THREE.Color(0.55, 0.55, 0.72));
  const deep = opt.deep ? hex(opt.deep) : shade.clone().multiplyScalar(0.62);
  const lite = opt.lite ? hex(opt.lite) : b.clone().multiplyScalar(1.45).add(new THREE.Color(0.03, 0.03, 0.045));
  const hi = opt.hi ? hex(opt.hi) : new THREE.Color(0.86, 0.89, 0.95);
  return new THREE.ShaderMaterial({
    vertexShader: toonVert, fragmentShader: toonFrag,
    uniforms: {
      uBase: { value: b }, uShade: { value: shade }, uLite: { value: lite }, uHi: { value: hi }, uDeep: { value: deep },
      uMetal: { value: opt.metal ? 1 : 0 }, uId: { value: id }, uHeadMul: { value: opt.noHead ? 0 : 1 },
      uBias: { value: opt.bias ?? 0 },
      ...toonShared,
    },
    side: THREE.DoubleSide,
  });
}

// ---------- palette of materials ----------
// Near-black charcoal coat, desaturated navy trousers (the medium clothing shape), light gray-blue plates,
// dark gunmetal; crimson is the only saturated family and is kept small (scarf, sash knot).
const M = {
  coat: toon(0, '#1d1b27', { lite: '#302d42', shade: '#121018', deep: '#0a090e', bias: -0.14 }),
  coat2: toon(1, '#33294a', { lite: '#463a62', shade: '#1c1727', deep: '#0f0c15' }),
  plate: toon(2, '#4c5468', { lite: '#717a90', shade: '#2c3140', deep: '#171a23', hi: '#9aa3b6', metal: true }),
  navy: toon(3, '#25314f', { lite: '#2f3d63', shade: '#1b2238', deep: '#111628' }),
  navyDark: toon(4, '#1c2440', { lite: '#27304f', shade: '#141a2d', deep: '#0d111e' }),
  metal: toon(5, '#2c303e', { lite: '#4f566b', shade: '#181b24', deep: '#0d0f15', hi: '#dde2ec', metal: true }),
  metalDark: toon(6, '#191c26', { lite: '#2e3344', shade: '#10121a', deep: '#0a0b10', hi: '#a9b1c2', metal: true }),
  crimson: toon(7, '#a8162a', { lite: '#d82a34', shade: '#5a0c1c', deep: '#340712' }),
  crimsonDark: toon(8, '#7c1222', { lite: '#a01c2a', shade: '#400a16', deep: '#26060f' }),
  leather: toon(9, '#211a1e', { lite: '#352a2d', shade: '#151013', deep: '#0c090b' }),
  cuff: toon(10, '#3a2e31', { lite: '#4e3e3e', shade: '#221a1d', deep: '#140f11' }),
  blade: toon(11, '#59627a', { lite: '#6f7a92', shade: '#3a4152', deep: '#232836', hi: '#c8d0de', metal: true }),
  dark: toon(12, '#121219', { lite: '#1d1d27', shade: '#0b0b10', deep: '#07070a' }),
  collar: toon(13, '#101017', { lite: '#1a1a24', shade: '#0b0b10', deep: '#07070a', noHead: true }),
  plum: toon(14, '#2a1d30', { lite: '#38263f', shade: '#1a1220', deep: '#100b14' }),
  edge: toon(15, '#dde2ec', { lite: '#f2f4f8', shade: '#c2cadb', deep: '#a9b1c2', hi: '#ffffff', metal: true, noHead: true }),
  bone: toon(16, '#b4ae9f', { lite: '#d9d3c3', shade: '#7c776f', deep: '#4a4646' }),
  ridge: toon(17, '#8a93a8', { lite: '#b7bfcf', shade: '#5f677b', deep: '#3a4050', hi: '#dde2ec', metal: true }),
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
function raggedPts(w0, w1, len, seed = 0, notch = 3.0) {
  const sx = (y) => (w0 + (w1 - w0) * (-y / len)) / 2;
  const j = (k) => 0.12 * Math.sin(seed * 7.1 + k * 3.7);
  const nd = Math.min(notch, len * 0.35);   // notch depth (art px)
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
function clothChain(parent, pos, segs, mat, { thick = 1.2, tatter = true, lining = null, seed = 0, notch = 3.0 } = {}) {
  const out = [];
  let p = group(parent, pos);
  p.rotation.order = 'ZXY';
  for (let i = 0; i < segs.length; i++) {
    const [w0, w1, len] = segs[i];
    const last = i === segs.length - 1;
    let geo;
    if (last && tatter) {
      geo = extrude(raggedPts(w0, w1, len, seed + i, notch), thick);
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
    if (lining) mesh(geo, lining, p, [0, 0.4, -thick * 0.85], [0, 0, 0], [1.07, 1.04, 0.6]);
    out.push(p);
    if (!last) { const n = group(p, [0, -len + 0.3, 0]); n.rotation.order = 'ZXY'; p = n; }
  }
  return out;
}

// ---------- build ----------
export const DIM = { HIP: 44, HX: 5.0, L1: 18, L2: 18, ANK: 8 };
const LY = 18 / 17;   // leg profile stretch

export function buildCharacter() {
  const R = {};
  const root = new THREE.Group(); root.name = 'CharacterRoot';
  R.root = root;
  const tilt = group(root, [0, 0, 0], 'tilt');
  tilt.rotation.x = 0.1;
  root.scale.setScalar(ROOT_SCALE);
  R.tilt = tilt;

  // pelvis (narrow: the waist steps in clearly under the chest)
  const pelvis = group(tilt, [0, DIM.HIP, 0], 'Pelvis');
  R.pelvis = pelvis;
  mesh(tbox(10.5, 7, 8.5, { tx: 0.78, tz: 0.9 }), M.navyDark, pelvis, [0, 1, 0]);

  // ---- legs: desaturated navy trousers (slimmer balloon) into heavy boots ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const hip = group(pelvis, [sx * DIM.HX, 0, 0], side + 'Thigh');
    hip.rotation.order = 'ZXY';
    mesh(lathe([[0.1, 1.5], [3.8, 1.5], [4.3, -3], [5.0, -9], [5.7, -14], [5.9, -17], [0.1, -18.5]].map(([r, y]) => [r, y * LY]), 7, side === 'l' ? 0.3 : 0.1),
      M.navy, hip, [0, 0, 0]);
    const knee = group(hip, [0, -DIM.L1, 0], side + 'Shin');
    mesh(lathe([[0.1, 1.5], [5.9, 1.0], [6.0, -1.5], [5.3, -4.5], [4.3, -7.5], [3.4, -10], [3.1, -11], [0.1, -11.5]].map(([r, y]) => [r, y * LY]), 7, 0.2),
      M.navy, knee, [0, 0, 0]);
    // dark ankle wrap (about half the knee balloon), then a 1 px pinch above the boot cuff
    mesh(lathe([[3.1, -10.6], [3.6, -11.6], [3.3, -12.7]], 7, 0.5), M.cuff, knee, [0, 0, 0]);
    mesh(lathe([[2.5, -12.5], [2.5, -14.2]], 7, 0.5), M.dark, knee, [0, 0, 0]);
    const ankle = group(knee, [0, -DIM.L2, 0], side + 'Boot');
    mesh(lathe([[0.1, 3.9], [5.0, 3.9], [5.4, 2.6], [4.7, 1.8], [4.8, -3], [5.2, -6], [0.1, -6]], 6, 0.3), M.leather, ankle, [0, 0, 0]);
    // chunky folded cuff (one value step lighter)
    mesh(lathe([[5.0, 4.0], [6.2, 3.3], [6.4, 2.2], [5.5, 1.4]], 6, 0.3), M.cuff, ankle, [0, 0, 0]);
    mesh(tbox(7.6, 5.5, 14.5, { tx: 0.9, tz: 0.75, shiftTopZ: -1.5 }), M.leather, ankle, [0, -5.2, 3.0]);
    mesh(tbox(8.0, 1.7, 15.5), M.dark, ankle, [0, -7.6, 3.4]);
    // toe cap jutting forward
    mesh(tbox(7.0, 3.2, 4.6, { tx: 0.82, tz: 0.8 }), M.metal, ankle, [0, -5.9, 10.2], [0.18, 0, 0]);
    R[side + 'Thigh'] = hip; R[side + 'Shin'] = knee; R[side + 'Boot'] = ankle;
  }

  // ---- waist: narrow dark-crimson sash with a centre-front knot + short dangling tail ----
  const sashY = 4.6;
  mesh(lathe([[4.5, 1.7], [5.0, 0.7], [5.0, -1.1], [4.6, -1.9]], 8, 0.2), M.crimsonDark, pelvis, [0, sashY, 0]);
  mesh(tbox(3.4, 3.2, 2.6, { tx: 0.75 }), M.crimson, pelvis, [0.8, sashY - 0.4, 4.9], [0, 0.2, 0.25]);
  R.sashA = clothChain(pelvis, [1.2, sashY - 1.8, 5.2], [[2.6, 2.3, 3.5], [2.3, 1.8, 3.5]], M.crimsonDark, { seed: 1 });
  // belt pouch on the right hip
  mesh(tbox(3.6, 4.6, 3.2, { tx: 0.9 }), M.leather, pelvis, [-5.4, sashY - 4.2, 2.6], [0, 0, -0.15]);
  mesh(tbox(4.0, 1.3, 3.6), M.metalDark, pelvis, [-5.4, sashY - 2.0, 2.6], [0, 0, -0.15]);
  // ragged coat skirt: one long torn flap on the near side (asymmetric), a near hip panel, back tails
  R.flapF = clothChain(pelvis, [-5.6, 2.0, 4.4], [[5.2, 5.4, 5], [5.4, 4.6, 6.5]], M.coat2, { thick: 1.0, seed: 3 });
  R.hipR = clothChain(pelvis, [-6.0, 2.5, 0.6], [[5, 5.5, 7], [5.5, 5, 6]], M.coat, { thick: 1.0, seed: 5 });
  R.tailL = clothChain(pelvis, [4.2, 3, -4.6], [[7, 7, 8], [7, 6.5, 8], [6.5, 6, 8]], M.coat, { thick: 1.0, seed: 6 });
  R.tailR = clothChain(pelvis, [-4.2, 3, -4.6], [[7, 6.8, 8], [6.8, 6.4, 8], [6.4, 5.5, 8]], M.coat, { thick: 1.0, seed: 7 });

  // ---- spine / chest: V taper, moderate shoulders ----
  const spine = group(pelvis, [0, 5.5, 0], 'Torso');
  spine.rotation.order = 'YXZ';
  R.spine = spine;
  mesh(tbox(7.6, 8, 7.0, { tx: 1.4, tz: 1.12 }), M.coat, spine, [0, 3.5, 0]);
  const chest = group(spine, [0, 7.5, 0], 'Chest');
  R.chest = chest;
  mesh(tbox(11, 14, 9.6, { tx: 1.45, tz: 1.12 }), M.coat, chest, [0, 6.5, -0.5]);
  // layered breastplate: two angled halves meeting in a centre ridge, pointed lower edge
  const half = [[0, 12.5], [7.6, 11.6], [7.2, 6.0], [4.8, 1.2], [0, -1.6]];
  const bpR = group(chest, [0, 1.8, 5.6]);
  bpR.rotation.x = -0.06;
  mesh(extrude(half.map(([x, y]) => [-x, y]), 2.6), M.plate, bpR, [0, 0, 0], [0, -0.26, 0]);
  mesh(extrude(half, 2.6), M.plate, bpR, [0, 0, 0], [0, 0.26, 0]);
  // bright ridge highlight down the centre
  mesh(tbox(0.9, 11.5, 1.2), M.ridge, bpR, [0, 5.6, 1.5]);
  // fauld lame below the plate (near-black)
  mesh(tbox(9, 2.4, 2.2, { tx: 1.12 }), M.metalDark, chest, [0, 0.0, 4.7], [-0.08, 0, 0]);
  // coat lapels: a V of dark cloth framing the collar, inner edge in plate gray
  mesh(tbox(2.4, 9, 1.6, { tx: 1.8 }), M.coat2, chest, [-5.6, 9.2, 5.6], [0.0, 0.35, -0.42]);
  mesh(tbox(2.4, 9, 1.6, { tx: 1.8 }), M.coat2, chest, [5.6, 9.2, 5.4], [0.0, -0.35, 0.42]);
  // under-chest strap
  mesh(tbox(11.4, 1.4, 10.8, { tx: 1.05 }), M.dark, chest, [0, 1.6, -0.4]);
  // back plate + shoulder yoke (near-black gorget)
  mesh(tbox(13, 12, 3, { tx: 1.2 }), M.metalDark, chest, [0, 7, -5.6]);
  R.yoke = mesh(tbox(22, 4, 10.5, { tx: 0.88 }), M.metalDark, chest, [0, 13, -0.6]);

  // collar / neck: dark flared collar the flame rises from (no warm band)
  const neck = group(chest, [0, 15, 0.5], 'Neck');
  R.neck = neck;
  mesh(lathe([[5.2, -1.5], [6.3, 0.8], [7.2, 2.8], [6.5, 3.4], [0.1, 1.8]], 7, 0.2), M.collar, neck, [0, 0, 0]);
  mesh(lathe([[6.5, -1.2], [7.4, 0.0], [7.0, 1.4]], 7, 0.0), M.metalDark, neck, [0, 0, 0]);
  const headAnchor = group(neck, [0, 2.6, 0.8], 'HeadEnergyRoot');
  R.head = headAnchor;
  const headLight = group(neck, [0, 10, 1.5], 'HeadLight');
  R.headLight = headLight;

  // scarf: a crimson wrap band across the front of the collar + two short tails off the near/back shoulder
  mesh(lathe([[7.0, -0.2], [8.0, -1.1], [7.8, -2.8], [6.6, -3.3]], 8, 0.4), M.crimson, neck, [0, 0.4, 0.3], [0.22, 0, -0.1]);
  R.scarf = clothChain(neck, [-7.2, -1.0, -3.0], [[5.0, 4.6, 4.5], [4.6, 4.3, 4.5], [4.3, 4.1, 4.5], [4.1, 4.0, 4.5], [4.0, 3.9, 4.5], [3.9, 5.4, 5.5]], M.crimson, { thick: 1.3, seed: 8, notch: 2.6 });
  R.scarf2 = clothChain(neck, [-3.6, -2, -4.6], [[3.4, 3.0, 5.5], [3.0, 2.6, 5.5], [2.6, 2.3, 5.5], [2.3, 2.0, 5.5]], M.crimsonDark, { thick: 1.2, seed: 9 });

  // tattered half-mantle hanging behind the near shoulder (frames the body), plum lining at the edges
  R.mantle = clothChain(chest, [-8.6, 14.0, -4.8], [[10, 10.5, 8], [10.5, 9.5, 9], [9.5, 8.5, 14]], M.coat, { thick: 1.2, lining: M.plum, seed: 10, notch: 5.5 });

  // ---- arms ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const sh = group(chest, [sx * 10.4, 11.5, -0.5], side + 'Arm');
    sh.rotation.order = 'ZXY';
    mesh(lathe([[0.1, 2], [3.6, 2], [4.2, -3], [4.0, -8], [3.3, -11.5], [0.1, -12]], 6, 0.3), M.coat2, sh, [0, 0, 0]);
    const el = group(sh, [0, -11.5, 0], side + 'Fore');
    // oversized gauntlet with a hard flared cuff
    mesh(lathe([[0.1, 1.5], [3.4, 1.5], [3.9, -2], [4.9, -5.5], [6.3, -8.4], [6.6, -10.0], [5.5, -10.9], [0.1, -11.2]], 6, 0.5), M.plate, el, [0, 0, 0]);
    mesh(lathe([[3.9, -2.0], [4.7, -3.2], [4.3, -4.4]], 6, 0.5), M.dark, el, [0, 0, 0]);
    const hand = group(el, [0, -12, 0], side + 'Hand');
    if (side === 'r') {
      // armoured fist around the grip
      mesh(tbox(7.0, 7.4, 8.0, { tx: 0.92 }), M.metalDark, hand, [0, -1.8, 0.4]);
      mesh(tbox(7.4, 2.2, 8.4), M.metal, hand, [0, 1.0, 0.4]);
      mesh(tbox(2.4, 4.0, 3.0), M.metal, hand, [-3.2, -1.0, 2.6], [0, 0, 0.3]);  // thumb plate
    } else {
      // open claw: a short dark palm + four splayed fingers (1 px gaps) with pale claw tips
      mesh(tbox(6.4, 4.4, 7.0, { tx: 1.05 }), M.metalDark, hand, [0, -0.6, 0.3]);
      const fz = [-3.9, -1.3, 1.3, 3.9];
      for (let i = 0; i < 4; i++) {
        const f = group(hand, [0.4, -2.6, fz[i] + 0.3]);
        f.rotation.set(0.3 * (i - 1.5), 0, 0.15 + 0.06 * i);
        mesh(tbox(1.7, 4.4, 1.5, { pivot: 'top' }), M.metalDark, f, [0, 0, 0]);
        const f2 = group(f, [0, -4.2, 0]);
        f2.rotation.set(0, 0, 0.6);
        mesh(flat(new THREE.ConeGeometry(0.85, 3.2, 4).translate(0, -1.6, 0).rotateX(Math.PI)), M.bone, f2, [0, 0, 0]);
      }
      const th = group(hand, [-2.6, -0.6, 3.6]);
      th.rotation.set(0.6, 0, -0.6);
      mesh(tbox(1.7, 4.2, 1.6, { pivot: 'top' }), M.metalDark, th, [0, 0, 0]);
    }
    R[side + 'Arm'] = sh; R[side + 'Fore'] = el; R[side + 'Hand'] = hand;
  }

  // ---- pauldrons (asymmetric) ----
  // layered pauldron on the far (left) shoulder with a swept horn crest (scaled down for a leaner silhouette)
  const pl = group(R.lArm, [0.6, 1.2, 0], 'PauldronL');
  pl.rotation.z = -0.35;
  pl.scale.setScalar(0.85);
  R.pl = pl;
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
  const pr = group(R.rArm, [-0.6, 1.4, 0], 'PauldronR');
  pr.rotation.z = 0.3;
  pr.scale.setScalar(1.0);
  R.pr = pr;
  // layered: a dark dome over a lighter lame that overhangs the upper arm by 3-4 px
  mesh(dome(7.4, 6, 2), M.metalDark, pr, [-1.2, 0, 0], [0, 0, 0], [1.12, 0.72, 1.05]);
  mesh(dome(7.8, 6, 2, Math.PI / 2), M.metal, pr, [-2.0, -3.2, 0], [0, 0, 0], [1.05, 0.4, 1.0]);
  mesh(tbox(2.5, 9, 7), M.leather, pr, [-3.5, -5, 0], [0, 0, 0.25]);

  // ---- weapon: short, slightly curved blade: bright 1 px edge / mid-gray flat / dark spine ----
  const weapon = group(R.rHand, [0, -1.5, 0.4], 'WeaponRoot');
  weapon.rotation.order = 'XZY';
  R.weapon = weapon;
  mesh(tbox(2.0, 2.0, 7), M.crimsonDark, weapon, [0, 0, -0.5]);
  mesh(tbox(3.0, 3.0, 2.2), M.metal, weapon, [0, 0, -4.6]); // pommel
  mesh(tbox(2.4, 7.5, 2.2, { tx: 0.8 }), M.metalDark, weapon, [0, 0.3, 4.2]);
  const s = new THREE.Shape();
  s.moveTo(0, -1.2); s.lineTo(12, -1.4); s.lineTo(19, -1.7); s.lineTo(23.5, -0.9);
  s.lineTo(25.5, 0.9); s.lineTo(20, 1.3); s.lineTo(9, 1.2); s.lineTo(0, 1.1); s.lineTo(0, -1.2);
  let bg = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false });
  bg.translate(0, 0, -0.6);
  bg.rotateY(-Math.PI / 2); // shape x -> +z
  bg = flat(bg);
  mesh(bg, M.blade, weapon, [0, 0, 5.2]);
  mesh(tbox(1.4, 0.7, 23), M.edge, weapon, [0, -1.45, 16.4], [0.02, 0, 0]);   // cutting edge
  mesh(tbox(1.4, 0.7, 17), M.dark, weapon, [0, 1.35, 13.9]);                 // spine line
  R.bladeTip = group(weapon, [0, 0.5, 29.9], 'tip');
  R.bladeMid = group(weapon, [0, 0, 11.4], 'mid');
  R.bladeEdge = group(weapon, [0, -1.5, 22.0], 'edge');

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return R;
}

// ---------- leg IK ----------
// Two-bone solve in the hip's vertical plane, then the whole leg is swivelled about the hip->ankle axis
// (knees bow outward so the bend reads in the picture plane, not only in depth). The boot is set to a
// flat, yawed orientation (turn-out) independent of the leg chain.
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _ax = new THREE.Vector3(), _eu = new THREE.Euler(), _ez = new THREE.Euler();
function solveLeg(thigh, shin, boot, hipPos, target, toe, swivel, footYaw, roll) {
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
  _qb.multiply(_qa);                                  // thigh orientation in the (unrolled) hip frame
  shin.rotation.set(knee, 0, 0);
  // boot: flat on the floor (keeps 20% of the sideways leg lean), toe pitch + yaw turn-out
  _eu.set(toe - 0.1, footYaw, 0.2 * gamma, 'YXZ'); _qc.setFromEuler(_eu);
  _qa.copy(_qb).multiply(shin.quaternion).invert();
  boot.quaternion.multiplyQuaternions(_qa, _qc);
  // the pelvis is rolled: counter-rotate the thigh about z (outermost)
  _ez.set(0, 0, -roll); _qa.setFromEuler(_ez);
  thigh.quaternion.multiplyQuaternions(_qa, _qb);
}

// ---------- apply pose ----------
const _hip = new THREE.Vector3(), _tgt = new THREE.Vector3();
const TILT_C = Math.cos(0.1), TILT_S = Math.sin(0.1), ANK_W = DIM.ANK * TILT_C;

// cloth: pure function of u (lagged samples of the drive signals), written straight into the chain
const CLOTH_DEF = { droop: 0, ripple: 0, curlZ: 0, zGain: 0, base: 0.0, baseZ: 0, curl: 0.05, gain: 0.012, lag: 0.045, flut: 0.12, flutF: 10, twistGain: 0.08, hipGain: 0.01, phase: 0, sX: 0, sZ: 0, sFlut: 0.25, sway: 0 };
const cp = (o) => Object.assign({}, CLOTH_DEF, o);
function clothApply(chain, u, P) {
  const n = chain.length;
  const sway = P.sway * Math.sin(TAU * 2 * u / LOOP + P.phase);
  for (let i = 0; i < n; i++) {
    const d = drive(u - P.lag * (i + 1));
    const k = (i + 1) / n;
    const st = d.stream;
    // soft-limit the torso-twist drive so the whip never flicks the cloth straight up
    const vT = 4 * Math.tanh(d.vTwist / 4);
    // travel drive by magnitude: backing off lifts the cloth off the back exactly like walking forward,
    // instead of folding it into the body
    const vTr = Math.abs(d.vTravel) * (d.vTravel < 0 ? 0.85 : 1.0);
    let ax = (i === 0 ? P.base + sway : P.curl)
      + P.gain * vTr * (i === 0 ? 1.0 : 0.3)
      + P.hipGain * d.vHip
      + P.flut * Math.sin(TAU * P.flutF * u / LOOP - i * 0.9 + P.phase) * (0.4 + k) + P.ripple * Math.sin(TAU * (P.flutF + 4) * u / LOOP - i * 1.6 + P.phase) * k;
    let az = (i === 0 ? P.baseZ : P.curlZ) + P.zGain * vTr * (0.5 + 0.5 * k) - P.twistGain * vT * (0.4 + k) * 0.5
      + P.flut * 0.6 * Math.sin(TAU * (P.flutF - 3) * u / LOOP - i * 0.7 + P.phase * 1.7) + P.ripple * Math.sin(TAU * P.flutF * u / LOOP - i * 1.3 + P.phase * 2.3) * (0.3 + k);
    if (i > 0) az += P.droop * k * k * (1 - 0.8 * st);   // tip segments fall back toward vertical
    if (st > 0) {
      // flag streaming during the strike/hold (lagged per segment so it unrolls)
      const wave = Math.sin(TAU * 24 * u / LOOP - i * 1.25 + P.phase);
      ax += st * ((i === 0 ? P.sX : -0.06 * P.sX) + P.sFlut * wave * k);
      az += st * ((i === 0 ? P.sZ : P.sZ * 0.08) + P.sFlut * 0.5 * Math.sin(TAU * 20 * u / LOOP - i * 1.1 + P.phase) * k);
      if (i > 0 && st > 0.05) az = clamp(az, -0.5, 0.6);   // stays near horizontal behind the strike
    }
    chain[i].rotation.x = clamp(ax, -1.3, 1.6);
    chain[i].rotation.z = clamp(az, -1.4, 1.0);
  }
}

const CP = {
  scarf: cp({ droop: 0.5, ripple: 0.06, curlZ: 0.0, base: 1.4, baseZ: -1.4, curl: -0.1, gain: 0.006, zGain: -0.008, lag: 0.05, flut: 0.06, flutF: 12, twistGain: 0.1, hipGain: 0.003, sX: -0.9, sZ: -0.6, sFlut: 0.3, sway: 0.12 }),
  scarf2: cp({ ripple: 0.13, curlZ: 0.08, base: 0.3, baseZ: -0.2, curl: 0.02, gain: 0.0045, zGain: -0.005, lag: 0.055, flut: 0.17, flutF: 13, twistGain: 0.08, phase: 1.3, sX: 0.4, sZ: -1.0, sFlut: 0.28, sway: 0.12 }),
  mantle: cp({ ripple: 0.08, curlZ: 0.04, base: 0.22, baseZ: -0.3, curl: 0.04, gain: 0.0045, zGain: -0.004, lag: 0.05, flut: 0.08, flutF: 9, twistGain: 0.08, hipGain: 0.005, phase: 2.6, sX: 0.26, sZ: -0.1, sFlut: 0.22, sway: 0.06 }),
  sashA: cp({ base: 0.1, baseZ: 0.1, curl: 0.04, gain: 0.01, lag: 0.04, flut: 0.09, flutF: 9, twistGain: 0.1, phase: 0.4, sX: 0.5, sZ: -0.2 }),
  flapF: cp({ base: -0.1, curl: -0.02, gain: 0.006, lag: 0.04, flut: 0.05, flutF: 8, twistGain: 0.04, phase: 0.9, sX: 0.25 }),
  hipR: cp({ base: 0.05, baseZ: -0.12, curl: 0.03, gain: 0.006, lag: 0.045, flut: 0.05, flutF: 10, twistGain: 0.05, phase: 2.9 }),
  tailL: cp({ base: 0.22, baseZ: 0.32, curl: 0.06, gain: 0.012, lag: 0.05, flut: 0.08, flutF: 9, twistGain: 0.08, phase: 3.0, sX: 0.45, sway: 0.05 }),
  tailR: cp({ base: 0.25, baseZ: -0.32, curl: 0.06, gain: 0.012, lag: 0.055, flut: 0.08, flutF: 10, twistGain: 0.08, phase: 4.1, sX: 0.45, sway: 0.05 }),
};

const _p = {};
const LEGS = ['l', 'r'].map((sd) => ({ sx: sd === 'l' ? 1 : -1, fx: sd + 'Fx', fz: sd + 'Fz', lift: sd + 'Lift', toe: sd + 'Toe', sw: sd + 'Sw', fy: sd + 'Fy', thigh: sd + 'Thigh', shin: sd + 'Shin', boot: sd + 'Boot' }));
// applyPose(R, u, {cloth, snap}): snap(x) returns the pixel-snapped root x. The planted feet are
// counter-shifted by the snap offset so they stay fixed in the world while the body snaps.
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
  const br = 1 + 0.025 * p.breathPhase * p.breath;
  R.chest.scale.set(br * (1 + 0.03 * p.squash), 1 - 0.04 * p.squash, br);

  for (let j = 0; j < 2; j++) {
    const L = LEGS[j];
    _hip.set(L.sx * DIM.HX, DIM.HIP + p.hipY, 0);
    _hip.y += L.sx * DIM.HX * Math.sin(p.pRoll);
    const fx = p[L.fx] - dxw * cy, fz = p[L.fz] - dxw * sy;
    // root-local ankle target (fx, floor height + lift, fz) mapped exactly into the tilted body frame,
    // so planted feet stay fixed in the world wherever they are in depth
    const wy = ANK_W + p[L.lift];
    _tgt.set(fx, wy * TILT_C + fz * TILT_S, -wy * TILT_S + fz * TILT_C);
    solveLeg(R[L.thigh], R[L.shin], R[L.boot], _hip, _tgt, p[L.toe], -L.sx * p[L.sw], p[L.fy], p.pRoll);
  }

  // breathing that reads at sprite size: ~1 px shoulder rise, the pauldrons lift a little more on the inhale
  const inh = p.breathPhase * p.breath;
  R.lArm.position.y = 11.5 + 0.3 * inh;
  R.rArm.position.y = 11.5 + 0.3 * inh;
  R.pl.position.y = 1.2 + 0.5 * Math.max(0, inh);
  R.pr.position.y = 1.4 + 0.45 * Math.max(0, inh);
  R.rArm.rotation.set(-p.rShF, 0, p.rShZ);
  R.rFore.rotation.set(-p.rEl, 0, 0);
  R.weapon.rotation.set(-p.rWr, 0, p.rWrZ);
  R.lArm.rotation.set(-p.lShF, p.lShY, p.lShZ);   // lShY: twist about the upper arm (turns the elbow hinge)
  R.lFore.rotation.set(-p.lEl, 0, 0);
  R.lHand.rotation.set(-p.lWr, 0, 0);

  if (cloth) {
    for (const k in CP) clothApply(R[k], u, CP[k]);
    R.flapF[0].rotation.x -= p.tPitch * 0.2;
    // mantle hangs with gravity: counter the torso pitch a little
    R.mantle[0].rotation.x -= p.tPitch * 0.6;
  }
  return p;
}
