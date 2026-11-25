# FAZENDA LAS

Jogo de fazenda em HTML5 Canvas + JavaScript puro (sem build, sem dependências).
Abra `index.html` no navegador (Chrome/Edge/Firefox) e jogue — ou use a versão publicada: **https://leankar-dev.github.io/fazenda_las/** (veja "Jogar online e offline").

## Personagens
Em **Novo jogo** você escolhe entre **Elias** (o fazendeiro) e **Karen** (a fazendeira). Os dois têm as mesmas habilidades; a escolha é salva no jogo e pode ser trocada a qualquer momento em **Esc → Trocar personagem**.
Na tela de escolha você também **dá um nome a cada personagem** (padrão: Elias e Karen, até 16 letras); depois, em **Esc → Alterar nome**, dá para trocar quando quiser. Os nomes ficam no save (saves antigos continuam com os nomes padrão).
Para adicionar outro personagem: crie `assets/<pasta>/` com os mesmos 16 sprites e registre-o em `CHARACTERS` no `game.js`.

## Controles
- **WASD / setas** mover · **Shift** correr
- **1–7** ferramentas (Forcado, Regador, Sementes, Luvas, Picareta, Machado, **Vara de pesca**) ou roda do mouse
- **Espaço** ou **clique** usa a ferramenta · **E** (ou botão direito) interage · **Q** troca a semente · **C** chama o cachorro · **F** comer peixe · **M** música · **N** efeitos sonoros · **Esc** pausa

## Árvores frutíferas e machado
- O **machado (6)** corta árvores: as do cenário (menos as da borda do mapa), as selvagens e as que você plantou. Rende madeira e deixa um toco (a picareta remove o toco). Árvores cortadas ficam cortadas no save.
- No **empório** você compra **mudas** de macieira, laranjeira, pessegueiro e limoeiro. Escolha a muda com **Q**, use a ferramenta **3** em terra livre (sem arar). Ela cresce em 4 dias e depois dá 2–4 frutas a cada 3 dias; colha com **E** ou com as luvas.
- Há árvores frutíferas selvagens espalhadas pela fazenda.

## Animais
- **Cachorro** (já vem com você): passeia sozinho pela fazenda e senta para descansar. Aperte **C** (ou o botão 🐕 no celular) para **chamá-lo**: ele vem correndo e acompanha você por cerca de 50 s, depois volta a passear. Ganha carinho com **E** e todo dia cava um **tesouro** em algum lugar da fazenda (monte de terra com patinha) — cave com **E**.
- **Curral** (a leste, cercado, com portão a oeste): compre na loja até **4 vacas** (leite diário, ordenhe com **E** quando aparecer o balão), **4 porcos** (carne 2× por dia e trufas) e **2 cavalos**.
- **Cavalo:** **E** perto dele para montar, **E** de novo para desmontar. Ele tem **ciclo de caminhada animado** nas 4 direções (4 a 5 quadros por direção) (andando solto ou montado; parado fica em pé com as pernas juntas). Cavalgando você anda quase 2× mais rápido, mas só interage (loja, caixa, poço), sem usar ferramentas.
- **Ordenhar:** chegue perto da vaca com o balão de balde e use as **Luvas (4) + Espaço** (ou **E**). Uma vez por vaca por dia.
- **Carne do porco:** 2 vezes por dia (ao amanhecer e a partir das 13:00) cada porco dá 1 carne — quando aparecer o balão de presunto, use **E** ou as **Luvas (4) + Espaço**. Carne vende por 30 ◎.
- **Galinhas:** são 6 e botam ovos 2 vezes por dia (ao amanhecer e ao meio-dia, 13:00). Ovos não coletados da manhã ficam no chão até você dormir.
- **Colher frutas:** perto de uma árvore com o balão de fruta, use as **Luvas (4) + Espaço** (ou **E**). O alvo "gruda" no que está pronto ao lado de onde você olha.
- Leite, carne, trufas, frutas e ovos vão para o cesto/inventário e são vendidos na caixa de vendas.

## Pesca no lago 🎣
O lago, a leste, tem **peixes de verdade** nadando (você os vê como silhuetas na água; com os **óculos polarizados** eles aparecem coloridos). Na **margem oeste** há uma **doca** de tábuas: de lá a boia alcança mais longe.
- **Como pescar:** compre a **vara spinning** no empório (aba **Pesca**), selecione a vara (**7**), fique de frente para a água e use **ESPAÇO** (ou clique): a linha é lançada. Um peixe próximo nada até a isca. Quando a boia afundar e aparecer o **!** sobre a cabeça, aperte **ESPAÇO** de novo (ou **E**) dentro de ~1 s para **fisgar**. Apertar cedo demais só recolhe a linha; trocar de ferramenta ou andar para longe também.
- **Peixes:** perca-sol (comum, vale 10 ◎), crappie (16 ◎), bagre (26 ◎) e achigã (raro, 42 ◎). Os maiores às vezes se **soltam** depois de fisgados. Amanhecer, entardecer e chuva deixam os peixes mais ativos. O lago amanhece cheio e vai repondo peixes durante o dia.
- **Usar o peixe:** **venda** na caixa de vendas (a balança dá +20%) ou **coma** (**F**, ou Esc → Comer peixe): cada espécie recupera energia (12 a 32). O cesto de pesca comporta 8 peixes (acessórios aumentam).
- **Equipamentos** (aba **Pesca** do empório): **vara de fly** (os peixes chegam 30% mais rápido) e **carretéis** (mais tempo para fisgar, peixe grande se solta menos); **iscas** de cera e vivas (gastam 1 por lançamento; a viva é mais rápida e atrai os raros); **iscas artificiais** de compra única (minhoca, minnow, colher, popper: cada uma atrai mais uma espécie); e acessórios — chumbada, linha, **puçá**, **óculos polarizados**, **chapéu** (pescar gasta metade da energia), **colete** (às vezes poupa a isca), **caixa de pesca** (mais iscas), **cordão** e **rede de captura** (cabem mais peixes), **balança** e **multiferramenta** (+25% de energia ao comer).
- A **margem do lago** agora é rochosa, com juncos, e a doca tem estacas (arte de `docs/equipamentos_pescca.jpeg`).

## Como jogar
Arar → plantar → regar → (depois das 18:00) dormir na porta da casa → colher → vender na caixa → comprar mais sementes/melhorias.
Pedras e tocos saem com a picareta; mato com o forcado; ovos das galinhas valem dinheiro.
Dias de chuva regam tudo sozinhos. O progresso é salvo automaticamente (localStorage).

## Jogos salvos (3 slots)
A tela inicial mostra **3 cartões de jogo** (personagem, nome, dia, ouro e há quanto tempo foi salvo). Escolha um cartão e use **Continuar**, **Novo jogo** ou **Apagar**; um cartão vazio só aceita Novo jogo. Os 3 jogos são independentes. A tela abre no último jogo que você jogou.
- **Continuar** abre o jogo **pausado** (menu de pausa aberto): feche com **Esc** ou **Continuar** quando estiver pronto.
- **Esc → Trocar de jogo** salva e volta à tela inicial para escolher outro cartão.
- **Apagar** e **Novo jogo** sobre um jogo existente guardam antes uma cópia de segurança neste navegador (as 3 mais recentes, de todos os jogos); se não couber, o jogo oferece baixar o arquivo antes.
  Num jogo **recuperado** (slot danificado, versão anterior boa) a cópia é a da versão legível, não a do arquivo danificado.
- **Trocar de jogo** nunca descarta progresso em silêncio: se não der para salvar (outra aba salvou depois, ou o jogo está salvo numa versão mais nova), o jogo mostra o aviso e as opções (usar esta aba, baixar cópia, sair mesmo assim).
- O título da aba é sempre **FAZENDA LAS** (não leva mais o nome do personagem, já que há 3 jogos).

## Backup e troca de aparelho (Exportar / Importar)
Os jogos ficam **só neste navegador** (`localStorage`): limpar os dados do site, trocar de navegador ou de aparelho os perde. Por isso dá para levar o jogo num arquivo:
- **Exportar** (tela inicial, no cartão escolhido, ou **Esc → Exportar** durante o jogo) baixa `fazenda-las-AAAA-MM-DD-slotN.json`. Guarde o arquivo num lugar seguro (e-mail, nuvem, pen drive). Pelo menu de pausa sai o jogo **como está na tela**, mesmo que esta aba não consiga salvar.
- **Importar** (tela inicial) lê um arquivo `.json` exportado, **mostra o resumo** (personagem, dia, ouro, quando foi salvo) e deixa **escolher em qual jogo gravar** (o padrão é o primeiro cartão vazio). Nada é gravado antes de você confirmar; se o jogo escolhido já existe, o jogo atual vira antes uma **cópia de segurança** (e, se a cópia não couber, o jogo oferece baixar o arquivo antes).
- Um arquivo que não é um jogo do FAZENDA LAS, está incompleto, foi alterado à mão ou é de uma versão mais nova do jogo é **recusado com uma mensagem clara e nada é gravado**. Arquivos de saves antigos (formato anterior) também são aceitos.

## Está salvando? (indicador, avisos e aba única)
- O **💾 no canto do painel** mostra o estado do salvamento: **✓ verde** = salvo (passe o mouse para ver a hora); **! amarelo** = esta aba não está salvando porque outra aba salvou depois (ou o jogo está salvo numa versão mais nova); **! vermelho** = o jogo **não está sendo salvo** (sem espaço no navegador, modo anônimo ou dados do site bloqueados) ou outra aba está com o jogo. Clique nele para abrir o menu (onde fica o **Exportar**).
- Quando **não consegue salvar**, uma **faixa vermelha** pede para **Exportar agora** (baixa o jogo como está na tela). **Dispensar** a esconde até o salvamento voltar e falhar de novo. Se o navegador já não deixa salvar na abertura, a tela inicial avisa **antes** de você jogar.
- Ao **bater uma meta**, o jogo sugere (faixa verde) guardar um backup com **Exportar**; não insiste se você acabou de exportar.
- O jogo pede ao navegador para **não apagar os dados do site** (`navigator.storage.persist()`) depois do seu primeiro clique ou tecla. O **Esc** mostra se isso foi concedido; se não, o aviso lembra de exportar de vez em quando (no iPhone/iPad o Safari pode apagar dados de sites não abertos por cerca de 7 dias).
- **Só uma aba joga por vez.** Se o FAZENDA LAS já está aberto em outra aba ou janela, a nova aba mostra "já está aberto em outra aba" e **não inicia** (nem grava). **Assumir aqui** faz a outra aba **salvar o jogo e parar** (se ela não responder em ~3 s, esta toma o jogo). Se a outra aba for fechada, esta entra sozinha. A aba que perdeu o jogo oferece **Baixar meu jogo** e **Recarregar**. Navegadores sem essa função continuam protegidos pelo aviso de "jogo aberto em outra aba".

## Jogar online e offline (GitHub Pages / PWA)
- O jogo publicado funciona **sem internet** depois da **primeira visita**: o navegador guarda o site inteiro (≈ 3 MB) e abre direto do aparelho. No celular, use **Instalar app / Adicionar à tela inicial** (Chrome Android: menu ⋮ → *Instalar app*; Safari iPhone: Compartilhar → *Adicionar à Tela de Início*) — instalado, o jogo abre em tela cheia, com ícone próprio. Instalar também ajuda a proteger os dados: o Safari costuma apagar os dados de sites que ficam ~7 dias sem uso, e um app instalado tem tratamento melhor.
- **Atualizações:** quando há uma versão nova, ela chega sozinha na **próxima vez que você abrir** (com internet); o jogo aberto nunca recarrega sozinho. **Seu jogo salvo não é afetado** — ele fica no armazenamento do navegador, que a atualização não toca.
- **Onde ficam meus saves?** No `localStorage` do navegador, **só neste aparelho e neste navegador**, na origem `leankar-dev.github.io` (chaves `fazenda_las:v2:*`). O site publicado e o arquivo local (`file://`) são **origens diferentes**: um jogo salvo abrindo o `index.html` do disco **não aparece** no site (e vice-versa) — use **Exportar → Importar** para levar o jogo de um para o outro. Limpar os dados do site apaga os jogos: **exporte um backup de vez em quando**.
- **Privacidade:** o FAZENDA LAS não tem servidor, conta, anúncio nem rastreador. **Nada do seu jogo sai do seu aparelho**: o único tráfego de rede é baixar os arquivos do jogo (o GitHub Pages registra acessos como qualquer site). O jogo só grava no armazenamento local do navegador e em arquivos que **você** baixa (Exportar).

## Publicar (para quem mantém o projeto)
- O deploy é automático: cada **push na `main`** roda `.github/workflows/pages.yml` (testes rápidos → `node tools/build-site.js` → GitHub Pages). **Uma vez**, em *Settings → Pages → Build and deployment → Source*, escolha **GitHub Actions**.
- `node tools/build-site.js [--out=_site]` monta o site: publica só `index.html`, `style.css`, os `.js`, `manifest.webmanifest`, `pwa/` e `assets/` (nada de `docs/`, `tests/`, `tools/`, `.jpeg`), acrescenta `?v=<hash>` nos scripts/estilo (quebra o cache da CDN), liga o manifesto e gera o `service-worker.js` com o mesmo hash. **Igual conteúdo = igual versão.** O `index.html` do repositório continua abrindo por `file://`, sem service worker.
- Estratégia do service worker (`tools/service-worker.template.js`): **página = rede primeiro** (4 s de limite, depois o cache); **scripts/estilo = só a versão exata (`?v=`)**; **imagens = cache primeiro**. A instalação é tudo-ou-nada, e só os caches `fazenda-las-*` são apagados (o `github.io` é compartilhado com outros projetos).
- **Novo asset?** Ele entra sozinho no cache (o build lista `assets/` inteiro). Confira a **caixa do nome do arquivo** (o Pages é case-sensitive; o Windows não) — `tests/build.test.js` confere que os assets publicados são exatamente os do repositório.
- Ícones do PWA: `python tools/make-icons.py` (Pillow) regenera `pwa/icon-*.png` a partir dos sprites.

## Arquivos
- `assets/fazendeiro/` e `assets/fazendeira/` – o Elias e a Karen. Cada pasta tem uma **sprite sheet de caminhada** `walk_sheet.png` (560×688, fundo transparente, 4 direções × 5 quadros, células 112×172, altura normalizada entre as direções), `walk_sheet.json` (laço do ciclo, quadro de repouso), `front.png` (retrato 2× do título, da escolha e do HUD) e as ferramentas/cesto (`basket`, `glove1/2`, `pickaxe`, `pitchfork`, `seedbag_empty`). Gerados de `docs/fazendeiro_andando.jpeg` e `docs/fazendeira_andando.jpeg` por `python tools/make-walker-sprites.py fazendeiro|fazendeira` (numpy, scipy, opencv); o jogo recorta a sheet em 20 quadros ao carregar. Na fonte da Karen as poses de **costas vieram sem chapéu**: o gerador compõe o chapéu (tirado dos quadros de frente)
- `assets/fazendeira/` – sprites da Karen (recortados de `docs/imagem_fazendeira.jpeg`, inclui os chapéus)
- `assets/tile_*.png` – tiles de terreno compartilhados pelos dois personagens
- `assets/casa.png` (+ `casa.json`) – a **casa principal** (tijolos, pórtico com porta vermelha; as janelas acendem à noite), gerada de `docs/casa_fazenda.jpeg` por `python tools/make-house-sprite.py` (remove o "xadrez" do fundo do JPEG; numpy, scipy, opencv)
- `assets/animais/` – cachorro, vaca e porco (vistas estáticas), `props/` (37 acessórios) e `tiles/` (15), recortados de `docs/animais.jpeg`
- `assets/animais/cavalo/` – **sprite sheet animada** `walk_sheet.png` (920×640, fundo transparente: **5 quadros do ciclo × 4 direções**, células de 184×160 com os pés no centro-base), `walk_sheet.json` (metadados) e `icon.png` (busto 96×96 da loja). Gerados de `docs/cavalo_sprite_sheet.jpeg` por `python tools/make-horse-sprites.py` (numpy, scipy, opencv, Pillow); o jogo recorta a sheet em 20 quadros ao carregar
- `animais.js` – curral, comportamento dos animais e montaria
- `pesca.js` – a **pesca**: peixes, lago, lançamento (voar → esperar → fisgar → recolher), catálogo e efeitos dos equipamentos, compra, comer/vender, saneamento do save (lógica sem DOM, testada em Node)
- `assets/pesca/` – 29 sprites de pesca (4 peixes virados para a esquerda, varas, carretéis, iscas, acessórios, rede, **doca, estaca e margem do lago**) + `pesca.json`; gerados de `docs/equipamentos_pescca.jpeg` por `python tools/make-fishing-sprites.py`
- `art.js` – arte procedural complementar (plantações, empório, árvores, galinhas...)
- `save.js` – persistência (`SaveManager`): salvar/carregar, cópias de segurança, exportar/importar, proteção contra duas abas (aviso por `rev` + bloqueio de jogo por Web Locks), sonda do storage, `persist()` e configuração de áudio
- `game.js` – lógica, renderização, UI e áudio (WebAudio)
- `manifest.webmanifest`, `pwa/` – app instalável (nome, cores, ícones) · `tools/` – build do site e do service worker · `.github/workflows/pages.yml` – deploy

## Música e animações
Música de fundo gerada em tempo real (WebAudio): tema alegre de dia, caixinha de música com grilos à noite e tema calmo com som de chuva nos dias chuvosos.
Animações: sombras de nuvens, vento nas árvores/mato, borboletas, pássaros, folhas, vagalumes, respingos de chuva, brotar das plantas, galinhas que fogem, tremor ao quebrar pedra, entre outras.

## Regras de tempo
- O dia vai de 06:00 a 24:00 (270 s reais). **Só dá para dormir depois das 18:00**; à meia-noite o personagem desmaia de cansaço e acorda com energia parcial.
- Ovos: 1ª postura ao amanhecer, 2ª às 13:00. Carne do porco: 1ª ao amanhecer, 2ª a partir das 13:00.
- Mato novo nasce toda noite, mas há um limite (70) e ele não aparece no curral, no galinheiro nem sobre ovos/trufas/tesouros.
- Para depurar no console, abra o jogo com `?debug` na URL (expõe `window.__game`).
- Se um save não for reconhecido, ele é copiado para uma cópia de segurança (`fazenda_las:v2:copy:<data>` no `localStorage`) antes de qualquer sobrescrita. Os saves das versões anteriores (`fazenda_leankar_*`) são importados para o jogo 1 e nunca apagados.
