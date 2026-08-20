# Handoff: aba "Início" (Home) — App Casa Car Club

## Overview

Tela inicial do app do Casa Car Club, clube de carros de Curitiba. É a primeira
aba da tab bar e o ponto de partida de toda a navegação: identifica o membro,
mostra o próximo evento, o pulso do clube em números e atalhos para as áreas
principais.

Escopo deste handoff: **somente a aba Início** e o chrome que a envolve (status
bar, tab bar). As outras telas do protótipo (Evento, Associação, Carteirinha,
Comunidade, Garagem, Planos) estão fora de escopo — os destinos dos atalhos e das
abas ficam como rotas a serem ligadas.

A identidade é **dark, editorial, dourado sobre preto**. Todo o texto de UI é em
**PT-BR** e deve ser usado literalmente.

## About the Design File

`App Casa Car Club (Prototipo).dc.html` é uma **referência de design feita em
HTML** — um protótipo que mostra aparência e comportamento pretendidos, **não
código de produção para copiar**. A tarefa é **recriar a tela no ambiente
existente** (React Native / Expo no caso do app do clube). Não porte HTML/CSS
diretamente.

Para abrir: o arquivo abre direto no navegador; precisa de `support.js`,
`image-slot.js` e da pasta `assets/` no mesmo diretório (todos incluídos). A aba
Início é o estado inicial — nada a clicar para chegar nela.

A moldura de iPhone ao redor é só apresentação do protótipo. O que importa é o
conteúdo dentro do canvas de **390×844**.

## Fidelity

**Alta fidelidade.** Cores, tipografia, espaçamento, raios e hierarquia são
finais e devem ser reproduzidos. As fotos são placeholders
(`<image-slot>`) — nenhuma imagem real de conteúdo está no pacote.

## Layout da tela

Canvas 390×844, fundo `#0A0A0A`. Três camadas fixas: status bar (54px, topo),
corpo rolável, tab bar (rodapé). O corpo rola com scrollbar oculta; padding
`6px 20px 120px` (o padding inferior de 120px libera a tab bar). A tela entra
com fade + translateY de 10px em 320ms ease.

Ordem vertical do conteúdo:

### 1. Header do app

Linha entre marca e notificações, padding `6px 0 18px`.

- **Esquerda**: `monogram-ccc-circle-gold.png` em 40×40 (`object-fit: contain`) +
  bloco de texto com gap de 12px:
  - `CASA CAR CLUB` — 12px, weight 600, letter-spacing `.24em`, `#F2E8D8`
  - `CURITIBA` — 9px, weight 500, letter-spacing `.34em`, `#C9A227`, margin-top 3px
- **Direita**: botão de ícone `notifications` 24px em `#D4AF37`, com badge de
  7×7px `#E8CE86` e borda de 1.5px `#0A0A0A` no canto superior direito (indica
  não lidas). Alvo de toque mínimo de 44×44.

### 2. Hero do clube

Bloco de 210px de altura, raio 20, borda `1px solid rgba(212,175,55,.16)`,
`overflow: hidden`.

- Foto de fundo full-bleed (placeholder `hero-house.png` — foto da sede).
- Sobreposição de gradiente vertical, sem captura de toque:
  `linear-gradient(180deg, rgba(10,10,10,.15) 0%, rgba(10,10,10,.35) 45%, rgba(10,10,10,.86) 100%)`.
- Mote alinhado embaixo à esquerda (22px de cada lado): `DIRIGIR.` / `CONECTAR.`
  / `PERTENCER.` em três linhas, 29px, weight 700, line-height 1.04,
  letter-spacing `-.01em`, `#F2E8D8`.
- Abaixo do mote, régua de 44×3px com raio 2 e
  `linear-gradient(90deg,#E8CE86,#C9A227)`, margin-top 14px.

### 3. Saudação do membro

margin-top 22px.

- `BEM-VINDO DE VOLTA, PEDRO` — 19px, weight 700, `#F2E8D8`, letter-spacing
  `.01em`. Nome do membro em maiúsculas, vindo do perfil.
- `MEMBRO #0001` — 11px, weight 600, letter-spacing `.26em`,
  `rgba(242,232,216,.45)`, margin-top 6px.

### 4. Card do próximo evento

Card clicável inteiro (navega para o detalhe do evento), margin-top 20px, raio
18, padding 16, borda `1px solid rgba(212,175,55,.28)`, fundo
`radial-gradient(130% 120% at 85% 0%, #1c1810 0%, #100e09 60%)`. Column com gap
14px.

Linha superior, dois blocos com gap 14px:
- **Texto (flex 1)**: label `PRÓXIMO EVENTO` (10px/600, letter-spacing `.28em`,
  `#C9A227`); título `Sunset Meet & Drive` (17px/600, `#F2E8D8`, margin-top 9px);
  duas metalinhas de 13px `rgba(242,232,216,.6)` com ícone de 16px `#C9A227` —
  `calendar_today` + data, `schedule` + hora.
- **Thumb (96px de largura)**: foto do evento, raio 12.

Rodapé do card, alinhado à direita: pílula `VER EVENTO` — 11px, weight 600,
letter-spacing `.18em`, texto `#0A0A0A`, fundo
`linear-gradient(135deg,#E8CE86,#C9A227)`, padding `11px 20px`, raio 9.

### 5. Status do clube

margin-top 26px. Label de seção `STATUS DO CLUBE`. Grid de 3 colunas, gap 12,
margin-top 14px.

Cada card: fundo `#0F0E0B`, borda `1px solid rgba(212,175,55,.14)`, raio 14,
padding `15px 10px`, centralizado. De cima para baixo: ícone 20px `#C9A227`,
label de 9px/600 letter-spacing `.22em` em `rgba(242,232,216,.5)` (margin-top 8),
número em **Cormorant Garamond** 26px/600 `#F2E8D8` (margin-top 4).

| Ícone | Label | Valor |
| --- | --- | --- |
| `group` | MEMBROS | 128 |
| `calendar_today` | EVENTOS | 6 |
| `directions_car` | GARAGEM | 18 |

Os três números vêm do backend; são contagens do clube, não do membro.

### 6. Acesso rápido

margin-top 26px. Label de seção `ACESSO RÁPIDO`. Grid 2×2, gap 12, margin-top 14.

Cada atalho é um botão: fundo `#0F0E0B`, borda `1px solid rgba(212,175,55,.14)`,
raio 14, padding 16, column com gap 20px, alinhado à esquerda. Ícone de 24px em
`#D4AF37` acima do rótulo de 13px/500 `#F2E8D8`.

| Ícone | Rótulo | Destino |
| --- | --- | --- |
| `event` | Eventos | lista/detalhe de eventos |
| `event_available` | Reservas | reservas (rota ainda não definida) |
| `directions_car` | Garagem | aba Garagem |
| `sell` | Planos | tela de planos/assinatura |

## Chrome ao redor

### Status bar (54px)

Só apresentação no protótipo — no app real usar a status bar nativa em estilo
claro (conteúdo claro sobre fundo escuro). No protótipo: hora 16px/600
`#F2E8D8` à esquerda, notch de 118×33px centralizado, e à direita
`signal_cellular_alt` / `wifi` / `battery_full`.

### Tab bar

Fixa no rodapé: fundo `rgba(10,10,10,.92)` com `backdrop-filter: blur(12px)`,
borda superior `1px solid rgba(212,175,55,.14)`, padding `12px 12px 26px`, itens
distribuídos com `space-around`. Cada item é ícone de 24px + rótulo de 10px/500,
gap 5px.

| Ícone | Rótulo | Aba |
| --- | --- | --- |
| `home` | Início | esta tela |
| `groups` | Comunidade | — |
| `directions_car` | Garagem | — |
| `person` | Perfil | — |

Aba ativa em `#D4AF37`, inativas em `rgba(242,232,216,.42)`. A aba Início
permanece ativa também quando o usuário está no detalhe do evento (é filha da
Início na pilha de navegação). Home indicator de 134×5px em
`rgba(242,232,216,.5)`, 9px do fundo.

## Interactions & Behavior

- Todo o card do próximo evento é uma única área de toque; a pílula
  `VER EVENTO` é affordance visual, não um segundo alvo.
- Atalhos de acesso rápido e itens da tab bar navegam por push/troca de aba.
  "Reservas" e o botão de notificações ainda não têm destino definido no
  protótipo.
- Entrada da tela: fade + translateY 10px → 0 em 320ms ease. Recomendado
  respeitar `prefers-reduced-motion` / "reduzir movimento" desligando o
  translate.
- Scroll vertical simples, sem pull-to-refresh no protótipo (vale considerar,
  já que os números do clube e o próximo evento são dados vivos).
- Estados de feedback ao toque (press/highlight) não estão desenhados: usar o
  padrão do app — sugestão de escurecer o fundo do card em ~6% no press.

## State Management

A tela é de leitura. O protótipo mantém apenas `screen` (aba/rota corrente) no
estado; a Início não guarda estado próprio.

Dados que a tela consome:
- **Membro**: primeiro nome (saudação) e número de membro.
- **Próximo evento**: título, data, hora, imagem de capa, id para navegação.
- **Contadores do clube**: membros, eventos no período, veículos na garagem.
- **Notificações**: flag de não lidas (só o badge; nenhuma contagem é exibida).

Estados que **faltam desenhar** e precisam de decisão antes da implementação
(ver "Antes de implementar"): loading, sem próximo evento, e falha de rede.

## Design Tokens

| Token | Valor |
| --- | --- |
| Fundo da tela | `#0A0A0A` |
| Superfície de card | `#0F0E0B` |
| Superfície com tinta dourada | `#14110a` |
| Card de destaque (evento) | `radial-gradient(130% 120% at 85% 0%, #1c1810 0%, #100e09 60%)` |
| Hairline padrão | `rgba(212,175,55,.14)` |
| Hairline em ênfase | `rgba(212,175,55,.28)` · hero `rgba(212,175,55,.16)` |
| Dourado primário | `#D4AF37` |
| Dourado claro | `#E8CE86` |
| Dourado profundo (labels) | `#C9A227` |
| Gradiente dourado (CTA) | `linear-gradient(135deg,#E8CE86,#C9A227)` · régua `linear-gradient(90deg,#E8CE86,#C9A227)` |
| Texto primário (creme) | `#F2E8D8` |
| Texto secundário | `rgba(242,232,216,.6)` |
| Texto muted | `rgba(242,232,216,.5)` · `.45` · `.42` |
| Raios | 9 (pílula) · 12 (thumb) · 14 (card pequeno) · 18 (card grande) · 20 (hero) |
| Padding lateral da tela | 20px |
| Gap entre seções | 22–26px |
| Gap dentro de grid | 12px |

### Tipografia

- **Jost** (300–700) — toda a UI, rótulos e corpo.
- **Cormorant Garamond** (400–700) — só numerais display e acentos serifados
  (os três contadores do clube).
- **Material Symbols Outlined** — ícones.

Escala usada nesta tela: 9 / 10 / 11 / 12 / 13 / 17 / 19 / 26 (Cormorant) /
29px.

Padrão de **label de seção**, usado em Status do clube e Acesso rápido: 10px,
weight 600, letter-spacing `.28em`, `#C9A227`, UPPERCASE. É a peça que dá ritmo
à tela — repetir sem variação.

Uso do dourado com parcimônia: marca, labels de seção, ícones, CTA e estado
ativo. Superfícies permanecem quase pretas.

## Patterns

Padrões que se repetem e valem virar componentes:

- **SectionLabel** — o label dourado de 10px descrito acima.
- **StatCard** — ícone + label + numeral em Cormorant. Props: ícone, label,
  valor.
- **QuickActionTile** — ícone + rótulo, botão de grid. Props: ícone, rótulo,
  destino.
- **FeatureCard** — card de destaque com fundo radial e borda dourada `.28`
  (usado pelo próximo evento; o mesmo tratamento aparece no card de membro em
  outras telas).
- **GoldPill** — CTA pequeno com gradiente dourado e texto preto.
- **AppHeader** — monograma + wordmark + ação à direita.

## Assets

Inclusos em `assets/brand/` (PNGs transparentes, marcas douradas sobre fundo
escuro):
- `monogram-ccc-circle-gold.png` — usado no header em 40×40.
- `badge-gold.png` — selo circular; não usado nesta tela, incluso como
  referência de marca (usar em ≥92px para o texto do selo continuar legível).
- `lockup-horizontal-gold.png` — lockup primário, para splash/onboarding.

Ícones (Material Symbols Outlined): `notifications`, `calendar_today`,
`schedule`, `group`, `directions_car`, `event`, `event_available`, `sell`,
`home`, `groups`, `person`.

Fotos necessárias (placeholders no protótipo):
- **Hero da sede** — 350×210 mínimo em 2x, orientação paisagem, ambiente noturno
  para o gradiente funcionar.
- **Thumb do evento** — proporção retrato ~96×110, 2x.

## Files

- `App Casa Car Club (Prototipo).dc.html` — protótipo; a aba Início é o estado
  inicial.
- `support.js`, `image-slot.js` — runtime necessário para abrir no navegador.
- `assets/brand/` — marcas usadas e referência.
- `screenshots/inicio.png` — captura da tela.

## Antes de implementar

Três estados não estão desenhados e precisam de decisão de produto/design:

1. **Sem próximo evento** — o card de destaque é o eixo visual da tela. Vale um
   vazio ("Nenhum evento agendado") ou o card deve dar lugar a outro conteúdo?
2. **Loading** — sugestão de skeleton nos formatos reais (hero, card de evento,
   três stat cards), no padrão do resto do app; nunca spinner de tela cheia.
3. **Erro de rede** — a tela mistura dados de fontes diferentes (membro, evento,
   contadores). Definir se falha parcial degrada por bloco ou se a tela inteira
   vira estado de erro.

Também em aberto: destino de "Reservas" e do botão de notificações (sem rota no
protótipo), e se a tela deve ter pull-to-refresh.
