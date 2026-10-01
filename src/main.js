import * as THREE from 'three';
import { LOOP, wrap, pose } from './pose.js';
import { buildCharacter, applyPose, toonShared } from './character.js';
import { compositeVert, compositeFrag } from './composite.js';

THREE.ColorManagement.enabled = false;
window.__LOOP = LOOP;

// ---------- config ----------
const BASE_H = 180;           // reference internal height (art px)
const MIN_W = 240;            // minimum internal width
const VIEW_H = 180;           // vertical world extent (constant)
const FLOOR_BOTTOM = -30;     // world y at bottom of view
const CAM_X = -6;             // world x at view centre

const params = new URLSearchParams(location.search);
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;
const quant = params.get('quant') === '0' ? 0 : 1;

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
trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
trailGeo.setAttribute('aA', new THREE.BufferAttribute(tA, 1));
trailGeo.setAttribute('aS', new THREE.BufferAttribute(tS, 1));
const idx = [];
for (let i = 0; i < TRAIL_N - 1; i++) {
  const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
  idx.push(a, b, c, b, d, c);
}
trailGeo.setIndex(idx);
const trailMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  vertexShader: /* glsl */`
    attribute float aA; attribute float aS; varying float vA; varying float vS;
    void main(){ vA = aA; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying float vA; varying float vS;
    float bayer4(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
      int b[16] = int[](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return (float(b[i]) + 0.5) / 16.0; }
    void main(){
      float a = vA * smoothstep(0.0, 0.35, vS);   // fade toward the inner edge of the arc
      if (a < bayer4(gl_FragCoord.xy) * 0.35 + 0.12) discard;
      float e = a * (0.55 + 0.45 * vS);
      vec3 c = e > 0.86 ? vec3(1.0, 0.95, 0.8) : e > 0.62 ? vec3(1.0, 0.76, 0.37) : e > 0.42 ? vec3(1.0, 0.45, 0.2) : e > 0.24 ? vec3(0.82, 0.18, 0.17) : vec3(0.53, 0.08, 0.14);
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
    uTip: { value: new THREE.Vector2() }, uFx: { value: 0 }, uQuant: { value: quant },
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
function resize() {
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  scale = Math.max(1, Math.min(Math.floor(H / BASE_H), Math.floor(W / MIN_W)));
  lowW = Math.ceil(W / scale);
  lowH = Math.ceil(H / scale);
  wpp = VIEW_H / lowH;
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

const tipW = [], midW = [];
for (let i = 0; i < TRAIL_N; i++) { tipW.push(new THREE.Vector3()); midW.push(new THREE.Vector3()); }
const histPx = Array.from({ length: 12 }, () => new THREE.Vector2());

function setCamera(u, shake) {
  const halfW = Math.floor(lowW / 2) * wpp;
  const left = CAM_X - halfW + shake * wpp;
  cam.left = 0; cam.right = lowW * wpp;
  cam.bottom = 0; cam.top = lowH * wpp;
  cam.position.set(left, FLOOR_BOTTOM - (shake ? wpp : 0), 600);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

function snapRoot() {
  // snap root to the art pixel grid (x in world, y=0 floor)
  const ox = cam.position.x;
  R.root.position.x = ox + Math.round((R.root.position.x - ox) / wpp) * wpp;
  R.root.updateMatrixWorld(true);
}

function render(t) {
  const u = wrap(t);
  const p0 = pose(u);
  const shake = p0.cam > 0.5 ? 1 : 0;
  setCamera(u, shake);

  // history samples: head positions (for embers / flame drag)
  for (let k = 11; k >= 0; k--) {
    applyPose(R, u - k * 0.1, { cloth: false });
    snapRoot();
    toPx(R.head, histPx[k]);
  }
  const lagPx = new THREE.Vector2();
  {
    applyPose(R, u - 0.09, { cloth: false }); snapRoot();
    toPx(R.head, lagPx);
  }
  // sword trail samples
  for (let k = TRAIL_N - 1; k >= 0; k--) {
    applyPose(R, u - k * TRAIL_DT, { cloth: false });
    snapRoot();
    R.bladeTip.getWorldPosition(tipW[k]);
    R.bladeMid.getWorldPosition(midW[k]);
  }
  // current pose (with cloth)
  applyPose(R, u, { cloth: true });
  snapRoot();
  R.root.updateMatrixWorld(true);

  // trail geometry: alpha by age and by tip speed
  for (let k = 0; k < TRAIL_N; k++) {
    const j = Math.min(k + 1, TRAIL_N - 1), i0 = Math.max(k - 1, 0);
    const sp = tipW[i0].distanceTo(tipW[j]) / ((j - i0) * TRAIL_DT);
    const speedA = THREE.MathUtils.clamp((sp - 260) / 500, 0, 1);
    const ageA = 1 - k / (TRAIL_N - 1);
    const ts = wrap(u - k * TRAIL_DT);
    const win = ts > 3.5 && ts < 4.1 ? 1 : 0;   // trail only for the slash itself
    const a = win * speedA * Math.pow(ageA, 0.8);
    // extend the outer edge a bit past the tip for a chunky arc
    const ox = tipW[k].x + (tipW[k].x - midW[k].x) * 0.12;
    const oy = tipW[k].y + (tipW[k].y - midW[k].y) * 0.12;
    tPos.set([ox, oy, 0], k * 6);
    tPos.set([midW[k].x * 0.25 + tipW[k].x * 0.75, midW[k].y * 0.25 + tipW[k].y * 0.75, 0], k * 6 + 3);
    tA[k * 2] = a; tA[k * 2 + 1] = a;
    tS[k * 2] = 1; tS[k * 2 + 1] = 0;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.aA.needsUpdate = true;
  trailGeo.attributes.aS.needsUpdate = true;

  // flame + light uniforms
  const headPx = new THREE.Vector2();
  toPx(R.head, headPx);
  headPx.set(Math.round(headPx.x), Math.round(headPx.y));
  const flick = 0.82 + 0.18 * hashf(Math.floor(u * 14));
  R.headLight.getWorldPosition(toonShared.uHeadPos.value);
  toonShared.uHeadI.value = flick;

  const U = compMat.uniforms;
  U.uRes.value.set(lowW, lowH);
  U.uOrigin.value.set(cam.position.x, cam.position.y);
  U.uWpp.value = wpp;
  U.uTime.value = u;
  U.uTf.value = Math.floor(u * 12) / 12;
  U.uHead.value.copy(headPx);
  U.uLag.value.set(THREE.MathUtils.clamp((lagPx.x - headPx.x) * 0.9, -9, 9), THREE.MathUtils.clamp((lagPx.y - headPx.y) * 0.5, -5, 5));
  U.uFace.value = 1;
  U.uFlick.value = flick;
  U.uShadowX.value = (R.root.position.x - cam.position.x) / wpp;
  for (let k = 0; k < 12; k++) U.uHist.value[k].copy(histPx[k]);
  U.uFx.value = p0.fxBoost;

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
  if (blitMat.uniforms.uZoom.value > 1) blitMat.uniforms.uC.value.set((U.uShadowX.value + 12) / lowW, (headPx.y - (parseFloat(params.get("zy") || "32"))) / lowH);
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
