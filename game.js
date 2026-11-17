'use strict';
/* ============================================================
   FAZENDA LAS  -  HTML5 Canvas + JavaScript puro
   Assets: recortados das folhas "Game Asset Sheet" de Elias e Karen
   (assets/fazendeiro, assets/fazendeira, assets/tile_*.png)
   + arte procedural em art.js
   ============================================================ */
(() => {
  const TS = 64, MW = 46, MH = 34;
  const SAVE_KEY = 'fazenda_leankar_v1';
  (function migrateLegacyKeys() {      // jogo renomeado: fazenda_elias_* -> fazenda_leankar_* (move uma única vez)
    try {
      for (const [oldK, newK] of [['fazenda_elias_v1', SAVE_KEY], ['fazenda_elias_cfg', 'fazenda_leankar_cfg']]) {
        const old = localStorage.getItem(oldK); if (old === null) continue;
        if (localStorage.getItem(newK) === null) localStorage.setItem(newK, old);
        localStorage.removeItem(oldK);
      }
    } catch (e) { /* storage indisponível */ }
  })();
  const DAY_START = 6 * 60, DAY_END = 24 * 60;
  const MIN_PER_SEC = 4;                    // 1 dia = 270 s
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const DX = [0, 0, -1, 1], DY = [1, 0 - 1, 0, 0];   // 0 baixo, 1 cima, 2 esq, 3 dir
  const idx = (x, y) => y * MW + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;

  /* ---------------- personagens ---------------- */
  const CHARACTERS = {
    fazendeiro: { id: 'fazendeiro', name: 'Elias', role: 'O Fazendeiro', desc: 'Colete de couro, camisa xadrez azul e muita vontade de plantar.', folder: 'assets/fazendeiro' },
    fazendeira: { id: 'fazendeira', name: 'Karen', role: 'A Fazendeira', desc: 'Camisa xadrez vermelha, cinto de ferramentas e mão boa para a terra.', folder: 'assets/fazendeira' },
  };
  const CHAR_IDS = Object.keys(CHARACTERS);
  for (const id of CHAR_IDS) CHARACTERS[id].defName = CHARACTERS[id].name;     // nome padrão (o jogador pode trocar)
  const NAME_MAX = 16;
  // limpa o nome digitado: sem < > & " (vai parar em innerHTML), espaços normalizados, até 16 letras; vazio = nome padrão
  const cleanName = (v, def) => (String(v == null ? '' : v).replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim()) || def;
  function applyNames(names) { for (const id of CHAR_IDS) CHARACTERS[id].name = cleanName(names && names[id], CHARACTERS[id].defName); }
  let CHAR = CHARACTERS.fazendeiro;
  const charSrc = n => CHAR.folder + '/' + n + '.png';
  const SPRITE_LIST = ['back', 'back34r', 'basket', 'belt', 'bottomup', 'front_stand', 'front_walk', 'glove1', 'glove2', 'left34', 'left_stand', 'pickaxe', 'pitchfork', 'seedbag_empty', 'seedbag_stack', 'topdown'];
  const TILE_LIST = ['tile_bare', 'tile_muddy', 'tile_loose', 'tile_grassA', 'tile_grassB', 'tile_grassC', 'tile_grassD', 'tile_wood'];
  const CHAR_IMGS = {};

  /* ---------------- dados ---------------- */
  const CROPS = {
    cenoura: { name: 'Cenoura', seed: 10, sell: 32, days: 2 },
    tomate:  { name: 'Tomate',  seed: 24, sell: 70, days: 3 },
    milho:   { name: 'Milho',   seed: 40, sell: 118, days: 4 },
    abobora: { name: 'Abóbora', seed: 70, sell: 215, days: 5 },
  };
  const CROP_KEYS = Object.keys(CROPS);
  // árvores frutíferas: a mesma chave guarda a muda (S.seeds) e a fruta colhida (S.harvest)
  const TREE_SP = {
    maca:    { name: 'Macieira',    fruit: 'Maçã',    cost: 120, sell: 30 },
    laranja: { name: 'Laranjeira',  fruit: 'Laranja', cost: 150, sell: 36 },
    pessego: { name: 'Pessegueiro', fruit: 'Pêssego', cost: 180, sell: 44 },
    limao:   { name: 'Limoeiro',    fruit: 'Limão',   cost: 140, sell: 28 },
  };
  const TREE_KEYS = Object.keys(TREE_SP);
  const PROD_KEYS = CROP_KEYS.concat(TREE_KEYS);        // tudo que vira semente/muda e colheita
  const TREE_ADULT = 4, TREE_REGROW = 3;                // dias até dar frutas / entre colheitas
  const FRUIT_COLORS = { maca: ['#ff7a6a', '#c4201a'], laranja: ['#ffc04a', '#e8730a'], pessego: ['#ffc7a6', '#ee7d55'], limao: ['#fff27a', '#dcb400'] };
  const prodName = k => CROPS[k] ? CROPS[k].name : TREE_SP[k].fruit;
  const prodSell = k => CROPS[k] ? CROPS[k].sell : TREE_SP[k].sell;
  const seedName = k => CROPS[k] ? 'sementes de ' + CROPS[k].name.toLowerCase() : 'muda de ' + TREE_SP[k].name.toLowerCase();
  const isTreeKey = k => !!TREE_SP[k];
  const treeStage = o => o.age < 2 ? 0 : o.age < TREE_ADULT ? 1 : 2;
  const TOOLS = [
    { id: 'forcado',  name: 'Forcado — arar a terra e arrancar mato',      img: 'pitchfork' },
    { id: 'regador',  name: 'Regador — regar e encher no poço/lagoa',      img: null },
    { id: 'sementes', name: 'Sementes — plantar (Q troca a semente)',      img: 'seedbag_empty' },
    { id: 'luvas',    name: 'Luvas — colher plantas e frutas, ordenhar vacas',           img: 'glove2' },
    { id: 'picareta', name: 'Picareta — quebrar pedras e tocos',           img: 'pickaxe' },
    { id: 'machado',  name: 'Machado — cortar árvores (rende madeira)',    img: null },
  ];
  const BASKET_CAP = [20, 40, 80], BASKET_COST = [0, 150, 400];
  const CAN_CAP = [15, 30, 50], CAN_COST = [0, 120, 350];
  const BOOTS = [1, 1.18, 1.36], BOOTS_COST = [0, 220, 520];
  const EGG_PRICE = 28, STONE_PRICE = 9, WOOD_PRICE = 10, MILK_PRICE = 42, TRUFFLE_PRICE = 80, MEAT_PRICE = 30;
  const SLEEP_FROM = 18 * 60;                           // só dá para dormir a partir das 18:00
  const MAX_BUSH = 70;                                  // limite de mato no mapa (nasce mato novo toda noite)
  const SAVE_VERSION = 1;
  const N_CHICKENS = 6;                                  // galinhas no galinheiro (botam ovos 2× por dia)
  const ANIMAL_SHOP = {
    vaca:   { name: 'Vaca',   cost: 260, max: 4, img: 'assets/animais/vaca/front34.png',   info: 'Dá leite todo dia (vende 42 ◎). Ordenhe com E.' },
    porco:  { name: 'Porco',  cost: 180, max: 4, img: 'assets/animais/porco/front34.png',  info: 'Dá carne 2× por dia (vende 30 ◎) e acha trufas (80 ◎). Pegue com E.' },
    cavalo: { name: 'Cavalo', cost: 650, max: 2, img: 'assets/animais/cavalo/front34.png', info: 'Monte com E e cavalgue quase 2× mais rápido.' },
  };
  const GOALS = [
    { at: 400,   reward: { seeds: { tomate: 6 } },  text: 'Sementes de tomate liberadas! (+6)' },
    { at: 1500,  reward: { seeds: { milho: 6 } },   text: 'Sementes de milho liberadas! (+6)' },
    { at: 4000,  reward: { seeds: { abobora: 6 } }, text: 'Sementes de abóbora liberadas! (+6)' },
    { at: 10000, reward: { gold: 500 },             text: 'Fazenda dos Sonhos! +500 ◎' },
  ];

  /* ---------------- layout do mapa ---------------- */
  const BARN  = { x: 5,  y: 0, w: 7, h: 5 };
  const STALL = { x: 14, y: 3, w: 3, h: 2 };
  const SIGN  = { x: 14, y: 6, w: 3, h: 1 };     // placa "FAZENDA LAS" na frente do empório (logo abaixo da trilha)
  const BIN   = { x: 18, y: 4, w: 2, h: 1 };
  const WELL  = { x: 21, y: 3, w: 2, h: 2 };
  const COOP  = { x: 26, y: 7, w: 2, h: 2 };
  const POND  = { cx: 38.5, cy: 9, rx: 6, ry: 4.4 };
  const PLOT  = { x0: 6, y0: 8, x1: 17, y1: 15 };
  const PATH_Y = 5, PATH_X0 = 5, PATH_X1 = 24;
  const SPAWN = { x: 8.5 * TS, y: 6.2 * TS };
  const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const isWater = (x, y) => {
    const dx = (x + .5 - POND.cx) / POND.rx, dy = (y + .5 - POND.cy) / POND.ry;
    return dx * dx + dy * dy < 1;
  };
  const isPath = (x, y) => y === PATH_Y && x >= PATH_X0 && x <= PATH_X1;

  /* ---------------- estado ---------------- */
  let S = null;
  let IMGS = {};
  const solid = new Uint8Array(MW * MH);
  const groundVar = new Uint8Array(MW * MH);
  const trees = [];
  const treeGrid = new Array(MW * MH).fill(null);
  let obs = [];
  const obsGrid = new Array(MW * MH).fill(null);
  let groundCanvas = null, tilledTile = null, wetTile = null;
  let canvas, g, W = 0, H = 0, zoom = 1, dpr = 1;
  const cam = { x: 0, y: 0 };
  const keys = {};
  let paused = true, running = false, modalOpen = false, sleeping = false, hudT = 0;
  let mouse = { x: 0, y: 0, on: false }, mouseMode = false;
  let act = null, cooldown = 0;
  let chickens = [], eggs = [];
  let parts = [];
  let rain = [];
  let time = 0, lastSave = 0, chirpT = 3;
  let stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  const hint = { text: '', x: 0, y: 0 };
  // animações / ambiente
  const tileFx = new Map();
  let butterflies = [], birds = [], flies = [], splashes = [], clouds = [], cloudSprites = null;
  let birdT = 14, leafT = 1, shakeT = 0, dispGold = 0, moodT = 0;
  const easeOutBack = u => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2);

  function newState() {
    return {
      v: 1, rev: 0, day: 1, min: DAY_START, gold: 100, earned: 0, energy: 100, water: 15,
      seeds: { cenoura: 8, tomate: 0, milho: 0, abobora: 0, maca: 0, laranja: 0, pessego: 0, limao: 0 },
      harvest: { cenoura: 0, tomate: 0, milho: 0, abobora: 0, maca: 0, laranja: 0, pessego: 0, limao: 0 },
      eggs: 0, stone: 0, wood: 0, milk: 0, truffle: 0, meat: 0, laid: 1,
      owned: { vaca: 0, porco: 0, cavalo: 0 }, milked: [], meatDone: [], digs: [], truffleList: [],
      up: { basket: 0, can: 0, boots: 0 },
      char: 'fazendeiro', selSeed: 'cenoura', tool: 0, dir: 0, px: SPAWN.x, py: SPAWN.y,
      rain: false, soil: new Array(MW * MH).fill(0), crops: {}, obs: [], eggList: [], names: {},
      obsInit: false, felled: [], goal: 0, stat: { till: 0, plant: 0, water: 0, harvest: 0, sold: 0, sleep: 0 }, won: false,
    };
  }

  /* ---------------- mundo ---------------- */
  function buildStatic() {
    solid.fill(0); trees.length = 0; treeGrid.fill(null);
    const felled = new Set((S.felled || []).map(f => f[0] + ',' + f[1]));
    const r = Art.mulberry32(1234);
    const mark = (rect) => { for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) solid[idx(x, y)] = 1; };
    [BARN, STALL, SIGN, BIN, WELL, COOP].forEach(mark);
    Animals.markSolid(solid, MW);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = idx(x, y);
      if (isWater(x, y)) { solid[i] = 1; continue; }
      if (solid[i]) continue;
      const border = x === 0 || x === MW - 1 || y === MH - 1 || y === 0;
      const nearPond = Math.hypot(x - POND.cx, (y - POND.cy) * 1.3) < POND.rx + 1.5;
      let forest = false;
      if (!border) {
        if (y === 1 && x > 12) forest = r() < .55;
        else if (y === 2 && x > 24) forest = r() < .5;
        else if (x <= 2 && y > 1) forest = r() < .45;
        else if (x >= MW - 3 && y > 1) forest = r() < .5;
        else if (y >= MH - 3) forest = r() < .5;
        else if (x >= 30 && y >= 15 && !nearPond) forest = r() < .22;
        else if (x >= 30 && y <= 3 && !nearPond) forest = r() < .4;
        if (nearPond && r() < .06 && !isPath(x, y) && !isWater(x, y) && Math.hypot(x - POND.cx, (y - POND.cy) * 1.3) > POND.rx + .6) forest = true;
      }
      if (Animals.inArea(x, y, 1)) forest = false;
      if (border || forest) {
        const tv = Math.floor(r() * 3);                       // (sempre sorteia, para o mapa não mudar)
        if (felled.has(x + ',' + y)) continue;                // árvore já cortada pelo jogador (inclui as da borda)
        solid[i] = 1; const tr = { x, y, v: tv, border, hp: 5 }; trees.push(tr); treeGrid[i] = tr;
      }
    }
    trees.sort((a, b) => a.y - b.y);
    // variação do chão
    const r2 = Art.mulberry32(99);
    for (let i = 0; i < MW * MH; i++) { const q = r2(); groundVar[i] = q < .5 ? 0 : q < .66 ? 1 : q < .82 ? 2 : q < .93 ? 3 : 4; }
  }

  function genObstacles() {
    const r = Art.mulberry32(777), list = [];
    for (let y = 6; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
      if (solid[idx(x, y)] || isPath(x, y)) continue;
      if (Math.hypot(x - POND.cx, (y - POND.cy) * 1.2) < POND.rx + 1.3) continue;
      if (x >= PLOT.x0 - 1 && x <= PLOT.x1 + 1 && y >= PLOT.y0 - 1 && y <= PLOT.y1 + 1) continue;
      if (x >= 5 && x <= 12 && y <= 7) continue;
      if (inRect({ x: COOP.x - 1, y: COOP.y - 1, w: 4, h: 5 }, x, y)) continue;
      if (Animals.inArea(x, y, 2)) continue;
      const q = r();
      if (q < .03) list.push(['rock', x, y, Math.floor(r() * 2), 3]);
      else if (q < .045) list.push(['stump', x, y, 0, 4]);
      else if (q < .056) list.push(['ftree', x, y, Math.floor(r() * 4), 6, 8, r() < .7 ? 1 : 0, 0]);   // árvore frutífera selvagem
      else if (q < .13) list.push(['bush', x, y, Math.floor(r() * 3), 1]);
    }
    return list;
  }

  function loadObs(list) {
    obs = []; obsGrid.fill(null);
    for (const o of list) addObs(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7]);
  }
  function addObs(type, x, y, v, hp, age, fruit, cd) {
    const o = { type, x, y, v, hp };
    if (type === 'ftree') { o.age = age || 0; o.fruit = fruit ? 1 : 0; o.cd = cd || 0; }     // v = espécie (índice em TREE_KEYS)
    obs.push(o); obsGrid[idx(x, y)] = o; return o;
  }
  function removeObs(o) {
    obs.splice(obs.indexOf(o), 1); obsGrid[idx(o.x, o.y)] = null;
  }
  const obsAt = (x, y) => inb(x, y) ? obsGrid[idx(x, y)] : null;
  const blocked = (x, y) => !inb(x, y) || solid[idx(x, y)] || obsGrid[idx(x, y)] !== null;

  function buildGround() {
    const r = Art.mulberry32(4242);
    const names = ['tile_grassC', 'tile_grassA', 'tile_grassD', 'tile_grassB', 'tile_grassC'];
    groundCanvas = Art.mk(MW * TS, MH * TS, c => {
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const img = IMGS[names[groundVar[idx(x, y)]]];
        c.save(); c.translate(x * TS + TS / 2, y * TS + TS / 2);
        c.rotate(Math.floor(r() * 4) * Math.PI / 2);
        c.drawImage(img, -TS / 2 - .5, -TS / 2 - .5, TS + 1, TS + 1);
        c.restore();
      }
      // 2ª camada: tiles com borda esfumada sobre as emendas (some com a grade)
      const feather = Art.mk(TS + 40, TS + 40, f => {
        const m = f.createRadialGradient((TS + 40) / 2, (TS + 40) / 2, 8, (TS + 40) / 2, (TS + 40) / 2, (TS + 40) / 2);
        m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.62, 'rgba(0,0,0,.8)'); m.addColorStop(1, 'rgba(0,0,0,0)');
        f.fillStyle = m; f.fillRect(0, 0, TS + 40, TS + 40);
      });
      const tmp = Art.mk(TS + 40, TS + 40, () => { });
      const tg = tmp.getContext('2d');
      for (let y = 0; y <= MH; y++) for (let x = 0; x <= MW; x++) {
        tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, TS + 40, TS + 40);
        const im = IMGS[names[Math.floor(r() * 5)]];
        tg.save(); tg.translate((TS + 40) / 2, (TS + 40) / 2); tg.rotate(Math.floor(r() * 4) * Math.PI / 2);
        tg.drawImage(im, -(TS + 40) / 2, -(TS + 40) / 2, TS + 40, TS + 40); tg.restore();
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(feather, 0, 0);
        c.globalAlpha = .85; c.drawImage(tmp, x * TS - 20, y * TS - 20); c.globalAlpha = 1;
      }
      // terra batida (lagoa)
      c.save();
      c.beginPath(); c.ellipse(POND.cx * TS, POND.cy * TS, (POND.rx + .5) * TS, (POND.ry + .5) * TS, 0, 0, Math.PI * 2); c.clip();
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        if (Math.abs(x + .5 - POND.cx) > POND.rx + 1 || Math.abs(y + .5 - POND.cy) > POND.ry + 1) continue;
        c.drawImage(IMGS['tile_muddy'], x * TS, y * TS, TS + 1, TS + 1);
      }
      c.restore();
      // canteiro inicial de terra nua: miolo sem rotação + borda esfumada
      for (let y = PLOT.y0 + 1; y < PLOT.y1; y++) for (let x = PLOT.x0 + 1; x < PLOT.x1; x++) {
        c.drawImage(IMGS['tile_bare'], x * TS, y * TS, TS + 1, TS + 1);
      }
      const px0 = PLOT.x0 * TS, py0 = PLOT.y0 * TS, px1 = (PLOT.x1 + 1) * TS, py1 = (PLOT.y1 + 1) * TS;
      for (let y = py0 - 8; y < py1 - 24; y += 32) for (let x = px0 - 8; x < px1 - 24; x += 32) {
        tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, TS + 40, TS + 40);
        tg.drawImage(IMGS[((x / 32 | 0) + (y / 32 | 0)) % 7 === 0 ? 'tile_loose' : 'tile_bare'], 0, 0, TS + 40, TS + 40);
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(feather, 0, 0);
        c.globalAlpha = .9; c.drawImage(tmp, x - 20, y - 20); c.globalAlpha = 1;
      }
      // trilha de tábuas
      for (let x = PATH_X0; x <= PATH_X1; x++) {
        c.drawImage(IMGS['tile_wood'], x * TS, PATH_Y * TS, TS, TS);
        c.fillStyle = 'rgba(30,15,0,.4)'; c.fillRect(x * TS, PATH_Y * TS + 31, TS, 2);
        c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x * TS, PATH_Y * TS, 2, TS);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x * TS, (PATH_Y + 1) * TS - 3, TS, 3);
      }
      Animals.drawGround(c, Art.mk);          // palha, terra e poças do curral
      // manchas suaves para quebrar a repetição
      for (let i = 0; i < 700; i++) {
        const x = r() * MW * TS, y = r() * MH * TS, rad = 40 + r() * 110;
        const gr = c.createRadialGradient(x, y, 0, x, y, rad);
        const col = r() < .5 ? '20,80,10' : '210,235,120';
        gr.addColorStop(0, `rgba(${col},${r() < .5 ? .1 : .07})`); gr.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    });
    // tiles de solo arado / molhado
    tilledTile = Art.mk(TS, TS, c => {
      c.drawImage(IMGS['tile_loose'], 0, 0, TS, TS);
      c.fillStyle = 'rgba(110,60,25,.22)'; c.fillRect(0, 0, TS, TS);
      for (let i = 0; i < 4; i++) {
        const y = 6 + i * 16;
        const gr = c.createLinearGradient(0, y, 0, y + 10);
        gr.addColorStop(0, 'rgba(255,225,170,.18)'); gr.addColorStop(.45, 'rgba(255,225,170,.0)'); gr.addColorStop(.6, 'rgba(35,18,5,.28)'); gr.addColorStop(1, 'rgba(35,18,5,0)');
        c.fillStyle = gr; c.fillRect(0, y, TS, 10);
      }
    });
    wetTile = Art.mk(TS, TS, c => {
      c.drawImage(tilledTile, 0, 0);
      c.fillStyle = 'rgba(45,25,12,.46)'; c.fillRect(0, 0, TS, TS);
      c.fillStyle = 'rgba(110,160,210,.10)'; c.fillRect(0, 0, TS, TS);
      for (let i = 0; i < 4; i++) { c.fillStyle = 'rgba(200,230,255,.16)'; c.fillRect(3, 9 + i * 16, TS - 6, 1.5); }
    });
  }

  /* ---------------- som ---------------- */
  const Snd = (() => {
    const CFG_KEY = 'fazenda_leankar_cfg';
    let cfg = { music: true, sfx: true };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* ignore */ }
    const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };
    let ctx = null, master = null, sfxBus = null, musicBus = null, delayIn = null, noiseBuf = null, rainGain = null;
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination);
        sfxBus = ctx.createGain(); sfxBus.gain.value = cfg.sfx ? 1 : 0; sfxBus.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = cfg.music ? .5 : 0; musicBus.connect(master);
        // eco suave para dar espaço à música
        delayIn = ctx.createGain(); delayIn.gain.value = .32;
        const dl = ctx.createDelay(1); dl.delayTime.value = .36;
        const fb = ctx.createGain(); fb.gain.value = .36;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
        delayIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(musicBus);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // chuva ambiente (loop de ruído filtrado)
        const rs = ctx.createBufferSource(); rs.buffer = noiseBuf; rs.loop = true;
        const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2600; rf.Q.value = .5;
        const rf2 = ctx.createBiquadFilter(); rf2.type = 'highpass'; rf2.frequency.value = 700;
        rainGain = ctx.createGain(); rainGain.gain.value = 0;
        rs.connect(rf); rf.connect(rf2); rf2.connect(rainGain); rainGain.connect(sfxBus); rs.start();
      } catch (e) { ctx = null; }
    }

    /* ---------- efeitos ---------- */
    function tone(f, d, type = 'sine', v = .2, slide = 0, delay = 0) {
      if (!ctx || !cfg.sfx) return;
      const t = ctx.currentTime + delay, o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, f + slide), t + d);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(v, t + .01); gn.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(gn); gn.connect(sfxBus); o.start(t); o.stop(t + d + .02);
    }
    function noise(d, v = .2, f = 800, type = 'lowpass', delay = 0, f2 = 0) {
      if (!ctx || !cfg.sfx) return;
      const t = ctx.currentTime + delay, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.linearRampToValueAtTime(f2, t + d);
      gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(.0001, t + d);
      s.connect(fl); fl.connect(gn); gn.connect(sfxBus); s.start(t, Math.random() * .5); s.stop(t + d + .02);
    }

    /* ---------- música generativa ---------- */
    // acordes [baixo, [notas]] em MIDI; escalas pentatônicas por clima
    const MOODS = {
      day: { bpm: 92, vol: 1, arp: .8, mel: .55, oct: 0,
        prog: [[36, [60, 64, 67]], [33, [57, 60, 64]], [41, [57, 60, 65]], [31, [55, 59, 62]]],
        scale: [60, 62, 64, 67, 69, 72, 74, 76, 79] },
      night: { bpm: 66, vol: .8, arp: .35, mel: .3, oct: 12,
        prog: [[33, [57, 60, 64]], [29, [53, 57, 60]], [36, [55, 60, 64]], [28, [55, 59, 64]]],
        scale: [57, 60, 62, 64, 67, 69, 72, 76] },
      rain: { bpm: 72, vol: .85, arp: .5, mel: .28, oct: 0,
        prog: [[29, [53, 57, 60]], [31, [55, 59, 62]], [33, [57, 60, 64]], [31, [55, 59, 62]]],
        scale: [57, 60, 62, 65, 67, 69, 72] },
    };
    let wantMood = 'day', mood = MOODS.day, moodName = 'day', step = 0, nextT = 0, timer = null, melIdx = 3, playing = false;

    function env(g, t, a, peak, d, rel) { // ataque, sustenta até d-rel, release
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setValueAtTime(peak, t + Math.max(a, d - rel)); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    }
    function voice(type, f, t, d, peak, a = .01, rel = .3, send = .5, detune = 0) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = detune;
      env(g, t, a, peak, d, rel);
      o.connect(g); g.connect(musicBus);
      if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(delayIn); }
      o.start(t); o.stop(t + d + .05);
      return o;
    }
    function pluck(m, t, v) {            // dedilhado de violão/harpa
      const f = mtof(m);
      voice('triangle', f, t, .9, .09 * v, .004, .85, .55);
      voice('sine', f * 2, t, .35, .03 * v, .004, .3, .4);
    }
    function pad(notes, t, d, v) {       // cama de acordes suave
      for (const m of notes) {
        voice('sine', mtof(m), t, d, .045 * v, .9, 1.4, .25, -4);
        voice('triangle', mtof(m), t, d, .015 * v, 1.1, 1.4, .25, 5);
      }
    }
    function flute(m, t, d, v) {         // melodia com leve vibrato
      const o = voice('sine', mtof(m), t, d, .08 * v, .05, .5, .7);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5; lg.gain.value = 5;
      lfo.connect(lg); lg.connect(o.detune); lfo.start(t + .15); lfo.stop(t + d + .05);
      voice('triangle', mtof(m) * 2, t + .02, d * .6, .012 * v, .05, .3, .5);
    }
    function bell(m, t, v) {             // caixinha de música (noite)
      const f = mtof(m);
      voice('sine', f, t, 1.8, .07 * v, .003, 1.7, .8);
      voice('sine', f * 2.76, t, .5, .02 * v, .003, .45, .6);
    }
    function cricket(t) {
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 4300 + Math.random() * 300;
        const tt = t + i * .075; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(.012, tt + .01); g.gain.linearRampToValueAtTime(0, tt + .06);
        o.connect(g); g.connect(sfxBus); o.start(tt); o.stop(tt + .08);
      }
    }

    function schedule(i, t) {
      const eighth = 60 / mood.bpm / 2, bar = Math.floor(i / 8) % 4, k = i % 8, chord = mood.prog[bar];
      if (k === 0) {
        if (bar === 0) { moodName = wantMood; mood = MOODS[moodName]; }
        pad(chord[1], t, eighth * 8 + .5, mood.vol);
        voice('triangle', mtof(chord[0] + 12), t, eighth * 3, .13 * mood.vol, .02, .5, .15);
      } else if (k === 4) {
        voice('triangle', mtof(chord[0] + (moodName === 'night' ? 12 : 19)), t, eighth * 2.5, .08 * mood.vol, .02, .4, .15);
      }
      // dedilhado
      const pat = [0, 1, 2, 1, 2, 1, 0, 1][k];
      if (Math.random() < mood.arp) pluck(chord[1][pat] + (moodName === 'night' ? 12 : 0) + (k % 4 === 3 ? 12 : 0), t + (Math.random() * .012), mood.vol);
      // melodia
      if (k % 2 === 0 && Math.random() < mood.mel) {
        const sc = mood.scale;
        melIdx = clamp(melIdx + pick([-2, -1, -1, 0, 1, 1, 2]), 0, sc.length - 1);
        const m = sc[melIdx];
        if (moodName === 'night') bell(m + 12, t, mood.vol); else flute(m, t, eighth * pick([1.5, 2, 3, 4]), mood.vol);
      }
      if (moodName === 'night' && Math.random() < .12) cricket(t + Math.random() * eighth);
    }
    function pump() {
      if (!ctx || !playing || ctx.state !== 'running') return;
      while (nextT < ctx.currentTime + .35) {
        if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05;
        schedule(step, nextT); nextT += 60 / mood.bpm / 2; step++;
      }
    }

    return {
      init,
      get muted() { return !cfg.sfx; },
      get musicOn() { return cfg.music; },
      toggle() { cfg.sfx = !cfg.sfx; if (sfxBus) sfxBus.gain.value = cfg.sfx ? 1 : 0; saveCfg(); return !cfg.sfx; },
      toggleMusic() {
        cfg.music = !cfg.music; saveCfg();
        if (musicBus) musicBus.gain.setTargetAtTime(cfg.music ? .5 : 0, ctx.currentTime, .25);
        return !cfg.music;
      },
      startMusic() {
        if (!ctx || playing) return;
        playing = true; step = 0; nextT = ctx.currentTime + .3;
        timer = setInterval(pump, 90);
      },
      setMood(m, raining) {
        wantMood = m;
        if (rainGain) rainGain.gain.setTargetAtTime(raining ? .13 : 0, ctx.currentTime, 1.2);
      },
      suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
      resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
      till()    { noise(.16, .5, 420, 'lowpass', 0, 200); tone(95, .12, 'triangle', .25, -40); },
      water()   { noise(.35, .22, 2200, 'bandpass', 0, 3400); },
      plant()   { tone(420, .1, 'sine', .22, 200); tone(640, .12, 'sine', .15, 100, .06); },
      harvest() { tone(520, .1, 'triangle', .22); tone(780, .14, 'triangle', .22, 0, .08); },
      coin()    { tone(1046, .09, 'square', .1); tone(1568, .22, 'square', .1, 0, .08); },
      rock()    { noise(.1, .6, 1800, 'highpass'); tone(150, .14, 'square', .15, -60); },
      pop()     { tone(300, .08, 'sine', .25, 400); },
      error()   { tone(160, .2, 'sawtooth', .13, -50); },
      buy()     { tone(660, .08, 'triangle', .2); tone(990, .16, 'triangle', .2, 0, .07); },
      sleep()   { [523, 659, 784, 1046].forEach((f, i) => tone(f, .5, 'sine', .15, 0, i * .18)); },
      level()   { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, .3, 'triangle', .18, 0, i * .1)); },
      chirp()   { const f = rnd(2400, 3600); tone(f, .07, 'sine', .06, 500); tone(f + 300, .07, 'sine', .06, 500, .1); if (Math.random() < .5) tone(f + 500, .06, 'sine', .05, 300, .2); },
      step()    { noise(.05, .06, 600, 'lowpass'); },
      egg()     { tone(880, .08, 'sine', .15); tone(1175, .12, 'sine', .15, 0, .07); },
      moo(q)    { tone(110, .75, 'sawtooth', q ? .04 : .09, -35); tone(165, .6, 'sine', q ? .03 : .07, -45, .03); },
      oink()    { noise(.12, .2, 700, 'bandpass', 0, 400); tone(190, .12, 'square', .06, -70); tone(150, .1, 'square', .05, -40, .15); noise(.1, .16, 600, 'bandpass', .15, 350); },
      bark()    { noise(.09, .3, 900, 'bandpass', 0, 500); tone(380, .1, 'square', .09, -160); tone(340, .09, 'square', .08, -140, .16); noise(.08, .25, 800, 'bandpass', .16, 400); },
      chop()    { noise(.1, .55, 1400, 'highpass'); tone(130, .13, 'square', .16, -70); noise(.14, .25, 500, 'lowpass', .02); },
      neigh()   { tone(520, .5, 'sawtooth', .07, 380); tone(900, .28, 'sawtooth', .05, -300, .35); },
      cluck()   { tone(520, .05, 'square', .04, 120); tone(430, .06, 'square', .04, -60, .07); },
      whoosh()  { noise(.18, .12, 1200, 'bandpass', 0, 400); },
    };
  })();

  /* ---------------- util UI ---------------- */
  function toast(msg, cls = '') {
    const box = $('toast');
    const small = matchMedia('(pointer:coarse), (max-width: 760px)').matches;
    while (box.children.length > (small ? 1 : 3)) box.removeChild(box.firstChild);
    const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls;
    box.appendChild(d);
    setTimeout(() => d.classList.add('out'), small ? 1800 : 2600);
    setTimeout(() => d.remove(), small ? 2300 : 3100);
  }
  function fmt(n) { return Math.floor(n).toLocaleString('pt-BR'); }
  function cropIcon(k) { return ICONS[k]; }
  const ICONS = {};

  /* ---------------- partículas ---------------- */
  function burst(x, y, n, cols, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-.8, .8) : rnd(0, 6.283), sp = rnd(o.min || 30, o.max || 110);
      parts.push({ k: o.kind || 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 40), g: o.g === undefined ? 380 : o.g,
        life: 0, max: rnd(.35, .7) * (o.life || 1), r: rnd(o.r0 || 2, o.r1 || 4), c: pick(cols), rot: rnd(0, 6) });
    }
  }
  function ring(x, y, c, r, grow, max) { parts.push({ k: 'ring', x, y, vx: 0, vy: 0, g: 0, life: 0, max, r, grow, c }); }
  function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  function floatText(x, y, text, color = '#ffe680') {
    parts.push({ k: 'text', x, y, vx: 0, vy: -38, g: 0, life: 0, max: 1.3, text, c: color });
  }
  function fly(x, y, canvasImg) {
    parts.push({ k: 'fly', x, y, sx: x, sy: y, life: 0, max: .65, img: canvasImg, vx: 0, vy: 0, g: 0, bend: rnd(-60, 60) });
  }

  /* ---------------- salvar / carregar ---------------- */
  // Grava o jogo. Devolve { ok: true } ou { ok: false, error }. Em falha (cota cheia, modo privado, storage bloqueado)
  // avisa o jogador: o autosave avisa uma vez e repete no máximo a cada 60 s; o botão "Salvar" (manual) sempre avisa.
  let saveFailing = false, lastSaveWarn = -1e9;
  function saveErrorText(e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    return quota ? 'Sem espaço no navegador para salvar! Libere espaço (dados do site) — o progresso NÃO está sendo salvo.'
      : 'O navegador não deixou salvar (modo privado ou dados do site bloqueados) — o progresso NÃO está sendo salvo.';
  }
  // `pt`/`pk` das plantas são só da animação de brotar/crescer (dependem de `time`, que reinicia a cada sessão): não vão para o save.
  // Devolve uma cópia — o estado vivo mantém `pt`/`pk` até o render terminar a animação.
  const TRANSIENT_CROP_KEYS = ['pt', 'pk'];
  function persistentCrops(crops) {
    const out = {};
    for (const k in crops) { const c = Object.assign({}, crops[k]); for (const f of TRANSIENT_CROP_KEYS) delete c[f]; out[k] = c; }
    return out;
  }
  /* R2 — aba velha NÃO sobrescreve aba nova. Cada gravação sobe `rev` (contador do save). Esta aba lembra o `rev` que leu/gravou por último
     (`loadedRev`); antes de gravar compara com o que está no storage: se for diferente, OUTRA aba salvou depois — esta aba para de salvar
     (staleTab) e pergunta ao jogador (recarregar, ou "usar esta aba" guardando antes uma cópia do que a outra salvou). */
  let loadedRev = 0, staleTab = false, staleShown = false, eraseForced = false;
  let slotKnown = false;           // N4: esta aba já leu ou gravou um save — se ele sumir do storage, outra aba o apagou (não ressuscitar)
  /* `rev` de um texto de save: 0 se não houver `rev` válido; null se o texto não é JSON. É a ÚNICA normalização do `rev` (N2): quem LÊ o save
     (loadedRev), quem confere antes de gravar (storedInfo) e o evento `storage` usam esta função, então nunca divergem (nem com rev 5.5 ou 1e13). */
  function revOfRaw(raw) {
    try { const o = JSON.parse(raw); return o && Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : 0; } catch (e) { return null; }
  }
  function storedInfo() {          // o que está gravado: { raw, rev }; rev === null se o texto não é um save legível. Lança se o storage falhar.
    const raw = localStorage.getItem(SAVE_KEY);
    return raw === null ? { raw: null, rev: 0 } : { raw, rev: revOfRaw(raw) };
  }
  const prevSaveInfo = () => { try { return storedInfo(); } catch (e) { return { raw: null, rev: 0 }; } };
  const conflictError = () => { const e = new Error('este jogo foi salvo mais recentemente em outra aba'); e.name = 'Conflict'; return e; };
  function save(manual) {
    if (!S) return { ok: false, error: new Error('nenhum jogo em andamento') };
    if (staleTab) {                // já sabemos que outra aba salvou depois: não grava nada (nem em pagehide/visibilitychange)
      if (manual === true) toast('⚠ Este jogo foi salvo em outra aba — esta aba não salva mais.', 'bad');
      return { ok: false, error: conflictError() };
    }
    try {
      const cur = storedInfo();
      const gone = cur.raw === null && slotKnown;                 // N4: outra aba apagou o save — esta aba não o ressuscita
      if (gone || (cur.raw !== null && cur.rev !== null && cur.rev !== loadedRev)) {
        staleTab = true; console.warn(gone ? 'save recusado: o save foi apagado em outra aba' : 'save recusado: rev gravado', cur.rev, '≠ rev desta aba', loadedRev);
        if (manual === true) toast('⚠ Este jogo foi salvo em outra aba — esta aba não salva mais.', 'bad');
        return { ok: false, error: conflictError() };
      }
      if (cur.raw !== null && cur.rev === null) backupSave(cur.raw);        // vai gravar por cima de algo ilegível: guarda antes
      S.obs = obs.map(o => o.type === 'ftree' ? [o.type, o.x, o.y, o.v, o.hp, o.age, o.fruit, o.cd] : [o.type, o.x, o.y, o.v, o.hp]);
      S.eggList = eggs.map(e => [e.x, e.y]);
      S.px = P.x; S.py = P.y; S.dir = P.dir;
      S.rev = loadedRev + 1;
      localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, S, { crops: persistentCrops(S.crops) })));
      loadedRev = S.rev; slotKnown = true;
    } catch (e) {
      console.warn('falha ao salvar', e);
      saveFailing = true;
      if (manual === true || time - lastSaveWarn > 60) { lastSaveWarn = time; toast('⚠ ' + saveErrorText(e), 'bad'); Snd.error(); }
      return { ok: false, error: e };
    }
    if (saveFailing) { saveFailing = false; toast('Salvamento restabelecido ✓', 'good'); }
    return { ok: true };
  }
  function showStaleModal() {
    staleShown = true; currentModal = 'stale';
    setModal(`<h2>⚠ Jogo aberto em outra aba</h2><p>Outra aba salvou este jogo <b>depois</b> de você (ou o apagou). Para não desfazer o que ela fez, <b>esta aba parou de salvar</b>.</p>
      <div class="modalBtns"><button class="mb" data-a="stalereload">Recarregar (recomendado)</button><button class="mb alt" data-a="staleuse">Usar esta aba</button></div>
      <p><small>"Usar esta aba" guarda uma cópia do que a outra aba salvou e passa a salvar daqui.</small></p>`);
  }
  // Salva logo depois de um evento importante (compra, venda, plantio). Agrupa rajadas (ex.: plantar segurando Espaço,
  // comprar várias vezes) num único save ~0,8 s depois. Roda mesmo com o jogo pausado (a loja pausa o jogo).
  let saveTimer = 0;
  function requestSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = 0; if (running && S) { lastSave = time; save(); } }, 800);
  }
  /* Leitura do save. Nunca lança e distingue os casos:
       { status: 'none' }                                  não existe save
       { status: 'ok', state, repaired }                   save válido (com defaults aplicados; `repaired` = correções do sanitizeState, e então o original vira cópia)
       { status: 'invalid', reason, raw, backedUp }        existe mas não dá para usar
     reason: json (corrompido) · future (versão mais nova que o jogo) · version (sem migração conhecida) · shape (dados faltando).
     Um save inválido NUNCA é alterado aqui: vai para uma cópia de segurança (as 3 mais recentes) e a tela inicial avisa o jogador. */
  const BACKUP_KEY = SAVE_KEY + '_backup', MAX_BACKUPS = 3;
  const MIGRATIONS = {};          // schema N → N+1: função pura (save → save). Vazio: só existe a versão 1.
  /* R3 — limpa o estado lido: tipo errado, valor fora da faixa, estrutura quebrada e espécie desconhecida viram valores seguros em vez de
     travar o jogo. Devolve quantas CORREÇÕES foram feitas (valor presente porém inválido); chave ausente só recebe o padrão e não conta. */
  function sanitizeState(st) {
    const dflt = newState(); let repairs = 0;
    const bad = () => { repairs++; };
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const Pint = (o, k, lo, hi, def) => { const v = o[k], ok = Number.isFinite(v), nv = ok ? Math.max(lo, Math.min(hi, Math.floor(v))) : def; if (!ok || nv !== v) bad(); o[k] = nv; };   // estrito: conta se mudou
    const Pnum = (o, k, lo, hi, def) => { const v = o[k], ok = Number.isFinite(v); if (!ok) bad(); o[k] = ok ? Math.max(lo, Math.min(hi, v)) : def; };                        // folgado: só conta se não for número
    const clampInt = (v, def, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : def;
    const objOf = (v, keys, def) => { if (!isObj(v)) { bad(); v = Object.assign({}, def); } return Object.fromEntries(keys.map(k => [k, has(v, k) ? v[k] : def[k]])); };   // só as chaves conhecidas
    const pairs = (arr, max, okPair) => {
      if (!Array.isArray(arr)) { bad(); return []; }
      const out = [];
      for (const e of arr) { if (out.length >= max) { bad(); break; } if (Array.isArray(e) && okPair(e)) out.push([e[0], e[1]]); else bad(); }
      return out;
    };
    const tilePair = e => Number.isInteger(e[0]) && Number.isInteger(e[1]) && inb(e[0], e[1]);
    const posPair = e => Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[0] >= 0 && e[1] >= 0 && e[0] <= MW * TS && e[1] <= MH * TS;

    Pint(st, 'day', 1, 1e6, 1); Pnum(st, 'gold', 0, 1e12, 100); Pnum(st, 'earned', 0, 1e12, 0); Pnum(st, 'min', DAY_START, DAY_END, DAY_START); Pnum(st, 'energy', 0, 100, 100);
    st.up = objOf(st.up, ['basket', 'can', 'boots'], dflt.up);
    Pint(st.up, 'basket', 0, BASKET_CAP.length - 1, 0); Pint(st.up, 'can', 0, CAN_CAP.length - 1, 0); Pint(st.up, 'boots', 0, BOOTS.length - 1, 0);
    Pnum(st, 'water', 0, CAN_CAP[st.up.can], Math.min(dflt.water, CAN_CAP[st.up.can]));
    Pint(st, 'goal', 0, GOALS.length, 0); Pint(st, 'tool', 0, TOOLS.length - 1, 0); Pint(st, 'dir', 0, 3, 0); Pint(st, 'rev', 0, 1e12, 0);
    if (!PROD_KEYS.includes(st.selSeed)) { bad(); st.selSeed = 'cenoura'; }
    if (typeof st.char !== 'string' || !has(CHARACTERS, st.char)) { bad(); st.char = 'fazendeiro'; }
    if (!Number.isFinite(st.px) || !Number.isFinite(st.py)) { if (st.px !== undefined || st.py !== undefined) bad(); st.px = SPAWN.x; st.py = SPAWN.y; }
    for (const k of ['eggs', 'stone', 'wood', 'milk', 'truffle', 'meat']) Pint(st, k, 0, 1e9, 0);
    if (st.laid !== 1 && st.laid !== 2) { bad(); st.laid = 1; }
    st.seeds = objOf(st.seeds, PROD_KEYS, dflt.seeds); st.harvest = objOf(st.harvest, PROD_KEYS, dflt.harvest);
    for (const k of PROD_KEYS) { Pint(st.seeds, k, 0, 1e6, dflt.seeds[k]); Pint(st.harvest, k, 0, 1e6, 0); }
    st.owned = objOf(st.owned, Object.keys(ANIMAL_SHOP), dflt.owned);
    for (const k in ANIMAL_SHOP) Pint(st.owned, k, 0, ANIMAL_SHOP[k].max, 0);      // sem isso um save com 4000 porcos cria 4000 porcos
    st.stat = objOf(st.stat, Object.keys(dflt.stat), dflt.stat);
    for (const k in dflt.stat) Pint(st.stat, k, 0, 1e9, 0);
    // listas do dia
    st.milked = Array.isArray(st.milked) ? st.milked.slice(0, 16).map(v => !!v) : (bad(), []);
    st.meatDone = Array.isArray(st.meatDone) ? st.meatDone.slice(0, 16).map(v => v == null ? 0 : Number.isFinite(v) ? clampInt(v, 0, 0, 2) : (bad(), 0)) : (bad(), []);
    st.digs = pairs(st.digs, 8, tilePair); st.truffleList = pairs(st.truffleList, 16, posPair); st.eggList = pairs(st.eggList, 64, posPair);
    st.felled = pairs(st.felled, MW * MH, tilePair);
    // chão: só 0 (nada), 1 (arado), 2 (molhado)
    let soilBad = false; st.soil = st.soil.map(v => (v === 0 || v === 1 || v === 2) ? v : (soilBad = true, 0)); if (soilBad) bad();
    // plantas: só espécies conhecidas, em tiles do mapa, com idade numérica (pt/pk da animação saem aqui)
    if (!isObj(st.crops)) { bad(); st.crops = {}; }
    else {
      const out = {};
      for (const k in st.crops) {
        const p = k.split(','), c = st.crops[k];
        if (p.length === 2 && /^[0-9]+$/.test(p[0]) && /^[0-9]+$/.test(p[1]) && inb(+p[0], +p[1]) && isObj(c) && CROP_KEYS.includes(c.t) && Number.isFinite(c.age) && c.age >= 0) out[k] = { t: c.t, age: Math.floor(c.age) };
        else bad();
      }
      st.crops = out;
    }
    // obstáculos: [tipo, x, y, variação, hp] (árvore frutífera: + idade, fruta, recarga). Lista inválida => regenera o mapa em vez de ficar sem nada
    const HP = { rock: 3, stump: 4, bush: 1, ftree: 6 };
    if (!Array.isArray(st.obs)) { bad(); st.obs = []; st.obsInit = false; }
    else {
      const seen = new Set(), out = [];
      for (const e of st.obs) {
        const okE = Array.isArray(e) && typeof e[0] === 'string' && has(HP, e[0]) && Number.isInteger(e[1]) && Number.isInteger(e[2]) && inb(e[1], e[2]) && !seen.has(e[1] + ',' + e[2]);
        if (!okE) { bad(); continue; }
        seen.add(e[1] + ',' + e[2]);
        const t = e[0], v = clampInt(e[3], 0, 0, 1e6), hp = Number.isFinite(e[4]) && e[4] > 0 ? Math.min(e[4], 12) : HP[t];
        if (t === 'ftree') out.push([t, e[1], e[2], v % TREE_KEYS.length, hp, clampInt(e[5], 0, 0, 999), e[6] ? 1 : 0, clampInt(e[7], 0, 0, 99)]);
        else out.push([t, e[1], e[2], t === 'rock' ? v % 2 : t === 'bush' ? v % 3 : 0, hp]);
      }
      st.obs = out; st.obsInit = !!st.obsInit;
    }
    st.rain = !!st.rain; st.won = !!st.won;
    if (!isObj(st.names)) st.names = {};
    return repairs;
  }
  function parseSave(j) {
    let s;
    try { s = JSON.parse(j); } catch (e) { return { status: 'invalid', reason: 'json' }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { status: 'invalid', reason: 'json' };
    let v = s.v;
    if (!Number.isInteger(v) || v < 1) return { status: 'invalid', reason: 'version' };
    if (v > SAVE_VERSION) return { status: 'invalid', reason: 'future' };
    while (v < SAVE_VERSION) {
      try { s = MIGRATIONS[v] ? MIGRATIONS[v](s) : null; } catch (e) { s = null; }
      if (!s || !(s.v > v)) return { status: 'invalid', reason: 'version' };
      v = s.v;
    }
    const base = newState();
    const state = Object.assign(base, s, { owned: Object.assign(base.owned, s.owned), seeds: Object.assign(base.seeds, s.seeds), harvest: Object.assign(base.harvest, s.harvest),
      up: Object.assign(base.up, s.up), stat: Object.assign(base.stat, s.stat), names: Object.assign({}, s.names) });
    if (!Array.isArray(state.soil) || state.soil.length !== MW * MH || ![state.day, state.gold, state.min].every(Number.isFinite)) return { status: 'invalid', reason: 'shape' };
    const repaired = sanitizeState(state);      // (também descarta pt/pk de saves antigos: as plantas são reconstruídas só com t e age)
    if (s.laid === undefined) state.laid = state.min >= Animals.MIDDAY ? 2 : 1;      // save anterior às posturas de meio-dia: não repõe ovos ao carregar
    return { status: 'ok', state, repaired };
  }
  function listBackups() {            // mais recentes primeiro; a chave antiga (sem data) fica por último
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === BACKUP_KEY || (k && k.startsWith(BACKUP_KEY + '_'))) {
          const raw = localStorage.getItem(k);
          out.push({ key: k, ts: k === BACKUP_KEY ? 0 : +k.slice(BACKUP_KEY.length + 1) || 0, raw, info: parseSave(raw) });
        }
      }
    } catch (e) { /* storage indisponível */ }
    return out.sort((x, y) => y.ts - x.ts);
  }
  /* R4 — poda para MAX_BACKUPS cópias sem perder a única cópia que dá para restaurar: descarta primeiro as ILEGÍVEIS (da mais antiga para a
     mais nova) e só depois as válidas (também da mais antiga); a cópia recém-criada e a cópia VÁLIDA mais recente nunca são descartadas. */
  function pruneBackups(keepKey) {
    const all = listBackups(), newestValid = all.find(b => b.info.status === 'ok');      // listBackups: mais recentes primeiro
    // N1: save de versão FUTURA/desconhecida não é lixo: é progresso de um jogo mais novo que este código não abre (JS antigo em cache). Ordem de descarte:
    // 0 = ilegível (json/shape) · 1 = válida · 2 = futura/versão desconhecida — dentro de cada grupo, a mais antiga primeiro.
    const rank = b => b.info.status === 'ok' ? 1 : (b.info.reason === 'future' || b.info.reason === 'version') ? 2 : 0;
    const victims = all.filter(b => b.key !== keepKey && b !== newestValid).sort((x, y) => rank(x) - rank(y) || x.ts - y.ts);
    for (let n = all.length; n > MAX_BACKUPS && victims.length; n--) localStorage.removeItem(victims.shift().key);
  }
  function backupSave(j) {
    try {
      if (listBackups().some(b => b.raw === j)) return true;                    // já guardado (o boot e o "Continuar" leem duas vezes)
      const key = BACKUP_KEY + '_' + Date.now();
      localStorage.setItem(key, j);
      pruneBackups(key);
      return true;
    } catch (e) { return false; }                                               // cota cheia: o texto ainda pode ser baixado da tela inicial
  }
  function loadSave() {
    let j;
    try { j = localStorage.getItem(SAVE_KEY); } catch (e) { return { status: 'none' }; }
    if (!j) return { status: 'none' };
    const r = parseSave(j);
    if (r.status === 'ok') { r.rev = revOfRaw(j); return r.repaired ? Object.assign(r, { backedUp: backupSave(j) }) : r; }      // `rev` do TEXTO lido (N2); corrigido pelo sanitizeState: guarda o ORIGINAL antes
    return Object.assign(r, { raw: j, backedUp: backupSave(j) });
  }
  function restoreBackup(b) { try { localStorage.setItem(SAVE_KEY, b.raw); return true; } catch (e) { return false; } }
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const SAVE_PROBLEMS = {
    json: 'O arquivo do save está corrompido e não pôde ser lido.',
    future: 'O save é de uma versão mais nova do jogo. Atualize a página (Ctrl+F5) e tente de novo — ele não foi alterado.',
    version: 'O save é de uma versão do jogo que este código não reconhece.',
    shape: 'O save está incompleto (faltam dados do mapa).',
    start: 'O save foi lido, mas o jogo não conseguiu iniciá-lo — o save não foi alterado.',
  };
  const saveFileName = () => 'fazenda-las-save-' + new Date().toISOString().slice(0, 10) + '.json';
  // caixa "Problema com o jogo salvo" da tela inicial. found: { status:'invalid', reason, raw, backedUp, detail } ou { status:'none' } (só oferece restaurar)
  function renderSaveProblem(found, good) {
    const bad = found.status === 'invalid';
    if (!bad && !good) return;
    const sp = $('saveProblem'), ex = $('btnSpExport'), br = $('btnSpRestore');
    $('spMsg').textContent = bad ? SAVE_PROBLEMS[found.reason] + (found.detail ? ' (' + found.detail + ')' : '') + ' ' + (found.backedUp ? 'Uma cópia de segurança foi guardada neste navegador.' : 'Não foi possível guardar uma cópia neste navegador — baixe o arquivo antes de começar de novo!')
      : 'Não há jogo salvo, mas existe uma cópia de segurança.';
    ex.classList.toggle('hidden', !(bad && found.raw)); br.classList.toggle('hidden', !good);
    if (bad && found.raw) ex.onclick = () => downloadText(saveFileName(), found.raw);
    if (good) {
      const label = 'Restaurar cópia (' + backupLabel(good) + ')'; let forced = false;
      br.textContent = label;
      br.onclick = () => {
        // R5: restaurar grava por cima do principal. Se ele está ilegível e NÃO tem cópia, tenta guardá-la agora; se não couber, só restaura no 2º clique
        if (bad && found.raw && !forced && !found.backedUp && !backupSave(found.raw)) {
          forced = true; br.textContent = 'Restaurar mesmo assim (o save atual será perdido)';
          $('spMsg').textContent = 'Não foi possível guardar uma cópia do save atual (ilegível) antes de restaurar. Baixe-o com "Baixar cópia" ou restaure mesmo assim — o save atual será perdido.';
          return;
        }
        if (restoreBackup(good)) location.reload(); else $('spMsg').textContent = 'Não foi possível restaurar: o navegador bloqueou o armazenamento.';
      };
    }
    $('btnSpClose').onclick = () => sp.classList.add('hidden');
    sp.classList.remove('hidden');
  }
  const backupLabel = b => { const st = b.info.state, d = b.ts ? new Date(b.ts).toLocaleDateString('pt-BR') : 'data desconhecida'; return 'Dia ' + st.day + ' · ' + fmt(st.gold) + ' ◎ · ' + d; };

  /* ---------------- jogador ---------------- */
  const P = { x: SPAWN.x, y: SPAWN.y, dir: 0, moving: false, walkT: 0, stepT: 0, wk: 0, idleT: 0, lastStep: 0 };
  const ptile = () => [Math.floor(P.x / TS), Math.floor(P.y / TS)];
  function boxBlocked(x, y) {
    const x0 = Math.floor((x - 11) / TS), x1 = Math.floor((x + 11) / TS), y0 = Math.floor((y - 9) / TS), y1 = Math.floor((y + 3) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blocked(tx, ty)) return true;
    return false;
  }
  function facingTile() {
    const [tx, ty] = ptile(); return [tx + DX[P.dir], ty + DY[P.dir]];
  }
  function hoverTile() {
    return [Math.floor((mouse.x / zoom + cam.x) / TS), Math.floor((mouse.y / zoom + cam.y) / TS)];
  }
  function inReach(tx, ty) {
    const [px, py] = ptile(); return Math.abs(tx - px) <= 2 && Math.abs(ty - py) <= 2;
  }
  function targetTile() {
    if (mouseMode && mouse.on) { const [hx, hy] = hoverTile(); if (inb(hx, hy) && inReach(hx, hy)) return [hx, hy]; }
    const base = facingTile();
    return snapHarvest(base) || base;
  }
  // algo pronto para colher/ordenhar?
  function readyAt(tx, ty) {
    const it = interactAt(tx, ty); if (!it) return false;
    if (it.type === 'vaca') return !S.milked[it.ref.idx];
    if (it.type === 'porco') return !!it.ready;
    if (it.type === 'ftree') { const o = obsAt(tx, ty); return !!o && treeStage(o) === 2 && !!o.fruit; }
    return it.type === 'crop' || it.type === 'truffle' || it.type === 'dig' || it.type === 'egg';
  }
  // se o tile à frente não tem nada útil, procura um colhível ao lado ou logo atrás dele
  function snapHarvest(b) {
    const [bx, by] = b;
    if (!inb(bx, by) || interactAt(bx, by) || toolCheck(bx, by).ok) return null;
    const horiz = P.dir >= 2, px = horiz ? 0 : 1, py = horiz ? 1 : 0;
    for (const [tx, ty] of [[bx + px, by + py], [bx - px, by - py], [bx + DX[P.dir], by + DY[P.dir]]]) if (inb(tx, ty) && readyAt(tx, ty)) return [tx, ty];
    return null;
  }
  function faceTo(tx, ty) {
    const [px, py] = ptile(); const dx = tx - px, dy = ty - py;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > Math.abs(dy)) P.dir = dx < 0 ? 2 : 3; else P.dir = dy < 0 ? 1 : 0;
  }

  function movePlayer(dt) {
    let ax = 0, ay = 0;
    if (!modalOpen && !paused) {
      if (keys['a'] || keys['arrowleft']) ax -= 1;
      if (keys['d'] || keys['arrowright']) ax += 1;
      if (keys['w'] || keys['arrowup']) ay -= 1;
      if (keys['s'] || keys['arrowdown']) ay += 1;
      if (stick.id !== null) { ax += stick.x; ay += stick.y; }
    }
    const m = Math.hypot(ax, ay);
    P.moving = m > .15;
    if (act && act.lock) { P.moving = false; return; }
    if (!P.moving) { P.stepT = 0; return; }
    if (keys['a'] || keys['d'] || keys['w'] || keys['s'] || keys['arrowleft'] || keys['arrowright'] || keys['arrowup'] || keys['arrowdown']) mouseMode = false;
    ax /= Math.max(1, m); ay /= Math.max(1, m);
    const sp = 172 * (keys['shift'] ? 1.5 : 1) * BOOTS[S.up.boots] * (S.energy <= 0 ? .65 : 1) * (Animals.isRiding() ? 1.85 : 1);
    if (Math.abs(ax) > Math.abs(ay) + .01) P.dir = ax < 0 ? 2 : 3; else if (Math.abs(ay) > Math.abs(ax) + .01) P.dir = ay < 0 ? 1 : 0;
    else if (ax !== 0 && (P.dir === 0 || P.dir === 1)) P.dir = ax < 0 ? 2 : 3;
    let nx = P.x + ax * sp * dt;
    if (!boxBlocked(nx, P.y)) P.x = nx;
    let ny = P.y + ay * sp * dt;
    if (!boxBlocked(P.x, ny)) P.y = ny;
    P.walkT += dt * (keys['shift'] ? 1.5 : 1);
    // o pé toca o chão no ponto de maior abertura das pernas (fase = pi/2 + k*pi)
    const stepK = Math.floor((P.walkT * WALK_FREQ - Math.PI / 2) / Math.PI);
    if (stepK !== P.lastStep) {
      P.lastStep = stepK; Snd.step();
      const fx = P.dir >= 2 ? (stepK % 2 ? 6 : -6) : (stepK % 2 ? 5 : -5);
      burst(P.x + fx, P.y, 3, ['#8a6a3c', '#a8895a', '#6e8f3a'], { min: 10, max: 45, up: 25, r0: 1, r1: 2.6, life: .8, dir: -Math.PI / 2 });
    }
  }

  /* ---------------- regras de ferramentas ---------------- */
  const cropAt = (x, y) => S.crops[x + ',' + y] || null;
  const cropStage = c => { const d = CROPS[c.t].days; return c.age >= d ? 4 : Math.floor(c.age / d * 4); };
  const basketUsed = () => PROD_KEYS.reduce((a, k) => a + S.harvest[k], 0);
  const basketCap = () => BASKET_CAP[S.up.basket];
  const canMax = () => CAN_CAP[S.up.can];

  function interactAt(tx, ty) {
    if (!inb(tx, ty)) return null;
    const an = Animals.at(tx, ty, S); if (an) return an;
    if (ty === 4 && tx >= 7 && tx <= 9) return { type: 'door', label: S.min < SLEEP_FROM ? 'Dormir só depois das 18:00' : 'E — Dormir (encerra o dia)' };
    if (inRect(STALL, tx, ty)) return { type: 'shop', label: 'E — Empório' };
    if (inRect(BIN, tx, ty)) return { type: 'bin', label: 'E — Vender tudo' };
    if (inRect(WELL, tx, ty)) return { type: 'well', label: 'E — Encher o regador' };
    if (isWater(tx, ty)) return { type: 'water', label: 'E — Encher o regador' };
    if (inRect(COOP, tx, ty)) return { type: 'coop', label: 'Galinheiro' };
    const fo = obsAt(tx, ty);
    if (fo && fo.type === 'ftree') { const sp = TREE_SP[TREE_KEYS[fo.v]]; return { type: 'ftree', label: treeStage(fo) === 2 && fo.fruit ? 'E — Colher ' + sp.fruit.toLowerCase() : sp.name + (treeStage(fo) < 2 ? ' (muda)' : '') }; }
    const c = cropAt(tx, ty); if (c && cropStage(c) === 4) return { type: 'crop', label: 'E — Colher' };
    if (eggs.some(e => Math.floor(e.x / TS) === tx && Math.floor(e.y / TS) === ty)) return { type: 'egg', label: 'E — Pegar ovo' };
    return null;
  }

  // Luvas: frutas das árvores e leite das vacas (as plantas da horta seguem em toolCheck)
  function luvasCheck(tx, ty, ob) {
    if (ob && ob.type === 'ftree') {
      const sp = TREE_SP[TREE_KEYS[ob.v]], st = treeStage(ob);
      if (st < 2) return { ok: false, msg: sp.name + ' ainda é uma muda (' + Math.min(ob.age, TREE_ADULT) + '/' + TREE_ADULT + ' dias)' };
      if (!ob.fruit) return { ok: false, msg: 'Sem frutas agora — volte em ' + Math.max(1, ob.cd) + ' dia(s)' };
      return basketUsed() < basketCap() ? { ok: true, k: 'pickTree' } : { ok: false, msg: 'Cesto cheio — venda na caixa' };
    }
    const an = Animals.at(tx, ty, S);
    if (an && an.type === 'vaca') return S.milked[an.ref.idx] ? { ok: false, msg: 'Essa vaca já foi ordenhada hoje. Volte amanhã!' } : { ok: true, k: 'milk' };
    if (an && an.type === 'porco' && an.ready) return { ok: true, k: 'meat' };       // sem carne: cai no carinho (E)
    return null;
  }

  function toolCheck(tx, ty) {
    if (!inb(tx, ty)) return { ok: false };
    const id = TOOLS[S.tool].id, i = idx(tx, ty), ob = obsAt(tx, ty), c = cropAt(tx, ty);
    switch (id) {
      case 'forcado':
        if (ob) return ob.type === 'bush' ? { ok: true, k: 'weed' } : { ok: false, msg: ob.type === 'ftree' ? 'Use o machado (6)' : 'Use a picareta (5)' };
        if (treeGrid[i]) return { ok: false, msg: 'Use o machado (6)' };
        if (solid[i] || isPath(tx, ty)) return { ok: false };
        return S.soil[i] === 0 ? { ok: true, k: 'till' } : { ok: false };
      case 'regador':
        if (isWater(tx, ty) || inRect(WELL, tx, ty)) return { ok: true, k: 'refill' };
        if (S.soil[i] === 1) return S.water > 0 ? { ok: true, k: 'water' } : { ok: false, msg: 'Regador vazio — encha no poço ou na lagoa' };
        return { ok: false };
      case 'sementes':
        if (isTreeKey(S.selSeed)) {            // muda de árvore: vai em terra livre (sem arar)
          if (S.seeds[S.selSeed] <= 0) return { ok: false, msg: 'Sem ' + seedName(S.selSeed) + ' — compre no empório' };
          if (ob || solid[i] || c || isPath(tx, ty) || isWater(tx, ty) || S.soil[i] !== 0 || Animals.inArea(tx, ty, 0)) return { ok: false };
          return { ok: true, k: 'plantTree' };
        }
        if (S.soil[i] > 0 && !c) return S.seeds[S.selSeed] > 0 ? { ok: true, k: 'plant' } : { ok: false, msg: 'Sem ' + seedName(S.selSeed) + ' — compre no empório' };
        return { ok: false };
      case 'luvas':
        { const lk = luvasCheck(tx, ty, ob); if (lk) return lk; }
        if (c) return cropStage(c) === 4 ? (basketUsed() < basketCap() ? { ok: true, k: 'harvest' } : { ok: false, msg: 'Cesto cheio — venda na caixa' }) : { ok: false, msg: 'Ainda não está madura' };
        return { ok: false };
      case 'picareta':
        if (ob && (ob.type === 'rock' || ob.type === 'stump')) return { ok: true, k: 'mine' };
        return { ok: false };
      case 'machado':
        if (ob && ob.type === 'ftree') return { ok: true, k: 'chop' };
        if (treeGrid[i]) return { ok: true, k: 'chop' };
        if (ob && (ob.type === 'rock' || ob.type === 'stump')) return { ok: false, msg: 'Use a picareta (5)' };
        return { ok: false };
    }
    return { ok: false };
  }
  const COST = { weed: 1, till: 2.5, water: .7, plant: .4, plantTree: 1, harvest: .6, mine: 4, chop: 5, pickTree: .6, milk: .8, meat: .8, refill: 0 };

  function useTool(tx, ty, fromMouse, auto) {
    if (act || modalOpen || paused) return;
    if (fromMouse) faceTo(tx, ty);
    let it = interactAt(tx, ty);
    const id = TOOLS[S.tool].id;
    if (it && it.type === 'cachorro' && toolCheck(tx, ty).ok) it = null;   // a ferramenta tem prioridade sobre o carinho (E ainda faz carinho)
    if (Animals.isRiding()) {            // montado: só interage (loja, caixa, poço...)
      if (auto) return;
      if (it) interact(tx, ty); else { toast('Desmonte (E) para usar as ferramentas', 'bad'); Snd.error(); }
      return;
    }
    const toolOwns = (id === 'machado' && it && it.type === 'ftree') || (id === 'luvas' && it && (it.type === 'ftree' || it.type === 'vaca' || (it.type === 'porco' && it.ready)));   // a ferramenta age em vez do atalho (E)
    if (auto && it && it.type !== 'crop' && it.type !== 'egg' && !toolOwns) return;
    if (it && it.type !== 'crop' && it.type !== 'egg' && !toolOwns && !(id === 'regador' && (it.type === 'water' || it.type === 'well'))) { interact(tx, ty); return; }
    const chk = toolCheck(tx, ty);
    if (!chk.ok) { if (chk.msg) { toast(chk.msg, 'bad'); Snd.error(); } else if (it) interact(tx, ty); return; }
    if (S.energy < COST[chk.k]) { toast('Sem energia! Coma uma torta no empório ou espere as 18:00 para dormir.', 'bad'); Snd.error(); return; }
    const dur = id === 'picareta' ? .42 : id === 'machado' ? .45 : id === 'forcado' ? .4 : id === 'regador' ? .45 : chk.k === 'milk' || chk.k === 'meat' ? .85 : chk.k === 'pickTree' ? .5 : .3;
    act = { tool: id, k: chk.k, tx, ty, t: 0, dur, applied: false, lock: true };
    if (chk.k === 'milk') {                       // a vaca fica parada durante a ordenha
      const an = Animals.at(tx, ty, S); if (an && an.ref) { an.ref.moving = false; an.ref.wait = 4; act.cow = an.ref; }
    }
    if (chk.k === 'meat') {                       // o porco fica parado enquanto você pega a carne
      const an = Animals.at(tx, ty, S); if (an && an.ref) { an.ref.moving = false; an.ref.wait = 4; act.pig = an.ref; }
    }
  }

  function applyAct(a) {
    const { tx, ty, k } = a, i = idx(tx, ty), cx = (tx + .5) * TS, cy = (ty + .5) * TS;
    S.energy = Math.max(0, S.energy - (COST[k] || 0));
    switch (k) {
      case 'weed': {
        const o = obsAt(tx, ty); if (!o) return;
        removeObs(o); Snd.pop();
        burst(cx, cy, 14, ['#5fae3a', '#8ad44f', '#3f8a2a'], { kind: 'leaf', min: 40, max: 120, up: 80, r0: 2, r1: 4 });
        if (Math.random() < .2) { const s = pick(CROP_KEYS.slice(0, S.goal >= 1 ? 2 : 1)); S.seeds[s]++; floatText(cx, cy - 20, '+1 semente de ' + CROPS[s].name.toLowerCase(), '#bff08a'); }
        break;
      }
      case 'till':
        S.soil[i] = 1; S.stat.till++; Snd.till(); tileFx.set(i, { t: time, k: 'till' });
        burst(cx, cy, 14, ['#6e4a2a', '#8a6038', '#4a2e18'], { min: 40, max: 120, up: 100, r0: 2, r1: 4.5 });
        break;
      case 'water':
        S.soil[i] = 2; S.water = Math.max(0, S.water - 1); S.stat.water++; Snd.water(); tileFx.set(i, { t: time, k: 'water' });
        ring(cx, cy + 6, '#cfeeff', 4, 22, .6);
        burst(cx, cy - 8, 14, ['#8fd8ff', '#bfe9ff', '#5fb0e8'], { min: 20, max: 80, up: 60, r0: 1.5, r1: 3 });
        break;
      case 'refill':
        S.water = canMax(); Snd.water(); ring(cx, cy, '#e6f6ff', 6, 34, .9); ring(cx, cy, '#cfeeff', 2, 22, .7);
        burst(cx, cy, 16, ['#8fd8ff', '#bfe9ff', '#ffffff'], { min: 30, max: 100, up: 120, r0: 1.5, r1: 3.5 });
        toast('Regador cheio! (' + S.water + ')', 'good');
        break;
      case 'plant':
        S.crops[tx + ',' + ty] = { t: S.selSeed, age: 0, pt: time, pk: 'new' }; S.seeds[S.selSeed]--; S.stat.plant++; Snd.plant(); requestSave();
        burst(cx, cy, 8, ['#e9d27a', '#d9c28f', '#8a6038'], { min: 20, max: 70, up: 60, r0: 1.4, r1: 2.6 });
        break;
      case 'harvest': harvestAt(tx, ty); break;
      case 'pickTree': { const o = obsAt(tx, ty); if (o && o.type === 'ftree' && treeStage(o) === 2 && o.fruit) harvestTree(o); break; }
      case 'milk': { const cow = a.cow || (Animals.at(tx, ty, S) || {}).ref; if (cow) milkCow(cow); break; }
      case 'meat': { const pig = a.pig || (Animals.at(tx, ty, S) || {}).ref; if (pig) takeMeat(pig); break; }
      case 'plantTree': {
        const k = S.selSeed, o = addObs('ftree', tx, ty, TREE_KEYS.indexOf(k), 6, 0, 0, 0); o.pt = time;
        S.seeds[k]--; S.stat.plant++; Snd.plant(); requestSave();
        burst(cx, cy, 10, ['#6e4a2a', '#8a6038', '#5fae3a'], { min: 20, max: 80, up: 70, r0: 1.5, r1: 3 });
        break;
      }
      case 'chop': {
        const o = obsAt(tx, ty), tr = treeGrid[i];
        Snd.chop(); shakeT = .12;
        burst(cx, cy - 6, 8, ['#d9ae72', '#a77a43', '#7a4e26'], { min: 50, max: 140, up: 110, r0: 1.6, r1: 3.6 });
        burst(cx, cy - 36, 4, ['#5fae3a', '#8ad44f'], { kind: 'leaf', min: 30, max: 90, up: 40, r0: 2, r1: 3.5, life: 1.2 });
        if (o && o.type === 'ftree') {
          o.shake = .25; o.hp -= o.age < 2 ? 3 : o.age < TREE_ADULT ? 1.5 : 1;
          if (o.hp <= 0) {
            removeObs(o);
            const n = o.age < 2 ? 1 : o.age < TREE_ADULT ? 2 : 3 + (Math.random() < .5 ? 1 : 0); S.wood += n;
            fellFx(tx, ty, Art.fruitTrees[TREE_KEYS[o.v]][treeStage(o) < 2 ? treeStage(o) : (o.fruit ? 3 : 2)], n);
          }
        } else if (tr) { tr.shake = .25; if (--tr.hp <= 0) fellTree(tr); }
        break;
      }
      case 'mine': {
        const o = obsAt(tx, ty); if (!o) return;
        o.hp--; Snd.rock(); o.shake = .25; shakeT = .16;
        burst(cx, cy, 12, o.type === 'rock' ? ['#bdb9ae', '#8f8c82', '#6b6960'] : ['#d9ae72', '#a77a43', '#7a4e26'], { min: 50, max: 150, up: 120, r0: 2, r1: 4 });
        if (o.hp <= 0) {
          removeObs(o);
          if (o.type === 'rock') { const n = 1 + Math.floor(Math.random() * 2); S.stone += n; floatText(cx, cy - 24, '+' + n + ' pedra', '#d6d3c8'); }
          else { const n = 2; S.wood += n; floatText(cx, cy - 24, '+' + n + ' madeira', '#e0b57a'); }
          Snd.pop();
        }
        break;
      }
    }
  }

  function harvestAt(tx, ty) {
    const key = tx + ',' + ty, c = S.crops[key]; if (!c || cropStage(c) < 4) return;
    if (basketUsed() >= basketCap()) { toast('Cesto cheio — venda na caixa de vendas', 'bad'); Snd.error(); return; }
    delete S.crops[key];
    S.soil[idx(tx, ty)] = 1; S.harvest[c.t]++; S.stat.harvest++;
    Snd.harvest();
    const cx = (tx + .5) * TS, cy = (ty + .5) * TS;
    burst(cx, cy - 10, 10, ['#ffe680', '#ffffff', '#bff08a'], { kind: 'spark', min: 30, max: 100, up: 60, r0: 1.5, r1: 3 });
    fly(cx, cy - 10, ICONS_CANVAS[c.t]);
    parts.push({ k: 'ghost', x: cx, y: (ty + 1) * TS - 6, vx: 0, vy: -34, g: 0, life: 0, max: .4, img: Art.crops[c.t][4] });
    P.hop = .3; bump($('bag'));
    floatText(cx, cy - 30, '+1 ' + CROPS[c.t].name, '#ffffff');
  }

  function harvestTree(o) {
    const key = TREE_KEYS[o.v], sp = TREE_SP[key], free = basketCap() - basketUsed();
    if (free <= 0) { toast('Cesto cheio — venda na caixa de vendas', 'bad'); Snd.error(); return; }
    const n = Math.min(free, 2 + Math.floor(Math.random() * 3));
    S.harvest[key] += n; S.stat.harvest++; o.fruit = 0; o.cd = TREE_REGROW; o.shake = .3; P.hop = .3;
    Snd.harvest(); const cx = (o.x + .5) * TS, cy = o.y * TS;
    burst(cx, cy + 6, 12, FRUIT_COLORS[key], { min: 20, max: 70, up: 30, r0: 2.4, r1: 4.2, life: 1.1 });
    fly(cx, cy + 20, ICONS_CANVAS[key]); floatText(cx, cy - 6, '+' + n + ' ' + sp.fruit, '#ffffff'); bump($('bag'));
  }
  function fellFx(tx, ty, img, n) {                 // animação da árvore tombando + madeira
    const cx = (tx + .5) * TS, cy = (ty + .5) * TS;
    parts.push({ k: 'fall', x: cx, y: (ty + 1) * TS + 4, vx: 0, vy: 0, g: 0, life: 0, max: .85, img, dirn: P.x < cx ? 1 : -1 });
    burst(cx, cy - 30, 26, ['#5fae3a', '#8ad44f', '#3f8a2a'], { kind: 'leaf', min: 60, max: 190, up: 100, r0: 2, r1: 4.5, life: 1.8 });
    burst(cx, cy, 14, ['#d9ae72', '#a77a43', '#7a4e26'], { min: 60, max: 170, up: 120, r0: 2, r1: 4.5 });
    floatText(cx, cy - 44, '+' + n + ' madeira', '#e0b57a'); Snd.rock(); shakeT = .25; bump($('bag'));
  }
  function fellTree(tr) {                           // árvore do cenário: some e deixa um toco
    const i = idx(tr.x, tr.y);
    trees.splice(trees.indexOf(tr), 1); treeGrid[i] = null; solid[i] = 0;
    S.felled.push([tr.x, tr.y]); addObs('stump', tr.x, tr.y, 0, 4);
    const n = 3 + Math.floor(Math.random() * 3); S.wood += n;
    fellFx(tr.x, tr.y, Art.trees[tr.v], n);
  }

  function interact(tx, ty) {
    const it = interactAt(tx, ty);
    if (Animals.isRiding() && (!it || it.type === 'dismount' || it.type === 'cavalo')) { Animals.dismount(); Snd.pop(); toast('Você desmontou.'); return; }
    if (!it) return;
    switch (it.type) {
      case 'door':
        if (S.min < SLEEP_FROM) { toast('Ainda é cedo para dormir — só depois das 18:00 🌆', 'bad'); Snd.error(); } else confirmSleep();
        break;
      case 'shop': openShop(); break;
      case 'bin': sellAll(); break;
      case 'well': case 'water':
        if (S.water >= canMax()) toast('O regador já está cheio.'); else { Snd.water(); S.water = canMax(); burst((tx + .5) * TS, (ty + .5) * TS, 16, ['#8fd8ff', '#bfe9ff', '#fff'], { min: 30, max: 100, up: 120 }); toast('Regador cheio! (' + S.water + ')', 'good'); }
        break;
      case 'coop': toast('As galinhas botam ovos 2× por dia: ao amanhecer e ao meio-dia. Pegue-os e venda!'); break;
      case 'crop': {
        const chk = { ok: basketUsed() < basketCap() };
        if (!chk.ok) { toast('Cesto cheio — venda na caixa de vendas', 'bad'); Snd.error(); }
        else { act = { tool: 'luvas', k: 'harvest', tx, ty, t: 0, dur: .3, applied: false, lock: true }; }
        break;
      }
      case 'egg': pickEggAt(tx, ty); break;
      case 'cachorro': case 'porco': {
        const a = it.ref; if (!a) break;
        if (it.type === 'porco' && it.ready) { takeMeat(a); break; }
        a.love = 1.6; a.hop = .25; if (a.kind === 'cachorro') Snd.bark(); else Snd.oink();
        for (let i = 0; i < 3; i++) setTimeout(() => heart(a.x + rnd(-12, 12), a.y - 36), i * 120);
        floatText(a.x, a.y - 52, a.kind === 'cachorro' ? 'Au au! 💕' : 'Oinc! 💕', '#ffd0dc'); break;
      }
      case 'vaca': milkCow(it.ref); break;
      case 'cavalo': {
        const a = it.ref; if (!Animals.mount(a)) break;
        if (!boxBlocked(a.x, a.y)) { P.x = a.x; P.y = a.y; }
        P.hop = .3; Snd.neigh(); toast('Montou! Cavalgue mais rápido. Pressione E para desmontar.', 'good'); break;
      }
      case 'dismount': Animals.dismount(); Snd.pop(); break;
      case 'truffle': {
        for (let i = S.truffleList.length - 1; i >= 0; i--) { const t = S.truffleList[i]; if (Math.floor(t[0] / TS) === tx && Math.floor(t[1] / TS) === ty) { S.truffleList.splice(i, 1); takeTruffle(t); } }
        break;
      }
      case 'ftree': {
        const o = obsAt(tx, ty); if (!o) break;
        const st = treeStage(o), sp = TREE_SP[TREE_KEYS[o.v]];
        if (st < 2) toast(sp.name + ' crescendo (' + Math.min(o.age, TREE_ADULT) + '/' + TREE_ADULT + ' dias)');
        else if (!o.fruit) toast(sp.name + ': sem frutas agora — volte em ' + Math.max(1, o.cd) + ' dia(s)');
        else harvestTree(o);
        break;
      }
      case 'dig': digTreasure(it.ref); break;
    }
  }

  function milkCow(a) {
    if (S.milked[a.idx]) { toast('Essa vaca já foi ordenhada hoje. Volte amanhã!'); return; }
    S.milked[a.idx] = true; S.milk++; S.stat.harvest++; a.hop = .25; a.moving = false; a.wait = Math.max(a.wait, 2.5);
    Snd.moo(); Snd.harvest();
    burst(a.x - 6, a.y - 14, 12, ['#ffffff', '#f4f8ff', '#dbe9ff'], { min: 25, max: 80, up: 60, r0: 1.8, r1: 3.4, life: 1 });
    floatText(a.x, a.y - 78, '+1 leite', '#ffffff'); fly(a.x, a.y - 30, ICONS_CANVAS.milk); bump($('bag'));
  }
  function takeMeat(a) {
    if (!Animals.meatReady(S, a)) { toast('Esse porco já deu carne agora. Volte ' + (S.min < Animals.MIDDAY ? 'à tarde (13:00)' : 'amanhã') + '!'); return; }
    S.meatDone[a.idx] = (S.meatDone[a.idx] || 0) + 1; S.meat++; S.stat.harvest++; a.hop = .25; a.moving = false; a.wait = Math.max(a.wait, 2.5);
    Snd.oink(); Snd.harvest();
    burst(a.x, a.y - 16, 12, ['#ffb0b8', '#ff8f9c', '#fff0f0'], { min: 25, max: 80, up: 60, r0: 1.8, r1: 3.4, life: 1 });
    floatText(a.x, a.y - 60, '+1 carne', '#ffd0d6'); fly(a.x, a.y - 24, ICONS_CANVAS.meat); bump($('bag'));
  }
  function heart(x, y) { parts.push({ k: 'heart', x, y, vx: rnd(-10, 10), vy: -42, g: 0, life: 0, max: 1.1, r: rnd(5, 8), c: pick(['#ff6b8b', '#ff8fa8', '#ffb0c4']) }); }
  function takeTruffle(t) {
    S.truffle++; Snd.egg(); floatText(t[0], t[1] - 20, '+1 trufa', '#e6c9a8'); fly(t[0], t[1] - 8, ICONS_CANVAS.truffle); bump($('bag'));
  }
  function digTreasure(d) {
    const i = S.digs.indexOf(d); if (i >= 0) S.digs.splice(i, 1);
    const cx = (d[0] + .5) * TS, cy = (d[1] + .6) * TS, q = Math.random();
    burst(cx, cy, 16, ['#6e4a2a', '#8a6038', '#4a2e18'], { min: 40, max: 130, up: 120, r0: 2, r1: 4.5 }); Snd.till();
    const dg = Animals.dog(); if (dg) { dg.hop = .25; Snd.bark(); }
    if (q < .5) { const n = 25 + Math.floor(Math.random() * 60); S.gold += n; S.earned += n; floatText(cx, cy - 30, '+' + n + ' ◎', '#ffe680'); Snd.coin(); toast('O cachorro achou ' + n + ' ◎ enterrados!', 'gold'); checkGoals(); }
    else if (q < .85) { const ks = CROP_KEYS.filter(k => k === 'cenoura' || (k === 'tomate' && S.goal >= 1) || (k === 'milho' && S.goal >= 2) || (k === 'abobora' && S.goal >= 3)); const k = pick(ks), n = 2 + Math.floor(Math.random() * 3); S.seeds[k] += n; floatText(cx, cy - 30, '+' + n + ' ' + CROPS[k].name.toLowerCase(), '#bff08a'); Snd.harvest(); toast('Você desenterrou ' + n + ' sementes de ' + CROPS[k].name.toLowerCase() + '!', 'good'); }
    else { const n = 1 + Math.floor(Math.random() * 2); S.stone += n; floatText(cx, cy - 30, '+' + n + ' pedra', '#d6d3c8'); Snd.rock(); toast('Só pedras... mas rendem uns trocados.'); }
    burst(cx, cy - 10, 10, ['#ffe680', '#ffffff'], { kind: 'spark', min: 30, max: 90, up: 70, r0: 1.5, r1: 3 });
  }

  function pickEggAt(tx, ty) {
    for (let i = eggs.length - 1; i >= 0; i--) {
      const e = eggs[i];
      if (Math.floor(e.x / TS) === tx && Math.floor(e.y / TS) === ty) takeEgg(i);
    }
  }
  function takeEgg(i) {
    const e = eggs[i]; eggs.splice(i, 1); S.eggs++; Snd.egg();
    floatText(e.x, e.y - 20, '+1 ovo', '#fffaf0'); fly(e.x, e.y - 8, ICONS_CANVAS.egg);
  }

  function sellAll() {
    let total = 0, n = 0;
    for (const k of PROD_KEYS) { total += S.harvest[k] * prodSell(k); n += S.harvest[k]; }
    total += S.eggs * EGG_PRICE + S.stone * STONE_PRICE + S.wood * WOOD_PRICE + S.milk * MILK_PRICE + S.truffle * TRUFFLE_PRICE + S.meat * MEAT_PRICE;
    n += S.eggs + S.stone + S.wood + S.milk + S.truffle + S.meat;
    if (!n) { toast('Nada para vender. Colha algo primeiro!', 'bad'); Snd.error(); return; }
    PROD_KEYS.forEach(k => S.harvest[k] = 0); S.eggs = S.stone = S.wood = S.milk = S.truffle = S.meat = 0;
    S.gold += total; S.earned += total; S.stat.sold += n;
    Snd.coin(); toast('Vendeu ' + n + ' itens por ' + fmt(total) + ' ◎', 'gold');
    const cx = (BIN.x + 1) * TS, cy = BIN.y * TS - 20;
    floatText(cx, cy, '+' + fmt(total) + ' ◎', '#ffe680');
    burst(cx, cy + 10, 18, ['#ffe680', '#ffd24d', '#fff3b0'], { kind: 'spark', min: 40, max: 140, up: 160, r0: 2, r1: 4 });
    checkGoals(); requestSave();
  }

  function checkGoals() {
    while (S.goal < GOALS.length && S.earned >= GOALS[S.goal].at) {
      const gl = GOALS[S.goal]; S.goal++;
      if (gl.reward.seeds) for (const k in gl.reward.seeds) S.seeds[k] += gl.reward.seeds[k];
      if (gl.reward.gold) S.gold += gl.reward.gold;
      Snd.level(); toast('🏆 Meta de ' + fmt(gl.at) + ' ◎ atingida! ' + gl.text, 'gold');
      if (S.goal === GOALS.length && !S.won) { S.won = true; setTimeout(showWin, 1200); }
    }
  }

  function bushSpotOK(x, y) {
    if (blocked(x, y) || isWater(x, y) || isPath(x, y) || S.soil[idx(x, y)] !== 0 || cropAt(x, y)) return false;
    if (Math.hypot(x * TS - P.x, y * TS - P.y) <= 3 * TS) return false;
    if (Animals.inArea(x, y, 2) || inRect({ x: COOP.x - 1, y: COOP.y - 1, w: 4, h: 5 }, x, y)) return false;
    if (S.digs.some(d => d[0] === x && d[1] === y)) return false;
    if (S.truffleList.some(t => Math.floor(t[0] / TS) === x && Math.floor(t[1] / TS) === y)) return false;
    if (eggs.some(e => Math.floor(e.x / TS) === x && Math.floor(e.y / TS) === y)) return false;
    return true;
  }

  // postura das galinhas (2× por dia: ao amanhecer e ao meio-dia); devolve quantos ovos apareceram
  function layEggs() {
    let n = 0;
    for (const ch of chickens) if (Math.random() < .8) {
      for (let tries = 0; tries < 16; tries++) {
        const tx = COOP.x + Math.floor(rnd(-2, 5)), ty = COOP.y + Math.floor(rnd(-1, 5));
        if (!blocked(tx, ty) && !isWater(tx, ty) && !eggs.some(e => Math.floor(e.x / TS) === tx && Math.floor(e.y / TS) === ty)) { eggs.push({ x: (tx + .5) * TS + rnd(-10, 10), y: (ty + .6) * TS }); n++; break; }
      }
    }
    return n;
  }

  /* ---------------- dia / sono ---------------- */
  function endDay(passedOut) {
    // crescimento
    for (const key in S.crops) {
      const c = S.crops[key], [x, y] = key.split(',').map(Number), i = idx(x, y);
      if (S.soil[i] === 2) c.age++;
    }
    for (let i = 0; i < S.soil.length; i++) if (S.soil[i] === 2) S.soil[i] = 1;
    for (const o of obs) if (o.type === 'ftree') {       // árvores frutíferas: crescem e voltam a dar frutas
      o.age++;
      if (o.age >= TREE_ADULT && !o.fruit) { if (o.cd > 0) o.cd--; if (o.cd <= 0) o.fruit = 1; }
    }
    S.day++; S.min = DAY_START;
    S.energy = passedOut ? Math.max(S.energy, 55) : 100;
    if (!passedOut) S.energy = 100;
    S.rain = S.day > 2 && Math.random() < .24;
    if (S.rain) { for (let i = 0; i < S.soil.length; i++) if (S.soil[i] > 0) S.soil[i] = 2; S.water = canMax(); }
    // ovos: 1ª postura da manhã (a 2ª vem ao meio-dia, em update)
    eggs.length = 0; layEggs(); S.laid = 1;
    // animais: ordenha e carne renovadas, trufas e tesouro do cachorro
    Animals.resetMorning(); S.milked = []; S.meatDone = []; S.truffleList = [];
    for (const pg of Animals.pigs()) if (Math.random() < .75) {
      for (let tries = 0; tries < 10; tries++) {
        const tx = Math.floor(rnd(Animals.IN.x0 + 1, Animals.IN.x1)), ty = Math.floor(rnd(Animals.IN.y0 + 1, Animals.IN.y1));
        if (!blocked(tx, ty)) { S.truffleList.push([(tx + .5) * TS + rnd(-8, 8), (ty + .65) * TS]); break; }
      }
    }
    for (let tries = 0; tries < 30; tries++) {
      const x = 3 + Math.floor(Math.random() * (MW - 6)), y = 7 + Math.floor(Math.random() * (MH - 12));
      if (!blocked(x, y) && !isWater(x, y) && !isPath(x, y) && S.soil[idx(x, y)] === 0 && !cropAt(x, y) && !Animals.inArea(x, y, 1) && !inRect(COOP, x, y) && !S.digs.some(d => d[0] === x && d[1] === y)) { S.digs.push([x, y]); break; }
    }
    while (S.digs.length > 3) S.digs.shift();
    // mato novo (com limite, e longe de curral, galinheiro, ovos, trufas e tesouros)
    let bushes = 0; for (const o of obs) if (o.type === 'bush') bushes++;
    for (let n = 0; n < 4 && bushes < MAX_BUSH; n++) {
      const x = 3 + Math.floor(Math.random() * (MW - 6)), y = 7 + Math.floor(Math.random() * (MH - 10));
      if (bushSpotOK(x, y)) { addObs('bush', x, y, Math.floor(Math.random() * 3), 1); bushes++; }
    }
    P.x = SPAWN.x; P.y = SPAWN.y; P.dir = 0; act = null;
    S.stat.sleep++;
    save();
  }

  function sleepSequence(passedOut) {
    modalOpen = true; paused = true; sleeping = true;
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#05030a;opacity:0;transition:opacity .9s;z-index:30;display:flex;align-items:center;justify-content:center;color:#f6ebcf;font:bold 26px Georgia,serif;text-align:center;padding:20px';
    f.innerHTML = passedOut ? 'Você desmaiou de cansaço...<br><small style="font-size:16px;font-weight:normal">acordou com energia parcial</small>' : 'Boa noite, ' + CHAR.name + '...';
    document.body.appendChild(f);
    Snd.sleep();
    requestAnimationFrame(() => f.style.opacity = 1);
    setTimeout(() => {
      endDay(passedOut);
      f.innerHTML = 'Dia ' + S.day + (S.rain ? '<br><small style="font-size:16px;font-weight:normal">🌧️ Está chovendo — as plantas foram regadas!</small>' : '<br><small style="font-size:16px;font-weight:normal">☀️ Bom dia!</small>');
      updateHud(true);
    }, 1100);
    setTimeout(() => { f.style.opacity = 0; }, 2300);
    setTimeout(() => { for (const k in S.crops) { S.crops[k].pt = time; S.crops[k].pk = 'grow'; }
      for (const o of obs) if (o.type === 'ftree') o.pt = time;
      for (const e of eggs) burst(e.x, e.y - 8, 10, ['#fffaf0', '#ffe680', '#ffffff'], { kind: 'spark', min: 30, max: 90, up: 70, r0: 1.5, r1: 3 });
      f.remove(); sleeping = false; modalOpen = false; paused = false; $('modal').classList.add('hidden'); }, 3200);
  }

  /* ---------------- modais ---------------- */
  function setModal(html) {
    $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); modalOpen = true; paused = true; document.body.classList.add('modalOpen');
  }
  function closeModal() {
    $('modal').classList.add('hidden'); modalOpen = false; paused = false; document.body.classList.remove('modalOpen');
  }
  $('modal').addEventListener('mousedown', e => { if (e.target.id === 'modal' && currentModal !== 'win' && currentModal !== 'stale') closeModal(); });
  let currentModal = '', pendingResetRaw = null;

  function confirmSleep() {
    currentModal = 'sleep';
    setModal(`<h2>🌙 Ir dormir?</h2><p>O dia termina agora. Plantas <b>regadas</b> crescem durante a noite, os ovos são repostos e sua energia volta a 100.</p>
      <div class="modalBtns"><button class="mb alt" data-a="close">Ainda não</button><button class="mb" data-a="sleep">Dormir</button></div>`);
  }

  function openShop() {
    currentModal = 'shop';
    const seedRows = CROP_KEYS.map(k => {
      const c = CROPS[k], unlocked = k === 'cenoura' || (k === 'tomate' && S.goal >= 1) || (k === 'milho' && S.goal >= 2) || (k === 'abobora' && S.goal >= 3);
      const need = k === 'tomate' ? GOALS[0].at : k === 'milho' ? GOALS[1].at : GOALS[2].at;
      const ok = unlocked || S.seeds[k] > 0;
      return `<div class="item"><img src="${ICONS[k]}"><div class="txt"><b>${c.name} <small>(${c.days} dias · vende ${c.sell} ◎)</small></b>
        <small>Semente ${c.seed} ◎ · você tem ${S.seeds[k]} ${unlocked ? '' : '· 🔒 ganhe ' + fmt(need) + ' ◎ para liberar'}</small></div>
        <div class="btns"><button class="mb" data-a="buy" data-k="${k}" data-n="1" ${!unlocked || S.gold < c.seed ? 'disabled' : ''}>+1</button>
        <button class="mb" data-a="buy" data-k="${k}" data-n="5" ${!unlocked || S.gold < c.seed * 5 ? 'disabled' : ''}>+5 · ${c.seed * 5}</button></div></div>`;
    }).join('');
    const treeRows = TREE_KEYS.map(k => {
      const t = TREE_SP[k];
      return `<div class="item"><img src="${ICONS[k + '_sapling']}"><div class="txt"><b>${t.name} <small>(${t.fruit.toLowerCase()} · vende ${t.sell} ◎)</small></b>
        <small>Muda ${t.cost} ◎ · adulta em ${TREE_ADULT} dias; depois 2–4 frutas a cada ${TREE_REGROW} dias · você tem ${S.seeds[k]}</small></div>
        <div class="btns"><button class="mb" data-a="buytree" data-k="${k}" ${S.gold < t.cost ? 'disabled' : ''}>${t.cost} ◎</button></div></div>`;
    }).join('');
    const animalRows = Object.keys(ANIMAL_SHOP).map(k => {
      const a = ANIMAL_SHOP[k], have = S.owned[k] || 0, maxed = have >= a.max;
      return `<div class="item"><img src="${a.img}"><div class="txt"><b>${a.name} <small>(${have}/${a.max})</small></b><small>${a.info}</small></div>
        <div class="btns">${maxed ? '<small>no limite</small>' : `<button class="mb" data-a="animal" data-k="${k}" ${S.gold < a.cost ? 'disabled' : ''}>${a.cost} ◎</button>`}</div></div>`;
    }).join('');
    const up = (name, img, lvl, costs, cur, nextTxt, key) => {
      const max = lvl >= costs.length - 1;
      return `<div class="item"><img src="${img}"><div class="txt"><b>${name}</b><small>${cur}${max ? ' · nível máximo' : ' → ' + nextTxt}</small></div>
        <div class="btns">${max ? '' : `<button class="mb" data-a="up" data-k="${key}" ${S.gold < costs[lvl + 1] ? 'disabled' : ''}>${costs[lvl + 1]} ◎</button>`}</div></div>`;
    };
    setModal(`<span class="money">◎ ${fmt(S.gold)}</span><h2>🛒 Empório</h2><p>Sementes, animais, comida e equipamento. Venda a colheita na caixa de vendas ao lado.</p>
      <h3>Sementes</h3>${seedRows}
      <h3>Árvores frutíferas <small style="text-transform:none;letter-spacing:0">(mudas · escolha com Q, plante em terra livre com a ferramenta 3)</small></h3>${treeRows}
      <h3>Animais do curral <small style="text-transform:none;letter-spacing:0">(a leste da fazenda)</small></h3>${animalRows}
      <h3>Comida</h3>
      <div class="item"><img src="${ICONS.pie}"><div class="txt"><b>Torta de maçã</b><small>Recupera 40 de energia · 22 ◎</small></div>
        <div class="btns"><button class="mb" data-a="eat" ${S.gold < 22 || S.energy >= 100 ? 'disabled' : ''}>Comer</button></div></div>
      <h3>Equipamento</h3>
      ${up('Cesto de vime', charSrc('basket'), S.up.basket, BASKET_COST, 'Capacidade ' + BASKET_CAP[S.up.basket], 'capacidade ' + BASKET_CAP[S.up.basket + 1], 'basket')}
      ${up('Regador maior', ICONS.can, S.up.can, CAN_COST, 'Capacidade ' + CAN_CAP[S.up.can], 'capacidade ' + CAN_CAP[S.up.can + 1], 'can')}
      ${up('Botas leves', ICONS.boots, S.up.boots, BOOTS_COST, 'Velocidade ' + Math.round(BOOTS[S.up.boots] * 100) + '%', 'velocidade ' + Math.round(BOOTS[S.up.boots + 1] * 100) + '%', 'boots')}
      <div class="modalBtns"><button class="mb alt" data-a="close">Fechar (Esc)</button></div>`);
  }

  function showWin() {
    currentModal = 'win';
    setModal(`<h2>🏆 Fazenda dos Sonhos!</h2><p>Parabéns, ${CHAR.name}! Você ganhou mais de <b>${fmt(GOALS[GOALS.length - 1].at)} ◎</b> com a sua fazenda em <b>${S.day}</b> dias.
      O vilarejo inteiro fala dos seus tomates e abóboras. Você pode continuar jogando e deixar a fazenda ainda maior!</p>
      <div class="modalBtns"><button class="mb" data-a="close">Continuar jogando</button></div>`);
  }

  function openMenu() {
    currentModal = 'menu';
    setModal(`<h2>☰ Pausa</h2>
      <div class="help"><b>Mover:</b> <kbd>W A S D</kbd> ou setas &nbsp; <b>Correr:</b> <kbd>Shift</kbd><br>
      <b>Ferramentas:</b> <kbd>1</kbd> Forcado · <kbd>2</kbd> Regador · <kbd>3</kbd> Sementes · <kbd>4</kbd> Luvas · <kbd>5</kbd> Picareta · <kbd>6</kbd> Machado (ou roda do mouse)<br>
      <b>Usar:</b> <kbd>Espaço</kbd> ou clique no terreno próximo &nbsp; <b>Interagir:</b> <kbd>E</kbd> &nbsp; <b>Trocar semente:</b> <kbd>Q</kbd> &nbsp; <b>Chamar o cachorro:</b> <kbd>C</kbd><br>
      <b>Música:</b> <kbd>M</kbd> &nbsp; <b>Efeitos:</b> <kbd>N</kbd> &nbsp; <b>Pausa:</b> <kbd>Esc</kbd></div>
      <h3>Como jogar</h3>
      <div class="help">① Are a terra com o <b>Forcado</b> → ② plante com as <b>Sementes</b> → ③ regue com o <b>Regador</b> (encha no poço ou na lagoa) →
      ④ depois das 18:00, durma na porta do celeiro para as plantas crescerem → ⑤ colha com as <b>Luvas</b> → ⑥ venda na <b>Caixa de Vendas</b>.<br>
      Pedras e tocos saem com a <b>Picareta</b>, o mato com o <b>Forcado</b>. As galinhas botam ovos 2× por dia (manhã e meio-dia) e os porcos dão carne 2× por dia. Dias com chuva regam tudo sozinhos!</div>
      <div class="modalBtns"><button class="mb red" data-a="resetask">Novo jogo</button><button class="mb alt" data-a="chars">Trocar personagem</button><button class="mb alt" data-a="rename">Alterar nome</button><button class="mb alt" data-a="save">Salvar</button><button class="mb" data-a="close">Continuar</button></div>`);
  }

  function openCharPicker() {
    currentModal = 'chars';
    setModal(`<h2>👤 Trocar personagem</h2><p>É só visual: seu progresso na fazenda continua o mesmo.</p><div class="cards inModal">${CHAR_IDS.map(id => cardHtml(CHARACTERS[id], id === S.char)).join('')}</div><div class="modalBtns"><button class="mb alt" data-a="close">Voltar</button></div>`);
  }
  function cardHtml(c, cur, edit) {
    const card = `<button class="charCard${cur ? ' cur' : ''}" data-a="char" data-k="${c.id}"><img src="${c.folder}/front_walk.png" alt="${c.name}"><b class="cn">${c.name}</b><span class="role">${c.role}</span><small>${c.desc}</small>${cur ? '<em>em uso</em>' : ''}</button>`;
    if (!edit) return card;
    return `<div class="charWrap">${card}<label class="nameField"><span>Nome</span><input type="text" maxlength="${NAME_MAX}" data-k="${c.id}" data-def="${c.defName}" value="${c.name}" placeholder="${c.defName}" autocomplete="off" autocapitalize="words" spellcheck="false"></label></div>`;
  }
  function openRename() {
    currentModal = 'rename';
    setModal(`<h2>✏️ Alterar nomes</h2><p>Escolha como cada personagem se chama. Seu progresso na fazenda continua o mesmo.</p>
      <div class="renameRows">${CHAR_IDS.map(id => `<label class="renameRow"><img src="${CHARACTERS[id].folder}/front_walk.png" alt=""><span>${CHARACTERS[id].role}</span><input type="text" maxlength="${NAME_MAX}" data-k="${id}" data-def="${CHARACTERS[id].defName}" value="${CHARACTERS[id].name}" placeholder="${CHARACTERS[id].defName}" autocomplete="off" autocapitalize="words" spellcheck="false"></label>`).join('')}</div>
      <div class="modalBtns"><button class="mb alt" data-a="close">Cancelar</button><button class="mb" data-a="renamesave">Salvar</button></div>`);
    const el = $('modalBox').querySelector('input[data-k="' + S.char + '"]'); if (el) { el.focus(); el.select(); }
  }

  $('modalBox').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) { const ok = $('modalBox').querySelector('[data-a=renamesave]'); if (ok) ok.click(); }
  });
  $('modalBox').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'close') closeModal();
    else if (a === 'sleep') { closeModal(); sleepSequence(false); }
    else if (a === 'buy') {
      const k = b.dataset.k, n = +b.dataset.n, c = CROPS[k]; const cost = c.seed * n;
      if (S.gold >= cost) { S.gold -= cost; S.seeds[k] += n; Snd.buy(); if (S.seeds[k] === n) { S.selSeed = k; } toast('Comprou ' + n + (n > 1 ? ' sementes' : ' semente') + ' de ' + c.name.toLowerCase() + ' (−' + cost + ' ◎)', 'good'); requestSave(); openShop(); } else Snd.error();
    } else if (a === 'buytree') {
      const k = b.dataset.k, t = TREE_SP[k];
      if (t && S.gold >= t.cost) { S.gold -= t.cost; S.seeds[k]++; if (S.seeds[k] === 1) S.selSeed = k; Snd.buy(); toast('Comprou uma muda de ' + t.name.toLowerCase() + ' (−' + t.cost + ' ◎). Plante com a ferramenta 3!', 'good'); requestSave(); openShop(); } else Snd.error();
    } else if (a === 'animal') {
      const k = b.dataset.k, an = ANIMAL_SHOP[k];
      if (an && S.gold >= an.cost && (S.owned[k] || 0) < an.max) { S.gold -= an.cost; S.owned[k] = (S.owned[k] || 0) + 1; Animals.add(k); Snd.buy(); if (k === 'vaca') Snd.moo(); else if (k === 'porco') Snd.oink(); else Snd.neigh(); toast('Comprou ' + an.name.toLowerCase() + ' (−' + an.cost + ' ◎) — já está no curral! 🐾', 'good'); requestSave(); openShop(); } else Snd.error();
    } else if (a === 'eat') {
      if (S.gold >= 22 && S.energy < 100) { const g = Math.min(40, 100 - S.energy); S.gold -= 22; S.energy += g; Snd.buy(); toast('Você comeu uma torta de maçã! Delícia! +' + Math.round(g) + ' de energia (−22 ◎)', 'good'); requestSave(); openShop(); }
    } else if (a === 'up') {
      const k = b.dataset.k, costs = k === 'basket' ? BASKET_COST : k === 'can' ? CAN_COST : BOOTS_COST, lvl = S.up[k] + 1;
      if (S.gold >= costs[lvl]) {
        S.gold -= costs[lvl]; S.up[k] = lvl; Snd.level(); if (k === 'can') S.water = canMax();
        const msg = k === 'basket' ? 'Cesto de vime melhorado! Capacidade ' + BASKET_CAP[lvl]
          : k === 'can' ? 'Regador maior! Capacidade ' + CAN_CAP[lvl] + ' (já está cheio)'
          : 'Botas leves! Velocidade ' + Math.round(BOOTS[lvl] * 100) + '%';
        toast(msg + ' (−' + costs[lvl] + ' ◎)', 'good'); requestSave(); openShop();
      } else Snd.error();
    } else if (a === 'chars') openCharPicker();
    else if (a === 'rename') openRename();
    else if (a === 'renamesave') {
      S.names = {}; $('modalBox').querySelectorAll('input[data-k]').forEach(i => { S.names[i.dataset.k] = cleanName(i.value, i.dataset.def); });
      applyNames(S.names); $('nameInfo').textContent = CHAR.name; document.title = 'FAZENDA LAS — ' + CHAR.name;
      Snd.pop(); toast('Nome salvo: ' + CHAR.name + '!', 'good'); save(); closeModal();
    }
    else if (a === 'char') { const k = b.dataset.k; if (CHARACTERS[k]) { S.char = k; setCharacter(k); buildHotbar(); Snd.pop(); toast('Agora você joga com ' + CHAR.name + '!', 'good'); save(); closeModal(); } }
    else if (a === 'save') { if (save(true).ok) toast('Jogo salvo!', 'good'); }
    else if (a === 'resetask') { currentModal = 'reset'; setModal(`<h2>Novo jogo</h2><p>Começar um novo jogo? O jogo atual será substituído (uma cópia de segurança fica guardada neste navegador).</p><div class="modalBtns"><button class="mb red" data-a="reset">Sim, apagar</button><button class="mb" data-a="close">Cancelar</button></div>`); }
    else if (a === 'reset' || a === 'resetforce') {       // R1: guarda cópia do jogo atual ANTES de apagar
      if (a === 'reset') save();                           // inclui o que foi feito desde o último autosave (se esta aba ainda pode salvar)
      const raw = prevSaveInfo().raw;
      if (a === 'reset' && raw !== null && !backupSave(raw)) {
        pendingResetRaw = raw; currentModal = 'reset';
        setModal(`<h2>Novo jogo</h2><p>Não foi possível guardar uma cópia do jogo atual (sem espaço no navegador). Baixe o save antes ou apague mesmo assim.</p>
          <div class="modalBtns"><button class="mb alt" data-a="resetdl">Baixar cópia (.json)</button><button class="mb red" data-a="resetforce">Apagar mesmo assim</button><button class="mb" data-a="close">Cancelar</button></div>`);
      } else { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage indisponível */ } running = false; location.reload(); }
    }
    else if (a === 'resetdl') { if (pendingResetRaw !== null) downloadText(saveFileName(), pendingResetRaw); }
    else if (a === 'stalereload') { running = false; location.reload(); }
    else if (a === 'staleuse') {       // R2: assume o controle: guarda o que a outra aba salvou e volta a gravar daqui
      try { const cur = storedInfo(); if (cur.raw !== null) backupSave(cur.raw); loadedRev = cur.rev === null ? 0 : cur.rev; } catch (e) { /* storage indisponível: save() avisa */ }
      staleTab = false; staleShown = false; slotKnown = false; const r = save(true); closeModal();       // slotKnown=false: se a outra aba APAGOU o save, esta pode recriá-lo (foi escolha do jogador)
      if (r.ok) toast('Esta aba agora salva o jogo. A cópia da outra aba ficou guardada.', 'good');
    }
    updateHud(true);
  });

  /* ---------------- HUD ---------------- */
  const ICONS_CANVAS = {};
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function buildHotbar() {
    const hb = $('hotbar'); hb.innerHTML = '';
    for (const k of Object.keys(hudCache)) if (k.startsWith('slot')) delete hudCache[k];
    TOOLS.forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'slot'; d.dataset.i = i;
      const src = t.id === 'regador' ? ICONS.can : t.id === 'machado' ? ICONS.axe : t.id === 'sementes' ? null : charSrc(t.img);
      d.innerHTML = `<span class="k">${i + 1}</span><img src="${src || ICONS[S.selSeed + '_seed']}" id="slotimg${i}"><span class="n" id="slotn${i}"></span>`;
      d.addEventListener('mousedown', e => { e.preventDefault(); selectTool(i); });
      hb.appendChild(d);
    });
  }
  function selectTool(i) {
    if (i === S.tool) return; S.tool = i; Snd.pop(); updateHud(true);
  }
  function cycleSeed(dirn = 1) {
    const avail = PROD_KEYS.filter(k => S.seeds[k] > 0);
    if (!avail.length) { toast('Você não tem sementes — compre na loja', 'bad'); return; }
    let i = avail.indexOf(S.selSeed); i = (i + dirn + avail.length) % avail.length; S.selSeed = avail[i];
    S.tool = 2; Snd.pop(); updateHud(true);
  }
  function updateHud(force) {
    if (!S) return;
    const hh = Math.floor(S.min / 60), mm = Math.floor(S.min % 60 / 10) * 10;
    setText('dayInfo', 'Dia ' + S.day);
    setText('timeInfo', String(hh % 24).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (hh >= 20 ? ' 🌙' : ''));
    setText('weatherInfo', S.rain ? '🌧️' : (hh >= 19 ? '🌆' : '☀️'));
    if (hudCache.moneyTxt === undefined) setText('moneyTxt', fmt(dispGold));
    const e = $('energyBar'); e.style.width = clamp(S.energy, 0, 100) + '%'; e.parentElement.classList.toggle('low', S.energy < 20);
    setText('energyTxt', 'Energia ' + Math.ceil(S.energy));
    $('waterBar').style.width = (S.water / canMax() * 100) + '%'; setText('waterTxt', 'Água ' + S.water + '/' + canMax());
    const gl = GOALS[Math.min(S.goal, GOALS.length - 1)], prev = S.goal > 0 ? GOALS[S.goal - 1].at : 0;
    if (S.goal >= GOALS.length) { setText('goalLabel', '🏆 Todas as metas concluídas!'); $('goalBar').style.width = '100%'; }
    else { setText('goalLabel', 'Meta: ' + fmt(S.earned) + ' / ' + fmt(gl.at) + ' ◎ ganhos'); $('goalBar').style.width = clamp((S.earned - prev) / (gl.at - prev) * 100, 0, 100) + '%'; }
    // hotbar
    document.querySelectorAll('.slot').forEach((el, i) => {
      el.classList.toggle('sel', i === S.tool);
      if (i === S.tool && hudCache.tool !== S.tool) { hudCache.tool = S.tool; bump(el); }
    });
    const si = $('slotimg2'); if (si) { const src = S.seeds[S.selSeed] > 0 || true ? ICONS[S.selSeed + '_seed'] : ''; if (si.getAttribute('src') !== src) si.setAttribute('src', src); }
    setText('slotn2', S.seeds[S.selSeed]);
    setText('slotn1', ''); setText('slotn3', ''); setText('slotn4', '');
    setText('toolName', TOOLS[S.tool].name + (S.tool === 2 ? ' · ' + (CROPS[S.selSeed] ? CROPS[S.selSeed].name : 'Muda de ' + TREE_SP[S.selSeed].name.toLowerCase()) : ''));
    // cesto
    const items = [];
    for (const k of PROD_KEYS) if (S.harvest[k]) items.push([ICONS[k], prodName(k), S.harvest[k]]);
    if (S.eggs) items.push([ICONS.egg, 'Ovos', S.eggs]);
    if (S.milk) items.push([ICONS.milk, 'Leite', S.milk]);
    if (S.meat) items.push([ICONS.meat, 'Carne', S.meat]);
    if (S.truffle) items.push([ICONS.truffle, 'Trufas', S.truffle]);
    if (S.stone) items.push([ICONS.stone, 'Pedras', S.stone]);
    if (S.wood) items.push([ICONS.wood, 'Madeira', S.wood]);
    const key = basketUsed() + '|' + basketCap() + '|' + items.map(i => i[1] + i[2]).join(',');
    if (hudCache.bag !== key) {
      if (hudCache.bag !== undefined) bump($('bag'));
      hudCache.bag = key;
      $('bag').innerHTML = `<div class="head"><img src="${charSrc('basket')}"> Cesto <small>${basketUsed()}/${basketCap()}</small></div>` +
        (items.length ? items.map(i => `<div class="row"><img src="${i[0]}">${i[1]}<b>${i[2]}</b></div>`).join('') : '<div class="empty">vazio</div>');
    }
    // tutorial
    const t = tutorialText();
    const tu = $('tutorial'), tg = $('tutToggle');
    if (!t) { tu.classList.add('hidden'); tg.classList.add('hidden'); return; }
    const compact = compactUI();
    if (hudCache.tut !== t) { hudCache.tut = t; tu.innerHTML = t; if (compact) showTut(); }
    const collapsed = compact && tutCollapsed;
    tu.classList.toggle('hidden', collapsed);
    tg.classList.toggle('hidden', !collapsed);
  }
  // no celular a dica some sozinha (vira o botão 💡) para não tampar o jogo
  let tutCollapsed = false, tutTimer = 0;
  function compactUI() { return matchMedia('(pointer:coarse), (max-width: 760px)').matches; }
  function showTut() { tutCollapsed = false; clearTimeout(tutTimer); tutTimer = setTimeout(hideTut, 7000); }
  function hideTut() { tutCollapsed = true; clearTimeout(tutTimer); }
  $('tutorial').addEventListener('click', hideTut);
  $('tutToggle').addEventListener('click', showTut);
  function tutorialText() {
    const st = S.stat;
    if (st.till < 3) return 'Mova-se com <b>WASD</b>. Pressione <b>1</b> (Forcado) e <b>ESPAÇO</b> para arar a terra à sua frente (' + st.till + '/3).';
    if (st.plant < 3) return 'Agora pressione <b>3</b> (Sementes) e <b>ESPAÇO</b> sobre a terra arada para plantar (' + st.plant + '/3).';
    if (st.water < 3) return 'Pegue o Regador (<b>2</b>) e regue as plantas. Encha o regador no <b>poço</b> com <b>E</b> (' + st.water + '/3).';
    if (st.sleep < 1) return 'Depois das <b>18:00</b>, vá até a porta do celeiro (tábuas, no topo) e pressione <b>E</b> para <b>dormir</b> — as plantas regadas crescem de noite.';
    if (st.harvest < 1) return 'Quando a planta estiver madura, use as <b>Luvas</b> (<b>4</b>) ou <b>E</b> para colher.';
    if (st.sold < 1) return 'Venda a colheita na <b>Caixa de Vendas</b> com <b>E</b>. Depois compre mais sementes na loja!';
    return '';
  }

  /* ---------------- entrada ---------------- */
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (e.target && e.target.tagName === 'INPUT') {      // digitando um nome: não é comando do jogo (espaço, setas, letras...)
      if (k === 'escape' && running && modalOpen && currentModal !== 'stale') closeModal();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;            // Ctrl+C/N/M/E... são do navegador, não do jogo
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
    if (!running) return;
    if (sleeping) return;
    if (k === 'escape') { if (modalOpen) { if (currentModal !== 'stale') closeModal(); } else openMenu(); return; }
    if (modalOpen) { if (k === 'e' && currentModal === 'shop') closeModal(); return; }
    if (keys[k]) { /* repetição */ } else keys[k] = true;
    if (e.repeat && k !== ' ') return;
    if (k >= '1' && k <= '6') selectTool(+k - 1);
    else if (k === 'q' || k === 'tab') cycleSeed(e.shiftKey ? -1 : 1);
    else if (k === 'c') callDog();
    else if (k === 'm') toggleMusic();
    else if (k === 'n') toggleSfx();
    else if (k === 'e') { const [tx, ty] = targetTile(); if (mouseMode) faceTo(tx, ty); interact(tx, ty); }
    else if (k === ' ') { const [tx, ty] = targetTile(); if (mouseMode) faceTo(tx, ty); useTool(tx, ty, false); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function bindCanvas() {
    canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouseMode = true; });
    canvas.addEventListener('mouseleave', () => { mouse.on = false; });
    canvas.addEventListener('mousedown', e => {
      if (!running || modalOpen) return; Snd.init();
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouseMode = true;
      const [tx, ty] = hoverTile();
      if (!inb(tx, ty)) return;
      if (!inReach(tx, ty)) { toast('Muito longe — chegue mais perto', ''); return; }
      if (e.button === 2) interact(tx, ty); else useTool(tx, ty, true);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { if (!running || modalOpen) return; e.preventDefault(); selectTool((S.tool + (e.deltaY > 0 ? 1 : TOOLS.length - 1)) % TOOLS.length); }, { passive: false });
    // toque
    const touch = $('touch'), st = $('stick'), kn = $('knob');
    const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    if (isTouch) touch.classList.remove('hidden');
    const sMove = e => {
      const t = [...e.changedTouches].find(t => t.identifier === stick.id); if (!t) return;
      const dx = t.clientX - stick.ox, dy = t.clientY - stick.oy, m = Math.min(1, Math.hypot(dx, dy) / 50);
      const a = Math.atan2(dy, dx); stick.x = Math.cos(a) * m; stick.y = Math.sin(a) * m;
      kn.style.transform = `translate(${stick.x * 40}px,${stick.y * 40}px)`; e.preventDefault();
    };
    st.addEventListener('touchstart', e => { Snd.init(); const t = e.changedTouches[0]; stick.id = t.identifier; const r = st.getBoundingClientRect(); stick.ox = r.left + r.width / 2; stick.oy = r.top + r.height / 2; sMove(e); }, { passive: false });
    st.addEventListener('touchmove', sMove, { passive: false });
    const sEnd = e => { if ([...e.changedTouches].some(t => t.identifier === stick.id)) { stick.id = null; stick.x = stick.y = 0; kn.style.transform = ''; } };
    st.addEventListener('touchend', sEnd); st.addEventListener('touchcancel', sEnd);
    const tb = (id, fn) => $(id).addEventListener('touchstart', e => { e.preventDefault(); Snd.init(); if (running && !modalOpen) fn(); }, { passive: false });
    tb('tbAct', () => { mouseMode = false; const [tx, ty] = facingTile(); useTool(tx, ty, false); });
    tb('tbUse', () => { mouseMode = false; const [tx, ty] = facingTile(); interact(tx, ty); });
    tb('tbTool', () => selectTool((S.tool + 1) % TOOLS.length));
    tb('tbSeed', () => cycleSeed(1));
    tb('tbDog', () => callDog());
  }
  // assobia para o cachorro: ele larga o passeio, vem correndo e acompanha você por um tempo
  function callDog() {
    const was = Animals.dogFollowing();
    if (!Animals.callDog()) return;
    Snd.bark(); floatText(P.x, P.y - 96, 'Vem cá! 🐕', '#fff3c0');
    toast(was ? 'O cachorro continua com você. 🐕' : 'Você chamou o cachorro! Ele está vindo. 🐕', 'good');
  }
  function toggleMusic() { Snd.init(); const off = Snd.toggleMusic(); $('btnMusic').textContent = off ? '🔕' : '🎵'; toast(off ? 'Música desligada' : 'Música ligada 🎵'); }
  function toggleSfx() { Snd.init(); const off = Snd.toggle(); $('btnMute').textContent = off ? '🔇' : '🔊'; toast(off ? 'Efeitos sonoros desligados' : 'Efeitos sonoros ligados'); }
  $('btnMute').addEventListener('click', toggleSfx);
  $('btnMusic').addEventListener('click', toggleMusic);
  $('btnMenu').addEventListener('click', () => { if (running && !modalOpen) openMenu(); });

  /* ---------------- galinhas ---------------- */
  function spawnChickens() {
    chickens = [];
    for (let i = 0; i < N_CHICKENS; i++) chickens.push({ x: (COOP.x + .6 + i * .75) * TS, y: (COOP.y + 2.6 + (i % 2) * .6) * TS, tx: 0, ty: 0, dir: i % 2 ? 1 : -1, wait: rnd(0, 2), moving: false, peck: 0, off: rnd(0, 9) });
  }
  function updateChickens(dt) {
    for (const c of chickens) {
      if (c.cd > 0) c.cd -= dt; if (c.flee > 0) c.flee -= dt; if (c.hop > 0) c.hop -= dt;
      if (P.moving && !(c.flee > 0) && Math.hypot(c.x - P.x, c.y - P.y) < 72) {   // assusta as galinhas
        c.flee = 1.1; c.moving = true; c.hop = .3;
        const a = Math.atan2(c.y - P.y, c.x - P.x) + rnd(-.5, .5);
        c.tx = c.x + Math.cos(a) * 130; c.ty = c.y + Math.sin(a) * 90;
        if (!(c.cd > 0)) { Snd.cluck(); c.cd = 3; }
      }
      if (c.moving) {
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        if (d < 3) { c.moving = false; c.wait = rnd(1, 4); }
        else {
          const spd = c.flee > 0 ? 105 : 38, nx = c.x + dx / d * spd * dt, ny = c.y + dy / d * spd * dt;
          if (blocked(Math.floor(nx / TS), Math.floor(ny / TS)) || isWater(Math.floor(nx / TS), Math.floor(ny / TS))) { c.moving = false; c.wait = .5; }
          else { c.x = nx; c.y = ny; if (Math.abs(dx) > 2) c.dir = dx < 0 ? -1 : 1; }
        }
      } else {
        c.wait -= dt; c.peck = Math.sin(time * 9 + c.off) > .2 && c.wait > .3 ? 1 : 0;
        if (c.wait <= 0) {
          c.tx = (COOP.x + 1) * TS + rnd(-3.3, 4.2) * TS; c.ty = (COOP.y + 2.5) * TS + rnd(-1.4, 3) * TS; c.moving = true;
        }
      }
    }
    // pegar ovos ao chegar perto
    for (let i = eggs.length - 1; i >= 0; i--) {
      if (Math.hypot(eggs[i].x - P.x, eggs[i].y - P.y) < 30) takeEgg(i);
    }
  }

  /* ---------------- atualização ---------------- */
  function update(dt) {
    time += dt;
    if (staleTab && !staleShown && !modalOpen && !sleeping) showStaleModal();      // R2: avisa quando der (não por cima de loja/sono)
    if (!paused) {
      S.min += dt * MIN_PER_SEC;
      if (S.min >= DAY_END) { sleepSequence(true); return; }
      if (cooldown > 0) cooldown -= dt;
      movePlayer(dt);
      { const mv = P.moving && !(act && act.lock); P.wk += ((mv ? 1 : 0) - P.wk) * Math.min(1, dt * 11); P.idleT = (mv || act) ? 0 : P.idleT + dt; }
      if (act) {
        act.t += dt;
        if (!act.applied && act.t >= act.dur * .55) { act.applied = true; applyAct(act); }
        if (act.t >= act.dur) { act = null; cooldown = .04; }
      }
      if (keys[' '] && !act && cooldown <= 0 && !modalOpen) {
        const [tx, ty] = targetTile(); if (mouseMode) faceTo(tx, ty); useTool(tx, ty, false, true);
      }
      if (act && act.tool === 'regador' && act.t > act.dur * .3 && act.k === 'water' && Math.random() < .6) {
        const cx = (act.tx + .5) * TS, cy = (act.ty + .5) * TS;
        parts.push({ k: 'dot', x: P.x + DX[P.dir] * 22, y: P.y - 34, vx: DX[P.dir] * 60 + rnd(-10, 10), vy: rnd(-10, 20), g: 500, life: 0, max: .35, r: 2.2, c: '#9fdcff' });
      }
      if (S.laid < 2 && S.min >= Animals.MIDDAY) {          // 2ª postura do dia
        S.laid = 2;
        if (layEggs()) { Snd.cluck(); toast('🥚 As galinhas botaram mais ovos! Pegue-os no galinheiro.', 'good'); }
      }
      updateChickens(dt);
      Animals.update(dt, S);
      chirpT -= dt;
      if (chirpT <= 0) { chirpT = rnd(4, 11); if (S.min < 18 * 60 && !S.rain && !Snd.muted) Snd.chirp(); }
      if (time - lastSave > 25) { lastSave = time; save(); }
    }
    // partículas
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      if (p.k === 'fly') continue;
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    // chuva
    if (S && S.rain && running) {
      while (rain.length < 220) rain.push({ x: Math.random() * W, y: Math.random() * H, l: rnd(10, 22), s: rnd(700, 1000) });
      for (const r of rain) { r.y += r.s * dt; r.x -= r.s * .18 * dt; if (r.y > H) { r.y = -20; r.x = Math.random() * (W + 200); } if (r.x < -20) r.x = W + 10; }
    } else rain.length = 0;
    // câmera
    const vw = W / zoom, vh = H / zoom;
    const tx = clamp(P.x - vw / 2, 0, Math.max(0, MW * TS - vw)), ty = clamp(P.y - 40 - vh / 2, 0, Math.max(0, MH * TS - vh));
    if (MW * TS < vw) cam.x = (MW * TS - vw) / 2; else cam.x = lerp(cam.x, tx, Math.min(1, dt * 8));
    if (MH * TS < vh) cam.y = (MH * TS - vh) / 2; else cam.y = lerp(cam.y, ty, Math.min(1, dt * 8));
    for (const o of obs) if (o.shake > 0) o.shake -= dt;
    for (const t of trees) if (t.shake > 0) t.shake -= dt;
    if (shakeT > 0) shakeT -= dt;
    if (P.hop > 0) P.hop -= dt;
    updateAmbient(dt);
    // dinheiro "rola" até o valor real
    if (dispGold !== S.gold) {
      const prev = dispGold; dispGold += (S.gold - dispGold) * Math.min(1, dt * 7);
      if (Math.abs(S.gold - dispGold) < 1) dispGold = S.gold;
      setText('moneyTxt', fmt(dispGold));
      if (S.gold > prev && !hudCache.moneyBump) { hudCache.moneyBump = 1; bump($('money')); setTimeout(() => hudCache.moneyBump = 0, 350); }
    }
    moodT -= dt; if (moodT <= 0) { moodT = .5; Snd.setMood(S.rain ? 'rain' : (S.min >= 19.5 * 60 ? 'night' : 'day'), S.rain); }
    hudT += dt; if (hudT > .1) { hudT = 0; updateHud(); }
  }


  /* ---------------- ambiente animado ---------------- */
  function makeCloudSprites() {
    cloudSprites = [0, 1].map(v => Art.mk(360, 200, c => {
      const r = Art.mulberry32(50 + v);
      for (let i = 0; i < 9; i++) {
        const x = 60 + r() * 240, y = 60 + r() * 80, rad = 40 + r() * 50;
        const gr = c.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(10,35,10,.5)'); gr.addColorStop(1, 'rgba(10,35,10,0)');
        c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }));
  }
  function initAmbient() {
    clouds = []; butterflies = []; birds = []; flies = []; splashes = [];
    for (let i = 0; i < 6; i++) clouds.push({ x: rnd(0, MW * TS), y: rnd(0, MH * TS), v: i % 2, s: rnd(1.3, 2.3), sp: rnd(9, 20) });
  }
  const BF_COLS = ['#ffb347', '#7fc8ff', '#ff9ad5', '#ffe66d', '#c9a0ff'];

  function updateAmbient(dt) {
    const vw = W / zoom, vh = H / zoom, dayOK = S.min < 18 * 60 && !S.rain, nn = nightness();
    for (const c of clouds) { c.x += c.sp * dt; if (c.x > MW * TS + 100) { c.x = -360 * c.s; c.y = rnd(0, MH * TS); } }
    // borboletas
    if (dayOK && butterflies.length < 6 && Math.random() < dt * 1.5)
      butterflies.push({ x: cam.x + rnd(0, vw), y: cam.y + rnd(0, vh), a: rnd(0, 6.28), sp: rnd(26, 46), t: rnd(0, 9), col: pick(BF_COLS), al: 0 });
    for (let i = butterflies.length - 1; i >= 0; i--) {
      const b = butterflies[i]; b.t += dt; b.a += Math.sin(b.t * 1.7 + b.sp) * 2.4 * dt;
      b.x += Math.cos(b.a) * b.sp * dt; b.y += Math.sin(b.a) * b.sp * dt * .7;
      b.al = dayOK ? Math.min(1, b.al + dt) : b.al - dt;
      if ((!dayOK && b.al <= 0) || b.x < cam.x - 260 || b.x > cam.x + vw + 260 || b.y < cam.y - 200 || b.y > cam.y + vh + 200) butterflies.splice(i, 1);
    }
    // pássaros cruzando o céu
    birdT -= dt;
    if (dayOK && birdT <= 0) {
      birdT = rnd(25, 50); const n = 1 + Math.floor(rnd(0, 3)), dir = Math.random() < .5 ? 1 : -1, y0 = cam.y + rnd(.1, .6) * vh;
      for (let k = 0; k < n; k++) birds.push({ x: dir > 0 ? cam.x - 80 - k * 46 : cam.x + vw + 80 + k * 46, y: y0 + rnd(-30, 30), dir, sp: rnd(110, 150), t: rnd(0, 9) });
      Snd.chirp();
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i]; b.t += dt; b.x += b.dir * b.sp * dt; b.y += Math.sin(b.t * 2) * 12 * dt;
      if (b.x < cam.x - 300 || b.x > cam.x + vw + 300) birds.splice(i, 1);
    }
    // vagalumes à noite
    if (nn > .35 && !S.rain) {
      while (flies.length < 24) flies.push({ x: cam.x + rnd(0, vw), y: cam.y + rnd(0, vh), a: rnd(0, 6.28), t: rnd(0, 9), ph: rnd(0, 6.28) });
    } else if (flies.length) flies.length = Math.max(0, flies.length - 1);
    for (const f of flies) {
      f.t += dt; f.a += Math.sin(f.t * 1.3 + f.ph) * 2 * dt; f.x += Math.cos(f.a) * 18 * dt; f.y += Math.sin(f.a) * 14 * dt - 2 * dt;
      if (f.x < cam.x - 40) f.x += vw + 80; else if (f.x > cam.x + vw + 40) f.x -= vw + 80;
      if (f.y < cam.y - 40) f.y += vh + 80; else if (f.y > cam.y + vh + 40) f.y -= vh + 80;
    }
    // folhas ao vento
    leafT -= dt;
    if (leafT <= 0 && !S.rain && S.min < 19 * 60) {
      leafT = rnd(.5, 1.3);
      parts.push({ k: 'leaf', x: cam.x + rnd(-100, vw), y: cam.y - 10, vx: rnd(18, 45), vy: rnd(24, 46), g: 0, life: 0, max: rnd(5, 8), r: rnd(2.5, 4), c: pick(['#7bc043', '#a8d65a', '#d9a441']), rot: rnd(0, 6) });
    }
    // respingos de chuva (espaço de tela)
    if (S.rain) {
      if (Math.random() < dt * 45) splashes.push({ x: Math.random() * W, y: Math.random() * H, l: 0 });
    }
    for (let i = splashes.length - 1; i >= 0; i--) { splashes[i].l += dt; if (splashes[i].l > .35) splashes.splice(i, 1); }
  }

  function drawSkyLife() {
    // sombras de pássaros e borboletas no chão + corpos
    for (const b of butterflies) {
      const fy = b.y - 26 + Math.sin(b.t * 2.3) * 5, flap = Math.abs(Math.cos(b.t * 16));
      g.save(); g.globalAlpha = b.al * .16; g.fillStyle = '#000'; g.beginPath(); g.ellipse(b.x, b.y + 4, 5, 2, 0, 0, 7); g.fill(); g.restore();
      g.save(); g.globalAlpha = b.al; g.translate(b.x, fy); g.rotate(Math.cos(b.a) * .25); g.scale(1.6, 1.6);
      g.fillStyle = b.col; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = .6;
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * 3.4 * (.35 + flap * .65), -1.5, 4 * (.3 + flap * .7), 5.4, sx * -.45, 0, 7); g.fill(); g.stroke(); }
      g.fillStyle = '#2b1a0a'; g.fillRect(-.8, -4.5, 1.6, 9);
      g.restore();
    }
    for (const b of birds) {
      g.save(); g.globalAlpha = .14; g.fillStyle = '#000'; g.beginPath(); g.ellipse(b.x + 14, b.y + 70, 9, 3, 0, 0, 7); g.fill(); g.restore();
      const fl = Math.sin(b.t * 13) * 6;
      g.save(); g.translate(b.x, b.y - 34 + Math.sin(b.t * 2) * 3); g.scale(b.dir, 1);
      g.strokeStyle = '#2d2a2a'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-10, -fl); g.quadraticCurveTo(-5, -fl * .3 - 3, 0, 0); g.quadraticCurveTo(5, -fl * .3 - 3, 10, -fl); g.stroke();
      g.fillStyle = '#2d2a2a'; g.beginPath(); g.ellipse(1, 1, 4, 2.4, 0, 0, 7); g.fill();
      g.restore();
    }
  }

  /* ---------------- desenho ---------------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    g.imageSmoothingQuality = 'high';                 // mudar o tamanho do canvas reseta o contexto
    zoom = clamp(Math.min(W / 1180, H / 720), .62, 1.5);
  }

  function lightColor() {
    const h = S.min / 60;
    const stops = [[6, [255, 212, 168]], [8, [255, 255, 255]], [17, [255, 255, 255]], [19, [255, 196, 146]], [21, [124, 132, 200]], [24, [78, 90, 160]]];
    let c = stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (h >= stops[i][0] && h <= stops[i + 1][0]) { const t = (h - stops[i][0]) / (stops[i + 1][0] - stops[i][0]); c = stops[i][1].map((v, j) => lerp(v, stops[i + 1][1][j], t)); break; }
    }
    if (S.rain) c = [c[0] * .74, c[1] * .8, c[2] * .9];
    return c;
  }
  const nightness = () => clamp((S.min / 60 - 18) / 3, 0, 1);

  const windAmt = () => (.7 + .5 * Math.sin(time * .35) + .25 * Math.sin(time * 1.1)) * (S.rain ? 1.8 : 1);

  const WALK_FREQ = 8;                 // rad/s da fase de caminhada (1 passo = pi)
  const HIP = .55, HIP_PAD = .06;      // quadril (fração da altura) e sobreposição do tronco

  // perfil: tronco + duas metades de perna que giram a partir do quadril
  function drawSide(img, w, h, ph, wk, sway) {
    const iw = img.width, ih = img.height, sc = h / ih;
    const hipS = Math.round(ih * HIP), padS = Math.round(ih * HIP_PAD), splitS = Math.round(iw * .5);
    const x0 = -w / 2, top = -h + 6, hipD = hipS * sc, splitD = splitS * sc;
    const pivX = x0 + splitD, pivY = top + hipD, L = h - 6 - hipD;
    const s = Math.sin(ph), u = Math.abs(s);
    const open = .34 * wk * Math.pow(u, .85);                 // abertura do passo (rad)
    const liftL = 5.5 * wk * Math.pow(Math.max(0, -Math.cos(ph)), 2);   // perna de trás passa à frente
    const liftR = 5.5 * wk * Math.pow(Math.max(0, Math.cos(ph)), 2);
    const leg = (sx, sw, ang, lift, dx) => {
      g.save(); g.translate(pivX, pivY + L * (1 - Math.cos(ang)) - lift); g.rotate(ang); g.translate(-pivX, -pivY);
      g.drawImage(img, sx, hipS, sw, ih - hipS, x0 + dx, top + hipD, sw * sc, (ih - hipS) * sc); g.restore();
    };
    leg(0, splitS, open + (wk * .06 * Math.cos(ph)), liftL, 0);          // metade de trás
    leg(splitS, iw - splitS, -open - (wk * .06 * Math.cos(ph)), liftR, splitD);   // metade da frente
    // tronco (balança em oposição ao quadril)
    g.save(); g.translate(0, pivY); g.rotate(sway); g.translate(0, -pivY);
    g.drawImage(img, 0, 0, iw, hipS + padS, x0, top, w, (hipS + padS) * sc);
    g.restore();
  }

  // frente/costas: espelha a pose de passada com transição suave (sem "pulo")
  function drawFrontBack(img, w, h, ph, wk) {
    const s = Math.sin(ph) * wk, t = clamp((s + .22) / .44, 0, 1), m = t * t * (3 - 2 * t);   // 0 normal .. 1 espelhado
    const draw = (flip, a) => { g.save(); g.globalAlpha = a; if (flip) g.scale(-1, 1); g.drawImage(img, -w / 2, -h + 6, w, h); g.restore(); };
    if (wk < .05) { draw(false, 1); return; }
    // base sempre opaca; a outra pose entra por cima (evita ficar semitransparente)
    if (m < .5) { draw(false, 1); if (m > .02) draw(true, m); }
    else { draw(true, 1); if (m < .98) draw(false, 1 - m); }
  }

  function drawPlayerSprite() {
    const dir = P.dir, wk = P.wk, ph = P.walkT * WALK_FREQ, s = Math.sin(ph), u = Math.abs(s);
    const side = dir >= 2;
    let img = dir === 0 ? IMGS.front_walk : dir === 1 ? IMGS.back : IMGS.left_stand;
    const crossed = side && wk < .02 && P.idleT > 2.5;            // parado de lado: cruza os braços
    if (crossed) img = IMGS.front_stand;
    const h = 104, w = img.width * h / img.height;
    const bob = wk * (1 - u) * 3 + Math.sin(time * 2) * .6 * (1 - wk);   // corpo sobe no cruzamento das pernas
    let ox = 0, oy = 0, rot = side ? wk * .035 : wk * s * .03;
    if (act) { const k = Math.sin(clamp(act.t / act.dur, 0, 1) * Math.PI); ox = DX[dir] * 5 * k; oy = DY[dir] * 4 * k + 2 * k; }
    const hop = P.hop > 0 ? Math.sin(P.hop / .3 * Math.PI) * 14 : 0;
    const sq = wk * u * .03;
    g.save(); g.translate(P.x + ox + (side ? 0 : s * wk * 1.2), P.y - bob + oy - hop); g.rotate(rot); g.scale(1 + sq * .6, 1 - sq);
    if (dir === 2) g.scale(-1, 1);
    if (side && !crossed) drawSide(img, w, h, ph, wk, -wk * s * .03);
    else if (side) g.drawImage(img, -w / 2, -h + 6, w, h);
    else drawFrontBack(img, w, h, ph, wk);
    g.restore();
  }

  function drawActTool(behind) {
    if (!act) return;
    const isBehind = P.dir === 1; if (isBehind !== behind) return;
    const u = clamp(act.t / act.dur, 0, 1), tx = act.tx, ty = act.ty;
    const hx = P.x + (P.dir === 2 ? -16 : P.dir === 3 ? 16 : P.dir === 0 ? 14 : -14), hy = P.y - (P.dir === 1 ? 52 : 44);
    if (act.tool === 'forcado') {
      const im = IMGS.pitchfork, h = 78, w = im.width * h / im.height;
      const cx = (tx + .5) * TS, cy = (ty + .78) * TS;
      let off; if (u < .55) { const s = u / .55; off = -70 * (1 - s * s); } else off = -(u - .55) / .45 * 16;
      g.save(); g.translate(cx, cy + off); g.rotate(Math.PI + (P.dir === 2 ? .22 : P.dir === 3 ? -.22 : 0)); g.drawImage(im, -w / 2, 0, w, h); g.restore();
    } else if (act.tool === 'picareta' || act.tool === 'machado') {
      const im = act.tool === 'machado' ? Art.axe : IMGS.pickaxe, sz = 78, s = u < .55 ? (u / .55) : 1;
      const a = lerp(-.5, 1.5, s * s) * (u > .55 ? lerp(1, .85, (u - .55) / .45) : 1);
      g.save(); g.translate(hx, hy); if (P.dir === 2) g.scale(-1, 1);
      g.rotate(a); g.drawImage(im, -sz * .9, -sz * .9, sz, sz); g.restore();
    } else if (act.tool === 'regador') {
      const s = Math.sin(u * Math.PI); const side = P.dir === 2 ? -1 : 1;
      g.save(); g.translate(hx + DX[P.dir] * 10, hy - 2 + DY[P.dir] * 6); g.scale(side, 1); Art.drawCan(g, 0, 0, s * .55, 1.1); g.restore();
    } else if (act.tool === 'sementes') {
      const im = IMGS.seedbag_empty, h = 30, w = im.width * h / im.height, s = Math.sin(u * Math.PI);
      g.save(); g.translate(hx + DX[P.dir] * 8, hy + 10 - s * 14); g.rotate((P.dir === 2 ? -1 : 1) * s * .6); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore();
    } else if (act.tool === 'luvas') {
      const im = IMGS.glove1, h = 30, w = im.width * h / im.height, s = Math.sin(u * Math.PI), cxp = (tx + .5) * TS, cyp = (ty + .5) * TS;
      if (act.k === 'milk') {                     // balde embaixo da vaca e mãos apertando
        const b = Animals.IMGS.props.milk_bucket;
        if (b) { const bw = 32, bh = bw * b.height / b.width; g.save(); g.translate(cxp - 8, cyp + 16); g.rotate(Math.sin(u * Math.PI * 5) * .07); g.drawImage(b, -bw / 2, -bh, bw, bh); g.restore(); }
        g.save(); g.translate(cxp + 6, cyp - 10 + Math.sin(u * Math.PI * 6) * 4); g.rotate(.5); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore();
      } else if (act.k === 'pickTree') {          // luva sobe até a copa
        g.save(); g.globalAlpha = .7 + s * .3; g.translate(cxp, cyp - 54 - s * 22); g.rotate(Math.sin(u * 12) * .12); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore();
      } else {
        g.save(); g.globalAlpha = .6 + s * .4; g.translate(cxp, cyp - 18 - s * 16); g.drawImage(im, -w / 2, -h / 2, w, h); g.restore();
      }
    }
  }

  function drawIndicator(tx, ty) {
    const chk = toolCheck(tx, ty), it = interactAt(tx, ty);
    const good = chk.ok || (it && it.type !== 'coop');
    const x = tx * TS, y = ty * TS, pulse = .75 + Math.sin(time * 6) * .25;
    g.save();
    g.lineWidth = 3; g.strokeStyle = good ? `rgba(255,240,150,${pulse})` : 'rgba(255,255,255,.35)';
    g.fillStyle = good ? 'rgba(255,240,150,.12)' : 'rgba(255,255,255,.05)';
    g.fillRect(x + 2, y + 2, TS - 4, TS - 4);
    const L = 14; g.beginPath();
    [[x + 3, y + 3, 1, 1], [x + TS - 3, y + 3, -1, 1], [x + 3, y + TS - 3, 1, -1], [x + TS - 3, y + TS - 3, -1, -1]].forEach(([cx, cy, sx, sy]) => { g.moveTo(cx, cy + sy * L); g.lineTo(cx, cy); g.lineTo(cx + sx * L, cy); });
    g.stroke(); g.restore();
    hint.text = it && it.type !== 'crop' ? it.label : (it && it.type === 'crop' ? it.label : (chk.msg && !chk.ok ? '' : ''));
    hint.x = x + TS / 2; hint.y = y - 6;
  }

  function drawHint() {
    if (!hint.text) return;
    g.save(); g.font = 'bold 13px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
    const w = g.measureText(hint.text).width + 16, x = hint.x, y = hint.y - 16;
    g.fillStyle = 'rgba(30,18,8,.88)'; g.strokeStyle = '#ffd24d'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(x - w / 2, y - 13, w, 24, 8); g.fill(); g.stroke();
    g.fillStyle = '#fff3c4'; g.textBaseline = 'middle'; g.fillText(hint.text, x, y); g.restore();
  }

  function drawPond() {
    const cx = POND.cx * TS, cy = POND.cy * TS, rx = POND.rx * TS * .96, ry = POND.ry * TS * .96;
    g.save();
    // borda
    g.fillStyle = 'rgba(60,40,20,.5)'; g.beginPath(); g.ellipse(cx, cy + 3, rx + 6, ry + 6, 0, 0, 7); g.fill();
    const gr = g.createRadialGradient(cx - rx * .3, cy - ry * .3, 10, cx, cy, rx);
    gr.addColorStop(0, '#5fb8d8'); gr.addColorStop(.6, '#2f86b4'); gr.addColorStop(1, '#1d5f8a');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 9; i++) {
      const a = (time * .15 + i * .7) % 1, px = cx + Math.sin(i * 2.3) * rx * .6, py = cy + Math.cos(i * 1.7) * ry * .55;
      g.strokeStyle = `rgba(255,255,255,${.35 * (1 - a)})`; g.lineWidth = 1.6; g.beginPath(); g.ellipse(px, py, 12 + a * 40, 4 + a * 14, 0, 0, 7); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.13)';
    for (let i = 0; i < 6; i++) { const px = cx + Math.sin(time * .5 + i * 1.9) * rx * .7, py = cy + Math.cos(time * .4 + i * 2.7) * ry * .6; g.beginPath(); g.ellipse(px, py, 22, 3, 0, 0, 7); g.fill(); }
    g.restore();
    // vitórias-régias
    const lp = [[-.55, -.2, 15], [.35, .25, 17], [-.1, .45, 12], [.6, -.35, 13]];
    for (const [ox, oy, r] of lp) {
      const x = cx + ox * rx, y = cy + oy * ry + Math.sin(time * 1.3 + ox * 5) * 1.2;
      g.fillStyle = '#3f9a3a'; g.beginPath(); g.ellipse(x, y, r, r * .55, 0, .3, 6.0); g.lineTo(x, y); g.fill();
      g.strokeStyle = '#256e2c'; g.lineWidth = 1.2; g.stroke();
      if (ox > 0) { g.fillStyle = '#ffd1e8'; g.beginPath(); g.arc(x + 2, y - 3, 4, 0, 7); g.fill(); g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(x + 2, y - 3, 1.6, 0, 7); g.fill(); }
    }
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; g.beginPath(); g.ellipse(cx, cy, rx - 3, ry - 3, 0, 3.5, 5.4); g.stroke();
    g.restore();
  }

  function drawSoilLayer(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const s = S.soil[idx(x, y)]; if (!s) continue;
      const fxo = tileFx.get(idx(x, y)); let u = 1;
      if (fxo) { u = (time - fxo.t) / .4; if (u >= 1 || u < 0) { tileFx.delete(idx(x, y)); u = 1; } }
      if (u < 1 && fxo.k === 'till') {
        g.save(); g.translate(x * TS + TS / 2, y * TS + TS / 2); const sc = .6 + .4 * easeOutBack(u); g.scale(sc, sc); g.globalAlpha = Math.min(1, u * 2);
        g.drawImage(tilledTile, -TS / 2, -TS / 2); g.restore();
      } else if (u < 1 && fxo.k === 'water' && s === 2) {
        g.drawImage(tilledTile, x * TS, y * TS); g.globalAlpha = u; g.drawImage(wetTile, x * TS, y * TS); g.globalAlpha = 1;
      } else g.drawImage(s === 2 ? wetTile : tilledTile, x * TS, y * TS);
      // bordas onde não há solo arado
      g.fillStyle = 'rgba(30,15,5,.34)';
      if (!inb(x, y - 1) || !S.soil[idx(x, y - 1)]) g.fillRect(x * TS, y * TS, TS, 3);
      if (!inb(x, y + 1) || !S.soil[idx(x, y + 1)]) g.fillRect(x * TS, y * TS + TS - 4, TS, 4);
      if (!inb(x - 1, y) || !S.soil[idx(x - 1, y)]) g.fillRect(x * TS, y * TS, 3, TS);
      if (!inb(x + 1, y) || !S.soil[idx(x + 1, y)]) g.fillRect(x * TS + TS - 3, y * TS, 3, TS);
    }
  }

  function drawBuildings(list, x0, y0, x1, y1) {
    const vis = (r) => r.x <= x1 + 1 && r.x + r.w >= x0 - 1 && r.y <= y1 + 1 && r.y + r.h >= y0 - 1;
    if (vis(BARN)) list.push({ y: (BARN.y + BARN.h) * TS - 10, d: () => g.drawImage(Art.barn, BARN.x * TS, (BARN.y + BARN.h) * TS - 320) });
    if (vis(STALL)) list.push({ y: (STALL.y + STALL.h) * TS - 8, d: () => g.drawImage(Art.stall, STALL.x * TS, (STALL.y + STALL.h) * TS - 150 + 6) });
    if (vis(SIGN)) list.push({ y: (SIGN.y + 1) * TS - 6, d: () => g.drawImage(Art.sign, SIGN.x * TS, (SIGN.y + 1) * TS - 104 + 8) });
    if (vis(BIN)) list.push({ y: (BIN.y + 1) * TS - 6, d: () => g.drawImage(Art.bin, BIN.x * TS, (BIN.y + 1) * TS - 92 + 10) });
    if (vis(WELL)) list.push({ y: (WELL.y + WELL.h) * TS - 8, d: () => g.drawImage(Art.well, WELL.x * TS, (WELL.y + WELL.h) * TS - 138 + 10) });
    if (vis(COOP)) list.push({ y: (COOP.y + COOP.h) * TS - 8, d: () => g.drawImage(Art.coop, COOP.x * TS, (COOP.y + COOP.h) * TS - 124 + 8) });
  }

  function render() {
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    g.fillStyle = '#1e3d1a'; g.fillRect(0, 0, W / zoom, H / zoom);
    const shk = shakeT > 0 ? shakeT * 22 : 0;
    g.save(); g.translate(-Math.round(cam.x) + (shk ? rnd(-shk, shk) : 0), -Math.round(cam.y) + (shk ? rnd(-shk, shk) : 0));
    const vw = W / zoom, vh = H / zoom;
    const x0 = Math.max(0, Math.floor(cam.x / TS) - 1), y0 = Math.max(0, Math.floor(cam.y / TS) - 1);
    const x1 = Math.min(MW - 1, Math.ceil((cam.x + vw) / TS) + 1), y1 = Math.min(MH - 1, Math.ceil((cam.y + vh) / TS) + 1);
    // chão
    const sx = x0 * TS, sy = y0 * TS, sw = (x1 - x0 + 1) * TS, sh = (y1 - y0 + 1) * TS;
    g.drawImage(groundCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    drawSoilLayer(x0, y0, x1, y1);
    drawPond();
    { // sombras de nuvens
      const a = .3 * (1 - nightness()) * (S.rain ? .3 : 1);
      if (a > .01 && cloudSprites) {
        g.save(); g.globalAlpha = a;
        for (const c of clouds) { const w = 360 * c.s, h = 200 * c.s; if (c.x + w < cam.x || c.x > cam.x + vw || c.y + h < cam.y || c.y > cam.y + vh) continue; g.drawImage(cloudSprites[c.v], c.x, c.y, w, h); }
        g.restore();
      }
    }
    hint.text = '';
    if (!modalOpen) { const [tx, ty] = targetTile(); if (inb(tx, ty) && !(act && act.lock && false)) drawIndicator(tx, ty); }

    // itens ordenados por profundidade
    const list = [];
    drawBuildings(list, x0, y0, x1, y1);
    for (const t of trees) {
      if (t.x < x0 - 1 || t.x > x1 + 1 || t.y < y0 - 2 || t.y > y1 + 3) continue;
      list.push({ y: (t.y + 1) * TS - 8, d: () => { g.save(); g.translate(t.x * TS + 32 + (t.shake > 0 ? Math.sin(t.shake * 80) * 3 : 0), (t.y + 1) * TS + 4); g.rotate(Math.sin(time * .9 + t.x * .7 + t.y * .3) * .011 * windAmt()); g.drawImage(Art.trees[t.v], -64, -176); g.restore(); } });
    }
    for (const o of obs) {
      if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1 + 1) continue;
      list.push({
        y: (o.y + 1) * TS - 10, d: () => {
          const sh = o.shake > 0 ? Math.sin(o.shake * 80) * 3 : 0;
          const im = o.type === 'rock' ? Art.rocks[o.v] : o.type === 'stump' ? Art.stump : Art.bushes[o.v];
          if (o.type === 'ftree') {
            const key = TREE_KEYS[o.v], st = treeStage(o), fim = Art.fruitTrees[key][st < 2 ? st : (o.fruit ? 3 : 2)];
            let sc = 1;
            if (o.pt !== undefined) { const u = (time - o.pt) / .55; if (u >= 0 && u < 1) sc = Math.max(.01, easeOutBack(u)); else delete o.pt; }
            g.save(); g.translate(o.x * TS + 32 + sh, (o.y + 1) * TS + 4); g.rotate(Math.sin(time * .9 + o.x * .7 + o.y * .3) * .011 * windAmt()); if (sc !== 1) g.scale(sc, sc);
            g.drawImage(fim, -64, -176); g.restore();
            if (st === 2 && o.fruit) { const tw = (Math.sin(time * 4 + o.x * 2 + o.y) + 1) / 2; g.fillStyle = `rgba(255,245,170,${.25 + tw * .55})`; g.beginPath(); g.arc(o.x * TS + 44, (o.y + 1) * TS - 108, 2 + tw * 2.4, 0, 7); g.fill(); }
            if (st === 2 && o.fruit && Math.hypot(P.x - (o.x + .5) * TS, P.y - (o.y + .5) * TS) < 6 * TS) {   // balão: fruta pronta
              const bx = (o.x + .5) * TS, by = (o.y + 1) * TS - 150 + Math.sin(time * 3 + o.x) * 2.5, ic = ICONS_CANVAS[key];
              g.save(); g.fillStyle = 'rgba(255,255,255,.93)'; g.strokeStyle = '#6b4a2a'; g.lineWidth = 2;
              g.beginPath(); g.arc(bx, by, 15, 0, 7); g.fill(); g.stroke();
              g.beginPath(); g.moveTo(bx - 4, by + 13); g.lineTo(bx, by + 20); g.lineTo(bx + 4, by + 13); g.fill();
              if (ic) g.drawImage(ic, bx - 12, by - 12, 24, 24);
              g.restore();
            }
            return;
          }
          if (o.type === 'bush') {
            g.save(); g.translate(o.x * TS + TS / 2 + sh, (o.y + 1) * TS + 4);
            g.transform(1, 0, Math.sin(time * 2 + o.x * 1.7 + o.y) * .09 * windAmt(), 1, 0, 0); g.drawImage(im, -im.width / 2, -im.height); g.restore();
          } else g.drawImage(im, o.x * TS + (TS - im.width) / 2 + sh, (o.y + 1) * TS - im.height + 4);
        }
      });
    }
    for (const key in S.crops) {
      const c = S.crops[key], i = key.indexOf(','), x = +key.slice(0, i), y = +key.slice(i + 1);
      if (x < x0 || x > x1 || y < y0 - 1 || y > y1 + 1) continue;
      list.push({
        y: (y + 1) * TS - 20, d: () => {
          const st = cropStage(c), sway = st >= 3 ? Math.sin(time * 1.6 + x * 1.3 + y) * .018 : 0;
          const spr = Art.crops[c.t][st];
          let sc = 1;
          if (c.pt !== undefined) {
            const u = (time - c.pt) / .55;
            if (u >= 0 && u < 1) sc = c.pk === 'new' ? Math.max(.01, easeOutBack(u)) : 1 + .2 * Math.sin(u * Math.PI);
            else { delete c.pt; delete c.pk; }
          }
          g.save(); g.translate(x * TS + 32, (y + 1) * TS - 6); g.rotate(sway * windAmt()); if (sc !== 1) g.scale(sc, sc); g.drawImage(spr, -32, -spr.height + 6); g.restore();
          if (st === 4) { const s = (Math.sin(time * 4 + x * 2 + y) + 1) / 2; g.fillStyle = `rgba(255,245,170,${.2 + s * .4})`; g.beginPath(); g.arc(x * TS + 50, y * TS + 14, 2 + s * 2.4, 0, 7); g.fill(); }
        }
      });
    }
    Animals.collect(list, { x0, y0, x1, y1 }, g, S, time);
    for (const e of eggs) list.push({ y: e.y, d: () => Art.drawEgg(g, e.x, e.y) });
    for (const ch of chickens) list.push({ y: ch.y, d: () => Art.drawChicken(g, ch.x, ch.y - (ch.hop > 0 ? Math.abs(Math.sin(ch.hop / .3 * Math.PI)) * 9 : 0), ch.dir, time + ch.off * (ch.flee > 0 ? 1.8 : 1), ch.moving, ch.peck) });
    list.push({
      y: P.y, d: () => {
        if (Animals.isRiding()) { Animals.drawMounted(g, P, IMGS, S); return; }
        Art.shadow(g, P.x, P.y - 1, 17, 6, .34);
        drawActTool(true); drawPlayerSprite(); drawActTool(false);
      }
    });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.d();

    drawSkyLife();
    // partículas
    for (const p of parts) {
      const t = p.life / p.max;
      if (p.k === 'text') {
        g.save(); g.globalAlpha = 1 - t * t; g.font = 'bold 17px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.fillStyle = p.c;
        g.strokeText(p.text, p.x, p.y); g.fillText(p.text, p.x, p.y); g.restore();
      } else if (p.k === 'fly') {
        const tx = P.x, ty = P.y - 50, e = t * t * (3 - 2 * t);
        const x = lerp(p.sx, tx, e) + Math.sin(e * Math.PI) * p.bend, y = lerp(p.sy, ty, e) - Math.sin(e * Math.PI) * 30;
        g.save(); g.globalAlpha = 1 - t * .6; const s = 1 - t * .5; g.translate(x, y); g.scale(s, s); g.drawImage(p.img, -14, -14, 28, 28); g.restore();
      } else if (p.k === 'heart') {
        g.save(); g.globalAlpha = 1 - t * t; g.translate(p.x + Math.sin(p.life * 6) * 3, p.y); const hs = p.r / 8 * (1 + Math.sin(p.life * 12) * .08); g.scale(hs, hs); g.fillStyle = p.c;
        g.beginPath(); g.moveTo(0, 3); g.bezierCurveTo(-9, -4, -5, -11, 0, -6); g.bezierCurveTo(5, -11, 9, -4, 0, 3); g.fill(); g.restore();
      } else if (p.k === 'ring') {
        g.save(); g.globalAlpha = (1 - t) * .8; g.strokeStyle = p.c; g.lineWidth = 2 * (1 - t) + .5;
        g.beginPath(); g.ellipse(p.x, p.y, p.r + t * p.grow, (p.r + t * p.grow) * .45, 0, 0, 7); g.stroke(); g.restore();
      } else if (p.k === 'fall') {
        g.save(); g.globalAlpha = 1 - t * t; g.translate(p.x, p.y); g.rotate(p.dirn * t * t * 1.45); g.drawImage(p.img, -64, -176); g.restore();
      } else if (p.k === 'ghost') {
        g.save(); g.globalAlpha = 1 - t; g.translate(p.x, p.y); const s2 = 1 + t * .25; g.scale(s2, s2 * (1 - t * .4)); g.drawImage(p.img, -32, -p.img.height + 6); g.restore();
      } else if (p.k === 'leaf') {
        g.save(); g.globalAlpha = p.max > 2 ? Math.min(1, (1 - t) * 4, t * 8) : 1 - t; g.translate(p.x, p.y); g.rotate(p.rot + p.life * 6); g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, p.r * 1.5, p.r * .7, 0, 0, 7); g.fill(); g.restore();
      } else if (p.k === 'spark') {
        g.save(); g.globalAlpha = 1 - t; g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; const r = p.r * (1 - t * .5);
        g.beginPath(); g.moveTo(0, -r * 1.6); g.lineTo(r * .5, 0); g.lineTo(0, r * 1.6); g.lineTo(-r * .5, 0); g.closePath(); g.fill(); g.restore();
      } else {
        g.globalAlpha = 1 - t * t; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r * (1 - t * .4), 0, 7); g.fill(); g.globalAlpha = 1;
      }
    }
    drawHint();
    g.restore();

    // iluminação
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lc = lightColor();
    if (lc[0] < 254 || lc[2] < 254) {
      g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${lc[0] | 0},${lc[1] | 0},${lc[2] | 0})`; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    const nn = nightness();
    if (nn > .05) { // brilho das luzes
      g.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0); g.translate(-Math.round(cam.x), -Math.round(cam.y));
      g.globalCompositeOperation = 'lighter';
      const lamp = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,210,120,${a * nn * (1 + .07 * Math.sin(time * 13) + .05 * Math.sin(time * 29.7))})`); gr.addColorStop(1, 'rgba(255,170,60,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
      lamp(BARN.x * TS + 224, 180, 150, .6); lamp(BARN.x * TS + 80, 228, 70, .45); lamp(BARN.x * TS + 364, 228, 70, .45); lamp(STALL.x * TS + 96, 4.4 * TS, 110, .4);
      lamp(P.x, P.y - 40, 130, .28);
      for (const f of flies) {
        const gl = nn * Math.max(0, .5 + .5 * Math.sin(f.t * 2.2 + f.ph)); if (gl < .05) continue;
        const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, 16); gr.addColorStop(0, `rgba(230,255,140,${gl})`); gr.addColorStop(1, 'rgba(200,255,100,0)');
        g.fillStyle = gr; g.fillRect(f.x - 16, f.y - 16, 32, 32);
        g.fillStyle = `rgba(255,255,210,${gl})`; g.beginPath(); g.arc(f.x, f.y, 1.4, 0, 7); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // chuva (tela)
    if (S.rain) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = 'rgba(200,225,255,.45)'; g.lineWidth = 1.4; g.beginPath();
      for (const r of rain) { g.moveTo(r.x, r.y); g.lineTo(r.x - r.l * .18, r.y - r.l); }
      g.stroke();
      g.strokeStyle = 'rgba(210,230,255,.5)'; g.lineWidth = 1;
      for (const sp of splashes) { const k = sp.l / .35; g.globalAlpha = (1 - k) * .6; g.beginPath(); g.ellipse(sp.x, sp.y, 2 + k * 11, (2 + k * 11) * .4, 0, 0, 7); g.stroke(); }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(70,90,120,.12)'; g.fillRect(0, 0, W, H);
    }
    // vinheta
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .45, W / 2, H / 2, Math.max(W, H) * .78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${.28 + nn * .2})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  /* ---------------- laço principal ---------------- */
  let last = 0;
  function frame(ts) {
    const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts;
    if (running) { update(dt); render(); }
    requestAnimationFrame(frame);
  }

  /* ---------------- início ---------------- */
  function makeIcons() {
    const mkc = (fn) => Art.mk(48, 48, fn);
    for (const k of CROP_KEYS) {
      const c = Art.crops[k][4]; ICONS[k] = Art.icon(c, 48);
      ICONS_CANVAS[k] = mkc(gg => { const sc = Math.min(44 / c.width, 44 / (c.height * .8)); gg.drawImage(c, 0, 12, c.width, c.height - 12, 24 - c.width * sc / 2, 24 - (c.height - 12) * sc / 2, c.width * sc, (c.height - 12) * sc); });
      ICONS[k + '_seed'] = mkc(gg => {
        const bag = IMGS.seedbag_empty, hh = 40, ww = bag.width * hh / bag.height; gg.drawImage(bag, 24 - ww / 2, 4, ww, hh);
        const small = Art.crops[k][4]; gg.drawImage(small, 0, 20, 64, 52, 24, 22, 26, 22);
      }).toDataURL();
    }
    ICONS.can = Art.icon(Art.canIcon, 48);
    const mb = Animals.IMGS.props.milk_bucket;
    ICONS.milk = mkc(gg => { const sc = Math.min(40 / mb.width, 42 / mb.height); gg.drawImage(mb, 24 - mb.width * sc / 2, 24 - mb.height * sc / 2, mb.width * sc, mb.height * sc); }).toDataURL();
    ICONS_CANVAS.milk = mkc(gg => { const sc = Math.min(40 / mb.width, 42 / mb.height); gg.drawImage(mb, 24 - mb.width * sc / 2, 24 - mb.height * sc / 2, mb.width * sc, mb.height * sc); });
    const trufa = gg => {
      const gr = gg.createRadialGradient(20, 20, 2, 24, 26, 18); gr.addColorStop(0, '#7a5a42'); gr.addColorStop(1, '#2a1a10');
      gg.fillStyle = gr; gg.beginPath(); gg.arc(24, 26, 15, 0, 7); gg.fill();
      gg.fillStyle = 'rgba(255,230,190,.25)'; for (const [x, y] of [[18, 20], [28, 18], [26, 28], [17, 31], [31, 27]]) { gg.beginPath(); gg.arc(x, y, 2, 0, 7); gg.fill(); }
    };
    ICONS.truffle = mkc(trufa).toDataURL(); ICONS_CANVAS.truffle = mkc(trufa);
    const carne = gg => {                       // presunto: pedaço rosado com osso
      gg.fillStyle = '#f4ead6'; gg.strokeStyle = '#c9b88e'; gg.lineWidth = 1.5;
      gg.fillRect(32, 30, 11, 5); gg.beginPath(); gg.arc(43, 29, 3.4, 0, 7); gg.arc(43, 36, 3.4, 0, 7); gg.fill(); gg.stroke();
      const gr = gg.createRadialGradient(18, 18, 3, 22, 24, 20); gr.addColorStop(0, '#f6a0a6'); gr.addColorStop(.6, '#d9566a'); gr.addColorStop(1, '#9c2a3e');
      gg.fillStyle = gr; gg.beginPath(); gg.ellipse(22, 25, 17, 14, -.5, 0, 7); gg.fill();
      gg.strokeStyle = '#7a1e30'; gg.lineWidth = 2; gg.stroke();
      gg.strokeStyle = 'rgba(255,225,225,.55)'; gg.lineWidth = 2; gg.beginPath(); gg.arc(22, 25, 8, 3.6, 5.2); gg.stroke();
    };
    ICONS.meat = mkc(carne).toDataURL(); ICONS_CANVAS.meat = mkc(carne);
    for (const k of TREE_KEYS) {
      ICONS[k] = Art.fruitIcons[k].toDataURL(); ICONS_CANVAS[k] = Art.fruitIcons[k];
      ICONS[k + '_sapling'] = Art.saplingIcons[k].toDataURL(); ICONS[k + '_seed'] = ICONS[k + '_sapling'];
    }
    ICONS.axe = Art.axe.toDataURL();
    ICONS.egg = mkc(gg => Art.drawEgg(gg, 24, 34)).toDataURL();
    ICONS_CANVAS.egg = mkc(gg => Art.drawEgg(gg, 24, 34));
    ICONS.stone = mkc(gg => gg.drawImage(Art.rocks[0], 4, 8, 40, 32)).toDataURL();
    ICONS.wood = mkc(gg => gg.drawImage(Art.stump, 6, 6, 36, 34)).toDataURL();
    ICONS.pie = mkc(gg => {
      gg.fillStyle = '#c98b3c'; gg.beginPath(); gg.ellipse(24, 30, 19, 9, 0, 0, 7); gg.fill();
      Art.ball(gg, 24, 24, 17, '#f0b868', '#b86a22', .62); gg.strokeStyle = '#8a4a14'; gg.lineWidth = 2;
      for (let i = -2; i <= 2; i++) { gg.beginPath(); gg.moveTo(24 + i * 6, 14); gg.lineTo(24 + i * 6 + 2, 26); gg.stroke(); }
    }).toDataURL();
    ICONS.boots = mkc(gg => {
      const gr = gg.createLinearGradient(0, 8, 0, 40); gr.addColorStop(0, '#a8703a'); gr.addColorStop(1, '#5c3a1c');
      gg.fillStyle = gr; gg.beginPath(); gg.moveTo(14, 6); gg.lineTo(28, 6); gg.lineTo(28, 26); gg.quadraticCurveTo(44, 26, 44, 36); gg.lineTo(44, 40); gg.lineTo(12, 40); gg.lineTo(12, 30); gg.closePath(); gg.fill();
      gg.strokeStyle = '#3b240f'; gg.lineWidth = 2; gg.stroke(); gg.fillStyle = '#3b240f'; gg.fillRect(12, 38, 32, 4);
    }).toDataURL();
    // retrato
    const p = $('portrait').getContext('2d'), im = IMGS.front_walk;
    p.fillStyle = '#9ec8e8'; p.fillRect(0, 0, 72, 72);
    const gr = p.createLinearGradient(0, 40, 0, 72); gr.addColorStop(0, '#9ec8e8'); gr.addColorStop(1, '#7fb050'); p.fillStyle = gr; p.fillRect(0, 40, 72, 32);
    p.imageSmoothingQuality = 'high';
    const sh = im.height * .26, sw = im.width * .86;
    p.drawImage(im, im.width * .07, 0, sw, sh, 0, 0, 72, 72 * sh / sw);
  }

  // seleciona o personagem ativo: troca os sprites, ícones e retrato
  function setCharacter(id) {
    CHAR = CHARACTERS[id] || CHARACTERS.fazendeiro;
    for (const n of SPRITE_LIST) IMGS[n] = CHAR_IMGS[CHAR.id][n];
    makeIcons();
    $('nameInfo').textContent = CHAR.name;
    document.title = 'FAZENDA LAS — ' + CHAR.name;
    hudCache.bag = undefined; hudCache.slot2 = undefined;
  }

  function startGame(loadIt, charId, names) {
    Snd.init();
    const loaded = loadIt ? loadSave() : null;
    const prev = loadIt ? null : prevSaveInfo();      // jogo novo: o save anterior só é substituído DEPOIS que o jogo novo iniciar (e com cópia)
    staleTab = false; staleShown = false; slotKnown = false;
    S = loaded && loaded.status === 'ok' ? loaded.state : newState();
    if (!loadIt) { S.char = CHARACTERS[charId] ? charId : 'fazendeiro'; }
    if (!CHARACTERS[S.char]) S.char = 'fazendeiro';
    if (!loadIt) { S.names = {}; for (const id of CHAR_IDS) S.names[id] = cleanName(names && names[id], CHARACTERS[id].defName); }
    applyNames(S.names);
    setCharacter(S.char);
    buildStatic();
    loadObs(S.obsInit ? S.obs : genObstacles()); S.obsInit = true;
    // limpar obstáculos sobre solo/ cultivo inválido
    for (const o of [...obs]) if (solid[idx(o.x, o.y)] || (o.type === 'bush' && (Animals.inArea(o.x, o.y, 0) || inRect(COOP, o.x, o.y)))) removeObs(o);   // (também limpa mato que saves antigos deixaram no curral)
    buildGround();
    spawnChickens();
    Animals.bind({ P, blocked, isWater, boxBlocked, shadow: Art.shadow, Snd, heart, takeTruffle, time: () => time, MW, MH, icons: ICONS_CANVAS,
      onScreen: (x, y) => x > cam.x - 100 && x < cam.x + W / zoom + 100 && y > cam.y - 100 && y < cam.y + H / zoom + 100 });
    Animals.spawn(S);
    eggs = (S.eggList || []).map(e => ({ x: e[0], y: e[1] }));
    P.x = S.px; P.y = S.py; P.dir = S.dir || 0;
    if (boxBlocked(P.x, P.y)) { P.x = SPAWN.x; P.y = SPAWN.y; }
    cam.x = clamp(P.x - W / zoom / 2, 0, Math.max(0, MW * TS - W / zoom)); cam.y = clamp(P.y - 40 - H / zoom / 2, 0, Math.max(0, MH * TS - H / zoom));
    dispGold = S.gold; initAmbient();
    buildHotbar(); updateHud(true);
    Snd.startMusic(); Snd.setMood(S.rain ? 'rain' : 'day', S.rain);
    $('title').classList.add('hidden'); $('hud').classList.remove('hidden');
    running = true; paused = false; modalOpen = false;
    if (!loadIt || S.day === 1) toast('Bem-vindo à fazenda, ' + CHAR.name + '! 🌾', 'good');
    if (S.rain) toast('🌧️ Hoje está chovendo — as plantas já estão regadas.');
    if (loadIt) { loadedRev = loaded && loaded.status === 'ok' ? loaded.rev : 0; slotKnown = loaded && loaded.status === 'ok'; if (loaded.repaired) toast('⚠ O save tinha dados inválidos que foram corrigidos. Uma cópia do original ficou guardada.', 'bad'); }
    else {      // R1: jogo novo iniciou — agora sim substitui o save anterior, depois de guardar uma cópia dele
      if (prev.raw !== null && !backupSave(prev.raw) && !eraseForced) toast('⚠ Não foi possível guardar cópia do jogo anterior (sem espaço no navegador).', 'bad');
      loadedRev = prev.rev === null ? 0 : prev.rev; save();
    }
    if (/[?&]debug\b/.test(location.search)) window.__game = { S, P, get act() { return act; }, useTool, interact, toast, endDay, sleepSequence, cropStage, targetTile, facingTile, chickens, get eggs() { return eggs; }, save, openShop, selectTool, startGame, setCharacter, get CHAR() { return CHAR; }, sellAll, Animals, get trees() { return trees; }, treeGrid, cam, getZoom: () => zoom, step: (dt) => { update(dt); render(); }, get obs() { return obs; }, TS, blocked, MW, MH };
  }

  async function boot() {
    const status = $('loading');
    const fail = msg => { $('loadTxt').textContent = msg; status.classList.remove('hidden'); status.classList.add('err'); };
    try {
      canvas = $('game'); g = canvas.getContext('2d'); g.imageSmoothingQuality = 'high';
      resize(); window.addEventListener('resize', resize);
      bindCanvas();
      // carregamento de imagens com tempo limite e novas tentativas: uma imagem travada na rede
      // não pode deixar o jogo preso em "Carregando..." para sempre
      let total = 0, done = 0;
      const tick = () => { $('loadTxt').textContent = 'Carregando... ' + Math.round(done / total * 100) + '%'; };
      const load = (src, store, key) => { total++; return new Promise(res => {
        let tries = 0;
        const attempt = () => {
          const i = new Image(); let over = false;
          const end = ok => {
            if (over) return; over = true; clearTimeout(tm);
            if (ok) store[key] = i;
            else if (++tries < 3) { attempt(); return; }
            else { console.warn('falha ao carregar', src); store[key] = Art.mk(8, 8, () => { }); }
            done++; tick(); res();
          };
          const tm = setTimeout(() => end(false), 15000);
          i.onload = () => end(true); i.onerror = () => end(false);
          i.src = tries ? src + '?r=' + tries : src;
        };
        attempt();
      }); };
      const jobs = TILE_LIST.map(n => load('assets/' + n + '.png', IMGS, n));
      for (const id of CHAR_IDS) { CHAR_IMGS[id] = {}; for (const n of SPRITE_LIST) jobs.push(load(CHARACTERS[id].folder + '/' + n + '.png', CHAR_IMGS[id], n)); }
      jobs.push(...Animals.load(load));
      await Promise.all(jobs);
      Art.init(); setCharacter('fazendeiro'); makeCloudSprites();
      $('btnMusic').textContent = Snd.musicOn ? '🎵' : '🔕'; $('btnMute').textContent = Snd.muted ? '🔇' : '🔊';
      status.classList.add('hidden');
      const found = loadSave(), has = found.status === 'ok', bad = found.status === 'invalid';
      if (has) $('btnContinue').classList.remove('hidden');
      renderSaveProblem(found, found.status === 'ok' ? null : listBackups().find(b => b.info.status === 'ok'));     // save ilegível, ou ausente com cópia válida
      // vitrine do título e tela de seleção
      $('titleImg1').src = CHARACTERS.fazendeiro.folder + '/front_walk.png';
      $('titleImg2').src = CHARACTERS.fazendeira.folder + '/front_walk.png';
      $('cards').innerHTML = CHAR_IDS.map(id => cardHtml(CHARACTERS[id], false, true)).join('');
      const showSelect = on => { $('charSelect').classList.toggle('hidden', !on); $('titleBox').classList.toggle('hidden', on); };
      // mostra o indicador de progresso e só então gera o mapa (que é pesado e congela a tela por um instante)
      const begin = (loadIt, charId, names) => {
        $('busy').classList.remove('hidden');
        requestAnimationFrame(() => setTimeout(() => {
          try { startGame(loadIt, charId, names); }
          catch (e) {
            console.error(e); showSelect(false);
            if (loadIt) {      // R3: o save passou na leitura mas o jogo não conseguiu iniciá-lo: guarda cópia e oferece baixar (recarregar não resolve)
              let raw = null; try { raw = localStorage.getItem(SAVE_KEY); } catch (e2) { /* storage indisponível */ }
              fail('Não foi possível iniciar o jogo salvo.');
              renderSaveProblem({ status: 'invalid', reason: 'start', raw, backedUp: raw !== null && backupSave(raw), detail: e.message }, null);
            } else fail('Não foi possível iniciar o jogo (' + e.message + '). Recarregue a página.');
          }
          $('busy').classList.add('hidden');
        }, 30));
      };
      // nomes digitados na tela de seleção (vão para o save do novo jogo)
      const typedNames = () => { const n = {}; $('cards').querySelectorAll('input[data-k]').forEach(i => { n[i.dataset.k] = cleanName(i.value, i.dataset.def); }); return n; };
      $('cards').addEventListener('click', e => { const b = e.target.closest('.charCard'); if (b) begin(false, b.dataset.k, typedNames()); });
      $('cards').addEventListener('input', e => {       // o cartão mostra o nome enquanto você digita
        const i = e.target.closest('input[data-k]'), cn = i && i.closest('.charWrap').querySelector('.cn');
        if (cn) cn.textContent = cleanName(i.value, i.dataset.def);
      });
      $('cards').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[data-k]')) begin(false, e.target.dataset.k, typedNames()); });
      $('cards').addEventListener('focusin', e => { if (e.target.matches('input[data-k]')) e.target.select(); });
      $('btnBack').onclick = () => showSelect(false);
      $('btnContinue').onclick = () => begin(true);
      // confirmação na própria tela (confirm() do navegador pode estar bloqueado e deixava o botão "morto")
      $('btnNew').onclick = () => {
        if (!has && !bad) { showSelect(true); return; }
        eraseForced = false; $('btnYes').textContent = 'Sim, apagar'; $('btnNewDl').classList.add('hidden');
        $('confirmMsg').textContent = has ? 'Isso substituirá o jogo salvo (uma cópia de segurança fica guardada neste navegador). Começar do zero?'
          : 'O save atual não pôde ser lido' + (found.backedUp ? ' (a cópia de segurança fica guardada).' : ' e NÃO há cópia guardada — baixe o arquivo antes!') + ' Começar do zero?';
        $('confirmNew').classList.remove('hidden');
      };
      $('btnYes').onclick = () => {
        const raw = prevSaveInfo().raw;
        if (raw !== null && !eraseForced && !backupSave(raw)) {       // R1: não coube a cópia — oferece baixar antes de apagar
          eraseForced = true;
          $('confirmMsg').textContent = 'Não foi possível guardar uma cópia do jogo atual (sem espaço no navegador). Baixe o save antes ou apague mesmo assim.';
          $('btnYes').textContent = 'Apagar mesmo assim'; $('btnNewDl').classList.remove('hidden'); $('btnNewDl').onclick = () => downloadText(saveFileName(), raw);
          return;
        }
        $('confirmNew').classList.add('hidden'); showSelect(true);
      };
      $('btnNo').onclick = () => { $('confirmNew').classList.add('hidden'); eraseForced = false; };
      window.addEventListener('storage', e => {       // R2: outra aba gravou o save — esta aba passa a ser a "velha" imediatamente
        if (!running) return;
        if (e.key === null || (e.key === SAVE_KEY && e.newValue === null)) { staleTab = true; return; }       // N4: outra aba apagou o save (Novo jogo) ou limpou os dados do site
        if (e.key !== SAVE_KEY) return;
        const r = revOfRaw(e.newValue); if (r === null || r !== loadedRev) staleTab = true;
      });
      window.addEventListener('beforeunload', () => { if (running) save(); });
      window.addEventListener('pagehide', () => { if (running) save(); });       // iOS/celular: beforeunload não é confiável
      document.addEventListener('visibilitychange', () => { if (document.hidden) { if (running) { save(); if (!modalOpen) openMenu(); } Snd.suspend(); } else Snd.resume(); });
      $('btnNew').disabled = false; $('btnContinue').disabled = false;
    } catch (e) {
      console.error(e); fail('Erro ao carregar o jogo (' + e.message + '). Recarregue a página.');
    }
    requestAnimationFrame(frame);
  }
  boot();
})();
