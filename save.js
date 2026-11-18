'use strict';
/* ============================================================
   SaveManager — persistência do FAZENDA LAS (script clássico, sem módulos ES; carregado ANTES do game.js).
   Único lugar do projeto que fala com `localStorage` (pelo adaptador no fim do arquivo).

   FASE 1b: formato v2 (envelope com `crc`), chaves `fazenda_las:v2:*`, escrita segura (tmp → verificar → bak → slot), leitura com
   fallback (slot → bak → tmp) e migração do legado `fazenda_leankar_*` (que NUNCA é apagado). Continua 1 slot (o slot 1); os 3 slots
   e a interface deles são a Fase 1c.

   Duas camadas (decisão D5):
     • AQUI (genérico, testável em Node com um adaptador falso — tests/save.test.js): envelope/crc, versões e migrações, escrita segura,
       `rev` e aba velha, cópias de segurança, configuração de áudio, importação do legado e o toolkit de sanitização (`kit()`).
     • NO JOGO (game.js): as REGRAS do estado, injetadas por `configure()`:
         hydrate(data)  dados já migrados → { status:'ok', state, repaired } | { status:'invalid', reason:'shape' }
         prepare(S)     copia para S o que vive fora dele (obstáculos, ovos, posição) — roda dentro do save, depois da checagem de `rev`
         persist(S)     devolve o objeto a serializar (sem estado transitório como `pt`/`pk`)

   Formato v2 (uma chave por slot):
     { magic:'fazenda_las-save', schema:2, app, slot, rev, savedAt, summary:{char,name,day,gold,earned}, data:{…estado…}, crc }
     `crc` = FNV-1a 32 bits de JSON.stringify(data): detecta corrupção/truncamento, NÃO é segurança. `v` e `rev` NÃO ficam em `data`.
   Formato v1 (legado): o estado "solto" com `v:1` e `rev` no topo. Ainda é LIDO (slot, cópias e chaves antigas), nunca mais gravado.

   Interface pública (tudo que o jogo usa):
     configure(rules) · kit() · deepMerge(defaults, save) · SCHEMA · format { MAGIC, wrap, inspect, fnv1a, keys }
     load()            → { status:'none' } | { status:'ok', state, repaired, rev, backedUp?, recovered?, imported?, persisted? }
                         | { status:'invalid', reason, raw, backedUp }      reason: json · crc · future · version · shape
     peek()            → { raw, rev } do que está gravado no slot (nunca lança)
     save(S)           → { ok:true } | { ok:false, error }   error.name: 'Conflict' (outra aba salvou/apagou depois) · 'FutureSchema' (o slot tem
                         um save de versão mais nova: nunca é sobrescrito) · erro do storage (cota, bloqueio)
     removeMain()      apaga slot + bak + tmp (o legado e as cópias ficam)
     copies            list() · add(raw) → bool · restore(cópia) → bool
     session           reset() · adopt(loaded) · startNew(prev) · takeOver() · isStale()
     cfg               load() · save(obj)           (música/efeitos)
     external(key, newValue)   o navegador avisa que OUTRA aba mudou o storage
   ============================================================ */

const SaveLib = (() => {
const SAVE_SCHEMA = 2, SAVE_MAGIC = 'fazenda_las-save', SAVE_APP = '2026.11.17', SAVE_SLOT = 1, SAVE_MAX_COPIES = 3;
const SAVE_NS = 'fazenda_las:v2:';
const SAVE_LEGACY = { main: 'fazenda_leankar_v1', mainOld: 'fazenda_elias_v1', cfg: 'fazenda_leankar_cfg', cfgOld: 'fazenda_elias_cfg', backup: 'fazenda_leankar_v1_backup' };
const SAVE_LEGACY_MAX_V = 1;                          // o formato "solto" (v1) nunca passou de v:1

/* FNV-1a 32 bits (vetores de teste: "" → 811c9dc5 · "a" → e40c292c · "foobar" → bf9cf968) */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/* JSON.parse que descarta `__proto__`/`constructor` (arquivo de terceiros não pode trocar o protótipo do estado — observação O1) */
const safeParse = raw => JSON.parse(raw, (k, v) => (k === '__proto__' || k === 'constructor') ? undefined : v);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const normRev = r => Number.isSafeInteger(r) && r >= 0 ? r : 0;
/* Deep merge dos DEFAULTS: objetos são mesclados recursivamente (chaves que faltam no save vêm do padrão), arrays e valores simples do save SUBSTITUEM o padrão.
   Não muta nenhum dos dois; ignora `__proto__`/`constructor`. Um valor do save de TIPO errado (ex.: string onde o padrão é objeto) entra como está: o sanitizador do jogo o corrige e conta. */
function deepMerge(base, src) {
  const out = Object.assign({}, base);
  if (!isObj(src)) return out;
  for (const k of Object.keys(src)) {
    if (k === '__proto__' || k === 'constructor') continue;
    out[k] = isObj(out[k]) && isObj(src[k]) ? deepMerge(out[k], src[k]) : src[k];
  }
  return out;
}

/* migrações de DADOS: schema N → N+1, funções PURAS (data → data). 1→2: o `v` e o `rev` do formato solto saem do estado (o rev vai para o envelope). */
const SAVE_MIGRATIONS = {
  1: data => { const d = Object.assign({}, data); delete d.v; delete d.rev; return d; },
};

/* `adapter` = { read(key) → string|null (lança se bloqueado), write(key, str) (lança em erro/cota), remove(key), keys() → string[] }
   `opts`    = { now() → ms, iso() → texto ISO }   (injetáveis só para testes) */
function createSaveManager(adapter, opts = {}) {
  const now = opts.now || (() => Date.now());
  const iso = opts.iso || (() => new Date().toISOString());
  const K = {
    slot: SAVE_NS + 'slot:' + SAVE_SLOT, bak: SAVE_NS + 'slot:' + SAVE_SLOT + ':bak', tmp: SAVE_NS + 'slot:' + SAVE_SLOT + ':tmp',
    meta: SAVE_NS + 'meta', cfg: SAVE_NS + 'cfg', copy: SAVE_NS + 'copy:',
  };
  let rules = null;
  function configure(r) { rules = r; }
  const need = () => { if (!rules) throw new Error('SaveManager.configure() não foi chamado'); return rules; };
  const readSafe = k => { try { const r = adapter.read(k); return r ? r : null; } catch (e) { return null; } };

  /* ---------- toolkit de sanitização (R3): cada chamada de `kit()` tem o seu contador de correções ---------- */
  function kit() {
    let repairs = 0;
    const bad = () => { repairs++; };
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const Pint = (o, k, lo, hi, def) => { const v = o[k], ok = Number.isFinite(v), nv = ok ? Math.max(lo, Math.min(hi, Math.floor(v))) : def; if (!ok || nv !== v) bad(); o[k] = nv; };   // estrito: conta se mudou
    const Pnum = (o, k, lo, hi, def) => { const v = o[k], ok = Number.isFinite(v); if (!ok) bad(); o[k] = ok ? Math.max(lo, Math.min(hi, v)) : def; };                        // folgado: só conta se não for número
    const clampInt = (v, def, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : def;
    const objOf = (v, keys, def) => { if (!isObj(v)) { bad(); v = Object.assign({}, def); } return Object.fromEntries(keys.map(k => [k, has(v, k) ? v[k] : def[k]])); };   // só as chaves conhecidas
    const pairs = (arr, max, okPair) => {
      if (!Array.isArray(arr)) { bad(); return []; }
      const out = [];
      for (const e of arr) { if (out.length >= max) { bad(); break; } if (Array.isArray(e) && okPair(e)) out.push([e[0], e[1]]); else bad(); }
      return out;
    };
    return { bad, isObj, has, Pint, Pnum, clampInt, objOf, pairs, repairs: () => repairs };
  }

  /* ---------- envelope: wrap / inspect / migrate / parse ---------- */
  function summarize(d) {
    const nm = isObj(d.names) && typeof d.names[d.char] === 'string' ? d.names[d.char] : null;
    return { char: d.char === undefined ? null : d.char, name: nm, day: d.day, gold: d.gold, earned: d.earned };
  }
  /* `rev` é o número FINAL desta gravação (quem chama soma 1). Tira `v`/`rev` do estado e carimba o `crc`. */
  function wrap(state, slot, rev) {
    const data = Object.assign({}, state); delete data.v; delete data.rev;
    // o crc é calculado sobre o `data` COMO O `inspect` O VÊ (depois do safeParse, que descarta `__proto__`/`constructor`): um save válido nunca vira "crc errado"
    return { magic: SAVE_MAGIC, schema: SAVE_SCHEMA, app: SAVE_APP, slot: slot || SAVE_SLOT, rev, savedAt: iso(), summary: summarize(data), data, crc: fnv1a(JSON.stringify(safeParse(JSON.stringify(data)))) };
  }
  /* Olha um texto SEM precisar das regras do jogo. { ok:true, kind:'v2'|'v1', schema, rev, data } ou { ok:false, reason } */
  function inspect(raw) {
    let o;
    try { o = safeParse(raw); } catch (e) { return { ok: false, reason: 'json' }; }
    if (!isObj(o)) return { ok: false, reason: 'json' };
    if (o.magic === SAVE_MAGIC) {
      const sc = o.schema;
      if (!Number.isInteger(sc) || sc < 1) return { ok: false, reason: 'version' };
      if (sc > SAVE_SCHEMA) return { ok: false, reason: 'future' };       // ANTES do crc: um save mais novo pode ter outro cálculo — não é "danificado"
      if (!isObj(o.data) || typeof o.crc !== 'string') return { ok: false, reason: 'json' };
      if (fnv1a(JSON.stringify(o.data)) !== o.crc) return { ok: false, reason: 'crc' };
      return { ok: true, kind: 'v2', schema: sc, rev: normRev(o.rev), data: o.data };
    }
    const v = o.v;                                                         // legado v1: o estado "solto"
    if (!Number.isInteger(v) || v < 1) return { ok: false, reason: 'version' };
    if (v > SAVE_LEGACY_MAX_V) return { ok: false, reason: 'future' };
    return { ok: true, kind: 'v1', schema: v, rev: normRev(o.rev), data: o };
  }
  function migrateData(ins) {                         // leva os dados até SAVE_SCHEMA; null se faltar migração
    let sc = ins.schema, d = ins.data;
    while (sc < SAVE_SCHEMA) {
      const fn = SAVE_MIGRATIONS[sc];
      if (!fn) return null;
      try { d = fn(d); } catch (e) { return null; }
      if (!isObj(d)) return null;
      sc++;
    }
    return d;
  }
  function parse(raw) {                               // texto → inspect → migrate → regras do jogo
    const ins = inspect(raw);
    if (!ins.ok) return { status: 'invalid', reason: ins.reason };
    const data = migrateData(ins);
    if (!data) return { status: 'invalid', reason: 'version' };
    let r;
    try { r = need().hydrate(data); }                 // as regras do jogo não podem derrubar a leitura: se lançarem, o save é tratado como "dados faltando"
    catch (e) { console.warn('hydrate lançou', e); return { status: 'invalid', reason: 'shape' }; }
    if (r.status === 'ok') r.rev = ins.rev;
    return r;
  }

  /* ---------- `rev`, aba velha e o save principal ---------- */
  /* R2 — aba velha NÃO sobrescreve aba nova. Cada gravação sobe `rev` (contador do slot). Esta aba lembra o `rev` que leu/gravou por último
     (`session.rev`); antes de gravar compara com o que está no storage: se for diferente, OUTRA aba salvou depois — esta aba para de salvar
     (`session.stale`) e o jogo pergunta ao jogador (recarregar, ou "usar esta aba" guardando antes uma cópia do que a outra salvou).
     N4: `session.known` = esta aba já leu ou gravou um save; se ele sumir do storage, outra aba o apagou (não ressuscitar).
     `active` = há um jogo em andamento nesta aba (o evento `storage` só importa então).
     `allowFuture` = o jogador escolheu "Novo jogo" por cima de um save de versão futura: vale só para o PRIMEIRO save do jogo novo (o que o substitui);
     um save futuro que apareça depois disso volta a ser protegido. */
  const session = { rev: 0, known: false, stale: false, active: false, allowFuture: false };

  /* `rev` do TEXTO (envelope v2 ou estado v1: o campo `rev` fica no topo nos dois): 0 se ausente/inválido; null se o texto não é JSON. É a
     ÚNICA normalização do `rev` (N2): leitura, conferência antes de gravar e evento `storage` usam esta função, então nunca divergem. */
  function revOfRaw(raw) {
    try { const o = JSON.parse(raw); return o ? normRev(o.rev) : 0; } catch (e) { return null; }
  }
  function storedInfo() {          // o que está no slot: { raw, rev }; rev === null se o texto não é JSON. Lança se o storage falhar.
    const raw = adapter.read(K.slot);
    return !raw ? { raw: null, rev: 0 } : { raw, rev: revOfRaw(raw) };      // texto vazio = ausente (igual ao load)
  }
  const peek = () => { try { return storedInfo(); } catch (e) { return { raw: null, rev: 0 }; } };
  const namedError = (name, msg) => { const e = new Error(msg); e.name = name; return e; };

  /* ---------- meta (marcadores do legado) ---------- */
  function readMeta() { try { const r = adapter.read(K.meta); const o = r === null ? {} : safeParse(r); return isObj(o) ? o : {}; } catch (e) { return {}; } }
  function setMeta(patch) { try { adapter.write(K.meta, JSON.stringify(Object.assign(readMeta(), patch))); return true; } catch (e) { return false; } }
  let legacyMainDone = false;      // cache: o marcador `legacyMain` já está gravado

  /* ---------- escrita segura (localStorage não tem transação) ----------
     1. tmp ← novo texto (se estourar a cota, o slot anterior continua intacto)   2. lê de volta e confere
     3. bak ← slot atual, SE ele for legível (nunca troca um bak bom por lixo)       4. slot ← novo texto   5. apaga tmp */
  function safeWrite(text, goodCurRaw) {                // goodCurRaw: o slot atual SE for legível (senão null: não troca um bak bom por lixo)
    try {
      adapter.write(K.tmp, text);
      if (adapter.read(K.tmp) !== text || !inspect(text).ok) throw new Error('verificação da gravação falhou');
      if (goodCurRaw !== null) { try { adapter.write(K.bak, goodCurRaw); } catch (e) { /* bak é redundância: sem espaço não impede salvar */ } }
      adapter.write(K.slot, text);
    } catch (e) {
      try { adapter.remove(K.tmp); } catch (e2) { /* ignora */ }
      throw e;
    }
    try { adapter.remove(K.tmp); } catch (e) { /* ignora */ }
  }

  // Grava o jogo. Devolve { ok: true } ou { ok: false, error }. O AVISO ao jogador (toast, throttle de 60 s) é do jogo.
  function save(S) {
    if (session.stale) return { ok: false, error: namedError('Conflict', 'este jogo foi salvo mais recentemente em outra aba') };
    try {
      const cur = storedInfo();
      const gone = cur.raw === null && session.known;                    // N4: outra aba apagou o save — esta aba não o ressuscita
      if (gone || (cur.raw !== null && cur.rev !== null && cur.rev !== session.rev)) {
        session.stale = true; console.warn(gone ? 'save recusado: o save foi apagado em outra aba' : 'save recusado: rev gravado', cur.rev, '≠ rev desta aba', session.rev);
        return { ok: false, error: namedError('Conflict', 'este jogo foi salvo mais recentemente em outra aba') };
      }
      const ins = cur.raw !== null ? inspect(cur.raw) : null;
      if (ins && !ins.ok && ins.reason === 'future' && !session.allowFuture) {      // save de versão MAIS NOVA no slot: nunca sobrescrever (só "Novo jogo" explícito)
        return { ok: false, error: namedError('FutureSchema', 'o save é de uma versão mais nova do jogo') };
      }
      if (ins && !ins.ok) copies.add(cur.raw);                              // vai gravar por cima de algo ilegível (json/crc/…): guarda antes
      need().prepare(S);
      const rev = session.rev + 1;
      safeWrite(JSON.stringify(wrap(need().persist(S), SAVE_SLOT, rev)), ins && ins.ok ? cur.raw : null);
      session.rev = rev; session.known = true; session.allowFuture = false;        // a permissão de sobrescrever um save futuro é de uma gravação só
      if (!legacyMainDone) legacyMainDone = readMeta().legacyMain === true || setMeta({ legacyMain: true });      // daqui em diante o legado não é mais consultado
    } catch (e) {
      console.warn('falha ao salvar', e);
      return { ok: false, error: e };
    }
    return { ok: true };
  }

  /* ---------- importação do legado (fazenda_leankar_* / fazenda_elias_*): LÊ, nunca apaga ---------- */
  function importLegacyCopies() {                     // uma vez: cópias antigas (…_backup_<ts>) e o save "elias" (quando o novo também existe) viram cópias v2
    if (readMeta().legacyCopies) return;
    let keys; try { keys = adapter.keys(); } catch (e) { return; }
    let found = 0;
    for (const k of keys) {
      if (k !== SAVE_LEGACY.backup && !k.startsWith(SAVE_LEGACY.backup + '_')) continue;
      const raw = readSafe(k); if (raw === null) continue;
      found++; copies.addAt(k === SAVE_LEGACY.backup ? 0 : +k.slice(SAVE_LEGACY.backup.length + 1) || 0, raw);
    }
    const a = readSafe(SAVE_LEGACY.main), b = readSafe(SAVE_LEGACY.mainOld);
    if (a !== null && b !== null && a !== b) { found++; copies.addAt(now(), b); }      // N3: o save antigo NÃO é apagado: vira cópia
    if (found) { pruneCopies(null); setMeta({ legacyCopies: true }); }
  }
  function loadLegacy(lr) {                           // slot vazio + legado presente (e ainda não importado): migra, sanitiza e grava o slot v2 (o original vira cópia se foi corrigido)
    const ins = inspect(lr), r = parse(lr);
    if (r.status === 'ok') {
      let persisted = false;
      // Legado que precisou de CORREÇÃO não grava o slot agora: o original vira cópia e o aviso "dados corrigidos" aparece ao jogar; o slot nasce no 1º save.
      if (!r.repaired) { try { adapter.write(K.slot, JSON.stringify(wrap(need().persist(r.state), SAVE_SLOT, r.rev))); persisted = true; setMeta({ legacyMain: true }); legacyMainDone = true; } catch (e) { /* sem espaço: segue só em memória; o 1º save grava */ } }
      r.imported = true; r.persisted = persisted;
      return r.repaired ? Object.assign(r, { backedUp: copies.add(lr) }) : r;
    }
    return Object.assign(r, { raw: lr, backedUp: copies.add(lr) });
  }

  /* Leitura do save. Nunca lança e distingue os casos:
       { status: 'none' }                                  não existe save
       { status: 'ok', state, repaired, rev, … }           save válido (com defaults aplicados). `repaired` = correções do sanitizador (o original vira cópia);
                                                           `recovered: 'bak'|'tmp'` = o slot estava danificado e foi recuperado (o danificado vira cópia);
                                                           `imported` = veio do legado (o slot v2 foi criado; `persisted:false` se não coube)
       { status: 'invalid', reason, raw, backedUp }        existe mas não dá para usar
     reason: json (corrompido) · crc (danificado) · future (versão mais nova que o jogo) · version (sem migração conhecida) · shape (dados faltando).
     Um save inválido NUNCA é alterado aqui: vai para uma cópia de segurança (as 3 mais recentes) e a tela inicial avisa o jogador. */
  function load() {
    let slotRaw;
    try { slotRaw = adapter.read(K.slot); slotRaw = slotRaw ? slotRaw : null; } catch (e) { return { status: 'none' }; }
    try { importLegacyCopies(); } catch (e) { /* o legado é opcional */ }
    const bakRaw = readSafe(K.bak), tmpRaw = readSafe(K.tmp);
    if (slotRaw === null && bakRaw === null && tmpRaw === null) {
      if (!readMeta().legacyMain) { const lr = readSafe(SAVE_LEGACY.main) || readSafe(SAVE_LEGACY.mainOld); if (lr !== null) return loadLegacy(lr); }
      return { status: 'none' };
    }
    const first = slotRaw !== null ? parse(slotRaw) : null;
    if (first && first.status === 'ok') return first.repaired ? Object.assign(first, { backedUp: copies.add(slotRaw) }) : first;
    if (first && first.reason === 'future') return Object.assign(first, { raw: slotRaw, backedUp: copies.add(slotRaw) });     // nunca "recupera" por cima de um save mais novo
    for (const [name, raw] of [['bak', bakRaw], ['tmp', tmpRaw]]) {                                                              // fallback: slot → bak → tmp
      if (raw === null) continue;
      const r = parse(raw);
      if (r.status !== 'ok') continue;
      const slotRev = slotRaw !== null ? revOfRaw(slotRaw) : null;
      r.rev = slotRev !== null ? slotRev : r.rev;                 // o rev do slot danificado: o 1º save depois não pode parecer "outra aba"
      r.recovered = name; r.backedUp = slotRaw !== null ? copies.add(slotRaw) : true;
      if (slotRaw === null) r.persisted = false;                    // não há slot: a sessão não pode achar que "outra aba o apagou" no 1º save
      return r;
    }
    const raw = slotRaw !== null ? slotRaw : (bakRaw !== null ? bakRaw : tmpRaw);
    return Object.assign(first || parse(raw), { raw, backedUp: copies.add(raw) });
  }
  function removeMain() { for (const k of [K.slot, K.bak, K.tmp]) { try { adapter.remove(k); } catch (e) { /* storage indisponível */ } } }

  const sessionApi = {
    reset() { session.rev = 0; session.known = false; session.stale = false; session.active = false; session.allowFuture = false; },       // início de uma partida
    adopt(loaded) { const ok = !!loaded && loaded.status === 'ok'; session.rev = ok ? loaded.rev : 0; session.known = ok && loaded.persisted !== false; session.active = true; },   // "Continuar" iniciou
    startNew(prev) { session.rev = prev.rev === null ? 0 : prev.rev; session.active = true; session.allowFuture = true; },           // jogo novo iniciou: continua a contagem do save substituído
    takeOver() {                                          // "Usar esta aba": guarda o que a outra aba salvou e assume o `rev` dela
      try { const cur = storedInfo(); if (cur.raw !== null) copies.add(cur.raw); session.rev = cur.rev === null ? 0 : cur.rev; } catch (e) { /* storage indisponível: save() avisa */ }
      session.stale = false; session.known = false;       // known=false: se a outra aba APAGOU o save, esta pode recriá-lo (foi escolha do jogador)
    },
    isStale: () => session.stale,
  };
  // outra aba mudou o storage: esta aba passa a ser a "velha" imediatamente (sem esperar o próximo save)
  function external(key, newValue) {
    if (!session.active) return;
    if (key === null || (key === K.slot && newValue === null)) { session.stale = true; return; }       // N4: outra aba apagou o save (Novo jogo) ou limpou os dados do site
    if (key !== K.slot) return;
    const r = revOfRaw(newValue); if (r === null || r !== session.rev) session.stale = true;
  }

  /* ---------- cópias de segurança (texto bruto: envelope v2 OU estado v1 legado) ---------- */
  const copyKey = ts => K.copy + ts;
  function listCopies() {            // mais recentes primeiro
    const out = [];
    try {
      for (const k of adapter.keys()) {
        if (!k.startsWith(K.copy)) continue;
        const raw = adapter.read(k);
        out.push({ key: k, ts: +k.slice(K.copy.length) || 0, raw, info: parse(raw) });
      }
    } catch (e) { /* storage indisponível */ }
    return out.sort((x, y) => y.ts - x.ts);
  }
  /* R4 — poda para SAVE_MAX_COPIES cópias sem perder a única cópia que dá para restaurar: descarta primeiro as ILEGÍVEIS (da mais antiga para a
     mais nova) e só depois as válidas (também da mais antiga); a cópia recém-criada e a cópia VÁLIDA mais recente nunca são descartadas. */
  function pruneCopies(keepKey) {
    const all = listCopies(), newestValid = all.find(b => b.info.status === 'ok');      // listCopies: mais recentes primeiro
    // N1: save de versão FUTURA/desconhecida não é lixo: é progresso de um jogo mais novo que este código não abre (JS antigo em cache). Ordem de descarte:
    // 0 = ilegível (json/crc/shape) · 1 = válida · 2 = futura/versão desconhecida — dentro de cada grupo, a mais antiga primeiro.
    const rank = b => b.info.status === 'ok' ? 1 : (b.info.reason === 'future' || b.info.reason === 'version') ? 2 : 0;
    const victims = all.filter(b => b.key !== keepKey && b !== newestValid).sort((x, y) => rank(x) - rank(y) || x.ts - y.ts);
    for (let n = all.length; n > SAVE_MAX_COPIES && victims.length; n--) adapter.remove(victims.shift().key);
  }
  const copies = {
    list: listCopies,
    add(j) {                                                                    // guarda uma cópia do texto `j`; true se guardou (ou já existia)
      if (!j) return true;                                                      // nada a guardar
      let t;
      try {
        if (listCopies().some(b => b.raw === j)) return true;                   // já guardado (o boot e o "Continuar" leem duas vezes)
        t = now(); while (adapter.read(copyKey(t)) !== null) t++;               // duas cópias no mesmo milissegundo não se sobrescrevem
        adapter.write(copyKey(t), j);
      } catch (e) { return false; }                                             // cota cheia: o texto ainda pode ser baixado da tela inicial
      try { pruneCopies(copyKey(t)); } catch (e) { /* poda é limpeza: a cópia JÁ está guardada */ }
      return true;
    },
    addAt(ts, raw) { if (!listCopies().some(b => b.raw === raw)) { let t = ts; while (adapter.read(copyKey(t)) !== null) t++; adapter.write(copyKey(t), raw); } },   // importação do legado (interna)
    restore(b) { try { adapter.write(K.slot, b.raw); return true; } catch (e) { return false; } },     // grava a cópia por cima do principal (texto bruto)
  };

  /* ---------- configuração de áudio (música/efeitos) ---------- */
  const cfg = {
    load() {                                          // v2; se não houver, migra a do legado (copia, não apaga)
      try {
        let r = adapter.read(K.cfg);
        if (r === null) { r = readSafe(SAVE_LEGACY.cfg) || readSafe(SAVE_LEGACY.cfgOld); if (r !== null) { try { adapter.write(K.cfg, r); } catch (e) { /* ignora */ } } }
        return r === null ? {} : safeParse(r);
      } catch (e) { return {}; }
    },
    save(obj) { try { adapter.write(K.cfg, JSON.stringify(obj)); } catch (e) { /* ignore */ } },
  };

  return { SCHEMA: SAVE_SCHEMA, configure, kit, deepMerge, load, peek, save, removeMain, copies, session: sessionApi, cfg, external,
    format: { MAGIC: SAVE_MAGIC, wrap, inspect, fnv1a, keys: K } };
}

return { create: createSaveManager, fnv1a, safeParse, deepMerge, SCHEMA: SAVE_SCHEMA, MAGIC: SAVE_MAGIC, LEGACY: SAVE_LEGACY };
})();

/* instância do navegador + adaptador: o ÚNICO ponto do projeto que toca `localStorage` */
const SaveManager = SaveLib.create({
  read: k => localStorage.getItem(k),
  write: (k, v) => localStorage.setItem(k, v),
  remove: k => localStorage.removeItem(k),
  keys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; },
});
if (typeof window !== 'undefined') window.addEventListener('storage', e => SaveManager.external(e.key, e.newValue));
if (typeof module !== 'undefined' && module.exports) module.exports = SaveLib;      // testes em Node: require('../save.js').create(adaptadorFalso)
