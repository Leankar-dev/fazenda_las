'use strict';
/* ============================================================
   rebanho.js  -  ovelhas e coelhos: espécies, produtos, acessórios da loja, oficina, comida e saneamento do save
   Sprites: assets/animais/ovelha|coelho/ (sheets, tools/make-livestock-sprites.py) e assets/animais/props/ (acessórios e produtos, tools/make-livestock-props.py).

   Este módulo tem a LÓGICA (sem DOM, sem localStorage), para ser testada em Node (tests/rebanho.test.js). O game.js/animais.js só ligam: loja, desenho, IA, teclas, HUD.
     • ANIMALS ..... as 2 espécies (preço, limite, produto, tamanho na tela)
     • GEAR ........ o catálogo da loja (estruturas, ferramentas, consumíveis) + `fx(S)`: o que o comprado FAZ
     • canBuy/buy .. compra de acessórios; canBuyAnimal/buyAnimal .. compra de bichos (vagas, portão, coelheira)
     • shear/collectRabbit/ready .. colheita (lã, carne e pele crua); dailyTick .. vira o dia (comida do cocho e da tigela)
     • RECIPES ..... a oficina: fiar (3 lã → fio), queijo (3 leite → queijo), curtir (2 pele crua → pele curtida)
     • defaults/sanitize ... campos novos do save, com regras para save hostil
   O estado vive em S: S.owned.ovelha / S.owned.coelho (quantos bichos) · S.reb { produtos, gear, feed, sheared[], rdone[], ... } (ver defaults()).
   Os preços são PONTO DE PARTIDA (docs/melhorias/ovelhas_coelhos/PLANO_OVELHAS_COELHOS.md, Fase 7 calibra): moram só aqui.
   ============================================================ */
const Rebanho = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const BASE = 'assets/animais/';

  /* ---------------- produtos ----------------
     price = preço de venda na caixa · img = sprite em assets/animais/props · key = campo em S.reb (cru: o que o bicho dá; fino: o que a oficina faz) */
  const PRODUCTS = {
    wool:   { name: 'Lã',           price: 40,  img: 'la_bruta' },
    rmeat:  { name: 'Carne de coelho', price: 22, img: 'carne_coelho' },
    rpelt:  { name: 'Pele crua',    price: 14,  img: 'pele_coelho' },
    yarn:   { name: 'Fio de lã',    price: 140, img: 'fio_la' },
    cheese: { name: 'Queijo',       price: 190, img: 'queijo' },
    pelt:   { name: 'Pele curtida', price: 40,  img: 'pele_curtida' },
  };
  const PRODUCT_KEYS = Object.keys(PRODUCTS);
  /* ---------------- espécies ----------------
     cost = preço · max = limite · h = altura na tela (px) · sheet = pasta da sheet (assets/animais/<sheet>/sheet.json) */
  const ANIMALS = {
    ovelha: { name: 'Ovelha', cost: 220, max: 8, h: 54, sheet: 'ovelha', info: 'Dá lã a cada 2 dias (vende ' + PRODUCTS.wool.price + ' ◎). Tosquie com E — precisa da tesoura de tosa.' },
    coelho: { name: 'Coelho', cost: 90, max: 8, h: 30, sheet: 'coelho', info: 'Dá carne e pele, uma por dia, alternando. Precisa de vaga na coelheira (2 por coelheira).' },
  };
  const KINDS = Object.keys(ANIMALS);

  const WOOL_DAYS = 2, WOOL_DAYS_FED = 1;          // dias para a lã voltar (1 se o cocho tem feno)
  const WOOL_CAP = 20, WOOL_CAP_BAG = 40;          // lã que cabe no cesto (40 com o saco de lã)
  const PRODUCT_CAP = 999;                         // os demais produtos (limite só contra save hostil)
  const SPARE_EVERY = 4;                           // com a estação de tosquia, a cada 4ª tosquia vem +1 lã
  const HUTCH_SLOTS = 2, HUTCH_MAX = 4;            // vagas de coelho por coelheira; máximo de coelheiras
  const FEED_CAP = 20;                             // feno e ração no estoque
  const FEED_PER = 4;                              // 1 feno/ração alimenta 4 bichos por dia

  /* ---------------- catálogo da loja ----------------
     kind: 'once' (compra única, S.reb.gear[id]) · 'count' (várias, S.reb[key] até max) · 'feed' (consumível em pacote, S.reb.feed[id])
     needs: ids que precisam ter sido comprados antes · why: mensagem se faltar */
  const GEAR = [
    { id: 'portao', kind: 'once', group: 'Pasto das ovelhas', img: 'portao_aprisco', name: 'Portão do aprisco', cost: 300, info: 'Abre o pasto das ovelhas. Sem ele não dá para comprar ovelhas.' },
    { id: 'tesoura', kind: 'once', group: 'Pasto das ovelhas', img: 'tesoura_tosa', name: 'Tesoura de tosa', cost: 90, info: 'Permite tosquiar as ovelhas.' },
    { id: 'estacao', kind: 'once', group: 'Pasto das ovelhas', img: 'estacao_tosquia', name: 'Estação de tosquia', cost: 240, needs: ['portao'], info: 'A cada 4ª tosquia vem +1 lã.' },
    { id: 'cocho', kind: 'once', group: 'Pasto das ovelhas', img: 'cocho_ovelha', name: 'Cocho de ovelha', cost: 120, needs: ['portao'], info: 'Com feno no cocho a lã volta em 1 dia (em vez de 2).' },
    { id: 'feno', kind: 'feed', pack: 5, group: 'Pasto das ovelhas', img: 'fardos_feno', name: 'Feno ×5', cost: 25, needs: ['cocho'], info: 'Abastece o cocho: 1 feno por dia para cada 4 ovelhas.' },
    { id: 'saco', kind: 'once', group: 'Pasto das ovelhas', img: 'la_bruta', name: 'Saco de lã', cost: 150, needs: ['portao'], info: 'O cesto de lã passa de 20 para 40.' },
    { id: 'oficina', kind: 'once', group: 'Oficina', img: 'oficina', name: 'Oficina', cost: 260, needs: ['portao'], info: 'Fia lã, faz queijo com o leite das vacas e cura pele de coelho.' },
    { id: 'coelheira', kind: 'count', key: 'coelheiras', max: HUTCH_MAX, group: 'Coelheira', img: 'coelheira', name: 'Coelheira', cost: 140, info: '+2 vagas para coelhos (até 4 coelheiras).' },
    { id: 'bebedouro', kind: 'once', group: 'Coelheira', img: 'bebedouro_coelho', name: 'Bebedouro', cost: 60, needs: ['coelheira'], info: 'Coelhos mais saudáveis: +15% de chance de produto extra.' },
    { id: 'tigela', kind: 'once', group: 'Coelheira', img: 'tigela_racao', name: 'Tigela de ração', cost: 50, needs: ['coelheira'], info: 'Permite usar ração de cenoura.' },
    { id: 'racao', kind: 'feed', pack: 5, group: 'Coelheira', img: 'tigela_racao', name: 'Ração de cenoura ×5', cost: 30, needs: ['tigela'], info: 'Coelhos alimentados: +25% de chance de produto extra no dia. 1 por dia para cada 4 coelhos.' },
    { id: 'alface', kind: 'once', group: 'Coelheira', img: 'canteiro_alface', name: 'Canteiro de alface', cost: 110, needs: ['coelheira'], info: 'Os coelhos comem sozinhos: o bônus da ração, sem gastar ração.' },
    { id: 'toca', kind: 'once', group: 'Coelheira', img: 'toca_coelho', name: 'Toca', cost: 40, needs: ['coelheira'], info: 'Coelhos descansados: +10% de chance de produto extra.' },
  ];
  const GEAR_BY = Object.fromEntries(GEAR.map(g => [g.id, g]));
  const ONCE_KEYS = GEAR.filter(g => g.kind === 'once').map(g => g.id);
  const FEED_KEYS = GEAR.filter(g => g.kind === 'feed').map(g => g.id);
  const NEED_WHY = { portao: 'compre o portão do aprisco antes', cocho: 'compre o cocho antes', coelheira: 'compre uma coelheira antes', tigela: 'compre a tigela de ração antes' };

  /* ---------------- oficina ---------------- */
  const RECIPES = [
    { id: 'fiar',   name: 'Fiar',   take: { wool: 3 },  give: { yarn: 1 },   info: '3 lã → 1 fio de lã' },
    { id: 'queijo', name: 'Queijo', take: { milk: 3 },  give: { cheese: 1 }, info: '3 leite → 1 queijo' },
    { id: 'curtir', name: 'Curtir', take: { rpelt: 2 }, give: { pelt: 1 },   info: '2 pele crua → 1 pele curtida' },
  ];
  const RECIPE_BY = Object.fromEntries(RECIPES.map(r => [r.id, r]));

  // todos os sprites usados de assets/animais/props (tests/build.test.js e tests/rebanho.test.js conferem que existem) + os ícones das espécies
  const SPRITES = [...new Set([...GEAR.map(g => g.img), ...PRODUCT_KEYS.map(k => PRODUCTS[k].img)])];
  const spriteUrl = n => BASE + 'props/' + n + '.png';
  const iconUrl = kind => BASE + ANIMALS[kind].sheet + '/icon.png';

  /* ---------------- estado do save ---------------- */
  const zero = keys => Object.fromEntries(keys.map(k => [k, 0]));
  const defaults = () => ({ reb: { wool: 0, yarn: 0, cheese: 0, rmeat: 0, rpelt: 0, pelt: 0, gear: zero(ONCE_KEYS), coelheiras: 0, feed: zero(FEED_KEYS), fed: 0, fedR: 0, shearN: 0, sheared: [], rdone: [] } });
  const OWNED_DEFAULT = { ovelha: 0, coelho: 0 };
  const MAX_DAY = 1e6;
  /* regras para save de terceiros/danificado: tudo vira inteiro limitado, chaves desconhecidas somem. `kit` = SaveManager.kit() */
  function sanitize(st, kit) {
    const d = defaults().reb;
    if (!kit.isObj(st.reb)) { if (st.reb !== undefined) kit.bad(); st.reb = d; }
    const r = st.reb;
    for (const k of PRODUCT_KEYS) kit.Pint(r, k, 0, PRODUCT_CAP, 0);
    r.gear = kit.objOf(r.gear, ONCE_KEYS, d.gear); for (const k of ONCE_KEYS) kit.Pint(r.gear, k, 0, 1, 0);
    r.feed = kit.objOf(r.feed, FEED_KEYS, d.feed); for (const k of FEED_KEYS) kit.Pint(r.feed, k, 0, FEED_CAP, 0);
    kit.Pint(r, 'coelheiras', 0, HUTCH_MAX, 0); kit.Pint(r, 'fed', 0, 1, 0); kit.Pint(r, 'fedR', 0, 1, 0); kit.Pint(r, 'shearN', 0, 1e9, 0);
    r.wool = Math.min(r.wool, WOOL_CAP_BAG);
    for (const [k, max] of [['sheared', ANIMALS.ovelha.max], ['rdone', ANIMALS.coelho.max]]) {
      if (!Array.isArray(r[k])) { if (r[k] !== undefined) kit.bad(); r[k] = []; continue; }
      if (r[k].length > max) { kit.bad(); r[k] = r[k].slice(0, max); }
      r[k] = r[k].map(v => Number.isFinite(v) ? clamp(Math.floor(v), 0, MAX_DAY) : (kit.bad(), 0));
    }
  }
  const have = (S, id) => !!(S.reb && S.reb.gear && S.reb.gear[id]);

  /* ---------------- o que o comprado FAZ ---------------- */
  function fx(S) {
    const r = S.reb, g = r.gear, owned = S.owned || {};
    const fedSheep = !!(g.cocho && r.fed), fedRabbit = !!(g.alface || (g.tigela && r.fedR));
    const bonus = (g.bebedouro ? .15 : 0) + (fedRabbit ? .25 : 0) + (g.toca ? .10 : 0);
    return {
      pastureOpen: !!g.portao,
      canShear: !!g.tesoura,
      spareEvery: g.estacao ? SPARE_EVERY : 0,
      woolDays: fedSheep ? WOOL_DAYS_FED : WOOL_DAYS,
      woolCap: g.saco ? WOOL_CAP_BAG : WOOL_CAP,
      hutchSlots: HUTCH_SLOTS * clamp(r.coelheiras | 0, 0, HUTCH_MAX),
      rabbitBonus: bonus,                         // chance (0..1) de um produto extra por coleta
      fedSheep, fedRabbit,
      workshop: !!g.oficina,
      feedNeed: { feno: Math.ceil((owned.ovelha | 0) / FEED_PER), racao: Math.ceil((owned.coelho | 0) / FEED_PER) },
    };
  }

  /* ---------------- compra ---------------- */
  function canBuy(S, id, opts) {
    const g = GEAR_BY[id]; if (!g) return { ok: false, why: 'item desconhecido' };
    for (const n of g.needs || []) {
      const ok = n === 'coelheira' ? (S.reb.coelheiras | 0) >= 1 : have(S, n);
      if (!ok) return { ok: false, why: NEED_WHY[n] || 'falta um item antes' };
    }
    if (g.kind === 'once' && have(S, id)) return { ok: false, why: 'já comprado' };
    if (g.kind === 'count' && (S.reb[g.key] | 0) >= g.max) return { ok: false, why: 'no limite (' + g.max + ')' };
    if (g.kind === 'feed' && (S.reb.feed[id] | 0) >= FEED_CAP) return { ok: false, why: 'estoque cheio' };
    if (!(opts && opts.ignoreGold) && S.gold < g.cost) return { ok: false, why: 'ouro insuficiente' };
    return { ok: true };
  }
  function buy(S, id) {                 // aplica a compra (o game.js cuida de som, aviso e salvar)
    const c = canBuy(S, id); if (!c.ok) return c;
    const g = GEAR_BY[id]; S.gold -= g.cost;
    if (g.kind === 'once') S.reb.gear[id] = 1;
    else if (g.kind === 'count') S.reb[g.key] = (S.reb[g.key] | 0) + 1;
    else S.reb.feed[id] = Math.min(FEED_CAP, (S.reb.feed[id] | 0) + g.pack);
    return { ok: true };
  }
  // ração também pode ser feita com 5 cenouras colhidas (S.harvest.cenoura), sem gastar ouro
  function buyFeedWithCarrots(S) {
    const g = GEAR_BY.racao, c = canBuy(S, 'racao', { ignoreGold: true }); if (!c.ok) return c;
    const need = g.pack; if (((S.harvest && S.harvest.cenoura) | 0) < need) return { ok: false, why: 'precisa de ' + need + ' cenouras colhidas' };
    S.harvest.cenoura -= need; S.reb.feed.racao = Math.min(FEED_CAP, (S.reb.feed.racao | 0) + g.pack); return { ok: true };
  }

  function canBuyAnimal(S, kind) {
    const a = ANIMALS[kind]; if (!a) return { ok: false, why: 'animal desconhecido' };
    const n = S.owned[kind] | 0;
    if (n >= a.max) return { ok: false, why: 'no limite (' + a.max + ')' };
    if (kind === 'ovelha' && !have(S, 'portao')) return { ok: false, why: 'compre o portão do aprisco antes' };
    if (kind === 'coelho') {
      const slots = fx(S).hutchSlots;
      if (!slots) return { ok: false, why: 'compre uma coelheira antes' };
      if (n >= slots) return { ok: false, why: 'sem vaga: compre outra coelheira' };
    }
    if (S.gold < a.cost) return { ok: false, why: 'ouro insuficiente' };
    return { ok: true };
  }
  function buyAnimal(S, kind) {
    const c = canBuyAnimal(S, kind); if (!c.ok) return c;
    S.gold -= ANIMALS[kind].cost; S.owned[kind] = (S.owned[kind] | 0) + 1;
    const arr = kind === 'ovelha' ? S.reb.sheared : S.reb.rdone; arr[S.owned[kind] - 1] = 0;      // 0 = pronto desde o início
    return { ok: true, idx: S.owned[kind] - 1 };
  }

  /* ---------------- colheita ---------------- */
  const woolReady = (S, idx) => { const s = S.reb.sheared[idx] | 0; return s === 0 || (S.day | 0) - s >= fx(S).woolDays; };
  // pode tosquiar a ovelha `idx` agora? { ok, why }
  function canShear(S, idx) {
    if (!(idx >= 0 && idx < (S.owned.ovelha | 0))) return { ok: false, why: 'ovelha desconhecida' };
    if (!fx(S).canShear) return { ok: false, why: 'precisa da tesoura de tosa' };
    if (!woolReady(S, idx)) return { ok: false, why: (S.reb.sheared[idx] | 0) === (S.day | 0) ? 'já tosquiada hoje' : 'a lã ainda está crescendo' };
    if (S.reb.wool >= fx(S).woolCap) return { ok: false, why: 'cesto de lã cheio — venda na caixa' };
    return { ok: true };
  }
  function shear(S, idx) {
    const c = canShear(S, idx); if (!c.ok) return c;
    const f = fx(S); let n = 1; S.reb.shearN = Math.min(1e9, (S.reb.shearN | 0) + 1);
    if (f.spareEvery && S.reb.shearN % f.spareEvery === 0) n++;
    n = Math.min(n, f.woolCap - S.reb.wool); S.reb.wool += n; S.reb.sheared[idx] = Math.max(1, S.day | 0);
    return { ok: true, gained: n };
  }
  // o produto do dia do coelho `idx`: alterna carne e pele crua (dia + índice par = carne)
  const rabbitKind = (S, idx) => (((S.day | 0) + idx) % 2 === 0) ? 'rmeat' : 'rpelt';
  const rabbitReady = (S, idx) => (S.reb.rdone[idx] | 0) !== (S.day | 0);
  function canCollectRabbit(S, idx) {
    if (!(idx >= 0 && idx < (S.owned.coelho | 0))) return { ok: false, why: 'coelho desconhecido' };
    if (!rabbitReady(S, idx)) return { ok: false, why: 'já deu o produto de hoje' };
    return { ok: true, kind: rabbitKind(S, idx) };
  }
  function collectRabbit(S, idx, rnd = Math.random) {
    const c = canCollectRabbit(S, idx); if (!c.ok) return c;
    const extra = rnd() < fx(S).rabbitBonus ? 1 : 0, n = 1 + extra, k = c.kind;
    S.reb[k] = Math.min(PRODUCT_CAP, S.reb[k] + n); S.reb.rdone[idx] = Math.max(1, S.day | 0);
    return { ok: true, kind: k, gained: n, extra: !!extra };
  }
  // para o balão "pronto" no jogo
  function ready(S, kind, idx) { return kind === 'ovelha' ? canShear(S, idx).ok : kind === 'coelho' ? canCollectRabbit(S, idx).ok : false; }

  /* ---------------- vira o dia ----------------
     Chame ao amanhecer (S.day já é o dia novo). Gasta o feno do cocho e a ração da tigela (1 para cada 4 bichos); sem estoque, o bônus do dia some (não há punição). */
  function dailyTick(S) {
    const f = fx(S), g = S.reb.gear, out = { fedSheep: false, fedRabbit: false, hay: 0, ration: 0 };
    S.reb.fed = 0; S.reb.fedR = 0;
    if (g.cocho && (S.owned.ovelha | 0) > 0 && S.reb.feed.feno >= f.feedNeed.feno) { S.reb.feed.feno -= f.feedNeed.feno; S.reb.fed = 1; out.fedSheep = true; out.hay = f.feedNeed.feno; }
    if (g.tigela && !g.alface && (S.owned.coelho | 0) > 0 && S.reb.feed.racao >= f.feedNeed.racao) { S.reb.feed.racao -= f.feedNeed.racao; S.reb.fedR = 1; out.fedRabbit = true; out.ration = f.feedNeed.racao; }
    if (g.alface) out.fedRabbit = true;                       // o canteiro alimenta de graça
    return out;
  }

  /* ---------------- oficina ---------------- */
  function canCraft(S, id) {
    const r = RECIPE_BY[id]; if (!r) return { ok: false, why: 'receita desconhecida' };
    if (!fx(S).workshop) return { ok: false, why: 'compre a oficina antes' };
    for (const k in r.take) { const have_ = k === 'milk' ? S.milk | 0 : S.reb[k] | 0; if (have_ < r.take[k]) return { ok: false, why: 'precisa de ' + r.take[k] + ' ' + (k === 'milk' ? 'leite' : PRODUCTS[k].name.toLowerCase()) + ' (você tem ' + have_ + ')' }; }
    for (const k in r.give) if ((S.reb[k] | 0) + r.give[k] > PRODUCT_CAP) return { ok: false, why: 'estoque cheio' };
    return { ok: true };
  }
  function craft(S, id) {
    const c = canCraft(S, id); if (!c.ok) return c;
    const r = RECIPE_BY[id];
    for (const k in r.take) { if (k === 'milk') S.milk -= r.take[k]; else S.reb[k] -= r.take[k]; }
    for (const k in r.give) S.reb[k] += r.give[k];
    return { ok: true, give: Object.assign({}, r.give) };
  }

  /* ---------------- venda ---------------- */
  const productValue = S => PRODUCT_KEYS.reduce((a, k) => a + (S.reb[k] | 0) * PRODUCTS[k].price, 0);
  const productCount = S => PRODUCT_KEYS.reduce((a, k) => a + (S.reb[k] | 0), 0);
  // tira os produtos do estado e devolve { total, n } (o game.js soma o ouro e as estatísticas, como faz com os peixes)
  function takeProducts(S) { const out = { total: productValue(S), n: productCount(S) }; for (const k of PRODUCT_KEYS) S.reb[k] = 0; return out; }

  return {
    ANIMALS, KINDS, PRODUCTS, PRODUCT_KEYS, GEAR, GEAR_BY, RECIPES, SPRITES, OWNED_DEFAULT,
    WOOL_DAYS, WOOL_DAYS_FED, WOOL_CAP, WOOL_CAP_BAG, SPARE_EVERY, HUTCH_SLOTS, HUTCH_MAX, FEED_CAP, FEED_PER,
    spriteUrl, iconUrl, defaults, sanitize, fx, canBuy, buy, buyFeedWithCarrots, canBuyAnimal, buyAnimal,
    canShear, shear, canCollectRabbit, collectRabbit, rabbitKind, ready, dailyTick, canCraft, craft, productValue, productCount, takeProducts,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Rebanho;      // testes em Node: require('../rebanho.js')
