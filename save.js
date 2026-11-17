'use strict';
/* ============================================================
   SaveManager — persistência do FAZENDA LAS (script clássico, sem módulos ES; carregado ANTES do game.js).

   FASE 1a (plano de persistência): este arquivo foi EXTRAÍDO do game.js sem mudar comportamento, formato nem chaves:
   continua o formato v1 (um save por chave) e as chaves legadas `fazenda_leankar_*`. A Fase 1b troca para envelope + `crc` +
   `fazenda_las:v2:*`. Único lugar do projeto que fala com `localStorage`.

   Duas camadas (decisão D5):
     • AQUI (genérico): chaves, leitura/gravação, `rev` e detecção de aba velha, cópias de segurança (poda R4/N1, restaurar R5),
       configuração de áudio, migração de versão e o toolkit de sanitização (`kit()`).
     • NO JOGO (game.js): as REGRAS do estado (defaults, forma mínima, faixas, espécies conhecidas…), injetadas por `configure()`:
         hydrate(s)  save já migrado → { status:'ok', state, repaired } | { status:'invalid', reason:'shape' }
         prepare(S)  copia para S o que vive fora dele (obstáculos, ovos, posição) — roda dentro do save, depois da checagem de `rev`
         persist(S)  devolve o objeto a serializar (sem estado transitório como `pt`/`pk`)

   Interface pública (tudo que o jogo usa):
     configure(rules) · VERSION · kit()
     load()            → { status:'none' } | { status:'ok', state, repaired, rev, backedUp? } | { status:'invalid', reason, raw, backedUp }
     peek()            → { raw, rev } do que está gravado (nunca lança)
     save(S)           → { ok:true } | { ok:false, error }   (error.name === 'Conflict' = outra aba salvou/apagou depois)
     removeMain()      apaga o save principal (storage indisponível = ignora)
     copies            list() · add(raw) → bool · restore(cópia) → bool
     session           reset() · adopt(loaded) · startNew(prev) · takeOver() · isStale()
     cfg               load() · save(obj)           (música/efeitos)
   ============================================================ */
const SaveManager = (() => {
  const VERSION = 1;                                  // versão do formato (v1 = o `v` dentro do save)
  const SAVE_KEY = 'fazenda_leankar_v1', CFG_KEY = 'fazenda_leankar_cfg';
  const BACKUP_KEY = SAVE_KEY + '_backup', MAX_BACKUPS = 3;
  const MIGRATIONS = {};                              // schema N → N+1: função pura (save → save). Vazio: só existe a versão 1.
  let rules = null;

  // jogo renomeado: fazenda_elias_* -> fazenda_leankar_* (move uma única vez). [N3, pendente para a 1b: se as duas chaves existem, a antiga é apagada sem cópia]
  (function migrateRenamedKeys() {
    try {
      for (const [oldK, newK] of [['fazenda_elias_v1', SAVE_KEY], ['fazenda_elias_cfg', CFG_KEY]]) {
        const old = localStorage.getItem(oldK); if (old === null) continue;
        if (localStorage.getItem(newK) === null) localStorage.setItem(newK, old);
        localStorage.removeItem(oldK);
      }
    } catch (e) { /* storage indisponível */ }
  })();

  function configure(r) { rules = r; }
  const need = () => { if (!rules) throw new Error('SaveManager.configure() não foi chamado'); return rules; };

  /* ---------- toolkit de sanitização (R3): cada chamada de `kit()` tem o seu contador de correções ---------- */
  function kit() {
    let repairs = 0;
    const bad = () => { repairs++; };
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
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

  /* ---------- leitura de um texto de save: JSON → versão → migração → regras do jogo ---------- */
  function parse(raw) {
    let s;
    try { s = JSON.parse(raw); } catch (e) { return { status: 'invalid', reason: 'json' }; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { status: 'invalid', reason: 'json' };
    let v = s.v;
    if (!Number.isInteger(v) || v < 1) return { status: 'invalid', reason: 'version' };
    if (v > VERSION) return { status: 'invalid', reason: 'future' };
    while (v < VERSION) {
      try { s = MIGRATIONS[v] ? MIGRATIONS[v](s) : null; } catch (e) { s = null; }
      if (!s || !(s.v > v)) return { status: 'invalid', reason: 'version' };
      v = s.v;
    }
    return need().hydrate(s);
  }

  /* ---------- `rev`, aba velha e o save principal ---------- */
  /* R2 — aba velha NÃO sobrescreve aba nova. Cada gravação sobe `rev` (contador do save). Esta aba lembra o `rev` que leu/gravou por último
     (`session.rev`); antes de gravar compara com o que está no storage: se for diferente, OUTRA aba salvou depois — esta aba para de salvar
     (`session.stale`) e o jogo pergunta ao jogador (recarregar, ou "usar esta aba" guardando antes uma cópia do que a outra salvou).
     N4: `session.known` = esta aba já leu ou gravou um save; se ele sumir do storage, outra aba o apagou (não ressuscitar).
     `active` = há um jogo em andamento nesta aba (o evento `storage` só importa então). */
  const session = { rev: 0, known: false, stale: false, active: false };

  /* `rev` de um texto de save: 0 se não houver `rev` válido; null se o texto não é JSON. É a ÚNICA normalização do `rev` (N2): quem LÊ o save
     (session.rev), quem confere antes de gravar (storedInfo) e o evento `storage` usam esta função, então nunca divergem (nem com rev 5.5 ou 1e13). */
  function revOfRaw(raw) {
    try { const o = JSON.parse(raw); return o && Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : 0; } catch (e) { return null; }
  }
  function storedInfo() {          // o que está gravado: { raw, rev }; rev === null se o texto não é um save legível. Lança se o storage falhar.
    const raw = localStorage.getItem(SAVE_KEY);
    return raw === null ? { raw: null, rev: 0 } : { raw, rev: revOfRaw(raw) };
  }
  const peek = () => { try { return storedInfo(); } catch (e) { return { raw: null, rev: 0 }; } };
  const conflictError = () => { const e = new Error('este jogo foi salvo mais recentemente em outra aba'); e.name = 'Conflict'; return e; };

  // Grava o jogo. Devolve { ok: true } ou { ok: false, error }. O AVISO ao jogador (toast, throttle de 60 s) é do jogo.
  function save(S) {
    if (session.stale) return { ok: false, error: conflictError() };      // já sabemos que outra aba salvou depois: não grava nada (nem em pagehide/visibilitychange)
    try {
      const cur = storedInfo();
      const gone = cur.raw === null && session.known;                    // N4: outra aba apagou o save — esta aba não o ressuscita
      if (gone || (cur.raw !== null && cur.rev !== null && cur.rev !== session.rev)) {
        session.stale = true; console.warn(gone ? 'save recusado: o save foi apagado em outra aba' : 'save recusado: rev gravado', cur.rev, '≠ rev desta aba', session.rev);
        return { ok: false, error: conflictError() };
      }
      if (cur.raw !== null && cur.rev === null) copies.add(cur.raw);       // vai gravar por cima de algo ilegível: guarda antes
      need().prepare(S);
      S.rev = session.rev + 1;
      localStorage.setItem(SAVE_KEY, JSON.stringify(need().persist(S)));
      session.rev = S.rev; session.known = true;
    } catch (e) {
      console.warn('falha ao salvar', e);
      return { ok: false, error: e };
    }
    return { ok: true };
  }

  /* Leitura do save. Nunca lança e distingue os casos:
       { status: 'none' }                                  não existe save
       { status: 'ok', state, repaired, rev }              save válido (com defaults aplicados; `repaired` = correções do sanitizador, e então o original vira cópia)
       { status: 'invalid', reason, raw, backedUp }        existe mas não dá para usar
     reason: json (corrompido) · future (versão mais nova que o jogo) · version (sem migração conhecida) · shape (dados faltando).
     Um save inválido NUNCA é alterado aqui: vai para uma cópia de segurança (as 3 mais recentes) e a tela inicial avisa o jogador. */
  function load() {
    let j;
    try { j = localStorage.getItem(SAVE_KEY); } catch (e) { return { status: 'none' }; }
    if (!j) return { status: 'none' };
    const r = parse(j);
    if (r.status === 'ok') { r.rev = revOfRaw(j); return r.repaired ? Object.assign(r, { backedUp: copies.add(j) }) : r; }      // `rev` do TEXTO lido (N2); corrigido pelo sanitizador: guarda o ORIGINAL antes
    return Object.assign(r, { raw: j, backedUp: copies.add(j) });
  }
  function removeMain() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage indisponível */ } }

  const sessionApi = {
    reset() { session.rev = 0; session.known = false; session.stale = false; session.active = false; },       // início de uma partida (continuar ou nova)
    adopt(loaded) { const ok = !!loaded && loaded.status === 'ok'; session.rev = ok ? loaded.rev : 0; session.known = ok; session.active = true; },   // "Continuar" iniciou
    startNew(prev) { session.rev = prev.rev === null ? 0 : prev.rev; session.active = true; },                 // jogo novo iniciou: continua a contagem do save substituído
    takeOver() {                                          // "Usar esta aba": guarda o que a outra aba salvou e assume o `rev` dela
      try { const cur = storedInfo(); if (cur.raw !== null) copies.add(cur.raw); session.rev = cur.rev === null ? 0 : cur.rev; } catch (e) { /* storage indisponível: save() avisa */ }
      session.stale = false; session.known = false;       // known=false: se a outra aba APAGOU o save, esta pode recriá-lo (foi escolha do jogador)
    },
    isStale: () => session.stale,
  };
  // outra aba gravou/apagou o save: esta aba passa a ser a "velha" imediatamente (sem esperar o próximo save)
  if (typeof window !== 'undefined') window.addEventListener('storage', e => {
    if (!session.active) return;
    if (e.key === null || (e.key === SAVE_KEY && e.newValue === null)) { session.stale = true; return; }       // N4: outra aba apagou o save (Novo jogo) ou limpou os dados do site
    if (e.key !== SAVE_KEY) return;
    const r = revOfRaw(e.newValue); if (r === null || r !== session.rev) session.stale = true;
  });

  /* ---------- cópias de segurança ---------- */
  function listCopies() {            // mais recentes primeiro; a chave antiga (sem data) fica por último
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === BACKUP_KEY || (k && k.startsWith(BACKUP_KEY + '_'))) {
          const raw = localStorage.getItem(k);
          out.push({ key: k, ts: k === BACKUP_KEY ? 0 : +k.slice(BACKUP_KEY.length + 1) || 0, raw, info: parse(raw) });
        }
      }
    } catch (e) { /* storage indisponível */ }
    return out.sort((x, y) => y.ts - x.ts);
  }
  /* R4 — poda para MAX_BACKUPS cópias sem perder a única cópia que dá para restaurar: descarta primeiro as ILEGÍVEIS (da mais antiga para a
     mais nova) e só depois as válidas (também da mais antiga); a cópia recém-criada e a cópia VÁLIDA mais recente nunca são descartadas. */
  function pruneCopies(keepKey) {
    const all = listCopies(), newestValid = all.find(b => b.info.status === 'ok');      // listCopies: mais recentes primeiro
    // N1: save de versão FUTURA/desconhecida não é lixo: é progresso de um jogo mais novo que este código não abre (JS antigo em cache). Ordem de descarte:
    // 0 = ilegível (json/shape) · 1 = válida · 2 = futura/versão desconhecida — dentro de cada grupo, a mais antiga primeiro.
    const rank = b => b.info.status === 'ok' ? 1 : (b.info.reason === 'future' || b.info.reason === 'version') ? 2 : 0;
    const victims = all.filter(b => b.key !== keepKey && b !== newestValid).sort((x, y) => rank(x) - rank(y) || x.ts - y.ts);
    for (let n = all.length; n > MAX_BACKUPS && victims.length; n--) localStorage.removeItem(victims.shift().key);
  }
  const copies = {
    list: listCopies,
    add(j) {                                                                    // guarda uma cópia do texto `j`; true se guardou (ou já existia)
      try {
        if (listCopies().some(b => b.raw === j)) return true;                   // já guardado (o boot e o "Continuar" leem duas vezes)
        const key = BACKUP_KEY + '_' + Date.now();
        localStorage.setItem(key, j);
        pruneCopies(key);
        return true;
      } catch (e) { return false; }                                             // cota cheia: o texto ainda pode ser baixado da tela inicial
    },
    restore(b) { try { localStorage.setItem(SAVE_KEY, b.raw); return true; } catch (e) { return false; } },     // grava a cópia por cima do principal
  };

  /* ---------- configuração de áudio (música/efeitos) ---------- */
  const cfg = {
    load() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { return {}; } },
    save(obj) { try { localStorage.setItem(CFG_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ } },
  };

  return { VERSION, configure, kit, load, peek, save, removeMain, copies, session: sessionApi, cfg };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SaveManager;
