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
- **O settle e a rede de seguranca, nao o expiry.** So liquida Order que ainda
  esta `pending`. Order nao-pendente (cancelado no cutoff) nunca vira `paid`;
  vira sinal de refund manual. O expiry do Pix reduz a janela, nao e a garantia.
- **Mesma disciplina de lock das outras mutacoes de box.** Toda escrita que
  carimba cobranca ou liquida trava a linha da `Garage` (`FOR UPDATE`) e re-checa
  status dentro da transacao, igual `confirm.ts` e `box-cutoff.ts`.

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
- Worker de cutoff (Fase 2, `workers/box-cutoff.ts`, cron 1 min): box nao paga no
  cutoff -> trava `Garage FOR UPDATE`, cancela Order pendente (`updateMany where
status:'pending'`) sem sobrepor pagamento liquidado, **nula `box.orderId`**,
  libera estoque, resolve budget-only (`ready`/`skipped`).
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

Cria a cobranca Pix pro Order de box do assinante. Rate-limited (endpoint que
bate num provider externo e pode ser martelado; `CLAUDE.md` pede rate limit em
rotas relevantes). `createPixBilling` bate HTTP externo, entao nao pode rodar
dentro do lock. Fluxo em tres fases pra fechar as corridas com o worker de
cutoff e com um duplo-clique:

**Fase A (transacao, `Garage FOR UPDATE`):** carrega membership elegivel + box do
ciclo (mesma guarda do confirm). Exige `box.status === 'awaiting_payment'` e
`orderId` setado. Se `now >= cutoffAt`, ou faltam menos de 60s pro cutoff, ou o
Order nao esta `pending` -> aborta (ver erros). Se o Order ja tem `providerRef` de
cobranca ativa nao expirada, **reusa** e retorna o `brCode` sem criar outra.

**Fase B (fora do lock):** cria via `createPixBilling`:

- `amountCents = order.amountCents` (verdade do servidor, nao vem do cliente).
- `expiresInSeconds = floor((cutoffAt - now) / 1000)`, com piso: se der menos que
  o minimo (ex.: < 60s), a Fase A ja abortou com `box_locked`, entao nunca cria
  cobranca de expiry quase-zero.
- `description`: `Caixa <mes/ano>` (PT-BR).
- `metadata`: `{ orderId, boxId, userId }`.

**Fase C (transacao, `Garage FOR UPDATE` de novo):** re-checa `Order.status ===
'pending'` e `box.status === 'awaiting_payment'`. So entao carimba
`order.providerRef = billing.id`, `order.brCode = billing.brCode` via
`updateMany(where id + status:'pending')`. Se o worker cancelou nesse meio-tempo
(`count === 0`), **nao carimba**: retorna `box_locked`. A cobranca orfa expira no
cutoff; e se o provider ainda liquidar, o settle a barra e sinaliza refund manual.

Serializar Fases A e C sob o lock da `Garage` fecha o duplo-checkout: dois
requests concorrentes nao criam duas cobrancas vivas pro mesmo Order.

- Erros:
  - `403 box_not_eligible` — sem membership elegivel.
  - `404 box_not_open` — sem box no ciclo.
  - `409 box_not_awaiting` — box nao esta `awaiting_payment` (ex.: ja `ready`,
    `skipped`, `cancelled`), ou o Order nao esta mais `pending`.
  - `409 box_locked` — `now >= cutoffAt`, ou dentro da margem minima pro cutoff,
    ou o worker cancelou entre as fases. Igual a resolucao residual da 3b-2b.
  - `503 payment_unavailable` — `app.abacatepay` nao configurado (mesma guarda que
    `cart.ts` faz antes de qualquer Pix).
  - Upstream AbacatePay 4xx/5xx -> `502` com mensagem de retry. Nao mexe no Order
    (reserva permanece; usuario tenta de novo).

Resposta (`boxCheckoutResponseSchema`):

```
{ brCode: string, amountCents: number, expiresAt: string /* ISO */ }
```

### Unidade 2 — ramo `box` no `settlePaidOrder`

Remove a guarda que lanca pra box. O ramo tem que ser seguro contra o worker de
cutoff, que roda em paralelo e pode cancelar o Order entre a leitura e a escrita.
O ramo `product` do `settle.ts` le status fora da transacao e so escapa por
isolamento `Serializable`; o ramo `box` **nao** copia esse padrao. Em vez disso:

- Transacao com `Garage FOR UPDATE`: flip condicional via
  `tx.order.updateMany({ where: { id, status: 'pending' }, data: { status:'paid',
paidAt } })`. So vira `paid` se ainda estava `pending`. Mesma disciplina do
  `box-cutoff.ts` (que cancela com `updateMany(where status:'pending')`).
- Se `count === 1`: flip `MonthlyBox.status 'awaiting_payment' -> 'ready'` na mesma
  transacao. `fulfillmentStatus` **inalterado** (`unfulfilled`; 4b e dona do
  pipeline). Estoque ja reservado no confirm; nada a re-reservar.
- Se `count === 0` (Order nao estava mais `pending`): re-le o status.
  - Ja `paid`: compara o `providerRef` recebido com o gravado. Igual -> replay
    benigno, no-op. **Diferente** -> segunda cobranca distinta liquidada pro mesmo
    Order (pagamento em dobro): `flagManualRefund`. Fecha o buraco silencioso do
    ramo "already paid" do webhook (`abacatepay-webhook.ts:637`).
  - `cancelled`/`expired`/outro (cancelado no cutoff): o dinheiro entrou mas o box
    ja foi resolvido budget-only. **Nunca** forca `paid`. `flagManualRefund` e
    resolve (200 pro webhook parar de retryar). Refund em si e 4c.
- `SettledOrderResult` ganha uma variante `box` (sem emissao de ticket).

O webhook em si (`abacatepay-webhook.ts`) segue sem mudanca de dispatch: o ramo
`box` do settle sinaliza o refund via `flagManualRefund` como os outros ramos ja
fazem no catch de `OrderNotPendingError`.

### Unidade 3 — mobile: tela de pagamento Pix

Nova rota `/caixa/pagar`. Tem header com voltar (igual `revisar.tsx`); sair
desmonta e para o polling.

Pontos de entrada (ambos exigem editar codigo existente, listado abaixo):

1. Logo apos "Confirmar caixa" quando `chargeCents > 0`. Hoje `revisar.tsx`
   (`onConfirm`) faz `router.replace('/caixa')` incondicional; passa a ramificar
   pra `/caixa/pagar` quando ha cobranca.
2. "Retomar pagamento" na home `awaiting_payment`. Hoje o botao esta `disabled`
   com `onPress` no-op (`index.tsx`, `AwaitingPaymentBody`); passa a navegar.

Ciclo de vida da tela:

- **Loading:** no mount chama `POST /me/box/checkout` (idempotente). Enquanto
  resolve, mostra `CaixaSkeleton` (ja usado no caixa/\*). Diferente do cart, que
  navega com o `brCode` ja em maos; aqui o checkout roda depois de montar.
- **Pagando:** renderiza QR + copia-e-cola + valor + contagem regressiva ate
  `expiresAt`. Reusa so o componente ja compartilhado `HiddenQR` + `expo-clipboard`;
  **nao** extrai componente novo do cart nem mexe na tela do cart (duplica o markup
  minimo; `CLAUDE.md`: simples primeiro, nao tocar codigo alheio).
- **Polling:** `GET /me/box` com intervalo base fixo e backoff apos ~30s (espelha
  a mecanica do `useOrderStatus` do cart), com estado de erro proprio (`GET` falha
  -> banner "reconectar", nao trava). Sem push/websocket (arquitetura REST +
  polling; push de box e Fase 5).
- **Sucesso vs trim (distincao critica):** o worker de cutoff tambem leva o box a
  `ready`/`skipped` sem pagamento (trim budget-only) e **nula `box.orderId`**. Logo
  o polling nao pode tratar todo `ready` como "pago". Regra: `ready` com `orderId`
  ainda setado -> sucesso de pagamento ("caixa a caminho"). `ready`/`skipped` com
  `orderId` nulo -> caixa fechada no cutoff (budget-only), nao "pago". Copy e
  navegacao diferentes por caso.
- **Expirado:** contagem chega a zero (ou checkout devolve `box_locked`) -> estado
  "prazo encerrado" com o que aconteceu com a caixa, distinto de erro generico.
- **`chargeCents === 0`** continua indo direto pra `ready` (inalterado).

Mapeamento de erro do checkout (todos os codigos da Unidade 1):

- `box_locked` / `box_not_awaiting` -> volta pra home com feedback (caixa fechou).
- `box_not_eligible` / `box_not_open` -> volta pra home (estado de leitura/erro),
  igual o `mapConfirmError` ja trata o 404 como `not_found`.
- `payment_unavailable` (503) / upstream (502) -> banner de retry na propria tela.

Copy: substitui `caixaCopy.awaiting.comingSoon` pelo conjunto Pix real (PT-BR):
titulo, instrucao, botao copiar/copiado, prazo, sucesso ("sua caixa esta a
caminho"), fechada-no-cutoff, expirado, erro/reconectar. Enumerar no
`caixaCopy.pay` (novo namespace).

### Superficie compartilhada (packages/shared)

- `BoxView` ganha **so** `orderId: string | null`. O `brCode`/expiry vem da
  resposta do checkout, nao do `BoxView` (view enxuta; resume re-chama o checkout
  idempotente). Atualizar `boxViewSchema` + `serialize.ts` + fixture + teste.
- Novo `boxCheckoutResponseSchema` em `packages/shared/src/box.ts`.

### Cliente mobile (apps/mobile)

Arquivos tocados (a lista completa, pra nao subcontar o escopo):

- Novo `src/api/box.ts` -> `checkoutBox(): Promise<BoxCheckoutResponse>`.
- Novo hook fino de pagamento (espelha `useBoxConfirm`): dispara checkout, mapeia
  erros; hook/helper de polling do status.
- Nova tela `app/(app)/caixa/pagar.tsx`.
- **Editar** `app/(app)/caixa/revisar.tsx`: `onConfirm` ramifica pra `/caixa/pagar`
  quando `chargeCents > 0` (hoje `router.replace('/caixa')` incondicional).
- **Editar** `app/(app)/caixa/index.tsx` (`AwaitingPaymentBody`): tira `disabled`
  do "Retomar pagamento" e navega pra `/caixa/pagar`.
- **Editar** `src/copy/caixa.ts`: novo namespace `pay`; remove `awaiting.comingSoon`.
- Helper puro `.ts` de mapeamento de erro + de distincao ready/trim (via `orderId`),
  testavel sem render.

## Corridas e residual (honesto)

O expiry do Pix **nao** e prova de que ninguem paga pos-cutoff. Duas razoes:

1. O worker de cutoff roda a cada 1 min (`cron('* * * * *')`); o box fica
   `awaiting_payment` ate ~60s depois do `cutoffAt` real.
2. Nao ha verificacao no codigo de que a AbacatePay torna a cobranca impagavel
   depois do `expiresIn` (o cart nunca passou `expiresInSeconds`; seria a primeira
   dependencia disso). Pode ser enforcement da criacao, com folga, ou so ocultar na
   UI. **Antes do go-live: validar em sandbox da AbacatePay** que pagar apos o
   expiry falha. Ate la, tratar como best-effort.

A rede de seguranca real e o settle (ver Invariantes + Unidade 2): so liquida
Order `pending`; Order cancelado no cutoff nunca vira `paid`, vira
`flagManualRefund`. Entao o pior caso e um pagamento que entra apos o cancelamento:
dinheiro recebido, box ja budget-only, refund manual pendente. Sem refund
automatico em 4a (AbacatePay nao tem refund API; e 4c). **Dimensionar isso como
operacao manual real**, nao teorica: cada corrida ganha vira um Pix devolvido a
mao. `flagManualRefund` ja emite o sinal (Sentry).

Residual conhecido herdado: nao existe worker de reconciliacao Pix varrendo
cobrancas orfas (o roadmap de pagamentos ja registra isso pro Stripe/assinatura).
Um `transparent.completed` perdido deixa Pix pago com Order pendente ate o cutoff
cancelar. Quando esse worker generico existir, tem que varrer Order `kind:'box'`
tambem.

Outros casos:

- **Re-checkout:** cobranca ativa reusada sob o lock (idempotente). Duplo-clique
  nao cria duas cobrancas (Fases A/C serializadas na `Garage`).
- **Webhook duplicado:** `PaymentWebhookEvent` deduplica; settle re-checa status.
- **AbacatePay fora do ar:** checkout falha com retry; reserva de estoque intacta.
- **Sem push:** 4a nao manda push de "pago" (so polling); push de box e Fase 5.
  Consistente com como Order `product` ja e tratado no webhook (sem push).

## Testes

Integracao da API em Postgres real (Testcontainers), fake AbacatePay:

- checkout cria cobranca, carimba `providerRef`/`brCode`, retorna `brCode`.
- checkout reusa cobranca ativa (idempotente); nao duplica.
- checkout calcula `expiresInSeconds` a partir do `cutoffAt`.
- checkout `409 box_locked` pos-cutoff e dentro da margem minima; `409
box_not_awaiting` quando o Order nao esta `pending`.
- checkout `503 payment_unavailable` quando o provider nao esta configurado.
- checkout nao carimba se o Order deixou de ser `pending` entre as fases (simular
  cancelamento do worker entre A e C); retorna `box_locked`.
- webhook liquida: Order -> `paid`, box -> `ready`, idempotente em replay.
- settle so vira `paid` se `pending`: Order cancelado no cutoff **nao** vira
  `paid`; dispara `flagManualRefund`.
- settle com segundo `providerRef` distinto num Order ja `paid` -> `flagManualRefund`
  (pagamento em dobro), nao no-op silencioso.
- unit puro: math de `expiresInSeconds`; distincao ready-pago vs trim (via `orderId`).
- shared: fixture do `boxViewSchema` com `orderId`.
- mobile: helper de mapeamento de erro do checkout + helper ready/trim (`.ts` puro)
  - hook (jsdom).

## O que 4a NAO faz

- Fulfillment (status, rastreio, timeline tela 09, rotas admin de box) — 4b.
- Refund + tratamento de pagamento tardio alem do expiry — 4c.
- Stripe/Apple Pay pra box — box dark no iOS.
- Flip do flag `EXPO_PUBLIC_CAIXA_ENABLED` — config, apos QA manual do fluxo.
