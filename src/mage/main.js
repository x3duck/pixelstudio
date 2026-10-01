import * as THREE from 'three';
import { LOOP, wrap, pose, sstep, lerp, LAUNCH, FLIGHT, SUMMON_T, RISE, blink, X0, WSX, WSZ } from './pose.js';
import { buildCharacter, applyPose, toonShared } from './character.js';
import { compositeVert, compositeFrag } from './composite.js';

THREE.ColorManagement.enabled = false;
window.__LOOP = LOOP;

// ---------- config ----------
const BASE_H = 180;           // target internal height (art px)
const MIN_H = 150;            // the integer scale never drops the internal height below this (one art px = one world unit)
const MIN_W = 200;            // minimum internal width
const VIEW_H = 180;           // nominal vertical world extent
const FLOOR_BOTTOM = -30;     // world y at bottom of view
const CAM_X = -8;             // world x at view centre
const TAU = Math.PI * 2;

const params = new URLSearchParams(location.search);
const ZOOM = Math.max(1, parseFloat(params.get('zoom')) || 1);   // inspection aid: ?zoom=N&zy=px magnifies the sprite
const ZOOM_Y = parseFloat(params.get('zy')) || 40;
const tParam = parseFloat(params.get('t'));
const frozenT = params.has('t') && Number.isFinite(tParam) ? tParam : null;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const canvas = renderer.domElement;
canvas.style.position = 'absolute';
canvas.style.imageRendering = 'pixelated';
document.body.appendChild(canvas);

// ---------- scene ----------
const charScene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-160, 160, 90, -90, 400, 800);
cam.position.set(0, 0, 600);
const R = buildCharacter();
charScene.add(R.root);
for (const r of R.rocks) charScene.add(r);

// ---------- targets ----------
let lowW = 320, lowH = 180, scale = 4, wpp = 1;
let rtChar, rtFinal;
function makeTargets() {
  for (const t of [rtChar, rtFinal]) if (t) t.dispose();
  const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
  rtChar = new THREE.WebGLRenderTarget(lowW, lowH, { ...opts, depthBuffer: true });
  rtChar.depthTexture = new THREE.DepthTexture(lowW, lowH);
  rtChar.depthTexture.type = THREE.UnsignedIntType;
  rtChar.depthTexture.minFilter = THREE.NearestFilter; rtChar.depthTexture.magFilter = THREE.NearestFilter;
  rtFinal = new THREE.WebGLRenderTarget(lowW, lowH, { ...opts, depthBuffer: false });
}

const quadGeo = new THREE.PlaneGeometry(2, 2);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const v3 = () => new THREE.Vector3();
const compMat = new THREE.ShaderMaterial({
  vertexShader: compositeVert, fragmentShader: compositeFrag(),
  depthTest: false, depthWrite: false,
  uniforms: {
    tChar: { value: null }, tDepth: { value: null },
    uRes: { value: new THREE.Vector2() }, uOrigin: { value: new THREE.Vector2() }, uWpp: { value: 1 },
    uTime: { value: 0 }, uShadowX: { value: 0 },
    uEyes: { value: new THREE.Vector4() }, uEyeInfo: { value: v3() },
    uRock: { value: [v3(), v3(), v3()] }, uRockV: { value: [v3(), v3(), v3()] },
    uImp: { value: [v3(), v3(), v3()] }, uSum: { value: [v3(), v3(), v3()] },
  },
});
const compScene = new THREE.Scene();
compScene.add(new THREE.Mesh(quadGeo, compMat));
const blitMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: null }, uZoom: { value: ZOOM }, uC: { value: new THREE.Vector2(0.5, 0.5) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tSrc; uniform float uZoom; uniform vec2 uC; varying vec2 vUv; void main(){ vec2 uv = uC + (vUv - 0.5) / uZoom; gl_FragColor = vec4(texture2D(tSrc, uv).rgb, 1.0); }`,
});
const blitScene = new THREE.Scene();
blitScene.add(new THREE.Mesh(quadGeo, blitMat));

// ---------- resize: integer upscale in device pixels, internal res grows to fill the window ----------
let targetKey = '';
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(innerWidth * dpr)), H = Math.max(1, Math.round(innerHeight * dpr));
  scale = Math.max(1, Math.min(Math.round(H / BASE_H), Math.floor(H / MIN_H), Math.floor(W / MIN_W)));
  lowW = Math.ceil(W / scale);
  lowH = Math.ceil(H / scale);
  wpp = Math.max(1, MIN_W / lowW, lowH < MIN_H ? VIEW_H / lowH : 1);
  const cw = lowW * scale, ch = lowH * scale;
  renderer.setSize(cw, ch, false);
  canvas.style.width = cw / dpr + 'px';
  canvas.style.height = ch / dpr + 'px';
  canvas.style.left = Math.floor((W - cw) / 2) / dpr + 'px';
  canvas.style.top = Math.floor((H - ch) / 2) / dpr + 'px';
  const key = lowW + 'x' + lowH;
  if (key !== targetKey) { targetKey = key; makeTargets(); }
}

// ---------- helpers ----------
const _v = new THREE.Vector3();
function toPx(p, out) {
  out.set((p.x - cam.position.x) / wpp, (p.y - cam.position.y) / wpp);
  return out;
}
function setCamera(shake) {
  const halfW = Math.floor(lowW / 2) * wpp;
  cam.left = 0; cam.right = lowW * wpp;
  cam.bottom = 0; cam.top = lowH * wpp;
  const extra = THREE.MathUtils.clamp((lowH * wpp - VIEW_H) * 0.5, -12, 25);
  cam.position.set(CAM_X - halfW + shake * wpp, FLOOR_BOTTOM - extra - shake * wpp, 600);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
const snapX = (x) => cam.position.x + Math.round((x - cam.position.x) / wpp) * wpp;
const SNAP = { cloth: false, snap: snapX }, SNAP_CLOTH = { cloth: true, snap: snapX };
function poseAt(u, opts = SNAP) {
  applyPose(R, u, opts);
  R.root.updateMatrixWorld(true);
}

// ---------- the rocks (pure functions of u) ----------
// idle offsets from the point above the palm (like the reference: one high, one out to the side, one low)
const OFF = [new THREE.Vector3(9, 27, 3), new THREE.Vector3(23, 11, 5), new THREE.Vector3(-6, 12, 7)];
const LAG = [0.16, 0.11, 0.07];
const SPIN = [[1, 2, 1], [2, 1, 1], [1, 1, 2]];       // whole turns per loop about x/y/z
// impact points on the floor ahead of the slam (fixed: the slam always happens at the same spot)
const SLAM_TRAVEL = 29;
const TGT = [0, 1, 2].map((i) => new THREE.Vector3(X0 + SLAM_TRAVEL * WSX + 62 + (i - 1) * 10, 0, SLAM_TRAVEL * WSZ + 8 + i));

const _orb = new THREE.Vector3();
// rock i hovering at loop time u: follows the palm with a lag, bobs, clusters overhead while gathering
function orbitPos(i, u, out) {
  poseAt(u - LAG[i]);
  R.palm.getWorldPosition(out);
  const w = wrap(u);
  const g = sstep(3.1, 3.42, w) * (1 - sstep(3.75, 3.85, w));   // only while gathering (the rocks are thrown by 3.6)
  const bob = 1.6 * Math.sin(TAU * (2 + i) * u / LOOP + i * 2.1);
  const sway = 1.2 * Math.sin(TAU * (1 + i) * u / LOOP + i);
  const ga = TAU * (i / 3) + TAU * 3 * u / LOOP * 2;   // tight fast circle while gathering
  out.x += lerp(OFF[i].x + sway, 5 + 7 * Math.cos(ga), g);
  out.y += lerp(OFF[i].y + bob, 17 + 4 * Math.sin(ga), g);
  out.z += lerp(OFF[i].z, 3 + 3 * Math.sin(ga), g);
  return out;
}
// returns visibility; writes position, scale factor and velocity (world units / s)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function rockState(i, u, pos) {
  const tL = LAUNCH[i], tI = tL + FLIGHT, tS = SUMMON_T[i], tA = tS + RISE;
  if (u < tL || u >= tA) { orbitPos(i, u, pos); return 1; }
  if (u < tI) {
    // thrown: from the cluster straight at the floor, accelerating
    orbitPos(i, tL, _a);
    const s = Math.pow((u - tL) / FLIGHT, 1.5);
    pos.lerpVectors(_a, TGT[i], s);
    pos.y += 6 * Math.sin(Math.PI * s) * (1 - s);
    return 1;
  }
  if (u < tS) return 0;
  // summoned: breaks out of the floor and arcs back up to the hand, growing to full size
  const s = (u - tS) / RISE;
  const e = 1 - Math.pow(1 - s, 3);
  orbitPos(i, tA, _b);
  _c.copy(TGT[i]); _c.y = -6;
  pos.lerpVectors(_c, _b, e);
  pos.y += 10 * Math.sin(Math.PI * e) * (1 - e);
  return 0.45 + 0.55 * sstep(0, 0.35, s);
}
function rockSpin(i, u, m) {
  // base tumble (whole turns per loop) + one extra turn each while gathering, flying and rising: seamless
  const extra = TAU * (sstep(3.1, 3.55, u) + sstep(LAUNCH[i], LAUNCH[i] + FLIGHT, u) + sstep(SUMMON_T[i], SUMMON_T[i] + RISE, u));
  m.rotation.set(TAU * SPIN[i][0] * u / LOOP + i + extra, TAU * SPIN[i][1] * u / LOOP + 2 * i + extra, TAU * SPIN[i][2] * u / LOOP + 0.5 * i);
}

// ---------- per frame ----------
const p0 = {};
const _px = new THREE.Vector2(), _pv = new THREE.Vector2(), _eyeA = new THREE.Vector2(), _eyeB = new THREE.Vector2();
const rockPos = [v3(), v3(), v3()], rockPrev = [v3(), v3(), v3()], rockVis = [0, 0, 0];

function render(t) {
  const u = wrap(t);
  pose(u, p0);
  // 1 px camera kick on the first impact
  const impAge0 = u - (LAUNCH[0] + FLIGHT);
  const shake = impAge0 >= 0 && impAge0 < 0.05 ? 1 : 0;
  setCamera(shake);

  // rocks (each sample re-poses the rig, so do them before the final pose)
  for (let i = 0; i < 3; i++) {
    rockVis[i] = rockState(i, u, rockPos[i]);
    rockState(i, u - 1 / 120, rockPrev[i]);
  }
  poseAt(u, SNAP_CLOTH);
  R.pelvis.getWorldPosition(toonShared.uPelvis.value);

  const U = compMat.uniforms;
  for (let i = 0; i < 3; i++) {
    const m = R.rocks[i];
    const vis = rockVis[i] > 0;
    m.visible = vis;
    m.position.copy(rockPos[i]);
    m.scale.setScalar(m.userData.size * (vis ? rockVis[i] : 1));
    rockSpin(i, u, m);
    toPx(rockPos[i], _px); toPx(rockPrev[i], _pv);
    U.uRock.value[i].set(_px.x, _px.y, vis ? 1 : 0);
    U.uRockV.value[i].set((_px.x - _pv.x) * 120, (_px.y - _pv.y) * 120, m.userData.size * (vis ? rockVis[i] : 1) / wpp);
    toPx(TGT[i], _px);
    U.uImp.value[i].set(_px.x, _px.y, u - (LAUNCH[i] + FLIGHT));
    U.uSum.value[i].set(_px.x, _px.y, u - SUMMON_T[i]);
  }

  // eyes
  R.eyeL.getWorldPosition(_v); toPx(_v, _eyeA);
  R.eyeR.getWorldPosition(_v); toPx(_v, _eyeB);
  _v.project(cam);
  U.uEyes.value.set(_eyeA.x, _eyeA.y, _eyeB.x, _eyeB.y);
  U.uEyeInfo.value.set(_v.z * 0.5 + 0.5, blink(u) ? 0 : 1, p0.cast > 0.55 ? 1 : 0);

  U.uRes.value.set(lowW, lowH);
  U.uOrigin.value.set(cam.position.x, cam.position.y);
  U.uWpp.value = wpp;
  U.uTime.value = u;
  R.root.getWorldPosition(_v);
  U.uShadowX.value = (_v.x - cam.position.x) / wpp;

  // passes
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rtChar);
  renderer.clear(true, true, true);
  renderer.render(charScene, cam);
  U.tChar.value = rtChar.texture; U.tDepth.value = rtChar.depthTexture;
  renderer.setRenderTarget(rtFinal);
  renderer.render(compScene, postCam);
  blitMat.uniforms.tSrc.value = rtFinal.texture;
  if (ZOOM > 1) blitMat.uniforms.uC.value.set((U.uShadowX.value + 10) / lowW, (FLOOR_BOTTOM * -1 + ZOOM_Y) / lowH);
  renderer.setRenderTarget(null);
  renderer.render(blitScene, postCam);
}

resize();
function onResize() { resize(); if (frozenT !== null) render(frozenT); }
addEventListener('resize', onResize);
(function watchDpr() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { onResize(); watchDpr(); }, { once: true });
})();

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
