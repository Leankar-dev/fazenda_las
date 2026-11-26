/* Cenários de teste que rodam DENTRO da página do jogo (injetados em uma cópia do index.html por tests/run.js).
   O cenário vem do hash da URL (#nome). Cada cenário tem seed() (roda ANTES do boot do jogo, ex.: preparar o localStorage)
   e run() (roda depois que o jogo carregou). O resultado vai para <pre id="results"> como JSON {tests, data}. */
(() => {
  'use strict';
  const name = location.hash.slice(1), F = window.FIXTURES || {};
  const tests = []; let data = null;

  /* =====================================================================================================================================
     T — acesso ao ARMAZENAMENTO, NEUTRO AO FORMATO. Os cenários não sabem em que chave nem em que formato o save mora: tudo passa por T.
     Hoje (Fase 1b): formato v2 — envelope com crc em `fazenda_las:v2:slot:1` (+ `:bak`, `:tmp`), cópias `fazenda_las:v2:copy:<ts>`, `meta`, `cfg` —
     e o LEGADO v1 (`fazenda_leankar_*`, `fazenda_elias_*`), que o jogo só LÊ. "Estado" = o objeto do jogo (S); "raw" = o texto gravado.
       T.reset()                       apaga TUDO do storage · T.snapshot()  texto com TODO o storage (igual antes e depois = nada foi gravado)
       — save principal (slot) —
       T.readMain() / T.mainState()    texto gravado / estado (dados + rev; null se não há save ou o texto não é JSON). O slot pode ter envelope v2 OU texto v1
       T.mainEnv() / T.mainSchema() / T.mainCrcOk()   o envelope (null se não for v2) · o schema (2; 1 se o slot tem o formato antigo) · o crc confere?
       T.setMain(raw) / T.setMainState(st) → raw   grava o slot (texto qualquer / envelope v2 válido com o rev de st.rev) — serve p/ simular "outra aba gravou"
       T.removeMain()                  apaga slot + bak + tmp ("outra aba apagou")
       T.setBak(raw) / T.readBak() / T.setTmp(raw) / T.readTmp()   versão anterior e escrita em andamento
       T.isMainKey(k)                  k é a chave do slot? (para contar gravações em Storage.prototype.setItem)
       — os 3 slots (Fase 1c; os helpers acima agem sempre no SLOT 1) —
       T.slotRaw(n) / T.slotState(n) / T.slotEnv(n)   texto / estado / envelope do slot n (1–3) · T.setSlot(n, raw) / T.setSlotState(n, st) → raw   grava no slot n
       T.removeSlot(n)                 apaga slot n + bak + tmp · T.lastSlot()   o último slot jogado (meta) ou null
       — cópias de segurança —
       T.copies()                      [{ key, ts, raw, state }], da mais antiga para a mais nova (ts 0 = a mais antiga possível)
       T.copyRaw(ts) / T.seedCopy(ts, raw)   (ts null = 0)
       — legado (formato v1, só leitura pelo jogo) —
       T.setLegacy(raw) / T.setLegacyState(obj) → raw / T.readLegacy()   save principal antigo (`fazenda_leankar_v1`)
       T.setElias(raw) / T.readElias()  save do nome antigo (`fazenda_elias_v1`) · T.setLegacyCopy(ts, raw) / T.readLegacyCopy(ts)  cópias antigas (ts null = sem data)
       T.setLegacyCfg(obj) / T.readLegacyCfg()   configuração de áudio antiga
       — resto —
       T.readCfg()                     configuração de áudio gravada ({music, sfx}) ou null · T.readMeta()  marcadores do legado
       T.fixtureState(nome, {raw})     estado (objeto) de uma fixture do tests/fixtures (v1: o próprio objeto; v2/v3: dados + rev), com o chão já no mapa de HOJE (raw:true = como está na fixture)
       T.validRaw(dia, ouro) / T.validLegacyRaw(dia, ouro)   TEXTO de um save mínimo válido (v2 / v1)
       T.fireStorage(raw)              dispara o evento "storage" do slot como se OUTRA aba o tivesse mudado (raw null = apagou) · T.fireStorageClear()  "limpar dados"
     ===================================================================================================================================== */
  const T = (() => {
    const SLOT = 'fazenda_las:v2:slot:1', BAK = SLOT + ':bak', TMP = SLOT + ':tmp', COPY = 'fazenda_las:v2:copy:', META = 'fazenda_las:v2:meta', CFG = 'fazenda_las:v2:cfg';
    const LEG = 'fazenda_leankar_v1', LEG_BK = LEG + '_backup', LEG_CFG = 'fazenda_leankar_cfg', ELIAS = 'fazenda_elias_v1';
    const MAGIC = 'fazenda_las-save';
    const parse = raw => { try { return JSON.parse(raw); } catch (e) { return null; } };
    const stateOf = raw => { const o = raw === null ? null : parse(raw); if (!o || typeof o !== 'object') return null; return o.magic === MAGIC ? Object.assign({}, o.data, { rev: o.rev }) : o; };
    const minimal = (day, gold) => ({ day, gold, min: 400, soil: new Array(SaveManager.WORLD.to[0] * SaveManager.WORLD.to[1]).fill(0), crops: {} });      // (chão do tamanho do mapa de hoje)
    const wrapState = (st, slot = 1) => {           // savedAt FIXO: o mesmo estado gera sempre o mesmo texto (semeado numa carga, comparado depois de recarregar a página)
      const d = Object.assign({}, st), rev = d.rev === undefined ? 0 : d.rev; delete d.rev; delete d.v;
      return JSON.stringify(Object.assign(SaveManager.format.wrap(d, slot, rev), { savedAt: '2026-01-01T00:00:00.000Z' }));
    };
    const SK = n => 'fazenda_las:v2:slot:' + n;
    const get = k => localStorage.getItem(k), set = (k, v) => localStorage.setItem(k, v);
    return {
      reset: () => localStorage.clear(),
      snapshot: () => JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])),      // TODO o storage, ordenado: "nada foi gravado" = snapshot igual
      isMainKey: k => k === SLOT,
      readMain: () => get(SLOT),
      mainState: () => stateOf(get(SLOT)),
      mainEnv: () => { const o = parse(get(SLOT)); return o && o.magic === MAGIC ? o : null; },
      mainSchema: () => { const r = get(SLOT); if (r === null) return null; const o = parse(r); return o && o.magic === MAGIC ? o.schema : (o && o.v) || null; },
      mainCrcOk: () => { const r = get(SLOT); return r !== null && SaveManager.format.inspect(r).ok; },
      setMain: raw => set(SLOT, raw),
      setMainState: st => { const raw = wrapState(st); set(SLOT, raw); return raw; },
      removeMain: () => { for (const k of [SLOT, BAK, TMP]) localStorage.removeItem(k); },
      slotRaw: n => get(SK(n)), slotState: n => stateOf(get(SK(n))), slotEnv: n => { const o = parse(get(SK(n))); return o && o.magic === MAGIC ? o : null; },
      setSlot: (n, raw) => set(SK(n), raw), setSlotState: (n, st) => { const raw = wrapState(st, n); set(SK(n), raw); return raw; },
      removeSlot: n => { for (const k of [SK(n), SK(n) + ':bak', SK(n) + ':tmp']) localStorage.removeItem(k); },
      lastSlot: () => { const m = parse(get(META)); return m ? m.lastSlot || null : null; },
      setBak: raw => set(BAK, raw), readBak: () => get(BAK), setTmp: raw => set(TMP, raw), readTmp: () => get(TMP),
      copies: () => Object.keys(localStorage).filter(k => k.startsWith(COPY))
        .map(k => { const raw = get(k); return { key: k, ts: +k.slice(COPY.length) || 0, raw, state: stateOf(raw) }; }).sort((a, b) => a.ts - b.ts),
      copyRaw: ts => get(COPY + (ts === null ? 0 : ts)),
      seedCopy: (ts, raw) => set(COPY + (ts === null ? 0 : ts), raw),
      setLegacy: raw => set(LEG, raw), setLegacyState: o => { const raw = JSON.stringify(o); set(LEG, raw); return raw; }, readLegacy: () => get(LEG),
      setElias: raw => set(ELIAS, raw), readElias: () => get(ELIAS),
      setLegacyCopy: (ts, raw) => set(ts === null ? LEG_BK : LEG_BK + '_' + ts, raw), readLegacyCopy: ts => get(ts === null ? LEG_BK : LEG_BK + '_' + ts),
      setLegacyCfg: o => set(LEG_CFG, JSON.stringify(o)), readLegacyCfg: () => { const r = get(LEG_CFG); return r === null ? null : parse(r); },
      readCfg: () => { const r = get(CFG); return r === null ? null : parse(r); },
      readMeta: () => { const r = get(META); return r === null ? null : parse(r); },
      // O estado de uma fixture, JÁ NO MAPA DE HOJE: as fixtures v1/v2 têm o chão do mapa antigo (46 × 34) e T.setMainState/T.setSlotState gravam envelope do schema atual, então o chão é remontado
      // aqui (mesma regra da migração 2→3). `{ raw: true }` devolve o estado como está na fixture (para testar a própria migração).
      fixtureState: (nome, opt) => { const st = stateOf(F[nome]); if (opt && opt.raw) return st; const [fw, fh] = SaveManager.WORLD.from, [tw, th] = SaveManager.WORLD.to;
        if (st && Array.isArray(st.soil) && st.soil.length === fw * fh) { const out = new Array(tw * th).fill(0); for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[y * tw + x] = st.soil[y * fw + x]; st.soil = out; }
        return st; },
      validRaw: (day, gold) => wrapState(minimal(day, gold)),
      validLegacyRaw: (day, gold) => JSON.stringify(Object.assign({ v: 1 }, minimal(day, gold))),
      fireStorage: raw => window.dispatchEvent(new StorageEvent('storage', { key: SLOT, newValue: raw, storageArea: localStorage })),
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
  async function gameReady(keepPaused) {
    let n = 0; while (!window.__game && n++ < 3000) await wait(100);
    if (!window.__game) throw new Error('jogo não iniciou: ' + window.__errs.join('|'));
    await wait(200);
    if (!keepPaused && !$('modal').classList.contains('hidden')) window.__game.closeModal();      // "Continuar" começa PAUSADO (menu aberto); os cenários jogam, então fecham o menu
    return window.__game;
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
  function loadable(fx, extra, opt = {}) {
    return {
      seed() { T.reset(); if (opt.main) T.setMain(F[fx]); else T.setLegacy(F[fx]); },
      async run() {
        const raw = F[fx], orig = opt.main ? T.fixtureState(fx) : JSON.parse(raw);
        await bootReady();
        ok('sem aviso de problema', !vis('saveProblem')); ok('Continuar visível', vis('btnContinue'));
        if (opt.main) ok('save principal (v2) intacto após o boot', T.readMain() === raw);
        else { ok('o legado (v1) continua INTACTO após o boot', T.readLegacy() === raw); ok('foi importado para o formato v2 (schema atual, crc confere, slot 1)', T.mainSchema() === SaveManager.SCHEMA && T.mainCrcOk() && T.mainEnv().slot === 1, T.mainSchema()); }
        ok('nenhuma cópia criada', T.copies().length === 0);
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
        ok('regravado: schema atual (crc ok), sem pt/pk, plantas preservadas', T.mainSchema() === SaveManager.SCHEMA && T.mainCrcOk() && !/"pt"|"pk"/.test(JSON.stringify(back.crops)) && (!orig.crops || Object.keys(back.crops).length === Object.keys(orig.crops).length));
        if (extra) await extra({ G, S: G.S, orig });
        ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
      },
    };
  }

  /* ---------- 2) saves que NÃO podem carregar: aviso, nada apagado, cópia, confirmação ---------- */
  function unloadable(fx, expectMsg, opt = {}) {
    return {
      seed() { T.reset(); const raw = typeof fx === 'string' && F[fx] !== undefined ? F[fx] : fx; if (opt.main) T.setMain(raw); else T.setLegacy(raw); },
      async run() {
        const read = opt.main ? T.readMain : T.readLegacy, raw = read();
        await bootReady();
        ok('aviso visível', vis('saveProblem')); ok('mensagem cita: ' + expectMsg, $('spMsg').textContent.includes(expectMsg), $('spMsg').textContent);
        ok('avisa que a cópia foi guardada', $('spMsg').textContent.includes('cópia de segurança foi guardada'));
        ok('Baixar visível, Restaurar escondido (não há cópia válida)', vis('btnSpExport') && !vis('btnSpRestore'));
        ok('Continuar escondido', !vis('btnContinue'));
        ok('o save NÃO foi alterado', read() === raw); if (!opt.main) ok('nenhum slot v2 foi criado para um legado inválido', T.readMain() === null);
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
  // formato v2 (envelope com crc) no slot
  S_['fixture-v2-ok'] = loadable('save_v2_ok', async () => { ok('o save v2 (mapa antigo) carregou migrado, sem importar nada do legado, e foi regravado no schema atual', T.readLegacy() === null && T.mainEnv().schema === SaveManager.SCHEMA); }, { main: true });
  S_['fixture-v2-truncado'] = unloadable('save_v2_truncado', 'corrompido', { main: true });
  S_['fixture-v2-crc'] = unloadable('save_v2_crc_errado', 'danificado', { main: true });
  S_['fixture-v2-futuro'] = unloadable('save_v2_futuro', 'mais nova', { main: true });
  // formato ATUAL (schema 3, mapa 64 × 49): gravado pelo jogo de hoje (tests/make-fixtures.js)
  S_['fixture-v3-ok'] = loadable('save_v3_ok', async () => { ok('o save do schema atual carregou sem migrar nada (world 3, chão do mapa novo)', T.readLegacy() === null && T.mainEnv().schema === SaveManager.SCHEMA && T.mainState().world === 3 && T.mainState().soil.length === SaveManager.WORLD.to[0] * SaveManager.WORLD.to[1]); }, { main: true });
  S_['fixture-v3-truncado'] = unloadable('save_v3_truncado', 'corrompido', { main: true });
  S_['fixture-v3-crc'] = unloadable('save_v3_crc_errado', 'danificado', { main: true });
  S_['fixture-v3-futuro'] = unloadable('save_v3_futuro', 'mais nova', { main: true });

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
      ok('2º clique restaurou: principal = a cópia válida (re-embrulhada: slot 1, rev 1, crc íntegro)', T.mainEnv() && T.mainEnv().data.day === 7 && T.mainEnv().data.gold === 777 && T.mainEnv().slot === 1 && T.mainEnv().rev === 1 && T.mainCrcOk(), JSON.stringify(T.mainEnv()));
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
      ok('principal = cópia restaurada (re-embrulhada: slot 1, rev 1, crc íntegro, data do jogo preservada)', T.mainEnv() && T.mainEnv().data.day === 7 && T.mainEnv().data.gold === 777 && T.mainEnv().slot === 1 && T.mainEnv().rev === 1 && T.mainCrcOk() && T.mainEnv().savedAt === '2026-01-01T00:00:00.000Z', JSON.stringify(T.mainEnv()));
      ok('o lixo anterior continua guardado numa cópia', T.copies().some(c => c.raw === '{lixo'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* PESCA no lago: sprites carregados, peixes DE VERDADE na água, doca andável e alcançável, margem sem árvores, 7ª ferramenta trancada até comprar a vara, loja com a aba Pesca,
     lançar → esperar → fisgar → pescar (energia e isca gastas, peixe sai do lago, entra no cesto/HUD), recolher cedo, trocar de ferramenta recolhe, comer (energia), vender (balança), novo dia repõe os peixes */
  S_['pesca-lago'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); $('btnNew').click(); await wait(200); document.querySelectorAll('.charCard')[0].click(); const G = await gameReady(), S = G.S, L = G.lake, D = G.DOCK;
      ok('todos os sprites de pesca carregaram (' + Pesca.SPRITES.length + ')', Pesca.SPRITES.every(n => G.PIMGS[n] && G.PIMGS[n].width > 8), Pesca.SPRITES.filter(n => !(G.PIMGS[n] && G.PIMGS[n].width > 8)).join(','));
      ok('o lago tem os peixes (' + Pesca.LAKE_TARGET + ') e todos estão BEM DENTRO da água', L && L.fish.length === Pesca.LAKE_TARGET && L.fish.every(f => G.deepWater(f.x, f.y)));
      ok('as 4 espécies existem no jogo e cada peixe nasce de uma delas', Pesca.FISH_KEYS.length === 4 && L.fish.every(f => Pesca.FISH[f.sp]));
      // os peixes são DESENHADOS a cada quadro; sem os óculos polarizados aparecem como silhueta (see=false), com eles coloridos (see=true)
      { const orig = Pesca.drawFish, seen = []; Pesca.drawFish = (g, lake, imgs, see) => { seen.push(see); return orig(g, lake, imgs, see); };
        G.P.x = (G.DOCK.x - 2) * 64; G.P.y = (G.DOCK.y + .5) * 64; steps(G, 6); const semOculos = seen.slice(); S.gear.oculos = 1; seen.length = 0; steps(G, 6); const comOculos = seen.slice(); S.gear.oculos = 0; Pesca.drawFish = orig;
        ok('os peixes são desenhados a cada quadro: silhueta sem óculos, coloridos com óculos polarizados', semOculos.length >= 6 && semOculos.every(v => v === false) && comOculos.length >= 6 && comOculos.every(v => v === true), JSON.stringify([semOculos.length, comOculos.length])); }
      const dockTiles = []; for (let x = D.x; x < D.x + D.w; x++) for (let y = D.y; y < D.y + D.h; y++) dockTiles.push([x, y]);
      ok('a doca (' + D.w + ' tiles) é andável: sem água e sem bloqueio', dockTiles.every(([x, y]) => !G.blocked(x, y)), JSON.stringify(dockTiles.filter(([x, y]) => G.blocked(x, y))));
      ok('o lago continua sólido ao lado da doca (leste) e nas margens norte/sul dela', G.blocked(D.x + D.w, D.y) && G.blocked(D.x + 1, D.y - 1) && G.blocked(D.x + 1, D.y + 1), '');
      const reach = (() => { const seen = new Set(['8,6']), q = [[8, 6]]; while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (nx < 0 || ny < 0 || nx >= G.MW || ny >= G.MH || seen.has(k) || G.blocked(nx, ny)) continue; seen.add(k); q.push([nx, ny]); } } return seen; })();
      ok('dá para chegar à ponta da doca a pé a partir do ponto de partida', reach.has((D.x + D.w - 1) + ',' + D.y), 'alcançáveis: ' + reach.size);
      const bad = []; for (let x = D.x - 4; x < D.x; x++) for (let y = D.y - 2; y <= D.y + 2; y++) if (G.blocked(x, y)) bad.push(x + ',' + y);      // (o galinheiro, em x=26-27, é uma estrutura sólida de verdade: fora da checagem)
      ok('a entrada da doca (4 tiles a oeste, ±2 de altura) não tem árvore, pedra nem mato', bad.length === 0, bad.join(' '));
      const slot = document.querySelectorAll('.slot')[6]; ok('a 7ª ferramenta (vara) existe na barra e está trancada (sem a vara)', !!slot && slot.classList.contains('locked') && /🔒/.test(slot.innerText), slot && slot.className);
      G.P.x = (D.x + D.w - .5) * 64; G.P.y = (D.y + .55) * 64; G.P.dir = 3; steps(G, 8); slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); ok('clicar no slot 7 seleciona a vara', S.tool === 6, S.tool);
      clearToasts(); G.fishStart(D.x + D.w, D.y); ok('sem vara: nada é lançado e o aviso manda comprar no empório', !G.cast && toasts().some(t => /Compre uma vara/.test(t)), toasts().join('|'));
      S.gold = 5000; G.openShop(); ok('a loja tem as abas Fazenda e Pesca', !!document.querySelector('[data-a=shoptab][data-k=pesca]') && !!document.querySelector('[data-a=shoptab][data-k=farm]'));
      document.querySelector('[data-a=shoptab][data-k=pesca]').click(); await wait(50);
      const rows = [...document.querySelectorAll('#modalBox .item')]; ok('a aba Pesca lista TODOS os ' + Pesca.GEAR.length + ' equipamentos, cada um com sprite e nome', rows.length === Pesca.GEAR.length && Pesca.GEAR.every(g => $('modalBox').innerHTML.includes(Pesca.spriteUrl(g.img)) && $('modalBox').innerText.includes(g.name)), rows.length);
      ok('a vara de fly e o carretel baitcast ficam travados até comprar o nível anterior', document.querySelector('[data-a=gear][data-k=rod2]').disabled && document.querySelector('[data-a=gear][data-k=reel2]').disabled);
      const g0 = S.gold; document.querySelector('[data-a=gear][data-k=rod1]').click(); await wait(50);
      ok('comprar a vara spinning: nível 1, cobra 150 ◎, slot destrancado', S.up.rod === 1 && S.gold === g0 - 150 && !document.querySelectorAll('.slot')[6].classList.contains('locked') && !document.querySelector('[data-a=gear][data-k=rod1]'), S.up.rod + ' ' + (g0 - S.gold));
      ok('depois da vara, a vara de fly libera', !document.querySelector('[data-a=gear][data-k=rod2]').disabled);
      document.querySelector('[data-a=gear][data-k=viva]').click(); await wait(30); ok('comprar isca viva: pacote de 5 (cobra 45)', S.bait.viva === 5 && S.gold === g0 - 150 - 45, S.bait.viva);
      document.querySelector('[data-a=shoptab][data-k=farm]').click(); await wait(30); ok('voltar à aba Fazenda mostra as sementes', /Sementes/.test($('modalBox').innerText)); G.closeModal();
      // pescar: uma perca (nunca se solta) perto da boia; os outros peixes longe
      const park = keep => { for (const f of L.fish) if (f !== keep) { f.x = 36 * 64; f.y = 12.6 * 64; f.mode = 'wander'; } };      // (36; 12,6) fica a ~5,8 tiles da boia (a boia cai perto de x=41): bem fora do alcance de 3,2 tiles      // afasta os OUTROS peixes (senão voltam a nadar para perto da boia e a espécie sorteada varia: teste instável)
      S.tool = 6; G.P.x = (D.x + D.w - .5) * 64; G.P.y = (D.y + .55) * 64; G.P.dir = 3; steps(G, 6);
      // a boia cai perto de x=41 (alcance da doca); o peixe testado fica ~1,6 tile dela, dentro do alcance de 3,2
      const fish = L.add('perca'); park(fish); fish.x = (D.x + D.w + 3.2) * 64; fish.y = (D.y + .5) * 64;
      const n0 = L.fish.length, e0 = S.energy, b0 = S.bait.viva; clearToasts(); G.fishStart(D.x + D.w, D.y);
      ok('lançar: a linha entra na água, gasta 1,2 de energia e 1 isca viva', !!G.cast && Math.abs(e0 - S.energy - 1.2) < .01 && S.bait.viva === b0 - 1, G.cast && G.cast.phase + ' ' + (e0 - S.energy) + ' ' + S.bait.viva);
      ok('a boia caiu na ÁGUA, para além da margem (a doca alcança mais)', G.deepWater(G.cast.bx, G.cast.by) && G.cast.bx > (D.x + D.w) * 64, G.cast.bx);
      let phase = ''; for (let i = 0; i < 400 && G.cast; i++) { steps(G, 1, .05); phase = G.cast ? G.cast.phase : 'none'; if (phase === 'bite') break; }
      ok('o peixe nada até a isca e MORDE (a boia afunda)', phase === 'bite', phase);
      ok('fisgar (espaço): vira a fase de recolher', G.fishPress() === true && G.cast.phase === 'fight', G.cast && G.cast.phase);
      for (let i = 0; i < 60 && G.cast; i++) steps(G, 1, .05);
      steps(G, 10, .05);      // o HUD (cesto) atualiza no quadro seguinte à captura
      ok('pescou: 1 perca no cesto de pesca, estatística e HUD; o peixe SAIU do lago; a linha foi recolhida', S.fish.perca === 1 && S.stat.fish === 1 && L.fish.length === n0 - 1 && !G.cast && /Perca-sol/.test($('bag').innerText) && toasts().some(t => /Perca-sol pescado/.test(t)), JSON.stringify(S.fish) + ' ' + L.fish.length + '/' + n0 + ' ' + toasts().join('|'));
      steps(G, 12); const f3 = L.add('perca'); f3.x = (D.x + D.w + 3.2) * 64; f3.y = (D.y + .5) * 64; park(f3); G.fishStart(D.x + D.w, D.y); for (let i = 0; i < 400 && G.cast && G.cast.phase !== 'bite'; i++) steps(G, 1, .05);
      G.interact(D.x + D.w, D.y); ok('a tecla E também fisga (com a linha na água, E não "enche o regador")', !!G.cast && G.cast.phase === 'fight', G.cast && G.cast.phase);
      for (let i = 0; i < 60 && G.cast; i++) steps(G, 1, .05); ok('...e o segundo peixe entra no cesto', S.fish.perca === 2 && S.stat.fish === 2, JSON.stringify(S.fish));
      steps(G, 12); const f2 = L.add('perca'); f2.x = (D.x + D.w + 3.2) * 64; f2.y = (D.y + .5) * 64; park(f2); G.fishStart(D.x + D.w, D.y); steps(G, 14, .05);
      ok('apertar cedo demais só recolhe a linha: sem peixe e sem erro', G.cast && G.cast.phase === 'wait' && G.fishPress() && !G.cast && S.fish.perca === 2);
      steps(G, 12); G.fishStart(D.x + D.w, D.y); steps(G, 4, .05); const hadCast = !!G.cast; document.querySelectorAll('.slot')[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      ok('trocar de ferramenta recolhe a linha (e solta o peixe atraído)', hadCast && !G.cast && L.fish.every(f => f.mode !== 'attract'), S.tool);
      S.tool = 6; steps(G, 12); G.fishStart(D.x + D.w, D.y); const lancou = !!G.cast; G.P.x -= 80; steps(G, 3);
      ok('andar para longe do lugar em que lançou recolhe a linha', lancou && !G.cast);
      S.energy = 40; S.fish.perca = 2; S.fish.achiga = 1; G.openEatFish(); ok('"Comer peixe" lista os peixes do cesto com a energia de cada um', /Perca-sol/.test($('modalBox').innerText) && /Achigã/.test($('modalBox').innerText) && /Recupera 12/.test($('modalBox').innerText) && /Recupera 32/.test($('modalBox').innerText), $('modalBox').innerText.slice(0, 120));
      document.querySelector('[data-a=eatfish][data-k=perca]').click(); await wait(30); ok('comer uma perca: +12 de energia e o peixe sai do cesto', S.energy === 52 && S.fish.perca === 1, S.energy + ' ' + S.fish.perca);
      S.energy = 90; G.closeModal(); G.openEatFish(); document.querySelector('[data-a=eatfish][data-k=achiga]').click(); await wait(30); ok('o ganho de energia nunca passa de 100 (90 + 32 → 100)', S.energy === 100 && S.fish.achiga === 0, S.energy); G.closeModal();
      S.fish.perca = 3; S.fish.bagre = 1; S.gear.balanca = 1; const g1 = S.gold; G.sellAll();
      ok('vender na caixa: peixes entram na conta com +20% da balança (3×12 + 1×31)', S.gold - g1 === 3 * 12 + 31 && Pesca.fishCount(S) === 0, (S.gold - g1) + ' ' + JSON.stringify(S.fish));
      L.fish.length = 0; G.endDay(false); ok('um novo dia repõe o lago até o alvo', L.fish.length === Pesca.LAKE_TARGET, L.fish.length);
      S.fish.perca = Pesca.fx(S).capacity; clearToasts(); S.tool = 6; G.P.x = (D.x + D.w - .5) * 64; G.P.y = (D.y + .55) * 64; G.P.dir = 3; steps(G, 6); G.fishStart(D.x + D.w, D.y);
      ok('cesto de pesca cheio: não lança e avisa', !G.cast && toasts().some(t => /Cesto de pesca cheio/.test(t)), toasts().join('|'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* save: o estado da pesca vai e volta; save HOSTIL não cria peixes demais nem quebra */
  S_['pesca-save'] = {
    seed() { T.reset(); const st = T.fixtureState('save_v1_atual'); Object.assign(st, { fish: { perca: 1e9, achiga: -4, bagre: 'x', crappie: 3.9, fantasma: 7 }, gear: { oculos: 5, popper: 'sim', inventado: 1 }, bait: { cera: 5000, viva: null }, up: Object.assign({}, st.up, { rod: 99, reel: -2 }) }); st.stat = Object.assign({}, st.stat, { fish: 'muitos' }); T.setMainState(st); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), S = G.S;
      ok('save hostil: peixes limitados (999 máx., sem negativos nem texto), chaves desconhecidas somem', S.fish.perca === 999 && S.fish.achiga === 0 && S.fish.bagre === 0 && S.fish.crappie === 3 && !('fantasma' in S.fish), JSON.stringify(S.fish));
      ok('save hostil: acessórios 0/1, iscas ≤ 99, vara ≤ 2, carretel ≥ 0, estatística numérica', S.gear.oculos === 1 && S.gear.popper === 0 && !('inventado' in S.gear) && S.bait.cera === 99 && S.bait.viva === 0 && S.up.rod === 2 && S.up.reel === 0 && S.stat.fish === 0, JSON.stringify([S.gear, S.bait, S.up, S.stat.fish]));
      ok('o jogo não quebrou com o save hostil (sem NaN, sem erro)', !hasNaN(S) && !window.__errs.length, hasNaN(S) + ' ' + window.__errs.join('|'));
      S.fish = { perca: 2, crappie: 0, bagre: 1, achiga: 0 }; S.gear.chapeu = 1; S.up.rod = 2; S.up.reel = 1; S.bait.cera = 7; S.stat.fish = 5; const r = G.save();
      const back = T.mainState(); ok('salvar grava peixes, acessórios, iscas, vara e carretel', r.ok && back.fish.perca === 2 && back.fish.bagre === 1 && back.gear.chapeu === 1 && back.up.rod === 2 && back.up.reel === 1 && back.bait.cera === 7 && back.stat.fish === 5, JSON.stringify([back.fish, back.gear.chapeu, back.up, back.bait]));
    },
  };

  /* Os DOIS personagens com sprite sheet (walk_sheet.png: 5 quadros x 4 direções): a sheet carrega e é fatiada em 20 quadros com pés na base; o chapéu aparece em todos os quadros
     do laço (a fazendeira de costas ganhou o chapéu por composição; o quadro sem chapéu do fazendeiro fica fora); o ciclo percorre o `loop` na ordem; parado usa o repouso; o cavaleiro,
     o retrato e as ferramentas carregam; trocar de personagem restaura as imagens certas */
  S_['personagens-sprites'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); $('btnNew').click(); await wait(200); document.querySelectorAll('.charCard')[0].click(); const G = await gameReady(), DIRS = ['down', 'up', 'left', 'right'];
      const info = f => {      // pixels visíveis: contagem, base (pés), centro de massa do TRONCO (60% de cima), borda tocada, palha do chapéu (topo) e hash
        const w = f.width, h = f.height, d = f.getContext('2d').getImageData(0, 0, w, h).data; let n = 0, y1 = -1, tn = 0, tx = 0, edge = 0, hash = 0, y0 = h, straw = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 40) { n++; y1 = Math.max(y1, y); y0 = Math.min(y0, y); if (x < 2 || x >= w - 2) edge++; hash = (hash * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0; } }
        for (let y = y0; y < y0 + (y1 - y0) * .6; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { tn++; tx += x; }
        for (let y = y0; y < y0 + (y1 - y0) * .2; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2]; if (d[i + 3] > 200 && gg > .74 * r && r - b > 45 && r > 140) straw++; }
        return { n, y1, h: y1 - y0 + 1, cx: tx / tn, edge, hash, straw };
      };
      for (const id of ['fazendeiro', 'fazendeira']) {
        G.setCharacter(id); const I = G.IMGS, W = G.WALKERS[id], tag = id + ': ';
        ok(tag + 'a sheet foi fatiada em 20 quadros (4 direções x 5) e o personagem é o certo', G.CHAR.id === id && !!I.walk && DIRS.every(d => I.walk[d] && I.walk[d].length === W.cols));
        const all = DIRS.flatMap(d => I.walk[d].map((f, i) => Object.assign(info(f), { d, i })));
        ok(tag + 'todos os quadros têm o personagem (pixels visíveis)', all.every(q => q.n > 3000), JSON.stringify(all.filter(q => q.n <= 3000)));
        ok(tag + 'os pés ficam na base da célula (alinhados ao chão)', all.every(q => q.y1 >= 167 && q.y1 <= 170), JSON.stringify(all.map(q => q.y1)));
        ok(tag + 'o tronco fica no centro da célula (±6 px) e nada encosta nas bordas: a fatia está na grade certa', all.every(q => Math.abs(q.cx - 56) < 6 && q.edge === 0), JSON.stringify(all.map(q => Math.round(q.cx) + '/' + q.edge)));
        const inLoop = all.filter(q => W.loop[q.d].includes(q.i));
        ok(tag + 'a altura é a MESMA nas 4 direções (±4 px) nos quadros do laço: não encolhe ao virar', Math.max(...inLoop.map(q => q.h)) - Math.min(...inLoop.map(q => q.h)) <= 5 && inLoop.every(q => Math.abs(q.h - W.ref) <= 4), JSON.stringify(inLoop.map(q => q.d[0] + q.h)));
        ok(tag + 'o CHAPÉU aparece em todos os quadros do laço, nas 4 direções (de costas também)', inLoop.every(q => q.straw >= 25), JSON.stringify(inLoop.filter(q => q.straw < 25).map(q => q.d + q.i + ':' + q.straw)));
        ok(tag + 'as 4 direções são DIFERENTES entre si', new Set(all.filter(q => q.i === W.idle[q.d]).map(q => q.hash)).size === 4);
        ok(tag + 'os quadros do laço de cada direção são todos DIFERENTES (nenhum repetido)', DIRS.every(d => new Set(W.loop[d].map(i => all.find(q => q.d === d && q.i === i).hash)).size === W.loop[d].length));
        // desenho: espia as imagens desenhadas (os quadros são canvas 112x172)
        const proto = CanvasRenderingContext2D.prototype, draw0 = proto.drawImage, seen = []; proto.drawImage = function (img, ...a) { if (img && img.width === 112 && img.height === 172) seen.push(img); return draw0.call(this, img, ...a); };
        const frameDrawn = (dir, wk, walkT) => { seen.length = 0; G.P.dir = dir; G.P.wk = wk; G.P.walkT = walkT; G.P.moving = wk > 0; G.step(.0001); return seen[seen.length - 1]; };
        G.S.min = 12 * 60; G.P.x = 8.5 * 64; G.P.y = 8.5 * 64;
        const T8 = 2 * Math.PI / 8, order = (dir, name) => { const n = W.loop[name].length, out = []; for (let j = 0; j < 2 * n; j++) out.push(I.walk[name].indexOf(frameDrawn(dir, 1, (j + .5) / (2 * n) * T8))); return out; };
        ok(tag + 'andando para a direita o ciclo percorre os quadros do laço, NA ORDEM (' + W.loop.right.join(',') + ')', JSON.stringify(order(3, 'right')) === JSON.stringify(W.loop.right.flatMap(i => [i, i])), JSON.stringify(order(3, 'right')));
        ok(tag + 'andando para cima usa só os quadros do laço de costas (' + W.loop.up.join(',') + ')', JSON.stringify([...new Set(order(1, 'up'))]) === JSON.stringify(W.loop.up));
        for (const d of [0, 1, 2, 3]) ok(tag + 'parado olhando ' + DIRS[d] + ' usa o quadro de repouso', frameDrawn(d, 0, 1.3) === I.walk[DIRS[d]][W.idle[DIRS[d]]]);
        proto.drawImage = draw0;
        ok(tag + 'retrato de frente (front.png) e imagens do cavaleiro existem; ferramentas carregaram', I.front_walk && I.front_walk.height > 250 && I.back && I.left_stand && I.back.height > 100 && ['basket', 'glove1', 'glove2', 'pickaxe', 'pitchfork', 'seedbag_empty'].every(k => I[k] && I[k].width > 5));
        ok(tag + 'o desenho antigo (4 corpos estáticos) não existe mais', !I.front_stand && !I.left34);
        const A = G.Animals; G.S.owned.cavalo = 1; const h = A.add('cavalo'); G.P.x = h.x + 70; G.P.y = h.y; A.mount(h);
        for (const d of [0, 1, 2, 3]) { G.P.dir = d; steps(G, 6); } A.dismount();
        ok(tag + 'montado, nas 4 direções: desenha sem erro', !window.__errs.length, window.__errs.join('|'));
      }
      G.setCharacter('fazendeiro');
      ok('trocar de personagem restaura as imagens do certo (o retrato é outro) e desenhar os dois não dá erro', G.IMGS.front_walk.width !== (G.setCharacter('fazendeira'), G.IMGS.front_walk.width) && (G.setCharacter('fazendeiro'), G.CHAR.id === 'fazendeiro') && !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* Casa principal (assets/casa.png no lugar do celeiro procedural): é desenhada no lugar certo e no tamanho certo; continua sólida; a porta (linha 4, colunas 7-9) dorme só depois
     das 18:00; à noite as janelas acendem (8 luzes) e de dia não */
  S_['casa-principal'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); $('btnNew').click(); await wait(200); document.querySelectorAll('.charCard')[0].click(); const G = await gameReady();
      ok('o celeiro procedural não existe mais (Art.barn)', typeof Art.barn === 'undefined');
      const proto = CanvasRenderingContext2D.prototype, draw0 = proto.drawImage, grad0 = proto.createRadialGradient, calls = [], grads = [];
      proto.drawImage = function (img, ...a) { if (img && img.width === 604 && img.height === 480) calls.push(a); return draw0.call(this, img, ...a); };
      proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { grads.push([x1, y1, r1]); return grad0.call(this, x0, y0, r0, x1, y1, r1); };
      G.S.min = 12 * 60; G.P.x = 8.5 * 64; G.P.y = 6.2 * 64; steps(G, 6);
      ok('a casa é desenhada (casa.png 604x480) no tamanho 403x320, centrada no bloco 7x5 (x=343, px INTEIRO) com a base em y=320', calls.length > 0 && calls.every(c => c.length === 4 && c[0] === 343 && c[1] === 0 && c[2] === 403 && c[3] === 320), JSON.stringify(calls.slice(0, 2)));
      ok('de dia não há luzes de janela', !grads.some(g => g[2] === 46), grads.length);
      grads.length = 0; G.S.min = 21 * 60 + 30; steps(G, 10);
      const win = grads.filter(g => g[2] === 46); ok('à noite as 8 janelas acendem (e a porta tem o seu brilho)', win.length >= 8 && grads.some(g => g[2] === 80), win.length + ' / ' + grads.length);
      ok('as luzes estão sobre a casa (x 343..746, y 0..320)', win.every(g => g[0] > 343 && g[0] < 746 && g[1] > 0 && g[1] < 320), JSON.stringify(win.slice(0, 3)));
      proto.drawImage = draw0; proto.createRadialGradient = grad0;
      ok('o bloco da casa é sólido (cantos e porta) e o caminho em frente é livre', [[5, 0], [11, 0], [5, 4], [11, 4], [8, 4], [8, 2]].every(([x, y]) => G.blocked(x, y)) && !G.blocked(8, 5), '');
      G.S.min = 12 * 60; G.P.x = 8.5 * 64; G.P.y = 5.6 * 64; G.P.dir = 1; steps(G, 4);
      const t = G.facingTile(); ok('de frente para a casa o alvo é a porta (tile 8,4)', t && t[0] === 8 && t[1] === 4, JSON.stringify(t));
      clearToasts(); G.interact(8, 4); ok('antes das 18:00 não dorme: só o aviso, sem confirmação', toasts().some(x => /18:00/.test(x)) && $('modal').classList.contains('hidden'), toasts().join('|'));
      G.S.min = 19 * 60; G.interact(8, 4); await wait(100); ok('depois das 18:00 a porta abre a confirmação de dormir', !$('modal').classList.contains('hidden') && /Dormir/.test($('modal').innerText), $('modal').innerText.slice(0, 60));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* Cavalo animado (sprite sheet walk_sheet.png: 5 quadros x 4 direções): a sheet carrega e é fatiada em 20 quadros com pés na base; o ciclo avança andando e volta ao
     repouso parado; montado e solto, nas 4 direções, desenha sem erro; o ícone da loja (busto) carrega */
  S_['cavalo-sprites'] = {
    seed() { T.reset(); const st = T.fixtureState('save_v1_atual'); st.owned = { vaca: 0, porco: 0, cavalo: 2 }; T.setMainState(st); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), A = G.Animals, im = A.IMGS.cavalo, DIRS = ['down', 'up', 'left', 'right'];
      ok('a sheet carregou inteira (920 x 640)', !!im.sheet && im.sheet.width === 920 && im.sheet.height === 640, im.sheet && im.sheet.width + 'x' + im.sheet.height);
      ok('20 quadros: 4 direções x 5', !!im.walk && DIRS.every(d => im.walk[d] && im.walk[d].length === 5));
      const info = f => {      // massa de pixels visíveis: contagem, base (pés), centro de massa em x e para que lado a CABEÇA aponta (topo mais à direita/esquerda do centro)
        const w = f.width, h = f.height, d = f.getContext('2d').getImageData(0, 0, w, h).data; let n = 0, y0 = h, y1 = -1, sx = 0, hash = 0, edge = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 40) { n++; y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; hash = (hash * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0; if (x < 3 || x >= w - 3) edge++; } }
        const cx = sx / n; let tn = 0, tx = 0; for (let y = y0; y < y0 + (y1 - y0) * .3; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { tn++; tx += x; }
        return { n, y1, cx, hash, edge, head: tn ? tx / tn - cx : 0 };
      };
      const all = DIRS.flatMap(d => im.walk[d].map((f, i) => Object.assign(info(f), { d, i })));
      ok('todos os quadros têm o cavalo (pixels visíveis)', all.every(q => q.n > 2000), JSON.stringify(all.filter(q => q.n <= 2000)));
      ok('os pés ficam na base da célula (alinhados ao chão)', all.every(q => q.y1 >= 155 && q.y1 <= 158), JSON.stringify(all.map(q => q.y1)));
      ok('o centro de massa fica no centro da célula (±4 px) e nada encosta nas bordas: a fatia está na grade certa', all.every(q => Math.abs(q.cx - 92) < 4 && q.edge === 0), JSON.stringify(all.map(q => Math.round(q.cx) + '/' + q.edge)));
      ok('direita: a cabeça aponta para a DIREITA; esquerda: para a ESQUERDA (linhas não trocadas)', all.filter(q => q.d === 'right').every(q => q.head > 15) && all.filter(q => q.d === 'left').every(q => q.head < -15), JSON.stringify(all.filter(q => q.d === 'right' || q.d === 'left').map(q => q.d[0] + Math.round(q.head))));
      ok('as 4 direções são DIFERENTES entre si (cada linha tem a sua arte)', new Set(all.filter(q => q.i === 0).map(q => q.hash)).size === 4);
      ok('os 5 quadros de cada direção são DIFERENTES (é uma animação, não um quadro repetido)', DIRS.every(d => new Set(all.filter(q => q.d === d).map(q => q.hash)).size === 5));
      const h = A.horse; ok('há um cavalo no curral', !!h && h.kind === 'cavalo');
      h.moving = false; A.update(.05, G.S); ok('parado: fase do ciclo em 0 (quadro de repouso)', h.wp === 0, h.wp);
      h.moving = true; h.tx = h.x + 400; h.ty = h.y; for (let i = 0; i < 5; i++) A.update(.1, G.S);
      ok('andando: a fase avança com o tempo (5 quadros/s → ~2,5 em 0,5 s)', h.wp > 2.2 && h.wp < 2.8, h.wp);
      h.moving = false; A.update(.05, G.S); ok('parou: volta ao repouso', h.wp === 0, h.wp);
      for (const d of [0, 1, 2, 3]) { h.dir = d; h.moving = d % 2 === 0; h.tx = h.x + 50; h.ty = h.y; steps(G, 6); }
      ok('solto, nas 4 direções (parado e andando): desenha sem erro', !window.__errs.length, window.__errs.join('|'));
      G.P.x = h.x + 70; G.P.y = h.y; ok('montar funciona', A.mount(h) && A.isRiding());
      for (const d of [0, 1, 2, 3]) { G.P.dir = d; steps(G, 8); }
      ok('montado, nas 4 direções: desenha sem erro', !window.__errs.length, window.__errs.join('|'));
      // o ciclo desenhado (cavalo solto, andando para a direita, ao lado do jogador): percorre exatamente o `loop` (o 5º quadro repetido de lado fica de fora); parado usa o repouso
      A.dismount(); h.x = 36 * 64; h.y = 22 * 64; G.P.x = h.x - 90; G.P.y = h.y; steps(G, 40);      // dentro do curral (fora dele o cavalo solto não anda)      // a câmera acompanha o jogador: dá quadros para o cavalo entrar na tela
      const pr = CanvasRenderingContext2D.prototype, dr0 = pr.drawImage, got = []; pr.drawImage = function (img, ...a) { if (img && img.width === 184 && img.height === 160) got.push(img); return dr0.call(this, img, ...a); };
      const horseFrame = (wp, moving) => { got.length = 0; for (const o of A.list) if (o.kind === 'cavalo' && o !== h) { o.dir = 0; o.moving = false; o.wait = 99; } h.dir = 3; h.moving = moving; h.tx = 42 * 64; h.ty = 22 * 64; h.wait = 99; h.wp = wp; G.step(.05); const idx = Math.max(...got.map(c => im.walk.right.indexOf(c))); if (idx < 0) horseFrame.dbg = JSON.stringify({ drawn: got.length, dir: h.dir, moving: h.moving, x: Math.round(h.x), y: Math.round(h.y), px: Math.round(G.P.x), cam: [Math.round(G.cam.x), Math.round(G.cam.y)] }); return idx; };
      const seq = []; for (let k = 0; k < 8; k++) seq.push(horseFrame(k + .1, true));
      ok('andando para a direita: percorre os 4 quadros do laço, na ordem e repetindo (0,1,2,3,0,1,2,3)', seq.join(',') === '0,1,2,3,0,1,2,3', seq.join(',') + ' ' + (horseFrame.dbg || ''));
      ok('parado: usa o quadro de repouso da direção (pernas juntas)', horseFrame(0, false) === 2, horseFrame(0, false));
      pr.drawImage = dr0;
      ok('desmontar funciona', !A.isRiding());
      G.openShop(); await wait(400); const ic = [...document.querySelectorAll('.item img')].find(i => /cavalo\/icon\.png/.test(i.src));
      ok('a loja mostra o ícone do cavalo (busto 96x96)', !!ic && ic.complete && ic.naturalWidth === 96 && ic.naturalHeight === 96, ic && ic.naturalWidth);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* Fase 2: o MOTIVO da cópia aparece no botão "Restaurar", e restaurar uma cópia que veio de OUTRO slot grava no slot selecionado (slot do envelope = o do destino) */
  S_['restaurar-motivo-slot'] = {
    seed() {
      if (sessionStorage.getItem('ran') === 'restaurar-motivo-slot') return;
      T.reset(); T.seedCopy(5000, JSON.stringify(Object.assign(JSON.parse(validSave(6, 66)), { slot: 3, rev: 4 })));      // cópia de um jogo do slot 3 (o crc é só do `data`)
      localStorage.setItem('fazenda_las:v2:why:5000', 'deleted'); T.setMain('{lixo');
    },
    async run() {
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'restaurar-motivo-slot') {
        sessionStorage.setItem('ran', 'restaurar-motivo-slot');
        ok('o botão mostra o dia e o MOTIVO (foi apagado)', vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia 6') && $('btnSpRestore').textContent.includes('foi apagado'), $('btnSpRestore').textContent);
        sessionStorage.setItem('first', '1'); $('btnSpRestore').click(); await wait(3000); return;
      }
      const e = T.mainEnv();
      ok('a cópia (slot 3, rev 4) foi gravada no slot 1 como slot 1, rev 5', e && e.slot === 1 && e.rev === 5 && e.data.day === 6 && T.mainCrcOk(), JSON.stringify(e));
      ok('o slot 3 não foi tocado', T.slotRaw(3) === null);
      ok('Continuar visível e sem aviso', vis('btnContinue') && !vis('saveProblem'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- configuração de áudio (música/efeitos) sobrevive ao recarregar. Recarrega a página: o cenário roda duas vezes ---------- */
  S_['cfg-audio'] = {
    seed() { if (sessionStorage.getItem('ran') === 'cfg-audio') return; T.reset(); },
    async run() {
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'cfg-audio') {
        sessionStorage.setItem('ran', 'cfg-audio');
        ok('1ª carga: música e efeitos ligados por padrão', $('btnMusic').textContent === '🎵' && $('btnMute').textContent === '🔊', $('btnMusic').textContent + $('btnMute').textContent);
        $('btnMusic').click(); $('btnMute').click();
        const c = T.readCfg();
        ok('desligar grava a configuração (music e sfx = false)', c && c.music === false && c.sfx === false, JSON.stringify(c));
        sessionStorage.setItem('first', JSON.stringify(tests));
        location.reload(); await wait(5000); return;
      }
      for (const t of JSON.parse(sessionStorage.getItem('first') || '[]')) tests.push(t);
      ok('depois de recarregar: música e efeitos continuam DESLIGADOS', $('btnMusic').textContent === '🔕' && $('btnMute').textContent === '🔇', $('btnMusic').textContent + $('btnMute').textContent);
      const c = T.readCfg(); ok('a configuração gravada continua igual', c && c.music === false && c.sfx === false, JSON.stringify(c));
      $('btnMusic').click(); ok('religar grava music = true', T.readCfg().music === true, JSON.stringify(T.readCfg()));
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
      ok('o save anterior continua legível (a falha não corrompeu nada)', T.mainCrcOk());
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
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); },
    async run() {
      const orig = T.fixtureState('save_v1_atual');
      await bootReady(); const before = T.readMain();
      $('btnNew').click(); await wait(100);
      ok('pede confirmação e promete a cópia de segurança', vis('confirmNew') && $('confirmMsg').textContent.includes('cópia de segurança'), $('confirmMsg').textContent);
      $('btnYes').click(); await wait(100);
      ok('a cópia já existe ANTES de escolher o personagem (idêntica ao save)', T.copies().length === 1 && T.copies()[0].raw === before, T.copies().length);
      ok('o save principal continua intacto enquanto escolhe', T.readMain() === before && vis('charSelect'));
      document.querySelector('.charCard').click(); await gameReady();
      const main = T.mainState();
      ok('o jogo novo foi gravado (dia 1)', main.day === 1, main.day);
      ok('o contador rev continua a contagem do save anterior (outras abas veem a mudança)', main.rev === (orig.rev || 0) + 1, main.rev);
      ok('a cópia do jogo anterior continua lá, idêntica', T.copies().length === 1 && T.copies()[0].raw === before);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-falha'] = {       // o jogo novo NÃO consegue iniciar: o save antigo não pode ter sido apagado
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); fastRaf(); Animals.spawn = () => { throw new Error('falha-simulada'); }; },
    async run() {
      await bootReady(); const before = T.readMain();
      $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100); document.querySelector('.charCard').click();
      await waitStart(() => /falha-simulada/.test($('loadTxt').textContent));
      ok('mostra o erro do jogo novo', /falha-simulada/.test($('loadTxt').textContent), $('loadTxt').textContent);
      ok('o jogo não iniciou', !window.__game);
      ok('o save antigo NÃO foi apagado', T.readMain() === before);
      ok('sem erros JS não tratados', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-pausa'] = {       // "Novo jogo" pelo menu de pausa (recarrega a página: o cenário roda duas vezes)
    seed() { if (sessionStorage.getItem('ran') === 'novo-jogo-pausa') return; T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); },
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
      ok('o save principal foi apagado (vai começar do zero) — slot, bak e tmp', T.readMain() === null && T.readBak() === null && T.readTmp() === null);
      const bk = T.copies().map(c => c.state).filter(Boolean);
      ok('o jogo anterior ficou numa cópia válida (mesmo dia)', bk.length === 1 && bk[0].day === orig.day, JSON.stringify(bk.map(b => b.day)));
      ok('a tela inicial oferece restaurar essa cópia', vis('btnSpRestore') && $('btnSpRestore').textContent.includes('Dia ' + orig.day), $('btnSpRestore').textContent);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-sem-espaco'] = {  // a cópia não cabe (cota cheia): avisa, oferece baixar e só apaga se o jogador insistir
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); fillStorage(); },
    async run() {
      await bootReady(); const before = T.readMain();
      ok('save válido carregou (Continuar visível)', vis('btnContinue'));
      $('btnNew').click(); await wait(100); $('btnYes').click(); await wait(100);
      ok('avisa que NÃO coube a cópia', $('confirmMsg').textContent.includes('Não foi possível guardar uma cópia'), $('confirmMsg').textContent);
      ok('botão vira "Apagar mesmo assim" e aparece "Baixar cópia"', $('btnYes').textContent === 'Apagar mesmo assim' && vis('btnNewDl'));
      ok('não avançou: confirmação ainda aberta, save intacto, nenhuma cópia', vis('confirmNew') && !vis('charSelect') && T.readMain() === before && T.copies().length === 0);
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
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), S = G.S;
      const revs = []; let allOk = true;
      for (let i = 0; i < 4; i++) { allOk = G.save().ok && allOk; revs.push(T.mainState().rev); }
      ok('uso normal: 4 gravações seguidas, rev sobe 1 a 1, sem falso conflito', allOk && revs.join(',') === '1,2,3,4', revs.join(','));
      const myDay = S.day;
      // "a outra aba" joga e salva: rev maior, dia 9
      const other = T.mainState(); other.rev += 5; other.day = 9; other.gold = 9999;
      const otherRaw = T.setMainState(other);
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
      const o2 = T.mainState(); o2.rev += 3; const raw2 = T.setMainState(o2);
      T.fireStorage(raw2);
      r = G.save(); ok('evento storage: próximo save recusado e storage intocado', r.ok === false && r.error.name === 'Conflict' && T.readMain() === raw2);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  const staleVisible = () => !$('modal').classList.contains('hidden') && !!$('modalBox').querySelector('button[data-a=staleuse]');      // visível de verdade (closeModal só esconde; o botão antigo continua no DOM)
  /* N4 (2ª revisão adversarial): outra aba APAGOU o save ("Novo jogo" da pausa) — esta aba, que continua aberta, não pode ressuscitá-lo */
  S_['aba-apagada'] = {
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); },
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
  let lastHostile = null;
  function hostile(mutate, check, opt = {}) {
    lastHostile = [mutate, check];
    return {
      seed() { T.reset(); const s = T.fixtureState('save_v1_atual'); mutate(s); window.__hostileRaw = opt.v2 ? T.setMainState(s) : T.setLegacyState(s); },      // v1: o save de quem já joga (importado) · v2: envelope VÁLIDO com dados hostis
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
    ok('tool dentro de 0..6 (7 ferramentas, com a vara) e goal dentro de 0..4', S.tool >= 0 && S.tool <= 6 && S.goal >= 0 && S.goal <= 4, S.tool + '/' + S.goal);
    ok('selSeed e char válidos', S.selSeed === 'cenoura' && S.char === 'fazendeiro', S.selSeed + '/' + S.char);
    ok('energia e água numéricas e dentro da faixa', S.energy === 100 && Number.isFinite(S.water) && S.water >= 0 && S.water <= 50, S.energy + '/' + S.water);
    ok('relógio dentro do dia (06:00..24:00)', S.min >= 360 && S.min <= 1440, S.min);
    ok('posição finita, dir 0..3, laid 1|2 (o rev agora vive no envelope, não no estado)', Number.isFinite(G.P.x) && Number.isFinite(G.P.y) && S.dir >= 0 && S.dir <= 3 && (S.laid === 1 || S.laid === 2) && !('rev' in S), [G.P.x, S.dir, S.laid]);
    ok('owned limitado ao máximo da loja (4/4/2) — nada de 8.000 animais', S.owned.vaca === 4 && S.owned.porco === 4 && S.owned.cavalo === 2 && G.Animals.list.length <= 11, JSON.stringify(S.owned) + ' animais=' + G.Animals.list.length);
    ok('sementes/melhoria/estatística negativas ou enormes viram valores válidos', S.seeds.cenoura === 0 && S.up.basket === 2 && S.stat.till === 0);
  });
  S_['hostil-estado-v2'] = hostile(...lastHostile, { v2: true });
  S_['hostil-estruturas'] = hostile(s => {
    s.obs = {}; s.obsInit = true; s.felled = {}; s.eggList = 'x'; s.digs = [[1, 2], ['a', 1], [999, 999], null]; s.truffleList = 5; s.soil[3] = 7; s.soil[4] = 'x'; s.milked = {}; s.meatDone = 'abc';
    s.crops = { '6,8': { t: 'milho', age: 2, pt: 1, pk: 'x' }, '7,8': { t: 'zzz', age: 1 }, 'a,b': { t: 'milho', age: 1 }, '9,9': { t: 'milho', age: 'x' }, '999,999': { t: 'milho', age: 1 }, '10,9': null };
  }, (G, S) => {
    ok('só a planta válida sobrou, sem pt/pk', JSON.stringify(Object.keys(S.crops)) === '["6,8"]' && JSON.stringify(S.crops['6,8']) === '{"t":"milho","age":2}', JSON.stringify(S.crops));
    ok('lista de obstáculos inválida => o mapa é regenerado (não fica vazio)', G.obs.length > 20, G.obs.length);
    ok('felled/eggList/truffleList/milked/meatDone viram arrays', ['felled', 'eggList', 'truffleList', 'milked', 'meatDone'].every(k => Array.isArray(S[k])));
    ok('digs: só o par válido sobrou', JSON.stringify(S.digs) === '[[1,2]]', JSON.stringify(S.digs));
    ok('chão só com 0/1/2', S.soil.every(v => v === 0 || v === 1 || v === 2) && S.soil.length === SaveManager.WORLD.to[0] * SaveManager.WORLD.to[1]);
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
    seed() { T.reset(); T.setMainState(T.fixtureState('save_v1_atual')); fastRaf(); Animals.spawn = () => { throw new Error('falha-simulada'); }; },
    async run() {
      await bootReady(); const before = T.readMain(); $('btnContinue').click();
      await waitStart(() => vis('saveProblem'));
      ok('aparece a caixa "Problema com o jogo salvo"', vis('saveProblem'));
      ok('explica que o save foi lido mas não iniciou, com o detalhe do erro', $('spMsg').textContent.includes('não conseguiu iniciá-lo') && $('spMsg').textContent.includes('falha-simulada'), $('spMsg').textContent);
      ok('NÃO manda "recarregar a página" (não resolveria)', !/Recarregue/.test($('spMsg').textContent + $('loadTxt').textContent), $('loadTxt').textContent);
      ok('oferece Baixar cópia', vis('btnSpExport'));
      ok('guardou uma cópia idêntica ao save', T.copies().length === 1 && T.copies()[0].raw === before);
      ok('o save original NÃO foi alterado', T.readMain() === before);
      $('btnSpExport').click(); await wait(100);
      ok('sem erros JS não tratados', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- 9) Fase 1b: legado v1 → v2, recuperação (bak/tmp) e save de versão futura ---------- */
  S_['legado-importa'] = {      // o legado v1 é IMPORTADO para o slot v2 sem ser tocado; as cópias antigas viram cópias v2 com o mesmo ts
    seed() { T.reset(); T.setLegacyCopy(1500, T.validLegacyRaw(2, 22)); T.setLegacyCopy(null, '{velha'); T.setLegacyState(T.fixtureState('save_v1_atual')); },
    async run() {
      const legacyRaw = T.readLegacy(), orig = T.fixtureState('save_v1_atual');
      await bootReady();
      ok('aparece "Continuar" e nenhum aviso de problema', vis('btnContinue') && !vis('saveProblem'));
      ok('o legado continua INTACTO', T.readLegacy() === legacyRaw);
      const env = T.mainEnv();
      ok('slot criado: schema atual, crc ok, dados do legado, sem v/rev dentro de data', env && env.schema === SaveManager.SCHEMA && T.mainCrcOk() && env.data.day === orig.day && !('v' in env.data) && !('rev' in env.data), JSON.stringify(env && env.summary));
      ok('cópias antigas (…_backup_<ts> e a sem data) viraram cópias v2 com o mesmo ts', T.copyRaw(1500) === T.validLegacyRaw(2, 22) && T.copyRaw(null) === '{velha', JSON.stringify(T.copies().map(c => c.ts)));
      ok('as chaves antigas dessas cópias continuam lá', T.readLegacyCopy(1500) !== null && T.readLegacyCopy(null) === '{velha');
      ok('marcadores gravados (legacyMain e legacyCopies)', (T.readMeta() || {}).legacyMain === true && (T.readMeta() || {}).legacyCopies === true, JSON.stringify(T.readMeta()));
      $('btnContinue').click(); const G = await gameReady();
      ok('jogando o save importado: dia do legado', G.S.day === orig.day, G.S.day);
      ok('regravar gera v2 válido, o legado segue intacto e nenhuma cópia extra', G.save().ok && T.mainCrcOk() && T.readLegacy() === legacyRaw && T.copies().length === 2, T.copies().length);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['legado-elias'] = {        // N3: as DUAS chaves antigas existem: usa a nova, guarda a "elias" como cópia e não apaga nenhuma
    seed() { T.reset(); T.setLegacy(T.validLegacyRaw(2, 22)); T.setElias(T.validLegacyRaw(11, 1111)); },
    async run() {
      await bootReady();
      ok('carrega a chave nova (dia 2)', vis('btnContinue') && T.mainState() && T.mainState().day === 2, T.mainState() && T.mainState().day);
      ok('a chave "elias" NÃO foi apagada', T.readElias() === T.validLegacyRaw(11, 1111));
      ok('...e virou uma cópia de segurança (dia 11)', T.copies().some(c => c.raw === T.validLegacyRaw(11, 1111)), T.copies().length);
      ok('a chave "leankar" também continua', T.readLegacy() === T.validLegacyRaw(2, 22));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['legado-sem-ressuscitar'] = {      // depois de importado, "Novo jogo" (pausa) apaga o slot e o save ANTIGO não volta. Recarrega a página: roda duas vezes
    seed() { if (sessionStorage.getItem('ran') === 'legado-sem-ressuscitar') return; T.reset(); T.setLegacyState(T.fixtureState('save_v1_atual')); },
    async run() {
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'legado-sem-ressuscitar') {
        sessionStorage.setItem('ran', 'legado-sem-ressuscitar'); sessionStorage.setItem('legacy', T.readLegacy());
        $('btnContinue').click(); await gameReady(); $('btnMenu').click(); await wait(50);
        $('modalBox').querySelector('button[data-a=resetask]').click(); await wait(50);
        $('modalBox').querySelector('button[data-a=reset]').click(); await wait(3000); return;
      }
      ok('o save principal foi apagado (slot, bak e tmp)', T.readMain() === null && T.readBak() === null && T.readTmp() === null);
      ok('o legado antigo NÃO ressuscitou: título sem "Continuar"', !vis('btnContinue'));
      ok('a tela inicial só oferece restaurar a cópia do jogo apagado', vis('saveProblem') && $('spMsg').textContent.includes('Não há jogo salvo') && vis('btnSpRestore') && T.copies().length === 1, $('spMsg').textContent);
      ok('o legado continua guardado, intacto', T.readLegacy() === sessionStorage.getItem('legacy'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['legado-cfg'] = {          // a configuração de áudio antiga é COPIADA para a v2 (sem apagar a antiga). O Snd lê ao carregar a página: roda duas vezes
    seed() { if (sessionStorage.getItem('ran') === 'legado-cfg') return; T.reset(); T.setLegacyCfg({ music: false, sfx: false }); },
    async run() {
      await bootReady();
      if (sessionStorage.getItem('ran') !== 'legado-cfg') { sessionStorage.setItem('ran', 'legado-cfg'); location.reload(); await wait(5000); return; }
      ok('depois de recarregar: música e efeitos DESLIGADOS (veio da configuração antiga)', $('btnMusic').textContent === '🔕' && $('btnMute').textContent === '🔇', $('btnMusic').textContent + $('btnMute').textContent);
      const c = T.readCfg(); ok('a configuração v2 foi gravada com os mesmos valores', c && c.music === false && c.sfx === false, JSON.stringify(c));
      const l = T.readLegacyCfg(); ok('a configuração antiga continua intacta', l && l.music === false && l.sfx === false, JSON.stringify(l));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['recupera-bak'] = {        // slot DANIFICADO (crc errado) + versão anterior boa no bak: recupera, avisa, guarda o danificado e continua a contar o rev
    seed() {
      T.reset(); const st = T.fixtureState('save_v1_atual');
      st.rev = 4; st.gold = 1111; T.setBak(T.setMainState(st));
      st.rev = 5; st.gold = 2222; const env = JSON.parse(T.setMainState(st)); env.crc = '00000000'; window.__damaged = JSON.stringify(env); T.setMain(window.__damaged); window.__bak = T.readBak();
    },
    async run() {
      await bootReady();
      ok('há "Continuar" e nenhuma caixa de problema (foi recuperado)', vis('btnContinue') && !vis('saveProblem'));
      ok('o danificado foi guardado numa cópia e o slot ainda não foi alterado', T.copies().some(c => c.raw === window.__damaged) && T.readMain() === window.__damaged, T.copies().length);
      $('btnContinue').click(); const G = await gameReady();
      ok('carregou a versão anterior (ouro 1111) e avisou que recuperou', G.S.gold === 1111 && toasts().some(t => t.includes('recuperamos')), G.S.gold + ' ' + JSON.stringify(toasts()));
      const r = G.save(); steps(G, 5);
      ok('o 1º save depois da recuperação funciona (sem falso "outra aba") e o slot volta a ser v2 válido', r.ok && T.mainCrcOk() && !staleVisible(), JSON.stringify(r.ok));
      ok('o rev continua depois do do slot danificado (5 → 6)', T.mainEnv().rev === 6, T.mainEnv() && T.mainEnv().rev);
      ok('o bak bom NÃO foi trocado pelo lixo', T.readBak() === window.__bak);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['recupera-tmp'] = {        // slot e bak ausentes, tmp válido (escrita interrompida): recupera, e o 1º save grava o slot sem falso conflito
    seed() { T.reset(); T.setTmp(T.validRaw(9, 999)); },
    async run() {
      await bootReady();
      ok('há "Continuar" e nenhuma caixa de problema', vis('btnContinue') && !vis('saveProblem'));
      $('btnContinue').click(); const G = await gameReady();
      ok('carregou o save do tmp (dia 9) e avisou que recuperou', G.S.day === 9 && toasts().some(t => t.includes('recuperamos')), G.S.day);
      const r = G.save(); steps(G, 5);
      ok('o 1º save grava o slot v2 (sem falso "outra aba apagou") com o dia 9', r.ok && T.mainCrcOk() && T.mainEnv().data.day === 9 && !staleVisible(), JSON.stringify(r.ok));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['futuro-nao-sobrescrito'] = {      // um save de versão MAIS NOVA no slot nunca é sobrescrito pelo jogo em andamento (nem em pagehide)
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(); ok('save normal funciona', G.save().ok);
      const fut = JSON.stringify({ magic: 'fazenda_las-save', schema: SaveManager.SCHEMA + 1, rev: T.mainEnv().rev, data: { novo: 1 }, crc: 'x' });
      T.setMain(fut);                      // MESMO rev: só a trava de versão futura pode impedir a gravação
      clearToasts(); const r = G.save(true);
      ok('save() recusado com FutureSchema', r.ok === false && r.error && r.error.name === 'FutureSchema', r.error && r.error.name);
      ok('o save futuro continua exatamente como estava', T.readMain() === fut);
      ok('avisa o jogador (versão mais nova, atualizar a página)', toasts().some(t => t.includes('versão mais nova')), JSON.stringify(toasts()));
      window.dispatchEvent(new Event('pagehide')); G.save();
      ok('pagehide e autosave também não o sobrescrevem', T.readMain() === fut);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
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
      data = { raw: T.readMain() || T.readLegacy() };
    },
  };

  /* ---------- gravador do "golden" do mundo (usado por tests/make-golden.js; não é um teste) ----------
     Um jogo NOVO gera o mapa de forma determinística (árvores, mato, pedras, frutíferas). Isto despeja o que foi gerado, para um teste garantir que mudar o TAMANHO do mapa
     (Fase 3 do plano das ovelhas) não embaralha a região antiga. Largura/altura vêm do jogo (G.MW/G.MH). */
  S_['gravar-mundo'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0);
      const rows = []; for (let y = 0; y < G.MH; y++) { let r = ''; for (let x = 0; x < G.MW; x++) r += G.blocked(x, y) ? '#' : '.'; rows.push(r); }
      data = { MW: G.MW, MH: G.MH, trees: G.trees.map(t => [t.x, t.y, t.v, t.border ? 1 : 0]), obs: G.obs.map(o => [o.type, o.x, o.y, o.v, o.hp, o.age === undefined ? null : o.age, o.fruit === undefined ? null : o.fruit]), blocked: rows };
      ok('gerou árvores e obstáculos', data.trees.length > 100 && data.obs.length > 50, data.trees.length + ' / ' + data.obs.length);
    },
  };

  /* ---------- Fase 3 do plano das ovelhas: a fazenda dobrou de área (46 × 34 → 64 × 49) ---------- */
  S_['mapa-golden'] = {      // o mundo ANTIGO continua igual dentro do mapa novo (tests/fixtures/mapa_golden_46x34.json, gravado ANTES da mudança)
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), gold = JSON.parse(F.mapa_golden_46x34), key = a => a.join(',');
      const OW = gold.MW, OH = gold.MH, MW = G.MW, MH = G.MH, edge = (x, y) => x === OW - 1 || y === OH - 1;
      const kc = (x, y) => G.Animals.keepClear(x, y);      // Fase 4: os recintos (curral ampliado, pasto, coelheira) e o corredor foram LIMPOS de árvore/mato de propósito: ficam fora da comparação
      ok('o mapa tem 64 × 49 (o dobro da área) e o golden é 46 × 34', MW === 64 && MH === 49 && OW === 46 && OH === 34 && MW * MH >= 2 * OW * OH * .99, MW + 'x' + MH);
      const treeSet = new Set(G.trees.map(t => key([t.x, t.y, t.v])));
      // 1) região antiga fora da faixa de 3 tiles (x < 43 e y < 31): árvores IDÊNTICAS, nas duas direções
      const goldInner = gold.trees.filter(t => t[0] < OW - 3 && t[1] < OH - 3 && !kc(t[0], t[1])), newInner = G.trees.filter(t => t.x < OW - 3 && t.y < OH - 3 && !kc(t.x, t.y));
      ok('árvores do mapa antigo (fora da faixa leste/sul): as mesmas, nenhuma a mais, nenhuma a menos', goldInner.length === newInner.length && goldInner.every(t => treeSet.has(key(t.slice(0, 3)))), goldInner.length + ' / ' + newInner.length);
      // 2) a faixa: só sobram árvores que já existiam (afinou), e a antiga moldura (x=45, y=33) virou passagem
      const gset = new Set(gold.trees.map(t => key(t.slice(0, 3))));
      const bandNew = G.trees.filter(t => t.x < OW && t.y < OH && (t.x >= OW - 3 || t.y >= OH - 3));
      ok('na faixa antiga só restam árvores que já existiam (nada de árvore nova no meio do caminho)', bandNew.every(t => gset.has(key([t.x, t.y, t.v]))), bandNew.length);
      const goldEdge = gold.trees.filter(t => edge(t[0], t[1]) && t[0] !== 0 && t[1] !== 0), newEdge = G.trees.filter(t => t.x < OW && t.y < OH && edge(t.x, t.y) && t.x !== 0 && t.y !== 0);
      ok('a antiga moldura leste/sul virou passagem (sobram ≤ 40% das árvores)', goldEdge.length > 40 && newEdge.length <= goldEdge.length * .4, goldEdge.length + ' → ' + newEdge.length);
      let free = 0; for (let y = 16; y <= 30; y++) if (!G.blocked(45, y)) free++;
      ok('o corredor x=45 do curral para o leste tem passagem (≥ 8 de 15 tiles livres)', free >= 8, free);
      ok('a moldura oeste e norte (x=0, y=0 e os cantos) continua inteira', gold.trees.filter(t => t[0] === 0 || t[1] === 0).every(t => treeSet.has(key(t.slice(0, 3)))));
      // 3) obstáculos antigos: TODOS iguais (mesmo gerador, mesma ordem)
      const nobs = new Map(G.obs.map(o => [o.x + ',' + o.y, o])); let same = 0; const diff = [];
      const goldObs = gold.obs.filter(o => !kc(o[1], o[2]));
      for (const o of goldObs) { const n = nobs.get(o[1] + ',' + o[2]); if (n && n.type === o[0] && n.v === o[3] && n.hp === o[4]) same++; else diff.push(o); }
      ok('os ' + goldObs.length + ' obstáculos do mapa antigo (fora dos recintos) estão todos no mapa novo, iguais', same === goldObs.length, diff.slice(0, 3).map(String).join(' | '));
      // 4) mapa de bloqueios idêntico na região segura
      let bad = 0; for (let y = 0; y < OH - 3; y++) for (let x = 0; x < OW - 3; x++) { if (kc(x, y)) continue; const c = G.blocked(x, y) ? '#' : '.'; if (c !== gold.blocked[y][x]) bad++; }
      ok('mapa de tiles bloqueados da região antiga (x < 43, y < 31, fora dos recintos) idêntico ao golden', bad === 0, bad + ' diferenças');
      // 5) terreno novo
      ok('moldura nova (x=63 e y=48) inteira', [...Array(MH).keys()].every(y => G.blocked(MW - 1, y)) && [...Array(MW).keys()].every(x => G.blocked(x, MH - 1)));
      const newLand = G.obs.filter(o => o.x >= OW || o.y >= OH), newTrees = G.trees.filter(t => (t.x >= OW || t.y >= OH) && t.x < MW - 1 && t.y < MH - 1);
      ok('o terreno novo tem pedras, mato e árvores (não é um deserto)', newLand.length >= 30 && newTrees.length >= 60, newLand.length + ' obs / ' + newTrees.length + ' árvores');
      const R = [{ x: 45, y: 15, w: 18, h: 17 }, { x: 45, y: 32, w: 15, h: 12 }, { x: 5, y: 35, w: 14, h: 10 }];
      const inR = (x, y) => R.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      ok('áreas reservadas do terreno novo (pasto, coelheira, horta 2) sem árvore nem obstáculo', !G.trees.some(t => (t.x >= OW || t.y >= OH) && t.x < MW - 1 && t.y < MH - 1 && inR(t.x, t.y)) && !G.obs.some(o => (o.x >= OW || o.y >= OH) && inR(o.x, o.y)));
      ok('o jogo roda 40 quadros sem erro', (steps(G, 40), !window.__errs.length), window.__errs.join('|'));
    },
  };
  S_['mapa-save-antigo'] = {      // um save do MAPA ANTIGO (schema 2, chão 46×34) abre no mapa novo: terra arada, plantas e jogador no mesmo lugar; terreno novo povoado; regrava no schema 3
    seed() { T.reset(); T.setMain(F.save_v2_ok); },
    async run() {
      const orig = T.fixtureState('save_v2_ok', { raw: true }), OW = 46, OH = 34;
      await bootReady(); ok('o save antigo (schema 2) está intacto antes de carregar', T.readMain() === F.save_v2_ok && T.mainEnv().schema === 2 && orig.soil.length === OW * OH);
      ok('sem aviso de problema e com Continuar', !vis('saveProblem') && vis('btnContinue'));
      $('btnContinue').click(); const G = await gameReady(), S = G.S, MW = G.MW, MH = G.MH;
      ok('o chão agora é do tamanho do mapa novo', S.soil.length === MW * MH, S.soil.length);
      let diffs = 0, tilled = 0; for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) { const v = orig.soil[y * OW + x]; if (v) tilled++; if (S.soil[y * MW + x] !== v) diffs++; }
      ok('toda a terra arada/molhada está na MESMA coordenada (x,y) (' + tilled + ' tiles)', tilled >= 20 && diffs === 0, diffs + ' diferenças');
      let nz = 0; for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if ((x >= OW || y >= OH) && S.soil[y * MW + x]) nz++;
      ok('o terreno novo começa sem arar', nz === 0, nz);
      ok('as plantas continuam nas mesmas coordenadas', Object.keys(orig.crops).length > 5 && Object.keys(orig.crops).every(k => S.crops[k] && S.crops[k].t === orig.crops[k].t), Object.keys(orig.crops).length);
      ok('ouro, dia e animais iguais', S.gold === orig.gold && S.day === orig.day && ['vaca', 'porco', 'cavalo'].every(k => S.owned[k] === orig.owned[k]), JSON.stringify(S.owned));
      const fresh = G.obs.filter(o => o.x >= OW || o.y >= OH).length;
      ok('o terreno novo foi povoado uma vez e o save passou para world=3', S.world === 3 && fresh >= 30, S.world + ' / ' + fresh);
      steps(G, 60); G.endDay(false); steps(G, 20);
      ok('sem NaN depois de passar um dia', !/NaN|Infinity/.test(JSON.stringify(G.S)));
      const r = G.save(); ok('salvar funciona', r.ok);
      const env = T.mainEnv();
      ok('regravado no schema 3, crc ok, chão do tamanho novo, world 3', env.schema === SaveManager.SCHEMA && SaveManager.SCHEMA === 3 && T.mainCrcOk() && env.data.soil.length === MW * MH && env.data.world === 3, env && env.schema);
      ok('o terreno novo está no save (obstáculos novos regravados)', env.data.obs.filter(o => o[1] >= OW || o[2] >= OH).length >= 30);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- Fase 4 do plano das ovelhas: recintos por dados (curral ampliado, pasto das ovelhas, coelheira) ---------- */
  S_['recintos'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), A = G.Animals, S = G.S, P = A.PENS;
      ok('3 recintos: curral, pasto, coelheira', JSON.stringify(Object.keys(P)) === '["curral","pasto","coelheira"]');
      ok('o curral cresceu para o sul (y 16–31; era 16–27) e o interior é a área menos a cerca', P.curral.area.y1 === 31 && P.curral.in.y1 === 30 && P.curral.in.x0 === 31 && P.curral.in.x1 === 43);
      ok('pasto 47–62 × 16–30 e coelheira 47–58 × 33–42 (cabem no mapa e não se tocam)', P.pasto.area.x1 < G.MW - 1 && P.coelheira.area.y1 < G.MH - 1 && P.pasto.area.y1 < P.coelheira.area.y0 && P.curral.area.x1 < P.pasto.area.x0);
      // cercas sólidas, portões e interior livres (fora a decoração sólida)
      let fenceBad = 0, gateBad = 0, inBlockedNoDecor = 0;
      for (const p of A.PEN_LIST) {
        const decor = new Set(); for (const d of p.decor) if (d.solid !== false) for (let i = 0; i < d.tw; i++) decor.add((d.tx + i) + ',' + d.ty);
        for (let y = p.area.y0; y <= p.area.y1; y++) for (let x = p.area.x0; x <= p.area.x1; x++) {
          const isGate = p.gates.some(g => x === g.x && y >= g.y0 && y <= g.y1), inside = x >= p.in.x0 && x <= p.in.x1 && y >= p.in.y0 && y <= p.in.y1;
          if (!inside && !isGate && !G.blocked(x, y)) fenceBad++;
          if (isGate && G.blocked(x, y)) gateBad++;
          if (inside && !decor.has(x + ',' + y) && G.blocked(x, y)) inBlockedNoDecor++;
        }
      }
      ok('toda a cerca é sólida, todo portão é passagem e o interior não tem árvore, pedra nem mato', fenceBad === 0 && gateBad === 0 && inBlockedNoDecor === 0, fenceBad + '/' + gateBad + '/' + inBlockedNoDecor);
      // corredor livre e alcançável: a pé, do ponto de partida até o meio de cada recinto, só por portões
      const free = (x, y) => x >= 0 && y >= 0 && x < G.MW && y < G.MH && !G.blocked(x, y);
      const reach = (sx, sy) => { const seen = new Set([sx + ',' + sy]), q = [[sx, sy]]; while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (!seen.has(k) && free(nx, ny) && !(G.POND && 0)) { seen.add(k); q.push([nx, ny]); } } } return seen; };
      const R = reach(8, 7), mid = p => [Math.floor((p.in.x0 + p.in.x1) / 2), Math.floor((p.in.y0 + p.in.y1) / 2)];
      for (const id of ['curral', 'pasto', 'coelheira']) { const [mx, my] = mid(P[id]); let ok_ = R.has(mx + ',' + my); if (!ok_) for (let dy = -2; dy <= 2 && !ok_; dy++) for (let dx = -2; dx <= 2 && !ok_; dx++) ok_ = R.has((mx + dx) + ',' + (my + dy)); ok('a pé dá para chegar ao meio do ' + id + ' saindo da casa', ok_); }
      let corr = 0; for (let y = 16; y <= 42; y++) for (const x of [45, 46]) if (free(x, y)) corr++; ok('o corredor x=45..46 (y 16–42) está livre de árvore e mato', corr === 27 * 2, corr);
      ok('nenhuma árvore nos recintos e no corredor (a moldura do mapa não conta)', !G.trees.some(t => !t.border && A.keepClear(t.x, t.y)));
      // lotação máxima do curral: 4 vacas, 4 porcos, 2 cavalos — todos nascem DENTRO do curral, em tile livre
      for (const [k, n] of [['vaca', 4], ['porco', 4], ['cavalo', 2]]) while (S.owned[k] < n) { S.owned[k]++; A.add(k); }
      const inPen = (a, p) => { const tx = Math.floor(a.x / 64), ty = Math.floor(a.y / 64); return tx >= p.in.x0 && tx <= p.in.x1 && ty >= p.in.y0 && ty <= p.in.y1 && !G.blocked(tx, ty); };
      const beasts = A.list.filter(a => a.kind !== 'cachorro');
      ok('lotação máxima: ' + beasts.length + ' bichos nascem dentro do curral, em tile livre', beasts.length === 10 && beasts.every(a => inPen(a, P.curral)), beasts.filter(a => !inPen(a, P.curral)).length + ' fora');
      steps(G, 400, .1);
      ok('depois de 40 s andando, todos continuam dentro do curral (a cerca confina)', beasts.every(a => inPen(a, P.curral) || a === A.horse), beasts.filter(a => !inPen(a, P.curral)).map(a => a.kind + ':' + Math.round(a.x / 64) + ',' + Math.round(a.y / 64)).join(' '));
      // o que o E faz continua igual (refatorado para a tabela de espécies)
      const cow = A.cows()[0], pig = A.pigs()[0], tile = a => [Math.floor(a.x / 64), Math.floor(a.y / 64)];
      S.milked = []; S.meatDone = []; S.min = 8 * 60; for (const a of A.list) if (a !== cow) { a.x = 33 * 64; a.y = 18 * 64; } cow.x = 40 * 64; cow.y = 25 * 64; pig.x = 36 * 64; pig.y = 25 * 64;
      let r = A.at(...tile(cow), S); ok('vaca pronta: "E — Ordenhar" (type vaca)', r && r.type === 'vaca' && r.label === 'E — Ordenhar', JSON.stringify(r && [r.type, r.label]));
      S.milked[cow.idx] = true; r = A.at(...tile(cow), S); ok('vaca já ordenhada: avisa em vez de oferecer', r && r.type === 'vaca' && r.label === 'Já ordenhada hoje');
      r = A.at(...tile(pig), S); ok('porco com carne: "E — Pegar carne" (ready)', r && r.type === 'porco' && r.ready === true && r.label === 'E — Pegar carne');
      S.meatDone[pig.idx] = 1; S.min = 9 * 60; r = A.at(...tile(pig), S); ok('porco sem carne: carinho', r && r.type === 'porco' && r.ready === false && r.label === 'E — Fazer carinho');
      // compatibilidade com o que o jogo usa e o catálogo da loja vem da tabela
      ok('IN/AREA/GATE e inArea/inIn/isFence continuam existindo (curral = principal)', A.IN === P.curral.in && A.AREA === P.curral.area && A.inArea(30, 16, 0) && A.inArea(55, 20, 0) && A.inIn(40, 20) && A.isFence(30, 16) && !A.isFence(30, 21));
      const shop = A.shopCatalog(); ok('a loja: vaca 260/4, porco 180/4, cavalo 650/2 — saiu do animais.js', shop.vaca.cost === 260 && shop.vaca.max === 4 && shop.porco.cost === 180 && shop.cavalo.cost === 650 && shop.cavalo.max === 2 && !shop.ovelha && !shop.coelho);
      // as sheets da ovelha e do coelho carregam e são fatiadas
      const sh = A.IMGS.ovelha, rb = A.IMGS.coelho;
      ok('sheets da ovelha (10 linhas × 6) e do coelho (8 × 6) fatiadas em quadros 116×120 e 120×124', sh.frames && Object.keys(sh.frames).length === 10 && sh.frames.left.length === 6 && sh.frames.left[0].width === 116 && sh.frames.left[0].height === 120 && rb.frames && Object.keys(rb.frames).length === 8 && rb.frames.right[0].width === 120 && rb.frames.right[0].height === 124);
      const nonEmpty = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true; return false; };
      ok('os quadros de repouso e de pulo têm pixels (a sheet carregou de verdade)', nonEmpty(sh.frames.left[0]) && nonEmpty(sh.frames.shorn_down[3]) && nonEmpty(rb.frames.right[3]) && nonEmpty(rb.frames.eat_left[1]));
      ok('o cavalo continua com 4 direções × 5 quadros (IMGS.cavalo.walk)', ['down', 'up', 'left', 'right'].every(d => A.IMGS.cavalo.walk[d].length === 5));
      steps(G, 60); G.endDay(false); steps(G, 20);
      ok('passar um dia leva os bichos de volta ao curral e não dá erro', A.list.filter(a => a.kind !== 'cachorro' && a !== A.horse).every(a => inPen(a, P.curral)) && !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- Fase 5 do plano das ovelhas: ovelhas e coelhos vivos (IA, quadros, tosquia, produto do coelho, fuga, descanso, save) ---------- */
  S_['ovelhas-coelhos'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), A = G.Animals, S = G.S, R = G.Rebanho, P = A.PENS;
      S.gold = 1e6; for (const id of ['portao', 'tesoura', 'coelheira']) R.buy(S, id);
      for (let i = 0; i < 3; i++) { R.buyAnimal(S, 'ovelha'); A.add('ovelha'); } for (let i = 0; i < 2; i++) { R.buyAnimal(S, 'coelho'); A.add('coelho'); }
      const sheep = A.list.filter(a => a.kind === 'ovelha'), rabbits = A.list.filter(a => a.kind === 'coelho');
      const inPen = (a, p) => { const tx = Math.floor(a.x / 64), ty = Math.floor(a.y / 64); return tx >= p.in.x0 && tx <= p.in.x1 && ty >= p.in.y0 && ty <= p.in.y1 && !G.blocked(tx, ty); };
      ok('3 ovelhas no pasto e 2 coelhos na coelheira, em tile livre', sheep.length === 3 && rabbits.length === 2 && sheep.every(a => inPen(a, P.pasto)) && rabbits.every(a => inPen(a, P.coelheira)));
      const tile = a => [Math.floor(a.x / 64), Math.floor(a.y / 64)];
      // ---- 40 s de vida: ficam no recinto, andam, pastam; o coelho só se desloca nos quadros NO AR do pulo
      const AIR = G.Animals.SHEETS.coelho.air, rowsSeen = new Set(), prev = new Map(rabbits.map(r => [r.id, [r.x, r.y]])), start = new Map(A.list.map(a => [a.id, [a.x, a.y]]));
      let groundMoves = 0, airMoves = 0, hopRows = 0, restRows = 0, sheepTravel = 0, rabbitTravel = 0; const sPrev = new Map(sheep.map(a => [a.id, [a.x, a.y]]));
      for (let i = 0; i < 400; i++) {
        A.update(.1, S);      // só a vida dos bichos (sem desenhar): 40 s em milissegundos
        for (const r of rabbits) {
          const pk = A.pickRow(r, S), q = prev.get(r.id), d = Math.hypot(r.x - q[0], r.y - q[1]); rowsSeen.add(pk.row); prev.set(r.id, [r.x, r.y]); rabbitTravel += d;
          if (r.moving && /^(right|left|down|up)$/.test(pk.row)) { hopRows++; if (!AIR.includes(pk.frame) && d > 1e-6) groundMoves++; if (AIR.includes(pk.frame) && d > 1e-6) airMoves++; } else if (!r.moving) restRows++;
        }
        for (const a of sheep) { rowsSeen.add(A.pickRow(a, S).row); const q = sPrev.get(a.id); sheepTravel += Math.hypot(a.x - q[0], a.y - q[1]); sPrev.set(a.id, [a.x, a.y]); }
      }
      ok('depois de 40 s: ovelhas e coelhos continuam dentro dos seus recintos', sheep.every(a => inPen(a, P.pasto)) && rabbits.every(a => inPen(a, P.coelheira)), JSON.stringify([...sheep, ...rabbits].filter(a => !inPen(a, a.kind === 'ovelha' ? P.pasto : P.coelheira)).map(a => [a.kind, a.x, a.y])));
      ok('as ovelhas andaram (> 60 px no total) e usaram linhas de andar e de pastar', sheepTravel > 60 && [...rowsSeen].some(r => /^(right|left|down|up)$/.test(r)) && [...rowsSeen].some(r => /^eat_/.test(r)), sheepTravel.toFixed(0) + ' ' + [...rowsSeen].join(','));
      ok('os coelhos pularam (> 40 px) e o deslocamento só acontece nos quadros no ar (' + airMoves + ' passos no ar, ' + groundMoves + ' no chão)', rabbitTravel > 40 && hopRows > 20 && airMoves > 5 && groundMoves === 0, rabbitTravel.toFixed(0) + ' ' + hopRows + '/' + airMoves + '/' + groundMoves);
      ok('os coelhos também sentam (orelhas mexendo ou mordiscando)', restRows > 20 && [...rowsSeen].some(r => /^(alert|eat)_/.test(r)), restRows);
      // ---- tosquia
      S.reb.sheared = []; S.min = 8 * 60; const sh = sheep[0], sh2 = sheep[1]; for (const a of A.list) { if (a !== sh) { a.x = 52 * 64; a.y = 28 * 64 + (a.id % 5) * 70; } } sh.x = 50 * 64 + 32; sh.y = 20 * 64 + 40; sh.moving = false; sh.graze = 0; sh.wait = 99;
      let it = A.at(...tile(sh), S); ok('ovelha pronta: "E — Tosquiar" (type ovelha, ready)', it && it.type === 'ovelha' && it.label === 'E — Tosquiar' && it.ready === true, JSON.stringify(it && [it.type, it.label]));
      ok('o balão de lã aparece (a lã é o que o jogador vê pronta)', A.KINDS.ovelha.balloon(S, sh) && A.KINDS.ovelha.balloon(S, sh).prop === 'la_bruta');
      ok('antes de tosquiar o quadro é de LÃ (andar/parada), depois é TOSQUIADA', !/^shorn/.test(A.pickRow(sh, S).row));
      G.interact(...tile(sh)); ok('E tosquia: +1 lã no estado, relógio marcado, balão some e o quadro vira tosquiada', S.reb.wool === 1 && S.reb.sheared[0] === S.day && A.KINDS.ovelha.balloon(S, sh) === null && /^shorn/.test(A.pickRow(sh, S).row), JSON.stringify([S.reb.wool, S.reb.sheared[0], A.pickRow(sh, S).row]));
      it = A.at(...tile(sh), S); ok('logo depois: "Já tosquiada hoje"', it && it.label === 'Já tosquiada hoje' && it.ready === false);
      G.interact(...tile(sh)); ok('E de novo não rende lã (só carinho)', S.reb.wool === 1);
      S.reb.gear.tesoura = 0; sh2.x = 50 * 64 + 32; sh2.y = 24 * 64 + 40; sh2.moving = false; it = A.at(...tile(sh2), S);
      ok('sem tesoura: a mensagem diz o que falta', it && it.label === 'Precisa da tesoura de tosa' && !it.ready, it && it.label); S.reb.gear.tesoura = 1;
      for (let i = 0; i < 2; i++) { G.endDay(false); steps(G, 5); }
      sh.x = 50 * 64 + 32; sh.y = 20 * 64 + 40; sh.moving = false; sh.wait = 99; S.min = 8 * 60;
      ok('a lã voltou em 2 dias: "E — Tosquiar" e o quadro volta a ser de lã', A.at(...tile(sh), S).label === 'E — Tosquiar' && !/^shorn/.test(A.pickRow(sh, S).row));
      // ---- coelho: produto do dia (carne/pele alternam), balão, "já deu"
      const rb = rabbits[0]; rb.x = 50 * 64 + 32; rb.y = 36 * 64 + 40; rb.moving = false; rb.wait = 99; S.min = 8 * 60;
      const c = R.canCollectRabbit(S, rb.idx); it = A.at(...tile(rb), S);
      ok('coelho pronto: "E — Pegar ' + (c.kind === 'rmeat' ? 'carne' : 'pele') + '" e o balão certo', it && it.type === 'coelho' && it.ready && it.label === (c.kind === 'rmeat' ? 'E — Pegar carne' : 'E — Pegar pele') && A.KINDS.coelho.balloon(S, rb).prop === (c.kind === 'rmeat' ? 'carne_coelho' : 'pele_coelho'), JSON.stringify(it && it.label));
      const before = S.reb[c.kind]; G.interact(...tile(rb)); ok('E dá o produto (+1 ou +2 com sorte), marca o dia e avisa "Já deu o produto de hoje"', S.reb[c.kind] >= before + 1 && S.reb.rdone[rb.idx] === S.day && A.at(...tile(rb), S).label === 'Já deu o produto de hoje' && A.KINDS.coelho.balloon(S, rb) === null, S.reb[c.kind]);
      G.endDay(false); steps(G, 5); S.min = 8 * 60; ok('no dia seguinte o outro produto está pronto', R.canCollectRabbit(S, rb.idx).ok && R.canCollectRabbit(S, rb.idx).kind !== c.kind);
      // ---- fuga: o jogador anda perto -> o coelho se afasta aos pulos
      const rf = rabbits[1]; rf.x = 53 * 64; rf.y = 38 * 64; rf.moving = false; rf.wait = 99; rf.flee = 0; G.P.x = rf.x - 70; G.P.y = rf.y; const d0 = Math.hypot(G.P.x - rf.x, G.P.y - rf.y); let fled = false;
      for (let i = 0; i < 40; i++) { G.P.moving = true; A.update(.05, S); if (rf.flee > 0) fled = true; }
      ok('o coelho foge de quem anda perto (pulou para longe)', fled && Math.hypot(G.P.x - rf.x, G.P.y - rf.y) > d0 + 25, d0.toFixed(0) + ' → ' + Math.hypot(G.P.x - rf.x, G.P.y - rf.y).toFixed(0)); G.P.moving = false;
      // ---- descanso à noite: ficam parados
      S.min = A.REST_FROM + 30; const pos = [...sheep, ...rabbits].map(a => [a.x, a.y]); for (let i = 0; i < 100; i++) A.update(.1, S);
      ok('à noite (depois das 20:30) ovelhas e coelhos ficam parados', [...sheep, ...rabbits].every((a, i) => a.x === pos[i][0] && a.y === pos[i][1] && !a.moving));
      // ---- comida: o cocho gasta feno ao amanhecer
      S.gold = 1e6; R.buy(S, 'cocho'); R.buy(S, 'feno'); const hay = S.reb.feed.feno; G.endDay(false); steps(G, 5);
      ok('ao amanhecer o cocho gasta feno (1 por 4 ovelhas) e a lã volta mais rápido', S.reb.feed.feno === hay - 1 && S.reb.fed === 1 && R.fx(S).woolDays === 1, JSON.stringify([hay, S.reb.feed.feno, S.reb.fed]));
      // ---- save: os bichos e os relógios persistem
      S.reb.sheared[0] = S.day; const r = G.save(); const back = T.mainState();
      ok('salvar grava bichos, produtos, acessórios e relógios', r.ok && back.owned.ovelha === 3 && back.owned.coelho === 2 && back.reb.wool >= 1 && back.reb.gear.tesoura === 1 && back.reb.sheared[0] === S.day && back.reb.feed.feno === S.reb.feed.feno, JSON.stringify(back.owned));
      ok('sem NaN e sem erros JS', !/NaN|Infinity/.test(JSON.stringify(S.reb)) && !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['ovelhas-save'] = {      // o save com bichos volta com bichos, cada um no seu recinto; save hostil não cria 4000 ovelhas
    seed() { T.reset(); const st = T.fixtureState('save_v3_ok'); Object.assign(st, { owned: Object.assign({}, st.owned, { ovelha: 3, coelho: 4000 }), reb: { wool: 1e12, gear: { portao: 1, tesoura: 1, inventado: 1 }, coelheiras: 2, sheared: [5, 'x', -3], rdone: 'lixo', feed: { feno: 999 } } }); T.setMainState(st); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), A = G.Animals, S = G.S, P = A.PENS;
      ok('save hostil: coelhos limitados ao máximo (8), ovelhas 3, lã limitada ao cesto, chaves desconhecidas somem', S.owned.coelho === 8 && S.owned.ovelha === 3 && S.reb.wool <= 40 && !('inventado' in S.reb.gear) && S.reb.gear.portao === 1 && S.reb.feed.feno === 20 && Array.isArray(S.reb.rdone) && S.reb.sheared.every(v => Number.isInteger(v) && v >= 0), JSON.stringify([S.owned, S.reb.wool, S.reb.sheared]));
      const sheep = A.list.filter(a => a.kind === 'ovelha'), rabbits = A.list.filter(a => a.kind === 'coelho');
      const inPen = (a, p) => { const tx = Math.floor(a.x / 64), ty = Math.floor(a.y / 64); return tx >= p.in.x0 && tx <= p.in.x1 && ty >= p.in.y0 && ty <= p.in.y1; };
      ok('os bichos do save nascem: 3 ovelhas no pasto e 8 coelhos na coelheira', sheep.length === 3 && rabbits.length === 8 && sheep.every(a => inPen(a, P.pasto)) && rabbits.every(a => inPen(a, P.coelheira)), sheep.length + '/' + rabbits.length);
      steps(G, 80); ok('o jogo roda sem erro com todos os bichos', !window.__errs.length && !/NaN/.test(JSON.stringify(S.reb)), window.__errs.join('|'));
    },
  };

  /* ---------- Fase 6 do plano das ovelhas: loja (aba Rebanho), compra de estruturas, venda, cesto e oficina ---------- */
  S_['rebanho-loja'] = {
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), A = G.Animals, S = G.S, R = G.Rebanho;
      const tab = k => { document.querySelector('#modalBox [data-a="shoptab"][data-k="' + k + '"]').click(); };
      const btn = (a, k) => document.querySelector('#modalBox [data-a="' + a + '"][data-k="' + k + '"]');
      const click = async (a, k) => { const b = btn(a, k); if (!b) return null; b.click(); await wait(30); return b; };
      // a pessoa que nunca abre a aba não vê nada novo: a aba Fazenda continua igual e a de Rebanho só existe se clicar
      G.openShop(); ok('o empório tem 3 abas (Fazenda, Pesca, Rebanho) e abre na Fazenda', document.querySelectorAll('#modalBox .shopTabs button').length === 3 && !!btn('animal', 'vaca') && !btn('rebanimal', 'ovelha'));
      tab('rebanho'); await wait(30);
      ok('aba Rebanho: 2 animais e 13 acessórios, com preço e texto', document.querySelectorAll('#modalBox .item').length === 15 && btn('rebanimal', 'ovelha').textContent.includes('220') && btn('rebanimal', 'coelho').textContent.includes('90') && btn('reb', 'portao').textContent.includes('300'));
      // bloqueios mostram o MOTIVO e não fazem nada
      ok('sem portão: a ovelha vem desabilitada com o motivo; sem coelheira: o coelho também', btn('rebanimal', 'ovelha').disabled && /portão do aprisco/.test(document.querySelector('#modalBox').textContent) && btn('rebanimal', 'coelho').disabled && /coelheira antes/.test(document.querySelector('#modalBox').textContent));
      ok('com 100 ◎ (ouro inicial) o portão (300) está desabilitado: "ouro insuficiente" aparece só no title', btn('reb', 'portao').disabled && btn('reb', 'portao').title === 'ouro insuficiente');
      btn('rebanimal', 'ovelha').click(); ok('clicar num botão desabilitado não compra nada', S.owned.ovelha === 0 && S.gold === 100);
      // compra de estrutura = aparece sozinha; o ouro sai certo
      S.gold = 5000; G.openShop(); tab('rebanho'); await wait(30);
      const g0 = S.gold; await click('reb', 'portao'); ok('portão comprado: -300 ◎, marcado "✓ comprado", e a ovelha libera', S.gold === g0 - 300 && S.reb.gear.portao === 1 && !btn('reb', 'portao') && !btn('rebanimal', 'ovelha').disabled, S.gold);
      await click('rebanimal', 'ovelha'); const sh = A.list.filter(a => a.kind === 'ovelha');
      ok('ovelha comprada (-220 ◎): nasce no pasto e o contador vira 1/8', S.owned.ovelha === 1 && sh.length === 1 && S.gold === g0 - 520 && /\(1\/8\)/.test(document.querySelector('#modalBox').textContent), S.gold);
      await click('reb', 'tesoura'); await click('reb', 'cocho'); await click('reb', 'feno'); await click('reb', 'oficina');
      const cocho = A.PENS.pasto.decor.find(d => d.req === 'cocho'), tileBlocked = d => G.blocked(d.tx, d.ty);
      ok('cocho comprado: aparece no pasto e vira sólido (o jogador não atravessa); feno visível porque há estoque', tileBlocked(cocho) && A.decorOn(cocho, S) && A.decorOn(A.PENS.pasto.decor.find(d => d.feed === 'feno'), S) && S.reb.feed.feno === 5);
      const est = A.PENS.pasto.decor.find(d => d.req === 'estacao'); ok('a estação (ainda não comprada) NÃO aparece nem bloqueia', !A.decorOn(est, S) && !G.blocked(est.tx, est.ty) && !G.blocked(est.tx + 1, est.ty));
      await click('reb', 'coelheira'); await click('rebanimal', 'coelho'); await click('rebanimal', 'coelho');
      ok('coelheira (-140) instalada 1/4; 2 coelhos comprados; o 3º pede mais uma coelheira', S.reb.coelheiras === 1 && S.owned.coelho === 2 && btn('rebanimal', 'coelho').disabled && /outra coelheira/.test(document.querySelector('#modalBox').textContent));
      ok('a coelheira nº 1 aparece e é sólida; a nº 2 ainda não', A.decorOn(A.PENS.coelheira.decor.find(d => d.n === 1), S) && !A.decorOn(A.PENS.coelheira.decor.find(d => d.n === 2), S));
      // ração: com ouro ou com 5 cenouras colhidas
      await click('reb', 'tigela'); S.harvest.cenoura = 7; G.openShop(); tab('rebanho'); await wait(30);
      const gold1 = S.gold; await click('rebcarrot', 'racao'); ok('ração com 5 cenouras: +5 ração, -5 cenouras, sem gastar ouro', S.reb.feed.racao === 5 && S.harvest.cenoura === 2 && S.gold === gold1, JSON.stringify([S.reb.feed.racao, S.harvest.cenoura]));
      G.closeModal();
      // tosquiar e vender na caixa: o preço da lã é o do rebanho.js
      const a1 = sh[0]; a1.x = 50 * 64 + 32; a1.y = 22 * 64 + 40; a1.moving = false; a1.wait = 99; S.min = 8 * 60; const t = [Math.floor(a1.x / 64), Math.floor(a1.y / 64)];
      G.interact(t[0], t[1]); steps(G, 4, .1); ok('E na ovelha tosquia: +1 lã; o cesto do HUD lista "Lã"', S.reb.wool === 1 && /Lã/.test(document.getElementById('bag').textContent), S.reb.wool);
      S.reb.rmeat = 2; S.reb.rpelt = 3; S.reb.yarn = 1; S.reb.cheese = 1; S.reb.pelt = 1; S.milk = 0; S.eggs = 0; S.harvest.cenoura = 0; const before = S.gold, want = R.productValue(S);
      steps(G, 4, .1); ok('o cesto lista carne, pele crua, fio, queijo e pele curtida', ['Carne de coelho', 'Pele crua', 'Fio de lã', 'Queijo', 'Pele curtida'].every(n => document.getElementById('bag').textContent.includes(n)), document.getElementById('bag').textContent);
      G.sellAll(); ok('a caixa de vendas compra tudo: ouro sobe exatamente o valor do rebanho (' + want + ' ◎) e os produtos zeram', S.gold === before + want && R.productCount(S) === 0 && want === 40 + 2 * 22 + 3 * 14 + 140 + 190 + 40, S.gold - before);
      // oficina: E abre o menu; fazer fio gasta 3 lã
      const of = A.PENS.pasto.decor.find(d => d.shop === 'oficina'); G.interact(of.tx + 1, of.ty);
      ok('E na oficina abre o menu com as 3 receitas, todas "Fazer"', !!btn('craft', 'fiar') && !!btn('craft', 'queijo') && !!btn('craft', 'curtir') && btn('craft', 'fiar').disabled && /precisa de 3 lã/.test(document.querySelector('#modalBox').textContent));
      S.reb.wool = 3; S.milk = 3; S.reb.rpelt = 2; G.openWorkshop(); await wait(30);
      await click('craft', 'fiar'); await click('craft', 'queijo'); await click('craft', 'curtir');
      ok('fiar, queijo e curtir: consomem os insumos e entregam fio, queijo e pele curtida; a roda gira', S.reb.wool === 0 && S.milk === 0 && S.reb.rpelt === 0 && S.reb.yarn === 1 && S.reb.cheese === 1 && S.reb.pelt === 1);
      G.closeModal(); const b2 = S.gold; G.sellAll(); ok('e o que a oficina faz vende mais: 140 + 190 + 40 ◎', S.gold - b2 === 370, S.gold - b2);
      // save
      const r = G.save(), back = T.mainState(); ok('o que foi comprado persiste no save', r.ok && back.reb.gear.portao === 1 && back.reb.gear.oficina === 1 && back.reb.coelheiras === 1 && back.owned.ovelha === 1 && back.owned.coelho === 2);
      ok('sem NaN e sem erros JS', !/NaN|Infinity/.test(JSON.stringify(S.reb)) && !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['rebanho-loja-carregar'] = {      // um save com o que foi comprado: as estruturas voltam (aparecem e bloqueiam) e a oficina responde
    seed() { T.reset(); const st = T.fixtureState('save_v3_ok'); Object.assign(st, { owned: Object.assign({}, st.owned, { ovelha: 2, coelho: 2 }), reb: { gear: { portao: 1, tesoura: 1, cocho: 1, oficina: 1, estacao: 1 }, coelheiras: 2, feed: { feno: 3 }, wool: 4 } }); T.setMainState(st); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(), A = G.Animals, S = G.S;
      const need = A.PENS.pasto.decor.filter(d => d.req && d.solid !== false && A.decorOn(d, S)), est = A.PENS.pasto.decor.find(d => d.req === 'estacao');
      ok('ao carregar: cocho, oficina e o feno em estoque aparecem; as estruturas sólidas bloqueiam', need.length >= 2 && need.every(d => d.tw >= 1 && G.blocked(d.tx, d.ty)) && A.decorOn(est, S) && !G.blocked(est.tx, est.ty), need.map(d => d.k).join(','));
      ok('as 2 coelheiras compradas aparecem (n=1 e n=2) e a 3ª não', A.decorOn(A.PENS.coelheira.decor.find(d => d.n === 2), S) && !A.decorOn(A.PENS.coelheira.decor.find(d => d.n === 3), S));
      const of = A.PENS.pasto.decor.find(d => d.shop === 'oficina'); const it = G.interactAt ? G.interactAt(of.tx, of.ty) : A.workshopAt(of.tx, of.ty, S);
      ok('a oficina comprada responde ao E', it && it.type === 'oficina');
      steps(G, 60); ok('o jogo roda sem erro e o cesto mostra a lã do save', !window.__errs.length && /Lã/.test(document.getElementById('bag').textContent), window.__errs.join('|'));
    },
  };

  /* ---------- capturas de tela (usadas à mão: tests/capturas.js; não são testes) ---------- */
  const captura = (cx, cy, openMapToo, zoomOut) => ({
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0); G.P.x = cx * 64; G.P.y = cy * 64; if (zoomOut) { /* câmera inteira: o zoom do jogo é automático; só reposiciona */ }
      for (let i = 0; i < 40; i++) G.step(.05); G.cam.x = Math.max(0, cx * 64 - 640); G.cam.y = Math.max(0, cy * 64 - 400); G.step(.05);
      if (openMapToo) { G.openMap(); const cv = document.getElementById('mapCv'); data = { png: cv ? cv.toDataURL() : null }; }
      ok('pronto', true);
    },
  });
  S_['captura-casa'] = captura(8.5, 6.5); S_['captura-leste'] = captura(50, 22); S_['captura-sul'] = captura(20, 40); S_['captura-mapa'] = captura(40, 20, true); S_['captura-curral'] = captura(38, 26); S_['captura-coelheira'] = captura(52, 38); S_['captura-pasto'] = captura(55, 23);
  const capturaBichos = (cx, cy, kind) => ({
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), A = G.Animals, S = G.S, R = G.Rebanho; S.gold = 1e6; for (const id of ['portao', 'tesoura', 'coelheira', 'bebedouro']) R.buy(S, id);
      for (let i = 0; i < 5; i++) { R.buyAnimal(S, 'ovelha'); A.add('ovelha'); } for (let i = 0; i < 4; i++) { R.buyAnimal(S, 'coelho'); A.add('coelho'); }
      const sh = A.list.filter(a => a.kind === 'ovelha'); R.shear(S, 0); R.shear(S, 1); S.min = 9 * 60;
      G.P.x = cx * 64; G.P.y = cy * 64; for (let i = 0; i < 150; i++) A.update(.1, S); for (let i = 0; i < 12; i++) G.step(.05);
      G.cam.x = Math.max(0, cx * 64 - 640); G.cam.y = Math.max(0, cy * 64 - 400); G.step(.05); ok('pronto', true);
    },
  });
  const capturaCompras = (cx, cy) => ({
    seed() { T.reset(); },
    async run() {
      await bootReady(); const G = await startNew(0), A = G.Animals, S = G.S, R = G.Rebanho; S.gold = 1e6;
      for (const g of R.GEAR) { const n = g.kind === 'count' ? g.max : 1; for (let i = 0; i < n; i++) R.buy(S, g.id); } A.syncGear(G.solid, G.MW, S);
      for (let i = 0; i < 4; i++) { R.buyAnimal(S, 'ovelha'); A.add('ovelha'); } for (let i = 0; i < 6; i++) { R.buyAnimal(S, 'coelho'); A.add('coelho'); }
      S.min = 9 * 60; G.P.x = cx * 64; G.P.y = cy * 64; for (let i = 0; i < 100; i++) A.update(.1, S); for (let i = 0; i < 10; i++) G.step(.05);
      G.cam.x = Math.max(0, cx * 64 - 640); G.cam.y = Math.max(0, cy * 64 - 400); G.step(.05); ok('pronto', true);
    },
  });
  S_['captura-pasto-cheio'] = capturaCompras(55, 24); S_['captura-coelheira-cheia'] = capturaCompras(53, 38);
  S_['captura-ovelhas'] = capturaBichos(54, 24); S_['captura-coelhos'] = capturaBichos(52, 38);

  /* ---------- Fase 1c: 3 slots ---------- */
  const card = n => document.querySelector('.slotCard[data-slot="' + n + '"]');
  const cardText = n => card(n).textContent;
  const clickCard = async n => { card(n).click(); await wait(100); };
  const sel = () => [...document.querySelectorAll('.slotCard.sel')].map(c => +c.dataset.slot);
  const diff = (a, b, p = 'S', out = []) => {          // caminhos em que a e b diferem
    if (a === b) return out;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) { out.push(p); return out; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p + '.' + k, out);
    return out;
  };

  S_['slots-cartoes'] = {          // 3 cartões: ok / ilegível / vazio; escolher um cartão troca os botões e o aviso; nada é alterado
    seed() { T.reset(); T.setSlot(1, validSave(5, 500)); T.setSlot(2, '{lixo'); },
    async run() {
      await bootReady(); const raw1 = T.slotRaw(1);
      ok('3 cartões', document.querySelectorAll('.slotCard').length === 3);
      ok('cartão 1: Dia 5 e 500', cardText(1).includes('Dia 5') && cardText(1).includes('500'), cardText(1));
      ok('cartão 2: save ilegível', cardText(2).includes('ilegível'), cardText(2)); ok('cartão 3: vazio', cardText(3).includes('Vazio'), cardText(3));
      ok('abre no 1º jogo existente (cartão 1 selecionado, aria-pressed)', sel().join() === '1' && card(1).getAttribute('aria-pressed') === 'true' && card(2).getAttribute('aria-pressed') === 'false');
      ok('slot 1: Continuar e Apagar visíveis, sem aviso', vis('btnContinue') && vis('btnDelete') && !vis('saveProblem'));
      await clickCard(2);
      ok('slot 2 (ilegível): aviso visível, sem Continuar, com Apagar e Baixar', sel().join() === '2' && vis('saveProblem') && !vis('btnContinue') && vis('btnDelete') && vis('btnSpExport'));
      ok('o aviso é do slot 2: "corrompido"', $('spMsg').textContent.includes('corrompido'), $('spMsg').textContent);
      ok('o ilegível ganhou 1 cópia; o slot 2 não foi alterado', T.copies().length === 1 && T.copies()[0].raw === '{lixo' && T.slotRaw(2) === '{lixo');
      await clickCard(3);
      ok('slot 3 (vazio): sem aviso (há outros jogos), sem Continuar, sem Apagar', sel().join() === '3' && !vis('saveProblem') && !vis('btnContinue') && !vis('btnDelete'));
      $('btnNew').click(); await wait(100);
      ok('Novo jogo num slot vazio vai direto à escolha do personagem (sem confirmar)', vis('charSelect') && !vis('confirmNew'));
      $('btnBack').click(); await clickCard(1);
      ok('voltar ao slot 1: Continuar de volta, slot 1 intacto', vis('btnContinue') && T.slotRaw(1) === raw1);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-nome-hostil'] = {          // o cartão mostra o nome de um arquivo de terceiros SEM interpretar HTML
    seed() {
      T.reset(); window.__xss = undefined;
      T.setSlotState(1, Object.assign(T.fixtureState('save_v1_atual'), { char: 'fazendeiro', names: { fazendeiro: '<img src=x onerror="window.__xss=1">Zé', fazendeira: 'Ana' } }));
      const raw = T.slotRaw(1), env = JSON.parse(raw); env.summary = { name: '<img src=x onerror="window.__xss=2">', day: 777, gold: 888777 }; T.setSlot(1, JSON.stringify(env));
    },
    async run() {
      await bootReady(); await wait(300);
      ok('o cartão 1 existe e mostra o save', cardText(1).includes('Dia'), cardText(1));
      ok('nenhum <img> do arquivo virou elemento (só o retrato do personagem)', [...card(1).querySelectorAll('img')].every(i => /\/front(_walk)?\.png$/.test(i.getAttribute('src'))), card(1).innerHTML);
      ok('nenhum <b>/<i> do arquivo virou elemento', !card(1).querySelector('i') && card(1).querySelectorAll('b').length === 1, card(1).innerHTML);
      ok('o script do nome NÃO rodou', window.__xss === undefined, window.__xss);
      ok('o texto do cartão não tem "<"', !cardText(1).includes('<'), cardText(1));
      ok('o resumo adulterado do arquivo foi ignorado: o cartão mostra o dia/ouro do ESTADO', !cardText(1).includes('777') && cardText(1).includes('Dia ' + T.slotState(1).day + ' ·'), cardText(1));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-independentes'] = {          // o jogo do slot 2 carrega, grava SÓ no slot 2 e vira o "último jogado"
    seed() { T.reset(); T.setSlotState(2, Object.assign(T.fixtureState('save_v1_atual'), { day: 7, gold: 700 })); },
    async run() {
      await bootReady();
      ok('com só o slot 2 salvo, ele já vem selecionado', sel().join() === '2' && vis('btnContinue'), sel().join());
      ok('slots 1 e 3 vazios', cardText(1).includes('Vazio') && cardText(3).includes('Vazio'));
      $('btnContinue').click(); const G = await gameReady(true);
      ok('carregou o jogo do slot 2 (dia 7, ouro 700)', G.S.day === 7 && G.S.gold === 700, G.S.day + '/' + G.S.gold);
      ok('o título da aba é sempre "FAZENDA LAS" (sem o nome do personagem)', document.title === 'FAZENDA LAS', document.title);
      G.closeModal(); G.S.gold = 811; const r = G.save(); ok('salvou', r.ok);
      ok('gravou no slot 2 (envelope com slot=2, ouro 811)', T.slotEnv(2).slot === 2 && T.slotState(2).gold === 811 && T.slotState(2).rev >= 1, JSON.stringify(T.slotEnv(2) && T.slotEnv(2).slot));
      ok('slots 1 e 3 continuam vazios', T.slotRaw(1) === null && T.slotRaw(3) === null);
      ok('o slot 2 é o último jogado (meta)', T.lastSlot() === 2, T.lastSlot());
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-novo-em-outro'] = {          // Novo jogo num slot vazio não toca no jogo do slot 1 (nem cria cópia)
    seed() { T.reset(); T.setSlot(1, validSave(5, 500)); },
    async run() {
      await bootReady(); const raw1 = T.slotRaw(1);
      await clickCard(2); $('btnNew').click(); await wait(100);
      ok('slot vazio: vai direto à escolha', vis('charSelect')); document.querySelectorAll('.charCard')[1].click(); const G = await gameReady();
      ok('jogo novo iniciou (dia 1, fazendeira)', G.S.day === 1 && G.S.char === 'fazendeira', G.S.day + '/' + G.S.char);
      const r = G.save(true); ok('salvou', r.ok);
      ok('gravou no slot 2 (slot=2, dia 1)', T.slotEnv(2) && T.slotEnv(2).slot === 2 && T.slotState(2).day === 1);
      ok('o jogo do slot 1 está BYTE a BYTE igual', T.slotRaw(1) === raw1);
      ok('nenhuma cópia (não havia nada a substituir)', T.copies().length === 0, T.copies().length);
      ok('o slot 2 é o último jogado', T.lastSlot() === 2);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-apagar'] = {          // Apagar guarda cópia antes, pede confirmação, só mexe no slot escolhido; vale também para um slot ilegível
    seed() { T.reset(); T.setSlot(1, validSave(5, 500)); T.setSlot(2, validSave(6, 600)); T.setSlot(3, '{lixo'); },
    async run() {
      await bootReady(); const raw1 = T.slotRaw(1), raw2 = T.slotRaw(2), raw3 = T.slotRaw(3);
      await clickCard(2); $('btnDelete').click(); await wait(100);
      ok('pede confirmação citando o Jogo 2 e a cópia', vis('confirmDel') && $('delMsg').textContent.includes('Jogo 2') && $('delMsg').textContent.includes('cópia'), $('delMsg').textContent);
      ok('nada foi apagado ainda', T.slotRaw(2) === raw2);
      $('btnDelNo').click(); await wait(50); ok('Cancelar fecha a confirmação e mantém o jogo', !vis('confirmDel') && T.slotRaw(2) === raw2);
      $('btnDelete').click(); await wait(50); $('btnDelYes').click(); await wait(150);
      ok('slot 2 apagado', T.slotRaw(2) === null && T.slotRaw(2 + ':bak') === null);
      ok('ficou uma cópia idêntica ao jogo apagado', T.copies().some(c => c.raw === raw2), T.copies().length);
      ok('slots 1 e 3 intactos', T.slotRaw(1) === raw1 && T.slotRaw(3) === raw3);
      ok('cartão 2 agora é "Vazio" e a confirmação fechou', cardText(2).includes('Vazio') && !vis('confirmDel') && !vis('btnDelete'));
      await clickCard(3); ok('o slot ilegível também pode ser apagado (Apagar visível)', vis('btnDelete') && vis('saveProblem'));
      $('btnDelete').click(); await wait(50);
      ok('mensagem do ilegível', $('delMsg').textContent.includes('não pôde ser lido'), $('delMsg').textContent);
      $('btnDelYes').click(); await wait(150);
      ok('slot 3 apagado e o texto ilegível está numa cópia', T.slotRaw(3) === null && T.copies().some(c => c.raw === '{lixo'));
      ok('slot 1 continua intacto', T.slotRaw(1) === raw1);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-apagar-sem-espaco'] = {          // a cópia não cabe: avisa, oferece baixar e só apaga no 2º clique
    seed() { T.reset(); T.setSlot(1, validSave(5, 500)); T.setSlot(2, validSave(6, 600)); fillStorage(); },
    async run() {
      await bootReady(); const raw2 = T.slotRaw(2); await clickCard(2);
      $('btnDelete').click(); await wait(50); $('btnDelYes').click(); await wait(100);
      ok('avisa que NÃO coube a cópia e oferece baixar', $('delMsg').textContent.includes('Não foi possível guardar uma cópia') && $('btnDelYes').textContent === 'Apagar mesmo assim' && vis('btnDelDl'), $('delMsg').textContent);
      ok('nada foi apagado e nenhuma cópia criada', T.slotRaw(2) === raw2 && T.copies().length === 0);
      $('btnDelDl').click(); await wait(100); $('btnDelYes').click(); await wait(150);
      ok('só no 2º clique apaga', T.slotRaw(2) === null && T.slotRaw(1) !== null);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['continuar-pausado'] = {          // "Continuar" abre o jogo PAUSADO (menu aberto): o tempo só corre depois de fechar
    seed() { T.reset(); T.setMain(validSave(3, 300)); },
    async run() {
      await bootReady(); $('btnContinue').click(); const G = await gameReady(true);
      ok('o menu de pausa está aberto', vis('modal') && $('modalBox').textContent.includes('Pausa'), $('modalBox').textContent.slice(0, 30));
      ok('o menu tem "Trocar de jogo"', !!$('modalBox').querySelector('[data-a=switchslot]'));
      const m0 = G.S.min; await wait(1500); steps(G, 60);
      ok('com o menu aberto o relógio do jogo NÃO anda', G.S.min === m0, m0 + ' → ' + G.S.min);
      G.closeModal(); steps(G, 60);
      ok('fechado o menu, o tempo volta a correr', G.S.min > m0, m0 + ' → ' + G.S.min);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['legado-vai-para-slot1'] = {          // legado + jogo no slot 2: o legado vira o slot 1 e o slot 2 não muda
    seed() { T.reset(); T.setLegacy(validLegacy()); T.setSlot(2, validSave(9, 900)); },
    async run() {
      await bootReady(); const raw2 = T.slotRaw(2);
      ok('slot 1 importado do legado (schema 2, slot=1, dia 4)', T.slotEnv(1) && T.slotEnv(1).slot === 1 && T.slotState(1).day === 4, T.slotRaw(1) && T.slotRaw(1).slice(0, 60));
      ok('cartões: 1 = Dia 4, 2 = Dia 9, 3 vazio', cardText(1).includes('Dia 4') && cardText(2).includes('Dia 9') && cardText(3).includes('Vazio'));
      ok('slot 2 intacto e o legado também', T.slotRaw(2) === raw2 && T.readLegacy() === validLegacy());
      ok('abre no slot 1 (primeiro com jogo)', sel().join() === '1');
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  function validLegacy() { return T.validLegacyRaw(4, 400); }
  /* E2E com RECARGA REAL: novo jogo no slot 2 → jogar → "Trocar de jogo" (salva e recarrega) → o título abre no slot 2 → Continuar →
     o estado carregado é IGUAL, campo a campo, ao que estava gravado. A fase 1 guarda o que precisa no sessionStorage (sobrevive à recarga). */
  S_['e2e-recarrega'] = {
    seed() { if (sessionStorage.getItem('e2e_before')) return; T.reset(); },
    async run() {
      if (!sessionStorage.getItem('e2e_before')) {          // ---- fase 1 ----
        await bootReady(); await clickCard(2);
        const G = await startNew(1), S = G.S, A = G.Animals;
        S.gold = 1234; S.earned = 2500; S.goal = 1; S.up.basket = 1; S.eggs = 4; S.stone = 3; S.wood = 5; S.milk = 2; S.seeds.tomate = 6; S.harvest.cenoura = 3; S.names.fazendeira = 'Maria';
        for (const k of ['vaca', 'porco']) { while (S.owned[k] < 2) { S.owned[k]++; A.add(k); } }
        for (let x = 6; x <= 11; x++) for (let y = 8; y <= 9; y++) { S.soil[y * G.MW + x] = 2; S.crops[x + ',' + y] = { t: x % 2 ? 'cenoura' : 'tomate', age: 1 + (x % 3) }; }
        for (let i = 0; i < 2; i++) G.endDay(false);
        steps(G, 30); G.P.x = 9 * 64; G.P.y = 7 * 64; G.openMenu();            // pausa: o relógio não anda entre salvar e recarregar
        const r = G.save(); ok('fase 1: jogo novo no slot 2 jogado e salvo', r.ok && T.slotEnv(2).slot === 2 && T.slotRaw(1) === null);
        const before = T.slotState(2); ok('fase 1: dia ≥ 3, ouro 1234, 12 plantas', before.day >= 3 && before.gold === 1234 && Object.keys(before.crops).length === 12, before.day + '/' + before.gold);
        sessionStorage.setItem('e2e_before', JSON.stringify(before)); sessionStorage.setItem('e2e_tests', JSON.stringify(tests));
        $('modalBox').querySelector('[data-a=switchslot]').click();            // salva de novo e recarrega a página
        await wait(3000); ok('fase 1: a página NÃO recarregou (esperado recarregar)', false);
        return;
      }
      // ---- fase 2 (página recarregada) ----
      for (const t of JSON.parse(sessionStorage.getItem('e2e_tests'))) tests.push(t);
      const before = JSON.parse(sessionStorage.getItem('e2e_before')); delete before.rev;
      await bootReady();
      ok('fase 2: o título abriu no slot 2 (último jogado) com Continuar', sel().join() === '2' && vis('btnContinue') && cardText(2).includes('Maria'), sel().join() + ' | ' + cardText(2));
      $('btnContinue').click(); const G = await gameReady(true);
      ok('fase 2: começou pausado', vis('modal'));
      ok('fase 2: o título da aba continua "FAZENDA LAS" mesmo com o personagem renomeado para Maria', document.title === 'FAZENDA LAS', document.title);
      const d = diff(before, JSON.parse(JSON.stringify(G.S))); ok('fase 2: estado carregado IDÊNTICO ao gravado (campo a campo)', d.length === 0, d.slice(0, 8).join(', '));
      const r = G.save(); ok('fase 2: salvar de novo funciona', r.ok);
      const after = T.slotState(2); const rev = after.rev; delete after.rev;
      const d2 = diff(before, after); ok('fase 2: e o que foi regravado continua idêntico', d2.length === 0, d2.slice(0, 8).join(', '));
      ok('fase 2: o rev do slot só sobe (≥ 2)', rev >= 2, rev);
      ok('fase 2: o slot 1 nunca foi criado', T.slotRaw(1) === null);
      sessionStorage.removeItem('e2e_before'); sessionStorage.removeItem('e2e_tests');
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- revisão da 1c ---------- */
  const recoverable = () => {          // slot 1 DANIFICADO (crc errado) + versão anterior boa no bak ("recuperado"): guarda o texto do bak em window.__bak
    T.reset(); const st = T.fixtureState('save_v1_atual');
    st.rev = 4; st.gold = 1111; T.setBak(T.setMainState(st));
    st.rev = 5; st.gold = 2222; const env = JSON.parse(T.setMainState(st)); env.crc = '00000000'; T.setMain(JSON.stringify(env)); window.__bak = T.readBak();
  };
  S_['slots-apagar-recuperado'] = {          // Apagar um jogo "recuperado": a cópia guardada é a LEGÍVEL (o bak), não o texto danificado — e a confirmação não mente
    seed: recoverable,
    async run() {
      await bootReady();
      ok('o cartão 1 está como recuperado, com Continuar e Apagar', cardText(1).includes('recuperado') && vis('btnContinue') && vis('btnDelete'), cardText(1));
      $('btnDelete').click(); await wait(50); $('btnDelYes').click(); await wait(150);
      ok('slot 1 apagado (slot, bak e tmp)', T.slotRaw(1) === null && T.readBak() === null && T.readTmp() === null);
      ok('ficou uma cópia idêntica ao jogo LEGÍVEL (o bak)', T.copies().some(c => c.raw === window.__bak && c.state && c.state.gold === 1111), T.copies().length);
      ok('cartão 1 agora é "Vazio"', cardText(1).includes('Vazio'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['novo-jogo-recuperado'] = {          // Novo jogo por cima de um jogo "recuperado": o jogo legível (bak) vira cópia antes de ser substituído
    seed: recoverable,
    async run() {
      await bootReady(); $('btnNew').click(); await wait(100); ok('pede confirmação', vis('confirmNew'));
      $('btnYes').click(); await wait(100); document.querySelectorAll('.charCard')[0].click(); const G = await gameReady();
      ok('jogo novo iniciou (dia 1)', G.S.day === 1, G.S.day);
      ok('o jogo legível (bak, ouro 1111) está numa cópia', T.copies().some(c => c.raw === window.__bak), T.copies().length);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-trocar-futuro'] = {          // "Trocar de jogo" com o slot num save de versão mais nova: NÃO recarrega em silêncio; oferece baixar / sair mesmo assim
    seed() { T.reset(); },
    async run() {
      window.__alive = true; await bootReady(); const G = await startNew(); ok('save normal funciona', G.save().ok);
      const fut = JSON.stringify({ magic: 'fazenda_las-save', schema: SaveManager.SCHEMA + 1, rev: T.mainEnv().rev, data: { novo: 1 }, crc: 'x' }); T.setMain(fut);
      G.openMenu(); $('modalBox').querySelector('[data-a=switchslot]').click(); await wait(300);
      ok('a página NÃO recarregou e o jogo continua', window.__alive === true && !!window.__game);
      ok('mostra a escolha: Baixar cópia, Sair mesmo assim, Cancelar', vis('modal') && !!$('modalBox').querySelector('[data-a=leavedl]') && !!$('modalBox').querySelector('[data-a=leaveforce]') && $('modalBox').textContent.includes('versão mais nova'), $('modalBox').textContent.slice(0, 60));
      ok('o save futuro continua intacto', T.readMain() === fut);
      $('modalBox').querySelector('[data-a=close]').click(); await wait(100);
      ok('Cancelar fecha a escolha e o jogo segue', !vis('modal') && window.__alive === true);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['slots-trocar-conflito'] = {          // "Trocar de jogo" numa aba velha: mostra o aviso de outra aba (Recarregar / Usar esta aba) em vez de descartar o progresso
    seed() { T.reset(); },
    async run() {
      window.__alive = true; await bootReady(); const G = await startNew(); ok('save normal funciona', G.save().ok);
      T.setMainState(Object.assign(T.fixtureState('save_v1_atual'), { rev: 50 }));          // "outra aba" salvou depois
      G.openMenu(); $('modalBox').querySelector('[data-a=switchslot]').click(); await wait(300);
      ok('a página NÃO recarregou e o aviso de outra aba está visível', window.__alive === true && staleVisible());
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* N5 — título desatualizado: outra aba apaga/corrompe o slot DEPOIS de o cartão ser montado; "Continuar" não pode iniciar um jogo novo em silêncio */
  const continueStale = async () => {
    $('btnContinue').click(); await wait(300); await waitStart(() => !vis('busy'));
    if (window.__game) window.requestAnimationFrame = () => 0;      // se o defeito voltar e o jogo iniciar, congela o laço: o cenário FALHA limpo em vez de travar
    await wait(200);
  };
  S_['titulo-velho-apagado'] = {
    seed() { T.reset(); T.setMain(validSave(3, 300)); },
    async run() {
      fastRaf(); await bootReady();
      ok('o título mostra Continuar no jogo 1 (dia 3)', vis('btnContinue') && cardText(1).includes('Dia 3'), cardText(1));
      T.removeMain();                                           // "outra aba" apagou o jogo
      await continueStale();
      ok('NÃO iniciou jogo (nem novo)', !window.__game && vis('title'));
      ok('o slot continua vazio (nada foi gravado)', T.slotRaw(1) === null && T.copies().length === 0);
      ok('o cartão foi atualizado para "Vazio" e o Continuar sumiu', cardText(1).includes('Vazio') && !vis('btnContinue'), cardText(1));
      ok('avisa que o jogo mudou em outra aba', vis('saveProblem') && $('spMsg').textContent.includes('outra aba'), $('spMsg').textContent);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['titulo-velho-corrompido'] = {
    seed() { T.reset(); T.setMain(validSave(3, 300)); },
    async run() {
      fastRaf(); await bootReady();
      ok('o título mostra Continuar no jogo 1', vis('btnContinue'));
      T.setMain('{lixo');                                       // "outra aba"/cota corrompeu o slot
      await continueStale();
      ok('NÃO iniciou jogo (nem novo)', !window.__game && vis('title'));
      ok('o texto ilegível continua no slot (não foi sobrescrito)', T.readMain() === '{lixo', T.readMain());
      ok('a caixa de problema explica (corrompido) e há cópia guardada', vis('saveProblem') && $('spMsg').textContent.includes('corrompido') && T.copies().some(c => c.raw === '{lixo'), $('spMsg').textContent);
      ok('o cartão é "ilegível" e o Continuar sumiu', cardText(1).includes('ilegível') && !vis('btnContinue'), cardText(1));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- Fase 2a: exportar / importar arquivo ---------- */
  // Captura os downloads (Blob + <a download>) SEM baixar de verdade: devolve a lista { name, text() }.
  function captureDownloads() {
    const out = [], blobs = new Map(), create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { const u = create(b); blobs.set(u, b); return u; };
    HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = blobs.get(this.href); out.push({ name: this.download, text: () => b.text() }); } };
    return out;
  }
  // Escolhe um "arquivo" no seletor do título (o mesmo caminho do clique em Importar → escolher arquivo).
  // A leitura do arquivo (File.text()) é assíncrona de verdade e o tempo virtual corre mais rápido: por isso fecha a caixa ANTES e espera ela reaparecer
  // (senão a verificação lê a mensagem da rodada anterior).
  async function importText(text, filename = 'jogo.json') {
    $('btnXferNo').click();
    const dt = new DataTransfer(); dt.items.add(new File([text], filename, { type: 'application/json' }));
    $('fileImport').files = dt.files; $('fileImport').dispatchEvent(new Event('change'));
    let n = 0; while (!vis('xferBox') && n++ < 100) await wait(50);
    await wait(50);
  }
  const xferMsg = () => $('xferMsg').textContent, xferShown = () => vis('xferBox');
  const localDate = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const stripRev = st => { const c = JSON.parse(JSON.stringify(st)); delete c.rev; return c; };

  S_['export-titulo'] = {          // Exportar um cartão da tela de título: arquivo v2 íntegro do slot certo, nada é gravado
    seed() { T.reset(); T.setSlotState(2, Object.assign(T.fixtureState('save_v1_atual'), { day: 7, gold: 700, rev: 5 })); T.setSlot(3, '{lixo'); },
    async run() {
      const dl = captureDownloads(); await bootReady();
      ok('slot 2 já vem selecionado e tem Exportar', sel().join() === '2' && vis('btnExport') && vis('btnImport'));
      await clickCard(1); ok('cartão vazio: sem Exportar (Importar continua)', !vis('btnExport') && vis('btnImport'));
      await clickCard(3); ok('cartão ilegível: sem Exportar (há "Baixar cópia" no aviso)', !vis('btnExport') && vis('btnSpExport'));
      await clickCard(2); const before = T.snapshot(); $('btnExport').click(); await wait(200);
      ok('baixou 1 arquivo', dl.length === 1, dl.length);
      ok('nome fazenda-las-AAAA-MM-DD-slot2.json com a data LOCAL', dl[0] && dl[0].name === 'fazenda-las-' + localDate() + '-slot2.json', dl[0] && dl[0].name);
      const txt = await dl[0].text(), env = JSON.parse(txt);
      ok('o arquivo é um envelope íntegro (magic, schema atual, crc confere)', env.magic === 'fazenda_las-save' && env.schema === SaveManager.SCHEMA && SaveManager.format.inspect(txt).ok);
      ok('é o jogo do slot 2: slot=2, rev=5, dia 7, ouro 700', env.slot === 2 && env.rev === 5 && env.data.day === 7 && env.data.gold === 700, env.slot + '/' + env.rev + '/' + env.data.day + '/' + env.data.gold);
      ok('sem pt/pk nem v/rev dentro de data', !/"pt"|"pk"/.test(JSON.stringify(env.data.crops)) && !('v' in env.data) && !('rev' in env.data));
      ok('mostra a confirmação com o nome do arquivo', xferShown() && xferMsg().includes(dl[0].name) && !$('xferBox').classList.contains('err'), xferMsg());
      ok('exportar NÃO gravou nada no storage', T.snapshot() === before);
      $('btnXferNo').click(); ok('Entendi fecha a caixa', !xferShown());
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['export-pausa'] = {          // Exportar pelo menu de pausa: o jogo EM MEMÓRIA, mesmo numa aba velha (que não grava)
    seed() { T.reset(); },
    async run() {
      const dl = captureDownloads(); await bootReady(); const G = await startNew();
      G.S.gold = 4321; ok('salvou', G.save(true).ok); const stored = T.readMain(); G.S.gold = 4400;          // 4400 só existe na memória
      G.openMenu(); const btn = $('modalBox').querySelector('[data-a=export]'); ok('o menu tem o botão Exportar', !!btn);
      btn.click(); await wait(200);
      ok('baixou 1 arquivo fazenda-las-AAAA-MM-DD-slot1.json', dl.length === 1 && dl[0].name === 'fazenda-las-' + localDate() + '-slot1.json', dl.length && dl[0].name);
      let txt = await dl[0].text(), env = JSON.parse(txt);
      ok('envelope v2 íntegro com o estado EM MEMÓRIA (ouro 4400, slot 1)', SaveManager.format.inspect(txt).ok && env.slot === 1 && env.data.gold === 4400, env.data.gold);
      ok('avisa com um toast', toasts().some(t => t.includes('Jogo exportado')), toasts().join('|'));
      ok('exportar NÃO gravou: o slot continua com o ouro anterior', T.readMain() === stored);
      T.setMainState(Object.assign(T.fixtureState('save_v1_atual'), { rev: 50 }));          // "outra aba" salvou: esta aba vira velha
      ok('a aba agora é velha (não grava)', !G.save(true).ok);
      G.S.gold = 4500; G.openMenu(); $('modalBox').querySelector('[data-a=export]').click(); await wait(200);
      ok('mesmo assim exporta o jogo desta aba (saída de emergência)', dl.length === 2, dl.length);
      txt = await dl[1].text(); env = JSON.parse(txt); ok('com o ouro 4500', SaveManager.format.inspect(txt).ok && env.data.gold === 4500, env.data.gold);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['importar-invalido'] = {          // arquivo ruim: mensagem clara, NADA é gravado (nem cópia), nenhum botão de confirmar
    seed() { T.reset(); T.setSlot(1, validSave(3, 300)); },
    async run() {
      await bootReady(); const good = JSON.parse(validSave(9, 900)), tamper = JSON.parse(validSave(9, 900)); tamper.data.gold = 5;
      const cases = [
        ['arquivo vazio', '', 'vazio'], ['texto qualquer', '{lixo', 'não é um jogo salvo'], ['JSON que não é um objeto', '"abc"', 'não é um jogo salvo'],
        ['truncado', validSave(9, 900).slice(0, 200), 'não é um jogo salvo'], ['editado sem recalcular o crc', JSON.stringify(tamper), 'alterado'],
        ['versão futura', JSON.stringify(Object.assign({}, good, { schema: SaveManager.SCHEMA + 1 })), 'versão mais nova'], ['schema desconhecido', JSON.stringify(Object.assign({}, good, { schema: 0 })), 'não reconhece'],
        ['crc ok mas sem dados do mapa', JSON.stringify(SaveManager.format.wrap({ day: 1, soil: [] }, 1, 1)), 'incompleto'], ['grande demais (> 2 MB)', 'x'.repeat(2000001), 'grande demais'],
      ];
      const before = T.snapshot();
      for (const [label, text, frag] of cases) {
        await importText(text);
        ok(label + ': mostra erro (vermelho) citando "' + frag + '"', xferShown() && $('xferBox').classList.contains('err') && xferMsg().includes(frag), xferMsg());
        ok(label + ': diz que nada foi alterado e não oferece Importar', xferMsg().includes('Nada foi alterado') && !vis('btnXferYes') && !vis('xferSlotRow'));
        ok(label + ': NADA foi gravado (storage idêntico)', T.snapshot() === before);
        $('btnXferNo').click();
      }
      ok('o título continua intacto (cartão 1 com Continuar)', vis('btnContinue') && cardText(1).includes('Dia 3'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['importar-slots'] = {          // importar: destino padrão seguro, re-embrulha no slot escolhido, cópia ao substituir, rev continua, v1 solto aceito
    seed() { T.reset(); T.setSlot(1, validSave(3, 300)); },
    async run() {
      await bootReady(); const raw1 = T.slotRaw(1), rev1 = T.slotEnv(1).rev, snap0 = T.snapshot(), pick = $('xferSlot');
      await importText(validSave(9, 900));
      ok('mostra a confirmação com resumo do arquivo (Dia 9, 900) e escolha do destino', xferShown() && vis('xferSlotRow') && vis('btnXferYes') && xferMsg().includes('Dia 9') && xferMsg().includes('900'), xferMsg());
      ok('3 destinos: o 1 diz "será substituído", 2 e 3 "vazio"', pick.options.length === 3 && pick.options[0].textContent.includes('será substituído') && pick.options[1].textContent.includes('vazio') && pick.options[2].textContent.includes('vazio'), [...pick.options].map(o => o.textContent).join(' | '));
      ok('destino padrão = 1º slot VAZIO (o 1 está ocupado: nunca substitui sem o jogador escolher)', pick.value === '2', pick.value);
      ok('para um destino vazio, a mensagem não fala em substituir', !xferMsg().includes('substituído'));
      ok('ainda NADA foi gravado (só ao confirmar)', T.snapshot() === snap0);
      $('btnXferYes').click(); await wait(200);
      const e2 = T.slotEnv(2);
      ok('gravou no slot 2: envelope com slot=2 (o arquivo dizia 1), rev 1, dia 9, crc ok', e2 && e2.slot === 2 && e2.rev === 1 && e2.data.day === 9 && SaveManager.format.inspect(T.slotRaw(2)).ok, e2 && e2.slot + '/' + e2.rev);
      ok('o slot 1 está BYTE a BYTE igual e não houve cópia (o destino estava vazio)', T.slotRaw(1) === raw1 && T.copies().length === 0);
      ok('o título atualizou: cartão 2 selecionado com Dia 9, Continuar visível e mensagem de sucesso', sel().join() === '2' && cardText(2).includes('Dia 9') && vis('btnContinue') && xferMsg().includes('Jogo 2') && xferShown(), sel().join() + ' | ' + cardText(2));
      $('btnXferNo').click();
      // 2) por cima de um jogo existente (escolhido de propósito): cópia + rev continua
      await importText(validSave(11, 1100)); pick.value = '1'; pick.dispatchEvent(new Event('change'));
      ok('destino 1: avisa que será substituído e que fica uma cópia', xferMsg().includes('será substituído') && xferMsg().includes('cópia de segurança'), xferMsg());
      $('btnXferYes').click(); await wait(200);
      ok('slot 1 agora é o jogo do arquivo (dia 11) e o rev CONTINUOU (+1)', T.slotState(1).day === 11 && T.slotEnv(1).rev === rev1 + 1, T.slotEnv(1).rev + ' vs ' + rev1);
      ok('o jogo substituído ficou numa cópia idêntica', T.copies().some(c => c.raw === raw1), T.copies().length);
      ok('o slot 2 não foi tocado', T.slotEnv(2).data.day === 9); $('btnXferNo').click();
      // 3) save v1 solto (formato antigo) também importa — e sai como v2
      await importText(T.validLegacyRaw(4, 400)); ok('v1 solto aceito; destino padrão = slot 3 (o único vazio)', xferShown() && vis('btnXferYes') && pick.value === '3', xferMsg());
      $('btnXferYes').click(); await wait(200);
      ok('slot 3 é do schema atual (slot 3, crc ok), dia 4', T.slotEnv(3) && T.slotEnv(3).schema === SaveManager.SCHEMA && T.slotEnv(3).slot === 3 && SaveManager.format.inspect(T.slotRaw(3)).ok && T.slotState(3).day === 4);
      $('btnXferNo').click(); $('btnContinue').click(); const G = await gameReady(true);
      ok('Continuar no slot 3 abre o jogo importado (dia 4, ouro 400), pausado', G.S.day === 4 && G.S.gold === 400 && vis('modal'), G.S.day + '/' + G.S.gold);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['importar-sem-espaco'] = {          // a cópia do jogo substituído não cabe: avisa, oferece baixar, NÃO apaga; e se nem gravar couber, o slot fica intacto
    seed() { T.reset(); T.setSlot(1, validSave(3, 300)); },
    async run() {
      const dl = captureDownloads(); await bootReady(); const raw1 = T.slotRaw(1), pick = $('xferSlot');
      await importText(validSave(9, 900)); pick.value = '1'; pick.dispatchEvent(new Event('change'));
      fillStorage();
      $('btnXferYes').click(); await wait(200);
      ok('avisa que NÃO coube a cópia e oferece "Importar mesmo assim" e "Baixar cópia"', xferMsg().includes('Não foi possível guardar uma cópia') && $('btnXferYes').textContent === 'Importar mesmo assim' && vis('btnXferDl') && $('xferBox').classList.contains('err'), xferMsg());
      ok('o jogo atual continua intacto', T.slotRaw(1) === raw1);
      $('btnXferDl').click(); await wait(100);
      ok('Baixar cópia entrega o jogo que seria substituído (slot1-copia)', dl.length === 1 && /-slot1-copia\.json$/.test(dl[0].name) && (await dl[0].text()) === raw1, dl.length && dl[0].name);
      $('btnXferYes').click(); await wait(200);      // 2º clique: tenta mesmo assim, mas nem a gravação cabe
      ok('sem espaço nem para gravar: erro claro, nada alterado', xferShown() && $('xferBox').classList.contains('err') && xferMsg().includes('Sem espaço') && xferMsg().includes('Nada foi alterado'), xferMsg());
      ok('o slot 1 continua BYTE a BYTE igual (e sem resto de escrita em andamento)', T.slotRaw(1) === raw1 && T.readTmp() === null);
      unfillStorage();
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  /* E2E (acceptance da Fase 2): jogar → exportar → LIMPAR TUDO → recarregar → importar → estado idêntico, campo a campo. Recarga real; a fase 1 guarda o que precisa no sessionStorage. */
  S_['e2e-exporta-importa'] = {
    seed() { if (sessionStorage.getItem('e2e_exp')) return; T.reset(); },
    async run() {
      if (!sessionStorage.getItem('e2e_exp')) {          // ---- fase 1 ----
        const dl = captureDownloads(); await bootReady(); const G = await startNew(1), S = G.S, A = G.Animals;
        S.gold = 1234; S.earned = 2500; S.goal = 1; S.up.basket = 1; S.eggs = 4; S.stone = 3; S.wood = 5; S.milk = 2; S.seeds.tomate = 6; S.harvest.cenoura = 3; S.names.fazendeira = 'Maria';
        for (const k of ['vaca', 'porco']) { while (S.owned[k] < 2) { S.owned[k]++; A.add(k); } }
        for (let x = 6; x <= 11; x++) for (let y = 8; y <= 9; y++) { S.soil[y * G.MW + x] = 2; S.crops[x + ',' + y] = { t: x % 2 ? 'cenoura' : 'tomate', age: 1 + (x % 3) }; }
        for (let i = 0; i < 2; i++) G.endDay(false);
        steps(G, 30); G.P.x = 9 * 64; G.P.y = 7 * 64; G.openMenu(); ok('fase 1: salvou', G.save().ok);
        const before = T.mainState(); ok('fase 1: dia ≥ 3, ouro 1234, 12 plantas', before.day >= 3 && before.gold === 1234 && Object.keys(before.crops).length === 12, before.day + '/' + before.gold);
        $('modalBox').querySelector('[data-a=export]').click(); await wait(200);
        ok('fase 1: exportou 1 arquivo', dl.length === 1, dl.length); const txt = await dl[0].text();
        sessionStorage.setItem('e2e_exp', txt); sessionStorage.setItem('e2e_before', JSON.stringify(before)); sessionStorage.setItem('e2e_tests', JSON.stringify(tests));
        T.reset();          // "limpar dados do site": a aba aberta NÃO pode recriar o jogo ao recarregar (N4: save apagado por fora ⇒ aba velha, não grava)
        ok('fase 1: com o storage limpo esta aba recusa gravar (não ressuscita o jogo no pagehide)', !G.save().ok && T.slotRaw(1) === null);
        sessionStorage.setItem('e2e_tests', JSON.stringify(tests));
        location.reload(); await wait(3000); ok('fase 1: a página NÃO recarregou (esperado recarregar)', false);
        return;
      }
      // ---- fase 2 (página recarregada, storage VAZIO) ----
      for (const t of JSON.parse(sessionStorage.getItem('e2e_tests'))) tests.push(t);
      const txt = sessionStorage.getItem('e2e_exp'), before = stripRev(JSON.parse(sessionStorage.getItem('e2e_before')));
      await bootReady();
      ok('fase 2: o storage está mesmo vazio: 3 cartões vazios, sem Continuar', [1, 2, 3].every(n => T.slotRaw(n) === null && cardText(n).includes('Vazio')) && !vis('btnContinue') && T.copies().length === 0);
      const tampered = JSON.parse(txt); tampered.data.gold += 1; const snap = T.snapshot();
      await importText(JSON.stringify(tampered)); ok('fase 2: o arquivo ADULTERADO é recusado e nada é gravado', xferShown() && $('xferBox').classList.contains('err') && T.snapshot() === snap, xferMsg()); $('btnXferNo').click();
      await importText(txt);
      ok('fase 2: a confirmação mostra Maria e o ouro 1.234', xferShown() && xferMsg().includes('Maria') && xferMsg().includes('1.234'), xferMsg());
      $('btnXferYes').click(); await wait(250);
      const after = T.slotState(1), d1 = diff(before, stripRev(after)); ok('fase 2: o que foi gravado no slot 1 é IDÊNTICO ao jogo exportado (campo a campo)', !!after && d1.length === 0, d1.slice(0, 8).join(', '));
      ok('fase 2: continua um envelope íntegro, slot 1', T.mainSchema() === SaveManager.SCHEMA && T.mainCrcOk() && T.mainEnv().slot === 1);
      ok('fase 2: nenhuma cópia (não havia nada a substituir)', T.copies().length === 0);
      $('btnXferNo').click(); $('btnContinue').click(); const G = await gameReady(true);
      const d2 = diff(before, JSON.parse(JSON.stringify(G.S))); ok('fase 2: Continuar abre o jogo importado IDÊNTICO ao de antes de limpar tudo', d2.length === 0, d2.slice(0, 8).join(', '));
      ok('fase 2: abriu pausado e dá para salvar de novo', vis('modal') && G.save().ok);
      for (const k of ['e2e_exp', 'e2e_before', 'e2e_tests']) sessionStorage.removeItem(k);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- Fase 2b: indicador de salvamento, storage indisponível, persist(), backup nas metas ---------- */
  const ind = () => $('saveInd').dataset.state, bannerKind = () => vis('saveBanner') ? $('saveBanner').dataset.kind : null;
  const quotaThrow = () => { throw new DOMException('cheio', 'QuotaExceededError'); };

  S_['indicador-salvamento'] = {          // ✓ / ⚠ no HUD + faixa "exporte agora" quando não salva; some quando volta; aba velha = amarelo
    seed() { T.reset(); },
    async run() {
      const dl = captureDownloads(); await bootReady();
      ok('armazenamento saudável: nenhum aviso na tela inicial', !vis('storageWarn'));
      const G = await startNew();
      ok('começa "ok" e sem faixa', ind() === 'ok' && bannerKind() === null, ind());
      ok('salvar: continua ok e o título diz a hora', G.save().ok && ind() === 'ok' && $('saveInd').title.includes('salvo às'), $('saveInd').title);
      const orig = Storage.prototype.setItem; Storage.prototype.setItem = quotaThrow;          // o navegador recusa gravar (cota)
      try {
        clearToasts(); ok('o save falha', !G.save(true).ok);
        ok('indicador vermelho e faixa de falha', ind() === 'bad' && bannerKind() === 'fail', ind() + '/' + bannerKind());
        ok('a faixa diz que não está salvando e manda exportar', $('sbMsg').textContent.includes('NÃO está sendo salvo') && $('sbMsg').textContent.includes('Exporte'), $('sbMsg').textContent);
        ok('o título do indicador explica e aponta o menu', $('saveInd').title.includes('NÃO está sendo salvo') && $('saveInd').title.includes('menu'), $('saveInd').title);
        G.S.gold = 4242; $('sbExport').click(); await wait(200);
        const txt = dl.length ? await dl[0].text() : '';
        ok('"Exportar agora" baixa o jogo EM MEMÓRIA (ouro 4242), mesmo sem conseguir gravar', dl.length === 1 && SaveManager.format.inspect(txt).ok && JSON.parse(txt).data.gold === 4242, dl.length);
        $('sbClose').click(); ok('Dispensar esconde a faixa', bannerKind() === null);
        G.save(true); ok('dispensada: não reaparece enquanto continua falhando (o indicador segue vermelho)', bannerKind() === null && ind() === 'bad');
        Storage.prototype.setItem = orig; clearToasts();
        ok('volta a salvar', G.save().ok);
        ok('indicador ok, faixa some e avisa "restabelecido"', ind() === 'ok' && bannerKind() === null && toasts().some(t => t.includes('restabelecido')), ind() + '/' + toasts().join('|'));
        Storage.prototype.setItem = quotaThrow; G.save(true);
        ok('falhou de novo depois de restabelecer: a faixa REAPARECE (a dispensa valia só para a falha anterior)', bannerKind() === 'fail' && ind() === 'bad');
      } finally { Storage.prototype.setItem = orig; }
      ok('salvar de novo limpa tudo', G.save().ok && ind() === 'ok' && bannerKind() === null);
      const o = T.mainState(); o.rev += 5; const rawO = T.setMainState(o); T.fireStorage(rawO);          // "outra aba" salvou: o navegador avisa pelo evento `storage`
      ok('evento storage: o indicador fica AMARELO assim que o jogo roda, sem esperar o próximo save', (steps(G, 3), ind() === 'warn' && bannerKind() === null), ind());
      G.closeModal();          // o aviso "outra aba" abriu sozinho
      ok('aba velha: save recusado, indicador amarelo e sem faixa de falha', !G.save().ok && ind() === 'warn' && bannerKind() === null, ind());
      ok('o título do indicador explica a aba velha', $('saveInd').title.includes('outra aba'), $('saveInd').title);
      ok('clicar no indicador abre o menu de pausa (onde está o Exportar)', ($('saveInd').click(), vis('modal') && $('modalBox').textContent.includes('Pausa')));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['storage-aviso-boot'] = {          // modo privado / dados do site bloqueados: avisa JÁ na abertura e o jogo começa com o aviso de falha
    seed() { T.reset(); const boom = () => { throw new DOMException('blocked', 'SecurityError'); }; for (const m of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) Storage.prototype[m] = boom; },
    async run() {
      await bootReady();
      ok('aviso de armazenamento visível na tela inicial', vis('storageWarn'));
      ok('explica (modo privado/bloqueado), diz que dá para jogar e exportar', $('swMsg').textContent.includes('modo privado') && $('swMsg').textContent.includes('Exportar'), $('swMsg').textContent);
      ok('o aviso NÃO impede de jogar (Novo jogo habilitado)', !$('btnNew').disabled);
      $('btnSwClose').click(); ok('Entendi fecha o aviso', !vis('storageWarn'));
      const G = await startNew();
      ok('o jogo já começa com o indicador vermelho e a faixa de falha', ind() === 'bad' && bannerKind() === 'fail', ind() + '/' + bannerKind());
      ok('o jogo roda sem exceção', (steps(G, 30), !window.__errs.length), window.__errs.join('|'));
    },
  };
  S_['storage-cheio-aviso'] = {          // cota REAL cheia na abertura: o aviso diz "sem espaço", não "modo privado"
    seed() { T.reset(); fillStorage(); },
    async run() {
      try {
        await bootReady();
        ok('aviso de armazenamento visível', vis('storageWarn'));
        ok('fala de falta de espaço', $('swMsg').textContent.includes('Sem espaço'), $('swMsg').textContent);
        ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
      } finally { unfillStorage(); }
    },
  };
  function persistScenario(mode) {          // persist(): só depois da 1ª interação, uma vez, e o menu mostra o resultado
    return {
      seed() {
        T.reset(); window.__persistCalls = 0;
        const st = mode === 'sem-api' ? {} : { persisted: async () => false, persist: async () => { window.__persistCalls++; return mode === 'concedido'; } };
        Object.defineProperty(navigator, 'storage', { value: st, configurable: true });
      },
      async run() {
        await bootReady(); await wait(150);
        ok('antes de qualquer interação NÃO pediu (o Firefox abriria uma pergunta no carregamento)', window.__persistCalls === 0, window.__persistCalls);
        document.dispatchEvent(new Event('pointerdown')); await wait(100); document.dispatchEvent(new Event('keydown')); document.dispatchEvent(new Event('pointerdown')); await wait(100);
        ok(mode === 'sem-api' ? 'sem a API: nada a pedir' : 'depois da 1ª interação pediu UMA vez', window.__persistCalls === (mode === 'sem-api' ? 0 : 1), window.__persistCalls);
        const G = await startNew(); G.openMenu(); const line = $('durLine') ? $('durLine').textContent : '';
        const want = { concedido: 'protegido', negado: 'pode apagar', 'sem-api': 'não informa' }[mode];
        ok('o menu mostra o estado do armazenamento: "' + want + '"', line.includes(want), line);
        ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
      },
    };
  }
  S_['persist-concedido'] = persistScenario('concedido');
  S_['persist-negado'] = persistScenario('negado');
  S_['persist-sem-api'] = persistScenario('sem-api');
  S_['backup-metas'] = {          // ao bater uma meta sugere exportar (faixa verde) — sem insistir, sem atropelar o aviso de falha
    seed() { T.reset(); },
    async run() {
      const dl = captureDownloads(); await bootReady(); const G = await startNew(), S = G.S;
      const reach = async (earned, wait_ = 4000) => { S.earned = earned; S.eggs = 3; G.sellAll(); await wait(wait_); };
      await reach(399, 100);
      ok('meta 1 atingida', S.goal === 1, S.goal); ok('a sugestão NÃO aparece na hora (deixa comemorar)', bannerKind() === null);
      await wait(4000);
      ok('depois de alguns segundos aparece a sugestão de backup (faixa verde) citando a meta', bannerKind() === 'tip' && $('sbMsg').textContent.includes('400') && $('sbMsg').textContent.includes('backup'), bannerKind() + ' ' + $('sbMsg').textContent);
      ok('o botão diz só "Exportar" e a faixa é a verde', $('sbExport').textContent === 'Exportar' && $('saveBanner').classList.contains('tip'));
      $('sbClose').click(); ok('Dispensar esconde', bannerKind() === null);
      const orig = Storage.prototype.setItem; Storage.prototype.setItem = quotaThrow;
      try {
        G.save(true); ok('falha de gravação: faixa vermelha', bannerKind() === 'fail');
        await reach(1499); ok('meta 2 atingida', S.goal === 2, S.goal);
        ok('o aviso de FALHA tem prioridade: a sugestão não o substitui', bannerKind() === 'fail', bannerKind());
        $('sbExport').click(); await wait(200); ok('exportar pela faixa de falha baixa o jogo', dl.length === 1, dl.length);
      } finally { Storage.prototype.setItem = orig; }
      ok('salvamento volta', G.save().ok && bannerKind() === null);
      await reach(3999); ok('meta 3 atingida', S.goal === 3, S.goal);
      ok('acabou de exportar: não insiste em outra sugestão', bannerKind() === null, bannerKind());
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };

  /* ---------- Fase 2c: bloqueio de jogo (Web Locks) ---------- */
  // OUTRA aba jogando, simulada no mesmo mundo falso de locks/canal (window.__fake, instalado pelo tests/lib.js): segura o bloqueio e, se `cooperative`, cede
  // quando recebe o pedido (como o jogo real faria depois de salvar). `release()` = a outra aba fechou · `lost` = o bloqueio dela foi roubado.
  const PLAY = 'fazenda_las-play', never = () => new Promise(() => { });
  function otherTab({ cooperative = false } = {}) {
    const F = window.__fake, ch = F.bus('fazenda_las'), o = { log: [], lost: false, released: false }; let free = null;
    o.release = () => { if (free) { o.released = true; free(); } };
    F.locks.request(PLAY, () => new Promise(r => { free = r; })).catch(() => { o.lost = true; });
    ch.onmessage = ev => {
      if (!ev.data || ev.data.t !== 'takeover') return;
      o.log.push(cooperative ? 'takeover' : 'takeover (ignorado)');
      if (cooperative) setTimeout(() => { o.release(); ch.postMessage({ t: 'released', from: 'outra' }); }, 30);
    };
    return o;
  }
  const waitVis = async (id, max = 300) => { let n = 0; while (!vis(id) && n++ < max) await wait(100); return vis(id); };
  const lockSeed = (extra) => { T.reset(); T.setMainState(Object.assign(T.fixtureState('save_v1_atual'), { rev: 3 })); extra && extra(); window.__snap = T.snapshot(); };

  S_['lock-bloqueada'] = {          // outra aba já joga: esta NÃO inicia nem grava; "Assumir aqui" faz a outra salvar e ceder
    seed() { lockSeed(() => { window.__other = otherTab({ cooperative: true }); }); },
    async run() {
      const o = window.__other;
      ok('aparece a tela "já está aberto em outra aba"', await waitVis('lockOverlay') && $('lkTitle').textContent.includes('já está aberto'), $('lkTitle').textContent);
      ok('só "Assumir aqui" (sem Recarregar nem Baixar)', vis('lkTake') && !vis('lkReload') && !vis('lkDl'));
      ok('o jogo NÃO iniciou: título travado (botões desabilitados)', $('btnNew').disabled && !window.__game);
      ok('esta aba não leu nem gravou nada (storage idêntico, sem chave de sonda)', T.snapshot() === window.__snap);
      ok('estado do bloqueio: na fila, sem permissão de gravar', SaveManager.playLock.state() === 'waiting' && !SaveManager.playLock.allowed());
      const r = SaveManager.save({ day: 1 }); ok('mesmo chamando save() à força: recusado pela cerca (LockLost) e nada muda', r.ok === false && r.error.name === 'LockLost' && T.snapshot() === window.__snap);
      $('lkTake').click(); await bootReady();
      ok('a outra aba recebeu o pedido e cedeu', o.log.join() === 'takeover' && o.released, o.log.join());
      ok('a tela sumiu e o título carregou com o jogo salvo', !vis('lockOverlay') && vis('btnContinue') && !$('btnNew').disabled);
      ok('agora ESTA aba joga e pode gravar', SaveManager.playLock.state() === 'held' && SaveManager.playLock.allowed());
      $('btnContinue').click(); const G = await gameReady();
      ok('salva normalmente (rev continua: 3 → 4)', G.save().ok && T.mainState().rev === 4, T.mainState().rev);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['lock-silenciosa'] = {          // a outra aba não responde (congelada): depois do prazo esta ROUBA o bloqueio; a outra recebe "perdeu"
    seed() { lockSeed(() => { window.__other = otherTab({ cooperative: false }); }); },
    async run() {
      const o = window.__other; await waitVis('lockOverlay');
      $('lkTake').click(); await bootReady();
      ok('o pedido foi enviado e ignorado', o.log.join() === 'takeover (ignorado)', o.log.join());
      ok('depois do prazo esta aba tomou o bloqueio e a outra o perdeu', SaveManager.playLock.state() === 'held' && o.lost && !o.released, SaveManager.playLock.state() + '/' + o.lost);
      ok('a tela sumiu e o título está pronto', !vis('lockOverlay') && vis('btnContinue'));
      $('btnContinue').click(); const G = await gameReady(); ok('esta aba salva', G.save().ok);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['lock-fecha-sozinha'] = {          // a outra aba é fechada: esta entra sozinha, sem clicar e sem roubar
    seed() { lockSeed(() => { window.__other = otherTab({ cooperative: true }); }); },
    async run() {
      const o = window.__other; ok('bloqueada no início', await waitVis('lockOverlay'));
      o.release(); await bootReady();
      ok('entrou sozinha: sem pedido de "assumir" e sem roubo', o.log.length === 0 && !o.lost && !vis('lockOverlay') && SaveManager.playLock.state() === 'held', o.log.join());
      $('btnContinue').click(); const G = await gameReady(); ok('joga e salva', G.save().ok);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['lock-cede'] = {          // ESTA aba joga e outra pede o jogo: salva ANTES de soltar, para, avisa e nunca mais grava
    seed() { T.reset(); },
    async run() {
      const dl = captureDownloads(); await bootReady(); const G = await startNew(); G.S.gold = 777;          // 777 só existe na memória
      const F = window.__fake, ch = F.bus('fazenda_las'), msgs = []; let atGrant = null, got = false;
      ch.onmessage = ev => msgs.push(ev.data.t);
      F.locks.request(PLAY, () => { got = true; atGrant = T.mainState(); return never(); });          // a outra aba espera na fila
      ch.postMessage({ t: 'takeover', from: 'outra' });
      let n = 0; while (!got && n++ < 100) await wait(50);
      ok('a outra aba recebeu o bloqueio', got);
      ok('ANTES de soltar, esta aba salvou o jogo (ouro 777 já estava no storage quando a outra assumiu)', !!atGrant && atGrant.gold === 777, atGrant && atGrant.gold);
      ok('avisou "liberei" pelo canal', msgs.includes('released'), msgs.join());
      ok('a tela explica (jogo aberto em outra aba) e oferece Recarregar e Baixar', vis('lockOverlay') && $('lkTitle').textContent.includes('aberto em outra aba') && vis('lkReload') && vis('lkDl') && !vis('lkTake'), $('lkTitle').textContent);
      ok('o indicador do HUD fica vermelho', ind() === 'bad');
      const snap = T.snapshot(), r = G.save(true);
      ok('save() recusado (LockLost) e o storage fica idêntico', r.ok === false && r.error.name === 'LockLost' && T.snapshot() === snap, r.error && r.error.name);
      window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); await wait(1000);
      ok('pagehide/beforeunload/autosave não gravam', T.snapshot() === snap);
      G.S.gold = 790; $('lkDl').click(); await wait(200);
      ok('"Baixar meu jogo" entrega o jogo da memória (ouro 790)', dl.length === 1 && JSON.parse(await dl[0].text()).data.gold === 790, dl.length);
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['lock-roubado'] = {          // outra aba tomou o jogo à força: esta para de gravar e oferece baixar o que estava na memória
    seed() { T.reset(); },
    async run() {
      const dl = captureDownloads(); await bootReady(); const G = await startNew(); ok('salvou', G.save().ok); G.S.gold = 888;
      const snap = T.snapshot(); window.__fake.locks.request(PLAY, { steal: true }, never);
      ok('aparece a tela "outra aba assumiu o jogo"', await waitVis('lockOverlay', 50) && $('lkTitle').textContent.includes('assumiu'), $('lkTitle').textContent);
      ok('oferece Baixar e Recarregar', vis('lkDl') && vis('lkReload') && !vis('lkTake'));
      ok('esta aba não está mais autorizada a gravar', !SaveManager.playLock.allowed() && SaveManager.playLock.state() === 'lost');
      const r = G.save(true); ok('save() recusado (LockLost), storage idêntico', r.ok === false && r.error.name === 'LockLost' && T.snapshot() === snap);
      $('lkDl').click(); await wait(200); ok('o arquivo baixado traz o que estava na memória (ouro 888)', dl.length === 1 && JSON.parse(await dl[0].text()).data.gold === 888, dl.length);
      ok('o aviso do HUD fica vermelho', ind() === 'bad');
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
    },
  };
  S_['lock-sem-api'] = {          // navegador sem Web Locks: nada de tela de bloqueio; vale só a defesa por rev
    seed() { T.reset(); Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); },
    async run() {
      await bootReady(); ok('sem tela de bloqueio', !vis('lockOverlay')); ok('estado "unsupported" e pode gravar', SaveManager.playLock.state() === 'unsupported' && SaveManager.playLock.allowed());
      const G = await startNew(); ok('joga e salva', G.save().ok && !!T.mainState());
      ok('a defesa por rev continua: outra aba salva → esta é velha', (T.setMainState(Object.assign(T.mainState(), { rev: 99 })), !G.save().ok && ind() === 'warn'));
      ok('sem erros JS', !window.__errs.length, window.__errs.join('|'));
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
