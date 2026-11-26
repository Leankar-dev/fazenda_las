#!/usr/bin/env node
'use strict';
/* Simula a ECONOMIA do rebanho (ovelhas e coelhos) por 30 dias usando o próprio rebanho.js, e compara com vaca e porco.   uso: node tools/simular-economia.js [--dias=30]
   Serve para CALIBRAR os preços (Fase 7 do plano das ovelhas) sem abrir o jogo. Cada plano é uma lista de compras na ordem; todo dia o "jogador" compra o que couber, tosquia e colhe
   TUDO que está pronto, faz as receitas da oficina, mantém feno e ração em dia e vende tudo. A renda da horta fica DE FORA de propósito (ela domina qualquer bicho: abóbora ≈ 29 ◎/dia
   por tile líquidos): aqui se mede só o retorno do investimento no rebanho, isolado.
   Saídas por plano: investimento total, retorno por dia no regime (média dos últimos 10 dias), dia de empate (ouro volta ao ponto de partida) e ouro líquido no dia N.
   Constantes do jogo (preço do leite, da carne, da trufa; custo da vaca e do porco) são LIDAS do game.js: se mudarem lá, a comparação acompanha. Determinístico (gerador com semente). */
const fs = require('fs'), path = require('path');
const Rebanho = require(path.join(__dirname, '..', 'rebanho.js'));
const DIAS = +((process.argv.find(a => a.startsWith('--dias=')) || '').split('=')[1]) || 30;
const mul = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- constantes do jogo (game.js)
const game = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const num = re => { const m = re.exec(game); if (!m) throw new Error('não achei ' + re); return +m[1]; };
const MILK = num(/MILK_PRICE = (\d+)/), MEAT = num(/MEAT_PRICE = (\d+)/), TRUFFLE = num(/TRUFFLE_PRICE = (\d+)/);
const anim = fs.readFileSync(path.join(__dirname, '..', 'animais.js'), 'utf8'), costOf = k => { const mm = new RegExp(k + ': \\{[\\s\\S]*?cost: (\\d+)').exec(anim); if (!mm) throw new Error('não achei o preço de ' + k); return +mm[1]; };
const COW_COST = costOf('vaca'), PIG_COST = costOf('porco');
const PIG_TRUFFLE_CHANCE = .75;      // game.js: cada porco tem 75% de chance de esconder uma trufa por dia

function sim(plan, dias, seed) {
  const rnd = mul(seed), S = Object.assign({ gold: 100000, day: 1, milk: 0, harvest: { cenoura: 0 }, owned: { vaca: 0, porco: 0, cavalo: 0, ...Rebanho.OWNED_DEFAULT } }, Rebanho.defaults());
  const start = S.gold; let spent = 0, queue = plan.slice(); const log = [];
  const buyNext = () => {
    while (queue.length) {
      const [kind, id] = queue[0], r = kind === 'animal' ? Rebanho.canBuyAnimal(S, id) : Rebanho.canBuy(S, id);
      if (!r.ok) { if (r.why === 'ouro insuficiente') return; queue.shift(); continue; }       // não dá para comprar por outro motivo: pula (não trava o plano)
      const g0 = S.gold; if (kind === 'animal') Rebanho.buyAnimal(S, id); else Rebanho.buy(S, id); spent += g0 - S.gold; queue.shift();
    }
  };
  for (let d = 1; d <= dias; d++) {
    S.day = d + 1;                          // (dia 1 = o dia 2 do relógio: a lã nunca tosquiada já está pronta)
    Rebanho.dailyTick(S);
    buyNext();
    // mantém comida: 1 feno por 4 ovelhas/dia, 1 ração por 4 coelhos/dia (compra pacote de 5 quando falta)
    const need = Rebanho.fx(S).feedNeed;
    if (S.reb.gear.cocho && S.reb.feed.feno < need.feno * 2) { const g0 = S.gold; if (Rebanho.buy(S, 'feno').ok) spent += g0 - S.gold; }
    if (S.reb.gear.tigela && !S.reb.gear.alface && S.reb.feed.racao < need.racao * 2) { const g0 = S.gold; if (Rebanho.buy(S, 'racao').ok) spent += g0 - S.gold; }
    let n = 0; for (let i = 0; i < (S.owned.ovelha | 0); i++) if (Rebanho.shear(S, i).ok) n++;
    for (let i = 0; i < (S.owned.coelho | 0); i++) Rebanho.collectRabbit(S, i, rnd);
    while (Rebanho.canCraft(S, 'fiar').ok) Rebanho.craft(S, 'fiar');
    while (Rebanho.canCraft(S, 'curtir').ok) Rebanho.craft(S, 'curtir');
    const take = Rebanho.takeProducts(S); S.gold += take.total; log.push(take.total);
  }
  const tail = log.slice(-10), regime = tail.reduce((a, b) => a + b, 0) / tail.length;
  let acc = -spent, breakeven = null; for (let i = 0; i < log.length; i++) { acc += log[i]; if (breakeven === null && acc >= 0) breakeven = i + 1; }
  return { spent, regime, breakeven, net: S.gold - start, log };
}

const A = (...ids) => ids.map(id => ['gear', id]);
const animais = (kind, n) => Array.from({ length: n }, () => ['animal', kind]);
const PLANOS = {
  'ovelha mínima: portão + tesoura + 4 ovelhas': [...A('portao', 'tesoura'), ...animais('ovelha', 4)],
  'ovelha cheia: 8 ovelhas, cocho+feno, estação, saco': [...A('portao', 'tesoura'), ...animais('ovelha', 8), ...A('cocho', 'estacao', 'saco')],
  'ovelha cheia + oficina (fia a lã)': [...A('portao', 'tesoura'), ...animais('ovelha', 8), ...A('cocho', 'estacao', 'saco', 'oficina')],
  'coelho mínimo: 1 coelheira + 2 coelhos': [...A('coelheira'), ...animais('coelho', 2)],
  'coelho cheio: 4 coelheiras, 8 coelhos, bebedouro, toca, alface': [...A('coelheira', 'coelheira', 'coelheira', 'coelheira'), ...animais('coelho', 8), ...A('bebedouro', 'toca', 'alface')],
  'coelho cheio com ração em vez do alface': [...A('coelheira', 'coelheira', 'coelheira', 'coelheira'), ...animais('coelho', 8), ...A('bebedouro', 'toca', 'tigela')],
};
const fmt = (v, d = 0) => v === null ? '—' : v.toFixed(d).replace('.', ',');
console.log(`Economia do rebanho — ${DIAS} dias, tudo colhido todo dia, horta fora da conta (preços do rebanho.js; leite ${MILK} ◎, carne ${MEAT} ◎, trufa ${TRUFFLE} ◎ do game.js)\n`);
console.log('| plano | investimento | ◎/dia no regime | ◎/dia por 100 ◎ | dia de empate | ouro líquido no dia ' + DIAS + ' |\n|---|---:|---:|---:|---:|---:|');
const rows = {};
for (const [nome, plano] of Object.entries(PLANOS)) { const r = sim(plano, DIAS, 20261126); rows[nome] = r; console.log(`| ${nome} | ${r.spent} | ${fmt(r.regime, 1)} | ${fmt(r.regime / r.spent * 100, 1)} | ${r.breakeven === null ? 'nunca' : r.breakeven} | ${fmt(r.net)} |`); }
// vaca e porco (modelo do game.js): vaca = 1 leite/dia; porco = 2 carnes/dia + 75% de achar 1 trufa/dia
const vaca = MILK, porco = 2 * MEAT + PIG_TRUFFLE_CHANCE * TRUFFLE;
console.log(`| *(referência)* 4 vacas | ${4 * COW_COST} | ${fmt(4 * vaca, 1)} | ${fmt(vaca / COW_COST * 100, 1)} | ${Math.ceil(COW_COST / vaca)} | ${fmt(4 * vaca * DIAS - 4 * COW_COST)} |`);
console.log(`| *(referência)* 4 porcos | ${4 * PIG_COST} | ${fmt(4 * porco, 1)} | ${fmt(porco / PIG_COST * 100, 1)} | ${Math.ceil(PIG_COST / porco)} | ${fmt(4 * porco * DIAS - 4 * PIG_COST)} |`);
// por bicho, no regime (só o bicho, sem a estrutura em volta): o que o plano de calibração pede (ovelha ~10%/dia, coelho ~20%/dia, ambos abaixo do porco)
const P = Rebanho.PRODUCTS, ov = P.wool.price / Rebanho.WOOL_DAYS, co = (P.rmeat.price + P.rpelt.price) / 2;
console.log(`\nPor bicho, sem estruturas: ovelha ${fmt(ov, 1)} ◎/dia (${fmt(ov / Rebanho.ANIMALS.ovelha.cost * 100, 1)}%/dia do preço) · coelho ${fmt(co, 1)} ◎/dia (${fmt(co / Rebanho.ANIMALS.coelho.cost * 100, 1)}%/dia) · vaca ${vaca} ◎/dia (${fmt(vaca / COW_COST * 100, 1)}%) · porco ${fmt(porco, 0)} ◎/dia (${fmt(porco / PIG_COST * 100, 1)}%)`);
const ok = [['ovelha entre 7% e 13%/dia', ov / Rebanho.ANIMALS.ovelha.cost * 100 >= 7 && ov / Rebanho.ANIMALS.ovelha.cost * 100 <= 13], ['coelho entre 15% e 25%/dia', co / Rebanho.ANIMALS.coelho.cost * 100 >= 15 && co / Rebanho.ANIMALS.coelho.cost * 100 <= 25],
  ['nenhum bicho novo rende mais por ◎ investido que o porco', ov / Rebanho.ANIMALS.ovelha.cost < porco / PIG_COST && co / Rebanho.ANIMALS.coelho.cost < porco / PIG_COST],
  ['todo plano completo se paga em até 15 dias', Object.entries(rows).filter(([n]) => /cheia|cheio/.test(n)).every(([, r]) => r.breakeven !== null && r.breakeven <= 15)]];
console.log('\nMetas de calibração:'); for (const [t, v] of ok) console.log((v ? '  ✔ ' : '  ✘ ') + t);
process.exit(ok.every(x => x[1]) ? 0 : 1);
