# Spec A — Stripe live na web

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Subprojeto irmão:** `2026-08-12-apple-pay-ios-design.md` (executar depois deste)

## Objetivo

Passar a receber pagamentos reais no `app.casacar.club`: cartão avulso via
Stripe, Pix avulso via AbacatePay, e assinatura recorrente via Stripe.

Hoje produção roda inteira em modo test. Nenhuma cobrança real aconteceu.

## Escopo

Dentro:

- Cartão avulso (carrinho de ingressos e loja) via Stripe Checkout hospedado.
- Pix avulso via AbacatePay.
- Assinatura recorrente (planos Bronze/Silver/Gold e add-ons) via Stripe.

Fora:

- Stripe Tax. Ver "Questões abertas".
- Qualquer pagamento dentro do app iOS. É o Spec B.
- Mudança de arquitetura. O código já existe e não muda.

## Contexto

Infra de produção já no ar com domínio próprio: API no Railway em
`api.casacar.club`, admin na Vercel, app web em `app.casacar.club`.

A conta Stripe é a conta pessoal do Pedro, já operante. Não há onboarding
novo. Os produtos "JDM Premium Gold" existentes no modo test não migram.

`docs/stripe.md` e `docs/revenuecat.md` descrevem a configuração da JDM
Experience: produtos, domínios e URLs de webhook todos errados para o CCC.
Serão reescritos como parte deste spec.

## Arquitetura

Nenhuma mudança. Registro dos pontos load-bearing que a operação precisa
respeitar, porque errar qualquer um deles causa dano com dinheiro real.

**Dois webhooks distintos, com secrets distintos.**

Os paths não seguem um padrão único. Foram conferidos no código, não nos docs
antigos, que estão errados. Nenhum deles tem prefixo (`apps/api/src/app.ts`
registra os três sem `prefix`):

| Rota                       | Secret                          | Cobre                        |
| -------------------------- | ------------------------------- | ---------------------------- |
| `/stripe/webhook`          | `STRIPE_WEBHOOK_SECRET`         | Avulso (carrinho, ingressos) |
| `/webhooks/stripe-billing` | `STRIPE_BILLING_WEBHOOK_SECRET` | Assinatura                   |
| `/abacatepay/webhook`      | `ABACATEPAY_WEBHOOK_SECRET`     | Pix avulso                   |

**Pedido só vira `paid` por webhook verificado.** Nunca por chamada do
cliente. Handlers são idempotentes, deduplicam por id de evento do provedor,
fazem upsert por `provider_ref` e verificam assinatura em toda entrada.

**`GROWTH_PREMIUM_BILLING_ENABLED` é o interruptor do go-live.** O default no
código é `true`; a variável no Railway precisa estar `false` até o smoke
passar. Com ela desligada, rotas de assinatura devolvem 503 e o app não
oferece contratação.

## Frentes de trabalho

### 1. Configuração na Stripe, live mode

Um Product por plano (Bronze, Silver, Gold) e um por add-on (Detailing,
Workshop). Um Price recorrente mensal em BRL por produto.

Invariantes que a Stripe ou o webhook impõem:

- Todos os Prices, plano e add-on, no mesmo intervalo e na mesma moeda.
  Intervalos ou moedas misturados fazem a Stripe recusar a Checkout Session
  combinada, e a API traduz para 503.
- Metadata `devFeePercent` obrigatória em todo Price de **plano**. Omitir grava
  o split de receita como `0` na invoice e na membership, silenciosamente, e a
  linha da invoice é a fonte da verdade para sempre — nunca é re-derivada do
  env. Add-ons não precisam.
- Metadata `baseAmountCents` igual ao `unit_amount` do Price.

Portal de billing hospedado habilitado, com cancelamento ao fim do período
(mapeia para `cancel_at_period_end=true`) e histórico de invoices ligado.

### 2. Webhooks live

Registrar as três rotas acima nos respectivos dashboards, apontando para
`api.casacar.club`, com o path exato da tabela. O endpoint de billing escuta
exatamente cinco eventos:

`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `charge.refunded`.

O endpoint de avulso (`/stripe/webhook`) trata cinco eventos, conferidos no
handler: `checkout.session.completed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
Os dois de `payment_intent` já suportam carrinho multi-pedido e ficam ociosos
até o Spec B; registrá-los agora evita uma segunda passada no dashboard.

### 3. Variáveis no Railway

| Variável                         | Valor                        |
| -------------------------------- | ---------------------------- |
| `STRIPE_SECRET_KEY`              | `sk_live_...`                |
| `STRIPE_PUBLISHABLE_KEY`         | `pk_live_...`                |
| `STRIPE_WEBHOOK_SECRET`          | novo, do endpoint avulso     |
| `STRIPE_BILLING_WEBHOOK_SECRET`  | novo, do endpoint de billing |
| `ABACATEPAY_API_KEY`             | chave de produção            |
| `ABACATEPAY_WEBHOOK_SECRET`      | de produção                  |
| `ABACATEPAY_DEV_WEBHOOK_ENABLED` | `false`                      |
| `GROWTH_PREMIUM_BILLING_ENABLED` | `false` até o smoke passar   |

Nenhum valor `sk_` ou `whsec_` entra no repositório.

### 4. Catálogo no admin

Cadastrar cada `price_...` live em `/premium/catalogo`, casando tier de plano
e chave de add-on. Verificar por `GET /api/plans`.

Um `stripePriceId` vazio derruba o checkout com 503. Para add-on a resposta
inclui `missingAddonKeys`; para plano a resposta é genérica e só o log da API
diz qual tier, cadência e slug falharam.

## Ordem de execução

Não negociável, e é a razão de existir esta seção:

1. Produtos e Prices na Stripe live.
2. `price_...` cadastrados no `/premium/catalogo` e verificados por
   `GET /api/plans`.
3. Variáveis no Railway, com `GROWTH_PREMIUM_BILLING_ENABLED=false`.
4. Smoke.
5. Flag para `true`.

Invertendo 1 e 2, uma compra real pode chegar antes do catálogo existir. O
webhook então responde 200, marca o evento como processado, dispara alerta no
Sentry e **não cria a membership**. O dinheiro entrou e a assinatura não
existe. A recuperação é manual, o webhook não re-executa, e o membro não pode
ser cobrado de novo.

## Verificação

Roteiro do `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-19-smoke-and-flag.md`,
executado em produção com valor real baixo, cartão do próprio Pedro, e refund
ao final.

Um ciclo por fluxo: cartão avulso, Pix avulso, assinatura. Cada ciclo confere
o estado no banco, não só a tela: `Order.status`, `PremiumMembership`,
`PremiumMembershipInvoice`, e o registro de evento processado.

Evidência anexada antes de virar a flag.

## Documentação

- `docs/stripe.md` reescrito para Casa Car Club: produtos, domínios, URLs de
  webhook. O conteúdo atual é da JDM e induz erro de operação.
- `docs/revenuecat.md` ganha cabeçalho marcando como dormente (ver Spec B).

## Questões abertas

**Stripe Tax.** Os docs atuais mandam configurar tax code `txcd_20030000`
(SaaS) com tax behavior inclusive. Isso foi desenhado para o produto digital da
JDM. O CCC vende majoritariamente bem físico e serviço presencial. Aplicar a
mesma configuração sem revisão fiscal seria errado. Decisão fica com o contador
do Pedro, fora deste spec.
