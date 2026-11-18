'use strict';
/* Testes UNITÁRIOS do SaveManager (save.js), em Node puro, sem navegador:   node tests/save.test.js
   Usa um storage falso em memória (com cota e falhas injetáveis) no lugar do localStorage. As regras do JOGO (sanitização) são simuladas por
   regras mínimas — as regras reais são cobertas pelos cenários de navegador (tests/run.js: hostil-*, fixture-*). Código de saída 0 = tudo passou. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SaveLib = require('../save.js');

const FX = n => fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8');
const MAPSIZE = 46 * 34;

/* storage falso: cota em caracteres (chave + valor), `failOn(op, key, val)` para simular erros, `log` das operações */
function mem({ quota = Infinity } = {}) {
  const m = new Map(), a = {
    m, failOn: null, log: [],
    size() { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; },
    read(k) { return m.has(k) ? m.get(k) : null; },
    write(k, v) {
      if (a.failOn) a.failOn('w', k, v);
      const old = m.has(k) ? k.length + m.get(k).length : 0;
      if (a.size() - old + k.length + v.length > a.quota) { const e = new Error('cota'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v); a.log.push('w:' + k);
    },
    remove(k) { if (a.failOn) a.failOn('x', k); m.delete(k); a.log.push('x:' + k); },
    keys() { return [...m.keys()]; },
    quota,
  };
  return a;
}
/* regras mínimas do jogo: forma (soil do tamanho do mapa) + um sanitizador que "corrige" se houver `lixo` */
const RULES = {
  hydrate(d) {
    if (!Array.isArray(d.soil) || d.soil.length !== MAPSIZE) return { status: 'invalid', reason: 'shape' };
    const state = JSON.parse(JSON.stringify(d)); let repaired = 0;
    if ('lixo' in state) { delete state.lixo; repaired = 1; }
    return { status: 'ok', state, repaired };
  },
  prepare(S) { S.px = S.px === undefined ? 1 : S.px; },
  persist: S => S,
};
let clock;
function mgr(a, rules = RULES) { clock = 1000; const M = SaveLib.create(a, { now: () => (clock += 1000), iso: () => '2026-11-17T12:00:00.000Z' }); M.configure(rules); return M; }
const goodState = (day = 3, gold = 250, extra = {}) => Object.assign({ day, gold, min: 500, soil: new Array(MAPSIZE).fill(0), crops: {}, char: 'fazendeira', names: { fazendeira: 'Karen' }, earned: 40 }, extra);
const K = (M) => M.format.keys;
const envText = (M, st, rev) => JSON.stringify(M.format.wrap(st, 1, rev));
const copiesOf = a => a.keys().filter(k => k.startsWith('fazenda_las:v2:copy:')).map(k => ({ k, ts: +k.split(':').pop(), raw: a.read(k) })).sort((x, y) => x.ts - y.ts);
/* referência INDEPENDENTE do FNV-1a (BigInt), para não confiar só na própria implementação */
function fnvRef(s) { let h = 0x811c9dc5n; for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x01000193n) & 0xffffffffn; } return h.toString(16).padStart(8, '0'); }

const tests = []; const test = (name, fn) => tests.push([name, fn]);
if (!process.env.VERBOSE) console.warn = () => {};      // o SaveManager avisa (console.warn) em falhas esperadas dos testes

/* ============================ envelope, crc, versões ============================ */
test('fnv1a: vetores-padrão e referência independente', () => {
  assert.strictEqual(SaveLib.fnv1a(''), '811c9dc5'); assert.strictEqual(SaveLib.fnv1a('a'), 'e40c292c'); assert.strictEqual(SaveLib.fnv1a('foobar'), 'bf9cf968');
  for (const s of ['', 'ação 🌾', JSON.stringify(goodState()), 'x'.repeat(5000)]) assert.strictEqual(SaveLib.fnv1a(s), fnvRef(s));
});
test('wrap: campos do envelope, data sem v/rev, crc confere, summary com o nome', () => {
  const M = mgr(mem()), env = M.format.wrap(Object.assign(goodState(), { v: 1, rev: 99 }), 1, 7);
  assert.deepStrictEqual(Object.keys(env), ['magic', 'schema', 'app', 'slot', 'rev', 'savedAt', 'summary', 'data', 'crc']);
  assert.strictEqual(env.magic, 'fazenda_las-save'); assert.strictEqual(env.schema, 2); assert.strictEqual(env.slot, 1); assert.strictEqual(env.rev, 7);
  assert.ok(!('v' in env.data) && !('rev' in env.data));
  assert.deepStrictEqual(env.summary, { char: 'fazendeira', name: 'Karen', day: 3, gold: 250, earned: 40 });
  assert.strictEqual(env.crc, fnvRef(JSON.stringify(env.data)));
  const ins = M.format.inspect(JSON.stringify(env)); assert.ok(ins.ok); assert.strictEqual(ins.kind, 'v2'); assert.strictEqual(ins.rev, 7);
});
test('inspect: crc adulterado, dados adulterados, truncado, tipos errados', () => {
  const M = mgr(mem()), env = M.format.wrap(goodState(), 1, 1), I = o => M.format.inspect(typeof o === 'string' ? o : JSON.stringify(o));
  assert.strictEqual(I(Object.assign({}, env, { crc: '00000000' })).reason, 'crc');
  assert.strictEqual(I(Object.assign({}, env, { data: Object.assign({}, env.data, { gold: 999999 }) })).reason, 'crc');
  assert.strictEqual(I(JSON.stringify(env).slice(0, 200)).reason, 'json');
  assert.strictEqual(I(Object.assign({}, env, { data: 'x' })).reason, 'json'); assert.strictEqual(I(Object.assign({}, env, { crc: 5 })).reason, 'json');
  assert.strictEqual(I('{lixo').reason, 'json'); assert.strictEqual(I('[]').reason, 'json'); assert.strictEqual(I('null').reason, 'json'); assert.strictEqual(I('').reason, 'json');
});
test('inspect: schema futuro vence o crc; schema 0/lixo = versão; legado v1: v:1 ok, v:99 futuro, v:0/ausente versão', () => {
  const M = mgr(mem()), env = M.format.wrap(goodState(), 1, 1), I = o => M.format.inspect(JSON.stringify(o));
  assert.strictEqual(I(Object.assign({}, env, { schema: 3, crc: 'qualquer' })).reason, 'future');
  assert.strictEqual(I(Object.assign({}, env, { schema: 0 })).reason, 'version'); assert.strictEqual(I(Object.assign({}, env, { schema: 'x' })).reason, 'version');
  assert.ok(I({ v: 1, day: 1 }).ok && I({ v: 1, day: 1 }).kind === 'v1');
  assert.strictEqual(I({ v: 99 }).reason, 'future'); assert.strictEqual(I({ v: 0 }).reason, 'version'); assert.strictEqual(I({ day: 1 }).reason, 'version');
});
test('safeParse/inspect descartam __proto__ e constructor (arquivo de terceiros não troca o protótipo)', () => {
  const M = mgr(mem()), raw = '{"__proto__":{"zzz":"<img onerror=x>","gold":9},"constructor":{"x":1},"v":1,"day":2,"gold":5,"soil":[]}';
  const ins = M.format.inspect(raw); assert.ok(ins.ok);
  assert.strictEqual(Object.getPrototypeOf(ins.data), Object.prototype); assert.strictEqual(ins.data.zzz, undefined); assert.ok(!Object.prototype.hasOwnProperty.call(ins.data, 'constructor'));
});

test('deepMerge: mescla objetos, completa chaves que faltam, substitui arrays/valores, não muta e ignora __proto__', () => {
  const base = { a: 1, up: { x: 0, y: 0 }, arr: [1, 2, 3], deep: { l1: { l2: 'padrão', outro: 5 } }, names: {} };
  const src = JSON.parse('{"a":9,"up":{"x":4},"arr":[7],"deep":{"l1":{"l2":"do save"}},"names":{"k":"v"},"novo":true,"__proto__":{"zzz":1},"constructor":{"c":1}}');
  const snap = JSON.stringify(base), out = SaveLib.deepMerge(base, src);
  assert.deepStrictEqual(out, { a: 9, up: { x: 4, y: 0 }, arr: [7], deep: { l1: { l2: 'do save', outro: 5 } }, names: { k: 'v' }, novo: true });
  assert.strictEqual(JSON.stringify(base), snap, 'não muta o padrão'); assert.strictEqual(Object.getPrototypeOf(out), Object.prototype); assert.strictEqual(out.zzz, undefined);
  assert.deepStrictEqual(SaveLib.deepMerge({ up: { x: 0 } }, { up: 'abc' }), { up: 'abc' }, 'tipo errado entra como está (o sanitizador corrige e conta)');
  assert.deepStrictEqual(SaveLib.deepMerge({ a: 1 }, null), { a: 1 });
});

/* ============================ migração v1 → v2 ============================ */
test('migração com fixture REAL (v1): importa para v2, rev no envelope, dados preservados, legado intacto', () => {
  const a = mem(), legacy = JSON.parse(FX('save_v1_atual')); legacy.rev = 7;
  const raw = JSON.stringify(legacy); a.m.set('fazenda_leankar_v1', raw);
  const M = mgr(a), r = M.load();
  assert.strictEqual(r.status, 'ok'); assert.ok(r.imported && r.persisted); assert.strictEqual(r.rev, 7);
  const env = JSON.parse(a.read(K(M).slot)); assert.strictEqual(env.schema, 2); assert.strictEqual(env.rev, 7);
  assert.ok(!('v' in env.data) && !('rev' in env.data));
  const expected = Object.assign({}, legacy); delete expected.v; delete expected.rev;
  assert.deepStrictEqual(env.data, JSON.parse(JSON.stringify(expected)), 'todos os campos preservados');
  assert.strictEqual(a.read('fazenda_leankar_v1'), raw, 'legado intacto'); assert.strictEqual(copiesOf(a).length, 0);
  assert.ok(M.format.inspect(a.read(K(M).slot)).ok);
});
test('todas as fixtures v1 do repositório carregam como o esperado', () => {
  const rulesShape = RULES;
  for (const [fx, status, reason] of [['save_v1_atual', 'ok'], ['save_v1_pre_carne', 'ok'], ['save_v1_minimo', 'ok'], ['save_v1_parcial', 'ok'], ['save_v1_com_ptpk', 'ok'],
    ['save_v1_truncado', 'invalid', 'json'], ['save_invalido', 'invalid', 'json'], ['save_futuro_schema99', 'invalid', 'future'], ['save_v1_shape', 'invalid', 'shape'], ['save_versao_desconhecida', 'invalid', 'version']]) {
    const a = mem(); a.m.set('fazenda_leankar_v1', FX(fx)); const r = mgr(a, rulesShape).load();
    assert.strictEqual(r.status, status, fx); if (reason) assert.strictEqual(r.reason, reason, fx);
    assert.strictEqual(a.read('fazenda_leankar_v1'), FX(fx), fx + ': legado intacto');
  }
});
test('migração 1→2 de um envelope com magic e schema 1: tira v/rev dos dados, mantém o rev do envelope', () => {
  const M = mgr(mem()), env = M.format.wrap(goodState(), 1, 4); env.schema = 1; env.crc = SaveLib.fnv1a(JSON.stringify(env.data));
  const a = mem(); a.m.set(K(M).slot, JSON.stringify(env)); const r = mgr(a).load(); assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.rev, 4);
});

/* ============================ escrita segura e leitura com fallback ============================ */
test('save: rev sobe 1 a 1 no envelope; tmp some; bak = versão anterior', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' });
  const S = goodState(); assert.ok(M.save(S).ok); const t1 = a.read(K(M).slot);
  assert.strictEqual(JSON.parse(t1).rev, 1); assert.strictEqual(a.read(K(M).tmp), null); assert.strictEqual(a.read(K(M).bak), null, 'sem bak no 1º save');
  S.gold = 999; assert.ok(M.save(S).ok); assert.strictEqual(JSON.parse(a.read(K(M).slot)).rev, 2); assert.strictEqual(a.read(K(M).bak), t1);
  assert.ok(M.save(S).ok); assert.strictEqual(JSON.parse(a.read(K(M).slot)).rev, 3); assert.strictEqual(JSON.parse(a.read(K(M).bak)).rev, 2);
});
test('save: chama prepare e persist, e o estado vivo não ganha v/rev', () => {
  const a = mem(), M = mgr(a, { hydrate: RULES.hydrate, prepare(S) { S.px = 55; }, persist: S => Object.assign({}, S, { pt: undefined, crops: { '1,1': { t: 'milho', age: 1 } } }) });
  M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); assert.ok(M.save(S).ok);
  assert.strictEqual(S.px, 55); assert.ok(!('rev' in S) && !('v' in S)); assert.deepStrictEqual(JSON.parse(a.read(K(M).slot)).data.crops, { '1,1': { t: 'milho', age: 1 } });
});
test('cota estoura ao gravar o tmp: slot anterior intacto, sem tmp, erro de cota, rev não avança', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); assert.ok(M.save(S).ok);
  const before = a.read(K(M).slot); a.quota = a.size() + 50; S.crops = { '1,1': { t: 'milho', age: 1 } }; S.extra = 'x'.repeat(500);
  const r = M.save(S); assert.ok(!r.ok); assert.strictEqual(r.error.name, 'QuotaExceededError');
  assert.strictEqual(a.read(K(M).slot), before); assert.strictEqual(a.read(K(M).tmp), null);
  a.quota = Infinity; assert.ok(M.save(S).ok, 'liberou espaço: volta a gravar, sem falso conflito'); assert.strictEqual(JSON.parse(a.read(K(M).slot)).rev, 2);
});
test('falha ao gravar o bak NÃO impede salvar (bak é redundância)', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); assert.ok(M.save(S).ok);
  a.failOn = (op, k) => { if (op === 'w' && k === K(M).bak) throw new Error('sem espaço no bak'); };
  S.gold = 7; assert.ok(M.save(S).ok); assert.strictEqual(JSON.parse(a.read(K(M).slot)).data.gold, 7);
});
test('falha ao gravar o slot: slot antigo intacto e o tmp é limpo', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); assert.ok(M.save(S).ok); const before = a.read(K(M).slot);
  a.failOn = (op, k) => { if (op === 'w' && k === K(M).slot) throw new Error('boom'); };
  S.gold = 1; const r = M.save(S); assert.ok(!r.ok); assert.strictEqual(a.read(K(M).slot), before); assert.strictEqual(a.read(K(M).tmp), null);
});
test('processo morre entre tmp e slot: o slot antigo é lido; o tmp sobra válido', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(3, 100); assert.ok(M.save(S).ok);
  a.failOn = (op, k) => { if (k === K(M).slot && op === 'w') throw new Error('morreu'); if (k === K(M).tmp && op === 'x') throw new Error('morreu'); };
  S.gold = 555; M.save(S); a.failOn = null;
  assert.ok(M.format.inspect(a.read(K(M).tmp)).ok, 'o tmp tem o save novo, válido');
  const r = mgr(a).load(); assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.state.gold, 100); assert.ok(!r.recovered);
});
test('slot truncado (escrita parcial) + bak válido: recupera do bak, copia o danificado, rev do slot, 1º save sem conflito e sem estragar o bak', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); M.save(S); S.gold = 10; M.save(S);
  const bak = a.read(K(M).bak), damaged = a.read(K(M).slot).slice(0, 120); a.m.set(K(M).slot, damaged);
  const M2 = mgr(a), r = M2.load(); assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.recovered, 'bak'); assert.strictEqual(r.state.gold, 250);
  assert.ok(r.backedUp); assert.strictEqual(copiesOf(a).filter(c => c.raw === damaged).length, 1);
  M2.session.reset(); M2.session.adopt(r); assert.ok(M2.save(r.state).ok, 'sem falso Conflict'); assert.strictEqual(a.read(K(M2).bak), bak, 'o bak bom não foi trocado pelo lixo');
  assert.ok(M2.format.inspect(a.read(K(M2).slot)).ok);
});
test('slot com crc errado + bak válido: recupera e usa o rev do slot danificado', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); M.save(S); S.gold = 77; M.save(S);
  const env = JSON.parse(a.read(K(M).slot)); env.crc = '00000000'; a.m.set(K(M).slot, JSON.stringify(env));
  const M2 = mgr(a), r = M2.load(); assert.strictEqual(r.recovered, 'bak'); assert.strictEqual(r.rev, 2, 'rev do slot danificado (2), não o do bak (1)');
  M2.session.adopt(r); assert.ok(M2.save(r.state).ok); assert.strictEqual(JSON.parse(a.read(K(M2).slot)).rev, 3);
});
test('slot ausente + bak válido: recupera (sem cópia); slot e bak ruins + tmp válido: recupera do tmp', () => {
  let a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); const S = goodState(); M.save(S); M.save(S);
  a.m.delete(K(M).slot); const M3 = mgr(a); let r = M3.load(); assert.strictEqual(r.recovered, 'bak'); assert.strictEqual(copiesOf(a).length, 0);
  M3.session.reset(); M3.session.adopt(r); assert.ok(M3.save(r.state).ok, 'sem falso "outra aba apagou" quando o slot não existia');
  a = mem(); a.m.set(K(M).slot, '{lixo'); a.m.set(K(M).bak, '{lixo2'); a.m.set(K(M).tmp, envText(M, goodState(9, 9), 5));
  r = mgr(a).load(); assert.strictEqual(r.recovered, 'tmp'); assert.strictEqual(r.state.day, 9);
});
test('tudo ilegível: invalid com o texto do slot e uma cópia', () => {
  const a = mem(), M = mgr(a); a.m.set(K(M).slot, '{lixo'); a.m.set(K(M).bak, 'lixo2');
  const r = mgr(a).load(); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'json'); assert.strictEqual(r.raw, '{lixo'); assert.ok(r.backedUp);
  assert.deepStrictEqual(copiesOf(a).map(c => c.raw), ['{lixo']); assert.strictEqual(a.read(K(M).slot), '{lixo', 'o slot não foi alterado');
});
test('slot com crc errado e SEM bak: invalid crc, original preservado em cópia', () => {
  const a = mem(), M = mgr(a), env = M.format.wrap(goodState(), 1, 2); env.crc = 'ffffffff'; const raw = JSON.stringify(env); a.m.set(K(M).slot, raw);
  const r = mgr(a).load(); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'crc'); assert.strictEqual(copiesOf(a)[0].raw, raw);
});
test('save de versão FUTURA: load invalid/future (sem fallback por cima dele), save recusa (FutureSchema), só "Novo jogo" sobrescreve', () => {
  const a = mem(), M = mgr(a), fut = JSON.stringify({ magic: 'fazenda_las-save', schema: 3, rev: 4, data: { day: 50 }, crc: 'x' });
  a.m.set(K(M).slot, fut); a.m.set(K(M).bak, envText(M, goodState(1, 1), 1));
  const M2 = mgr(a), r = M2.load(); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'future'); assert.ok(copiesOf(a).some(c => c.raw === fut));
  M2.session.reset(); M2.session.adopt({ status: 'ok', rev: 4 });                         // "continuar" numa sessão que já conhece o rev 4
  const r2 = M2.save(goodState()); assert.ok(!r2.ok); assert.strictEqual(r2.error.name, 'FutureSchema'); assert.strictEqual(a.read(K(M).slot), fut);
  M2.session.reset(); M2.session.startNew(M2.peek());                                      // o jogador escolheu "Novo jogo"
  assert.ok(M2.save(goodState()).ok); assert.ok(M2.format.inspect(a.read(K(M).slot)).ok); assert.ok(copiesOf(a).some(c => c.raw === fut), 'a cópia do futuro continua');
  const fut2 = JSON.stringify({ magic: 'fazenda_las-save', schema: 3, rev: JSON.parse(a.read(K(M).slot)).rev, data: {}, crc: 'x' }); a.m.set(K(M).slot, fut2);
  const r3 = M2.save(goodState()); assert.ok(!r3.ok); assert.strictEqual(r3.error.name, 'FutureSchema', 'um futuro que aparece DEPOIS volta a ser protegido'); assert.strictEqual(a.read(K(M).slot), fut2);
});
test('removeMain apaga slot+bak+tmp mas NÃO as cópias nem o legado', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); M.save(goodState()); M.save(goodState()); M.copies.add('{x'); a.m.set('fazenda_leankar_v1', 'legado');
  M.removeMain(); for (const k of [K(M).slot, K(M).bak, K(M).tmp]) assert.strictEqual(a.read(k), null);
  assert.strictEqual(copiesOf(a).length, 1); assert.strictEqual(a.read('fazenda_leankar_v1'), 'legado');
});

/* ============================ rev, aba velha ============================ */
test('aba velha: outro rev no storage ⇒ Conflict, nada gravado; depois nem tenta (stale)', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); M.save(goodState());
  const other = envText(M, goodState(9, 9999), 6); a.m.set(K(M).slot, other);
  const r = M.save(goodState()); assert.ok(!r.ok); assert.strictEqual(r.error.name, 'Conflict'); assert.strictEqual(a.read(K(M).slot), other); assert.ok(M.session.isStale());
  const w = a.log.length; assert.ok(!M.save(goodState()).ok); assert.strictEqual(a.log.length, w, 'nem lê nem grava quando já é velha');
});
test('N4: save apagado por outra aba não é recriado; "Usar esta aba" (takeOver) recria de propósito e guarda a cópia', () => {
  const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); M.save(goodState());
  a.m.delete(K(M).slot); const r = M.save(goodState()); assert.strictEqual(r.error.name, 'Conflict'); assert.strictEqual(a.read(K(M).slot), null);
  M.session.takeOver(); assert.ok(!M.session.isStale()); assert.ok(M.save(goodState()).ok); assert.ok(a.read(K(M).slot));
  const a2 = mem(), M2 = mgr(a2); M2.session.reset(); M2.session.adopt({ status: 'none' }); M2.save(goodState());
  const other = envText(M2, goodState(8, 8), 9); a2.m.set(K(M2).slot, other); M2.session.takeOver();
  assert.ok(copiesOf(a2).some(c => c.raw === other)); assert.ok(M2.save(goodState()).ok); assert.strictEqual(JSON.parse(a2.read(K(M2).slot)).rev, 10);
});
test('external(): rev diferente, null, key null e texto não-JSON marcam a aba como velha; mesmo rev e outras chaves não; sem jogo ativo ignora', () => {
  const mk = () => { const a = mem(), M = mgr(a); M.session.reset(); M.session.adopt({ status: 'none' }); M.save(goodState()); return { a, M }; };
  let { M } = mk(); M.external(K(M).slot, envText(M, goodState(), 1)); assert.ok(!M.session.isStale(), 'mesmo rev');
  M.external('outra_chave', 'x'); M.external(K(M).bak, 'x'); assert.ok(!M.session.isStale());
  M.external(K(M).slot, envText(M, goodState(), 5)); assert.ok(M.session.isStale());
  for (const [k, v] of [[K(mk().M).slot, null], [null, null], [K(mk().M).slot, '{lixo']]) { const x = mk(); x.M.external(k, v); assert.ok(x.M.session.isStale(), String(k) + '/' + v); }
  const a = mem(), M3 = mgr(a); M3.external(K(M3).slot, null); assert.ok(!M3.session.isStale(), 'sem sessão ativa');
});
test('N2: rev estranho no texto lido (5.5, 1e13, "7", -3, null) não gera Conflict falso no 1º save', () => {
  for (const [rev, exp] of [[5.5, 1], [1e13, 1e13 + 1], ['7', 1], [-3, 1], [null, 1], [7, 8]]) {
    const a = mem(), M = mgr(a), env = M.format.wrap(goodState(), 1, 0); env.rev = rev; a.m.set(K(M).slot, JSON.stringify(env));
    const M2 = mgr(a), r = M2.load(); assert.strictEqual(r.status, 'ok'); M2.session.adopt(r);
    assert.ok(M2.save(r.state).ok, 'rev=' + rev); assert.strictEqual(JSON.parse(a.read(K(M2).slot)).rev, exp, 'rev=' + rev);
  }
});

/* ============================ cópias de segurança ============================ */
test('copies.add: dedupe por texto; dois textos no mesmo ms não se sobrescrevem; list lê v2 e v1', () => {
  const a = mem(), M = mgr(a, RULES); let t = 5000; const M2 = SaveLib.create(a, { now: () => t }); M2.configure(RULES);
  assert.ok(M2.copies.add('{a')); assert.ok(M2.copies.add('{a')); assert.ok(M2.copies.add('{b')); assert.strictEqual(copiesOf(a).length, 2, 'dedupe e sem colisão de chave');
  M2.copies.add(envText(M, goodState(2, 2), 1)); M2.copies.add(JSON.stringify(Object.assign({ v: 1 }, goodState(4, 4))));
  const st = M2.copies.list().map(b => b.info.status); assert.strictEqual(st.filter(s => s === 'ok').length, 2); assert.ok(M2.copies.list().length <= 3);
});
test('R4: a poda descarta primeiro as ilegíveis; a única válida e a recém-criada sobrevivem', () => {
  const a = mem(), M = mgr(a); const valid = envText(M, goodState(1, 10), 1);
  a.m.set(K(M).copy + '1000', valid); for (const t of [2000, 3000, 4000]) a.m.set(K(M).copy + t, '{"lixo' + t + '":');
  M.copies.add('{novo'); const ks = copiesOf(a); assert.strictEqual(ks.length, 3);
  assert.ok(ks.some(c => c.raw === valid), 'a válida ficou'); assert.ok(ks.some(c => c.raw === '{novo'), 'a nova ficou'); assert.ok(!ks.some(c => c.ts === 2000 || c.ts === 3000));
});
test('N1: save de versão futura/desconhecida só é podado depois das ilegíveis e das válidas', () => {
  const a = mem(), M = mgr(a), fut = JSON.stringify({ v: 99, day: 12 });
  a.m.set(K(M).copy + '1000', fut); a.m.set(K(M).copy + '2000', envText(M, goodState(2, 2), 1)); a.m.set(K(M).copy + '3000', envText(M, goodState(3, 3), 1));
  M.copies.add('{novo'); const ks = copiesOf(a); assert.strictEqual(ks.length, 3);
  assert.ok(ks.some(c => c.raw === fut), 'a futura sobreviveu'); assert.ok(!ks.some(c => c.ts === 2000), 'a válida mais antiga saiu');
});
test('restore grava o texto bruto da cópia no slot; falha devolve false', () => {
  const a = mem(), M = mgr(a), raw = envText(M, goodState(7, 777), 3); M.copies.add(raw);
  assert.ok(M.copies.restore(M.copies.list()[0])); assert.strictEqual(a.read(K(M).slot), raw);
  a.failOn = () => { throw new Error('bloqueado'); }; assert.strictEqual(M.copies.restore({ raw: 'x' }), false);
});

/* ============================ legado (fazenda_leankar_* / fazenda_elias_*) ============================ */
test('legado: depois de importado, removeMain NÃO ressuscita o save antigo; o legado continua lá', () => {
  const a = mem(); a.m.set('fazenda_leankar_v1', FX('save_v1_atual')); const M = mgr(a); assert.ok(M.load().imported);
  assert.strictEqual(JSON.parse(a.read(K(M).meta)).legacyMain, true); M.removeMain();
  assert.strictEqual(mgr(a).load().status, 'none'); assert.strictEqual(a.read('fazenda_leankar_v1'), FX('save_v1_atual'));
  assert.strictEqual(mgr(a).load().status, 'none', 'e continua none');
});
test('legado: 2º load usa o slot (sem reimportar) e o legado não muda', () => {
  const a = mem(); a.m.set('fazenda_leankar_v1', FX('save_v1_atual')); mgr(a).load(); const r = mgr(a).load();
  assert.strictEqual(r.status, 'ok'); assert.ok(!r.imported); assert.strictEqual(a.read('fazenda_leankar_v1'), FX('save_v1_atual'));
});
test('legado inválido: invalid + 1 cópia, legado intacto, sem slot criado; repetir o boot não duplica a cópia', () => {
  const a = mem(); a.m.set('fazenda_leankar_v1', FX('save_v1_truncado'));
  const r = mgr(a).load(); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'json'); assert.ok(r.backedUp);
  mgr(a).load(); assert.strictEqual(copiesOf(a).length, 1); assert.strictEqual(a.read('fazenda_leankar_v1'), FX('save_v1_truncado'));
  assert.strictEqual(a.read(K(mgr(a)).slot), null);
});
test('legado "corrigido" pelo sanitizador: o texto original vira cópia', () => {
  const a = mem(), o = JSON.parse(FX('save_v1_atual')); o.lixo = 1; const raw = JSON.stringify(o); a.m.set('fazenda_leankar_v1', raw);
  const r = mgr(a).load(); assert.strictEqual(r.status, 'ok'); assert.ok(r.repaired); assert.deepStrictEqual(copiesOf(a).map(c => c.raw), [raw]);
  assert.strictEqual(r.persisted, false); assert.strictEqual(a.read('fazenda_las:v2:slot:1'), null, 'legado corrigido não grava o slot no boot (o 1º save grava)');
  const M2 = mgr(a), r2 = M2.load(); assert.ok(r2.repaired, 'o aviso continua disponível ao jogar'); assert.strictEqual(copiesOf(a).length, 1, 'carregar de novo NÃO duplica a cópia');
  M2.session.reset(); M2.session.adopt(r2); assert.ok(M2.save(r2.state).ok, 'o 1º save grava o slot (sem falso "outra aba apagou")');
  assert.ok(!('lixo' in JSON.parse(a.read('fazenda_las:v2:slot:1')).data), 'e já sanitizado'); assert.ok(!mgr(a).load().repaired);
});
test('legado: cópias antigas (…_backup_<ts> e a sem data) viram cópias v2 com o mesmo ts, sem apagar as antigas, uma só vez', () => {
  const a = mem(), v = JSON.stringify(Object.assign({ v: 1 }, goodState(2, 2)));
  a.m.set('fazenda_leankar_v1_backup_1500', v); a.m.set('fazenda_leankar_v1_backup', '{velha');
  const M = mgr(a); M.load(); const cs = copiesOf(a); assert.deepStrictEqual(cs.map(c => c.ts), [0, 1500]);
  assert.strictEqual(a.read('fazenda_leankar_v1_backup_1500'), v); assert.strictEqual(a.read('fazenda_leankar_v1_backup'), '{velha');
  mgr(a).load(); assert.strictEqual(copiesOf(a).length, 2, 'idempotente');
});
test('N3: com as DUAS chaves (elias e leankar), usa a leankar e guarda a elias como cópia; nenhuma é apagada', () => {
  const a = mem(), elias = JSON.stringify(Object.assign({ v: 1 }, goodState(11, 11))), leankar = JSON.stringify(Object.assign({ v: 1 }, goodState(2, 2)));
  a.m.set('fazenda_elias_v1', elias); a.m.set('fazenda_leankar_v1', leankar);
  const r = mgr(a).load(); assert.strictEqual(r.state.day, 2); assert.ok(copiesOf(a).some(c => c.raw === elias));
  assert.strictEqual(a.read('fazenda_elias_v1'), elias); assert.strictEqual(a.read('fazenda_leankar_v1'), leankar);
});
test('só a chave elias: é importada como principal', () => {
  const a = mem(); a.m.set('fazenda_elias_v1', JSON.stringify(Object.assign({ v: 1 }, goodState(6, 6)))); const r = mgr(a).load();
  assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.state.day, 6); assert.ok(a.read('fazenda_elias_v1'));
});
test('legado válido mas storage cheio: segue em memória (persisted:false) e o 1º save depois grava sem falso conflito', () => {
  const a = mem({ quota: 0 }); a.m.set('fazenda_leankar_v1', FX('save_v1_atual')); a.quota = a.size() + 10;
  const M = mgr(a), r = M.load(); assert.strictEqual(r.status, 'ok'); assert.ok(r.imported); assert.strictEqual(r.persisted, false); assert.strictEqual(a.read(K(M).slot), null);
  M.session.reset(); M.session.adopt(r); a.quota = Infinity; assert.ok(M.save(r.state).ok, 'sem falso "outra aba apagou"');
  assert.strictEqual(mgr(a).load().imported, undefined);
});
test('cfg de áudio: migra a do legado (copia), grava na v2, JSON ruim = {}', () => {
  const a = mem(), M = mgr(a); a.m.set('fazenda_leankar_cfg', '{"music":false,"sfx":false}');
  assert.deepStrictEqual(M.cfg.load(), { music: false, sfx: false }); assert.strictEqual(a.read(K(M).cfg), '{"music":false,"sfx":false}'); assert.strictEqual(a.read('fazenda_leankar_cfg'), '{"music":false,"sfx":false}');
  M.cfg.save({ music: true, sfx: false }); assert.deepStrictEqual(M.cfg.load(), { music: true, sfx: false });
  a.m.set(K(M).cfg, '{lixo'); assert.deepStrictEqual(M.cfg.load(), {}); assert.deepStrictEqual(mgr(mem()).cfg.load(), {});
  const b = mem(); b.m.set('fazenda_elias_cfg', '{"music":false}'); assert.deepStrictEqual(mgr(b).cfg.load(), { music: false });
});
test('storage bloqueado: load = none, save devolve o erro, nada lança', () => {
  const a = mem(), M = mgr(a); a.read = () => { const e = new Error('x'); e.name = 'SecurityError'; throw e; }; a.write = a.remove = a.keys = a.read;
  assert.strictEqual(M.load().status, 'none'); const r = M.save(goodState()); assert.ok(!r.ok); assert.strictEqual(r.error.name, 'SecurityError');
  assert.deepStrictEqual(M.peek(), { raw: null, rev: 0 }); assert.strictEqual(M.copies.add('x'), false); assert.deepStrictEqual(M.copies.list(), []); M.removeMain(); assert.deepStrictEqual(M.cfg.load(), {});
});
test('kit de sanitização: contagem de correções e ferramentas', () => {
  const M = mgr(mem()), K1 = M.kit(), o = { a: 5.5, b: 'x', c: 99 };
  K1.Pint(o, 'a', 0, 10, 0); K1.Pint(o, 'b', 0, 10, 3); K1.Pint(o, 'c', 0, 10, 0); assert.deepStrictEqual(o, { a: 5, b: 3, c: 10 }); assert.strictEqual(K1.repairs(), 3);
  assert.strictEqual(M.kit().repairs(), 0, 'cada kit tem o seu contador');
  const K2 = M.kit(); assert.deepStrictEqual(K2.objOf(null, ['x', 'y'], { x: 1, y: 2 }), { x: 1, y: 2 }); assert.deepStrictEqual(K2.pairs([[1, 2], 'z', [3, 4]], 5, e => true), [[1, 2], [3, 4]]); assert.strictEqual(K2.repairs(), 2);
});

/* ============================ revisão adversarial da 1b ============================ */
test('hydrate que LANÇA não derruba load(): vira invalid/shape (e o texto vira cópia); copies.list continua inteira', () => {
  const a = mem(), M = mgr(a); M.session.adopt({ status: 'none' }); M.save(goodState()); const raw = a.read(K(M).slot);
  const boom = { hydrate() { throw new Error('boom'); }, prepare() {}, persist: S => S }, T = mgr(a, boom);
  let r; assert.doesNotThrow(() => { r = T.load(); }); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'shape'); assert.strictEqual(r.raw, raw);
  a.m.set(K(M).copy + '1', envText(M, goodState(), 1)); a.m.set(K(M).copy + '2', envText(M, goodState(), 2));
  assert.strictEqual(T.copies.list().length, 3, 'a cópia do slot (do load) + as 2 novas: um hydrate que quebra não esconde nenhuma');
});
test('copies.add: se a PODA falha, a cópia já está guardada e devolve true', () => {
  const a = mem(), M = mgr(a); for (const t of [1, 2, 3]) a.m.set(K(M).copy + t, '{lixo' + t);
  a.failOn = op => { if (op === 'x') throw new Error('remove bloqueado'); };
  assert.strictEqual(M.copies.add('{nova'), true); assert.ok(copiesOf(a).some(c => c.raw === '{nova'));
  a.failOn = () => { throw new Error('tudo bloqueado'); }; assert.strictEqual(M.copies.add('{outra'), false, 'sem conseguir gravar: false');
});
test('crc: chave "constructor"/"__proto__" nos dados não faz um save válido virar "crc"; a chave é descartada ao ler', () => {
  const M = mgr(mem()), st = goodState(); st.names = JSON.parse('{"constructor":"x","a":"K"}');
  const ins = M.format.inspect(JSON.stringify(M.format.wrap(st, 1, 1))); assert.ok(ins.ok, ins.reason); assert.ok(!Object.prototype.hasOwnProperty.call(ins.data.names, 'constructor')); assert.strictEqual(ins.data.names.a, 'K');
});
test('slot com texto vazio = ausente: save não cria cópia vazia, copies.add("") não grava nada', () => {
  const a = mem(), M = mgr(a); a.m.set(K(M).slot, ''); M.session.adopt({ status: 'none' });
  assert.ok(M.save(goodState()).ok); assert.strictEqual(copiesOf(a).length, 0); assert.strictEqual(M.copies.add(''), true); assert.strictEqual(copiesOf(a).length, 0);
});

/* ============================ fixtures v2 (se já geradas) ============================ */
test('fixtures v2 do repositório: ok carrega sem cópia; crc errado é recusado (e o crc é o FNV-1a de referência)', () => {
  const okp = path.join(__dirname, 'fixtures', 'save_v2_ok.json'); assert.ok(fs.existsSync(okp), 'fixture ausente: rode node tests/make-fixtures.js');
  const env = JSON.parse(fs.readFileSync(okp, 'utf8')); assert.strictEqual(env.crc, fnvRef(JSON.stringify(env.data)), 'crc da fixture bate com a referência independente');
  let a = mem(); a.m.set('fazenda_las:v2:slot:1', fs.readFileSync(okp, 'utf8')); let r = mgr(a).load(); assert.strictEqual(r.status, 'ok'); assert.strictEqual(copiesOf(a).length, 0);
  a = mem(); a.m.set('fazenda_las:v2:slot:1', FX('save_v2_crc_errado')); r = mgr(a).load(); assert.strictEqual(r.status, 'invalid'); assert.strictEqual(r.reason, 'crc');
});

let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log('ok     ' + name); } catch (e) { fail++; console.log('FALHOU ' + name + '\n   ✗ ' + (e && e.message || e).split('\n')[0]); if (process.env.VERBOSE) console.log(e.stack); }
}
console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
