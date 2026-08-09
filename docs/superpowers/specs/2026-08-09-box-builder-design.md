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

---

# Deep review — riscos e decisões em aberto

Marcados com recomendação. Precisam de confirmação antes do spec final.

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
