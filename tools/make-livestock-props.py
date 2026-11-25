"""Gera os sprites dos ACESSÓRIOS, PRODUTOS e CENÁRIO de ovelhas e coelhos (Fase 1 do plano) a partir de docs/ovelhas_coelhos.jpeg e docs/oficina.jpeg.
uso: python tools/make-livestock-props.py [--preview pasta]        (precisa de numpy, scipy, opencv-python)

Saída em assets/animais/props/ (RGBA, fundo transparente) + assets/animais/props/rebanho.json (tamanho final, grupo, fonte, nota de cada item):
  <nome>.png                 um por item (tabela ITEMS abaixo)
  oficina_anim.png           6 quadros da roda de fiar da OFICINA girando (grade 6 x 1, células do tamanho de oficina.png); o 6º quadro + 7,5 graus = o 1º (laço perfeito: a roda tem 8 raios = 45 graus)

Método (o mesmo de make-livestock-sprites.py / make-fishing-sprites.py; as fontes são folhas com painéis azul-acinzentados, rótulos e itens de contorno escuro):
  1. cada item tem uma CAIXA (coordenadas da fonte, lidas na folha; NÃO incluem o rótulo)
  2. FUNDO = pixels "azulados claros" (G-R >= 8, B-R >= 8, V >= 165): inclusive os vãos (cabo da tesoura, argolas, cercas de arame)
  3. só o corpo principal (o rótulo que encosta na caixa e pontinhos do JPEG saem); buracos PEQUENOS fecham (brilho da lã/queijo)
  4. alfa curto, cor da borda = mínimo 3x3 dentro do item (sem halo azul)
  5. redução com alfa pré-multiplicado (INTER_AREA); NUNCA amplia além de UP_MAX vezes (a fonte tem ~100 px por item: ampliar só borra)
Os rótulos da folha têm erros (trocaram nomes); o nome do arquivo segue o que a IMAGEM mostra, não o rótulo (coluna `nota`)."""
import json, math, os, sys
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'animais', 'props')
PREVIEW = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
UP_MAX = 1.25
S1, S2 = 'ovelhas_coelhos.jpeg', 'oficina.jpeg'
SRC = {k: cv2.imread(os.path.join(ROOT, 'docs', k)) for k in (S1, S2)}
for k, v in SRC.items():
    if v is None: raise SystemExit('não achei docs/' + k)

def bglike(bgr, vmin=165):
    rgb = bgr[:, :, ::-1].astype(np.int32); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return ((G - R) >= 8) & ((B - R) >= 8) & (rgb.max(-1) >= vmin)
BG = {k: bglike(v) for k, v in SRC.items()}

# nome: (fonte, (x0, y0, x1, y1), lado maior pedido, grupo, nota)
ITEMS = {
    # ---- bloco 1: ovelha
    'tesoura_tosa': (S1, (42, 282, 158, 384), 80, 'ovelha', 'tesoura de tosa + novelo (rótulo: "Ball of Wooltearer")'),
    'fardos_feno': (S1, (178, 280, 288, 386), 96, 'ovelha', 'pilha de fardos de FENO/palha (rótulo: "Stack of Wool"; a imagem não é lã)'),
    'cocho_ovelha': (S1, (306, 322, 412, 396), 112, 'ovelha', 'cocho de metal'),
    'estacao_tosquia': (S1, (418, 320, 560, 402), 128, 'ovelha', 'plataforma de tosquia (piso de tábuas com esteira)'),
    'portao_aprisco': (S1, (576, 296, 668, 408), 112, 'ovelha', 'portão de madeira'),
    # ---- bloco 2: coelho
    'coelheira': (S1, (718, 276, 826, 388), 112, 'coelho', 'casinha de madeira'),
    'bebedouro_coelho': (S1, (852, 276, 944, 384), 88, 'coelho', 'garrafa d\'água com bico + cenouras'),
    'tigela_racao': (S1, (962, 336, 1018, 382), 56, 'coelho', 'tigela de metal com ração (rótulo: "Carrot Bundle")'),
    'toca_coelho': (S1, (1048, 328, 1144, 372), 80, 'coelho', 'buraco na terra (rótulo: "Rabbit Food Bowl")'),
    'canteiro_alface': (S1, (1158, 316, 1264, 374), 88, 'coelho', 'alface em canteiro de terra'),
    'pegadas_coelho': (S1, (1290, 332, 1346, 372), 40, 'cenario', 'pegadas (contraste baixo na folha)'),
    # ---- bloco 3: produtos
    'la_bruta': (S1, (66, 506, 170, 584), 64, 'produto', 'lã bruta (nuvem de lã)'),
    'fio_la': (S1, (228, 504, 302, 590), 64, 'produto', 'carretel de fio (rótulo: "Wool Yarn")'),
    'pele_coelho': (S1, (534, 504, 628, 590), 64, 'produto', 'PELE CRUA do coelho (pelo claro); o rótulo é "Rabbit Pelt"'),
    'carne_coelho': (S1, (303, 630, 410, 704), 64, 'produto', 'pernil de coelho'),
    'queijo': (S2, (950, 555, 1100, 690), 64, 'produto', 'queijo com fatia (da folha oficina.jpeg: mais detalhado que o do bloco 3)'),
    'pele_curtida': (S2, (1130, 560, 1335, 700), 64, 'produto', 'pele curtida/couro (da folha oficina.jpeg)'),
    # ---- bloco 4: cenário
    'pasto_tufo': (S1, (728, 498, 870, 588), 96, 'cenario', 'retalho de capim (losango isométrico; NÃO é um tile contínuo: use como retalho com feather)'),
    'trilha_terra': (S1, (893, 508, 1034, 580), 104, 'cenario', 'retalho de terra batida (mancha irregular; NÃO é um tile contínuo)'),
    'cerca_arame': (S1, (1061, 496, 1176, 588), 96, 'cenario', 'estaca + estaca com arame, em diagonal (1ª "Farm Fence")'),
    'cerca_estacas': (S1, (736, 630, 856, 702), 96, 'cenario', 'duas estacas com arame de frente (2ª "Farm Fence")'),
    'feno_redondo': (S1, (1233, 498, 1340, 588), 80, 'cenario', 'fardo redondo de feno (1º "Hay Bale"; o 2º é variação e foi descartado)'),
    'canteiro_horta': (S1, (1038, 616, 1194, 706), 112, 'cenario', 'canteiro de terra para hortaliças'),
    'regador_pequeno': (S1, (1238, 621, 1328, 700), 64, 'cenario', 'regador de metal'),
    # ---- oficina (folha oficina.jpeg)
    'oficina': (S2, (480, 135, 920, 445), 176, 'oficina', 'bancada com roca de fiar, novelo, queijo e pele no cavalete; pegada 3 x 2 tiles'),
}
# descartados de propósito (documentados para ninguém "reencontrar" como esquecidos):
#   2ª "Rabbit Pelt" do bloco 3 (66..170, 628..696): é uma carcaça/pedaço cru, não pele — e já temos a carne
#   2º "Hay Bale" e o 2º "Farm Fence" duplicado do bloco 4 que não está acima; "Wool Yarn" da oficina.jpeg (novelo): o carretel do bloco 3 lê melhor como "fio"
MINFRAC = {'pegadas_coelho': 0.0, 'cerca_arame': 0.02, 'cerca_estacas': 0.02}   # peças soltas legítimas (pegadas são 2 marcas; a cerca tem 2 estacas e o arame é fino)
HOLE_MAX = 60
# 'diff' = fundo é "tudo que é igual à cor do painel" (fios finos e marcas fracas somem no teste "azulado claro", porque o anti-serrilhado os mistura com o painel)
# 'difffill' = 'diff' e fecha QUALQUER buraco (metal prateado e vidro azulado, quase da cor do painel, com contorno escuro contínuo)
MODE = {'cerca_arame': ('diff', 26), 'cerca_estacas': ('diff', 26), 'pegadas_coelho': ('diff', 14), 'tigela_racao': ('difffill', 22), 'bebedouro_coelho': ('difffill', 16)}


def extract(src, box, name):
    x0, y0, x1, y1 = box; bgr = SRC[src]
    mode, thr = MODE.get(name, ('bg', 0))
    m = _diff(bgr[y0:y1, x0:x1], thr) if mode.startswith('diff') else ~BG[src][y0:y1, x0:x1]
    m = ndi.binary_opening(m, structure=np.ones((2, 2))) if not mode.startswith('diff') else m
    lab, n = ndi.label(m, structure=np.ones((3, 3))); sizes = ndi.sum(m, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= max(6, MINFRAC.get(name, 0.10) * sizes.max())]
    m = m & np.isin(lab, keep)
    hl, hn = ndi.label(ndi.binary_fill_holes(m) & ~m); hs = ndi.sum(np.ones_like(hl), hl, range(1, hn + 1))
    m = m | np.isin(hl, [i + 1 for i, a in enumerate(hs) if a <= (10 ** 6 if mode == 'difffill' else HOLE_MAX)])
    img = bgr[y0:y1, x0:x1, ::-1].astype(np.float32)
    a = np.clip((cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) - 0.15) / 0.7, 0, 1)
    ring = m & ~ndi.binary_erosion(m, structure=np.ones((3, 3)))
    col = np.where(ring[..., None], cv2.erode(img, np.ones((3, 3), np.uint8)), img)
    out = np.dstack([col, a * 255]); ys, xs = np.nonzero(a > 0.02)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def _diff(bgr, thr):
    """fundo = cor do painel (mediana da moldura da caixa, que só tem painel); item = qualquer pixel a mais de `thr` dessa cor em algum canal."""
    h, w = bgr.shape[:2]; edge = np.concatenate([bgr[0], bgr[-1], bgr[:, 0], bgr[:, -1]]).astype(np.float32); col = np.median(edge, 0)
    return (np.abs(bgr.astype(np.float32) - col).max(-1) > thr)


def fit(f, side):
    h, w = f.shape[:2]; s = min(side / max(h, w), UP_MAX)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    pm = f.copy(); pm[..., :3] *= pm[..., 3:] / 255
    sm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4); al = sm[..., 3:4] / 255
    return np.clip(np.dstack([np.where(al > 0.004, sm[..., :3] / np.maximum(al, 1e-6), 0), np.clip(sm[..., 3:], 0, 255)]), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- oficina: roda de fiar girando
# A roda da bancada é uma elipse (vista oblíqua) com 8 raios. Em coordenadas da FONTE oficina.jpeg: centro do cubo, semi-eixos do aro interno e inclinação.
WHEEL = dict(cx=709.5, cy=190.5, a=29.0, b=36.0, tilt=-9.0)                # a = semi-eixo horizontal, b = vertical (antes de inclinar), tilt em graus
POST = [(700, 188), (722, 186), (726, 232), (702, 238), (698, 215)]         # poste do suporte, na frente do cubo (fica parado)
FRAMES, STEP = 6, 7.5


def wheel_frames(side):
    """Devolve (lista de quadros RGBA, tamanho) - a bancada inteira com os raios girados, na mesma escala de `fit(extract(...), side)`."""
    src = 'oficina.jpeg'; box = ITEMS['oficina'][1]; x0, y0, x1, y1 = box
    base = extract(S2, box, 'oficina')                                              # recorte (px da fonte) -> offset do recorte dentro da caixa:
    full = SRC[S2][:, :, ::-1].astype(np.float32); H, W = full.shape[:2]
    m = ~BG[S2]; m_box = np.zeros_like(m); m_box[y0:y1, x0:x1] = m[y0:y1, x0:x1]
    # recorte idêntico ao extract(): reconstrói com a mesma máscara para saber o deslocamento
    sub = m_box[y0:y1, x0:x1]; sub = ndi.binary_opening(sub, structure=np.ones((2, 2)))
    lab, n = ndi.label(sub, structure=np.ones((3, 3))); sz = ndi.sum(sub, lab, range(1, n + 1)); sub = sub & np.isin(lab, [i + 1 for i, s in enumerate(sz) if s >= .10 * sz.max()])
    ys, xs = np.nonzero(sub); ox, oy = x0 + xs.min() - 0, y0 + ys.min()              # canto do recorte na fonte (aproximado: o alfa suave pode comer 1 px)
    # trabalha na imagem inteira da fonte (RGBA): alfa = máscara do extract() colocada de volta
    rgba = np.zeros((H, W, 4), np.float32); rgba[..., :3] = full
    ah, aw = base.shape[:2]
    # alinha o recorte com a fonte por correlação do alfa (±3 px), para não depender de aproximação
    best, bo = -1, (ox, oy)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            sl = (m_box[oy + dy:oy + dy + ah, ox + dx:ox + dx + aw])
            if sl.shape != (ah, aw): continue
            sc = (sl & (base[..., 3] > 128)).sum()
            if sc > best: best, bo = sc, (ox + dx, oy + dy)
    ox, oy = bo
    rgba[oy:oy + ah, ox:ox + aw, 3] = base[..., 3]; rgba[oy:oy + ah, ox:ox + aw, :3] = base[..., :3]
    # camada limpa: tira o poste (inpaint) e preenche os furos transparentes da roda para o giro não arrastar "buracos"
    wm = np.zeros((H, W), np.uint8); cv2.fillPoly(wm, [np.array(POST, np.int32)], 255); wm = cv2.dilate(wm, np.ones((3, 3), np.uint8))
    el = np.zeros((H, W), np.uint8); cv2.ellipse(el, ((WHEEL['cx'], WHEEL['cy']), (2 * WHEEL['a'] * 2, 2 * WHEEL['b'] * 2), WHEEL['tilt']), 255, -1)   # elipse do aro (aprox.)
    occ = (cv2.bitwise_or(wm, ((rgba[..., 3] < 128) & (el > 0)).astype(np.uint8) * 255) > 0)             # o que NÃO é roda de verdade: poste na frente e furos transparentes
    # transformação elipse -> círculo unitário (centro, inclinação, semi-eixos)
    t = math.radians(WHEEL['tilt']); c, s_ = math.cos(t), math.sin(t)
    Rm = np.array([[c, -s_], [s_, c]], np.float32); D = np.diag([WHEEL['a'], WHEEL['b']]).astype(np.float32)
    A = Rm @ D                                                                        # círculo unitário -> elipse (px)
    Ainv = np.linalg.inv(A)
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    P = np.stack([gx - WHEEL['cx'], gy - WHEEL['cy']], -1) @ Ainv.T                  # coordenadas unitárias de cada pixel
    rad = np.hypot(P[..., 0], P[..., 1])
    # camada LIMPA por simetria: a roda tem 8 raios (45 graus), então o que o poste cobre num raio existe, descoberto, 45 graus adiante
    def rot_sample(img, deg, interp=cv2.INTER_LINEAR):
        th = math.radians(deg); cr, sr = math.cos(th), math.sin(th)
        Q = P @ np.array([[cr, sr], [-sr, cr]], np.float32).T; sxy = Q @ A.T + np.array([WHEEL['cx'], WHEEL['cy']], np.float32)
        return cv2.remap(img, sxy[..., 0].astype(np.float32), sxy[..., 1].astype(np.float32), interp, borderMode=cv2.BORDER_REPLICATE)
    clean = rgba[..., :3].copy(); todo = occ.copy()
    occ_f = occ.astype(np.float32)
    for j in (1, 2, 3, 4, 5, 6, 7):
        src_occ = rot_sample(occ_f, 45.0 * j, cv2.INTER_NEAREST) > 0.5
        ok = todo & ~src_occ
        if ok.any(): clean[ok] = rot_sample(rgba[..., :3], 45.0 * j)[ok]; todo &= ~ok
    if todo.any(): clean = cv2.inpaint(np.clip(clean, 0, 255).astype(np.uint8), (todo * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA).astype(np.float32)
    inner = ((rad < 1.0) & (rad > 0.16)).astype(np.float32)                           # fora do aro (raio 1) e fora do cubo (0,16): só os raios
    inner = cv2.GaussianBlur(inner, (0, 0), 0.8)
    post = cv2.GaussianBlur(cv2.fillPoly(np.zeros((H, W), np.uint8), [np.array(POST, np.int32)], 255).astype(np.float32) / 255, (0, 0), 0.7)
    frames = []
    for k in range(FRAMES):
        rot = rot_sample(clean, STEP * k)                                              # camada limpa girada no plano da roda
        w = (inner * (1 - post))[..., None]
        col = rgba[..., :3] * (1 - w) + rot * w
        out = np.dstack([col, rgba[..., 3]])                                           # o alfa não muda (silhueta parada)
        frames.append(out[oy:oy + ah, ox:ox + aw])
    return frames


def write_png(path, f): cv2.imwrite(path, cv2.cvtColor(f, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])


def main():
    os.makedirs(OUT, exist_ok=True); meta = {}; made = {}
    for name, (src, box, side, group, note) in ITEMS.items():
        f = fit(extract(src, box, name), side); made[name] = f
        write_png(os.path.join(OUT, name + '.png'), f)
        meta[name] = {'size': [int(f.shape[1]), int(f.shape[0])], 'group': group, 'source': 'docs/' + src, 'note': note}
    # oficina animada: mesma escala/offset do oficina.png
    fr = wheel_frames(ITEMS['oficina'][3 - 1 + 0] if False else ITEMS['oficina'][2])
    ow, oh = made['oficina'].shape[1], made['oficina'].shape[0]
    cells = [fit(np.clip(q, 0, 255), ITEMS['oficina'][2]) for q in fr]
    cells = [cv2.resize(c, (ow, oh), interpolation=cv2.INTER_AREA) if c.shape[:2] != (oh, ow) else c for c in cells]
    sheet = np.hstack(cells); write_png(os.path.join(OUT, 'oficina_anim.png'), sheet)
    meta['oficina_anim'] = {'size': [int(sheet.shape[1]), int(sheet.shape[0])], 'group': 'oficina', 'source': 'docs/' + S2, 'cell': [ow, oh], 'frames': FRAMES, 'loop': list(range(FRAMES)),
                            'note': 'roda de fiar girando; grade 6 x 1; 6 quadros x 7,5 graus = 45 graus = um raio (laço perfeito)'}
    with open(os.path.join(OUT, 'rebanho.json'), 'w', encoding='utf-8') as fh:
        json.dump({'facing': 'frente/3-4 (como as demais props)', 'upMax': UP_MAX, 'items': meta}, fh, ensure_ascii=False, indent=1); fh.write('\n')
    total = sum(os.path.getsize(os.path.join(OUT, n + '.png')) for n in list(ITEMS) + ['oficina_anim'])
    print(len(ITEMS), 'sprites + oficina_anim em assets/animais/props ·', total // 1024, 'KB')
    if PREVIEW: preview(made, sheet)


def preview(made, anim):
    os.makedirs(PREVIEW, exist_ok=True)
    for tag, bg in (('verde', (70, 150, 70)), ('terra', (120, 85, 55))):
        W = 1400; x = y = 8; rowh = 0; items = list(made.items()) + [('oficina_anim', anim)]; rows = []
        cur = []; cw = 0
        for n, f in items:
            if cw + f.shape[1] + 10 > W: rows.append(cur); cur = []; cw = 0
            cur.append(f); cw += f.shape[1] + 10
        rows.append(cur)
        H = sum(max(f.shape[0] for f in r) + 10 for r in rows) + 10
        canvas = np.zeros((H, W, 3), np.float32); canvas[:] = bg; y = 8
        for r in rows:
            x = 8
            for f in r:
                a = f[..., 3:] / 255.0; h, w = f.shape[:2]
                canvas[y:y + h, x:x + w] = canvas[y:y + h, x:x + w] * (1 - a) + f[..., :3] * a; x += w + 10
            y += max(f.shape[0] for f in r) + 10
        cv2.imwrite(os.path.join(PREVIEW, 'props_' + tag + '.png'), canvas[:, :, ::-1].astype(np.uint8))


if __name__ == '__main__': main()
