# fazenda_leankar

Jogo de fazenda em HTML5 Canvas + JavaScript puro (sem build, sem dependências).
Abra `index.html` no navegador (Chrome/Edge/Firefox) e jogue.

## Personagens
Em **Novo jogo** você escolhe entre **Elias** (o fazendeiro) e **Karen** (a fazendeira). Os dois têm as mesmas habilidades; a escolha é salva no jogo e pode ser trocada a qualquer momento em **Esc → Trocar personagem**.
Na tela de escolha você também **dá um nome a cada personagem** (padrão: Elias e Karen, até 16 letras); depois, em **Esc → Alterar nome**, dá para trocar quando quiser. Os nomes ficam no save (saves antigos continuam com os nomes padrão).
Para adicionar outro personagem: crie `assets/<pasta>/` com os mesmos 16 sprites e registre-o em `CHARACTERS` no `game.js`.

## Controles
- **WASD / setas** mover · **Shift** correr
- **1–6** ferramentas (Forcado, Regador, Sementes, Luvas, Picareta, Machado) ou roda do mouse
- **Espaço** ou **clique** usa a ferramenta · **E** (ou botão direito) interage · **Q** troca a semente · **M** música · **N** efeitos sonoros · **Esc** pausa

## Árvores frutíferas e machado
- O **machado (6)** corta árvores: as do cenário (menos as da borda do mapa), as selvagens e as que você plantou. Rende madeira e deixa um toco (a picareta remove o toco). Árvores cortadas ficam cortadas no save.
- No **empório** você compra **mudas** de macieira, laranjeira, pessegueiro e limoeiro. Escolha a muda com **Q**, use a ferramenta **3** em terra livre (sem arar). Ela cresce em 4 dias e depois dá 2–4 frutas a cada 3 dias; colha com **E** ou com as luvas.
- Há árvores frutíferas selvagens espalhadas pela fazenda.

## Animais
- **Cachorro** (já vem com você): segue o jogador, senta quando você para, ganha carinho com **E** e todo dia cava um **tesouro** em algum lugar da fazenda (monte de terra com patinha) — cave com **E**.
- **Curral** (a leste, cercado, com portão a oeste): compre na loja **vacas** (leite diário, ordenhe com **E** quando aparecer o balão), **porcos** (acham trufas todo dia) e um **cavalo**.
- **Cavalo:** **E** perto dele para montar, **E** de novo para desmontar. Cavalgando você anda quase 2× mais rápido, mas só interage (loja, caixa, poço), sem usar ferramentas.
- **Ordenhar:** chegue perto da vaca com o balão de balde e use as **Luvas (4) + Espaço** (ou **E**). Uma vez por vaca por dia.
- **Colher frutas:** perto de uma árvore com o balão de fruta, use as **Luvas (4) + Espaço** (ou **E**). O alvo "gruda" no que está pronto ao lado de onde você olha.
- Leite, trufas, frutas e ovos vão para o cesto/inventário e são vendidos na caixa de vendas.

## Como jogar
Arar → plantar → regar → dormir na porta do celeiro → colher → vender na caixa → comprar mais sementes/melhorias.
Pedras e tocos saem com a picareta; mato com o forcado; ovos das galinhas valem dinheiro.
Dias de chuva regam tudo sozinhos. O progresso é salvo automaticamente (localStorage).

## Arquivos
- `assets/fazendeiro/` – sprites do Elias (recortados de `docs/imagem_fazendeiro.jpeg`)
- `assets/fazendeira/` – sprites da Karen (recortados de `docs/imagem_fazendeira.jpeg`, inclui os chapéus)
- `assets/tile_*.png` – tiles de terreno compartilhados pelos dois personagens
- `assets/animais/` – cachorro, vaca, cavalo e porco (8 vistas cada), `props/` (37 acessórios) e `tiles/` (15), recortados de `docs/animais.jpeg`
- `animais.js` – curral, comportamento dos animais e montaria
- `art.js` – arte procedural complementar (plantações, celeiro, árvores, galinhas...)
- `game.js` – lógica, renderização, UI e áudio (WebAudio)

## Música e animações
Música de fundo gerada em tempo real (WebAudio): tema alegre de dia, caixinha de música com grilos à noite e tema calmo com som de chuva nos dias chuvosos.
Animações: sombras de nuvens, vento nas árvores/mato, borboletas, pássaros, folhas, vagalumes, respingos de chuva, brotar das plantas, galinhas que fogem, tremor ao quebrar pedra, entre outras.
