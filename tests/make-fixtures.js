'use strict';
/* Gera tests/fixtures/*.json.   uso:  node tests/make-fixtures.js [--chrome=caminho]
   - save_v1_atual.json      : gravado pelo jogo ATUAL (animais 3/4/2, plantas, carne, posturas).
   - save_v1_pre_carne.json  : gravado pelo jogo ANTIGO (commit OLD_COMMIT, antes de carne/posturas/limites novos; ainda com pt/pk nas plantas).
   - os demais são derivados desses dois (truncado, schema futuro, mínimo, aninhados parciais, com pt/pk, sem mapa, versão desconhecida).
   Os arquivos gerados são versionados: o runner usa os JSON, não precisa do git nem refaz isto a cada teste. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const lib = require('./lib');

const OLD_COMMIT = '4397c24';      // "feat: placa FAZENDA LAS na frente do empório" — último commit antes da carne do porco
const OUT = path.join(__dirname, 'fixtures');

async function record(chrome, site) {
  const r = await lib.runScenario(chrome, site, 'gravar-fixture');
  const bad = r.tests.filter(t => !t.ok);
  if (bad.length || !r.data || !r.data.raw) throw new Error('falha ao gravar fixture: ' + JSON.stringify(bad));
  return r.data.raw;
}

(async () => {
  const chrome = lib.findChrome((process.argv.find(a => a.startsWith('--chrome=')) || '').split('=')[1]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-fx-'));

  console.log('gravando com o jogo atual...');
  const atual = await record(chrome, lib.buildSite(path.join(tmp, 'atual')));

  console.log('gravando com o jogo antigo (' + OLD_COMMIT + ')...');
  const files = {};
  for (const f of ['index.html', 'style.css', 'art.js', 'animais.js', 'game.js']) {
    files[f] = cp.execFileSync('git', ['show', OLD_COMMIT + ':' + f], { cwd: lib.ROOT, maxBuffer: 1 << 28 }).toString('utf8');
  }
  const antigo = await record(chrome, lib.buildSite(path.join(tmp, 'antigo'), { files }));

  const A = JSON.parse(atual), O = JSON.parse(antigo);
  if ('meat' in O || 'laid' in O || 'meatDone' in O) throw new Error('o save "antigo" já tem campos novos — OLD_COMMIT errado?');
  if (!('meat' in A) || !('laid' in A)) throw new Error('o save "atual" deveria ter meat/laid');

  const withPtPk = JSON.parse(atual);
  for (const k in withPtPk.crops) { withPtPk.crops[k].pt = 12.3456789 + Object.keys(withPtPk.crops).indexOf(k); withPtPk.crops[k].pk = 'grow'; }

  const fx = {
    save_v1_atual: atual,
    save_v1_pre_carne: antigo,
    save_v1_com_ptpk: JSON.stringify(withPtPk),
    // objetos aninhados PARCIAIS (um save de quando up/stat/owned tinham menos chaves): o merge com os padrões precisa completar
    save_v1_parcial: JSON.stringify(Object.assign({}, A, { up: { basket: 1 }, stat: { till: 5 }, owned: { vaca: 1 }, seeds: { cenoura: 2 }, harvest: { cenoura: 1 } })),
    save_v1_minimo: JSON.stringify({ v: 1, day: 3, gold: 250, min: 500, soil: new Array(46 * 34).fill(0), crops: {} }),
    save_v1_truncado: atual.slice(0, Math.floor(atual.length * 0.6)),
    save_invalido: '{lixo',
    save_futuro_schema99: JSON.stringify(Object.assign({}, A, { v: 99 })),
    save_v1_shape: JSON.stringify(Object.assign({}, A, { soil: [] })),
    save_versao_desconhecida: JSON.stringify(Object.assign({}, A, { v: 0 })),
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [n, txt] of Object.entries(fx)) { fs.writeFileSync(path.join(OUT, n + '.json'), txt); console.log('  ' + n + '.json  ' + txt.length + ' bytes'); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nok — rode "node tests/run.js" para validar.');
})().catch(e => { console.error(e); process.exit(1); });
