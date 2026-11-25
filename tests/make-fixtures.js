'use strict';
/* Gera as fixtures do formato ATUAL (schema 3, mapa 64 × 49):   node tests/make-fixtures.js [--chrome=caminho]
   - save_v3_ok.json          : gravado pelo jogo ATUAL (envelope com crc; animais 3/4/2, plantas, carne, posturas).
   - save_v3_crc_errado.json  : o mesmo, com um dado alterado sem recalcular o crc (corrupção que o JSON não revela).
   - save_v3_truncado.json    : o mesmo, cortado em 60 % (escrita interrompida).
   - save_v3_futuro.json      : o mesmo, com schema 4 (save de um jogo mais novo).
   As fixtures save_v2_* (mapa 46 × 34, schema 2) são CONGELADAS, como as v1: são a entrada da migração 2→3 (cenários fixture-v2-* e mapa-save-antigo). Só o save_v2_futuro foi
   editado uma vez (schema 3 → 4), porque o schema 3 passou a ser o atual.

   As fixtures v1 (save_v1_*.json, save_invalido, save_futuro_schema99, save_versao_desconhecida) são do formato LEGADO e estão CONGELADAS: o jogo
   atual não grava mais v1, então elas não são (e não devem ser) regeneradas daqui — são a entrada dos cenários de importação do legado.
   save_v1_pre_carne.json foi gravado pelo jogo ANTIGO (commit 4397c24, antes de carne/posturas/limites novos; ainda com pt/pk nas plantas).
   Os arquivos são versionados: o runner usa os JSON, não precisa do git nem refaz isto a cada teste. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');
const SaveLib = require('../save.js');

const OUT = path.join(__dirname, 'fixtures');

(async () => {
  const chrome = lib.findChrome((process.argv.find(a => a.startsWith('--chrome=')) || '').split('=')[1]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-fx-'));

  console.log('gravando com o jogo atual...');
  const r = await lib.runScenario(chrome, lib.buildSite(path.join(tmp, 'atual')), 'gravar-fixture');
  const bad = r.tests.filter(t => !t.ok);
  if (bad.length || !r.data || !r.data.raw) throw new Error('falha ao gravar fixture: ' + JSON.stringify(bad));
  const atual = r.data.raw, env = JSON.parse(atual);
  if (env.magic !== SaveLib.MAGIC || env.schema !== SaveLib.SCHEMA) throw new Error('o jogo atual não gravou um envelope do schema atual: ' + atual.slice(0, 80));
  if (!('meat' in env.data) || !('laid' in env.data)) throw new Error('o save "atual" deveria ter meat/laid');
  if (env.crc !== SaveLib.fnv1a(JSON.stringify(env.data))) throw new Error('o crc gravado pelo jogo não confere');
  if ('v' in env.data || 'rev' in env.data) throw new Error('data não deveria ter v/rev');

  const tampered = JSON.parse(atual); tampered.data.gold += 1;                       // o crc antigo não confere mais
  const fx = {
    save_v3_ok: atual,
    save_v3_crc_errado: JSON.stringify(tampered),
    save_v3_truncado: atual.slice(0, Math.floor(atual.length * 0.6)),
    save_v3_futuro: JSON.stringify(Object.assign({}, env, { schema: SaveLib.SCHEMA + 1, app: 'futuro' })),
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [n, txt] of Object.entries(fx)) { fs.writeFileSync(path.join(OUT, n + '.json'), txt); console.log('  ' + n + '.json  ' + txt.length + ' bytes'); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nok — rode "node tests/save.test.js" e "node tests/run.js" para validar.');
})().catch(e => { console.error(e); process.exit(1); });
