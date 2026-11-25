'use strict';
/* ============================================================
   animais.js  -  recintos (pens), animais e companheiros da fazenda
   Sprites: assets/animais/<animal>/*.png (recortados de docs/animais.jpeg). O CAVALO, a OVELHA e o COELHO são sprite sheets animadas (sheet.png + sheet.json, geradas por
   tools/make-horse-sprites.py e tools/make-livestock-sprites.py); acessórios e cenário em assets/animais/props/.
   Cachorro: companheiro que segue o jogador e cava tesouros. Vaca: ordenha diária. Porco: acha trufas. Cavalo: montaria. Ovelha e coelho: Fase 5 do plano (docs/melhorias/ovelhas_coelhos).

   COMO ESTÁ ORGANIZADO (Fase 4 do plano: refatorado para dados):
     • PENS ........ os recintos (curral, pasto das ovelhas, coelheira): área, portões, cerca, decoração, retalhos de chão. Acrescentar um recinto = acrescentar uma entrada.
     • KINDS ....... as espécies: tamanho, velocidade, recinto onde vivem, sprite/sheet, balão de "pronto" e o que o E faz. Nada de `if (kind === 'vaca')` espalhado.
     • SHEETS ...... as sprite sheets (cavalo, ovelha, coelho): constantes iguais às dos sheet.json (tests/build.test.js confere).
   O jogo (game.js) pergunta por `inAnyPen`, `keepClear`, `IN`... e não conhece o layout. O mapa ANTIGO (curral de 15 × 12) continua descrito em LEGACY, só para o gerador do mundo sortear
   exatamente como antes (o mundo antigo não pode mudar: cenário `mapa-golden`).
   ============================================================ */
const Animals = (() => {
  const TS = 64, TAU = Math.PI * 2;
  const BASE = 'assets/animais/';

  /* ---------------- recintos ----------------
     area = anel da CERCA (x0..x1 × y0..y1, em tiles) · o interior é a área menos 1 de cada lado · gates = aberturas VERTICAIS na cerca { x, y0, y1 }
     fence = estilo da cerca ('madeira' | 'arame' | 'estacas') · decor = props (tw = largura em tiles; solid:false = só enfeite) · patches = [tile, cx, cy, rx, ry] (tiles do chão, com borda esfumada)
     puddles = [prop, cx, cy, escala] desenhados no chão · allows = espécies que vivem aqui (o spawn usa KINDS[k].pen) */
  const PENS = {
    curral: {
      id: 'curral', name: 'Curral', fence: 'madeira', allows: ['vaca', 'porco', 'cavalo'],
      area: { x0: 30, y0: 16, x1: 44, y1: 31 },
      gates: [{ x: 30, y0: 21, y1: 22 }, { x: 44, y0: 21, y1: 22 }],           // oeste (para a fazenda) e leste (para o corredor do pasto)
      decor: [
        { k: 'watering_trough', tx: 34, ty: 17, tw: 2, s: 1.45 }, { k: 'hay_bale', tx: 41, ty: 17, tw: 1, s: 1.2 }, { k: 'hay_bale', tx: 42, ty: 17, tw: 1, s: 1.2 },
        { k: 'salt_lick', tx: 37, ty: 17, tw: 1, s: 1.15 },
        { k: 'hay_bale', tx: 32, ty: 30, tw: 1, s: 1.2 }, { k: 'watering_trough', tx: 34, ty: 30, tw: 2, s: 1.45 }, { k: 'salt_lick', tx: 37, ty: 30, tw: 1, s: 1.15 },
        { k: 'feed_trough', tx: 39, ty: 30, tw: 2, s: 1.35 }, { k: 'pig_feeder', tx: 42, ty: 30, tw: 1, s: 1.25 },
      ],
      patches: [['straw', 34.4, 23.7, 3.4, 2.5], ['rooting_ground', 40.2, 23.4, 3.7, 2.7], ['straw', 35.5, 27.8, 3.4, 2.2], ['rooting_ground', 40.4, 27.6, 3.4, 2.2]],
      puddles: [['mud_puddle', 39.2, 23.2, 1.5], ['mud_puddle2', 41.4, 24.4, 1.3], ['mud_puddle', 38.2, 21.7, 1.1], ['mud_puddle2', 38.6, 28.2, 1.2]],
    },
    pasto: {
      id: 'pasto', name: 'Pasto das ovelhas', fence: 'arame', allows: ['ovelha'],
      area: { x0: 47, y0: 16, x1: 62, y1: 30 },
      gates: [{ x: 47, y0: 21, y1: 22 }],
      decor: [                                                                  // as estruturas compradas (cocho, estação, fardos, oficina...) entram na Fase 6; aqui só enfeite
        { k: 'pasto_tufo', tx: 50, ty: 19, tw: 1, s: 1, solid: false }, { k: 'pasto_tufo', tx: 56, ty: 18, tw: 1, s: 1, solid: false }, { k: 'pasto_tufo', tx: 59, ty: 24, tw: 1, s: 1, solid: false },
        { k: 'pasto_tufo', tx: 52, ty: 26, tw: 1, s: 1, solid: false }, { k: 'pasto_tufo', tx: 58, ty: 28, tw: 1, s: 1, solid: false }, { k: 'pasto_tufo', tx: 50, ty: 23, tw: 1, s: 1, solid: false },
        { k: 'feno_redondo', tx: 60, ty: 17, tw: 1, s: 1.15 }, { k: 'feno_redondo', tx: 49, ty: 28, tw: 1, s: 1.15 },
      ],
      patches: [['grassA', 54.5, 22.5, 6.5, 4.5], ['grassB', 54.5, 26.5, 5.5, 2.5]],
      puddles: [],
    },
    coelheira: {
      id: 'coelheira', name: 'Coelheira', fence: 'estacas', allows: ['coelho'],
      area: { x0: 47, y0: 33, x1: 58, y1: 42 },
      gates: [{ x: 47, y0: 37, y1: 38 }],
      decor: [
        { k: 'pegadas_coelho', tx: 51, ty: 36, tw: 1, s: 1, solid: false }, { k: 'pegadas_coelho', tx: 55, ty: 39, tw: 1, s: 1, solid: false }, { k: 'pegadas_coelho', tx: 52, ty: 40, tw: 1, s: 1, solid: false },
        { k: 'pasto_tufo', tx: 49, ty: 35, tw: 1, s: .9, solid: false }, { k: 'pasto_tufo', tx: 56, ty: 35, tw: 1, s: .9, solid: false }, { k: 'pasto_tufo', tx: 54, ty: 41, tw: 1, s: .9, solid: false },
      ],
      patches: [['dirt', 52.5, 37.5, 4.5, 3.2], ['grassB', 56.5, 41, 2.5, 1.6]],
      puddles: [],
    },
  };
  for (const p of Object.values(PENS)) p.in = { x0: p.area.x0 + 1, y0: p.area.y0 + 1, x1: p.area.x1 - 1, y1: p.area.y1 - 1 };
  const PEN_LIST = Object.values(PENS);
  // faixas que ficam LIVRES de árvore e mato (o corredor oeste→leste que liga os portões dos recintos)
  const CLEAR = [{ x: 45, y: 15, w: 2, h: 29 }];
  // trilha de terra do corredor (retalhos desenhados no chão)
  const TRAIL = ['trilha_terra', 46.0, 17.2, 1.15, 46.0, 20.0, 1.1, 46.0, 22.8, 1.15, 46.0, 25.6, 1.1, 46.0, 28.4, 1.15, 46.0, 31.2, 1.1, 46.0, 34.0, 1.15, 46.0, 36.8, 1.1, 46.0, 38.4, 1.15, 46.2, 37.6, 1.0];

  /* O curral ANTIGO (15 × 12 tiles): só para o gerador do mundo. NÃO mude: o mundo antigo sai igual por causa disto (tests/fixtures/mapa_golden_46x34.json). */
  const LEGACY = {
    area: { x0: 30, y0: 16, x1: 44, y1: 27 }, gate: { x: 30, y0: 21, y1: 22 },
    decor: [[34, 17, 2], [41, 17, 1], [42, 17, 1], [37, 17, 1], [39, 26, 2], [42, 26, 1], [32, 26, 1]],      // [tx, ty, tw]
  };
  const legacyIn = (x, y, m = 0) => x >= LEGACY.area.x0 - m && x <= LEGACY.area.x1 + m && y >= LEGACY.area.y0 - m && y <= LEGACY.area.y1 + m;
  const legacyFence = (x, y) => legacyIn(x, y) && !(x > LEGACY.area.x0 && x < LEGACY.area.x1 && y > LEGACY.area.y0 && y < LEGACY.area.y1) && !(x === LEGACY.gate.x && y >= LEGACY.gate.y0 && y <= LEGACY.gate.y1);

  /* ---------------- geometria dos recintos ---------------- */
  const inArea = (p, x, y, m = 0) => x >= p.area.x0 - m && x <= p.area.x1 + m && y >= p.area.y0 - m && y <= p.area.y1 + m;
  const inIn = (p, x, y) => x >= p.in.x0 && x <= p.in.x1 && y >= p.in.y0 && y <= p.in.y1;
  const isGate = (p, x, y) => p.gates.some(g => x === g.x && y >= g.y0 && y <= g.y1);
  const isFenceOf = (p, x, y) => inArea(p, x, y) && !inIn(p, x, y) && !isGate(p, x, y);
  const penOf = (x, y) => PEN_LIST.find(p => inArea(p, x, y)) || null;                          // o recinto que contém a célula (cerca ou interior)
  const inAnyPen = (x, y, m = 0) => PEN_LIST.some(p => inArea(p, x, y, m));
  const inAnyIn = (x, y) => PEN_LIST.some(p => inIn(p, x, y));
  const isFence = (x, y) => PEN_LIST.some(p => isFenceOf(p, x, y));
  const keepClear = (x, y) => inAnyPen(x, y, 1) || CLEAR.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);      // sem árvore, pedra nem mato
  const penTile = (x, y) => { const p = penOf(x, y); return p && p.id; };

  const RIGHT = 'right', LEFT = 'left';
  /* ---------------- sprite sheets ---------------- */
  /* Grade uniforme: colunas = quadros · linhas = ações/direções. Os pés ficam no centro-base de cada célula. As constantes são IGUAIS às dos sheet.json (tests/build.test.js confere).
     rows: nome → linha · foot: largura do corpo por linha (a sombra usa isto) · idle: quadro de repouso · loop: quadros do ciclo por linha (`eat` etc. são extras) · fps: quadros/s */
  const HORSE = {
    cell: [184, 160], cols: 5, ref: 148,                                       // ref = altura do cavalo de lado (sem folga): K.h é a altura dele na tela
    rows: { right: 0, left: 1, down: 2, up: 3 },
    foot: { right: 168, left: 169, down: 51, up: 50 },                         // largura do corpo por direção (a sombra usa isto, não a da célula)
    idle: { right: 2, left: 3, down: 1, up: 4 },                               // quadro de repouso (pernas juntas)
    loop: { right: [0, 1, 2, 3], left: [0, 1, 2, 3], down: [0, 1, 2, 3, 4], up: [0, 1, 2, 3, 4] },     // quadros do ciclo (de lado o 5º repete o 1º: fica de fora, senão o passo travaria a cada volta)
    fps: 5, fpsRide: 9,                                                        // quadros/s andando sozinho e montado (o montado é quase 2x mais rápido)
  };
  const SHEEP = {
    cell: [116, 120], cols: 6, ref: 91,
    rows: { right: 0, left: 1, down: 2, up: 3, eat_right: 4, eat_left: 5, shorn_right: 6, shorn_left: 7, shorn_down: 8, shorn_up: 9 },
    foot: { right: 89, left: 89, down: 98, up: 84, eat_right: 97, eat_left: 97, shorn_right: 98, shorn_left: 98, shorn_down: 90, shorn_up: 77 },
    frames: { right: 6, left: 6, down: 6, up: 6, eat_right: 4, eat_left: 4, shorn_right: 6, shorn_left: 6, shorn_down: 6, shorn_up: 6 },
    idle: 0, loop: { walk: [0, 1, 2, 3, 4, 5], eat: [0, 1, 2, 3] }, fps: { walk: 6, eat: 4 },
  };
  const RABBIT = {
    cell: [120, 124], cols: 6, ref: 95,
    rows: { right: 0, left: 1, down: 2, up: 3, eat_right: 4, eat_left: 5, alert_right: 6, alert_left: 7 },
    foot: { right: 79, left: 79, down: 66, up: 53, eat_right: 100, eat_left: 100, alert_right: 79, alert_left: 79 },
    frames: { right: 6, left: 6, down: 6, up: 6, eat_right: 4, eat_left: 4, alert_right: 4, alert_left: 4 },
    idle: 0, hop: [1, 2, 3, 4, 5], air: [2, 3, 4], fps: { hop: 10, eat: 6, alert: 3 },
  };
  const SHEETS = { cavalo: HORSE, ovelha: SHEEP, coelho: RABBIT };

  /* ---------------- espécies ----------------
     pen = recinto onde vive (null = anda por toda a fazenda) · owned = campo de S.owned · h/speed/step/bob = tamanho (px), velocidade (px/s) e balanço · touch = meia-largura da área de toque (px)
     views = sprites estáticos (right/left = os que olham para cada lado) · sheet = sprite sheet (SHEETS) · shop = o que a loja mostra (só as espécies já à venda)
     interact(S, a) → { type, label, ready? } | null: o que o E faz · idle(S, a): true se NÃO está pronto (o jogador prefere o bicho que ainda dá produto)
     balloon(S, a) → { prop } | { icon } | null: o balão de "pronto" acima do bicho (só antes das 18:00) */
  const MIDDAY = 13 * 60;
  const meatSlots = S => S.min >= MIDDAY ? 2 : 1;                       // carne do porco: 2 vezes por dia (de manhã e a partir do meio-dia), uma por porco em cada janela
  const meatReady = (S, a) => ((S.meatDone && S.meatDone[a.idx]) || 0) < meatSlots(S);
  const milkDone = (S, a) => !!(S.milked && S.milked[a.idx]);
  const KINDS = {
    cachorro: { pen: null, h: 46, speed: 70, step: 15, bob: 2.4, touch: 46, right: 'profile_left', left: 'profile_right', ai: 'dog',
      interact: (S, a) => ({ type: 'cachorro', label: 'E — Fazer carinho', ref: a }) },
    vaca: { pen: 'curral', owned: 'vaca', h: 72, speed: 20, step: 7, bob: 1.4, touch: 80, right: 'profile_left', left: 'profile_right',
      shop: { name: 'Vaca', cost: 260, max: 4, img: 'assets/animais/vaca/front34.png', info: 'Dá leite todo dia (vende 42 ◎). Ordenhe com E.' },
      interact: (S, a) => ({ type: 'vaca', label: milkDone(S, a) ? 'Já ordenhada hoje' : 'E — Ordenhar', ref: a }),
      idle: (S, a) => milkDone(S, a),
      balloon: (S, a) => !milkDone(S, a) ? { prop: 'milk_bucket' } : null },
    porco: { pen: 'curral', owned: 'porco', h: 44, speed: 28, step: 12, bob: 1.8, touch: 46, right: 'profile_right', left: 'profile_left',
      shop: { name: 'Porco', cost: 180, max: 4, img: 'assets/animais/porco/front34.png', info: 'Dá carne 2× por dia (vende 30 ◎) e acha trufas (80 ◎). Pegue com E.' },
      interact: (S, a) => ({ type: 'porco', label: meatReady(S, a) ? 'E — Pegar carne' : 'E — Fazer carinho', ref: a, ready: meatReady(S, a) }),
      idle: (S, a) => !meatReady(S, a),
      balloon: (S, a) => meatReady(S, a) ? { icon: 'meat' } : null },
    cavalo: { pen: 'curral', owned: 'cavalo', h: 104, speed: 38, step: 9, bob: .6, touch: 84, sheet: 'cavalo',       // sem right/left: usa a sheet; o balanço é só um respiro, as pernas já se mexem nos quadros
      shop: { name: 'Cavalo', cost: 650, max: 2, img: 'assets/animais/cavalo/icon.png', info: 'Monte com E e cavalgue quase 2× mais rápido.' },
      interact: (S, a) => ({ type: 'cavalo', label: 'E — Montar', ref: a }) },
    // Fase 5 do plano: a IA, a interação e o balão destas duas entram lá. Já têm recinto, tamanho e sheet; não aparecem enquanto S.owned.ovelha/coelho não existirem (Fase 6: loja).
    ovelha: { pen: 'pasto', owned: 'ovelha', h: 54, speed: 22, step: 8, bob: 1.2, touch: 52, sheet: 'ovelha' },
    coelho: { pen: 'coelheira', owned: 'coelho', h: 30, speed: 40, step: 10, bob: 0, touch: 44, sheet: 'coelho' },
  };
  const DIR_NAMES = ['down', 'up', 'left', 'right'];                           // a.dir: 0 baixo · 1 cima · 2 esquerda · 3 direita
  const VIEWS = ['front', 'front34', 'back', 'back34', 'profile_left', 'profile_right'];
  const PROPS = ['milk_bucket', 'watering_trough', 'hay_bale', 'feed_trough', 'pig_feeder', 'salt_lick', 'mud_puddle', 'mud_puddle2', 'paw_print', 'apple', 'dog_bowl_water',
    'pasto_tufo', 'pegadas_coelho', 'feno_redondo', 'trilha_terra'];
  const TILES = ['straw', 'rooting_ground', 'grassA', 'grassB', 'dirt'];
  const IMGS = { props: {}, tiles: {} };

  let E = null;                       // ambiente injetado pelo jogo
  let list = [], horse = null, riding = false, nextId = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function load(loader) {
    const jobs = [];
    for (const k in KINDS) {
      IMGS[k] = {};
      if (KINDS[k].sheet) { jobs.push(loader(`${BASE}${KINDS[k].sheet}/${k === 'cavalo' ? 'walk_sheet' : 'sheet'}.png`, IMGS[k], 'sheet').then(() => sliceSheet(k))); continue; }
      for (const v of VIEWS) jobs.push(loader(`${BASE}${k}/${v}.png`, IMGS[k], v));
    }
    for (const p of PROPS) jobs.push(loader(`${BASE}props/${p}.png`, IMGS.props, p));
    for (const t of TILES) jobs.push(loader(`${BASE}tiles/${t}.png`, IMGS.tiles, t));
    return jobs;
  }
  // recorta a sheet em quadros (canvas) uma vez: o resto do código desenha um quadro como desenha qualquer sprite. Sheet que não carregou = quadros vazios (nunca lança).
  // IMGS[k].frames[linha][coluna]; o cavalo também mantém IMGS.cavalo.walk[direção][quadro] (o mesmo objeto, o que o desenho e os testes já usam)
  function sliceSheet(kind) {
    const SH = SHEETS[kind], im = IMGS[kind], sh = im.sheet, [cw, ch] = SH.cell, names = Object.keys(SH.rows);
    const ok = !!sh && sh.width >= cw * SH.cols && sh.height >= ch * names.length, frames = {};
    for (const n of names) {
      frames[n] = [];
      for (let f = 0; f < SH.cols; f++) {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        if (ok) c.getContext('2d').drawImage(sh, f * cw, SH.rows[n] * ch, cw, ch, 0, 0, cw, ch);
        frames[n].push(c);
      }
    }
    im.frames = frames; if (kind === 'cavalo') im.walk = frames;
  }
  const bind = env => { E = env; };

  /* ---------------- mundo ---------------- */
  // só as células SÓLIDAS do mapa ANTIGO (cerca e decoração do curral de 15 × 12): é o que o gerador do mundo viu quando o mapa antigo foi gerado
  function markSolidLegacy(solid, MW) {
    for (let y = LEGACY.area.y0; y <= LEGACY.area.y1; y++) for (let x = LEGACY.area.x0; x <= LEGACY.area.x1; x++) if (legacyFence(x, y)) solid[y * MW + x] = 1;
    for (const [tx, ty, tw] of LEGACY.decor) for (let i = 0; i < tw; i++) solid[ty * MW + tx + i] = 1;
  }
  // depois do mundo gerado: tira a cerca/decoração ANTIGAS e marca as dos recintos de hoje (o curral cresceu para o sul; o pasto e a coelheira são novos)
  function relayout(solid, MW) {
    for (let y = LEGACY.area.y0; y <= LEGACY.area.y1; y++) for (let x = LEGACY.area.x0; x <= LEGACY.area.x1; x++) if (legacyFence(x, y)) solid[y * MW + x] = 0;
    for (const [tx, ty, tw] of LEGACY.decor) for (let i = 0; i < tw; i++) solid[ty * MW + tx + i] = 0;
  }
  function markSolid(solid, MW) {
    for (const p of PEN_LIST) {
      for (let y = p.area.y0; y <= p.area.y1; y++) for (let x = p.area.x0; x <= p.area.x1; x++) if (isFenceOf(p, x, y)) solid[y * MW + x] = 1;
      for (const d of p.decor) if (d.solid !== false) for (let i = 0; i < d.tw; i++) solid[d.ty * MW + d.tx + i] = 1;
    }
  }

  // piso dos recintos: retalhos de palha, terra, capim e poças (desenhados no canvas do chão)
  function drawGround(c, mk) {
    const F = TS + 40;
    const feather = mk(F, F, f => {
      const m = f.createRadialGradient(F / 2, F / 2, 8, F / 2, F / 2, F / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.6, 'rgba(0,0,0,.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = m; f.fillRect(0, 0, F, F);
    });
    const tmp = mk(F, F, () => { }), tg = tmp.getContext('2d');
    for (const p of PEN_LIST) {
      for (const [name, cx, cy, rx, ry] of p.patches) {
        const im = IMGS.tiles[name]; if (!im) continue;
        for (let y = (cy - ry) * TS; y <= (cy + ry) * TS; y += 24) for (let x = (cx - rx) * TS; x <= (cx + rx) * TS; x += 24) {
          const d = Math.hypot((x / TS - cx) / rx, (y / TS - cy) / ry), al = clamp((1 - d) * 2.4, 0, 1) * .93;
          if (al < .03) continue;
          tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, F, F);
          tg.save(); tg.translate(F / 2, F / 2); tg.rotate(Math.floor(((x * 7 + y * 3) % 4)) * Math.PI / 2); tg.drawImage(im, -F / 2, -F / 2, F, F); tg.restore();
          tg.globalCompositeOperation = 'destination-in'; tg.drawImage(feather, 0, 0);
          c.globalAlpha = al; c.drawImage(tmp, x - F / 2, y - F / 2); c.globalAlpha = 1;
        }
      }
      for (const [n, tx, ty, s] of p.puddles) {
        const im = IMGS.props[n]; if (!im) continue;
        c.globalAlpha = .95; c.drawImage(im, tx * TS - im.width * s / 2, ty * TS - im.height * s / 2, im.width * s, im.height * s); c.globalAlpha = 1;
      }
    }
    const tr = IMGS.props[TRAIL[0]];                                                         // a trilha de terra do corredor (por baixo das cercas)
    if (tr) for (let i = 1; i + 2 < TRAIL.length; i += 3) { c.globalAlpha = .92; c.drawImage(tr, TRAIL[i] * TS - tr.width * TRAIL[i + 2] / 2, TRAIL[i + 1] * TS - tr.height * TRAIL[i + 2] / 2, tr.width * TRAIL[i + 2], tr.height * TRAIL[i + 2]); c.globalAlpha = 1; }
  }

  /* ---------------- animais ---------------- */
  function freeSpot(pen) {
    const p = PENS[pen || 'curral'];
    for (let i = 0; i < 40; i++) {
      const tx = Math.floor(rnd(p.in.x0 + 1, p.in.x1)), ty = Math.floor(rnd(p.in.y0 + 1, p.in.y1));
      if (!E.blocked(tx, ty)) return [(tx + .5) * TS, (ty + .6) * TS];
    }
    return [(p.in.x0 + 3) * TS, (p.in.y0 + 3) * TS];
  }
  function mk(kind, x, y, extra) {
    return Object.assign({ id: nextId++, kind, x, y, dir: Math.floor(rnd(0, 4)), moving: false, wait: rnd(0, 3), tx: 0, ty: 0, t: rnd(0, 9), idle: 0, hop: 0, love: 0, stuck: 0, lastBark: 0 }, extra || {});
  }
  const ownedKinds = () => Object.keys(KINDS).filter(k => KINDS[k].owned);
  function spawn(S) {
    list = []; horse = null; riding = false;
    const P = E.P;
    list.push(mk('cachorro', P.x - 60, P.y + 30, { dir: 3 }));
    for (const k of ownedKinds()) for (let i = 0; i < ((S.owned && S.owned[KINDS[k].owned]) | 0); i++) {
      const [x, y] = freeSpot(KINDS[k].pen), a = mk(k, x, y, { idx: i }); list.push(a); if (k === 'cavalo' && !horse) horse = a;
    }
  }
  const dog = () => list.find(a => a.kind === 'cachorro');
  function add(kind) {
    const [px, py] = freeSpot(KINDS[kind].pen), idx = list.filter(q => q.kind === kind).length;
    const an = mk(kind, px, py, { idx }); list.push(an); if (kind === 'cavalo' && !horse) horse = an; return an;
  }
  // o que a loja mostra de cada espécie à venda (game.js monta o ANIMAL_SHOP a partir daqui: um lugar só para o preço, o limite e o texto)
  const shopCatalog = () => Object.fromEntries(Object.keys(KINDS).filter(k => KINDS[k].shop).map(k => [k, KINDS[k].shop]));

  function walkable(a, nx, ny, confine) {
    const tx = Math.floor(nx / TS), ty = Math.floor(ny / TS);
    if (E.blocked(tx, ty) || E.isWater(tx, ty)) return false;
    if (confine && !inIn(confine, tx, ty)) return false;
    return true;
  }
  function move(a, mx, my, confine) {
    let moved = 0;
    if (mx && walkable(a, a.x + mx, a.y, confine)) { a.x += mx; moved += Math.abs(mx); }
    if (my && walkable(a, a.x, a.y + my, confine)) { a.y += my; moved += Math.abs(my); }
    return moved;
  }
  function faceVec(a, dx, dy) {
    if (Math.abs(dx) > Math.abs(dy) * 1.15) a.dir = dx < 0 ? 2 : 3;
    else if (Math.abs(dy) > Math.abs(dx) * 1.15) a.dir = dy < 0 ? 1 : 0;
  }

  const VEC = [[0, 1], [0, -1], [-1, 0], [1, 0]];     // baixo, cima, esquerda, direita
  const FOLLOW_TIME = 50;                             // segundos que o cachorro acompanha depois de chamado
  // o cachorro passeia sozinho pela fazenda; quando chamado, vem correndo e fica com o jogador por um tempo
  function callDog() {
    const a = dog(); if (!a) return false;
    a.follow = FOLLOW_TIME; a.go = false; a.stuck = 0; a.hop = .25; a.lastBark = E.time();
    return true;
  }
  const dogFollowing = () => { const a = dog(); return !!a && a.follow > 0; };
  function dogRoam(a, dt) {
    if (a.go) {
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (d < 8) { a.go = false; a.wait = rnd(2, 6); a.idle = 0; return; }
      const mv = move(a, dx / d * 62 * dt, dy / d * 62 * dt, null);
      faceVec(a, dx, dy); a.moving = mv > .05;
      if (mv < .05) { a.stuck += dt; if (a.stuck > .5) { a.go = false; a.wait = rnd(.3, 1.2); a.stuck = 0; } } else a.stuck = 0;
      return;
    }
    a.idle += dt; a.wait -= dt;
    if (a.wait > 0) return;
    for (let i = 0; i < 12; i++) {                      // escolhe um canto próximo da fazenda, em terreno livre
      const tx = clamp(a.x + rnd(-420, 420), 2 * TS, (E.MW - 2) * TS), ty = clamp(a.y + rnd(-320, 320), 8 * TS, (E.MH - 2) * TS);
      const tx0 = Math.floor(tx / TS), ty0 = Math.floor(ty / TS);
      if (E.blocked(tx0, ty0) || E.isWater(tx0, ty0)) continue;
      a.tx = tx; a.ty = ty; a.go = true; a.idle = 0; a.stuck = 0; return;
    }
    a.wait = rnd(1, 3);
  }
  function dogAI(a, dt) {
    const P = E.P, dp = Math.hypot(P.x - a.x, P.y - a.y);
    a.moving = false;
    if (!(a.follow > 0)) {                              // passeando sozinho
      dogRoam(a, dt);
      if (!a.go && a.idle > 4 && Math.random() < dt * .05 && E.time() - a.lastBark > 12 && dp < 700) { a.lastBark = E.time(); E.Snd.bark(); a.hop = .25; }
      return;
    }
    a.follow -= dt;
    if (dp > 1500 && !(E.onScreen && E.onScreen(a.x, a.y))) { a.x = P.x - VEC[P.dir][0] * 60; a.y = P.y - VEC[P.dir][1] * 40 + 24; a.stuck = 0; return; }
    // segue por TRÁS do jogador (nunca no tile à frente, onde as ferramentas atuam)
    const bx = P.x - VEC[P.dir][0] * 70, by = P.y + 6 - VEC[P.dir][1] * 54;
    const dx = bx - a.x, dy = by - a.y, d = Math.hypot(dx, dy);
    let sp = 0;
    if (dp > 240) sp = 190; else if (d > 36 && (P.moving || dp > 130)) sp = dp > 150 ? 115 : 80;
    if (sp) {
      const mv = move(a, dx / d * sp * dt, dy / d * sp * dt, null);
      a.moving = mv > .05; faceVec(a, dx, dy); a.idle = 0;
      if (mv < .05) { a.stuck += dt; if (a.stuck > 1.4 && dp > 130) { a.x = bx; a.y = by; a.stuck = 0; } } else a.stuck = 0;
    } else {
      a.idle += dt; a.stuck = 0;
      if (dp < 150) faceVec(a, P.x - a.x, P.y - a.y);
      // late de vez em quando quando está sentado olhando para o jogador
      if (a.idle > 6 && Math.random() < dt * .08 && E.time() - a.lastBark > 8) { a.lastBark = E.time(); E.Snd.bark(); a.hop = .25; }
    }
  }

  // vagueia dentro do PRÓPRIO recinto (KINDS[kind].pen)
  function wanderAI(a, dt, S) {
    const K = KINDS[a.kind], pen = PENS[K.pen];
    const tx0 = Math.floor(a.x / TS), ty0 = Math.floor(a.y / TS);
    if (!inIn(pen, tx0, ty0)) { a.moving = false; return; }          // fora do recinto (cavalo desmontado): fica parado
    if (a.moving) {
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (d < 3) { a.moving = false; a.wait = rnd(2.5, 7); }
      else {
        const mv = move(a, dx / d * K.speed * dt, dy / d * K.speed * dt, pen);
        faceVec(a, dx, dy);
        if (mv < .02) { a.moving = false; a.wait = rnd(.6, 2); }
      }
    } else {
      a.wait -= dt; a.idle += dt;
      if (a.wait <= 0) {
        a.tx = clamp(a.x + rnd(-210, 210), (pen.in.x0 + .6) * TS, (pen.in.x1 + .4) * TS);
        a.ty = clamp(a.y + rnd(-150, 150), (pen.in.y0 + 1) * TS, (pen.in.y1 + .5) * TS);
        a.moving = true; a.idle = 0;
        if (a.kind === 'vaca' && Math.random() < .25) E.Snd.moo(true);
      }
    }
  }

  function update(dt, S) {
    const P = E.P;
    for (const a of list) {
      a.t += dt; if (a.hop > 0) a.hop -= dt;
      if (SHEETS[a.kind]) a.wp = a.moving ? (a.wp || 0) + dt * (a === horse && riding ? HORSE.fpsRide : sheetFps(a)) : 0;      // fase do ciclo de caminhada; parou = quadro de repouso
      if (a.love > 0) { a.love -= dt; if (Math.random() < dt * 5) E.heart(a.x + rnd(-10, 10), a.y - KINDS[a.kind].h * .85); }
      if (a === horse && riding) { a.x = P.x; a.y = P.y; a.dir = P.dir; a.moving = P.moving && P.wk > .2; continue; }
      if (a.kind === 'cachorro') dogAI(a, dt); else wanderAI(a, dt, S);
    }
    // trufas: pegas ao passar perto
    if (S.truffleList) for (let i = S.truffleList.length - 1; i >= 0; i--) {
      const t = S.truffleList[i];
      if (Math.hypot(t[0] - P.x, t[1] - P.y) < 30) { S.truffleList.splice(i, 1); E.takeTruffle(t); }
    }
  }
  const sheetFps = a => { const f = SHEETS[a.kind].fps; return typeof f === 'number' ? f : (f.walk || f.hop || 5); };

  /* ---------------- interação ---------------- */
  function near(a, cx, cy) {
    return Math.abs(a.x - cx) < KINDS[a.kind].touch && a.y > cy - 58 && a.y < cy + 62 && !(a === horse && riding);          // animais grandes: área de toque generosa
  }
  function at(tx, ty, S) {
    const cx = (tx + .5) * TS, cy = (ty + .5) * TS;
    if (S.truffleList) for (const t of S.truffleList) if (Math.floor(t[0] / TS) === tx && Math.floor(t[1] / TS) === ty) return { type: 'truffle', label: 'E — Pegar trufa' };
    if (S.digs) for (const d of S.digs) if (d[0] === tx && d[1] === ty) return { type: 'dig', label: 'E — Cavar tesouro', ref: d };
    if (riding && horse && Math.abs(horse.x - cx) < 80 && Math.abs(horse.y - cy) < 60) return { type: 'dismount', label: 'E — Desmontar' };
    // prioriza o animal mais perto do centro do tile (e, entre dois, o que ainda tem produto)
    let best = null, bd = 1e9;
    for (const a of list) if (KINDS[a.kind].interact && near(a, cx, cy)) {
      const K = KINDS[a.kind]; let d = Math.hypot(a.x - cx, a.y - cy);
      if (K.idle && K.idle(S, a)) d += 500;
      if (d < bd) { bd = d; best = a; }
    }
    return best ? KINDS[best.kind].interact(S, best) : null;
  }
  function mount(a) { if (a && a.kind === 'cavalo') horse = a; if (!horse) return false; riding = true; return true; }
  function dismount() {
    if (!riding) return;
    riding = false; horse.moving = false;
    const P = E.P; horse.x = P.x; horse.y = P.y;
    // o jogador desce ao lado
    for (const [dx, dy] of [[-56, 0], [56, 0], [0, 40], [0, -40]]) if (walkableP(P.x + dx, P.y + dy)) { P.x += dx; P.y += dy; break; }
  }
  function walkableP(x, y) { return !E.boxBlocked(x, y); }
  const isRiding = () => riding;
  const cows = () => list.filter(a => a.kind === 'vaca');
  const pigs = () => list.filter(a => a.kind === 'porco');
  function resetMorning() {          // novo dia: os animais voltam ao seu recinto
    if (riding) dismount();
    for (const a of list) {
      const pen = KINDS[a.kind].pen && PENS[KINDS[a.kind].pen]; if (!pen) continue;
      if (!inIn(pen, Math.floor(a.x / TS), Math.floor(a.y / TS))) { const [x, y] = freeSpot(pen.id); a.x = x; a.y = y; }
    }
  }

  /* ---------------- desenho ---------------- */
  function pickSprite(a) {
    const im = IMGS[a.kind], K = KINDS[a.kind];
    const alt = Math.floor(a.t * 3.4) % 2 === 0;
    if (K.sheet) {                                              // sprite sheet: linha pela direção (cavalo, ovelha e coelho andam; os extras eat_*/shorn_* entram na Fase 5)
      const SH = SHEETS[a.kind], d = DIR_NAMES[a.dir] || 'down', L = SH.loop[d] || SH.loop.walk || SH.hop, idle = typeof SH.idle === 'number' ? SH.idle : SH.idle[d];
      const fr = a.moving ? L[Math.floor(a.wp || 0) % L.length] : idle;
      return { img: im.frames[d][fr], flip: false, foot: SH.foot[d] };
    }
    if (a.dir >= 2) {
      return { img: im[a.dir === 3 ? K.right : K.left], flip: false };
    }
    if (a.kind === 'cachorro') {
      const stand = a.moving || a.idle < 1.6;
      return { img: a.dir === 0 ? (stand ? im.front34 : im.front) : (stand ? im.back34 : im.back), flip: false };
    }
    return { img: a.dir === 0 ? im.front : im.back, flip: false };
  }
  function sizeOf(a, img) {
    const K = KINDS[a.kind], sc = K.h / (K.sheet ? SHEETS[a.kind].ref : IMGS[a.kind].profile_left.height);
    return { w: img.width * sc, h: img.height * sc, sc };
  }

  // largura da sombra: o cavalo usa a largura do CORPO (de frente ele é estreito; a célula da sheet é larga)
  const shadowW = (pk, w, h, sc, k) => pk.foot ? pk.foot * sc * (pk.foot < 100 ? k * 1.4 : k) : Math.min(w, h * 1.6) * k;
  function drawBalloon(g, a, S, K, phase) {
    const b = K.balloon && S.min < 18 * 60 ? K.balloon(S, a) : null; if (!b) return;
    const y = a.y - K.h - 12 + Math.sin(a.t * 3 + phase) * 2;
    g.save(); g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#6b4a2a'; g.lineWidth = 2;
    g.beginPath(); g.arc(a.x, y, 15, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(a.x - 4, y + 13); g.lineTo(a.x, y + 20); g.lineTo(a.x + 4, y + 13); g.fill();
    if (b.prop) { const im = IMGS.props[b.prop]; if (im) g.drawImage(im, a.x - 10, y - 11, 20, 20 * im.height / im.width); }
    else if (b.icon && E.icons && E.icons[b.icon]) g.drawImage(E.icons[b.icon], a.x - 12, y - 12, 24, 24);
    g.restore();
  }
  function drawAnimal(g, a, S) {
    const K = KINDS[a.kind], pk = pickSprite(a), { img, flip } = pk, { w, h, sc } = sizeOf(a, img);
    const bob = a.moving ? Math.abs(Math.sin(a.t * K.step)) * K.bob : Math.sin(a.t * 1.6 + a.id) * .5;
    const hop = a.hop > 0 ? Math.sin(a.hop / .25 * Math.PI) * 9 : 0;
    E.shadow(g, a.x, a.y - 1, shadowW(pk, w, h, sc, .36), 5 + K.h * .05, .3);
    g.save(); g.translate(a.x, a.y - bob - hop);
    if (a.moving && !K.sheet) g.rotate(Math.sin(a.t * K.step * .5) * .03);      // os bichos de sheet já animam as pernas nos quadros
    if (flip) g.scale(-1, 1);
    g.drawImage(img, -w / 2, -h + 3, w, h);
    g.restore();
    drawBalloon(g, a, S, K, a.kind === 'porco' ? 1 : 0);        // vaca pronta para ordenha: balde · porco com carne pronta: presunto
  }

  // jogador montado: cavalo + tronco do personagem na sela
  function drawMounted(g, P, CI, S) {
    const a = horse; if (!a) return;
    const K = KINDS.cavalo, pk = pickSprite(a), { img, flip } = pk, { w, h, sc } = sizeOf(a, img);
    const bob = P.wk > .2 ? Math.abs(Math.sin(a.t * K.step)) * K.bob : Math.sin(a.t * 1.6) * .5;
    const dir = P.dir, rider = dir === 0 ? CI.front_walk : dir === 1 ? CI.back : CI.left_stand;
    const frac = .7, rh = 104, rs = rh / rider.height, rw = rider.width * rs, ph = rider.height * frac * rs;
    const saddle = P.y - h * .66 - bob;              // a linha do dorso do cavalo novo é mais alta que a do antigo
    const drawRider = () => {
      g.save(); g.translate(P.x + (dir >= 2 ? (dir === 3 ? -3 : 3) : 0), saddle + 12);
      if (dir === 2) g.scale(-1, 1);
      g.drawImage(rider, 0, 0, rider.width, rider.height * frac, -rw / 2, -ph, rw, ph); g.restore();
    };
    const drawHorse = () => {
      E.shadow(g, P.x, P.y - 1, shadowW(pk, w, h, sc, .38), 7, .3);
      g.save(); g.translate(P.x, P.y - bob); if (flip) g.scale(-1, 1);
      g.drawImage(img, -w / 2, -h + 3, w, h); g.restore();
    };
    // o corpo do cavalo cobre a parte de baixo do cavaleiro; DE COSTAS o cavaleiro vem na frente da cabeça/pescoço do cavalo (senão só a cabeça dele apareceria)
    if (dir === 1) { drawHorse(); drawRider(); } else { drawRider(); drawHorse(); }
  }

  /* cercas: 'madeira' (curral: duas travas grossas), 'arame' (pasto: postes finos e dois fios), 'estacas' (coelheira: estacas baixas e um fio) */
  const FENCE_STYLE = {
    madeira: { ph: 46, gph: 58, w: 12, h: [[38, 6], [20, 6]], v: [[36, 6], [20, 6]] },      // h = travas horizontais [altura, espessura] · v = as verticais (mesmos números do curral original)
    arame:   { ph: 42, gph: 54, w: 8, h: [[34, 1.6], [18, 1.6]], v: [[34, 1.6], [18, 1.6]] },
    estacas: { ph: 30, gph: 42, w: 8, h: [[20, 1.6]], v: [[20, 1.6]] },
  };
  function drawFence(g, tx, ty) {
    const pen = penOf(tx, ty), st = FENCE_STYLE[pen.fence], wire = pen.fence !== 'madeira';
    const cx = tx * TS + 32, by = (ty + 1) * TS - 6;
    const bar = (x, y, w, h) => {
      if (wire) { g.fillStyle = '#4a4a4a'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, Math.min(h, .8)); return; }
      const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#b98350'); gr.addColorStop(1, '#7a4d27');
      g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y + h - 1.5, w, 1.5);
    };
    const e = isFenceOf(pen, tx + 1, ty), s = isFenceOf(pen, tx, ty + 1);
    if (e) for (const [hy, th] of st.h) bar(cx, by - hy, TS, th);
    if (s) for (const [vy, th] of st.v) bar(cx - th / 2, by - vy, th, TS);
    const gp = isGate(pen, tx, ty + 1) || isGate(pen, tx, ty - 1);
    const ph = gp ? st.gph : st.ph, w = st.w;
    E.shadow(g, cx + 3, by + 1, w * .75, 3.5, .28);
    const post = wire ? ['#b98a55', '#8a6238', '#5a3f22'] : ['#a8723f', '#7a4d27', '#4e3017'];
    const gr = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0); gr.addColorStop(0, post[0]); gr.addColorStop(.6, post[1]); gr.addColorStop(1, post[2]);
    g.fillStyle = gr; g.fillRect(cx - w / 2, by - ph, w, ph);
    g.fillStyle = wire ? '#d4ad78' : '#c99660'; g.beginPath(); g.ellipse(cx, by - ph, w / 2 + .5, w / 4, 0, 0, TAU); g.fill();
    if (gp) { g.fillStyle = '#d9b37a'; g.fillRect(cx - 8, by - ph - 2, 16, 4); }
  }
  function drawDecor(g, d) {
    const im = IMGS.props[d.k]; if (!im) return;
    const w = im.width * d.s, h = im.height * d.s;
    if (d.solid !== false) E.shadow(g, (d.tx + d.tw / 2) * TS, (d.ty + 1) * TS - 4, w * .42, 5, .22);
    g.drawImage(im, (d.tx + d.tw / 2) * TS - w / 2, (d.ty + 1) * TS - 2 - h, w, h);
  }
  function drawTruffle(g, x, y) {
    E.shadow(g, x, y + 2, 7, 2.6, .25);
    g.save(); g.translate(x, y - 5);
    const gr = g.createRadialGradient(-2, -3, 1, 0, 0, 8); gr.addColorStop(0, '#6a4a34'); gr.addColorStop(1, '#2a1a10');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,230,190,.22)'; for (const [dx, dy] of [[-3, -2], [2, -3], [1, 2], [-2, 3], [4, 1]]) { g.beginPath(); g.arc(dx, dy, 1.2, 0, TAU); g.fill(); }
    g.restore();
  }
  function drawMound(g, d, time) {
    const x = (d[0] + .5) * TS, y = (d[1] + .75) * TS, p = IMGS.props.paw_print;
    E.shadow(g, x, y + 2, 18, 6, .25);
    const gr = g.createRadialGradient(x - 5, y - 8, 2, x, y - 2, 20); gr.addColorStop(0, '#8a6038'); gr.addColorStop(1, '#4a2e18');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y - 3, 19, 10, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,225,170,.2)'; g.beginPath(); g.ellipse(x - 5, y - 6, 9, 3, 0, 0, TAU); g.fill();
    if (p) g.drawImage(p, x - 8, y - 14 - Math.sin(time * 3) * 1.5, 16, 16 * p.height / p.width);
    const s = (Math.sin(time * 4 + d[0]) + 1) / 2; g.fillStyle = `rgba(255,245,170,${.25 + s * .5})`; g.beginPath(); g.arc(x + 14, y - 14, 1.8 + s * 2, 0, TAU); g.fill();
  }

  function collect(out, v, g, S, time) {
    const vis = (tx, ty) => tx >= v.x0 - 1 && tx <= v.x1 + 1 && ty >= v.y0 - 2 && ty <= v.y1 + 2;
    for (const p of PEN_LIST) {
      if (!(v.x1 >= p.area.x0 - 2 && v.x0 <= p.area.x1 + 2 && v.y1 >= p.area.y0 - 2 && v.y0 <= p.area.y1 + 2)) continue;
      for (let y = p.area.y0; y <= p.area.y1; y++) for (let x = p.area.x0; x <= p.area.x1; x++) {
        if (isFenceOf(p, x, y) && vis(x, y)) out.push({ y: (y + 1) * TS - 5, d: () => drawFence(g, x, y) });
      }
      for (const d of p.decor) if (vis(d.tx, d.ty)) out.push({ y: (d.ty + 1) * TS - 4, d: () => drawDecor(g, d) });
    }
    if (S.digs) for (const d of S.digs) if (vis(d[0], d[1])) out.push({ y: (d[1] + .75) * TS, d: () => drawMound(g, d, time) });
    if (S.truffleList) for (const t of S.truffleList) out.push({ y: t[1], d: () => drawTruffle(g, t[0], t[1]) });
    for (const a of list) {
      if (a === horse && riding) continue;
      if (a.x < v.x0 * TS - 120 || a.x > (v.x1 + 2) * TS + 120 || a.y < v.y0 * TS - 120 || a.y > (v.y1 + 3) * TS + 120) continue;
      out.push({ y: a.y, d: () => drawAnimal(g, a, S) });
    }
  }

  return {
    PENS, PEN_LIST, KINDS, SHEETS, IMGS, CLEAR, LEGACY,
    // compatibilidade com o que o jogo já usava (curral = o recinto principal; inArea/inIn/isFence valem para QUALQUER recinto)
    AREA: PENS.curral.area, IN: PENS.curral.in, GATE: PENS.curral.gates[0], DECOR: PENS.curral.decor,
    inArea: inAnyPen, inIn: inAnyIn, isFence, isGate: (x, y) => PEN_LIST.some(p => isGate(p, x, y)),
    inAnyPen, keepClear, penOf, penTile, inLegacyArea: legacyIn, shopCatalog,
    load, bind, markSolid, markSolidLegacy, relayout, drawGround, spawn, update, at, collect, drawMounted,
    mount, dismount, isRiding, resetMorning, cows, pigs, dog, freeSpot, add, callDog, dogFollowing, meatReady, MIDDAY,
    get horse() { return horse; },
    get list() { return list; },
  };
})();
