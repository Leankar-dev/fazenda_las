"""Gera os sprites de UM personagem (fazendeiro ou fazendeira) a partir da folha de caminhada em docs/ (ciclo: 4 direções x 5 quadros).
uso: python tools/make-walker-sprites.py fazendeiro|fazendeira      (precisa de numpy, scipy, opencv-python)

Saída em assets/<personagem>/:
  walk_sheet.png   grade UNIFORME de 5 colunas x 4 linhas (direita · esquerda · frente · costas), células CELL_W x CELL_H, fundo transparente,
                   pés no centro-base da célula, altura normalizada entre as direções
  walk_sheet.json  metadados (célula, linhas, `loop` = quadros do ciclo, quadro de repouso, altura de referência, largura da pegada) — o jogo usa as mesmas constantes
                   em game.js (WALKERS) e tests/build.test.js confere
  front.png        retrato de frente (2x, para o título, a escolha de personagem e o retrato do HUD)

Método (a fonte é um JPEG com cenário de fazenda borrado e grade):
  1. acha as 20 figuras (pixels escuros dilatados, uma faixa por linha)
  2. FUNDO = o que alcança a borda da janela sem atravessar o CONTORNO escuro (V < 150) — o personagem tem contorno contínuo, inclusive em pés e mãos
  3. pele sem contorno (rosto de perfil, antebraço, mão): pixels de COR DE PELE (quentes, saturados, G/R baixo) ligados ao corpo voltam
  4. bolsões de fundo fechados (entre as pernas, ao lado da cintura) = claros e pouco saturados (pele é bem mais saturada): saem
  5. contorno liso, alfa curto, cor da borda tirada do contorno escuro (sem halo do cenário)
  6. altura normalizada por direção (a fonte varia conforme a direção; sem isso o personagem "encolheria" ao virar)
  7. ancoragem: pés na base, centro de massa do TRONCO no centro (estável durante o passo)
  8. `loop`: o 5º quadro de uma linha costuma repetir o 1º (fecha o ciclo): fica de fora do laço para não "travar" a cada volta; quadros com defeito da fonte
     (ex.: fazendeiro de costas SEM CHAPÉU) ficam em EXCLUDE """
import json, os, sys

# ---- configuração por personagem ----
CONFIG = {
    'fazendeiro': dict(src='fazendeiro_andando.jpeg', out='fazendeiro', bands=[(70, 258), (258, 425), (425, 588), (588, 752)],
                       cell=(112, 172), target_h=162, exclude={'up': [3]}),
    'fazendeira': dict(src='fazendeira_andando.jpeg', out='fazendeira', bands=[(80, 268), (275, 449), (452, 589), (592, 742)],
                       cell=(112, 172), target_h=162, exclude={}, back_hat=True),
}
if len(sys.argv) != 2 or sys.argv[1] not in CONFIG: raise SystemExit('uso: python tools/make-walker-sprites.py ' + '|'.join(CONFIG))
CH = sys.argv[1]; CFG = CONFIG[CH]
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', CFG['src'])
OUT = os.path.join(ROOT, 'assets', CFG['out'])
COLS, ROW_NAMES = 5, ['right', 'left', 'down', 'up']
(CELL_W, CELL_H), PAD_B = CFG['cell'], 2
TARGET_H = CFG['target_h']                       # altura (chapéu aos pés) de TODAS as direções
EXCLUDE = CFG['exclude']                         # quadros com defeito na fonte
DUP_RATIO = 0.55                                 # último quadro com diferença p/ o 1º < 55 % da menor diferença entre vizinhos = repetição que fecha o ciclo
BANDS = CFG['bands']
SAT, MIN_POCKET, BT, M = 0.24, 6, 150, 26
HAT_CROWN = 5                                    # px (fonte): quanto a copa do chapéu passa do topo do cabelo, no chapéu composto de costas
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
# limite vertical de cada linha = ponto médio do vão REAL entre os pés de uma linha e a cabeça da seguinte (faixas fixas cortavam 1 px ou deixavam entrar o vizinho)
row_top = [min(f[2] for f in r) for r in figs]; row_bot = [max(f[3] for f in r) for r in figs]
LIMITS = [((row_bot[r - 1] + row_top[r]) // 2 if r > 0 else 0, (row_bot[r] + row_top[r + 1]) // 2 if r < 3 else rgb.shape[0]) for r in range(4)]
if [len(r) for r in figs] != [COLS] * 4: raise SystemExit('esperava 4 linhas x 5 figuras, achei ' + str([len(r) for r in figs]))


def cut(x0, x1, y0, y1, band):
    """máscara da figura (e a janela usada). Ver passos 2-4 no cabeçalho. A janela NÃO passa da faixa da linha: entre duas linhas há só ~6 px e os pés da figura de cima
    entravam na máscara da de baixo (achado na fazendeira: 3 de 5 quadros de costas 'cresciam' 25 px)."""
    X0, X1, Y0, Y1 = x0 - M, x1 + M, max(y0 - M, band[0]), min(y1 + M, band[1])
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
    y0, y1, x0, x1 = max(0, ys.min() - pad), min(m.shape[0], ys.max() + 1 + pad), max(0, xs.min() - pad), min(m.shape[1], xs.max() + 1 + pad)      # a janela agora pode terminar antes do `pad`
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
raw = [[rgba_of(*(lambda mk: (mk[0], mk[1][0], mk[1][1]))(cut(*figs[r][c], LIMITS[r]))) for c in range(COLS)] for r in range(4)]


def straw_hat(f):
    """o CHAPÉU de um quadro de frente: tudo acima da linha onde começa a PELE do rosto (copa + aba, com contorno). RGBA recortado."""
    h, w = f.shape[:2]; R_, G_, B_ = f[..., 0], f[..., 1], f[..., 2]; a = f[..., 3] > 100
    skin = a & ((R_ - B_) > 40) & (G_ < 0.72 * R_) & (R_ > 110)                              # pele: mais vermelha que a palha (G/R ~0,63 contra ~0,82)
    ys, xs = np.nonzero(a); cx = int(xs.mean()); half = max(6, (xs.max() - xs.min()) // 5)
    rows = [y for y in range(int(h * .03), int(h * .30)) if skin[y, cx - half:cx + half + 1].sum() >= 5]
    if not rows: raise SystemExit('não achei a linha do rosto no quadro de frente')
    y_face = rows[0]
    out = f[:y_face].copy(); cols = np.nonzero((out[..., 3] > 100).any(0))[0]
    return out[:, cols[0]:cols[-1] + 1]


def put_hat(f, hat, k):
    """põe o chapéu (reduzido/ampliado por k) no alto da cabeça de um quadro DE COSTAS sem chapéu; o quadro cresce para cima se preciso"""
    hh, hw = hat.shape[:2]; nh, nw = max(1, round(hh * k)), max(1, round(hw * k))
    pm = hat.copy(); pm[..., :3] *= pm[..., 3:] / 255
    sm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LANCZOS4); al = sm[..., 3:4] / 255
    hs = np.dstack([np.where(al > 0.004, sm[..., :3] / np.maximum(al, 1e-6), 0), sm[..., 3:]])
    H, W = f.shape[:2]; a = f[..., 3] > 100; ys, xs = np.nonzero(a)
    top = ys.min(); cx = int(round(xs[ys < top + 12].mean()))                                # centro da cabeça (topo do cabelo)
    drop = int(round(HAT_CROWN * k)); y_hat = top - drop                                     # a copa passa um pouco do topo do cabelo
    pad_top = max(0, -y_hat); pad_x = max(0, nw // 2 - cx, cx + nw // 2 + 1 - W)
    g = np.zeros((H + pad_top, W + 2 * pad_x, 4), np.float32); g[pad_top:, pad_x:pad_x + W] = f
    y0 = y_hat + pad_top; x0 = cx + pad_x - nw // 2
    dst = g[y0:y0 + nh, x0:x0 + nw]; ha = hs[..., 3:4] / 255; da = dst[..., 3:] / 255
    oa = ha + da * (1 - ha)                                                                    # composição "over": o chapéu por cima do cabelo
    dst[..., :3] = (hs[..., :3] * ha + dst[..., :3] * da * (1 - ha)) / np.maximum(oa, 1e-6); dst[..., 3:] = oa * 255
    return g


if CFG.get('back_hat'):
    ref_hat = straw_hat(raw[2][0][0])                                                         # chapéu do quadro de frente 0 (o mais nítido)
    k = row_hs = float(np.median([f[0].shape[0] for f in raw[3]])) / float(np.median([f[0].shape[0] for f in raw[2]]))
    for c in range(COLS):
        raw[3][c] = (put_hat(raw[3][c][0], ref_hat, k), None)
    print('chapéu composto nas 5 poses de costas (a fonte as desenhou sem chapéu); escala', round(k, 3))
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
    'note': 'ciclo de caminhada; `loop` = quadros do ciclo' + (' (excluídos por defeito da fonte: ' + str(EXCLUDE) + ')' if EXCLUDE else '') + ('; as poses de costas ganharam o chapéu por composição (a fonte as desenhou sem)' if CFG.get('back_hat') else '') + '. Direções do jogo: 0 baixo(front) · 1 cima(back) · 2 esquerda · 3 direita',
    'character': CH,
}
with open(os.path.join(OUT, 'walk_sheet.json'), 'w', encoding='utf-8') as fh: json.dump(meta, fh, ensure_ascii=False, indent=2); fh.write('\n')
print('walk_sheet.png', sheet.shape[1], 'x', sheet.shape[0], os.path.getsize(png), 'bytes · front.png', fr2.shape[1], 'x', fr2.shape[0], '· pegadas', foot)
