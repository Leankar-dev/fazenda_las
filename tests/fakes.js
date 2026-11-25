/* Falsos de Web Locks e BroadcastChannel para os testes — usados tanto em Node (tests/save.test.js: require) quanto no navegador (script injetado
   pelo tests/lib.js, que instala os falsos no lugar de navigator.locks / BroadcastChannel em TODA página de teste).
   Por quê: no Chrome headless com tempo virtual (--virtual-time-budget) o `navigator.locks.request` REAL nunca responde (nem em file://, nem em http, nem no
   Edge — medido), então sem o falso o jogo ficaria preso na tela "já está aberto em outra aba". O comportamento real em duas abas reais é conferido por
   `node tests/real-tabs.js` (CDP, tempo real). */
(function (root) {
  'use strict';
  /* Web Locks falso, fiel à especificação no que importa: fila por nome (FIFO), `ifAvailable`, `signal` (cancela o pedido na fila: AbortError) e `steal`
     (quebra o dono: o request DELE rejeita com AbortError, e o novo é concedido na hora). O bloqueio fica preso até a promessa do callback resolver. */
  function fakeLocks() {
    const names = {}, abortErr = () => { const e = new Error('abortado'); e.name = 'AbortError'; return e; };
    const slot = name => names[name] || (names[name] = { holder: null, queue: [] });
    function grant(n, e) {
      e.state = 'held'; n.holder = e;
      Promise.resolve().then(() => e.cb({})).then(v => { if (e.state === 'held') { e.state = 'done'; n.holder = null; e.resolve(v); pump(n); } },
        err => { if (e.state === 'held') { e.state = 'done'; n.holder = null; e.reject(err); pump(n); } });
    }
    function pump(n) { if (!n.holder && n.queue.length) grant(n, n.queue.shift()); }
    return {
      holder: name => !!slot(name).holder, queued: name => slot(name).queue.length,
      request(name, opts, cb) {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        const n = slot(name);
        return new Promise((resolve, reject) => {
          const e = { resolve, reject, cb, state: 'queued' };
          if (opts.signal) {
            if (opts.signal.aborted) return reject(abortErr());
            opts.signal.addEventListener('abort', () => { if (e.state === 'queued') { e.state = 'aborted'; n.queue = n.queue.filter(x => x !== e); reject(abortErr()); } });
          }
          if (opts.steal) { if (n.holder) { const h = n.holder; h.state = 'broken'; n.holder = null; h.reject(abortErr()); } grant(n, e); return; }
          if (opts.ifAvailable && n.holder) { Promise.resolve().then(() => cb(null)).then(resolve, reject); return; }
          n.queue.push(e); pump(n);
        });
      },
    };
  }
  /* barramento de BroadcastChannel falso: `bus(nome)` cria um canal; entrega às OUTRAS instâncias do mesmo nome (como o real), de forma assíncrona */
  function fakeBus() {
    const all = [];
    return name => { const c = { name, onmessage: null, postMessage(data) { for (const o of all) if (o !== c && o.name === name && o.onmessage) setTimeout(() => o.onmessage({ data }), 0); }, close() { const i = all.indexOf(c); if (i >= 0) all.splice(i, 1); } }; all.push(c); return c; };
  }
  const api = { fakeLocks, fakeBus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fakes = api;
})(typeof window !== 'undefined' ? window : globalThis);
