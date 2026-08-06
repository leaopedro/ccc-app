# Aba "Assinaturas" no painel administrativo — design

Data: 2026-08-05
Branch: `feat/assinaturas-controle-admin`
Status: design aprovado pelo usuário, incluindo os filtros de período de renovação e
de fornecedor pedidos depois da aprovação inicial

## Problema

O admin não tem controle operacional sobre as assinaturas dos membros. Hoje existem
duas telas parciais e nenhuma tela de detalhe:

- `/premium/catalogo` — CRUD do catálogo de planos e módulos, não de assinaturas
- `/financeiro/membros` — lista paginada de assinaturas, somente leitura

Falta ao admin: ver uma assinatura em detalhe, ver o método de pagamento, adicionar
e remover módulos de um membro, trocar o plano, e alterar o status.

Falta também controle dos módulos adicionais como serviços de terceiros. O schema
guarda o valor cobrado do cliente (`PremiumAddonModule.monthlyDeltaCents`) mas não
guarda o valor de repasse nem identifica o fornecedor.

## O que já existe e será reusado

Banco (`packages/db/prisma/schema.prisma`):

- `PremiumMembership` — a assinatura. Índice parcial `premium_membership_live_per_garage`
  garante uma assinatura viva por garagem
- `PremiumMembershipInvoice` — histórico de pagamentos por ciclo
- `PremiumPlan`, `PremiumPlanPrice`, `PremiumPlanBenefit` — catálogo de planos
- `PremiumAddonModule`, `PremiumMembershipAddon`, `PremiumAddonUsage`,
  `PremiumAddonRedemption` — módulos adicionais
- `SubscriptionWebhookEvent` — dedupe de webhook por `[provider, providerEventId]`

API (`apps/api`):

- `services/billing/apply-membership-event.ts` — máquina de estados. Contrato de lock:
  `SELECT id FROM "Garage" WHERE id = $garageId FOR UPDATE` na mesma transação, antes
  de aplicar o evento
- `services/billing/normalize-stripe.ts`, `normalize-revenuecat.ts` — normalizadores puros
- `routes/admin/index.ts` — composição de escopos com `requireRole`
- `services/admin-audit.ts` — `recordAudit`
- `GET /admin/finance/memberships` — lista de assinaturas com filtros e paginação

Admin (`apps/admin`):

- `src/lib/api.ts` — `apiFetch` com Bearer do cookie `session_access` e validação Zod
- `src/lib/admin-api.ts` — uma função por endpoint
- `app/(authed)/financeiro/membros/membros-table.tsx` — padrão de tabela, chips de
  filtro e paginação

## Invariante e decisão central

O invariante do projeto é que só webhooks verificados escrevem status de cobrança.
A `PremiumMembership` é escrita apenas por `applyMembershipEvent`, disparado por
webhook assinado.

**Decisão: modelo híbrido.**

- Assinatura Stripe: a ação do admin chama a Stripe. O webhook resultante grava no
  banco. O invariante permanece intacto
- Assinatura Apple/RevenueCat: somente leitura. Toda mutação responde 409. A Apple é
  a dona da assinatura e nossa API não pode mutá-la
- Concessão manual de premium continua no endpoint existente
  `POST /admin/users/:id/garage/premium`, que escreve o snapshot da `Garage` e não a
  `PremiumMembership`. Não é alterado por este trabalho

Consequência de UX: a alteração aparece na tela com atraso de segundos. A interface
mostra estado pendente e nunca aplica otimismo falso.

**Decisão: rateio.** Toda troca de plano e todo vínculo de módulo usa
`proration_behavior: 'create_prorations'`. A diferença proporcional entra como
crédito ou débito na fatura seguinte. Nenhuma cobrança imediata fora do ciclo. Isso
é o que o fluxo de módulos do membro já faz hoje, então não há divergência de
comportamento entre admin e membro.

## Seção 1 — Banco de dados

Uma migration. Seis colunas novas, nenhuma entidade nova, nenhuma coluna obrigatória.

`PremiumAddonModule`:

```prisma
payoutAmountCents Int     @default(0)
vendorName        String? @db.VarChar(120)
```

`PremiumMembershipAddon` recebe o snapshot, seguindo o padrão já usado para
`monthlyDeltaCents`, `quotaPerCycle`, `quotaUnit` e `currency`:

```prisma
payoutAmountCents Int     @default(0)
vendorName        String? @db.VarChar(120)
```

`PremiumMembership` recebe o snapshot de método de pagamento:

```prisma
paymentBrand String? @db.VarChar(20)
paymentLast4 String? @db.VarChar(4)
```

Margem por módulo é derivada em tempo de leitura, nunca persistida:
`monthlyDeltaCents - payoutAmountCents`.

O snapshot em `PremiumMembershipAddon` é load-bearing. Editar o repasse no catálogo
não deve alterar retroativamente o repasse de um módulo já vinculado, pelo mesmo
motivo que já vale para preço e cota.

Nome da migration: `<timestamp>_addon_payout_and_payment_method`.

Seed (`packages/db/prisma/seed.ts`): `PREMIUM_ADDON_MODULES` ganha `payoutAmountCents`
e `vendorName` nos dois módulos existentes, `detailing` e `oficina`. Valores de
repasse a definir pelo operador; o seed usa zero e `null` se não houver valor real,
para não inventar dado financeiro.

## Seção 2 — Backend

### 2.1 Extração de serviços

A lógica de vincular e desvincular módulo está hoje inline no handler de
`routes/me-premium-addons.ts`. Para o admin executar a mesma ação sem duplicar regra
de negócio, ela é extraída sem mudança de comportamento.

`apps/api/src/services/billing/addons.ts`:

```ts
attachAddon(input: {
  membershipId: string;
  addonKey: string;
  stripe: StripeClient;
  logger: FastifyBaseLogger;
}): Promise<{ status: PremiumAddonStatus; addonsAmountCents: number; totalAmountCents: number }>

detachAddon(input: {
  membershipId: string;
  addonKey: string;
  stripe: StripeClient;
  logger: FastifyBaseLogger;
}): Promise<{ status: PremiumAddonStatus; addonsAmountCents: number; totalAmountCents: number }>
```

Preserva integralmente: ordem provider-first (Stripe antes da transação), fallback
local-only sem lançar erro quando não há `providerSubRef` ou `stripePriceId`,
snapshot dos termos do módulo, abertura do ciclo de uso alinhada ao período da
assinatura, reaproveitamento de vínculo previamente cancelado, recálculo de
`addonsAmountCents` somando apenas módulos `active`, e `cancel_scheduled` em vez de
exclusão no desvínculo.

Passa a snapshotar `payoutAmountCents` e `vendorName`.

`routes/me-premium-addons.ts` fica fino: resolve garagem e assinatura viva, valida,
chama o serviço, responde. Erros de domínio viram exceções tipadas que a rota mapeia
para o status HTTP que ela já retorna hoje, de forma que os códigos de resposta do
endpoint do membro não mudam.

`apps/api/src/services/billing/subscription-actions.ts`:

```ts
changePlan(input: { membershipId: string; tier: GaragePremiumTier; cadence: PremiumCadence; stripe: StripeClient }): Promise<void>
scheduleCancel(input: { membershipId: string; stripe: StripeClient }): Promise<void>
resumeCancel(input: { membershipId: string; stripe: StripeClient }): Promise<void>
pauseCollection(input: { membershipId: string; stripe: StripeClient }): Promise<void>
resumeCollection(input: { membershipId: string; stripe: StripeClient }): Promise<void>
```

Nenhuma dessas funções escreve em `PremiumMembership`. Todas apenas chamam a Stripe.
O banco é escrito pelo webhook.

### 2.2 Identificação do item de plano

`changePlan` precisa trocar o preço do item de plano na assinatura Stripe. Não existe
"o item do plano" por posição: o comentário em `services/stripe/index.ts` documenta
que `current_period_end` é por item e que com módulos vinculados a ordem dos itens
não é contratual.

Resolução: carregar todos os `PremiumPlanPrice.stripePriceId` não nulos e todos os
`PremiumAddonModule.stripePriceId` não nulos. Recuperar a assinatura com
`retrieveSubscription`. O item de plano é aquele cujo `price.id` está no conjunto de
preços de plano. Se zero ou mais de um item casar, a operação aborta com erro e não
chama a Stripe. Adivinhar qual item é o plano em uma assinatura ambígua é pior do que
falhar visivelmente.

### 2.3 Cliente Stripe

`StripeClient` em `services/stripe/index.ts` ganha quatro métodos, com implementação
real e implementação em `services/stripe/fake.ts`:

```ts
updateSubscriptionItemPrice(input: { subscriptionItemId: string; priceId: string; idempotencyKey: string }): Promise<void>
resumeSubscriptionCancellation(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>
pauseSubscriptionCollection(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>
resumeSubscriptionCollection(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>
```

`updateSubscriptionItemPrice` passa `proration_behavior: 'create_prorations'`.
`pauseSubscriptionCollection` usa `pause_collection: { behavior: 'void' }`.
`resumeSubscriptionCollection` envia `pause_collection: null`.

Todas as chamadas carregam `idempotencyKey` derivada de `membershipId` e da ação,
seguindo o padrão já usado em `addon_attach_${membershipId}_${addonKey}`.

### 2.4 Máquina de estados: pausar e retomar

`PremiumMembershipStatus` já tem `paused`, mas nenhum `BillingEvent` produz esse
estado. É a única extensão real da máquina de estados neste trabalho, e a parte de
maior risco.

`services/billing/types.ts` ganha duas variantes:

```ts
| { kind: 'subscription.paused'; provider: PremiumProvider; providerSubRef: string }
| { kind: 'subscription.resumed'; provider: PremiumProvider; providerSubRef: string }
```

`normalize-stripe.ts`, dentro do bloco `customer.subscription.updated`, ganha um
discriminador de `pause_collection`, avaliado depois do flip de `cancel_at_period_end`
e antes do swap de preço:

- `previous_attributes.pause_collection` era null ou ausente e agora existe →
  `subscription.paused`
- `previous_attributes.pause_collection` existia e agora é null →
  `subscription.resumed`

`apply-membership-event.ts` ganha `handlePaused` e `handleResumed`, sob o mesmo
contrato de lock:

- `handlePaused` — status vira `paused`. Não toca no snapshot da `Garage`. O membro
  mantém a titularidade até `premiumUntil`, mesma escolha já feita para `past_due`
- `handleResumed` — status volta para `active`. Reaplica o snapshot da `Garage`
  com a regra de `max()` já usada em `handleRenewed` e `handleUncancelled`

O `switch` exaustivo com checagem `never` obriga o compilador a apontar os dois
novos casos, o que é a rede de segurança desta mudança.

`normalize-revenuecat.ts` não é alterado.

### 2.5 Método de pagamento

O caminho é o mesmo do resto do snapshot de cobrança, não um caminho novo.

`BillingPricing` em `services/billing/types.ts` ganha dois campos opcionais:

```ts
paymentBrand?: string;
paymentLast4?: string;
```

Ficam em `BillingPricing` porque ele já é o portador de snapshot em
`subscription.activated`, `subscription.renewed` e `subscription.tier_changed`, os três
eventos que já reescrevem os valores da assinatura. Nenhuma variante nova de
`BillingEvent`, nenhuma assinatura de função alterada.

`normalize-stripe.ts`, no bloco `invoice.paid`, preenche os dois campos **somente se o
payload já os trouxer**. O normalizador é uma função pura sem acesso à Stripe nem ao
banco, e isso não muda.

**Incerteza sinalizada.** No payload de `invoice.paid` o campo `payment_intent` vem
como id, não expandido, então na maioria dos casos a bandeira e o final do cartão
**não** estarão no evento. A resolução fica na rota, não no normalizador:
`stripe-billing-webhook.ts` chama `retrievePaymentIntent`, que já existe em
`StripeClient`, e lê `payment_method_details.card`. Uma chamada por fatura paga, em
webhook, fora do caminho de renderização.

Se a chamada falhar, o webhook **não** falha. Os campos ficam ausentes e o resto do
evento é aplicado normalmente. Método de pagamento é dado de conveniência para o
admin; perdê-lo não pode derrubar o processamento de uma cobrança.

A forma exata de `payment_method_details` na versão de API `2026-04-22.dahlia` precisa
ser confirmada contra o SDK durante a implementação. Se o campo não estiver acessível
por esse caminho, o fallback é a opção "derivar do provider", sem bandeira nem final,
e as duas colunas ficam sempre nulas até haver uma fonte confiável.

`normalize-revenuecat.ts` nunca preenche os dois campos.

`apply-membership-event.ts`, em `handleActivated` e `handleRenewed`, grava os dois
campos na `PremiumMembership` **apenas quando presentes**. Ausente nunca sobrescreve
valor já gravado com `null`, senão uma renovação sem o dado apagaria o snapshot bom da
ativação.

Ausência de dado nunca é erro. O detalhe cai para rótulo derivado do provider:
`stripe` vira "Cartão", `apple_revenuecat` vira "App Store".

Nenhuma chamada à Stripe é feita na renderização da tela.

### 2.6 Endpoints

Arquivo novo `apps/api/src/routes/admin/subscriptions.ts`, registrado em
`routes/admin/index.ts` no escopo `requireRole('organizer', 'admin')`, junto de
`adminFinanceRoutes` e `adminPremiumCatalogRoutes`.

| Método | Path | Corpo |
| --- | --- | --- |
| GET | `/admin/subscriptions/:id` | — |
| POST | `/admin/subscriptions/:id/plan` | `{ tier, cadence }` |
| POST | `/admin/subscriptions/:id/addons` | `{ addonKey }` |
| DELETE | `/admin/subscriptions/:id/addons/:addonKey` | — |
| POST | `/admin/subscriptions/:id/cancel` | — |
| POST | `/admin/subscriptions/:id/resume` | — |
| POST | `/admin/subscriptions/:id/pause` | — |

`POST /resume` cobre os dois sentidos de retomada. Se a assinatura está
`cancel_scheduled`, chama `resumeCancel`. Se está `paused`, chama
`resumeCollection`. Um único botão na interface, o backend decide pelo estado atual.

**Status permitido por ação.** Cada ação tem sua própria lista. Não existe um conceito
único de "assinatura viva" que sirva para todas. `LIVE_STATUSES` em
`me-premium-addons.ts` vale `active`, `past_due` e `cancel_scheduled`, e não serve
para `resume`, que precisa aceitar `paused`.

| Ação | Status aceitos |
| --- | --- |
| `GET /:id` | todos, inclusive `expired` |
| `POST /plan` | `active`, `past_due`, `cancel_scheduled` |
| `POST /addons` | `active`, `past_due`, `cancel_scheduled` |
| `DELETE /addons/:addonKey` | `active`, `past_due`, `cancel_scheduled` |
| `POST /cancel` | `active`, `past_due`, `trialing` |
| `POST /resume` | `cancel_scheduled`, `paused` |
| `POST /pause` | `active`, `past_due`, `trialing` |

Status fora da lista responde 409 `InvalidStatus`, com o status atual na mensagem.
O gate por status vem antes do gate por provider, para que o admin receba o motivo
mais específico.

A leitura do detalhe **não** é bloqueada por `GROWTH_PREMIUM_BILLING_ENABLED`. O admin
precisa inspecionar assinaturas mesmo com a flag desligada. As mutações são
bloqueadas com 503.

Toda mutação grava `recordAudit` com `actorId`, ação, `entityType: 'premium_membership'`,
`entityId: membershipId` e metadata com os parâmetros. As ações novas são adicionadas
ao enum de `AdminAuditAction` em `packages/shared/src/admin.ts`.

Não existe endpoint novo de lista. A lista usa `GET /admin/finance/memberships`.

### 2.7 Extensão da lista existente

`GET /admin/finance/memberships` é estendido, não duplicado.

`adminFinanceMembershipsQuerySchema` ganha:

```ts
addonKey:   z.string().min(1).max(40).optional()
vendorName: z.string().min(1).max(120).optional()
```

`addonKey` filtra assinaturas que têm aquele módulo com status `active` ou
`cancel_scheduled`. Responde ao requisito de saber qual membro possui determinado
módulo.

`vendorName` filtra assinaturas que têm qualquer módulo daquele fornecedor, com os
mesmos status. Casamento exato, não `contains`, porque a origem dos valores é o
próprio catálogo e não texto livre do usuário. Ambos viram
`where.addons = { some: { ..., status: { in: ['active', 'cancel_scheduled'] } } }`.

`from` e `to` **não** precisam de mudança. `findMembershipRows` já os aplica sobre
`currentPeriodEnd`, o que é exatamente o filtro de período de renovação. Falta apenas
expor na interface.

`adminFinanceMembershipsItemSchema` ganha:

```ts
userId: z.string().min(1)
userEmail: z.string()
baseAmountCents: z.number().int().nonnegative()
addonsAmountCents: z.number().int().nonnegative()
paymentBrand: z.string().nullable()
paymentLast4: z.string().nullable()
addonKeys: z.array(z.string())
```

`userId` permite link para `/users/:id`. `addonKeys` permite chips de módulo na
tabela. A rota `admin/finance.ts` é atualizada para preencher os campos novos.

### 2.8 Schemas compartilhados

Arquivo novo `packages/shared/src/admin-subscription.ts`, seguindo a convenção de um
arquivo por domínio limitado:

- `adminSubscriptionAddonSchema` — `key`, `name`, `vendorName`, `status`, `quotaUnit`,
  `quotaPerCycle`, `monthlyDeltaCents`, `payoutAmountCents`, `marginCents`,
  `billingIntegrated: boolean`, `currentCycle` com cota usada e total.
  `billingIntegrated` é derivado de `providerItemRef !== null` e diz se a Stripe está
  de fato cobrando por aquele módulo
- `adminSubscriptionInvoiceSchema` — `periodStart`, `periodEnd`, `paidAt`,
  `grossAmountCents`, `addonsAmountCents`, `currency`, `status`, `refundedAt`,
  `refundedAmountCents`
- `adminSubscriptionDetailSchema` — identidade do membro (`userId`, `userName`,
  `userEmail`, `garageId`, `garageSlug`), plano (`tier`, `planSlug`, `planName`),
  `cadence`, `status`, `provider`, `currentPeriodStart`, `currentPeriodEnd`,
  `cancelAtPeriodEnd`, `cancelledAt`, valores (`baseAmountCents`,
  `addonsAmountCents`, `totalAmountCents`, `currency`), método de pagamento
  (`paymentBrand`, `paymentLast4`), `addons`, `invoices`, e
  `mutable: boolean` derivado de `provider === 'stripe'`
- `adminSubscriptionChangePlanSchema` — `{ tier, cadence }`
- `adminSubscriptionAddonAttachSchema` — `{ addonKey }`
- `adminSubscriptionActionResponseSchema` — `{ ok: true, pending: true }`, usado por
  `plan`, `cancel`, `resume` e `pause`
- `adminSubscriptionAddonMutationResponseSchema` — `{ ok: true, pending: false,
  addonKey, status, addonsAmountCents, totalAmountCents }`, usado pelas duas rotas de
  módulo

A distinção é real, não cosmética. Vincular e desvincular módulo grava no banco de
imediato, depois da chamada à Stripe, exatamente como o fluxo do membro faz hoje.
Trocar plano, cancelar, retomar e pausar não gravam nada: quem grava é o webhook. A
interface lê `pending` para decidir se mostra o novo valor na hora ou a mensagem de
alteração enviada.

`providerCustomerRef`, `providerSubRef` e `providerItemRef` **não** são expostos no
detalhe. A lista já expõe `providerSubRef` hoje e isso não é alterado, para não
quebrar o contrato existente.

Adicionar a entrada de subpath em `packages/shared/package.json` e rodar
`pnpm --filter @ccc/shared build`. Typecheck obrigatório em `@ccc/api`, `@ccc/admin`
e `@ccc/mobile`.

### 2.9 Erros

Ordem de avaliação em toda mutação: existência, status, provider, corpo, catálogo,
Stripe.

| Situação | Resposta |
| --- | --- |
| Assinatura inexistente | 404 `NotFound` |
| Status atual fora da lista da ação | 409 `InvalidStatus` |
| `provider === 'apple_revenuecat'` em qualquer mutação | 409 `ProviderNotMutable` |
| `GROWTH_PREMIUM_BILLING_ENABLED` desligado, em mutação | 503 `ServiceUnavailable` |
| Módulo já vinculado | 409 `AlreadyExists` |
| Módulo não vinculado, no desvínculo | 404 `NotFound` |
| Módulo inativo no catálogo | 404 `NotFound` |
| Troca para o plano e cadência atuais | 409 `NoChange` |
| Plano alvo sem `stripePriceId` | 422 `UnprocessableEntity` |
| Item de plano ambíguo na Stripe | 409 `AmbiguousPlanItem` |
| Falha na Stripe | erro propagado, nada gravado |

Ordem provider-first em todas as mutações. Stripe falha, banco não muda.

## Seção 3 — Frontend admin

### 3.1 Navegação

- `apps/admin/src/components/authed-nav.tsx` — `ORGANIZER_LINKS` ganha
  `{ href: '/assinaturas', label: 'Assinaturas' }`
- `apps/admin/middleware.ts` — `config.matcher` ganha `/assinaturas/:path*`; o bloco
  de gate de papel passa a bloquear `staff` em `/assinaturas`
- `apps/admin/app/(authed)/financeiro/membros/page.tsx` — passa a ser
  `redirect('/assinaturas')`, preservando a query string
- `apps/admin/src/components/garage-membership-history.tsx:123` — o link passa a
  apontar para `/assinaturas?search=...`
- `financeiro/membros/membros-table.tsx` e seu `__tests__` são removidos. O
  comportamento migra para `assinaturas-table.tsx` e seus testes. Deixar código morto
  seria pior do que remover

A aba Premium (`/premium/catalogo`) permanece separada. É catálogo de planos, não
assinatura de membro.

### 3.2 Arquivos

```
apps/admin/app/(authed)/assinaturas/
  page.tsx                     lista, server component, force-dynamic
  assinaturas-table.tsx        tabela, chips de filtro, paginacao
  __tests__/page.test.tsx
  [id]/page.tsx                detalhe, server component
  [id]/plan-actions.tsx        client, troca de plano
  [id]/status-actions.tsx      client, cancelar, retomar, pausar
  [id]/addons-panel.tsx        client, vincular e desvincular modulo
  [id]/__tests__/page.test.tsx
  [id]/__tests__/actions.interaction.test.tsx
apps/admin/src/lib/assinaturas-actions.ts
```

### 3.3 Lista

Server component com `export const dynamic = 'force-dynamic'`. `searchParams` é
`Promise<Record<string, string | string[] | undefined>>`, cada filtro validado
contra um `ReadonlyArray` de valores aceitos antes de ir para a API.

Colunas: membro (nome e email), plano, cadência, status, provider, método de
pagamento, renovação, total mensal, módulos, total pago.

Filtros como link que altera a query string, nunca estado de cliente, seguindo
`buildFilterHref`, `buildPageHref` e `buildClearHref` do padrão atual. Toda troca de
filtro reseta `page`.

Filtros por chip: status, tier, cadência, provider, módulo e fornecedor. Busca por
nome ou email em campo de texto. Período de renovação em dois campos `date`, `from` e
`to`, submetidos por `<form method="get">` para preservar o modelo de query string.

As opções de módulo e de fornecedor vêm do catálogo. A página busca o catálogo de
módulos com a função que já existe em `admin-api.ts` e deriva a lista de fornecedores
distintos dos módulos ativos. Nenhum endpoint novo para isso.

Um botão `Limpar filtros` some quando nenhum filtro está aplicado. Paginação
`Anterior` e `Próxima` com indicador de página.

Estado vazio centralizado com `data-testid="assinaturas-empty-state"`.

### 3.4 Detalhe

Ordem na tela:

1. Link de volta para `/assinaturas`
2. Card do membro: nome, email, link para `/users/:id`, slug da garagem, pill de
   status, provider
3. Tiles: plano e tier, cadência, valor base, valor de módulos, total mensal, data de
   renovação, cancelamento agendado
4. Método de pagamento: bandeira e quatro últimos dígitos, ou rótulo derivado do
   provider
5. Painel de módulos: nome, fornecedor, status, cota do ciclo usada e total, valor
   cobrado, valor de repasse, margem. Módulo com `billingIntegrated` falso ganha um
   aviso de que a Stripe não está cobrando por ele. Botão remover por linha. Botão
   adicionar, com select dos módulos ativos do catálogo ainda não vinculados
6. Ações de plano: select de tier e de cadência, com aviso de rateio na próxima fatura
7. Ações de status: cancelar ao fim do período, retomar, pausar
8. Histórico de pagamentos: período, pago em, valor bruto, status, estorno

Quando `mutable` é falso, todos os botões ficam desabilitados e um aviso explica que
a assinatura é gerenciada pela App Store.

404 da API vira `notFound()`, seguindo o padrão de `users/[id]/page.tsx`.

### 3.5 Padrões

Leitura por server component via `apiFetch`, com validação Zod da resposta.
Funções tipadas por endpoint em `src/lib/admin-api.ts`.

Mutação por server action em `src/lib/assinaturas-actions.ts`, retornando
`{ ok: true } | { ok: false; error: string }`. Componentes client usam `useTransition`
e `router.refresh()` depois do sucesso.

Toast local copiado do padrão de `grant-ticket-modal.tsx`, com `role="status"` e
`aria-live="polite"`. Não existe toast compartilhado no admin e criar um está fora
de escopo.

Cores apenas por variável CSS (`var(--color-accent)`, `var(--color-border)`,
`var(--color-muted)`). Pills de status com par `bg-{cor}-900 text-{cor}-300` a partir
de um `Record` local, aproveitando os mapas de rótulo e tom que já existem em
`membros-table.tsx`.

Rótulos PT-BR em `Record` local por arquivo. O admin não tem dicionário central e
criar um está fora de escopo.

Formatação de moeda e data com helpers locais `fmtBRL` e `fmtDate`, como no resto do
admin.

`data-testid` em todo elemento dinâmico, padrão `assinaturas-{elemento}-{id}`.

### 3.6 Latência do modelo híbrido

Depois de cada mutação bem-sucedida o toast informa que a alteração foi enviada ao
provedor e aparecerá em instantes, e `router.refresh()` é chamado. A tela não
antecipa o novo estado. Se o webhook ainda não chegou, o valor antigo continua
visível, o que é a verdade.

## Seção 4 — Fluxo de dados

```
admin (client) → server action → apiFetch (Bearer do cookie session_access)
  → rota admin (requireRole) → serviço de billing → Stripe
  → webhook assinado → dedupe em SubscriptionWebhookEvent
  → transação com SELECT ... FOR UPDATE na Garage → applyMembershipEvent → banco
  → router.refresh() relê o detalhe
```

## Seção 5 — Testes

### API

`apps/api/test/admin/subscriptions/`, contra Postgres real via Testcontainers e
Stripe fake por `makeAppWithFakeStripe()`:

- 401 sem token; 403 para `user` e para `staff`
- detalhe: resposta validada por `adminSubscriptionDetailSchema`; assinatura
  inexistente dá 404
- detalhe: confirma que `providerSubRef` e `providerItemRef` não aparecem
- cada mutação: caminho feliz, linha em `adminAudit`, e 409 para `apple_revenuecat`
- cada mutação: 409 quando o status atual não está na lista permitida da ação
- leitura do detalhe funciona com `GROWTH_PREMIUM_BILLING_ENABLED` desligado
- troca de plano: asserção de que o fake recebeu `proration_behavior:
  'create_prorations'` e o `subscriptionItemId` do item de plano, não de um módulo
- troca de plano em assinatura com dois módulos vinculados: prova que o item correto
  foi escolhido
- item de plano ambíguo: 409 e nenhuma chamada ao fake
- `resume`: encaminha para `resumeCancel` quando `cancel_scheduled` e para
  `resumeCollection` quando `paused`; 409 quando `active`
- `GROWTH_PREMIUM_BILLING_ENABLED` desligado: 503

### Billing

`apps/api/test/billing/`:

- `normalize-stripe`: flip de `pause_collection` nos dois sentidos gera
  `subscription.paused` e `subscription.resumed`; nenhum dos dois é gerado quando
  `pause_collection` não muda
- `apply-membership-event`: `handlePaused` põe status `paused` e não altera o
  snapshot da `Garage`; `handleResumed` volta para `active` e reaplica o snapshot com
  regra de `max()`
- webhook de billing: bandeira e final do cartão são gravados quando o fake de
  `retrievePaymentIntent` os devolve; falha dessa chamada não derruba o webhook e o
  resto do evento é aplicado
- webhook de billing: renovação sem o dado não sobrescreve com `null` o snapshot
  gravado na ativação

### Extensão da lista

`apps/api/test/admin/finance/`:

- filtro `addonKey` retorna só quem tem o módulo vinculado, e ignora vínculo
  `cancelled`
- filtro `vendorName` retorna quem tem qualquer módulo daquele fornecedor
- `addonKey` e `vendorName` combinados aplicam as duas restrições
- `from` e `to` continuam filtrando `currentPeriodEnd`, sem regressão
- campos novos aparecem na resposta

### Prova da refatoração

Os testes atuais de `me-premium-addons` ficam **intocados**. Se passarem sem
alteração depois da extração para `services/billing/addons.ts`, o comportamento do
endpoint do membro não mudou. Essa é a evidência de que não houve duplicação nem
regressão.

### Admin

- `assinaturas/__tests__/page.test.tsx` e `[id]/__tests__/page.test.tsx` — render
  estático com `renderToStaticMarkup`, `next/link` mockado, asserção por regex sobre
  `data-testid`
- `[id]/__tests__/actions.interaction.test.tsx` — docblock
  `// @vitest-environment jsdom`, `IS_REACT_ACT_ENVIRONMENT`, `act()` para testar
  estado pendente, sucesso e erro dos três painéis de ação
- `authed-nav.test.tsx` — ganha asserção do link novo e da ausência dele para `staff`
- `middleware.test.ts` — ganha caso de `staff` bloqueado em `/assinaturas`

## Riscos

1. **Extensão da máquina de estados de cobrança.** `apply-membership-event.ts` está
   verde com uma suíte grande. Mitigação: escrever os testes de `paused` e `resumed`
   antes de tocar nos handlers, e confiar no `switch` exaustivo com checagem `never`
   para apontar todos os pontos afetados.
2. **Identificação do item de plano.** Com módulos vinculados, escolher o item errado
   trocaria o preço de um módulo pelo preço de um plano. Mitigação: resolver contra o
   catálogo e abortar quando ambíguo, com teste dedicado.
3. **Alteração de contrato na lista de finanças.** Campos novos obrigatórios em
   `adminFinanceMembershipsItemSchema` exigem atualizar `admin/finance.ts` no mesmo
   commit. Mitigação: typecheck dos três apps e teste da resposta.
4. **Fornecedores sem valor de repasse real.** O seed não inventa valor financeiro.
   Até o operador preencher, a margem exibida iguala o valor cobrado. A interface não
   sinaliza isso como erro.
5. **Origem da bandeira e do final do cartão.** Depende de `payment_method_details`
   estar acessível na versão de API em uso. Mitigação: confirmar contra o SDK antes de
   implementar; se não estiver, cair para rótulo derivado do provider e manter as duas
   colunas nulas. Isso não bloqueia nenhuma outra parte do trabalho.
6. **Módulos sem `stripePriceId` no catálogo.** Hoje os dois módulos seedados têm
   `stripePriceId` nulo, o que faz o vínculo cair no caminho local-only sem cobrança na
   Stripe. O admin conseguirá vincular um módulo e ver o valor na tela sem que a
   Stripe cobre por ele. Comportamento já existente no fluxo do membro, não introduzido
   aqui. A tela sinaliza o módulo como não integrado à cobrança quando
   `stripePriceId` é nulo, para o admin não interpretar mal.

## Fora de escopo

- Cadência anual
- Assinatura via Pix
- Upgrade ou downgrade iniciado pelo próprio membro
- Fechamento financeiro de repasse por período, com relatório e conciliação
- CRUD de fornecedor como entidade própria
- Mover `/premium/catalogo` para dentro da aba Assinaturas
- Alterar o fluxo de concessão manual de premium em `/admin/users/:id/garage/premium`
