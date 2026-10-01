"""Run cycle for the earth mage from the 8 hand-drawn run frames + a looping MP4.

Source: assets/earth-mage/run_source_8f.png (1x pixel art, two rows of four frames).
Cleanup applied to the drawn frames (pixels are never resampled, only moved, copied or removed):
  - one canonical head + hat (from frame 1) is pasted onto every frame at that frame's eye, so the hat
    keeps exactly one size instead of drifting between 56 and 63 px,
  - frames of the second row are drawn ~1-2 px taller; their shins lose the matching number of rows
    (the rows most similar to the row below are removed), so the stride does not limp,
  - every grounded frame stands on the floor; the flight frame floats 2 px above its neighbours.
Cycle (8 frames, two steps): contact, down, passing, flight, contact, down, passing, flight.

Outputs (assets/earth-mage/):
  run_sheet.png  8-frame cycle, 1x, transparent, frames on a common baseline
  run.mp4        1920x1080, 8x nearest upscale, 6 s seamless loop, floor scrolling under the runner

Usage: python3 tools/mage_run.py
"""
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets' / 'earth-mage'
SOURCE = ASSETS / 'run_source_8f.png'

ORDER = [0, 3, 1, 2, 7, 5, 6, 2]      # source frame index per cycle frame (1-based: 1 4 2 3 8 6 7 3)
FLIGHT = {2}                           # source frames with both feet off the ground
SHORTEN = {7: 2, 5: 1, 6: 1}           # second-row frames: shin rows to remove
FPS = 12
CYCLES = 9                             # 9 x 8 frames = 6 s
SCALE = 8
ART_W, ART_H = 1920 // SCALE, 1080 // SCALE
FLOOR_Y = ART_H - 20
SCROLL = 6                             # floor scroll per frame (art px); 48 px per cycle = two floor blocks

WALL = (43, 95, 106)
FLOOR_TOP, FLOOR, FLOOR_LINE = (42, 61, 97), (30, 38, 72), (21, 23, 52)
SHADOW = (24, 30, 58)


def split_frames(sheet):
    fg = sheet[..., 3] > 0

    def bands(p, minlen=8):
        out, s = [], None
        for i, v in enumerate(list(p > 0) + [False]):
            if v and s is None:
                s = i
            if not v and s is not None:
                if i - s >= minlen:
                    out.append((s, i))
                s = None
        return out

    frames = []
    for r0, r1 in bands(fg.sum(1)):
        for c0, c1 in bands(fg[r0:r1].sum(0)):
            f = sheet[r0:r1, c0:c1]
            ys, xs = np.nonzero(f[..., 3])
            frames.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy())
    return frames


def eye_pos(f):
    """Top-left of the light eye pixels in the face band under the hat."""
    h, w = f.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    lum = f[..., :3].astype(int).sum(-1)
    m = (f[..., 3] > 0) & (lum > 560) & (yy >= 14) & (yy <= 30)
    ys, xs = np.nonzero(m)
    return int(ys.min()), int(xs.min())


def shorten_shins(f, k):
    """Remove k rows from the lower legs: each time the row (between pants and shoes) most similar to the
    row below it, which keeps vertical shin lines intact."""
    for _ in range(k):
        h = f.shape[0]
        best, by = None, None
        for y in range(h - 26, h - 9):
            a, b = f[y], f[y + 1]
            cost = int(np.any(a != b, axis=-1).sum())
            if best is None or cost < best:
                best, by = cost, y
        f = np.delete(f, by, axis=0)
    return f


def paste_head(f, head, head_eye, eye):
    """Replace everything above the neck with the canonical head + hat, aligned on the eye."""
    out = f.copy()
    ey, ex = eye
    hy, hx = head_eye
    cut = ey + 4
    out[:cut + 1] = 0
    dy, dx = ey - hy, ex - hx
    hh, hw = head.shape[:2]
    pad_top = max(0, -dy)
    if pad_top:                              # the canonical hat sits higher than this frame's top: grow upward
        out = np.concatenate([np.zeros((pad_top,) + out.shape[1:], out.dtype), out], axis=0)
        dy += pad_top
    pad_l, pad_r = max(0, -dx), max(0, dx + hw - out.shape[1])
    if pad_l or pad_r:
        out = np.concatenate([np.zeros((out.shape[0], pad_l, 4), out.dtype), out, np.zeros((out.shape[0], pad_r, 4), out.dtype)], axis=1)
        dx += pad_l
    m = head[..., 3] > 0
    region = out[dy:dy + hh, dx:dx + hw]
    region[m] = head[m]
    return out, (eye[0] + pad_top, eye[1] + pad_l)


def build():
    sheet = np.asarray(Image.open(SOURCE).convert('RGBA')).copy()
    sheet[..., 3] = np.where(sheet[..., 3] > 127, 255, 0)
    src = split_frames(sheet)
    # canonical head + hat from frame 1: everything down to 4 rows below the eye
    e0 = eye_pos(src[0])
    head = src[0][:e0[0] + 5].copy()

    cleaned, eyes = [], []
    for i, f in enumerate(src):
        f = shorten_shins(f, SHORTEN.get(i, 0))
        f, e = paste_head(f, head, e0, eye_pos(f))
        cleaned.append(f)
        eyes.append(e)

    # baseline: grounded frames put their lowest pixel on the floor; the flight frame floats above
    heights = {i: (f.shape[0] - 1) - eyes[i][0] for i, f in enumerate(cleaned)}   # eye height above the feet
    grounded = [heights[i] for i in set(ORDER) if i not in FLIGHT]
    lift = {i: (max(grounded) + 2 - heights[i]) if i in FLIGHT else 0 for i in range(len(cleaned))}

    # common canvas: eye at a fixed x, feet on a common baseline
    W = 100
    H = max(f.shape[0] + lift[i] for i, f in enumerate(cleaned)) + 2
    EYE_X = 58
    out = []
    for i in ORDER:
        f = cleaned[i]
        c = np.zeros((H, W, 4), np.uint8)
        ox = EYE_X - eyes[i][1]
        oy = H - 1 - (f.shape[0] - 1) - lift[i]
        hh, ww = f.shape[:2]
        x0, x1 = max(0, ox), min(W, ox + ww)
        region = c[oy:oy + hh, x0:x1]
        src_part = f[:, x0 - ox:x1 - ox]
        m = src_part[..., 3] > 0
        region[m] = src_part[m]
        out.append((c, lift[i]))
    return out


def scene(frame, lift, f):
    c = np.zeros((ART_H, ART_W, 3), np.uint8)
    c[:] = WALL
    c[FLOOR_Y] = FLOOR_TOP
    c[FLOOR_Y + 1:] = FLOOR
    off = (f * SCROLL) % 24
    for yy in range(FLOOR_Y + 1, ART_H):
        row = yy - FLOOR_Y - 1
        if row % 9 == 8:
            c[yy] = FLOOR_LINE
        else:
            for xx in range(((row // 9) * 7 - off) % 24, ART_W, 24):
                c[yy, xx] = FLOOR_LINE
    sh, sw = frame.shape[:2]
    ox = (ART_W - sw) // 2
    oy = FLOOR_Y - sh + 1
    half = max(6, 14 - 2 * lift)                     # contact shadow shrinks while airborne
    cx = ox + 50
    c[FLOOR_Y, cx - half: cx + half] = SHADOW
    a = frame[..., 3] > 0
    region = c[oy:oy + sh, ox:ox + sw]
    region[a] = frame[..., :3][a]
    return c


def main():
    cycle = build()
    fh, fw = cycle[0][0].shape[:2]
    sheet = np.zeros((fh, fw * len(cycle), 4), np.uint8)
    for k, (fr, _) in enumerate(cycle):
        sheet[:, k * fw:(k + 1) * fw] = fr
    Image.fromarray(sheet, 'RGBA').save(ASSETS / 'run_sheet.png')

    out = ASSETS / 'run.mp4'
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{ART_W * SCALE}x{ART_H * SCALE}',
           '-r', str(FPS * 2), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-tune', 'animation',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    total = len(cycle) * CYCLES
    for f in range(total):
        fr, lift = cycle[f % len(cycle)]
        big = np.repeat(np.repeat(scene(fr, lift, f), SCALE, axis=0), SCALE, axis=1).tobytes()
        p.stdin.write(big)
        p.stdin.write(big)
    p.stdin.close()
    p.wait()
    print('wrote', out, 'and', ASSETS / 'run_sheet.png', f'({total} frames, {total / FPS:.1f} s)')


if __name__ == '__main__':
    main()
