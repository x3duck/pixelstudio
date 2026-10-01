import * as THREE from 'three';
import { LOOP, wrap, pose, swingProgress, bladeHidden, SWING_T0, SWING_T1 } from './pose.js';
import { buildCharacter, applyPose, toonShared } from './character.js';
import { compositeVert, compositeFrag } from './composite.js';

THREE.ColorManagement.enabled = false;
window.__LOOP = LOOP;

// ---------- config ----------
const BASE_H = 180;           // target internal height (art px); the integer scale keeps it within ~160-200
const MIN_W = 200;            // minimum internal width (narrow / portrait windows trade scale for width)
const VIEW_H = 180;           // nominal vertical world extent
const FLOOR_BOTTOM = -30;     // world y at bottom of view
const CAM_X = -6;             // world x at view centre

const params = new URLSearchParams(location.search);
const ZOOM_Y = parseFloat(params.get('zy') || '32');   // debug inspection: ?zoom=N&zy=px
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = true;
const canvas = renderer.domElement;
canvas.style.position = 'absolute';
canvas.style.imageRendering = 'pixelated';
document.body.appendChild(canvas);

// ---------- scenes ----------
const charScene = new THREE.Scene();
const fxScene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-160, 160, 90, -90, 400, 800);
cam.position.set(0, 0, 600);
cam.lookAt(0, 0, 0);

const R = buildCharacter();
charScene.add(R.root);

// slash trail ribbon (fx buffer)
const TRAIL_N = 52, TRAIL_DT = 0.0055;
const trailGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(TRAIL_N * 2 * 3);
const tA = new Float32Array(TRAIL_N * 2);
const tS = new Float32Array(TRAIL_N * 2);
const tK = new Float32Array(TRAIL_N * 2);
trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
trailGeo.setAttribute('aA', new THREE.BufferAttribute(tA, 1));
trailGeo.setAttribute('aS', new THREE.BufferAttribute(tS, 1));
trailGeo.setAttribute('aK', new THREE.BufferAttribute(tK, 1));
const idx = [];
for (let i = 0; i < TRAIL_N - 1; i++) {
  const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
  idx.push(a, b, c, b, d, c);
}
trailGeo.setIndex(idx);
const trailMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  uniforms: { uFlash: { value: 0 } },
  vertexShader: /* glsl */`
    attribute float aA; attribute float aS; attribute float aK; varying float vA; varying float vS; varying float vK;
    void main(){ vA = aA; vS = aS; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uFlash;
    varying float vA; varying float vS; varying float vK;
    void main(){
      if (vA < 0.2) discard;   // hard edge, no dither
      // steps down by age: gold head -> orange -> crimson -> #5a0c1a tail
      vec3 c = vK < 0.018 ? vec3(1.0, 0.76, 0.37) : vK < 0.04 ? vec3(1.0, 0.45, 0.2) : vK < 0.065 ? vec3(0.67, 0.12, 0.16) : vec3(0.353, 0.047, 0.102);
      // white only on the 1 px outer edge of the newest samples (and the leading edge on the impact frames)
      if (vK < 0.02 && vS > 0.72) c = vec3(1.0, 0.97, 0.88);
      if (uFlash > 0.5 && vK < 0.012) c = vS > 0.5 ? vec3(1.0, 0.97, 0.88) : vec3(1.0, 0.89, 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const trail = new THREE.Mesh(trailGeo, trailMat);
trail.frustumCulled = false;
fxScene.add(trail);

// ---------- targets ----------
let lowW = 320, lowH = 180, scale = 4, wpp = 1;
let rtChar, rtFx, rtFinal;
function makeTargets() {
  for (const t of [rtChar, rtFx, rtFinal]) if (t) t.dispose();
  const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true };
  rtChar = new THREE.WebGLRenderTarget(lowW, lowH, opts);
  rtChar.depthTexture = new THREE.DepthTexture(lowW, lowH);
  rtChar.depthTexture.type = THREE.UnsignedIntType;
  rtChar.depthTexture.minFilter = THREE.NearestFilter; rtChar.depthTexture.magFilter = THREE.NearestFilter;
  rtFx = new THREE.WebGLRenderTarget(lowW, lowH, opts);
  rtFinal = new THREE.WebGLRenderTarget(lowW, lowH, { ...opts, depthBuffer: false });
}

// composite + blit passes
const quadGeo = new THREE.PlaneGeometry(2, 2);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const compMat = new THREE.ShaderMaterial({
  vertexShader: compositeVert, fragmentShader: compositeFrag(),
  depthTest: false, depthWrite: false,
  uniforms: {
    tChar: { value: null }, tDepth: { value: null }, tFx: { value: null },
    uRes: { value: new THREE.Vector2() }, uOrigin: { value: new THREE.Vector2() }, uWpp: { value: 1 },
    uTime: { value: 0 }, uTf: { value: 0 }, uLoop: { value: LOOP },
    uHead: { value: new THREE.Vector2() }, uLag: { value: new THREE.Vector2() }, uFace: { value: 1 },
    uFlick: { value: 1 }, uShadowX: { value: 0 },
    uHist: { value: Array.from({ length: 12 }, () => new THREE.Vector2()) },
    uHeadDepth: { value: 0.5 }, uSpark: { value: new THREE.Vector4() }, uSparkDir: { value: new THREE.Vector2(1, 0) },
    uGlint: { value: new THREE.Vector3() }, uBladeN: { value: new THREE.Vector2(0, 1) },
  },
});
const compScene = new THREE.Scene();
compScene.add(new THREE.Mesh(quadGeo, compMat));
const blitMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: null }, uZoom: { value: parseFloat(params.get('zoom') || '1') }, uC: { value: new THREE.Vector2(0.5, 0.5) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tSrc; uniform float uZoom; uniform vec2 uC; varying vec2 vUv; void main(){ vec2 uv = uC + (vUv - 0.5) / uZoom; gl_FragColor = vec4(texture2D(tSrc, uv).rgb, 1.0); }`,
});
const blitScene = new THREE.Scene();
blitScene.add(new THREE.Mesh(quadGeo, blitMat));

// ---------- resize: integer upscale, internal res grows to fill the window ----------
// The scale is chosen from the height so the internal height stays near 180 (about 160-200) and one art pixel
// stays one world unit at every window shape: the sides extend or crop around the action instead of the sprite
// changing pixel density. Narrow / portrait windows lower the scale to keep >= MIN_W columns (more wall above).
function resize() {
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  scale = Math.max(1, Math.min(Math.round(H / BASE_H), Math.floor(W / MIN_W)));
  lowW = Math.ceil(W / scale);
  lowH = Math.ceil(H / scale);
  wpp = lowW < MIN_W ? MIN_W / lowW : (lowH < 150 ? VIEW_H / lowH : 1);
  const cw = lowW * scale, ch = lowH * scale;
  renderer.setSize(cw, ch, false);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.style.left = Math.floor((W - cw) / 2) + 'px';
  canvas.style.top = Math.floor((H - ch) / 2) + 'px';
  makeTargets();
}

// ---------- per-frame ----------
const _v = new THREE.Vector3();
function toPx(obj, out) {
  obj.getWorldPosition(_v);
  out.set((_v.x - cam.left - cam.position.x) / wpp, (_v.y - cam.bottom - cam.position.y) / wpp);
  return out;
}
function hashf(n) { const s = Math.sin(n * 91.345 + 47.853) * 43758.5453; return s - Math.floor(s); }

const pivW = [];
for (let i = 0; i < TRAIL_N; i++) pivW.push(new THREE.Vector3());
const _sh = new THREE.Vector3(), _tp = new THREE.Vector3();
const SLASH_KEY_T = 3.60;
const histPx = Array.from({ length: 12 }, () => new THREE.Vector2());

function setCamera(u, shake) {
  const halfW = Math.floor(lowW / 2) * wpp;
  const left = CAM_X - halfW + shake * wpp;
  cam.left = 0; cam.right = lowW * wpp;
  cam.bottom = 0; cam.top = lowH * wpp;
  // keep the floor line at a stable height: extra rows mostly go to the wall above
  const extra = THREE.MathUtils.clamp((lowH * wpp - VIEW_H) * 0.5, -12, 25);
  cam.position.set(left, FLOOR_BOTTOM - extra - (shake ? wpp : 0), 600);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

// snap the root to the art pixel grid (x in world, y=0 floor); applyPose keeps the planted feet in place
const snapX = (x) => cam.position.x + Math.round((x - cam.position.x) / wpp) * wpp;
const SNAP = { cloth: false, snap: snapX }, SNAP_CLOTH = { cloth: true, snap: snapX };
function poseAt(u, opts = SNAP) {
  applyPose(R, u, opts);
  R.root.updateMatrixWorld(true);
}
const lagPx = new THREE.Vector2(), headPx = new THREE.Vector2();
const _sa = new THREE.Vector2(), _sb = new THREE.Vector2(), _g = new THREE.Vector2();
const p0 = {};

function render(t) {
  const u = wrap(t);
  pose(u, p0);
  const shake = p0.cam > 0.5 ? 1 : 0;
  setCamera(u, shake);

  // history samples: head positions (for embers / flame drag)
  for (let k = 11; k >= 0; k--) {
    poseAt(u - k * 0.1);
    toPx(R.head, histPx[k]);
  }
  poseAt(u - 0.09);
  toPx(R.head, lagPx);
  // slash smear: a crescent around the near shoulder, from the coil tip direction over the top of the
  // fire to the strike tip. Sampled at past times so it trails and fades by age (pure in u).
  const trailOn = u > SWING_T0 && u < SWING_T1 + 0.25;
  let a0 = 0, a1 = 0, r0 = 0, r1 = 0;
  if (trailOn) {
    poseAt(SWING_T0); R.rArm.getWorldPosition(_sh); R.bladeTip.getWorldPosition(_tp);
    a0 = Math.atan2(_tp.y - _sh.y, _tp.x - _sh.x); r0 = Math.hypot(_tp.x - _sh.x, _tp.y - _sh.y);
    poseAt(SLASH_KEY_T); R.rArm.getWorldPosition(_sh); R.bladeTip.getWorldPosition(_tp);
    a1 = Math.atan2(_tp.y - _sh.y, _tp.x - _sh.x); r1 = Math.hypot(_tp.x - _sh.x, _tp.y - _sh.y);
    if (a1 > a0) a1 -= Math.PI * 2;   // sweep clockwise, over the top
    for (let k = TRAIL_N - 1; k >= 0; k--) {
      poseAt(u - k * TRAIL_DT);
      R.rArm.getWorldPosition(pivW[k]);
    }
  }
  // impact sparks: timed from the hit, origin = the visible blade tip just after it reappears, direction = tip motion
  const SPARK_T = 3.575, SPARK_POS_T = 3.595;
  const sparkAge = u - SPARK_T;
  const sparkOn = sparkAge >= 0 && sparkAge < 0.3;
  if (sparkOn) {
    poseAt(SPARK_POS_T - 0.012); toPx(R.bladeTip, _sa);
    poseAt(SPARK_POS_T); toPx(R.bladeTip, _sb);
    const d = _sa.sub(_sb).negate(); if (d.lengthSq() < 1e-6) d.set(1, 0); d.normalize();
    compMat.uniforms.uSpark.value.set(_sb.x, _sb.y, sparkAge, 1);
    compMat.uniforms.uSparkDir.value.copy(d);
  } else compMat.uniforms.uSpark.value.set(0, 0, 0, 0);
  // current pose (with cloth); the blade is replaced by the smear's leading edge while it sweeps
  poseAt(u, SNAP_CLOTH);
  R.weapon.visible = !bladeHidden(u);

  // trail geometry: a ~180 degree crescent (starts 25% into the swing), ~4 px thick at the leading edge and
  // tapering to a point at the tail
  const PR0 = 0.25;
  const prHead = trailOn ? Math.min(swingProgress(u), 1) : 1;
  const thickHead = 5.0 * wpp;
  for (let k = 0; k < TRAIL_N; k++) {
    const age = k * TRAIL_DT;
    const pr = trailOn ? swingProgress(u - age) : 0;
    const ageA = 1 - THREE.MathUtils.smoothstep(age, 0.02, 0.2);
    const uk = wrap(u - age);
    const a = pr > PR0 && uk <= SWING_T1 + 0.006 ? ageA : 0;   // only samples taken while the arc sweeps
    const endA = 1 - THREE.MathUtils.smoothstep(u - SWING_T1, 0.07, 0.11);   // whole arc gone ~0.1 s after the hit
    const th = a0 + (a1 - a0) * pr;
    const r = (r0 + (r1 - r0) * pr) * (1 + 0.05 * Math.sin(Math.PI * pr));
    const rel = THREE.MathUtils.clamp((pr - PR0) / Math.max(1e-3, prHead - PR0), 0, 1);
    const ro = r * 1.04, ri = ro - thickHead * Math.pow(rel, 0.45);
    const c = Math.cos(th), sn = Math.sin(th), pv = pivW[k];
    const o6 = k * 6;
    tPos[o6] = pv.x + c * ro; tPos[o6 + 1] = pv.y + sn * ro; tPos[o6 + 2] = 0;
    tPos[o6 + 3] = pv.x + c * ri; tPos[o6 + 4] = pv.y + sn * ri; tPos[o6 + 5] = 0;
    tA[k * 2] = a * endA; tA[k * 2 + 1] = a * endA;
    tS[k * 2] = 1; tS[k * 2 + 1] = 0;
    tK[k * 2] = age; tK[k * 2 + 1] = age;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.aA.needsUpdate = true;
  trailGeo.attributes.aS.needsUpdate = true;
  trailGeo.attributes.aK.needsUpdate = true;
  trailMat.uniforms.uFlash.value = p0.flash > 0.5 ? 1 : 0;

  // flame + light uniforms
  toPx(R.head, headPx);
  headPx.set(Math.round(headPx.x), Math.round(headPx.y));
  const flick = 0.82 + 0.18 * hashf(Math.floor(u * 14));
  R.headLight.getWorldPosition(toonShared.uHeadPos.value);
  R.pelvis.getWorldPosition(toonShared.uPelvis.value);
  toonShared.uHeadI.value = flick;

  const U = compMat.uniforms;
  U.uRes.value.set(lowW, lowH);
  U.uOrigin.value.set(cam.position.x, cam.position.y);
  U.uWpp.value = wpp;
  U.uTime.value = u;
  U.uTf.value = Math.floor(u * 12) / 12;
  U.uHead.value.copy(headPx);
  U.uLag.value.set(THREE.MathUtils.clamp((lagPx.x - headPx.x) * 0.9 + 2.0 * p0.breathLate, -9, 9), THREE.MathUtils.clamp((lagPx.y - headPx.y) * 0.5, -5, 5));
  U.uFace.value = 1;
  U.uFlick.value = flick;
  U.uShadowX.value = (R.root.position.x - cam.position.x) / wpp;
  for (let k = 0; k < 12; k++) U.uHist.value[k].copy(histPx[k]);
  // flame depth (blade nearer than this draws in front of the fire)
  R.head.getWorldPosition(_v); _v.project(cam);
  U.uHeadDepth.value = _v.z * 0.5 + 0.5;
  // blade screen normal toward its upper (lit) edge, for the composite's 1 px edge / spine
  toPx(R.weapon, _sa); toPx(R.bladeTip, _sb);
  {
    let dx = _sb.x - _sa.x, dy = _sb.y - _sa.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    let nx = -dy, ny = dx;
    if (Math.abs(ny) < 0.2 ? nx > 0 : ny < 0) { nx = -nx; ny = -ny; }
    U.uBladeN.value.set(nx, ny);
  }
  // coil glint on the blade edge
  if (p0.coil > 0.02) { toPx(R.bladeEdge, _g); U.uGlint.value.set(_g.x, _g.y, p0.coil); }
  else U.uGlint.value.set(0, 0, 0);

  // passes
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rtChar);
  renderer.clear(true, true, true);
  renderer.render(charScene, cam);
  renderer.setRenderTarget(rtFx);
  renderer.clear(true, true, true);
  renderer.render(fxScene, cam);
  U.tChar.value = rtChar.texture; U.tDepth.value = rtChar.depthTexture; U.tFx.value = rtFx.texture;
  renderer.setRenderTarget(rtFinal);
  renderer.render(compScene, postCam);
  blitMat.uniforms.tSrc.value = rtFinal.texture;
  if (blitMat.uniforms.uZoom.value > 1) blitMat.uniforms.uC.value.set((U.uShadowX.value + 12) / lowW, (headPx.y - ZOOM_Y) / lowH);
  renderer.setRenderTarget(null);
  renderer.render(blitScene, postCam);
}

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
