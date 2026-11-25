"""Gera o sprite da CASA PRINCIPAL da fazenda a partir de docs/casa_fazenda.jpeg (casa de tijolos, vista 3/4).
uso: python tools/make-house-sprite.py        (precisa de numpy, scipy, opencv-python)

Saída:
  assets/casa.png    RGBA, fundo transparente, EXPORT_W x EXPORT_H px (o jogo desenha em DISPLAY_W x DISPLAY_H = 6,3 x 5 tiles, base alinhada à base do bloco)
  assets/casa.json   metadados: tamanho, porta, luzes das janelas (para a noite) — as mesmas constantes ficam em game.js (HOUSE) e o tests/build.test.js confere

Método: o JPEG traz um "xadrez de transparência" DESENHADO no fundo (cinza claro ~187 e cinza escuro ~109, sem cor). O telhado também é cinza, e o contorno fino
do telhado é neutro: por isso o fundo = pixels sem cor E claros (V >= 96, o contorno escuro fica de fora), com abertura (corta pontes finas) e propagação a partir da borda.
Depois: contorno liso, alfa curto e firme, cor da borda vinda do contorno escuro logo abaixo (sem halo claro do xadrez), recorte, redução com alfa pré-multiplicado."""
import json, os
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'casa_fazenda.jpeg')
OUT = os.path.join(ROOT, 'assets')
EXPORT_W, EXPORT_H = 604, 480          # ~0,77x da fonte (a 1x do jogo a casa aparece a 0,67 do arquivo: sobra resolução para telas dpr 2)
DISPLAY_W, DISPLAY_H = 403, 320        # tamanho na tela (px lógicos): 6,3 x 5 tiles
PAD = 2

# pontos do desenho original (px da fonte) usados no jogo
DOOR_SRC = (768, 445)                                                       # porta vermelha, no pórtico
WINDOWS_SRC = [(502, 265), (455, 397), (550, 437), (665, 445), (785, 210), (853, 408), (921, 408), (1048, 357)]

bgr = cv2.imread(SRC)
if bgr is None: raise SystemExit('não achei ' + SRC)
rgb = bgr[:, :, ::-1].astype(np.int32)
chroma = rgb.max(-1) - rgb.min(-1); V = rgb.max(-1)
cand = (chroma < 7) & (V >= 96)
core = ndi.binary_opening(cand, structure=np.ones((5, 5)))
lab, _ = ndi.label(core)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = ndi.binary_dilation(np.isin(lab, list(border)), structure=np.ones((3, 3)), iterations=4) & ((chroma < 9) & (V >= 86))
fg = ~bg
l2, n2 = ndi.label(fg)
sizes = ndi.sum(fg, l2, range(1, n2 + 1))
house = l2 == (int(np.argmax(sizes)) + 1)                                   # só o maior componente: a casa (sobras de xadrez somem)
house = ndi.binary_fill_holes(house)                                        # vidros e frestas fechadas dentro da casa

ys, xs = np.nonzero(house)
x0, x1, y0, y1 = max(0, xs.min() - PAD), xs.max() + 1 + PAD, max(0, ys.min() - PAD), ys.max() + 1 + PAD
m = cv2.GaussianBlur(house[y0:y1, x0:x1].astype(np.float32), (0, 0), 1.0) > 0.5          # contorno liso
img = bgr[y0:y1, x0:x1, ::-1].astype(np.float32)
core = ndi.binary_erosion(m, structure=np.ones((3, 3)), iterations=2)       # interior seguro: sem mistura com o xadrez
band = (core & ~ndi.binary_erosion(core, structure=np.ones((3, 3)), iterations=2)).astype(np.float32)
num = cv2.GaussianBlur(img * band[..., None], (0, 0), 2.0); den = cv2.GaussianBlur(band, (0, 0), 2.0)[..., None]
solid = np.where(core[..., None], img, num / np.maximum(den, 1e-4))
a = np.clip((cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) - 0.2) / 0.6, 0, 1)
src_w, src_h = x1 - x0, y1 - y0

# redução com alfa pré-multiplicado (sem halo escuro/claro)
pm = np.dstack([solid * a[..., None], a * 255]).astype(np.float32)
small = cv2.resize(pm, (EXPORT_W, EXPORT_H), interpolation=cv2.INTER_AREA)
al = small[..., 3:4] / 255
rgb_out = np.where(al > 0.004, small[..., :3] / np.maximum(al, 1e-6), 0)
rgba = np.clip(np.dstack([rgb_out, small[..., 3]]), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
png = os.path.join(OUT, 'casa.png')
cv2.imwrite(png, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# coordenadas para o jogo: em px de TELA (DISPLAY) relativos ao canto superior esquerdo do sprite
kx, ky = DISPLAY_W / src_w, DISPLAY_H / src_h
to_disp = lambda p: [round((p[0] - x0) * kx), round((p[1] - y0) * ky)]
meta = {
    'image': 'casa.png', 'size': [EXPORT_W, EXPORT_H], 'display': [DISPLAY_W, DISPLAY_H],
    'door': to_disp(DOOR_SRC), 'lights': [to_disp(p) for p in WINDOWS_SRC],
    'note': 'origem das coordenadas = canto superior esquerdo do sprite desenhado em display (403x320). O jogo coloca o sprite com a BASE na base do bloco da casa (7x5 tiles), centrado.',
}
with open(os.path.join(OUT, 'casa.json'), 'w', encoding='utf-8') as fh: json.dump(meta, fh, ensure_ascii=False, indent=2); fh.write('\n')
print('casa.png', EXPORT_W, 'x', EXPORT_H, os.path.getsize(png), 'bytes · porta', meta['door'], '· luzes', meta['lights'])
