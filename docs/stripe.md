# Stripe — configuração operacional

Como configurar a Stripe para o Casa Car Club. Isto é setup de painel, não
código. Aplicar uma vez por ambiente: test mode para preview e smoke, live mode
para produção.

Este documento substitui a versão anterior, que descrevia a JDM Experience:
produto único "JDM Premium Gold", domínios `jdm-experience.com` e um caminho de
webhook que não existe. Seguir aquele texto quebrava o go-live.

Specs relacionados: `docs/superpowers/specs/2026-08-12-stripe-live-web-design.md`
(Spec A) e `docs/superpowers/specs/2026-08-12-billing-fixes-design.md` (Fase 0).

---

## 0. A versão de API dos endpoints, e por que ela não salva

**Fixe todo endpoint novo em `2026-04-22.dahlia`. Mas não conte com isso para a
forma da invoice.**

A versão anterior deste documento chamava o pin de "gate de tudo" e afirmava que
ele preservaria a forma antiga da invoice, com `subscription` no topo do objeto e
o `price` expandido na linha. **Isso é falso, e custou uma cobrança real.**

Em 2026-08-26 o primeiro pagamento de teste entrou com os dois endpoints já
fixados em `2026-04-22.dahlia`, conferidos por API, e mesmo assim o
`invoice.paid` chegou na forma nova e caiu em `UNRECOGNIZED_SHAPE`. Cartão
cobrado, membership não criada.

Renderizando a mesma invoice em várias versões fica claro por quê:

| `Stripe-Version`                       | `subscription` no topo | `line.price` expandido |
| -------------------------------------- | ---------------------- | ---------------------- |
| `2026-07-29.dahlia` (default da conta) | não                    | não                    |
| `2026-04-22.dahlia`                    | **não**                | **não**                |
| `2025-08-27.basil`                     | não                    | não                    |
| `2024-06-20`                           | sim                    | sim                    |

A reestruturação da invoice aconteceu **antes** de `2026-04-22.dahlia`. Ou seja,
a versão que o SDK fixa e que este documento mandava usar nos endpoints já
entrega a forma nova. Nenhum pin razoável traz a forma antiga de volta.

**A correção é código, não painel.** `normalize-stripe.ts` lê as duas formas
desde então:

| campo               | forma 2026                                                   |
| ------------------- | ------------------------------------------------------------ |
| subscription        | `parent.subscription_details.subscription`                   |
| priceRef            | `lines[].pricing.price_details.price`, id puro               |
| subscriptionItemRef | `lines[].parent.subscription_item_details.subscription_item` |

Além dos três acima, o **período** também mudou de lugar, e esse foi o segundo
tropeço, encontrado no mesmo smoke: numa invoice de `subscription_create`,
`invoice.period_start` e `invoice.period_end` são **o mesmo instante**, e o
período realmente cobrado está em `lines[].period`. Ler o nível do invoice grava
um `currentPeriodEnd` já no passado, e `computeIsPremiumActive` responde
`premiumUntil > now`, então quem acabou de pagar sai como **não premium**, com
quota de add-on de duração zero. Silencioso nas duas pontas, porque
`PremiumMembership.status` continua `active`. `subscription.current_period_end`
também virou `null`; passou para `items[]`.

O único valor que a forma nova não carrega é o `devFeePercent`, porque a linha
traz só o id do preço. `stripe-billing-webhook.ts` busca o Price na Stripe para
resolver isso, e responde 503 se a busca falhar, em vez de gravar `0`: a linha da
invoice é fonte da verdade para sempre, e um zero inventado ali não tem conserto
depois.

O pin em `2026-04-22.dahlia` continua valendo como boa prática, para casar com o
`apiVersion` do SDK em `apps/api/src/services/stripe/index.ts` e evitar que uma
versão futura mude outra coisa sem aviso. Só não trate ele como defesa da forma
da invoice, porque não é.

A sentinela `UNRECOGNIZED_SHAPE` segue sendo a rede: ela recusa, responde 503,
não marca o evento como processado e alerta. Foi ela que impediu o pagamento de
2026-08-26 de virar uma membership com split zerado e tier chutado.

---

## 1. Produtos e preços

Um Product por plano (Bronze, Silver, Gold) e um por módulo de add-on. Um Price
recorrente mensal em BRL por produto.

Invariantes que a Stripe ou o webhook impõem:

| Regra                                               | Consequência de violar                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Todos os Prices no mesmo intervalo e moeda          | A Stripe recusa a Checkout Session combinada; a API traduz para 503                                                                  |
| Metadata `devFeePercent` em todo Price de **plano** | Omitir grava o split de receita como `0` na invoice e na membership, sem alerta, e a linha da invoice é fonte da verdade para sempre |
| Metadata `baseAmountCents` igual ao `unit_amount`   | Não é lido pelo webhook (que usa o catálogo do banco), mas é lido por `GET /api/premium/pricing` e pelo worker de reconciliação      |

Add-ons não precisam de `devFeePercent`.

**Descritor de fatura.** Definir o descritor da conta como `CASA CAR CLUB` antes
da primeira cobrança live. Nenhum criador de sessão ou intent seta
`statement_descriptor` no código, então vale o da conta. A conta é pessoa física:
descritor com nome pessoal em fatura de cliente gera contestação, e contestação
agora revoga ingresso automaticamente.

**Portal de billing.** Habilitar, com cancelamento ao fim do período (mapeia para
`cancel_at_period_end=true`) e histórico de invoices ligado.

---

## 2. Webhooks

Os caminhos não seguem um padrão único. Foram conferidos no código, e nenhum tem
prefixo (`apps/api/src/app.ts` registra os três sem `prefix`).

| Caminho                                     | Secret                          | Cobre                             |
| ------------------------------------------- | ------------------------------- | --------------------------------- |
| `/stripe/webhook`                           | `STRIPE_WEBHOOK_SECRET`         | Avulso: carrinho, ingressos, loja |
| `/webhooks/stripe-billing`                  | `STRIPE_BILLING_WEBHOOK_SECRET` | Assinatura                        |
| `/abacatepay/webhook?webhookSecret=<valor>` | `ABACATEPAY_WEBHOOK_SECRET`     | Pix                               |

**A AbacatePay autentica por segredo na query string, não por header.** Registrar
a URL sem `?webhookSecret=` faz toda entrega retornar 401
(`apps/api/src/routes/abacatepay-webhook.ts`).

### Eventos do endpoint de avulso

`checkout.session.completed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
`charge.dispute.created`, `charge.dispute.closed`.

Os dois de `payment_intent` já suportam carrinho multi-pedido e ficam ociosos até
o Apple Pay nativo existir. Registrar agora evita uma segunda passada no
dashboard. Os dois de `dispute` foram adicionados na Fase 0.

### Eventos do endpoint de billing

`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `charge.refunded`.

`customer.subscription.updated` é o que carrega cancelamento, pausa e troca de
tier. Ele depende de `previous_attributes`, que a Stripe entrega como irmão de
`data.object`. Não remover esse evento da assinatura pensando que é ruído.

---

## 3. Variáveis de ambiente

| Variável                            | Onde          | Notas                                 |
| ----------------------------------- | ------------- | ------------------------------------- |
| `STRIPE_SECRET_KEY`                 | Railway       | `sk_test_` ou `sk_live_`              |
| `STRIPE_PUBLISHABLE_KEY`            | Railway + EAS | `pk_test_` ou `pk_live_`              |
| `STRIPE_WEBHOOK_SECRET`             | Railway       | Endpoint de avulso                    |
| `STRIPE_BILLING_WEBHOOK_SECRET`     | Railway       | Endpoint de billing, secret distinto  |
| `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` | Railway       | Load-bearing, ver abaixo              |
| `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL`  | Railway       | Load-bearing, ver abaixo              |
| `ABACATEPAY_API_KEY`                | Railway       |                                       |
| `ABACATEPAY_WEBHOOK_SECRET`         | Railway       | Vai também na query string do webhook |
| `ABACATEPAY_DEV_WEBHOOK_ENABLED`    | Railway       | `false` em produção                   |
| `GROWTH_PREMIUM_BILLING_ENABLED`    | Railway       | Interruptor do go-live                |

**Armadilha nas duas variáveis de preço gold.** Para o tier gold, se o
`stripePriceId` do catálogo estiver vazio, `me-premium.ts` cai silenciosamente no
preço do env. Deixadas com valores de test sob chave live, um checkout de gold é
montado com preço de test. Elas também são obrigatórias para
`GET /api/premium/pricing`, que alimenta a página `/premium` do admin.

**Sobre `GROWTH_PREMIUM_BILLING_ENABLED`.** Default `true` no código, precisa
estar `false` no Railway até o smoke de avulso passar. Ela é global, não por
plataforma, e também silencia o worker de reconciliação. Com ela desligada o
webhook de billing **grava** o evento e responde 503, então nada se perde na
janela antes da virada.

O que faz esse evento guardado aplicar depois é o ramo de duplicata tratar
linha não processada com mais de 60 segundos como abandonada e adotá-la. Sem
isso, guardar não serviria de nada: a Stripe reentrega com o mesmo id, cairia
sempre no mesmo 503 e a linha ficaria inalcançável. Esse detalhe foi corrigido
depois de revisão, e a implicação prática está no Runbook 5 de
`docs/observability.md`: espere um minuto antes de reentregar à mão.

Nenhum valor `sk_` ou `whsec_` entra no repositório. Considerar chave restrita em
vez de `sk_live` de acesso total, dado que a conta é compartilhada com outro
negócio.

---

## 4. Catálogo no admin

Cadastrar cada `price_...` em `/premium/catalogo`, casando tier de plano e chave
de add-on. Verificar com `GET /api/plans`.

Campo vazio derruba o checkout com 503. Para add-on a resposta traz
`missingAddonKeys`; para plano a resposta é genérica e só o log da API diz qual
tier, cadência e slug falharam. Para gold, ver a armadilha do fallback acima.

---

## 5. Cartões de teste

| Número                | Comportamento |
| --------------------- | ------------- |
| `4242 4242 4242 4242` | Aprovado      |
| `4000 0025 0000 3155` | Exige 3DS     |
| `4000 0000 0000 9995` | Recusado      |

Qualquer validade futura, qualquer CVC.

---

## 6. Checkout nativo (PaymentSheet)

Duas rotas mintam um `clientSecret` para o app confirmar direto no
`PaymentSheet`, sem redirecionar para uma Checkout Session hospedada.

| Rota                                                | Mint                                                                              | Ativa quando                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `POST /cart/checkout` com `flow: 'native'` no corpo | `createPaymentIntent` (avulso, multi-pedido)                                      | `payment_intent.succeeded` no endpoint de avulso |
| `POST /api/me/premium/checkout-native`              | `createNativeSubscription` (assinatura, `payment_behavior: 'default_incomplete'`) | `invoice.paid` no endpoint de billing            |

`flow` é `z.enum(['hosted', 'native']).default('hosted')`
(`packages/shared/src/cart.ts`); omitir o campo preserva o comportamento
hospedado de sempre. A resposta troca `checkoutUrl` por `clientSecret` quando
`flow: 'native'`, mas usa a mesma metadata do ramo hospedado — inclusive
`cartVersion`, que `handleCartPaymentSucceeded` (`stripe-webhook.ts`) lê para
recusar um PaymentSheet velho confirmado depois que o carrinho reabriu (ver
`docs/observability.md`, regra 2f).

**`receipt_email` é derivado do servidor, nunca do corpo da requisição.** O
checkout nativo de carrinho busca o e-mail do `sub` autenticado
(`prisma.user.findUnique`) e só inclui `receiptEmail` na PaymentIntent quando
esse e-mail existe — o cliente não pode informar (nem sobrescrever) o
destinatário do recibo Stripe. A assinatura nativa não recebe esse mesmo
parâmetro: o e-mail já foi fixado no Customer por `findOrCreateCustomer` na
criação, e a fatura da assinatura herda dali.

A assinatura nativa nunca cria `PremiumMembership` — só a Task de webhook
(`invoice.paid`) faz isso, preservando a invariante de que o estado de
assinatura só muda por webhook verificado. Antes de mintar, a rota grava um
`PremiumSubscriptionAttempt` (`pending`) sob lock de `Garage` (mesmo padrão de
`stripe-billing-webhook.ts:754`) para colapsar toques concorrentes numa única
assinatura Stripe; ver `docs/observability.md` regra 2g para o alerta de
assinatura criada sem `confirmation_secret`.

## 7. Impostos: o que este documento NÃO diz

A versão anterior mandava configurar tax code `txcd_20030000` (SaaS) com tax
behavior inclusive, e afirmava que o Stripe Tax funcionaria porque o Checkout
coleta endereço de cobrança. As duas coisas são falsas aqui.

Nenhum criador de sessão no código seta `billing_address_collection` nem
`automatic_tax` (`apps/api/src/services/stripe/index.ts`). E o CCC vende
majoritariamente bem físico e serviço presencial, não SaaS.

Stripe Tax e, principalmente, emissão de nota fiscal são decisões do contador,
registradas como pendência aberta no Spec A. Stripe Tax calcula imposto; não
emite documento fiscal brasileiro.
