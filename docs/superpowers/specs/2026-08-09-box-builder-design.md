# Box Builder — design e review high level

Status: em brainstorming. Decisões travadas + questões em aberto abaixo.

## Decisões do review (confirmadas)

- R1: pagamento dos extras sempre iniciado pelo usuário (Pix/cartão) antes do cutoff. Sem débito automático.
- R2: extra não pago até o cutoff → envia só os itens dentro do budget (sem cobrança).
- R3: sobra de budget é perdida no ciclo.
- R4: sem mínimo; usuário pode pular o mês (não confirma → não envia).
- R5: estoque limitado por ciclo, reserva no pagamento/confirmação.
- R7: só `active` e `trialing` montam box. `cancel_scheduled`, `past_due`, `paused` bloqueiam.
- R8: budget snapshot no abrir; troca de tier vale no próximo ciclo.
- R9: módulo de parceiro é item físico por ciclo, cobrado a cada ciclo selecionado.
- R10: confirmar/pagar trava o box (sem edição depois).
- R11: item arquivado que já está na seleção permanece.
- R12: picking list do admin via `MonthlyBoxItem`.
- R13: refund manual pelo admin, reusa `Order`.
- R14: last-write-wins na edição (PUT substitui seleção inteira).
- R2b: no corte pra caber no budget, derruba parceiros primeiro, depois itens do catálogo em LIFO (últimos adicionados) até caber.
- R5b: estoque reservado no confirm; sem confirm até o cutoff, o worker confirma a seleção (budget-only) no cutoff e reserva então.

## Objetivo

Assinante monta graficamente a caixa mensal. O plano dá um budget mensal em R$.
Escolhe itens de um catálogo curado até o budget. Passar do budget gera cobrança.
Seções de Parceiros oferecem módulos adicionais, sempre cobrados à parte.

## Decisões travadas

- Budget incluso no plano, extras (overflow + parceiros) cobrados à parte.
- Catálogo do Box separado da loja (`Product`).
- Parceiros em model próprio (`Partner`), não reusa `PremiumAddonModule`.
- Escopo do épico: mobile + admin + fulfillment + API.
- Ciclo com cutoff: box reabre a cada ciclo, edita até o corte, depois trava.
- Extras cobrados via `Order` único no fechamento (infra de orders atual).
- Fulfillment reusa `Order` + `ShippingAddress` + `FulfillmentStatus`.

## Modelo de dados (proposto)

Novos models:

- `BoxCatalogItem` — `slug, title, description, priceCents, imageObjectKey, category, active, sortOrder, stockPerCycle?`.
- `Partner` — `slug, name, logoObjectKey, description, active, sortOrder`.
- `PartnerModule` — `partnerId, name, description, priceCents, imageObjectKey, active, sortOrder`. 1:N, começa com 1.
- `MonthlyBox` — 1 por membership por ciclo. `membershipId, garageId, cycleStart, cycleEnd, cutoffAt, status, budgetCentsSnapshot, itemsTotalCents, partnersTotalCents, overflowCents, chargeCents, shippingAddressId, orderId?`.
- `MonthlyBoxItem` — `boxId, catalogItemId, quantity, unitPriceCents, subtotalCents`.
- `MonthlyBoxPartnerItem` — `boxId, partnerModuleId, quantity, unitPriceCents, subtotalCents`.

Alterações:

- `PremiumPlan.monthlyBoxBudgetCents Int @default(0)`.
- `OrderKind` ganha `box`.
- `BoxSettings` — `boxEnabled, cutoffDaysBeforeRenewal, header copy`.

## Regra de cobrança

Recalcula a cada edição, server-side:

- `itemsTotalCents` = soma itens do catálogo.
- `overflowCents` = max(0, itemsTotal - budgetSnapshot).
- `partnersTotalCents` = soma módulos de parceiro.
- `chargeCents` = overflow + parceiros.

Order só flipa `paid` por webhook. Box avança pra fulfillment só com Order pago.
Se `chargeCents == 0`, box vai direto pra fulfillment sem Order.

## Máquina de estados (final)

Estados do `MonthlyBox.status`:

- `open` — editável. Sem reserva de estoque.
- `awaiting_payment` — usuário confirmou com extras. Order `pending` criado. Estoque reservado.
- `ready` — confirmado sem pendência (chargeCents==0) ou Order pago. Trava edição, aguarda fulfillment.
- `skipped` — usuário pulou o mês / seleção vazia no cutoff. Nada enviado.
- `cancelled` — cancelado (refund ou admin).

Transições:

- `open` --confirm (chargeCents==0)--> `ready` (reserva estoque).
- `open` --confirm (chargeCents>0)--> `awaiting_payment` (reserva estoque, cria Order).
- `awaiting_payment` --webhook Order paid--> `ready`.
- `open`/`awaiting_payment` --cutoff worker--> ver algoritmo abaixo.
- `ready` --Order.fulfillmentStatus--> packed/shipped/delivered (fulfillment).

Fulfillment vive em `Order.fulfillmentStatus` quando há Order; boxes budget-only
sem Order usam `MonthlyBox` + picking list (`MonthlyBoxItem`) direto.

## Algoritmo do cutoff (worker)

Para cada box com cutoff vencido:

- `open` com seleção vazia → `skipped`.
- `open` com seleção não vazia → auto-confirma budget-only: derruba parceiros,
  depois itens em LIFO até `itemsTotal <= budget`, reserva estoque (item sem
  estoque é derrubado), grava `ready`. Sem cobrança.
- `awaiting_payment` (extras não pagos) → mesmo corte pra budget-only, cancela o
  Order pendente, libera reserva dos itens derrubados, grava `ready`.

## Reserva de estoque

- Reserva no confirm (ou no auto-confirm do cutoff), não na seleção.
- Item sem estoque no momento da reserva é derrubado da caixa (LIFO), com aviso.
- `stockPerCycle` decrementa na reserva; libera no corte/cancelamento.

## Integração com assinaturas (PR #5 feat/assinaturas-controle-admin)

O fluxo de assinatura é o pré-requisito. Assinar é o passo inicial de quem hoje
não paga nada. Os planos da assinatura SÃO os planos do box. Virou membro, todo
mês tem acesso ao Box Builder.

- Budget por tier vive em `PremiumPlan.monthlyBoxBudgetCents`. `PremiumPlan.tier`
  é único (bronze/silver/gold), então cada plano tem seu budget.
- Elegibilidade e ciclo vêm de `PremiumMembership` (não do snapshot
  `Garage.premiumTier`). Só `active`/`trialing` montam box (R7). O ciclo é
  `currentPeriodStart`/`currentPeriodEnd` da membership.
- Abertura do MonthlyBox: hook em `applyMembershipEvent` nos casos
  `subscription.activated` e `subscription.renewed` (branch forward-advance),
  espelhando o padrão pós-commit do `PremiumTicketBackfillJob`. Um MonthlyBox por
  membership por ciclo. Sem membership viva, sem box.
- Invariante mantida: `PremiumMembership` só é escrita por webhook via
  `applyMembershipEvent`. O box só lê o estado; não cria membership.
- Extras do box são um `Order` one-time (kind `box`, Pix/cartão), separado da
  fatura recorrente do Stripe. Não usa proration da assinatura.
- Aberto: garagens com premium só por concessão manual (`Garage.premiumTier`,
  sem `PremiumMembership`) têm box? MVP: não (box exige membership viva). Flag.

## Handoff de design

Referência de UI em `docs/design/box-builder/` (15 telas mobile alta fidelidade,
4 wireframes de admin, componentes, microcopy PT-BR, tokens, animações).

## Questões do handoff (Q1-Q9) — abertas

Levantadas pelo agente de design. Algumas afetam schema (bloqueiam Fase 1).

- Q1 Frete (RESOLVIDO): grátis só para Curitiba e região. Fora da região, o
  frete é somado ao `chargeCents`. Precisa de: config em `BoxSettings`
  (`freeShippingRegion` por CEP/cidade + `shippingFeeCents` padrão), cálculo do
  frete a partir da `ShippingAddress` no server, e linha de frete condicional na
  tela 05. Aberto menor: fora da região, cobra frete ou bloqueia envio? Default:
  cobra.
- Q2 Aviso do corte: push/e-mail no momento do corte e aviso preventivo 24h
  antes com extras não pagos. Não definido. Afeta Fase 5.
- Q3 Cancelar Pix pendente: cancelar volta o box pra `open` (libera reserva,
  edita) ou só cancela o Order mantendo travado? Afeta máquina de estados.
- Q4 Item derrubado por falta de estoque no confirm: usuário revisa antes de
  pagar? Sugestão: confirm recalcula, mostra o que caiu, pede reconfirmação.
- Q5 Estoque visível no catálogo: mostrar "últimas unidades" com estoque baixo
  ou só "Sem estoque" em zero? Telas assumem só o segundo.
- Q6 Rastreio (schema): timeline mostra código de rastreio; Order não tem esse
  campo. Se não existir, tela 09 fica só com 3 marcos.
- Q7 Box budget-only sem Order (schema): fulfillment não vive em
  `Order.fulfillmentStatus`. Qual campo o app lê? Precisa fonte (ex.:
  `MonthlyBox.fulfillmentStatus` ou Order zero pra budget-only).
- Q8 Voltar depois de pular: tela 11 reverte até o cutoff. Spec não define
  transição `skipped` → `open`. Confirmar ou tornar skip definitivo.
- Q9 Quantidade máxima por item (schema): RESOLVIDO — `maxPerCycle Int?` em
  `BoxCatalogItem`, validado no Zod. Ver hardening abaixo.

## Correções pós-review (4 reviewers, aplicadas)

Achados verificados contra o código real (padrões de `cancel.ts`,
`apply-membership-event.ts`, `stripe-billing-webhook.ts`, `Variant`). Incorporados
ao design.

### Schema

- Unicidade do ciclo: `MonthlyBox` ganha `cycleKey String` estável (derivado do
  período da membership) e `@@unique([membershipId, cycleKey])`. O job de abertura
  engole P2002 (padrão do invoice insert). Não confiar só em `cycleStart` cru.
- Estoque com race safety: `stockPerCycle` no `BoxCatalogItem` é capacidade;
  a reserva NÃO decrementa esse campo. Novo ledger por ciclo
  `BoxCatalogItemCycleStock { catalogItemId, cycleKey, total, reserved }` com
  `@@unique([catalogItemId, cycleKey])`; decremento atômico condicional
  (`UPDATE ... SET reserved = reserved + q WHERE reserved + q <= total`),
  0-rows = esgotado. Espelha `Variant.quantitySold`.
- Fulfillment do box budget-only (resolve Q7): `MonthlyBox.fulfillmentStatus
FulfillmentStatus @default(unfulfilled)` é a fonte de verdade do box. Quando há
  `Order`, mantém sincronizado. Não inventar "Order zero".
- Snapshots nas linhas: `MonthlyBoxItem`/`MonthlyBoxPartnerItem` gravam
  `titleSnapshot`/`nameSnapshot` + `currency` além de `unitPriceCents` (padrão do
  `PremiumMembershipAddon`). Picking list e histórico leem o snapshot.
- Corte auditável: linhas ganham `included Boolean @default(true)` +
  `droppedAt DateTime?` + `dropReason`. A picking list filtra `included=true`.
  Preserva o que o membro escolheu vs o que foi enviado.
- Moeda: `currency String @default("BRL") @db.VarChar(3)` em `BoxCatalogItem`,
  `PartnerModule`, `MonthlyBox` e snapshots (convenção do schema).
- Ordenação p/ LIFO: `MonthlyBoxItem.addedAt` (ou `seq` monotônico). O PUT de
  seleção passa a ser diff-merge por `catalogItemId` (preserva `addedAt` de itens
  já presentes), não delete-insert cego. Ajusta R14: last-write-wins nas
  quantidades, mas a ordem de adição é preservada.
- `maxPerCycle Int?` em `BoxCatalogItem` (resolve Q9), validado no Zod.
- Relações/índices: box→linhas `onDelete: Cascade`; linhas→catalogItem/
  partnerModule `Restrict`; partner→module `Restrict`; `MonthlyBox.orderId
String? @unique` + back-relation em `Order` (`SetNull`). Índices:
  `@@index([status, cutoffAt])` (worker), índice p/ picking list
  (`[cycleKey, fulfillmentStatus]`), `@@index([membershipId])`. `garageId` fica
  como cópia denormalizada, não autoritativa (elegibilidade vem da membership).

### Abertura do ciclo (billing)

- Job pós-commit `MonthlyBoxOpenJob`, enfileirado só nos branches
  forward-advance (`didAdvancePeriod`), espelhando
  `enqueuePremiumTicketBackfillIfActivated` (stripe-billing-webhook.ts:544).
  Ativação/renovação stale (out-of-order) NÃO abre box. O worker lê o ciclo da
  ROW da membership, não do evento.

### Worker de cutoff (correção de corridas)

- Transição por box em UMA transação, com `SELECT ... FOR UPDATE` na Garage
  (canon §F8.5) e gate `WHERE status IN ('open','awaiting_payment')`. Efeitos
  (decremento de estoque, cancel do Order, flip de status) commitam juntos;
  re-run é no-op.
- Cancelar Order via `updateMany({where:{id,status:'pending'}})` + checagem de
  count (padrão cancel.ts:77-81). Se count===0, o Pix já liquidou → seguir o
  caminho pago, não cancelar. Serializa contra o webhook.
- Corte unit-level: decrementa `quantity` em LIFO até `itemsTotal <= budget`;
  remove a linha só quando chega a 0. Recalcula subtotal a cada passo.
- Pós-corte com seleção vazia → `skipped`, não `ready` (não envia caixa vazia).

### Cobrança e refund

- Ordem do cálculo: `chargeCents = overflow + parceiros + frete`. O branch
  `chargeCents==0 → ready direto` roda DEPOIS de somar o frete (fora de Curitiba
  vira cobrança só de frete → passa pelo pagamento).
- Assertiva server-side: o confirm rejeita se o `chargeCents` calculado no server
  for > 0 quando o cliente pediu o caminho grátis.
- Snapshot no Order: `Order.amountCents = box.chargeCents`, `currency='BRL'`;
  totais do box imutáveis a partir de `awaiting_payment` (R10).
- Cancelar Pix (Q3, recomendado): só cancela o Order e mantém o box travado
  (evita segundo Order órfão). Além disso, chamar AbacatePay pra cancelar/expirar
  a cobrança (nosso cancel local não anula o QR; risco do path pix-manual-refund).
- Refund do box (R13): flip Order `refunded` (Pix e cartão) → libera reserva de
  estoque → box `cancelled` → bloqueia picking se ainda não enviado. Transições
  explícitas: `awaiting_payment`/`ready` → `cancelled`.
- Dev fee: DECIDIR (ver Q11). Order tem `devFeePercent @default(10)`; não deixar
  defaultado sem intenção.

### Admin / UX / a11y

- Admin (wireframe D) ganha log do cutoff / relatório de itens derrubados e
  tratamento de box budget-only sem endereço.
- Indicador de "cobrado à parte" não pode ser só cor (verde). Adicionar rótulo/
  ícone p/ daltônicos.
- Microcopy vai pra chaves i18n (não literal), retenção LGPD de histórico de box
  e endereço documentada.
- Correção factual: o handoff afirma "nenhum campo novo"; falso — `tracking` (Q6)
  e `MonthlyBox.fulfillmentStatus` (Q7) são campos novos.

## Novas questões do review (Q10-Q17) — abertas

- Q10 (CONFLITO, crítico) Auto-confirm sem consentimento: o cutoff auto-confirma
  box `open` com itens e ENVIA (escolha R5b), mas R4 diz "não confirma → não
  envia" e enviar sem confirmação é remessa não solicitada. Reconciliar:
  (a) só box confirmado/pago envia (open+itens não confirmado → `skipped`), ou
  (b) flag opt-in "enviar automático". Conflita com decisão anterior (R5b).
- Q11 Dev fee no Order do box: 0 ou split padrão da plataforma?
- Q12 Estoque de módulo de parceiro: `PartnerModule` tem estoque por ciclo? MVP:
  não. Se sim, precisa campo + estado esgotado na tela 04.
- Q13 Membership expira entre `ready` e envio: envia a caixa (base já inclusa no
  plano) ou segura? Extras já pagos por Order à parte.
- Q14 Primeiro box / meio de ciclo: quem assina depois do cutoff vê o quê? Budget
  de `trialing` é igual? Ponto de entrada do primeiro box.
- Q15 Auto-confirm sem endereço: box budget-only no cutoff sem `ShippingAddress`
  → `skipped` ou `ready` não-enviável? (liga com Q10)
- Q16 Algoritmo da região de frete grátis: faixa de CEP ou lista de cidades da
  região de Curitiba? Load-bearing e propenso a erro.
- Q17 Q6 rastreio: adicionar campo `tracking` no Order (+ notificação com
  rastreio) ou remover o marco de rastreio da tela 09?

---

# Deep review — riscos e decisões em aberto

RESOLVIDO. As decisões finais estão em "Decisões do review (confirmadas)" no
topo, que prevalece. O texto abaixo é o registro original das recomendações.
Onde divergir do topo (ex.: R5, R6), vale o topo.

## R1. Pagamento não pode ser automático no cutoff (CRÍTICO)

Pix (AbacatePay) não permite cobrança off-session. Cartão via Stripe até
permitiria off-session, mas Pix não. Logo "cobrar no fechamento" não pode ser
um débito automático genérico. O usuário precisa pagar ativamente os extras.
Isso reformata a máquina de estados.

- Pergunta: o pagamento dos extras é sempre iniciado pelo usuário (confirmar +
  pagar antes do cutoff)? Recomendado: sim.

## R2. Comportamento no cutoff com extra não pago

Se o usuário montou extras mas não pagou até o cutoff:

- (a) envia só os itens dentro do budget, descarta overflow + parceiros; ou
- (b) não envia box nesse mês; ou
- (c) cancela o box.
  Recomendado: (a) envia budget-only.

## R3. Sobra de budget

Se a seleção fica abaixo do budget, a diferença é perdida no ciclo?
Recomendado: perde, não acumula (padrão de box).

## R4. Mínimo / pular o mês

Existe seleção mínima? O usuário pode pular a caixa de um mês?
Recomendado: sem mínimo, pode pular (não confirma → não envia).

## R5. Estoque por ciclo

`stockPerCycle` limita e pode esgotar? Se sim, reserva na seleção ou no
pagamento? Reserva na seleção trava estoque de quem não paga.
Recomendado MVP: sem limite de estoque (ignora corrida). `stockPerCycle`
fica como campo futuro, não enforced na fase 1.

## R6. Frete

Frete do box é grátis/incluso ou somado ao `chargeCents`?
Recomendado: incluso (grátis) no MVP.

## R7. Elegibilidade por status de membership

Quais status geram box: `active`, `trialing`, `past_due`, `paused`,
`cancel_scheduled`? Recomendado: `active` e `trialing` podem montar.
`past_due`/`paused` bloqueiam. `cancel_scheduled` monta o último ciclo pago.

## R8. Assinatura no meio do ciclo / troca de tier

- Signup no meio do ciclo antes do cutoff: ganha box do ciclo atual (budget cheio)?
  Recomendado: sim se antes do cutoff, senão próximo ciclo.
- Troca de tier no meio do ciclo: budget muda no ciclo atual?
  Recomendado: snapshot no abrir, troca vale no próximo ciclo.

## R9. Módulo de parceiro é por ciclo, não assinatura

Cada módulo de parceiro é um item físico escolhido por ciclo, cobrado a cada
ciclo em que for selecionado (não é add-on recorrente persistente).
Recomendado: confirmar essa semântica.

## R10. Edição depois de pagar

Depois de confirmar/pagar os extras, dá pra editar de novo antes do cutoff?
Recomendado: pagar trava o box (sem edição). Sem extra, confirmar também trava.

## R11. Catálogo muda no meio do ciclo

Admin arquiva item já selecionado. Preço é snapshotado, mas e disponibilidade?
Recomendado: item já na seleção permanece; arquivar só remove do catálogo novo.

## R12. Picking list do admin

Itens do box vivem em `MonthlyBoxItem`, não em `OrderItem`. O fulfillment usa
`Order.fulfillmentStatus`, mas a lista de separação por ciclo consulta
`MonthlyBoxItem`. Split conhecido, aceitável. Registrar no spec.

## R13. Reembolso / cancelamento

Cancelar depois de pago e antes de enviar: reusa refund do `Order`.
Recomendado: fluxo mínimo de refund manual pelo admin.

## R14. Concorrência na edição

Dois dispositivos editando a mesma seleção. Recomendado: last-write-wins no
MVP (PUT substitui a seleção inteira).
