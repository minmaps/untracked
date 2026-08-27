"""Genere les icones de Rideau : un oeil barre, sans dependance externe.

Rendu 4x puis reduction en moyennant les composantes premultipliees, ce qui
donne un anticrenelage propre y compris sur le bord arrondi transparent.

Usage : python tools/make-icons.py
"""

import math
import os
import struct
import zlib

ACCENT = (124, 156, 255, 255)
DARK = (20, 22, 26, 255)
SS = 4  # facteur de suramplification


def rounded_rect(x, y, size, radius):
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return math.hypot(x - cx, y - cy) <= radius


def in_circle(x, y, cx, cy, r):
    return math.hypot(x - cx, y - cy) <= r


def render(size):
    s = size * SS
    c = s / 2.0

    # Amande de l'oeil : intersection de deux disques de meme rayon.
    w, h = 0.32 * s, 0.185 * s
    r_eye = (w * w + h * h) / (2 * h)
    c1y, c2y = c + r_eye - h, c - r_eye + h

    r_pupil = 0.125 * s
    ang = math.radians(-45)
    ca, sa = math.cos(ang), math.sin(ang)
    slash_half_len, slash_half_w, slash_border = 0.40 * s, 0.036 * s, 0.030 * s
    radius = 0.24 * s

    buf = bytearray(s * s * 4)
    for py in range(s):
        y = py + 0.5
        for px in range(s):
            x = px + 0.5
            if not rounded_rect(x, y, s, radius):
                continue

            color = ACCENT
            if in_circle(x, y, c, c1y, r_eye) and in_circle(x, y, c, c2y, r_eye):
                color = DARK
                if in_circle(x, y, c, c, r_pupil):
                    color = ACCENT

            u = (x - c) * ca + (y - c) * sa
            v = -(x - c) * sa + (y - c) * ca
            if abs(u) <= slash_half_len:
                if abs(v) <= slash_half_w:
                    color = DARK
                elif abs(v) <= slash_half_w + slash_border:
                    color = ACCENT

            i = (py * s + px) * 4
            buf[i : i + 4] = bytes(color)
    return buf, s


def downsample(buf, s, size):
    out = bytearray(size * size * 4)
    n = SS * SS
    for oy in range(size):
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                row = (oy * SS + dy) * s
                for dx in range(SS):
                    i = (row + ox * SS + dx) * 4
                    alpha = buf[i + 3]
                    # Premultiplication : sans elle, les pixels transparents
                    # tireraient la couleur du bord vers le noir.
                    r += buf[i] * alpha
                    g += buf[i + 1] * alpha
                    b += buf[i + 2] * alpha
                    a += alpha
            j = (oy * size + ox) * 4
            if a:
                out[j] = min(255, round(r / a))
                out[j + 1] = min(255, round(g / a))
                out[j + 2] = min(255, round(b / a))
            out[j + 3] = round(a / n)
    return out


def write_png(path, size, pixels):
    raw = b"".join(
        b"\x00" + bytes(pixels[y * size * 4 : (y + 1) * size * 4]) for y in range(size)
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        buf, s = render(size)
        write_png(os.path.join(out_dir, f"icon{size}.png"), size, downsample(buf, s, size))
        print(f"icon{size}.png")


if __name__ == "__main__":
    main()
