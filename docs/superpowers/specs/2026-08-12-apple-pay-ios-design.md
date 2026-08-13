# Spec B — Apple Pay no iOS

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Depende de:** `2026-08-12-stripe-live-web-design.md`, concluído e com smoke passado

## Objetivo

Receber pagamentos dentro do app iOS via Apple Pay, tanto avulso (ingressos e
loja) quanto assinatura recorrente, usando Stripe nativo.

Isso reverte o canon §F8.16, que hoje proíbe qualquer traço de Stripe no bundle
iOS.

## Escopo

Dentro:

- Caminho de pagamento nativo com `PaymentSheet` e Apple Pay para carrinho,
  assinatura e retomada de pedido pendente.
- Remoção do isolamento iOS: gate no `StripeProvider`, regra de lint, teste de
  isolamento.
- Endpoints de intent nativo na API.
- Preparação da submissão à App Review.

Fora:

- Google Pay no Android. Sai quase de graça junto do `PaymentSheet`, mas não é
  o pedido. Fica para depois.
- Remoção do RevenueCat. Ver "Plano B".
- Botão `PlatformPayButton` dedicado. Ver "Decisões".

## Contexto

O app iOS está só em TestFlight. Nunca passou por App Review completo. A
primeira submissão vai carregar o app inteiro **e** o pagamento externo ao
mesmo tempo.

O cert de Apple Pay para `merchant.com.casacarclub.app` já está provisionado e
ativo na Apple e na Stripe, dormente, com validade até 2028-09-04.

Estado atual do código:

- `apps/mobile/app/_layout.tsx:203` gateia `StripeProvider` em
  `Platform.OS !== 'ios'`.
- `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`, registrado no
  `eslint.config.js`, proíbe tokens Stripe em código iOS.
- `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts`
  trava isso em teste.
- O carrinho, mesmo no Android, faz `Linking.openURL` na página hospedada da
  Stripe. Não existe caminho nativo no carrinho.
- `apps/mobile/app/(app)/profile/orders.tsx` já usa `PaymentSheet` para retomar
  pedido pendente, gateado em não-iOS.
- `apps/mobile/src/screens/assinaturas/checkout.ts` centraliza o branch de
  plataforma e devolve `ios_unsupported`.

## Base legal do pagamento externo

Regra 3.1.5(a) da App Store: bens físicos e serviços consumidos fora do app
**não podem** usar IAP. A assinatura do CCC entrega box física mensal
(`PremiumPlan.monthlyBoxBudgetCents`), serviços prestados por fornecedores
terceiros (`PremiumAddonModule.vendorName`, `payoutAmountCents`) e acesso ao
espaço e a eventos presenciais.

**Risco declarado.** A assinatura também destrava perks dentro do app. Isso dá
ao revisor margem para exigir IAP. Não é determinístico, é discricionário. A
mitigação é a seção "Plano B".

## Arquitetura

### API

**Invariante preservada.** Nenhum pedido e nenhuma membership muda de estado
por chamada do cliente. Continua só por webhook verificado. O caminho nativo
entrega ao app um segredo para confirmar pagamento, nada além disso. Se o app
confirmar e morrer antes de voltar, o webhook liquida igual.

**1. Avulso nativo.** `POST /api/cart/checkout` ganha um campo `flow`, com
valores `hosted` e `native`, default `hosted`. A web permanece idêntica.

Com `flow: native` e método `card`, o handler cria um PaymentIntent em vez de
uma Checkout Session, com a mesma metadata que o webhook já espera (`cartId`,
`userId`, ids e tipos de pedido), grava `providerRef` no primeiro pedido, e
devolve `clientSecret` com `checkoutUrl: null`.

Nenhuma mudança no webhook: `apps/api/src/routes/stripe-webhook.ts` já trata
`payment_intent.succeeded` e `payment_intent.payment_failed` com metadata
`cartId`. O campo `clientSecret` já existe como nullable no
`beginCheckoutResponseSchema`. O contrato foi previsto e nunca foi ligado.

Pix ignora `flow`. Já é nativo hoje e não muda.

**2. Assinatura nativa.** Endpoint irmão de `POST /api/me/premium/checkout`,
que não cria Checkout Session. Reusa o customer, cria a Subscription direto com
`payment_behavior: default_incomplete`, e devolve o client secret da primeira
invoice para o `PaymentSheet` confirmar.

A ativação continua vindo do handler de `invoice.paid` que já existe. Requisito
crítico: replicar na Subscription a metadata que hoje é posta na Checkout
Session. Sem ela o webhook não resolve o `garageId`, recusa a invoice, e o
membro paga sem receber assinatura.

**3. Serviço e fake.** Método novo em `apps/api/src/services/stripe/index.ts` e
o espelho correspondente em `fake.ts`, senão a suíte não roda.

### Duplicidade de assinatura

Criar a Subscription fora da Checkout Session remove a proteção implícita
contra duplicidade que a sessão dava. Dois toques, ou um retry após erro de
rede, podem gerar assinatura dobrada.

Fechamento: chave de idempotência derivada de garagem, plano e conjunto de
add-ons, mais guarda que recusa quando já existe membership `active`,
`cancel_scheduled` ou incompleta. Coberto por teste de integração contra
Postgres real, conforme CLAUDE.md.

### Mobile

**Remoção do isolamento iOS.**

- Cai o gate em `app/_layout.tsx:203`. `StripeProvider` monta em toda
  plataforma nativa.
- Cai `no-stripe-on-ios.cjs` e o registro no `eslint.config.js`.
- Cai `ios-stripe-isolation.test.ts`.
- O canon §F8.16 em
  `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` é reescrito
  como **superseded**, com data e motivo. Não é apagado: explica decisões
  antigas e vai ser lido de novo.

**Merchant identifier em todas as variants.** Hoje `app.config.ts` só preenche
`stripeMerchantIdentifier` quando a variant é `production`. Consequência: build
de dev e de preview não testam Apple Pay, e a primeira execução real seria na
build de loja. Passa a preencher sempre.

Isso exige, no portal da Apple, habilitar o merchant ID
`merchant.com.casacarclub.app` também nos App IDs `.dev` e `.preview`, e
regerar os provisioning profiles no EAS. É trabalho de credencial, precede
qualquer teste, e não é código.

**Telas.**

| Tela                       | Hoje                           | Depois                              |
| -------------------------- | ------------------------------ | ----------------------------------- |
| Carrinho, nativo           | `Linking.openURL` na Stripe    | `flow: native` + `PaymentSheet`     |
| Carrinho, web              | `redirectToStripeCheckout`     | inalterado                          |
| Assinatura (`checkout.ts`) | devolve `ios_unsupported`      | caminho nativo                      |
| `ContratarScreen`          | aviso "contrate na web" no iOS | sem aviso                           |
| `profile/orders.tsx`       | `PaymentSheet` gateado não-iOS | sem gate, com Apple Pay configurado |

**3DS.** Cartão brasileiro cai em autenticação com frequência bem acima da
média. O `PaymentSheet` resolve nativamente, mas exige `returnURL` com o scheme
do app. Sem isso o retorno da autenticação se perde e o pagamento fica
pendurado. Só aparece em teste com cartão real.

## Decisões

**Uma configuração de `PaymentSheet`, sem botão dedicado.** O `PaymentSheet` já
apresenta Apple Pay como opção nativa quando configurado. Um `PlatformPayButton`
separado seria um segundo caminho de código com a mesma conversão.

**RevenueCat fica dormente.** Nada é apagado. A rota de webhook segue
registrada atrás da flag, o SDK segue no repo, `initRevenueCat` segue sem ser
chamado. Ganha comentário no topo marcando como plano B, com a data desta
decisão.

## Plano B

Se a App Review citar a assinatura, a resposta imediata não exige binário novo.

A tela de assinatura já depende de `GROWTH_PREMIUM_BILLING_ENABLED` no
servidor: com a flag desligada a API devolve 503 e o app não oferece
contratação. Este spec trata isso como **requisito explícito, com teste**, em
vez de coincidência.

Resposta a uma rejeição, em ordem: desligar a variável no Railway, responder ao
revisor, e só então decidir se o caminho RevenueCat vale ser completado.

O avulso não corre esse risco. Ingresso de evento presencial e produto físico
da loja são isentos de IAP com clareza.

## Verificação

| Camada    | Como                                                             |
| --------- | ---------------------------------------------------------------- |
| API       | Integração contra Postgres real via Testcontainers               |
| Mobile    | vitest com o SDK da Stripe mockado                               |
| Apple Pay | Manual, aparelho físico, cartão real na carteira, Stripe test    |
| Plano B   | Teste automatizado: flag off ⇒ assinatura não é oferecida no iOS |

Apple Pay não roda em simulador nem em CI. É teste manual com roteiro escrito.

## Submissão à App Review

Vai junto:

- Nota de review invocando 3.1.5(a), listando box física mensal, serviços de
  fornecedores terceiros, e acesso a espaço e eventos presenciais.
- Conta de teste com assinatura ativa e um evento com ingresso disponível.
  Revisor que não alcança a tela rejeita por isso.

## Ordem de execução

1. Spec A concluído, smoke passado, flag ligada.
2. Credenciais Apple: merchant ID nos App IDs `.dev` e `.preview`, profiles
   regerados no EAS.
3. API: `flow: native` no carrinho, endpoint de assinatura nativa, guarda de
   duplicidade.
4. Mobile: remoção do isolamento, `PaymentSheet` nas três telas.
5. Teste manual de Apple Pay em aparelho, Stripe em test mode.
6. Submissão.
