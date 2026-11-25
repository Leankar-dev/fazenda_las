"""Gera os sprites do FAZENDEIRO (Elias) a partir de docs/fazendeiro_andando.jpeg (ciclo de caminhada: 4 direções x 5 quadros).
uso: python tools/make-fazendeiro-sprites.py        (precisa de numpy, scipy, opencv-python)

Saída em assets/fazendeiro/:
  walk_sheet.png   grade UNIFORME de 5 colunas x 4 linhas (direita · esquerda · frente · costas), células CELL_W x CELL_H, fundo transparente,
                   pés no centro-base da célula, altura normalizada entre as direções
  walk_sheet.json  metadados (célula, linhas, `loop` = quadros do ciclo, quadro de repouso, altura de referência, largura da pegada) — o jogo usa as mesmas constantes
                   em game.js (WALKER) e tests/build.test.js confere
  front.png        retrato de frente (2x, para o título, a escolha de personagem e o retrato do HUD)

Método (a fonte é um JPEG com cenário de fazenda borrado e grade):
  1. acha as 20 figuras (pixels escuros dilatados, uma faixa por linha)
  2. FUNDO = o que alcança a borda da janela sem atravessar o CONTORNO escuro (V < 150) — o personagem tem contorno contínuo, inclusive em pés e mãos
  3. rosto de perfil não tem contorno (pele clara encosta no fundo): na cabeça, pixels de COR DE PELE ligados ao corpo voltam
  4. bolsões de fundo fechados (entre as pernas, ao lado da cintura) = claros e pouco saturados (pele é bem mais saturada): saem
  5. contorno liso, alfa curto, cor da borda tirada do contorno escuro (sem halo do cenário)
  6. altura normalizada por direção (a fonte tem 155-168 px conforme a direção; sem isso ele "encolheria" ao virar)
  7. ancoragem: pés na base, centro de massa do TRONCO no centro (estável durante o passo)
  8. `loop`: o 5º quadro de uma linha é quase igual ao 1º (fecha o ciclo): fica de fora do laço para não "travar" a cada volta; o quadro 4 de COSTAS tem o
     fazendeiro SEM CHAPÉU (defeito da fonte): excluído """
import json, os
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'fazendeiro_andando.jpeg')
OUT = os.path.join(ROOT, 'assets', 'fazendeiro')
COLS, ROW_NAMES = 5, ['right', 'left', 'down', 'up']
CELL_W, CELL_H, PAD_B = 112, 172, 2
TARGET_H = 162                                   # altura (chapéu aos pés) de TODAS as direções
EXCLUDE = {'up': [3]}                            # quadros com defeito na fonte (fazendeiro sem chapéu)
DUP_RATIO = 0.55                                 # último quadro com diferença p/ o 1º < 55 % da menor diferença entre vizinhos = repetição que fecha o ciclo
BANDS = [(70, 258), (258, 425), (425, 588), (588, 752)]
SAT, MIN_POCKET, BT, M = 0.24, 6, 150, 26
FRONT_SCALE = 2

bgr = cv2.imread(SRC)
if bgr is None: raise SystemExit('não achei ' + SRC)
rgb = bgr[:, :, ::-1].astype(np.int32); V = rgb.max(-1)

# 1) figuras
dark = (V < 100); dark[:, :270] = False; dark[:, 1340:] = False
figs = []
for (a, b) in BANDS:
    mm = np.zeros_like(dark); mm[a:b] = dark[a:b]
    lab, _ = ndi.label(ndi.binary_dilation(mm, structure=np.ones((3, 3)), iterations=10))
    row = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if (lab[sl] == i).sum() < 2000: continue
        row.append((sl[1].start + 10, sl[1].stop - 10, max(a, sl[0].start + 10), min(b, sl[0].stop - 10)))
    figs.append(sorted(row))
if [len(r) for r in figs] != [COLS] * 4: raise SystemExit('esperava 4 linhas x 5 figuras, achei ' + str([len(r) for r in figs]))


def cut(x0, x1, y0, y1):
    """máscara da figura (e a janela usada). Ver passos 2-4 no cabeçalho."""
    X0, X1, Y0, Y1 = x0 - M, x1 + M, y0 - M, y1 + M
    sub = rgb[Y0:Y1, X0:X1]; barrier = sub.max(-1) < BT
    lab, _ = ndi.label(~barrier)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)); fg = ~bg
    ell = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, ell).astype(bool)
    l1, n1 = ndi.label(fg); fg = l1 == (int(np.argmax(ndi.sum(fg, l1, range(1, n1 + 1)))) + 1)       # só a figura (a janela pega pedaços das vizinhas)
    # 3) pele sem contorno (rosto de perfil, antebraço e mão: a pele iluminada encosta direto no fundo claro): pixels de COR DE PELE ligados ao corpo voltam.
    #    A pele é "vermelha" (G/R ~0,74); o chão bege é "amarelado" (G/R ~0,95) e o celeiro desbotado é pouco saturado
    mx = sub.max(-1).astype(np.float32); mn = sub.min(-1).astype(np.float32); sat = (mx - mn) / np.maximum(mx, 1)
    Rr, Gg, Bb = sub[..., 0].astype(np.float32), sub[..., 1].astype(np.float32), sub[..., 2].astype(np.float32)
    skin = ((Rr - Bb) >= 35) & (Gg <= 0.86 * Rr) & (sat >= .22) & (mx >= 110) & (mx <= 240)
    cs = ndi.binary_opening(skin, structure=np.ones((3, 3)))                     # lascas finas não passam
    ls, _ = ndi.label(cs | fg); touch = np.unique(ls[fg]); touch = touch[touch > 0]
    fg = fg | (cs & np.isin(ls, touch))
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, ell).astype(bool)
    fg = ndi.binary_fill_holes(fg)
    # 4) bolsões de fundo
    like = fg & ~barrier & (mx >= 175) & (sat < SAT)
    ys1 = np.nonzero(fg.any(1))[0]; neck = ys1.min() + 0.28 * (ys1.max() - ys1.min())
    ll, nl = ndi.label(like)
    for i in range(1, nl + 1):
        comp = ll == i
        if comp.sum() < MIN_POCKET or np.nonzero(comp)[0].mean() < neck: like[comp] = False
    fg = fg & ~ndi.binary_dilation(like, iterations=1)
    l2, n2 = ndi.label(fg); m = l2 == (int(np.argmax(ndi.sum(fg, l2, range(1, n2 + 1)))) + 1)
    holes, nh = ndi.label(ndi.binary_fill_holes(m) & ~m)
    for h in range(1, nh + 1):
        if (holes == h).sum() < 40: m = m | (holes == h)
    return m, (X0, Y0)


def rgba_of(m, X0, Y0):
    """RGBA recortado: contorno liso, alfa curto, cor da borda tirada do contorno (passo 5)"""
    ys, xs = np.nonzero(m); pad = 4
    y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + 1 + pad, max(0, xs.min() - pad), xs.max() + 1 + pad
    mm = cv2.GaussianBlur(m[y0:y1, x0:x1].astype(np.float32), (0, 0), 0.9) > 0.5
    img = bgr[Y0 + y0:Y0 + y1, X0 + x0:X0 + x1, ::-1].astype(np.float32)
    core = ndi.binary_erosion(mm, structure=np.ones((3, 3)))
    band = (core & ~ndi.binary_erosion(core, structure=np.ones((3, 3)), iterations=2)).astype(np.float32)
    num = cv2.GaussianBlur(img * band[..., None], (0, 0), 1.5); den = cv2.GaussianBlur(band, (0, 0), 1.5)[..., None]
    solid = np.where(core[..., None], img, num / np.maximum(den, 1e-4))
    a = np.clip((cv2.GaussianBlur(mm.astype(np.float32), (0, 0), 0.6) - 0.2) / 0.6, 0, 1)
    out = np.dstack([solid, a * 255]).astype(np.float32)
    ys, xs = np.nonzero(a > 0.02)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1], mm[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def resize_rgba(f, scale):
    """redimensiona com alfa pré-multiplicado (sem halo)"""
    h, w = f.shape[:2]; nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    pm = f.copy(); pm[..., :3] *= pm[..., 3:] / 255
    sm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
    al = sm[..., 3:4] / 255
    return np.clip(np.dstack([np.where(al > 0.004, sm[..., :3] / np.maximum(al, 1e-6), 0), np.clip(sm[..., 3:], 0, 255)]), 0, 255), None


# recorta tudo e mede a altura de cada direção
raw = [[rgba_of(*(lambda mk: (mk[0], mk[1][0], mk[1][1]))(cut(*figs[r][c]))) for c in range(COLS)] for r in range(4)]
row_h = [float(np.median([f[0].shape[0] for f in raw[r]])) for r in range(4)]
print('alturas por direção na fonte:', dict(zip(ROW_NAMES, row_h)), '-> alvo', TARGET_H)

sheet = np.zeros((CELL_H * 4, CELL_W * COLS, 4), np.uint8)
masks = {}; foot = {}; spread = {}; heights = []
for r, name in enumerate(ROW_NAMES):
    k = TARGET_H / row_h[r]; masks[name] = []; widths = []; spread[name] = []
    for c in range(COLS):
        f, mm = raw[r][c]
        f2, _ = resize_rgba(f, k) if abs(k - 1) > 0.002 else (f, None)
        h, w = f2.shape[:2]
        if w > CELL_W or h > CELL_H - PAD_B: raise SystemExit('quadro %s %d (%dx%d) não cabe na célula' % (name, c, w, h))
        alpha = f2[..., 3] > 100
        torso = alpha[:int(h * 0.6)]; cxm = int(round(np.nonzero(torso)[1].mean()))      # centro de massa do TRONCO: estável durante o passo
        ox = min(max(CELL_W // 2 - cxm, 0), CELL_W - w); oy = CELL_H - PAD_B - h
        sheet[r * CELL_H + oy:r * CELL_H + oy + h, c * CELL_W + ox:c * CELL_W + ox + w] = f2.astype(np.uint8)
        masks[name].append(np.pad(alpha, ((CELL_H - PAD_B - h, PAD_B), (ox, CELL_W - ox - w))))
        widths.append(w); heights.append(h)
        low = alpha[int(h * 0.62):]; cols = np.nonzero(low.any(0))[0]; spread[name].append(int(cols.max() - cols.min()) if len(cols) else 0)
    foot[name] = int(np.median(widths))

# `loop` e quadro de repouso
def diff(a, b): return float((a ^ b).sum()) / max(1.0, float((a | b).sum()))
loop, idle = {}, {}
for name in ROW_NAMES:
    frames = [i for i in range(COLS) if i not in EXCLUDE.get(name, [])]
    mk = masks[name]; last = frames[-1]
    neigh = [diff(mk[frames[i]], mk[frames[i + 1]]) for i in range(len(frames) - 1)]
    closes = diff(mk[frames[0]], mk[last])
    if len(frames) > 2 and closes < DUP_RATIO * min(neigh[0], neigh[-1]): frames = frames[:-1]          # repete o 1º: fecha o ciclo, não entra no laço
    loop[name] = frames
    idle[name] = min(frames, key=lambda i: spread[name][i])
    print(name, 'laço', frames, 'repouso', idle[name], '| dif 1º-último %.3f vs vizinhos %s' % (closes, ['%.2f' % d for d in neigh]))

os.makedirs(OUT, exist_ok=True)
png = os.path.join(OUT, 'walk_sheet.png')
cv2.imwrite(png, cv2.cvtColor(sheet, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# retrato de frente (2x) a partir do recorte ORIGINAL (não da sheet: mais nítido), quadro de repouso da linha "down"
fr, _ = raw[2][idle['down']]
fr2, _ = resize_rgba(fr, FRONT_SCALE * TARGET_H / row_h[2])
blur = cv2.GaussianBlur(fr2[..., :3], (0, 0), 1.2); fr2[..., :3] = np.clip(fr2[..., :3] * 1.35 - blur * 0.35, 0, 255)       # realce leve (a ampliação amacia)
cv2.imwrite(os.path.join(OUT, 'front.png'), cv2.cvtColor(fr2.astype(np.uint8), cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

meta = {
    'image': 'walk_sheet.png', 'cell': [CELL_W, CELL_H], 'columns': COLS, 'rows': ROW_NAMES, 'size': [CELL_W * COLS, CELL_H * 4],
    'bodyHeight': TARGET_H, 'padBottom': PAD_B, 'loop': loop, 'idleFrame': idle, 'footprintWidth': foot,
    'front': 'front.png', 'frontSize': list(map(int, fr2.shape[1::-1])),
    'note': 'ciclo de caminhada; a linha "up" não usa o quadro 3 (fazendeiro sem chapéu na fonte). Direções do jogo: 0 baixo(front) · 1 cima(back) · 2 esquerda · 3 direita',
}
with open(os.path.join(OUT, 'walk_sheet.json'), 'w', encoding='utf-8') as fh: json.dump(meta, fh, ensure_ascii=False, indent=2); fh.write('\n')
print('walk_sheet.png', sheet.shape[1], 'x', sheet.shape[0], os.path.getsize(png), 'bytes · front.png', fr2.shape[1], 'x', fr2.shape[0], '· pegadas', foot)
