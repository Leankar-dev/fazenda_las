'use strict';
/* ============================================================
   pesca.js  -  pesca no lago: peixes, lançamento, equipamentos da loja, comer/vender peixe
   Sprites: assets/pesca/*.png (recortados de docs/equipamentos_pescca.jpeg por tools/make-fishing-sprites.py). Todos os peixes olham para a ESQUERDA.

   Este módulo tem a LÓGICA (sem DOM, sem localStorage), para ser testada em Node (tests/pesca.test.js). O game.js só liga: teclas, loja, desenho do mundo, HUD.
     • FISH ........ as 4 espécies (nome, preço de venda, energia ao comer, raridade, tamanho na tela, chance de se soltar)
     • GEAR ........ o catálogo da loja (varas, carretéis, iscas, iscas artificiais, acessórios) + `fx(S)`: o que o equipamento comprado FAZ
     • createLake .. os peixes nadando no lago (de verdade: cada um é uma entidade; a pesca pega um peixe que está perto da boia)
     • Line ........ a máquina de estados do lançamento: voar → esperar (o peixe nada até a isca) → fisgar (janela de tempo) → recolher
     • defaults/sanitize ... campos novos do save (peixes, acessórios, iscas) com defaults e regras para save hostil
   O estado vive em S: S.fish {espécie: n} · S.gear {acessório: 0|1} · S.bait {cera, viva} · S.up.rod / S.up.reel (0-2) · S.stat.fish
   ============================================================ */
const Pesca = (() => {
  const TS = 64;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- espécies ----------------
     sell = preço de venda · energy = energia ao COMER · w = peso de raridade · len = comprimento na tela (px) · brk = chance de se soltar ao recolher (0..1)
     Preços calibrados para a pesca ser um complemento da horta (o lago comporta poucos peixes por dia), não um atalho. */
  const FISH = {
    perca:   { name: 'Perca-sol', sell: 10, energy: 12, w: 38, len: 44, brk: 0 },
    crappie: { name: 'Crappie',   sell: 16, energy: 16, w: 30, len: 50, brk: .05 },
    bagre:   { name: 'Bagre',     sell: 26, energy: 24, w: 20, len: 62, brk: .2 },
    achiga:  { name: 'Achigã',    sell: 42, energy: 32, w: 12, len: 66, brk: .3 },
  };
  const FISH_KEYS = Object.keys(FISH);
  const LAKE_TARGET = 10;            // peixes no lago ao amanhecer (e o máximo)
  const LAKE_TRICKLE = 60;           // s: a cada tanto nasce mais um peixe, se faltar (pescar demais se recupera durante o dia)
  const REACH = 3.2 * TS;            // px: peixes mais longe que isto da boia nem notam a isca
  const BASE_CAPACITY = 8;           // peixes que cabem no cesto de pesca sem acessórios

  /* ---------------- catálogo da loja ----------------
     kind: 'level' (vara/carretel: nível em S.up[key], precisa do anterior) · 'once' (acessório: S.gear[id], compra única) · 'bait' (consumível: S.bait[id], vem em pacote) */
  const GEAR = [
    { id: 'rod1', kind: 'level', key: 'rod', lvl: 1, group: 'Varas e carretéis', img: 'vara_spinning', name: 'Vara spinning', cost: 150, info: 'Permite pescar no lago. Selecione a vara (7) de frente para a água.' },
    { id: 'rod2', kind: 'level', key: 'rod', lvl: 2, group: 'Varas e carretéis', img: 'vara_fly', name: 'Vara de fly', cost: 450, info: 'Os peixes chegam à isca 30% mais rápido.' },
    { id: 'reel1', kind: 'level', key: 'reel', lvl: 1, group: 'Varas e carretéis', img: 'carretel_fechado', name: 'Carretel fechado', cost: 220, info: '+0,6 s para fisgar quando o peixe morde; peixe grande se solta menos.' },
    { id: 'reel2', kind: 'level', key: 'reel', lvl: 2, group: 'Varas e carretéis', img: 'carretel_baitcast', name: 'Carretel baitcast', cost: 520, info: '+1,2 s para fisgar; peixe grande se solta bem menos.' },
    { id: 'cera', kind: 'bait', pack: 5, group: 'Iscas (gastam 1 por lançamento)', img: 'isca_cera', name: 'Isca de cera ×5', cost: 20, info: 'Os peixes chegam 25% mais rápido.' },
    { id: 'viva', kind: 'bait', pack: 5, group: 'Iscas (gastam 1 por lançamento)', img: 'isca_viva', name: 'Isca viva ×5', cost: 45, info: 'Chegam 45% mais rápido e os peixes raros se interessam mais.' },
    { id: 'minhoca', kind: 'once', group: 'Iscas artificiais (uma compra, usa sempre)', img: 'minhoca', name: 'Minhoca de borracha', cost: 80, info: 'Atrai mais a perca-sol.' },
    { id: 'minnow', kind: 'once', group: 'Iscas artificiais (uma compra, usa sempre)', img: 'minnow', name: 'Isca minnow', cost: 110, info: 'Atrai mais o crappie.' },
    { id: 'colher', kind: 'once', group: 'Iscas artificiais (uma compra, usa sempre)', img: 'colher', name: 'Isca colher', cost: 90, info: 'Atrai mais o bagre.' },
    { id: 'popper', kind: 'once', group: 'Iscas artificiais (uma compra, usa sempre)', img: 'popper', name: 'Popper de superfície', cost: 190, info: 'Atrai bem mais o achigã (o peixe mais valioso).' },
    { id: 'chumbo', kind: 'once', group: 'Acessórios', img: 'chumbo', name: 'Chumbada', cost: 60, info: 'A isca afunda rápido: os peixes chegam 10% mais cedo.' },
    { id: 'linha', kind: 'once', group: 'Acessórios', img: 'linha', name: 'Linha de monofilamento', cost: 70, info: 'Linha forte: peixe grande se solta menos (−10 pontos).' },
    { id: 'puca', kind: 'once', group: 'Acessórios', img: 'puca', name: 'Puçá', cost: 160, info: 'Ajuda a recolher o peixe: ele se solta menos (−10 pontos).' },
    { id: 'oculos', kind: 'once', group: 'Acessórios', img: 'oculos', name: 'Óculos polarizados', cost: 120, info: 'Tira o reflexo: você enxerga os peixes na água com as cores.' },
    { id: 'chapeu', kind: 'once', group: 'Acessórios', img: 'chapeu', name: 'Chapéu de pescador', cost: 80, info: 'Pescar gasta metade da energia.' },
    { id: 'colete', kind: 'once', group: 'Acessórios', img: 'colete', name: 'Colete de pesca', cost: 240, info: '25% de chance de a isca não ser gasta.' },
    { id: 'caixa', kind: 'once', group: 'Acessórios', img: 'caixa_pesca', name: 'Caixa de pesca', cost: 130, info: 'Carrega até 40 iscas de cada tipo (em vez de 15).' },
    { id: 'cordao', kind: 'once', group: 'Acessórios', img: 'cordao', name: 'Cordão de peixes', cost: 45, info: '+6 peixes no cesto de pesca.' },
    { id: 'rede', kind: 'once', group: 'Acessórios', img: 'rede_captura', name: 'Rede de captura', cost: 260, info: '+16 peixes no cesto de pesca.' },
    { id: 'balanca', kind: 'once', group: 'Acessórios', img: 'balanca', name: 'Balança de pesca', cost: 140, info: '+20% no preço de venda dos peixes.' },
    { id: 'multi', kind: 'once', group: 'Acessórios', img: 'multiferramenta', name: 'Multiferramenta', cost: 110, info: 'Limpa o peixe na hora: ele dá +25% de energia ao comer.' },
  ];
  const GEAR_BY = Object.fromEntries(GEAR.map(g => [g.id, g]));
  const ONCE_KEYS = GEAR.filter(g => g.kind === 'once').map(g => g.id);
  const BAIT_KEYS = GEAR.filter(g => g.kind === 'bait').map(g => g.id);
  const ROD_MAX = 2, REEL_MAX = 2;
  // todos os sprites usados (o jogo carrega por aqui; tests/build.test.js confere que a pasta assets/pesca tem EXATAMENTE isto)
  const SPRITES = [...new Set([...GEAR.map(g => g.img), 'boia', 'doca', 'estaca', 'margem', ...FISH_KEYS])];
  const spriteUrl = n => 'assets/pesca/' + n + '.png';

  /* ---------------- estado do save ---------------- */
  const zero = keys => Object.fromEntries(keys.map(k => [k, 0]));
  const defaults = () => ({ fish: zero(FISH_KEYS), gear: zero(ONCE_KEYS), bait: zero(BAIT_KEYS) });
  /* regras para save de terceiros/danificado: tudo vira inteiro limitado (nada de 1e9 peixes), chaves desconhecidas somem. `kit` = SaveManager.kit() */
  function sanitize(st, kit) {
    const d = defaults();
    st.fish = kit.objOf(st.fish, FISH_KEYS, d.fish); for (const k of FISH_KEYS) kit.Pint(st.fish, k, 0, 999, 0);
    st.gear = kit.objOf(st.gear, ONCE_KEYS, d.gear); for (const k of ONCE_KEYS) kit.Pint(st.gear, k, 0, 1, 0);
    st.bait = kit.objOf(st.bait, BAIT_KEYS, d.bait); for (const k of BAIT_KEYS) kit.Pint(st.bait, k, 0, 99, 0);
    if (!kit.isObj(st.up)) st.up = {};
    kit.Pint(st.up, 'rod', 0, ROD_MAX, 0); kit.Pint(st.up, 'reel', 0, REEL_MAX, 0);
    if (!kit.isObj(st.stat)) st.stat = {};
    kit.Pint(st.stat, 'fish', 0, 1e9, 0);
  }

  /* ---------------- o que o equipamento comprado FAZ ---------------- */
  function bestBait(S) { return BAIT_KEYS.slice().reverse().find(k => (S.bait[k] | 0) > 0) || null; }      // a melhor isca que tem: viva antes de cera
  function fx(S) {
    const g = S.gear || {}, rod = clamp(S.up.rod | 0, 0, ROD_MAX), reel = clamp(S.up.reel | 0, 0, REEL_MAX);
    const baitKey = bestBait(S);
    return {
      canFish: rod >= 1,
      rod, reel,
      waitMul: [1, 1, .7][rod] * (g.chumbo ? .9 : 1) * (baitKey === 'viva' ? .55 : baitKey === 'cera' ? .75 : 1),      // < 1 = o peixe chega mais depressa
      window: 1 + [0, .6, 1.2][reel],                                                                                   // s para fisgar depois da mordida
      breakAdj: [0, .05, .12][reel] + (g.linha ? .1 : 0) + (g.puca ? .1 : 0),                                          // reduz a chance de se soltar
      capacity: BASE_CAPACITY + (g.cordao ? 6 : 0) + (g.rede ? 16 : 0),
      sellMul: g.balanca ? 1.2 : 1,
      energyMul: g.chapeu ? .5 : 1,
      eatMul: g.multi ? 1.25 : 1,
      seeFish: !!g.oculos,
      baitSave: g.colete ? .25 : 0,
      baitCap: g.caixa ? 40 : 15,
      bait: baitKey,
      lure: { perca: g.minhoca ? 1.8 : 1, crappie: g.minnow ? 1.8 : 1, bagre: g.colher ? 1.8 : 1, achiga: g.popper ? 2.4 : 1 },
      rare: baitKey === 'viva' ? 1.4 : 1,
    };
  }
  const fishCount = S => FISH_KEYS.reduce((a, k) => a + (S.fish[k] | 0), 0);
  const fishFree = S => Math.max(0, fx(S).capacity - fishCount(S));
  const sellPrice = (S, sp) => Math.round(FISH[sp].sell * fx(S).sellMul);
  const fishValue = S => FISH_KEYS.reduce((a, k) => a + (S.fish[k] | 0) * sellPrice(S, k), 0);
  const eatGain = (S, sp) => Math.round(FISH[sp].energy * fx(S).eatMul);
  const breakChance = (S, sp) => clamp(FISH[sp].brk - fx(S).breakAdj, 0, 1);
  // quanto o jogador pode comprar/ter: devolve { ok, why } (why = mensagem curta para o aviso)
  function canBuy(S, id) {
    const g = GEAR_BY[id]; if (!g) return { ok: false, why: 'item desconhecido' };
    if (g.kind === 'level') {
      const have = S.up[g.key] | 0;
      if (have >= g.lvl) return { ok: false, why: 'já comprado' };
      if (have < g.lvl - 1) return { ok: false, why: 'compre a ' + GEAR.find(x => x.key === g.key && x.lvl === g.lvl - 1).name.toLowerCase() + ' antes' };
    } else if (g.kind === 'once') { if (S.gear[id]) return { ok: false, why: 'já comprado' }; }
    else if ((S.bait[id] | 0) >= fx(S).baitCap) return { ok: false, why: 'sua caixa de iscas está cheia' };
    if (S.gold < g.cost) return { ok: false, why: 'ouro insuficiente' };
    return { ok: true };
  }
  function buy(S, id) {          // aplica a compra (o game.js cuida de som, aviso e salvar)
    const c = canBuy(S, id); if (!c.ok) return c;
    const g = GEAR_BY[id]; S.gold -= g.cost;
    if (g.kind === 'level') S.up[g.key] = g.lvl; else if (g.kind === 'once') S.gear[id] = 1; else S.bait[id] = Math.min(fx(S).baitCap, (S.bait[id] | 0) + g.pack);
    return { ok: true };
  }

  /* ---------------- o lago: peixes de verdade ----------------
     env = { inWater(x, y) → bool (ponto bem dentro da água), rnd() → [0,1), bounds: { x0, y0, x1, y1 } (px) }. Cada peixe: { sp, x, y, ang, v, turn, ph, mode, flip } */
  function createLake(env) {
    const fish = [];
    const rnd = () => env.rnd();
    function spawnPoint() {
      const b = env.bounds;
      for (let i = 0; i < 80; i++) { const x = b.x0 + rnd() * (b.x1 - b.x0), y = b.y0 + rnd() * (b.y1 - b.y0); if (env.inWater(x, y)) return [x, y]; }
      return null;
    }
    function pickSpecies() { let r = rnd() * FISH_KEYS.reduce((a, k) => a + FISH[k].w, 0); for (const k of FISH_KEYS) { r -= FISH[k].w; if (r <= 0) return k; } return FISH_KEYS[0]; }
    function add(sp) {
      const p = spawnPoint(); if (!p) return null;
      const f = { sp: sp || pickSpecies(), x: p[0], y: p[1], ang: rnd() * Math.PI * 2, v: 12 + rnd() * 14, turn: rnd() * 2, ph: rnd() * 6.28, mode: 'wander', flip: true, tx: 0, ty: 0 };
      f.flip = Math.cos(f.ang) > 0; fish.push(f); return f;
    }
    const lake = {
      fish, add,
      restock(n = LAKE_TARGET) { while (fish.length < n) if (!add()) break; },
      trickleT: 0,
      update(dt, activity = 1) {
        lake.trickleT += dt; if (lake.trickleT >= LAKE_TRICKLE) { lake.trickleT = 0; if (fish.length < LAKE_TARGET) add(); }
        for (const f of fish) {
          f.ph += dt * (3 + f.v * .1);
          if (f.mode === 'hooked') continue;
          let v = f.v * activity;
          if (f.mode === 'attract') {
            const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
            if (d < 6) { f.arrived = true; continue; }
            f.ang = Math.atan2(dy, dx); v = f.att;                                      // nada reto até a isca
          } else if (f.mode === 'flee') { v = 70; f.fleeT -= dt; if (f.fleeT <= 0) f.mode = 'wander'; }
          else { f.turn -= dt; if (f.turn <= 0) { f.ang += (rnd() - .5) * 1.7; f.turn = .8 + rnd() * 2.2; } }
          const nx = f.x + Math.cos(f.ang) * v * dt, ny = f.y + Math.sin(f.ang) * v * dt;
          if (env.inWater(nx, ny)) { f.x = nx; f.y = ny; } else { f.ang += Math.PI * (.6 + rnd() * .8); f.turn = .6; }
          f.flip = Math.cos(f.ang) > 0;
        }
      },
      remove(f) { const i = fish.indexOf(f); if (i >= 0) fish.splice(i, 1); },
      near(x, y, r) { return fish.filter(f => f.mode === 'wander' && Math.hypot(f.x - x, f.y - y) <= r); },
    };
    return lake;
  }

  /* ---------------- o lançamento ----------------
     fases: 'fly' (a linha voa) → 'wait' (o peixe nada até a isca) → 'bite' (a boia afunda: JANELA para fisgar) → 'fight' (recolhendo) → fim
     update(c, dt, ctx) devolve uma lista de eventos: 'splash' · 'bite' · 'nothing' (nenhum peixe veio) · 'escaped' (perdeu a janela) · 'lost' (se soltou) · 'caught' (c.fish é o peixe)
     press(c) devolve 'hook' (fisgou) · 'cancel' (recolheu antes da hora) · null.  ctx = { S, lake, rnd, activity } */
  const FLY_T = .5, FIGHT_T = .75, WAIT_MAX = 10, MIN_WAIT = 1;
  function startCast(S, lake, bx, by, rnd, activity = 1) {
    const f = fx(S); if (!f.canFish) return { error: 'Compre uma vara no empório (aba Pesca)' };
    if (fishFree(S) <= 0) return { error: 'Cesto de pesca cheio — venda os peixes na caixa de vendas ou coma um' };
    const cands = lake.near(bx, by, REACH);
    // isca: gasta 1 (o colete às vezes poupa)
    let baitUsed = null;
    if (f.bait) { baitUsed = f.bait; if (rnd() >= f.baitSave) S.bait[f.bait] = Math.max(0, (S.bait[f.bait] | 0) - 1); }
    let fish = null;
    if (cands.length) {                                    // quem se interessa: peso da espécie × isca artificial × isca viva (só os raros)
      const wts = cands.map(c => FISH[c.sp].w * f.lure[c.sp] * (c.sp === 'bagre' || c.sp === 'achiga' ? f.rare : 1));
      let r = rnd() * wts.reduce((a, b) => a + b, 0); fish = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) { r -= wts[i]; if (r <= 0) { fish = cands[i]; break; } }
      fish.mode = 'attract'; fish.tx = bx; fish.ty = by; fish.arrived = false; fish.att = clamp(62 * activity / f.waitMul, 30, 160);
    }
    return { phase: 'fly', t: 0, bx, by, fish, fx: f, baitUsed, window: f.window, dip: 0 };
  }
  function releaseFish(c, mode = 'wander') { if (c.fish) { c.fish.mode = mode; c.fish.fleeT = 1.6; c.fish.arrived = false; if (mode === 'flee') c.fish.ang += Math.PI; } }
  function update(c, dt, ctx) {
    const ev = []; c.t += dt;
    if (c.phase === 'fly') { if (c.t >= FLY_T) { c.phase = 'wait'; c.t = 0; ev.push('splash'); } }
    else if (c.phase === 'wait') {
      if (!c.fish) { if (c.t >= 5) { c.phase = 'done'; ev.push('nothing'); } }
      else if (c.fish.arrived && c.t >= MIN_WAIT) { c.phase = 'bite'; c.t = 0; c.fish.mode = 'hooked'; ev.push('bite'); }
      else if (c.t >= WAIT_MAX) { releaseFish(c); c.phase = 'done'; ev.push('nothing'); }
    } else if (c.phase === 'bite') {
      c.dip = Math.min(1, c.dip + dt * 6);
      if (c.t >= c.window) { releaseFish(c, 'flee'); c.phase = 'done'; ev.push('escaped'); }
    } else if (c.phase === 'fight') {
      if (c.t >= FIGHT_T) {
        c.phase = 'done';
        if (ctx.rnd() < breakChance(ctx.S, c.fish.sp)) { releaseFish(c, 'flee'); ev.push('lost'); }
        else { ctx.lake.remove(c.fish); ev.push('caught'); }
      }
    }
    return ev;
  }
  function press(c) {
    if (c.phase === 'bite') { c.phase = 'fight'; c.t = 0; return 'hook'; }
    if (c.phase === 'wait') { releaseFish(c); c.phase = 'done'; return 'cancel'; }
    return null;
  }
  function cancel(c) { if (c && c.phase !== 'done') { releaseFish(c); c.phase = 'done'; } }
  // a pesca rende mais ao amanhecer/entardecer e na chuva (os peixes se agitam)
  function activity(S) { const h = S.min / 60; return (h < 8.5 || (h >= 16.5 && h < 19.5) ? 1.25 : 1) * (S.rain ? 1.25 : 1); }

  /* ---------------- desenho (g = CanvasRenderingContext2D; imgs = { nome: Image }) ---------------- */
  const tints = {};
  function makeTints(imgs) {          // versão "debaixo d'água": escurecida e azulada (sem óculos polarizados os peixes aparecem assim)
    for (const k of FISH_KEYS) {
      const im = imgs[k]; if (!im || !im.width) continue;
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d');
      x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(18,70,110,.62)'; x.fillRect(0, 0, c.width, c.height); tints[k] = c;
    }
  }
  function drawFish(g, lake, imgs, see) {
    for (const f of lake.fish) {
      const sp = FISH[f.sp], im = see || !tints[f.sp] ? imgs[f.sp] : tints[f.sp]; if (!im || !im.width) continue;
      const w = sp.len, h = w * im.height / im.width, wig = Math.sin(f.ph * 2) * .12;
      g.save(); g.translate(f.x, f.y); if (f.flip) g.scale(-1, 1); g.rotate(wig); g.globalAlpha = see ? .95 : .62;
      g.drawImage(im, -w / 2, -h / 2, w, h); g.restore();
    }
  }
  // a vara na mão, a linha e a boia. hand = [x, y] da mão; c = lançamento ativo. Devolve a posição da boia desenhada.
  function drawLine(g, c, hand, imgs, time) {
    const rod = imgs[c.fx.rod >= 2 ? 'vara_fly' : 'vara_spinning'], bob = imgs.boia; if (!rod || !bob || !rod.width) return null;
    const sc = 74 / rod.width, rw = rod.width * sc, rh = rod.height * sc, len = Math.hypot(rw, rh);
    const axis = -Math.atan2(rh, rw);                                   // ângulo da vara NA IMAGEM: cabo embaixo à esquerda → ponta em cima à direita
    let bx = c.bx, by = c.by + (c.phase === 'wait' ? Math.sin(time * 3) * 1.2 : 0) + (c.phase === 'bite' ? 3 * c.dip + Math.sin(time * 30) * 1.5 : 0);
    if (c.phase === 'fly') { const u = Math.min(1, c.t / FLY_T), e = u * u * (3 - 2 * u); bx = hand[0] + (c.bx - hand[0]) * e; by = hand[1] + (c.by - hand[1]) * e - Math.sin(u * Math.PI) * 34; }
    const aim = Math.atan2(by - hand[1], bx - hand[0]) - .35 + (c.phase === 'fight' ? Math.sin(time * 40) * .08 : 0);      // a vara aponta para a boia, um pouco levantada
    g.save(); g.translate(hand[0], hand[1]); g.rotate(aim - axis); g.drawImage(rod, 0, -rh, rw, rh); g.restore();
    const tip = [hand[0] + Math.cos(aim) * len, hand[1] + Math.sin(aim) * len];                                       // de onde a linha sai
    g.save(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tip[0], tip[1]);
    g.quadraticCurveTo((tip[0] + bx) / 2, (tip[1] + by) / 2 + (c.phase === 'fight' ? 4 : 12), bx, by); g.stroke(); g.restore();
    const bw = 17, bh = bw * bob.height / bob.width;
    if (c.phase !== 'fly' || c.t > FLY_T * .6) g.drawImage(bob, bx - bw / 2, by - bh * .78, bw, bh);
    if (c.phase === 'bite' || c.phase === 'fight') {                    // marolas na água
      const r = (time * 2.2) % 1; g.save(); g.strokeStyle = `rgba(255,255,255,${.6 * (1 - r)})`; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(bx, by + 2, 6 + r * 22, 2.5 + r * 9, 0, 0, 7); g.stroke(); g.restore();
    }
    return [bx, by];
  }

  return { TS, FISH, FISH_KEYS, GEAR, GEAR_BY, ONCE_KEYS, BAIT_KEYS, ROD_MAX, REEL_MAX, SPRITES, spriteUrl, LAKE_TARGET, REACH, BASE_CAPACITY, FLY_T, FIGHT_T,
    defaults, sanitize, fx, bestBait, fishCount, fishFree, sellPrice, fishValue, eatGain, breakChance, canBuy, buy,
    createLake, startCast, update, press, cancel, releaseFish, activity, makeTints, drawFish, drawLine };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Pesca;      // testes em Node: require('../pesca.js')
