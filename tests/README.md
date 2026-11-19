# Testes do FAZENDA LAS

Testes automáticos de **salvamento e carregamento**, em dois níveis. Sem dependências: só **Node 18+** e (para o nível 2) um Chrome ou Edge instalado.

```text
node tests/save.test.js                # 1) unitários do SaveManager, em Node puro (segundos)
node tests/run.js                      # 2) cenários no navegador headless (3 a 15 min; 4 em paralelo — numa máquina com pouca RAM use --jobs=1)
node tests/run.js quota-jogo           #    roda só um (ou vários) cenário(s)
node tests/run.js --list               #    lista os cenários
node tests/run.js --chrome="C:/caminho/chrome.exe" --jobs=2 --virtual=60000   # --virtual: orçamento de tempo virtual por cenário (ms)
node tests/make-fixtures.js            #    (re)gera as fixtures v2 a partir do jogo real
```

Código de saída `0` = tudo passou · `1` = algum teste falhou · `2` = erro de uso (só o `run.js`). Se o navegador não for achado, defina `CHROME_PATH`.

> **1) Unitários** (`tests/save.test.js`): carregam o `save.js` **de verdade** num storage falso em memória (com cota e falhas injetáveis) — é aqui que se simulam cota estourada, escrita interrompida entre `tmp`/`bak`/slot, corrupção, schema futuro e legado com precisão. As **regras do jogo** (sanitização) entram simuladas; as reais são cobertas pelo nível 2.
> **2) Navegador** (`tests/run.js`): o jogo de verdade **não é alterado** — o runner copia o projeto para uma pasta temporária e injeta os cenários no `index.html` da cópia (com `?debug`, que expõe `window.__game`).

## O que é testado

### 1) Unitários (`tests/save.test.js`, 57 testes)

Envelope e `crc` (vetores-padrão do FNV-1a + referência independente), `inspect` (adulterado, truncado, tipos errados, schema futuro, `__proto__`), migração v1 → v2 com fixtures reais, `deepMerge`, escrita segura (rev, `bak`, cota no `tmp`, falha no `bak`/slot, processo que morre entre `tmp` e slot), recuperação (`bak`/`tmp`), save futuro nunca sobrescrito (e permissão de uso único), aba velha (`Conflict`, N2, N4, `external`), cópias (R4/N1, dedupe, mesmo milissegundo, restore), legado (importa sem apagar, não ressuscita, inválido, corrigido, cópias antigas, `elias` × `leankar`, storage cheio), `cfg`, storage bloqueado e o `kit` de sanitização. **Fase 1c:** `useSlot`, `slots()` (resumo do estado saneado, `savedAt` só se for data), legado só no slot 1, apagar o slot 1 não ressuscita o legado, `lastSlot`, `external` só do slot em uso, sessões independentes por slot. Revisão da 1c: `peekBest` (slot → bak → tmp, futuro nunca "recuperado"), Apagar um jogo recuperado deixa cópia legível, `exportText`. Revisão da 1b: `hydrate` que lança, poda que falha, `crc` com `constructor`, slot vazio.

### 2) Cenários de navegador (59)

| Grupo | Cenários | O que garante |
| --- | --- | --- |
| Legado v1 que **deve carregar** | `fixture-pre-carne`, `fixture-atual`, `fixture-minimo`, `fixture-parcial`, `fixture-com-ptpk` | O save antigo é **importado** para v2 (schema 2, `crc` ok) sem tocar o original; carrega **sem `NaN`**, campos novos recebem padrões, animais batem com `owned`, o jogo roda 80 quadros e passa um dia, e regravar funciona (sem `pt`/`pk`) |
| Legado v1 que **não pode carregar** | `fixture-truncado`, `fixture-invalido`, `fixture-futuro`, `fixture-shape`, `fixture-versao` | Aviso com o motivo certo, o legado fica **intacto**, nenhum slot v2 é criado, 1 cópia idêntica, "Novo jogo" pede confirmação |
| Formato **v2** | `fixture-v2-ok`, `fixture-v2-truncado`, `fixture-v2-crc`, `fixture-v2-futuro` | `ok` carrega sem importar nada; truncado / `crc` errado / schema futuro são recusados com a mensagem certa, preservados e copiados |
| Legado → v2 | `legado-importa`, `legado-elias`, `legado-sem-ressuscitar`, `legado-cfg` | Importa sem apagar, cópias antigas viram cópias v2 com o mesmo `ts`; `elias` + `leankar` (N3); depois de "Novo jogo" o save antigo **não volta**; a configuração de áudio antiga é copiada |
| Recuperação e versão futura | `recupera-bak`, `recupera-tmp`, `futuro-nao-sobrescrito` | Slot danificado → recupera do `bak`/`tmp`, avisa, guarda o danificado, o `rev` continua e o 1º save não dá falso conflito; um save de versão mais nova **nunca é sobrescrito** (nem em `pagehide`) |
| Cópias de segurança | `rotacao-copias`, `poda-copias-validas`, `poda-copia-futura`, `poda-copia-versao`, `restaurar`, `restaurar-sem-copia` | Só 3 cópias; a poda descarta **ilegíveis** (R4), depois válidas, e por último as de versão futura (N1); restaurar funciona; sem espaço para a cópia do principal → "Restaurar mesmo assim" (R5) |
| **Falhas de gravação** | `quota-jogo`, `quota-boot`, `storage-bloqueado` | Cota **realmente** cheia (o teste enche o `localStorage` até o navegador lançar `QuotaExceededError`): `save()` devolve `{ok:false, error}`, avisa, o botão Salvar não mente, o aviso não se repete, o save anterior não é corrompido. Também: cópia que não cabe e modo privado (`SecurityError`) |
| **R1** — Novo jogo nunca apaga sem cópia | `novo-jogo-copia`, `novo-jogo-falha`, `novo-jogo-pausa`, `novo-jogo-sem-espaco`, `novo-jogo-rev` | Título e pausa guardam cópia **antes** de apagar (slot, `bak` e `tmp` saem juntos); jogo novo que falha ao iniciar não apaga o antigo; sem espaço → baixar e 2º clique; `rev` continua a contagem |
| **R2** — aba velha | `aba-velha`, `aba-apagada`, `rev-estranho` | `Conflict`, `pagehide` não sobrescreve, aviso (Esc não fecha), "Usar esta aba" guarda cópia; save apagado por outra aba não é recriado (N4); `rev` 5.5 / 1e13 / `"7"` / −3 / `null` não geram conflito falso (N2) |
| **R3** — save válido porém hostil | `hostil-estado`, `hostil-estado-v2`, `hostil-estruturas`, `hostil-crops-obs`, `falha-inicio` | `tool: 99`, `goal: -1`, `owned: 4000`, `obs: {}`, `crops: null`... são corrigidos (legado **e** envelope v2 válido com dados hostis): o jogo inicia, sem `NaN`, original em cópia, o aviso aparece; se o início falhar → Baixar cópia, sem "recarregue" |
| **Fase 1c — 3 slots** | `slots-cartoes`, `slots-nome-hostil`, `slots-independentes`, `slots-novo-em-outro`, `slots-apagar`, `slots-apagar-sem-espaco`, `legado-vai-para-slot1`, `continuar-pausado`, `e2e-recarrega` | 3 cartões (ok / ilegível / vazio) e os botões certos para cada um; nome hostil do arquivo não vira HTML; cada slot grava só no seu (`slot=N`, `rev` próprio, `lastSlot`); Novo jogo em slot vazio não toca nos outros nem cria cópia; **Apagar** guarda cópia, confirma e só mexe no slot escolhido (sem espaço → baixar e 2º clique); legado vai para o slot 1; **Continuar abre pausado** (relógio parado até fechar o menu); **E2E com recarga real**: novo jogo no slot 2 → jogar → *Trocar de jogo* → o título abre no slot 2 → Continuar → estado **idêntico campo a campo**; **revisão da 1c:** `slots-apagar-recuperado` e `novo-jogo-recuperado` (a cópia guardada é o jogo legível, o `bak`), `slots-trocar-futuro` e `slots-trocar-conflito` (Trocar de jogo não recarrega em silêncio) |
| Configuração de áudio | `cfg-audio` | Desligar música/efeitos grava; recarregar mantém; religar grava |
| Gatilhos e conteúdo | `salva-eventos`, `pt-pk-fora-do-save` | Salva ~0,8 s depois de compra/venda/plantio (rajadas = 1 gravação); `pt`/`pk` não vão para o save |

## Fixtures (`tests/fixtures/*.json`)

São **versionadas**. Duas famílias:

| Arquivo | Origem |
| --- | --- |
| `save_v2_ok.json` | **gerado** por `node tests/make-fixtures.js` com o jogo **atual** (envelope v2; animais 3/4/2, plantas, carne, posturas) |
| `save_v2_crc_errado.json`, `save_v2_truncado.json`, `save_v2_futuro.json` | derivados do `save_v2_ok`: dado alterado sem recalcular o `crc` · cortado em 60 % · `schema: 3` |
| `save_v1_*.json`, `save_invalido.json`, `save_futuro_schema99.json`, `save_versao_desconhecida.json` | formato **legado v1 — CONGELADAS**: o jogo atual não grava mais v1, então não se regeneram; são a entrada dos cenários de importação |
| `save_v1_pre_carne.json` | gravado pelo jogo **antigo** (commit `4397c24`, antes de carne/posturas/limites; plantas ainda com `pt`/`pk`) |

**Regra do projeto:** ao mudar o **formato** do save, (1) acrescente o padrão em `newState()` e a regra em `sanitizeState()`, (2) se mudar o formato dos dados, acrescente uma migração em `SAVE_MIGRATIONS` (`save.js`) e (3) **mantenha** a fixture do formato anterior (grave uma nova a partir do commit anterior à mudança); `save_v2_ok` é regenerada com `node tests/make-fixtures.js`.

## Escrevendo cenários: use o `T` (armazenamento neutro ao formato)

Os cenários em `tests/browser/scenarios.js` **não sabem** em que chave nem em que formato o save mora: tudo passa pelo objeto `T` (bloco no topo do arquivo, com a lista completa). Foi o que permitiu mudar o formato na Fase 1b mexendo **só no `T`** e em poucos cenários que dependiam de formato.

| Quero… | Use |
|---|---|
| limpar tudo | `T.reset()` |
| os 3 slots (os helpers desta tabela agem no **slot 1**) | `T.slotRaw(n)`, `T.slotState(n)`, `T.slotEnv(n)`, `T.setSlot(n, raw)`, `T.setSlotState(n, st)`, `T.removeSlot(n)`, `T.lastSlot()` |
| semear / ler o save principal (slot v2) | `T.setMain(raw)`, `T.setMainState(objeto)` → raw, `T.readMain()` (texto), `T.mainState()` (dados + `rev`; `null` se não há) |
| inspecionar o formato | `T.mainEnv()`, `T.mainSchema()`, `T.mainCrcOk()` |
| `bak` / `tmp` (escrita segura) | `T.setBak/readBak`, `T.setTmp/readTmp` |
| simular "outra aba" | `T.setMainState(...)`, `T.removeMain()` (slot+bak+tmp), `T.fireStorage(raw)` (`null` = apagou), `T.fireStorageClear()` |
| cópias de segurança | `T.copies()` (`[{key, ts, raw, state}]`), `T.copyRaw(ts)`, `T.seedCopy(ts, raw)` (`ts null` = 0) |
| **legado v1** (só leitura pelo jogo) | `T.setLegacy(raw)`, `T.setLegacyState(obj)`, `T.readLegacy()`, `T.setElias/readElias`, `T.setLegacyCopy/readLegacyCopy`, `T.setLegacyCfg/readLegacyCfg` |
| contar gravações do save | `Storage.prototype.setItem` + `T.isMainKey(k)` |
| fixtures / textos de save mínimo | `T.fixtureState(nome)`, `T.validRaw(dia, ouro)` (v2; atalho `validSave`), `T.validLegacyRaw(dia, ouro)` (v1) |

**Regra:** não escreva `localStorage.getItem('fazenda_…')` nem monte chaves num cenário. Continuam diretos só o que **não depende do formato**: `fillStorage()` (enche a cota de verdade) e os marcadores em `sessionStorage` dos cenários que recarregam a página. O `T.validRaw` usa `savedAt` **fixo** (o mesmo estado gera sempre o mesmo texto, mesmo depois de recarregar a página).

## Como o teste é validado

A suíte é conferida com **mutações** (quebrar o jogo de propósito numa cópia e ver se algum teste falha). **21 mutações detectadas**: `save()` que engole o erro; poda por data (R4) e save futuro tratado como lixo (N1); `rev` sanitizado (N2); save apagado recriado e `storage` ignorando `null` (N4); sem checagem de `rev` (R2); Novo jogo sem cópia no título e na pausa (R1); sanitizador desligado (R3); restaurar sem checar a cópia (R5); `cfg` que não persiste; e, na Fase 1b, **`crc` ignorado, fallback `bak`/`tmp` desligado, `bak` trocado por lixo, save futuro sobrescrito, legado que ressuscita ou é apagado, `elias` sem cópia, cópias antigas e `cfg` antiga não migradas, sessão confundindo "slot ausente"**. Um mutante só vale se existir um teste que o cubra — foi assim que apareceu a lacuna do `cfg` (daí o `cfg-audio`).

## Limites

- Só testa o navegador em que roda (Chrome/Edge). **Não** cobre Safari/iOS nem Firefox.
- O download do "Baixar cópia (.json)" é acionado, mas o arquivo baixado não é inspecionado.
- Não há testes de jogabilidade (só salvar/carregar) e **duas abas reais** continuam simuladas numa página só (um teste com `iframe` não concluiu no headless).
- `tests/` **não** deve ir para o deploy (Fase 3 do plano de persistência).
- **O Chrome headless depende do display:** com a **tela do Windows bloqueada/apagada** ele quase não produz quadros (medido: 2 quadros em 3 s). O runner injeta um `requestAnimationFrame` com **fallback lento** (250 ms de tempo virtual, sempre com `performance.now()` — misturar com o timestamp do `rAF` real dá `dt` negativo) para a suíte não travar — mas aí cada cenário leva ~1 min em vez de segundos. Para rodar rápido, **deixe a sessão destravada**.
- **Higiene:** o runner remove o que cria; scripts avulsos de mutação/diagnóstico devem apagar suas pastas em `%TEMP%` (centenas de cópias do site e perfis do Chrome se acumulam: chegaram a ~1 GB e atrapalham).
