/* Cenários de teste que rodam DENTRO da página do jogo (injetados em uma cópia do index.html por tests/run.js).
   O cenário vem do hash da URL (#nome). Cada cenário tem seed() (roda ANTES do boot do jogo, ex.: preparar o localStorage)
   e run() (roda depois que o jogo carregou). O resultado vai para <pre id="results"> como JSON {tests, data}. */
(() => {
  'use strict';
  const name = location.hash.slice(1), F = window.FIXTURES || {};
  const tests = []; let data = null;

  /* =====================================================================================================================================
     T — acesso ao ARMAZENAMENTO, NEUTRO AO FORMATO. Os cenários não sabem em que chave nem em que formato o save mora: tudo passa por T.
     Quando o formato mudar (Fase 1b: chaves fazenda_las:v2:*, envelope com crc), só ESTE bloco muda — os cenários continuam iguais.
     Hoje: formato v1 (uma chave + cópias `<chave>_backup_<ts>`). "Estado" = o objeto do jogo (S); "raw" = o texto gravado.
       T.reset()                  apaga TUDO do storage
       T.readMain() / T.mainState()   texto gravado / estado (null se não há save ou o texto não é JSON)
       T.setMain(raw) / T.setMainState(st) → raw   grava o save principal (também serve para simular "outra aba gravou")
       T.removeMain()             apaga o save principal ("outra aba apagou")
       T.isMainKey(k)             a chave k é a do save principal? (para contar gravações em Storage.prototype.setItem)
       T.copies()                 cópias de segurança [{ key, ts, raw, state }], da mais antiga para a mais nova (ts null = chave antiga sem data)
       T.copyRaw(ts)              texto da cópia com esse ts (null = sem data), ou null
       T.seedCopy(ts, raw)        cria uma cópia de segurança (ts null = chave antiga sem data)
       T.fixtureState(nome)       estado (objeto) de uma fixture do tests/fixtures
       T.validRaw(dia, ouro)      TEXTO de um save mínimo válido (para semear principal ou cópias)
       T.fireStorage(raw)         dispara o evento "storage" do save principal como se OUTRA aba o tivesse mudado (raw null = apagou)
       T.fireStorageClear()       idem para "limpar os dados do site" (key null)
     ===================================================================================================================================== */
  const T = (() => {
    const KEY = 'fazenda_leankar_v1', BK = KEY + '_backup';
    const parse = raw => { try { return JSON.parse(raw); } catch (e) { return null; } };
    const copyKey = ts => ts === null ? BK : BK + '_' + ts;
    return {
      reset: () => localStorage.clear(),
      isMainKey: k => k === KEY,
      readMain: () => localStorage.getItem(KEY),
      mainState: () => { const r = localStorage.getItem(KEY); return r === null ? null : parse(r); },
      setMain: raw => localStorage.setItem(KEY, raw),
      setMainState: st => { const raw = JSON.stringify(st); localStorage.setItem(KEY, raw); return raw; },
      removeMain: () => localStorage.removeItem(KEY),
      copies: () => Object.keys(localStorage).filter(k => k === BK || k.startsWith(BK + '_'))
        .map(k => { const raw = localStorage.getItem(k), ts = k === BK ? null : +k.slice(BK.length + 1); return { key: k, ts, raw, state: parse(raw) }; })
        .sort((a, b) => (a.ts === null ? -1 : a.ts) - (b.ts === null ? -1 : b.ts)),
      copyRaw: ts => localStorage.getItem(copyKey(ts)),
      seedCopy: (ts, raw) => localStorage.setItem(copyKey(ts), raw),
      fixtureState: nome => parse(F[nome]),
      validRaw: (day, gold) => JSON.stringify({ v: 1, day, gold, min: 400, soil: new Array(46 * 34).fill(0), crops: {} }),
      fireStorage: raw => window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: raw, storageArea: localStorage })),
      fireStorageClear: () => window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage })),
    };
  })();
  const validSave = T.validRaw;      // atalho usado nos cenários
  const ok = (n, c, x) => tests.push({ ok: !!c, name: name + ': ' + n, detail: x === undefined ? '' : String(x) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id), vis = id => !$(id).classList.contains('hidden');
  const toasts = () => [...document.querySelectorAll('#toast div')].map(d => d.textContent);
  const clearToasts = () => document.querySelectorAll('#toast div').forEach(d => d.remove());
  const hasNaN = (v, path = 'S') => {          // devolve o caminho do 1º NaN/Infinity encontrado
    if (typeof v === 'number') return Number.isFinite(v) ? null : path + '=' + v;
    if (v && typeof v === 'object') for (const k in v) { const r = hasNaN(v[k], path + '.' + k); if (r) return r; }
    return null;
  };
  async function bootReady() {
    let n = 0; while ($('btnNew').disabled && n++ < 1200) await wait(100);
    if ($('btnNew').disabled) throw new Error('boot travado: ' + $('loadTxt').textContent + ' | ' + window.__errs.join('|'));
  }
  async function gameReady() {
    let n = 0; while (!window.__game && n++ < 3000) await wait(100);
    if (!window.__game) throw new Error('jogo não iniciou: ' + window.__errs.join('|'));
    await wait(200); return window.__game;
  }
  // O início do jogo (botão → rAF → setTimeout) depende de um quadro REAL do headless, e o tempo virtual corre bem mais rápido que o real:
  // o quadro chega quando quer (de 30 s a nunca, em tempo virtual). Os cenários em que o jogo NÃO inicia (e portanto nunca chegam ao loop de
  // jogo) usam este atalho: se o rAF não vier em 50 ms de tempo virtual, o timer dispara o mesmo callback (determinístico).
  function fastRaf() {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { let done = false; const f = t => { if (!done) { done = true; cb(t); } }; raf(f); setTimeout(() => f(performance.now()), 50); return 0; };
  }
  async function waitStart(cond) { let n = 0; while (!cond() && n++ < 100) await wait(100); }
  async function startNew(card = 0) { $('btnNew').click(); await wait(100); document.querySelectorAll('.charCard')[card].click(); return gameReady(); }
  const steps = (G, n, dt = .05) => { for (let i = 0; i < n; i++) G.step(dt); };
  // enche o localStorage ATÉ ESTOURAR DE VERDADE (cota real do navegador, não simulada)
  function fillStorage() {
    let i = 0;
    for (const size of [50000, 5000, 500, 50, 5, 1]) { const chunk = 'x'.repeat(size); try { for (;;) localStorage.setItem('fill_' + i++, chunk); } catch (e) { /* cheio neste tamanho */ } }
  }
  const unfillStorage = () => Object.keys(localStorage).filter(k => k.startsWith('fill_')).forEach(k => localStorage.removeItem(k));

  /* ---------- 1) saves que DEVEM carregar (antigos, mínimos, com lixo transitório) ---------- */
  function loadable(fx, extra) {
    return {
      seed() { T.reset(); T.setMain(F[fx]); },
      async run() {
        const raw = F[fx], orig = JSON.parse(raw);
        await bootReady();
        ok('sem aviso de problema', !vis('saveProblem')); ok('Continuar visível', vis('btnContinue'));
        ok('save principal intacto após o boot', T.readMain() === raw); ok('nenhuma cópia criada', T.copies().length === 0);
        $('btnContinue').click(); const G = await gameReady(), S = G.S, A = G.Animals;
        ok('sem NaN/Infinity no estado carregado', !hasNaN(S), hasNaN(S));
        ok('campos novos com padrão: meat número, meatDone array, laid 1|2', typeof S.meat === 'number' && Array.isArray(S.meatDone) && (S.laid === 1 || S.laid === 2), [S.meat, S.meatDone, S.laid]);
        ok('up/stat/owned completos', ['basket', 'can', 'boots'].every(k => Number.isFinite(S.up[k])) && ['till', 'plant', 'water', 'harvest', 'sold', 'sleep'].every(k => Number.isFinite(S.stat[k])) && ['vaca', 'porco', 'cavalo'].every(k => Number.isFinite(S.owned[k])));
        steps(G, 80);
        ok('HUD sem "NaN"/"undefined" após 80 quadros', !/NaN|undefined/.test($('hud').innerText), $('hud').innerText.slice(0, 80));
        ok('animais criados batem com owned', A.cows().length === S.owned.vaca && A.pigs().length === S.owned.porco && A.list.filter(a => a.kind === 'cavalo').length === S.owned.cavalo, JSON.stringify(S.owned));
        G.endDay(false); steps(G, 20);
        ok('sem NaN depois de passar um dia', !hasNaN(G.S), hasNaN(G.S));
        const r = G.save(); ok('salvar de novo funciona', r.ok);
        const back = T.mainState();
        ok('regravado: v=1, sem pt/pk, plantas preservadas', back.v === 1 && !/"pt"|"pk"/.test(JSON.stringify(back.crops)) && (!orig.crops || Object.keys(back.crops).length === Object.keys(orig.crops).length));
        if (extra) await extra({ G, S: G.S, orig });
        ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
      },
    };
  }

  /* ---------- 2) saves que NÃO podem carregar: aviso, nada apagado, cópia, confirmação ---------- */
  function unloadable(fx, expectMsg) {
    return {
      seed() { T.reset(); T.setMain(typeof fx === 'string' && F[fx] !== undefined ? F[fx] : fx); },
      async run() {
        const raw = T.readMain();
        await bootReady();
        ok('aviso visível', vis('saveProblem')); ok('mensagem cita: ' + expectMsg, $('spMsg').textContent.includes(expectMsg), $('spMsg').textContent);
        ok('avisa que a cópia foi guardada', $('spMsg').textContent.includes('cópia de segurança foi guardada'));
        ok('Baixar visível, Restaurar escondido (não há cópia válida)', vis('btnSpExport') && !vis('btnSpRestore'));
        ok('Continuar escondido', !vis('btnContinue'));
        ok('save principal NÃO foi alterado', T.readMain() === raw);
        ok('exatamente 1 cópia, idêntica ao original', T.copies().length === 1 && T.copies()[0].raw === raw, T.copies().length);
        $('btnSpExport').click(); await wait(100);
        $('btnNew').click(); await wait(100);
        ok('Novo jogo pede confirmação citando a cópia', vis('confirmNew') && $('confirmMsg').textContent.includes('cópia de segurança'), $('confirmMsg').textContent);
        $('btnSpClose').click(); ok('Entendi fecha o aviso', !vis('saveProblem'));
        ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
      },
    };
  }

  const S_ = {};   // cenários

  S_['fixture-pre-carne'] = loadable('save_v1_pre_carne', async ({ orig, S }) => {
    ok('fixture realmente é anterior à carne (sem meat/laid/meatDone)', !('meat' in orig) && !('laid' in orig) && !('meatDone' in orig));
    ok('S.meat = 0 e posturas de meio-dia não repostas ao carregar', S.meat === 0 && S.laid >= 1);
  });
  S_['fixture-atual'] = loadable('save_v1_atual', async ({ orig, S }) => {
    ok('dia e ouro preservados (sem endDay depois = comparar com o que foi lido)', orig.day >= 1 && Number.isFinite(orig.gold));
  });
  S_['fixture-minimo'] = loadable('save_v1_minimo', async ({ S }) => { ok('defaults preenchidos num save mínimo', S.seeds.cenoura >= 0 && S.owned.vaca === 0 && Array.isArray(S.milked)); });
  S_['fixture-parcial'] = loadable('save_v1_parcial', async ({ S }) => {
    ok('valores do save preservados (up.basket=1, stat.till=5, owned.vaca=1)', S.up.basket === 1 && S.stat.till === 5 && S.owned.vaca === 1, JSON.stringify([S.up, S.stat.till, S.owned]));
    ok('chaves que faltavam vieram dos padrões (up.can/boots, stat.sold, seeds.tomate, harvest.milho)', S.up.can === 0 && S.up.boots === 0 && S.stat.sold === 0 && S.seeds.tomate === 0 && S.harvest.milho === 0);
  });
  S_['fixture-com-ptpk'] = loadable('save_v1_com_ptpk', async ({ G }) => {
    ok('fixture traz pt/pk (é o caso testado)', /"pt"/.test(F.save_v1_com_ptpk));
  });
  S_['fixture-truncado'] = unloadable('save_v1_truncado', 'corrompido');
  S_['fixture-invalido'] = unloadable('save_invalido', 'corrompido');
  S_['fixture-futuro'] = unloadable('save_futuro_schema99', 'mais nova');
  S_['fixture-shape'] = unloadable('save_v1_shape', 'incompleto');
  S_['fixture-versao'] = unloadable('save_versao_desconhecida', 'não reconhece');

  /* sessão com várias cópias: mantém só 3 e oferece restaurar a válida mais recente */
  S_['rotacao-copias'] = {
    seed() {
      T.reset();
      T.seedCopy(1000, validSave(1, 10)); T.seedCopy(2000, validSave(2, 20));
      T.seedCopy(null, '{"velha":'); T.seedCopy(3000, validSave(3, 30)); T.setMain('{lixo');
    },
    async run() {
      await bootReady();
      const cs = T.copies(), tss = cs.map(c => c.ts);
      ok('mantém só 3 cópias', cs.length === 3, tss.join(','));
      ok('a mais antiga (chave sem data) foi descartada', T.copyRaw(null) === null);
      ok('o principal ilegível também virou cópia', cs.some(c => c.raw === '{lixo'));
      ok('restaurar oferece a cópia válida MAIS RECENTE (Dia 3)', vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia 3'), $('btnSpRestore').textContent);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* R4: a poda descarta primeiro as cópias ILEGÍVEIS — a única cópia válida (a mais antiga) tem de sobreviver */
  S_['poda-copias-validas'] = {
    seed() {
      T.reset();
      T.seedCopy(1000, validSave(1, 10));                                                   // a ÚNICA válida, e a mais antiga
      for (const t of [2000, 3000, 4000]) T.seedCopy(t, '{"lixo' + t + '":');             // 3 ilegíveis, mais novas
      T.setMain('{lixo');                                                                      // o principal ilegível vira a 5ª cópia → poda
    },
    async run() {
      await bootReady();
      const cs = T.copies(), tss = cs.map(c => c.ts);
      ok('mantém só 3 cópias', cs.length === 3, tss.join(','));
      ok('a cópia VÁLIDA (a mais antiga) sobreviveu', T.copyRaw(1000) === validSave(1, 10), tss.join(','));
      ok('as ilegíveis MAIS ANTIGAS foram podadas (2000, 3000); ficam a 4000 e o principal ilegível', T.copyRaw(2000) === null && T.copyRaw(3000) === null && T.copyRaw(4000) !== null && cs.some(c => c.raw === '{lixo'), tss.join(','));
      ok('"Restaurar" continua oferecido (Dia 1)', vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia 1'), $('btnSpRestore').textContent);
      ok('o principal ilegível não foi alterado', T.readMain() === '{lixo');
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* R5: o principal ilegível NÃO tem cópia (não coube) → "Restaurar" não o sobrescreve no 1º clique. Recarrega a página, então roda duas vezes */
  S_['restaurar-sem-copia'] = {
    seed() {
      if (sessionStorage.getItem('ran') === 'restaurar-sem-copia') return;
      T.reset();
      T.seedCopy(5000, validSave(7, 777));
      T.setMain('{lixo' + 'x'.repeat(8000));       // ilegível e MAIOR que a cópia válida (restaurar depois cabe, guardar cópia dele não)
      fillStorage();
    },
    async run() {
      await bootReady();
      const big = '{lixo' + 'x'.repeat(8000);
      if (sessionStorage.getItem('ran') !== 'restaurar-sem-copia') {
        sessionStorage.setItem('ran', 'restaurar-sem-copia');
        const nb = T.copies().length;
        ok('sem espaço: o principal ilegível não ganhou cópia', nb === 1, nb);
        ok('"Restaurar" e "Baixar cópia" disponíveis', vis('btnSpRestore') && vis('btnSpExport'));
        $('btnSpRestore').click();          // SEM esperar: se o jogo restaurar (defeito), a página recarrega logo — as verificações abaixo são síncronas e gravadas antes disso
        ok('1º clique NÃO sobrescreve o principal ilegível', T.readMain() === big);
        ok('avisa que não coube a cópia e o botão vira "Restaurar mesmo assim"', $('spMsg').textContent.includes('Não foi possível guardar uma cópia') && $('btnSpRestore').textContent.includes('mesmo assim'), $('spMsg').textContent + ' | ' + $('btnSpRestore').textContent);
        ok('sem erros JS (1ª carga)', !window.__errs.length, window.__errs.join('|'));
        sessionStorage.setItem('first', JSON.stringify(tests));
        $('btnSpRestore').click(); await wait(3000); return;          // 2º clique: restaura de fato e recarrega
      }
      const first = JSON.parse(sessionStorage.getItem('first') || '[]');
      for (const t of first) tests.push(t);
      ok('a 1ª carga registrou suas verificações', first.length === 5, first.length);
      ok('2º clique restaurou: principal = cópia válida', T.readMain() === validSave(7, 777));
      ok('Continuar visível e sem aviso', vis('btnContinue') && !vis('saveProblem'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* restaurar: recarrega a página, então o cenário roda duas vezes (marcador em sessionStorage) */
  S_['restaurar'] = {
    seed() {
      if (sessionStorage.getItem('ran') === 'restaurar') return;
      T.reset(); T.seedCopy(5000, validSave(7, 777)); T.setMain('{lixo');
    },
    async run() {
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'restaurar') {
        sessionStorage.setItem('ran', 'restaurar');
        sessionStorage.setItem('first', (vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia 7')) + ' | ' + $('btnSpRestore').textContent);
        $('btnSpRestore').click(); await wait(3000); return;
      }
      ok('1ª carga: restaurar visível (Dia 7)', (sessionStorage.getItem('first') || '').startsWith('true'), sessionStorage.getItem('first'));
      ok('depois de restaurar: Continuar visível e sem aviso', vis('btnContinue') && !vis('saveProblem'));
      ok('principal = cópia restaurada', T.readMain() === validSave(7, 777));
      ok('o lixo anterior continua guardado numa cópia', T.copies().some(c => c.raw === '{lixo'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 3) falhas de gravação: cota cheia REAL, storage bloqueado ---------- */
  S_['quota-jogo'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(), S = G.S;
      ok('save inicial funciona', G.save().ok);
      fillStorage();
      for (let i = 0; i < 300; i++) S.crops[(i % 40) + ',' + (20 + Math.floor(i / 40))] = { t: 'milho', age: 1 };   // o save fica maior que o espaço livre
      clearToasts();
      let r = G.save();
      ok('save() devolve {ok:false} com QuotaExceededError REAL', r.ok === false && r.error && (r.error.name === 'QuotaExceededError' || r.error.code === 22), r.error && r.error.name);
      ok('avisa o jogador: "Sem espaço"', toasts().some(t => t.includes('Sem espaço')), JSON.stringify(toasts()));
      G.save(); G.save();
      ok('autosave não repete o aviso em seguida (throttle de 60 s)', toasts().filter(t => t.includes('Sem espaço')).length === 1);
      ok('o save anterior continua legível (a falha não corrompeu nada)', T.mainState().v === 1);
      clearToasts(); $('btnMenu').click(); await wait(50);
      $('modalBox').querySelector('button[data-a=save]').click(); await wait(50);
      ok('botão Salvar (manual) sempre avisa', toasts().some(t => t.includes('NÃO está sendo salvo')), JSON.stringify(toasts()));
      ok('botão Salvar NÃO diz "Jogo salvo!" quando falhou', !toasts().some(t => t.includes('Jogo salvo!')));
      unfillStorage(); clearToasts();
      r = G.save(); ok('liberou espaço: save() volta a funcionar', r.ok === true);
      ok('avisa "Salvamento restabelecido"', toasts().some(t => t.includes('restabelecido')), JSON.stringify(toasts()));
      ok('gravou o estado grande', Object.keys(T.mainState().crops).length === 300);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['quota-boot'] = {      // save ilegível + storage cheio: a cópia de segurança não cabe
    seed() { T.reset(); T.setMain('{lixo'); fillStorage(); },
    async run() {
      await bootReady();
      ok('aviso visível', vis('saveProblem'));
      ok('diz que NÃO foi possível guardar a cópia e manda baixar', $('spMsg').textContent.includes('Não foi possível guardar uma cópia') && $('spMsg').textContent.includes('baixe'), $('spMsg').textContent);
      ok('nenhuma cópia criada (não coube)', T.copies().length === 0);
      ok('o save ilegível continua no lugar', T.readMain() === '{lixo');
      ok('Baixar cópia disponível (o texto está em memória)', vis('btnSpExport'));
      $('btnNew').click(); await wait(100);
      ok('Novo jogo avisa que NÃO há cópia', $('confirmMsg').textContent.includes('NÃO há cópia'), $('confirmMsg').textContent);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['storage-bloqueado'] = {      // modo privado / dados do site bloqueados: tudo lança SecurityError
    seed() {
      T.reset();
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      for (const m of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) Storage.prototype[m] = boom;
    },
    async run() {
      await bootReady();
      ok('boot normal, sem aviso (não há o que ler)', !vis('saveProblem') && !vis('btnContinue'));
      const G = await startNew();
      ok('novo jogo inicia mesmo com storage bloqueado', !!G.S);
      clearToasts(); const r = G.save(true);      // manual: sempre avisa (o autosave só repete o aviso a cada 60 s de jogo, e isso depende de quantos quadros o headless entregou)
      ok('save() devolve {ok:false, SecurityError}', r.ok === false && r.error && r.error.name === 'SecurityError', r.error && r.error.name);
      ok('mensagem fala de modo privado/dados bloqueados', toasts().some(t => t.includes('modo privado')), JSON.stringify(toasts()));
      steps(G, 40);
      ok('o jogo continua jogável (sem exceção)', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 4) save logo após compra/venda/plantio e sem pt/pk ---------- */
  S_['salva-eventos'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(), S = G.S;
      let writes = 0; const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (T.isMainKey(k)) writes++; return orig.call(this, k, v); };
      const saved = () => T.mainState(), buy = sel => document.querySelector('#modalBox ' + sel);
      await wait(1200); writes = 0; await wait(1500); ok('sem eventos: nenhum save extra', writes === 0, writes);
      S.gold = 5000; G.openShop(); buy('button[data-a=buy][data-k=cenoura][data-n="1"]').click();
      ok('compra: debounce (ainda não gravou)', writes === 0); await wait(1200);
      ok('compra: gravou ouro e sementes', writes === 1 && saved().gold === 4990 && saved().seeds.cenoura === 9, 'writes=' + writes);
      writes = 0; G.openShop(); for (let i = 0; i < 4; i++) buy('button[data-a=buy][data-k=cenoura][data-n="1"]').click(); await wait(1200);
      ok('rajada de 4 compras = 1 gravação', writes === 1 && saved().seeds.cenoura === 13, 'writes=' + writes);
      G.openShop(); writes = 0; buy('button[data-a=animal][data-k=porco]').click(); await wait(1200); ok('animal: salvo', saved().owned.porco === 1 && writes === 1);
      S.gold = 0; G.openShop(); writes = 0; const b = buy('button[data-a=buy][data-k=cenoura][data-n="1"]'); b.disabled = false; b.click(); await wait(1200);
      ok('compra recusada (sem dinheiro): não grava', writes === 0, writes);
      document.querySelector('#modalBox button[data-a=close]').click();
      S.eggs = 3; S.milk = 2; G.sellAll(); await wait(1200); ok('venda: salva', writes === 1 && saved().eggs === 0 && saved().milk === 0, 'writes=' + writes);
      writes = 0; G.sellAll(); await wait(1200); ok('venda sem nada: não grava', writes === 0, writes);
      S.seeds.cenoura = 10; S.selSeed = 'cenoura'; G.selectTool(2); writes = 0;
      for (const [tx, ty] of [[8, 9], [9, 9], [10, 9]]) { S.soil[ty * G.MW + tx] = 1; G.P.x = (tx + .5) * 64; G.P.y = (ty - 1 + .6) * 64; G.P.dir = 0; G.useTool(tx, ty); steps(G, 12); }
      await wait(1200);
      ok('3 plantios em rajada = 1 gravação com as 3 plantas', writes === 1 && Object.keys(saved().crops).length >= 3, 'writes=' + writes);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['pt-pk-fora-do-save'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(), S = G.S;
      for (let y = 8; y <= 15; y++) for (let x = 6; x <= 17; x++) { S.soil[y * G.MW + x] = 1; S.crops[x + ',' + y] = { t: 'milho', age: 1, pt: 12.5, pk: 'new' }; }
      const live = JSON.stringify(S.crops); ok('save ok', G.save().ok);
      const saved = T.mainState(), len = JSON.stringify(saved.crops).length;
      ok('96 plantas gravadas', Object.keys(saved.crops).length === 96);
      ok('nada de pt/pk no que foi gravado', !/"pt"|"pk"/.test(JSON.stringify(saved.crops)));
      ok('t e age preservados', Object.values(saved.crops).every(c => c.t === 'milho' && c.age === 1));
      ok('estado VIVO não foi alterado (a animação continua)', JSON.stringify(S.crops) === live);
      ok('bloco crops ' + live.length + ' → ' + len + ' bytes (menor)', len < live.length - 1500);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 6) R1: "Novo jogo" nunca apaga o save sem guardar uma cópia ---------- */
  S_['novo-jogo-copia'] = {
    seed() { T.reset(); T.setMain(F.save_v1_atual); },
    async run() {
      const orig = T.fixtureState('save_v1_atual');
      await bootReady();
      $('btnNew').click(); await wait(100);
      ok('pede confirmação e promete a cópia de segurança', vis('confirmNew') && $('confirmMsg').textContent.includes('cópia de segurança'), $('confirmMsg').textContent);
      $('btnYes').click(); await wait(100);
      ok('a cópia já existe ANTES de escolher o personagem (idêntica ao save)', T.copies().length === 1 && T.copies()[0].raw === F.save_v1_atual, T.copies().length);
      ok('o save principal continua intacto enquanto escolhe', T.readMain() === F.save_v1_atual && vis('charSelect'));
      document.querySelector('.charCard').click(); await gameReady();
      const main = T.mainState();
      ok('o jogo novo foi gravado (dia 1)', main.day === 1, main.day);
      ok('o contador rev continua a contagem do save anterior (outras abas veem a mudança)', main.rev === (orig.rev || 0) + 1, main.rev);
      ok('a cópia do jogo anterior continua lá, idêntica', T.copies().length === 1 && T.copies()[0].raw === F.save_v1_atual);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-falha'] = {       // o jogo novo NÃO consegue iniciar: o save antigo não pode ter sido apagado
    seed() { T.reset(); T.setMain(F.save_v1_atual); fastRaf(); Animals.spawn = () => { throw new Error('falha-simulada'); }; },
    async run() {
      await bootReady();
      $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100); document.querySelector('.charCard').click();
      await waitStart(() => /falha-simulada/.test($('loadTxt').textContent));
      ok('mostra o erro do jogo novo', /falha-simulada/.test($('loadTxt').textContent), $('loadTxt').textContent);
      ok('o jogo não iniciou', !window.__game);
      ok('o save antigo NÃO foi apagado', T.readMain() === F.save_v1_atual);
      ok('sem erros JS não tratados', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-pausa'] = {       // "Novo jogo" pelo menu de pausa (recarrega a página: o cenário roda duas vezes)
    seed() { if (sessionStorage.getItem('ran') === 'novo-jogo-pausa') return; T.reset(); T.setMain(F.save_v1_atual); },
    async run() {
      const orig = T.fixtureState('save_v1_atual');
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'novo-jogo-pausa') {
        sessionStorage.setItem('ran', 'novo-jogo-pausa');
        $('btnContinue').click(); await gameReady(); $('btnMenu').click(); await wait(50);
        $('modalBox').querySelector('button[data-a=resetask]').click(); await wait(50);
        ok('o texto promete a cópia', $('modalBox').textContent.includes('cópia de segurança'));
        $('modalBox').querySelector('button[data-a=reset]').click(); await wait(3000); return;
      }
      ok('o save principal foi apagado (vai começar do zero)', T.readMain() === null);
      const bk = T.copies().map(c => c.state).filter(Boolean);
      ok('o jogo anterior ficou numa cópia válida (mesmo dia)', bk.length === 1 && bk[0].day === orig.day, JSON.stringify(bk.map(b => b.day)));
      ok('a tela inicial oferece restaurar essa cópia', vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia ' + orig.day), $('btnSpRestore').textContent);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-sem-espaco'] = {  // a cópia não cabe (cota cheia): avisa, oferece baixar e só apaga se o jogador insistir
    seed() { T.reset(); T.setMain(F.save_v1_atual); fillStorage(); },
    async run() {
      await bootReady();
      ok('save válido carregou (Continuar visível)', vis('btnContinue'));
      $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100);
      ok('avisa que NÃO coube a cópia', $('confirmMsg').textContent.includes('Não foi possível guardar uma cópia'), $('confirmMsg').textContent);
      ok('botão vira "Apagar mesmo assim" e aparece "Baixar cópia"', $('btnYes').textContent === 'Apagar mesmo assim' && vis('btnNewDl'));
      ok('não avançou: confirmação ainda aberta, save intacto, nenhuma cópia', vis('confirmNew') && !vis('charSelect') && T.readMain() === F.save_v1_atual && T.copies().length === 0);
      $('btnNewDl').click(); await wait(100);
      $('btnYes').click(); await wait(100);
      ok('só com o 2º clique avança para a escolha do personagem', vis('charSelect'));
      document.querySelector('.charCard').click(); const G = await gameReady();
      ok('o jogo novo inicia', !!G.S && G.S.day === 1);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-rev'] = {
    seed() { T.reset(); const o = T.fixtureState('save_v1_atual'); o.rev = 7; T.setMainState(o); },
    async run() {
      await bootReady(); $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100); document.querySelector('.charCard').click(); await gameReady();
      const main = T.mainState();
      ok('jogo novo grava rev 8 (continua a contagem do save substituído)', main.day === 1 && main.rev === 8, main.day + '/' + main.rev);
    },
  };

  /* ---------- 7) R2: aba velha NÃO sobrescreve aba nova ---------- */
  S_['aba-velha'] = {
    seed() { T.reset(); T.setMain(F.save_v1_atual); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), S = G.S;
      const revs = []; let allOk = true;
      for (let i = 0; i < 4; i++) { allOk = G.save().ok && allOk; revs.push(T.mainState().rev); }
      ok('uso normal: 4 gravações seguidas, rev sobe 1 a 1, sem falso conflito', allOk && revs.join(',') === '1,2,3,4', revs.join(','));
      const myDay = S.day;
      // "a outra aba" joga e salva: rev maior, dia 9
      const other = T.mainState(); other.rev += 5; other.day = 9; other.gold = 9999;
      const otherRaw = JSON.stringify(other); T.setMain(otherRaw);
      let r = G.save(); ok('save() da aba velha é recusado com erro "Conflict"', r.ok === false && r.error && r.error.name === 'Conflict', r.error && r.error.name);
      window.dispatchEvent(new Event('pagehide')); G.save(true); G.save();
      ok('fechar/esconder a aba velha (pagehide) NÃO sobrescreve: save da outra aba intacto', T.readMain() === otherRaw);
      ok('a aba velha não gerou cópia à toa', T.copies().length === 0);
      steps(G, 5); await wait(100);
      ok('aparece o aviso "outra aba" com Recarregar e Usar esta aba', !$('modal').classList.contains('hidden') && $('modalBox').textContent.includes('outra aba') && !!$('modalBox').querySelector('button[data-a=stalereload]') && !!$('modalBox').querySelector('button[data-a=staleuse]'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(50);
      ok('Esc não fecha o aviso (senão o jogador seguiria jogando sem salvar)', !$('modal').classList.contains('hidden'));
      $('modalBox').querySelector('button[data-a=staleuse]').click(); await wait(100);
      ok('"Usar esta aba" guarda ANTES uma cópia do que a outra aba salvou', T.copies().some(c => c.raw === otherRaw));
      const mine = T.mainState();
      ok('...e passa a gravar o estado desta aba com rev maior', mine.day === myDay && mine.rev === other.rev + 1, mine.day + '/' + mine.rev);
      ok('avisa que esta aba assumiu', toasts().some(t => t.includes('Esta aba agora salva')), JSON.stringify(toasts()));
      ok('depois disso os saves normais voltam', G.save().ok && T.mainState().rev === other.rev + 2);
      // evento "storage" (outra aba gravou): esta aba vira velha na hora, sem nem tentar gravar
      const o2 = T.mainState(); o2.rev += 3; const raw2 = JSON.stringify(o2); T.setMain(raw2);
      T.fireStorage(raw2);
      r = G.save(); ok('evento storage: próximo save recusado e storage intocado', r.ok === false && r.error.name === 'Conflict' && T.readMain() === raw2);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  const staleVisible = () => !$('modal').classList.contains('hidden') && !!$('modalBox').querySelector('button[data-a=staleuse]');      // visível de verdade (closeModal só esconde; o botão antigo continua no DOM)
  /* N4 (2ª revisão adversarial): outra aba APAGOU o save ("Novo jogo" da pausa) — esta aba, que continua aberta, não pode ressuscitá-lo */
  S_['aba-apagada'] = {
    seed() { T.reset(); T.setMain(F.save_v1_atual); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady();
      ok('uso normal: grava', G.save().ok && T.readMain() !== null);
      T.removeMain();                                  // "a outra aba" apagou (sem evento storage nesta página)
      let r = G.save();
      ok('save() recusado com "Conflict" (não recria o save apagado)', r.ok === false && r.error && r.error.name === 'Conflict', JSON.stringify(r.ok) + ' ' + (r.error && r.error.name));
      window.dispatchEvent(new Event('pagehide')); G.save(true); G.save();
      ok('pagehide, Salvar e autosave também não o recriam', T.readMain() === null);
      steps(G, 5); await wait(100);
      ok('aparece o aviso com Recarregar e Usar esta aba', $('modalBox').textContent.includes('outra aba') && staleVisible());
      $('modalBox').querySelector('button[data-a=staleuse]').click(); await wait(100);
      ok('"Usar esta aba" recria o save de propósito (escolha do jogador) e os saves voltam', T.readMain() !== null && G.save().ok);
      // só o EVENTO storage (newValue null), sem nenhum save(): a aba já vira velha e avisa
      T.removeMain(); T.fireStorage(null);
      steps(G, 5);          // SÍNCRONO (sem esperar o loop real nem chamar save()): só o evento pode ter marcado a aba como velha
      ok('evento storage com newValue=null: aviso aparece sem precisar tentar salvar', staleVisible() && T.readMain() === null);
      $('modalBox').querySelector('button[data-a=staleuse]').click(); await wait(100);
      // "limpar dados do site" (storage event com key null)
      T.reset(); T.fireStorageClear();
      steps(G, 5);
      ok('limpar os dados do site (key null) também vira aviso', staleVisible() && T.readMain() === null);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* N2: `rev` fracionário/gigante/de tipo errado não pode gerar "Conflict" falso no 1º save (loadedRev e storedInfo usam a mesma normalização) */
  S_['rev-estranho'] = {
    seed() { T.reset(); const o = T.fixtureState('save_v1_atual'); o.rev = 5.5; T.setMainState(o); },
    async run() {
      await bootReady(); $('btnContinue').click(); await gameReady();
      const cases = [[5.5, 1], [1e13, 1e13 + 1], ['7', 1], [-3, 1], [null, 1], [7, 8]];
      let i = 0;
      for (const [rev, expected] of cases) {
        if (i++) { const o = T.fixtureState('save_v1_atual'); o.rev = rev; T.setMainState(o); window.__game.startGame(true); }
        const G = window.__game, r = G.save(), saved = T.mainState().rev;      // lê o rev JÁ (o autosave do jogo pode gravar de novo durante a espera abaixo)
        steps(G, 5); await wait(50);
        ok('rev=' + JSON.stringify(rev) + ': 1º save sem conflito e rev gravado = ' + expected, r.ok === true && saved === expected && !staleVisible(), JSON.stringify(r.ok) + ' ' + (r.error && r.error.name) + ' rev=' + saved);
      }
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* N1: a poda de cópias não descarta o save de versão FUTURA/desconhecida (progresso de um jogo mais novo) antes das cópias válidas */
  for (const [nm, bad] of [['poda-copia-futura', { v: 99, day: 12, gold: 5000 }], ['poda-copia-versao', { v: 0, day: 12, gold: 5000 }]]) S_[nm] = {
    seed() {
      T.reset();
      T.seedCopy(1000, JSON.stringify(bad));                                                  // a mais ANTIGA e "inválida" para este código
      T.seedCopy(2000, validSave(2, 20)); T.seedCopy(3000, validSave(3, 30));
      T.setMain(validSave(5, 50));
    },
    async run() {
      await bootReady();
      $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100);                               // "Novo jogo": a cópia do save atual é a 4ª → poda
      const cs = T.copies(), tss = cs.map(c => c.ts);
      ok('mantém só 3 cópias', cs.length === 3, tss.join(','));
      ok('a cópia do save de versão ' + (bad.v === 99 ? 'futura' : 'desconhecida') + ' SOBREVIVEU', T.copyRaw(1000) === JSON.stringify(bad), tss.join(','));
      ok('foi descartada a cópia VÁLIDA mais antiga (Dia 2), não a insubstituível', T.copyRaw(2000) === null, tss.join(','));
      ok('a válida mais recente (Dia 3) e a cópia do save atual (Dia 5) estão lá', T.copyRaw(3000) !== null && cs.some(c => c.raw === validSave(5, 50)), tss.join(','));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 8) R3: save "válido" porém hostil é corrigido, não trava o jogo ---------- */
  function hostile(mutate, check) {
    return {
      seed() { T.reset(); const s = T.fixtureState('save_v1_atual'); mutate(s); window.__hostileRaw = JSON.stringify(s); T.setMain(window.__hostileRaw); },
      async run() {
        const raw = window.__hostileRaw;
        await bootReady();
        ok('sem aviso de save inválido (é lido e corrigido)', !vis('saveProblem')); ok('Continuar visível', vis('btnContinue'));
        $('btnContinue').click(); const G = await gameReady(), S = G.S;
        ok('o jogo INICIOU', !!S);
        ok('cópia do ORIGINAL (hostil) guardada antes de corrigir', T.copies().length === 1 && T.copies()[0].raw === raw, T.copies().length);
        ok('avisa que houve dados inválidos corrigidos', toasts().some(t => t.includes('dados inválidos')), JSON.stringify(toasts()));
        ok('sem NaN/Infinity no estado', !hasNaN(S), hasNaN(S));
        steps(G, 80); ok('80 quadros sem erro de JS', !window.__errs.length, window.__errs.join('|'));
        ok('HUD sem "NaN"/"undefined"', !/NaN|undefined/.test($('hud').innerText), $('hud').innerText.slice(0, 100));
        check(G, S);
        G.endDay(false); steps(G, 20); ok('passa um dia sem erro', !window.__errs.length, window.__errs.join('|'));
        ok('regravar funciona e o JSON gravado não tem NaN', G.save().ok && !hasNaN(T.mainState()));
      },
    };
  }
  S_['hostil-estado'] = hostile(s => {
    s.tool = 99; s.goal = -1; s.selSeed = 'zzz'; s.energy = 'x'; s.water = 'x'; s.min = -50; s.px = 'abc'; s.dir = 77; s.laid = 'x'; s.rev = 'x';
    s.owned = { vaca: 4000, porco: 4000, cavalo: 4000 }; s.seeds.cenoura = -5; s.up.basket = 99; s.stat.till = -3; s.char = 'ninguem';
  }, (G, S) => {
    ok('tool dentro de 0..5 e goal dentro de 0..4', S.tool >= 0 && S.tool <= 5 && S.goal >= 0 && S.goal <= 4, S.tool + '/' + S.goal);
    ok('selSeed e char válidos', S.selSeed === 'cenoura' && S.char === 'fazendeiro', S.selSeed + '/' + S.char);
    ok('energia e água numéricas e dentro da faixa', S.energy === 100 && Number.isFinite(S.water) && S.water >= 0 && S.water <= 50, S.energy + '/' + S.water);
    ok('relógio dentro do dia (06:00..24:00)', S.min >= 360 && S.min <= 1440, S.min);
    ok('posição finita, dir 0..3, laid 1|2, rev inteiro', Number.isFinite(G.P.x) && Number.isFinite(G.P.y) && S.dir >= 0 && S.dir <= 3 && (S.laid === 1 || S.laid === 2) && Number.isInteger(S.rev), [G.P.x, S.dir, S.laid, S.rev]);
    ok('owned limitado ao máximo da loja (4/4/2) — nada de 8.000 animais', S.owned.vaca === 4 && S.owned.porco === 4 && S.owned.cavalo === 2 && G.Animals.list.length <= 11, JSON.stringify(S.owned) + ' animais=' + G.Animals.list.length);
    ok('sementes/melhoria/estatística negativas ou enormes viram valores válidos', S.seeds.cenoura === 0 && S.up.basket === 2 && S.stat.till === 0);
  });
  S_['hostil-estruturas'] = hostile(s => {
    s.obs = {}; s.obsInit = true; s.felled = {}; s.eggList = 'x'; s.digs = [[1, 2], ['a', 1], [999, 999], null]; s.truffleList = 5; s.soil[3] = 7; s.soil[4] = 'x'; s.milked = {}; s.meatDone = 'abc';
    s.crops = { '6,8': { t: 'milho', age: 2, pt: 1, pk: 'x' }, '7,8': { t: 'zzz', age: 1 }, 'a,b': { t: 'milho', age: 1 }, '9,9': { t: 'milho', age: 'x' }, '999,999': { t: 'milho', age: 1 }, '10,9': null };
  }, (G, S) => {
    ok('só a planta válida sobrou, sem pt/pk', JSON.stringify(Object.keys(S.crops)) === '["6,8"]' && JSON.stringify(S.crops['6,8']) === '{"t":"milho","age":2}', JSON.stringify(S.crops));
    ok('lista de obstáculos inválida => o mapa é regenerado (não fica vazio)', G.obs.length > 20, G.obs.length);
    ok('felled/eggList/truffleList/milked/meatDone viram arrays', ['felled', 'eggList', 'truffleList', 'milked', 'meatDone'].every(k => Array.isArray(S[k])));
    ok('digs: só o par válido sobrou', JSON.stringify(S.digs) === '[[1,2]]', JSON.stringify(S.digs));
    ok('chão só com 0/1/2', S.soil.every(v => v === 0 || v === 1 || v === 2) && S.soil.length === 46 * 34);
  });
  S_['hostil-crops-obs'] = hostile(s => {
    s.crops = null; s.obsInit = true;
    s.obs = [['rock', 1, 1, 0, 3], ['zzz', 1, 1, 0, 1], ['rock', 999, 999, 0, 3], 'x', null, ['ftree', 20, 12, 99, 6, 'x', 1, 2], ['bush', 1, 1, 0, 1], ['rock', 30, 12, 7, -5]];
  }, (G, S) => {
    ok('crops nulo vira {}', JSON.stringify(S.crops) === '{}', JSON.stringify(S.crops));
    ok('obstáculos: só os 3 válidos (tipo desconhecido, fora do mapa, lixo e tile repetido caem)', S.obs.length === 3, S.obs.length);
    const ft = S.obs.find(o => o[0] === 'ftree'), rk = S.obs.find(o => o[0] === 'rock' && o[1] === 30);
    ok('árvore: espécie 99 vira índice válido, idade "x" vira 0', ft && ft[3] >= 0 && ft[3] < 4 && ft[5] === 0, JSON.stringify(ft));
    ok('pedra: variação 7 vira 0..1 e hp negativo vira o padrão', rk && rk[3] >= 0 && rk[3] <= 1 && rk[4] === 3, JSON.stringify(rk));
  });
  S_['falha-inicio'] = {      // o save passa na leitura mas o jogo não consegue iniciá-lo: cópia + baixar, sem "recarregue"
    seed() { T.reset(); T.setMain(F.save_v1_atual); fastRaf(); Animals.spawn = () => { throw new Error('falha-simulada'); }; },
    async run() {
      await bootReady(); $('btnContinue').click();
      await waitStart(() => vis('saveProblem'));
      ok('aparece a caixa "Problema com o jogo salvo"', vis('saveProblem'));
      ok('explica que o save foi lido mas não iniciou, com o detalhe do erro', $('spMsg').textContent.includes('não conseguiu iniciá-lo') && $('spMsg').textContent.includes('falha-simulada'), $('spMsg').textContent);
      ok('NÃO manda "recarregar a página" (não resolveria)', !/Recarregue/.test($('spMsg').textContent + $('loadTxt').textContent), $('loadTxt').textContent);
      ok('oferece Baixar cópia', vis('btnSpExport'));
      ok('guardou uma cópia idêntica ao save', T.copies().length === 1 && T.copies()[0].raw === F.save_v1_atual);
      ok('o save original NÃO foi alterado', T.readMain() === F.save_v1_atual);
      $('btnSpExport').click(); await wait(100);
      ok('sem erros JS não tratados', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 5) gravador de fixtures (usado por tests/make-fixtures.js; não é um teste) ---------- */
  S_['gravar-fixture'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(1), S = G.S, A = G.Animals;       // 1 = Karen
      const modern = 'meat' in S;                                                     // o código atual tem carne/laid; o antigo não
      S.gold = 1234; S.earned = 2500; S.goal = 1; S.up.basket = 1; S.eggs = 4; S.stone = 3; S.wood = 5; S.milk = 2;
      S.seeds.tomate = 6; S.seeds.maca = 2; S.harvest.cenoura = 3;
      const own = modern ? { vaca: 3, porco: 4, cavalo: 2 } : { vaca: 2, porco: 2, cavalo: 1 };
      for (const k in own) { while (S.owned[k] < own[k]) { S.owned[k]++; A.add(k); } }
      for (let x = 6; x <= 13; x++) for (let y = 8; y <= 10; y++) {
        S.soil[y * G.MW + x] = 2; S.crops[x + ',' + y] = { t: x % 2 ? 'cenoura' : 'tomate', age: 1 + (x % 3) };
        if (!modern) { S.crops[x + ',' + y].pt = 3.25 + x; S.crops[x + ',' + y].pk = 'grow'; }   // o jogo antigo gravava isso
      }
      for (let i = 0; i < 3; i++) G.endDay(false);
      if (modern) { S.meat = 2; S.meatDone = [1, 2, 0]; }
      steps(G, 20); G.P.x = 9 * 64; G.P.y = 7 * 64;
      const r = G.save(); ok('gravou', r === undefined || r.ok === true);       // o save() antigo não devolvia nada
      data = { raw: T.readMain() };
    },
  };

  /* ---------- execução ---------- */
  const scenario = S_[name];
  async function main() {
    try {
      if (!scenario) throw new Error('cenário desconhecido: ' + name + ' (existem: ' + Object.keys(S_).join(', ') + ')');
      await scenario.run();
    } catch (e) { ok('EXCEÇÃO no cenário', false, e && e.stack || e); }
    const pre = document.createElement('pre'); pre.id = 'results'; pre.textContent = JSON.stringify({ tests, data }); document.body.appendChild(pre);
  }
  if (scenario && scenario.seed) { try { scenario.seed(); } catch (e) { ok('EXCEÇÃO no seed', false, e && e.stack || e); } }   // antes do boot do jogo
  main();
  window.__scenarioNames = Object.keys(S_);
})();
