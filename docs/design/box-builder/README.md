# Handoff: Box Builder (Casa Car Club)

## Overview

Feature que permite ao assinante Premium montar graficamente a caixa mensal do
clube. O plano dá um **budget mensal em R$**; o membro escolhe itens de um
catálogo curado até esse teto. Passar do teto gera **excedente** cobrado à
parte. Seções de **Parceiros** oferecem módulos adicionais, sempre cobrados fora
do budget. Existe uma **data de corte (cutoff)** por ciclo; depois dela a caixa
trava.

Escopo do handoff: **mobile (Expo React Native) em alta fidelidade** + **admin
(Next.js) em baixa fidelidade**.

Fonte da verdade das regras de negócio:
`docs/superpowers/specs/2026-08-09-box-builder-design.md` no repositório
`ccc-app`. Nada neste pacote cria regra nova. Divergências e ambiguidades estão
listadas na seção "Questões pro time" do documento de handoff (item 9).

## About the Design Files

Os arquivos `.dc.html` deste pacote são **referências de design feitas em HTML**
— protótipos que mostram aparência e comportamento pretendidos, **não código de
produção para copiar**. A tarefa é **recriar essas telas no ambiente existente
do `ccc-app`**: React Native (Expo) para o mobile, usando `apps/mobile/src/theme`
e `@ccc/design`; Next.js para o admin. Não porte HTML/CSS diretamente.

Para abrir: os `.dc.html` abrem direto no navegador (precisam de `support.js`,
`image-slot.js` e `doc-page.js`, todos incluídos, no mesmo diretório).

## Fidelity

- **Mobile — alta fidelidade.** Cores, tipografia, espaçamento e estados finais.
  Recriar fielmente usando os tokens do app.
- **Admin — baixa fidelidade.** Wireframes de estrutura e densidade de dados.
  Aplicar o design system existente do admin; não reproduzir os cinzas dos
  wireframes.

Todo o texto de UI é **PT-BR** e deve ser usado literalmente (a microcopy está
consolidada na seção 4 do documento de handoff). Moeda sempre `R$ 1.234,56`.

## Screens / Views

Quinze telas mobile no arquivo `Box Builder — Telas (Handoff).dc.html`,
numeradas 01–15, mais quatro wireframes de admin (A–D). Todas em canvas de
390×844.

### 01 · Caixa do mês (status `open`)

Entrada da feature. Objetivo: situação do ciclo em uma olhada.

Layout, de cima para baixo, padding lateral 20px, gap 20px:

1. Header: label `CAIXA DO MÊS` (10px/600, letter-spacing .28em, `#C9A227`) +
   título do ciclo em Cormorant Garamond 34px; ícone `history` à direita.
2. **CutoffBanner**: fundo `#14110a`, borda `rgba(212,175,55,.28)`, raio 12,
   padding 12/14. Ícone `schedule` dourado + "Fecha em **6d 04h 12m**" + data
   à direita em texto muted.
3. **BudgetMeter (full)**: card `#0F0E0B`, borda `rgba(212,175,55,.14)`, raio
   16, padding 20. Valor usado em Cormorant 38px + "de R$ 450,00" muted. Barra
   de 8px, raio 4, trilho `rgba(242,232,216,.1)`: segmento dourado
   (`linear-gradient(90deg,#C9A227,#E8CE86)`) proporcional ao budget e segmento
   verde `#22C55E` para o excedente. Abaixo: "Incluso no plano R$ 450,00" e
   "+R$ 70,00 excedente" em verde 600.
4. **Resumo**: linhas de 14px — Itens do catálogo (n), Incluído no plano,
   Excedente, Parceiros (n) — divisória hairline, depois "A pagar" com valor em
   Cormorant 26px dourado.
5. Duas imagens 74px de altura, raio 12.
6. Rodapé: CTA primário 52px, raio 12, `#D4AF37`, texto `#0A0A0A` 16px/600
   "Editar minha caixa"; abaixo, link "Pular esse mês" 13px muted centralizado.

Outros estados desta tela: 08 (awaiting_payment), 09 (ready), 10 (pós-cutoff),
skipped, 13 (loading), 15 (erro/offline).

### 02 · Builder — catálogo (dentro do budget)

Header sticky (borda inferior hairline): voltar + "Montar a caixa" + countdown
compacto dourado à direita. Abaixo, **BudgetMeter (compact)**: linha
"R$ 340,00 de R$ 450,00" / "restam R$ 110,00" (12px muted) e barra de 6px.
Depois, chips de categoria: altura ~32px, raio 999px, ativo = fundo `#D4AF37`
com texto `#0A0A0A`; inativo = borda `rgba(212,175,55,.28)`.

Grid de 2 colunas, gap 12. **CatalogItemCard**: `#0F0E0B`, raio 14, foto 104px,
título 13px/500, preço 14px dourado. Estados:

- fora da caixa: borda `rgba(212,175,55,.14)`, botão "Adicionar" 32px com borda
  dourada e ícone `add`;
- na caixa: borda `rgba(212,175,55,.28)` e **QuantityStepper** (fundo `#14110a`,
  borda dourada, `remove` / valor 14px/600 / `add`);
- esgotado: opacidade .5, overlay `rgba(10,10,10,.6)` com "ESGOTADO" 11px/600
  letter-spacing .16em, botão desabilitado "Sem estoque".

**SummaryFooter** sticky: fundo `#0F0E0B`, borda superior
`rgba(212,175,55,.28)`, padding 14/20/24. Quando charge = 0 colapsa para uma
linha ("3 itens · dentro do budget" / "Sem cobrança extra" em verde) + CTA
"Revisar e confirmar".

### 03 · Builder — em excedente

Mesma tela com a mudança de estado. Barra ganha o segundo segmento verde e o
rótulo "+R$ 70,00 extra". Banner informativo `rgba(34,197,94,.08)` com borda
`rgba(34,197,94,.3)`: "Você passou do budget. O excedente de R$ 70,00 é cobrado
à parte antes do fechamento." Card em excedente ganha borda verde
`rgba(34,197,94,.4)` e selo "EXTRA" (`#22C55E`, texto preto, 10px/600, raio 4)
no canto superior esquerdo da foto. O rodapé expande para quatro linhas
(Incluído no plano / Excedente / Parceiros / A pagar).

**Verde nunca é erro aqui** — é "valor que será cobrado". Não usar vermelho.

### 04 · Seções de Parceiros

Banner fixo no topo do conteúdo: "Módulos de parceiro são **sempre cobrados à
parte**, fora do budget do plano." Um bloco por parceiro: logo 44×44 (raio 10),
nome 15px/600, descrição 12px muted. **PartnerModuleCard**: raio 14, foto 82px,
nome 14px/500, descrição 12px muted, preço 15px dourado à direita. Estado
selecionado = faixa `rgba(34,197,94,.12)` com borda verde e texto
"Na caixa · cobrado à parte" com ícone `check`; não selecionado = "Adicionar à
caixa" com borda dourada.

Parceiro **não** move a barra de budget.

### 05 · Revisão + endereço

Seções: `ITENS DO PLANO`, `PARCEIROS · COBRADO À PARTE`, `ENTREGA`, totais.
Linhas de item: thumb 48px raio 8, nome 14px, "2 × R$ 120,00" 12px muted,
subtotal à direita. **AddressCard**: `#0F0E0B`, borda `rgba(212,175,55,.28)`,
raio 12, ícone `home`, destinatário em 600 e endereço em 13px/1.55 (reusa
`ShippingAddress`: destinatário, rua/número, bairro, cidade/UF, CEP). Link
"Trocar" à direita do label.

Totais: Itens / Incluído no plano / Excedente / Parceiros / Frete (ver questão
Q1 do documento). Rodapé: "A pagar" em Cormorant 26px + CTA. Se
`chargeCents == 0`, o bloco "A pagar" some e o CTA vira "Confirmar caixa".
Sempre com o aviso "Confirmar trava a caixa. Não dá pra editar depois."

### 06 · Pagamento dos extras

Só quando `chargeCents > 0`. Valor centralizado em Cormorant 52px dourado com
a decomposição "Excedente R$ 70,00 · Parceiros R$ 180,00" abaixo. Duas opções
em cards de 16px de padding com radio de 20px: Pix (`qr_code_2`) e Cartão
(`credit_card`, padrão Stripe do app). Aviso de prazo com ícone `schedule`.
CTA "Gerar Pix".

### 07 · Pix — aguardando confirmação

Pílula de status `rgba(212,175,55,.12)` com "Aguardando pagamento · expira em
29:41". QR 220×220 sobre `#F2E8D8`, raio 16. Linha copia-e-cola truncada com
ação "Copiar". Valor em Cormorant 38px. CTAs: "Já paguei, verificar"
(secundário) e "Cancelar cobrança" (texto).

Estados irmãos a implementar: **pago** (selo verde, scale-in, navega para 09),
**falhou** (retry), **expirado** (gerar novo Pix).

### 08 · `awaiting_payment` — travada

BoxStatusBanner dourado com ícone `lock`: "Aguardando pagamento" + prazo.
Seleção listada em read-only (opacidade .72, sem steppers). Card "A pagar".
CTA "Retomar pagamento" + nota "Sem pagamento até o corte, enviamos só os itens
do budget."

### 09 · `ready` → fulfillment

Banner verde `check_circle` "Caixa confirmada". **FulfillmentTimeline** vertical:
pontos de 12px, conectores de 2px; concluído = `#22C55E`, pendente = borda
`rgba(242,232,216,.25)`. Marcos: Preparando / Enviado (com rastreio, ver Q6) /
Entregue. Grade de 3 miniaturas do conteúdo. CTA secundário "Acompanhar entrega".

### 10 · Pós-cutoff — corte budget-only

Banner `lock_clock`: "Caixa fechada em 22 de agosto" + "Os extras não foram
pagos a tempo, então enviamos só o que cabe no budget. Nada foi cobrado."
Duas listas: `ENVIADO · R$ 440,00` e `REMOVIDO NO FECHAMENTO` (opacidade .45,
títulos riscados, motivo por item: "Parceiro não pago" / "Excedente não pago").
Ordem do corte conforme R2b: parceiros primeiro, depois catálogo em LIFO.

### 11 · Pular o mês

Bottom sheet sobre a home escurecida (`rgba(8,8,10,.6)`): fundo `#0F0E0B`, raio
superior 24, alça de 40×4. Título Cormorant 26px "Pular a caixa de agosto?",
corpo 14px/1.6, e dois botões: "Pular esse mês" (secundário) e "Continuar
montando" (primário). Depois de pular, a home mostra "Você pulou agosto" com
opção de voltar enquanto houver tempo (ver Q8).

### 12 · Histórico de caixas

Lista de cards 14px de raio: thumb 52px, ciclo em 15px/600, subtítulo com status
e totais. O ciclo corrente ganha borda `rgba(212,175,55,.28)` e subtítulo
dourado; os demais, borda `.14` e subtítulo muted. Chevron à direita.

### 13 · Loading

Skeleton com blocos `rgba(242,232,216,.05)` nos formatos reais da tela. Shimmer
sutil (opacidade .05 → .09, 1,4s). Nunca spinner de tela cheia.

### 14 · Vazios

Três vazios distintos, todos em caixa tracejada `rgba(212,175,55,.28)` raio 16,
ícone 32px `#C9A227`, título 15px/600 e corpo 13px muted: catálogo em curadoria,
nenhum parceiro no ciclo, sem endereço de entrega (este com CTA primário
"Adicionar endereço"). Sem endereço, o CTA de confirmar fica desabilitado com o
motivo visível.

### 15 · Erro de rede e offline

Banner de topo `rgba(212,175,55,.12)` com `cloud_off`: "Você está offline.
Alterações não são salvas." Erro de carga no corpo com ícone `wifi_off`, título,
explicação e botão "Tentar de novo". Erro de escrita como toast persistente no
rodapé.

### Admin (baixa fidelidade)

- **A · Catálogo do box** — tabela com drag handle, foto, título/slug,
  categoria, preço, estoque por ciclo, ordem, ativo, editar. Filtros e "+ Novo
  item". Arquivar não remove o item de seleções já feitas (R11).
- **B · Parceiros e módulos** — CRUD de `Partner` com lista aninhada de
  `PartnerModule`.
- **C · Budget por tier + BoxSettings** — campo de budget por plano
  (`PremiumPlan.monthlyBoxBudgetCents`), toggle box on/off, cutoff em dias antes
  da renovação, textos do header.
- **D · Caixas do ciclo** — contadores por status, tabela de caixas (membro,
  status, a pagar, fulfillment, refund) e **picking list agregada** vinda de
  `MonthlyBoxItem` + `MonthlyBoxPartnerItem`, não de `OrderItem` (R12).

## Interactions & Behavior

- Barra de budget anima largura em 240ms ease-out a cada mudança de quantidade;
  a transição para excedente cresce o segmento verde a partir da direita.
- Adicionar item: card faz scale 1 → 1,03 → 1 em 160ms; valor do rodapé em
  cross-fade. Haptic `selection`.
- Primeira entrada em excedente na sessão: haptic `warning` + banner desliza de
  cima em 200ms. Só uma vez por sessão.
- Rodapé de resumo sticky, com sombra que aparece só quando há conteúdo rolado
  por baixo.
- Countdown atualiza a cada minuto; nas últimas 24h mostra minutos e muda para o
  tom urgent.
- Pix pago: selo verde com scale-in de 220ms + haptic `success`, depois navega
  para a caixa confirmada.
- Telas travadas não animam nada — read-only não deve parecer interativo.
- `prefers-reduced-motion`: sem scale nos cards; barra muda sem transição.
- Navegação: Caixa do mês → Builder → Parceiros → Revisão → Pagamento → Caixa
  confirmada. Voltar do builder salva a seleção.
- Edição concorrente: last-write-wins, o PUT substitui a seleção inteira (R14).

## State Management

Por ciclo, uma `MonthlyBox` com `status ∈ {open, awaiting_payment, ready,
skipped, cancelled}`.

Transições (do spec):

- `open` + confirm com `chargeCents == 0` → `ready` (reserva estoque).
- `open` + confirm com `chargeCents > 0` → `awaiting_payment` (reserva estoque,
  cria `Order` kind `box`).
- `awaiting_payment` + webhook de Order pago → `ready`.
- Worker no cutoff: `open` vazio → `skipped`; `open` com itens → auto-confirma
  budget-only → `ready`; `awaiting_payment` → corte budget-only, cancela o Order
  pendente → `ready`.
- `ready` → packed / shipped / delivered via `Order.fulfillmentStatus`.

Estado local da tela: seleção corrente (itens + módulos), quantidade por item,
categoria ativa do filtro, método de pagamento escolhido, estado do Pix
(aguardando / pago / falhou / expirado), estado de rede (online/offline, erro de
escrita pendente).

Cálculo é **server-side** e refeito a cada edição: `itemsTotalCents`,
`overflowCents = max(0, itemsTotal - budgetSnapshot)`, `partnersTotalCents`,
`chargeCents = overflow + parceiros`. O cliente exibe, não recalcula como fonte
de verdade.

Campos lidos/escritos por tela: ver a seção 8 do documento de handoff. Nenhum
campo novo é proposto.

## Design Tokens

Vindos de `@ccc/design` e `apps/mobile/src/theme`:

| Token                        | Valor                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Fundo                        | `#0B0B0F`                                                                                    |
| Superfície de card           | `#0F0E0B`                                                                                    |
| Superfície com tinta dourada | `#14110a`                                                                                    |
| Borda                        | `#1F1F24` · hairline dourado `rgba(212,175,55,.14)` → `.28` em ênfase                        |
| Marca / dourado              | `#D4AF37` · deep `#B8912A` (label `#C9A227`) · soft `#E8C874` · tint `rgba(212,175,55,0.12)` |
| Sucesso / cobrado à parte    | `#22C55E`                                                                                    |
| Texto primário               | `#F2E8D8`                                                                                    |
| Texto muted                  | `rgba(242,232,216,.5)`                                                                       |
| Raios                        | sm 4 · md 8 · lg 12 (cards maiores 14–16)                                                    |
| Espaçamento                  | 4 / 8 / 12 / 16 / 24                                                                         |
| Tipografia                   | System (Jost como referência visual no protótipo); tamanhos 12 / 14 / 16 / 20 / 28           |
| Numerais display             | Cormorant Garamond (valores em R$, títulos de ciclo)                                         |

Usar o dourado com parcimônia: marca, CTA principal e estado de budget.

## Assets

- **Ícones** (set atual do app / Material Symbols Outlined): `schedule`, `lock`,
  `lock_clock`, `check_circle`, `add`, `remove`, `qr_code_2`, `credit_card`,
  `content_copy`, `home`, `location_off`, `inventory_2`, `handshake`,
  `cloud_off`, `wifi_off`, `history`, `chevron_right`, `hourglass_top`, `error`,
  `info`, `payments`, `arrow_back`, `close`.
- **Fotos de item** — `BoxCatalogItem.imageObjectKey`, 1:1, mínimo 600×600,
  fundo escuro.
- **Módulo de parceiro** — 16:9, 1200×675.
- **Logo de parceiro** — PNG transparente quadrado 240×240, versão clara.
- **Placeholder** — bloco `#14110a` com ícone `inventory_2`.
- Nas telas, as fotos são placeholders (`<image-slot>`); nenhuma imagem real
  está no pacote.
- Marca: nenhum selo ou lockup dentro do builder. A identidade CASA aparece só
  no e-mail e no encarte impresso da caixa, fora deste escopo — usar o kit de
  marca existente no projeto.

## Files

- `Box Builder — Telas (Handoff).dc.html` — canvas com as 15 telas mobile em
  alta fidelidade e os 4 wireframes de admin.
- `Box Builder — Handoff (Documento).dc.html` — documento de handoff com fluxo,
  componentes e props, microcopy PT-BR completa, animações, acessibilidade,
  assets, mapa de dados por tela e as 9 questões em aberto.
- `support.js`, `image-slot.js`, `doc-page.js` — runtime necessário para abrir
  os dois arquivos no navegador.
- `screenshots/telas-completo.png` — captura do canvas inteiro de telas.
- `screenshots/documento.png` — captura do documento de handoff.

## Antes de implementar

Nove pontos precisam de decisão de produto/eng antes ou durante a
implementação — estão detalhados na seção 9 do documento. Os mais travantes:
frete (recomendado incluso em R6, mas não confirmado no topo do spec), o que
acontece ao cancelar um Pix pendente, e qual campo o mobile lê para exibir
fulfillment quando o box é budget-only e não tem `Order`.
