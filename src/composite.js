// Low-res composite pass: background + character outline/rim + procedural pixel flame +
// particles + palette quantization. Runs once per art pixel.

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
  // two-tier armour / cloth values (near-black trouser shadow, saturated navy lit, lifted muted purple)
  '11131c', '161a28', '222d52', '2b3b6c', '1a1d27', '2a2f3d', '3b4254', '241e38', '3b3258', '51467a',
  // blade + glints
  '5d6a8a', 'c9d2e8', '7886aa', '465069', '2e3444', '1f2330', '2c3242', '30374a',
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
uniform float uHeadDepth; // depth-buffer value of the flame (for blade-in-front ordering)
uniform vec4 uSpark;      // impact spark origin px (xy), age s (z), active (w)
uniform vec2 uSparkDir;   // direction of the blade tip at impact
uniform vec3 uGlint;      // coil glint px (xy) + intensity (z)
uniform vec2 uBladeN;     // screen-space unit normal of the blade pointing to its light (upper) edge
varying vec2 vUv;

${paletteGLSL()}

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1,0)), f.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), f.x), f.y);
}
// ---------------- background ----------------
// large rounded, pillowed flagstones in loosely staggered rows, 1 px soft mortar
// row boundary k: uneven heights (about +-35%)
float rowB(float k){ return k * 22.0 + (h12(vec2(k, 1.3)) - 0.5) * 15.0; }
float stoneSdf(vec2 w, out vec2 id, out vec4 info){
  float row = floor(w.y / 22.0);
  if (w.y < rowB(row)) row -= 1.0;
  else if (w.y >= rowB(row + 1.0)) row += 1.0;
  float rb0 = rowB(row), rb1 = rowB(row + 1.0);
  float off = h12(vec2(row, 4.7)) * 61.0 + row * 17.0;   // no regular stagger
  float bw = 30.0 + 16.0 * h12(vec2(row, 8.8));
  float xx = w.x + off;
  float col = floor(xx / bw);
  float jj = 0.76 * bw;   // joint jitter: widths vary about +-50%
  float x0 = col * bw + (h12(vec2(col, row)) - 0.5) * jj;
  float x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * jj;
  if (xx < x0) { col -= 1.0; x1 = x0; x0 = col * bw + (h12(vec2(col, row)) - 0.5) * jj; }
  else if (xx > x1) { col += 1.0; x0 = x1; x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * jj; }
  id = vec2(col, row);
  float hv = h12(id + 0.37);
  float y0 = rb0 + (hv - 0.5) * 2.0, y1 = rb1 + (h12(id + 5.1) - 0.5) * 2.0;
  vec2 c = vec2(0.5 * (x0 + x1), 0.5 * (y0 + y1));
  vec2 hs = vec2(0.5 * (x1 - x0), 0.5 * (y1 - y0)) - 0.5;
  float r = 1.5 + 3.0 * h12(id + 2.3);          // corner radius varies 1-4 px per stone
  vec2 lp = vec2(xx, w.y) - c;
  vec2 d = abs(lp) - (hs - r);
  float e = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  // chipped corners: a 2-3 px mortar bite in one or two corners
  vec2 cq = sign(lp);
  float ck = h12(id + cq * 0.71 + 3.3);
  vec2 cd = hs - abs(lp);
  if (ck > 0.62 && cd.x < 2.5 && cd.y < 2.5) e = max(e, 0.0);
  info = vec4(lp, hs);
  return e;
}

vec3 wallColor(vec2 w, vec2 pix){
  vec2 id; vec2 idn; vec4 info, infn;
  float e = stoneSdf(w, id, info);
  vec3 stone = vec3(0.098, 0.204, 0.224);                 // ~15% darker teal
  stone *= 0.93 + 0.1 * h12(id + 9.7);
  vec3 c = stone;
  float m = uWpp;
  if (e > -1.0 * m) c = stone * 0.76;                      // mortar (soft contrast)
  else if (e > -2.6 * m) {
    float up = stoneSdf(w + vec2(0.0, 1.5) * m, idn, infn);
    float lf = stoneSdf(w + vec2(-1.5, 0.0) * m, idn, infn);
    float dn = stoneSdf(w + vec2(0.0, -1.5) * m, idn, infn);
    float rt = stoneSdf(w + vec2(1.5, 0.0) * m, idn, infn);
    if (up > -1.0 * m || lf > -1.0 * m) c = stone * 1.11;      // lit top/left lip
    else if (dn > -1.0 * m || rt > -1.0 * m) c = stone * 0.88; // shaded bottom/right lip
  } else {
    if (e < -7.0 * m) c = stone * 1.03;                    // slightly raised centre
    // short axis-aligned hairline crack (2+ px runs with one jog, lighter lip on the lit side) on ~6% of the
    // stones, never on the bottom row behind the boots
    if (h12(id + 7.7) > 0.94 && (w.y - info.y) > 24.0) {
      vec2 lp = (info.xy - (vec2(h12(id + 4.4), h12(id + 6.6)) - 0.5) * info.zw * 0.8) / m;
      bool horiz = h12(id + 1.9) > 0.4;
      float L = 3.0 + 3.0 * h12(id + 2.9);
      float along = horiz ? lp.x : lp.y, across = horiz ? lp.y : -lp.x;
      float acr = floor(across) - (along > 0.0 ? 1.0 : 0.0);
      if (abs(along) < L) {
        if (acr == 0.0) c = stone * 0.72;
        else if (acr == 1.0) c = stone * 1.12;
      }
    }
  }
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
float flameField(vec2 q, out float Fb){
  q /= vec2(1.1, 1.2);
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
  float n1 = vnoise(vec2(x * 0.42, y * 0.3 - tf * 11.0));
  float n = n1 * 0.6 + vnoise(vec2(x * 0.9 + 3.0, y * 0.6 - tf * 17.0)) * 0.4;
  float base = max(max(blob * 1.25, column), tongues);
  float F = base + (n - 0.5) * 0.55;
  Fb = base + (n1 - 0.5) * 0.4;       // band field: low octave only (no single-pixel band islands)
  // 2-3 px bites cut into the base silhouette
  if (y < ce.y + 1.0) {
    float nb = step(0.6, vnoise(vec2(q.x * 0.5 + 11.0, tf * 5.0 + 3.0)));
    F -= nb * 0.5 * clamp((ce.y + 1.0 - y) / 5.0, 0.0, 1.0);
  }
  // rare detached flame pixels above the column
  float det = step(0.9, vnoise(vec2(x * 0.7, (y - tf * 26.0) * 0.55))) * step(H * 0.62, y) * step(y, H + 11.0) * step(abs(x), 5.0);
  if (det > 0.5) { F = max(F, 0.12); Fb = min(Fb, 0.15); }
  if (length(q - vec2(0.0, 14.0)) > 36.0) F = -1.0;
  return F;
}

// core cluster membership for integer offset g (rows -2..2, per-row extents jittered per flame frame)
float coreIn(vec2 g){
  if (g.y < -2.0 || g.y > 2.0) return 0.0;
  float fr = uTf * 12.0;
  float skew = (g.y >= 1.0) ? floor((vnoise(vec2(7.0, uTf * 4.0)) - 0.5) * 2.6 + 0.5 + clamp(uLag.x * 0.2, -1.0, 1.0)) : 0.0;
  float edge = (g.y == -2.0 || g.y == 2.0) ? 1.0 : 0.0;
  float l = -1.0 + edge * step(0.4, h12(vec2(g.y + 3.0, fr))) - (1.0 - edge) * step(0.8, h12(vec2(g.y + 7.0, fr)));
  float r = 2.0 - edge * step(0.35, h12(vec2(g.y + 5.0, fr))) + (1.0 - edge) * step(0.75, h12(vec2(g.y + 1.0, fr))) * step(0.0, g.y);
  float x = g.x - skew;
  return (x >= l && x <= r) ? 1.0 : 0.0;
}

// returns rgb + coverage (a); F = density (for the ring / contour)
vec4 flame(vec2 pix, out float F){
  vec2 q = pix + 0.5 - uHead;
  float Fb;
  F = flameField(q, Fb);
  vec2 ce = vec2(uFace * CE.x, CE.y);
  float hy = clamp((q.y / 1.2 - 4.0) / 27.0, 0.0, 1.0);
  // white-hot core: a hard, irregular 4x5 px cluster whose shape flickers on the 12 fps step,
  // skewed toward the tip of the current main tongue
  vec2 cc = floor(uHead + vec2(ce.x * 1.1 + uFace * 1.5, ce.y * 1.2 + 2.0));
  vec2 g = floor(pix) - cc;
  float cs = coreIn(g);
  if (cs > 0.5) {
    float nIn = coreIn(g + vec2(1, 0)) * coreIn(g - vec2(1, 0)) * coreIn(g + vec2(0, 1)) * coreIn(g - vec2(0, 1));
    return nIn > 0.5 ? vec4(1.0, 0.97, 0.88, 1.0) : vec4(1.0, 0.89, 0.6, 1.0);
  }
  if (F > 0.0 && coreIn(g + vec2(1, 0)) + coreIn(g - vec2(1, 0)) + coreIn(g + vec2(0, 1)) + coreIn(g - vec2(0, 1)) > 0.5) return vec4(1.0, 0.76, 0.37, 1.0);
  if (F <= 0.0) {
    // detached tongue clusters: 2-4 px licks that peel off the top, drift 4-8 px up and die (stepped, pure in u)
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float P = uLoop / (13.0 + fi * 3.0);
      float cyc = uTf / P + fi * 0.37;
      float ph = fract(cyc), ci = floor(cyc);
      if (ph > 0.72) continue;
      float hs = h11(ci * 3.1 + fi * 5.7);
      vec2 c0 = vec2((hs - 0.5) * 9.0 + uFace * 1.5 - uLag.x * 0.5, 23.0 + 6.0 * h11(ci * 1.7 + fi));
      vec2 cp = c0 + vec2(sin(ph * 5.0 + fi) * 1.2 - uLag.x * 0.3 * ph, ph * (4.0 + 4.0 * h11(ci + fi * 9.1)));
      vec2 dd = abs(floor(q) - floor(cp));
      float rr = ph < 0.3 ? 1.0 : (ph < 0.55 ? 0.8 : 0.0);
      if (dd.x + dd.y * 0.6 <= rr + 0.01 && dd.y < 2.5) {
        vec3 tc = ph < 0.25 ? vec3(1.0, 0.45, 0.2) : (ph < 0.5 ? vec3(0.67, 0.12, 0.16) : vec3(0.37, 0.06, 0.11));
        return vec4(tc, 1.0);
      }
    }
    return vec4(0.0);
  }
  // gold-white core, orange shell, crimson then dark-crimson outer wisps (no pure red-orange body)
  vec3 c;
  if (Fb > 0.6) c = vec3(1.0, 0.61, 0.27);
  else if (Fb > 0.4) c = vec3(1.0, 0.45, 0.2);
  else if (Fb > 0.2) c = vec3(0.67, 0.12, 0.16);
  else c = vec3(0.37, 0.06, 0.11);
  if (hy > 0.75 && Fb < 0.35) c = vec3(0.235, 0.043, 0.082);
  return vec4(c, 1.0);
}

// rising embers spawned from the head's past positions (pure in u)
vec4 embers(vec2 pix){
  vec2 p = pix + 0.5;
  float floorPy = -uOrigin.y / uWpp;
  if (p.y < floorPy) return vec4(0.0);
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
                         18.0 + t * (28.0 + 14.0 * h11(fi * 2.2)));
    if (all(equal(floor(p), floor(pos)))) {
      if (t < 0.3) return vec4(1.0, 0.78, 0.37, 1.0);
      if (t < 0.68) return vec4(0.94, 0.31, 0.17, 1.0);
      if (t < 0.84 && mod(fi, 2.0) < 0.5) return vec4(0.52, 0.06, 0.11, 1.0);
    }
  }
  return vec4(0.0);
}

// impact sparks: a plus-star flash at the tip, then 6 short streaks bursting from it (pure in u)
bool starIn(vec2 d){ vec2 a = abs(d); return (a.x < 0.5 && a.y < 3.5) || (a.y < 0.5 && a.x < 3.5) || (a.x < 1.5 && a.y < 1.5 && a.x + a.y < 1.5); }
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0); return length(pa - ba * h); }
vec4 sparks(vec2 pix){
  if (uSpark.w < 0.5) return vec4(0.0);
  vec2 p = floor(pix) + 0.5;
  float floorPy = -uOrigin.y / uWpp;
  if (p.y < floorPy) return vec4(0.0);
  // 7x7 four-point burst 3 px beyond the blade tip (white centre, pale-yellow arms, 1 px dark-red outline),
  // held for the first 3 frames of the hit
  if (uSpark.z < 0.05) {
    vec2 sc = floor(uSpark.xy + uSparkDir * 3.0);
    vec2 d = floor(pix) - sc;
    if (starIn(d)) return (d.x == 0.0 && d.y == 0.0) ? vec4(1.0, 0.97, 0.88, 1.0) : vec4(1.0, 0.89, 0.6, 1.0);
    if (starIn(d + vec2(1, 0)) || starIn(d - vec2(1, 0)) || starIn(d + vec2(0, 1)) || starIn(d - vec2(0, 1))) return vec4(0.37, 0.06, 0.11, 1.0);
  }
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float life = 0.16 + 0.1 * h11(fi * 4.1 + 1.0);
    float age = uSpark.z - 0.012 * fi;
    if (age < 0.0 || age > life) continue;
    float a = (h11(fi * 2.3 + 0.5) - 0.5) * 2.4;
    vec2 d = vec2(uSparkDir.x * cos(a) - uSparkDir.y * sin(a), uSparkDir.x * sin(a) + uSparkDir.y * cos(a));
    float sp = 110.0 + 70.0 * h11(fi * 7.7);
    vec2 pos = uSpark.xy + d * sp * age + vec2(0.0, -90.0) * age * age;
    if (pos.y < floorPy) continue;
    float t = age / life;
    vec3 c = t < 0.35 ? vec3(1.0, 0.97, 0.88) : (t < 0.7 ? vec3(1.0, 0.76, 0.37) : vec3(0.94, 0.31, 0.17));
    if (all(equal(floor(p), floor(pos)))) return vec4(c, 1.0);
    if (t < 0.6) {
      float L = t < 0.3 ? 4.0 : 2.0;
      if (segD(p, floor(pos) + 0.5, floor(pos - d * L) + 0.5) < 0.5) return vec4(t < 0.3 ? vec3(1.0, 0.76, 0.37) : vec3(0.94, 0.31, 0.17), 1.0);
    }
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

vec3 quantize(vec3 c){
  vec3 cc = clamp(c, 0.0, 1.0);
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
// material code written by the toon shader: a = (id*2 + up + 4) / 64
float codeAt(ivec2 p){ return floor(texelFetch(tChar, cl(p), 0).a * 64.0 + 0.5) - 4.0; }
float idOf(float code){ return floor(code * 0.5 + 0.01); }
bool isMetal(float id){ return id == 2.0 || id == 5.0 || id == 6.0 || id == 11.0 || id == 15.0 || id == 17.0 || id == 18.0; }
bool isCrim(float id){ return id == 7.0 || id == 8.0; }
float fxA(ivec2 p){ return step(0.5, texelFetch(tFx, cl(p), 0).a); }
float idAt(ivec2 p){ return maskAt(p) > 0.5 ? idOf(codeAt(p)) : -1.0; }
// a specular 'hot' pixel on armour (bright bluish highlight colour from the toon shader)
bool hotAt(ivec2 p){
  vec4 t = texelFetch(tChar, cl(p), 0);
  if (t.a < 0.05) return false;
  float id = idOf(floor(t.a * 64.0 + 0.5) - 4.0);
  return isMetal(id) && id != 11.0 && id != 15.0 && id != 17.0 && t.b > 0.45;
}
bool topEdge(ivec2 p, float id){ return idAt(p) == id && maskAt(p + ivec2(0, 1)) < 0.5; }

void main(){
  ivec2 ip = ivec2(floor(vUv * uRes));
  vec2 pix = vec2(ip);
  vec2 w = uOrigin + (pix + 0.5) * uWpp;

  // ---- background ----
  vec3 col = w.y >= 0.0 ? wallColor(w, pix) : floorColor(w);
  // contact shadow
  float sx = (pix.x + 0.5 - uShadowX) / 20.0;
  float sy = (w.y + 1.5) / 3.5;
  float sh = 1.0 - (sx * sx + sy * sy);
  if (sh > 0.0) col *= sh > 0.45 ? 0.45 : 0.68;
  // very subtle warm light pool on the wall behind the flame (flat bands, no dither)
  if (w.y >= 0.0) {
    vec2 hq = (pix - uHead - vec2(0.0, 14.0));
    float wl = clamp(1.0 - length(hq * vec2(0.85, 1.0)) / 46.0, 0.0, 1.0) * uFlick;
    wl = floor(wl * wl * 3.0) / 3.0;
    col = col * (1.0 + 0.22 * wl) + vec3(0.022, 0.004, 0.0) * wl;
  }

  // ---- character ----
  vec4 C = texelFetch(tChar, ip, 0);
  float isC = step(0.05, C.a);
  float mU = maskAt(ip + ivec2(0, 1)), mD = maskAt(ip + ivec2(0, -1));
  float mL = maskAt(ip + ivec2(-1, 0)), mR = maskAt(ip + ivec2(1, 0));
  float nearHead = 0.0;   // character pixel (or its contour) lies in front of the flame
  float dNear = uHeadDepth - 0.022;
  if (isC > 0.5) {
    vec3 c = C.rgb;
    float d0 = depthAt(ip);
    nearHead = step(d0, dNear);
    float code = codeAt(ip);
    float id = idOf(code);
    float up = mod(code, 2.0);
    // depth-discontinuity lines (near-black) and material-boundary lines (deep tone of the farther side)
    float th = 0.0125;
    float line = 0.0, seam = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 o = k == 0 ? ivec2(0, 1) : (k == 1 ? ivec2(-1, 0) : (k == 2 ? ivec2(1, 0) : ivec2(0, -1)));
      if (maskAt(ip + o) < 0.5) continue;
      float dn = depthAt(ip + o);
      if (d0 - dn > th) line = 1.0;
      else {
        float idn = idOf(codeAt(ip + o));
        if (idn != id && dn < d0 && id != 15.0 && idn != 15.0) {
          // seams only on real boundaries: the nearer part is at least 2 px thick and the boundary runs 2+ px
          ivec2 pp = ivec2(o.y, o.x);
          bool thick = idAt(ip + 2 * o) == idn;
          bool run = (idAt(ip + pp + o) == idn && idAt(ip + pp) == id) || (idAt(ip - pp + o) == idn && idAt(ip - pp) == id);
          if (thick && run) seam = 1.0;
        }
      }
    }
    bool metal = isMetal(id), crim = isCrim(id);
    // specular capped to isolated single pixels; none on islands smaller than ~3x3
    if (hotAt(ip)) {
      bool small = idAt(ip + ivec2(1, 0)) != id || idAt(ip - ivec2(1, 0)) != id || idAt(ip + ivec2(0, 1)) != id || idAt(ip - ivec2(0, 1)) != id;
      if (small || hotAt(ip - ivec2(1, 0)) || hotAt(ip - ivec2(0, 1))) c *= 0.42;
    }
    if (id == 11.0) {
      // blade: flat mid-metal body, continuous 1 px light edge on the upper side, 1 px dark spine below
      ivec2 bn = ivec2(floor(uBladeN + 0.5));
      if (idAt(ip + bn) != 11.0) c = vec3(0.788, 0.824, 0.91);
      else if (idAt(ip - bn) != 11.0) c = vec3(0.11, 0.122, 0.157);
      else c = vec3(0.365, 0.416, 0.541);
    } else if (id != 15.0) {
      // rim pixels only on edge runs of 2+ px (no dashed staircases on diagonals), never on features under 2 px
      bool runU = (maskAt(ip + ivec2(1, 0)) > 0.5 && maskAt(ip + ivec2(1, 1)) < 0.5) || (maskAt(ip + ivec2(-1, 0)) > 0.5 && maskAt(ip + ivec2(-1, 1)) < 0.5);
      bool runR = (maskAt(ip + ivec2(0, 1)) > 0.5 && maskAt(ip + ivec2(1, 1)) < 0.5) || (maskAt(ip + ivec2(0, -1)) > 0.5 && maskAt(ip + ivec2(1, -1)) < 0.5);
      bool thickV = idAt(ip - ivec2(0, 1)) == id;
      bool thickH = idAt(ip - ivec2(1, 0)) == id;
      if (mU < 0.5 && runU && thickV) {
        if (metal) {
          // armour: a dim rim along the run, the bright glint only at the run ends (isolated 1-2 px)
          bool endRun = !topEdge(ip + ivec2(1, 0), id) || !topEdge(ip - ivec2(1, 0), id);
          bool thick3 = idAt(ip - ivec2(0, 2)) == id;
          if (up > 0.5 && endRun && thick3) c = vec3(0.47, 0.53, 0.67);
          else c = c * 1.3 + vec3(0.03, 0.035, 0.05);
        }
        else if (crim) c = vec3(0.85, 0.17, 0.2);
        else c = c * 1.55 + vec3(0.05, 0.06, 0.08);
      } else if (mR < 0.5 && runR && thickH && !crim) {
        c = metal ? c * 1.35 + vec3(0.03, 0.035, 0.05) : c * 1.3 + vec3(0.04, 0.045, 0.07);
      }
    }
    if (seam > 0.5 && line < 0.5) c = c * 0.5;
    if (line > 0.5) c = mix(c, vec3(0.03, 0.03, 0.05), 0.85);
    col = c;
  } else if (mU + mD + mL + mR > 0.5) {
    col = vec3(0.027, 0.027, 0.047);   // 1px near-black contour
    float dn = 1.0;
    if (mU > 0.5) dn = min(dn, depthAt(ip + ivec2(0, 1)));
    if (mD > 0.5) dn = min(dn, depthAt(ip + ivec2(0, -1)));
    if (mL > 0.5) dn = min(dn, depthAt(ip + ivec2(-1, 0)));
    if (mR > 0.5) dn = min(dn, depthAt(ip + ivec2(1, 0)));
    nearHead = step(dn, dNear);
  }

  // ---- flame field (needed first: the slash trail is knocked out around the fire) ----
  vec2 q = pix + 0.5 - uHead;
  bool inFlame = length(q - vec2(0.0, 16.0)) < 44.0;
  float Fd = -1.0;
  vec4 fl = vec4(0.0);
  if (inFlame) fl = flame(pix, Fd);

  // ---- slash trail (fx buffer): solid arc + a solid 1 px dark-red contour, no dither ----
  float Fa = fxA(ip);
  bool knock = inFlame && Fd > -0.17;
  if (!knock) {
    if (Fa > 0.5) {
      col = texelFetch(tFx, ip, 0).rgb;
      // within ~6 px of the flame the smear drops one band, so a dark gap keeps the fire the brightest shape
      if (inFlame && Fd > -0.95) col = col.r > 0.95 && col.g > 0.8 ? vec3(1.0, 0.45, 0.2) : (col.g > 0.3 ? vec3(0.67, 0.12, 0.16) : vec3(0.35, 0.05, 0.1));
    }
    else {
      float nb = fxA(ip + ivec2(1, 0)) + fxA(ip + ivec2(-1, 0)) + fxA(ip + ivec2(0, 1)) + fxA(ip + ivec2(0, -1));
      if (nb > 0.5) col = vec3(0.37, 0.06, 0.10);
    }
  }

  // ---- flame head ----
  if (inFlame) {
    // the fire rises out of the collar opening (curved rim seen slightly from above)
    float rimY = 2.2 + 1.4 * clamp(pow(q.x / 7.0, 2.0), 0.0, 1.0);
    bool hidden = isC > 0.5 && q.y < rimY;
    if (hidden) fl.a = 0.0;
    if (nearHead > 0.5) fl.a = 0.0;     // a nearer blade/arm draws in front of the flame
    if (fl.a > 0.5) {
      // darker-red contour step on the lower/back edge
      float back = clamp(-uFace * (q.x - uFace * CE.x * 1.1) / 6.6, 0.0, 1.0);
      float low = clamp((CE.y * 1.2 + 2.0 - q.y) / 7.0, 0.0, 1.0);
      if (max(back, low) > 0.35 && Fd < 0.2 && fl.r < 0.9) fl.rgb = vec3(0.37, 0.045, 0.08);
      col = fl.rgb;
    } else if (nearHead < 0.5) {
      if (isC > 0.5 && q.y < rimY && q.y > rimY - 1.0 && abs(q.x) < 8.5) {
        // 1 px dark collar contour where the fire meets the neck opening
        float Fu; flame(pix + vec2(0.0, 1.0), Fu);
        if (Fu > 0.0 || Fd > 0.0) col = vec3(0.027, 0.027, 0.047);
      } else if (isC < 0.5) {
        // tight ring of one dark crimson around the flame (1-2 px); also separates it from the slash arc
        float back = clamp(-uFace * (q.x - uFace * CE.x * 1.1) / 6.6, 0.0, 1.0);
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
  col = quantize(col);
  gl_FragColor = vec4(col, 1.0);
}`;
