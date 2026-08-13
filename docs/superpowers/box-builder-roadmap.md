# Box Builder — roadmap e handoff

Documento vivo para qualquer agente continuar o Box Builder. Curto e direto.

## O que e o Box Builder

Membros Premium ganham um budget mensal em R$ por plano. O organizador
monta um catalogo curado, modulos de parceiros e as regras da caixa. O
assinante escolhe itens dentro do budget a cada ciclo. Modulos de parceiros
sao cobrados a parte.

Docs de origem:

- Spec: `docs/superpowers/specs/2026-08-09-box-builder-design.md`
- Plano Fase 1: `docs/superpowers/plans/2026-08-09-box-builder-fase-1.md`
- Design: `docs/design/box-builder/`

## Estado por fase

### Fase 1 — Config (CONCLUIDA)

Config-only. Sem runtime de ciclo. Entregue em `feat/box-builder-design` (PR #9).

Escopo entregue:

- Schema Prisma: `BoxCatalogItem`, `Partner`, `PartnerModule`, `BoxSettings`.
- `PremiumPlan.monthlyBoxBudgetCents` (budget mensal por plano).
- Migration aditiva (nao destrutiva).
- Schemas Zod em `packages/shared/src/admin-box.ts`.
- API admin CRUD: catalogo, parceiros/modulos, settings (scope organizer/admin).
- Upload de imagens R2: kinds `box_item`, `partner_logo`, `partner_module`.
- Admin web: paginas `/box/catalogo`, `/box/parceiros`, `/box/config` + subnav.
- Seed idempotente de `BoxSettings`.

Correcoes pos-review (mesmo PR):

- CRC32 no presign resolvido via merge do `main` (PR #8).
- `BoxSettings` agora e singleton por id fixo (`box_default`) com upsert.
- Admin mostra imagem atual (`imageUrl`/`logoUrl` vindos da API).
- Validacao de chave por prefixo de kind (`isKindKey`) nas rotas de box.
- Nav expoe Catalogo, Parceiros e Configuracao.

### Fase 2 — Runtime de ciclo (CONCLUIDA)

API do atendente + logica de ciclo/cutoff/worker. Entregue em
`feat/box-builder-fase-2` (PR #11, mergeado em `main`).

Escopo entregue:

- Schema Prisma de runtime: `MonthlyBox`, `MonthlyBoxItem`,
  `MonthlyBoxPartnerItem`, `BoxCatalogItemCycleStock`. `OrderKind.box` adicionado.
- Hook de abertura: `MonthlyBox` aberto automaticamente no forward-advance da
  assinatura Premium (swallows P2002; um box por ciclo por assinatura). Roda
  pos-commit nos tres caminhos: webhook Stripe, webhook RevenueCat, worker de
  reconciliacao.
- API do atendente: `GET /me/box`, `PUT /me/box/selection`, `POST /me/box/confirm`.
- Ledger de estoque por ciclo: reserva atomica em `BoxCatalogItemCycleStock`
  com decremento transacional.
- Worker de cutoff (`runBoxCutoffTick`): skip/ready, trim LIFO de excesso,
  cancela Order pendente sem sobrepor pagamento liquidado.

Serializacao das tres rotas que mutam a caixa (confirm, PUT selection, worker)
via lock `FOR UPDATE` na linha da `Garage` (mesmo recurso nas tres). Confirm e
PUT relockam e re-checam `status` + `cutoffAt` dentro da transacao.

Correcoes pos-review (PR #11):

- `box` adicionado ao `orderKindSchema` do shared e ao label mobile
  (`GET /me/orders` deixaria de 500 num Order de box).
- Cutoff nao envia caixa com frete nao pago: `shippingCents > 0` vira `skipped`,
  nunca `ready`.
- Cutoff distingue `paid` de outros estados nao-pendentes do Order (cancelado
  por outra via libera estoque e resolve, em vez de travar).
- `maxPerCycle` aplicado no PUT (422).

Nota: Fase 4 ainda e dona de: checkout do provider + flip do webhook para pago

- fulfillment e refund no admin. `settlePaidOrder` hoje lanca de proposito para
  `kind === 'box'`, como guarda ate a Fase 4 implementar a liquidacao.

### Fase 3 — UI mobile (DESIGN CONCLUIDO)

Dividida em duas entregas: 3a (API do atendente) e 3b (UI mobile).

Design: `docs/superpowers/specs/2026-08-11-box-builder-fase-3-design.md`
(passou por review de tres agentes; resolucoes embutidas). Referencia de UI:
`docs/design/box-builder/README.md`.

#### Fase 3a — API do atendente (CONCLUIDA)

Camada de leitura/skip/historico/preferencias que as telas exigem. Entregue em
`feat/box-builder-fase-3a-api` (PR #14). Plano:
`docs/superpowers/plans/2026-08-12-box-builder-fase-3a-api.md`. Executada via
subagent-driven-development (6 tasks TDD, review por task + review de branch).

Novos endpoints do atendente: `GET /me/box/catalog`, `POST /me/box/skip` +
`/unskip`, `GET /me/boxes`, `PUT /me/box/preferences`; box view enriquecida com
`imageUrl` + linhas removidas (`included`/`dropReason`). `autoSendOptIn` agora
tem caminho de escrita unico (`PUT /me/box/preferences`; removido do confirm).

Correcoes pos-review (PR #14):

- `PUT /me/box/preferences` calcula `shippingCents` do endereco (igual confirm),
  senao o cutoff enviava caixa auto-send de regiao nao-gratis sem cobrar frete.
- `soldOut` do catalogo usa o `total` do ledger do ciclo quando existe, nao o
  `stockPerCycle` atual, pra edicao de estoque nao virar disponibilidade num
  ciclo ja aberto.
- Fix de typecheck de CI no teste do shared (acesso indexado nao-nulo).

A 3b foi fatiada em duas: 3b-1 (fundacao + telas de leitura) e 3b-2 (builder
interativo + offline).

#### Fase 3b-1 — mobile: fundacao + telas de leitura (CONCLUIDA)

Camada de dados, navegacao premium-gated e todas as telas de leitura/estado da
Caixa, atras do flag `EXPO_PUBLIC_CAIXA_ENABLED` (default OFF, merge dark).
Entregue em `feat/box-builder-fase-3b-mobile` (PR #15, mergeado em `main`). Plano:
`docs/superpowers/plans/2026-08-12-box-builder-fase-3b-1-mobile-foundation.md`.
Executada via subagent-driven-development (10 tasks TDD, review por task + review
de branch; final READY TO MERGE, zero Critical/Important).

Entregue: `src/api/box.ts` (8 rotas), copy `caixa.ts` + formatadores puros,
flag + resolver puro do slot premium, nav rework (slot premium-gated
Caixa/Assinatura, Ingressos vira item do Perfil, anti-flicker via AsyncStorage),
hooks `useBox`/`useBoxHistory`/`useBoxPreferences`, helpers de status/medidor,
Caixa home com estados de leitura (open/skipped/awaiting_payment/ready/pos-cutoff),
sheet de pular/voltar, historico, preferencias (auto-envio + endereco reusando o
fluxo existente).

Decisoes fechadas na 3b-1:

- Screen 09 (ready) decide por `status`, nao por `fulfillmentStatus` (fora do
  `BoxView`). Timeline fica na Fase 4.
- Nav: o slot antigo de Ingressos virou o slot premium; `tickets` sempre
  `href: null`, acessivel pelo Perfil. Loja ON/OFF inalterada.
- `/caixa` adicionado ao `NEXT_ALLOWED_PREFIXES` (redirect-intent) pro returnTo
  do add-address voltar pra preferencias.

Correcoes pos-review (mesma branch):

- 6 erros de tsc das primeiras tasks (metodo `PUT` ausente no `RequestOptions`
  do client; acesso indexado nao-nulo) corrigidos; tsc agora e gate obrigatorio.
- Regressao da Task 4: `ProfileMenuScreen.test.tsx` tinha mock lucide sem
  `Ticket`; corrigido.
- Listener web `tabPress` no slot premium visivel (Assinatura hoje tem rotas
  aninhadas).
- Historico usa `mes/ano` (`cycleMonthYearLabel`), nao so mes, pra nao duplicar
  rotulos entre anos.

Carry-forward pra 3b-2 (nao bloqueiam merge; feature dark):

- PONTO DE ENTRADA: `caixa/index.tsx` nao linka pra `/caixa/preferencias`.
  Adicionar icone de engrenagem/ajustes no header da home apontando pra la.
- Antes de ligar `EXPO_PUBLIC_CAIXA_ENABLED`: o builder real (`montar.tsx` hoje e
  placeholder "Em breve") precisa existir.
- ENDERECO DAS PREFERENCIAS (achados de review adiados, precisam de mudanca de
  API; a tela e inalcancavel ate a 3b-2):
  - Expor `shippingAddressId` no `BoxView` (serialize.ts + shared + teste) pra a
    tela semear o endereco realmente salvo na caixa. Sem isso, salvar so o toggle
    de auto-envio troca silenciosamente o endereco salvo pelo default da conta.
  - Bloquear salvar com auto-envio ligado sem endereco selecionado (o worker de
    cutoff pula caixa sem `shippingAddressId`, mas hoje a UI reporta sucesso).
- Limpezas menores: remover `'post_cutoff'` da union de `homeVariant`; reusar
  `budgetMeter().includedCents` no `OpenBody`; remover override no-op de
  `lineRowDropped.borderBottomColor`; teste direto de `unskipBox` no client.

Achados de review ja corrigidos nesta branch (3b-1): guarda do cache de premium
em erro transitorio + refresh no foreground (`usePremiumSlot`); SkipSheet trata
erro nao-ApiError (fim de rejeicao nao tratada); home da Caixa refaz fetch no
foco; erro de unskip agora aparece na UI.

A 3b-2 foi fatiada em duas: 3b-2a (builder do catalogo) e 3b-2b (parceiros,
revisao/endereco, offline, flip do flag).

#### Fase 3b-2a — mobile: builder do catalogo (CONCLUIDA)

Tela do assinante montar a caixa (telas 02/03) sobre a fundacao da 3b-1, atras
do flag `EXPO_PUBLIC_CAIXA_ENABLED` (default OFF, merge dark). Entregue em
`feat/box-builder-fase-3b-2a-mobile` (PR #17). Plano:
`docs/superpowers/plans/2026-08-12-box-builder-fase-3b-2a-mobile-builder.md`.
Executada via subagent-driven-development (7 tasks TDD, review por task + review
de branch no opus).

Entregue: `shippingAddressId` no `BoxView` (shared + serialize + teste
Testcontainers); limpezas da 3b-1 (union de `homeVariant`, reuso de
`includedCents`, estilo no-op, teste de `unskipBox`); `useBoxCatalog`;
`builder-selection.ts` puro (totais otimistas, indice de preco, payload,
filtro de categoria); `useBoxBuilder` (PUT debounced, reconciliacao pelo
servidor, saves serializados, flush no blur/unmount, preserva parceiros); tela
`montar.tsx` (02/03) + `CatalogItemCard` + barra de budget animada (RN
`Animated`) + placeholder `revisar.tsx`; ponto de entrada de preferencias no
header da home.

Carry-forwards da 3b-1 fechados nesta fase: ponto de entrada de preferencias;
`shippingAddressId` exposto no `BoxView` (base pros achados de endereco); as
quatro limpezas menores.

Correcoes pos-review (mesma branch/PR):

- Review de branch (opus): barra animada renderizava cheia abaixo do budget
  (faltava o segmento espaçador do modo estatico). Corrigido.
- Review de PR (tres passadas): `toSelectionUpdate` agora manda `quantity: 0`
  explicito (o PUT e diff-based; sem isso a remocao de item nao persistia);
  fixture do `boxViewSchema` no shared ganhou `shippingAddressId` (quebrava o
  vitest do shared / CI); saves serializados no `useBoxBuilder` (um PUT em voo,
  reenvio da ultima selecao) pro last-write-wins valer tambem no servidor.

#### Fase 3b-2b — mobile: parceiros, revisao, offline (CONCLUIDA)

Fecha o builder sobre a 3b-2a. Entregue em `feat/box-builder-fase-3b-2b-mobile`,
mergeada em `main` pelo PR #20.
Plano: `docs/superpowers/plans/2026-08-13-box-builder-fase-3b-2b-mobile.md`.
Executado via subagent-driven-development (7 tasks, review por task, review final).

Escopo entregue:

- Parceiros (tela 04): tela `/caixa/parceiros` com toggle de modulos sobre o
  `partners` semeado no controlador da 3b-2a. Parceiros nunca movem a barra de
  budget. Fluxo linear: Montar -> Parceiros -> Revisao (CTA do builder virou
  "Continuar").
- Revisao + endereco (tela 05): `revisar.tsx` real substitui o placeholder.
  Semeia o endereco de `BoxView.shippingAddressId`; confirm via `confirmBox`;
  sucesso cai na home read-only (`awaiting_payment`/`ready`). Frete nao e
  mostrado antes do confirm (resolucao da Q1); linha muted "Frete calculado na
  confirmacao".
- Dois achados de endereco da 3b-1 fechados na tela de Preferencias: semear do
  box (nao so do default); bloquear auto-envio sem endereco.
- Offline: persist local minimo (`builder-offline.ts`, draft AsyncStorage por
  box, reenviado no mount se ficou sujo). Sem lib de conectividade.

Fixes de review (review final opus + review do PR #20):

- Draft nao e marcado limpo se uma edicao chegou durante o PUT em voo.
- Resume no mount nao sobrescreve uma edicao feita durante o `loadDraft` async.
- `flush()` resolve true so quando a selecao esta salva; Montar/Parceiros so
  navegam pra frente com sucesso (PUT falho mantem o usuario na tela de retry).
- Revisao trata erro de carga de endereco separado de lista vazia (com retry).
- Revisao redireciona pra `/caixa` e desabilita confirmar quando o box nao esta
  `open`.

Residual conhecido: janela `open` mas pos-cutoff (antes do worker rodar) nao e
pega pelo redirect; o servidor rejeita o confirm com `box_locked` e o feedback
aparece. Consistente com Montar.

Go-live (apos QA manual do fluxo completo):

- Ligar `EXPO_PUBLIC_CAIXA_ENABLED=true` no ambiente de build do mobile
  (perfil EAS / .env). O default no codigo fica OFF; o flip e config, nao
  codigo. Testar num cliente premium real antes de promover.

### Fase 4 — Checkout dos extras (PENDENTE)

Checkout dos modulos de parceiro + webhook + fulfillment no admin. Manter a
invariante: pedido so vira `paid` por webhook verificado, nunca por chamada
do cliente. Webhooks idempotentes por event id.

### Fase 5 — Notificacoes (PENDENTE)

Expo Push nos marcos do ciclo.

## Integracao com o PR de assinaturas (PR #5)

- PR #9 (box) e PR #5 (assinaturas) sao ramos paralelos de `main`.
- Sem dependencia dura. Backbone Premium ja esta em `main`.
- Banco integra limpo: schemas auto-merge, migrations independentes.
- Conflitos mecanicos esperados no segundo a mergear:
  `admin/index.ts`, `admin-api.ts`, `authed-nav.tsx`, `middleware.ts`,
  `premium-catalog-client.tsx` (este ultimo exige cuidado: reencaixar o
  campo `monthlyBoxBudgetCents` no form final).
- Ordem sugerida: mergear #9 primeiro (limpo com `main`), depois #5 resolve
  `main` + overlap de uma vez.

## Follow-ups adiados (nao bloqueiam merge)

Fase 1:

- API mantem union `UploadKind` paralela ao `UPLOAD_KINDS` do shared. Derivar.
- `packages/shared/src/index.ts` tem `export * from './cart.js'` duplicado.
- Sem guarda de MIME no servidor no presign (R2 valida via content-type assinado).
- CEP editor e textarea (from:to por linha), nao UI de linhas.

Fase 2 (do review do PR #11):

- Persistir auto-send + endereco na caixa aberta e trabalho da Fase 3 (ver
  dependencia acima). O caminho de auto-send do worker fica inalcancavel ate la.
- Cancelar Order de box pelo endpoint generico de cancelamento nao libera o
  estoque do ciclo na hora. O cutoff resolve depois (libera + resolve), mas a
  caixa segue `awaiting_payment` ate o cutoff. Aceitavel na Fase 2.

## Onde esta o ledger de execucao

- Fase 1: `.superpowers/sdd/2026-08-09-box-builder-fase-1/progress.md`
- Fase 2: `.superpowers/sdd/2026-08-10-box-builder-fase-2/progress.md`

Ambos git-ignored (scratch). Registram cada task, reviews e decisoes.
