# Box Builder Fase 4a — Pagamento (Pix) do extra da caixa

Design da fatia de pagamento da Fase 4. Fecha o fluxo do assinante: pagar o
extra da caixa por Pix e o Order virar `paid` so por webhook verificado.

Origem:

- Roadmap: `docs/superpowers/box-builder-roadmap.md` (Fase 4 — PENDENTE)
- Fase 2 (runtime/confirm/cutoff): `docs/superpowers/plans/2026-08-10-box-builder-fase-2.md`
- Fase 3b-2b (revisao/confirm mobile): `docs/superpowers/plans/2026-08-13-box-builder-fase-3b-2b-mobile.md`

## Escopo

Fatia 4a de tres. So pagamento.

- **4a (esta spec):** checkout Pix do Order de box + settlement por webhook +
  tela de pagamento mobile.
- **4b (depois):** fulfillment (status, rastreio, timeline tela 09, admin).
- **4c (depois):** refund (Pix/AbacatePay nao tem refund API hoje) e qualquer
  tratamento de pagamento pos-cutoff alem do expiry.

Fora de escopo em 4a: Stripe/Apple Pay pra box (a Caixa e dark no iOS via
`EXPO_PUBLIC_CAIXA_ENABLED` ausente do profile EAS de producao iOS).

## Invariantes (nao negociaveis)

- Order so vira `paid` por webhook verificado do provider. Nunca por chamada do
  cliente.
- Webhook idempotente: dedupe por event id do provider (`PaymentWebhookEvent`),
  match por `orderId`/`providerRef`, assinatura verificada.
- Frete e verdade do servidor, calculado no confirm. 4a nao recalcula frete.
- Totais sao verdade do servidor (`chargeCents = overflow + partners + shipping`).

## Estado atual (base sobre a qual 4a constroi)

Ja existe em `main`:

- `POST /me/box/confirm` (`services/box/confirm.ts`): dentro de transacao que
  trava a Garage, reserva estoque, cria o Order de box quando `chargeCents > 0`:
  `kind:'box'`, `method:'pix'`, `provider:'abacatepay'`, `status:'pending'`,
  `amountCents = chargeCents`, `shippingAddressId`, `shippingCents`. **Nao** seta
  `providerRef`/`brCode` (nenhuma cobranca Pix e criada no confirm). Box vira
  `awaiting_payment`. Quando `chargeCents === 0`: box vira `ready`, sem Order.
- Seam de webhook AbacatePay (`routes/abacatepay-webhook.ts`): assinatura + secret
  na URL, dedupe idempotente, re-fetch `getPixBilling` (exige `PAID`), replay
  window 24h, e dispatch single-order por `metadata.orderId` (primario) ou
  `providerRef` (fallback) -> `settlePaidOrder`.
- `settlePaidOrder` (`services/orders/settle.ts`): hoje **lanca** pra
  `kind === 'box'` (guarda da Fase 2).
- `createPixBilling` (`services/abacatepay/index.ts`): aceita `amountCents`,
  `description`, `expiresInSeconds`, `customer`, `metadata`. Retorna `id` +
  `brCode`. `getPixBilling`, `verifyWebhookSignature`. **Sem** metodo de refund.
- Worker de cutoff (Fase 2): box nao paga no cutoff -> trim LIFO do excedente,
  envia so o budget, cancela Order pendente sem sobrepor pagamento liquidado.
- Mobile: home `awaiting_payment` ja renderiza banner + acao "Retomar pagamento"
  (`resumePayment`) e o placeholder "Pagamento pelo app disponivel em breve".

## Arquitetura 4a

Tres unidades, cada uma com fronteira clara:

1. **API — checkout:** novo `POST /me/box/checkout`. Cria a cobranca Pix pro Order
   de box `awaiting_payment` existente e carimba `providerRef`/`brCode`.
2. **API — settlement:** ramo `box` no `settlePaidOrder`. Order -> `paid`, box
   `awaiting_payment` -> `ready`.
3. **Mobile — tela de pagamento Pix:** mostra QR + copia-e-cola, faz polling do
   `GET /me/box` ate `ready`.

Sem mudanca no `abacatepay-webhook.ts`: o dispatch single-order ja roteia por
`metadata.orderId`. A logica de box mora no `settle.ts`, nao no webhook.

### Unidade 1 — `POST /me/box/checkout`

Cria a cobranca Pix pro Order de box do assinante.

Regras:

- Carrega a membership Premium elegivel e o `MonthlyBox` do ciclo (mesma guarda
  do confirm). Box precisa estar `awaiting_payment` com `orderId` setado.
- Se ja existe cobranca ativa (Order tem `providerRef` e a cobranca nao expirou),
  **reusa**: retorna o mesmo `brCode`. Idempotente. Nao cria cobranca duplicada.
- Senao, cria via `createPixBilling`:
  - `amountCents = order.amountCents` (verdade do servidor, nao vem do cliente).
  - `expiresInSeconds = floor((cutoffAt - now) / 1000)`. A cobranca **expira no
    cutoff**. Nao da pra pagar depois do cutoff. Fecha a corrida de pagamento
    pos-cutoff sem precisar de refund em 4a.
  - `description`: `Caixa <mes/ano>` (PT-BR).
  - `metadata`: `{ orderId, boxId, userId }`.
- Carimba `order.providerRef = billing.id`, `order.brCode = billing.brCode`.
- Erros:
  - `403 box_not_eligible` — sem membership elegivel.
  - `404 box_not_open` — sem box no ciclo.
  - `409 box_not_awaiting` — box nao esta `awaiting_payment` (ex.: ja `ready`,
    `skipped`, `cancelled`).
  - `409 box_locked` — `now >= cutoffAt` (janela expirada; nada a cobrar). Igual
    a resolucao residual da 3b-2b.
  - Upstream AbacatePay 4xx/5xx -> `502`/`503` com mensagem de retry. Nao mexe no
    Order (reserva permanece; usuario tenta de novo).

Resposta (`boxCheckoutResponseSchema`):

```
{ brCode: string, amountCents: number, expiresAt: string /* ISO */ }
```

### Unidade 2 — ramo `box` no `settlePaidOrder`

Remove a guarda que lanca pra box. Novo ramo:

- Transacao: flip `Order.status -> 'paid'`, `paidAt`; flip
  `MonthlyBox.status 'awaiting_payment' -> 'ready'`.
- `fulfillmentStatus` **inalterado** (`unfulfilled`). 4b e dona do pipeline.
- Estoque ja reservado no confirm. Nada a re-reservar.
- Idempotente: se o Order ja e `paid`, no-op (o webhook ja deduplica; a re-checagem
  de status protege corridas). Se o box nao esta `awaiting_payment` (ex.: cancelado
  no cutoff), o Order nao deveria estar `pending` — segue o mesmo tratamento de
  Order nao-pendente que o cart usa (nao sobrepoe estado liquidado).
- `SettledOrderResult` ganha uma variante `box` (sem emissao de ticket).

### Unidade 3 — mobile: tela de pagamento Pix

Nova rota `/caixa/pagar`.

- Alcancada de dois jeitos:
  1. Logo apos "Confirmar caixa" (revisar.tsx) quando `chargeCents > 0`.
  2. "Retomar pagamento" na home `awaiting_payment`.
- No mount: chama `POST /me/box/checkout` (idempotente) e renderiza QR +
  copia-e-cola + valor + prazo (expiraAt).
- Polling: `GET /me/box` a cada N segundos ate `status === 'ready'`, entao mostra
  sucesso e volta pra home read-only (`ready`). Sem push/websocket (arquitetura:
  REST + polling).
- `chargeCents === 0` continua indo direto pra `ready` (inalterado).
- Erros do checkout: `box_locked`/`box_not_awaiting` -> volta pra home com feedback;
  upstream -> banner de retry na propria tela.
- Copy: substitui "Pagamento pelo app disponivel em breve" pelo fluxo Pix real
  (PT-BR). Reusa a tela Pix do cart como referencia de UI (QR, botao copiar).

### Superficie compartilhada (packages/shared)

- `BoxView` ganha **so** `orderId: string | null`. O `brCode`/expiry vem da
  resposta do checkout, nao do `BoxView` (view enxuta; resume re-chama o checkout
  idempotente). Atualizar `boxViewSchema` + `serialize.ts` + fixture + teste.
- Novo `boxCheckoutResponseSchema` em `packages/shared/src/box.ts`.

### Cliente mobile (apps/mobile/src/api)

- Nova rota `checkoutBox(): Promise<BoxCheckoutResponse>` em `src/api/box.ts`.
- Hook fino de pagamento (espelha `useBoxConfirm`): dispara checkout, mapeia erros.

## Casos de borda

- **Cutoff antes de pagar:** worker da Fase 2 ja faz trim + cancela Order pendente.
  Com expiry = cutoff, a cobranca morre junto. Consistente.
- **Pagamento pos-cutoff:** impossivel — a cobranca expira no cutoff. Sem refund em
  4a. (Se o provider ainda liquidar por algum motivo raro, o Order ja foi cancelado
  pelo worker e o settle nao sobrepoe estado liquidado; o refund manual e 4c.)
- **Re-checkout:** cobranca ativa e reusada (idempotente). Sem duplicar Pix.
- **Webhook duplicado:** `PaymentWebhookEvent` deduplica; settle re-checa status.
- **AbacatePay fora do ar:** checkout falha com retry; reserva de estoque intacta.

## Testes

Integracao da API em Postgres real (Testcontainers), fake AbacatePay:

- checkout cria cobranca, carimba `providerRef`/`brCode`, retorna `brCode`.
- checkout reusa cobranca ativa (idempotente); nao duplica.
- checkout calcula `expiresInSeconds` a partir do `cutoffAt`.
- checkout `409` quando box nao `awaiting_payment` / quando pos-cutoff.
- webhook liquida: Order -> `paid`, box -> `ready`, idempotente em replay.
- settle no-op quando Order ja `paid`.
- unit puro: math de `expiresInSeconds`.
- shared: fixture do `boxViewSchema` com `orderId`.
- mobile: helper de mapeamento de erro do checkout (`.ts` puro) + hook (jsdom).

## O que 4a NAO faz

- Fulfillment (status, rastreio, timeline tela 09, rotas admin de box) — 4b.
- Refund + tratamento de pagamento tardio alem do expiry — 4c.
- Stripe/Apple Pay pra box — box dark no iOS.
- Flip do flag `EXPO_PUBLIC_CAIXA_ENABLED` — config, apos QA manual do fluxo.
