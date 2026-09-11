# Alterar assinatura e editar módulos

Data: 2026-09-11
Status: revisado por quatro revisores adversariais, pronto para plano

## Problema

Um membro com assinatura viva não consegue mudar nada da assinatura pelo app,
exceto cancelar.

O caminho que parece existir é uma armadilha. De `MinhaAssinaturaScreen`, o
botão `VER TODOS OS PLANOS` leva a `/assinaturas?all=1`, dali para
`ContratarScreen`, onde o membro escolhe módulos e vê o total recalcular. Só ao
tocar `IR PARA O PAGAMENTO` ele descobre que não pode: `POST
/api/me/premium/checkout` responde `409 AlreadySubscribed`
(`apps/api/src/routes/me-premium.ts:435` no caminho hospedado, `:673` no
nativo).

O 409 está certo. O índice único parcial `premium_membership_live_per_garage`
cobre `active`, `past_due` e `cancel_scheduled`, então deixar o checkout passar
criaria uma segunda assinatura viva ou estouraria no banco. O que falta não é
afrouxar o guard, é uma ação de troca.

No servidor ela existe: `changePlan`
(`apps/api/src/services/billing/subscription-actions.ts`) troca o preço do item
de plano com `create_prorations` e não escreve no banco, deixando o webhook
gravar. Mas só é alcançável por `POST /api/admin/subscriptions/:id/plan`
(`apps/api/src/routes/admin/subscriptions.ts:230`), atrás de `requireRole`.

O mesmo vale para os módulos. `POST /api/me/premium/addons` e `DELETE
/api/me/premium/addons/:addonKey` já existem, são de membro, e o app nunca os
chama. `apps/mobile/src/copy/assinaturas.ts` promete, em `modules.footnote`, que
o membro "poderá adicionar módulos durante a contratação ou depois, em Minha
Assinatura". A segunda metade dessa frase é falsa hoje.

## Escopo

Dentro:

- `POST /api/me/premium/plan`: troca de plano iniciada pelo membro.
- Campos novos no payload de assinatura: `status` e `provider` na membership,
  `monthlyDeltaCents` em cada add-on.
- Correção da chave de idempotência de `changePlan`, que serve admin e membro.
- Guards de servidor que faltam nas rotas de add-on: status, provider e rate
  limit no DELETE.
- Tornar a remoção de módulo reversível, permitindo re-vínculo a partir de
  `cancel_scheduled`.
- Tela de confirmação da troca, `AlterarPlanoScreen`, e as entradas para ela.
- UI de adicionar, remover e reativar módulo em `MinhaAssinaturaScreen`.
- Copy PT-BR nova, com twin EN para cada chave.

Fora, e deliberadamente:

- **Trocar de cadência (mensal ↔ anual) pelo app.** Ver Decisões.
- Variante de alteração na tela de boas-vindas. A troca termina em Minha
  Assinatura com toast.
- Desfazer cancelamento da assinatura (`resumeCancel` segue admin-only).
- Trocar cartão pelo app. `POST /api/me/premium/billing-portal` continua sem
  chamador, exceto pelo link que o estado bloqueado passa a oferecer.
- Troca de plano para membership Apple. Continua na App Store.

## Decisões

**Módulos não entram na troca de plano.** A ação muda só o item de plano. Os
módulos anexados seguem anexados e cobrados. Editar módulo é a outra superfície
desta spec, com endpoint próprio e sem poll.

**A troca preserva a cadência.** O app envia `subscription.cadence`, nunca um
literal. Trocar de mensal para anual é mudança de periodicidade de cobrança,
merece sua própria conversa com o membro, e esbarra num impedimento real: os
módulos só têm preço mensal cadastrado, e a Stripe recusa assinatura com
intervalos misturados (`me-premium.ts:122-133`, e o teste
`premium-checkout-anual-addon.test.ts` que existe por causa disso). O endpoint
aceita `cadence` no corpo porque é o vocabulário de `changePlan`, mas rejeita
`annual` com add-on anexado, exatamente como o checkout já rejeita.

**A troca vale na hora, com rateio na fatura seguinte.** É o que `changePlan` já
faz via `updateSubscriptionItemPrice` com `create_prorations`.

Atenção a uma armadilha de leitura: dois comentários no mesmo arquivo descrevem
esse mesmo `create_prorations` de formas opostas.
`apps/api/src/services/stripe/index.ts:190-192` diz "entra na fatura seguinte, e
não como cobrança imediata". `:664-666` diz "charged/credited **immediately**".
O primeiro está certo: `create_prorations` cria itens de fatura pendentes,
coletados na próxima fatura; cobrar na hora exigiria `always_invoice`. O
comentário de `addSubscriptionItem` é um erro e deve ser corrigido junto, senão
a próxima pessoa escreve a copy errada lendo ele.

Consequência para a copy: **uma formulação só** para troca de plano e para as
ações de módulo, com ressalva de borda de ciclo. Confirmar a poucas horas do fim
do período faz a "próxima fatura" ser a que fecha em seguida.

**Só troca quem está em dia.** `active` e `cancel_scheduled`. Um membro
`past_due` regulariza antes. É mais estrito que
`ADMIN_SUBSCRIPTION_ALLOWED_STATUS.plan`
(`packages/shared/src/admin-subscription.ts:44`), que também aceita `past_due`.
A regra de membro fica declarada separadamente, com comentário dizendo por que
diverge.

**A mesma regra de status passa a valer para anexar módulo.** Hoje `POST
/api/me/premium/addons` não valida status nenhum, e `attachAddon` declara que
não valida (`addons.ts:60-61`). Sem isso a tela ficaria incoerente consigo
mesma: o membro `past_due` seria barrado na troca de plano e, uma seção abaixo,
conseguiria anexar módulo pago. Pior no `paused`: a Stripe descarta as faturas
do período pausado (`pauseSubscriptionCollection` usa `behavior: 'void'`), então
seria módulo entregue com receita zero. É mudança de comportamento num endpoint
existente, e é deliberada.

**Guard de provider vai para o servidor, não só para a tela.** Para membership
que não é Stripe, `attachAddon` cai no caminho local-only (`addons.ts:90-108`):
grava a linha, soma em `addonsAmountCents`, e não cobra nada. Esconder o botão
no app não fecha o buraco, porque binário antigo continua rodando e a rota é
pública para qualquer token. A superfície admin já enforça isso
(`ProviderNotMutable`, `admin/subscriptions.ts:220-226`).

**Remover módulo passa a ser reversível.** Hoje `detachAddon` grava
`cancel_scheduled` e **nada no repo escreve `cancelled`** — a string só aparece
no guard de leitura em `addons.ts:82`, e `handleRenewed`
(`apply-membership-event.ts:559-587`) só faz upsert dos add-ons presentes no
evento. Um módulo removido nunca volta: `attachAddon` recusa para sempre e a
lista de disponíveis o esconde para sempre. Nem o admin resolve, porque usa o
mesmo serviço.

Como esta spec é o que expõe a remoção num botão, ela é responsável por não
criar uma perda permanente. O guard de `addons.ts:82` passa a aceitar re-vínculo
a partir de `cancel_scheduled`, e o ramo de re-vínculo que já existe
(`addons.ts:121-126`) cuida do resto: refresca o snapshot e reabre o ciclo. Um
`REATIVAR` na UI expõe isso. É menor e mais seguro do que mexer no webhook de
renovação.

**A troca de plano não roda `enforceProfileGate`.** `/checkout` e
`/checkout-native` rodam (`me-premium.ts:397`, `:606`); `/cancel`,
`/billing-portal` e o attach de add-on não. A regra escrita aqui: o gate existe
para a **entrada** de um assinante novo, cujo perfil ainda não foi coletado.
Quem já paga já passou por ele. Trocar de plano e mexer em módulo ficam de fora
por essa razão, e não por esquecimento.

**A resposta da troca é `pending`, a do módulo é final.** São contratos
diferentes e a UI trata cada um do seu jeito.

## 1. Contrato compartilhado

Em `packages/shared/src/premium-subscription.ts`.

`mySubscriptionResponseSchema` ganha:

```ts
status: z.enum([...LIVE_MEMBERSHIP_STATUSES]).nullable(),
provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
```

`mySubscriptionAddonSchema` ganha:

```ts
monthlyDeltaCents: z.number().int().nonnegative(),
```

Por que cada um:

- `status`: `active: true` é devolvido para qualquer membership viva, incluindo
  `past_due`, `paused` e `cancel_scheduled`. O app não distingue, então não
  consegue aplicar a regra de elegibilidade nem explicar a recusa.
- `provider`: a tela precisa saber antes de renderizar qualquer ação que só
  existe na Stripe. O servidor também passa a barrar, mas a UI não deve oferecer
  o que vai ser recusado.
- `monthlyDeltaCents`: o add-on serializado hoje não tem preço. Sem ele, a única
  fonte de valor na tela é `usePremiumAddonModules`, que é o preço **atual do
  catálogo**, não o snapshot cobrado. Editar o catálogo faria o sheet de remoção
  anunciar um total que a fatura não confirma. O valor sai de
  `PremiumMembershipAddon.monthlyDeltaCents`, o snapshot da linha.

Os status saem de `LIVE_MEMBERSHIP_STATUSES`
(`packages/shared/src/premium.ts:167`), espalhado porque a constante é readonly.
Os valores de provider são escritos na mão (`schema.prisma:259`), como
`premiumCheckoutPrecheckResponseSchema` já faz (`premium.ts:61`): `@ccc/shared`
não depende do client do Prisma.

Aditivos. `mySubscriptionResponseSchema` é `z.object` sem `.strict()`, então
cliente antigo com cópia velha do schema descarta as chaves novas em vez de
falhar.

## 2. `POST /api/me/premium/plan`

Em `apps/api/src/routes/me-premium.ts`.

Escopo **próprio** de rate limit, com bucket `premium-change-plan:${sub}`. O
arquivo tem três blocos `app.register` separados (`:1157`, `:1176`, `:1191`),
cada um com `max: 5`; reusar o de checkout faria uma troca de plano consumir
tentativa de contratação. `requireSubscriptionsEnabled` entra como `preHandler`
da rota: trocar de plano é entrada de compra.

Guards, nesta ordem:

| Condição                                     | Resposta                                  |
| -------------------------------------------- | ----------------------------------------- |
| `GROWTH_PREMIUM_BILLING_ENABLED` desligado   | 503 `ServiceUnavailable`                  |
| Body inválido                                | 422 `UnprocessableEntity` com `issues`    |
| Sem garagem, ou `pickLiveMembership` vazio   | 404 `NotFound`                            |
| `provider !== 'stripe'`                      | 409 `NotStripeSubscription` + `manageUrl` |
| `status` fora de `active`/`cancel_scheduled` | 409 `InvalidStatus` com `status`          |
| Slug desconhecido ou inativo                 | 404 `PlanNotFound`                        |
| Plano sem `stripePriceId` para a cadência    | 404 `PlanNotFound`                        |
| `cadence === 'annual'` com add-on anexado    | 422 `AnnualCadenceAddonUnsupported`       |
| Mesmo tier e mesma cadência                  | 409 `NoChange`                            |

O guard de preço é checado **na rota**, não delegado ao `changePlan`. Delegar
produz `PlanPriceMissing` em 422, que nenhum mapeamento de cliente cobre e que
vira "tente novamente" num erro que nunca passa. É alcançável de verdade:
`monthlyPriceCents` (`tier-visual.ts:90-94`) cai no primeiro preço quando não há
linha mensal, então a tela mostra preço e CTA para um plano que só tem anual.

O guard de cadência anual reusa a mesma verificação do checkout
(`me-premium.ts:122-133`). Sem ele, a Stripe recusa a mistura de intervalos, o
erro não é `BillingActionError`, escapa do `catch` e vira 500.

**Serialização — corrigido depois do review da Task 5.** A versão anterior desta
spec mandava rodar o guard e o `changePlan` dentro de uma transação que trava a
linha de `Garage` com `SELECT ... FOR UPDATE`. Isso estava errado, por três
motivos que o review levantou e que eu confirmei no código.

Primeiro, o lock não serializa nada. A transação não escreve linha nenhuma, e
`changePlan` também não — a invariante desta spec é justamente que só o webhook
grava. Sem escrita, não existe token que o segundo request possa observar: ele
adquire o lock, relê a membership, encontra o mesmo `gold`/`monthly` de antes,
passa o `NoChange` e chega na Stripe com a chave dele. As duas trocas aplicam,
exatamente como aplicariam sem lock.

Segundo, o caso que o lock cobriria já está coberto. Dois requests para o
**mesmo** plano alvo leem o mesmo `updatedAt`, produzem a mesma chave de
idempotência, e a Stripe deduplica. O lock é redundante onde funciona e
impotente onde importaria.

Terceiro, o custo é um bug que este repo já cometeu e já consertou.
`apps/api/src/routes/admin/refunds.ts:49-60` documenta o fix round 2 da mesma
classe: chamada Stripe dentro da transação, timeout padrão de 5s do Prisma
(`packages/db` não define `transactionOptions`), e uma chamada **aceita** que
responde em mais de 5s aborta com P2028. Aqui o estrago seria: a troca acontece
na Stripe, o membro recebe 500, e o `recordAudit` — que roda depois da
transação — nunca grava. Uma troca real sem rastro nenhum. Pior, o lock da
`Garage` é o mesmo que `stripe-billing-webhook.ts:434` pede, então a rota
bloquearia a ingestão do webhook que ela própria dispara.

Regra desta spec: **nenhuma chamada à Stripe dentro de transação.** Os guards
leem, a transação fecha, e só então `changePlan` roda.

Isso deixa a corrida entre planos alvo diferentes em aberto, e isso é
consciente. Serializar de verdade exige um token persistido — uma linha de
claim seguida de settle, que é o desenho do `refunds.ts` e do checkout nativo,
onde a `PremiumSubscriptionAttempt` faz esse papel. A troca de plano não tem
linha equivalente, criar uma é desenho novo, e fica como trabalho próprio fora
desta spec. O dano da corrida em aberto é um membro que toca em dois planos
diferentes em segundos receber o último; o dano do lock era troca silenciosa sem
auditoria e webhook bloqueado.

**Erros.** Mapa explícito de `BillingActionCode` para resposta, dentro da rota,
como `me-premium-addons.ts:200-216` já faz e documenta. Repassar `err.code` cru
expõe ao membro `PlanPriceMissing` ("target plan has no stripePriceId
configured") e `AmbiguousPlanItem` ("expected exactly one plan item, found N"),
que são estado de operador.

O helper `sendBillingError` do admin é privado de módulo
(`admin/subscriptions.ts:64`) e recebe `FastifyReply`. Ele pode ser
compartilhado, mas **não** dentro de `services/billing/errors.ts`, cujo
cabeçalho declara que aquela camada não conhece Fastify. Vai para um módulo de
camada de rota.

O código devolvido para provider errado é `NotStripeSubscription`, e não o
`ProviderNotMutable` do admin, para casar com o que `/cancel` já devolve ao
membro nessa mesma situação.

Resposta `200 { ok: true, pending: true }`. A rota não escreve em
`PremiumMembership`: quem grava tier, cadência e snapshot é o webhook
`customer.subscription.updated`, normalizado para `subscription.tier_changed`.

`recordAudit` com `actorId` do próprio membro, ação
`premium.subscription.plan_changed`, e `actorKind: 'member'` no metadata. Sem o
discriminador, a mesma ação com o mesmo `entityType` deixa de responder quem
trocou. `AdminAudit.actorId` é `String` sem FK, então não há impedimento
técnico.

## 3. Chave de idempotência de `changePlan`

`plan_change_${membershipId}_${tier}_${cadence}` (`subscription-actions.ts:85`).
Gold para silver, silver para gold, gold para silver de novo dentro das 24h em
que a Stripe guarda chaves: a terceira chamada reusa a chave da primeira com
parâmetros idênticos, recebe a resposta em cache, e a assinatura não muda.
Nenhum webhook dispara, o poll estoura, e a tela cai em pendente sem que nada
tenha acontecido.

Correção: incluir `membership.updatedAt.getTime()` na chave. O campo existe
(`schema.prisma:416`) e é escrito por `applyMembershipEvent` quando o webhook
aplica a mudança.

Duas ressalvas honestas sobre o alcance dessa correção:

- `updatedAt` também é bumpado por escritas não relacionadas.
  `recomputeAddonsAmount` (`addons.ts:30-44`) atualiza `PremiumMembership` em
  todo attach e detach. Um membro que mexe num módulo entre dois toques de troca
  rotaciona a chave e perde o dedupe. O dano é baixo, porque reaplicar o mesmo
  price não gera rateio novo, mas a rede é mais frouxa do que "duplo toque
  sempre deduplica".
- O fake da Stripe **não implementa idempotência**
  (`services/stripe/fake.ts:341-343` só registra a chamada). Nenhum teste do
  repo pode provar que a Stripe deduplicou. Os testes desta spec afirmam a
  **forma da chave**, que é o que está sob nosso controle, e isso precisa estar
  escrito para ninguém confundir o teste com prova de comportamento.

As chaves de add-on entram na mesma correção, e a justificativa anterior para
deixá-las quietas era falsa: `addon_detach_${addon.id}` **não** é nova a cada
re-vínculo, porque o re-vínculo faz `update` da linha existente
(`addons.ts:121-126`), preservando o id. Com a decisão de permitir re-vínculo a
partir de `cancel_scheduled`, isso deixa de ser teórico: attach, detach, attach,
detach do mesmo módulo em 24h repete a chave. As duas chaves de add-on passam a
carregar o `updatedAt` da linha.

## 4. App — tela de confirmação da troca

Nenhuma troca acontece sem uma tela que diga, antes, exatamente o que vai mudar.
Não é sheet e não é diálogo. É tela, e a chamada de rede só sai do toque no CTA.

### Entradas

`PlanosScreen` com `?all=1`: o card do plano atual ganha selo `SEU PLANO ATUAL`
e CTA inerte; os demais dizem `TROCAR PARA {TIER}` e levam a
`/assinaturas/alterar?slug={slug}`.

`ContratarScreen` redireciona para `/assinaturas/alterar?slug=` quando há
membership viva **e** o status permite trocar. Para `past_due` e `paused` ela
mantém o caminho atual, que termina no 409 `AlreadySubscribed` com o link
`GERENCIAR ASSINATURA` para o portal da Stripe: é onde se troca o cartão que
falhou. Redirecionar esse membro para uma tela sem CTA tiraria dele a única
saída que existe hoje.

`PlanoDetalheScreen` empurra hoje para `/assinaturas/contratar?slug=` de
**qualquer** plano, inclusive o do próprio membro. Passa a seguir a mesma regra
das outras entradas.

### `AlterarPlanoScreen`, em `/assinaturas/alterar`

Lê `subscription` de `usePremiumSubscription` e o plano alvo de
`getPremiumPlan(slug)`. Nada é mutado na montagem.

Recusa antes de renderizar o CTA, em ordem:

- `slug === subscription.planSlug`: não há troca a confirmar. Volta para Minha
  Assinatura.
- `provider !== 'stripe'`: bloco da App Store com link.
- `status` fora de `active`/`cancel_scheduled`: estado bloqueado com a copy de
  cobrança pendente **e o link do billing-portal**, que é a ação que resolve.
- `subscriptionsEnabled` false: bloco de indisponível.
- Plano alvo sem preço para `subscription.cadence`: bloco explicando que o plano
  não está disponível nessa periodicidade.

Conteúdo:

- Header `ALTERAR ASSINATURA`, com voltar.
- `DE` e `PARA`: os dois planos, com tier, nome e valor **da cadência vigente**.
  O rótulo segue `subscription.cadence`: "Valor mensal de hoje" ou "Valor anual
  de hoje". `baseAmountCents` é o snapshot da cadência contratada; chamar de
  "mensalidade" um snapshot anual erra por um fator de doze numa tela cujo
  trabalho é mostrar o número certo.
- `O QUE MUDA NO VALOR`: valor de hoje, valor novo, diferença com sinal, módulos
  mantidos somados, total depois da troca.
- `O QUE VOCÊ GANHA` e `O QUE VOCÊ PERDE`: diff entre os benefícios do plano
  alvo e `subscription.benefits`. A seção de perda só aparece quando há perda, e
  é o que justifica a tela existir num downgrade.
- `SEUS MÓDULOS CONTINUAM`: add-ons com `status === 'active'`, com valor de
  `monthlyDeltaCents`. Filtrar por `active` é obrigatório: o GET inclui
  `cancel_scheduled` na lista, mas `addonsAmountCents` soma só `active`
  (`me-premium-addons.ts:37`, `addons.ts:34-38`). Sem o filtro, a tela lista um
  módulo como "continua", com preço, que não entra no total.
- `QUANDO VALE`: a formulação única de rateio, com a ressalva de borda de ciclo.
- Linha do cancelamento agendado quando `cancelAtPeriodEnd`.
- CTA `CONFIRMAR ALTERAÇÃO` e secundário `VOLTAR`.

Sem sheet por cima: a tela é a confirmação explícita, e empilhar um "tem
certeza?" depois dela só treina o membro a tocar sem ler.

Confirmado: `POST` com `cadence: subscription.cadence` →
`pollSubscriptionTier(tier, cadence)` → Minha Assinatura com toast. Poll
estourado cai no estado pendente.

O poll compara **tier e cadência**. Comparar só o tier faz uma troca que não
muda o tier resolver `true` na primeira tentativa, antes de qualquer webhook, e
mostrar sucesso para uma mudança que não aconteceu.

Anti duplo toque por ref checada e setada no mesmo tick, antes do primeiro
`await`, como `ContratarScreen` e `MinhaAssinaturaScreen` já fazem.

## 5. App — editar módulos

Os endpoints são síncronos e escrevem o banco na hora. Não há webhook nem poll.

- `POST /api/me/premium/addons` devolve 201.
- `DELETE /api/me/premium/addons/:addonKey` devolve 200, remove o item da Stripe
  na hora e marca `cancel_scheduled`. A cota do ciclo continua utilizável até o
  fim do período, e o redeem de staff aceita add-on nesse status
  (`admin/premium-redemptions.ts:35-50` olha ciclo aberto, não status).

Antes de expor qualquer botão, três correções de servidor (ver Decisões):

1. Attach valida status, mesma lista da troca de plano.
2. Attach e detach validam provider.
3. DELETE entra no escopo com rate limit. Hoje ele está fora
   (`me-premium-addons.ts:226` registra em `app`, e o bucket das linhas 269-284
   cobre só o POST), e cada chamada bate na Stripe de verdade.

E uma de serviço: `addons.ts:82` passa a aceitar re-vínculo a partir de
`cancel_scheduled`.

`MinhaAssinaturaScreen`:

- Módulo `active` ganha `REMOVER`.
- Módulo `cancel_scheduled` mantém o rótulo atual e ganha `REATIVAR`.
- Bloco `MÓDULOS DISPONÍVEIS` com o catálogo menos o que já está anexado. Ele
  precisa aparecer **mesmo com zero add-ons**; hoje a seção inteira só renderiza
  quando `sub.addons.length > 0` (`MinhaAssinaturaScreen.tsx:251`).

As três ações confirmam em `SheetShell` antes de qualquer chamada, sempre com
números:

- Adicionar: valor mensal do módulo, total novo, a frase única de rateio, e a
  cota que passa a ter.
- Remover: a cobrança para agora, o total cai para X, a cota vale até o fim do
  ciclo, e **dá para reativar depois**.
- Reativar: o valor volta a ser cobrado, com rateio, e o total sobe para X.

Depois de cada mutação, `refresh()` do `usePremiumSubscription`, em vez dos
totais da resposta: eles estão certos, mas não trazem o ciclo de uso.

Gate: `ADICIONAR` e `REATIVAR` seguem `subscriptionsEnabled`. `REMOVER` não.
Mesma divisão que a API faz.

## Copy

Em `apps/mobile/src/copy/assinaturas.ts`, com twin EN para **cada** chave nova.
O arquivo declara que só as chaves criadas a partir de 2026-08-29 carregam twin,
e todas as desta spec são novas.

Blocos: `alterar` e `minhaAssinatura.modulos`.

A frase de rateio é a peça mais delicada, e é **uma só**, usada na troca de
plano e nas três ações de módulo:

> A mudança vale assim que você confirmar. Nada é cobrado agora: a diferença
> proporcional entra na sua próxima fatura, que pode ser a que fecha neste
> ciclo.

## Testes

API, integração com Postgres real:

- Cada linha da tabela de guards da seção 2, incluindo `past_due` recusado,
  `annual` com add-on recusado, e plano sem preço na cadência.
- Os guards que não chegam à Stripe afirmam `stripe.calls` vazio, não só que o
  `updateSubscriptionItemPrice` não rodou.
- Caminho feliz devolvendo `pending` e não escrevendo em `PremiumMembership`.
- A **forma** da chave de idempotência muda quando a membership muda, e repete
  quando não muda. Não é possível afirmar dedupe real: o fake não implementa
  idempotência.
- Attach recusado para `past_due`, `paused` e provider Apple.
- Re-vínculo a partir de `cancel_scheduled` funciona e recria o item na Stripe.

Mobile:

- `AlterarPlanoScreen`: o diff nos dois sentidos, os números do bloco de valor
  com membership anual, a recusa de cada desvio, e a prova de que nenhuma
  chamada de mutação sai antes do CTA. O duplo toque precisa ser dois cliques
  **dentro de um único `act`**, sem flush entre eles, senão um guard baseado em
  state passaria e o teste não provaria nada.
- `MinhaAssinaturaScreen`: as três ações, os sheets aparecendo antes da chamada
  com os números formatados, o gate, o guard de provider, e o refresh.

## Riscos e o que fica em aberto

**O diff de benefícios compara rótulos.** São strings do banco, sem id estável
na resposta. Dois benefícios equivalentes escritos diferente aparecem como um
perdido e um ganho. Quem editar a redação de um benefício precisa saber que esta
tela usa o texto como identidade.

**O rateio não é mostrado em reais.** A tela diz que a diferença entra na
próxima fatura, mas não calcula o valor. Calcular exigiria uma prévia da Stripe,
que não existe em nenhum ponto do código. A copy fica qualitativa por escolha.

**`paused` fica sem caminho.** É status vivo, a assinatura aparece, a troca é
recusada, e não há ação de retomar para o membro (`resumeCollection` é
admin-only). Para o membro pausado a tela é informativa.

**A troca depende do webhook para virar verdade.** Se o
`customer.subscription.updated` atrasar além do teto do poll, o membro vê
pendente mesmo com a troca aplicada na Stripe. É o custo de manter a invariante.

**Trocar de cadência continua sem caminho no app.** Fora de escopo por decisão,
e o endpoint rejeita o caso perigoso. Um membro anual que queira virar mensal
não tem como, e isso é uma lacuna conhecida, não um descuido.
