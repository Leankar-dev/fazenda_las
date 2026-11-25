"""Gera os sprites do CAVALO a partir de docs/cavalo_sprite_sheet.jpeg (ciclo de caminhada: 4 direções x 5 quadros).
uso: python tools/make-horse-sprites.py        (precisa de numpy, scipy, opencv-python e Pillow)

Saída em assets/animais/cavalo/:
  walk_sheet.png   grade UNIFORME de 5 colunas (quadros do ciclo) x 4 linhas (direções), células de CELL_W x CELL_H, fundo transparente
                   linha 0 = direita · 1 = esquerda · 2 = frente (anda para baixo) · 3 = costas (anda para cima)
                   cada quadro ancorado: PÉS no centro-base da célula (o jogo desenha com a base da célula no chão)
  walk_sheet.json  metadados (célula, linhas, quadros, quadro de repouso, largura da "pegada" para a sombra) — o jogo usa as mesmas constantes em animais.js
  icon.png         busto 96x96 (cabeça e pescoço) para a loja

Método: a fonte é um JPEG com fundo de fazenda borrado e grade. O cavalo é marrom/escuro e o fundo é claro/azulado/bege, então
máscara = (escuro OU marrom quente) -> abertura (tira as linhas da grade) -> um componente por célula -> fecha só os buracos da CABEÇA (a "estrela" branca do focinho) ->
borda suave (alfa) com a COR da borda tirada do interior (sem halo claro do fundo). Escala nativa (1:1): o jogo desenha de 1x a 3x. """
import json, os
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'cavalo_sprite_sheet.jpeg')
OUT = os.path.join(ROOT, 'assets', 'animais', 'cavalo')
COLS, ROWS = 5, 4
ROW_NAMES = ['right', 'left', 'down', 'up']
CELL_W, CELL_H = 184, 160          # cabe o maior quadro (172 x 154) com folga; pés ficam a PAD_B px do fundo
PAD_B = 2
HOLE_MAX = 400                  # px: teto de segurança para um buraco na cabeça
HEAD_FRAC = 0.32                # a estrela do focinho está no terço superior do cavalo

bgr = cv2.imread(SRC)
if bgr is None: raise SystemExit('não achei ' + SRC)
rgb = bgr[:, :, ::-1].astype(np.int32)
R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
V = rgb.max(-1)
mask = (((V < 185) & (R - B > 38) & (R >= G)) | (V < 105))
mask[:80, :] = False; mask[:, :270] = False; mask[:, 1340:] = False; mask[750:, :] = False      # título, rótulos "WALK ..." e a borda inferior
mask = ndi.binary_opening(mask, structure=np.ones((2, 2)))
lab, n = ndi.label(mask)
comps = []
for i, sl in enumerate(ndi.find_objects(lab), 1):
    area = int((lab[sl] == i).sum())
    if area < 250: continue
    comps.append((i, sl, area))
if len(comps) != COLS * ROWS: raise SystemExit('esperava %d cavalos, achei %d — confira a máscara' % (COLS * ROWS, len(comps)))
# agrupa em linhas (pelo centro vertical) e ordena por coluna (centro horizontal)
comps.sort(key=lambda c: (c[1][0].start + c[1][0].stop) / 2)
grid = []
for r in range(ROWS):
    row = sorted(comps[r * COLS:(r + 1) * COLS], key=lambda c: c[1][1].start)
    grid.append(row)


def cut(i, sl):
    """quadro RGBA do componente `i`: alfa suave e cor da borda vinda do interior"""
    pad = 6
    y0, y1, x0, x1 = max(0, sl[0].start - pad), sl[0].stop + pad, max(0, sl[1].start - pad), sl[1].stop + pad
    m = (lab[y0:y1, x0:x1] == i)
    # buracos: a "estrela" branca do focinho é do cavalo e fica; bolsões de FUNDO entre cauda, corpo e pernas ficam transparentes.
    # Cor/tamanho não separam os dois (a estrela é grande de frente; o fundo claro do celeiro é "quente" como ela) — a POSIÇÃO separa: a estrela está sempre na cabeça (terço superior).
    ys0 = np.nonzero(m.any(1))[0]; top, hgt = ys0.min(), ys0.max() - ys0.min() + 1
    holes, nh = ndi.label(ndi.binary_fill_holes(m) & ~m)
    for h in range(1, nh + 1):
        hm = holes == h
        if hm.sum() <= HOLE_MAX and np.nonzero(hm)[0].mean() < top + HEAD_FRAC * hgt: m = m | hm
    m = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0) > 0.5               # contorno liso (a máscara por limiar tem degraus de 1 px que viram serrilhado ao ampliar)
    core = ndi.binary_erosion(m, structure=np.ones((3, 3)))                     # interior seguro (sem mistura com o fundo)
    img = bgr[y0:y1, x0:x1, ::-1].astype(np.float32)
    # cor da borda = média SUAVE do contorno escuro logo abaixo da borda (o "vizinho mais próximo" alternava entre contorno e corpo: pontilhado)
    band = (core & ~ndi.binary_erosion(core, structure=np.ones((3, 3)), iterations=2)).astype(np.float32)
    num = cv2.GaussianBlur(img * band[..., None], (0, 0), 2.0); den = cv2.GaussianBlur(band, (0, 0), 2.0)[..., None]
    ring = num / np.maximum(den, 1e-4)
    solid = np.where(core[..., None], img, ring)
    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7)
    a = np.clip((a - 0.2) / 0.6, 0, 1)                                          # borda curta e firme (pintura, não esfumaçada)
    rgba = np.dstack([solid, a * 255]).astype(np.uint8)
    # recorta ao conteúdo
    ys, xs = np.nonzero(a > 0.02)
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    mm = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return rgba, mm


sheet = np.zeros((CELL_H * ROWS, CELL_W * COLS, 4), np.uint8)
foot = {}; idle = {}; heights = []
for r, row in enumerate(grid):
    widths = []; spread = []
    for c, (i, sl, area) in enumerate(row):
        f, m = cut(i, sl)
        h, w = f.shape[:2]
        if w > CELL_W or h > CELL_H - PAD_B: raise SystemExit('quadro %d,%d (%dx%d) não cabe na célula' % (r, c, w, h))
        cxm = int(round(np.nonzero(m)[1].mean()))                             # centro de massa horizontal: estável entre quadros (a ponta da cauda/pernas varia)
        ox = CELL_W // 2 - cxm
        ox = min(max(ox, 0), CELL_W - w)
        oy = CELL_H - PAD_B - h
        sheet[r * CELL_H + oy: r * CELL_H + oy + h, c * CELL_W + ox: c * CELL_W + ox + w] = f
        widths.append(w)
        if r < 2: heights.append(h)
        low = m[int(m.shape[0] * 0.62):]                                      # as pernas (parte de baixo): quanto mais juntas, mais "parado" o quadro
        cols = np.nonzero(low.any(0))[0]; spread.append(int(cols.max() - cols.min()) if len(cols) else 0)
    idle[ROW_NAMES[r]] = int(np.argmin(spread))                              # quadro de repouso = pernas mais juntas
    foot[ROW_NAMES[r]] = int(np.median(widths))                              # largura típica do corpo: a sombra usa isto, não a da célula

os.makedirs(OUT, exist_ok=True)
png = os.path.join(OUT, 'walk_sheet.png')
cv2.imwrite(png, cv2.cvtColor(sheet, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# ícone da loja (aparece a 44 px): BUSTO quadrado (cabeça, pescoço e peito) — o cavalo inteiro ficaria minúsculo e ilegível nesse tamanho
ICON, BUST, FADE = 96, 130, 22
fr = sheet[0:CELL_H, 0:CELL_W]                                               # linha "right", quadro 0 (olha para a direita)
ys, xs = np.nonzero(fr[..., 3] > 8)
x1, y0 = xs.max() + 1, ys.min()
crop = fr[y0:y0 + BUST, max(0, x1 - BUST):x1]
pad = np.zeros((BUST, BUST, 4), np.uint8); pad[:crop.shape[0], BUST - crop.shape[1]:] = crop
ramp = np.clip(np.arange(BUST) / FADE, 0, 1)                                    # o corte do corpo (esquerda e embaixo) esmaece em vez de terminar em linha reta
pad[..., 3] = (pad[..., 3] * np.minimum(ramp[None, :], np.clip((BUST - 1 - np.arange(BUST)) / FADE, 0, 1)[:, None])).astype(np.uint8)
pm = pad.astype(np.float32); pm[..., :3] *= pm[..., 3:] / 255                 # redimensiona com alfa pré-multiplicado (sem halo escuro)
small = cv2.resize(pm, (ICON, ICON), interpolation=cv2.INTER_AREA)
al = small[..., 3:]; small[..., :3] = np.where(al > 0, small[..., :3] / np.maximum(al / 255, 1e-6), 0)
icon = np.clip(small, 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(OUT, 'icon.png'), cv2.cvtColor(icon, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

meta = {
    'image': 'walk_sheet.png', 'cell': [CELL_W, CELL_H], 'columns': COLS, 'rows': ROW_NAMES, 'frames': COLS,
    'anchor': 'pés no centro-base da célula (PAD_B px acima da borda inferior)', 'padBottom': PAD_B,
    'bodyHeight': int(np.median(heights)), 'footprintWidth': foot, 'idleFrame': idle, 'size': [CELL_W * COLS, CELL_H * ROWS],
    'note': 'ciclo de caminhada de 5 quadros por direção; "idle" = idleFrame (pernas mais juntas). Direções do jogo: 0 baixo(front) · 1 cima(back) · 2 esquerda · 3 direita',
}
with open(os.path.join(OUT, 'walk_sheet.json'), 'w', encoding='utf-8') as fh: json.dump(meta, fh, ensure_ascii=False, indent=2); fh.write('\n')
print('walk_sheet.png', sheet.shape[1], 'x', sheet.shape[0], os.path.getsize(png), 'bytes ·', 'icon.png', icon.shape[1], 'x', icon.shape[0], '· pegadas', foot, '· repouso', idle)
