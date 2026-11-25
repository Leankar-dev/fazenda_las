"""Gera os sprites de PESCA (peixes, equipamentos, doca, estaca e margem do lago) a partir de docs/equipamentos_pescca.jpeg.
uso: python tools/make-fishing-sprites.py        (precisa de numpy, scipy, opencv-python)

Saída em assets/pesca/<nome>.png (RGBA, fundo transparente) e assets/pesca/pesca.json (tamanhos finais e metadados).
Todos os PEIXES saem virados para a ESQUERDA (como na fonte); o jogo espelha quando o peixe nada para a direita.

Método (a fonte é uma folha com painéis azul-acinzentados, grade, rótulos de texto e itens de contorno escuro):
  1. cada item tem uma CAIXA (coordenadas da fonte, lidas na folha; não incluem o rótulo)
  2. FUNDO = pixels "azulados claros" (G-R >= 8, B-R >= 8, V >= 185): inclusive os vãos de redes, alças e anzóis (não só o que alcança a borda)
  3. peças pequenas soltas (restos de rótulo) saem; a máscara é suavizada e o alfa é curto
  4. cor da borda: mínimo 3x3 dentro do item (o contorno escuro "espalha" nas bordas: sem halo azul do painel)
  5. redução com alfa pré-multiplicado para o tamanho de uso (lado maior = MAXSIDE)"""
import json, os
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'equipamentos_pescca.jpeg')
OUT = os.path.join(ROOT, 'assets', 'pesca')

# nome: (x0, y0, x1, y1, lado maior final, grupo)
ITEMS = {
    # bloco 1: varas e carretéis
    'vara_spinning': (40, 112, 242, 266, 168, 'equip'), 'vara_fly': (209, 120, 433, 277, 168, 'equip'),
    'carretel_fechado': (57, 303, 140, 399, 88, 'equip'), 'carretel_baitcast': (188, 310, 307, 397, 96, 'equip'),
    # bloco 2: iscas
    'caixa_pesca': (489, 119, 664, 284, 112, 'equip'), 'boia': (694, 136, 733, 199, 64, 'equip'), 'colher': (779, 126, 807, 201, 72, 'equip'),
    'minnow': (845, 144, 923, 191, 80, 'equip'), 'minhoca': (686, 246, 809, 273, 96, 'equip'), 'popper': (829, 242, 935, 299, 88, 'equip'),
    'isca_viva': (498, 331, 640, 403, 96, 'equip'), 'isca_cera': (662, 339, 731, 396, 72, 'equip'), 'linha': (757, 331, 830, 399, 72, 'equip'),
    'chumbo': (857, 341, 923, 397, 64, 'equip'),
    # bloco 3: acessórios
    'puca': (961, 126, 1091, 260, 112, 'equip'), 'multiferramenta': (1150, 123, 1226, 235, 80, 'equip'), 'cordao': (1270, 123, 1361, 234, 80, 'equip'),
    'balanca': (992, 279, 1075, 403, 96, 'equip'), 'oculos': (1123, 276, 1224, 323, 80, 'equip'), 'chapeu': (1114, 336, 1229, 390, 88, 'equip'),
    'colete': (1255, 279, 1362, 404, 96, 'equip'),
    # bloco 4: peixes (viram para a esquerda na fonte) e rede de captura
    'achiga': (53, 505, 237, 589, 112, 'peixe'), 'perca': (296, 501, 430, 589, 84, 'peixe'), 'bagre': (51, 628, 239, 699, 112, 'peixe'),
    'crappie': (288, 618, 437, 705, 92, 'peixe'), 'rede_captura': (495, 497, 654, 699, 112, 'equip'),
    # bloco 5: doca, estaca e margem
    'doca': (715, 540, 921, 683, 176, 'cenario'), 'estaca': (946, 540, 995, 668, 96, 'cenario'), 'margem': (1221, 548, 1355, 673, 128, 'cenario'),
}
# fração mínima (da maior peça) para uma peça solta ficar: letras de rótulo que encostam na caixa são pequenas, as peças do item (cartões, alça, linha) não
MINFRAC = {'vara_spinning': 0.3, 'vara_fly': 0.3, 'popper': 0.15, 'puca': 0.2, 'minnow': 0.15, 'chumbo': 0.1, 'isca_cera': 0.1}
NO_TRIM = {'margem'}                    # o tile da margem é um QUADRADO com moldura: não recorta o fundo

bgr = cv2.imread(SRC)
if bgr is None: raise SystemExit('não achei ' + SRC)
rgb = bgr[:, :, ::-1].astype(np.int32); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
bglike = ((G - R) >= 8) & ((B - R) >= 8) & (rgb.max(-1) >= 185)


def extract(name, box):
    x0, y0, x1, y1 = box
    m = ~bglike[y0:y1, x0:x1]
    if name in NO_TRIM: m = np.ones_like(m)
    else:
        m = ndi.binary_opening(m, structure=np.ones((2, 2))) | (ndi.binary_dilation(m, iterations=1) & m)
        lab, n = ndi.label(ndi.binary_dilation(m, structure=np.ones((3, 3)), iterations=2))
        sizes = ndi.sum(m, lab, range(1, n + 1)); keep = [i + 1 for i, s in enumerate(sizes) if s >= max(60, MINFRAC.get(name, 0.03) * sizes.max())]
        m = m & np.isin(lab, keep)                                                  # restos de rótulo/serrilhado somem; peças soltas relevantes (cartões, alças) ficam
        m = ndi.binary_fill_holes(ndi.binary_closing(m, structure=np.ones((3, 3)))) | m if name in ('doca', 'estaca', 'margem', 'colete', 'chapeu') else m
    img = bgr[y0:y1, x0:x1, ::-1].astype(np.float32)
    a = np.clip((cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) - 0.15) / 0.7, 0, 1)
    # cor da borda: mínimo 3x3 (o contorno escuro cobre a mistura com o painel)
    ring = m & ~ndi.binary_erosion(m, structure=np.ones((3, 3)))
    er = cv2.erode(img, np.ones((3, 3), np.uint8)); col = np.where(ring[..., None], er, img)
    out = np.dstack([col, a * 255])
    ys, xs = np.nonzero(a > 0.02); out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return out


def fit(f, side):
    h, w = f.shape[:2]; s = side / max(h, w)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    pm = f.copy(); pm[..., :3] *= pm[..., 3:] / 255
    sm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4); al = sm[..., 3:4] / 255
    return np.clip(np.dstack([np.where(al > 0.004, sm[..., :3] / np.maximum(al, 1e-6), 0), np.clip(sm[..., 3:], 0, 255)]), 0, 255).astype(np.uint8)


os.makedirs(OUT, exist_ok=True)
meta = {}
for name, (x0, y0, x1, y1, side, group) in ITEMS.items():
    f = fit(extract(name, (x0, y0, x1, y1)), side)
    p = os.path.join(OUT, name + '.png'); cv2.imwrite(p, cv2.cvtColor(f, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    meta[name] = {'size': [int(f.shape[1]), int(f.shape[0])], 'group': group}
with open(os.path.join(OUT, 'pesca.json'), 'w', encoding='utf-8') as fh:
    json.dump({'source': 'docs/equipamentos_pescca.jpeg', 'facing': 'left', 'items': meta}, fh, ensure_ascii=False, indent=1); fh.write('\n')
total = sum(os.path.getsize(os.path.join(OUT, n + '.png')) for n in ITEMS)
print(len(ITEMS), 'sprites em assets/pesca ·', total // 1024, 'KB')
