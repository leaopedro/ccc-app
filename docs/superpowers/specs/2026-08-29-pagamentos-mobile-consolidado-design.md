# Pagamentos no mobile — spec consolidado

**Data:** 2026-08-29
**Status:** revisado adversarialmente, decisões de produto fechadas em 2026-08-29
**Não substitui nada.** Indexa os quatro specs, corrige o que eles afirmam de
errado, e registra o que a revisão de 2026-08-29 derrubou.

Specs indexados: [Fase 0](2026-08-12-billing-fixes-design.md) ·
[Spec A, web](2026-08-12-stripe-live-web-design.md) ·
[Bloqueadores iOS](2026-08-12-ios-review-blockers-design.md) ·
[Apple Pay](2026-08-12-apple-pay-ios-design.md) ·
[Rastreador](../plans/2026-08-13-pagamentos-roadmap.md)

## Correções de fato, aplicáveis a todos os specs anteriores

Quatro revisores adversariais leram este documento e o código em 2026-08-29.
Estas são as afirmações que não sobreviveram. Elas estão erradas nos specs
anteriores também, e nos comentários de código citados.

**C1. A diretriz citada está morta.** Todos os specs citam `3.1.5(a)` para a
isenção de bens físicos. Hoje **3.1.5 é "Cryptocurrencies"** e não tem alínea
(a). A citação correta é **3.1.3(e) — Goods and Services Outside of the App**:
_"If your app enables people to purchase **physical** goods or services that
will be consumed outside of the app, you must use purchase methods other than
in-app purchase to collect those payments, such as Apple Pay or traditional
credit card entry."_

Corrigir em `packages/db/prisma/seed.ts:826` e nos quatro specs. E notar a
palavra que a paráfrase dos specs perdia: **physical**. O texto real é mais
estreito que a leitura que vinha sendo usada.

**C2. O chapeau da 3.1.3 já é violado hoje.** _"Apps in this section cannot,
within the app, encourage users to use a purchasing method other than in-app
purchase, except for apps on the United States storefront."_

`apps/mobile/src/copy/assinaturas.ts:73-74` entrega, no iOS:

```
iosTitle: 'Contratação pelo site.',
iosSubcopy: 'No iPhone a contratação é feita pelo site da Casa Car Club.'
```

Renderizado em `ContratarScreen.tsx:315-318`. Isso é encaminhamento para compra
externa dentro do app, na storefront do Brasil. A exceção dos EUA não se aplica.
É rejeição autônoma, presente no binário de hoje, independente de todo o resto.
A versão anterior deste spec tratava a remoção disso como cosmética.

**C3. `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` é gate, e está desligado em
produção.** A versão anterior dizia que nenhuma tela a lê. Lêem quatro:
`app/(app)/profile/index.tsx:248` esconde a linha de menu,
`screens/settings/PremiumScreen.tsx:54` troca a tela por aviso de manutenção,
`hooks/usePremiumSubscription.ts:26-29` e `hooks/usePremiumInvoices.ts:6`
abortam a chamada. O perfil `production` do `eas.json` não a define, logo ela é
`false` no binário submetido. Qualquer gate de runtime é empilhado sobre um gate
de build-time já desligado.

**C4. `ContratarScreen` não lê `GET /api/plans`.** Lê `GET /api/plans/:slug`
(`ContratarScreen.tsx:24,77` → `api/premium-catalog.ts:36-37`). Só
`PlanosScreen.tsx:195` lê a lista. Colocar o booleano do gate apenas na lista
deixa a tela de contratação sem ele. Corrigido na Decisão 1.

**C5. `docs/eas-credentials.md` já está correto.** Já usa
`com.casacarclub.app`. O `com.jdmexperience.app` obsoleto está em oito outros
arquivos: `docs/mobile-build.md`, `docs/secrets.md`, `docs/revenuecat.md`,
`docs/vercel.md`, `docs/mobile-web.md`, `docs/railway.md`,
`docs/manual-testing.md`, `docs/legal/encarregado.md`. A versão anterior herdou
a linha desatualizada do rastreador sem conferir.

**C6. A linha de cadência anual já existe no admin.**
`apps/admin/.../premium-catalog-client.tsx:312-313` renderiza `PlanPriceForm`
para as duas cadências, e o comentário em `:166-176` diz que o `cadence=monthly`
fixo foi removido exatamente por causa do `unknown-plan-price`. Item morto, sai
do bloco 7.

**C7. Seed não é produção, e a ressalva vale para tudo.** A versão anterior fez
essa ressalva só para o SKU virtual. `monthlyBoxBudgetCents` entra apenas no
ramo `create` (`seed.ts:608-616`), então banco de produção que já tem as linhas
nunca recebe o valor. Vale igual para `vendorName` e para `oficina active:
false`. Tudo isso continua **aberto em produção**, não "já feito".

**C8. Blocker 2.1 não está fechado.** A varredura de aba com placeholder
(`rastreador:256`) segue `[ ]`. A versão anterior listava 2.1 como concluído e
ao mesmo tempo colocava a varredura no bloco 6.

**C9. O Stripe SDK confere.** `apps/api/package.json:37` fixa `^22.1.0`,
instalado 22.1.0, `services/stripe/index.ts:282` usa `2026-04-22.dahlia`, e
`Invoice` tem `confirmation_secret` no topo e não tem `payment_intent`. Único
item da lista de verificação que passou intacto.

## Estado verificado do código

### Aberto em produção, apesar de semeado em dev

`monthlyBoxBudgetCents` por tier, `vendorName` do detailing, `oficina
active:false`, e a aposentadoria do SKU "Vaga de Garagem Adicional". Todos
dependem de ação contra o banco de produção via `/premium/catalogo` ou script.

### Pendente em código, confirmado

Isolamento iOS do `StripeProvider` (`app/_layout.tsx:222`), regra de lint
`no-stripe-on-ios.cjs`, teste de isolamento, caminho nativo no avulso
(`cart.ts:686,769` devolvem `clientSecret: null`), `merchantIdentifier` só em
`production` (`app.config.ts:39`), endpoint de assinatura nativa inexistente,
gate por plataforma inexistente, folha "O que é Premium?" com dois benefícios
digitais (`copy/garage.ts:105` e `:221`), `payoutAmountCents` zero, chave
`pk_test_51RD9T6…` da conta JDM no perfil `preview` do `eas.json`, perfil
`production` sem nenhuma variável Stripe.

### Achado novo: botão morto no binário iOS

`screens/settings/PremiumScreen.tsx:164-180` renderiza "Assinar Gold" no iOS,
chamando `fetchOfferings()` contra um SDK RevenueCat que nunca é inicializado
(`lib/revenuecat.ts:26`, sem chamador). A rota é deep-linkable. Botão de compra
que não funciona é rejeição 2.1 sozinho. Nenhum bloco dos specs anteriores
agendava a remoção.

## Decisão 1 — gate por plataforma, corrigido

### O que a revisão derrubou

A forma anterior tinha quatro furos. Todos corrigidos abaixo.

- Carregava o booleano só em `GET /api/plans`, que a tela de contratação não lê
  (C4).
- Cobria a escrita só em `routes/me-premium.ts`. `POST /api/me/premium/addons`
  vive em `routes/me-premium-addons.ts` e ficava aberto: um cliente iOS anexa
  add-on recorrente passando ao largo do gate. `POST /api/me/premium/billing-portal`
  e `/checkout-precheck` idem.
- Falhava aberto. "Ausente ou desconhecido é tratado como `web`" numa rota que
  vira portadora de decisão de compliance significa que qualquer chamada sem o
  header serve `subscriptionsEnabled: true` ao iOS.
- Dizia "esconder a aba" sem dizer o que ocupa o slot. `caixa-slot.ts:7`
  devolve `'assinaturas'` incondicionalmente quando a caixa está desligada, e a
  caixa **está** desligada em produção. Esconder `assinaturas` no iOS deixa o
  slot premium sem aba nenhuma.

### Forma adotada

- **Detecção.** Header `x-ccc-platform` com `Platform.OS`, preenchido nos dois
  pontos de saída da API do cliente, `api/client.ts:33` e `:78`. Não é "o único
  ponto de saída" do app: `shipping/useCepLookup.ts:34` e `lib/upload-image.ts:70`
  também saem, mas não batem na nossa API.
- **Falha fechada.** Header ausente ou desconhecido resolve para o valor
  **restritivo** quando o `User-Agent` é de app nativo. Só navegador declarado
  resolve para `web`. O modo de falha de um gate de compliance não pode ser
  "ligado".
- **Leitura.** `subscriptionsEnabled` viaja nas **três** rotas de catálogo:
  `GET /api/plans`, `GET /api/plans/:slug` e `GET /api/addon-modules`. Com
  `Vary: x-ccc-platform` e `Cache-Control: no-store`, senão um cache à frente da
  API serve corpo de web para cliente iOS, que é exatamente a rejeição que o
  gate existe para evitar.
- **Escrita.** Barra `me-premium.ts` (`/checkout`, `/checkout-precheck`,
  `/billing-portal`) **e** `me-premium-addons.ts` (`POST /api/me/premium/addons`).
- **Slot da aba.** `resolveCaixaSlot` ganha um terceiro estado. Gate desligado e
  caixa desligada significa slot vazio, não aba órfã. Testes de navegação
  atualizados.
- **Deep link.** Esconder a aba não remove a rota. `app/(app)/assinaturas/`
  tem `contratar`, `[slug]`, `minha-assinatura` e `checkout-return`, todas
  alcançáveis por deep link. Cada uma redireciona quando o gate está desligado.
- **Rate limit.** As três rotas de catálogo hoje não têm nenhum
  (`premium-catalog.ts`, zero ocorrências, ao contrário de `badges-catalog.ts`).
  Promovê-las a portadoras do gate sem limite é fan-out de banco não autenticado
  de graça.

`GROWTH_PREMIUM_BILLING_ENABLED` continua global e não vira gate de plataforma.
`EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` é build-time, **é** gate de quatro
superfícies (C3), e precisa ser ligada no perfil `production` no bloco 6, senão
o gate de runtime é decorativo.

## Decisão 2 — anual mais add-on

Mantida: rejeição tipada em vez de 503, com add-ons escondidos na UI quando a
cadência for anual. A premissa segue válida — `api/premium.ts:26` fixa
`monthly`, então anual não é selecionável no app. C6 remove só a verificação do
admin, não muda a decisão.

Falta nomear: o código de erro e o schema Zod. Ambos entram no bloco 3.

## Decisão 3 — construir agora, em paralelo

Mantida. A ressalva que a revisão de política levantou foi fechada pela
Decisão 7: o gate é construído por inteiro, mas a submissão vai com ele ligado,
então não há caminho de compra dormente no binário.

## Decisão 4 — a guarda de duplicidade, refeita

### Por que a anterior era pior que não ter guarda

A revisão de segurança demonstrou o seguinte, e eu confirmei cada passo:

1. `PremiumMembershipStatus` (`schema.prisma:269-276`) é
   `trialing | active | past_due | cancel_scheduled | expired | paused`. **Não
   existe `incomplete`.** O índice parcial proposto não pode ser escrito.
2. `premiumMembership.create` existe em um lugar só,
   `services/billing/apply-membership-event.ts:97`, dentro de `handleActivated`,
   disparado por `invoice.paid`. Logo o índice não impede a Stripe de criar a
   segunda assinatura. Ele impede o banco de **registrar** uma que a Stripe já
   cobrou.
3. Caminho do desastre: segunda `invoice.paid` → `handleActivated` → P2002 →
   escapa do `$transaction` → 500 → Stripe reentrega por ~3 dias → 503 no ramo
   de não processado → evento perdido. **Cobrança mensal recorrente, sem
   membership, sem entitlement, sem reembolso.** `billing-reconcile.ts:246` só
   varre `active/past_due/cancel_scheduled`, então nada encontra.
4. O caso de teste obrigatório do próprio spec é o gatilho: cancelar grava
   `cancel_scheduled`, que está dentro do predicado proposto.
5. Trocar a chave determinística por UUID por tentativa remove a única proteção
   real que existe hoje (`me-premium.ts:384`), sem colocar nada no lugar antes
   do pagamento.

### Forma adotada

Três peças, e nenhuma toca no enum de `PremiumMembership`, evitando o efeito
cascata por ~25 arquivos que o enum novo provocaria.

- **Lock antes da Stripe.** `SELECT … FOR UPDATE` na linha de `Garage` antes de
  qualquer `subscriptions.create`, o mesmo padrão que
  `stripe-billing-webhook.ts:752` já usa. Dois toques concorrentes serializam.
- **Tabela de tentativa.** `PremiumSubscriptionAttempt` nova, com índice único
  parcial por `garageId` onde `status = 'pending'`. É o registro pré-pagamento.
  `PremiumMembership` fica intocada, o que **preserva** a invariante de que
  membership só nasce de webhook verificado.
- **Chave de idempotência determinística com discriminador de tentativa.**
  `sub_${garageId}_${cadence}_${digest}_${attemptId}`. Toques concorrentes caem
  na mesma tentativa e colapsam numa assinatura só. Recontratação depois de
  cancelar abre tentativa nova e portanto assinatura nova, que é o caso
  obrigatório, agora satisfeito sem colisão.
- **Reaping.** Tentativa expira por TTL de 23h no worker de reconciliação, antes
  de a Stripe transicionar para `incomplete_expired`. Sem isso, quem toca em
  assinar e fecha o app fica travado para sempre.
- **Visibilidade entre plataformas.** `listOpenSubscriptionCheckoutSessions`
  (`services/stripe/index.ts:227`) enumera Checkout Sessions, e uma assinatura
  `default_incomplete` não cria nenhuma. A precheck em `me-premium.ts:363` passa
  a consultar também a tabela de tentativa, senão iniciar no iOS nativo e
  terminar na web cobra duas vezes.
- **Rate limit** no endpoint nativo. Sem ele, "UUID novo a cada toque" é uma
  torneira de assinaturas órfãs.

`LIVE_STATUSES` está duplicado em três lugares (`me-premium.ts:47`,
`me-premium-addons.ts:36`, `apply-membership-event.ts:461`) e omite `trialing` e
`paused` — um membro em trial ou pausado abre segunda assinatura sem nada
objetar. Unificar numa constante só, em `packages/shared`.

## Decisão 5 — o avulso nativo, com as corridas fechadas

Bloco 2 mantido, com três defeitos que a revisão achou e que precisam de
resposta no plano:

- **`handleCartFailure` não cancela a PaymentIntent** (`stripe-webhook.ts:289`).
  Ele marca os pedidos `failed`, libera estoque e reabre o carrinho. O
  `PaymentSheet`, por design, continua montado para nova tentativa na mesma PI.
  Recusa seguida de sucesso na mesma folha cai no ramo `dead` de
  `stripe-webhook.ts:161-180` e vira cobrança seguida de reembolso, com estoque
  já revendido. Recusa de 3DS é o modo de falha mais comum em cartão
  brasileiro, e o próprio spec diz isso.
- **Folha velha com `clientSecret` velho** confirma depois de o carrinho ter
  sido reaberto e uma PI nova criada. As duas PIs carregam o mesmo `cartId`.
  Cobrança dupla, a segunda sem `providerRef`, invisível para `charge.refunded`
  e para `charge.dispute.created`.
- **Não existe worker de expiração.** `apps/api/src/workers/` não tem nenhum;
  toda varredura é preguiçosa, disparada por outro checkout do mesmo
  tier/variant ou por `GET /orders/:id`. "Cancela a PI quando a varredura
  expirar o pedido" não tem gatilho confiável.

O plano precisa fechar os três, não só adicionar `flow: native`.
`receipt_email` deve ser derivado do `sub` no servidor, nunca do corpo da
requisição, senão vira primitiva de e-mail para destinatário arbitrário no
domínio Stripe.

## Escopo que faltava

Nada disto estava na versão anterior e tudo é necessário.

**Migrações.** Tabela `PremiumSubscriptionAttempt`. Campo de `livemode` ou
equivalente em `Order` para o corte pré-cutover, mais backfill e filtro em
`routes/admin/finance.ts` e na UI de finanças do admin. Doc de rollback por
migração, conforme os três `docs/migration-rollback-*.md` que já existem.

**Schemas Zod em `packages/shared`.** `beginCheckoutRequestSchema` ganha `flow`.
Os schemas de catálogo ganham `subscriptionsEnabled`. Par novo de
request/response para a assinatura nativa. Forma tipada do erro da Decisão 2.
`LIVE_STATUSES` unificada.

**Copy PT e EN.** Falhas do `PaymentSheet`, cancelamento, retorno de 3DS, o erro
da Decisão 2, o estado de gate desligado, e a remoção de
`'Assinaturas em breve.'` (`copy/assinaturas.ts:89`). Mais a remoção do texto de
encaminhamento do C2.

**Tags de Sentry.** `docs/observability.md` usa convenção de regra por tag. Os
blocos 2, 3 e 5 introduzem modos de falha sem observabilidade nenhuma: PI nativa
criada e nunca confirmada, tentativa de assinatura abandonada, retorno de 3DS
perdido, rejeição do gate na escrita. As regras de painel são de Pedro; as tags
são código.

**Rate limiting.** `cart.ts` e `premium-catalog.ts` têm zero. `app.ts:95` não
seta `trustProxy`, então qualquer limite por IP atrás do Railway é um balde
global e vira alavanca de DoS em vez de proteção. Resolver o `trustProxy` antes
de adicionar limite por IP em rota não autenticada.

**Itens que a versão anterior perdeu dos specs de origem.** Reescrita de
`docs/stripe.md`, que o Spec A diz que "induz erro de operação" e contém
afirmação falsa sobre Stripe Tax. Fluxo de reembolso para suporte, que não
existe hoje. Os onze casos de smoke obrigatórios do Spec A. Seção de rollback.
Chave Stripe restrita em vez de `sk_live` completa. Reembolso parcial. Remoção
do botão morto de RevenueCat. Execução da purga, que o rastreador marca como
DEV. Benefícios de plano ainda não implementados sob a regra 2.3.1.

## Decisão 6 — o pacote misto: tornar a caixa visível antes da compra

Decidido em 2026-08-29. Os desbloqueios digitais **permanecem** na assinatura
paga. A correção é de exposição, não de arquitetura: a prova física passa a
aparecer no momento da decisão de compra.

Isto não elimina o argumento 3.1.1, apenas o enfraquece. Fica registrado que a
opção que eliminaria a ambiguidade era tirar capas, selo e feed da membresia
paga, e que ela foi conscientemente recusada por custo de produto.

Trabalho que isto exige, e que a versão anterior do bloco 6 não continha:

- **Rótulos de benefício no banco**, não em `copy/garage.ts`. A tela de compra lê
  de `GET /api/plans/:slug` via `premium-catalog.ts:42-58`. Cadastrar em
  `/premium/catalogo`, em produção, incluindo conteúdo da caixa e cadência de
  entrega. É ação de Pedro no admin, e é o item de maior efeito da lista.
- **Serializar o que hoje não sai.** `monthlyBoxBudgetCents` existe no modelo e
  nunca é serializado. Decidir se o valor aparece ou se só a descrição aparece.
- **Endereço de entrega e cadência no paywall.** `ContratarScreen.tsx:215-230`
  hoje renderiza tier, nome, preço e add-ons, e não renderiza benefício nenhum.
- **Folha "O que é Premium?"** reescrita, PT e EN, ainda necessária, mas agora
  entendida como secundária: é a folha da garagem, não o paywall.

Risco que sobra e precisa estar nas notas de review: a folha reescrita promete
caixa, e `caixa-slot.ts:7` esconde a aba de quem não é premium. Prometer no
paywall o que a navegação esconde é exposição 2.3.1. A Decisão 8 é o que
sustenta esta.

## Decisão 7 — submeter com o gate ligado

Decidido em 2026-08-29. O binário submetido tem o fluxo de assinatura iOS
**ativo**. Não haverá caminho de compra completo e inalcançável dentro do
binário.

Motivo: risco concentrado no argumento do pacote misto, que é juízo de revisor e
pode ir para os dois lados, em vez de exposição de boa-fé sob 2.3.1, que é
achado pior e atinge a conta.

Consequências:

- O gate por plataforma continua sendo construído integralmente. Ele deixa de
  ser postura de submissão e passa a ser **instrumento de resposta** a uma
  rejeição, que é o que ele sempre deveria ter sido.
- `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` precisa ser **ligada** no perfil
  `production` do `eas.json`. Hoje ausente, logo `false`, logo as quatro
  superfícies do C3 estão desligadas no binário. Sem esse flip, submeter "com o
  gate ligado" entrega um app sem assinatura de qualquer forma.
- O texto de encaminhamento do C2 sai. Com pagamento nativo funcionando no iOS,
  ele deixa de ser necessário e passa a ser só a violação que já era.

## Decisão 8 — QA da caixa antes do flip, e antes da submissão

Decidido em 2026-08-29. `EXPO_PUBLIC_CAIXA_ENABLED` só é ligada depois do QA
manual que os planos do box-builder declararam load-bearing, incluindo confirmar
na AbacatePay que uma cobrança Pix é impagável depois do `expiresIn`.

Isto move o QA da caixa para **dentro do caminho crítico da submissão iOS**, o
que nenhum spec anterior fazia. A Decisão 6 promete a caixa no paywall; a
Decisão 8 é o que faz a promessa ser verdadeira quando o revisor for conferir.

Consequência de sequenciamento: a submissão iOS passa a depender de um bloco de
QA que não é de engenharia de pagamentos. Ele entra no plano como pré-requisito
explícito, com dono, não como suposição.

## Questão aberta — o SKU virtual pode estar vivo em produção

Única que continua aberta, e é fato a apurar, não decisão.

O spec de Apple Pay diz que a "Vaga de Garagem Adicional" de R$49 é inalcançável
porque `GeneralSettings.defaultFreeGarageSpots` é null e null é ilimitado. Mas
`migrations/20260520120100_garage_spots_tables/migration.sql:58-61` faz
`UPDATE "GeneralSettings" SET "defaultFreeGarageSpots" = 1 WHERE … IS NULL`.

Se existia linha de `GeneralSettings` em produção quando essa migração rodou, o
limite é finito, o tile de `garage-slots.ts:76` renderiza, e há desbloqueio
digital de R$49 vendido fora do IAP no binário atual. Uma query resolve:

```sql
SELECT "defaultFreeGarageSpots" FROM "GeneralSettings";
```

Independente do resultado, a correção durável não é aposentar um SKU. É recusar
item `virtual: true` no `POST /api/cart/checkout` quando a plataforma for iOS,
no servidor. Aposentar a linha resolve a instância de hoje; o schema do carrinho
continua permitindo a próxima.

## Ordem, corrigida

A ordem anterior tinha três erros de dependência.

- **Bloco 7 não é independente.** `packages/shared/src/legal.ts` é empacotado no
  binário mobile (`app/(auth)/privacidade.tsx:2`). Submeter o iOS com política
  dizendo que assinatura é gerida pela RevenueCat, enquanto o app cobra por
  Stripe, é contradição visível ao revisor. Bloco 7 precede a submissão.
  O bump de `PRIVACY_POLICY_VERSION` também exige mexer em
  `PREVIOUS_PRIVACY_POLICY_VERSION` (`legal.ts:25`) e faz o banner de cookies do
  admin reaparecer.
- **Bloco 4 depende de Pedro.** `merchantIdentifier` em toda variant quebra
  build `.dev` e `.preview` até a Apple habilitar
  `merchant.com.casacarclub.app` nesses App IDs e os profiles serem regerados.
- **Bloco 5 depende do bloco 6.** `_layout.tsx:222` exige `stripeKey`, e o
  perfil `production` não tem nenhuma. O `PaymentSheet` nasce morto em build de
  produção até o bloco 6 entrar.

## Verificação

| Camada        | Como                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| API           | Integração contra Postgres real via Testcontainers, conforme regra do repo                                             |
| Mobile        | vitest com o SDK da Stripe mockado                                                                                     |
| Apple Pay     | Manual, aparelho físico, cartão real na carteira, Stripe em test mode                                                  |
| Gate          | iOS desligado ⇒ sem entrada, sem aba, sem deep link, escrita barrada nos dois routers; web, Android e webhook intactos |
| Duplicidade   | Cancelar e recontratar dentro de 24h; dois toques concorrentes; tentativa abandonada reapada em 23h                    |
| Avulso nativo | Recusa de 3DS seguida de nova tentativa na mesma folha; folha velha confirmando após reabertura do carrinho            |

Apple Pay não roda em simulador nem em CI. Os onze casos de smoke do Spec A
continuam obrigatórios e estão lá, não aqui.

## Android, que os specs esqueciam

Com `flow: native` no bloco 2 e o `PaymentSheet` no bloco 5, **o Android ganha a
folha nativa por padrão**: `_layout.tsx:222` só gateia iOS, e
`orders.tsx:209` já habilita Stripe fora do iOS. O rastreador diz que Google Pay
"não foi pedido", mas ele vem junto do `PaymentSheet` a menos que seja
explicitamente suprimido em `initPaymentSheet`. Decidir: suprimir, ou aceitar e
testar. Hoje o plano entrega sem decidir.

Também aberto: `PremiumScreen` no Android abre WebBrowser hospedado e
`ContratarScreen` no Android usa `redirectToStripeCheckout`. Se o Android migra
para nativo ou fica no hospedado é decisão de produto escondida num bloco de
código.

## Exposição registrada

`expo-updates` com `runtimeVersion` por `appVersion`. Alterar comportamento de
pagamento por OTA depois da aprovação é exposição maior que qualquer flag de
servidor. Não se faz. A revisão nota que **flag de servidor que liga fluxo de
compra tem a mesma exposição com transporte diferente**. É por isso que a
Decisão 7 submete com o gate ligado, em vez de submeter com o fluxo dormente.
