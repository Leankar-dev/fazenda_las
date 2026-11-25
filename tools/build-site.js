#!/usr/bin/env node
'use strict';
/* Monta o site que vai para o GitHub Pages (Fase 3).   uso: node tools/build-site.js [--out=_site]
   Só publica o necessário (nada de docs/, tests/, tools/, .github/, .jpeg, README). Sem dependências (Node 18+). O que faz:
     1. copia index.html, style.css, art.js, animais.js, pesca.js, save.js, game.js, manifest.webmanifest, pwa/ e assets/
     2. VERSÃO = hash do conteúdo de tudo isso (12 hex) — igual conteúdo, igual versão (build reproduzível); `SITE_VERSION=...` força uma (testes)
     3. index.html publicado: `style.css?v=VER`, `*.js?v=VER` (quebra o cache da CDN do Pages), manifesto, ícones, `<meta name="fazenda-build">` e o registro do SW
        (só aqui: o index.html do repositório continua abrindo por file:// sem service worker)
     4. service-worker.js a partir de tools/service-worker.template.js, com a versão e a lista de arquivos para guardar (tudo o que foi publicado)
   Termina com código 1 se algo esperado não estiver no index.html (um build que "passa" sem fazer o trabalho é pior que um que falha). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['index.html'];
const CODE = ['style.css', 'art.js', 'animais.js', 'pesca.js', 'save.js', 'game.js'];             // citados no index.html: ganham ?v=
const STATIC = ['manifest.webmanifest'];
const DIRS = ['pwa', 'assets'];
const TEMPLATE = 'tools/service-worker.template.js';
const FAIL = msg => { console.error('build-site: ' + msg); process.exit(1); };

function walk(dir, out = []) {
  for (const n of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    const rel = dir + '/' + n, st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

function build(outDir, { version } = {}) {
  const files = [...PAGES, ...CODE, ...STATIC, ...DIRS.flatMap(d => walk(d))];
  for (const f of files) if (!fs.existsSync(path.join(ROOT, f))) FAIL('arquivo ausente: ' + f);
  const template = fs.readFileSync(path.join(ROOT, TEMPLATE), 'utf8');
  const hash = crypto.createHash('sha256');
  for (const f of [...files, TEMPLATE]) { hash.update(f + '\0'); hash.update(f === TEMPLATE ? template : fs.readFileSync(path.join(ROOT, f))); hash.update('\0'); }
  const ver = version || hash.digest('hex').slice(0, 12);
  if (!/^[A-Za-z0-9._-]+$/.test(ver)) FAIL('versão inválida: ' + ver);

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(outDir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(outDir, f)); }

  // index.html
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), n = 0;
  html = html.replace(/\b(href|src)="((?:style\.css|[a-z]+\.js))"/g, (m, attr, file) => { if (!CODE.includes(file)) return m; n++; return attr + '="' + file + '?v=' + ver + '"'; });
  if (n !== CODE.length) FAIL('o index.html cita ' + n + ' de ' + CODE.length + ' arquivos de código (css/js): confira os nomes');
  const head = [
    '<meta name="theme-color" content="#3e2512">', '<meta name="application-name" content="FAZENDA LAS">',
    '<meta name="mobile-web-app-capable" content="yes">', '<meta name="apple-mobile-web-app-capable" content="yes">', '<meta name="apple-mobile-web-app-title" content="Fazenda LAS">',
    '<link rel="manifest" href="manifest.webmanifest">', '<link rel="apple-touch-icon" href="pwa/icon-180.png">', '<meta name="fazenda-build" content="' + ver + '">',
  ].map(l => '  ' + l).join('\n') + '\n';
  const reg = '  <script>/* service worker: só no site publicado (https ou localhost); o save não passa por ele */\n  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) addEventListener("load", function () { navigator.serviceWorker.register("service-worker.js").catch(function (e) { console.warn("service worker:", e); }); });\n  </script>\n';
  if (!html.includes('</head>') || !html.includes('</body>')) FAIL('index.html sem </head> ou </body>');
  html = html.replace('</head>', () => head + '</head>').replace('</body>', () => reg + '</body>');
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  // service-worker.js: guarda a página (index.html), o código COM ?v= e todo o resto publicado
  const cached = ['index.html', ...CODE.map(f => f + '?v=' + ver), ...files.filter(f => !PAGES.includes(f) && !CODE.includes(f))];
  const sw = template.replace('__VERSION__', () => ver).replace('__PRECACHE__', () => JSON.stringify(cached, null, 2));
  if (/__VERSION__|__PRECACHE__/.test(sw)) FAIL('template do service worker com marcador não substituído');
  fs.writeFileSync(path.join(outDir, 'service-worker.js'), sw);
  return { version: ver, files: [...files, 'service-worker.js'], precache: cached, outDir };
}

module.exports = { build, ROOT };
if (require.main === module) {
  const out = path.resolve(ROOT, (process.argv.find(a => a.startsWith('--out=')) || '--out=_site').slice(6));
  if (!out.startsWith(ROOT + path.sep) && !process.env.ALLOW_OUT_OUTSIDE) FAIL('--out precisa ficar dentro do projeto (ou defina ALLOW_OUT_OUTSIDE=1)');
  const r = build(out, { version: process.env.SITE_VERSION });
  let bytes = 0; for (const f of r.files) bytes += fs.statSync(path.join(out, f)).size;
  console.log('site montado em ' + path.relative(ROOT, out) + '  versão ' + r.version + '  ' + r.files.length + ' arquivos  ' + (bytes / 1048576).toFixed(2) + ' MB');
}
