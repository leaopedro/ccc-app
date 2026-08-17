# Notification delivery durability (outbox) — design

Data: 2026-08-16. Branch: `feat/box-builder-fase-5-notifications` (mesmo PR da Fase 5, #29).
Origem: dois achados de review na Fase 5, ambos comportamento do subsistema
de push compartilhado (`sendTransactionalPush`), nao regressao da Fase 5.

## Objetivo

Tornar a entrega de notificacao transacional duravel e re-tentavel:

1. **Achado #1 (crash entre commit de estado e criacao da linha):** hoje a
   linha de notificacao e criada DEPOIS que a transacao de estado commita.
   Um crash no meio perde inbox + push, e a transicao nao re-dispara.
2. **Achado #2 (Expo all-error marcado como enviado):** `sentAt` e gravado
   incondicionalmente apos `send`, mesmo quando todos os tokens falham
   (outage Expo). A unique de dedupe bloqueia reenvio. Push perdido, aparece
   como enviado.

Padrao existente a espelhar: `BroadcastDelivery` + worker de broadcasts
(status/attemptCount/lastAttemptAt/failureCode, worker cron 1/min, `sentAt`
so no sucesso).

## Escopo fechado (decisoes do usuario)

- Tudo no PR da Fase 5 (#29), mesma branch.
- **#2 (retry) universal** via worker + `sentAt`-so-no-sucesso: beneficia
  todos os kinds SEM editar arquivos de billing.
- **#1 (durabilidade in-tx) so no box** (3 sites com transacao propria).
  #1 dos tickets de billing fica como residual documentado: exigiria
  cirurgia no nucleo do `settlePaidOrder`; fora de escopo aqui. Janela
  estreita e o ticket ja e emitido e visivel in-app.

## 1. Migration (Notification) — aditiva

Adiciona a `Notification`:

```prisma
attemptCount  Int       @default(0)
lastAttemptAt DateTime?
failureCode   String?   @db.VarChar(80)
```

`sentAt IS NULL` passa a significar "ainda nao entregue" (outbox pendente).

**Backfill obrigatorio no mesmo migration:** `UPDATE "Notification" SET
"sentAt" = COALESCE("sentAt", "createdAt") WHERE "sentAt" IS NULL;` Sem isso,
o worker novo re-processaria notificacoes historicas com `sentAt` nulo (ex:
antigas de zero-token) e poderia entregar push velho. O backfill fecha o
historico antes do worker ligar.

Indice opcional pra varredura do worker:
`@@index([sentAt, attemptCount])` (pending scan). Incluir.

## 2. Refactor de `apps/api/src/services/push/transactional.ts`

Divide criacao de entrega. Preserva `buildPushData` (route `notifications`,
`notificationId`, `destination`) e a limpeza de token invalido existentes.

### `enqueueNotification`

```ts
export const enqueueNotification = async (
  input: SendTransactionalPushInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ deduped: true } | { deduped: false; id: string }> => { ... }
```

Cria so a linha (`sentAt` null, `attemptCount` 0). Em colisao de unique
(P2002) retorna `{ deduped: true }`. Aceita um tx client (default `prisma`).

Nota P2002-in-tx: quando chamado dentro de uma transacao do caller, uma
colisao de unique aborta a transacao Postgres inteira (nao da pra engolir
sem abortar). Todos os sites de enqueue-in-tx do box sao guardados por
transicoes de estado idempotentes (flip so-se-pending, advance forward-only,
cutoff resolve-uma-vez), entao P2002 nao ocorre no caminho feliz. Se ocorrer,
o rollback conjunto (estado + notificacao) e seguro: nao ha meio-estado.

### `deliverNotification`

```ts
export const deliverNotification = async (
  notificationId: string,
  deps: { sender: PushSender },
): Promise<{ sent: number; invalidatedTokens: number; delivered: boolean }> => { ... }
```

- Carrega a notificacao; se `sentAt` ja setado, no-op (`delivered: true`).
- Busca `deviceToken` do usuario. Zero tokens: nada a entregar, termina
  (grava `sentAt`), `delivered: true`.
- Envia via `deps.sender.send` com `buildPushData`.
- Conta `sent` (outcome `ok`); coleta `invalid` (outcome `invalid-token`) e
  apaga esses tokens (comportamento atual); marca `hasError` se qualquer
  outcome for `error`.
- **Grava `sentAt` (terminal) quando `sent > 0` OU `!hasError`** (todos ok/
  invalid-token, ou zero tokens). **Deixa `sentAt` null e incrementa
  `attemptCount`, seta `lastAttemptAt` + `failureCode` quando `sent === 0 &&
hasError`** (transiente, re-tentavel).

### `sendTransactionalPush` (mantido, compat)

```ts
export const sendTransactionalPush = async (input, deps) => {
  const enq = await enqueueNotification(input);
  if (enq.deduped) return { deduped: true, sent: 0, invalidatedTokens: 0 };
  const d = await deliverNotification(enq.id, deps);
  return { deduped: false, sent: d.sent, invalidatedTokens: d.invalidatedTokens };
};
```

Mesma assinatura e retorno. Os 6 callers non-box (event-reminders,
admin/tickets, stripe x3, abacatepay x2) ficam inalterados, mas ganham a
semantica correta de `sentAt` (#2) e o backstop do worker.

## 3. Worker de entrega (novo)

`apps/api/src/workers/notification-delivery.ts`:

```ts
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 60_000;

export const runNotificationDeliveryTick = async (deps: {
  sender: PushSender; now?: Date; log?: FastifyBaseLogger;
}): Promise<void> => { ... }

export const startNotificationDeliveryWorker = (deps: {
  sender: PushSender; log: FastifyBaseLogger;
}): { stop: () => void } => { ... } // cron '* * * * *'
```

Varre `Notification` onde `sentAt IS NULL AND attemptCount < 5 AND
(lastAttemptAt IS NULL OR lastAttemptAt <= now - 60s)`, `take: 50`, ordena
por `createdAt asc`. Para cada, chama `deliverNotification`. Erros por linha
sao logados e nao derrubam o tick (try/catch por item, igual broadcasts).
Registrar em `app.ts` com `sender: app.push` (junto dos outros workers).

Latencia: push do box sai em ate ~1 min. Aceitavel pros marcos (inclusive
pagamento confirmado; a tela de pagamento ja faz polling).

## 4. Box vai pra dentro da transacao (#1)

`apps/api/src/services/box/notifications.ts`: `sendBoxPush(sender, ...)`
vira:

```ts
export const enqueueBoxNotification = async (
  tx: Prisma.TransactionClient,
  input: { userId: string; boxId: string; kind: BoxPushKind },
): Promise<void> => {
  const copy = COPY[input.kind];
  await enqueueNotification(
    {
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    tx,
  );
};
```

COPY (acentos) inalterada. Sem `sender`, sem envio (worker entrega).

Move o enqueue pra DENTRO de cada transacao de estado do box; remove os
envios post-commit adicionados antes na Fase 5:

- **box.paid** — dentro da `$transaction` do ramo box em `settle.ts`, apos o
  `monthlyBox.updateMany` pra `ready`. `userId` via `membership.garage.userId`
  (estender o select do `findFirst`). REVERTE `paidBox` do `SettledOrderResult`
  (nao mais necessario) e REMOVE o bloco `sendBoxPush` de `box.paid` no
  `abacatepay-webhook.ts`.
- **box.ready** — dentro da `$transaction` por-caixa do cutoff, quando
  `resolveBudgetOnly` retorna `'ready'`, enqueue in-tx. REMOVE o envio
  post-commit e o parametro `sender` de `Deps`/`startBoxCutoffWorker`
  (reverte essa parte da Fase 5); `app.ts` volta a `startBoxCutoffWorker({
log: app.log })`. `userId` do box carregado no tick (`membership.garage.userId`).
- **box.shipped / box.delivered** — dentro da `$transaction` de
  `advanceBoxFulfillment`, apos o box `updateMany` + sync do Order + audit,
  quando `input.to` for `shipped` ou `delivered`, enqueue in-tx com
  `` kind: `box.${input.to}` ``. REVERTE `userId`/`boxId` do resultado `ok` e
  REMOVE o `sendBoxPush` da rota `box-fulfillment-admin.ts`. `userId` via
  `membership.garage.userId` (o select inicial ja sera estendido).

Guarda mantida: nunca tocar `Order.status`; guarda `order_not_paid` e audit
intactos; enqueue so no caminho de sucesso da transicao.

## 5. Testes (API, Testcontainers/Postgres real)

- **Worker:** pending vira entregue (`sentAt` setado); all-error deixa
  `sentAt` null, incrementa `attemptCount`, re-tenta no proximo tick; para em
  5 tentativas; respeita `RETRY_INTERVAL` (nao re-tenta antes de 60s).
- **`deliverNotification`/`sendTransactionalPush`:** all-error NAO grava
  `sentAt` (regressao do #2); sucesso parcial (`sent>0`) grava; all-invalid
  grava (terminal) e apaga tokens; zero-token grava.
- **Box in-tx (#1):** enqueue cria a linha atomically com a transicao; se a
  transacao de estado der rollback, NENHUMA linha de notificacao existe
  (prova atomicidade); o worker entrega a linha criada.
- **Box triggers:** box.paid no settle, box.ready no cutoff (ready) e nao no
  skipped, box.shipped/delivered no advance e nao no packed — agora via
  worker (enqueue + `runNotificationDeliveryTick`).
- **Migration backfill:** linha pre-existente com `sentAt` null nao e
  re-entregue pelo worker (backfill fechou).
- Suites existentes (box, push, broadcasts) seguem verdes.

## Residual conhecido (at-least-once)

A entrega e at-least-once, nao exactly-once. O claim CAS previne double-send
concorrente-instantaneo, mas um envio que ultrapassa a janela de retry (60s)
pode ser re-reivindicado e re-enviado (o Expo nao tem idempotency key). O
worker tem um guard de nao-overlap que serializa os ticks no processo,
fechando o caso comum worker-vs-worker; o residual (envio unico > janela, ou
multiplas instancias de API) fica aceito pela postura "prioriza entrega sobre
perda". Fechar totalmente exigiria lease duravel + SKIP LOCKED (so necessario
com multiplas instancias). Um crash entre o envio e a escrita de `sentAt`
tambem re-entrega no proximo tick (mesma propriedade).

## 6. Fora de escopo (explicito)

- #1 dos tickets de billing (cirurgia no `settlePaidOrder`): residual
  documentado, nao corrigido aqui.
- Outbox generico transacional (tabela + relay): nao usado; enqueue-in-tx
  direto no box e suficiente.
- Backoff exponencial: retry linear (cada tick, ate 5) e suficiente.
- Preferencias/opt-out por usuario, WebSockets, mudanca mobile: nenhum.

## Contrato de interface (fonte unica pro plano)

- Migration: `Notification.attemptCount/lastAttemptAt/failureCode` +
  backfill de `sentAt` + indice `[sentAt, attemptCount]`.
- `transactional.ts`: `enqueueNotification(input, client=prisma)`,
  `deliverNotification(id, {sender})`, `sendTransactionalPush` mantido.
- Worker: `runNotificationDeliveryTick`/`startNotificationDeliveryWorker`;
  registrado em `app.ts`.
- Box: `enqueueBoxNotification(tx, {userId, boxId, kind})`; enqueue in-tx nos
  3 sites; reverte `paidBox`, `Deps.sender` do cutoff, `userId/boxId` do ok
  do advance, e os 3 envios post-commit.
