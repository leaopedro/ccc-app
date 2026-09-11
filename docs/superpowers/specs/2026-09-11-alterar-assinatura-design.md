# Alterar assinatura e editar módulos

Data: 2026-09-11
Status: aguardando revisão do autor

## Problema

Um membro com assinatura viva não consegue mudar nada da assinatura pelo app,
exceto cancelar.

O caminho que parece existir é uma armadilha. De `MinhaAssinaturaScreen`, o
botão `VER TODOS OS PLANOS` leva a `/assinaturas?all=1`, dali para
`ContratarScreen`, onde o membro escolhe módulos e vê o total recalcular. Só ao
tocar `IR PARA O PAGAMENTO` ele descobre que não pode: `POST
/api/me/premium/checkout` responde `409 AlreadySubscribed`
(`apps/api/src/routes/me-premium.ts:435` no caminho hospedado, `:673` no
nativo). A tela mostra um banner vermelho e um link `GERENCIAR ASSINATURA` que
abre o portal da Stripe no browser, que só troca plano se estiver configurado
para isso no dashboard.

O 409 está certo. O índice único parcial `premium_membership_live_per_garage`
cobre `active`, `past_due` e `cancel_scheduled`, então deixar o checkout passar
criaria uma segunda assinatura viva ou estouraria no banco. O que falta não é
afrouxar o guard, é uma ação de troca.

No servidor ela existe e está correta: `changePlan`
(`apps/api/src/services/billing/subscription-actions.ts`) troca o preço do item
de plano com `create_prorations` e não escreve no banco, deixando o webhook
gravar. Mas só é alcançável por `POST /api/admin/subscriptions/:id/plan`
(`apps/api/src/routes/admin/subscriptions.ts:230`), atrás de `requireRole`.

O mesmo vale para os módulos, com um agravante. `POST /api/me/premium/addons` e
`DELETE /api/me/premium/addons/:addonKey` já existem, são de membro, e o app
nunca os chama. `apps/mobile/src/copy/assinaturas.ts` promete, em
`modules.footnote`, que o membro "poderá adicionar módulos durante a contratação
ou depois, em Minha Assinatura". A segunda metade dessa frase é falsa hoje.

## Escopo

Dentro:

- `POST /api/me/premium/plan`: troca de plano iniciada pelo membro.
- Dois campos novos em `mySubscriptionResponseSchema`: `status` e `provider`.
- Correção da chave de idempotência de `changePlan`, que serve admin e membro.
- Tela de confirmação da troca, `AlterarPlanoScreen`, e as entradas para ela em
  `PlanosScreen` e `ContratarScreen`.
- UI de adicionar e remover módulo em `MinhaAssinaturaScreen`, sobre os
  endpoints que já existem.
- Copy PT-BR nova, com os twins EN que a regra de `copy/assinaturas.ts` pede.

Fora, e deliberadamente:

- Variante de alteração na tela de boas-vindas. A troca termina em Minha
  Assinatura com toast. Decisão do autor: personalizar só a contratação.
- Desfazer cancelamento de assinatura (`resumeCancel` segue admin-only).
- Trocar cartão pelo app. `POST /api/me/premium/billing-portal` continua órfão.
- Desfazer a remoção de um módulo dentro do mesmo ciclo. Ver Riscos.
- Qualquer mudança no fluxo de compra nova, incluindo a boas-vindas recém-feita.
- Troca de plano para membership Apple. Continua na App Store.

## Decisões

**Módulos não entram na troca de plano.** A ação muda só o item de plano. Os
módulos anexados seguem anexados e cobrados, e a tela de alteração os mostra
como mantidos. Editar módulo é a outra superfície desta spec, com endpoint
próprio e sem poll.

**A troca vale na hora, com rateio na fatura seguinte.** É exatamente o que
`changePlan` já faz via `updateSubscriptionItemPrice` com `create_prorations`.
Nenhum código novo de Stripe, nenhum estado de troca agendada, e o mesmo
comportamento que o admin já produz.

**Só troca quem está em dia.** `active` e `cancel_scheduled`. Um membro
`past_due` regulariza a cobrança antes. Isso é mais estrito que
`ADMIN_SUBSCRIPTION_ALLOWED_STATUS.plan`
(`packages/shared/src/admin-subscription.ts:44`), que também aceita `past_due`.
A regra de membro é declarada separadamente, com um comentário apontando para a
do admin e dizendo por que diverge, em vez de reusar a constante e mentir sobre
a intenção.

**Quem troca de plano com cancelamento agendado continua agendado.**
`changePlan` não mexe em `cancel_at_period_end`. A tela diz isso.

**A resposta da troca é `pending`, a do módulo é final.** São contratos
diferentes e a UI trata cada um do seu jeito. Ver seções 2 e 5.

## 1. Contrato compartilhado

`mySubscriptionResponseSchema`
(`packages/shared/src/premium-subscription.ts`) ganha dois campos:

```ts
status: z.enum([...LIVE_MEMBERSHIP_STATUSES]).nullable(),
provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
```

Ambos `null` quando não há membership viva, junto com os outros campos nulos que
o endpoint já devolve nesse caso. Os status saem de `LIVE_MEMBERSHIP_STATUSES`
(`packages/shared/src/premium.ts:167`), espalhado porque a constante é readonly.
Os valores de provider são os do enum `PremiumProvider` do Prisma
(`schema.prisma:259`), `stripe` e `apple_revenuecat`, escritos na mão pelo mesmo
motivo que `premiumCheckoutPrecheckResponseSchema` já os escreve assim
(`packages/shared/src/premium.ts:61`): `@ccc/shared` não depende do client do
Prisma.

Por que os dois são necessários:

- `status`: hoje `active: true` é devolvido para qualquer membership viva,
  incluindo `past_due`, `paused` e `cancel_scheduled`
  (`apps/api/src/routes/me-premium-addons.ts`, ramo que serializa
  `active: true`). O app não consegue distinguir, então não consegue aplicar a
  regra de elegibilidade nem explicar a recusa.
- `provider`: para membership que não é Stripe, `attachAddon` cai no caminho
  local-only (`apps/api/src/services/billing/addons.ts:98-108`): grava o módulo
  no banco, loga, e não cobra nada. Expor o botão `ADICIONAR` para um assinante
  Apple entregaria módulo pago de graça. Sem `provider` no payload, a tela não
  tem como se proteger.

Campos aditivos. Binário antigo em campo ignora os dois e segue funcionando,
mesmo cuidado que a resposta de `getPremiumPlan` já documenta em
`ContratarScreen.tsx`.

## 2. `POST /api/me/premium/plan`

Arquivo: `apps/api/src/routes/me-premium.ts`, junto das outras ações de membro.

PreHandlers: `app.authenticate`, `requireSubscriptionsEnabled` e rate limit por
usuário autenticado. Trocar de plano é entrada de compra, então segue o gate de
plataforma pelo mesmo motivo que `/checkout` e o attach de módulo seguem. O
bucket de rate limit usa `keyGenerator` sobre `req.user?.sub`, com o hook em
`preHandler`, pelo motivo já documentado em
`apps/api/src/routes/me-premium-addons.ts:270-273`.

Body: `memberChangePlanRequestSchema` novo, `{ planSlug: string, cadence:
'monthly' | 'annual' }`. `planSlug` e não `tier` porque é o vocabulário que o
mobile já usa em `startPremiumCheckout`. O plano é resolvido por slug e o `tier`
sai dele; `PremiumPlan` é único por tier, como `changePlan` assume ao fazer
`findUnique({ where: { tier } })`.

Guards, nesta ordem:

| Condição                                             | Resposta                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `GROWTH_PREMIUM_BILLING_ENABLED` desligado           | 503 `ServiceUnavailable`                               |
| Body inválido                                        | 422 `UnprocessableEntity` com `issues`                 |
| Sem garagem, ou `pickLiveMembership` vazio           | 404 `NotFound`                                         |
| `provider !== 'stripe'`                              | 409 `NotStripeSubscription` + `manageUrl` da App Store |
| `status` fora de `active`/`cancel_scheduled`         | 409 `InvalidStatus` com `status` no corpo              |
| Slug desconhecido, inativo, ou sem preço na cadência | 404 `PlanNotFound`                                     |
| Mesmo tier e mesma cadência                          | 409 `NoChange`                                         |

Passando, chama `changePlan({ membershipId, tier, cadence, stripe })` e traduz
`BillingActionError` com o mesmo `sendBillingError` que o admin usa, para os
códigos não divergirem entre as duas superfícies. Resposta `200 { ok: true,
pending: true }`.

A rota não escreve em `PremiumMembership`. Quem grava tier, cadência e o
snapshot de preço é o webhook `customer.subscription.updated`, normalizado para
`subscription.tier_changed` e aplicado por `applyMembershipEvent`. É a mesma
invariante que `/cancel` já respeita, e é o motivo de a resposta ser `pending` e
não o estado novo.

`recordAudit` com `actorId` igual ao próprio membro e ação
`premium.subscription.plan_changed`, a mesma do admin, com `fromTier`,
`fromCadence`, `toTier`, `toCadence` no metadata. Auditoria de troca de plano
não pode existir só quando quem troca é o staff.

## 3. Chave de idempotência de `changePlan`

`changePlan` usa `plan_change_${membershipId}_${tier}_${cadence}`
(`apps/api/src/services/billing/subscription-actions.ts:85`). A chave é estável
demais, e o defeito fica muito mais alcançável quando quem dispara é o membro.

Cenário: gold para bronze, bronze para gold, gold para bronze de novo, tudo
dentro da janela de 24h em que a Stripe guarda chaves. A terceira chamada reusa
a chave da primeira, com parâmetros idênticos. A Stripe devolve a resposta
gravada em cache e não altera a assinatura. Nenhum webhook dispara, o poll do
app estoura, e a tela cai no estado pendente sem que nada tenha mudado. O membro
acredita que trocou.

Correção: incluir `membership.updatedAt` na chave. O campo existe
(`packages/db/prisma/schema.prisma:415`) e é bumpado sempre que o webhook aplica
uma mudança. Duplo toque antes do webhook chegar reusa a mesma chave, que é
exatamente o que a idempotência deve proteger. Depois que a troca é aplicada, o
`updatedAt` muda e a próxima troca ganha chave nova.

Vale para admin e membro, é o mesmo arquivo, e o admin tem hoje o mesmo defeito.

As chaves de add-on (`addon_attach_${membershipId}_${addonKey}`,
`addon_detach_${addonId}`) não têm esse problema do mesmo jeito e ficam como
estão: o attach só é alcançável quando o add-on não está anexado, e o detach é
chaveado pelo id da linha, que é novo a cada re-vínculo.

## 4. App — tela de confirmação da troca

Nenhuma troca acontece sem uma tela que diga, antes, exatamente o que vai mudar.
Não é sheet e não é diálogo. É tela, com tudo escrito, e a chamada de rede só
sai do toque no CTA dela.

### Entradas

`PlanosScreen` com `?all=1`: o card do plano atual ganha selo `SEU PLANO ATUAL`
e CTA inerte, e os demais passam a dizer `TROCAR PARA {TIER}`, levando a
`/assinaturas/alterar?slug={slug}`. Sem `?all=1` o redirect para Minha
Assinatura continua como está (`PlanosScreen.tsx:214-217`).

`ContratarScreen` passa a redirecionar para `/assinaturas/alterar?slug=` quando
`subscription.active` é true. Hoje ela deixa um assinante montar o pacote
inteiro para só então bater no 409. O redirect fecha esse beco, inclusive para
quem chega por deep link.

`ContratarScreen` não ganha modo alterar. Ela é um montador de pacote com
toggles de módulo e CTA de checkout; na troca quase tudo difere, do conteúdo ao
endpoint ao poll. Uma tela própria evita uma tela fazendo dois trabalhos.

### `AlterarPlanoScreen`, em `/assinaturas/alterar`

Lê `subscription` de `usePremiumSubscription` e o plano alvo de
`getPremiumPlan(slug)`. As duas leituras acontecem na montagem. Nada é mutado
aqui.

Conteúdo, de cima para baixo:

- Header `ALTERAR ASSINATURA`, com voltar.
- `DE` e `PARA`: os dois planos lado a lado, com tier, nome e mensalidade.
- `O QUE MUDA NO VALOR`: mensalidade de hoje, mensalidade nova, a diferença com
  sinal, os módulos mantidos somados, e o total por mês depois da troca.
- `O QUE VOCÊ GANHA` e `O QUE VOCÊ PERDE`: o diff entre a lista de benefícios do
  plano alvo e `subscription.benefits`. A seção de perda só aparece quando há
  perda, e é a que justifica a tela existir: num downgrade é o único lugar onde
  o membro vê o que está abrindo mão antes de confirmar.
- `SEUS MÓDULOS CONTINUAM`: os add-ons anexados, com valor. Eles não mudam.
- `QUANDO VALE`: vale imediatamente; nada é cobrado agora; a diferença
  proporcional entra como crédito ou débito na próxima fatura.
- Se `cancelAtPeriodEnd` for true: uma linha dizendo que o cancelamento agendado
  continua de pé, porque `changePlan` não mexe nisso.
- CTA `CONFIRMAR ALTERAÇÃO` e um secundário `VOLTAR`.

Sem sheet de confirmação em cima. A tela inteira é a confirmação explícita, e
empilhar um "tem certeza?" depois de uma tela que já detalha tudo só treina o
membro a tocar sem ler.

Desvios, avaliados na montagem, antes de qualquer chamada de mutação, com os
campos novos do payload:

- `provider !== 'stripe'`: a tela troca o CTA por um bloco mandando gerenciar na
  App Store, com link. Nenhuma chamada sai.
- `status` fora de `active`/`cancel_scheduled`: estado próprio pedindo para
  regularizar a cobrança, sem CTA.
- `subscriptionsEnabled` false: a entrada não aparece em `PlanosScreen`, e a
  rota, se alcançada por deep link, renderiza o mesmo bloco de indisponível que
  `ContratarScreen` já usa. Mesma regra que hoje esconde `VER TODOS OS PLANOS`.

Confirmado, o fluxo é: `POST` → `pollSubscriptionTier` → Minha Assinatura com
toast `Plano alterado.`. Se o poll estourar, o mesmo estado pendente da compra,
porque o webhook ainda pode chegar depois.

Duplo toque no CTA é barrado por ref checada e setada no mesmo tick, antes do
primeiro `await`, como `ContratarScreen` e `MinhaAssinaturaScreen` já fazem. O
estado de `submitting` serve só para rótulo e disabled.

`pollSubscriptionTier(targetTier, targetCadence)` é novo, ao lado de
`pollSubscriptionActive` em `poll-subscription.ts`, com o mesmo intervalo e o
mesmo teto de tentativas. O poller atual só sabe dizer se existe assinatura
viva, e nessa troca ela existe o tempo todo.

Cliente: `changePremiumPlan()` em `apps/mobile/src/api/premium.ts`, e
`plan-change-error.ts` mapeando os status da tabela da seção 2 para copy
acionável, espelhando `checkout-error.ts`.

## 5. App — editar módulos

Os endpoints são síncronos e escrevem o banco na hora, diferente da troca de
plano. Não há webhook nem poll. A resposta é a verdade.

A assimetria entre as duas ações é deliberada no servidor e a copy precisa
respeitá-la:

- `POST /api/me/premium/addons` devolve 201. Adiciona o item na Stripe e cobra
  com rateio.
- `DELETE /api/me/premium/addons/:addonKey` devolve 200. Remove o item da
  Stripe na hora, mas marca o add-on como `cancel_scheduled`, e a cota do ciclo
  continua utilizável até o fim do período
  (`apps/api/src/services/billing/addons.ts:205-211`).

`MinhaAssinaturaScreen`, na seção `MÓDULOS` que já existe:

- Módulo com status `active` ganha `REMOVER`.
- Módulo com status `cancel_scheduled` mantém o rótulo atual e não oferece ação.
- Bloco novo `MÓDULOS DISPONÍVEIS`, com o que está no catálogo e não está
  anexado, cada um com preço e `ADICIONAR`. O catálogo vem de
  `usePremiumAddonModules`, que já existe.

As duas ações também passam por confirmação explícita antes de qualquer
chamada, pela mesma regra da seção 4. Aqui a confirmação é um `SheetShell` e não
uma tela, porque o que muda cabe em quatro linhas e é reversível no ciclo
seguinte, ao contrário da troca de plano. O que o sheet precisa dizer, sempre em
números, nunca em generalidade:

- Adicionar: o valor mensal do módulo, o total por mês depois da adição, que a
  cobrança começa agora com rateio, e a cota que ele passa a ter no ciclo.
- Remover: que a cobrança para imediatamente, que o total por mês cai para X,
  que a cota continua utilizável até o fim do ciclo atual, e que **não dá para
  desfazer antes disso**.

Depois de cada mutação, `refresh()` do `usePremiumSubscription`, em vez de
aplicar os totais da resposta no estado local. Os totais da resposta estão
certos, mas não trazem o ciclo de uso do add-on novo, e a tela inteira precisa
ficar coerente.

Gate: `ADICIONAR` segue `subscriptionsEnabled`, é compra. `REMOVER` não segue.
É a mesma divisão que a API já faz, com `requireSubscriptionsEnabled` só no POST
(`me-premium-addons.ts:281-285`).

Guard de provider: com `provider !== 'stripe'`, nem `ADICIONAR` nem `REMOVER`
aparecem, e a seção mostra uma linha mandando gerenciar pela App Store. Sem
isso, o caminho local-only do `attachAddon` entrega módulo pago sem cobrança.

Mapeamento de erro em `addon-error.ts`: 409 `AddonAlreadyAttached`, 409
`NoActiveMembership`, 404 `ModuleNotFound`, 404 `AddonNotAttached`, 429 do
bucket de 20 por minuto, 503 do billing desligado.

## Copy

Tudo em `apps/mobile/src/copy/assinaturas.ts`, com twin EN para cada chave nova,
conforme a regra do próprio arquivo.

Blocos novos: `alterar` (header, rótulos de `DE`/`PARA`, os títulos das seções
de valor, ganho, perda e módulos mantidos, a frase de vigência e rateio, a linha
do cancelamento agendado, CTA, os dois desvios, sucesso e pendente) e `modulos`
dentro de `minhaAssinatura` (título do bloco disponível, adicionar, remover, os
dois sheets com os números, erros).

A copy de vigência é a peça que mais importa acertar: ela precisa dizer que nada
é cobrado agora e que a diferença aparece na próxima fatura. Qualquer formulação
que sugira cobrança imediata está errada, porque `create_prorations` não cobra
fora do ciclo.

`modules.footnote` fica como está. Com a seção 5, ela passa a ser verdade.

## Testes

API, integração com Postgres real, conforme o mandato do `CLAUDE.md`:

- Cada linha da tabela de guards da seção 2, incluindo `past_due` recusado, que
  é onde a regra de membro diverge da do admin.
- Caminho feliz devolvendo `pending` e não escrevendo em `PremiumMembership`.
- Duplo toque na mesma troca: uma chamada só à Stripe.
- Troca, webhook aplicado, nova troca de volta ao plano anterior: a segunda
  troca precisa chegar à Stripe, que é a regressão da seção 3.
- Attach e detach já têm suíte; acrescentar o que a UI passa a depender.

Mobile, vitest:

- `PlanosScreen`: selo do plano atual, rótulo `TROCAR PARA`, CTA inerte no card
  atual.
- `ContratarScreen`: assinante ativo é redirecionado para `/assinaturas/alterar`
  em vez de montar pacote.
- `AlterarPlanoScreen`: o diff de benefícios nos dois sentidos (upgrade sem
  bloco de perda, downgrade com ele), os números do bloco de valor, e a prova de
  que **nenhuma chamada de mutação sai antes do CTA**. Mais os quatro desfechos
  (sucesso, pendente, Apple, `past_due`) e o anti duplo toque.
- `MinhaAssinaturaScreen`: adicionar, remover, os dois sheets aparecendo antes
  da chamada, o gate em `ADICIONAR`, o guard de provider escondendo as duas
  ações, e o refresh após cada mutação.

## Riscos e o que fica em aberto

**Remover módulo não tem desfazer dentro do ciclo.** `attachAddon` recusa
re-anexar enquanto o status for `cancel_scheduled`, só aceita depois de
`cancelled` (`addons.ts:82-84`). Quem remover por engano espera o ciclo virar. A
copy do sheet diz isso com todas as letras. Corrigir de verdade é afrouxar o
guard e recriar o item na Stripe, o que é trabalho próprio e fica para um PR
separado.

**O diff de benefícios compara rótulos.** `subscription.benefits` e os
benefícios do plano alvo são strings do banco, sem id estável na resposta. O
diff é por igualdade de texto. Dois benefícios equivalentes escritos diferente
aparecem como um perdido e um ganho. É aceitável porque os rótulos vêm do mesmo
cadastro em `/premium/catalogo`, mas quem editar a redação de um benefício
precisa saber que essa tela usa o texto como identidade.

**O rateio não é mostrado em reais.** A tela diz que a diferença entra na
próxima fatura, mas não calcula o valor proporcional. Calcular exigiria uma
prévia da Stripe, que não existe em nenhum ponto do código hoje. A copy fica
qualitativa, e isso é uma escolha, não um esquecimento.

**`paused` fica sem caminho.** É status vivo, então a assinatura aparece, mas a
troca é recusada pela regra de elegibilidade e não há ação de retomar para o
membro (`resumeCollection` é admin-only). Para o membro pausado a tela vira
informativa. Aceito nesta spec.

**A troca depende do webhook para virar verdade.** Se o `customer.subscription
.updated` atrasar além do teto do poll, o membro vê o estado pendente mesmo com
a troca aplicada na Stripe. É o mesmo contrato da compra, e o custo de manter a
invariante de que só webhook verificado escreve assinatura.
