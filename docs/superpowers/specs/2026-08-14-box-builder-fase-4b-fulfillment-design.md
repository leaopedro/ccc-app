# Box Builder — Fase 4b: Fulfillment (design)

Data: 2026-08-14. Branch: `feat/box-builder-fase-4b-fulfillment`.
Roadmap: `docs/superpowers/box-builder-roadmap.md` (Fase 4b — PENDENTE).
Spec de origem: `docs/superpowers/specs/2026-08-09-box-builder-design.md`.

## Objetivo

O organizador avanca uma caixa confirmada por Preparando -> Enviado ->
Entregue. O membro ve uma timeline ao vivo na tela 09 (`ready`). Sem
rastreio, sem push (Fase 5), sem refund/cancel (Fase 4c).

## Decisoes fechadas

- Uma branch para toda a Fase 4b. Fatiada em tres planos: API, admin web,
  mobile.
- Ship-only, 3 marcos. Box usa 5 dos valores do enum `FulfillmentStatus`:
  `unfulfilled, packed, shipped, delivered, cancelled`.
- Notificacoes adiadas para a Fase 5. Nenhum push na 4b.
- Refund/cancel adiados para a 4c. Timeline nao mostra cancelado (box
  cancelado tem `status = cancelled`, nunca chega na tela `ready`).

## 1. Modelo de dados — sem migration

`MonthlyBox.fulfillmentStatus` e `Order.fulfillmentStatus` ja existem, com
`@@index([cycleKey, fulfillmentStatus])`. Nada a migrar. Sem `trackingCode`
(Q17: sem rastreio).

Fonte de verdade = `MonthlyBox.fulfillmentStatus`. Quando existe `Order`
(extras pagos), o avanco atualiza os dois na mesma transacao. Caixa
budget-only (`orderId = null`) atualiza so o `MonthlyBox`.

O box usa seu proprio mapa ship-only de 3 marcos. Nao lemos nem escrevemos
`Order.fulfillmentMethod` (default `pickup` no schema, irrelevante aqui).

## 2. API

Novo `apps/api/src/services/box/fulfillment.ts`, espelhando o padrao
provado de `apps/api/src/services/store/orders.ts` (mapa de transicao,
contadores, mutacao de avanco).

### Mapa de transicao (forward-only)

```
unfulfilled -> packed -> shipped -> delivered
```

`delivered` e `cancelled` sao terminais. Sem un-advance na 4b.
Predecessores: `packed<-unfulfilled`, `shipped<-packed`, `delivered<-shipped`.

### Servico de avanco

```ts
type BoxAdvanceInput = { boxId: string; to: 'packed' | 'shipped' | 'delivered' };
type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus }
  | { kind: 'not_found' }
  | { kind: 'not_ready' } // box.status !== 'ready'
  | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string };
```

Guardas: `box.status` precisa ser `ready`; se ha `Order`, ele precisa
continuar `paid` (um webhook de refund pode virar `refunded`/`failed` com o
box ainda `ready`; nesse caso retorna `order_not_paid`, guardado tambem
dentro da transacao contra corrida); o status atual precisa ser o
predecessor imediato de `to`. Cada avanco grava um `AdminAudit`
(`box.fulfillment.advance`, ator + from/to) na mesma transacao. Flip race-safe via `updateMany(where
fulfillmentStatus = predecessor)`; count 0 re-le e retorna
`invalid_transition`. Se `orderId` setado, sincroniza
`Order.fulfillmentStatus` na mesma transacao (mesmo valor). Dedupe natural:
avanco repetido para o mesmo `to` cai em `invalid_transition` (idempotente
no efeito, sem duplo-escrita).

### Rotas admin (scope organizer/admin, como Fase 1)

- `POST /admin/box/monthly/:id/fulfillment` body `{ to }`
  -> 200 `{ id, fulfillmentStatus }`
  -> 404 `box_not_found`
  -> 409 `box_not_ready` | `invalid_transition` (com `code`)
- `GET /admin/box/monthly?cycleKey=<opcional>`
  -> `{ cycleKey, availableCycles: string[], counts, boxes: BoxAdminRow[] }`
  - `cycleKey` default = ultimo (maior) presente em `MonthlyBox`.
  - `availableCycles` = cycleKeys distintos, ordem desc.
  - `counts` = tally de `fulfillmentStatus` apenas nas caixas `ready` do
    ciclo (dashboard de progresso de packing).
  - `boxes` = todas as caixas do ciclo (inclui open/awaiting/skipped pra
    visibilidade).
  - `BoxAdminRow = { id, memberName, memberEmail, status, chargeCents,
currency, fulfillmentStatus, orderStatus }`. `orderStatus` null se sem
    Order. `memberName`/`memberEmail` derivados da membership -> user,
    seguindo o padrao existente da store.
- `GET /admin/box/monthly/picking?cycleKey=<opcional>`
  -> `{ cycleKey, items: PickingRow[], partnerItems: PickingRow[] }`
  - `PickingRow = { refId, title, totalQuantity, boxCount }`.
  - Agrega linhas `included = true` das caixas `status = ready` do ciclo
    (R12: de `MonthlyBoxItem` + `MonthlyBoxPartnerItem`, nunca `OrderItem`).
  - `items` agrupado por `catalogItemId` (`titleSnapshot`); `partnerItems`
    por `partnerModuleId` (`nameSnapshot`). `boxCount` = caixas distintas.
  - Decisao: agrega TODAS as caixas `ready` do ciclo (demanda fisica total
    da sessao de packing), nao so as ainda-nao-empacotadas.

### Shared (`packages/shared/src/box.ts`)

```ts
export const boxFulfillmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]);
export type BoxFulfillmentStatus = z.infer<typeof boxFulfillmentStatusSchema>;
// boxViewSchema ganha: fulfillmentStatus: boxFulfillmentStatusSchema
```

Novos schemas admin (onde vivem os schemas admin de box hoje,
`packages/shared/src/admin-box.ts`): request de avanco, `BoxAdminRow`,
`PickingRow`, respostas de list e picking.

### Serialize (`apps/api/src/services/box/serialize.ts`)

Adiciona `fulfillmentStatus: box.fulfillmentStatus` ao `BoxView`.

## 3. Admin web — painel D

Nova pagina `apps/admin/app/(authed)/box/caixas/`, espelhando
`apps/admin/app/(authed)/loja/pedidos/`: seletor de ciclo, contadores por
status de fulfillment, tabela de caixas (membro, status, a pagar,
fulfillment) com botao de avanco por linha, secao de picking list agregada.
Nova entrada de nav sob Box (junto de Catalogo/Parceiros/Config).

Consome os endpoints da secao 2. Sem refund/cancel (coluna refund fica pra
4c).

## 4. Mobile — timeline na tela 09

- `boxViewSchema` ja ganhou `fulfillmentStatus` (secao 2). O client mobile
  passa a ler.
- Helper puro `boxTimelineSteps(fulfillmentStatus)` em
  `apps/mobile/src/screens/caixa/box-state.ts` -> 3 passos
  `{ label, state: 'done' | 'current' | 'pending' }`:
  - `unfulfilled` -> `[current, pending, pending]`
  - `packed` -> `[done, current, pending]`
  - `shipped` -> `[done, done, current]`
  - `delivered` -> `[done, done, done]`
- Componente `FulfillmentTimeline` renderizado na variante `ready` (tanto
  `ReadyBody` quanto `PostCutoffBody`). Pontos verdes = concluido, borda =
  pendente, ponto atual destacado. Segue o design da tela 09.
- Copy `ready.timeline` = Preparando / Enviado / Entregue (com acentos).
- REMOVE o CTA "Acompanhar entrega": sem rastreio, timeline e inline.

## 5. Testes

- API (Testcontainers, Postgres real): avanco Order-backed + budget-only;
  guardas (not-ready rejeita, transicao invalida rejeita, duplo-avanco
  idempotente); list + counts; agregacao de picking.
- Shared: fixture do `boxViewSchema` ganha `fulfillmentStatus`.
- Mobile: testes unitarios de `boxTimelineSteps` (logica no helper puro,
  componente fino, seguindo a convencao caixa de nao testar render RN).
- Admin: espelha o que `loja/pedidos` usa.

## 6. Fora de escopo (explicito)

Refund/cancel (4c), notificacoes (5), rastreio/trackingCode, transicoes
para tras, metodos pickup/virtual.

## Contrato de interface (fonte unica pros tres planos)

- Shared produz `boxFulfillmentStatusSchema` + `boxViewSchema.fulfillmentStatus`.
- API produz as 3 rotas admin e o `fulfillmentStatus` no `BoxView`.
- Admin web consome as 3 rotas admin.
- Mobile consome `BoxView.fulfillmentStatus`.
- Nomes/tipos exatos: secoes 2 e 4 acima sao normativas.
