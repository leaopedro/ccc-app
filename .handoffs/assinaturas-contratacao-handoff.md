# Handoff — Assinaturas: fluxo de contratação, cancelamento e histórico

Data: 2026-07-28
Branch: `feat/rebrand-ccc-app-sweep` (trabalhar DIRETO nela, sem worktree — instrução explícita do usuário)
Estado: **as 3 seções do design foram aprovadas em 2026-07-28.** O spec consolidado está em
`docs/superpowers/specs/2026-07-28-assinaturas-contratacao-design.md` e SUBSTITUI este handoff.
Próximo passo: gate de revisão do usuário sobre o spec, depois `superpowers:writing-plans`.
Este arquivo fica só como registro da fase de exploração (seção 3 abaixo).

---

## 0. Como retomar

1. `git branch --show-current` deve dar `feat/rebrand-ccc-app-sweep`. Se não, `git checkout feat/rebrand-ccc-app-sweep`.
2. Invocar `superpowers:brainstorming` (o usuário exigiu a skill Superpowers no processo).
3. **Pular** a fase de exploração — está toda registrada na seção 3 deste documento.
4. Retomar apresentando a **Seção 2 do design (mobile)**, depois a **Seção 3 (testes e riscos)**.
5. Após aprovação das 3 seções: escrever o spec em `docs/superpowers/specs/2026-07-28-assinaturas-contratacao-design.md`, self-review, gate de revisão do usuário, e só então `superpowers:writing-plans`.

**HARD GATE ativo:** nenhuma linha de código antes das 3 seções aprovadas + spec aprovado pelo usuário.

### Processo exigido pelo usuário (multi-agente)

Orquestrador (CEO) coordena agentes especialistas, nesta ordem obrigatória:
DB → Backend → Frontend → Revisor. Backend-first. Nenhuma tela antes da infra existir.
Regras: não criar arquitetura paralela, não duplicar, reutilizar tudo que já existe, justificar tecnicamente qualquer mudança estrutural.

---

## 1. Decisões travadas (não reabrir)

| #   | Decisão                        | Escolha do usuário                                                                                                                                                                                                                                     |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Meios de pagamento             | **Só cartão via Stripe, Android + Web.** Pix fora (AbacatePay não tem API de assinatura; Stripe não suporta Pix em subscription). iOS fora (regra App Store + lint rule `no-stripe-on-ios.cjs` já existente) — iOS mostra aviso de contratar pela web. |
| 2   | Histórico                      | **Só histórico de cobranças.** Nova rota lendo `PremiumMembershipInvoice` (já populada por webhook). Sem model novo de transições de estado.                                                                                                           |
| 3   | Tela legada `/profile/premium` | **Remover só a entrada do menu** do Perfil. Tela e rota permanecem no código, sem link. Não deletar arquivos.                                                                                                                                          |
| 4   | Validação / Stripe price IDs   | **Testes automatizados com FakeStripe + o usuário cadastra os price IDs** pelo painel admin, seguindo `docs/stripe.md`. Não chamar a conta Stripe do usuário.                                                                                          |
| 5   | Add-ons no checkout            | **Abordagem A — Checkout multi-line-item.** Uma Checkout Session em `mode: 'subscription'` com `line_items = [plano, ...módulos]`. O resumo mostrado bate exatamente com a primeira fatura.                                                            |
| 6   | Cancelamento                   | Rota própria `POST /api/me/premium/cancel` → `stripe.subscriptions.update({cancel_at_period_end:true})`. Cancela ao fim do período. O caminho de volta (webhook → `handleCancelled`) já existe pronto.                                                 |

---

## 2. Design aprovado — Seção 1: Backend e Banco

### 2.1 Banco: ZERO migrations

Verificado requisito por requisito contra `packages/db/prisma/schema.prisma`:

| Requisito                      | Tabela que já atende                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Módulos no checkout            | `PremiumMembershipAddon` + `PremiumAddonUsage`                                    |
| Cancelamento                   | `PremiumMembership.cancelAtPeriodEnd` / `cancelledAt` / status `cancel_scheduled` |
| Histórico de cobranças         | `PremiumMembershipInvoice`                                                        |
| Benefícios em Minha Assinatura | `PremiumPlanBenefit`                                                              |

O agente de Banco de Dados **não tem trabalho estrutural**. Declarar isso, não inventar tabela.

### 2.2 Rotas

```
POST   /api/me/premium/cancel        NOVA
GET    /api/me/premium/invoices      NOVA
POST   /api/me/premium/checkout      ALTERADA (aceita addonKeys[])
GET    /api/me/premium/subscription  ALTERADA (resposta ganha benefits[] e planDescription)
```

**`POST /api/me/premium/cancel`**

- Guards: `app.authenticate` + flag `GROWTH_PREMIUM_BILLING_ENABLED` (503) + rate limit 5/min por `sub`.
- `stripe.subscriptions.update({ cancel_at_period_end: true })`, idempotency key `cancel_sub_{membershipId}`.
- **Não escreve no banco.** Quem escreve é o webhook `customer.subscription.updated` (já mapeado para `subscription.cancelled` em `normalize-stripe.ts`, já tratado por `handleCancelled`). Mantém a invariante: estado de assinatura só muda por webhook verificado.
- Retorna `{ cancelAtPeriodEnd: true, currentPeriodEnd }`.
- `409 NotStripeSubscription` para membership `apple_revenuecat` (devolve `manageUrl` da App Store, mesmo padrão de `billing-portal`).

**`GET /api/me/premium/invoices`**

- Lê `PremiumMembershipInvoice` das memberships da garagem do user, `orderBy periodStart desc`, `take 24`.
- Retorna `{ invoices: [{ periodStart, periodEnd, paidAt, grossAmountCents, currency, status, refundedAt }] }`.
- **Nunca** expõe `providerInvoiceRef` nem `providerTransactionRef`.

**`POST /api/me/premium/checkout`** (alterada)

- Body ganha `addonKeys?: string[]` (máx 10) em `premiumCheckoutRequestSchema` (`packages/shared/src/premium.ts`).
- Resolve `stripePriceId` de cada módulo ativo do catálogo. Se algum faltar → `503` listando as chaves faltantes.
- Passa `[planPriceId, ...addonPriceIds]` para a sessão.

### 2.3 Alterações de serviço

**`createSubscriptionCheckoutSession`** (`apps/api/src/services/stripe/index.ts:322`)

- `priceId: string` → `priceIds: string[]`, mapeado para `line_items`.
- Único call-site: `me-premium.ts`. Atualizar `FakeStripe` (`services/stripe/fake.ts`) junto.

**`normalize-stripe.ts`** (`apps/api/src/services/billing/normalize-stripe.ts:22`)

- Remover `tierFromPrice()` que retorna `'gold'` hardcoded (bug que quebra multi-tier).
- Normalizer passa a devolver as linhas da fatura: `lines: [{ priceRef, amountCents, subscriptionItemRef }]` (de `invoice.lines.data[].price.id`, `.amount`, `.subscription_item`).
- `tier` fica placeholder, **exatamente como `garageId` já é hoje** (comentário em `normalize-stripe.ts:71-74` documenta esse precedente). A rota patcha.
- Atenção: `pricingFromInvoice` usa `invoice.lines.data[0]` — com multi-line isso deixa de ser confiável. O `baseAmountCents` passa a vir da linha que casar com o plano.

**Rota do webhook** (`apps/api/src/routes/stripe-billing-webhook.ts`)

- Resolve as linhas contra o catálogo no banco (fonte da verdade, não metadata do Stripe):
  - linha que casa com `PremiumPlanPrice.stripePriceId` → define `tier`, `cadence`, `baseAmountCents`
  - linhas que casam com `PremiumAddonModule.stripePriceId` → `addonsAmountCents` + lista de add-ons a criar
- Patcha o `BillingEvent` antes de despachar, no mesmo ponto onde já patcha `garageId`.

**`handleActivated`** (`apps/api/src/services/billing/apply-membership-event.ts:53`)

- Passa a criar `PremiumMembershipAddon` + `PremiumAddonUsage` na MESMA transação da ativação, a partir da lista resolvida. `providerItemRef` = `subscriptionItemRef` da linha.
- Sem chamada externa dentro da tx. Sem estado parcial.
- Respeitar canon §F8.5 (`SELECT ... FOR UPDATE` no Garage) e §F8.6 (exatamente um `awardXp` por tx).

### 2.4 Rate limit

Nenhuma rota premium tem hoje. Adicionar em: `checkout` 5/min, `cancel` 5/min, `addons` 20/min.
Padrão obrigatório (escopo encapsulado + `hook: 'preHandler'` porque a chave usa `request.user`):

```ts
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max,
    timeWindow,
    hook: 'preHandler',
    keyGenerator: (req) => `premium-checkout:${req.user?.sub ?? req.ip}`,
  });
  scoped.post('/rota', handler);
});
```

Ver `apps/api/src/routes/orders.ts:369` e `apps/api/src/routes/admin/index.ts:112-116`.

---

## 3. Fase 1 — Análise da arquitetura (NÃO REFAZER)

### 3.1 Invariante estrutural

**Premium é ancorado em `Garage`, não em `User`.** `User → Garage (1:1, `Garage.userId @unique`) → PremiumMembership`. `User` não tem nenhum campo premium/tier. Toda query de "é assinante?" passa por Garage.

### 3.2 Models premium existentes (`packages/db/prisma/schema.prisma`)

- `Garage` (l.225) — `premiumTier GaragePremiumTier?`, `premiumUntil DateTime?` (cache denormalizado), `@@index([premiumTier, premiumUntil])`
- `PremiumMembership` (l.319) — `provider`, `providerCustomerRef`, `providerSubRef`, `tier`, `cadence`, `status`, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `cancelledAt`, `baseAmountCents`, `devFeePercent`, `devFeeAmountCents`, `grossAmountCents`, `currency`, `addonsAmountCents`. `@@unique([provider, providerSubRef])`. **Partial unique cru em SQL** (migration `20260527094120`): `premium_membership_live_per_garage` ON `("garageId")` WHERE status IN `('active','past_due','cancel_scheduled')`. Linhas expiradas acumulam como histórico.
- `PremiumMembershipInvoice` (l.357) — `providerInvoiceRef`, `periodStart/End`, `paidAt` (não-opcional), `refundedAt`, `refundedAmountCents`, `grossAmountCents`, `addonsAmountCents`, `status String @db.VarChar(20)` (string livre, sem enum). `@@unique([provider, providerInvoiceRef])`
- `SubscriptionWebhookEvent` (l.384) — `@@unique([provider, providerEventId])`, `processedAt DateTime?`
- `PremiumPlan` (l.426) — `tier @unique` (⚠️ **máx 3 planos**, um por tier), `slug @unique`, `name`, `description`, `active`, `sortOrder`
- `PremiumPlanPrice` (l.443) — `cadence`, `baseAmountCents`, `currency`, `stripePriceId`, `rcProductId`, `active`. `@@unique([planId, cadence])`
- `PremiumPlanBenefit` (l.460) — `label`, `sortOrder`
- `PremiumAddonModule` (l.475) — `key @unique`, `name`, `description` (obrigatório), `monthlyDeltaCents`, `quotaPerCycle`, `quotaUnit`, `stripePriceId`, `rcProductId`, `active`, `sortOrder`
- `PremiumMembershipAddon` (l.498) — `addonKey` FK por **natural key** para `PremiumAddonModule.key` com `onDelete: Restrict`, `status`, `providerItemRef`, snapshots de preço/quota. `@@unique([membershipId, addonKey])` (sem filtro de status)
- `PremiumAddonUsage` (l.520) — `cycleStart`, `cycleEnd`, `quotaTotal`, `quotaUsed`. `@@unique([membershipAddonId, cycleStart])`
- `PremiumAddonRedemption` (l.538) — `redeemedByUserId String?` **sem FK**
- `PremiumTicketBackfillJob` (l.410)

### 3.3 Enums (valores exatos)

```
GaragePremiumTier        { bronze silver gold }
PremiumProvider          { stripe apple_revenuecat }
PremiumCadence           { monthly annual }
PremiumMembershipStatus  { trialing active past_due cancel_scheduled expired paused }
PremiumAddonUnit         { access hours }
PremiumAddonStatus       { active cancel_scheduled cancelled }
UserRole                 { user organizer admin staff }
PaymentMethod            { card pix }
PaymentProvider          { stripe abacatepay }
OrderStatus              { pending paid failed refunded expired cancelled }
```

Silos: `PaymentProvider` (avulso) vs `PremiumProvider` (assinatura); `PaymentWebhookEvent` vs `SubscriptionWebhookEvent`; `Order` e `PremiumMembership` **sem FK entre si**.

### 3.4 Seed (`packages/db/prisma/seed.ts`, `seedPremiumCatalog` l.504)

| tier   | slug       | name     | mensal                 |
| ------ | ---------- | -------- | ---------------------- |
| bronze | `ingresso` | Ingresso | R$ 490,00 (`49000`)    |
| silver | `estrada`  | Estrada  | R$ 890,00 (`89000`)    |
| gold   | `fundador` | Fundador | R$ 1.490,00 (`149000`) |

12 benefits (3/4/5). Módulos: `detailing` (R$ 150,00, 3 `access`/mês), `oficina` (R$ 500,00, 5 `hours`/mês).
**Só cadência `monthly` é semeada.** `stripePriceId`/`rcProductId` ficam `null` de propósito.

### 3.5 Rotas premium existentes (`apps/api/src/routes/`)

| Rota                                                       | Arquivo                           | Guard                                      |
| ---------------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| `GET /api/plans`, `/api/plans/:slug`, `/api/addon-modules` | `premium-catalog.ts:73,84,94`     | público, **sem** flag gate                 |
| `GET /api/premium/pricing`                                 | `premium-pricing.ts:48`           | público, flag-gated, gold-only via env     |
| `GET /api/me/premium/checkout-precheck`                    | `me-premium.ts:53`                | auth + flag                                |
| `POST /api/me/premium/checkout`                            | `me-premium.ts:123`               | auth + flag                                |
| `POST /api/me/premium/billing-portal`                      | `me-premium.ts:279`               | auth + flag                                |
| `GET /api/me/premium/status`                               | `me-premium.ts:357`               | auth + flag                                |
| `GET /api/me/premium/subscription`                         | `me-premium-addons.ts:48`         | auth + flag                                |
| `POST /api/me/premium/addons`                              | `me-premium-addons.ts:158`        | auth + flag                                |
| `DELETE /api/me/premium/addons/:addonKey`                  | `me-premium-addons.ts:320`        | auth + flag                                |
| `GET/POST/PATCH/DELETE /admin/premium/*`                   | `admin/premium-catalog-admin.ts`  | `requireRole('organizer','admin')`         |
| `POST /admin/premium/addons/:id/redeem`                    | `admin/premium-redemptions.ts:23` | `requireRole('organizer','admin','staff')` |
| `POST /admin/users/:id/garage/premium`                     | `admin/user-garage.ts:75`         | grant/revoke manual, não fala com Stripe   |

`LIVE_STATUSES = ['active','past_due','cancel_scheduled']` (`me-premium.ts:40`).
Checkout usa idempotency key `checkout_sub_{garageId}_{cadence}` (`me-premium.ts:253`).

### 3.6 Stripe client (`apps/api/src/services/stripe/index.ts`)

API version fixada `'2026-04-22.dahlia'`. Interface em `:96-155`.
Assinatura: `createSubscriptionCheckoutSession` (`:322`), `findOrCreateCustomer` (`:350`), `createBillingPortalSession` (`:374`), `listOpenSubscriptionCheckoutSessions` (`:381`), `retrieveSubscription` (`:313`), `retrievePrice` (`:391`), `addSubscriptionItem` (`:394`), `removeSubscriptionItem` (`:409`).
**Não existe** nenhuma chamada de cancelamento. `stripe.subscriptions` só é usado para `retrieve`.
Dublê de teste: `services/stripe/fake.ts` `buildFakeStripe()` — usado por toda a suite de billing.

### 3.7 Webhooks

| Rota                             | Arquivo                        | Idempotência                                                                                                                                                                                 |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /webhooks/stripe-billing`  | `stripe-billing-webhook.ts:59` | `SubscriptionWebhookEvent` `@@unique([provider, providerEventId])` + `processedAt`. Duplicata processada → `200 deduped`. Duplicata **não** processada → **`503`** para o Stripe reentregar. |
| `POST /webhooks/revenuecat`      | `revenuecat-webhook.ts:38`     | mesma tabela, provider `apple_revenuecat`. Auth por `timingSafeEqual`. Rate limit 30/min.                                                                                                    |
| `POST /stripe/webhook` (avulso)  | `stripe-webhook.ts:282`        | `PaymentWebhookEvent`, helper `markProcessed`                                                                                                                                                |
| `POST /abacatepay/webhook` (Pix) | `abacatepay-webhook.ts:195`    | `PaymentWebhookEvent`, dupla verificação + re-fetch de confiança                                                                                                                             |

Events Stripe de assinatura tratados hoje: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`. Resto → `null` → `200 ignored`.
Seam de add-ons já existe: em qualquer `customer.subscription.updated`, chama `reconcileMembershipAddonsAmount` antes do normalize (`stripe-billing-webhook.ts:184-199`).

### 3.8 `apply-membership-event.ts` (542 linhas)

Contrato de lock (canon §F8.5): o chamador DEVE ter feito `SELECT id FROM "Garage" WHERE id = $garageId FOR UPDATE` na mesma tx.

- `applyMembershipEvent(tx, evt)` `:21` — switch exaustivo
- `handleActivated` `:53` — guard anti-regressão para webhook fora de ordem; invoice em `SAVEPOINT invoice_insert` (P2002 = replay silencioso); `Garage.premiumUntil = max(existing, new)`; `awardXp(... 'premium_activation', delta:200)`
- `handleRenewed` `:201`, `handleCancelled` `:279`, `handleUncancelled` `:297`, `handleExpired` `:325`, `handlePastDue` `:368`, `handleTierChanged` `:387`
- `applyInvoiceRefund` `:443` — canon §F8.10: refund NÃO revoga acesso até o fim do período
- `reconcileMembershipAddonsAmount` `:487`
- `enqueuePremiumTicketBackfillIfActivated` `:533` — sempre PÓS-COMMIT

### 3.9 Feature flags (`apps/api/src/env.ts`)

| Flag                                        | Linha    | Default                     |
| ------------------------------------------- | -------- | --------------------------- |
| `GROWTH_PREMIUM_BILLING_ENABLED`            | `:72`    | `'true'` (local)            |
| `STRIPE_BILLING_WEBHOOK_SECRET`             | `:76`    | opcional                    |
| `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY/_ANNUAL` | `:36,37` | opcional (legado gold-only) |
| `DEV_FEE_PERCENT`                           | `:65`    | `10`                        |

`normalizeEnv` (`:96`) descarta strings vazias antes do parse.

### 3.10 Mobile — telas de assinaturas (`apps/mobile/src/screens/assinaturas/`)

- `PlanosScreen.tsx` (521 l.) — lista planos. Botão "ASSINAR X" (`:123-149`) só faz `router.push('/assinaturas/{slug}')`. Componentes locais (`OuroBackground`, `PlanCard`, `ModuleRow`), **zero uso de `@ccc/ui`**.
- `PlanoDetalheScreen.tsx` (356 l.) — CTA sticky (`:174-206`) chama `startPremiumCheckout(plan.slug)`. Fetch manual dentro da tela.
- `MinhaAssinaturaScreen.tsx` (364 l.) — **já mostra** plano, tier, renovação, base/módulos/total, uso de quota por módulo. Falta: benefícios, histórico, botão cancelar.
- `tier-visual.ts` (89 l.) — `TIER_VISUAL` (`bronze`→`BRONZE`/`#C08A4E`, `silver`→`PRATA`/`#C7CCD1`, `gold`→`OURO`/`#E8CE86`, só gold `recommended:true`), `tierStyle()`, `monthlyPriceCents()`, `orderedBenefits()`. Paleta local `c` (não usa tokens de `@ccc/design`).
- **`checkout.ts` (19 l.) — O STUB.** `startPremiumCheckout(planSlug): void` só chama `showToast('Contratação em breve.')`. `// TODO(P5)` na linha 14. É síncrono — virar async exigirá estado de loading na tela.

### 3.11 Mobile — rotas e navegação

- `app/(app)/assinaturas/{_layout,index,[slug],minha-assinatura}.tsx` — shims finos sobre `src/screens`.
- Tab **oculta**: `app/(app)/_layout.tsx:105` → `<Tabs.Screen name="assinaturas" options={{ href: null }} />`.
- Entrada real: `app/(app)/profile/index.tsx:224-230` (ícone `Gem`) → `/assinaturas`.
- ⚠️ **`/assinaturas/minha-assinatura` é ÓRFÃ** — nenhum `router.push` aponta pra ela.
- ⚠️ **Segunda entrada concorrente**: `profile/index.tsx:232-237` → `/profile/premium` (tela legada F8 `src/screens/settings/PremiumScreen.tsx`). **Decisão 3: remover essa linha do menu.**

### 3.12 Mobile — data fetching

**Não existe react-query nem SWR.** Padrão manual em todos os hooks:
`useState(data/loading/error)` + `useCallback refresh()` + `useEffect(() => void refresh(), [refresh])` → `{ data, loading, error, refresh }`.
Transporte: `src/api/client.ts:28` (`request`) e `:71` (`authedRequest`, com refresh de token deduplicado em `:61`). Toda resposta passa por `schema.parse()` (Zod).
Hooks: `usePremiumPlans.ts:14`, `usePremiumAddonModules.ts:14`, `usePremiumSubscription.ts:26` (lê flag `Constants.expoConfig?.extra?.premiumBillingEnabled`; se off nem chama a API; `ApiError.status === 503` → `billingUnavailable`).
API clients: `src/api/premium-catalog.ts`, `src/api/premium.ts`.

### 3.13 Mobile — padrão de checkout web (a reutilizar)

- Legado premium (`src/screens/settings/PremiumScreen.tsx:139-145`): Android → `WebBrowser.openAuthSessionAsync(url, 'ccc://premium/return')`. **Este é o padrão de referência.**
- Carrinho (`app/(app)/cart/index.tsx:510-565`): web → `window.location.href`; nativo → `Linking.openURL`.
- Retorno web: `app/(app)/events/buy/checkout-return.tsx` — polling manual de `getOrder`, 2s, máx 30 tentativas.
- `metro.config.js:49-52` — no web, `@stripe/stripe-react-native/*` é aliasado para `src/stripe/web-stub.tsx`.

### 3.14 Design System

**`packages/design/src/tokens.ts`** — `color` (bg `#0A0A0A`, surface `#141414`, surfaceAlt `#1F1F1F`, border `#2A2A2A`, brand `#D4AF37`, success `#22C55E`, danger `#EF4444`), `fontFamily` (display `Jost_300Regular`, sans `Inter_*`, mono `JetBrainsMono_*`), `fontSize` (xs 12 → 5xl 60), `radius` (sm 4 → full 9999), `space` (1=4 → 24=96), `shadow` (card/cardLg/glow/glowStrong), `motion` (`duration.fast/base/slow` 120/200/320 — **não utilizados hoje**), `layout` (screenPadding 20, cardGap 16, touchTarget 44).

**`packages/ui`** exporta: `Button` (variant primary/secondary/ghost/danger, size sm/md/lg, **tem `loading`**, `iconLeft/Right`, `fullWidth`), `Text` (10 variants, 6 tones), `Card` (flat/raised/outlined), `Badge`, `PremiumBadge` (aceita `tier` + `daysLeftUntilExpiry`), `SheetShell` (**o bottom-sheet reutilizável**), `PremiumSheet` (copy 100% injetável), `ParkingStallCard`, `BadgeGlyph`, `HexBadge`, `BadgeRow`, `BadgeDetail`, `BadgesSheet`, `StatsRow`, `XPScoreboard`, `XPTooltip`, `ProfileStats`, `garageTokens`/`tierColors()`/`rarityColors()`.

**NÃO existe em `@ccc/ui`:** Skeleton, Modal genérico, Input/TextField, Divider, Avatar, Toast, Spinner.

⚠️ **Duas paletas de tier concorrentes:** `tier-visual.ts` (bronze `#C08A4E`, prata `#C7CCD1`, ouro `#E8CE86`) vs `packages/ui/src/garage-tokens.ts:8-18` (bronze `#C58A52`, silver `#D6D8DC`, gold `#E8B339`).
⚠️ **Terceira paleta:** `apps/mobile/src/theme/index.ts` (`bg: '#0B0B0F'`) usada pelas telas antigas. E `apps/mobile/src/components/Button.tsx` duplica o Button do `@ccc/ui`.

### 3.15 Perfil

`app/(app)/profile/index.tsx:86` — hero card (`:148-179`): avatar 88×88, nome (`:162`), email (`:163`), cidade/UF (`:164`), link "Alterar foto" (`:165-167`).
**Não existe card premium nem badge de tier no perfil hoje.**
Padrão de referência que já existe: `src/screens/garage/IdentityCard.tsx:49-52` usa `<PremiumBadge isPremiumActive tier={garage.premiumTier} />` ao lado do nome da garagem.

### 3.16 Loading / erro / animação

- Loading dominante: `ActivityIndicator` centrado + texto (ex.: `PlanosScreen.tsx:196-205`).
- Único skeleton do app: `app/(app)/events/index.tsx:349-376` (`Animated.loop` de opacity 0.5↔1, 600ms, `useNativeDriver`).
- Erro: título + botão "Tentar novamente" chamando `refresh()`. `MinhaAssinaturaScreen.tsx:140` tem o `CenteredState` genérico.
- **Não há `react-native-reanimated`.** Só a API `Animated` do RN, em 4 arquivos. Bottom sheet de referência com pan-to-close: `src/screens/events/confirmed-cars/CarDetailSheet.tsx:31-98`.
- Toast: `src/lib/toast.tsx:14`, 2400ms, sem animação.

### 3.17 Shared schemas (`packages/shared/src/`)

- `premium-catalog.ts` — `premiumPlanSchema`, `premiumPlanPriceSchema`, `premiumPlanBenefitSchema`, `premiumAddonModuleSchema` + list responses. Público, **sem** provider ids.
- `premium-subscription.ts` — `mySubscriptionResponseSchema`, `mySubscriptionAddonSchema`, `attachAddonRequestSchema`, `addonMutationResponseSchema`, `redeemAddonRequestSchema/ResponseSchema`.
- `premium.ts` — `premiumCheckoutRequestSchema` (`{cadence, planSlug?}`), `premiumCheckoutResponseSchema`, `premiumCheckoutPrecheckResponseSchema`, `premiumBillingPortalResponseSchema`, `premiumStatusSchema` (⚠️ `tier: z.enum(['gold'])` — diverge do catálogo), `premiumPricingResponseSchema`.
- `admin.ts:1267-1440` — superfície admin COM `stripePriceId`/`rcProductId`.

**Export pattern:** subpath explícita em `packages/shared/package.json`, `types` → source TS, `default` → `dist`. **Obrigatório rodar `pnpm --filter @ccc/shared build` após mudar schema** (canon §F8.13).
`src/index.ts` re-exporta `./premium.js` mas **NÃO** `premium-catalog` nem `premium-subscription` (só via subpath).

### 3.18 Admin

- `app/(authed)/premium/catalogo/{page,premium-catalog-client}.tsx` — CRUD completo do catálogo. ⚠️ **Só edita cadência `monthly`** (hidden input, `premium-catalog-client.tsx:163`).
- `src/lib/premium-catalog-actions.ts` (243 l.) — 8 server actions, `useActionState`, `revalidatePath('/premium/catalogo')`.
- `src/lib/admin-api.ts:252-313` — camada HTTP.
- `app/premium/page.tsx` (fora de `(authed)`) — página pública de pricing gold-only (legado F8).
- Nav: `src/components/authed-nav.tsx:14`.

### 3.19 Docs canônicos

- ⚠️ **`brainstorm.md` NÃO EXISTE** apesar do `CLAUDE.md` apontar pra ele.
- `BUSINESS_PLAN.md` §4 — monetização; premium é linha 2; cancel-at-period-end para novos grants.
- `plans/roadmap.md` §F8 (l.535) — checkboxes ainda desmarcados apesar do código existir.
- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` (41.8 KB) — spec canônico do F8 **gold-only**. Não cobre o catálogo multi-tier nem add-ons.
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` — **canon §F8.1–§F8.16**, load-bearing. Ler antes de mexer em billing.
- `docs/stripe.md` — como criar produto/price no dashboard. **É o doc que o usuário vai seguir para cadastrar os price IDs.**
- `docs/manual-testing.md` §3.9 (l.858+) — smoke manual F8.
- **Não existe nenhum doc do módulo multi-tier + add-ons (P1-P5).** `.handoffs/design_handoff_assinaturas/` está vazio.

### 3.20 Padrão de teste de integração (`apps/api/test/`)

- `vitest.config.ts` — `globalSetup: ['./test/global-setup.ts']`, `pool:'forks'` com `singleFork:true`, timeout 60s.
- `test/global-setup.ts` — **Testcontainers** `postgres:16-alpine`, `prisma migrate deploy`. Não é mock (exigência do CLAUDE.md).
- `test/helpers.ts` — `makeAppWithFakeStripe()`, `resetDatabase()` (⚠️ **não** limpa `PremiumPlan`/`PremiumAddonModule` — os testes têm `resetCatalog()` local), `createUser()` (cria User **e** Garage), `bearer(env, userId, role)`.
- Exemplo canônico: `test/billing/premium-subscription.test.ts` (fixtures `seedGoldPlan`, `seedModule`, `seedMembership`; asserts contra o schema Zod compartilhado).
- Webhook: `test/billing/stripe-billing-webhook.test.ts` — `rawJson()` helper, `buildBillingApp(flag)` seta env ANTES de `loadEnv()`, `FakeStripe.nextSignatureValid`/`nextEvent`.

---

## 4. Gaps mapeados (a demanda vs o que existe)

| #   | Gap                                                               | Camada  | Status                       |
| --- | ----------------------------------------------------------------- | ------- | ---------------------------- |
| 1   | Botão "Assinar" é stub (toast)                                    | Mobile  | endereçado — Seção 2         |
| 2   | Checkout não aceita add-ons                                       | Backend | **endereçado — Seção 1**     |
| 3   | Não existe rota de cancelamento                                   | Backend | **endereçado — Seção 1**     |
| 4   | Não existe histórico para o membro                                | Backend | **endereçado — Seção 1**     |
| 5   | `tierFromPrice()` hardcoded `'gold'`                              | Backend | **endereçado — Seção 1**     |
| 6   | `/assinaturas` não redireciona assinante; `minha-assinatura` órfã | Mobile  | endereçado — Seção 2         |
| 7   | Perfil não mostra tier/card premium                               | Mobile  | endereçado — Seção 2         |
| 8   | Rotas premium sem rate limit                                      | Backend | **endereçado — Seção 1**     |
| 9   | `premiumStatusSchema.tier = z.enum(['gold'])`                     | Shared  | avaliar na Seção 3           |
| 10  | Duas entradas premium no menu do Perfil                           | Mobile  | decisão 3 — remover a legada |

---

## 5. Requisitos do briefing ainda não desenhados (Seções 2 e 3)

**Seção 2 — Mobile / Design:**

- Fluxo do botão Assinar: tela ou sheet de montagem do pacote (módulos com descrição, preço individual, adicionar/remover, total recalculando em tempo real, resumo, CTA final).
- Confirmação: anti-duplo-clique, botão animado durante processamento, loading, tratamento de erro, feedback de sucesso.
- `/assinaturas` deve virar "Minha Assinatura" automaticamente quando houver assinatura ativa.
- Card premium + tipo de membro abaixo do nome no Perfil (Bronze/Prata/Ouro).
- Minha Assinatura: adicionar benefícios, histórico de cobranças, botão cancelar com confirmação e feedback.
- Reuso obrigatório: `Button` (tem `loading`), `SheetShell`, `PremiumBadge`, `tier-visual.ts`. Nada de tela que pareça de outro projeto.
- Decidir: reaproveitar o `WebBrowser.openAuthSessionAsync` + deep link `ccc://premium/return` do `PremiumScreen` legado.

**Seção 3 — Testes, riscos, sequência:**

- Cobertura de integração com Testcontainers + FakeStripe.
- Risco: checkout multi-line-item exige que TODOS os prices envolvidos tenham o mesmo `interval` e `currency`.
- Risco: `pricingFromInvoice` lê `lines.data[0]` — quebra com multi-line se não for corrigido junto.
- Risco: `PremiumMembershipAddon.@@unique([membershipId, addonKey])` sem filtro de status.
- Resolver o item 9 (divergência de tier no `premiumStatusSchema`).
- Sequência de implementação por agente (DB → Backend → Frontend → Revisor).
- Ops: passo a passo para o usuário criar os prices recorrentes no Stripe e colar no admin.

---

## 6. Ambiente local (validado nesta sessão)

| Serviço  | Como subir                                                        | Porta                        |
| -------- | ----------------------------------------------------------------- | ---------------------------- |
| Postgres | `docker start jdm-postgres` (Docker Desktop precisa estar aberto) | `5433`, user/pass/db = `jdm` |
| API      | `cd apps/api && pnpm dev`                                         | `4000`, health em `/health`  |
| Admin    | `cd apps/admin && pnpm dev`                                       | `3000`                       |
| Mobile   | `cd apps/mobile && EXPO_NO_TELEMETRY=1 npx expo start`            | `8081`                       |

**Armadilhas de Windows já conhecidas:**

- `pnpm dev` no mobile **trava silenciosamente** (pnpm mangla o `sh -c '...'` do package.json). Usar `npx expo start` direto.
- Não usar `CI=1` no Expo — desabilita hot reload.
- **Nunca** `npx turbo run build --force` para build limpo — produz `dist` com formato de módulo inconsistente (ESM/CJS misturado). Buildar sequencialmente: `design` → `db` → `shared` → `api` → `admin`.
- `pnpm lint` na raiz estoura heap. Lintar por pacote.
- Bash `/tmp` = `C:\Users\pablo\AppData\Local\Temp` (o Read tool precisa do path Windows).

**Estado do build:** validado nesta sessão. `pnpm typecheck` 13/13 verde. Admin buildou as 39 rotas. Mobile exportou o bundle web.

**Emails em dev:** `DevMailer` imprime `[dev-mail] to=... subject=...` no stdout da API. Nada é enviado de verdade.
**Conta de teste:** `pablo@casacar.com`, role `admin`, email verificado.
**Trocar role:** `docker exec jdm-postgres psql -U jdm -d jdm -c "UPDATE \"User\" SET role='admin' WHERE email='...';"` — exige logout/login (o JWT carimba a role na emissão, `apps/api/src/routes/auth/login.ts`).

**Plugin Superpowers:** instalado (`superpowers@superpowers-marketplace` v6.2.0, escopo user). Skills disponíveis: `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `subagent-driven-development`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `using-git-worktrees`, `dispatching-parallel-agents`, `finishing-a-development-branch`, `writing-skills`, `using-superpowers`.
