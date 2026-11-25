'use strict';
/* Service worker do FAZENDA LAS — GERADO pelo `tools/build-site.js` (não é carregado direto: os marcadores de versão e de lista de arquivos, nas 2 constantes abaixo, são trocados no build).
   Objetivo: depois da 1ª visita o jogo abre SEM rede, e um deploy novo chega sem perder o save (o save mora no localStorage, que o SW nunca toca).
   • VERSION = hash do conteúdo de tudo o que foi publicado: muda a cada deploy com mudança, e só então. O cache se chama `fazenda-las-<VERSION>`.
   • install: baixa TUDO (`cache:'reload'`, sem passar pelo cache HTTP da CDN) e só então vale — se um arquivo falhar, o SW novo não instala e o antigo continua.
   • activate: apaga só os caches `fazenda-las-*` antigos (a origem github.io é compartilhada com outros projetos: nunca mexer em cache alheio).
   • página (navegação): REDE PRIMEIRO (com limite de 4 s) → cópia guardada se estiver sem rede. O HTML novo aponta para `game.js?v=<novo>`, então o código novo
     chega sozinho. A cópia só é atualizada se o HTML for DESTA versão (senão ela citaria scripts que este cache não tem).
   • scripts/estilos (`?v=`): só pelo URL exato (um `?v=` velho nunca serve código de outra versão). Imagens e o resto: cache primeiro. Sem rede e fora do cache: falha normal. */
const VERSION = '__VERSION__';
const PREFIX = 'fazenda-las-', CACHE = PREFIX + VERSION;
const PRECACHE = __PRECACHE__;
const PAGE = new URL('index.html', self.location).href;
const NET_TIMEOUT = 4000;

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })));
  await self.skipWaiting();       // o código novo vale na próxima abertura; a página aberta continua com o que já carregou (o jogo não recarrega sozinho)
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

async function pageRequest(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), NET_TIMEOUT)),
    ]);
    if (res.ok && res.type === 'basic') {
      try { if ((await res.clone().text()).includes('name="fazenda-build" content="' + VERSION + '"')) await cache.put(PAGE, res.clone()); } catch (e) { /* guardar é um extra */ }
    }
    return res;
  } catch (err) {
    const hit = await cache.match(PAGE);
    if (hit) return hit;
    throw err;
  }
}

async function assetRequest(req) {
  const cache = await caches.open(CACHE);
  const exact = await cache.match(req);
  if (exact) return exact;
  const code = /\.(js|css)$/.test(new URL(req.url).pathname);
  if (!code) { const loose = await cache.match(req, { ignoreSearch: true }); if (loose) return loose; }      // ex.: `x.png?r=1` (o jogo tenta de novo com ?r=)
  return fetch(req);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') e.respondWith(pageRequest(req));
  else e.respondWith(assetRequest(req));
});
