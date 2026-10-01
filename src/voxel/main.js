// Voxel earth mage: the mage built voxel-musou style (sculpted voxel parts on a rigid rig), breathing idle, slow orbit.
// ?t=<s> renders one frozen frame (window.__ready); ?pixel=1 renders at ~180 rows with a nearest integer upscale
// (the 3D-to-pixel-art route); ?az=<deg> fixes the camera azimuth instead of orbiting.
import * as THREE from 'three';
import { buildMage, solve2, flatFoot, DIM } from './mage.js';
import { vox, md, hash3 } from './vox.js';

const LOOP = 12;              // seconds: one camera orbit = 5 breaths
const BREATH = LOOP / 5;
const TAU = Math.PI * 2;

const params = new URLSearchParams(location.search);
const tParam = parseFloat(params.get('t'));
const frozenT = params.has('t') && Number.isFinite(tParam) ? tParam : null;
const PIXEL = params.get('pixel') === '1';
const azParam = parseFloat(params.get('az'));
window.__LOOP = LOOP;

const renderer = new THREE.WebGLRenderer({ antialias: !PIXEL, preserveDrawingBuffer: true });
renderer.setPixelRatio(PIXEL ? 1 : Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.type = PIXEL ? THREE.BasicShadowMap : THREE.PCFShadowMap;
const canvas = renderer.domElement;
if (PIXEL) { canvas.style.imageRendering = 'pixelated'; canvas.style.position = 'absolute'; }
document.body.appendChild(canvas);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x2b5f6a);
scene.background = BG;
scene.fog = new THREE.Fog(BG, 240, 430);

// ---- lights: cool sky fill, warm key from the upper right (the rocks' side), a rim from behind
scene.add(new THREE.HemisphereLight(0xb8dce0, 0x2a3050, 1.9));
const key = new THREE.DirectionalLight(0xffe6c8, 3.2);
key.position.set(120, 200, 140);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -90, right: 90, top: 110, bottom: -20, near: 10, far: 600 });
key.shadow.bias = -0.0008;
scene.add(key);
const rim = new THREE.DirectionalLight(0xffc89a, 1.1);
rim.position.set(-80, 120, -160);
scene.add(rim);
const fill = new THREE.DirectionalLight(0x7fb0d0, 0.45);
fill.position.set(-150, 60, 80);
scene.add(fill);

// ---- floor: a slab of dark navy stone blocks (voxel), lighter top edges, mortar lines
const floorGeo = vox([
  { a: [-200, -4, -140], b: [200, 0, 140], c: (x, y, z) => {
    const bx = md(x + Math.floor(z / 12) * 6, 18), bz = md(z, 12);
    if (bx === 0 || bz === 0) return 0x121530;
    const v = 0.85 + hash3(Math.floor((x + Math.floor(z / 12) * 6) / 18), 0, Math.floor(z / 12)) * 0.25;
    const base = y === -1 ? 0x2a3460 : 0x1e2648;
    return ((Math.round(((base >> 16) & 255) * v) << 16) | (Math.round(((base >> 8) & 255) * v) << 8) | Math.round((base & 255) * v));
  } },
], { jitter: 0.04, ao: 0.3 });
const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
floor.receiveShadow = true;
scene.add(floor);

// ---- the mage
const R = buildMage();
scene.add(R.root);
const J = R.J;

const _t = new THREE.Vector3(), _pole = new THREE.Vector3();
const FEET = { L: [7.5, 2.5], R: [-7, -2.5] };   // ankle x, z on the floor (root space)

function pose(t) {
  const u = ((t % LOOP) + LOOP) % LOOP;
  const br = Math.sin(TAU * u / BREATH);
  const late = (d) => Math.sin(TAU * (u - d) / BREATH);
  J.hips.position.y = DIM.hipY - 1.6 + 0.35 * br;
  J.hips.rotation.set(0, 0, 0.025);
  J.spine.rotation.set(0.02 + 0.015 * br, 0, -0.01);
  J.chest.rotation.set(0.03 + 0.025 * br, 0.06, -0.015);
  J.head.rotation.set(-0.03 - 0.02 * late(0.12), 0.08, 0.02);
  // the wide hat follows the head a beat late
  J.hat.rotation.set(0.03 * late(0.3), 0, 0.02 * late(0.45));
  J.hat.position.y = 7.5 + 0.22 * late(0.28);
  // legs: ankles planted, knees slightly out and forward
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const [fx, fz] = FEET[s];
    _t.set(fx, DIM.ankle - J.hips.position.y, fz);
    _pole.set(sx * 0.35, 0, 1);
    solve2(J['thigh' + s], J['shin' + s], DIM.thigh, DIM.shin, _t, _pole);
    flatFoot(J['thigh' + s], J['shin' + s], J['foot' + s], sx * 0.25);
  }
  // magic arm (left): out to the side, forearm level, palm up
  J.upperArmL.rotation.set(-0.35, 0, 0.95 + 0.03 * br);
  J.foreArmL.rotation.set(-0.35, 0, 0.62);
  J.handL.rotation.set(0, 1.57, 0.35);
  // claw arm (right): hanging a little away from the body
  J.upperArmR.rotation.set(0.05, 0, -0.22 - 0.03 * br);
  J.foreArmR.rotation.set(-0.38, 0, 0);
  J.handR.rotation.set(-0.15, 0, 0);
}

// ---- camera
const cam = new THREE.PerspectiveCamera(26, 1, 10, 1500);
const TARGET = new THREE.Vector3(0, 45, 0);
function placeCamera(t) {
  const az = (Number.isFinite(azParam) ? azParam : 28 + 360 * (((t % LOOP) + LOOP) % LOOP) / LOOP) * Math.PI / 180;
  const el = 7 * Math.PI / 180, r = 205;
  cam.position.set(TARGET.x + Math.sin(az) * Math.cos(el) * r, TARGET.y + Math.sin(el) * r, TARGET.z + Math.cos(az) * Math.cos(el) * r);
  cam.lookAt(TARGET);
}

function resize() {
  const W = innerWidth, H = innerHeight;
  if (PIXEL) {
    // ~180 art rows, integer upscale, nearest (CSS pixelated)
    const dpr = window.devicePixelRatio || 1;
    const Wd = Math.round(W * dpr), Hd = Math.round(H * dpr);
    const scale = Math.max(1, Math.round(Hd / 180));
    const lw = Math.ceil(Wd / scale), lh = Math.ceil(Hd / scale);
    renderer.setSize(lw, lh, false);
    canvas.style.width = (lw * scale) / dpr + 'px';
    canvas.style.height = (lh * scale) / dpr + 'px';
    canvas.style.left = Math.floor((Wd - lw * scale) / 2) / dpr + 'px';
    canvas.style.top = Math.floor((Hd - lh * scale) / 2) / dpr + 'px';
    cam.aspect = lw / lh;
  } else {
    renderer.setSize(W, H);
    cam.aspect = W / H;
  }
  cam.updateProjectionMatrix();
}

function render(t) {
  pose(t);
  placeCamera(t);
  renderer.render(scene, cam);
}
window.__renderAt = render;

resize();
addEventListener('resize', () => { resize(); if (frozenT !== null) render(frozenT); });
if (frozenT !== null) {
  render(frozenT);
  requestAnimationFrame(() => { window.__ready = true; });
} else {
  const start = performance.now();
  const loop = (now) => {
    render((now - start) / 1000);
    window.__ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
