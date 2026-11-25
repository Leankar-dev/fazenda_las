'use strict';
/* Roda os testes do jogo num Chrome/Edge headless.   uso:  node tests/run.js [cenario ...] [--list] [--chrome=caminho] [--jobs=N] [--virtual=ms]
   Sem dependências (só Node 18+ e um Chrome/Edge instalado). Código de saída 0 = tudo passou; 1 = algum teste falhou. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const SCENARIOS = [
  'fixture-pre-carne', 'fixture-atual', 'fixture-minimo', 'fixture-parcial', 'fixture-com-ptpk',          // saves que devem carregar sem NaN
  'fixture-truncado', 'fixture-invalido', 'fixture-futuro', 'fixture-shape', 'fixture-versao',   // saves que devem avisar e ser preservados
  'fixture-v2-ok', 'fixture-v2-truncado', 'fixture-v2-crc', 'fixture-v2-futuro',                  // formato v2 (envelope com crc)
  'rotacao-copias', 'poda-copias-validas', 'poda-copia-futura', 'poda-copia-versao', 'restaurar', 'restaurar-sem-copia', 'restaurar-motivo-slot',                                                       // cópias de segurança
  'cfg-audio',                                                                         // configuração de áudio sobrevive ao recarregar
  'quota-jogo', 'quota-boot', 'storage-bloqueado',                                     // falhas de gravação (cota REAL cheia, modo privado)
  'salva-eventos', 'pt-pk-fora-do-save',                                               // gatilhos de save e conteúdo gravado
  'novo-jogo-copia', 'novo-jogo-falha', 'novo-jogo-pausa', 'novo-jogo-sem-espaco', 'novo-jogo-rev',   // R1: Novo jogo nunca apaga sem cópia
  'aba-velha', 'aba-apagada', 'rev-estranho',                                                                         // R2: aba velha não sobrescreve aba nova
  'hostil-estado', 'hostil-estado-v2', 'hostil-estruturas', 'hostil-crops-obs', 'falha-inicio',   // R3: save válido porém hostil (legado e v2)
  'legado-importa', 'legado-elias', 'legado-sem-ressuscitar', 'legado-cfg',            // Fase 1b: legado v1 → v2 (o legado nunca é apagado)
  'recupera-bak', 'recupera-tmp', 'futuro-nao-sobrescrito',                           // Fase 1b: escrita segura, recuperação, schema futuro
  'slots-cartoes', 'slots-nome-hostil', 'slots-independentes', 'slots-novo-em-outro', 'slots-apagar', 'slots-apagar-sem-espaco', 'legado-vai-para-slot1',   // Fase 1c: 3 slots
  'continuar-pausado', 'e2e-recarrega',                                             // Fase 1c: começa pausado; novo → jogar → recarregar → continuar idêntico
  'slots-apagar-recuperado', 'novo-jogo-recuperado', 'slots-trocar-futuro', 'slots-trocar-conflito',     // revisão da 1c: apagar/novo sobre jogo recuperado; Trocar de jogo sem perder progresso
  'titulo-velho-apagado', 'titulo-velho-corrompido',                                // revisão da 1c (N5): Continuar com o título desatualizado não inicia jogo novo em silêncio
  'export-titulo', 'export-pausa', 'importar-invalido', 'importar-slots', 'importar-sem-espaco', 'e2e-exporta-importa',     // Fase 2a: exportar/importar arquivo (E2E: exportar → limpar tudo → recarregar → importar → idêntico)
  'indicador-salvamento', 'storage-aviso-boot', 'storage-cheio-aviso', 'persist-concedido', 'persist-negado', 'persist-sem-api', 'backup-metas',     // Fase 2b: indicador/faixa, storage indisponível, persist(), backup nas metas
  'pesca-lago', 'pesca-save',                                                        // Pesca: lago com peixes, doca, 7ª ferramenta, loja, lançar/fisgar/pescar, comer, vender, save hostil
  'personagens-sprites',                                                              // Fase de arte: fazendeiro e fazendeira com sprite sheet (5 quadros x 4 direções)
  'casa-principal',                                                                  // Fase de arte: casa de tijolos no lugar do celeiro (desenho, colisão, porta, luzes)
  'cavalo-sprites',                                                                  // Fase de arte: cavalo animado (sprite sheet 5 quadros x 4 direções)
  'fixture-v3-ok', 'fixture-v3-truncado', 'fixture-v3-crc', 'fixture-v3-futuro',            // Fase 3: fixtures do schema 3 (mapa 64 x 49)
  'recintos',                                                                          // Fase 4 (ovelhas): curral ampliado, pasto, coelheira; cerca, portões, lotação, E, sheets
  'mapa-golden', 'mapa-save-antigo',                                                // Fase 3 (ovelhas): fazenda de 64 x 49 - o mundo antigo igual ao golden; save do mapa antigo migrado
  'lock-bloqueada', 'lock-silenciosa', 'lock-fecha-sozinha', 'lock-cede', 'lock-roubado', 'lock-sem-api',                                     // Fase 2c: Web Locks (2ª aba não inicia nem grava; Assumir aqui; roubo; sem API)
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
  const results = await lib.pool(list.map(s => () => lib.runScenario(chrome, site, s, { virtualMs: +opt('virtual') || undefined })), +opt('jobs') || Math.min(4, os.cpus().length));
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
