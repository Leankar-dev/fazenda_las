'use strict';
/* ============================================================
   SaveManager — persistência do FAZENDA LAS (script clássico, sem módulos ES; carregado ANTES do game.js).
   Único lugar do projeto que fala com `localStorage` (pelo adaptador no fim do arquivo).

   FASE 1b: formato v2 (envelope com `crc`), chaves `fazenda_las:v2:*`, escrita segura (tmp → verificar → bak → slot), leitura com
   fallback (slot → bak → tmp) e migração do legado `fazenda_leankar_*` (que NUNCA é apagado).
   FASE 1c: 3 SLOTS. O manager trabalha sempre no slot EM USO (`useSlot(n)`, começa no 1): load/save/peek/removeMain/copies.restore/external
   valem para ele, então o código de uma partida é o mesmo com 1 ou 3 slots. `slots()` lista os três para os cartões da tela de título.
   O legado (`fazenda_leankar_*`) só é importado para o slot 1. As cópias de segurança são de todos os slots (máx. 3 no total).

   Duas camadas (decisão D5):
     • AQUI (genérico, testável em Node com um adaptador falso — tests/save.test.js): envelope/crc, versões e migrações, escrita segura,
       `rev` e aba velha, cópias de segurança, configuração de áudio, importação do legado e o toolkit de sanitização (`kit()`).
     • NO JOGO (game.js): as REGRAS do estado, injetadas por `configure()`:
         hydrate(data)  dados já migrados → { status:'ok', state, repaired } | { status:'invalid', reason:'shape' }
         prepare(S)     copia para S o que vive fora dele (obstáculos, ovos, posição) — roda dentro do save, depois da checagem de `rev`
         persist(S)     devolve o objeto a serializar (sem estado transitório como `pt`/`pk`)

   Formato v2 (uma chave por slot: `fazenda_las:v2:slot:N`, N = 1–3; o `v2` é do FORMATO de armazenamento, o `schema` abaixo é o dos DADOS):
     { magic:'fazenda_las-save', schema:3, app, slot, rev, savedAt, summary:{char,name,day,gold,earned}, data:{…estado…}, crc }
     `crc` = FNV-1a 32 bits de JSON.stringify(data): detecta corrupção/truncamento, NÃO é segurança. `v` e `rev` NÃO ficam em `data`.
     schemas: 2 = mapa 46 × 34 · 3 = mapa 64 × 49 (o chão `soil` é remontado pela migração 2→3; ver SAVE_WORLD e SAVE_MIGRATIONS).
   Formato v1 (legado): o estado "solto" com `v:1` e `rev` no topo. Ainda é LIDO (slot, cópias e chaves antigas), nunca mais gravado.

   Interface pública (tudo que o jogo usa):
     configure(rules) · kit() · deepMerge(defaults, save) · SCHEMA · format { MAGIC, wrap, inspect, fnv1a, keys }
     load()            → { status:'none' } | { status:'ok', state, repaired, rev, backedUp?, recovered?, imported?, persisted? }
                         | { status:'invalid', reason, raw, backedUp }      reason: json · crc · future · version · shape
     useSlot(n)        muda o slot em uso (1–3) e começa uma sessão limpa · slot() o slot em uso · SLOTS = 3
     slots()           → [{ slot, status:'empty'|'ok'|'invalid', summary?, savedAt?, rev?, repaired?, recovered?, reason? }] dos 3 slots (nunca lança;
                         mesmos efeitos do load(): importa o legado no slot 1, guarda cópia do que estiver ilegível). `summary` vem do estado SANEADO.
     lastSlot()        o último slot jogado (gravado ao iniciar uma partida) ou null
     peek()            → { raw, rev } do que está gravado no slot (nunca lança)
     peekBest()        → { raw, rev } do texto que load() usaria (slot → bak → tmp): é ESTE que se copia antes de apagar (nunca lança)
     exportText(S)     → texto do save que seria gravado agora (para baixar quando não dá para gravar, ou "Exportar" na pausa; não grava)
     exportSlot(n)     → { ok:true, text, summary, recovered?, future? } | { ok:false, reason, raw? }   exporta o slot n (tela de título); sempre um envelope v2 íntegro
     inspectImport(t)  → { ok:true, state, summary, savedAt, repaired } | { ok:false, reason }   valida o texto de um arquivo SEM gravar (reason: empty · size · json · crc · future · version · shape)
     importInto(n, t, {force}) → { ok:true, rev, summary, repaired, backedUp } | { ok:false, reason:'nocopy'|'write'|<motivo do inspectImport> }   grava o arquivo no slot n
                         (re-embrulhado: slot=n, rev do slot +1), com cópia do jogo substituído antes; arquivo recusado = nada gravado
     save(S)           → { ok:true } | { ok:false, error }   error.name: 'Conflict' (outra aba salvou/apagou depois) · 'FutureSchema' (o slot tem
                         um save de versão mais nova: nunca é sobrescrito) · erro do storage (cota, bloqueio)
     removeMain()      apaga slot + bak + tmp (o legado e as cópias ficam); no slot 1 também encerra a importação do legado (não ressuscita). false se a cerca recusou
     probe()           → { ok:true } | { ok:false, error }   grava/lê/apaga uma chave de teste: storage indisponível (modo privado, bloqueado, cheio) já na abertura (2b)
     fence(fn)         instala a cerca de escrita: fn() → esta aba pode gravar? Sem permissão, save → error.name 'LockLost' e importInto → reason 'lock' (2c)
     (fora do manager: SaveLib.createDurability → persist() · SaveLib.createPlayLock → Web Locks + "Assumir aqui"; no navegador: SaveManager.durability / .playLock)
     copies            list() · add(raw) → bool · restore(cópia) → bool
     session           reset() · adopt(loaded) · startNew(prev) · takeOver() · isStale()
     cfg               load() · save(obj)           (música/efeitos)
     external(key, newValue)   o navegador avisa que OUTRA aba mudou o storage
   ============================================================ */

const SaveLib = (() => {
const SAVE_SCHEMA = 3, SAVE_MAGIC = 'fazenda_las-save', SAVE_APP = '2026.11.25', SAVE_SLOT = 1, SAVE_SLOTS = 3, SAVE_MAX_COPIES = 3;
const SAVE_IMPORT_MAX = 2000000;                      // caracteres: um jogo tem 5–20 KB; arquivo maior que isto não é um save (recusado sem nem tentar migrar)
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
const validIso = s => typeof s === 'string' && s.length <= 40 && Number.isFinite(Date.parse(s)) ? s : null;      // `savedAt` vem do arquivo: só vale se for uma data de verdade
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

/* O MAPA do jogo (tiles). Só o vetor `soil` depende dele: é indexado por y*largura+x, então crescer o mapa muda o significado dos índices. from = o mapa até o schema 2; to = o do schema 3
   (a fazenda dobrou de área, para leste e sul — a origem não mexe). game.js tem LEGACY_MW/LEGACY_MH/MW/MH; tests/build.test.js confere que são os mesmos números. */
const SAVE_WORLD = { from: [46, 34], to: [64, 49] };
/* migrações de DADOS: schema N → N+1, funções PURAS (data → data, sem alterar a entrada).
   1→2: o `v` e o `rev` do formato solto saem do estado (o rev vai para o envelope).
   2→3: o chão (`soil`) do mapa 46 × 34 é remontado, linha a linha, no mapa 64 × 49 (o que é novo começa 0 = sem arar); `world: 2` marca "terreno novo ainda por povoar" (o jogo gera as
        pedras/mato/frutíferas do terreno novo uma vez ao carregar e passa para 3). Um `soil` com outro tamanho NÃO é mexido: o jogo o recusa como "dados do mapa incompletos". */
const SAVE_MIGRATIONS = {
  1: data => { const d = Object.assign({}, data); delete d.v; delete d.rev; return d; },
  2: data => {
    const d = Object.assign({}, data), [fw, fh] = SAVE_WORLD.from, [tw, th] = SAVE_WORLD.to;
    if (Array.isArray(d.soil) && d.soil.length === fw * fh) {
      const out = new Array(tw * th).fill(0);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[y * tw + x] = d.soil[y * fw + x];
      d.soil = out;
    }
    d.world = 2;
    return d;
  },
};

/* `adapter` = { read(key) → string|null (lança se bloqueado), write(key, str) (lança em erro/cota), remove(key), keys() → string[] }
   `opts`    = { now() → ms, iso() → texto ISO }   (injetáveis só para testes) */
function createSaveManager(adapter, opts = {}) {
  const now = opts.now || (() => Date.now());
  const iso = opts.iso || (() => new Date().toISOString());
  /* SLOTS (Fase 1c): `cur` é o slot em uso (1–3); `slot`/`bak`/`tmp` de `K` sempre apontam para ele. Todas as funções abaixo (load/save/peek/removeMain/
     copies.restore/external) trabalham no slot em uso, então o código de uma partida não muda com 1 ou 3 slots. `useSlot(n)` troca; `slots()` lista os três. */
  let cur = SAVE_SLOT;
  const K = { slot: '', bak: '', tmp: '', meta: SAVE_NS + 'meta', cfg: SAVE_NS + 'cfg', copy: SAVE_NS + 'copy:', why: SAVE_NS + 'why:' };
  const pointTo = n => { cur = n; K.slot = SAVE_NS + 'slot:' + n; K.bak = K.slot + ':bak'; K.tmp = K.slot + ':tmp'; };
  pointTo(SAVE_SLOT);
  const validSlot = n => Number.isInteger(n) && n >= 1 && n <= SAVE_SLOTS;
  function withSlot(n, fn) { const prev = cur; pointTo(n); try { return fn(); } finally { pointTo(prev); } }      // síncrono: nada mais roda enquanto as chaves apontam para `n`
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
      return { ok: true, kind: 'v2', schema: sc, rev: normRev(o.rev), savedAt: validIso(o.savedAt), data: o.data };
    }
    const v = o.v;                                                         // legado v1: o estado "solto"
    if (!Number.isInteger(v) || v < 1) return { ok: false, reason: 'version' };
    if (v > SAVE_LEGACY_MAX_V) return { ok: false, reason: 'future' };
    return { ok: true, kind: 'v1', schema: v, rev: normRev(o.rev), savedAt: null, data: o };
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
    if (r.status === 'ok') { r.rev = ins.rev; r.savedAt = ins.savedAt; }
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
  /* O texto que o jogo PERDERIA se o slot fosse apagado: o mesmo que load() usaria (slot legível ou futuro → senão bak → senão tmp → senão o primeiro que existir).
     peek() só olha o slot, e removeMain() apaga também bak/tmp: com o slot danificado ou ausente, copiar só o peek() guardava lixo (ou nada) e destruía o único jogo legível. Nunca lança. */
  function peekBest() {
    try {
      const s = readSafe(K.slot), b = readSafe(K.bak), t = readSafe(K.tmp), first = s !== null ? parse(s) : null;
      if (first && (first.status === 'ok' || first.reason === 'future')) return { raw: s, rev: revOfRaw(s) };
      for (const raw of [b, t]) if (raw !== null && parse(raw).status === 'ok') return { raw, rev: revOfRaw(raw) };
      const raw = s !== null ? s : (b !== null ? b : t);
      return raw === null ? { raw: null, rev: 0 } : { raw, rev: revOfRaw(raw) };
    } catch (e) { return { raw: null, rev: 0 }; }
  }
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

  /* ---------- cerca de escrita (Fase 2c) ----------
     `fence(fn)`: o navegador (game.js) instala uma função que diz se ESTA aba pode gravar (hoje: "tenho o bloqueio de jogo?" — Web Locks, §6.7).
     Aba sem permissão NUNCA grava: save, importInto e removeMain recusam (`LockLost` / `reason:'lock'`) sem tocar no storage. Só leituras e cópias de
     segurança (proteção, não progresso) continuam. Sem cerca instalada (testes antigos, navegador sem Web Locks) nada muda: vale só a defesa por `rev`. */
  let gate = null;
  const fence = fn => { gate = typeof fn === 'function' ? fn : null; };
  const fenced = () => { try { return !!gate && !gate(); } catch (e) { return false; } };      // uma cerca que lança não pode travar o jogo: a defesa por `rev` continua

  /* ---------- sonda do storage (Fase 2b) ----------
     Grava, lê e apaga uma chave de teste: pega modo privado / dados do site bloqueados / cota cheia JÁ NA ABERTURA (antes de o jogador perder progresso).
     { ok:true } | { ok:false, error }. Não deixa nada para trás (e não toca em save nenhum). */
  function probe() {
    const key = SAVE_NS + 'probe', val = 'ok:' + now();
    try {
      adapter.write(key, val);
      const back = adapter.read(key);
      try { adapter.remove(key); } catch (e) { /* uma chave minúscula que ficou não é um problema */ }
      return back === val ? { ok: true } : { ok: false, error: namedError('ProbeMismatch', 'o navegador não devolveu o que foi gravado') };
    } catch (e) {
      try { adapter.remove(key); } catch (e2) { /* ignora */ }
      return { ok: false, error: e };
    }
  }

  // Grava o jogo. Devolve { ok: true } ou { ok: false, error }. O AVISO ao jogador (toast, throttle de 60 s) é do jogo.
  function save(S) {
    if (fenced()) return { ok: false, error: namedError('LockLost', 'outra aba está com o jogo aberto: esta aba não grava') };
    if (session.stale) return { ok: false, error: namedError('Conflict', 'este jogo foi salvo mais recentemente em outra aba') };
    try {
      const curInfo = storedInfo();
      const gone = curInfo.raw === null && session.known;                    // N4: outra aba apagou o save — esta aba não o ressuscita
      if (gone || (curInfo.raw !== null && curInfo.rev !== null && curInfo.rev !== session.rev)) {
        session.stale = true; console.warn(gone ? 'save recusado: o save foi apagado em outra aba' : 'save recusado: rev gravado', curInfo.rev, '≠ rev desta aba', session.rev);
        return { ok: false, error: namedError('Conflict', 'este jogo foi salvo mais recentemente em outra aba') };
      }
      const ins = curInfo.raw !== null ? inspect(curInfo.raw) : null;
      if (ins && !ins.ok && ins.reason === 'future' && !session.allowFuture) {      // save de versão MAIS NOVA no slot: nunca sobrescrever (só "Novo jogo" explícito)
        return { ok: false, error: namedError('FutureSchema', 'o save é de uma versão mais nova do jogo') };
      }
      if (ins && !ins.ok) copies.add(curInfo.raw, 'invalid');                              // vai gravar por cima de algo ilegível (json/crc/…): guarda antes
      need().prepare(S);
      const rev = session.rev + 1;
      safeWrite(JSON.stringify(wrap(need().persist(S), cur, rev)), ins && ins.ok ? curInfo.raw : null);
      session.rev = rev; session.known = true; session.allowFuture = false;        // a permissão de sobrescrever um save futuro é de uma gravação só
      if (cur === SAVE_SLOT && !legacyMainDone) legacyMainDone = readMeta().legacyMain === true || setMeta({ legacyMain: true });      // o legado é do slot 1: gravar nele encerra a importação (gravar nos outros não)
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
      found++; copies.addAt(k === SAVE_LEGACY.backup ? 0 : +k.slice(SAVE_LEGACY.backup.length + 1) || 0, raw, 'legacy');
    }
    const a = readSafe(SAVE_LEGACY.main), b = readSafe(SAVE_LEGACY.mainOld);
    if (a !== null && b !== null && a !== b) { found++; copies.addAt(now(), b, 'replaced'); }      // N3: o save antigo NÃO é apagado: vira cópia
    if (found) { pruneCopies(null); setMeta({ legacyCopies: true }); }
  }
  function loadLegacy(lr) {                           // slot vazio + legado presente (e ainda não importado): migra, sanitiza e grava o slot v2 (o original vira cópia se foi corrigido)
    const ins = inspect(lr), r = parse(lr);
    if (r.status === 'ok') {
      let persisted = false;
      // Legado que precisou de CORREÇÃO não grava o slot agora: o original vira cópia e o aviso "dados corrigidos" aparece ao jogar; o slot nasce no 1º save.
      if (!r.repaired) { try { adapter.write(K.slot, JSON.stringify(wrap(need().persist(r.state), SAVE_SLOT, r.rev))); persisted = true; setMeta({ legacyMain: true }); legacyMainDone = true; } catch (e) { /* sem espaço: segue só em memória; o 1º save grava */ } }
      r.imported = true; r.persisted = persisted;
      return r.repaired ? Object.assign(r, { backedUp: copies.add(lr, 'repaired') }) : r;
    }
    return Object.assign(r, { raw: lr, backedUp: copies.add(lr, 'invalid') });
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
      if (cur === SAVE_SLOT && !readMeta().legacyMain) { const lr = readSafe(SAVE_LEGACY.main) || readSafe(SAVE_LEGACY.mainOld); if (lr !== null) return loadLegacy(lr); }
      return { status: 'none' };
    }
    const first = slotRaw !== null ? parse(slotRaw) : null;
    if (first && first.status === 'ok') return first.repaired ? Object.assign(first, { backedUp: copies.add(slotRaw, 'repaired') }) : first;
    if (first && first.reason === 'future') return Object.assign(first, { raw: slotRaw, backedUp: copies.add(slotRaw, 'future') });     // nunca "recupera" por cima de um save mais novo
    for (const [name, raw] of [['bak', bakRaw], ['tmp', tmpRaw]]) {                                                              // fallback: slot → bak → tmp
      if (raw === null) continue;
      const r = parse(raw);
      if (r.status !== 'ok') continue;
      const slotRev = slotRaw !== null ? revOfRaw(slotRaw) : null;
      r.rev = slotRev !== null ? slotRev : r.rev;                 // o rev do slot danificado: o 1º save depois não pode parecer "outra aba"
      r.recovered = name; r.backedUp = slotRaw !== null ? copies.add(slotRaw, 'invalid') : true;
      if (slotRaw === null) r.persisted = false;                    // não há slot: a sessão não pode achar que "outra aba o apagou" no 1º save
      return r;
    }
    const raw = slotRaw !== null ? slotRaw : (bakRaw !== null ? bakRaw : tmpRaw);
    return Object.assign(first || parse(raw), { raw, backedUp: copies.add(raw, 'invalid') });
  }
  function removeMain() {
    if (fenced()) return false;                                   // aba sem o bloqueio de jogo não apaga nada
    for (const k of [K.slot, K.bak, K.tmp]) { try { adapter.remove(k); } catch (e) { /* storage indisponível */ } }
    if (cur === SAVE_SLOT && !legacyMainDone) legacyMainDone = setMeta({ legacyMain: true });      // o jogador apagou o slot 1: o legado não pode ressuscitar nele
    return true;
  }

  /* ---------- slots ---------- */
  const lastSlot = () => { const n = readMeta().lastSlot; return validSlot(n) ? n : null; };
  const markLast = () => { if (lastSlot() !== cur) setMeta({ lastSlot: cur }); };      // o último slot jogado vira a seleção inicial da tela de título
  function useSlot(n) {                                 // muda o slot em uso e começa uma sessão limpa nele
    if (!validSlot(n)) throw new RangeError('slot inválido: ' + n);
    pointTo(n); sessionApi.reset();
  }
  /* Os 3 slots para os cartões da tela de título: { slot, status:'empty'|'ok'|'invalid', summary?, savedAt?, rev?, repaired?, recovered?, reason? }.
     Usa load() de cada slot, então tem os mesmos efeitos (importa o legado no slot 1, guarda cópia do que estiver ilegível). O resumo vem do ESTADO JÁ
     SANEADO (não do `summary` do arquivo, que é texto de terceiros). Nunca lança. */
  function slots() {
    const out = [];
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      out.push(withSlot(n, () => {
        let r; try { r = load(); } catch (e) { r = { status: 'invalid', reason: 'json' }; }
        if (r.status === 'ok') return { slot: n, status: 'ok', summary: summarize(r.state), savedAt: r.savedAt || null, rev: r.rev, repaired: r.repaired || 0, recovered: r.recovered || null, imported: !!r.imported };
        if (r.status === 'invalid') return { slot: n, status: 'invalid', reason: r.reason };
        return { slot: n, status: 'empty' };
      }));
    }
    return out;
  }

  /* Texto do save que SERIA gravado agora (para o jogador baixar quando não dá para gravar, ou pelo "Exportar" do menu de pausa). Não grava nada. */
  function exportText(S) { need().prepare(S); return JSON.stringify(wrap(need().persist(S), cur, session.rev + 1)); }

  /* ---------- exportar / importar arquivo (Fase 2a) ---------- */
  /* Exporta o jogo do slot `n` SEM precisar de partida em andamento (tela de título). Devolve o ESTADO já lido e saneado, re-embrulhado em envelope v2
     (mesmo que o slot tenha texto v1, ou tenha sido recuperado do bak): o arquivo é sempre um v2 íntegro. Não grava nada.
       { ok:true, text, summary, recovered?, future? }   `future`: o slot guarda um save de versão MAIS NOVA — o texto é o original, byte a byte
       { ok:false, reason:'empty' | json | crc | version | shape, raw? }      (o jogo oferece "Baixar cópia" do `raw` ilegível por outro caminho) */
  function exportSlot(n) {
    if (!validSlot(n)) throw new RangeError('slot inválido: ' + n);
    return withSlot(n, () => {
      let r; try { r = load(); } catch (e) { return { ok: false, reason: 'json' }; }
      if (r.status === 'ok') {
        const env = wrap(need().persist(r.state), n, r.rev);
        if (r.savedAt) env.savedAt = r.savedAt;                                  // a data do jogo, não a do clique em Exportar
        return { ok: true, text: JSON.stringify(env), summary: env.summary, recovered: r.recovered || null };
      }
      if (r.status === 'invalid' && r.reason === 'future' && r.raw) return { ok: true, text: r.raw, summary: null, future: true };      // cópia fiel: um jogo mais novo abre o arquivo
      return r.status === 'invalid' ? { ok: false, reason: r.reason, raw: r.raw } : { ok: false, reason: 'empty' };
    });
  }
  /* Valida o TEXTO de um arquivo (de terceiros!) sem gravar nada: tamanho → JSON → magic/schema/crc → migração → regras do jogo (hydrate).
       { ok:true, state, summary, savedAt, repaired }   `state` já saneado; `repaired` = quantos dados inválidos foram corrigidos
       { ok:false, reason: empty | size | json | crc | future | version | shape }
     O crc é FNV-1a: detecta arquivo danificado/editado à mão SEM recalcular o crc — não é segurança (quem recalcula o crc passa; o sanitizador cuida do resto). */
  function inspectImport(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
    if (text.length > SAVE_IMPORT_MAX) return { ok: false, reason: 'size' };
    const r = parse(text);
    if (r.status !== 'ok') return { ok: false, reason: r.reason || 'shape' };
    return { ok: true, state: r.state, summary: summarize(r.state), savedAt: r.savedAt || null, repaired: r.repaired || 0 };
  }
  /* Grava o arquivo no slot `n` (a tela de título já mostrou o resumo e pediu confirmação). Re-embrulha: o slot do envelope vira `n` e o `rev` continua o
     do slot (+1, D6: as outras abas notam a troca); o texto do arquivo NUNCA é gravado cru. Antes de sobrescrever, guarda cópia do que o slot tem (peekBest).
       { ok:true, rev, summary, repaired, backedUp }
       { ok:false, reason:'nocopy', raw }   não coube a cópia do jogo atual: nada foi alterado; repita com `{ force:true }` (o jogador escolhe perder o jogo atual)
       { ok:false, reason:'write', error }  o storage recusou (cota/bloqueio): o slot anterior continua intacto
       { ok:false, reason: empty | size | json | crc | future | version | shape }   arquivo recusado: NADA foi gravado */
  function importInto(n, text, opts = {}) {
    if (!validSlot(n)) throw new RangeError('slot inválido: ' + n);
    if (fenced()) return { ok: false, reason: 'lock' };           // aba sem o bloqueio de jogo não grava (2c)
    const ins = inspectImport(text);
    if (!ins.ok) return { ok: false, reason: ins.reason };
    return withSlot(n, () => {
      let best, slotRaw, backedUp = true;
      try {
        best = peekBest(); slotRaw = readSafe(K.slot);
        if (best.raw !== null) { backedUp = copies.add(best.raw, 'replaced'); if (!backedUp && !opts.force) return { ok: false, reason: 'nocopy', raw: best.raw }; }
        const curIns = slotRaw !== null ? inspect(slotRaw) : null;
        const rev = Math.max(slotRaw !== null ? normRev(revOfRaw(slotRaw)) : 0, normRev(best.rev)) + 1;
        const env = wrap(need().persist(ins.state), n, rev);
        if (ins.savedAt) env.savedAt = ins.savedAt;
        safeWrite(JSON.stringify(env), curIns && curIns.ok ? slotRaw : null);                      // o bak só troca por um slot legível; um save futuro ficou na cópia acima
        if (n === SAVE_SLOT && !legacyMainDone) legacyMainDone = readMeta().legacyMain === true || setMeta({ legacyMain: true });      // o slot 1 agora tem jogo: o legado não ressuscita nele
        return { ok: true, rev, summary: ins.summary, repaired: ins.repaired, backedUp };
      } catch (e) {
        console.warn('falha ao importar', e);
        return { ok: false, reason: 'write', error: e };
      }
    });
  }

  const sessionApi = {
    reset() { session.rev = 0; session.known = false; session.stale = false; session.active = false; session.allowFuture = false; },       // início de uma partida
    adopt(loaded) { const ok = !!loaded && loaded.status === 'ok'; session.rev = ok ? loaded.rev : 0; session.known = ok && loaded.persisted !== false; session.active = true; markLast(); },   // "Continuar" iniciou
    startNew(prev) { session.rev = prev.rev === null ? 0 : prev.rev; session.active = true; session.allowFuture = true; markLast(); },           // jogo novo iniciou: continua a contagem do save substituído
    takeOver() {                                          // "Usar esta aba": guarda o que a outra aba salvou e assume o `rev` dela
      if (fenced()) return;                               // sem o bloqueio de jogo não há o que assumir: quem decide é o Web Locks
      try { const cur = storedInfo(); if (cur.raw !== null) copies.add(cur.raw, 'stale'); session.rev = cur.rev === null ? 0 : cur.rev; } catch (e) { /* storage indisponível: save() avisa */ }
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
  /* MOTIVO da cópia (Fase 2): uma chave irmã `fazenda_las:v2:why:<ts>` (a cópia continua sendo o texto bruto, então a deduplicação e o legado não mudam).
     invalid = não dava para ler · repaired = o jogo foi corrigido ao abrir · replaced = substituído (Novo jogo / importar / restaurar) · deleted = apagado pelo jogador
     · stale = outra aba salvou por cima · future = save de versão mais nova · legacy = veio do formato antigo. Motivo desconhecido/ausente = null (nunca quebra). */
  const WHY = ['invalid', 'repaired', 'replaced', 'deleted', 'stale', 'future', 'legacy'];
  const whyKey = ts => K.why + ts;
  const readWhy = ts => { const w = readSafe(whyKey(ts)); return WHY.includes(w) ? w : null; };
  function listCopies() {            // mais recentes primeiro
    const out = [];
    try {
      for (const k of adapter.keys()) {
        if (!k.startsWith(K.copy)) continue;
        const raw = adapter.read(k);
        const ts = +k.slice(K.copy.length) || 0;
        out.push({ key: k, ts, raw, info: parse(raw), why: readWhy(ts) });
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
    for (let n = all.length; n > SAVE_MAX_COPIES && victims.length; n--) { const v = victims.shift(); adapter.remove(v.key); try { adapter.remove(whyKey(v.ts)); } catch (e) { /* ignora */ } }
    try { const live = new Set(all.map(b => whyKey(b.ts))); for (const k of adapter.keys()) if (k.startsWith(K.why) && !live.has(k)) adapter.remove(k); } catch (e) { /* motivo órfão é só lixo pequeno */ }
  }
  const copies = {
    list: listCopies,
    add(j, why) {                                                               // guarda uma cópia do texto `j` (com o MOTIVO, opcional); true se guardou (ou já existia)
      if (!j) return true;                                                      // nada a guardar
      let t;
      try {
        if (listCopies().some(b => b.raw === j)) return true;                   // já guardado (o boot e o "Continuar" leem duas vezes)
        t = now(); while (adapter.read(copyKey(t)) !== null) t++;               // duas cópias no mesmo milissegundo não se sobrescrevem
        adapter.write(copyKey(t), j);
      } catch (e) { return false; }
      if (WHY.includes(why)) { try { adapter.write(whyKey(t), why); } catch (e) { /* sem espaço para o motivo: a cópia vale igual */ } }                                             // cota cheia: o texto ainda pode ser baixado da tela inicial
      try { pruneCopies(copyKey(t)); } catch (e) { /* poda é limpeza: a cópia JÁ está guardada */ }
      return true;
    },
    addAt(ts, raw, why) { if (!listCopies().some(b => b.raw === raw)) { let t = ts; while (adapter.read(copyKey(t)) !== null) t++; adapter.write(copyKey(t), raw); if (WHY.includes(why)) { try { adapter.write(whyKey(t), why); } catch (e) { /* ignora */ } } } },   // importação do legado (interna)
    /* Restaura a cópia no slot EM USO. Só cópia LEGÍVEL (o jogo nunca oferece outra) e RE-EMBRULHADA, como a importação: slot = o do destino (a cópia pode ser de
       outro slot) e `rev` = o do slot + 1 (D6: as outras abas notam a troca). Nunca grava o texto cru. false: recusada (sem o bloqueio de jogo / ilegível / sem espaço). */
    restore(b) {
      if (fenced() || !b || !b.info || b.info.status !== 'ok') return false;
      try {
        const slotRaw = readSafe(K.slot), curIns = slotRaw !== null ? inspect(slotRaw) : null;
        const rev = Math.max(slotRaw !== null ? normRev(revOfRaw(slotRaw)) : 0, normRev(peekBest().rev), normRev(b.info.rev)) + 1;
        const env = wrap(need().persist(b.info.state), cur, rev);
        if (b.info.savedAt) env.savedAt = b.info.savedAt;
        safeWrite(JSON.stringify(env), curIns && curIns.ok ? slotRaw : null);
        if (cur === SAVE_SLOT && !legacyMainDone) legacyMainDone = readMeta().legacyMain === true || setMeta({ legacyMain: true });
        return true;
      } catch (e) { console.warn('falha ao restaurar a cópia', e); return false; }
    },
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

  return { SCHEMA: SAVE_SCHEMA, WORLD: SAVE_WORLD, SLOTS: SAVE_SLOTS, IMPORT_MAX: SAVE_IMPORT_MAX, configure, kit, deepMerge, load, peek, peekBest, exportText, exportSlot, inspectImport, importInto, save, removeMain, useSlot, slots, lastSlot, slot: () => cur, copies, session: sessionApi, cfg, external,
    probe, fence, format: { MAGIC: SAVE_MAGIC, wrap, inspect, fnv1a, keys: K } };
}

/* ============================================================
   Durabilidade do armazenamento (Fase 2b): `navigator.storage.persist()` pede ao navegador para NÃO apagar os dados do site quando faltar espaço
   (o Safari/iOS ainda apaga o que não é usado há ~7 dias; instalar como PWA e exportar continuam sendo a proteção de verdade). É "best-effort":
   o Chrome decide sozinho (engajamento), o Firefox pergunta ao jogador — por isso só se pede DEPOIS da 1ª interação, nunca no carregamento.
   `getStorage()` devolve o `navigator.storage` (ou null): injetado, então roda em Node.
     status()  → { supported, persisted }                      (não pede nada)
     request() → { supported, persisted, asked, error? }        (pede, no máximo uma vez por página; se já é persistente, não pergunta)
   ============================================================ */
function createDurability(getStorage) {
  const api = () => { try { const s = getStorage(); return s && typeof s.persist === 'function' ? s : null; } catch (e) { return null; } };
  const isPersisted = async s => { try { return typeof s.persisted === 'function' ? !!(await s.persisted()) : false; } catch (e) { return false; } };
  let asked = null;
  return {
    async status() { const s = api(); return s ? { supported: true, persisted: await isPersisted(s) } : { supported: false, persisted: false }; },
    request() {
      if (asked) return asked;
      asked = (async () => {
        const s = api(); if (!s) return { supported: false, persisted: false, asked: false };
        if (await isPersisted(s)) return { supported: true, persisted: true, asked: false };
        try { return { supported: true, persisted: !!(await s.persist()), asked: true }; }
        catch (e) { return { supported: true, persisted: false, asked: true, error: e }; }
      })();
      return asked;
    },
  };
}

/* ============================================================
   Bloqueio de jogo — Web Locks (Fase 2c, §6.7 do plano): prevenção contra DUAS abas jogando o mesmo jogo. Um bloqueio único para o site inteiro
   (`fazenda_las-play`): quem o tem joga e grava; a 2ª aba não inicia o jogo e oferece "Assumir aqui". A defesa por `rev` (aba velha) continua valendo
   por baixo — e é a única quando o navegador não tem Web Locks.
   Protocolo do "Assumir aqui" (BroadcastChannel `fazenda_las`): a aba bloqueada entra na fila do bloqueio e manda `takeover`; a aba que joga SALVA e PARA
   (`onYield`), libera o bloqueio e responde `released`. Sem resposta em `replyMs` (aba congelada) a aba nova ROUBA (`steal`): a antiga recebe `onLost`
   e não grava mais (o jogo oferece baixar o que estava na memória). O pedido leva `at`/`ttl`: uma dona que estava CONGELADA e acorda depois do prazo
   ignora o pedido (senão salvaria por cima do jogo de quem já roubou) — achado do teste com abas reais (tests/real-tabs.js).
   Tudo injetado (`env`) e lido na hora de usar, então testa em Node com um Web Locks falso:
     env = { locks() → LockManager|null, channel(nome) → BroadcastChannel|null, setTimeout, clearTimeout, AbortController, id }
   Estados: idle · waiting (na fila) · held (joga e grava) · released (cedeu) · lost (roubado) · unsupported (sem Web Locks: vale só o `rev`)
     acquire(ms)   → 'held' | 'blocked' | 'unsupported'   (espera até `ms` na fila — cobre a corrida de uma recarga em que a página antiga ainda não soltou)
                     'blocked': o pedido CONTINUA na fila: se a outra aba fechar, `whenAvailable()` resolve sozinho
     whenAvailable() → Promise<boolean>   resolve true quando o bloqueio chegar (depois de 'blocked')
     takeOver(ms)  → 'held' | 'failed'     pede para a aba dona ceder; sem resposta em `ms`, rouba
     release()     libera (cede) · allowed()  esta aba pode gravar? (held ou unsupported) · state()
     onYield(fn)   fn() async: chamada na aba dona quando outra pede o jogo (salvar e parar) · onLost(fn)  o bloqueio foi roubado
   ============================================================ */
const PLAY_LOCK = 'fazenda_las-play', PLAY_CHANNEL = 'fazenda_las';
function createPlayLock(env = {}) {
  const id = env.id || Math.random().toString(36).slice(2), now = () => (env.now || Date.now)();
  const later = (fn, ms) => (env.setTimeout || setTimeout)(fn, ms), cancel = t => (env.clearTimeout || clearTimeout)(t);
  const lm = () => { try { return env.locks ? env.locks() || null : null; } catch (e) { return null; } };
  let state = 'idle', current = null, chan = null, yielding = false;
  const on = { yield: null, lost: null };
  const fire = name => { try { if (on[name]) Promise.resolve(on[name]()).catch(e => console.warn('playLock.' + name + ' lançou', e)); } catch (e) { console.warn('playLock.' + name + ' lançou', e); } };

  function post(msg) { try { if (chan) chan.postMessage(Object.assign({ from: id }, msg)); } catch (e) { /* sem canal: o `steal` resolve */ } }
  function openChannel() {
    if (chan) return;
    try { chan = env.channel ? env.channel(PLAY_CHANNEL) : null; } catch (e) { chan = null; }
    if (chan) chan.onmessage = ev => {
      const m = ev && ev.data;
      if (!m || typeof m !== 'object' || m.from === id || m.t !== 'takeover' || state !== 'held') return;
      // Pedido VENCIDO (aba que estava congelada e acordou): quem pediu já esgotou o prazo e ROUBOU o bloqueio — salvar agora gravaria por cima do jogo dele.
      // Ignora; o aviso de "perdi o bloqueio" chega em seguida (onLost). Pedido sem `at`/`ttl` (outra versão do jogo) vale como novo.
      if (Number.isFinite(m.at) && Number.isFinite(m.ttl) && now() - m.at > m.ttl) return;
      yieldTo(m.from);
    };
  }
  async function yieldTo(to) {                         // outra aba pediu o jogo: salva e para (onYield), solta o bloqueio e avisa
    if (yielding) return; yielding = true;
    try { if (on.yield) await on.yield(); } catch (e) { console.warn('playLock.onYield lançou', e); }
    release(); post({ t: 'released', to }); yielding = false;
  }
  // um pedido ao LockManager; o bloqueio fica preso até `req.release()`. `granted` resolve quando concedido e rejeita se o pedido falhar ou for cancelado.
  function startRequest(steal) {
    const c = new (env.AbortController || AbortController)(), req = { c, done: false, release: null };
    req.granted = new Promise((resolve, reject) => {
      let p;
      try {
        p = lm().request(PLAY_LOCK, steal ? { steal: true } : { signal: c.signal }, () => new Promise(res => { req.release = res; req.done = true; if (current === req) state = 'held'; resolve(); }));
      } catch (e) { reject(e); return; }
      p.then(() => { /* soltamos nós mesmos */ }, e => {
        if (!req.done) reject(e);                                                // nunca concedido: erro ou cancelado
        else if (current === req) { current = null; state = 'lost'; fire('lost'); }      // concedido e depois quebrado: outra aba usou `steal`
      });
    });
    req.granted.catch(() => { /* quem espera trata; ninguém esperando não pode virar "unhandled rejection" */ });
    current = req; return req;
  }
  const race = (req, ms) => new Promise(resolve => {
    const t = later(() => resolve('timeout'), ms);
    req.granted.then(() => { cancel(t); resolve('held'); }, () => { cancel(t); resolve('error'); });
  });
  function release() {
    const r = current; if (!r || !r.done) return false;
    current = null; state = 'released'; try { r.release(); } catch (e) { /* ignora */ } return true;
  }

  return {
    id, state: () => state, allowed: () => state === 'held' || state === 'unsupported',
    onYield(fn) { on.yield = fn; }, onLost(fn) { on.lost = fn; },
    async acquire(ms = 1500) {
      if (state === 'held' || state === 'unsupported') return state;
      if (!lm()) { state = 'unsupported'; return 'unsupported'; }
      let req; try { req = startRequest(false); } catch (e) { current = null; state = 'unsupported'; return 'unsupported'; }
      state = 'waiting';
      const r = await race(req, ms);
      if (r === 'held') { openChannel(); return 'held'; }
      if (r === 'error') { current = null; state = 'unsupported'; return 'unsupported'; }      // ex.: SecurityError (contexto sem Web Locks): vale só o `rev`
      return 'blocked';
    },
    async whenAvailable() {
      const req = current; if (!req) return state === 'held';
      try { await req.granted; openChannel(); return true; } catch (e) { return false; }
    },
    async takeOver(ms = 3000) {
      if (state === 'held' || state === 'unsupported') return 'held';
      if (!lm()) { state = 'unsupported'; return 'held'; }
      openChannel();
      let req = current && state === 'waiting' ? current : startRequest(false);      // continua na fila que já existe: a ordem de chegada vale
      state = 'waiting';
      post({ t: 'takeover', at: now(), ttl: ms });                                   // `at`/`ttl`: a dona ignora o pedido se ele chegar depois do prazo (aba congelada que acorda)
      if (await race(req, ms) === 'held') return 'held';
      req.c.abort();                                                                // ninguém cedeu: rouba (a dona perde o bloqueio e recebe `onLost`)
      try { const s = startRequest(true); await s.granted; return 'held'; } catch (e) { current = null; state = 'idle'; return 'failed'; }
    },
    release,
  };
}

return { create: createSaveManager, createDurability, createPlayLock, fnv1a, safeParse, deepMerge, SCHEMA: SAVE_SCHEMA, WORLD: SAVE_WORLD, SLOTS: SAVE_SLOTS, MAGIC: SAVE_MAGIC, LEGACY: SAVE_LEGACY, PLAY_LOCK, PLAY_CHANNEL };
})();

/* instância do navegador + adaptador: o ÚNICO ponto do projeto que toca `localStorage` */
const SaveManager = SaveLib.create({
  read: k => localStorage.getItem(k),
  write: (k, v) => localStorage.setItem(k, v),
  remove: k => localStorage.removeItem(k),
  keys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; },
});
if (typeof window !== 'undefined') window.addEventListener('storage', e => SaveManager.external(e.key, e.newValue));
/* Fase 2b/2c — peças do navegador (tudo lido na hora de usar: `navigator.storage`, `navigator.locks` e `BroadcastChannel` podem faltar ou ser trocados nos testes) */
SaveManager.durability = SaveLib.createDurability(() => navigator.storage);
SaveManager.playLock = SaveLib.createPlayLock({
  locks: () => navigator.locks,
  channel: name => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null,
});
if (typeof module !== 'undefined' && module.exports) module.exports = SaveLib;      // testes em Node: require('../save.js').create(adaptadorFalso)
