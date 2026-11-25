'use strict';
/* Testes do BUILD do site e da lógica do SERVICE WORKER (Fase 3), em Node puro, sem navegador:   node tests/build.test.js
   O build (tools/build-site.js) roda de verdade numa pasta temporária. O service-worker.js gerado roda numa sandbox (vm) com `caches`/`fetch` falsos:
   instalação, offline, atualização entre versões e isolamento do cache de outros projetos. O comportamento no navegador real (offline de verdade, instalável,
   deploy novo sem perder o save) é conferido por `node tests/pwa.js` (opt-in). Código de saída 0 = tudo passou. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { build, ROOT } = require('../tools/build-site.js');

const tests = []; const test = (name, fn) => tests.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-build-'));
const listAll = (dir, base = dir, out = []) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); fs.statSync(p).isDirectory() ? listAll(p, base, out) : out.push(path.relative(base, p).split(path.sep).join('/')); } return out.sort(); };
const dirs = [];
const built = (opts) => { const d = tmp(); dirs.push(d); return Object.assign(build(path.join(d, 'site'), opts), { dir: path.join(d, 'site') }); };

/* ============================ build ============================ */
test('build: publica só o necessário (nada de docs, tests, tools, .github, .jpeg, README) e todos os assets', () => {
  const b = built(), all = listAll(b.dir);
  for (const f of all) assert.ok(/^(index\.html|style\.css|art\.js|animais\.js|pesca\.js|rebanho\.js|save\.js|game\.js|manifest\.webmanifest|service-worker\.js|pwa\/[^/]+|assets\/.+)$/.test(f), 'arquivo inesperado publicado: ' + f);
  assert.ok(!all.some(f => /\.jpe?g$/i.test(f)), 'nenhum .jpeg');
  const src = listAll(path.join(ROOT, 'assets')); assert.deepStrictEqual(all.filter(f => f.startsWith('assets/')).map(f => f.slice(7)), src, 'os assets publicados são exatamente os do repositório (caixa dos nomes incluída)');
  for (const f of ['index.html', 'service-worker.js', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/icon-180.png']) assert.ok(all.includes(f), 'falta ' + f);
});
test('build: determinístico (mesmo conteúdo → mesma versão, mesmos arquivos) e a versão pode ser forçada', () => {
  const a = built(), b = built(); assert.strictEqual(a.version, b.version); assert.match(a.version, /^[0-9a-f]{12}$/);
  assert.strictEqual(fs.readFileSync(path.join(a.dir, 'service-worker.js'), 'utf8'), fs.readFileSync(path.join(b.dir, 'service-worker.js'), 'utf8'));
  assert.strictEqual(built({ version: 'teste-1' }).version, 'teste-1');
});
test('build: index.html publicado — ?v= em TODO css/js, manifesto, ícone, meta de versão e registro do SW; o do repositório continua limpo', () => {
  const b = built({ version: 'v9' }), html = fs.readFileSync(path.join(b.dir, 'index.html'), 'utf8'), repo = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const f of ['style.css', 'art.js', 'animais.js', 'pesca.js', 'rebanho.js', 'save.js', 'game.js']) assert.ok(html.includes('"' + f + '?v=v9"'), f + ' sem ?v=');
  assert.ok(!/(?:href|src)="(?:style\.css|[a-z]+\.js)"/.test(html), 'sobrou css/js sem versão');
  for (const s of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'name="fazenda-build" content="v9"', 'serviceWorker.register("service-worker.js")']) assert.ok(html.includes(s), 'falta ' + s);
  assert.ok(!/serviceWorker|manifest|fazenda-build/.test(repo), 'o index.html do repositório (file://) não deve registrar SW nem citar manifesto');
});
test('build: manifesto válido — ícones existem e têm o tamanho declarado; start_url/scope relativos (o site mora em /fazenda_las/)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(m.start_url, './'); assert.strictEqual(m.scope, './'); assert.ok(m.name && m.short_name && /^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color));
  assert.ok(m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any') && m.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) {
    assert.ok(!i.src.startsWith('/'), 'src relativo: ' + i.src); const buf = fs.readFileSync(path.join(ROOT, i.src));
    assert.strictEqual(buf.toString('latin1', 1, 4), 'PNG'); const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)]; assert.strictEqual(w + 'x' + h, i.sizes, i.src);
  }
});
test('service worker: marcadores trocados, lista de arquivos == o que foi publicado (nenhum a mais, nenhum a menos) e o código vai com ?v=', () => {
  const b = built({ version: 'v1' }), sw = fs.readFileSync(path.join(b.dir, 'service-worker.js'), 'utf8');
  assert.ok(sw.includes("const VERSION = 'v1';") && !/__VERSION__|__PRECACHE__/.test(sw));
  const files = listAll(b.dir).filter(f => f !== 'service-worker.js'), pre = b.precache.map(u => u.split('?')[0]).sort();
  assert.deepStrictEqual(pre, files); assert.strictEqual(new Set(b.precache).size, b.precache.length, 'sem duplicados');
  for (const f of ['style.css', 'art.js', 'animais.js', 'pesca.js', 'rebanho.js', 'save.js', 'game.js']) assert.ok(b.precache.includes(f + '?v=v1'));
  assert.ok(b.precache.includes('index.html') && !b.precache.includes('service-worker.js'), 'o SW não guarda a si mesmo');
});
test('build: falha (código 1) se o index.html deixar de citar um arquivo de código — nunca publica um site pela metade', () => {
  const cp = require('child_process'), d = tmp(); dirs.push(d);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.ok(html.includes('src="game.js"'));
  // roda o build num projeto-cópia mínimo com o index.html sem o game.js
  const proj = path.join(d, 'p'); fs.mkdirSync(proj); fs.cpSync(path.join(ROOT, 'tools'), path.join(proj, 'tools'), { recursive: true });
  for (const f of ['style.css', 'art.js', 'animais.js', 'pesca.js', 'rebanho.js', 'save.js', 'game.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(ROOT, f), path.join(proj, f));
  fs.cpSync(path.join(ROOT, 'pwa'), path.join(proj, 'pwa'), { recursive: true }); fs.mkdirSync(path.join(proj, 'assets')); fs.copyFileSync(path.join(ROOT, 'assets', 'tile_bare.png'), path.join(proj, 'assets', 'tile_bare.png'));
  fs.writeFileSync(path.join(proj, 'index.html'), html.replace('<script src="game.js"></script>', ''));
  const r = cp.spawnSync(process.execPath, [path.join(proj, 'tools', 'build-site.js'), '--out=_site'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /6 de 7/);
  fs.writeFileSync(path.join(proj, 'index.html'), html); const ok = cp.spawnSync(process.execPath, [path.join(proj, 'tools', 'build-site.js'), '--out=_site'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
});

/* ============================ sprites do cavalo (sheet) ============================ */
const pngInfo = f => { const b = fs.readFileSync(f); assert.strictEqual(b.toString('latin1', 1, 4), 'PNG', f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] }; };
test('cavalo: walk_sheet.png, walk_sheet.json e as constantes HORSE do animais.js batem entre si (tamanho, grade, pegada da sombra, quadro de repouso)', () => {
  const dir = path.join(ROOT, 'assets', 'animais', 'cavalo'), meta = JSON.parse(fs.readFileSync(path.join(dir, 'walk_sheet.json'), 'utf8')), png = pngInfo(path.join(dir, 'walk_sheet.png'));
  assert.deepStrictEqual([png.w, png.h], meta.size, 'tamanho do PNG == json'); assert.strictEqual(png.colorType, 6, 'RGBA (fundo transparente)');
  assert.deepStrictEqual([meta.cell[0] * meta.columns, meta.cell[1] * meta.rows.length], meta.size, 'grade uniforme: colunas x célula');
  const src = fs.readFileSync(path.join(ROOT, 'animais.js'), 'utf8'), blk = /const HORSE = (\{[\s\S]*?\n  \});/.exec(src); assert.ok(blk, 'bloco HORSE no animais.js');
  const H = new Function('return ' + blk[1])();
  assert.deepStrictEqual(H.cell, meta.cell); assert.strictEqual(H.cols, meta.columns); assert.strictEqual(H.ref, meta.bodyHeight);
  assert.deepStrictEqual(H.foot, meta.footprintWidth); assert.deepStrictEqual(H.idle, meta.idleFrame); assert.deepStrictEqual(H.loop, meta.loop);
  for (const d of meta.rows) assert.ok(meta.loop[d].includes(meta.idleFrame[d]) && meta.loop[d].every(i => i >= 0 && i < meta.columns), 'loop/repouso coerentes: ' + d);
  assert.deepStrictEqual(Object.keys(H.rows), meta.rows, 'ordem das linhas'); assert.deepStrictEqual(Object.values(H.rows), meta.rows.map((_, i) => i));
  for (const d of meta.rows) assert.ok(H.idle[d] >= 0 && H.idle[d] < meta.columns);
  const ic = pngInfo(path.join(dir, 'icon.png')); assert.deepStrictEqual([ic.w, ic.h], [96, 96], 'ícone da loja 96x96');
});
test('cavalo: os 7 PNGs antigos foram removidos e a loja usa o ícone novo', () => {
  const dir = path.join(ROOT, 'assets', 'animais', 'cavalo'), left = fs.readdirSync(dir).sort();
  assert.deepStrictEqual(left, ['icon.png', 'walk_sheet.json', 'walk_sheet.png'], 'sobrou arquivo antigo: ' + left);
  const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'); assert.ok(game.includes("cavalo/icon.png") && !/cavalo\/(front|back|profile|bottomup)/.test(game + fs.readFileSync(path.join(ROOT, 'animais.js'), 'utf8')), 'ninguém cita os sprites antigos');
});
test('personagens: walk_sheet.png × walk_sheet.json × constantes WALKERS do game.js batem nos DOIS (grade, altura, laço, repouso); pastas só com o que o jogo usa', () => {
  const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), blk = /const WALKERS = (\{[\s\S]*?\n  \});/.exec(game); assert.ok(blk, 'bloco WALKERS no game.js');
  const WALKERS = new Function('return ' + blk[1])(), tools = /TOOL_SPRITES = (\[[^\]]*\])/.exec(game); assert.ok(tools); const T = new Function('return ' + tools[1])();
  assert.deepStrictEqual(Object.keys(WALKERS).sort(), ['fazendeira', 'fazendeiro']);
  for (const id of Object.keys(WALKERS)) {
    const dir = path.join(ROOT, 'assets', id), meta = JSON.parse(fs.readFileSync(path.join(dir, 'walk_sheet.json'), 'utf8')), png = pngInfo(path.join(dir, 'walk_sheet.png')), W = WALKERS[id];
    assert.strictEqual(meta.character, id, id + ': o json é do personagem certo');
    assert.deepStrictEqual([png.w, png.h], meta.size, id); assert.strictEqual(png.colorType, 6, id + ': RGBA (fundo transparente)'); assert.deepStrictEqual([meta.cell[0] * meta.columns, meta.cell[1] * meta.rows.length], meta.size);
    assert.deepStrictEqual(W.cell, meta.cell, id); assert.strictEqual(W.cols, meta.columns, id); assert.strictEqual(W.ref, meta.bodyHeight, id); assert.deepStrictEqual(W.loop, meta.loop, id); assert.deepStrictEqual(W.idle, meta.idleFrame, id);
    assert.deepStrictEqual(Object.keys(W.rows), meta.rows, id); assert.deepStrictEqual(Object.values(W.rows), meta.rows.map((_, i) => i), id);
    for (const d of meta.rows) assert.ok(meta.loop[d].includes(meta.idleFrame[d]) && meta.loop[d].every(i => i >= 0 && i < meta.columns), id + ': loop/repouso coerentes: ' + d);
    const front = pngInfo(path.join(dir, 'front.png')); assert.deepStrictEqual([front.w, front.h], meta.frontSize, id); assert.ok(front.h >= 300, id + ': retrato em alta (título e cartões mostram até 340 px)');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...T.map(n => n + '.png'), 'front.png', 'walk_sheet.json', 'walk_sheet.png'].sort(), id + ': a pasta tem EXATAMENTE o que o jogo usa (sem sobras nem faltas)');
    assert.ok(new RegExp(id + ": \{[^}]*front: 'front\.png'").test(game), id + ': retrato front.png no CHARACTERS');
  }
  // diferenças de fonte tratadas
  const E = WALKERS.fazendeiro, K = WALKERS.fazendeira;
  assert.ok(!E.loop.up.includes(3), 'fazendeiro: o 4º quadro de costas (sem chapéu na fonte) fica fora do laço'); assert.ok(E.loop.right.length === 4 && E.loop.left.length === 4 && E.loop.down.length === 4, 'fazendeiro: o 5º quadro repetido fica fora do laço');
  assert.ok(Object.values(K.loop).every(l => l.length === 5), 'fazendeira: ciclo real de 5 quadros (nenhum repete o 1º)');
  assert.ok(!/BODY_SPRITES|front_stand|drawSide|drawFrontBack|walker: true/.test(game), 'sobrou código do desenho antigo (sprites estáticos com pernas giradas)');
});
test('rebanho (arte): sheets da ovelha e do coelho e props — cada PNG existe, é RGBA e tem o tamanho que o json declara; a grade das sheets fecha; a pasta não tem sobras', () => {
  for (const [animal, rows] of [['ovelha', 10], ['coelho', 8]]) {
    const dir = path.join(ROOT, 'assets', 'animais', animal), meta = JSON.parse(fs.readFileSync(path.join(dir, 'sheet.json'), 'utf8')), png = pngInfo(path.join(dir, 'sheet.png'));
    assert.strictEqual(png.colorType, 6, animal + ': RGBA'); assert.deepStrictEqual([png.w, png.h], [meta.cell[0] * meta.columns, meta.cell[1] * meta.rows.length], animal + ': tamanho do PNG == célula x grade');
    assert.strictEqual(meta.rows.length, rows, animal + ': linhas');
    for (const r of meta.rows) { assert.ok(meta.frames[r] >= 1 && meta.frames[r] <= meta.columns, animal + '/' + r + ': quadros na grade'); assert.ok(meta.footprintWidth[r] > 0 && meta.footprintWidth[r] <= meta.cell[0], animal + '/' + r + ': pegada cabe na célula'); for (const f of meta.loop[r]) assert.ok(f < meta.frames[r], animal + '/' + r + ': laço dentro dos quadros'); }
    const ic = pngInfo(path.join(dir, 'icon.png')); assert.deepStrictEqual([ic.w, ic.h], [96, 96], animal + ': ícone da loja 96x96');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['icon.png', 'sheet.json', 'sheet.png'], animal + ': a pasta tem EXATAMENTE o que o jogo usa');
  }
  const pd = path.join(ROOT, 'assets', 'animais', 'props'), pm = JSON.parse(fs.readFileSync(path.join(pd, 'rebanho.json'), 'utf8')).items;
  for (const [name, it] of Object.entries(pm)) { const png = pngInfo(path.join(pd, name + '.png')); assert.strictEqual(png.colorType, 6, name + ': RGBA'); assert.deepStrictEqual([png.w, png.h], it.size, name + ': tamanho do PNG == rebanho.json'); assert.ok(it.group && it.source && it.note, name + ': metadados'); }
  const an = pm.oficina_anim; assert.strictEqual(an.cell[0] * an.frames, an.size[0]); assert.deepStrictEqual(an.cell, pm.oficina.size, 'quadros da oficina têm o tamanho da oficina parada');
  for (const n of ['tesoura_tosa', 'fardos_feno', 'cocho_ovelha', 'estacao_tosquia', 'portao_aprisco', 'coelheira', 'bebedouro_coelho', 'tigela_racao', 'toca_coelho', 'canteiro_alface', 'la_bruta', 'fio_la', 'pele_coelho', 'carne_coelho', 'queijo', 'pele_curtida', 'oficina']) assert.ok(pm[n], 'falta o item do plano: ' + n);
});
test('casa: casa.png × casa.json × constantes HOUSE_ART do game.js batem; o celeiro procedural foi removido do art.js', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'casa.json'), 'utf8')), png = pngInfo(path.join(ROOT, 'assets', 'casa.png'));
  assert.deepStrictEqual([png.w, png.h], meta.size); assert.strictEqual(png.colorType, 6, 'RGBA (fundo transparente)');
  const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), blk = /const HOUSE_ART = (\{[^;]*\});/.exec(game); assert.ok(blk, 'HOUSE_ART no game.js');
  const H = new Function('return ' + blk[1])(); assert.deepStrictEqual([H.w, H.h], meta.display); assert.deepStrictEqual(H.door, meta.door); assert.deepStrictEqual(H.lights, meta.lights);
  assert.ok(meta.display[0] <= 7 * 64 && meta.display[1] <= 5 * 64, 'cabe no bloco da casa (7x5 tiles)'); assert.ok(meta.lights.length >= 6);
  for (const [x, y] of [meta.door, ...meta.lights]) assert.ok(x > 0 && y > 0 && x < meta.display[0] && y < meta.display[1], 'ponto dentro do sprite: ' + x + ',' + y);
  assert.ok(/HOUSE\s*=\s*\{ x: 5,\s+y: 0, w: 7, h: 5 \}/.test(game), 'o bloco sólido da casa continua 7x5 em (5,0): a porta (linha 4, colunas 7-9) depende disto');
  const art = fs.readFileSync(path.join(ROOT, 'art.js'), 'utf8'); assert.ok(!/drawBarn|this\.barn|barn:/.test(art) && !/Art\.barn|BARN/.test(game), 'sobrou código do celeiro antigo');
  assert.ok(/HOUSE_X = HOUSE\.x \* TS \+ Math\.round/.test(game), 'a posição do sprite é arredondada (px inteiros)');
  assert.ok(game.includes("'casa'") && /IMGS\.casa/.test(game), 'o jogo carrega e desenha a casa');
  const porch = Math.round(H.door[0] + Math.round((7 * 64 - H.w) / 2) + 5 * 64); assert.ok(porch >= 7 * 64 && porch <= 10 * 64, 'a porta desenhada fica sobre a linha de interação (colunas 7-9): x=' + porch);
});
test('assets: toda imagem citada por literal no código existe com a CAIXA exata (o Pages é case-sensitive, o Windows não)', () => {
  const real = new Set(listAll(path.join(ROOT, 'assets')).map(f => 'assets/' + f)); let n = 0;
  for (const f of ['game.js', 'animais.js', 'pesca.js', 'rebanho.js', 'art.js', 'style.css', 'index.html']) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/assets\/[A-Za-z0-9_\-./]+\.(?:png|json)/g)) { n++; assert.ok(real.has(m[0]), f + ' cita ' + m[0] + ' que não existe (confira a caixa)'); }
  }
  assert.ok(n >= 4, 'achou poucas referências: ' + n);
});

/* ============================ service worker (sandbox) ============================ */
const ORIGIN = 'https://leankar-dev.github.io', BASE = ORIGIN + '/fazenda_las/';
class Req { constructor(u, init = {}) { this.url = new URL(u, BASE).href; this.method = init.method || 'GET'; this.mode = init.mode || 'cors'; this.cache = init.cache || 'default'; } }
class Res { constructor(body, init = {}) { this.body = body; this.ok = init.ok !== false; this.type = init.type || 'basic'; this.status = this.ok ? 200 : 404; } text() { return Promise.resolve(this.body); } clone() { return new Res(this.body, { ok: this.ok, type: this.type }); } }
const stripQ = u => u.split('?')[0];
class FakeCache {
  constructor() { this.m = new Map(); }
  key(r) { return typeof r === 'string' ? new URL(r, BASE).href : r.url; }
  async addAll(reqs) { for (const r of reqs) { const res = await fakeNet(r); if (!res.ok) throw new Error('addAll: ' + r.url + ' → ' + res.status); this.m.set(r.url, res); } }
  async put(r, res) { this.m.set(this.key(r), res); }
  async match(r, o = {}) { const k = this.key(r); if (this.m.has(k)) return this.m.get(k); if (o.ignoreSearch) for (const [u, v] of this.m) if (stripQ(u) === stripQ(k)) return v; }
}
let net, caches, netLog;
async function fakeNet(r) { netLog.push(r.url); const h = net(r); if (h instanceof Error) throw h; return h; }

/* monta um SW da versão `ver` (build real) dentro de uma sandbox que compartilha `caches` e a "rede" `net(req)` */
function loadSW(ver, htmlFor) {
  const b = built({ version: ver }), src = fs.readFileSync(path.join(b.dir, 'service-worker.js'), 'utf8'), handlers = {};
  const self = { location: new URL('service-worker.js', BASE), addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: async () => { self.skipped = true; }, clients: { claim: async () => { self.claimed = true; } } };
  const ctx = vm.createContext({ self, caches, Request: Req, Response: Res, URL, Promise, setTimeout, clearTimeout, fetch: (r, o) => fakeNet(Object.assign(r instanceof Req ? r : new Req(r), o || {})) });
  vm.runInContext(src, ctx);
  const fire = async (type, ev) => { const ps = []; ev.waitUntil = p => ps.push(p); ev.respondWith = p => { ev.response = p; }; handlers[type](ev); await Promise.all(ps); return ev.response; };
  return { b, self, install: () => fire('install', {}), activate: () => fire('activate', {}), fetch: (req) => fire('fetch', { request: req }) };
}
const reset = (netImpl) => { netLog = []; net = netImpl; const store = new Map(); caches = { open: async n => { if (!store.has(n)) store.set(n, new FakeCache()); return store.get(n); }, keys: async () => [...store.keys()], delete: async n => store.delete(n), store }; };
const pageFor = ver => '<!doctype html><meta name="fazenda-build" content="' + ver + '"><title>jogo ' + ver + '</title>';
/* "servidor": serve a página da versão atual no ar, e qualquer outro arquivo com o nome */
const serverOf = () => { const s = { ver: 'v1', online: true, down: new Set() }; s.handler = r => { if (!s.online) return new Error('offline'); const p = stripQ(r.url); if (s.down.has(p)) return new Res('', { ok: false }); return new Res(p.endsWith('/') || p.endsWith('index.html') ? pageFor(s.ver) : 'conteudo de ' + r.url + ' ' + new URL(r.url).search); }; return s; };

test('SW install: guarda TUDO da lista; um arquivo que falha impede a instalação (o SW antigo continua valendo)', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1');
  await a.install(); const c = await caches.open('fazenda-las-v1'); assert.strictEqual(c.m.size, a.b.precache.length); assert.ok(a.self.skipped);
  assert.ok(netLog.length >= a.b.precache.length);
  reset(srv.handler); srv.down.add(BASE + 'assets/tile_bare.png'); const b = loadSW('v2');
  await assert.rejects(b.install(), /addAll/); assert.ok(!b.self.skipped, 'não assume o controle com instalação incompleta');
});
test('SW activate: apaga só os caches fazenda-las-* antigos — nunca o de outro projeto da mesma origem github.io', async () => {
  const srv = serverOf(); reset(srv.handler); await caches.open('fazenda-las-v0'); await caches.open('outro-projeto-v1'); await caches.open('workbox-precache');
  const a = loadSW('v1'); await a.install(); await a.activate();
  assert.deepStrictEqual([...caches.store.keys()].sort(), ['fazenda-las-v1', 'outro-projeto-v1', 'workbox-precache']); assert.ok(a.self.claimed);
});
test('SW OFFLINE: depois de instalado, a página e todos os arquivos vêm do cache (nenhuma ida à rede)', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install(); await a.activate(); srv.online = false; netLog = [];
  for (const u of ['', 'index.html', 'index.html?debug', '?source=pwa']) { const res = await a.fetch(new Req(BASE + u, { mode: 'navigate' })); assert.ok((await res.text()).includes('jogo v1'), 'página offline: ' + u); }
  for (const u of a.b.precache) { const res = await a.fetch(new Req(u)); assert.ok(res.ok, u); }
  assert.strictEqual(netLog.length, 4, 'só as 4 navegações tentaram a rede (e caíram no cache); os arquivos não');
});
test('SW: imagem pedida com ?r= (nova tentativa do jogo) acha a do cache; script/css com ?v= de OUTRA versão NÃO é servido do cache (nunca mistura código)', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install(); srv.online = false;
  assert.ok((await a.fetch(new Req('assets/tile_bare.png?r=1'))).ok, 'png com ?r= vem do cache');
  await assert.rejects(a.fetch(new Req('game.js?v=v2')), /offline/); assert.ok((await a.fetch(new Req('game.js?v=v1'))).ok);
  await assert.rejects(a.fetch(new Req('game.js')), /offline/, 'sem ?v= também não: o HTML sempre cita com ?v=');
});
test('SW: com rede, a página vem da REDE (HTML novo chega) e só é guardada se for da versão do SW; um HTML novo não contamina o cache antigo', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install(); await a.activate();
  srv.ver = 'v2'; const res = await a.fetch(new Req(BASE, { mode: 'navigate' })); assert.ok((await res.text()).includes('jogo v2'), 'online: HTML novo');
  srv.online = false; const off = await a.fetch(new Req(BASE, { mode: 'navigate' })); assert.ok((await off.text()).includes('jogo v1'), 'o cache da v1 continua com o HTML da v1 (não citaria scripts ?v=v2 que ele não tem)');
});
test('SW: atualização v1 → v2 — a v2 instala e assume, apaga a v1, e offline passa a servir a v2 inteira', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install(); await a.activate();
  srv.ver = 'v2'; const b = loadSW('v2'); await b.install(); await b.activate();
  assert.deepStrictEqual([...caches.store.keys()], ['fazenda-las-v2']); srv.online = false;
  assert.ok((await (await b.fetch(new Req(BASE, { mode: 'navigate' }))).text()).includes('jogo v2')); assert.ok((await b.fetch(new Req('game.js?v=v2'))).ok);
  await assert.rejects(b.fetch(new Req('game.js?v=v1')), /offline/, 'código da v1 não sobrou no cache');
});
test('SW: página que o servidor recusa (404) não é guardada nem mascarada; sem rede e sem cache a falha é a normal; POST e outras origens passam direto', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install();
  srv.down.add(BASE + 'nada'); const r = await a.fetch(new Req(BASE + 'nada', { mode: 'navigate' })); assert.strictEqual(r.ok, false);
  const c = await caches.open('fazenda-las-v1'); assert.ok(!c.m.has(BASE + 'nada'));
  assert.strictEqual(await a.fetch(new Req(BASE + 'x', { method: 'POST' })), undefined, 'POST: o SW não responde (vai à rede)');
  assert.strictEqual(await a.fetch(Object.assign(new Req(BASE + 'x'), { url: 'https://outro.com/x.png' })), undefined, 'outra origem: o SW não responde');
  reset(srv.handler); const b = loadSW('v1'); srv.online = false; await assert.rejects(b.fetch(new Req(BASE, { mode: 'navigate' })), /offline/);
});
test('SW: rede travada (sem resposta) cai no cache depois do limite, em vez de deixar o jogador olhando uma tela em branco', async () => {
  const srv = serverOf(); reset(srv.handler); const a = loadSW('v1'); await a.install();
  net = r => (r.mode === 'navigate' ? new Promise(() => { /* nunca responde */ }) : srv.handler(r));
  const t0 = Date.now(); const res = await a.fetch(new Req(BASE, { mode: 'navigate' })); const dt = Date.now() - t0;
  assert.ok((await res.text()).includes('jogo v1')); assert.ok(dt >= 3500 && dt < 8000, 'esperou ~4 s: ' + dt);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('o teste travou (20 s)')), 20000).unref())]); pass++; console.log('ok     ' + name); } catch (e) { fail++; console.log('FALHOU ' + name + '\n   ✗ ' + (e && e.message || e).split('\n')[0]); if (process.env.VERBOSE) console.log(e && e.stack); }
  }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignora */ } }
  console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
