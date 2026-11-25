"""Gera os ícones do PWA (pwa/icon-*.png) a partir dos sprites do jogo. Rodado UMA vez; os PNGs ficam no repositório.
uso: python tools/make-icons.py   (precisa do Pillow: pip install pillow)"""
from PIL import Image, ImageDraw
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = lambda *p: os.path.join(ROOT, 'assets', *p)

def canvas(size, safe):
    """grama (tile repetido) + o fazendeiro de frente; `safe` = fração central que fica visível em ícone "maskable" (o resto pode ser cortado)"""
    tile = Image.open(A('tile_grassA.png')).convert('RGBA')
    im = Image.new('RGBA', (size, size))
    t = max(1, round(size / 5))
    tl = tile.resize((t, t), Image.NEAREST)
    for y in range(0, size, t):
        for x in range(0, size, t):
            im.paste(tl, (x, y))
    d = ImageDraw.Draw(im)
    # sol/horizonte discreto no alto e uma faixa de terra arada embaixo, para o ícone não ser só "verde"
    d.rectangle([0, int(size * .78), size, size], fill=(92, 58, 28, 255))
    for i in range(6):
        d.line([0, int(size * (.8 + i * .035)), size, int(size * (.8 + i * .035))], fill=(62, 37, 18, 255), width=max(1, size // 128))
    hero = Image.open(A('fazendeiro', 'front_walk.png')).convert('RGBA')
    box = hero.getbbox(); hero = hero.crop(box)
    h = int(size * safe * .9); w = round(hero.width * h / hero.height)
    hero = hero.resize((w, h), Image.NEAREST)
    im.alpha_composite(hero, ((size - w) // 2, int(size * .06 + (size * safe * .9 < size * .82 and (size * (1 - safe) / 2) or 0))))
    return im.convert('RGB')

os.makedirs(os.path.join(ROOT, 'pwa'), exist_ok=True)
out = lambda n: os.path.join(ROOT, 'pwa', n)
for n, s, safe in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-180.png', 180, 1.0), ('icon-maskable-512.png', 512, .72)]:
    canvas(s, safe).save(out(n), optimize=True)
    print(n, os.path.getsize(out(n)), 'bytes')
