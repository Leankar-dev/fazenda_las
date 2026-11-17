# Testes do FAZENDA LAS

Testes automáticos de **salvamento e carregamento**. Rodam o jogo de verdade num Chrome/Edge *headless* (sem janela), com `localStorage` limpo a cada cenário. Sem dependências: só **Node 18+** e um Chrome ou Edge instalado.

```text
node tests/run.js                      # roda todos os cenários (2 a 5 min; 4 em paralelo)
node tests/run.js quota-jogo           # roda só um (ou vários) cenário(s)
node tests/run.js --list               # lista os cenários
node tests/run.js --chrome="C:/caminho/chrome.exe" --jobs=2
```

Código de saída `0` = tudo passou · `1` = algum teste falhou · `2` = erro de uso. Se o navegador não for achado, defina `CHROME_PATH`.

> O jogo de verdade **não é alterado**: o runner copia o projeto para uma pasta temporária e injeta os cenários no `index.html` da cópia. Os cenários usam `?debug` (que expõe `window.__game`).

## O que é testado

| Grupo | Cenários | O que garante |
| --- | --- | --- |
| Saves que **devem carregar** | `fixture-pre-carne`, `fixture-atual`, `fixture-minimo`, `fixture-parcial`, `fixture-com-ptpk` | Save antigo/mínimo/parcial carrega **sem `NaN`** nem `undefined` na tela, campos novos recebem padrões, animais batem com `owned`, o jogo roda 80 quadros e passa um dia sem erro, e regravar funciona (sem `pt`/`pk`) |
| Saves que **não podem carregar** | `fixture-truncado`, `fixture-invalido`, `fixture-futuro`, `fixture-shape`, `fixture-versao` | Aviso na tela inicial com o motivo certo, save original **intacto**, 1 cópia de segurança idêntica, "Novo jogo" pede confirmação |
| Cópias de segurança | `rotacao-copias`, `poda-copias-validas`, `poda-copia-futura`, `poda-copia-versao`, `restaurar`, `restaurar-sem-copia` | Só 3 cópias ficam; a poda descarta primeiro as **ilegíveis** (R4), depois as válidas, e **por último** as de versão futura/desconhecida (N1); nunca a única válida; restaurar oferece a cópia válida mais nova e realmente restaura; se o principal ilegível não tem cópia (sem espaço), o 1º clique não o sobrescreve — pede "Restaurar mesmo assim" (R5) |
| **Falhas de gravação** | `quota-jogo`, `quota-boot`, `storage-bloqueado` | Cota **realmente** cheia (o teste enche o `localStorage` até o navegador lançar `QuotaExceededError`): `save()` devolve `{ok:false, error}`, avisa o jogador, o botão Salvar não mente, o aviso não se repete a cada autosave, o save anterior não é corrompido, e há aviso de recuperação. Também: cópia que não cabe, e modo privado (`SecurityError`) |
| **R1** — Novo jogo nunca apaga sem cópia | `novo-jogo-copia`, `novo-jogo-falha`, `novo-jogo-pausa`, `novo-jogo-sem-espaco`, `novo-jogo-rev` | Título e pausa guardam uma cópia **antes** de apagar; se o jogo novo falhar ao iniciar o save antigo continua intacto; sem espaço para a cópia → oferece baixar e exige um 2º clique; `rev` continua a contagem |
| **R2** — aba velha não sobrescreve | `aba-velha`, `aba-apagada`, `rev-estranho` | Aba velha tem o save recusado (`Conflict`), `pagehide` não sobrescreve, aparece o aviso (Esc não fecha), "Usar esta aba" guarda cópia da outra, evento `storage` marca a aba como velha; uso normal não dá falso conflito. `aba-apagada` (N4): save apagado por outra aba não é recriado (nem em `pagehide`), evento `storage` com `newValue`/`key` nulos avisa. `rev-estranho` (N2): `rev` 5.5, 1e13, `"7"`, −3, `null` não geram conflito falso |
| **R3** — save válido porém hostil | `hostil-estado`, `hostil-estruturas`, `hostil-crops-obs`, `falha-inicio` | `tool: 99`, `goal: -1`, `owned: 4000`, `obs: {}`, `crops: null`, espécie desconhecida, `energy: "x"`... são corrigidos: o jogo inicia, 80 quadros sem erro, sem `NaN`, original guardado em cópia; se o início falhar → caixa com Baixar cópia, sem "recarregue" |
| Gatilhos e conteúdo | `salva-eventos`, `pt-pk-fora-do-save` | Salva ~0,8 s depois de compra/venda/plantio (rajadas viram 1 gravação; compra recusada não grava); `pt`/`pk` das plantas não vão para o save e o estado vivo não muda |

## Fixtures (`tests/fixtures/*.json`)

São **versionadas** e geradas por `node tests/make-fixtures.js` (que usa o jogo de verdade, não JSON escrito à mão):

| Arquivo | Origem |
| --- | --- |
| `save_v1_atual.json` | gravado pelo jogo **atual** (animais 3/4/2, plantas, carne, posturas) |
| `save_v1_pre_carne.json` | gravado pelo jogo **antigo** (commit `4397c24`, antes de carne/posturas/limites; plantas ainda com `pt`/`pk`) |
| `save_v1_parcial.json` | derivado: `up`/`stat`/`owned`/`seeds`/`harvest` só com algumas chaves (exercita o merge com os padrões) |
| `save_v1_minimo.json` | só `v`, `day`, `gold`, `min`, `soil`, `crops` |
| `save_v1_com_ptpk.json` | derivado: plantas com `pt`/`pk` |
| `save_v1_truncado.json`, `save_invalido.json` | JSON cortado / lixo |
| `save_futuro_schema99.json`, `save_versao_desconhecida.json`, `save_v1_shape.json` | `v: 99`, `v: 0`, sem mapa (`soil: []`) |

**Regra do projeto:** ao mudar o **formato** do save (campo novo no estado, schema novo), (1) acrescente o padrão em `newState()`, (2) trate em `parseSave()` (e em `MIGRATIONS`, se mudar o formato), (3) regenere as fixtures com `node tests/make-fixtures.js` e (4) **mantenha** a fixture do formato anterior (`save_v1_pre_carne.json` é a "versão anterior" de hoje — quando houver outra mudança, grave uma nova a partir do commit anterior à mudança).

## Escrevendo cenários: use o `T` (armazenamento neutro ao formato)

Os cenários em `tests/browser/scenarios.js` **não sabem** em que chave nem em que formato o save mora: tudo passa pelo objeto `T` (bloco no topo do arquivo). Quando o formato mudar (Fase 1b do plano de persistência), **só o bloco `T` é reescrito** — os cenários continuam iguais.

| Quero… | Use |
|---|---|
| limpar tudo / semear o save principal | `T.reset()`, `T.setMain(raw)`, `T.setMainState(objeto)` |
| ler o save principal | `T.readMain()` (texto), `T.mainState()` (objeto; `null` se não há) |
| simular "outra aba" gravando / apagando | `T.setMainState(...)`, `T.removeMain()`, `T.fireStorage(raw)` (raw `null` = apagou), `T.fireStorageClear()` |
| cópias de segurança | `T.copies()` (`[{key, ts, raw, state}]`, da mais antiga à mais nova), `T.copyRaw(ts)`, `T.seedCopy(ts, raw)` (`ts null` = chave antiga sem data) |
| contar gravações do save | `Storage.prototype.setItem` + `T.isMainKey(k)` |
| fixtures / texto de um save mínimo | `T.fixtureState(nome)`, `T.validRaw(dia, ouro)` (atalho `validSave`) |

**Regra:** não escreva `localStorage.getItem('fazenda_…')` nem monte chaves `…_backup_…` num cenário. O que continua direto são os utilitários **que não dependem do formato**: `fillStorage()` (enche a cota de verdade) e os marcadores em `sessionStorage` dos cenários que recarregam a página.

## Como o teste é validado

A suíte foi conferida com **mutações** (quebrar o jogo de propósito numa cópia e ver se algum teste falha): `save()` que engole o erro, `loadSave()` sem completar `up`/`stat`, save voltando a gravar `pt`/`pk`, save inválido apagado em vez de copiado, **Novo jogo sem cópia (título e pausa) ou apagando antes de iniciar**, **sem checagem de `rev` entre abas**, **sanitizador desligado ou sem limite de `owned`** e **falha ao iniciar sem a caixa de baixar**. Todas foram detectadas.

## Limites

- Só testa o navegador em que roda (Chrome/Edge). **Não** cobre Safari/iOS nem Firefox.
- O download do "Baixar cópia (.json)" é acionado, mas o arquivo baixado não é inspecionado.
- Não há testes de jogabilidade (só salvar/carregar).
- `tests/` **não** deve ir para o deploy (Fase 3 do plano de persistência).
