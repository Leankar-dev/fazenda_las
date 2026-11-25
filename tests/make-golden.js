'use strict';
/* Grava o "golden" do mundo gerado por um jogo NOVO (árvores, mato, pedras, frutíferas e o mapa de tiles bloqueados):   node tests/make-golden.js [--chrome=caminho] [--out=arquivo]
   Padrão de saída: tests/fixtures/mapa_golden_46x34.json — o mundo ANTES de dobrar a fazenda (Fase 3). É CONGELADO: não regenere depois da Fase 3; o teste
   `mapa-golden` (cenário de navegador) confere que a região antiga do mapa novo continua igual a este arquivo (exceto a antiga moldura leste/sul, que vira passagem). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

(async () => {
  const arg = n => (process.argv.find(a => a.startsWith(n + '=')) || '').split('=')[1];
  const chrome = lib.findChrome(arg('--chrome')), out = arg('--out') || path.join(__dirname, 'fixtures', 'mapa_golden_46x34.json');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fazenda-golden-'));
  const r = await lib.runScenario(chrome, lib.buildSite(path.join(tmp, 'site')), 'gravar-mundo');
  const bad = r.tests.filter(t => !t.ok); if (bad.length || !r.data) throw new Error('falha ao gravar o golden: ' + JSON.stringify(bad));
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(r.data));
  console.log('golden ' + r.data.MW + 'x' + r.data.MH + ': ' + r.data.trees.length + ' árvores, ' + r.data.obs.length + ' obstáculos -> ' + path.relative(process.cwd(), out));
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
