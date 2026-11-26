'use strict';
/* Orçamento de desempenho da LÓGICA dos bichos, em Node (tempo real, de verdade):   node tests/desempenho.test.js
   O corredor de testes de navegador roda em tempo VIRTUAL, onde `performance.now()` não anda dentro de um laço síncrono, então o custo da lógica é medido aqui: o `animais.js` roda sob Node com um
   ambiente de mentira (sem DOM, sem desenho) e o rebanho CHEIO (4 vacas + 4 porcos + 2 cavalos + 8 ovelhas + 8 coelhos + o cachorro = 27 bichos). O que NÃO se mede aqui: o desenho (precisa de GPU/aparelho
   real). Limite: 1 ms por atualização (a 60 fps o quadro inteiro tem 16,7 ms; a lógica real costuma gastar centésimos de ms). Código de saída 0 = tudo passou. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Rebanho = require('../rebanho.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'animais.js'), 'utf8');
const Animals = new Function('Rebanho', 'document', src + '\n;return Animals;')(Rebanho, undefined);

const tests = []; const test = (name, fn) => tests.push([name, fn]);
const mkEnv = P => ({
  P, MW: 64, MH: 49, time: () => 0, icons: {}, shadow() { }, Snd: { moo() { }, oink() { }, bark() { }, baa() { }, thump() { } }, heart() { }, takeTruffle() { },
  blocked: () => false, isWater: () => false, boxBlocked: () => false, onScreen: () => true,
});
const roster = () => {
  const S = Object.assign({ gold: 1e7, day: 5, min: 9 * 60, milk: 0, harvest: { cenoura: 0 }, owned: { vaca: 4, porco: 4, cavalo: 2, ...Rebanho.OWNED_DEFAULT }, milked: [], meatDone: [], truffleList: [], digs: [] }, Rebanho.defaults());
  for (const id of ['portao', 'tesoura', 'cocho', 'estacao', 'oficina', 'coelheira', 'coelheira', 'coelheira', 'coelheira', 'bebedouro', 'tigela', 'alface', 'toca']) Rebanho.buy(S, id);
  for (let i = 0; i < 8; i++) { Rebanho.buyAnimal(S, 'ovelha'); Rebanho.buyAnimal(S, 'coelho'); }
  const P = { x: 8 * 64, y: 7 * 64, dir: 0, moving: false, wk: 0 };
  Animals.bind(mkEnv(P)); Animals.spawn(S);
  return { S, P };
};

test('o rebanho cheio tem 27 bichos e a lógica custa menos de 1 ms por atualização (20.000 atualizações = 333 s de jogo)', () => {
  const { S } = roster(); assert.strictEqual(Animals.list.length, 27);
  for (let i = 0; i < 2000; i++) Animals.update(.05, S);                         // aquecimento (o JIT)
  const N = 20000, t0 = process.hrtime.bigint(); for (let i = 0; i < N; i++) Animals.update(.05, S); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log('       lógica: ' + ms.toFixed(4) + ' ms por atualização (27 bichos)');
  assert.ok(ms < 1, 'a lógica dos bichos custa ' + ms.toFixed(3) + ' ms por atualização');
});
test('escolher o quadro de cada ovelha e coelho (pickRow) também é barato: menos de 20 µs por bicho', () => {
  const { S } = roster(); const rows = Animals.list.filter(a => a.kind === 'ovelha' || a.kind === 'coelho'); assert.strictEqual(rows.length, 16);
  for (let i = 0; i < 20000; i++) Animals.update(.05, S);
  const N = 100000, t0 = process.hrtime.bigint(); let x = 0; for (let i = 0; i < N; i++) for (const a of rows) x += Animals.pickRow(a, S).frame; const us = Number(process.hrtime.bigint() - t0) / 1e3 / N / rows.length;
  console.log('       pickRow: ' + us.toFixed(3) + ' µs por bicho'); assert.ok(us < 20 && Number.isFinite(x), 'pickRow custa ' + us.toFixed(2) + ' µs');
});
test('depois de 300 s de jogo ninguém saiu do recinto, nada virou NaN e nenhum coelho fica pulando para sempre', () => {
  const { S } = roster(); const pens = { vaca: 'curral', porco: 'curral', ovelha: 'pasto', coelho: 'coelheira' }; let maxHop = 0; const run = new Map();
  for (let i = 0; i < 6000; i++) {
    Animals.update(.05, S);
    for (const a of Animals.list) if (a.kind === 'coelho') { if (a.moving) { const r = (run.get(a.id) || 0) + 1; run.set(a.id, r); maxHop = Math.max(maxHop, r); } else run.set(a.id, 0); }
  }
  for (const a of Animals.list) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), a.kind + ' com posição inválida');
    const p = pens[a.kind] && Animals.PENS[pens[a.kind]];
    if (p) { const tx = Math.floor(a.x / 64), ty = Math.floor(a.y / 64); assert.ok(tx >= p.in.x0 && tx <= p.in.x1 && ty >= p.in.y0 && ty <= p.in.y1, a.kind + ' saiu do recinto: ' + tx + ',' + ty); }
  }
  assert.ok(maxHop * .05 < 12, 'um coelho pulou ' + (maxHop * .05).toFixed(1) + ' s seguidos (limite 12 s)');
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok     ' + name); } catch (e) { fail++; console.log('FALHOU ' + name + '\n   ✗ ' + (e && e.message || e).split('\n')[0]); if (process.env.VERBOSE) console.log(e && e.stack); }
  }
  console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
