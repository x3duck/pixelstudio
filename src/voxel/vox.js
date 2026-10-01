// Voxel sculpting + meshing. The approach follows voxel-musou (github.com/mike007jd/voxel-musou, MIT): a part is a list
// of boxes in voxel units, rasterised into a colour grid and meshed with only its exposed faces, per-vertex ambient
// occlusion (seams and folds darken) and a tiny per-voxel brightness jitter.
//
// box = { a: [x0, y0, z0], b: [x1, y1, z1] (integers, b exclusive), c, paint? }
//   c: 0xRRGGBB | -1 (carve) | (x, y, z) => colour | null (null = leave as is)
//   paint: only recolour voxels that already exist. Later boxes win.
import * as THREE from 'three';

export const B = (a, b, c, paint = false) => ({ a, b, c, paint });
export const P = (a, b, c) => ({ a, b, c, paint: true });
export const md = (a, m) => ((a % m) + m) % m;

export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function shade(hex, f) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

// face: normal + 4 corners of the unit cube (counter-clockwise seen from outside)
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const _c = new THREE.Color();

/** boxes -> BufferGeometry (voxel units; vertex (x, y, z) = voxel min corner). */
export function vox(boxes, { jitter = 0.06, ao = 0.4 } = {}) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const b of boxes) if (!b.paint && b.c !== -1) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.a[k]); mx[k] = Math.max(mx[k], b.b[k]); }
  const o = mn.map((m) => m - 1), n = mx.map((m, k) => m - mn[k] + 2);   // one empty voxel of border for neighbour tests
  const grid = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  const id = (i, j, k) => i + n[0] * (j + n[1] * k);
  for (const b of boxes) {
    for (let z = Math.max(b.a[2], o[2]); z < Math.min(b.b[2], o[2] + n[2]); z++)
      for (let y = Math.max(b.a[1], o[1]); y < Math.min(b.b[1], o[1] + n[1]); y++)
        for (let x = Math.max(b.a[0], o[0]); x < Math.min(b.b[0], o[0] + n[0]); x++) {
          const g = id(x - o[0], y - o[1], z - o[2]);
          if (b.paint && grid[g] < 0) continue;
          const c = typeof b.c === 'function' ? b.c(x, y, z) : b.c;
          if (c == null) continue;
          grid[g] = c;
        }
  }
  const full = (i, j, k) => (i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && grid[id(i, j, k)] >= 0 ? 1 : 0);
  const pos = [], nor = [], col = [], idx = [];
  const AO = [1 - ao, 1 - ao * 0.6, 1 - ao * 0.25, 1];
  const lv = [0, 0, 0, 0];
  for (let k = 1; k < n[2] - 1; k++) for (let j = 1; j < n[1] - 1; j++) for (let i = 1; i < n[0] - 1; i++) {
    const c = grid[id(i, j, k)];
    if (c < 0) continue;
    _c.set(shade(c, 1 - jitter / 2 + hash3(i + o[0], j + o[1], k + o[2]) * jitter));
    for (const f of FACES) {
      const [nx, ny, nz] = f.n;
      if (full(i + nx, j + ny, k + nz)) continue;
      const ax = nx ? [1, 2] : ny ? [0, 2] : [0, 1];
      const base = pos.length / 3;
      f.v.forEach((cv, q) => {
        const p = [i + nx, j + ny, k + nz];
        const s1 = [...p], s2 = [...p];
        s1[ax[0]] += cv[ax[0]] ? 1 : -1;
        s2[ax[1]] += cv[ax[1]] ? 1 : -1;
        const cc = [...s1]; cc[ax[1]] += cv[ax[1]] ? 1 : -1;
        const a = full(...s1), b = full(...s2);
        lv[q] = a && b ? 0 : 3 - a - b - full(...cc);
        const kq = AO[lv[q]];
        pos.push(i + o[0] + cv[0], j + o[1] + cv[1], k + o[2] + cv[2]);
        nor.push(nx, ny, nz);
        col.push(_c.r * kq, _c.g * kq, _c.b * kq);
      });
      // split the quad along the diagonal that keeps the AO gradient symmetric
      if (lv[0] + lv[2] < lv[1] + lv[3]) idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
      else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
