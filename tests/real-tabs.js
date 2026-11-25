'use strict';
/* Teste com DUAS ABAS REAIS (Fase 2c) — opt-in, fora do `run.js`:   node tests/real-tabs.js [--chrome=caminho]
   Por quê separado: a suíte principal roda em tempo virtual, onde o `navigator.locks` REAL nunca responde (tests/fakes.js), então ela testa o protocolo com
   falsos. Aqui o Chrome roda em TEMPO REAL, com Web Locks e BroadcastChannel de verdade, e o runner o controla pelo protocolo de depuração (CDP; Node 22+, sem
   dependências). O jogo é servido em http://127.0.0.1 (como na produção: origem real, não file://). Cenários:
     1) 2ª aba fica bloqueada → "Assumir aqui" → a 1ª SALVA antes de soltar, para e mostra a tela; a 2ª entra e grava; a 1ª é recusada (LockLost)
     2) aba dona CONGELADA (depurador pausado: não responde ao canal) → a 2ª rouba depois do prazo; a dona, ao acordar, vê "assumiu o jogo" e não grava
   Código de saída 0 = passou. Limpa o perfil e o site temporários ao terminar. */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const lib = require('./lib');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9400 + Math.floor(Math.random() * 400), HTTP_PORT = PORT + 500;
let pass = 0, fail = 0; const ok = (name, cond, detail) => { cond ? pass++ : fail++; console.log((cond ? 'ok     ' : 'FALHOU ') + name + (cond || detail === undefined ? '' : '  → ' + detail)); };

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const srv = http.createServer((q, r) => {
    const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+$/, 'index.html').replace(/^\//, ''));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; r.end(); return; }
    r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  });
  return new Promise(res => srv.listen(HTTP_PORT, '127.0.0.1', () => res(srv)));
}
async function cdpJson(p, method) { for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: method || 'GET' }); return await r.json(); } catch (e) { await sleep(200); } } throw new Error('Chrome não respondeu no CDP'); }
async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = {}; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };
  const until = async (expr, ms = 15000) => { const t0 = Date.now(); for (;;) { try { if (await ev(expr)) return true; } catch (e) { /* página ainda carregando */ } if (Date.now() - t0 > ms) return false; await sleep(150); } };
  return { id: target.id, send, ev, until, close: () => ws.close() };
}
const open = async url => { const t = await cdpJson('/json/new?' + url, 'PUT'); return attach(t); };
const vis = id => `!document.getElementById('${id}').classList.contains('hidden')`;
const stored = tab => tab.ev(`(()=>{const r=localStorage.getItem('fazenda_las:v2:slot:1');return r?JSON.parse(r):null})()`);

async function main() {
  const chromeArg = (process.argv.find(a => a.startsWith('--chrome=')) || '').split('=')[1];
  const chrome = lib.findChrome(chromeArg), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-cdp-')), site = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-site-'));
  for (const f of ['index.html', 'style.css', 'art.js', 'animais.js', 'pesca.js', 'save.js', 'game.js']) fs.copyFileSync(path.join(lib.ROOT, f), path.join(site, f));
  fs.cpSync(path.join(lib.ROOT, 'assets'), path.join(site, 'assets'), { recursive: true });
  const srv = await serve(site), URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html?debug';
  const child = cp.spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + prof, '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  const tabs = [];
  try {
    await cdpJson('/json/version');
    const bootReady = t => t.until(`!document.getElementById('btnNew').disabled`, 40000);

    /* ---- 1) cedência cooperativa ---- */
    const A = await open(URL); tabs.push(A);
    ok('aba A: carregou o título', await bootReady(A));
    await A.ev(`document.getElementById('btnNew').click()`); await sleep(200);
    await A.ev(`document.querySelectorAll('.charCard')[0].click()`);
    ok('aba A: o jogo iniciou (tem o bloqueio)', await A.until(`!!window.__game && document.getElementById('hud') && !document.getElementById('hud').classList.contains('hidden')`, 30000) && await A.ev(`SaveManager.playLock.state()`) === 'held');
    await A.ev(`window.__game.S.gold = 777; window.__game.save().ok`);
    await A.ev(`window.__game.S.gold = 778`);                                  // 778 só existe na memória: quem cede tem de SALVAR antes de soltar
    const B = await open(URL); tabs.push(B);
    ok('aba B: fica BLOQUEADA ("já está aberto em outra aba")', await B.until(vis('lockOverlay'), 20000) && (await B.ev(`document.getElementById('lkTitle').textContent`)).includes('já está aberto'));
    ok('aba B: o jogo não iniciou e o título está travado', await B.ev(`document.getElementById('btnNew').disabled && !window.__game`));
    await B.ev(`document.getElementById('lkTake').click()`);
    ok('aba B: "Assumir aqui" → entra (a tela some e o título habilita)', await B.until(`!document.getElementById('btnNew').disabled && document.getElementById('lockOverlay').classList.contains('hidden')`, 20000));
    ok('aba A: parou e mostra "aberto em outra aba"', await A.until(vis('lockOverlay'), 10000) && (await A.ev(`document.getElementById('lkTitle').textContent`)).includes('aberto em outra aba'));
    const s1 = await stored(B); ok('o jogo da A foi SALVO antes de ceder (ouro 778 no storage)', !!s1 && s1.data.gold === 778, s1 && s1.data.gold);
    ok('aba B: tem o bloqueio', await B.ev(`SaveManager.playLock.state()`) === 'held');
    await B.ev(`document.getElementById('btnContinue').click()`);
    ok('aba B: Continuar inicia o jogo salvo pela A', await B.until(`!!window.__game && window.__game.S.gold === 778`, 30000));
    ok('aba B: grava (rev sobe)', await B.ev(`window.__game.save().ok`) && (await stored(B)).rev === s1.rev + 1);
    const before = JSON.stringify(await stored(B));
    const r = await A.ev(`(()=>{const r=window.__game.save(true);return [r.ok, r.error&&r.error.name]})()`);
    ok('aba A: save() recusado (LockLost)', r[0] === false && r[1] === 'LockLost', JSON.stringify(r));
    ok('o storage ficou como a B deixou', JSON.stringify(await stored(B)) === before);

    /* ---- 2) aba dona congelada: roubo ---- */
    // B joga e é CONGELADA pelo depurador (não responde ao canal); a C pede o jogo, espera o prazo e rouba
    await B.send('Debugger.enable', {}); await B.ev(`window.__game.S.gold = 900; window.__game.save().ok`);
    const C = await open(URL); tabs.push(C);
    ok('aba C: bloqueada (a B joga)', await C.until(vis('lockOverlay'), 20000));
    const frozen = JSON.stringify(await stored(B));
    await B.send('Debugger.pause', {});                                       // B congela: JS parado, sem responder ao BroadcastChannel
    const t0 = Date.now(); await C.ev(`document.getElementById('lkTake').click()`);
    ok('aba C: depois do prazo ROUBA o bloqueio e entra', await C.until(`!document.getElementById('btnNew').disabled && document.getElementById('lockOverlay').classList.contains('hidden')`, 20000), 'esperou ' + (Date.now() - t0) + ' ms');
    ok('o roubo esperou o prazo (≥ ~2,5 s): a dona teve a chance de ceder', Date.now() - t0 >= 2500, Date.now() - t0);
    await B.send('Debugger.resume', {});
    const seen = await B.until(vis('lockOverlay'), 10000), bTitle = await B.ev(`document.getElementById('lkTitle').textContent`);
    ok('aba B: ao acordar vê "outra aba assumiu o jogo"', seen && bTitle.includes('assumiu'), seen + ' / "' + bTitle + '" / lock=' + await B.ev('SaveManager.playLock.state()'));
    ok('aba B: oferece baixar o que estava na memória (ouro 900)', await B.ev(`document.getElementById('lkDl').offsetParent !== null && SaveManager.exportText(window.__game.S).includes('"gold":900')`));
    const rb = await B.ev(`(()=>{const r=window.__game.save(true);return [r.ok, r.error&&r.error.name]})()`);
    ok('aba B: não grava mais (LockLost)', rb[0] === false && rb[1] === 'LockLost', JSON.stringify(rb));
    ok('aba C: tem o bloqueio e o jogo como a B deixou ao congelar', await C.ev(`SaveManager.playLock.state()`) === 'held' && JSON.stringify(await stored(C)) === frozen, 'o storage mudou depois do roubo (a dona congelada gravou ao acordar?)');
  } catch (e) { ok('EXCEÇÃO no teste', false, e && e.stack || e); }
  for (const t of tabs) { try { t.close(); } catch (e) { /* ignora */ } }
  child.kill(); srv.close(); await sleep(800);
  for (const d of [prof, site]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* perfil preso: ignora */ } }
  console.log('\n' + pass + ' verificações passaram, ' + fail + ' falharam');
  return fail ? 1 : 0;
}
main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
