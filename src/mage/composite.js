// Low-res composite pass for the earth mage: background + character outline/rims + glowing eyes +
// rock glow, dust, flight trails, impact debris and dust puffs + palette quantization. One art pixel each.

const PALETTE = [
  // outline / dark body (warm purple-browns)
  '0a070a', '120a0f', '1a0f16', '22141d', '2e1d27', '3b2732', '4a3340',
  // hat terracotta
  '3c1614', '5b2119', '7a2c20', '993d2c', 'a8402c', 'c85a38', 'e0784c',
  // gold / ochre
  '55321a', '8a5420', 'a8682a', 'c17b2c', 'e2a446', 'f2c66a',
  // cream / sash
  '4e3c2a', '725b41', '8f7656', 'a68c68', 'bba17d', 'd4bf98', 'e6d4ae', 'efdcb6', 'f8ecd2',
  // green belt
  '17211c', '24342b', '354a3e', '4b6a55',
  // rock / dust
  '2e1e17', '432b20', '664433', '8a6244', 'b3825a', 'd0a274', '7d6a54', 'a8927a', 'c8b496',
  // eyes
  'fff6e6', 'f0dcb0', 'e8b868',
  // teal wall (lighter, like the reference sheet)
  '0f2a30', '143439', '183d44', '1c464e', '215058', '255a63', '2a636c', '306e77', '387a84', '2c6874', '3a7480', '4a7a72', '5a8478',
  // floor navy
  '0b0d1c', '121530', '161a38', '1c2244', '222a52', '2a3460', '35427a',
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
uniform sampler2D tChar;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform vec2 uOrigin;     // world coords at pixel (0,0) lower-left corner
uniform float uWpp;       // world units per art pixel
uniform float uTime;      // loop time u
uniform float uShadowX;   // px
uniform vec4 uEyes;       // eye centres in px (left xy, right xy)
uniform vec3 uEyeInfo;    // depth of the eyes, visible (0/1), cast glow (0..1)
uniform vec3 uRock[3];    // rock centre px (xy) + visible (z)
uniform vec3 uRockV[3];   // rock velocity px/s (xy) + size px (z)
uniform vec3 uImp[3];     // impact point px (xy) + age s (z; < 0 = inactive)
uniform vec3 uSum[3];     // summon point px (xy) + age s (z; < 0 = inactive)
varying vec2 vUv;

${paletteGLSL()}

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float n){ n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

// ---------------- background ----------------
// large rounded flagstones in loosely staggered rows, thin soft mortar (low contrast, like the reference)
float rowB(float k){ return k * 24.0 + (h12(vec2(k, 1.3)) - 0.5) * 14.0; }
float stoneSdf(vec2 w, out vec2 id){
  float row = floor(w.y / 24.0);
  if (w.y < rowB(row)) row -= 1.0;
  else if (w.y >= rowB(row + 1.0)) row += 1.0;
  float rb0 = rowB(row), rb1 = rowB(row + 1.0);
  float off = h12(vec2(row, 4.7)) * 61.0 + row * 17.0;
  float bw = 34.0 + 18.0 * h12(vec2(row, 8.8));
  float xx = w.x + off;
  float col = floor(xx / bw);
  float jj = 0.7 * bw;
  float x0 = col * bw + (h12(vec2(col, row)) - 0.5) * jj;
  float x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * jj;
  if (xx < x0) { col -= 1.0; x1 = x0; x0 = col * bw + (h12(vec2(col, row)) - 0.5) * jj; }
  else if (xx > x1) { col += 1.0; x0 = x1; x1 = (col + 1.0) * bw + (h12(vec2(col + 1.0, row)) - 0.5) * jj; }
  id = vec2(col, row);
  float y0 = rb0 + (h12(id + 0.37) - 0.5) * 3.0, y1 = rb1 + (h12(id + 5.1) - 0.5) * 3.0;
  vec2 c = vec2(0.5 * (x0 + x1), 0.5 * (y0 + y1));
  vec2 hs = vec2(0.5 * (x1 - x0), 0.5 * (y1 - y0)) - 0.5;
  float r = 3.0 + 4.0 * h12(id + 2.3);      // well rounded corners
  vec2 lp = vec2(xx, w.y) - c;
  vec2 d = abs(lp) - (hs - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

vec3 wallColor(vec2 w, vec2 pix){
  vec2 id, idn;
  float e = stoneSdf(w, id);
  vec3 stone = vec3(0.160, 0.378, 0.428);
  stone *= 0.95 + 0.08 * h12(id + 9.7);
  vec3 c = stone;
  float m = uWpp;
  if (e > -1.0 * m) c = stone * 0.84;                       // mortar
  else if (e > -2.6 * m) {
    float up = stoneSdf(w + vec2(0.0, 1.5) * m, idn);
    float rt = stoneSdf(w + vec2(1.5, 0.0) * m, idn);
    float dn = stoneSdf(w + vec2(0.0, -1.5) * m, idn);
    if (up > -1.0 * m || rt > -1.0 * m) c = stone * 1.07;   // lit top/right lip
    else if (dn > -1.0 * m) c = stone * 0.92;
  }
  float grad = 1.0 - smoothstep(20.0, 160.0, w.y);
  c *= mix(0.8, 1.0, grad);
  float cx = (pix.x / uRes.x - 0.5);
  c *= 1.0 - 0.18 * pow(abs(cx) * 2.0, 2.0);
  return c;
}

vec3 floorColor(vec2 w){
  float y = -w.y;
  if (y < 1.0) return vec3(0.208, 0.259, 0.478);    // bright top edge
  if (y < 3.0) return vec3(0.165, 0.204, 0.376);
  float rowH = 14.0;
  float yy = y - 3.0;
  float row = floor(yy / rowH);
  float off = row * 15.0 + 5.0;
  float bw = 30.0;
  float bx = w.x + off;
  float col = floor(bx / bw);
  float lx = bx - col * bw; float ly = yy - row * rowH;
  vec3 blk = vec3(0.118, 0.149, 0.282);
  blk *= 0.85 + 0.25 * h12(vec2(col, row));
  blk *= 1.0 - 0.2 * row;
  vec3 c = blk;
  if (ly < 1.0) c = blk * 1.3;
  if (lx < 1.5 || ly > rowH - 1.0) c = vec3(0.043, 0.051, 0.11);
  if ((lx < 3.0 && ly < 2.0) || (lx > bw - 2.0 && ly < 2.0)) c = mix(c, vec3(0.043, 0.051, 0.11), 0.6);
  return c;
}

// ---------------- character buffer access ----------------
ivec2 cl(ivec2 p){ return clamp(p, ivec2(0), ivec2(uRes) - 1); }
float codeOf(vec4 t){ return floor(t.a * 64.0 + 0.5) - 4.0; }
float idOf(float code){ return floor(code * 0.5 + 0.01); }
// a pixel holds the character unless it is a rock pixel below the floor (rocks rise out of the ground)
bool charAt(ivec2 p){
  vec4 t = texelFetch(tChar, cl(p), 0);
  if (t.a < 0.05) return false;
  if (idOf(codeOf(t)) == 6.0 && uOrigin.y + (float(p.y) + 0.5) * uWpp < 0.0) return false;
  return true;
}
float maskAt(ivec2 p){ return charAt(p) ? 1.0 : 0.0; }
float depthAt(ivec2 p){ return texelFetch(tDepth, cl(p), 0).r; }
float idAt(ivec2 p){ return charAt(p) ? idOf(codeOf(texelFetch(tChar, cl(p), 0))) : -1.0; }

// ---------------- FX ----------------
float floorPy(){ return -uOrigin.y / uWpp; }

// glowing slit eyes (angled like a frown), drawn on the face; hidden while blinking or occluded
vec4 eyes(ivec2 ip){
  if (uEyeInfo.y < 0.5) return vec4(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 e = floor(k == 0 ? uEyes.xy : uEyes.zw);
    vec2 d = vec2(ip) - e;
    float s = k == 0 ? 1.0 : -1.0;                 // mirror: outer corner rises
    bool core = (d.y == 0.0 && d.x * s >= -1.0 && d.x * s <= 1.0) || (d.y == 1.0 && d.x * s >= -1.0 && d.x * s <= 0.0);
    bool tip = (d.y == 1.0 && d.x * s == -2.0) || (d.y == 0.0 && d.x * s == 2.0);
    bool glow = uEyeInfo.z > 0.5 && ((d.y == 2.0 && d.x * s == -2.0) || (d.y == -1.0 && d.x * s >= 0.0 && d.x * s <= 1.0));
    if (core || tip || glow) {
      if (depthAt(ip) < uEyeInfo.x - 0.01) continue;   // something nearer covers the eye
      if (core) return vec4(1.0, 0.965, 0.902, 1.0);
      if (tip) return vec4(0.941, 0.863, 0.69, 1.0);
      return vec4(0.91, 0.72, 0.41, 1.0);
    }
  }
  return vec4(0.0);
}

// dust specks drifting around the floating rocks
vec4 specks(vec2 pix){
  vec2 p = floor(pix);
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    int r = int(mod(fi, 3.0));
    vec3 rk = uRock[0];
    if (r == 1) rk = uRock[1];
    if (r == 2) rk = uRock[2];
    if (rk.z < 0.5) continue;
    float k = 2.0 + mod(fi, 3.0);                   // whole cycles per loop
    float a = 6.2832 * (uTime * k / 8.0 + h11(fi * 3.7));
    float rad = 8.0 + 6.0 * h11(fi * 5.1);
    vec2 pos = rk.xy + vec2(cos(a) * rad, sin(a) * rad * 0.6 - 3.0 + 4.0 * sin(a * 2.0 + fi));
    float on = step(0.3, fract(uTime * (3.0 + mod(fi, 4.0)) / 8.0 * 4.0 + h11(fi)));
    if (on > 0.5 && all(equal(p, floor(pos)))) return mod(fi, 2.0) < 0.5 ? vec4(0.816, 0.635, 0.455, 1.0) : vec4(0.541, 0.384, 0.267, 1.0);
  }
  return vec4(0.0);
}

float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0); return length(pa - ba * h); }

// dust streak behind a rock in flight
vec4 trails(vec2 pix){
  vec2 p = floor(pix) + 0.5;
  for (int i = 0; i < 3; i++) {
    vec3 rk = uRock[i], v = uRockV[i];
    float sp = length(v.xy);
    if (rk.z < 0.5 || sp < 150.0) continue;
    vec2 dir = v.xy / sp;
    vec2 a = rk.xy - dir * v.z * 0.45;
    vec2 b = a - dir * clamp(sp * 0.035, 6.0, 20.0);
    float d = segD(p, a, b);
    float t = clamp(dot(p - a, -dir) / max(length(b - a), 1.0), 0.0, 1.0);
    float wdt = mix(v.z * 0.5, 0.8, t * t);
    if (d < wdt) return t < 0.45 ? vec4(0.659, 0.573, 0.478, 1.0) : vec4(0.49, 0.416, 0.329, 1.0);
  }
  return vec4(0.0);
}

// dust puff: a flat two-tone disc that swells, drifts and shrinks away
vec4 puff(vec2 p, vec2 c, float t, float rmax){
  if (t < 0.0 || t > 1.0) return vec4(0.0);
  float r = rmax * (t < 0.6 ? sqrt(t / 0.6) : 1.0 - (t - 0.6) / 0.4 * 0.85);
  vec2 d = p - c;
  if (length(d) > r) return vec4(0.0);
  bool lit = d.y > -0.25 * r && d.x > -0.6 * r;
  return lit ? vec4(0.722, 0.635, 0.518, 1.0) : vec4(0.506, 0.431, 0.345, 1.0);
}

// impact: ground wave, debris chunks, dust puffs, a crack in the floor lip
vec4 impacts(vec2 pix, vec2 w){
  vec2 p = floor(pix) + 0.5;
  float fy = floorPy();
  vec4 res = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 im = uImp[i];
    float age = im.z;
    if (age < 0.0 || age > 1.3) continue;
    float fi = float(i);
    // crack in the floor lip (2 px deep zig-zag), gone after ~1 s
    if (age < 1.0 && w.y < 0.0 && w.y > -4.0) {
      float dx = p.x - im.x;
      float zz = floor(abs(dx) / 3.0);
      if (abs(dx) < 9.0 && abs(floor(fy - p.y) - mod(zz + fi, 2.0)) < 0.5) res = vec4(0.043, 0.051, 0.11, 1.0);
    }
    // ground wave: a thin dust band racing out along the floor
    if (age < 0.22) {
      float R = 4.0 + age * 140.0;
      float dx = abs(p.x - im.x);
      if (p.y > fy && p.y < fy + 2.0 + (1.0 - age / 0.22) * 2.0 && dx > R - 4.0 && dx < R) res = vec4(0.722, 0.635, 0.518, 1.0);
    }
    // debris chunks: ballistic, they land on the floor and lie there until they pop away
    for (int j = 0; j < 7; j++) {
      float fj = float(j) + fi * 7.0;
      float life = 0.75 + 0.35 * h11(fj * 2.1);
      if (age > life) continue;
      float vx = (h11(fj * 3.3) - 0.35) * 150.0;
      float vy = 70.0 + 90.0 * h11(fj * 5.7);
      float tl = 2.0 * vy / 420.0;                       // time to come back to the floor
      float ta = min(age, tl);
      vec2 pos = vec2(im.x + vx * ta * (age > tl ? 1.0 : 1.0) + (age > tl ? vx * 0.08 * min(age - tl, 0.15) : 0.0),
                      im.y + 1.0 + vy * ta - 210.0 * ta * ta);
      pos.y = max(pos.y, fy + 0.5);
      vec2 dd = floor(p) - floor(pos);
      bool big = j < 3;
      if (dd.x >= 0.0 && dd.y >= 0.0 && dd.x <= (big ? 1.0 : 0.0) && dd.y <= (big ? 1.0 : 0.0))
        res = (dd.y > 0.5 || !big) ? vec4(0.702, 0.51, 0.353, 1.0) : vec4(0.4, 0.267, 0.2, 1.0);
    }
    // dust puffs
    for (int j = 0; j < 4; j++) {
      float fj = float(j) + fi * 4.0;
      float life = 0.65 + 0.3 * h11(fj * 1.9);
      float t = (age - 0.02 * float(j)) / life;
      vec2 c = vec2(im.x + (h11(fj * 4.3) - 0.5) * 22.0 + (h11(fj * 6.1) - 0.5) * 18.0 * t, im.y + 4.0 + t * (8.0 + 10.0 * h11(fj)));
      vec4 pf = puff(p, c, t, 5.5 + 4.0 * h11(fj * 7.3));
      if (pf.a > 0.5) res = pf;
    }
  }
  // summon: puffs where the rocks break out of the floor
  for (int i = 0; i < 3; i++) {
    vec3 sm = uSum[i];
    if (sm.z < 0.0 || sm.z > 0.8) continue;
    for (int j = 0; j < 3; j++) {
      float fj = float(j) + float(i) * 3.0 + 40.0;
      float t = (sm.z - 0.03 * float(j)) / (0.55 + 0.2 * h11(fj));
      vec2 c = vec2(sm.x + (h11(fj * 4.3) - 0.5) * 14.0, sm.y + 2.0 + t * 7.0);
      vec4 pf = puff(p, c, t, 3.5 + 2.5 * h11(fj * 7.3));
      if (pf.a > 0.5) res = pf;
    }
  }
  return res;
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

void main(){
  ivec2 ip = ivec2(floor(vUv * uRes));
  vec2 pix = vec2(ip);
  vec2 w = uOrigin + (pix + 0.5) * uWpp;

  // ---- background ----
  vec3 col = w.y >= 0.0 ? wallColor(w, pix) : floorColor(w);
  // contact shadow
  float sx = (pix.x + 0.5 - uShadowX) / 22.0;
  float sy = (w.y + 1.5) / 3.5;
  float sh = 1.0 - (sx * sx + sy * sy);
  if (sh > 0.0) col *= sh > 0.45 ? 0.5 : 0.72;
  // faint banded glow on the wall around the floating rocks
  if (w.y >= 0.0) {
    float wl = 0.0;
    for (int i = 0; i < 3; i++) {
      if (uRock[i].z < 0.5) continue;
      wl = max(wl, clamp(1.0 - length(pix - uRock[i].xy) / (uRockV[i].z * 1.5 + 8.0), 0.0, 1.0));
    }
    wl = floor(wl * 3.0) / 3.0;
    col = col * (1.0 + 0.22 * wl) + vec3(0.07, 0.055, 0.02) * wl;
  }

  // ---- character ----
  bool isC = charAt(ip);
  float mU = maskAt(ip + ivec2(0, 1)), mD = maskAt(ip + ivec2(0, -1));
  float mL = maskAt(ip + ivec2(-1, 0)), mR = maskAt(ip + ivec2(1, 0));
  if (isC) {
    vec4 C = texelFetch(tChar, ip, 0);
    vec3 c = C.rgb;
    float d0 = depthAt(ip);
    float code = codeOf(C);
    float id = idOf(code);
    // depth-discontinuity lines (dark) and material-boundary seams (deep tone of the farther side)
    float line = 0.0, seam = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 o = k == 0 ? ivec2(0, 1) : (k == 1 ? ivec2(-1, 0) : (k == 2 ? ivec2(1, 0) : ivec2(0, -1)));
      if (maskAt(ip + o) < 0.5) continue;
      float dn = depthAt(ip + o);
      float idn = idAt(ip + o);
      if (d0 - dn > 0.0125) { if (id != 2.0 || idn != 2.0) line = 1.0; }   // no lines inside the hat's own tiers
      else {
        if (idn != id && dn < d0) {
          ivec2 pp = ivec2(o.y, o.x);
          bool thick = idAt(ip + 2 * o) == idn;
          bool run = (idAt(ip + pp + o) == idn && idAt(ip + pp) == id) || (idAt(ip - pp + o) == idn && idAt(ip - pp) == id);
          if (thick && run) seam = 1.0;
        }
      }
    }
    // rims on top and right edge runs (light from the upper right), never on features under 2 px
    bool runU = (maskAt(ip + ivec2(1, 0)) > 0.5 && maskAt(ip + ivec2(1, 1)) < 0.5) || (maskAt(ip + ivec2(-1, 0)) > 0.5 && maskAt(ip + ivec2(-1, 1)) < 0.5);
    bool runR = (maskAt(ip + ivec2(0, 1)) > 0.5 && maskAt(ip + ivec2(1, 1)) < 0.5) || (maskAt(ip + ivec2(0, -1)) > 0.5 && maskAt(ip + ivec2(1, -1)) < 0.5);
    bool thickV = idAt(ip - ivec2(0, 1)) == id;
    bool thickH = idAt(ip - ivec2(1, 0)) == id;
    if (mR < 0.5 && runR && thickH) c = c * 1.32 + vec3(0.05, 0.045, 0.035);
    else if (mU < 0.5 && runU && thickV) c = c * 1.22 + vec3(0.04, 0.035, 0.03);
    if (seam > 0.5 && line < 0.5) c = c * 0.55;
    if (line > 0.5) c = mix(c, vec3(0.04, 0.025, 0.035), 0.85);
    col = c;
  } else if (mU + mD + mL + mR > 0.5) {
    // selective 1 px outline: a deep version of the neighbouring colour (dark brown around cream, near-black
    // around the body)
    ivec2 o = mU > 0.5 ? ivec2(0, 1) : (mL > 0.5 ? ivec2(-1, 0) : (mR > 0.5 ? ivec2(1, 0) : ivec2(0, -1)));
    vec3 nc = texelFetch(tChar, cl(ip + o), 0).rgb;
    col = mix(nc * 0.3, vec3(0.039, 0.027, 0.039), 0.45);
  }

  // ---- FX ----
  vec4 tr = trails(pix);
  if (tr.a > 0.5 && !isC && w.y >= 0.0) col = tr.rgb;
  vec4 im = impacts(pix, w);
  if (im.a > 0.5) col = im.rgb;
  vec4 sp = specks(pix);
  if (sp.a > 0.5 && !isC && w.y >= 0.0) col = sp.rgb;
  vec4 ey = eyes(ip);
  if (ey.a > 0.5) col = ey.rgb;

  // ---- palette quantization ----
  col = quantize(col);
  gl_FragColor = vec4(col, 1.0);
}`;
