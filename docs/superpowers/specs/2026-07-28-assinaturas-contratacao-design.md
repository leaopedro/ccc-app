# Assinaturas — contratação, módulos, cancelamento e histórico (design spec)

**Data:** 2026-07-28
**Status:** Design aprovado nas três seções. Pronto para plano de implementação.
**Branch:** `feat/rebrand-ccc-app-sweep`
**Origem:** brainstorming 2026-07-28, handoff `.handoffs/assinaturas-contratacao-handoff.md`.
**Canon obrigatório:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.1–§F8.16.

Este spec está em PT-BR por decisão de revisão. Os specs anteriores do repo estão em inglês.

---

## 1. Escopo

O módulo de assinaturas multi-tier (P1–P4) já entregou catálogo, telas de planos e leitura da assinatura. O botão "Assinar" é um stub honesto que só mostra um toast (`apps/mobile/src/screens/assinaturas/checkout.ts:16`).

Este spec cobre o fechamento do módulo:

- contratação real, com montagem de pacote (plano + módulos opcionais) num único checkout;
- cancelamento pelo membro, ao fim do período;
- histórico de cobranças na tela Minha Assinatura;
- benefícios do plano na tela Minha Assinatura;
- card premium com tier no Perfil;
- correção do `tierFromPrice()` hardcoded que quebra multi-tier.

**Fora de escopo:** Pix em assinatura (AbacatePay não tem API de assinatura, Stripe não suporta Pix em subscription). Compra no iOS (regra da App Store, lint rule `no-stripe-on-ios.cjs`). Cadência anual. Upgrade e downgrade de tier em assinatura viva. Model novo de transições de estado.

---

## 2. Decisões travadas

| #   | Decisão                        | Escolha                                                                                                                         |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Meios de pagamento             | Só cartão via Stripe, em Android e web. iOS mostra aviso para contratar pela web                                                |
| 2   | Histórico                      | Só histórico de cobranças, lendo `PremiumMembershipInvoice`. Sem model novo                                                     |
| 3   | Tela legada `/profile/premium` | Remover só a entrada do menu do Perfil. Arquivos e rota permanecem                                                              |
| 4   | Validação                      | Testes automatizados com `FakeStripe`. O usuário cadastra os price IDs pelo painel admin. Não chamar a conta Stripe real        |
| 5   | Add-ons no checkout            | Checkout multi-line-item. Uma sessão em `mode: 'subscription'` com `line_items = [plano, ...módulos]`                           |
| 6   | Cancelamento                   | Rota própria que chama `cancel_at_period_end: true`. O webhook escreve no banco                                                 |
| 7   | Retorno web do Stripe          | Trocar `successUrl`/`cancelUrl` no backend para o módulo novo. Sem parâmetro vindo do cliente                                   |
| 8   | `devFeePercent`                | Continua saindo só de `Price.metadata`. Metadata ausente grava 0. **A metadata passa a ser obrigatória em cada price de plano** |
| 9   | Confirmação de cancelamento    | `SheetShell` com props de tema aditivas. Não usar `confirmDestructive()`                                                        |

---

## 3. Banco de dados: zero migrations

Verificado requisito por requisito contra `packages/db/prisma/schema.prisma`.

| Requisito                      | Tabela existente que atende                                                      |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Módulos no checkout            | `PremiumMembershipAddon` + `PremiumAddonUsage`                                   |
| Cancelamento                   | `PremiumMembership.cancelAtPeriodEnd`, `.cancelledAt`, status `cancel_scheduled` |
| Histórico de cobranças         | `PremiumMembershipInvoice`                                                       |
| Benefícios em Minha Assinatura | `PremiumPlanBenefit`                                                             |

O agente de Banco de Dados não tem trabalho estrutural. A entrega dele é a confirmação escrita disso, campo a campo. Não inventar tabela, não propor migration.

Invariante que continua valendo: premium é ancorado em `Garage`, não em `User`. `User → Garage (1:1) → PremiumMembership`.

---

## 4. Backend

### 4.1 Rotas

```
POST   /api/me/premium/cancel        NOVA
GET    /api/me/premium/invoices      NOVA
POST   /api/me/premium/checkout      ALTERADA
GET    /api/me/premium/subscription  ALTERADA
```

#### `POST /api/me/premium/cancel`

- Guards: `app.authenticate`, flag `GROWTH_PREMIUM_BILLING_ENABLED` (503 quando off), rate limit 5/min por `sub`.
- Chama `stripe.subscriptions.update({ cancel_at_period_end: true })` com idempotency key `cancel_sub_{membershipId}`.
- **Não escreve no banco.** Quem escreve é o webhook `customer.subscription.updated`, já mapeado para `subscription.cancelled` em `normalize-stripe.ts:180-188` e tratado por `handleCancelled` (`apply-membership-event.ts:279`). Mantém a invariante: estado de assinatura só muda por webhook verificado.
- Resposta: `{ cancelAtPeriodEnd: true, currentPeriodEnd }`.
- Sem membership viva: 404.
- Membership `apple_revenuecat`: 409 com `manageUrl` da App Store, mesmo padrão de `billing-portal` (`me-premium.ts:212`).

#### `GET /api/me/premium/invoices`

- Guards: `app.authenticate` + flag.
- Lê `PremiumMembershipInvoice` das memberships da garagem do usuário, `orderBy periodStart desc`, `take 24`.
- Resposta: `{ invoices: [{ periodStart, periodEnd, paidAt, grossAmountCents, currency, status, refundedAt }] }`.
- **Nunca** expõe `providerInvoiceRef` nem `providerTransactionRef`.

#### `POST /api/me/premium/checkout` (alterada)

- Body ganha `addonKeys?: string[]`, máximo 10.
- Chave desconhecida ou módulo inativo no catálogo: 400. Mais de 10 chaves: 422, que é o código que a rota já devolve para falha de `safeParse`.
- Resolve o `stripePriceId` de cada módulo ativo do catálogo. Se algum faltar, responde 503 listando exatamente as chaves faltantes. A distinção importa: 400 é erro do cliente, 503 é catálogo mal configurado pelo operador.
- Passa `[planPriceId, ...addonPriceIds]` para a sessão, nessa ordem.
- Idempotency key passa de `checkout_sub_{garageId}_{cadence}` para incluir `planSlug` e um digest curto dos `addonKeys` ordenados. Sem isso, trocar de pacote e tentar de novo colide na key (risco R4).
- Guard de sessão aberta (`me-premium.ts:242-251`): antes de criar a nova sessão, expira a aberta. Ver risco R5.
- `successUrl` passa a ser `${APP_WEB_BASE_URL}/assinaturas/checkout-return`. `cancelUrl` passa a ser `${APP_WEB_BASE_URL}/assinaturas`. Hoje apontam para `/premium/success` e `/premium`, que são páginas do F8 legado gold-only no admin (`me-premium.ts:258-259`).

#### `GET /api/me/premium/subscription` (alterada)

- Resposta ganha `benefits: string[]` (de `PremiumPlanBenefit`, ordenado por `sortOrder`) e `planDescription: string | null`.

### 4.2 Serviços Stripe

`apps/api/src/services/stripe/index.ts`

- `createSubscriptionCheckoutSession` (`:322`): `priceId: string` vira `priceIds: string[]`, mapeado para `line_items`. Único call-site é `me-premium.ts`.
- Método novo `expireCheckoutSession(sessionId)`. Justificativa: sem ele, o membro que abandona o checkout e muda o pacote fica preso na sessão antiga por até 24h (risco R5). É um método a mais numa interface existente, não uma arquitetura nova.
- `FakeStripe` (`services/stripe/fake.ts`) atualizado junto, nos dois pontos.

### 4.3 Normalizer e rota do webhook

`apps/api/src/services/billing/normalize-stripe.ts`

- Remover `tierFromPrice()` (`:22-25`), que retorna `'gold'` hardcoded e quebra multi-tier.
- O normalizer passa a devolver as linhas da fatura: `lines: [{ priceRef, amountCents, subscriptionItemRef }]`, lidas de `invoice.lines.data[].price.id`, `.amount` e `.subscription_item`.
- `tier` e `baseAmountCents` viram placeholder, exatamente como `garageId` já é hoje. O precedente está documentado em `normalize-stripe.ts:71-74`. A rota patcha.
- `devFeePercent` continua saindo de `Price.metadata.devFeePercent`, mas da linha que casa com o plano, não de `lines.data[0]`. Metadata ausente continua gravando 0 (decisão 8).
- O mesmo tratamento vale para o ramo `tier_changed` (`:198-222`), que hoje lê `items.data[0]`.

`apps/api/src/routes/stripe-billing-webhook.ts`

- Resolve as linhas contra o catálogo no banco, que é a fonte da verdade. Não confiar em metadata do Stripe para tier.
  - linha que casa com `PremiumPlanPrice.stripePriceId` define `tier`, `cadence` e `baseAmountCents`;
  - linhas que casam com `PremiumAddonModule.stripePriceId` viram `addonsAmountCents` e a lista de add-ons a criar.
- Patcha o `BillingEvent` antes de despachar, no mesmo ponto onde já patcha `garageId`.
- No ramo `tier_changed`: se o price trocado for de módulo e não de plano, descarta o evento. `reconcileMembershipAddonsAmount` já rodou antes do normalize (`stripe-billing-webhook.ts:184-199`). Ver risco R6.

### 4.4 `apply-membership-event.ts`

`handleActivated` (`:53`) passa a criar `PremiumMembershipAddon` e `PremiumAddonUsage` na **mesma transação** da ativação, a partir da lista resolvida pela rota. `providerItemRef` recebe o `subscriptionItemRef` da linha.

- Sem chamada externa dentro da transação. Sem estado parcial.
- Criação por **upsert** em `[membershipId, addonKey]`, voltando o status para `active`. O unique não filtra status, então recontratar um módulo antes cancelado violaria a constraint (risco R7).
- Respeitar canon §F8.5: o chamador já fez `SELECT id FROM "Garage" WHERE id = $garageId FOR UPDATE` na mesma transação.
- Respeitar canon §F8.6: exatamente um `awardXp` por transação. O `awardXp('premium_activation', delta: 200)` que já existe continua sendo o único.

### 4.5 Rate limit

Nenhuma rota premium tem rate limit hoje. Adicionar:

| Rota                            | Limite |
| ------------------------------- | ------ |
| `POST /api/me/premium/checkout` | 5/min  |
| `POST /api/me/premium/cancel`   | 5/min  |
| `POST /api/me/premium/addons`   | 20/min |

Padrão obrigatório, com escopo encapsulado e `hook: 'preHandler'` porque a chave usa `request.user`:

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

Referências: `apps/api/src/routes/orders.ts:369` e `apps/api/src/routes/admin/index.ts:112-116`.

### 4.6 Shared schemas

`packages/shared/src/`

- `premium.ts`: `premiumCheckoutRequestSchema` ganha `addonKeys?: string[]` com `.max(10)`. `premiumStatusSchema.tier` passa de `z.enum(['gold'])` para `z.enum(['bronze','silver','gold'])` (risco R8).
- `premium-subscription.ts`: `mySubscriptionResponseSchema` ganha `benefits` e `planDescription`. Schema novo `premiumInvoicesResponseSchema`.
- Depois de qualquer mudança: `pnpm --filter @ccc/shared build`. Canon §F8.13.
- `src/index.ts` re-exporta `./premium.js` mas não `premium-catalog` nem `premium-subscription`. Esses continuam só por subpath.

---

## 5. Mobile

### 5.1 Tela de contratação

Rota nova `app/(app)/assinaturas/contratar.tsx`, param `?slug=`. Shim fino sobre `src/screens/assinaturas/ContratarScreen.tsx`, seguindo o padrão dos outros arquivos de `app/(app)/assinaturas/`.

Tela e não sheet: o conteúdo é grande (módulos com descrição, quota, preço, toggle, resumo, avisos) e um sheet forçaria scroll dentro de scroll.

- Dados: `getPremiumPlan(slug)` e `usePremiumAddonModules()`. Padrão manual de fetch já usado no app. Não existe react-query nem SWR e não vamos introduzir.
- Estado: `selected: Set<string>` de `addonKeys`. Total derivado no render, sem `useEffect`.
- Layout: header padrão (ArrowLeft e título), card compacto do plano, lista de módulos, barra fixa no rodapé com base, módulos, total e CTA.
- CTA usa `tierStyle()` de `tier-visual.ts`, com gradiente no ouro.
- Anti-duplo-clique: guard `if (submitting) return` no início do handler, mais `disabled` no Pressable. Label vira "PROCESSANDO...".

### 5.2 Seam de checkout

`src/screens/assinaturas/checkout.ts` deixa de ser síncrono. É o único arquivo que muda de contrato.

```ts
export type CheckoutOutcome =
  | { kind: 'redirected' } // web navegou para o Stripe
  | { kind: 'returned' } // Android: browser fechou com sucesso
  | { kind: 'dismissed' } // usuário desistiu
  | { kind: 'ios_unsupported' }
  | { kind: 'error'; message: string };

export async function startPremiumCheckout(input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<CheckoutOutcome>;
```

- iOS retorna `ios_unsupported` sem tocar na API. Respeita `eslint-rules/no-stripe-on-ios.cjs`. A tela mostra o aviso para contratar pela web.
- Caso contrário chama `POST /api/me/premium/checkout` com `{ cadence: 'monthly', planSlug, addonKeys }`.
- Web: `window.location.href = url`.
- Android: `WebBrowser.openAuthSessionAsync(url, 'ccc://premium/return')`, mesmo padrão de `src/screens/settings/PremiumScreen.tsx:141`.
- Client HTTP novo em `src/api/premium.ts`, que já existe.

### 5.3 Confirmação pós-pagamento

O webhook é assíncrono. O retorno do browser não prova pagamento.

Depois de `returned`, a tela entra em "Confirmando pagamento...". Polling de `getMyPremiumSubscription()` a cada 2s, máximo 15 tentativas. Mesmo padrão de `app/(app)/events/buy/checkout-return.tsx`.

| Resultado                | Tela faz                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| `redirected`             | Nada. A página já navegou para o Stripe. O retorno entra por `checkout-return` |
| `active === true`        | `router.replace('/assinaturas/minha-assinatura')` e toast de sucesso           |
| Esgotou as 15 tentativas | Estado "Pagamento em processamento", CTA "Ver minha assinatura". Não é erro    |
| `dismissed`              | Volta ao formulário intacto                                                    |
| `error`                  | Mensagem inline acima do CTA e botão para tentar de novo                       |

Rota nova `app/(app)/assinaturas/checkout-return.tsx`, só usada na web. Executa o mesmo polling e redireciona. No Android ela nunca abre, o deep link resolve antes.

### 5.4 `/assinaturas` vira Minha Assinatura

`PlanosScreen` passa a chamar `usePremiumSubscription()`. Se `active`, faz `router.replace('/assinaturas/minha-assinatura')` ainda durante o loading que já existe, sem flash da lista de planos.

Escape hatch: link "Ver todos os planos" no rodapé de Minha Assinatura, apontando para `/assinaturas?all=1`, que ignora o redirect. Sem ele o assinante perde o caminho de upgrade de tier.

Isso também resolve a rota órfã: hoje nenhum `router.push` aponta para `/assinaturas/minha-assinatura`.

### 5.5 Reuso de componentes

O módulo assinaturas não usa `@ccc/ui` em lugar nenhum. Tem paleta própria `c` em `tier-visual.ts:13`, marcada como autoritativa no cabeçalho do arquivo.

| Componente            | Decisão                                                                    | Motivo                                                                                                              |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SheetShell`          | Usar, com props opcionais de tema (surface, border, cor e fonte do título) | Hoje usa `garageTokens.surface.sheet` e fonte de sistema. Props aditivas evitam componente novo e duplicação        |
| `Button` de `@ccc/ui` | Não usar                                                                   | O CTA precisa do gradiente por tier. Extrair `TierCta` local do bloco duplicado em `PlanoDetalheScreen.tsx:176-206` |
| `PremiumBadge`        | Usar, só no Perfil                                                         | Mesmo padrão de `src/screens/garage/IdentityCard.tsx:49`                                                            |
| `tier-visual.ts`      | Usar em tudo                                                               | Já é a fonte de estilo por tier                                                                                     |

### 5.6 Card premium no Perfil

O hero card (`app/(app)/profile/index.tsx:152-176`) ganha o tier abaixo de nome, email e cidade. Fonte: `usePremiumSubscription()`, que já é 503-safe. Sem assinatura, não renderiza nada.

Render: `<PremiumBadge isPremiumActive tier={...} />` e o label "Membro Ouro" / "Membro Prata" / "Membro Bronze".

Menu: remover a linha que aponta para `/profile/premium` (`:232-237`). A tela e a rota permanecem no código, sem link (decisão 3).

Nota de paleta: `PremiumBadge` usa `garage-tokens` (gold `#E8B339`) e o Perfil usa `src/theme` (`bg: '#0B0B0F'`). São diferentes da paleta de assinaturas. Aceito: o Perfil já é visualmente outra tela e esse é o padrão local dele.

### 5.7 Minha Assinatura: três blocos novos

1. **Benefícios** — de `subscription.benefits[]`. Visual igual ao de `PlanoDetalheScreen.tsx:164-171` (ícone `Check` na cor do tier mais texto).
2. **Histórico de cobranças** — hook novo `usePremiumInvoices()` sobre `GET /api/me/premium/invoices`. Linhas com período, data de pagamento, valor e status. `refundedAt` preenchido mostra "Estornado". Lista vazia mostra "Nenhuma cobrança ainda". Erro derruba só a seção, nunca a tela.
3. **Cancelar** — botão discreto em tom danger no fim da tela. Abre `SheetShell` explicando o que acontece e a data em que o acesso termina, com "Manter assinatura" e "Cancelar assinatura" (com loading). Sucesso fecha o sheet, chama `refresh()` e mostra toast.

A tela já renderiza "Cancela em {data}" quando `cancelAtPeriodEnd` é true (`MinhaAssinaturaScreen.tsx:88`). O estado cancelado não precisa de UI nova.

Membership `apple_revenuecat` recebe 409 com `manageUrl`. O sheet troca o conteúdo para "Gerencie pela App Store" e abre o link.

### 5.8 Copy

Tudo em `src/copy/assinaturas.ts`. Chaves novas em `checkout`, `minhaAssinatura.historico` e `minhaAssinatura.cancelar`. A chave `checkout.comingSoon` sai.

---

## 6. Riscos e mitigações

| #   | Risco                                                                                                                                                                                     | Mitigação                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Checkout multi-line exige o mesmo `interval` e a mesma `currency` em todos os prices                                                                                                      | Sem pré-validação, que custaria um roundtrip Stripe por checkout. O erro do Stripe vira 503 com mensagem clara. Teste com `FakeStripe` cobrindo o caminho |
| R2  | `pricingFromInvoice` lê `invoice.lines.data[0]` (`normalize-stripe.ts:42`), o que deixa de ser confiável com multi-line                                                                   | `baseAmountCents` e `tier` viram placeholder. A rota resolve pela linha que casa com `PremiumPlanPrice.stripePriceId`                                     |
| R3  | `devFeePercent` vem de `Price.metadata` e ausente grava 0 silenciosamente                                                                                                                 | Comportamento mantido por decisão. Consequência: a metadata `devFeePercent` é **obrigatória** em cada price de plano, e isso está no passo de ops         |
| R4  | Idempotency key `checkout_sub_{garageId}_{cadence}` (`me-premium.ts:253`) não inclui plano nem módulos                                                                                    | A key passa a incluir `planSlug` e um digest curto dos `addonKeys` ordenados                                                                              |
| R5  | Guard de sessão aberta devolve 409 com a URL do pacote antigo                                                                                                                             | `expireCheckoutSession` antes de criar a nova sessão                                                                                                      |
| R6  | Discriminador de `tier_changed` usa `items.data[0]` (`normalize-stripe.ts:199-201`). Adicionar módulo dispara `customer.subscription.updated` e pode virar `tier_changed` com tier errado | `tier` vira placeholder também nesse ramo. A rota resolve contra o catálogo e descarta quando o price trocado for de módulo                               |
| R7  | `PremiumMembershipAddon.@@unique([membershipId, addonKey])` não filtra status. Recontratar módulo antes cancelado viola o unique                                                          | Upsert por `[membershipId, addonKey]` com status voltando para `active`. Sem migration                                                                    |
| R8  | `premiumStatusSchema.tier = z.enum(['gold'])` (`premium.ts:65`). Membership bronze ou prata derruba `GET /api/me/premium/status` no `parse`                                               | Virar `z.enum(['bronze','silver','gold'])` e rodar `pnpm --filter @ccc/shared build`                                                                      |
| R9  | `resetDatabase()` não limpa `PremiumPlan` nem `PremiumAddonModule`                                                                                                                        | Seguir o padrão existente: `resetCatalog()` local em cada arquivo de teste. Não mexer no helper                                                           |

---

## 7. Testes

### 7.1 API

Testcontainers com Postgres real e `FakeStripe`, conforme `apps/api/test/global-setup.ts`. Arquivos em `apps/api/test/billing/`.

**`premium-cancel.test.ts`**

- 401 sem auth, 503 com a flag off, 404 sem membership viva
- 409 com `manageUrl` para membership `apple_revenuecat`
- 200 chama o Stripe com `cancel_at_period_end` e a idempotency key correta
- o banco não muda na resposta 200
- sexta chamada dentro do minuto retorna 429

**`premium-invoices.test.ts`**

- ordem `periodStart desc` e `take 24`
- a resposta nunca contém `providerInvoiceRef` nem `providerTransactionRef`
- sem faturas retorna lista vazia
- isolamento: usuário A não vê fatura de B

**`premium-checkout-addons.test.ts`**

- `line_items` na ordem `[plano, ...módulos]`
- módulo ativo sem `stripePriceId` retorna 503 listando as chaves faltantes
- mais de 10 `addonKeys` retorna 422 (falha de schema, mesmo código já usado pela rota)
- falha do Stripe ao criar a sessão vira 503 com mensagem clara (R1)
- a idempotency key muda quando a seleção muda (R4)
- a sessão aberta é expirada antes de criar a nova (R5)

**`stripe-billing-webhook.test.ts`** (estender)

- `invoice.paid` multi-line cria membership, `PremiumMembershipAddon` e `PremiumAddonUsage` na mesma transação
- `tier` vem do catálogo e não da metadata: regressão direta do `tierFromPrice` (R2)
- módulo antes cancelado é reativado por upsert, sem violar o unique (R7)
- `customer.subscription.updated` trocando item de módulo não gera `tier_changed` (R6)

**Unit do normalizer**

- `lines[]` populado a partir de `invoice.lines.data`
- `tier` e `baseAmountCents` como placeholder

### 7.2 Mobile

Vitest já existe e testa módulos puros, não telas. Seguir o padrão de `src/cart/web-stripe-redirect.test.ts`.

**`checkout.test.ts`**

- iOS retorna `ios_unsupported` sem chamar a API
- web usa `window.location.href`
- Android mapeia o resultado do `WebBrowser` para `returned` ou `dismissed`
- erro da API vira `{ kind: 'error' }`

**`package-total.test.ts`**

- função pura de soma: base mais módulos selecionados

**CORRIGIDO em 2026-07-29 depois de medir.** A frase original aqui — "sem teste de tela, não existe React Native Testing Library configurado" — era **falsa**. Veio de um `find` com `-maxdepth 3` que não enxergou os diretórios `__tests__`.

O app tem 73 arquivos de teste. Testes de tela existem e rodam em jsdom com `react-dom/client` mais um mock do módulo `react-native`, sem RNTL. O cabeçalho do padrão é `// @vitest-environment jsdom`.

Testes existentes que as tasks de mobile deste plano vão quebrar e precisam atualizar:

| Arquivo                                                            | Quem quebra                                         |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `src/api/__tests__/premium.test.ts`                                | Task 10, muda o client                              |
| `src/screens/assinaturas/__tests__/PlanoDetalheScreen.test.tsx`    | Tasks 11 e 12, o CTA passa a navegar                |
| `src/screens/assinaturas/__tests__/PlanosScreen.test.tsx`          | Task 14, ganha redirect de assinante                |
| `src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx` | Task 15, ganha benefícios, histórico e cancelamento |
| `src/screens/settings/__tests__/ios-stripe-isolation.test.ts`      | Task 11, mexe no guard de iOS                       |

Atualizar asserção cuja intenção mudou é correção. Apagar teste não é.

---

## 8. Sequência de implementação

Orquestrador coordena agentes especialistas nesta ordem obrigatória. Backend-first: nenhuma tela antes da infra existir.

| Ordem | Agente         | Entrega                                                                                                                                                                                      | Gate para o próximo                 |
| ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1     | Banco de dados | Confirmação escrita de zero migrations, verificada campo a campo contra a seção 3                                                                                                            | Confirmação registrada              |
| 2     | Backend        | Shared schemas primeiro, depois `pnpm --filter @ccc/shared build`. Então normalizer, rota do webhook, `apply-membership-event`, rotas novas, rate limit, `successUrl`. Testes escritos junto | `pnpm --filter @ccc/api test` verde |
| 3     | Frontend       | Só depois do gate 2. Ordem: copy, api clients, hooks, seam de checkout com teste, `ContratarScreen`, `checkout-return`, Minha Assinatura, Perfil, remoção do item de menu legado             | `pnpm typecheck` verde              |
| 4     | Revisor        | Diff contra este spec, canon §F8.5, §F8.6, §F8.10 e §F8.13, e a invariante de que estado de assinatura só muda por webhook verificado                                                        | Aprovação                           |

Regras para todos os agentes: não criar arquitetura paralela, não duplicar, reutilizar o que já existe, justificar tecnicamente qualquer mudança estrutural.

---

## 9. Ops: cadastrar os price IDs

Feito pelo usuário no painel do Stripe, seguindo `docs/stripe.md`.

1. Um Product por plano: Ingresso, Estrada, Fundador. Um Product por módulo: Detailing, Oficina.
2. Um Price recorrente em cada, mensal e em BRL. Todos com o mesmo intervalo e a mesma moeda, senão o checkout multi-line falha (R1).
3. No price de cada plano, preencher a metadata `devFeePercent`. **Obrigatório.** Ausente, a taxa é gravada como 0 (decisão 8, risco R3).
4. Copiar cada `price_...` e colar no admin, em `/premium/catalogo`.
5. Conferir: `GET /api/plans` devolve os três planos. Se algum `stripePriceId` ficou vazio, o checkout responde 503 listando exatamente as chaves faltantes.
6. Webhook: endpoint `/webhooks/stripe-billing`, `STRIPE_BILLING_WEBHOOK_SECRET` configurado, eventos `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` e `charge.refunded`.

Valores semeados hoje (`packages/db/prisma/seed.ts`, `seedPremiumCatalog`):

| tier   | slug       | nome     | mensal      |
| ------ | ---------- | -------- | ----------- |
| bronze | `ingresso` | Ingresso | R$ 490,00   |
| silver | `estrada`  | Estrada  | R$ 890,00   |
| gold   | `fundador` | Fundador | R$ 1.490,00 |

Módulos: `detailing` (R$ 150,00, 3 acessos por mês) e `oficina` (R$ 500,00, 5 horas por mês). Só a cadência `monthly` é semeada. Os `stripePriceId` ficam `null` de propósito.
