import * as THREE from 'three';

// Placeholder: low-res render target upscaled with nearest filtering.
const LOW_W = 320, LOW_H = 180;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const target = new THREE.WebGLRenderTarget(LOW_W, LOW_H, {
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
});
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f2a2e');
const cam = new THREE.OrthographicCamera(-LOW_W / 2, LOW_W / 2, LOW_H / 2, -LOW_H / 2, -1000, 1000);
const box = new THREE.Mesh(new THREE.BoxGeometry(30, 60, 10), new THREE.MeshBasicMaterial({ color: '#ff5a1f' }));
scene.add(box);

const blitScene = new THREE.Scene();
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: target.texture })));

const params = new URLSearchParams(location.search);
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;

function resize() { renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize);
resize();

function frame(now) {
  const t = frozenT ?? now / 1000;
  box.rotation.y = t;
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.render(blitScene, blitCam);
  window.__ready = true;
  if (frozenT === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
