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

## 0. Antes de tudo: a versão de API dos endpoints

**Ler a versão de API do endpoint de webhook existente no dashboard e criar todo
endpoint novo fixado na mesma versão.**

> **Conta nova não tem endpoint antigo para copiar.** A migração para o CNPJ,
> decidida em 2026-08-14, cria uma conta do zero, e endpoint novo nasce na versão
> corrente da Stripe, que é mais nova que a fixada aqui. Nesse caminho o
> descasamento abaixo deixa de ser possibilidade e vira o caso provável: fixe
> explicitamente cada endpoint em `2026-04-22.dahlia` no momento da criação.

O motivo não é preferência. O normalizador em
`apps/api/src/services/billing/normalize-stripe.ts` lê a invoice na forma em que
`subscription` fica no topo do objeto e a linha traz o `price` expandido, com
`metadata` e `recurring`. Em versões mais novas a Stripe move o vínculo para
`parent.subscription_details.subscription` e a linha passa a trazer só o id do
preço em `pricing.price_details.price`. Nessa forma o `devFeePercent` e a
cadência simplesmente não estão no payload, então não existe remapeamento de
campo que resolva.

Endpoint novo nasce na versão corrente da conta, não na do SDK. Se ele render a
forma nova, o handler não consegue ler a invoice. Ele não vai fingir que leu: a
Fase 0 fez esse caminho responder 503 com alerta fatal e sem marcar o evento
como processado, para a entrega sobreviver até a versão ser corrigida. Mas isso é
rede de segurança, não substituto da configuração.

O SDK está fixado em `stripe@22.1.0` com `apiVersion: '2026-04-22.dahlia'`
(`apps/api/src/services/stripe/index.ts`).

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

## 6. Impostos: o que este documento NÃO diz

A versão anterior mandava configurar tax code `txcd_20030000` (SaaS) com tax
behavior inclusive, e afirmava que o Stripe Tax funcionaria porque o Checkout
coleta endereço de cobrança. As duas coisas são falsas aqui.

Nenhum criador de sessão no código seta `billing_address_collection` nem
`automatic_tax` (`apps/api/src/services/stripe/index.ts`). E o CCC vende
majoritariamente bem físico e serviço presencial, não SaaS.

Stripe Tax e, principalmente, emissão de nota fiscal são decisões do contador,
registradas como pendência aberta no Spec A. Stripe Tax calcula imposto; não
emite documento fiscal brasileiro.
