import * as THREE from 'three';
import { pose, drive, LOOP, WALK_YAW, clamp, wrap } from './pose.js';

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
uniform float uMetal; uniform float uCode;
uniform vec3 uKey; uniform vec3 uHeadPos; uniform float uHeadI;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = dot(n, uKey);
  vec3 c = d > 0.58 ? uLite : (d > 0.12 ? uBase : (d > -0.4 ? uShade : uDeep));
  if (uMetal > 0.5) {
    vec3 sl = normalize(vec3(-0.65, 0.7, 0.3));
    vec3 r = reflect(-sl, n);
    if (r.z > 0.96) c = uHi;
  }
  // flame light: warm banded tint on faces turned toward the head
  vec3 L = uHeadPos - vW;
  float dist = length(L);
  float hd = dot(n, L / max(dist, 0.001));
  float att = clamp(1.0 - dist / 34.0, 0.0, 1.0) * uHeadI;
  float h = hd * att;
  if (h > 0.18) c = mix(c, c * vec3(1.6, 0.75, 0.6) + vec3(0.16, 0.03, 0.01), 0.55);
  if (h > 0.45) c = mix(c, vec3(0.95, 0.42, 0.22), 0.35 * uMetal + 0.12);
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
      uMetal: { value: opt.metal ? 1 : 0 }, uCode: { value: opt.code ?? 1.0 },
      ...toonShared,
    },
    side: THREE.DoubleSide,
    defines: location.search.includes('dbgn') ? { DBGN: 1 } : {},
  });
}

// ---------- palette of materials ----------
const M = {
  coat: toon('#252432', { lite: '#3c3952', shade: '#15141e', deep: '#0b0a10' }),
  coat2: toon('#2d2940', { lite: '#4a4466', shade: '#1a1826', deep: '#100e17' }),
  navy: toon('#1e2c56', { lite: '#30488a', shade: '#121a36', deep: '#0a0f20' }),
  navyDark: toon('#18213f', { lite: '#283a6a', shade: '#0f1428', deep: '#080b17' }),
  metal: toon('#3e4559', { lite: '#636c88', shade: '#232735', deep: '#13151c', hi: '#e2e8f2', metal: true, code: 0.8 }),
  metalDark: toon('#2a2f40', { lite: '#464d68', shade: '#181b25', deep: '#0e1015', hi: '#aab2c6', metal: true, code: 0.8 }),
  crimson: toon('#a8162a', { lite: '#e8343a', shade: '#5a0c1c', deep: '#340712', code: 0.6 }),
  crimsonDark: toon('#7c1222', { lite: '#b4202e', shade: '#400a16', deep: '#26060f', code: 0.6 }),
  leather: toon('#2e2329', { lite: '#4d3c46', shade: '#1a1317', deep: '#0e0a0c' }),
  wrap: toon('#474b62', { lite: '#767c9a', shade: '#2a2c3a', deep: '#181922' }),
  blade: toon('#5a647a', { lite: '#a8b2c8', shade: '#343a4c', deep: '#20242f', hi: '#ffffff', metal: true, code: 0.8 }),
  dark: toon('#15151d', { lite: '#24242f', shade: '#0d0d12', deep: '#08080b' }),
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

// cloth chain: returns array of segment groups (each pivots at its top)
function clothChain(parent, pos, segs, mat, { thick = 1.2, tatter = true } = {}) {
  const out = [];
  let p = group(parent, pos);
  p.rotation.order = 'ZXY';
  for (let i = 0; i < segs.length; i++) {
    const [w0, w1, len] = segs[i];
    const last = i === segs.length - 1;
    let geo;
    if (last && tatter) {
      // torn end: jagged triangle-ish tip
      const s = new THREE.Shape();
      s.moveTo(-w0 / 2, 0); s.lineTo(w0 / 2, 0); s.lineTo(w1 / 2, -len * 0.75);
      s.lineTo(w1 * 0.1, -len * 0.55); s.lineTo(-w1 * 0.15, -len); s.lineTo(-w1 / 2, -len * 0.6);
      s.lineTo(-w0 / 2, 0);
      geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
      geo.translate(0, 0, -thick / 2);
      geo = flat(geo);
    } else {
      geo = tbox(w0, len, thick, { tx: 1, pivot: 'top' });
      // taper bottom by scaling: rebuild with bottom width
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
    out.push(p);
    if (!last) { const n = group(p, [0, -len + 0.3, 0]); n.rotation.order = 'ZXY'; p = n; }
  }
  return out;
}

// ---------- build ----------
export const DIM = { HIP: 42, HX: 5.5, L1: 17, L2: 17, ANK: 8 };
export const X0 = -34;

export function buildCharacter() {
  const R = {};
  const root = new THREE.Group(); root.name = 'CharacterRoot';
  R.root = root;
  const tilt = group(root, [0, 0, 0], 'tilt');
  tilt.rotation.x = 0.1;
  root.scale.setScalar(1.15);
  R.tilt = tilt;

  // pelvis
  const pelvis = group(tilt, [0, DIM.HIP, 0], 'Pelvis');
  R.pelvis = pelvis;
  mesh(tbox(13, 7, 9, { tx: 0.85, tz: 0.95 }), M.navyDark, pelvis, [0, 1, 0]);

  // ---- legs ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const hip = group(pelvis, [sx * DIM.HX, 0, 0], side + 'Thigh');
    hip.rotation.order = 'ZXY';
    // baggy thigh: balloon toward the knee
    mesh(lathe([[0.1, 1.5], [4.4, 1.5], [5.8, -3], [8.0, -9], [9.0, -13.5], [7.8, -17], [0.1, -18]], 7, side === 'l' ? 0.3 : 0.1),
      M.navy, hip, [0, 0, 0]);
    const knee = group(hip, [0, -DIM.L1, 0], side + 'Shin');
    // shin: bulge just below knee, tucks into the boot
    mesh(lathe([[0.1, 1.5], [8.0, 1.0], [8.5, -2.5], [7.0, -6.5], [4.4, -10.5], [3.4, -13], [0.1, -14]], 7, 0.2),
      M.navy, knee, [0, 0, 0]);
    // fold highlight band on the balloon (cloth wrap)
    mesh(lathe([[4.3, -10.0], [5.0, -11.0], [4.0, -12.2]], 7, 0.5), M.wrap, knee, [0, 0, 0]);
    const ankle = group(knee, [0, -DIM.L2, 0], side + 'Boot');
    // boot shaft with cuff
    mesh(lathe([[0.1, 6.5], [5.4, 6.5], [5.6, 4.5], [4.5, 3.8], [4.6, -3], [5.0, -6], [0.1, -6]], 6, 0.3), M.leather, ankle, [0, 0, 0]);
    mesh(lathe([[5.5, 6.3], [6.0, 5.2], [5.6, 4.3]], 6, 0.3), M.metalDark, ankle, [0, 0, 0]);
    // foot
    mesh(tbox(7.5, 5.5, 14, { tx: 0.9, tz: 0.75, shiftTopZ: -1.5 }), M.leather, ankle, [0, -5.2, 3.0]);
    mesh(tbox(7.8, 1.6, 14.6), M.dark, ankle, [0, -7.6, 3.0]);
    // toe cap
    mesh(tbox(7, 3, 4, { tx: 0.8 }), M.metalDark, ankle, [0, -5.8, 8.4], [0.2, 0, 0]);
    R[side + 'Thigh'] = hip; R[side + 'Shin'] = knee; R[side + 'Boot'] = ankle;
  }

  // ---- waist / sash ----
  const sashY = 4.5;
  mesh(lathe([[6.0, 3], [6.8, 1], [6.9, -1.5], [6.6, -3]], 8, 0.2), M.crimson, pelvis, [0, sashY, 0]);
  // belt buckle plate (metal) on front
  mesh(tbox(3.5, 3.5, 2), M.metal, pelvis, [0.5, sashY - 0.5, 6.4]);
  // sash knot on left hip + hanging tails
  mesh(tbox(4.5, 4, 4, { tx: 0.7 }), M.crimson, pelvis, [6.4, sashY - 1, 3.0], [0, 0, 0.3]);
  R.sashA = clothChain(pelvis, [7.2, sashY - 2.5, 3.0], [[4, 3.6, 7], [3.6, 3.0, 7], [3.0, 2.6, 7]], M.crimson);
  R.sashB = clothChain(pelvis, [6.8, sashY - 2.5, 0.5], [[3.2, 2.8, 6], [2.8, 2.4, 6], [2.4, 2.2, 5]], M.crimsonDark);
  // belt pouch on the right hip + small metal ring
  mesh(tbox(4, 5, 3.5, { tx: 0.9 }), M.leather, pelvis, [-6.8, sashY - 4.5, 2.5], [0, 0, -0.15]);
  mesh(tbox(4.4, 1.4, 3.9), M.metalDark, pelvis, [-6.8, sashY - 2.2, 2.5], [0, 0, -0.15]);
  // front loincloth flap (dark)
  R.flapF = clothChain(pelvis, [0, 1.5, 6.4], [[9, 8, 8], [8, 7, 7], [7, 6, 6]], M.coat2, { thick: 1.0 });
  // back coat tails (two, charcoal)
  R.tailL = clothChain(pelvis, [3.5, 3, -5.6], [[8, 8, 9], [8, 7, 9], [7, 6, 8]], M.coat, { thick: 1.0 });
  R.tailR = clothChain(pelvis, [-3.5, 3, -5.6], [[8, 7.5, 9], [7.5, 7, 8], [7, 5, 7]], M.coat, { thick: 1.0 });

  // ---- spine / chest ----
  const spine = group(pelvis, [0, 5.5, 0], 'Torso');
  spine.rotation.order = 'YXZ';
  R.spine = spine;
  // abdomen (narrow) and chest (broad) - charcoal coat
  mesh(tbox(10.5, 8, 8.5, { tx: 1.4, tz: 1.15 }), M.coat, spine, [0, 3.5, 0]);
  const chest = group(spine, [0, 7.5, 0], 'Chest');
  R.chest = chest;
  mesh(tbox(15, 14, 11, { tx: 1.6, tz: 1.1 }), M.coat, chest, [0, 6.5, -0.5]);
  // breastplate (gunmetal) front, slightly asymmetric
  mesh(tbox(12, 10, 3, { tx: 1.45, tz: 0.6, shiftTopZ: 0.8 }), M.metal, chest, [0.8, 7.5, 6.3], [-0.12, 0, 0]);
  // lower plate lame + rivet
  mesh(tbox(10, 3, 2.5, { tx: 1.15 }), M.metalDark, chest, [0.6, 1.6, 6.0], [-0.05, 0, 0]);
  // coat lapel folds (lighter cloth wedges) beside the plate
  mesh(tbox(3.5, 12, 2, { tx: 1.8 }), M.coat2, chest, [-8.6, 7, 4.8], [0, 0.3, -0.12]);
  mesh(tbox(3.5, 12, 2, { tx: 1.8 }), M.coat2, chest, [9.2, 7, 4.6], [0, -0.3, 0.12]);
  // chest strap (diagonal) leather
  mesh(tbox(3, 22, 1.5), M.leather, chest, [0, 6, 7.1], [0, 0, 0.75]);
  // back plate
  mesh(tbox(16, 12, 3, { tx: 1.2 }), M.metalDark, chest, [0, 7, -6.0]);
  // shoulder yoke
  mesh(tbox(27, 4, 11, { tx: 0.9 }), M.coat2, chest, [0, 13, -0.5]);

  // collar / neck (dark high collar the flame rises from)
  const neck = group(chest, [0, 15, 0.5], 'Neck');
  R.neck = neck;
  mesh(lathe([[5.5, -1], [6.2, 2], [6.8, 4.5], [6.0, 5.2], [0.1, 5.2]], 7, 0.2), M.dark, neck, [0, 0, 0]);
  mesh(lathe([[6.8, 0], [7.5, 1.5], [7.0, 3.2]], 7, 0.0), M.metalDark, neck, [0, 0, 0]);
  const headAnchor = group(neck, [0, 5.0, 0.8], 'HeadEnergyRoot');
  R.head = headAnchor;
  const headLight = group(neck, [0, 12, 1.5], 'HeadLight');
  R.headLight = headLight;

  // scarf around the collar (crimson) + long tail off the right shoulder
  mesh(lathe([[7.2, 0.5], [8.4, -1], [8.5, -3.2], [7.0, -4]], 8, 0.4), M.crimson, neck, [0, 1.5, 0], [0.12, 0, -0.1]);
  R.scarf = clothChain(neck, [-5.5, -1, -4.5], [[8, 6.5, 6], [6.5, 6, 6], [6, 5, 6], [5, 5.5, 6], [5.5, 4, 6], [4, 3.5, 6], [3.5, 3.5, 7]], M.crimson, { thick: 1.3 });
  R.scarf2 = clothChain(neck, [-3, -1.5, -6], [[4, 3.6, 6], [3.6, 3.2, 6], [3.2, 2.6, 6], [2.6, 2.4, 6]], M.crimsonDark, { thick: 1.2 });

  // ---- arms ----
  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? 1 : -1;
    const sh = group(chest, [sx * 13.5, 11.5, -0.5], side + 'Arm');
    sh.rotation.order = 'ZXY';
    // upper arm: puffy sleeve
    mesh(lathe([[0.1, 2], [3.8, 2], [4.4, -3], [4.2, -8], [3.4, -11.5], [0.1, -12]], 6, 0.3), M.coat2, sh, [0, 0, 0]);
    const el = group(sh, [0, -11.5, 0], side + 'Fore');
    // oversized gauntlet, flares toward the wrist
    mesh(lathe([[0.1, 1.5], [3.4, 1.5], [3.8, -2], [4.8, -7.5], [5.5, -9.5], [5.0, -10.8], [0.1, -11]], 6, 0.5), M.metal, el, [0, 0, 0]);
    mesh(lathe([[3.6, -2.5], [4.2, -3.6], [3.8, -4.6]], 6, 0.5), M.wrap, el, [0, 0, 0]);
    const hand = group(el, [0, -12, 0], side + 'Hand');
    mesh(tbox(5.5, 6, 6.2, { tx: 0.9 }), M.leather, hand, [0, -1.5, 0.3]);
    mesh(tbox(5.8, 2, 6.6), M.metalDark, hand, [0, 1, 0.3]);
    R[side + 'Arm'] = sh; R[side + 'Fore'] = el; R[side + 'Hand'] = hand;
  }

  // ---- pauldrons (asymmetric) ----
  // big layered pauldron on the left shoulder (far side, screen right)
  const pl = group(R.lArm, [1.0, 1.5, 0], 'PauldronL');
  pl.rotation.z = -0.35;
  mesh(dome(10.5, 7, 3), M.metal, pl, [1.5, 0, 0], [0, 0, 0], [1.05, 0.72, 1.0]);
  mesh(dome(11.5, 7, 2, Math.PI / 2), M.metalDark, pl, [2.5, -3.6, 0], [0, 0, 0], [1.0, 0.45, 1.0]);
  mesh(dome(11.0, 7, 2, Math.PI / 2), M.metal, pl, [3.5, -6.6, 0], [0, 0, 0], [0.95, 0.4, 0.95]);
  // crest spike
  mesh(flat(new THREE.ConeGeometry(2.4, 8, 4)), M.metal, pl, [1.0, 7.5, -1.5], [0, 0.4, -0.35]);
  mesh(flat(new THREE.ConeGeometry(1.8, 6, 4)), M.metalDark, pl, [5.0, 5.0, -2], [0, 0.4, -0.75]);
  // small pauldron on the right (sword arm, near side)
  const pr = group(R.rArm, [-0.5, 1.5, 0], 'PauldronR');
  pr.rotation.z = 0.25;
  mesh(dome(6.5, 6, 2), M.metalDark, pr, [-0.8, 0, 0], [0, 0, 0], [1.0, 0.75, 1.0]);
  mesh(tbox(2.5, 9, 7), M.leather, pr, [-3.5, -4, 0], [0, 0, 0.25]);

  // ---- weapon: short, broad, slightly curved blade ----
  const weapon = group(R.rHand, [0, -1.5, 0.3], 'WeaponRoot');
  weapon.rotation.order = 'XZY';
  R.weapon = weapon;
  // grip (along +z)
  mesh(tbox(2.2, 2.2, 7), M.crimsonDark, weapon, [0, 0, -0.5]);
  mesh(tbox(3.2, 3.2, 2.4), M.metal, weapon, [0, 0, -4.4]); // pommel
  // guard
  mesh(tbox(2.6, 9, 2.4, { tx: 0.8 }), M.metal, weapon, [0, 0.5, 3.8]);
  // blade as an extruded falchion profile in (z, y), extruded across x
  const s = new THREE.Shape();
  s.moveTo(0, -2.4); s.lineTo(12, -3.0); s.lineTo(19, -3.6); s.lineTo(23.5, -2.0);
  s.lineTo(25.5, 1.4); s.lineTo(20, 2.8); s.lineTo(9, 2.6); s.lineTo(0, 2.4); s.lineTo(0, -2.4);
  let bg = new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: false });
  bg.translate(0, 0, -0.8);
  bg.rotateY(-Math.PI / 2); // shape x -> +z
  bg = flat(bg);
  mesh(bg, M.blade, weapon, [0, 0, 4.8]);
  // fuller / back spine darker strip
  mesh(tbox(1.9, 1.2, 17), M.metalDark, weapon, [0, 1.6, 13.5]);
  R.bladeTip = group(weapon, [0, 0.5, 29.5], 'tip');
  R.bladeMid = group(weapon, [0, 0, 11], 'mid');

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
  boot.rotation.set(hipF - knee + toe, 0, -gamma * 0.8);
}

// ---------- apply pose ----------
const _hip = new THREE.Vector3(), _tgt = new THREE.Vector3();

function setChain(chain, angles) {
  for (let i = 0; i < chain.length; i++) {
    const a = angles[i];
    chain[i].rotation.x = a[0];
    chain[i].rotation.z = a[1];
  }
}

// cloth angles: pure function of u (lagged samples of the drive signals)
function clothAngles(u, n, { ripple = 0, curlZ = 0, zGain = 0, base = 0.0, baseZ = 0, curl = 0.05, gain = 0.012, lag = 0.045, flut = 0.12, flutF = 10, twistGain = 0.08, hipGain = 0.01, phase = 0, side = 0 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = drive(u - lag * (i + 1));
    const k = (i + 1) / n;
    let ax = (i === 0 ? base : curl)
      + gain * d.vTravel * (0.6 + 0.6 * k)
      + hipGain * d.vHip
      + flut * Math.sin(TAU * flutF * u / LOOP - i * 0.9 + phase) * (0.4 + k) + ripple * Math.sin(TAU * (flutF + 4) * u / LOOP - i * 1.6 + phase) * k;
    let az = (i === 0 ? baseZ : curlZ) + zGain * d.vTravel * (0.5 + 0.5 * k) - twistGain * d.vTwist * (0.4 + k) * 0.5
      + flut * 0.6 * Math.sin(TAU * (flutF - 3) * u / LOOP - i * 0.7 + phase * 1.7) + ripple * Math.sin(TAU * flutF * u / LOOP - i * 1.3 + phase * 2.3) * (0.3 + k);
    ax = clamp(ax, -1.3, 1.5); az = clamp(az, -1.0, 1.0);
    out.push([ax, az + side * 0.0]);
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
  // chest breathing (tiny scale)
  const br = 1 + 0.025 * p.breathPhase * p.breath;
  R.chest.scale.set(br, 1, br);

  // legs via IK, hips in tilt-space
  for (const side of ['l', 'r']) {
    const sxs = side === 'l' ? 1 : -1;
    _hip.set(sxs * DIM.HX, DIM.HIP + p.hipY, 0);
    // pelvis roll moves hip heights slightly
    _hip.y += sxs * DIM.HX * Math.sin(p.pRoll);
    _tgt.set(p[side + 'Fx'], DIM.ANK + p[side + 'Lift'], p[side + 'Fz']);
    solveLeg(R[side + 'Thigh'], R[side + 'Shin'], R[side + 'Boot'], _hip, _tgt, p[side + 'Toe']);
    R[side + 'Thigh'].rotation.z -= p.pRoll;
  }

  // arms
  R.rArm.rotation.set(-p.rShF, 0, p.rShZ);
  R.rFore.rotation.set(-p.rEl, 0, 0);
  R.weapon.rotation.set(-p.rWr, 0, p.rWrZ);
  R.lArm.rotation.set(-p.lShF, 0, p.lShZ);
  R.lFore.rotation.set(-p.lEl, 0, 0);
  R.lHand.rotation.set(-p.lWr, 0, 0);

  if (cloth) {
    setChain(R.scarf, clothAngles(u, R.scarf.length, { ripple: 0.22, curlZ: 0.3, base: 0.3, baseZ: -0.95, curl: 0.03, gain: 0.012, zGain: -0.022, lag: 0.05, flut: 0.16, flutF: 12, twistGain: 0.1, hipGain: 0.006 }));
    setChain(R.scarf2, clothAngles(u, R.scarf2.length, { ripple: 0.2, curlZ: 0.22, base: 0.3, baseZ: -0.5, curl: 0.03, gain: 0.01, zGain: -0.016, lag: 0.055, flut: 0.13, flutF: 13, twistGain: 0.08, phase: 1.3 }));
    setChain(R.sashA, clothAngles(u, R.sashA.length, { base: 0.25, baseZ: 0.25, curl: 0.04, gain: 0.012, lag: 0.04, flut: 0.07, flutF: 9, twistGain: 0.1, phase: 0.4 }));
    setChain(R.sashB, clothAngles(u, R.sashB.length, { base: 0.15, baseZ: 0.12, curl: 0.04, gain: 0.011, lag: 0.05, flut: 0.07, flutF: 11, twistGain: 0.1, phase: 2.2 }));
    setChain(R.flapF, clothAngles(u, R.flapF.length, { base: -0.12, curl: -0.03, gain: 0.006, lag: 0.04, flut: 0.04, flutF: 8, twistGain: 0.04, phase: 0.9 }));
    setChain(R.tailL, clothAngles(u, R.tailL.length, { base: 0.22, baseZ: 0.08, curl: 0.06, gain: 0.012, lag: 0.05, flut: 0.06, flutF: 9, twistGain: 0.08, phase: 3.0 }));
    setChain(R.tailR, clothAngles(u, R.tailR.length, { base: 0.25, baseZ: -0.08, curl: 0.06, gain: 0.012, lag: 0.055, flut: 0.06, flutF: 10, twistGain: 0.08, phase: 4.1 }));
    // compensate chain bases for torso pitch so cloth hangs with gravity-ish
    R.flapF[0].rotation.x -= p.tPitch * 0.2;
  }
  return p;
}
