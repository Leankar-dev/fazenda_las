'use strict';
/* Roda os testes do jogo num Chrome/Edge headless.   uso:  node tests/run.js [cenario ...] [--list] [--chrome=caminho] [--jobs=N]
   Sem dependências (só Node 18+ e um Chrome/Edge instalado). Código de saída 0 = tudo passou; 1 = algum teste falhou. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const SCENARIOS = [
  'fixture-pre-carne', 'fixture-atual', 'fixture-minimo', 'fixture-parcial', 'fixture-com-ptpk',          // saves que devem carregar sem NaN
  'fixture-truncado', 'fixture-invalido', 'fixture-futuro', 'fixture-shape', 'fixture-versao',   // saves que devem avisar e ser preservados
  'rotacao-copias', 'poda-copias-validas', 'poda-copia-futura', 'poda-copia-versao', 'restaurar', 'restaurar-sem-copia',                                                       // cópias de segurança
  'cfg-audio',                                                                         // configuração de áudio sobrevive ao recarregar
  'quota-jogo', 'quota-boot', 'storage-bloqueado',                                     // falhas de gravação (cota REAL cheia, modo privado)
  'salva-eventos', 'pt-pk-fora-do-save',                                               // gatilhos de save e conteúdo gravado
  'novo-jogo-copia', 'novo-jogo-falha', 'novo-jogo-pausa', 'novo-jogo-sem-espaco', 'novo-jogo-rev',   // R1: Novo jogo nunca apaga sem cópia
  'aba-velha', 'aba-apagada', 'rev-estranho',                                                                         // R2: aba velha não sobrescreve aba nova
  'hostil-estado', 'hostil-estruturas', 'hostil-crops-obs', 'falha-inicio',            // R3: save válido porém hostil
];

function loadFixtures() {
  const dir = path.join(__dirname, 'fixtures'), out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[path.basename(f, '.json')] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { console.log(SCENARIOS.join('\n')); return 0; }
  const opt = n => (args.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
  const wanted = args.filter(a => !a.startsWith('--'));
  const list = wanted.length ? wanted : SCENARIOS;
  const unknown = list.filter(s => !SCENARIOS.includes(s)); if (unknown.length) { console.error('cenário desconhecido: ' + unknown.join(', ')); return 2; }
  const chrome = lib.findChrome(opt('chrome'));
  const site = lib.buildSite(fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-site-')), { fixtures: loadFixtures() });
  console.log('Chrome: ' + chrome + '\nCenários: ' + list.length + '\n');
  const t0 = Date.now();
  const results = await lib.pool(list.map(s => () => lib.runScenario(chrome, site, s)), +opt('jobs') || Math.min(4, os.cpus().length));
  let pass = 0, fail = 0;
  list.forEach((s, i) => {
    const r = results[i], bad = r.tests.filter(t => !t.ok);
    console.log((bad.length ? 'FALHOU ' : 'ok     ') + s + '  (' + (r.tests.length - bad.length) + '/' + r.tests.length + ')');
    for (const t of bad) console.log('   ✗ ' + t.name + (t.detail ? '  → ' + t.detail : ''));
    pass += r.tests.length - bad.length; fail += bad.length;
  });
  console.log('\n' + pass + ' verificações passaram, ' + fail + ' falharam  (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  fs.rmSync(site, { recursive: true, force: true });
  return fail ? 1 : 0;
}
main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
