# Spec B — Apple Pay no iOS

**Data:** 2026-08-12
**Status:** aprovado, aguardando plano de implementação
**Depende de:** `2026-08-12-billing-fixes-design.md`,
`2026-08-12-stripe-live-web-design.md` com smoke passado, e
`2026-08-12-ios-review-blockers-design.md`

## Objetivo

Receber pagamentos dentro do app iOS via Apple Pay, avulso e assinatura, usando
Stripe nativo. Reverte o canon §F8.16, que proíbe qualquer traço de Stripe no
bundle iOS.

## O problema que a revisão adversarial expôs

O argumento jurídico se apoia na regra 3.1.5(a): bens físicos e serviços
consumidos fora do app não podem usar IAP. A revisão foi verificar o que o app
de fato diz e o que o banco de fato tem.

**A folha "O que é Premium?" é 100% digital.**
`apps/mobile/src/copy/garage.ts:99-106` lista quatro benefícios: capas
personalizadas, selo Premium, garagem em destaque no feed, e página pública sem
rodapé. Nenhuma menção a box, clube ou serviço de fornecedor. Essa folha é a
resposta do próprio app à pergunta que o revisor vai fazer.

**Os dois campos citados como base legal estão vazios em produção.**
`PremiumPlan.monthlyBoxBudgetCents` tem default `0` e o seed nunca o define.
`PremiumAddonModule.vendorName` é `null` e `payoutAmountCents` é `0` nos dois
módulos, deliberadamente, conforme comentário no próprio seed
(`packages/db/prisma/seed.ts:556-559,570-571`).

**A prova física é compilada para fora do binário.** O perfil `production` do
`apps/mobile/eas.json` não define `EXPO_PUBLIC_CAIXA_ENABLED`, então
`src/screens/caixa/caixa-enabled.ts:1` avalia falso e a aba da caixa nunca
renderiza (`src/navigation/caixa-slot.ts:7`).

**Os gates digitais são reais, não cosméticos.** O servidor recusa com
`premium_required` em `routes/garage.ts:262-264`. Nove de dez capas são premium
(`packages/shared/src/garage-covers.ts:32-104`). Badges exclusivos
(`services/garage/awarder.ts:112-116`). Feed de membros com leitura e postagem
pagas (`services/feed/access.ts:15-21,42-46,88-91`). O selo é serializado em todo
carro, post, comentário e evento.

Estimativa da revisão: 65 a 85 por cento de rejeição na assinatura como estava
planejado. E a nota de review invocando 3.1.5(a) **piora**, porque garante que o
revisor abra exatamente essa questão em vez de passar por ela.

## Decisão: reposicionar o produto, não a arquitetura

Aprovado em 2026-08-12. A correção mais barata não é técnica.

1. `EXPO_PUBLIC_CAIXA_ENABLED=true` no perfil `production` do `eas.json`, para
   que a aba da caixa física exista no binário submetido.
2. `monthlyBoxBudgetCents` com valor real por tier no seed e em produção.
3. `vendorName` e `payoutAmountCents` preenchidos nos módulos de add-on.
4. `apps/mobile/src/copy/garage.ts:99-106` reescrito para liderar com box
   mensal, acesso ao clube e serviços de fornecedor, com selo e capa listados
   como extras. Mesma coisa na versão em inglês (`:210-219`), que é a que o
   revisor lê.

Isso muda o que o revisor lê sem remover funcionalidade nenhuma. É copy e
configuração.

Pré-requisito honesto: os benefícios anunciados precisam existir. O spec de
bloqueadores trata os que são promessa sem implementação, e ele vem antes deste.

## Risco que a versão anterior deste spec negava

A versão anterior afirmava que o avulso não corria risco de review. Falso, por
causa de um SKU.

`packages/db/src/garage-spot-product.ts:8-11` define "Vaga de Garagem
Adicional", R$49, semeado com `virtual: true`, entregue como linha `GarageSpot`
(`services/orders/garage-fulfillment.ts:14-18`). A copy em inglês diz "+1
permanent space in your garage" e "One-time payment (not a subscription)".

Isso é desbloqueio digital não consumível, sem defesa pelo 3.1.5(a). Passa pelo
mesmo carrinho e hoje, no iOS, abre a página hospedada da Stripe sem nenhum
guard de plataforma.

Mitigante: o tile só renderiza quando `availableSlots === 0`
(`src/screens/garage/garage-slots.ts:76`), e
`GeneralSettings.defaultFreeGarageSpots` é nullable, nunca semeado, e null
significa ilimitado. Então hoje é inalcançável, a menos que um operador defina
um limite finito.

**Decisão necessária antes da submissão:** remover o SKU do catálogo no build
iOS, ou aceitar que ele é a peça mais frágil da submissão. Não deixar
indefinido.

## Arquitetura

### API

**Invariante preservada.** Nenhum pedido e nenhuma membership muda de estado por
chamada do cliente. O caminho nativo entrega ao app um segredo para confirmar
pagamento, nada além.

**1. Avulso nativo.** `POST /api/cart/checkout` ganha campo `flow`, valores
`hosted` e `native`, default `hosted`. A web permanece idêntica.

Com `flow: native` e método `card`, cria PaymentIntent com a metadata que o
webhook já espera (`cartId` e os demais), grava `providerRef` no primeiro pedido
(o que a Fase 0 passa a fazer de qualquer forma) e devolve `clientSecret` com
`checkoutUrl: null`. O webhook não muda: `routes/stripe-webhook.ts` já trata
`payment_intent.succeeded` e `payment_intent.payment_failed` por `cartId`, e
`beginCheckoutResponseSchema` já tem `clientSecret` nullable.

Duas lacunas reais em relação à Checkout Session, que a versão anterior não
listava:

- **Recibo.** A página hospedada coleta email e a Stripe envia recibo. Uma
  PaymentIntent crua não. Setar `receipt_email`.
- **Expiração.** Checkout Session tem `expires_at` e emite
  `checkout.session.expired`, que hoje libera a reserva. PaymentIntent não
  expira. Sem isso, o caso do §C3 da Fase 0 fica pior no caminho nativo. Cancelar
  a PI quando a varredura expirar o pedido, reusando o `cancelPaymentIntent` que
  já existe.

Pix ignora `flow`.

**2. Assinatura nativa.** Endpoint irmão de `POST /api/me/premium/checkout` que
cria a Subscription direto com `payment_behavior: default_incomplete` e devolve
o segredo da primeira invoice para o `PaymentSheet` confirmar. A ativação
continua vindo do handler de `invoice.paid`.

Correção factual: a versão anterior dizia que replicar metadata na Subscription
era requisito crítico. Não é. `stripe-billing-webhook.ts:489-492` resolve o
`garageId` a partir do **Customer**, e `findOrCreateCustomer` grava e atualiza
esse metadata a cada reuso. Como o caminho nativo reusa o customer, está
resolvido.

O bloqueio real é outro: `resolveLinesAgainstCatalog`
(`stripe-billing-webhook.ts:414-441`). Preço fora do `PremiumPlanPrice` faz o
handler marcar processado, alertar e devolver 200 sem criar membership.

**Incerteza fechada.** O repo fixa `stripe@22.1.0` com `2026-04-22.dahlia`.
Nessa versão `Invoice` não tem `payment_intent` no topo. O caminho é
`latest_invoice.confirmation_secret.client_secret`, expandindo
`latest_invoice.confirmation_secret`. `payment_intent` não compila.

**3. Serviço e fake.** Método novo em `services/stripe/index.ts` e espelho em
`fake.ts`.

### Duplicidade de assinatura

A versão anterior propunha chave de idempotência derivada de garagem, plano e
add-ons. **Isso está errado**, e a revisão provou o porquê.

A janela de idempotência da Stripe é de 24 horas, e `subscriptions.create`
replicado devolve a Subscription original, não uma nova. Cenário concreto: o
membro assina, cancela dentro da hora, e assina de novo o mesmo plano. Mesma
chave. A Stripe replica a assinatura cancelada e sua primeira invoice já
liquidada. O app recebe segredo de uma PaymentIntent já consumida, o
`PaymentSheet` não cobra nada, nenhuma membership nasce, e o membro acredita que
assinou.

Simetricamente, uma assinatura `incomplete` abandonada é replicada por 24 horas,
impedindo tentativa limpa. E a chave nem previne o duplicado que prometia: dois
toques com 25 horas de intervalo criam duas assinaturas.

**Correção:** chave por tentativa, não por pacote. UUID por tentativa como chave
Stripe, e a proteção contra duplicidade vindo de constraint no banco: índice
único parcial por `garageId` para status em `active`, `past_due`,
`cancel_scheduled` e `incomplete`. Teste de integração contra Postgres real,
incluindo o caso de recontratação dentro de 24 horas.

### Mobile

**Remoção do isolamento iOS.** Cai o gate em `app/_layout.tsx:203`, cai
`eslint-rules/no-stripe-on-ios.cjs` e seu registro, cai
`ios-stripe-isolation.test.ts`. O canon §F8.16 em
`docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` é reescrito
como superseded, com data e motivo, não apagado.

**Merchant identifier em todas as variants.** `app.config.ts:39` só preenche
`stripeMerchantIdentifier` quando a variant é `production`, então build de dev e
preview não testam Apple Pay. Passa a preencher sempre. Exige habilitar
`merchant.com.casacarclub.app` nos App IDs `.dev` e `.preview` no portal da
Apple e regerar provisioning profiles no EAS. Trabalho de credencial, precede
qualquer teste.

**Telas.**

| Tela                       | Hoje                           | Depois                              |
| -------------------------- | ------------------------------ | ----------------------------------- |
| Carrinho, nativo           | `Linking.openURL` na Stripe    | `flow: native` + `PaymentSheet`     |
| Carrinho, web              | `redirectToStripeCheckout`     | inalterado                          |
| Assinatura (`checkout.ts`) | devolve `ios_unsupported`      | caminho nativo                      |
| `ContratarScreen`          | aviso "contrate na web" no iOS | sem aviso                           |
| `profile/orders.tsx`       | `PaymentSheet` gateado não-iOS | sem gate, com Apple Pay configurado |

**Uma configuração de `PaymentSheet`, sem botão dedicado.** O `PaymentSheet` já
apresenta Apple Pay quando configurado.

**3DS.** Cartão brasileiro autentica com frequência acima da média. O
`PaymentSheet` resolve nativamente, mas exige `returnURL` com o scheme do app.
Sem isso o retorno se perde e o pagamento fica pendurado. Só aparece em teste com
cartão real.

## Plano B, reescrito

A versão anterior dizia que desligar `GROWTH_PREMIUM_BILLING_ENABLED` responde a
uma rejeição sem binário novo. Isso não funciona, por cinco motivos, e três deles
são graves.

**A flag é global, não por plataforma.** Consumida em
`routes/me-premium.ts:61,133,367,438,497,558` sem argumento de plataforma.
Desligar para acalmar a Apple mata assinatura na web e no Android junto, e
derruba o webhook de billing (`stripe-billing-webhook.ts:192`), ou seja, para o
processamento de renovação de quem já paga.

**Ela troca uma rejeição por outra.** Com a flag desligada a aba continua
existindo (`app/(app)/_layout.tsx:66-70`) e mostra `'Assinaturas em breve.'`
(`src/copy/assinaturas.ts:89`). Placeholder em aba primária é rejeição por
completude.

**A tela nem consulta a flag hoje.** `ContratarScreen.tsx:291` renderiza o CTA
incondicionalmente fora do iOS, e o catálogo que ela lê é explicitamente não
gateado (`routes/premium-catalog.ts:11-13`). O 503 só aparece no toque, virando
erro genérico. Ou seja, o comportamento que a versão anterior descrevia como
existente é trabalho novo.

**A flag do mobile é outra coisa e é build-time.**
`src/lib/premium-runtime.ts:9` lê `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`,
inlined no build, e nenhuma tela de assinaturas a lê. O
`extra.premiumBillingEnabled` publicado em `app.config.ts:145` não é lido por
ninguém.

**O destino do plano B está quebrado.** `src/lib/revenuecat.ts:26` define
`initRevenueCat` e nada no app o chama. `PremiumScreen.tsx:165-176` ainda
renderiza um botão `Assinar Gold` no iOS que chama `fetchOfferings()` contra um
SDK não configurado. A rota é deep-linkable. Completar esse caminho é integração
inacabada mais produtos na App Store Connect mais um segundo ciclo de review.

**Plano B correto:** um gate por plataforma, servido pela API e lido em runtime,
que remove a entrada de assinatura no iOS sem tocar em web e Android e sem
deixar aba com placeholder. Isso é requisito deste spec, com teste, e não
coincidência.

Nota de exposição: `expo-updates` está no projeto com `runtimeVersion` por
`appVersion`. Alterar comportamento de pagamento por OTA depois da aprovação é
exposição maior que a flag de servidor. Registrar que não se faz isso.

## Verificação

| Camada    | Como                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| API       | Integração contra Postgres real via Testcontainers                             |
| Mobile    | vitest com o SDK da Stripe mockado                                             |
| Apple Pay | Manual, aparelho físico, cartão real na carteira, Stripe test                  |
| Plano B   | Teste: gate por plataforma desligado ⇒ iOS sem entrada, web e Android intactos |

Apple Pay não roda em simulador nem em CI.

Caso obrigatório: recontratar dentro de 24 horas após cancelar, mesmo plano e
add-ons, afirmando que nasce assinatura nova.

## Submissão à App Review

Vai junto: conta de demonstração com email verificado, assinatura ativa e evento
com ingresso disponível, conforme o spec de bloqueadores.

Sobre a nota de review invocando 3.1.5(a): a revisão adversarial argumenta que
ela chama atenção para a questão em vez de resolvê-la, e que o reposicionamento
do produto é o que de fato muda a leitura. Decidir na submissão se a nota vai,
com o produto já reposicionado. A recomendação é que vá curta, descrevendo o que
o membro recebe fisicamente, sem citar número de regra.

## Ordem de execução

1. Fase 0 fechada.
2. Spec A concluído, smoke passado.
3. Bloqueadores de review resolvidos.
4. Reposicionamento do produto: config, seed, copy.
5. Credenciais Apple: merchant ID nos App IDs `.dev` e `.preview`, profiles
   regerados.
6. API: `flow: native`, endpoint de assinatura nativa, guarda de duplicidade por
   constraint, gate por plataforma.
7. Mobile: remoção do isolamento, `PaymentSheet` nas três telas.
8. Decisão sobre o SKU da vaga virtual.
9. Teste manual de Apple Pay em aparelho, Stripe em test mode.
10. Submissão.
