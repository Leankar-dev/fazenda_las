'use strict';
/* ============================================================
   animais.js  -  curral, animais e companheiros da fazenda
   Sprites: assets/animais/<animal>/*.png (recortados de docs/animais.jpeg)
   Cachorro: companheiro que segue o jogador e cava tesouros.
   Vaca: ordenha diária.  Porco: acha trufas.  Cavalo: montaria.
   ============================================================ */
const Animals = (() => {
  const TS = 64, TAU = Math.PI * 2;
  const BASE = 'assets/animais/';

  /* ---------------- layout do curral ---------------- */
  const AREA = { x0: 30, y0: 16, x1: 44, y1: 27 };      // anel da cerca
  const IN = { x0: 31, y0: 17, x1: 43, y1: 26 };        // interior
  const GATE = { x: 30, y0: 21, y1: 22 };               // abertura (oeste)
  const inArea = (x, y, m = 0) => x >= AREA.x0 - m && x <= AREA.x1 + m && y >= AREA.y0 - m && y <= AREA.y1 + m;
  const inIn = (x, y) => x >= IN.x0 && x <= IN.x1 && y >= IN.y0 && y <= IN.y1;
  const isGate = (x, y) => x === GATE.x && y >= GATE.y0 && y <= GATE.y1;
  const isFence = (x, y) => inArea(x, y) && !inIn(x, y) && !isGate(x, y);
  const DECOR = [
    { k: 'watering_trough', tx: 34, ty: 17, tw: 2, s: 1.45 },
    { k: 'hay_bale', tx: 41, ty: 17, tw: 1, s: 1.2 },
    { k: 'hay_bale', tx: 42, ty: 17, tw: 1, s: 1.2 },
    { k: 'salt_lick', tx: 37, ty: 17, tw: 1, s: 1.15 },
    { k: 'feed_trough', tx: 39, ty: 26, tw: 2, s: 1.35 },
    { k: 'pig_feeder', tx: 42, ty: 26, tw: 1, s: 1.25 },
    { k: 'hay_bale', tx: 32, ty: 26, tw: 1, s: 1.2 },
  ];
  const PUDDLES = [['mud_puddle', 39.2, 23.2, 1.5], ['mud_puddle2', 41.4, 24.4, 1.3], ['mud_puddle', 38.2, 21.7, 1.1]];
  const PATCHES = [['straw', 34.4, 23.7, 3.4, 2.5], ['rooting_ground', 40.2, 23.4, 3.7, 2.7]];   // [tile, cx, cy, rx, ry] em tiles

  /* ---------------- espécies ---------------- */
  const KINDS = {
    cachorro: { h: 46, speed: 70, step: 15, bob: 2.4, right: 'profile_left', left: 'profile_right' },
    vaca:     { h: 72, speed: 20, step: 7,  bob: 1.4, right: 'profile_left', left: 'profile_right' },
    porco:    { h: 44, speed: 28, step: 12, bob: 1.8, right: 'profile_right', left: 'profile_left' },
    cavalo:   { h: 98, speed: 38, step: 9,  bob: 2.2, right: 'profile_left', left: 'profile_left' },
  };
  const VIEWS = ['front', 'front34', 'back', 'back34', 'profile_left', 'profile_right'];
  const PROPS = ['milk_bucket', 'watering_trough', 'hay_bale', 'feed_trough', 'pig_feeder', 'salt_lick', 'mud_puddle', 'mud_puddle2', 'paw_print', 'apple', 'dog_bowl_water'];
  const TILES = ['straw', 'rooting_ground'];
  const IMGS = { props: {}, tiles: {} };

  let E = null;                       // ambiente injetado pelo jogo
  let list = [], horse = null, riding = false, nextId = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function load(loader) {
    const jobs = [];
    for (const k in KINDS) { IMGS[k] = {}; for (const v of VIEWS) jobs.push(loader(`${BASE}${k}/${v}.png`, IMGS[k], v)); }
    for (const p of PROPS) jobs.push(loader(`${BASE}props/${p}.png`, IMGS.props, p));
    for (const t of TILES) jobs.push(loader(`${BASE}tiles/${t}.png`, IMGS.tiles, t));
    return jobs;
  }
  const bind = env => { E = env; };

  /* ---------------- mundo ---------------- */
  function markSolid(solid, MW) {
    for (let y = AREA.y0; y <= AREA.y1; y++) for (let x = AREA.x0; x <= AREA.x1; x++) if (isFence(x, y)) solid[y * MW + x] = 1;
    for (const d of DECOR) for (let i = 0; i < d.tw; i++) solid[d.ty * MW + d.tx + i] = 1;
  }

  // piso do curral: palha, terra de porco e poças (desenhados no canvas do chão)
  function drawGround(c, mk) {
    const F = TS + 40;
    const feather = mk(F, F, f => {
      const m = f.createRadialGradient(F / 2, F / 2, 8, F / 2, F / 2, F / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.6, 'rgba(0,0,0,.85)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = m; f.fillRect(0, 0, F, F);
    });
    const tmp = mk(F, F, () => { }), tg = tmp.getContext('2d');
    for (const [name, cx, cy, rx, ry] of PATCHES) {
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
    for (const [n, tx, ty, s] of PUDDLES) {
      const im = IMGS.props[n]; if (!im) continue;
      c.globalAlpha = .95; c.drawImage(im, tx * TS - im.width * s / 2, ty * TS - im.height * s / 2, im.width * s, im.height * s); c.globalAlpha = 1;
    }
  }

  /* ---------------- animais ---------------- */
  function freeSpot() {
    for (let i = 0; i < 40; i++) {
      const tx = Math.floor(rnd(IN.x0 + 1, IN.x1)), ty = Math.floor(rnd(IN.y0 + 1, IN.y1));
      if (!E.blocked(tx, ty)) return [(tx + .5) * TS, (ty + .6) * TS];
    }
    return [(IN.x0 + 3) * TS, (IN.y0 + 3) * TS];
  }
  function mk(kind, x, y, extra) {
    return Object.assign({ id: nextId++, kind, x, y, dir: Math.floor(rnd(0, 4)), moving: false, wait: rnd(0, 3), tx: 0, ty: 0, t: rnd(0, 9), idle: 0, hop: 0, love: 0, stuck: 0, lastBark: 0 }, extra || {});
  }
  function spawn(S) {
    list = []; horse = null; riding = false;
    const P = E.P;
    list.push(mk('cachorro', P.x - 60, P.y + 30, { dir: 3 }));
    for (let i = 0; i < (S.owned.vaca || 0); i++) { const [x, y] = freeSpot(); list.push(mk('vaca', x, y, { idx: i })); }
    for (let i = 0; i < (S.owned.porco || 0); i++) { const [x, y] = freeSpot(); list.push(mk('porco', x, y, { idx: i })); }
    if (S.owned.cavalo) { const [x, y] = freeSpot(); horse = mk('cavalo', x, y); list.push(horse); }
  }
  const dog = () => list.find(a => a.kind === 'cachorro');
  function add(kind) {
    const [px, py] = freeSpot(), idx = list.filter(q => q.kind === kind).length;
    const an = mk(kind, px, py, { idx }); list.push(an); if (kind === 'cavalo') horse = an; return an;
  }

  function walkable(a, nx, ny, confine) {
    const tx = Math.floor(nx / TS), ty = Math.floor(ny / TS);
    if (E.blocked(tx, ty) || E.isWater(tx, ty)) return false;
    if (confine && (!inIn(tx, ty))) return false;
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
  function dogAI(a, dt) {
    const P = E.P, dp = Math.hypot(P.x - a.x, P.y - a.y);
    a.moving = false;
    if (dp > 950) { a.x = P.x - VEC[P.dir][0] * 60; a.y = P.y - VEC[P.dir][1] * 40 + 24; a.stuck = 0; return; }
    // segue por TRÁS do jogador (nunca no tile à frente, onde as ferramentas atuam)
    const bx = P.x - VEC[P.dir][0] * 70, by = P.y + 6 - VEC[P.dir][1] * 54;
    const dx = bx - a.x, dy = by - a.y, d = Math.hypot(dx, dy);
    let sp = 0;
    if (dp > 240) sp = 190; else if (d > 36 && (P.moving || dp > 130)) sp = dp > 150 ? 115 : 80;
    if (sp) {
      const mv = move(a, dx / d * sp * dt, dy / d * sp * dt, false);
      a.moving = mv > .05; faceVec(a, dx, dy); a.idle = 0;
      if (mv < .05) { a.stuck += dt; if (a.stuck > 1.4 && dp > 130) { a.x = bx; a.y = by; a.stuck = 0; } } else a.stuck = 0;
    } else {
      a.idle += dt; a.stuck = 0;
      if (dp < 150) faceVec(a, P.x - a.x, P.y - a.y);
      // late de vez em quando quando está sentado olhando para o jogador
      if (a.idle > 6 && Math.random() < dt * .08 && E.time() - a.lastBark > 8) { a.lastBark = E.time(); E.Snd.bark(); a.hop = .25; }
    }
  }

  function wanderAI(a, dt, S) {
    const K = KINDS[a.kind];
    const tx0 = Math.floor(a.x / TS), ty0 = Math.floor(a.y / TS);
    if (!inIn(tx0, ty0)) { a.moving = false; return; }          // fora do curral (cavalo desmontado): fica parado
    if (a.moving) {
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (d < 3) { a.moving = false; a.wait = rnd(2.5, 7); }
      else {
        const mv = move(a, dx / d * K.speed * dt, dy / d * K.speed * dt, true);
        faceVec(a, dx, dy);
        if (mv < .02) { a.moving = false; a.wait = rnd(.6, 2); }
      }
    } else {
      a.wait -= dt; a.idle += dt;
      if (a.wait <= 0) {
        a.tx = clamp(a.x + rnd(-210, 210), (IN.x0 + .6) * TS, (IN.x1 + .4) * TS);
        a.ty = clamp(a.y + rnd(-150, 150), (IN.y0 + 1) * TS, (IN.y1 + .5) * TS);
        a.moving = true; a.idle = 0;
        if (a.kind === 'vaca' && Math.random() < .25) E.Snd.moo(true);
      }
    }
  }

  function update(dt, S) {
    const P = E.P;
    for (const a of list) {
      a.t += dt; if (a.hop > 0) a.hop -= dt;
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

  /* ---------------- interação ---------------- */
  function near(a, cx, cy) {
    const w = a.kind === 'cavalo' ? 84 : a.kind === 'vaca' ? 80 : 46;           // animais grandes: área de toque generosa
    return Math.abs(a.x - cx) < w && a.y > cy - 58 && a.y < cy + 62 && !(a === horse && riding);
  }
  function at(tx, ty, S) {
    const cx = (tx + .5) * TS, cy = (ty + .5) * TS;
    if (S.truffleList) for (const t of S.truffleList) if (Math.floor(t[0] / TS) === tx && Math.floor(t[1] / TS) === ty) return { type: 'truffle', label: 'E — Pegar trufa' };
    if (S.digs) for (const d of S.digs) if (d[0] === tx && d[1] === ty) return { type: 'dig', label: 'E — Cavar tesouro', ref: d };
    if (riding && horse && Math.abs(horse.x - cx) < 80 && Math.abs(horse.y - cy) < 60) return { type: 'dismount', label: 'E — Desmontar' };
    // prioriza o animal mais perto do centro do tile
    let best = null, bd = 1e9;
    for (const a of list) if (near(a, cx, cy)) {
      let d = Math.hypot(a.x - cx, a.y - cy);
      if (a.kind === 'vaca' && S.milked && S.milked[a.idx]) d += 500;      // prefere uma vaca que ainda dá leite
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    if (best.kind === 'cachorro') return { type: 'cachorro', label: 'E — Fazer carinho', ref: best };
    if (best.kind === 'porco') return { type: 'porco', label: 'E — Fazer carinho', ref: best };
    if (best.kind === 'cavalo') return { type: 'cavalo', label: 'E — Montar', ref: best };
    if (best.kind === 'vaca') return { type: 'vaca', label: S.milked && S.milked[best.idx] ? 'Já ordenhada hoje' : 'E — Ordenhar', ref: best };
    return null;
  }
  function mount() { if (!horse) return false; riding = true; return true; }
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
  function resetMorning() {          // novo dia: animais voltam ao curral
    if (riding) dismount();
    for (const a of list) {
      if (a.kind === 'cachorro') continue;
      if (!inIn(Math.floor(a.x / TS), Math.floor(a.y / TS))) { const [x, y] = freeSpot(); a.x = x; a.y = y; }
    }
  }

  /* ---------------- desenho ---------------- */
  function pickSprite(a) {
    const im = IMGS[a.kind], K = KINDS[a.kind];
    const alt = Math.floor(a.t * 3.4) % 2 === 0;
    if (a.dir >= 2) {
      if (a.kind === 'cavalo') return { img: a.moving && alt ? im.profile_right : im.profile_left, flip: a.dir === 2 };
      return { img: im[a.dir === 3 ? K.right : K.left], flip: false };
    }
    if (a.kind === 'cachorro') {
      const stand = a.moving || a.idle < 1.6;
      return { img: a.dir === 0 ? (stand ? im.front34 : im.front) : (stand ? im.back34 : im.back), flip: false };
    }
    return { img: a.dir === 0 ? im.front : im.back, flip: false };
  }
  function sizeOf(a, img) {
    const K = KINDS[a.kind], ref = IMGS[a.kind].profile_left, sc = K.h / ref.height;
    return { w: img.width * sc, h: img.height * sc, sc };
  }

  function drawAnimal(g, a, S) {
    const K = KINDS[a.kind], { img, flip } = pickSprite(a), { w, h } = sizeOf(a, img);
    const bob = a.moving ? Math.abs(Math.sin(a.t * K.step)) * K.bob : Math.sin(a.t * 1.6 + a.id) * .5;
    const hop = a.hop > 0 ? Math.sin(a.hop / .25 * Math.PI) * 9 : 0;
    E.shadow(g, a.x, a.y - 1, Math.min(w, h * 1.6) * .36, 5 + K.h * .05, .3);
    g.save(); g.translate(a.x, a.y - bob - hop);
    if (a.moving) g.rotate(Math.sin(a.t * K.step * .5) * (a.kind === 'cavalo' ? .018 : .03));
    if (flip) g.scale(-1, 1);
    g.drawImage(img, -w / 2, -h + 3, w, h);
    g.restore();
    // vaca pronta para ordenha: balão com balde
    if (a.kind === 'vaca' && S.milked && !S.milked[a.idx] && S.min < 18 * 60) {
      const b = IMGS.props.milk_bucket, y = a.y - K.h - 12 + Math.sin(a.t * 3) * 2;
      g.save(); g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#6b4a2a'; g.lineWidth = 2;
      g.beginPath(); g.arc(a.x, y, 15, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(a.x - 4, y + 13); g.lineTo(a.x, y + 20); g.lineTo(a.x + 4, y + 13); g.fill();
      if (b) g.drawImage(b, a.x - 10, y - 11, 20, 20 * b.height / b.width);
      g.restore();
    }
  }

  // jogador montado: cavalo + tronco do personagem na sela
  function drawMounted(g, P, CI, S) {
    const a = horse; if (!a) return;
    const K = KINDS.cavalo, { img, flip } = pickSprite(a), { w, h } = sizeOf(a, img);
    const bob = P.wk > .2 ? Math.abs(Math.sin(a.t * K.step)) * K.bob : Math.sin(a.t * 1.6) * .5;
    const dir = P.dir, rider = dir === 0 ? CI.front_walk : dir === 1 ? CI.back : CI.left_stand;
    const frac = .7, rh = 104, rs = rh / rider.height, rw = rider.width * rs, ph = rider.height * frac * rs;
    const saddle = P.y - h * .55 - bob;
    const drawRider = () => {
      g.save(); g.translate(P.x + (dir >= 2 ? (dir === 3 ? -3 : 3) : 0), saddle + 12);
      if (dir === 2) g.scale(-1, 1);
      g.drawImage(rider, 0, 0, rider.width, rider.height * frac, -rw / 2, -ph, rw, ph); g.restore();
    };
    const drawHorse = () => {
      E.shadow(g, P.x, P.y - 1, Math.min(w, h * 1.5) * .38, 7, .3);
      g.save(); g.translate(P.x, P.y - bob); if (a.moving) g.rotate(Math.sin(a.t * K.step * .5) * .015); if (flip) g.scale(-1, 1);
      g.drawImage(img, -w / 2, -h + 3, w, h); g.restore();
    };
    drawRider(); drawHorse();          // o corpo do cavalo cobre a parte de baixo do cavaleiro
  }

  function drawFence(g, tx, ty) {
    const cx = tx * TS + 32, by = (ty + 1) * TS - 6;
    const wood = (x, y, w, h) => {
      const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#b98350'); gr.addColorStop(1, '#7a4d27');
      g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y + h - 1.5, w, 1.5);
    };
    if (isFence(tx + 1, ty)) { wood(cx, by - 38, TS, 6); wood(cx, by - 20, TS, 6); }
    if (isFence(tx, ty + 1)) { wood(cx - 3, by - 36, 6, TS); wood(cx - 3, by - 20, 6, TS); }
    const gp = isGate(tx, ty + 1) || isGate(tx, ty - 1);
    const ph = gp ? 58 : 46;
    E.shadow(g, cx + 3, by + 1, 9, 3.5, .28);
    const gr = g.createLinearGradient(cx - 6, 0, cx + 6, 0); gr.addColorStop(0, '#a8723f'); gr.addColorStop(.6, '#7a4d27'); gr.addColorStop(1, '#4e3017');
    g.fillStyle = gr; g.fillRect(cx - 6, by - ph, 12, ph);
    g.fillStyle = '#c99660'; g.beginPath(); g.ellipse(cx, by - ph, 6.5, 3, 0, 0, TAU); g.fill();
    if (gp) { g.fillStyle = '#d9b37a'; g.fillRect(cx - 8, by - ph - 2, 16, 4); }
  }
  function drawDecor(g, d) {
    const im = IMGS.props[d.k]; if (!im) return;
    const w = im.width * d.s, h = im.height * d.s;
    E.shadow(g, (d.tx + d.tw / 2) * TS, (d.ty + 1) * TS - 4, w * .42, 5, .22);
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
    if (v.x1 >= AREA.x0 - 2 && v.y1 >= AREA.y0 - 2) {
      for (let y = AREA.y0; y <= AREA.y1; y++) for (let x = AREA.x0; x <= AREA.x1; x++) {
        if (isFence(x, y) && vis(x, y)) out.push({ y: (y + 1) * TS - 5, d: () => drawFence(g, x, y) });
      }
      for (const d of DECOR) if (vis(d.tx, d.ty)) out.push({ y: (d.ty + 1) * TS - 4, d: () => drawDecor(g, d) });
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
    AREA, IN, GATE, DECOR, IMGS, KINDS, inArea, inIn, isGate, isFence,
    load, bind, markSolid, drawGround, spawn, update, at, collect, drawMounted,
    mount, dismount, isRiding, resetMorning, cows, pigs, dog, freeSpot, add,
    get horse() { return horse; },
    get list() { return list; },
  };
})();
