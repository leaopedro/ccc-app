# Fase 0 — Correções de billing antes de qualquer dinheiro real

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Bloqueia:** `2026-08-12-stripe-live-web-design.md`

## Por que este documento existe

A primeira versão do Spec A afirmava que o go-live era só operação, porque o
código já existia. Quatro revisões adversariais derrubaram isso. O caminho de
assinatura tem defeitos que ninguém sente hoje porque nada é real.

Nenhuma cobrança real acontece antes desta fase fechar.

Tudo abaixo foi confirmado no código, com arquivo e linha. Nada aqui é
suposição.

## C1 — Cancelamento não chega ao banco

`apps/api/src/services/stripe/index.ts:325-330` monta o evento do webhook
devolvendo apenas `id`, `type` e `data.object`. O `previous_attributes` é irmão
de `data.object` no envelope da Stripe e é descartado ali.

`apps/api/src/services/billing/normalize-stripe.ts:194` então faz
`sub.previous_attributes ?? {}`, lendo de dentro do objeto, onde a Stripe nunca
põe. Em produção `prev` é sempre `{}`, e todo `customer.subscription.updated`
normaliza para `null`.

`POST /api/me/premium/cancel` chama a Stripe e deliberadamente não escreve no
banco, confiando no webhook. O membro cancela, a Stripe registra, e o app segue
mostrando assinatura ativa. Isso gera chargeback.

Mesma raiz derruba pausa administrativa e troca de tier. O worker de
reconciliação converge o cancelamento perto do fim do período, mas não converge
os outros dois.

**Correção:** carregar `previous_attributes` através do seam `WebhookEvent` e
lê-lo de `event.data.previous_attributes`. Um teste de integração por
discriminador, usando o envelope real. Os fixtures atuais codificam o mesmo
erro, aninhando `previous_attributes` dentro de `data.object`, então precisam
ser refeitos junto.

## C2 — A ativação pode nunca acontecer, dependendo da versão de API

`normalize-stripe.ts:93` faz `if (!invoice.subscription) return null;`. A linha
95 lê `invoice.lines.data[0]?.price`. A linha 327 faz `if (!charge.invoice)`.

O normalizador faz cast para tipos escritos à mão, então o TypeScript não
reclama. Mas o SDK fixado é `stripe@22.1.0` com `2026-04-22.dahlia`, e nessa
faixa `Invoice` não tem `subscription` no topo (mudou para
`parent.subscription_details.subscription`), `InvoiceLineItem` não tem `price`
(virou `pricing`), e `Charge` não tem `invoice`. Confirmado: `grep invoice`
em `node_modules/stripe/esm/resources/Charges.d.ts` retorna zero.

O que decide o comportamento em runtime é a versão de API com que **cada
endpoint de webhook** renderiza o payload, não a do SDK. O endpoint de test
atual foi criado antes e renderiza a forma antiga. Endpoint novo nasce na
versão corrente da conta.

Se o endpoint live nascer na versão nova: `invoice.paid` normaliza para `null`,
o handler marca como processado, responde 200, a Stripe nunca reenvia. Cartão
cobrado, `PremiumMembership` inexistente. Os irmãos do mesmo defeito são
`invoice.payment_failed`, que nunca aplica `past_due`, e `charge.refunded`, que
nunca marca a invoice como reembolsada.

**Correção, em duas partes.** Primeiro, ler no dashboard a versão de API do
endpoint de test e criar os endpoints live fixados na mesma versão. Isso é
leitura de trinta segundos e é gate do go-live. Segundo, tornar o normalizador
tolerante às duas formas: `invoice.subscription ?? invoice.parent?.subscription_details?.subscription`,
`line.price ?? line.pricing?.price_details?.price`, e o caminho equivalente
para `charge`. Um fixture por tipo de evento capturado de uma entrega real na
versão nova.

## C3 — Pedido de carrinho pago após expirar é cobrado e descartado

`apps/api/src/routes/stripe-webhook.ts:114-130`: quando não há pedido
`pending` nem `paid` para o `cartId`, o handler responde
`{ ok: true, ignored: true }` e ninguém é avisado.

`ORDER_EXPIRY_MS` é 15 minutos (`services/orders/expire.ts:5`), mas a Checkout
Session vive pelo menos 30 (`cart.ts:708-710`). Se a varredura expirar o pedido
e o comprador pagar dentro da sessão ainda válida, o dinheiro entra e não existe
pedido. Sem refund, sem Sentry.

O caminho de pedido único trata isso corretamente em
`stripe-webhook.ts:452-465`, com refund automático. O caminho de carrinho, que
é o fluxo principal da web, não.

**Correção:** no ramo sem pendente e sem pago, procurar pedidos do carrinho em
`expired` ou `failed`. Havendo, reembolsar a PaymentIntent e alertar no Sentry.
Nunca responder `ignored` para um `cartId` que tem pedidos.

## C4 — Refund de carrinho não marca pedido nem revoga ingresso

`stripe-webhook.ts:324-327` busca o pedido por
`{ provider: 'stripe', providerRef: piId }`. Pedido de carrinho nunca recebe
`providerRef`: `cart.ts:741` só grava se `session.paymentIntentId` existir, e
uma Checkout Session em modo `payment` nasce com `payment_intent: null`. Os
caminhos de liquidação reforçam com `...(order.cartId ? {} : { providerRef })`
(`services/orders/settle.ts:64`, `services/tickets/issue.ts:265,325,490`).

Resultado: refund sai, o pedido segue `paid`, o ingresso segue `valid`.
`revokeTicketsForRefundedOrder` nunca é alcançado.

**Correção:** gravar `providerRef = piId` no primeiro pedido do carrinho durante
`handleCartPaymentSucceeded`, e adicionar busca por `cartId` no ramo de
`charge.refunded`, espelhando o que `checkout.session.completed` já faz.

## C5 — Disputa e chargeback não existem no código

`rg -c "dispute" apps/api/src/routes/stripe-webhook.ts` retorna zero. Não há
`charge.dispute.created` em lugar nenhum do caminho Stripe. A AbacatePay, em
contraste, trata `transparent.disputed`.

Ingresso disputado segue válido e a pessoa entra no evento. Invoice de
assinatura disputada deixa a membership ativa.

**Correção:** assinar `charge.dispute.created` e `charge.dispute.closed` no
endpoint de avulso. No `created`, alertar no Sentry com tag própria e revogar o
ingresso. Revogar entitlement de assinatura pode ser ação manual do admin, mas
o alerta tem que existir.

## H1 — Descritor de fatura nunca é setado

Nem `createPaymentIntent`, nem `createCheckoutSession`, nem
`createSubscriptionCheckoutSession` setam `statement_descriptor` ou
`statement_descriptor_suffix` (`services/stripe/index.ts:265-437`).

A conta é pessoa física. Cliente brasileiro que vê nome desconhecido na fatura
contesta, o que alimenta C5 diretamente. `docs/stripe.md:16` ainda configura
`JDM PREMIUM`.

**Correção:** definir o descritor da conta como `CASA CAR CLUB` no dashboard
antes da primeira cobrança live. Verificar na fatura real do smoke.

## H2 — Linhas de test mode ficam órfãs após a virada

Produção rodou inteira em modo test, então existem linhas apontando para
objetos de test. Nada as purga.

- `PremiumMembership.providerCustomerRef` com `cus_` de test: as duas mints de
  portal em `me-premium.ts:97-101` e `:256-259` não têm try/catch. Sob chave
  live a Stripe levanta `resource_missing`, virando 500 não tratado. O usuário
  nunca mais consegue assinar. `GET /status` trata, então a falha é
  inconsistente por endpoint.
- `Order.providerRef` com `pi_` de test: `orders.ts:690` chama
  `retrievePaymentIntent` sem guarda. `GET /orders/:id/resume` fica 500 para
  sempre.
- `PremiumMembership.providerSubRef` com `sub_` de test: o worker de
  reconciliação lança, o catch por linha loga e segue, e a linha nunca expira.
  Entitlement premium vitalício sem assinatura por trás, silencioso por
  construção.

**Correção:** migração que expira as memberships com refs de test, limpa
`Garage.premiumTier` e `premiumUntil` correspondentes, e expira os pedidos
`pending`. Try/catch nas três chamadas desprotegidas. Isso vira o passo zero da
ordem de execução do Spec A.

Junto: nem `Order` nem as tabelas de billing têm campo `livemode`, e
`routes/admin/finance.ts:296` agrega tudo sem filtro. O primeiro relatório de
receita real incluiria dinheiro falso. Marcar ou arquivar as linhas
pré-cutover.

## H3 — A flag descarta eventos sem persistir

`stripe-billing-webhook.ts:192-198` retorna antes do insert de
`SubscriptionWebhookEvent`. Com `GROWTH_PREMIUM_BILLING_ENABLED=false` o evento
some, a Stripe marca como entregue, e não há replay.

Isso torna impossível fazer smoke de assinatura antes de virar a flag, que era
exatamente a ordem que o Spec A propunha.

**Correção:** mover o gate para depois do insert, e responder 503 em vez de 200,
para a Stripe reentregar quando a flag ligar.

## H4 — Chave de idempotência do carrinho replica sessão morta

`cart.ts:727` usa `cart_checkout_${cart.id}_v${cart.version}`. Em
`payment_intent.payment_failed`, `handleCartFailure` devolve o carrinho para
`open` sem incrementar `version` (`stripe-webhook.ts:270-273`). O cliente tenta
de novo, a Stripe replica a resposta original por 24 horas, e ele cai numa
página de checkout já consumida.

Perda de receita, não perda de dinheiro.

**Correção:** incrementar `cart.version` dentro de `handleCartFailure`.

## H5 — Evento envenenado dá 503 por três dias e some

`stripe-billing-webhook.ts:283-297` responde 503 sempre que existe linha com
`processedAt: null`. Se o apply lançar de forma determinística, toda retentativa
cai aí, e após cerca de três dias a Stripe desiste. O evento se perde com um
warning.

**Correção:** contar retentativas na linha. Passando de N, escalar para Sentry
em nível fatal com tag própria, mantendo o 503.

## Observabilidade

`docs/observability.md:55-63` limita a regra 2 a
`transaction:POST /stripe/webhook`. Os outros dois endpoints não têm alerta
nenhum. Estender para os três.

Falta também caminho de recuperação para membership. Para ingresso existe
`POST /admin/tickets/grant`. Para assinatura não existe endpoint de criação, e o
Spec A descrevia a recuperação como manual sem dizer qual é o manual. Ou um
caminho de concessão manual, ou procedimento escrito no `observability.md`.

E não existe ferramenta de reembolso para suporte: `app.stripe.refund` só é
chamado de ramos automáticos, sem endpoint nem tela. A AbacatePay, conforme
`plans/jdma-260-abacatepay-refund-api-path.md`, não tem API de refund
documentada. Nomear o fluxo, mesmo que seja "dashboard da Stripe na mão, Pix via
suporte do fornecedor", e dizer quem executa.

## Fora de escopo

Reembolso parcial continua ignorado de propósito
(`stripe-webhook.ts:340-352`), com a atribuição por item de linha declarada fora
de escopo. Hoje isso funciona por acidente, porque carrinho gera um único
`Order` e o refund parcial acaba sendo integral. Confirmar antes do go-live e
registrar que é acidental.

## Verificação

Testes de integração contra Postgres real via Testcontainers, conforme
CLAUDE.md, para: cancelamento refletindo no banco, ativação nas duas formas de
invoice, refund de carrinho revogando ingresso, pedido expirado sendo
reembolsado, e disputa alertando.

Nenhum desses casos é coberto hoje, e os fixtures existentes codificam as formas
erradas, então eles são refeitos junto.
