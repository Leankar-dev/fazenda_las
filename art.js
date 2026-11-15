'use strict';
/* ============================================================
   art.js  -  arte procedural complementar (plantações, celeiro,
   árvores, pedras, galinhas...) no mesmo estilo "pintado" dos
   assets recortados da folha do Elias.
   ============================================================ */
const Art = (() => {
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function mk(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    fn(g, w, h);
    return c;
  }

  function shadow(g, x, y, rx, ry, a = 0.28) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
  }
  function ball(g, x, y, r, c1, c2, sy = 1) {
    const gr = g.createRadialGradient(x - r * .35, y - r * .35 * sy, r * .1, x, y, r);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, r, r * sy, 0, 0, TAU); g.fill();
  }
  function leaf(g, x, y, ang, len, wid, c1 = '#5fae3a', c2 = '#2f7a24') {
    g.save(); g.translate(x, y); g.rotate(ang);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, c2); gr.addColorStop(1, c1);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(len * .5, -wid, len, 0);
    g.quadraticCurveTo(len * .5, wid, 0, 0); g.fill();
    g.strokeStyle = 'rgba(0,50,0,.35)'; g.lineWidth = .8; g.stroke();
    g.beginPath(); g.moveTo(len * .08, 0); g.lineTo(len * .85, 0);
    g.strokeStyle = 'rgba(230,255,170,.28)'; g.stroke();
    g.restore();
  }
  function mound(g, x, y, rx, ry) {
    shadow(g, x, y + 2, rx + 3, ry, .25);
    const gr = g.createRadialGradient(x - rx * .3, y - ry * 1.2, 1, x, y, rx);
    gr.addColorStop(0, '#7b5434'); gr.addColorStop(1, '#3f2815');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,220,170,.18)';
    g.beginPath(); g.ellipse(x - rx * .25, y - ry * .35, rx * .45, ry * .3, 0, 0, TAU); g.fill();
  }

  /* ---------------- PLANTAÇÕES  (64 x 96, base em y=70) ---------------- */
  const CW = 64, CH = 96, BX = 32, BY = 70;

  function carrot(g, s) {
    mound(g, BX, BY, s === 0 ? 12 : 14, s === 0 ? 5 : 6);
    if (s === 0) {
      g.fillStyle = '#d9c28f';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(BX - 5 + i * 5, BY - 1, 1.4, .9, 0, 0, TAU); g.fill(); }
      return;
    }
    const n = [0, 2, 5, 7, 9][s], len = [0, 11, 20, 28, 34][s];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? .5 : i / (n - 1);
      const a = -Math.PI / 2 - 1 + t * 2;
      leaf(g, BX + (t - .5) * 6, BY - 2, a, len * (0.82 + ((i * 37) % 5) * .05), 3.4 + s * .5, '#7bd04a', '#2f8a2c');
    }
    if (s === 4) {
      ball(g, BX, BY - 1, 6.5, '#ffb866', '#d9651a', .8);
      ball(g, BX - 7, BY, 4.5, '#ffb866', '#d9651a', .8);
      ball(g, BX + 7, BY, 4.5, '#ffb866', '#d9651a', .8);
    }
  }

  function tomato(g, s) {
    mound(g, BX, BY, 14, 6);
    if (s === 0) { g.fillStyle = '#d9c28f'; g.beginPath(); g.ellipse(BX, BY - 1, 1.6, 1, 0, 0, TAU); g.fill(); return; }
    if (s === 1) {
      g.strokeStyle = '#4c9a30'; g.lineWidth = 2; g.beginPath(); g.moveTo(BX, BY - 2); g.lineTo(BX, BY - 14); g.stroke();
      leaf(g, BX, BY - 12, -2.5, 10, 4); leaf(g, BX, BY - 12, -.65, 10, 4);
      return;
    }
    const h = [0, 0, 28, 44, 48][s];
    // estaca
    g.strokeStyle = '#8a6137'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(BX + 9, BY); g.lineTo(BX + 9, BY - h - 6); g.stroke();
    g.strokeStyle = '#4c9a30'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(BX, BY - 2); g.quadraticCurveTo(BX + 3, BY - h * .5, BX + 1, BY - h); g.stroke();
    const rows = s === 2 ? 4 : 7;
    for (let i = 0; i < rows; i++) {
      const y = BY - 6 - i * (h - 8) / rows, side = i % 2 ? 1 : -1;
      leaf(g, BX + 1, y, side < 0 ? -2.7 + (i % 3) * .15 : -.45 - (i % 3) * .15, 15 + (i % 3) * 2, 6.5, '#79c447', '#2c7d28');
    }
    if (s >= 3) {
      const pos = [[-11, -14], [11, -20], [-6, -28], [8, -34], [-12, -38], [2, -10]];
      const cnt = s === 3 ? 3 : 6;
      for (let i = 0; i < cnt; i++) {
        const [dx, dy] = pos[i], x = BX + dx, y = BY + dy;
        if (s === 3) {
          if (i === 0) ball(g, x, y, 4.2, '#9be06a', '#4d9b2e');
          else { g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill(); g.fillStyle = '#fff6a8'; g.beginPath(); g.arc(x, y, 1.2, 0, TAU); g.fill(); }
        } else {
          ball(g, x, y, 5.5, '#ff8a70', '#c4201a');
          g.fillStyle = '#2f8a2c'; g.beginPath(); g.arc(x, y - 4.5, 2, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(x - 1.8, y - 1.8, 1.5, 1, -.6, 0, TAU); g.fill();
        }
      }
    }
  }

  function corn(g, s) {
    mound(g, BX, BY, 14, 6);
    if (s === 0) { g.fillStyle = '#e9d27a'; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(BX - 5 + i * 5, BY - 1, 1.8, 1, 0, 0, TAU); g.fill(); } return; }
    if (s <= 2) {
      const n = s === 1 ? 3 : 5, len = s === 1 ? 14 : 28;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), a = -Math.PI / 2 - .8 + t * 1.6;
        leaf(g, BX + (t - .5) * 5, BY - 2, a, len * (.8 + (i % 2) * .25), 3, '#8ad44f', '#2f8a2c');
      }
      return;
    }
    const h = s === 3 ? 52 : 64;
    // caule
    const gr = g.createLinearGradient(BX - 3, 0, BX + 3, 0);
    gr.addColorStop(0, '#4f9a2c'); gr.addColorStop(1, '#7cc545');
    g.fillStyle = gr; g.fillRect(BX - 2.6, BY - h, 5.2, h);
    for (let i = 0; i < 6; i++) {
      const y = BY - 8 - i * (h - 14) / 5, side = i % 2 ? 1 : -1;
      leaf(g, BX, y, side < 0 ? -Math.PI + .35 + (i % 3) * .08 : -.35 - (i % 3) * .08, 26 - i * 1.2, 4.6, '#8ad44f', '#2f8a2c');
      // folha caindo
      g.strokeStyle = 'rgba(40,110,30,.0)';
    }
    if (s === 3) {
      leaf(g, BX, BY - h, -Math.PI / 2 - .5, 16, 3.4); leaf(g, BX, BY - h, -Math.PI / 2 + .5, 16, 3.4);
    } else {
      // pendão
      g.strokeStyle = '#d8c46a'; g.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(BX, BY - h + 2); g.quadraticCurveTo(BX + i * 2, BY - h - 8, BX + i * 3.6, BY - h - 12 + Math.abs(i)); g.stroke(); }
      // espigas
      [[8, -30], [-8, -42]].forEach(([dx, dy], i) => {
        g.save(); g.translate(BX + dx, BY + dy); g.rotate(dx > 0 ? .25 : -.25);
        const husk = g.createLinearGradient(-4, 0, 4, 0); husk.addColorStop(0, '#2f8a2c'); husk.addColorStop(1, '#79c447');
        g.fillStyle = husk; g.beginPath(); g.ellipse(0, 2, 5, 12, 0, 0, TAU); g.fill();
        const cob = g.createLinearGradient(-3, 0, 3, 0); cob.addColorStop(0, '#f2b40f'); cob.addColorStop(1, '#ffe66d');
        g.fillStyle = cob; g.beginPath(); g.ellipse(0, -5, 3.6, 8, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(160,100,0,.35)';
        for (let j = -10; j < 2; j += 3) { g.fillRect(-3, j, 6, .8); }
        g.restore();
      });
    }
  }

  function pumpkin(g, s) {
    mound(g, BX, BY, 15, 6);
    if (s === 0) { g.fillStyle = '#efe0b4'; for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(BX - 3 + i * 6, BY - 1, 2.4, 1.2, 0, 0, TAU); g.fill(); } return; }
    if (s === 1) {
      g.strokeStyle = '#4c9a30'; g.lineWidth = 2; g.beginPath(); g.moveTo(BX, BY - 2); g.lineTo(BX, BY - 8); g.stroke();
      ball(g, BX - 6, BY - 9, 6, '#8ad44f', '#2f8a2c', .7); ball(g, BX + 6, BY - 9, 6, '#8ad44f', '#2f8a2c', .7);
      return;
    }
    // vinha
    g.strokeStyle = '#3f8a2a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(BX, BY - 2); g.quadraticCurveTo(BX - 20, BY - 10, BX - 24, BY + 2); g.stroke();
    g.beginPath(); g.moveTo(BX, BY - 2); g.quadraticCurveTo(BX + 20, BY - 12, BX + 25, BY); g.stroke();
    const lv = [[-20, -6, 9], [-8, -14, 9], [10, -15, 10], [22, -5, 9], [0, -22, s >= 3 ? 8 : 6]];
    if (s === 4) {
      // abóbora grande
      ball(g, BX - 9, BY - 11, 11, '#ffb04a', '#cf5c0e', .82);
      ball(g, BX + 9, BY - 11, 11, '#ffb04a', '#cf5c0e', .82);
      ball(g, BX, BY - 12, 13.5, '#ffbb58', '#c4500a', .85);
      g.strokeStyle = 'rgba(140,50,0,.45)'; g.lineWidth = 1.2;
      for (const k of [-6, 0, 6]) { g.beginPath(); g.ellipse(BX + k, BY - 12, 5 + Math.abs(k) * .2, 11.4, 0, 0, TAU); g.stroke(); }
      g.strokeStyle = '#5a7a25'; g.lineWidth = 3.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(BX, BY - 24); g.quadraticCurveTo(BX + 2, BY - 30, BX + 6, BY - 30); g.stroke();
      ball(g, BX - 14, BY - 24, 7, '#8ad44f', '#2f8a2c', .75);
      ball(g, BX + 15, BY - 25, 7, '#8ad44f', '#2f8a2c', .75);
    } else {
      lv.forEach(([dx, dy, r], i) => ball(g, BX + dx, BY + dy, r, '#8ad44f', '#2f8a2c', .72));
      if (s === 3) ball(g, BX + 2, BY - 8, 6, '#c9d65a', '#6d9a2a', .85);
    }
  }

  const CROP_FN = { cenoura: carrot, tomate: tomato, milho: corn, abobora: pumpkin };
  const crops = {};
  for (const k in CROP_FN) {
    crops[k] = [0, 1, 2, 3, 4].map(s => mk(CW, CH, g => CROP_FN[k](g, s)));
  }

  /* ---------------- CELEIRO (7x5 tiles = 448 x 320) ---------------- */
  function drawBarn() {
    return mk(448, 320, (g, W, H) => {
      const P = [[14, 150], [14, 108], [78, 44], [224, 10], [370, 44], [434, 108], [434, 150]];
      // sombra no chão
      const sg = g.createLinearGradient(0, H - 16, 0, H); sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.35)');
      g.fillStyle = sg; g.fillRect(0, H - 16, W, 16);
      // paredes
      const wall = g.createLinearGradient(0, 40, 0, H);
      wall.addColorStop(0, '#c04430'); wall.addColorStop(1, '#8a281c');
      g.fillStyle = wall;
      g.beginPath(); g.moveTo(14, H - 6); g.lineTo(P[0][0], P[0][1]);
      for (const p of P) g.lineTo(p[0], p[1]);
      g.lineTo(434, H - 6); g.closePath(); g.fill();
      // tábuas
      g.strokeStyle = 'rgba(60,10,5,.35)'; g.lineWidth = 1.4;
      for (let x = 22; x < 434; x += 15) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x, H - 8); g.stroke(); }
      g.strokeStyle = 'rgba(255,170,140,.12)';
      for (let x = 23; x < 434; x += 15) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x, H - 8); g.stroke(); }
      // limpar acima do telhado (recorta)
      g.globalCompositeOperation = 'destination-in';
      g.beginPath(); g.moveTo(14, H); for (const p of P) g.lineTo(p[0], p[1]); g.lineTo(434, H); g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-over';
      // fundação
      const fd = g.createLinearGradient(0, H - 20, 0, H); fd.addColorStop(0, '#8a8a85'); fd.addColorStop(1, '#5c5c58');
      g.fillStyle = fd; g.fillRect(10, H - 18, 428, 18);
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1;
      for (let x = 10; x < 438; x += 26) { g.beginPath(); g.moveTo(x, H - 18); g.lineTo(x, H - 9); g.moveTo(x + 13, H - 9); g.lineTo(x + 13, H); g.stroke(); }
      // moldura branca do telhado
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = '#4b4137'; g.lineWidth = 17;
      g.beginPath(); g.moveTo(P[0][0] - 6, P[0][1] + 4); for (const p of P) g.lineTo(p[0], p[1] - 2); g.lineTo(440, 154); g.stroke();
      g.strokeStyle = '#6a5d4e'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(P[0][0] - 6, P[0][1] + 2); for (const p of P) g.lineTo(p[0], p[1] - 3); g.lineTo(440, 152); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(P[0][0] - 6, P[0][1]); for (const p of P) g.lineTo(p[0], p[1] - 6); g.lineTo(440, 148); g.stroke();
      g.strokeStyle = '#efe6d2'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(14, H - 18); g.lineTo(P[0][0], P[0][1]); for (const p of P) g.lineTo(p[0], p[1] + 9); g.lineTo(434, H - 18); g.stroke();
      // faixa horizontal
      g.fillStyle = '#efe6d2'; g.fillRect(14, 150, 420, 5);
      // portão grande
      const dx = 160, dy = 188, dw = 128, dh = H - 18 - dy;
      g.fillStyle = '#efe6d2'; g.fillRect(dx - 6, dy - 6, dw + 12, dh + 6);
      const dg = g.createLinearGradient(0, dy, 0, dy + dh); dg.addColorStop(0, '#9c3022'); dg.addColorStop(1, '#6e1f16');
      g.fillStyle = dg; g.fillRect(dx, dy, dw / 2 - 1, dh); g.fillRect(dx + dw / 2 + 1, dy, dw / 2 - 1, dh);
      g.strokeStyle = '#efe6d2'; g.lineWidth = 6;
      for (const ox of [dx, dx + dw / 2 + 1]) {
        g.strokeRect(ox + 3, dy + 3, dw / 2 - 7, dh - 6);
        g.beginPath(); g.moveTo(ox + 3, dy + 3); g.lineTo(ox + dw / 2 - 4, dy + dh - 3); g.moveTo(ox + dw / 2 - 4, dy + 3); g.lineTo(ox + 3, dy + dh - 3); g.stroke();
      }
      // janela de feno
      const hx = 192, hy = 60, hw = 64, hh = 62;
      g.fillStyle = '#efe6d2'; g.fillRect(hx - 6, hy - 6, hw + 12, hh + 12);
      g.fillStyle = '#2a1510'; g.fillRect(hx, hy, hw, hh);
      g.fillStyle = '#e0b84a';
      g.beginPath(); g.moveTo(hx, hy + hh); g.lineTo(hx, hy + 28); g.quadraticCurveTo(hx + 20, hy + 20, hx + 34, hy + 34); g.quadraticCurveTo(hx + 50, hy + 22, hx + hw, hy + 30); g.lineTo(hx + hw, hy + hh); g.fill();
      g.strokeStyle = '#a9842a'; g.lineWidth = 1;
      for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(hx + 4 + i * 3.7, hy + hh); g.lineTo(hx + 8 + i * 3.7 - (i % 3) * 3, hy + 36 + (i % 4) * 4); g.stroke(); }
      g.strokeStyle = '#efe6d2'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(hx + hw / 2, hy); g.lineTo(hx + hw / 2, hy + hh); g.moveTo(hx, hy + hh / 2 - 10); g.lineTo(hx + hw, hy + hh / 2 - 10); g.stroke();
      // janelas laterais
      for (const wx of [56, 336]) {
        g.fillStyle = '#efe6d2'; g.fillRect(wx - 5, 196, 62, 62);
        const wg = g.createLinearGradient(0, 200, 0, 254); wg.addColorStop(0, '#9fd4ee'); wg.addColorStop(1, '#4a7fa5');
        g.fillStyle = wg; g.fillRect(wx, 201, 52, 52);
        g.strokeStyle = '#efe6d2'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(wx + 26, 201); g.lineTo(wx + 26, 253); g.moveTo(wx, 227); g.lineTo(wx + 52, 227); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(wx + 4, 205); g.lineTo(wx + 22, 205); g.lineTo(wx + 4, 223); g.fill();
      }
      // lâmpada
      g.fillStyle = '#3a3a3a'; g.fillRect(222, 164, 4, 12);
      ball(g, 224, 180, 5, '#fff3b0', '#e0a52a');
    });
  }

  /* ---------------- BARRACA / EMPÓRIO (3x2 tiles; 192x150) ---------------- */
  function drawStall() {
    return mk(192, 150, (g, W, H) => {
      shadow(g, W / 2, H - 6, 92, 9, .3);
      // fundo
      const bg = g.createLinearGradient(0, 40, 0, H); bg.addColorStop(0, '#b98350'); bg.addColorStop(1, '#8c5c33');
      g.fillStyle = bg; g.fillRect(10, 40, 172, H - 48);
      g.strokeStyle = 'rgba(50,25,5,.4)'; g.lineWidth = 1.3;
      for (let x = 20; x < 182; x += 14) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, H - 10); g.stroke(); }
      // prateleira
      g.fillStyle = '#6e4521'; g.fillRect(14, 74, 164, 6);
      for (let i = 0; i < 6; i++) ball(g, 28 + i * 24, 68, 6, ['#ff8a70', '#ffd24d', '#8ad44f', '#ffb04a'][i % 4], ['#c4201a', '#d9a010', '#3d8a2a', '#cf5c0e'][i % 4]);
      // balcão
      const ct = g.createLinearGradient(0, 96, 0, H); ct.addColorStop(0, '#d29a62'); ct.addColorStop(1, '#8c5c33');
      g.fillStyle = ct; g.fillRect(4, 96, 184, H - 102);
      g.fillStyle = '#e8b887'; g.fillRect(0, 92, 192, 9);
      g.strokeStyle = 'rgba(50,25,5,.35)';
      for (let x = 16; x < 188; x += 22) { g.beginPath(); g.moveTo(x, 102); g.lineTo(x, H - 8); g.stroke(); }
      // caixotes com legumes
      const items = [['#ff9a3a', '#c9560a'], ['#ff6a50', '#b81a14'], ['#ffd84a', '#c89a10']];
      for (let i = 0; i < 3; i++) {
        const x = 18 + i * 56;
        g.fillStyle = '#7a4d27'; g.fillRect(x, 106, 44, 26);
        g.strokeStyle = '#4e3017'; g.lineWidth = 1.5; g.strokeRect(x, 106, 44, 26);
        for (let j = 0; j < 6; j++) ball(g, x + 7 + j * 6.2, 104 + (j % 2) * 3, 6, items[i][0], items[i][1]);
      }
      // postes
      g.fillStyle = '#5c3a1c'; g.fillRect(2, 22, 8, H - 26); g.fillRect(182, 22, 8, H - 26);
      // toldo listrado
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f4ead2' : '#c8372b';
        g.beginPath(); g.moveTo(i * 24, 14); g.lineTo(i * 24 + 24, 14); g.lineTo(i * 24 + 24, 40);
        g.arc(i * 24 + 12, 40, 12, 0, Math.PI); g.lineTo(i * 24, 14); g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 14, W, 4);
      // placa
      g.fillStyle = '#5c3a1c'; g.fillRect(34, 0, 124, 22);
      g.fillStyle = '#e8c88a'; g.fillRect(37, 3, 118, 16);
      g.fillStyle = '#4a2b0e'; g.font = 'bold 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('EMPÓRIO', W / 2, 11.5);
    });
  }

  /* ---------------- CAIXA DE VENDAS (2x1; 128x90) ---------------- */
  function drawBin() {
    return mk(128, 92, (g, W, H) => {
      shadow(g, W / 2, H - 6, 58, 8, .3);
      // interior
      g.fillStyle = '#2b1a0c'; g.beginPath(); g.moveTo(14, 30); g.lineTo(114, 30); g.lineTo(122, 44); g.lineTo(6, 44); g.fill();
      // frente
      const fr = g.createLinearGradient(0, 40, 0, H); fr.addColorStop(0, '#b27a43'); fr.addColorStop(1, '#7e4f26');
      g.fillStyle = fr; g.fillRect(6, 44, 116, H - 52);
      g.strokeStyle = 'rgba(40,20,5,.5)'; g.lineWidth = 1.5;
      for (let y = 56; y < H - 8; y += 12) { g.beginPath(); g.moveTo(6, y); g.lineTo(122, y); g.stroke(); }
      g.strokeStyle = '#4e3017'; g.lineWidth = 3; g.strokeRect(6, 44, 116, H - 52);
      // cantos metálicos
      g.fillStyle = '#6b6b6b'; for (const x of [6, 116]) g.fillRect(x, 44, 6, H - 52);
      // tampa aberta
      g.save(); g.translate(14, 30); g.rotate(-.35);
      g.fillStyle = '#9b6a38'; g.fillRect(0, -16, 100, 16); g.strokeStyle = '#4e3017'; g.lineWidth = 2; g.strokeRect(0, -16, 100, 16);
      g.restore();
      // moedas
      ball(g, 44, 36, 4, '#ffe680', '#c9971a'); ball(g, 58, 38, 4, '#ffe680', '#c9971a'); ball(g, 74, 35, 4, '#ffe680', '#c9971a');
      g.fillStyle = '#f4ead2'; g.fillRect(30, 56, 68, 20);
      g.fillStyle = '#4a2b0e'; g.font = 'bold 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('VENDAS', W / 2, 66.5);
    });
  }

  /* ---------------- POÇO (2x2; 128x128) ---------------- */
  function drawWell() {
    return mk(128, 138, (g, W, H) => {
      shadow(g, 64, 112, 54, 14, .32);
      // anel de pedra (traseira)
      const st = g.createLinearGradient(0, 70, 0, 118); st.addColorStop(0, '#b4b0a6'); st.addColorStop(1, '#6f6c64');
      g.fillStyle = st; g.beginPath(); g.ellipse(64, 96, 44, 22, 0, 0, TAU); g.fill();
      g.fillStyle = st; g.fillRect(20, 86, 88, 22);
      g.beginPath(); g.ellipse(64, 108, 44, 18, 0, 0, Math.PI); g.fill();
      // tijolos
      g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 1.2;
      for (let x = 24; x < 108; x += 14) { g.beginPath(); g.moveTo(x, 90); g.lineTo(x, 118); g.stroke(); }
      g.beginPath(); g.ellipse(64, 104, 44, 17, 0, 0.1, Math.PI - .1); g.stroke();
      // borda superior
      g.fillStyle = '#cfcabd'; g.beginPath(); g.ellipse(64, 88, 44, 21, 0, 0, TAU); g.fill();
      const wg = g.createRadialGradient(64, 88, 2, 64, 88, 34); wg.addColorStop(0, '#3a7da8'); wg.addColorStop(1, '#1f4c6e');
      g.fillStyle = wg; g.beginPath(); g.ellipse(64, 89, 34, 15, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(58, 88, 14, 5, 0, 3.4, 5.6); g.stroke();
      // postes
      g.fillStyle = '#6e4521'; g.fillRect(24, 22, 8, 76); g.fillRect(96, 22, 8, 76);
      g.fillStyle = '#8a5b30'; g.fillRect(24, 22, 3, 76); g.fillRect(96, 22, 3, 76);
      // telhado
      g.fillStyle = '#7a3a22'; g.beginPath(); g.moveTo(8, 38); g.lineTo(64, 2); g.lineTo(120, 38); g.lineTo(112, 42); g.lineTo(64, 14); g.lineTo(16, 42); g.closePath(); g.fill();
      const rf = g.createLinearGradient(0, 4, 0, 40); rf.addColorStop(0, '#b0522e'); rf.addColorStop(1, '#7a3a22');
      g.fillStyle = rf; g.beginPath(); g.moveTo(10, 38); g.lineTo(64, 4); g.lineTo(118, 38); g.lineTo(108, 40); g.lineTo(64, 14); g.lineTo(20, 40); g.closePath(); g.fill();
      g.fillStyle = '#5a2c18'; g.beginPath(); g.moveTo(4, 40); g.lineTo(64, 0); g.lineTo(124, 40); g.lineTo(120, 44); g.lineTo(64, 9); g.lineTo(8, 44); g.closePath(); g.fill();
      // corda e balde
      g.strokeStyle = '#c9b98a'; g.lineWidth = 2; g.beginPath(); g.moveTo(64, 14); g.lineTo(64, 56); g.stroke();
      g.fillStyle = '#8a5b30'; g.beginPath(); g.moveTo(54, 56); g.lineTo(74, 56); g.lineTo(71, 72); g.lineTo(57, 72); g.fill();
      g.strokeStyle = '#4e3017'; g.lineWidth = 1.5; g.strokeRect(54, 56, 20, 2);
      // pedras na frente
      g.fillStyle = st; g.beginPath(); g.ellipse(24, 112, 10, 6, 0, 0, TAU); g.ellipse(106, 114, 9, 5, 0, 0, TAU); g.fill();
    });
  }

  /* ---------------- GALINHEIRO (2x2; 128x120) ---------------- */
  function drawCoop() {
    return mk(128, 124, (g, W, H) => {
      shadow(g, 64, H - 10, 56, 10, .3);
      const wall = g.createLinearGradient(0, 40, 0, H); wall.addColorStop(0, '#c8955a'); wall.addColorStop(1, '#8c5c33');
      g.fillStyle = wall; g.fillRect(14, 50, 100, H - 62);
      g.strokeStyle = 'rgba(50,25,5,.4)'; g.lineWidth = 1.3;
      for (let x = 24; x < 114; x += 12) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, H - 12); g.stroke(); }
      // telhado
      const rf = g.createLinearGradient(0, 8, 0, 56); rf.addColorStop(0, '#c8502e'); rf.addColorStop(1, '#8a2f1a');
      g.fillStyle = rf; g.beginPath(); g.moveTo(2, 58); g.lineTo(64, 6); g.lineTo(126, 58); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1.2;
      for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(2 + i * 6, 58 - i * 10.4); g.lineTo(126 - i * 6, 58 - i * 10.4); g.stroke(); }
      g.strokeStyle = '#5a2c18'; g.lineWidth = 4; g.beginPath(); g.moveTo(2, 58); g.lineTo(64, 6); g.lineTo(126, 58); g.stroke();
      // porta redonda + rampa
      g.fillStyle = '#2a1608'; g.beginPath(); g.arc(64, 92, 14, Math.PI, 0); g.lineTo(78, H - 12); g.lineTo(50, H - 12); g.fill();
      g.strokeStyle = '#efe6d2'; g.lineWidth = 3; g.beginPath(); g.arc(64, 92, 16, Math.PI, 0); g.stroke();
      g.fillStyle = '#a8763f'; g.beginPath(); g.moveTo(48, H - 12); g.lineTo(80, H - 12); g.lineTo(88, H - 2); g.lineTo(42, H - 2); g.fill();
      g.strokeStyle = '#5c3a1c'; g.lineWidth = 1.2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(46 + i * 2, H - 10 + i * 2); g.lineTo(82 - i * 2, H - 10 + i * 2); g.stroke(); }
      // feno
      g.fillStyle = '#e0b84a'; g.beginPath(); g.ellipse(26, H - 12, 14, 6, 0, 0, TAU); g.ellipse(104, H - 10, 12, 5, 0, 0, TAU); g.fill();
    });
  }

  /* ---------------- ÁRVORES / PEDRAS / MATO ---------------- */
  function drawTree(v) {
    return mk(128, 176, (g, W, H) => {
      const r = mulberry32(100 + v * 7);
      shadow(g, 64, H - 10, 40, 10, .3);
      if (v === 2) { // pinheiro
        const tg = g.createLinearGradient(54, 0, 74, 0); tg.addColorStop(0, '#6e4521'); tg.addColorStop(1, '#4a2e15');
        g.fillStyle = tg; g.fillRect(56, H - 40, 16, 32);
        const layers = [[H - 34, 50], [H - 62, 42], [H - 90, 34], [H - 116, 26], [H - 138, 18]];
        layers.forEach(([y, w], i) => {
          const gr = g.createLinearGradient(0, y - 40, 0, y); gr.addColorStop(0, '#3c8a3a'); gr.addColorStop(1, '#1e5a2a');
          g.fillStyle = gr; g.beginPath(); g.moveTo(64, y - 40); g.lineTo(64 + w, y); g.lineTo(64 - w, y); g.closePath(); g.fill();
          g.fillStyle = 'rgba(190,255,150,.14)'; g.beginPath(); g.moveTo(64, y - 40); g.lineTo(64 - w * .15, y); g.lineTo(64 - w, y); g.closePath(); g.fill();
        });
        return;
      }
      const tg = g.createLinearGradient(48, 0, 80, 0); tg.addColorStop(0, '#7a4e26'); tg.addColorStop(.6, '#5a3819'); tg.addColorStop(1, '#3f2710');
      g.fillStyle = tg;
      g.beginPath(); g.moveTo(52, H - 8); g.quadraticCurveTo(58, H - 50, 56, H - 90); g.lineTo(72, H - 90); g.quadraticCurveTo(70, H - 50, 78, H - 8); g.closePath(); g.fill();
      // raízes
      g.beginPath(); g.moveTo(44, H - 6); g.quadraticCurveTo(54, H - 18, 56, H - 30); g.lineTo(70, H - 30); g.quadraticCurveTo(76, H - 18, 86, H - 6); g.closePath(); g.fill();
      const cols = v === 0 ? [['#3f9a3a', '#256e2c'], ['#5fb84a', '#2f8a2c'], ['#8ad45a', '#3f9a3a']] : [['#2f7f3a', '#1b5a2a'], ['#468f3c', '#256e2c'], ['#6cb04a', '#2f8a2c']];
      for (let layer = 0; layer < 3; layer++) {
        const n = 7 - layer * 1;
        for (let i = 0; i < n; i++) {
          const a = r() * TAU, d = (r() * .5 + .25) * (46 - layer * 12);
          const cx = 64 + Math.cos(a) * d, cy = 70 + Math.sin(a) * d * .8 - layer * 6, rad = 24 - layer * 3 + r() * 6;
          ball(g, cx, cy, rad, cols[layer][0], cols[layer][1]);
        }
      }
      g.fillStyle = 'rgba(255,255,200,.12)';
      for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(40 + r() * 40, 36 + r() * 40, 2 + r() * 4, 0, TAU); g.fill(); }
      if (v === 1) for (let i = 0; i < 6; i++) ball(g, 36 + r() * 56, 40 + r() * 50, 4, '#ff7a6a', '#c4201a');
    });
  }
  function drawRock(v) {
    return mk(64, 52, (g, W, H) => {
      shadow(g, 32, H - 8, 26, 7, .3);
      const r = mulberry32(300 + v);
      const pts = []; const n = 9;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; const rr = 1 + (r() - .5) * .3; pts.push([32 + Math.cos(a) * 25 * rr, 28 + Math.sin(a) * 17 * rr]); }
      const gr = g.createLinearGradient(10, 8, 52, 44); gr.addColorStop(0, '#c0bdb2'); gr.addColorStop(.5, '#8f8c82'); gr.addColorStop(1, '#5a5850');
      g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,30,30,.5)'; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(24, 18, 9, 4, -.3, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(30,30,30,.4)'; g.beginPath(); g.moveTo(34, 18); g.lineTo(38, 28); g.lineTo(33, 36); g.stroke();
      if (v === 1) { g.fillStyle = 'rgba(90,150,60,.65)'; g.beginPath(); g.ellipse(40, 40, 8, 3, 0, 0, TAU); g.fill(); }
    });
  }
  function drawStump() {
    return mk(64, 60, (g, W, H) => {
      shadow(g, 32, H - 8, 26, 7, .3);
      const sg = g.createLinearGradient(8, 0, 56, 0); sg.addColorStop(0, '#7a4e26'); sg.addColorStop(.6, '#5a3819'); sg.addColorStop(1, '#3f2710');
      g.fillStyle = sg; g.beginPath(); g.moveTo(10, 24); g.lineTo(10, 46); g.quadraticCurveTo(32, 56, 54, 46); g.lineTo(54, 24); g.fill();
      g.fillStyle = '#d9ae72'; g.beginPath(); g.ellipse(32, 24, 22, 11, 0, 0, TAU); g.fill();
      g.strokeStyle = '#a77a43'; g.lineWidth = 1.2;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.ellipse(32, 24, 22 - i * 5, 11 - i * 2.4, 0, 0, TAU); g.stroke(); }
      g.strokeStyle = '#4a2e15'; g.lineWidth = 2; g.beginPath(); g.ellipse(32, 24, 22, 11, 0, 0, TAU); g.stroke();
    });
  }
  function drawBush(v) {
    return mk(64, 52, (g, W, H) => {
      const r = mulberry32(500 + v);
      shadow(g, 32, H - 8, 22, 6, .25);
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 11 - .5) * 2.4;
        leaf(g, 32 + (r() - .5) * 8, H - 10, a, 22 + r() * 12, 2.6, '#8ad44f', '#2f7a24');
      }
      if (v < 2) for (let i = 0; i < 5; i++) {
        const x = 18 + r() * 28, y = 12 + r() * 16;
        g.fillStyle = v === 0 ? '#ff8fb8' : '#ffe14d'; g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 1, 0, TAU); g.fill();
      }
    });
  }

  /* ---------------- ÁRVORES FRUTÍFERAS (muda / jovem / adulta) ---------------- */
  const FT = {
    maca:    { dark: ['#3f9a3a', '#256e2c'], mid: ['#5fb84a', '#2f8a2c'], light: ['#8ad45a', '#3f9a3a'], fruit: ['#ff7a6a', '#c4201a'] },
    laranja: { dark: ['#2f8a46', '#1b6a30'], mid: ['#46a653', '#26793a'], light: ['#6cc46a', '#34903f'], fruit: ['#ffc04a', '#e8730a'] },
    pessego: { dark: ['#5aa63e', '#34792a'], mid: ['#7cc653', '#3f9a30'], light: ['#a3de6c', '#5aae3c'], fruit: ['#ffc7a6', '#ee7d55'], blossom: '#ffb6d0' },
    limao:   { dark: ['#4a9a3a', '#2c702a'], mid: ['#6cb644', '#3a8a2c'], light: ['#a6dd4f', '#5aa832'], fruit: ['#fff27a', '#dcb400'] },
  };
  function drawFruit(g, sp, x, y, r) {          // uma fruta desenhada (também usada nos ícones)
    const f = FT[sp].fruit;
    g.save(); g.translate(x, y);
    if (sp === 'limao') {
      const gr = g.createRadialGradient(-r * .3, -r * .3, 1, 0, 0, r * 1.2); gr.addColorStop(0, f[0]); gr.addColorStop(1, f[1]);
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, r * 1.18, r * .86, -.35, 0, TAU); g.fill();
      g.fillStyle = f[1]; g.beginPath(); g.arc(-r * 1.2, r * .4, r * .22, 0, TAU); g.arc(r * 1.2, -r * .4, r * .22, 0, TAU); g.fill();
    } else {
      ball(g, 0, 0, r, f[0], f[1], sp === 'pessego' ? .96 : 1);
      if (sp === 'laranja') { g.fillStyle = 'rgba(190,80,0,.35)'; for (const [dx, dy] of [[-.4, -.2], [.3, .3], [.1, -.5], [-.2, .5], [.5, -.1]]) { g.beginPath(); g.arc(dx * r, dy * r, r * .09, 0, TAU); g.fill(); } }
      if (sp === 'pessego') { g.strokeStyle = 'rgba(190,60,40,.45)'; g.lineWidth = Math.max(.8, r * .1); g.beginPath(); g.arc(r * .1, 0, r * .8, 2.4, 3.9); g.stroke(); }
      if (sp === 'maca' || sp === 'pessego') { g.strokeStyle = '#5a3819'; g.lineWidth = Math.max(1, r * .16); g.beginPath(); g.moveTo(0, -r * .85); g.lineTo(r * .12, -r * 1.25); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(-r * .38, -r * .38, r * .24, r * .15, -.7, 0, TAU); g.fill();
    if (sp !== 'limao') { leaf(g, r * .1, -r * .95, -.5, r * .75, r * .3, '#79c447', '#2c7d28'); }
    g.restore();
  }
  function drawFruitTree(sp, stage, fruit) {
    const c = FT[sp];
    return mk(128, 176, (g, W, H) => {
      const r = mulberry32(900 + sp.length * 31 + stage * 7), base = H - 8, s = [.34, .66, 1][stage];
      shadow(g, 64, H - 10, 40 * s + 8, 10 * s + 3, .3);
      if (stage === 0) mound(g, 64, base - 2, 14, 5);
      const th = [24, 54, 84][stage], tw = [3.2, 7, 12][stage];
      const tg = g.createLinearGradient(64 - tw, 0, 64 + tw, 0); tg.addColorStop(0, '#7a4e26'); tg.addColorStop(.6, '#5a3819'); tg.addColorStop(1, '#3f2710');
      g.fillStyle = tg; g.beginPath(); g.moveTo(64 - tw * 1.5, base); g.quadraticCurveTo(64 - tw * .9, base - th * .5, 64 - tw * .6, base - th);
      g.lineTo(64 + tw * .6, base - th); g.quadraticCurveTo(64 + tw * .9, base - th * .5, 64 + tw * 1.5, base); g.closePath(); g.fill();
      const R = [15, 28, 44][stage], k = R / 44, cx = 64, cy = base - th - R * .3, cols = [c.dark, c.mid, c.light];
      for (let layer = 0; layer < 3; layer++) {
        const n = stage === 0 ? 4 - layer : 7 - layer;
        for (let i = 0; i < n; i++) {
          const a = r() * TAU, d = (r() * .5 + .25) * (46 - layer * 12) * k;
          ball(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * .8 - layer * 6 * k, (24 - layer * 3 + r() * 6) * k, cols[layer][0], cols[layer][1]);
        }
      }
      g.fillStyle = 'rgba(255,255,200,.12)';
      for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(cx - 26 * k + r() * 52 * k, cy - 22 * k + r() * 30 * k, (2 + r() * 4) * k, 0, TAU); g.fill(); }
      if (c.blossom && !(stage === 2 && fruit) && stage > 0) {     // flores do pessegueiro
        g.fillStyle = c.blossom; for (let i = 0; i < 16; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * .95; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .7, 2.2, 0, TAU); g.fill(); }
      }
      if (stage === 2 && fruit) {
        for (let i = 0; i < 11; i++) { const a = r() * TAU, d = Math.sqrt(r()) * .88; drawFruit(g, sp, cx + Math.cos(a) * d * R, cy + Math.sin(a) * d * R * .7 + 4, 6.8); }
      }
    });
  }
  const FRUIT_SP = Object.keys(FT);
  const fruitIcon = sp => mk(48, 48, g => { drawFruit(g, sp, 17, 29, 10.5); drawFruit(g, sp, 31, 26, 13.5); });
  const saplingIcon = sp => mk(48, 48, g => {
    mound(g, 24, 40, 14, 5); g.strokeStyle = '#6e4521'; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(24, 40); g.quadraticCurveTo(25, 28, 24, 18); g.stroke();
    const c = FT[sp]; leaf(g, 24, 28, -2.7, 13, 5, c.light[0], c.dark[1]); leaf(g, 24, 24, -.45, 13, 5, c.mid[0], c.dark[1]); leaf(g, 24, 18, -Math.PI / 2 - .3, 14, 5, c.light[0], c.dark[1]); leaf(g, 24, 18, -Math.PI / 2 + .5, 12, 4.5, c.mid[0], c.dark[1]);
    if (c.blossom) { g.fillStyle = c.blossom; for (const [x, y] of [[17, 22], [31, 20], [24, 10]]) { g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); } }
  });

  /* ---------------- MACHADO (mesma orientação da picareta: cabo para baixo/direita, cabeça para cima/esquerda) ---------------- */
  function drawAxeSprite() {
    return mk(72, 72, g => {
      g.translate(36, 42); g.rotate(-Math.PI / 4);
      const hg = g.createLinearGradient(-4, 0, 4, 0); hg.addColorStop(0, '#c99660'); hg.addColorStop(.55, '#8a5b30'); hg.addColorStop(1, '#5a3819');
      g.fillStyle = hg; g.beginPath(); g.moveTo(-3.4, 34); g.lineTo(3.4, 34); g.lineTo(2.7, -30); g.lineTo(-2.7, -30); g.closePath(); g.fill();
      g.fillStyle = '#4e3017'; g.fillRect(-3.6, 20, 7.2, 14);
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; for (let y = 22; y < 34; y += 3.5) { g.beginPath(); g.moveTo(-3.6, y); g.lineTo(3.6, y + 1.5); g.stroke(); }
      const sg = g.createLinearGradient(-4, -36, 24, -12); sg.addColorStop(0, '#f2f5f7'); sg.addColorStop(.5, '#9aa4ac'); sg.addColorStop(1, '#5a636a');
      g.fillStyle = sg; g.beginPath(); g.moveTo(-4, -31); g.lineTo(4, -31); g.bezierCurveTo(10, -36, 20, -38, 23, -33); g.bezierCurveTo(19, -28, 19, -21, 23, -15); g.bezierCurveTo(19, -11, 10, -12, 4, -16); g.lineTo(-4, -16); g.closePath(); g.fill();
      g.strokeStyle = '#3a4249'; g.lineWidth = 1.6; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(8, -33); g.bezierCurveTo(15, -35, 20, -35, 21.5, -32); g.stroke();
      g.fillStyle = '#3a4249'; g.fillRect(-5, -31, 3, 15);
    });
  }

  /* ---------------- ITENS DESENHADOS EM TEMPO REAL ---------------- */
  function drawChicken(g, x, y, dir, t, moving, peck) {
    g.save(); g.translate(x, y); g.scale(dir, 1);
    shadow(g, 0, 2, 11, 4, .25);
    const bob = moving ? Math.abs(Math.sin(t * 14)) * 2 : 0;
    g.translate(0, -bob);
    // pernas
    g.strokeStyle = '#e29a2a'; g.lineWidth = 1.8;
    const l = moving ? Math.sin(t * 14) * 3 : 0;
    g.beginPath(); g.moveTo(-3, -7); g.lineTo(-3 + l, 0); g.moveTo(3, -7); g.lineTo(3 - l, 0); g.stroke();
    // corpo
    ball(g, 0, -13, 10, '#ffffff', '#d9d4c4', .85);
    // cauda
    g.fillStyle = '#e8e2d0'; g.beginPath(); g.moveTo(-8, -15); g.quadraticCurveTo(-17, -22, -13, -9); g.quadraticCurveTo(-9, -10, -8, -15); g.fill();
    // asa
    g.fillStyle = '#e1dccb'; g.beginPath(); g.ellipse(-1, -12, 5, 3.5, .3, 0, TAU); g.fill();
    // cabeça
    const hy = peck ? -11 : -22, hx = peck ? 11 : 8;
    ball(g, hx, hy, 5.2, '#ffffff', '#d9d4c4');
    g.fillStyle = '#d8281e'; g.beginPath(); g.arc(hx - 1, hy - 5, 2.2, 0, TAU); g.arc(hx + 1.5, hy - 5, 1.8, 0, TAU); g.fill();
    g.fillStyle = '#f0a020'; g.beginPath(); g.moveTo(hx + 4.5, hy - 1); g.lineTo(hx + 9, hy + .5); g.lineTo(hx + 4.5, hy + 2); g.fill();
    g.fillStyle = '#d8281e'; g.beginPath(); g.ellipse(hx + 4, hy + 3.5, 1.3, 2, 0, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(hx + 1.8, hy - 1.2, 1, 0, TAU); g.fill();
    g.restore();
  }
  function drawEgg(g, x, y) {
    shadow(g, x, y + 2, 6, 2.5, .25);
    const gr = g.createRadialGradient(x - 2, y - 6, 1, x, y - 4, 7);
    gr.addColorStop(0, '#fffaf0'); gr.addColorStop(1, '#e4d3b0');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y - 4, 5, 6.5, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(120,90,40,.4)'; g.lineWidth = .8; g.stroke();
  }
  function drawCan(g, x, y, tilt, sc = 1) {
    g.save(); g.translate(x, y); g.rotate(tilt); g.scale(sc, sc);
    // cano
    g.strokeStyle = '#6f7b84'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(8, 4); g.lineTo(26, -8); g.stroke();
    g.fillStyle = '#8f9ba4'; g.beginPath(); g.moveTo(24, -14); g.lineTo(32, -6); g.lineTo(26, -2); g.lineTo(20, -8); g.fill();
    // corpo
    const gr = g.createLinearGradient(-14, 0, 12, 0); gr.addColorStop(0, '#6fb0d0'); gr.addColorStop(1, '#2f7a9f');
    g.fillStyle = gr; g.beginPath(); g.moveTo(-14, -10); g.lineTo(10, -10); g.lineTo(12, 12); g.lineTo(-14, 12); g.closePath(); g.fill();
    g.strokeStyle = '#1f566f'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(-11, -8, 4, 18);
    g.strokeStyle = '#1f566f'; g.lineWidth = 3; g.beginPath(); g.arc(-14, 0, 8, Math.PI * .5, Math.PI * 1.5); g.stroke();
    g.beginPath(); g.arc(0, -10, 10, Math.PI, 0); g.stroke();
    g.restore();
  }

  /* ---------------- ícones de HUD (dataURL) ---------------- */
  function icon(canvas, size = 48) {
    const c = mk(size, size, g => {
      const sc = Math.min(size / canvas.width, size / canvas.height);
      const w = canvas.width * sc, h = canvas.height * sc;
      g.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
    });
    return c.toDataURL();
  }

  const out = {
    TAU, mk, ball, leaf, shadow, mulberry32, crops, drawCan, drawChicken, drawEgg, icon,
    CW, CH, FRUIT_SP,
    barn: null, stall: null, bin: null, well: null, coop: null, trees: [], rocks: [], stump: null, bushes: [],
    init() {
      this.barn = drawBarn(); this.stall = drawStall(); this.bin = drawBin(); this.well = drawWell(); this.coop = drawCoop();
      this.trees = [0, 1, 2].map(drawTree); this.rocks = [0, 1].map(drawRock); this.stump = drawStump();
      this.bushes = [0, 1, 2].map(drawBush);
      // ícone do regador
      this.canIcon = mk(48, 48, g => drawCan(g, 22, 28, -.15, 1.05));
      this.fruitTrees = {}; this.fruitIcons = {}; this.saplingIcons = {};
      for (const sp of FRUIT_SP) {
        this.fruitTrees[sp] = [drawFruitTree(sp, 0, false), drawFruitTree(sp, 1, false), drawFruitTree(sp, 2, false), drawFruitTree(sp, 2, true)];
        this.fruitIcons[sp] = fruitIcon(sp); this.saplingIcons[sp] = saplingIcon(sp);
      }
      this.axe = drawAxeSprite();
    }
  };
  return out;
})();
