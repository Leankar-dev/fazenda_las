'use strict';
/* Testes UNITÁRIOS de ovelhas e coelhos (rebanho.js), em Node puro, sem navegador:   node tests/rebanho.test.js
   O módulo é só lógica (sem DOM/localStorage): espécies, catálogo, compra, tosquia, produto do coelho, comida, oficina, venda, saneamento do save. O desenho, a IA dos bichos
   e a interface (loja, HUD, teclas) entram nas fases seguintes e serão cobertos por cenários de navegador. Código de saída 0 = tudo passou. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Rebanho = require('../rebanho.js');
const SaveLib = require('../save.js');

const tests = []; const test = (name, fn) => tests.push([name, fn]);
const newS = (over = {}) => Object.assign({ gold: 5000, day: 5, milk: 0, harvest: { cenoura: 0 }, owned: { vaca: 0, porco: 0, cavalo: 0, ...Rebanho.OWNED_DEFAULT } }, Rebanho.defaults(), over);
const kit = () => SaveLib.create({ read: () => null, write() { }, remove() { }, keys: () => [] }).kit();
const buyAll = (S, ids) => { for (const id of ids) { const r = Rebanho.buy(S, id); assert.ok(r.ok, id + ': ' + r.why); } };
const never = () => 1, always = () => 0;      // rnd: nunca / sempre sorteia o "extra"

/* ============================ catálogo e arquivos ============================ */
test('sprites: todo sprite citado existe em assets/animais/props, está no rebanho.json (mesmo tamanho) e é RGBA; os ícones das espécies e as sheets existem', () => {
  const root = path.join(__dirname, '..'), dir = path.join(root, 'assets', 'animais', 'props'), meta = JSON.parse(fs.readFileSync(path.join(dir, 'rebanho.json'), 'utf8')).items;
  for (const n of Rebanho.SPRITES) {
    const b = fs.readFileSync(path.join(dir, n + '.png')); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG', n); assert.strictEqual(b[25], 6, n + ' RGBA');
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], meta[n].size, n + ': tamanho == rebanho.json');
  }
  assert.strictEqual(Rebanho.spriteUrl('oficina'), 'assets/animais/props/oficina.png');
  for (const k of Rebanho.KINDS) { assert.ok(fs.existsSync(path.join(root, Rebanho.iconUrl(k))), k + ' icon'); assert.ok(fs.existsSync(path.join(root, 'assets', 'animais', Rebanho.ANIMALS[k].sheet, 'sheet.png'))); }
});
test('catálogo: ids únicos, preço inteiro > 0, texto, dependências (`needs`) apontam para itens que existem, e a ordem do catálogo compra tudo sem travar', () => {
  const ids = Rebanho.GEAR.map(g => g.id); assert.strictEqual(new Set(ids).size, ids.length);
  for (const g of Rebanho.GEAR) {
    assert.ok(Number.isInteger(g.cost) && g.cost > 0, g.id); assert.ok(g.name && g.info && g.group && g.img, g.id);
    for (const n of g.needs || []) assert.ok(Rebanho.GEAR_BY[n], g.id + ' precisa de ' + n + ' que não existe');
  }
  const S = newS({ gold: 1e6 }); for (const g of Rebanho.GEAR) assert.ok(Rebanho.buy(S, g.id).ok, 'na ordem do catálogo: ' + g.id);
});
test('espécies e produtos: preços inteiros; o que é beneficiado vale mais que os insumos crus (senão a oficina não compensa)', () => {
  for (const k of Rebanho.KINDS) { const a = Rebanho.ANIMALS[k]; assert.ok(Number.isInteger(a.cost) && a.cost > 0 && a.max >= 1 && a.h > 0 && a.info, k); }
  for (const k of Rebanho.PRODUCT_KEYS) assert.ok(Number.isInteger(Rebanho.PRODUCTS[k].price) && Rebanho.PRODUCTS[k].price > 0, k);
  const P = Rebanho.PRODUCTS; assert.ok(P.yarn.price > 3 * P.wool.price, 'fio > 3 lãs'); assert.ok(P.pelt.price > 2 * P.rpelt.price, 'curtida > 2 cruas'); assert.ok(P.cheese.price > 3 * 42, 'queijo > 3 leites (42 ◎ cada, MILK_PRICE do game.js)');
  assert.ok(/40 ◎/.test(Rebanho.ANIMALS.ovelha.info), 'o texto da ovelha cita o preço real da lã');
});

/* ============================ compra ============================ */
test('canBuy: motivo certo para cada bloqueio (dependência, já comprado, limite, estoque, ouro)', () => {
  const S = newS({ gold: 10 });
  assert.deepStrictEqual(Rebanho.canBuy(S, 'coisa'), { ok: false, why: 'item desconhecido' });
  assert.strictEqual(Rebanho.canBuy(S, 'portao').why, 'ouro insuficiente');
  assert.strictEqual(Rebanho.canBuy(S, 'cocho').why, 'compre o portão do aprisco antes');
  assert.strictEqual(Rebanho.canBuy(S, 'bebedouro').why, 'compre uma coelheira antes');
  assert.strictEqual(Rebanho.canBuy(S, 'racao').why, 'compre a tigela de ração antes');
  assert.strictEqual(Rebanho.canBuy(S, 'feno').why, 'compre o cocho antes');
  S.gold = 5000; buyAll(S, ['portao', 'cocho']); assert.strictEqual(Rebanho.canBuy(S, 'portao').why, 'já comprado');
  for (let i = 0; i < 4; i++) buyAll(S, ['coelheira']); assert.ok(/no limite/.test(Rebanho.canBuy(S, 'coelheira').why));
  for (let i = 0; i < 4; i++) buyAll(S, ['feno']); assert.strictEqual(S.reb.feed.feno, Rebanho.FEED_CAP); assert.strictEqual(Rebanho.canBuy(S, 'feno').why, 'estoque cheio');
});
test('buy: cobra o preço exato, aplica o efeito e recusa sem mexer no ouro; pacote de consumível soma o pacote e respeita o teto', () => {
  const S = newS({ gold: 400 }); const r = Rebanho.buy(S, 'portao'); assert.ok(r.ok); assert.strictEqual(S.gold, 100); assert.strictEqual(S.reb.gear.portao, 1);
  const before = JSON.stringify(S); const bad = Rebanho.buy(S, 'estacao'); assert.strictEqual(bad.ok, false); assert.strictEqual(JSON.stringify(S), before, 'recusa não altera nada');
  S.gold = 1000; buyAll(S, ['cocho', 'feno']); assert.strictEqual(S.reb.feed.feno, 5); assert.strictEqual(S.gold, 1000 - 120 - 25);
  buyAll(S, ['coelheira']); assert.strictEqual(S.reb.coelheiras, 1);
});
test('ração: pode ser comprada com ouro ou feita com 5 cenouras colhidas (sem ouro); sem cenouras suficientes diz quantas faltam', () => {
  const S = newS({ gold: 0 }); buyAll(Object.assign(S, { gold: 1000 }), ['coelheira', 'tigela']); S.gold = 0;
  assert.strictEqual(Rebanho.canBuy(S, 'racao').why, 'ouro insuficiente');
  const no = Rebanho.buyFeedWithCarrots(S); assert.strictEqual(no.ok, false); assert.ok(/5 cenouras/.test(no.why));
  S.harvest.cenoura = 7; assert.ok(Rebanho.buyFeedWithCarrots(S).ok); assert.strictEqual(S.harvest.cenoura, 2); assert.strictEqual(S.reb.feed.racao, 5); assert.strictEqual(S.gold, 0, 'não cobrou ouro');
  S.reb.gear.tigela = 0; S.harvest.cenoura = 9; assert.strictEqual(Rebanho.buyFeedWithCarrots(S).ok, false, 'sem a tigela não vale nem com cenouras');
});
test('animais: ovelha exige o portão; coelho exige coelheira e vaga (2 por coelheira); limites; ouro; compra cobra e guarda o índice', () => {
  const S = newS({ gold: 1e6 });
  assert.strictEqual(Rebanho.canBuyAnimal(S, 'ovelha').why, 'compre o portão do aprisco antes');
  assert.strictEqual(Rebanho.canBuyAnimal(S, 'coelho').why, 'compre uma coelheira antes');
  assert.strictEqual(Rebanho.canBuyAnimal(S, 'gato').why, 'animal desconhecido');
  buyAll(S, ['portao', 'coelheira']);
  const g0 = S.gold; const r = Rebanho.buyAnimal(S, 'ovelha'); assert.deepStrictEqual([r.ok, r.idx, S.owned.ovelha, S.gold], [true, 0, 1, g0 - 220]);
  for (let i = 1; i < 8; i++) assert.ok(Rebanho.buyAnimal(S, 'ovelha').ok); assert.ok(/no limite/.test(Rebanho.canBuyAnimal(S, 'ovelha').why)); assert.strictEqual(S.owned.ovelha, 8);
  assert.ok(Rebanho.buyAnimal(S, 'coelho').ok); assert.ok(Rebanho.buyAnimal(S, 'coelho').ok);
  assert.strictEqual(Rebanho.canBuyAnimal(S, 'coelho').why, 'sem vaga: compre outra coelheira');
  buyAll(S, ['coelheira']); assert.ok(Rebanho.buyAnimal(S, 'coelho').ok); assert.strictEqual(Rebanho.fx(S).hutchSlots, 4);
  const poor = newS({ gold: 10 }); poor.reb.gear.portao = 1; assert.strictEqual(Rebanho.canBuyAnimal(poor, 'ovelha').why, 'ouro insuficiente');
});

/* ============================ efeitos (fx) ============================ */
test('fx: cada acessório muda exatamente o que diz (valores iniciais e depois de comprar)', () => {
  const S = newS(); let f = Rebanho.fx(S);
  assert.deepStrictEqual([f.pastureOpen, f.canShear, f.spareEvery, f.woolDays, f.woolCap, f.hutchSlots, f.rabbitBonus, f.workshop], [false, false, 0, 2, 20, 0, 0, false]);
  S.reb.gear.portao = 1; S.reb.gear.tesoura = 1; S.reb.gear.estacao = 1; S.reb.gear.saco = 1; S.reb.gear.oficina = 1; S.reb.coelheiras = 3;
  f = Rebanho.fx(S); assert.deepStrictEqual([f.pastureOpen, f.canShear, f.spareEvery, f.woolCap, f.hutchSlots, f.workshop], [true, true, 4, 40, 6, true]);
  S.reb.gear.bebedouro = 1; assert.ok(Math.abs(Rebanho.fx(S).rabbitBonus - .15) < 1e-9); S.reb.gear.toca = 1; assert.ok(Math.abs(Rebanho.fx(S).rabbitBonus - .25) < 1e-9);
  S.reb.gear.alface = 1; assert.ok(Math.abs(Rebanho.fx(S).rabbitBonus - .5) < 1e-9, '+15% +10% +25% (alface = ração de graça)');
  S.owned.ovelha = 5; S.owned.coelho = 9; assert.deepStrictEqual(Rebanho.fx(S).feedNeed, { feno: 2, racao: 3 }, '1 por 4 bichos, arredondando para cima');
});

/* ============================ ovelha: tosquia ============================ */
test('tosquia: exige a tesoura; mensagens de motivo; rende 1 lã e marca o dia; recusa ovelha que não existe', () => {
  const S = newS(); S.owned.ovelha = 2;
  assert.strictEqual(Rebanho.canShear(S, 0).why, 'precisa da tesoura de tosa');
  assert.strictEqual(Rebanho.canShear(S, 5).why, 'ovelha desconhecida'); assert.strictEqual(Rebanho.canShear(S, -1).why, 'ovelha desconhecida');
  S.reb.gear.tesoura = 1; const r = Rebanho.shear(S, 0); assert.deepStrictEqual([r.ok, r.gained, S.reb.wool, S.reb.sheared[0]], [true, 1, 1, 5]);
  assert.strictEqual(Rebanho.canShear(S, 0).why, 'já tosquiada hoje');
  assert.strictEqual(Rebanho.canShear(S, 1).ok, true, 'a outra ovelha continua pronta (cada uma tem o seu relógio)');
});
test('lã volta em 2 dias; com o cocho abastecido (feno) volta em 1; sem feno volta aos 2', () => {
  const S = newS({ day: 10 }); S.owned.ovelha = 1; S.reb.gear.tesoura = 1; Rebanho.shear(S, 0);
  S.day = 11; assert.strictEqual(Rebanho.canShear(S, 0).why, 'a lã ainda está crescendo'); S.day = 12; assert.ok(Rebanho.canShear(S, 0).ok, 'dia 12: voltou (2 dias)');
  Rebanho.shear(S, 0); S.reb.gear.cocho = 1; S.reb.feed.feno = 3; S.day = 13; Rebanho.dailyTick(S); assert.strictEqual(S.reb.fed, 1); assert.ok(Rebanho.canShear(S, 0).ok, 'com feno: 1 dia basta');
  Rebanho.shear(S, 0); S.reb.feed.feno = 0; S.day = 14; const t = Rebanho.dailyTick(S); assert.strictEqual(t.fedSheep, false); assert.strictEqual(Rebanho.canShear(S, 0).ok, false, 'sem feno volta a levar 2 dias');
});
test('estação de tosquia: a cada 4ª tosquia vem +1 lã (contador do jogo todo); cesto de lã: limite 20 (40 com o saco) e nunca passa dele', () => {
  const S = newS(); S.owned.ovelha = 1; S.reb.gear.tesoura = 1; S.reb.gear.estacao = 1; const got = [];
  for (let i = 0; i < 8; i++) { S.day += 2; got.push(Rebanho.shear(S, 0).gained); } assert.deepStrictEqual(got, [1, 1, 1, 2, 1, 1, 1, 2]);
  S.reb.wool = 19; S.reb.shearN = 3; S.day += 2; const r = Rebanho.shear(S, 0); assert.strictEqual(r.gained, 1, 'o +1 não passa do limite'); assert.strictEqual(S.reb.wool, 20);
  S.day += 2; assert.strictEqual(Rebanho.canShear(S, 0).why, 'cesto de lã cheio — venda na caixa'); S.reb.gear.saco = 1; assert.ok(Rebanho.canShear(S, 0).ok);
});

/* ============================ coelho ============================ */
test('coelho: 1 produto por dia por coelho, alternando carne e pele crua (dia + índice); o extra só vem se o sorteio cair abaixo do bônus', () => {
  const S = newS({ day: 4 }); S.owned.coelho = 2;
  assert.strictEqual(Rebanho.canCollectRabbit(S, 0).kind, 'rmeat'); assert.strictEqual(Rebanho.canCollectRabbit(S, 1).kind, 'rpelt');
  const a = Rebanho.collectRabbit(S, 0, never); assert.deepStrictEqual([a.ok, a.kind, a.gained, S.reb.rmeat], [true, 'rmeat', 1, 1]);
  assert.strictEqual(Rebanho.canCollectRabbit(S, 0).why, 'já deu o produto de hoje'); assert.strictEqual(Rebanho.collectRabbit(S, 0, never).ok, false);
  S.day = 5; assert.strictEqual(Rebanho.canCollectRabbit(S, 0).kind, 'rpelt', 'no dia seguinte alterna');
  S.reb.gear.bebedouro = 1; S.reb.coelheiras = 1;                                  // bônus 15%
  const b = Rebanho.collectRabbit(S, 0, always); assert.deepStrictEqual([b.gained, b.extra], [2, true]);
  const c = Rebanho.collectRabbit(S, 1, () => .149); assert.strictEqual(c.gained, 2, 'abaixo de 15% = extra'); S.day = 6; const d = Rebanho.collectRabbit(S, 1, () => .15); assert.strictEqual(d.gained, 1, '15% exato não sorteia extra');
  assert.strictEqual(Rebanho.canCollectRabbit(S, 9).why, 'coelho desconhecido');
});
test('ready(): é o que o balão do jogo consulta — ovelha só com tesoura e lã pronta, coelho até coletar no dia; espécie desconhecida nunca', () => {
  const S = newS(); S.owned.ovelha = 1; S.owned.coelho = 1;
  assert.strictEqual(Rebanho.ready(S, 'ovelha', 0), false); S.reb.gear.tesoura = 1; assert.strictEqual(Rebanho.ready(S, 'ovelha', 0), true);
  assert.strictEqual(Rebanho.ready(S, 'coelho', 0), true); Rebanho.collectRabbit(S, 0, never); assert.strictEqual(Rebanho.ready(S, 'coelho', 0), false);
  assert.strictEqual(Rebanho.ready(S, 'gato', 0), false);
});

/* ============================ comida ============================ */
test('dailyTick: gasta 1 feno/ração por 4 bichos, só se tem estoque; sem estoque o bônus some (sem punição); o alface alimenta de graça e não gasta ração', () => {
  const S = newS(); S.owned.ovelha = 5; S.owned.coelho = 3; S.reb.gear.cocho = 1; S.reb.gear.tigela = 1; S.reb.coelheiras = 2; S.reb.feed.feno = 2; S.reb.feed.racao = 1;
  let t = Rebanho.dailyTick(S); assert.deepStrictEqual([t.fedSheep, t.hay, S.reb.feed.feno, S.reb.fed], [true, 2, 0, 1]); assert.deepStrictEqual([t.fedRabbit, t.ration, S.reb.feed.racao, S.reb.fedR], [true, 1, 0, 1]);
  t = Rebanho.dailyTick(S); assert.deepStrictEqual([t.fedSheep, t.fedRabbit, S.reb.fed, S.reb.fedR], [false, false, 0, 0], 'sem estoque: sem bônus, e nada de negativo');
  assert.ok(S.reb.feed.feno >= 0 && S.reb.feed.racao >= 0);
  S.reb.gear.alface = 1; S.reb.feed.racao = 5; t = Rebanho.dailyTick(S); assert.strictEqual(t.fedRabbit, true); assert.strictEqual(S.reb.feed.racao, 5, 'o canteiro não gasta ração'); assert.ok(Rebanho.fx(S).fedRabbit);
});
test('dailyTick sem bichos não gasta comida', () => {
  const S = newS(); S.reb.gear.cocho = 1; S.reb.feed.feno = 4; Rebanho.dailyTick(S); assert.strictEqual(S.reb.feed.feno, 4); assert.strictEqual(S.reb.fed, 0);
});

/* ============================ oficina ============================ */
test('oficina: exige comprar; cada receita consome e produz exatamente o que diz; sem insumo mostra quanto falta; leite vem do S.milk do jogo', () => {
  const S = newS(); S.reb.wool = 7; S.reb.rpelt = 3; S.milk = 4;
  assert.strictEqual(Rebanho.canCraft(S, 'fiar').why, 'compre a oficina antes'); assert.strictEqual(Rebanho.canCraft(S, 'bolo').why, 'receita desconhecida');
  S.reb.gear.oficina = 1;
  let r = Rebanho.craft(S, 'fiar'); assert.deepStrictEqual([r.ok, S.reb.wool, S.reb.yarn], [true, 4, 1]);
  r = Rebanho.craft(S, 'queijo'); assert.deepStrictEqual([r.ok, S.milk, S.reb.cheese], [true, 1, 1]);
  r = Rebanho.craft(S, 'curtir'); assert.deepStrictEqual([r.ok, S.reb.rpelt, S.reb.pelt], [true, 1, 1]);
  const no = Rebanho.craft(S, 'curtir'); assert.strictEqual(no.ok, false); assert.strictEqual(no.why, 'precisa de 2 pele crua (você tem 1)'); assert.strictEqual(S.reb.rpelt, 1, 'recusa não consome');
  assert.strictEqual(Rebanho.canCraft(S, 'queijo').why, 'precisa de 3 leite (você tem 1)');
});

/* ============================ venda ============================ */
test('venda: productValue == soma dos preços; takeProducts devolve total e quantidade e ZERA os produtos (sem mexer em gear/feed/animais)', () => {
  const S = newS(); S.reb.wool = 3; S.reb.yarn = 1; S.reb.cheese = 2; S.reb.rmeat = 4; S.reb.rpelt = 5; S.reb.pelt = 1; S.reb.gear.portao = 1; S.reb.feed.feno = 3;
  const P = Rebanho.PRODUCTS, want = 3 * P.wool.price + P.yarn.price + 2 * P.cheese.price + 4 * P.rmeat.price + 5 * P.rpelt.price + P.pelt.price;
  assert.strictEqual(Rebanho.productValue(S), want); assert.strictEqual(Rebanho.productCount(S), 16);
  const t = Rebanho.takeProducts(S); assert.deepStrictEqual(t, { total: want, n: 16 }); assert.strictEqual(Rebanho.productValue(S), 0);
  assert.deepStrictEqual([S.reb.gear.portao, S.reb.feed.feno], [1, 3]); assert.deepStrictEqual(Rebanho.takeProducts(S), { total: 0, n: 0 });
});

/* ============================ save ============================ */
test('defaults ↔ sanitize: o padrão passa limpo (0 correções) e é idempotente; save antigo (sem `reb`) ganha o padrão sem contar como correção', () => {
  const d = Rebanho.defaults(), st = JSON.parse(JSON.stringify(d)), k = kit(); Rebanho.sanitize(st, k); assert.strictEqual(k.repairs(), 0); assert.deepStrictEqual(st, d);
  const old = { gold: 1 }, k2 = kit(); Rebanho.sanitize(old, k2); assert.strictEqual(k2.repairs(), 0, 'chave ausente só recebe o padrão'); assert.deepStrictEqual(old.reb, d.reb);
  const again = JSON.parse(JSON.stringify(old)), k3 = kit(); Rebanho.sanitize(again, k3); assert.deepStrictEqual(again, old); assert.strictEqual(k3.repairs(), 0);
});
test('sanitize: save hostil — NaN, negativos, 1e12, strings, listas gigantes, chaves desconhecidas e __proto__ viram valores seguros', () => {
  const st = JSON.parse('{"reb":{"wool":1e12,"yarn":-5,"cheese":"x","rmeat":null,"rpelt":0,"pelt":1.9,"coelheiras":99,"fed":7,"fedR":-1,"shearN":1e30,"gear":{"portao":5,"tesoura":-1,"inventada":1,"__proto__":{"x":1}},"feed":{"feno":1e9,"racao":"a","magia":3},"sheared":[1,2,3,4,5,6,7,8,9,10,11,12,"a",null,-4,1e12],"rdone":"x"}}');
  st.reb.rpelt = NaN; st.reb.sheared[15] = Infinity;      // NaN/Infinity não existem em JSON, mas existem em memória
  const k = kit(); Rebanho.sanitize(st, k); const r = st.reb;
  assert.ok(k.repairs() > 0);
  assert.deepStrictEqual([r.wool, r.yarn, r.cheese, r.rmeat, r.rpelt, r.pelt], [Rebanho.WOOL_CAP_BAG, 0, 0, 0, 0, 1], 'lã limitada ao teto do saco; lixo vira 0; 1.9 vira 1');
  assert.deepStrictEqual([r.coelheiras, r.fed, r.fedR], [Rebanho.HUTCH_MAX, 1, 0]); assert.ok(r.shearN <= 1e9);
  assert.deepStrictEqual(Object.keys(r.gear).sort(), Object.keys(Rebanho.defaults().reb.gear).sort(), 'chaves desconhecidas somem'); assert.deepStrictEqual([r.gear.portao, r.gear.tesoura], [1, 0]);
  assert.deepStrictEqual(Object.keys(r.feed).sort(), ['feno', 'racao']); assert.deepStrictEqual([r.feed.feno, r.feed.racao], [Rebanho.FEED_CAP, 0]);
  assert.strictEqual(r.sheared.length, Rebanho.ANIMALS.ovelha.max, 'lista cortada no número máximo de ovelhas'); assert.ok(r.sheared.every(v => Number.isInteger(v) && v >= 0 && v <= 1e6)); assert.deepStrictEqual(r.rdone, []);
  assert.strictEqual(({}).x, undefined, 'o __proto__ do save não poluiu Object.prototype');
  for (const bad of [5, 'x', [], true]) { const s2 = { reb: bad }, k2 = kit(); Rebanho.sanitize(s2, k2); assert.deepStrictEqual(s2.reb, Rebanho.defaults().reb); assert.ok(k2.repairs() >= 1, 'tipo errado conta como correção'); }
});
test('compra e colheita não corrompem o save: depois de uma sessão inteira, o estado passa limpo pelo sanitize (0 correções)', () => {
  const S = newS({ gold: 1e6 }); buyAll(S, ['portao', 'tesoura', 'estacao', 'cocho', 'feno', 'saco', 'oficina', 'coelheira', 'coelheira', 'bebedouro', 'tigela', 'racao', 'alface', 'toca']);
  for (let i = 0; i < 8; i++) Rebanho.buyAnimal(S, 'ovelha'); for (let i = 0; i < 4; i++) Rebanho.buyAnimal(S, 'coelho'); S.milk = 9;
  for (let d = 0; d < 6; d++) { S.day++; Rebanho.dailyTick(S); for (let i = 0; i < 8; i++) Rebanho.shear(S, i); for (let i = 0; i < 4; i++) Rebanho.collectRabbit(S, i, Math.random); }
  for (const id of ['fiar', 'queijo', 'curtir']) Rebanho.craft(S, id);
  const copy = JSON.parse(JSON.stringify({ reb: S.reb })), k = kit(); Rebanho.sanitize(copy, k); assert.strictEqual(k.repairs(), 0); assert.deepStrictEqual(copy.reb, S.reb);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok     ' + name); } catch (e) { fail++; console.log('FALHOU ' + name + '\n   ✗ ' + (e && e.message || e).split('\n')[0]); if (process.env.VERBOSE) console.log(e && e.stack); }
  }
  console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
