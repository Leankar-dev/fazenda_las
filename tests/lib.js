'use strict';
/* Utilitários dos testes: copia o projeto para uma pasta temporária, injeta os cenários no index.html da cópia
   (o jogo de verdade não é alterado) e roda cada cenário num Chrome/Edge headless com perfil limpo. Sem dependências. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

function findChrome(custom) {
  const cands = [custom, process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = cands.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!found) throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH ou use --chrome=<caminho>.');
  return found;
}

// monta uma cópia do site em `dest`. `files` = { 'game.js': '<conteúdo>' } sobrescreve arquivos (usado para rodar código de um commit antigo).
function buildSite(dest, { files = {}, fixtures = {}, scenarioFile = path.join(__dirname, 'browser', 'scenarios.js') } = {}) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['index.html', 'style.css', 'art.js', 'animais.js', 'game.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  fs.cpSync(path.join(ROOT, 'assets'), path.join(dest, 'assets'), { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dest, name), content);
  fs.writeFileSync(path.join(dest, 'tests-fixtures.js'), 'window.FIXTURES = ' + JSON.stringify(fixtures) + ';');
  fs.copyFileSync(scenarioFile, path.join(dest, 'tests-scenarios.js'));
  let html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  const tag = '<script src="game.js"></script>';
  if (!html.includes(tag)) throw new Error('index.html sem a tag do game.js');
  html = html.replace(tag, '<script src="tests-fixtures.js"></script><script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(e.message)});</script>'
    + tag + '<script src="tests-scenarios.js"></script>');
  fs.writeFileSync(path.join(dest, 'index.html'), html);
  return dest;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// roda um cenário e devolve { tests: [{ok,name,detail}], data }. Tenta até 6 vezes (o headless às vezes devolve o DOM antes do fim).
function runScenario(chrome, siteDir, scenario, { timeoutMs = 240000, virtualMs = 150000, attempts = 6 } = {}) {
  const url = pathToFileURL(path.join(siteDir, 'index.html')).href + '?debug#' + scenario;
  const once = () => new Promise(resolve => {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-test-'));
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + prof, '--allow-file-access-from-files',
      '--virtual-time-budget=' + virtualMs, '--dump-dom', url];
    const child = cp.spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    // O Chrome às vezes imprime o DOM e NÃO encerra (a rodada esperava o timeout inteiro): ao ver o fim do documento, encerra o processo.
    child.stdout.on('data', d => { out += d; if (/<\/html>\s*$/i.test(out)) setTimeout(() => child.kill(), 300); });
    const done = () => { clearTimeout(timer); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* perfil preso: ignora */ } resolve(out); };
    child.on('close', done); child.on('error', done);
  });
  return (async () => {
    for (let i = 1; i <= attempts; i++) {
      const dom = await once();
      const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);
      if (m) { try { return JSON.parse(decode(m[1])); } catch (e) { /* tenta de novo */ } }
    }
    return { tests: [{ ok: false, name: scenario + ': cenário terminou sem resultado', detail: 'sem <pre id="results"> após ' + attempts + ' tentativas' }], data: null };
  })();
}

// executa `jobs` (funções async) com no máximo `n` em paralelo, mantendo a ordem dos resultados
async function pool(jobs, n) {
  const res = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; res[i] = await jobs[i](); } }));
  return res;
}

module.exports = { ROOT, findChrome, buildSite, runScenario, pool };
