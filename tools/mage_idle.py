"""Pixel-art idle loop for the earth mage sprite + a looping MP4.

The sprite (assets/earth-mage/earth_mage_55x84.png, 1 px = 1 art pixel) is cut into parts that move by whole
pixels only (no rotation, so the pixel art stays intact):
  - torso (collar, sash, both arms) breathes 1 px down,
  - the head follows one frame later, the hat two frames later (overlap),
  - the magic forearm + hand holds steady in the air (counter-phase to the breath),
  - the eyes blink once per video.
A part that moves down repeats its top row (like a stretching neck), so no gaps open between parts.

Outputs (assets/earth-mage/):
  idle_sheet.png  24-frame breathing cycle, 1x, transparent (for the engine)
  idle.mp4        1920x1080, 8x nearest upscale, 6 s seamless loop (3 breaths, one blink)

Usage: python3 tools/mage_idle.py
"""
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets' / 'earth-mage'
SPRITE = ASSETS / 'earth_mage_55x84.png'

CYCLE = 24            # frames per breath
CYCLES = 3            # breaths per video
FPS = 12              # animation frame rate (the MP4 runs at 24 fps, every frame shown twice)
BLINK = (CYCLE + 2, CYCLE + 3)   # frames with the eyes closed
SCALE = 8             # MP4 upscale (even, so H.264 chroma blocks never straddle an art pixel)
ART_W, ART_H = 1920 // SCALE, 1080 // SCALE   # 240 x 135 art canvas
FLOOR_Y = ART_H - 20                          # first floor row

WALL = (43, 95, 106)
FLOOR_TOP, FLOOR, FLOOR_LINE = (42, 61, 97), (30, 38, 72), (21, 23, 52)
SHADOW = (24, 30, 58)


def load_parts(spr):
    """Boolean masks for the moving parts, from the 55x84 sprite's layout (rows/columns in art pixels)."""
    h, w = spr.shape[:2]
    y, x = np.mgrid[0:h, 0:w]
    opaque = spr[..., 3] > 0
    hat = opaque & (y <= 14)
    head = opaque & (y >= 15) & (y <= 22)
    hand = opaque & (x >= 38) & (y >= 34) & (y <= 45)          # magic forearm + claw
    torso = opaque & (y >= 23) & (y <= 40) & ~hand
    torso |= opaque & (x <= 13) & (y >= 23)                     # the hanging arm moves with the torso
    lower = opaque & ~(hat | head | hand | torso)               # pants + legs stay planted
    return {'lower': lower, 'torso': torso, 'hand': hand, 'head': head, 'hat': hat}


def eye_mask(spr):
    """The light eye pixels inside the face."""
    h, w = spr.shape[:2]
    y, x = np.mgrid[0:h, 0:w]
    lum = spr[..., :3].astype(int).sum(-1)
    return (spr[..., 3] > 0) & (y >= 15) & (y <= 20) & (x >= 18) & (x <= 34) & (lum > 450)


def breath(f):
    """0/1 px drop of a breath at frame f (smooth cosine, quantised to whole pixels)."""
    return int(round(0.5 - 0.5 * np.cos(2 * np.pi * (f % CYCLE) / CYCLE)))


def offsets(f):
    t = breath(f)
    return {
        'lower': 0,
        'torso': t,
        'head': breath(f - 1),
        'hat': breath(f - 2),
        'hand': 1,           # steady in the air: total drop stays 1 px whatever the torso does
    }


def paste(canvas, spr, mask, ox, oy, dy, stretch):
    """Draw the masked part at (ox, oy + dy). With stretch, a downward move repeats the part's top row."""
    ys, xs = np.nonzero(mask)
    for k in range(0, dy + 1) if stretch else (dy,):
        canvas[oy + ys + k, ox + xs] = spr[ys, xs]


def frame(spr, parts, eyes, face_col, f):
    h, w = spr.shape[:2]
    pad = 2
    img = np.zeros((h + pad * 2, w + pad * 2, 4), np.uint8)
    s = spr.copy()
    if BLINK[0] <= f <= BLINK[1]:
        s[eyes, :3] = face_col
    off = offsets(f)
    # back to front: legs/pants, torso (+ hanging arm), magic hand, head, hat
    paste(img, s, parts['lower'], pad, pad, 0, False)
    paste(img, s, parts['torso'], pad, pad, off['torso'], True)
    paste(img, s, parts['hand'], pad, pad, off['hand'], True)
    paste(img, s, parts['head'], pad, pad, off['head'], True)
    paste(img, s, parts['hat'], pad, pad, off['hat'], False)
    return img


def scene(sprite_frame):
    """Composite one 1x frame onto the art canvas: flat teal wall, dark floor, contact shadow."""
    c = np.zeros((ART_H, ART_W, 3), np.uint8)
    c[:] = WALL
    c[FLOOR_Y] = FLOOR_TOP
    c[FLOOR_Y + 1:] = FLOOR
    for yy in range(FLOOR_Y + 1, ART_H):
        row = yy - FLOOR_Y - 1
        if row % 9 == 8:
            c[yy] = FLOOR_LINE
        else:
            for xx in range((row // 9) * 7 % 24, ART_W, 24):
                c[yy, xx] = FLOOR_LINE
    sh, sw = sprite_frame.shape[:2]
    ox = (ART_W - sw) // 2
    oy = FLOOR_Y - sh + 2          # 2 px padding below the feet in the frame
    c[FLOOR_Y, ox + 8: ox + sw - 8] = SHADOW
    a = sprite_frame[..., 3] > 0
    region = c[oy:oy + sh, ox:ox + sw]
    region[a] = sprite_frame[..., :3][a]
    return c


def main():
    spr = np.asarray(Image.open(SPRITE).convert('RGBA')).copy()
    spr[..., 3] = np.where(spr[..., 3] > 127, 255, 0)
    parts = load_parts(spr)
    eyes = eye_mask(spr)
    face_col = spr[19, 26, :3]
    total = CYCLE * CYCLES
    frames = [frame(spr, parts, eyes, face_col, f) for f in range(total)]

    # 1x sprite sheet of one breathing cycle (no blink)
    fh, fw = frames[0].shape[:2]
    sheet = np.zeros((fh, fw * CYCLE, 4), np.uint8)
    for i in range(CYCLE):
        sheet[:, i * fw:(i + 1) * fw] = frames[i]          # first cycle has no blink
    Image.fromarray(sheet, 'RGBA').save(ASSETS / 'idle_sheet.png')

    # MP4: 8x nearest upscale, 24 fps (each animation frame twice), lossless-looking H.264
    out = ASSETS / 'idle.mp4'
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{ART_W * SCALE}x{ART_H * SCALE}',
           '-r', str(FPS * 2), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-tune', 'animation',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in frames:
        big = np.repeat(np.repeat(scene(f), SCALE, axis=0), SCALE, axis=1)
        p.stdin.write(big.tobytes())
        p.stdin.write(big.tobytes())
    p.stdin.close()
    p.wait()
    print('wrote', out, 'and', ASSETS / 'idle_sheet.png', f'({total} frames, {total / FPS:.1f} s)')


if __name__ == '__main__':
    main()
