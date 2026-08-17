# Box Builder — Fase 5: Notificacoes (design)

Data: 2026-08-15. Branch: `feat/box-builder-fase-5-notifications`.
Roadmap: `docs/superpowers/box-builder-roadmap.md` (Fase 5 — PENDENTE).
Spec de origem: `docs/superpowers/specs/2026-08-09-box-builder-design.md`.

## Objetivo

O membro recebe um push a cada marco do ciclo da caixa: pagamento
confirmado, caixa pronta no cutoff, enviada, entregue. Reusa a infra de push
transacional que ja existe. Sem WebSocket, sem preferencias novas, sem
mudanca no mobile.

## Decisoes fechadas

- Quatro marcos: `box.paid`, `box.ready`, `box.shipped`, `box.delivered`.
  `packed` (Preparando) NAO notifica.
- Abordagem A (no ponto de gatilho): cada push dispara no site que ja
  existe (webhook, worker de cutoff, rota de advance). Sem worker novo, sem
  polling.
- Reusa `sendTransactionalPush`: cria item de inbox + envia + deduplica.
- Destino dos quatro: `{ kind: 'internal_path', path: '/caixa' }`.
- Sem preferencias por usuario. Transacional sempre envia, igual aos
  lembretes de evento.
- Escopo API + shared. Zero codigo mobile.

## 1. Modelo de dados — sem migration

Reusa `Notification`, `DeviceToken` e `sendTransactionalPush`. A unique
`@@unique([userId, kind, dedupeKey])` ja garante idempotencia. Nada a
migrar.

Dono do box (destinatario) resolvido por `MonthlyBox.garageId ->
Garage.userId` (hop unico, disponivel em todos os sites).

`dedupeKey = boxId` (o `kind` ja entra na unique, entao o boxId sozinho
basta por marco).

## 2. Shared (`packages/shared/src/push.ts`)

Adiciona quatro valores ao `pushKindSchema` (hoje: `ticket.confirmed`,
`event.reminder_24h`, `event.reminder_1h`, `broadcast`):

```ts
export const pushKindSchema = z.enum([
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
  'broadcast',
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
]);
```

Nenhum schema de destino novo: `notificationDestinationSchema` ja tem
`internal_path`. Cabe em `Notification.kind` (`VarChar(40)`).

## 3. Copy PT-BR

Central pra reuso nos tres sites de gatilho e nos testes. Onde a copy vive
e uma decisao do plano (constante em `apps/api/src/services/box/` ou modulo
dedicado); os valores sao normativos:

| kind          | title                | body                                              |
| ------------- | -------------------- | ------------------------------------------------- |
| box.paid      | Pagamento confirmado | Recebemos o pagamento. Sua caixa esta confirmada. |
| box.ready     | Caixa confirmada     | Sua caixa deste mes foi fechada e entrou na fila. |
| box.shipped   | Caixa enviada        | Sua caixa saiu para entrega.                      |
| box.delivered | Caixa entregue       | Sua caixa foi entregue. Aproveite.                |

Todos dentro dos limites (`title` VarChar 200, `body` VarChar 500).

## 4. Gatilhos (abordagem A)

Cada envio usa `sendTransactionalPush({ userId, kind, dedupeKey: boxId,
title, body, destination: { kind: 'internal_path', path: '/caixa' }, data:
{ boxId } }, { sender })`.

### 4.1 box.paid — webhook do Pix

`apps/api/src/services/orders/settle.ts`, ramo `order.kind === 'box'`. O
flip so acontece quando o Order estava `pending` (non-pending lanca
`OrderNotPendingError`), entao um retorno `{ kind: 'box' }` sempre significa
que a caixa virou `ready`. O ramo passa a capturar o dono e retornar:

```ts
export type SettledOrderResult =
  | { kind: 'ticket' | 'extras_only'; issued: IssueResult }
  | { kind: 'product' | 'mixed'; issued?: IssueResult[] }
  | { kind: 'box'; paidBox?: { userId: string; boxId: string } };
```

`paidBox` presente sempre que o flip ocorreu. `userId` resolvido via
`Garage` a partir do `garageId` que o ramo ja seleciona. `settle.ts` NAO
ganha dependencia de push.

O `apps/api/src/routes/abacatepay-webhook.ts` envia o push apos o settle,
usando `app.push`, quando o resultado e `kind === 'box'` com `paidBox`.
`settlePaidOrder` tambem e chamado pelo `stripe-webhook`, mas caixa nunca
liquida via Stripe, entao o ramo nao dispara la.

### 4.2 box.ready — worker de cutoff

`apps/api/src/workers/box-cutoff.ts`. `resolveBudgetOnly` fecha a caixa
como `ready` (quando ha itens) ou `skipped` (sem itens). So `ready`
notifica.

A transacao passa a retornar `{ notify: 'ready'; userId } | null`; o
`runBoxCutoffTick` envia o push pos-commit, fora da transacao. `notify` e
setado apenas no caminho `ready`, nunca no `skipped`. O caminho pago que ja
liquidou retorna cedo (o Order ja esta `paid`, a caixa ja e `ready` pela
4.1) e nao gera `box.ready`, evitando duplicata.

`Deps` do worker e `startBoxCutoffWorker` ganham `sender: PushSender` (hoje
so recebem `log`). `apps/api/src/app.ts` passa `app.push` ao iniciar o
worker, igual ao `event-reminders`.

### 4.3 box.shipped / box.delivered — rota de advance

`apps/api/src/services/box/fulfillment.ts`. `advanceBoxFulfillment` no
resultado `ok` passa a retornar o dono e o boxId:

```ts
type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus; userId: string; boxId: string }
  | ...; // demais variantes inalteradas
```

A rota `apps/api/src/routes/admin/box-fulfillment-admin.ts`, no advance,
apos `kind === 'ok'` e quando `to` for `shipped` ou `delivered` (packed nao
notifica), envia o push via `app.push`. Fire-and-forget: erro logado, nunca
derruba o advance nem muda a resposta 200.

## 5. Mobile — sem mudanca

O push sempre cai na tela de notificacoes (`data.route = 'notifications'`,
setado pelo `buildPushData`). Ao tocar o item do inbox, o
`openDestination` resolve `internal_path -> router.push('/caixa')`
(`apps/mobile/src/notifications/destination.ts:20`, ja implementado). A
rota `/caixa` ja existe. Nenhum arquivo mobile muda; no maximo um teste de
fumaca confirmando o roteamento do destino de caixa.

## 6. Testes (API, Testcontainers/Postgres real)

- `box.paid`: settle de Order de box pendente cria `Notification`
  (kind `box.paid`, destino `/caixa`, dedupeKey = boxId) e dispara no
  `DevPushSender`.
- `box.ready`: cutoff de caixa budget-only com itens cria `box.ready`.
- `box.shipped` / `box.delivered`: advance cria o push correspondente.
- Dedupe: repetir o mesmo gatilho nao duplica (`deduped: true`).
- Negativos:
  - cutoff `skipped` (sem itens) nao cria `box.ready`.
  - advance para `packed` nao cria push.
  - box pago que ja liquidou nao gera `box.ready` no cutoff.
- Shared: `pushKindSchema` aceita os quatro kinds novos.

## 7. Fora de escopo (explicito)

Push de `packed` (Preparando); lembretes de engajamento (caixa aberta,
lembrete de cutoff); aviso de `skipped`; preferencias/opt-out por usuario;
WebSockets. Todos adiaveis.

## Contrato de interface (fonte unica pro plano)

- Shared produz os quatro `pushKindSchema`.
- API dispara os quatro pushes nos tres sites, reusando
  `sendTransactionalPush`, com destino `/caixa` e dedupe por boxId.
- `SettledOrderResult` do ramo box ganha `paidBox`.
- `BoxAdvanceResult` variante `ok` ganha `userId` + `boxId`.
- `startBoxCutoffWorker`/`Deps` ganham `sender`.
- Mobile: consome o destino `internal_path` ja suportado; sem mudanca.
