'use strict';
/* Gera as fixtures do REBANHO (ovelhas e coelhos) a partir do save_v3_ok.json, sem navegador:   node tests/make-fixture-rebanho.js
   - save_v3_rebanho.json         : um jogo no meio do caminho — 4 ovelhas (2 tosquiadas hoje, 1 ontem, 1 nunca), 3 coelhos (1 já colheu hoje), as estruturas compradas
                                    (portão, tesoura, estação, cocho com feno, oficina, 2 coelheiras, bebedouro), produtos no cesto e os relógios por bicho.
   - save_v3_rebanho_hostil.json  : o mesmo envelope (crc recalculado) com dados absurdos: 4000 ovelhas, 99999 coelhos, lã 1e12, chaves desconhecidas, listas gigantes, tipos errados.
   São CONGELADAS depois de geradas: viram a entrada dos cenários `fixture-v3-rebanho*` (se o formato do rebanho mudar, acrescente uma migração e mantenha estas). */
const fs = require('fs');
const path = require('path');
const SaveLib = require('../save.js');
const DIR = path.join(__dirname, 'fixtures');

const base = JSON.parse(fs.readFileSync(path.join(DIR, 'save_v3_ok.json'), 'utf8'));
if (base.schema !== SaveLib.SCHEMA) throw new Error('save_v3_ok.json não é do schema atual (' + base.schema + ' × ' + SaveLib.SCHEMA + ')');
const wrap = data => Object.assign({}, base, { data, crc: SaveLib.fnv1a(JSON.stringify(data)) });
const put = (name, env) => { fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify(env)); console.log(name + '.json  ' + JSON.stringify(env).length + ' bytes'); };

const d = JSON.parse(JSON.stringify(base.data)), day = d.day;
d.owned = Object.assign({}, d.owned, { ovelha: 4, coelho: 3 });
d.reb = {
  wool: 3, yarn: 1, cheese: 0, rmeat: 2, rpelt: 1, pelt: 0,
  gear: { portao: 1, tesoura: 1, estacao: 1, cocho: 1, feno: 0, saco: 0, oficina: 1, bebedouro: 1, tigela: 0, alface: 0, toca: 0 },
  coelheiras: 2, feed: { feno: 3, racao: 0 }, fed: 1, fedR: 0, shearN: 5,
  sheared: [day, day, day - 1, 0], rdone: [day, 0, 0],
};
put('save_v3_rebanho', wrap(d));

const h = JSON.parse(JSON.stringify(base.data));
h.owned = Object.assign({}, h.owned, { ovelha: 4000, coelho: 99999, vaca: -3 });
h.reb = { wool: 1e12, yarn: -5, cheese: 'x', rmeat: null, rpelt: 1.9, pelt: 1e30, gear: { portao: 5, tesoura: 'sim', inventado: 1 }, coelheiras: 99, feed: { feno: 1e9, racao: 'a', magia: 3 }, fed: 7, fedR: -1, shearN: 1e30,
  sheared: Array.from({ length: 300 }, (_, i) => i % 3 ? 1e12 : 'lixo'), rdone: { nao: 'uma lista' } };
put('save_v3_rebanho_hostil', wrap(h));
