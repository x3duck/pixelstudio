// Low-res composite pass: background + character outline/rim + procedural pixel flame +
// particles + quantized bloom + palette quantization. Runs once per art pixel.

const PALETTE = [
  // outline / blacks / charcoal
  '07070c', '0e0e15', '17161f', '201f2a', '2c2a38', '3a3849', '4b4860',
  // navy / slate
  '10162a', '161e36', '1e2944', '283658', '33456e', '475c8a', '64779e', '8d9cba', 'c2cadb', 'eef1f6',
  // gunmetal
  '1c1f28', '272b36', '343a48', '474e5f', '5f677b', '7f889c', 'a9b1c2', 'dde2ec',
  // muted purple / slate-purple cloth
  '2a1f33', '3c2c48', '1d1a29', '2a2639', '37324b', '4a4462',
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
uniform float uHeadDepth; // depth-buffer value of the flame (for blade-in-front ordering)
uniform vec4 uSpark;      // impact spark origin px (xy), age s (z), active (w)
uniform vec2 uSparkDir;   // direction of the blade tip at impact
uniform vec3 uGlint;      // coil glint px (xy) + intensity (z)
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
// large rounded, pillowed flagstones in loosely staggered rows, 1 px soft mortar
float stoneSdf(vec2 w, out vec2 id){
  // uneven row heights: boundary k sits at k*22 + jitter
  float row = floor(w.y / 22.0);
  float yb0 = row * 22.0 + (h12(vec2(row, 1.3)) - 0.5) * 8.0;
  if (w.y < yb0) row -= 1.0;
  else if (w.y >= (row + 1.0) * 22.0 + (h12(vec2(row + 1.0, 1.3)) - 0.5) * 8.0) row += 1.0;
  float rb0 = row * 22.0 + (h12(vec2(row, 1.3)) - 0.5) * 8.0;
  float rb1 = (row + 1.0) * 22.0 + (h12(vec2(row + 1.0, 1.3)) - 0.5) * 8.0;
  float off = h12(vec2(row, 4.7)) * 46.0;
  float bw = 34.0 + 10.0 * h12(vec2(row, 8.8));
  float xx = w.x + off;
  float col = floor(xx / bw);
  float x0 = col * bw + (h12(vec2(col, row)) - 0.5) * 18.0;
  float x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * 18.0;
  if (xx < x0) { col -= 1.0; x1 = x0; x0 = col * bw + (h12(vec2(col, row)) - 0.5) * 18.0; }
  else if (xx > x1) { col += 1.0; x0 = x1; x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * 18.0; }
  id = vec2(col, row);
  float hv = h12(id + 0.37);
  float y0 = rb0 + (hv - 0.5) * 1.5, y1 = rb1 + (h12(id + 5.1) - 0.5) * 1.5;
  vec2 c = vec2(0.5 * (x0 + x1), 0.5 * (y0 + y1));
  vec2 hs = vec2(0.5 * (x1 - x0), 0.5 * (y1 - y0)) - 0.5;
  float r = 5.5 + 3.0 * h12(id + 2.3);
  vec2 d = abs(vec2(xx, w.y) - c) - (hs - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

vec3 wallColor(vec2 w, vec2 pix){
  vec2 id; vec2 idn;
  float e = stoneSdf(w, id);
  vec3 stone = vec3(0.098, 0.204, 0.224);                 // ~15% darker teal
  stone *= 0.93 + 0.1 * h12(id + 9.7);
  vec3 c = stone;
  float m = uWpp;
  if (e > -1.0 * m) c = stone * 0.76;                      // mortar (soft contrast)
  else if (e > -2.6 * m) {
    float up = stoneSdf(w + vec2(0.0, 1.5) * m, idn);
    float lf = stoneSdf(w + vec2(-1.5, 0.0) * m, idn);
    float dn = stoneSdf(w + vec2(0.0, -1.5) * m, idn);
    float rt = stoneSdf(w + vec2(1.5, 0.0) * m, idn);
    if (up > -1.0 * m || lf > -1.0 * m) c = stone * 1.11;      // lit top/left lip
    else if (dn > -1.0 * m || rt > -1.0 * m) c = stone * 0.88; // shaded bottom/right lip
  } else if (e < -7.0 * m) c = stone * 1.04;               // pillowed centre
  // vertical gradient: darker toward the top
  float grad = smoothstep(150.0, 10.0, w.y);
  c *= mix(0.58, 1.0, grad);
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
const vec2 CE = vec2(0.8, 9.0);   // core mass centre (x scaled by uFace)

// flame density field around the base (q = px relative to the flame base)
float flameField(vec2 q){
  float tf = uTf;
  float H = 27.0;
  vec2 ce = vec2(uFace * CE.x, CE.y);
  float y = q.y;
  float hy = clamp((y - 4.0) / H, 0.0, 1.0);
  // drag: tip trails the motion (lagged head position), bending more with height
  float bend = uLag.x * pow(hy, 1.4);
  float x = q.x - bend - uFace * 1.6 * hy;
  float wob = (vnoise(vec2(y * 0.16 - tf * 6.0, tf * 3.0)) - 0.5) * 6.0 * hy;
  x -= wob;
  // irregular lower mass: radius modulated by stepped angular noise (never a clean orb)
  vec2 bq = vec2(q.x - ce.x, y - ce.y);
  float ang = atan(bq.y, bq.x);
  float rmod = 0.84 + 0.3 * vnoise(vec2(ang * 2.2 + 7.0, tf * 4.0));
  // narrower toward the base so the fire rises out of the neck opening
  float waist = mix(0.55, 1.0, smoothstep(ce.y - 7.5, ce.y - 0.5, y));
  float blob = 1.0 - length(vec2(bq.x / (8.4 * waist), bq.y / (bq.y > 0.0 ? 10.5 : 7.6))) / rmod;
  float colW = mix(7.5, 0.6, pow(hy, 0.75)) * mix(0.6, 1.0, smoothstep(ce.y - 7.0, ce.y, y));
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
  // short side tongues licking out of the lower third
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float sd = i == 0 ? -1.0 : 1.0;
    float len = 3.0 + 8.0 * vnoise(vec2(fi * 5.1 + 2.0, tf * 4.5));
    float by = 3.5 + 2.5 * vnoise(vec2(fi * 2.7 + 9.0, tf * 3.0));
    float t = (y - by) / len;
    float tc = clamp(t, 0.0, 1.0);
    float cx = ce.x + sd * (6.0 + 5.0 * tc - 2.5 * tc * tc) - uLag.x * 0.25 * tc;
    float w = mix(2.0, 0.35, tc);
    float tg = (t > 0.0 && t < 1.0) ? (1.0 - abs(q.x - cx) / w) : -1.0;
    tongues = max(tongues, tg * 0.8);
  }
  float n = vnoise(vec2(x * 0.42, y * 0.3 - tf * 11.0)) * 0.6 + vnoise(vec2(x * 0.9 + 3.0, y * 0.6 - tf * 17.0)) * 0.4;
  float F = max(max(blob * 1.25, column), tongues) + (n - 0.5) * 0.55;
  // 2-3 px bites cut into the base silhouette
  if (y < ce.y + 1.0) {
    float nb = step(0.6, vnoise(vec2(q.x * 0.5 + 11.0, tf * 5.0 + 3.0)));
    F -= nb * 0.5 * clamp((ce.y + 1.0 - y) / 5.0, 0.0, 1.0);
  }
  // rare detached flame pixels above the column
  float det = step(0.9, vnoise(vec2(x * 0.7, (y - tf * 26.0) * 0.55))) * step(H * 0.62, y) * step(y, H + 11.0) * step(abs(x), 5.0);
  if (det > 0.5) F = max(F, 0.12);
  if (length(q - vec2(0.0, 14.0)) > 40.0) F = -1.0;
  return F;
}

// returns rgb + coverage (a); F = density (for the ring / contour)
vec4 flame(vec2 pix, out float F){
  vec2 q = pix + 0.5 - uHead;
  F = flameField(q);
  vec2 ce = vec2(uFace * CE.x, CE.y);
  float hy = clamp((q.y - 4.0) / 27.0, 0.0, 1.0);
  // white-hot core: raised and pushed toward the facing side
  vec2 eq = q - vec2(ce.x + uFace * 2.0, ce.y + 2.0);
  float ed = length(eq * vec2(1.0, 1.1));
  if (ed < 2.0) return vec4(1.0, 0.98, 0.9, 1.0);
  if (ed < 3.2) return vec4(1.0, 0.86, 0.45, 1.0);
  if (ed < 4.6 && F > 0.0) return vec4(1.0, 0.55, 0.22, 1.0);
  if (F <= 0.0) return vec4(0.0);
  vec3 c;
  if (F > 0.62) c = vec3(1.0, 0.46, 0.2);
  else if (F > 0.42) c = vec3(0.94, 0.31, 0.17);
  else if (F > 0.2) c = vec3(0.80, 0.14, 0.15);
  else c = vec3(0.50, 0.06, 0.10);
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
      if (t < 0.3) return vec4(1.0, 0.78, 0.37, 1.0);
      if (t < 0.68) return vec4(0.94, 0.31, 0.17, 1.0);
      if (t < 0.84 && mod(fi, 2.0) < 0.5) return vec4(0.52, 0.06, 0.11, 1.0);
    }
  }
  return vec4(0.0);
}

// impact sparks: 6 pixels bursting from the arc tip (pure in u)
vec4 sparks(vec2 pix){
  if (uSpark.w < 0.5) return vec4(0.0);
  vec2 p = pix + 0.5;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float life = 0.16 + 0.1 * h11(fi * 4.1 + 1.0);
    float age = uSpark.z - 0.012 * fi;
    if (age < 0.0 || age > life) continue;
    float a = (h11(fi * 2.3 + 0.5) - 0.5) * 2.4;
    vec2 d = vec2(uSparkDir.x * cos(a) - uSparkDir.y * sin(a), uSparkDir.x * sin(a) + uSparkDir.y * cos(a));
    float sp = 70.0 + 70.0 * h11(fi * 7.7);
    vec2 pos = uSpark.xy + d * sp * age + vec2(0.0, -90.0) * age * age;
    vec2 pos2 = pos - d * sp * 0.012;
    float t = age / life;
    vec3 c = t < 0.35 ? vec3(1.0, 0.97, 0.88) : (t < 0.7 ? vec3(1.0, 0.76, 0.37) : vec3(0.94, 0.31, 0.17));
    if (all(equal(floor(p), floor(pos)))) return vec4(c, 1.0);
    if (i < 3 && t < 0.5 && all(equal(floor(p), floor(pos2)))) return vec4(1.0, 0.76, 0.37, 1.0);
  }
  return vec4(0.0);
}

// coil: a hot glint ramping on the blade edge + a few embers drawn from the flame toward it
vec4 coilFx(vec2 pix){
  if (uGlint.z < 0.05) return vec4(0.0);
  vec2 p = floor(pix);
  vec2 g = floor(uGlint.xy);
  vec2 d = abs(p - g);
  float I = uGlint.z;
  if (d.x + d.y < 0.5 && I > 0.3) return vec4(1.0, 0.97, 0.88, 1.0);
  if (d.x + d.y < 1.5 && min(d.x, d.y) < 0.5 && I > 0.62) return vec4(1.0, 0.76, 0.37, 1.0);
  if (d.x + d.y < 2.5 && min(d.x, d.y) < 0.5 && I > 0.9) return vec4(0.94, 0.31, 0.17, 1.0);
  vec2 src = uHead + vec2(uFace * 2.0, 12.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ph = fract(uTime * 2.6 + fi * 0.27);
    if (ph > I) continue;
    vec2 dir = g - src;
    vec2 nrm = normalize(vec2(-dir.y, dir.x));
    vec2 pos = mix(src, g, ph * ph) + nrm * sin(ph * 3.14159) * (3.0 + 3.0 * h11(fi * 3.7)) * (fi < 2.0 ? 1.0 : -1.0);
    if (all(equal(p, floor(pos)))) return ph > 0.6 ? vec4(1.0, 0.76, 0.37, 1.0) : vec4(0.94, 0.31, 0.17, 1.0);
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
  // very subtle warm light pool on the wall behind the flame (flat bands, no dither)
  if (w.y >= 0.0) {
    vec2 hq = (pix - uHead - vec2(0.0, 12.0));
    float wl = clamp(1.0 - length(hq * vec2(0.85, 1.0)) / 44.0, 0.0, 1.0) * uFlick;
    wl = floor(wl * wl * 3.0) / 3.0;
    col = col * (1.0 + 0.22 * wl) + vec3(0.022, 0.004, 0.0) * wl;
  }

  // ---- character ----
  vec4 C = texelFetch(tChar, ip, 0);
  float isC = step(0.05, C.a);
  float mU = maskAt(ip + ivec2(0, 1)), mD = maskAt(ip + ivec2(0, -1));
  float mL = maskAt(ip + ivec2(-1, 0)), mR = maskAt(ip + ivec2(1, 0));
  bool charPix = false;
  float nearHead = 0.0;   // character pixel (or its contour) lies in front of the flame
  float dNear = uHeadDepth - 0.022;
  if (isC > 0.5) {
    charPix = true;
    vec3 c = C.rgb;
    float d0 = depthAt(ip);
    nearHead = step(d0, dNear);
    float th = 0.0125;
    float line = 0.0;
    if (mU > 0.5 && d0 - depthAt(ip + ivec2(0, 1)) > th) line = 1.0;
    if (mL > 0.5 && d0 - depthAt(ip + ivec2(-1, 0)) > th) line = 1.0;
    if (mR > 0.5 && d0 - depthAt(ip + ivec2(1, 0)) > th) line = 1.0;
    if (mD > 0.5 && d0 - depthAt(ip + ivec2(0, -1)) > th) line = 1.0;
    float metal = step(abs(C.a - 0.8), 0.05);
    float crim = step(abs(C.a - 0.6), 0.05);
    if (mU < 0.5) {
      vec3 rim = metal > 0.5 ? vec3(0.80, 0.84, 0.92) : (crim > 0.5 ? vec3(1.0, 0.36, 0.25) : c * 1.7 + vec3(0.07, 0.08, 0.11));
      c = rim;
    } else if (mR < 0.5) {
      vec3 rim = metal > 0.5 ? vec3(0.42, 0.46, 0.56) : (crim > 0.5 ? vec3(0.88, 0.2, 0.2) : c * 1.35 + vec3(0.05, 0.06, 0.09));
      c = rim;
    }
    if (line > 0.5) c = mix(c, vec3(0.03, 0.03, 0.05), 0.85);
    col = c;
  } else if (mU + mD + mL + mR > 0.5) {
    col = vec3(0.027, 0.027, 0.047);   // 1px near-black contour
    charPix = true;
    float dn = 1.0;
    if (mU > 0.5) dn = min(dn, depthAt(ip + ivec2(0, 1)));
    if (mD > 0.5) dn = min(dn, depthAt(ip + ivec2(0, -1)));
    if (mL > 0.5) dn = min(dn, depthAt(ip + ivec2(-1, 0)));
    if (mR > 0.5) dn = min(dn, depthAt(ip + ivec2(1, 0)));
    nearHead = step(dn, dNear);
  }

  // ---- slash trail (fx buffer) ----
  vec4 F = texelFetch(tFx, ip, 0);
  if (F.a > 0.5) { col = F.rgb; charPix = true; }
  float fb = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    float wgt = 1.0 - length(vec2(x, y)) / 4.3;
    if (wgt <= 0.0) continue;
    fb += texelFetch(tFx, cl(ip + ivec2(x, y)), 0).a * wgt;
  }
  fb = clamp(fb / 6.0, 0.0, 1.0);
  if (F.a < 0.5 && fb > 0.02 && fb * 1.3 > dith) col = fb > 0.45 ? vec3(0.53, 0.08, 0.14) : vec3(0.37, 0.06, 0.10);

  // ---- flame head ----
  vec2 q = pix + 0.5 - uHead;
  if (length(q - vec2(0.0, 14.0)) < 42.0) {
    float Fd;
    vec4 fl = flame(pix, Fd);
    // the fire rises out of the collar opening (curved rim seen slightly from above)
    float rimY = 2.2 + 1.4 * clamp(pow(q.x / 7.0, 2.0), 0.0, 1.0);
    bool hidden = isC > 0.5 && q.y < rimY;
    if (hidden) fl.a = 0.0;
    if (nearHead > 0.5) fl.a = 0.0;     // a nearer blade/arm draws in front of the flame
    if (fl.a > 0.5) {
      // darker-red contour step on the lower/back edge
      float back = clamp(-uFace * (q.x - uFace * CE.x) / 6.0, 0.0, 1.0);
      float low = clamp((CE.y + 2.0 - q.y) / 6.0, 0.0, 1.0);
      if (max(back, low) > 0.35 && Fd < 0.2 && fl.r < 0.9) fl.rgb = vec3(0.37, 0.045, 0.08);
      col = fl.rgb; charPix = true;
    } else if (nearHead < 0.5) {
      if (isC > 0.5 && q.y < rimY && q.y > rimY - 1.0 && abs(q.x) < 8.5) {
        // 1 px dark collar contour where the fire meets the neck opening
        float Fu; flame(pix + vec2(0.0, 1.0), Fu);
        if (Fu > 0.0 || Fd > 0.0) col = vec3(0.027, 0.027, 0.047);
      } else if (isC < 0.5 && F.a < 0.5) {
        // tight ring of one dark crimson around the flame (1-2 px)
        float back = clamp(-uFace * (q.x - uFace * CE.x) / 6.0, 0.0, 1.0);
        float thr = -0.09 - 0.06 * back;
        if (Fd > thr && q.y > 0.0) col = vec3(0.235, 0.043, 0.082);
      }
    }
  }
  vec4 em = embers(pix);
  if (em.a > 0.5) col = em.rgb;
  vec4 cf = coilFx(pix);
  if (cf.a > 0.5) col = cf.rgb;
  vec4 spk = sparks(pix);
  if (spk.a > 0.5) col = spk.rgb;

  // ---- palette quantization ----
  if (uQuant > 0.5) col = quantize(col, dith);
  gl_FragColor = vec4(col, 1.0);
}`;
