// Low-res composite pass: background + character outline/rim + procedural pixel flame +
// particles + quantized bloom + palette quantization. Runs once per art pixel.

const PALETTE = [
  // outline / blacks / charcoal
  '07070c', '0e0e15', '17161f', '201f2a', '2c2a38', '3a3849', '4b4860',
  // navy / slate
  '10162a', '161e36', '1e2944', '283658', '33456e', '475c8a', '64779e', '8d9cba', 'c2cadb', 'eef1f6',
  // gunmetal
  '1c1f28', '272b36', '343a48', '474e5f', '5f677b', '7f889c', 'a9b1c2', 'dde2ec',
  // muted purple
  '2a1f33', '3c2c48',
  // teal wall
  '08141a', '0c1b21', '102329', '142b31', '183238', '1c3a40', '21424a', '274c54', '2f5860', '3a6770',
  // floor navy-purple
  '0a0b15', '10111f', '161729', '1c1e33', '23253f', '2c2f4d', '3a3e61', '4b5077',
  // fire family
  '22070e', '3c0b15', '5e0f1c', '861624', 'ac1e28', 'd22f2b', 'ef4f2c', 'ff7432', 'ff9c44', 'ffc35e', 'ffe49a', 'fff8e0',
  // warm-lit darks
  '2e1a20', '442328', '5e2d2c', '7a3a30',
  // leather
  '2a2026', '3f3139',
];

export function paletteGLSL() {
  const rows = PALETTE.map((h) => {
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    return `vec3(${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)})`;
  });
  return `const int NPAL = ${PALETTE.length};\nconst vec3 PAL[${PALETTE.length}] = vec3[](${rows.join(',')});`;
}

export const compositeVert = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const compositeFrag = () => /* glsl */`
precision highp float;
uniform sampler2D tChar;
uniform sampler2D tDepth;
uniform sampler2D tFx;
uniform vec2 uRes;
uniform vec2 uOrigin;     // world coords at pixel (0,0) lower-left corner
uniform float uWpp;       // world units per art pixel
uniform float uTime;      // loop time u
uniform float uTf;        // stepped loop time (flame frames)
uniform float uLoop;
uniform vec2 uHead;       // flame base in px
uniform vec2 uLag;        // flame drag in px
uniform float uFace;      // +1 facing right
uniform float uFlick;
uniform float uShadowX;   // px
uniform vec2 uHist[12];   // head px positions at u - k*0.1
uniform vec2 uTip;        // sword tip px
uniform float uFx;        // slash fx boost
uniform float uQuant;     // palette quantize on/off
varying vec2 vUv;

${paletteGLSL()}

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1,0)), f.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), f.x), f.y);
}
float bayer4(vec2 p){
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int b[16] = int[](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(b[i]) + 0.5) / 16.0;
}

// ---------------- background ----------------
// irregular rounded flagstones: jittered voronoi, mortar where F2-F1 small
vec3 voro(vec2 w){
  vec2 s = vec2(26.0, 18.0);
  vec2 g = w / s;
  vec2 ig = floor(g);
  float f1 = 1e9, f2 = 1e9; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = ig + vec2(x, y);
    vec2 o = vec2(h12(c), h12(c + 17.3));
    vec2 pt = (c + 0.2 + 0.6 * o) * s;
    vec2 d = (w - pt) / vec2(1.25, 1.0);
    float dd = length(d);
    if (dd < f1) { f2 = f1; f1 = dd; id = c; } else if (dd < f2) { f2 = dd; }
  }
  return vec3(f2 - f1, h12(id + 3.1), h12(id + 9.7));
}
float mortarAt(vec2 w){ return step(voro(w).x, 1.7); }

vec3 wallColor(vec2 w, vec2 pix){
  vec3 v = voro(w);
  float mort = step(v.x, 1.7);
  float above = mortarAt(w + vec2(0, 1.0 * uWpp));
  float below = mortarAt(w - vec2(0, 1.0 * uWpp));
  float left = mortarAt(w - vec2(1.0 * uWpp, 0));
  vec3 stone = vec3(0.118, 0.239, 0.263);                 // #1e3d43
  stone *= 0.92 + 0.12 * v.y;
  // inner subtle crack/pits
  float pit = step(0.93, h12(floor(w / 2.0) + floor(v.z * 50.0)));
  stone *= 1.0 - 0.12 * pit;
  // pillowed stones: lighter toward the centre, banded
  stone *= 0.84 + 0.16 * floor(clamp(v.x / 9.0, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
  vec3 c = stone;
  if (mort < 0.5) {
    if (above > 0.5) c = stone * 1.14 + vec3(0.0, 0.01, 0.01);   // lit top-left edge
    else if (below > 0.5 || left > 0.5) c = stone * 0.86;                                        // shadow bottom edge
  } else c = stone * 0.6;                                         // mortar
  // vertical gradient: darker toward the top, slight fog lift near floor
  float wy = w.y;
  float grad = smoothstep(150.0, 10.0, wy);
  c *= mix(0.6, 1.0, grad);
  // atmospheric center lift
  float cx = (pix.x / uRes.x - 0.5);
  c *= 1.0 - 0.35 * pow(abs(cx) * 2.0, 2.0);
  return c;
}

vec3 floorColor(vec2 w){
  // floor top at world y = 0. Top lip, then a row of chunky blocks.
  float y = -w.y; // depth below the top
  vec3 top = vec3(0.176, 0.184, 0.30);
  if (y < 1.0) return vec3(0.29, 0.30, 0.45);    // bright top edge
  if (y < 3.0) return top;
  float rowH = 13.0;
  float yy = y - 3.0;
  float row = floor(yy / rowH);
  float off = row * 13.0 + 5.0;
  float bw = 26.0;
  float bx = w.x + off;
  float col = floor(bx / bw);
  float lx = bx - col * bw; float ly = yy - row * rowH;
  vec3 blk = vec3(0.125, 0.133, 0.227);                 // #20223a
  blk *= 0.82 + 0.3 * h12(vec2(col, row));
  blk *= 1.0 - 0.18 * row;
  vec3 c = blk;
  if (ly < 1.0) c = blk * 1.25;                           // lit top edge of block
  if (lx < 1.5 || ly > rowH - 1.0) c = vec3(0.04, 0.043, 0.08);
  // rounded block corners
  if ((lx < 3.0 && ly < 2.0) || (lx > bw - 2.0 && ly < 2.0)) c = mix(c, vec3(0.04, 0.043, 0.08), 0.6);
  return c;
}

// ---------------- flame head ----------------
// returns rgb + coverage (a); g = glow amount
vec4 flame(vec2 pix, out float glow){
  vec2 q = pix + 0.5 - uHead;           // px relative to flame base
  float tf = uTf;
  glow = 0.0;
  float H = 27.0;
  // round core mass ("head") centered a little above the collar
  vec2 ce = vec2(uFace * 0.8, 9.0);
  float y = q.y;
  float hy = clamp((y - 4.0) / H, 0.0, 1.0);
  // drag: tip trails the motion (lagged head position), bending more with height
  float bend = uLag.x * pow(hy, 1.4);
  float x = q.x - bend - uFace * 1.6 * hy;
  // stepped wobble scrolling upward
  float wob = (vnoise(vec2(y * 0.16 - tf * 6.0, tf * 3.0)) - 0.5) * 6.0 * hy;
  x -= wob;
  // density field
  float blob = 1.0 - length(vec2((q.x - ce.x) / 9.0, (y - ce.y) / (y > ce.y ? 11.0 : 8.6)));
  float colW = mix(8.0, 0.6, pow(hy, 0.75));
  float column = (y > ce.y - 2.0 && y < H + 8.0) ? (1.0 - abs(x) / colW) * (1.0 - hy * 0.9) : -1.0;
  // tongues: thin flickering spikes
  float tongues = -1.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float tx = (fi - 1.0) * 5.0 + (vnoise(vec2(fi * 7.0, tf * 4.0)) - 0.5) * 4.0;
    float th = 10.0 + 14.0 * vnoise(vec2(fi * 3.3 + 1.0, tf * 5.0)) + (i == 1 ? 6.0 : 0.0);
    float ty = clamp((y - 6.0) / th, 0.0, 1.0);
    float txx = x - tx - sin(ty * 4.0 + fi * 2.1 + tf * 9.0) * 2.2 * ty;
    float w = mix(3.0, 0.4, ty);
    float tg = (y > 6.0 && y < 6.0 + th) ? (1.0 - abs(txx) / w) : -1.0;
    tongues = max(tongues, tg * 0.9);
  }
  float n = vnoise(vec2(x * 0.42, y * 0.3 - tf * 11.0)) * 0.6 + vnoise(vec2(x * 0.9 + 3.0, y * 0.6 - tf * 17.0)) * 0.4;
  float F = max(max(blob * 1.25, column), tongues) + (n - 0.5) * 0.55;
  // detached flame pixels above the column
  float det = step(0.83, vnoise(vec2(x * 0.7, (y - tf * 26.0) * 0.55))) * step(H * 0.55, y) * step(y, H + 14.0) * step(abs(x), 7.0);
  if (det > 0.5) F = max(F, 0.12);
  if (length(q - vec2(0.0, 14.0)) > 40.0) F = -1.0;
  glow = clamp(1.0 - length(vec2(q.x - ce.x, (y - ce.y - 3.0) * 0.75)) / 15.0, 0.0, 1.0);

  // eye core
  vec2 eq = q - vec2(ce.x + uFace * 0.6, ce.y + 0.5);
  float ed = length(eq * vec2(1.0, 1.1));
  if (ed < 2.0) return vec4(1.0, 0.98, 0.9, 1.0);
  if (ed < 3.2) return vec4(1.0, 0.86, 0.45, 1.0);
  if (ed < 4.6 && F > 0.0) return vec4(1.0, 0.55, 0.22, 1.0);

  if (F <= 0.0) return vec4(0.0);
  // collar occlusion: the column emerges from inside the collar
  vec3 c;
  if (F > 0.62) c = vec3(1.0, 0.46, 0.2);
  else if (F > 0.42) c = vec3(0.94, 0.31, 0.17);
  else if (F > 0.2) c = vec3(0.80, 0.14, 0.15);
  else c = vec3(0.50, 0.06, 0.10);
  // cooler (darker) toward the tip
  if (hy > 0.75 && F < 0.35) c = vec3(0.37, 0.04, 0.09);
  return vec4(c, 1.0);
}

// rising embers spawned from the head's past positions (pure in u)
vec4 embers(vec2 pix){
  vec2 p = pix + 0.5;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float m = 5.0 + mod(fi, 3.0);          // periods dividing the loop
    float P = uLoop / m;
    float a = fract(uTime / P + h11(fi * 1.7));
    float age = a * P;
    int hk = int(clamp(floor(age / 0.1 + 0.5), 0.0, 11.0));
    vec2 sp = uHist[hk];
    float life = 0.75 + 0.25 * h11(fi * 3.1);
    if (a > life) continue;
    float t = a / life;
    vec2 pos = sp + vec2((h11(fi * 5.3) - 0.5) * 10.0 + sin(t * 6.0 + fi) * 2.5,
                         14.0 + t * (26.0 + 14.0 * h11(fi * 2.2)));
    if (all(equal(floor(p), floor(pos)))) {
      if (t < 0.25) return vec4(1.0, 0.78, 0.37, 1.0);
      if (t < 0.55) return vec4(0.94, 0.31, 0.17, 1.0);
      return vec4(0.52, 0.06, 0.11, 1.0);
    }
  }
  return vec4(0.0);
}

vec3 quantize(vec3 c, float dith){
  vec3 cc = clamp(c + (dith - 0.5) * 0.0, 0.0, 1.0);
  float best = 1e9; vec3 bc = cc;
  for (int i = 0; i < NPAL; i++) {
    vec3 d = (PAL[i] - cc) * vec3(1.0, 1.25, 0.8);
    float e = dot(d, d);
    if (e < best) { best = e; bc = PAL[i]; }
  }
  return bc;
}

ivec2 cl(ivec2 p){ return clamp(p, ivec2(0), ivec2(uRes) - 1); }
float maskAt(ivec2 p){ return step(0.05, texelFetch(tChar, cl(p), 0).a); }
float depthAt(ivec2 p){ return texelFetch(tDepth, cl(p), 0).r; }

void main(){
  ivec2 ip = ivec2(floor(vUv * uRes));
  vec2 pix = vec2(ip);
  vec2 w = uOrigin + (pix + 0.5) * uWpp;
  float dith = bayer4(pix);

  // ---- background ----
  vec3 col = w.y >= 0.0 ? wallColor(w, pix) : floorColor(w);
  // contact shadow
  float sx = (pix.x + 0.5 - uShadowX) / 20.0;
  float sy = (w.y + 1.5) / 3.5;
  float sh = 1.0 - (sx * sx + sy * sy);
  if (sh > 0.0) col *= sh > 0.45 ? 0.45 : 0.68;
  // warm wall light from the flame (banded + dithered)
  vec2 hq = (pix - uHead - vec2(0.0, 10.0));
  float wl = clamp(1.0 - length(hq * vec2(0.8, 1.0)) / 56.0, 0.0, 1.0) * uFlick;
  wl = floor(wl * wl * 3.0 + dith * 0.7) / 3.0;
  col += vec3(0.03, 0.006, 0.004) * wl;

  // ---- character ----
  vec4 C = texelFetch(tChar, ip, 0);
  float isC = step(0.05, C.a);
  float mU = maskAt(ip + ivec2(0, 1)), mD = maskAt(ip + ivec2(0, -1));
  float mL = maskAt(ip + ivec2(-1, 0)), mR = maskAt(ip + ivec2(1, 0));
  bool charPix = false;
  if (isC > 0.5) {
    charPix = true;
    vec3 c = C.rgb;
    float d0 = depthAt(ip);
    // internal contour: pixel lies behind a much nearer neighbour
    float th = 0.0125;
    float line = 0.0;
    if (mU > 0.5 && d0 - depthAt(ip + ivec2(0, 1)) > th) line = 1.0;
    if (mL > 0.5 && d0 - depthAt(ip + ivec2(-1, 0)) > th) line = 1.0;
    if (mR > 0.5 && d0 - depthAt(ip + ivec2(1, 0)) > th) line = 1.0;
    if (mD > 0.5 && d0 - depthAt(ip + ivec2(0, -1)) > th) line = 1.0;
    float metal = step(abs(C.a - 0.8), 0.05);
    float crim = step(abs(C.a - 0.6), 0.05);
    // rim pixels on light-facing silhouette edges (top and back/right side)
    float lum = dot(c, vec3(0.3, 0.5, 0.2));
    if (mU < 0.5) {
      vec3 rim = metal > 0.5 ? vec3(0.80, 0.84, 0.92) : (crim > 0.5 ? vec3(1.0, 0.36, 0.25) : c * 1.7 + vec3(0.07, 0.08, 0.11));
      c = rim;
    } else if (mR < 0.5) {
      vec3 rim = metal > 0.5 ? vec3(0.55, 0.60, 0.72) : (crim > 0.5 ? vec3(0.88, 0.2, 0.2) : c * 1.35 + vec3(0.05, 0.06, 0.09));
      c = rim;
    }
    if (line > 0.5) c = mix(c, vec3(0.03, 0.03, 0.05), 0.85);
    col = c;
  } else if (mU + mD + mL + mR > 0.5) {
    col = vec3(0.027, 0.027, 0.047);   // 1px near-black contour
    charPix = true;
  }

  // ---- slash trail (fx buffer) ----
  vec4 F = texelFetch(tFx, ip, 0);
  if (F.a > 0.5) { col = F.rgb; charPix = true; }

  // ---- flame head + embers ----
  float glow;
  vec4 fl = flame(pix, glow);
  // flame base hidden inside the collar
  if (fl.a > 0.5 && (pix.y + 0.5 - uHead.y) < 3.0 && isC > 0.5) fl.a = 0.0;
  vec4 em = embers(pix);
  // bloom: banded halo around the flame + soft halo around the trail
  float gq = step(1.0 - glow * glow * 1.6 * uFlick, dith) * step(0.05, glow);
  vec3 bloom = vec3(0.0);
  if (gq > 0.5) col = charPix ? mix(col, vec3(0.75, 0.16, 0.12), 0.35) : vec3(0.37, 0.06, 0.10);
  float fb = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    float wgt = 1.0 - length(vec2(x, y)) / 4.3;
    if (wgt <= 0.0) continue;
    fb += texelFetch(tFx, cl(ip + ivec2(x, y)), 0).a * wgt;
  }
  fb = clamp(fb / 6.0, 0.0, 1.0);
  if (F.a < 0.5 && fb > 0.02 && fb * 1.3 > dith) col = fb > 0.45 ? vec3(0.53, 0.08, 0.14) : vec3(0.37, 0.06, 0.10);
  if (fl.a > 0.5) { col = fl.rgb; charPix = true; }
  else {
    col += bloom * (charPix ? 0.6 : 1.0);
  }
  if (em.a > 0.5) col = em.rgb;

  // ---- palette quantization ----
  if (uQuant > 0.5) col = quantize(col, dith);
  gl_FragColor = vec4(col, 1.0);
}`;
