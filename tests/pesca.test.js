'use strict';
/* Testes UNITÁRIOS da pesca (pesca.js), em Node puro, sem navegador:   node tests/pesca.test.js
   O módulo é só lógica (sem DOM/localStorage): lago, lançamento, equipamentos, compra, comer/vender, saneamento do save. O desenho e a interface (loja, HUD, teclas)
   são cobertos pelos cenários de navegador (tests/run.js: pesca-*). Código de saída 0 = tudo passou. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Pesca = require('../pesca.js');
const SaveLib = require('../save.js');

const tests = []; const test = (name, fn) => tests.push([name, fn]);
// gerador pseudo-aleatório com semente (mulberry32): os testes são determinísticos
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const newS = (over = {}) => Object.assign({ gold: 1000, min: 600, rain: false, up: { basket: 0, can: 0, boots: 0, rod: 0, reel: 0 }, stat: { fish: 0 }, ...Pesca.defaults() }, over);
// lago circular de teste: centro (500,500), raio 200
const inWater = (x, y) => Math.hypot(x - 500, y - 500) < 190;
const mkLake = seed => { const r = rng(seed); return Pesca.createLake({ inWater, rnd: r, bounds: { x0: 300, y0: 300, x1: 700, y1: 700 } }); };

/* ============================ catálogo e arquivos ============================ */
test('sprites: a lista do módulo == os PNGs de assets/pesca (nem sobra arquivo nem falta); pesca.json confere; todos RGBA', () => {
  const dir = path.join(__dirname, '..', 'assets', 'pesca'), png = fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort();
  assert.deepStrictEqual(png, [...Pesca.SPRITES].sort());
  assert.ok(fs.existsSync(path.join(dir, 'pesca.json')));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'pesca.json'), 'utf8')).items;
  for (const n of Pesca.SPRITES) { const b = fs.readFileSync(path.join(dir, n + '.png')); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG'); assert.strictEqual(b[25], 6, n + ' RGBA'); assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], meta[n].size, n + ' tamanho'); }
  assert.strictEqual(Pesca.spriteUrl('boia'), 'assets/pesca/boia.png');
});
test('catálogo: ids únicos, todo item tem sprite, preço inteiro > 0, texto; as 4 espécies têm sprite, preço e energia coerentes (mais raro = mais caro)', () => {
  const ids = Pesca.GEAR.map(g => g.id); assert.strictEqual(new Set(ids).size, ids.length);
  for (const g of Pesca.GEAR) { assert.ok(Pesca.SPRITES.includes(g.img), g.id); assert.ok(Number.isInteger(g.cost) && g.cost > 0, g.id); assert.ok(g.name && g.info && g.group, g.id); }
  assert.deepStrictEqual(Pesca.FISH_KEYS.slice().sort(), ['achiga', 'bagre', 'crappie', 'perca']);
  const byRarity = Pesca.FISH_KEYS.slice().sort((a, b) => Pesca.FISH[b].w - Pesca.FISH[a].w);        // do mais comum ao mais raro
  for (let i = 1; i < byRarity.length; i++) { assert.ok(Pesca.FISH[byRarity[i]].sell > Pesca.FISH[byRarity[i - 1]].sell, 'o mais raro vale mais'); assert.ok(Pesca.FISH[byRarity[i]].energy > Pesca.FISH[byRarity[i - 1]].energy); }
});

/* ============================ equipamentos (fx), compra, venda, comida ============================ */
test('fx: sem vara não pesca; cada equipamento muda exatamente o que diz', () => {
  let S = newS(); assert.strictEqual(Pesca.fx(S).canFish, false); S.up.rod = 1; assert.strictEqual(Pesca.fx(S).canFish, true);
  const base = Pesca.fx(S); assert.strictEqual(base.waitMul, 1); assert.strictEqual(base.window, 1); assert.strictEqual(base.capacity, Pesca.BASE_CAPACITY); assert.strictEqual(base.sellMul, 1); assert.strictEqual(base.energyMul, 1); assert.strictEqual(base.eatMul, 1);
  S.up.rod = 2; assert.ok(Math.abs(Pesca.fx(S).waitMul - .7) < 1e-9, 'vara de fly: 30% mais rápido'); S.up.rod = 1;
  S.up.reel = 1; assert.ok(Math.abs(Pesca.fx(S).window - 1.6) < 1e-9); S.up.reel = 2; assert.ok(Math.abs(Pesca.fx(S).window - 2.2) < 1e-9);
  S = newS({ up: { rod: 1, reel: 0 } }); S.gear.cordao = 1; assert.strictEqual(Pesca.fx(S).capacity, 14); S.gear.rede = 1; assert.strictEqual(Pesca.fx(S).capacity, 30);
  S.gear.balanca = 1; assert.strictEqual(Pesca.fx(S).sellMul, 1.2); S.gear.chapeu = 1; assert.strictEqual(Pesca.fx(S).energyMul, .5); S.gear.multi = 1; assert.strictEqual(Pesca.fx(S).eatMul, 1.25);
  S.gear.oculos = 1; assert.strictEqual(Pesca.fx(S).seeFish, true); S.gear.colete = 1; assert.strictEqual(Pesca.fx(S).baitSave, .25); S.gear.caixa = 1; assert.strictEqual(Pesca.fx(S).baitCap, 40);
  S.gear.popper = 1; assert.strictEqual(Pesca.fx(S).lure.achiga, 2.4); assert.strictEqual(Pesca.fx(S).lure.perca, 1);
  S.bait.cera = 3; assert.ok(Math.abs(Pesca.fx(S).waitMul - .75) < 1e-9); S.bait.viva = 1; assert.strictEqual(Pesca.fx(S).bait, 'viva', 'a melhor isca vem primeiro'); assert.ok(Math.abs(Pesca.fx(S).waitMul - .55) < 1e-9); assert.strictEqual(Pesca.fx(S).rare, 1.4);
});
test('compra: nível exige o anterior; acessório é uma vez; isca respeita a caixa; ouro insuficiente não gasta; compra aplica o efeito e cobra', () => {
  const S = newS({ gold: 100 });
  assert.strictEqual(Pesca.canBuy(S, 'rod1').why, 'ouro insuficiente'); assert.strictEqual(S.gold, 100, 'recusada = nada cobrado');
  S.gold = 1000; assert.match(Pesca.canBuy(S, 'rod2').why, /antes/); assert.match(Pesca.canBuy(S, 'reel2').why, /antes/);
  assert.ok(Pesca.buy(S, 'rod1').ok); assert.strictEqual(S.up.rod, 1); assert.strictEqual(S.gold, 850); assert.strictEqual(Pesca.canBuy(S, 'rod1').why, 'já comprado');
  assert.ok(Pesca.buy(S, 'rod2').ok); assert.strictEqual(S.up.rod, 2);
  assert.ok(Pesca.buy(S, 'balanca').ok); assert.strictEqual(S.gear.balanca, 1); assert.strictEqual(Pesca.buy(S, 'balanca').ok, false);
  for (let i = 0; i < 3; i++) assert.ok(Pesca.buy(S, 'cera').ok); assert.strictEqual(S.bait.cera, 15, '3 pacotes de 5'); assert.match(Pesca.buy(S, 'cera').why, /cheia/, 'limite sem a caixa de pesca = 15');
  Pesca.buy(S, 'caixa'); assert.ok(Pesca.buy(S, 'cera').ok); assert.strictEqual(S.bait.cera, 20); assert.strictEqual(Pesca.canBuy(S, 'xyz').ok, false);
  for (const g of Pesca.GEAR) { const T = newS({ gold: 5000, up: { rod: 2, reel: 1 } }); if (g.kind === 'level') T.up[g.key] = g.lvl - 1; const r = Pesca.buy(T, g.id); assert.ok(r.ok, g.id + ' ' + r.why); assert.strictEqual(T.gold, 5000 - g.cost, g.id + ' cobrou o preço do catálogo'); }
});
test('cesto de pesca, venda e comida: capacidade, preço com balança, energia com multiferramenta', () => {
  const S = newS({ up: { rod: 1, reel: 0 } }); assert.strictEqual(Pesca.fishFree(S), 8);
  S.fish.perca = 3; S.fish.achiga = 2; assert.strictEqual(Pesca.fishCount(S), 5); assert.strictEqual(Pesca.fishFree(S), 3);
  assert.strictEqual(Pesca.fishValue(S), 3 * 10 + 2 * 42); S.gear.balanca = 1; assert.strictEqual(Pesca.sellPrice(S, 'achiga'), 50); assert.strictEqual(Pesca.fishValue(S), 3 * 12 + 2 * 50);
  assert.strictEqual(Pesca.eatGain(S, 'bagre'), 24); S.gear.multi = 1; assert.strictEqual(Pesca.eatGain(S, 'bagre'), 30);
  S.fish.perca = 99; assert.strictEqual(Pesca.fishFree(S), 0, 'nunca negativo');
});
test('chance de se soltar: perca nunca; achigã é o mais difícil; carretel, linha e puçá reduzem; nunca fica negativa', () => {
  const S = newS({ up: { rod: 1, reel: 0 } }); assert.strictEqual(Pesca.breakChance(S, 'perca'), 0); assert.ok(Pesca.breakChance(S, 'achiga') > Pesca.breakChance(S, 'bagre') && Pesca.breakChance(S, 'bagre') > Pesca.breakChance(S, 'crappie'));
  const a0 = Pesca.breakChance(S, 'achiga'); S.up.reel = 2; const a1 = Pesca.breakChance(S, 'achiga'); assert.ok(a1 < a0); S.gear.linha = 1; S.gear.puca = 1; const a2 = Pesca.breakChance(S, 'achiga'); assert.ok(a2 < a1);
  for (const k of Pesca.FISH_KEYS) assert.ok(Pesca.breakChance(S, k) >= 0);
});

/* ============================ lago ============================ */
test('lago: restock enche até o alvo, peixes nascem na água e NUNCA saem dela em 5 minutos simulados; espécies variadas; nadam e viram', () => {
  const lake = mkLake(7); lake.restock(); assert.strictEqual(lake.fish.length, Pesca.LAKE_TARGET); assert.ok(lake.fish.every(f => inWater(f.x, f.y)));
  const start = lake.fish.map(f => [f.x, f.y]); let flips = 0, last = lake.fish.map(f => f.flip);
  for (let t = 0; t < 300 * 20; t++) { lake.update(.05); lake.fish.forEach((f, i) => { assert.ok(inWater(f.x, f.y), 'saiu da água: ' + f.sp); if (f.flip !== last[i]) { flips++; last[i] = f.flip; } }); }
  assert.ok(lake.fish.some((f, i) => Math.hypot(f.x - start[i][0], f.y - start[i][1]) > 30), 'os peixes se movem'); assert.ok(flips > 5, 'os peixes mudam de direção');
  const many = mkLake(3); for (let i = 0; i < 400; i++) many.add(); const sp = new Set(many.fish.map(f => f.sp)); assert.strictEqual(sp.size, 4, 'as 4 espécies aparecem'); const c = k => many.fish.filter(f => f.sp === k).length; assert.ok(c('perca') > c('achiga'), 'perca é mais comum que achigã');
});
test('lago: sem espaço na água não trava (add devolve null); reposição durante o dia só até o alvo', () => {
  const dry = Pesca.createLake({ inWater: () => false, rnd: rng(1), bounds: { x0: 0, y0: 0, x1: 10, y1: 10 } }); assert.strictEqual(dry.add(), null); dry.restock(); assert.strictEqual(dry.fish.length, 0);
  const lake = mkLake(5); lake.restock(); const f = lake.fish[0]; lake.remove(f); assert.strictEqual(lake.fish.length, Pesca.LAKE_TARGET - 1);
  for (let i = 0; i < 70 / .5; i++) lake.update(.5); assert.strictEqual(lake.fish.length, Pesca.LAKE_TARGET, 'nasce 1 em ~60 s'); for (let i = 0; i < 400; i++) lake.update(.5); assert.strictEqual(lake.fish.length, Pesca.LAKE_TARGET, 'nunca passa do alvo');
});

/* ============================ lançamento ============================ */
// simula um lançamento inteiro: devolve { events, c }. `pressAt` = quantos s depois da mordida o jogador aperta (null = nunca)
function run(S, lake, rnd, { bx = 500, by = 500, pressAt = .3, dt = .02, max = 40, act = 1 } = {}) {
  const c = Pesca.startCast(S, lake, bx, by, rnd, act); if (c.error) return { error: c.error };
  const events = []; let tBite = null, pressed = false;
  for (let t = 0; t < max; t += dt) {
    lake.update(dt); const ev = Pesca.update(c, dt, { S, lake, rnd, activity: act }); events.push(...ev);
    if (ev.includes('bite')) tBite = t;
    if (tBite !== null && pressAt !== null && !pressed && t - tBite >= pressAt) { pressed = true; events.push('press:' + Pesca.press(c)); }
    if (c.phase === 'done') break;
  }
  return { events, c };
}
test('lançar sem vara / com o cesto cheio: erro claro e NADA é gasto', () => {
  const S = newS(), lake = mkLake(1); lake.restock(); const r = run(S, lake, rng(2)); assert.match(r.error, /Compre uma vara/);
  S.up.rod = 1; S.bait.cera = 4; S.fish.perca = 8; const r2 = run(S, lake, rng(2)); assert.match(r2.error, /cheio/); assert.strictEqual(S.bait.cera, 4, 'a isca não foi gasta');
});
test('pesca completa: com peixe perto → splash, bite, hook e caught; o peixe SAI do lago; fora de alcance → nothing; sem apertar → escaped', () => {
  const S = newS({ up: { rod: 1, reel: 0 } }), lake = mkLake(11); lake.restock(); const n0 = lake.fish.length;
  const f = lake.add('achiga'); f.x = 520; f.y = 505; lake.fish.forEach(o => { if (o !== f) { o.x = 340; o.y = 340; o.mode = 'wander'; } });
  const r = run(S, lake, rng(5), { bx: 500, by: 500, pressAt: .3 });
  assert.deepStrictEqual(r.events.filter(e => /splash|bite|press|caught|lost|escaped|nothing/.test(e)).slice(0, 3), ['splash', 'bite', 'press:hook']);
  assert.ok(r.events.includes('caught') || r.events.includes('lost'), 'resolveu: ' + r.events);
  if (r.events.includes('caught')) assert.strictEqual(lake.fish.length, n0, 'o peixe pescado saiu do lago (era n0+1)');
  // sem peixe perto: nothing
  const lonely = mkLake(2); lonely.restock(); lonely.fish.forEach(o => { o.x = 330; o.y = 330; }); const r2 = run(S, lonely, rng(5)); assert.ok(r2.events.includes('nothing') && !r2.events.includes('bite'), r2.events);
  // não apertou: escapou, e o peixe volta ao lago (não some)
  const l3 = mkLake(4); l3.restock(); const g = l3.add('perca'); g.x = 510; g.y = 500; l3.fish.forEach(o => { if (o !== g) { o.x = 330; o.y = 330; } });
  const r3 = run(S, l3, rng(5), { pressAt: null }); assert.ok(r3.events.includes('escaped'), r3.events); assert.ok(l3.fish.includes(g), 'o peixe fugiu mas continua no lago');
});
test('janela de fisgada: o carretel dá tempo; apertar fora da janela não pega; apertar cedo demais só recolhe (sem punição)', () => {
  const mk = reel => { const S = newS({ up: { rod: 1, reel } }), lake = mkLake(21); lake.restock(); lake.fish.forEach(o => { o.x = 330; o.y = 330; }); const g = lake.add('perca'); g.x = 505; g.y = 500; return { S, lake, g }; };
  let a = mk(0); const r0 = run(a.S, a.lake, rng(9), { pressAt: 1.2 }); assert.ok(r0.events.includes('escaped') && !r0.events.includes('press:hook'), 'janela de 1,0 s: apertar em 1,2 s é tarde');
  a = mk(2); const r2 = run(a.S, a.lake, rng(9), { pressAt: 1.2 }); assert.ok(r2.events.includes('press:hook'), 'carretel baitcast (2,2 s): 1,2 s ainda pega');
  // cedo demais
  a = mk(0); const c = Pesca.startCast(a.S, a.lake, 500, 500, rng(1)); assert.strictEqual(Pesca.press(c), null, 'voando: ignora'); for (let i = 0; i < 40; i++) Pesca.update(c, .02, { S: a.S, lake: a.lake, rnd: rng(1) });
  assert.strictEqual(c.phase, 'wait'); assert.strictEqual(Pesca.press(c), 'cancel'); assert.strictEqual(c.phase, 'done'); assert.strictEqual(a.g.mode, 'wander', 'o peixe é solto');
});
test('isca: gasta 1 por lançamento (a viva antes da de cera); o colete poupa às vezes; sem isca pesca igual (mais devagar)', () => {
  const S = newS({ up: { rod: 1, reel: 0 } }); S.bait.cera = 5; S.bait.viva = 2; const lake = mkLake(1); lake.restock();
  Pesca.startCast(S, lake, 500, 500, rng(1)); assert.deepStrictEqual([S.bait.viva, S.bait.cera], [1, 5]); Pesca.startCast(S, lake, 500, 500, rng(1)); assert.deepStrictEqual([S.bait.viva, S.bait.cera], [0, 5]); Pesca.startCast(S, lake, 500, 500, rng(1)); assert.deepStrictEqual([S.bait.viva, S.bait.cera], [0, 4]);
  S.gear.colete = 1; let kept = 0, used = 0; const r = rng(77); for (let i = 0; i < 400; i++) { const b = S.bait.cera; S.bait.cera = 50; Pesca.startCast(S, lake, 500, 500, r); S.bait.cera === 50 ? kept++ : used++; S.bait.cera = b; }
  assert.ok(kept > 70 && kept < 130, 'colete poupa ~25%: ' + kept + '/' + (kept + used));
  const S0 = newS({ up: { rod: 1, reel: 0 } }); assert.ok(Pesca.startCast(S0, lake, 500, 500, rng(1)).fx.bait === null);
});
test('equipamento muda a PESCA de verdade: vara/isca viva fazem o peixe chegar mais cedo; isca artificial escolhe a espécie', () => {
  const tBite = S => { let sum = 0, n = 0; for (let k = 0; k < 20; k++) { const lake = mkLake(100 + k); lake.restock(); lake.fish.forEach(o => { o.x = 330; o.y = 330; }); const g = lake.add('perca'); g.x = 690; g.y = 500;      // 190 px da boia: perto demais bateria no tempo mínimo (0,5 s de voo + 1 s) e esconderia o efeito
    if (S.bait.viva !== undefined && S.keepViva) S.bait.viva = 5;      // a isca viva acaba em 5 lançamentos: repõe para medir só o efeito dela
    const c = Pesca.startCast(S, lake, 500, 500, rng(k), 1); let t = 0; for (; t < 15; t += .02) { lake.update(.02); if (Pesca.update(c, .02, { S, lake, rnd: rng(k) }).includes('bite')) break; } if (c.phase === 'bite') { sum += t; n++; } } return sum / n; };
  const a = newS({ up: { rod: 1, reel: 0 } }), b = newS({ up: { rod: 2, reel: 0 } }), c = newS({ up: { rod: 2, reel: 0 } }); c.bait.viva = 5; c.keepViva = true;
  const ta = tBite(a), tb = tBite(b), tc = tBite(c); assert.ok(tb < ta * .85, 'vara de fly mais rápida: ' + ta.toFixed(2) + ' → ' + tb.toFixed(2)); assert.ok(tc < tb * .8, 'isca viva ainda mais: ' + tc.toFixed(2));
  // com 4 espécies junto da boia, a isca artificial muda a frequência de quem morde
  const count = (gear) => { const cnt = { perca: 0, crappie: 0, bagre: 0, achiga: 0 }; for (let k = 0; k < 600; k++) { const S = newS({ up: { rod: 1, reel: 0 } }); Object.assign(S.gear, gear); const lake = mkLake(1); lake.fish.length = 0;
    for (const sp of Pesca.FISH_KEYS) { const f = lake.add(sp); f.x = 505; f.y = 500; } const cst = Pesca.startCast(S, lake, 500, 500, rng(k)); cnt[cst.fish.sp]++; } return cnt; };
  const none = count({}), pop = count({ popper: 1 }); assert.ok(pop.achiga > none.achiga * 1.8, 'popper atrai o achigã: ' + none.achiga + ' → ' + pop.achiga); assert.ok(none.perca > none.achiga, 'sem isca a perca é mais comum');
});
test('cancelar (andar para longe, trocar de ferramenta): solta o peixe e não deixa estado preso; atividade sobe ao amanhecer/chuva', () => {
  const S = newS({ up: { rod: 1, reel: 0 } }), lake = mkLake(3); lake.restock(); lake.fish.forEach(o => { o.x = 330; o.y = 330; }); const g = lake.add('bagre'); g.x = 505; g.y = 500; const c = Pesca.startCast(S, lake, 500, 500, rng(1));
  assert.strictEqual(g.mode, 'attract'); Pesca.cancel(c); assert.strictEqual(c.phase, 'done'); assert.strictEqual(g.mode, 'wander'); Pesca.cancel(null); Pesca.cancel(c);
  assert.ok(Pesca.activity({ min: 7 * 60, rain: false }) > Pesca.activity({ min: 12 * 60, rain: false })); assert.ok(Pesca.activity({ min: 12 * 60, rain: true }) > Pesca.activity({ min: 12 * 60, rain: false }));
});

/* ============================ save ============================ */
test('save: defaults completos; sanitize limita tipos/valores de um save HOSTIL e não deixa nada fora do esperado', () => {
  const M = SaveLib.create({ read: () => null, write() { }, remove() { }, keys: () => [] }), d = Pesca.defaults();
  assert.deepStrictEqual(Object.keys(d.fish).sort(), Pesca.FISH_KEYS.slice().sort()); assert.deepStrictEqual(Object.keys(d.gear).sort(), Pesca.ONCE_KEYS.slice().sort()); assert.deepStrictEqual(Object.keys(d.bait).sort(), Pesca.BAIT_KEYS.slice().sort());
  const hostile = { fish: { perca: 1e9, achiga: -5, bagre: 'x', crappie: 2.7, fantasma: 9 }, gear: { oculos: 5, popper: 'sim', inexistente: 1 }, bait: { cera: 5000, viva: null }, up: { rod: 99, reel: -3 }, stat: { fish: NaN } };
  const k = M.kit(); Pesca.sanitize(hostile, k);
  assert.deepStrictEqual(hostile.fish, { perca: 999, crappie: 2, bagre: 0, achiga: 0 }); assert.strictEqual(hostile.gear.oculos, 1); assert.strictEqual(hostile.gear.popper, 0); assert.ok(!('inexistente' in hostile.gear));
  assert.deepStrictEqual(hostile.bait, { cera: 99, viva: 0 }); assert.strictEqual(hostile.up.rod, 2); assert.strictEqual(hostile.up.reel, 0); assert.strictEqual(hostile.stat.fish, 0); assert.ok(k.repairs() > 8, 'contou as correções: ' + k.repairs());
  const absurd = { fish: 5, gear: [], bait: 'x', up: null, stat: 7 }; const k2 = M.kit(); Pesca.sanitize(absurd, k2); assert.deepStrictEqual(absurd.fish, d.fish); assert.deepStrictEqual(absurd.gear, d.gear); assert.deepStrictEqual(absurd.bait, d.bait); assert.deepStrictEqual(absurd.up, { rod: 0, reel: 0 }); assert.deepStrictEqual(absurd.stat, { fish: 0 });
  const clean = Object.assign({ up: { rod: 1, reel: 2 }, stat: { fish: 3 } }, Pesca.defaults()); const k3 = M.kit(); Pesca.sanitize(clean, k3); assert.strictEqual(k3.repairs(), 0, 'save limpo: nenhuma correção');
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok     ' + name); } catch (e) { fail++; console.log('FALHOU ' + name + '\n   ✗ ' + (e && e.message || e).split('\n')[0]); if (process.env.VERBOSE) console.log(e && e.stack); }
  }
  console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
