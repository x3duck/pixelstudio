// The earth mage as a voxel puppet: every part is sculpted from boxes in voxel units (1 voxel = 1 pixel of the
// 55x84 sprite, so the proportions come straight from it), meshed once, and hung on its rig joint. No skinning:
// the parts are rigid, like an action figure. Character faces +z, its left is +x, y up, the floor at y = 0.
import * as THREE from 'three';
import { vox, B, P, md, hash3 } from './vox.js';

// palette sampled from the sprite
export const K = {
  hat: 0xb44a2c, hatL: 0xd2643a, hatD: 0x7e3020, hatU: 0x4a1a14,
  skin: 0x45303b, skinD: 0x33222c, face: 0x3a2633,
  gold: 0xc17b2c, goldL: 0xe2a446, goldD: 0x8a5420,
  shirt: 0x1d1419,
  cream: 0xe6d0a8, creamL: 0xf3e1bd, creamD: 0xbba17d, fold: 0x9c8462,
  sash: 0xf1d9ae, green: 0x354a3e, greenD: 0x24342b,
  sole: 0x1a1014, eye: 0xf6ead2,
};

// joint offsets (voxel units)
export const DIM = { hipY: 44, hipX: 3.5, thigh: 21, shin: 18, ankle: 4, upper: 13, fore: 11, shoulderX: 6.5, shoulderY: 9 };

// ---------------------------------------------------------------- parts
const c = (v) => v + 0.5;            // voxel centre

function hat() {
  // wide pagoda cone: five sloped tiers, each stepping in with a small ledge; eight radial seams; dark underside
  const R0 = 23, T = 3, TIERS = 5;
  const radius = (y) => {
    const k = Math.floor(y / T), t = (y - k * T) / T;
    return R0 - k * 4.3 - t * 2.3;
  };
  return [
    B([-R0, 0, -R0], [R0, T * TIERS, R0], (x, y, z) => {
      const cx = c(x), cz = c(z), r = Math.hypot(cx, cz);
      if (r > radius(y)) return null;
      if (y === 0) return K.hatU;
      const a = Math.atan2(cz, cx) / (Math.PI * 2) * 8;
      if (md(a + 0.5, 1) < 0.07 && r > 3) return K.hatD;                    // radial seams
      if (y % T === 0 && r > radius(y) - 1.2) return K.hatD;                // a clean dark ring along each tier's lower edge
      return K.hat;
    }),
    B([-1, T * TIERS, -1], [1, T * TIERS + 2, 1], K.hatD),                  // finial
  ];
}

function head() {
  // narrow dark head with a pointed chin; the glowing eyes are a separate unlit mesh (eyes())
  const hw = [1, 2, 3, 4, 4, 4, 4, 4, 3, 3];
  return [
    B([-4, 0, -3], [4, 10, 4], (x, y, z) => {
      const w = hw[y] ?? 3;
      if (Math.abs(c(x)) > w || Math.abs(c(z) - 0.5) > (y < 2 ? 2 : 3.2)) return null;
      return y > 7 ? K.skinD : K.face;
    }),
  ];
}

function eyes() {
  // slanted slits, the outer corner one voxel higher (a frown), one voxel proud of the face
  return [
    B([1, 5, 3], [3, 6, 5], K.eye), B([3, 6, 3], [4, 7, 5], K.eye),
    B([-3, 5, 3], [-1, 6, 5], K.eye), B([-4, 6, 3], [-3, 7, 5], K.eye),
  ];
}

function chest() {
  const hw = (y) => 3.6 + y * 0.17;                                        // V taper toward the shoulders
  return [
    B([-6, 0, -3], [6, 11, 3], (x, y) => (Math.abs(c(x)) <= hw(y) ? K.shirt : null)),
    // gold lapels down the front, the dark V opening widening toward the collar
    B([-6, 0, 2], [6, 11, 4], (x, y) => {
      const ax = Math.abs(c(x));
      if (ax > hw(y) || ax < 0.5 + y * 0.15) return null;                  // narrow V opening up to the collar
      return y === 10 ? K.goldL : ax < 1.5 + y * 0.15 ? K.goldD : K.gold;
    }),
    // stiff pointed shoulder flaps rising toward their outer tips
    B([-11, 7, -3], [11, 14, 4], (x, y, z) => {
      const ax = Math.abs(c(x)) - 4.5;
      if (ax < 0) return null;
      const top = 10.5 + ax * 0.55, bot = 8 + ax * 0.25;
      if (c(y) > top || c(y) < bot || ax > 6) return null;
      return c(y) > top - 1 ? K.goldL : z < -1 ? K.goldD : K.gold;
    }),
    // high collar standing up beside the neck
    B([-4, 10, -2], [4, 14, 2], (x) => (Math.abs(c(x)) > 2 ? (x > 0 ? K.goldD : K.gold) : null)),
  ];
}

function waist() {
  // green belt under a wide cream sash, knot on the left hip with a short tail
  return [
    B([-5, 0, -3], [5, 2, 4], (x, y, z) => (md(x + z, 5) === 0 ? K.greenD : K.green)),
    B([-5, 2, -3], [5, 6, 4], (x, y, z) => (md(x * 2 + y + z, 7) === 0 ? K.creamD : K.sash)),
    B([2, 0, 4], [4, 2, 5], K.greenD),
    B([2, -4, 4], [3, 0, 5], K.green),
  ];
}

function seat() {
  return [B([-6, -4, -4], [6, 2, 4], (x, y, z) => (md(x + y * 3 + z, 6) === 0 ? K.creamD : K.cream))];
}

function thigh(sx, res = 2) {
  // harem-pant balloon from the hip to the gathered knee, sculpted on a half-size voxel grid (res 2) so the round
  // volume steps in half-voxel terraces; three broad vertical folds, inner side shaded
  const prof = [[0, 3.8], [0.3, 5.3], [0.6, 6.4], [0.8, 6.1], [0.92, 4.8], [1, 3.2]];
  const r = (t) => {
    for (let i = 1; i < prof.length; i++) if (t <= prof[i][0]) {
      const [t0, r0] = prof[i - 1], [t1, r1] = prof[i];
      return r0 + (r1 - r0) * (t - t0) / (t1 - t0);
    }
    return 3.2;
  };
  return [B([-7 * res, -21 * res, -7 * res], [7 * res, res, 7 * res], (x, y, z) => {
    const cx = c(x) / res, cz = c(z) / res, t = Math.min(1, Math.max(0, -c(y) / res / 21)), rr = r(t);
    if ((cx * cx) / (rr * rr) + (cz * cz) / (rr * rr * 0.9) > 1) return null;
    const a = Math.atan2(cz, cx * sx);
    const f = md(a * 3 / Math.PI, 2);
    if (cx * sx < -2.5) return K.creamD;                                     // inner side toward the other leg
    if (f < 0.2) return K.creamD;
    if (f > 1.0 && f < 1.2 && cz > -1) return K.creamL;
    return K.cream;
  })];
}

function shin() {
  // thin dark shin spiral-wrapped in gold bands; a gathered cream cuff at the knee
  const off = [0, 1, 3, 2];
  return [
    B([-2, -2, -2], [2, 1, 2], (x, y, z) => (Math.abs(c(x)) + Math.abs(c(z)) > 3 ? null : K.creamD)),
    B([-2, -18, -2], [2, -2, 2], (x, y, z) => {
      if (Math.abs(c(x)) + Math.abs(c(z)) > 3) return null;
      const q = (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0);
      return md(y + off[q], 3) === 0 ? K.goldD : (md(y + off[q], 3) === 1 ? K.goldL : K.gold);
    }),
  ];
}

function foot() {
  // pointed gold shoe on a small dark heel
  return [
    B([-2, -1, -2], [2, 1, 2], K.goldD),
    B([-2, -4, -2], [2, -1, 5], (x, y, z) => (z > 2 && Math.abs(c(x)) > 1.5 - (z - 3) * 0.5 ? null : (y === -2 && z < 3 ? K.goldL : K.gold))),
    B([-1, -3, 5], [1, -1, 7], (x, y, z) => (z === 6 && y === -1 ? null : K.gold)),
    B([-1, -4, -3], [1, -2, -1], K.sole),
  ];
}

function upperArm() {
  return [B([-1, -13, -1], [1, 1, 1], K.skin)];
}

function foreArm() {
  return [
    B([-1, -11, -1], [1, 0, 1], K.skin),
    ...[-9, -7].map((y) => B([-2, y, -2], [2, y + 1, 2], (x, yy, z) => (Math.abs(c(x)) + Math.abs(c(z)) > 3 ? null : (z > 0 ? K.goldL : K.gold)))),
  ];
}

function hand() {
  // claw: a small palm, four long fingers curling toward the palm (+z), a thumb
  const out = [B([-2, -3, -1], [2, 0, 1], K.skin)];
  [-2, -1, 0, 1].forEach((x, i) => {
    out.push(B([x, -6, 0], [x + 1, -3, 1], K.skin));
    out.push(B([x, -8, 1], [x + 1, -6, 2], i % 2 ? K.skin : K.skinD));
    out.push(B([x, -8, 2], [x + 1, -7, 3], K.skinD));                       // claw tip curling toward the palm
  });
  out.push(B([2, -4, 0], [3, -1, 1], K.skin));
  return out;
}

// ---------------------------------------------------------------- rig
export function buildMage() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: K.eye });
  const J = {};
  const joint = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Object3D();
    o.name = name; o.position.set(x, y, z);
    if (parent) parent.add(o);
    J[name] = o;
    return o;
  };
  const part = (j, boxes, m = mat, opt = {}) => {
    const mesh = new THREE.Mesh(vox(boxes, opt), m);
    mesh.castShadow = true; mesh.receiveShadow = opt.receive ?? true;
    if (opt.scale) mesh.scale.setScalar(opt.scale);
    J[j].add(mesh);
    return mesh;
  };
  joint('root', null);
  joint('hips', J.root, 0, DIM.hipY, 0);
  joint('spine', J.hips, 0, 1, 0);
  joint('chest', J.spine, 0, 6, 0);
  joint('neck', J.chest, 0, 11, 0);
  joint('head', J.neck, 0, 1, 0);
  joint('hat', J.head, 0, 7.5, 0);
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    joint('shoulder' + s, J.chest, sx * DIM.shoulderX, DIM.shoulderY, 0);
    joint('upperArm' + s, J['shoulder' + s]);
    joint('foreArm' + s, J['upperArm' + s], 0, -DIM.upper, 0);
    joint('hand' + s, J['foreArm' + s], 0, -DIM.fore, 0);
    joint('thigh' + s, J.hips, sx * DIM.hipX, -1, 0);
    joint('shin' + s, J['thigh' + s], 0, -DIM.thigh, 0);
    joint('foot' + s, J['shin' + s], 0, -DIM.shin, 0);
    J['upperArm' + s].rotation.order = 'ZXY';
  }
  part('hips', seat(), mat, { ao: 0.18, jitter: 0.03 });
  const lit = { receive: false };   // the wide hat would shadow the whole upper body and dull the gold
  part('spine', waist(), mat, lit);
  part('chest', chest(), mat, lit);
  part('neck', [B([-1, -1, -1], [1, 2, 1], K.skinD)], mat, lit);
  part('head', head(), mat, lit);
  part('head', eyes(), eyeMat).castShadow = false;
  part('hat', hat());
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    part('thigh' + s, thigh(sx), mat, { ao: 0.18, jitter: 0.03, scale: 0.5 });   // soft cloth: half-size voxels, light AO
    part('shin' + s, shin());
    part('foot' + s, foot());
    part('upperArm' + s, upperArm(), mat, lit);
    part('foreArm' + s, foreArm(), mat, lit);
    part('hand' + s, hand(), mat, lit);
  }
  return { root: J.root, J, mat };
}

// ---------------------------------------------------------------- leg IK (two bones, knee toward the pole)
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _E = new THREE.Vector3(), _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _eu = new THREE.Euler();

/** Points `upper` (child of `parent`) and `lower` so the chain end reaches `target` (in parent space), knee toward
 *  `pole` (parent-space direction). Bones hang along local -y. */
export function solve2(upper, lower, L1, L2, target, pole) {
  _S.copy(upper.position);
  _d.subVectors(target, _S);
  const D = Math.min(Math.max(_d.length(), 2), L1 + L2 - 0.05);
  _d.normalize();
  _n.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _E.copy(_S).addScaledVector(_d, a).addScaledVector(_n, h);
  _T.copy(_S).addScaledVector(_d, D);
  _u1.subVectors(_E, _S).normalize();
  _u2.subVectors(_T, _E).normalize();
  _X.crossVectors(_u1, _u2);
  if (_X.lengthSq() < 1e-8) _X.crossVectors(_u1, _n);
  _X.normalize();
  _Y.copy(_u1).negate();
  _Z.crossVectors(_X, _Y);
  upper.quaternion.setFromRotationMatrix(_m.makeBasis(_X, _Y, _Z));
  lower.rotation.set(Math.atan2(-_u2.dot(_Z), -_u2.dot(_Y)), 0, 0);
}

/** Keep a foot flat and facing forward whatever the leg does (cancel the thigh + shin rotation). */
export function flatFoot(thigh, shin, foot, yaw = 0) {
  _q.copy(thigh.quaternion).multiply(shin.quaternion).invert();
  _qp.setFromEuler(_eu.set(0, yaw, 0));
  foot.quaternion.multiplyQuaternions(_q, _qp);
}

export { hash3, P };
