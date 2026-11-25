"""Gera as sprite sheets da OVELHA e do COELHO a partir de docs/ovelhas_coelhos.jpeg (blocos 1 e 2: as poses de cada animal).
uso: python tools/make-livestock-sprites.py [--preview pasta]        (precisa de numpy, scipy, opencv-python)

Saída:
  assets/animais/ovelha/sheet.png  + sheet.json + icon.png
  assets/animais/coelho/sheet.png  + sheet.json + icon.png
  sheet.png = grade UNIFORME (colunas = quadros · linhas = ações/direções), células CELL_W x CELL_H, fundo transparente. Cada quadro é ancorado igual ao do
  cavalo: o centro de massa fica na coluna central da célula e os PÉS na base (PAD_B px acima da borda inferior) - o jogo desenha com a base da célula no chão.
  sheet.json = metadados (célula, linhas, quadros, laço, quadro de repouso, largura da "pegada" para a sombra...). O jogo copia essas constantes (animais.js) e
  tests/build.test.js confere que batem.

O PROBLEMA: a folha de arte tem UMA pose por vista (ovelha: frente, costas, perfil, pastando, tosquiada; coelho: frente, costas, perfil, pulando, comendo), não um ciclo
de caminhada como o cavalo. Os quadros de animação são, então, FABRICADOS a partir das poses (2x de resolução durante o trabalho, depois INTER_AREA):
  - ovelha: as pernas são "retângulos de perna" (lidos na pose) que balançam como um pêndulo (lateral: vai-e-vem + levanta o pé; frente/costas: só levanta), as
    diagonais em fase oposta (andar de quadrúpede); o corpo sobe e desce e balança (rotação leve); pastar = a cabeça faz "tchum tchum" (deslocamento só da região da cabeça).
  - coelho: o pulo usa a pose de PERFIL (agachar) e a pose "PULANDO" (no ar) com esmagar/esticar e altura embutida no quadro; de frente/costas só esmagar/esticar + altura;
    comer = mordiscar (cabeça); alerta = orelhas mexendo.
  - ovelha tosquiada: a pose da folha é a do bichinho PASTANDO tosquiado (cabeça baixa), usada para andar (as ovelhas andam de cabeça baixa); de frente/costas o
    tosquiado é a mesma pose de lã passada por um filtro de tosquia (cor de pele-creme, sem os tufos, corpo mais magro).
O cavalo da folha anda; estes não: nada aqui é "desenho novo", só movimento sobre a arte da folha. Tudo é determinístico: rodar de novo gera os mesmos bytes."""
import json, math, os, sys
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'ovelhas_coelhos.jpeg')
PREVIEW = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
SS = 2                      # super-amostragem durante o trabalho
PAD_B = 2                   # px entre os pés e a borda de baixo da célula
COLS = 6

bgr = cv2.imread(SRC)
if bgr is None: raise SystemExit('não achei ' + SRC)
rgb = bgr[:, :, ::-1].astype(np.int32); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]; V = rgb.max(-1)
BGLIKE = ((G - R) >= 8) & ((B - R) >= 8) & (V >= 165)          # fundo = azulado claro (o painel); lã e pelo são quentes/neutros

# ---------------------------------------------------------------- 1) extração das poses (caixas lidas na folha; não incluem o rótulo)
BOX = {
    'sheep_front': (40, 120, 150, 229), 'sheep_back': (180, 115, 285, 229), 'sheep_profile': (298, 118, 400, 229),
    'sheep_eating': (424, 118, 530, 229), 'sheep_shorn': (556, 118, 668, 229),
    'rabbit_front': (735, 118, 820, 229), 'rabbit_back': (860, 118, 930, 229), 'rabbit_profile': (985, 118, 1085, 229),
    'rabbit_hopping': (1128, 118, 1215, 229), 'rabbit_eating': (1250, 118, 1370, 229),
}

def extract(name):
    x0, y0, x1, y1 = BOX[name]
    m = ~BGLIKE[y0:y1, x0:x1]
    m = ndi.binary_opening(m, structure=np.ones((2, 2)))
    lab, n = ndi.label(m, structure=np.ones((3, 3)))                  # sem dilatar: pontinhos soltos (ruído do JPEG perto dos pés) não ficam ligados ao corpo
    sizes = ndi.sum(m, lab, range(1, n + 1)); keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.10 * sizes.max()]
    m = m & np.isin(lab, keep)
    hl, hn = ndi.label(ndi.binary_fill_holes(m) & ~m)               # só buracos PEQUENOS fecham (brilho da lã); o vão entre as orelhas é fundo de verdade
    hs = ndi.sum(np.ones_like(hl), hl, range(1, hn + 1)); m = m | np.isin(hl, [i + 1 for i, a in enumerate(hs) if a <= 40])
    img = bgr[y0:y1, x0:x1, ::-1].astype(np.float32)
    a = np.clip((cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) - 0.15) / 0.7, 0, 1)
    ring = m & ~ndi.binary_erosion(m, structure=np.ones((3, 3)))
    col = np.where(ring[..., None], cv2.erode(img, np.ones((3, 3), np.uint8)), img)      # cor da borda: o contorno escuro "espalha" (sem halo azul do painel)
    out = np.dstack([col, a * 255]); ys, xs = np.nonzero(a > 0.02)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

POSE = {k: extract(k) for k in BOX}

# ---------------------------------------------------------------- 2) ferramentas de deformação (tudo em imagem pré-multiplicada, float32, em escala SS)
def premul(f):
    p = f.astype(np.float32).copy(); p[..., :3] *= p[..., 3:] / 255.0; return p

def unpremul(p):
    a = p[..., 3:] / 255.0
    return np.clip(np.dstack([np.where(a > 0.004, p[..., :3] / np.maximum(a, 1e-6), 0), p[..., 3:]]), 0, 255)

def upscale(f):                       # pose (RGBA reta) -> pré-multiplicada em SS x
    p = premul(f); return cv2.resize(p, (p.shape[1] * SS, p.shape[0] * SS), interpolation=cv2.INTER_CUBIC)

def smooth_box(n, a, b, edge):        # 1 dentro de [a, b], rampa suave de `edge` px nas bordas (coordenadas da pose)
    x = (np.arange(n, dtype=np.float32) + .5) / SS
    return np.clip((x - a) / edge, 0, 1) * np.clip((b - x) / edge, 0, 1)

def remap_field(p, u, v):             # destino (x,y) lê a origem (x-u, y-v); u,v em px da pose (não de SS)
    h, w = p.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(p, gx - u * SS, gy - v * SS, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

def legs_field(shape, legs, th, Ax, lift):
    """legs = [(x0, y0, x1, y1, hip, fase)] em px da pose. Cada perna é um pêndulo: do quadril (hip) para baixo desloca em x (Ax*sin) e levanta o pé (lift*max(0,cos))."""
    h, w = shape[:2]; u = np.zeros((h, w), np.float32); v = np.zeros((h, w), np.float32)
    ys = (np.arange(h, dtype=np.float32) + .5) / SS
    for (x0, y0, x1, y1, hip, ph) in legs:
        wx = smooth_box(w, x0, x1, 2.0)[None, :]
        wy = np.clip((ys - hip) / max(1.0, (y1 - hip)), 0, 1)[:, None] * (ys < y1 + 1)[:, None]
        s, c = math.sin(th + ph), math.cos(th + ph)
        u += Ax * s * wy * wx; v -= lift * max(0.0, c) * wy * wx
    return u, v

def region_field(shape, rect, du, dv, edge=6.0):
    """desloca uma região retangular suave (cabeça, orelhas): (du, dv) px da pose no centro, caindo a 0 nas bordas."""
    h, w = shape[:2]; x0, y0, x1, y1 = rect
    wx = smooth_box(w, x0, x1, edge)[None, :]; wy = smooth_box(h, y0, y1, edge)[:, None]
    return du * wx * wy, dv * wx * wy

def lean_field(shape, y_pivot, y_top, du):
    """inclina o que está acima de y_pivot (orelhas ao vento): deslocamento x cresce linearmente para cima até du em y_top."""
    h, w = shape[:2]; ys = (np.arange(h, dtype=np.float32) + .5) / SS
    k = np.clip((y_pivot - ys) / max(1.0, y_pivot - y_top), 0, 1)[:, None] ** 1.6
    return du * k * np.ones((1, w), np.float32), np.zeros((h, w), np.float32)

def centroid_bottom(p):
    a = p[..., 3]; ys, xs = np.nonzero(a > 40)
    return (a[ys, xs] * xs).sum() / a[ys, xs].sum() / SS, ys.max() / SS          # x do centro de massa, y do ponto mais baixo (px da pose)

def place(p, cell, cx, bottom, sx=1.0, sy=1.0, rot=0.0, lift=0.0, dx=0.0):
    """põe a pose na célula: centro de massa em cell_w/2 (+dx), pés em (cell_h - PAD_B - lift); esmaga/estica (sx, sy) e gira (graus) em torno dos pés."""
    cw, ch = cell
    fx, fy = cw / 2 + dx, ch - PAD_B - lift
    # pose -> célula: translada o ponto de pés (cx, bottom) para (fx, fy), aplica escala e rotação em torno dele; tudo em SS x
    a = math.radians(rot); ca, sa = math.cos(a), math.sin(a)
    A = np.array([[sx * ca, -sy * sa], [sx * sa, sy * ca]], np.float32)            # esmaga/estica e gira em torno do ponto dos pés
    t = np.array([fx * SS, fy * SS], np.float32) - A @ np.array([cx * SS, bottom * SS], np.float32)
    W = np.hstack([A, t[:, None]])
    return cv2.warpAffine(p, W, (cw * SS, ch * SS), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

def finish(p):                        # SS x pré-multiplicada -> RGBA reta 1x
    s = cv2.resize(p, (p.shape[1] // SS, p.shape[0] // SS), interpolation=cv2.INTER_AREA)
    return np.clip(unpremul(s), 0, 255).astype(np.uint8)

def mirror(cell_img): return cell_img[:, ::-1].copy()

# ---------------------------------------------------------------- 3) tosquia: a pose de lã de frente/costas -> sem tufos, cor de pele-creme, corpo mais magro
def shear_filter(f):
    """f: RGBA reta (pose de lã). Devolve a mesma pose 'tosquiada': a LÃ (claro e pouco saturado) perde os tufos (suaviza), vira creme-claro; o corpo emagrece depois, em slim().
    Cabeça e pernas (cinza escuro) ficam como estão."""
    rgbf = f[..., :3].copy(); a = f[..., 3] / 255.0
    Vv = rgbf.max(-1); light = (Vv > 150) & (a > .5)
    soft = cv2.bilateralFilter(rgbf.astype(np.uint8), 7, 38, 5).astype(np.float32)           # tira os tufos (mantém as bordas do contorno)
    skin = np.array([240, 222, 202], np.float32)                                              # creme-rosado do tosquiado da folha
    lum = (soft.mean(-1, keepdims=True) / 228.0).clip(.78, 1.04)
    tint = np.clip(skin * lum, 0, 255)
    k = cv2.GaussianBlur(light.astype(np.float32), (0, 0), 1.0)[..., None]
    out = rgbf * (1 - k) + tint * k
    return np.dstack([out, f[..., 3]])

def slim(p, hip, k):
    """emagrece o corpo tosquiado: comprime em x (k = 0,10 -> 10%) tudo acima do quadril `hip` em direção ao centro de massa; as pernas (abaixo) não mudam."""
    cx, _ = centroid_bottom(p); h, w = p.shape[:2]
    xs = (np.arange(w, dtype=np.float32) + .5) / SS; ys = (np.arange(h, dtype=np.float32) + .5) / SS
    wy = np.clip((hip + 6 - ys) / 12.0, 0, 1)[:, None]
    return remap_field(p, (-k * (xs[None, :] - cx) * wy).astype(np.float32), np.zeros((h, w), np.float32))

# ---------------------------------------------------------------- 4) descrição dos quadros
# pernas por pose: (x0, y0, x1, y1, quadril, fase) - lidas na pose (px). Fase 0 / pi = diagonais em oposição (andar de quadrúpede).
PI = math.pi
SHEEP_LEGS = {
    'sheep_profile': [(22, 64, 37, 86, 64, 0), (39, 68, 54, 91, 68, PI), (58, 50, 73, 72, 52, PI), (74, 48, 89, 76, 50, 0)],
    'sheep_front': [(21, 68, 39, 95, 68, 0), (40, 72, 55, 100, 72, PI), (78, 52, 94, 84, 54, PI)],
    'sheep_back': [(2, 76, 17, 100, 76, 0), (20, 84, 40, 106, 84, PI), (43, 68, 59, 84, 68, PI), (57, 68, 72, 90, 70, 0)],
    'sheep_shorn': [(38, 76, 62, 100, 78, PI), (64, 52, 78, 70, 54, 0), (80, 50, 95, 78, 52, 0)],
}
SHEEP_HEAD = (0, 52, 48, 99)               # sheep_eating: região da cabeça/pescoço (x0, y0, x1, y1)
RABBIT_HEAD = (0, 40, 56, 81)              # rabbit_eating: cabeça e cenoura
RABBIT_EARS = (22, 0, 64, 40)              # rabbit_profile: orelhas

def build_sheep():
    cell = (116, 120); rows = []; meta = {'frames': {}, 'loop': {}, 'idle': {}, 'foot': {}}
    up = {k: upscale(v) for k, v in POSE.items() if k.startswith('sheep')}
    up['sheep_shorn_front'] = slim(upscale(shear_filter(POSE['sheep_front'])), 68, .10); up['sheep_shorn_back'] = slim(upscale(shear_filter(POSE['sheep_back'])), 70, .10)
    def walk(pose, legs, side, shear=False):
        base = up[pose]; cx, bt = centroid_bottom(base); out = []
        for k in range(COLS):
            th = 2 * PI * k / COLS
            u, v = legs_field(base.shape, legs, th, 5.0 if side else 1.4, 3.2 if side else 2.4)
            f = remap_field(base, u, v)
            bob = (1.6 if side else 1.4) * abs(math.sin(th)); rot = (1.1 if side else 2.2) * math.sin(th)
            out.append(finish(place(f, cell, cx, bt, rot=rot, lift=bob, sy=1 + .012 * math.cos(2 * th))))
        return out
    def eat(pose):
        base = up[pose]; cx, bt = centroid_bottom(base); out = []
        for k in range(4):
            th = 2 * PI * k / 4
            u, v = region_field(base.shape, SHEEP_HEAD, -1.2 * math.sin(th), 4.0 * (math.sin(th) * .5 + .5), 7.0)       # a cabeça desce até o capim e sobe
            out.append(finish(place(remap_field(base, u, v), cell, cx, bt, rot=0.4 * math.sin(th))))
        return out
    L = walk('sheep_profile', SHEEP_LEGS['sheep_profile'], True)
    rows += [('right', [mirror(f) for f in L]), ('left', L),
             ('down', walk('sheep_front', SHEEP_LEGS['sheep_front'], False)), ('up', walk('sheep_back', SHEEP_LEGS['sheep_back'], False))]
    E = eat('sheep_eating'); rows += [('eat_right', [mirror(f) for f in E]), ('eat_left', E)]
    S = walk('sheep_shorn', SHEEP_LEGS['sheep_shorn'], True); rows += [('shorn_right', [mirror(f) for f in S]), ('shorn_left', S)]
    # tosquiada de frente/costas: filtro de tosquia sobre as poses de lã (mesmas pernas)
    for nm, pose, legs in (('shorn_down', 'sheep_shorn_front', SHEEP_LEGS['sheep_front']), ('shorn_up', 'sheep_shorn_back', SHEEP_LEGS['sheep_back'])):
        rows.append((nm, walk(pose, legs, False)))
    return cell, rows, 'sheep_profile'

def build_rabbit():
    cell = (120, 124); rows = []
    up = {k: upscale(v) for k, v in POSE.items() if k.startswith('rabbit')}
    def hop_side():
        P, H = up['rabbit_profile'], up['rabbit_hopping']; cxP, btP = centroid_bottom(P); cxH, btH = centroid_bottom(H)
        return [finish(place(P, cell, cxP, btP)),
                finish(place(P, cell, cxP, btP, sx=1.06, sy=.90)),                      # agacha (antecipação)
                finish(place(H, cell, cxH, btH, sx=.97, sy=1.04, lift=7, dx=-2)),       # sai do chão
                finish(place(H, cell, cxH, btH, lift=17, dx=-3)),                       # ponto mais alto
                finish(place(H, cell, cxH, btH, sx=.98, sy=1.02, lift=8, dx=-2)),       # descendo
                finish(place(P, cell, cxP, btP, sx=1.07, sy=.88))]                      # aterrissa (esmaga)
    def hop_fb(pose):
        P = up[pose]; cx, bt = centroid_bottom(P)
        spec = [(1, 1, 0), (1.05, .91, 0), (.96, 1.07, 6), (.97, 1.04, 14), (.98, 1.02, 6), (1.06, .89, 0)]
        return [finish(place(P, cell, cx, bt, sx=a, sy=b, lift=c)) for a, b, c in spec]
    L = hop_side()
    rows += [('right', [mirror(f) for f in L]), ('left', L), ('down', hop_fb('rabbit_front')), ('up', hop_fb('rabbit_back'))]
    E = up['rabbit_eating']; cx, bt = centroid_bottom(E); Ef = []
    for k, (dv, dsy) in enumerate([(0, 1), (2.2, .985), (0, 1), (1.6, .99)]):
        u, v = region_field(E.shape, RABBIT_HEAD, -.6 * dv, dv, 6.0)
        Ef.append(finish(place(remap_field(E, u, v), cell, cx, bt, sy=dsy)))
    rows += [('eat_right', [mirror(f) for f in Ef]), ('eat_left', Ef)]
    P = up['rabbit_profile']; cx, bt = centroid_bottom(P); Af = []
    for k, (du, dv) in enumerate([(0, 0), (-2.4, 0), (0, 0), (2.6, 0)]):
        u, v = lean_field(P.shape, RABBIT_EARS[3] - 3, RABBIT_EARS[1], du)
        Af.append(finish(place(remap_field(P, u, v), cell, cx, bt, rot=.8 * du / 2.6)))
    rows += [('alert_right', [mirror(f) for f in Af]), ('alert_left', Af)]
    return cell, rows, 'rabbit_profile'

def body_w(img): ys, xs = np.nonzero(img[..., 3] > 128); return int(xs.max() - xs.min() + 1)

def write(animal, cell, rows, ref_pose, extra):
    out = os.path.join(ROOT, 'assets', 'animais', animal); os.makedirs(out, exist_ok=True)
    cw, ch = cell; sheet = np.zeros((ch * len(rows), cw * COLS, 4), np.uint8)
    names, frames, foot, idle = [], {}, {}, {}
    for r, (name, fr) in enumerate(rows):
        names.append(name); frames[name] = len(fr); foot[name] = body_w(fr[0]); idle[name] = 0
        for c, f in enumerate(fr): sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = f
    cv2.imwrite(os.path.join(out, 'sheet.png'), cv2.cvtColor(sheet, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    ref = POSE[ref_pose].shape[0]
    meta = {'source': 'docs/ovelhas_coelhos.jpeg', 'image': 'sheet.png', 'cell': [cw, ch], 'columns': COLS, 'rows': names, 'frames': frames, 'idle': idle,
            'anchor': 'centro de massa na coluna central da célula; pés na base (padBottom px acima da borda inferior)', 'padBottom': PAD_B,
            'bodyHeight': int(ref), 'footprintWidth': foot, 'facing': 'as linhas *_left olham para a esquerda; as *_right são o espelho'}
    meta.update(extra)
    with open(os.path.join(out, 'sheet.json'), 'w', encoding='utf-8') as fh: json.dump(meta, fh, ensure_ascii=False, indent=1); fh.write('\n')
    return sheet, names

def icon(animal, pose):
    f = POSE[pose]; h, w = f.shape[:2]; s = 88.0 / max(h, w)
    p = premul(f); sm = cv2.resize(p, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    c = np.zeros((96, 96, 4), np.float32); oy, ox = (96 - sm.shape[0]) // 2, (96 - sm.shape[1]) // 2
    c[oy:oy + sm.shape[0], ox:ox + sm.shape[1]] = sm
    cv2.imwrite(os.path.join(ROOT, 'assets', 'animais', animal, 'icon.png'), cv2.cvtColor(np.clip(unpremul(c), 0, 255).astype(np.uint8), cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])

SHEEP_EXTRA = {'loop': {n: list(range(COLS)) for n in ['right', 'left', 'down', 'up', 'shorn_right', 'shorn_left', 'shorn_down', 'shorn_up']} | {'eat_right': [0, 1, 2, 3], 'eat_left': [0, 1, 2, 3]},
               'fps': {'walk': 6, 'eat': 4}, 'notes': 'idle = quadro 0 (pose original, sem deformação). tosquiada: linhas shorn_*. pastar: eat_* (a cabeça abaixa e sobe).'}
RABBIT_EXTRA = {'loop': {'right': [1, 2, 3, 4, 5], 'left': [1, 2, 3, 4, 5], 'down': [1, 2, 3, 4, 5], 'up': [1, 2, 3, 4, 5], 'eat_right': [0, 1, 2, 3], 'eat_left': [0, 1, 2, 3], 'alert_right': [0, 1, 2, 3], 'alert_left': [0, 1, 2, 3]},
                'hopFrames': {'crouch': 1, 'launch': 2, 'apex': 3, 'fall': 4, 'land': 5}, 'hopLift': {'launch': 7, 'apex': 17, 'fall': 8},
                'fps': {'hop': 10, 'eat': 6, 'alert': 3}, 'notes': 'idle = quadro 0 (sentado, pose original). O pulo é um ciclo de 5 quadros (agachar, sair, topo, descer, aterrissar); a altura do pulo está EMBUTIDA no quadro (a sombra fica no chão).'}

def preview(animal, sheet, cell, names):
    if not PREVIEW: return
    os.makedirs(PREVIEW, exist_ok=True)
    bg = np.zeros(sheet.shape[:2] + (3,), np.float32); bg[:] = (70, 150, 70); a = sheet[..., 3:] / 255.0
    comp = bg * (1 - a) + sheet[..., :3] * a
    for r in range(len(names)):                                          # divisórias
        comp[r * cell[1], :, :] = (255, 255, 0)
    big = cv2.resize(comp.astype(np.uint8), None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(os.path.join(PREVIEW, animal + '_sheet_prev.png'), big[:, :, ::-1])

for animal, builder, ref_icon, extra in (('ovelha', build_sheep, 'sheep_front', SHEEP_EXTRA), ('coelho', build_rabbit, 'rabbit_front', RABBIT_EXTRA)):
    cell, rows, ref = builder()
    sheet, names = write(animal, cell, rows, ref, extra)
    icon(animal, ref_icon); preview(animal, sheet, cell, names)
    print(animal, 'sheet', sheet.shape[1], 'x', sheet.shape[0], '·', len(names), 'linhas ·', os.path.getsize(os.path.join(ROOT, 'assets', 'animais', animal, 'sheet.png')) // 1024, 'KB')
