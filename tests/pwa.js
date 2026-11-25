'use strict';
/* Teste do PWA no NAVEGADOR REAL (Fase 3) — opt-in, fora do `run.js`:   node tests/pwa.js [--chrome=caminho]
   Chrome em TEMPO REAL via CDP (Node 22+, sem dependências), site MONTADO pelo tools/build-site.js e servido em http://127.0.0.1 (localhost conta como origem
   segura, então o service worker funciona como no https do Pages). O HTML sai com `cache-control: max-age=600` (como o GitHub Pages); o resto com `no-store`, para o cache HTTP do Chrome não esconder o service worker. Roteiro:
     1) 1ª visita: o SW instala sozinho, guarda o site inteiro, o manifesto é lido e o Chrome não aponta erro de instalabilidade
     2) joga (muda o jogo e salva) → DERRUBA o servidor → recarrega: abre OFFLINE (a página, os 4 scripts e as imagens vêm do cache) e o Continuar traz o save
     3) NOVO DEPLOY (v2, com um marcador no game.js): servidor de volta com a v2 → recarrega: o HTML novo chega apesar do max-age (rede primeiro), o SW v2 assume,
        apaga o cache da v1 e deixa um cache de OUTRO projeto em paz → o jogo carregado é o código novo e o SAVE continua igual (o SW nunca toca o localStorage)
     4) offline de novo, agora na v2
   Código de saída 0 = passou. Limpa o perfil e os sites temporários ao terminar. */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const lib = require('./lib');
const { build } = require('../tools/build-site.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 400), HTTP_PORT = PORT + 500;
let pass = 0, fail = 0; const ok = (name, cond, detail) => { cond ? pass++ : fail++; console.log((cond ? 'ok     ' : 'FALHOU ') + name + (cond || detail === undefined ? '' : '  → ' + detail)); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* servidor trocável: `site.dir` aponta para o deploy no ar; `down()`/`up()` derrubam e sobem de verdade (sem servidor = sem rede) */
function makeServer(site) {
  let srv = null; const hits = [];
  const handler = (q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+$/, 'index.html').replace(/^\//, '') || 'index.html', f = path.join(site.dir, rel);
    hits.push(rel);
    if (!f.startsWith(site.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; r.end('nada'); return; }
    r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); r.setHeader('cache-control', rel.endsWith('.html') ? 'max-age=600' : 'no-store');      // o HTML como o Pages (prova o "rede primeiro"); o resto SEM cache HTTP, senão o do Chrome esconderia o que o SW faz (visto numa mutação que passou)
    r.end(fs.readFileSync(f));
  };
  return {
    hits, up: () => new Promise(res => { srv = http.createServer(handler); srv.listen(HTTP_PORT, '127.0.0.1', res); }),
    down: () => new Promise(res => { if (!srv) return res(); srv.closeAllConnections(); srv.close(() => res()); srv = null; }),
  };
}
async function cdpJson(p, method) { for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: method || 'GET' }); return await r.json(); } catch (e) { await sleep(200); } } throw new Error('Chrome não respondeu'); }
async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = {}; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const until = async (expr, ms = 20000) => { const t0 = Date.now(); for (;;) { try { if (await ev(expr)) return true; } catch (e) { /* página carregando */ } if (Date.now() - t0 > ms) return false; await sleep(150); } };
  return { send, ev, until, close: () => ws.close() };
}
const cacheNames = tab => tab.ev(`caches.keys().then(k => k.sort())`);

async function main() {
  const chromeArg = (process.argv.find(a => a.startsWith('--chrome=')) || '').split('=')[1];
  const chrome = lib.findChrome(chromeArg), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-pwa-prof-')), work = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-pwa-site-'));
  const v1 = build(path.join(work, 'v1'), { version: 'v1' }), v2 = build(path.join(work, 'v2'), { version: 'v2' });
  fs.appendFileSync(path.join(v2.outDir, 'game.js'), '\n;window.__deploy = "v2";\n');           // o "código novo" do deploy 2
  const site = { dir: v1.outDir }, server = makeServer(site), URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html?debug';
  await server.up();
  const child = cp.spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + prof, '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let tab = null;
  try {
    await cdpJson('/json/version');
    tab = await attach(await cdpJson('/json/new?' + URL, 'PUT')); await tab.send('Page.enable', {});
    const boot = () => tab.until(`!document.getElementById('btnNew').disabled`, 40000);
    const reload = async () => { await tab.send('Page.reload', { ignoreCache: false }); await sleep(300); };

    /* ---- 1) 1ª visita ---- */
    ok('1ª visita: o jogo carregou (v1)', await boot() && await tab.ev(`document.querySelector('meta[name=fazenda-build]').content`) === 'v1');
    ok('o service worker instalou e controla a página', await tab.until(`navigator.serviceWorker.ready.then(r => !!r.active && r.active.state === 'activated') `, 30000) && await tab.until(`!!navigator.serviceWorker.controller`, 15000));
    ok('o cache fazenda-las-v1 tem o site inteiro', await tab.ev(`caches.open('fazenda-las-v1').then(c => c.keys()).then(k => k.length)`) === v1.precache.length, await tab.ev(`caches.open('fazenda-las-v1').then(c => c.keys()).then(k => k.length)`) + ' de ' + v1.precache.length);
    const m = await tab.send('Page.getAppManifest', {});
    ok('o manifesto foi lido sem erros (nome e 3 ícones)', !(m.result.errors || []).length && /FAZENDA/.test(m.result.data || '') && (JSON.parse(m.result.data).icons || []).length === 3, JSON.stringify(m.result.errors));
    const inst = await tab.send('Page.getInstallabilityErrors', {});
    ok('o Chrome não aponta nenhum erro de instalabilidade', Array.isArray(inst.result.installabilityErrors) && inst.result.installabilityErrors.length === 0, JSON.stringify(inst.result.installabilityErrors));

    /* ---- 2) jogar, derrubar o servidor, abrir offline ---- */
    await tab.ev(`localStorage.setItem('fazenda_las:v2:meta-outro-projeto', 'nao mexer')`);
    await tab.ev(`document.getElementById('btnNew').click()`); await sleep(200); await tab.ev(`document.querySelectorAll('.charCard')[0].click()`);
    ok('novo jogo iniciou', await tab.until(`!!window.__game`, 30000));
    await tab.ev(`window.__game.S.gold = 4321; window.__game.S.day = 7; window.__game.save().ok`);
    const saved = await tab.ev(`localStorage.getItem('fazenda_las:v2:slot:1')`);
    ok('jogo salvo (dia 7, 4321 ◎)', !!saved && JSON.parse(saved).data.gold === 4321);
    await server.down();
    await reload();
    ok('OFFLINE: a página abre (servidor derrubado)', await boot(), 'a página não abriu sem rede');
    ok('OFFLINE: scripts e imagens carregaram (o jogo montou o título e o canvas)', await tab.ev(`typeof SaveManager === 'object' && typeof Art === 'object' && !document.getElementById('btnContinue').disabled`));
    ok('OFFLINE: o save continua lá e o Continuar traz o jogo', await tab.ev(`!document.getElementById('btnContinue').classList.contains('hidden')`) && (await (async () => { await tab.ev(`document.getElementById('btnContinue').click()`); return tab.until(`!!window.__game && window.__game.S.gold === 4321 && window.__game.S.day === 7`, 30000); })()));
    ok('OFFLINE: nenhuma imagem falhou (o jogo não caiu no sprite vazio)', await tab.ev(`[...document.images].length > 0 && [...document.images].every(i => i.complete && i.naturalWidth > 0)`));
    await tab.ev(`window.__game.S.gold = 4400; window.__game.save().ok`);
    ok('OFFLINE: salvar continua funcionando (localStorage não depende do SW)', JSON.parse(await tab.ev(`localStorage.getItem('fazenda_las:v2:slot:1')`)).data.gold === 4400);

    /* ---- 3) novo deploy ---- */
    await tab.ev(`caches.open('outro-projeto-cache').then(c => c.put('/x', new Response('meu')))`);
    site.dir = v2.outDir; await server.up();
    await reload();
    ok('DEPLOY: o HTML novo chegou apesar do max-age=600 (rede primeiro) — v2 no ar', await boot() && await tab.ev(`document.querySelector('meta[name=fazenda-build]').content`) === 'v2');
    ok('DEPLOY: o código novo está rodando (game.js?v=v2)', await tab.ev(`window.__deploy`) === 'v2' && await tab.ev(`[...document.scripts].some(s => s.src.endsWith('game.js?v=v2'))`));
    ok('DEPLOY: o SW v2 assumiu, apagou o cache da v1 e deixou o de outro projeto', await tab.until(`caches.keys().then(k => k.includes('fazenda-las-v2') && !k.includes('fazenda-las-v1') && k.includes('outro-projeto-cache'))`, 30000), JSON.stringify(await cacheNames(tab)));
    const after = JSON.parse(await tab.ev(`localStorage.getItem('fazenda_las:v2:slot:1')`));
    ok('DEPLOY: o SAVE continua igual (4400 ◎, dia 7) e o localStorage de outro projeto também', after.data.gold === 4400 && after.data.day === 7 && await tab.ev(`localStorage.getItem('fazenda_las:v2:meta-outro-projeto')`) === 'nao mexer');
    ok('DEPLOY: o Continuar abre o jogo salvo com o código novo', await tab.ev(`document.getElementById('btnContinue').click(), true`) && await tab.until(`!!window.__game && window.__game.S.gold === 4400`, 30000));

    /* ---- 4) offline na v2 ---- */
    await server.down(); await reload();
    ok('OFFLINE v2: abre, é o código novo e o save está lá', await boot() && await tab.ev(`window.__deploy`) === 'v2' && await tab.ev(`!document.getElementById('btnContinue').classList.contains('hidden')`));
  } catch (e) { ok('EXCEÇÃO no teste', false, e && e.stack || e); }
  try { tab && tab.close(); } catch (e) { /* ignora */ }
  child.kill(); await server.down(); await sleep(800);
  for (const d of [prof, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* perfil preso: ignora */ } }
  console.log('\n' + pass + ' verificações passaram, ' + fail + ' falharam');
  return fail ? 1 : 0;
}
main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
