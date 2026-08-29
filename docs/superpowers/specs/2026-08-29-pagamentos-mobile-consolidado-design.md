# Pagamentos no mobile — spec consolidado

**Data:** 2026-08-29
**Status:** aprovado, aguardando plano de implementação
**Não substitui nada.** Indexa os quatro specs e registra três decisões novas,
mais o estado verificado do código em 2026-08-29.

Specs indexados: [Fase 0](2026-08-12-billing-fixes-design.md) ·
[Spec A, web](2026-08-12-stripe-live-web-design.md) ·
[Bloqueadores iOS](2026-08-12-ios-review-blockers-design.md) ·
[Apple Pay](2026-08-12-apple-pay-ios-design.md) ·
[Rastreador](../plans/2026-08-13-pagamentos-roadmap.md)

## Por que este documento existe

Os quatro specs foram escritos entre 12 e 13 de agosto. Dezessete dias depois,
parte do que eles descrevem como pendente já foi feito, e um item do desenho de
Apple Pay não sobrevive à leitura do código atual. Um plano de implementação
escrito direto de cima deles construiria coisa já construída e apontaria o gate
de plataforma para uma rota que não responde.

Este documento é a camada de verificação entre os specs e o plano.

## Estado verificado em 2026-08-29

Confirmado por leitura de código, não por memória.

### Já feito, sai do escopo

| Item                                          | Onde                                                 | Evidência                             |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `monthlyBoxBudgetCents` por tier              | `packages/db/prisma/seed.ts:523,536,550`             | 4490 / 9890 / 22490, só no `create`   |
| `vendorName` do detailing                     | `seed.ts:573`                                        | `Vortex Detailing`                    |
| Oficina fora de comercialização               | `seed.ts`                                            | módulo `active: false`                |
| Benefício não implementado removido da folha  | `apps/mobile/src/copy/garage.ts:99-104`              | comentário datado 2026-08-14, PT e EN |
| Script de aposentadoria do SKU virtual        | `apps/api/src/scripts/retire-garage-spot-product.ts` | existe, com `--dry-run`               |
| Bloqueadores de review 1.2, 5.1.1, 5.1.2, 2.1 | vários                                               | marcados `[x]` no rastreador          |

O SKU "Vaga de Garagem Adicional" está meio removido: o script de aposentadoria
existe, as constantes seguem em `packages/db/src/garage-spot-product.ts`. Não há
decisão pendente, há execução pendente contra o banco de produção. É item de
Pedro, não de DEV.

### Ainda pendente, confirmado

| Item                                  | Onde                                                          | Estado                                                      |
| ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Isolamento iOS do Stripe              | `apps/mobile/app/_layout.tsx:222`                             | `Platform.OS !== 'ios'` ainda gateia o `StripeProvider`     |
| Regra de lint                         | `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`               | ativa, registrada em `eslint.config.js`                     |
| Teste de isolamento                   | `src/screens/settings/__tests__/ios-stripe-isolation.test.ts` | ativo                                                       |
| Caminho nativo no avulso              | `apps/api/src/routes/cart.ts:686,769`                         | `clientSecret: null` nos dois retornos                      |
| `merchantIdentifier` fora de produção | `apps/mobile/app.config.ts:39`                                | `variant === 'production' ? … : undefined`                  |
| Assinatura nativa                     | —                                                             | endpoint não existe                                         |
| Gate por plataforma                   | —                                                             | nenhuma ocorrência de plataforma em `routes/me-premium.ts`  |
| Folha "O que é Premium?"              | `copy/garage.ts:105` e `:221`                                 | dois benefícios, ambos digitais, PT e EN                    |
| `payoutAmountCents` do detailing      | `seed.ts:572,583`                                             | zero                                                        |
| Chave da conta antiga no `eas.json`   | `apps/mobile/eas.json`, perfil `preview`                      | `pk_test_51RD9T6…`, conta JDM, nenhuma das duas contas CCC  |
| Perfil `production` sem chave Stripe  | `apps/mobile/eas.json`                                        | nenhuma variável Stripe, nenhum `EXPO_PUBLIC_CAIXA_ENABLED` |

## Enquadramento na App Store, registrado de propósito

O rastreador e o spec de Apple Pay assumem esse enquadramento sem enunciá-lo. Ele
é a premissa de tudo que vem depois, então fica escrito.

Stripe dentro de app iOS na loja é permitido. A diretriz 3.1.1 exige IAP para
desbloqueio de conteúdo e funcionalidade digital. A diretriz 3.1.5(a), bens e
serviços consumidos fora do app, proíbe IAP e nomeia Apple Pay e entrada de
cartão como os métodos corretos.

Apple Pay não é alternativa ao Stripe. Apple Pay é carteira, Stripe é
processadora. A alternativa real ao Stripe é StoreKit, que é o que a RevenueCat
embrulha, e é onde a Apple cobra a comissão.

O canon §F8.16 estava correto para o produto de maio de 2026, que era digital:
capa, selo, garagem em destaque, página sem rodapé. Sob 3.1.1, link de checkout
Stripe no bundle iOS é rejeição direta. O que mudou em 12 de agosto não foi a
leitura jurídica, foi o produto: caixa física mensal, acesso ao clube e serviços
de fornecedor caem em 3.1.5(a).

O risco residual não é técnico. Premium é pacote misto: entrega caixa física e
também destrava capa e selo, que são gateados no servidor e inequivocamente
digitais. É dessa ambiguidade que veio a estimativa de 65 a 85 por cento de
rejeição, e é por isso que a reescrita da folha de copy é item de plano e não
polimento.

Avulso de ingresso é caso mais seguro. Ingresso para evento presencial é serviço
consumido fora do app sob qualquer leitura.

## Decisão 1 — gate por plataforma

O spec de Apple Pay exige "gate por plataforma servido pela API, lido em
runtime". Não fixa a forma. Fica fixada aqui.

### Correção ao desenho considerado primeiro

A ideia inicial era carregar o booleano em `GET /api/premium/pricing`. **Não
funciona.** Essa rota devolve 503 quando `GROWTH_PREMIUM_BILLING_ENABLED` está
desligada (`apps/api/src/routes/premium-pricing.ts:49`), e hoje ela devolve
503 em produção de qualquer forma, porque `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` e
`_ANNUAL` não estão setadas no Railway. Gate que não responde não é gate.

### Forma adotada

O booleano viaja em `GET /api/plans` (`routes/premium-catalog.ts`). Essa rota é
unauthed, é explicitamente não gateada pela flag global, e é a que a
`ContratarScreen` de fato lê.

- **Detecção.** Header `x-ccc-platform`, preenchido com `Platform.OS` no único
  ponto de saída do cliente mobile, `apps/mobile/src/api/client.ts:33` e `:78`.
  Ausente ou desconhecido é tratado como `web`.
- **Resolução.** Uma variável por plataforma no Railway. Ausente significa
  ligada, para que nenhum ambiente existente mude de comportamento no deploy.
- **Leitura.** `GET /api/plans` passa a devolver `subscriptionsEnabled`. O mobile
  lê em runtime e, quando falso, não renderiza a entrada de assinatura **nem a
  aba**. Aba primária com "em breve" é rejeição por completude, que é
  exatamente a armadilha que o Plano B antigo tinha.
- **Escrita.** O gate também barra os endpoints de checkout em
  `routes/me-premium.ts`. Esconder no cliente não basta: a rota é alcançável.

A flag `GROWTH_PREMIUM_BILLING_ENABLED` continua existindo e continua global.
Ela não vira o gate de plataforma, e desligá-la segue derrubando web, Android e
o processamento de renovação junto. O gate novo é o instrumento de resposta a
uma rejeição da Apple; a flag global não é, e nunca foi.

`EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` é build-time
(`apps/mobile/src/lib/premium-runtime.ts:9`) e nenhuma tela de assinatura a lê.
Fica como está. Não é gate de nada hoje e este spec não a promove a gate.

**Verificação obrigatória:** gate de iOS desligado ⇒ iOS sem entrada e sem aba,
web e Android intactos, webhook de renovação intacto.

## Decisão 2 — anual mais add-on

A Stripe recusa preço anual junto de add-on mensal na mesma sessão, e a API
traduz isso para 503. Detailing só tem cadência mensal, então Fundador anual mais
Detailing não fecha.

**Adotado:** rejeitar a combinação explicitamente, com erro tipado em vez de 503,
e esconder add-ons na UI quando a cadência selecionada for anual.

Motivo: a cadência anual não é selecionável no app hoje, então a combinação é
inalcançável pela interface. Criar preço anual de add-on é trabalho de catálogo
numa conta Stripe que ainda não foi ativada, e precificaria um serviço cujo
`payoutAmountCents` segue em zero. Se a cadência anual virar selecionável, a
decisão é revisitada com dado de uso.

## Decisão 3 — construir agora, em paralelo

As duas contas Stripe estão com `charges_enabled: false`. A ativação depende da
Stripe, não de nós, e o rastreador serializa iOS estritamente depois do smoke da
web.

**Adotado:** escrever e testar todo o código contra Stripe em test mode agora, com
o gate de iOS desligado por padrão. Nada fica exposto antes dos passos de Pedro.
O que a serialização protegia era o risco de escrever código contra premissas que
a conta live invalidaria; o gate de plataforma cobre esse risco melhor, porque
permite desligar sem build novo.

## Decomposição

Sete blocos. A ordem é por dependência.

**1. Gate por plataforma.** Primeiro porque é o que torna seguro mesclar código
de pagamento iOS enquanto a conta está inativa. Conforme a Decisão 1.

**2. Avulso nativo na API.** Campo `flow` em `POST /api/cart/checkout`, valores
`hosted` e `native`, default `hosted`. Nativo com método `card` cria PaymentIntent
com a metadata que o webhook já lê, grava `providerRef`, devolve `clientSecret`
com `checkoutUrl: null`. Seta `receipt_email`, que a página hospedada dava de
graça e a PaymentIntent crua não dá. Cancela a PI quando a varredura expirar o
pedido, reusando `cancelPaymentIntent`. Pix ignora `flow`. Caminho web intocado.

**3. Assinatura nativa na API.** Endpoint irmão com
`payment_behavior: default_incomplete`, lendo
`latest_invoice.confirmation_secret.client_secret`. Em `stripe@22.1.0` com
`2026-04-22.dahlia` não existe `payment_intent` no topo da Invoice; esse caminho
não compila. Idempotência por tentativa, UUID novo a cada toque. A proteção
contra duplicidade sai da chave Stripe e vira índice único parcial por `garageId`
sobre `active`, `past_due`, `cancel_scheduled` e `incomplete`. A rejeição da
Decisão 2 entra aqui. Método novo em `services/stripe/index.ts` com espelho em
`fake.ts`.

Caso de teste obrigatório: cancelar e recontratar o mesmo pacote dentro de 24
horas, afirmando que nasce assinatura nova. A chave por pacote que o spec
original propunha falha exatamente aí, devolvendo a assinatura cancelada e uma
invoice já liquidada.

**4. Remoção do isolamento iOS.** Cai o gate do `StripeProvider`, cai a regra de
lint, cai o teste de isolamento. O canon §F8.16 em
`plans/2026-05-26-f8-billing-chunks-skeleton.md:52` é marcado superseded com data
e motivo, não apagado. `merchantIdentifier` passa a ser preenchido em toda
variant.

**5. `PaymentSheet` no mobile.** Carrinho, assinatura e retomar pedido. Uma
configuração só, sem botão dedicado: o sheet apresenta Apple Pay quando
configurado. `returnURL` com o scheme do app, para o retorno do 3DS. Cartão
brasileiro autentica acima da média e sem isso o pagamento fica pendurado.
`src/screens/assinaturas/checkout.ts:26` para de devolver `ios_unsupported`.

**6. Copy e configuração de build.** Folha do Premium reescrita em PT
(`copy/garage.ts:105`) e EN (`:221`), liderando com caixa, clube e serviços, com
selo e capa como extras. É a folha que o revisor lê, e hoje ela argumenta contra
nós. Perfil `production` do `eas.json` ganha chave publicável real,
`EXPO_PUBLIC_CAIXA_ENABLED` e `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`. Perfil
`preview` perde a chave da conta JDM. `docs/eas-credentials.md` para de dizer
`com.jdmexperience.app`. Varredura afirmando que nenhuma aba primária cai em
placeholder no binário submetido.

**7. Código do go-live da web.** Independente dos blocos 1 a 6, roda em paralelo.
AbacatePay entra no fanout de exclusão de conta
(`services/account-deletion/vendor-fanout.ts`), onde hoje falta apesar de ser
Operador nomeado na política. `legal.ts` passa a assinatura de RevenueCat para
Stripe, na prosa e na tabela de subprocessadores, com bump de
`PRIVACY_POLICY_VERSION`. Pedidos pré-cutover marcados, senão o primeiro
relatório de receita real soma dinheiro de teste em `routes/admin/finance.ts`.
Caminho administrativo de recuperação de membership, espelhando
`POST /admin/tickets/grant`. Worker de reconciliação do Pix, espelhando
`billing-reconcile.ts`. Verificar se `/premium/catalogo` cria linha de cadência
anual em `PremiumPlanPrice`; sem ela uma fatura anual cai em `unknown-plan-price`
e o dinheiro entra sem assinatura nascer.

## Fora do escopo de DEV

Ativação da conta Stripe do CNPJ, catálogo e webhooks e portal live, variáveis do
Railway, AbacatePay de produção com `?webhookSecret=` na query string, instante
de corte da purga, `payoutAmountCents` do detailing, habilitação do
`merchant.com.casacarclub.app` nos App IDs `.dev` e `.preview` com regeração de
profiles, regras de alerta do Sentry, decisões de nota fiscal e Stripe Tax e
parcelamento, execução do script de aposentadoria do SKU virtual, teste manual de
Apple Pay em aparelho, notas de review, submissão.

## Verificação

| Camada    | Como                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| API       | Integração contra Postgres real via Testcontainers, conforme regra do repo    |
| Mobile    | vitest com o SDK da Stripe mockado                                            |
| Apple Pay | Manual, aparelho físico, cartão real na carteira, Stripe em test mode         |
| Gate      | Teste: iOS desligado ⇒ sem entrada e sem aba; web, Android e webhook intactos |

Apple Pay não roda em simulador nem em CI.

## Exposição registrada

`expo-updates` está no projeto com `runtimeVersion` por `appVersion`. Alterar
comportamento de pagamento por OTA depois da aprovação é exposição maior que
qualquer flag de servidor. Não se faz.
