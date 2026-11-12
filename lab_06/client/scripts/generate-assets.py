"""Generates public/assets: sprites.png + atlas.json + WAV sound effects (all procedural, no licences)."""
import json, math, random, struct, wave
from PIL import Image, ImageDraw, ImageFilter

OUT = "public/assets"
SS = 4  # supersampling factor for anti-aliasing

FRAMES = {  # name: (x, y, w, h)
    "asteroid_large_a": (0, 0, 192, 192), "asteroid_large_b": (192, 0, 192, 192),
    "asteroid_small_a": (384, 0, 96, 96), "asteroid_small_b": (480, 0, 96, 96),
    "ship": (576, 0, 96, 96), "pickup_repair": (672, 0, 96, 96), "pickup_homing": (768, 0, 96, 96),
    "spark": (864, 0, 32, 32), "bullet": (864, 32, 48, 24), "bullet_homing": (864, 64, 48, 24),
    "flame": (0, 192, 128, 64),
}


def canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def finish(img, w, h):
    return img.resize((w, h), Image.LANCZOS)


def asteroid(w, seed):
    rnd = random.Random(seed)
    img = canvas(w, w)
    d = ImageDraw.Draw(img)
    c = w * SS / 2
    n = 12
    pts = []
    for i in range(n):
        a = i / n * math.tau
        r = c * 0.92 * (0.82 + 0.18 * rnd.random())
        pts.append((c + math.cos(a) * r, c + math.sin(a) * r))
    d.polygon(pts, fill=(58, 60, 70, 255), outline=(200, 204, 214, 255), width=3 * SS)
    for _ in range(4):
        cx, cy = c + rnd.uniform(-0.4, 0.4) * c, c + rnd.uniform(-0.4, 0.4) * c
        r = rnd.uniform(0.08, 0.16) * c
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(40, 42, 50, 255), outline=(120, 124, 136, 255), width=SS)
    return finish(img, w, w)


def ship():
    img = canvas(96, 96)
    d = ImageDraw.Draw(img)
    s = SS * 96 / 96
    pts = [(0.92, 0.5), (0.18, 0.18), (0.36, 0.5), (0.18, 0.82)]
    d.polygon([(x * 96 * s, y * 96 * s) for x, y in pts], fill=(245, 245, 247, 255), outline=(10, 132, 255, 255), width=4 * SS)
    return finish(img, 96, 96)


def ring(color, glyph):
    img = canvas(96, 96)
    d = ImageDraw.Draw(img)
    c = 48 * SS
    d.ellipse((c - 36 * SS, c - 36 * SS, c + 36 * SS, c + 36 * SS), fill=color + (60,), outline=color + (255,), width=4 * SS)
    if glyph == "plus":
        d.rectangle((c - 5 * SS, c - 20 * SS, c + 5 * SS, c + 20 * SS), fill=color + (255,))
        d.rectangle((c - 20 * SS, c - 5 * SS, c + 20 * SS, c + 5 * SS), fill=color + (255,))
    else:
        d.ellipse((c - 14 * SS, c - 14 * SS, c + 14 * SS, c + 14 * SS), outline=color + (255,), width=3 * SS)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            d.line((c + dx * 14 * SS, c + dy * 14 * SS, c + dx * 26 * SS, c + dy * 26 * SS), fill=color + (255,), width=3 * SS)
    return finish(img, 96, 96)


def capsule(color):
    img = canvas(48, 24)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((2 * SS, 6 * SS, 46 * SS, 18 * SS), radius=6 * SS, fill=color + (255,))
    d.rounded_rectangle((20 * SS, 9 * SS, 44 * SS, 15 * SS), radius=3 * SS, fill=(255, 255, 255, 230))
    return finish(img, 48, 24)


def spark():
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = img.load()
    for y in range(32):
        for x in range(32):
            t = max(0.0, 1 - math.hypot(x - 15.5, y - 15.5) / 15.5)
            px[x, y] = (255, 159, 10, int(255 * t * t))
    return img


def flame():
    img = canvas(128, 64)
    d = ImageDraw.Draw(img)
    d.polygon([(128 * SS, 14 * SS), (4 * SS, 32 * SS), (128 * SS, 50 * SS)], fill=(255, 159, 10, 255))
    d.polygon([(128 * SS, 24 * SS), (40 * SS, 32 * SS), (128 * SS, 40 * SS)], fill=(255, 230, 130, 255))
    return finish(img, 128, 64).filter(ImageFilter.GaussianBlur(0.6))


sheet = Image.new("RGBA", (1024, 256), (0, 0, 0, 0))
parts = {
    "asteroid_large_a": asteroid(192, 1), "asteroid_large_b": asteroid(192, 2),
    "asteroid_small_a": asteroid(96, 3), "asteroid_small_b": asteroid(96, 4),
    "ship": ship(), "pickup_repair": ring((48, 209, 88), "plus"), "pickup_homing": ring((255, 159, 10), "cross"),
    "spark": spark(), "bullet": capsule((100, 210, 255)), "bullet_homing": capsule((255, 159, 10)), "flame": flame(),
}
for name, (x, y, w, h) in FRAMES.items():
    sheet.paste(parts[name], (x, y))
sheet.save(f"{OUT}/sprites.png", optimize=True)
json.dump({"version": 1, "frames": {k: dict(zip("xywh", v)) for k, v in FRAMES.items()}}, open(f"{OUT}/atlas.json", "w"), indent=2)

RATE = 44100


def write_wav(name, samples):
    with wave.open(f"{OUT}/{name}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))


def render(seconds, fn):
    return [fn(i / RATE, i / RATE / seconds) for i in range(int(RATE * seconds))]


rnd = random.Random(7)
write_wav("fire", render(0.14, lambda t, p: 0.55 * math.sin(math.tau * (900 - 700 * p) * t) * (1 - p) ** 2 + 0.15 * (rnd.random() * 2 - 1) * (1 - p) ** 3))
write_wav("hit", render(0.09, lambda t, p: 0.6 * math.sin(math.tau * 220 * t) * (1 - p) ** 2 + 0.3 * (rnd.random() * 2 - 1) * (1 - p) ** 4))
lp = 0.0
def boom(t, p):
    global lp
    lp += 0.12 * ((rnd.random() * 2 - 1) - lp)
    return 1.6 * lp * (1 - p) ** 2 + 0.3 * math.sin(math.tau * 60 * t) * (1 - p)
write_wav("explode", render(0.7, boom))
write_wav("pickup", render(0.18, lambda t, p: 0.4 * math.sin(math.tau * (520 + 700 * p) * t) * (1 - p)))
print("assets generated")
