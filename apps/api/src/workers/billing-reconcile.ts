import { prisma } from '@ccc/db';
import type { PremiumMembership } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { applyMembershipEvent } from '../services/billing/apply-membership-event.js';
import { openMonthlyBoxIfEligible } from '../services/box/open.js';
import type { BillingEvent } from '../services/billing/types.js';
import type { RevenueCatClient } from '../services/revenuecat/client.js';
import type { StripeClient } from '../services/stripe/index.js';

export type ReconcileTickDeps = {
  stripe: StripeClient;
  rc: RevenueCatClient;
  alertDepth: number;
  flagEnabled?: boolean;
  now?: Date;
  log?: FastifyBaseLogger;
};

const STALE_STATUSES: Array<'active' | 'past_due' | 'cancel_scheduled'> = [
  'active',
  'past_due',
  'cancel_scheduled',
];
const QUERY_LIMIT = 200;

/**
 * TTL da tentativa de assinatura nativa (2026-08-29, Task 11).
 *
 * 23h, nao 24h, e nao e arredondamento. A Stripe transiciona uma assinatura
 * `incomplete` para `incomplete_expired` em 24h. Reapar depois disso deixaria
 * a tentativa apontando para uma assinatura ja morta, e o membro travado no
 * intervalo. Reapar antes devolve a garagem ao estado limpo enquanto ainda ha
 * chance de o pagamento chegar.
 *
 * Sem reaping nenhum, quem toca em assinar e fecha o app fica travado para
 * sempre: o indice unico parcial recusa toda tentativa nova.
 *
 * Aplica-se a linhas com `providerSubRef` PREENCHIDO — subscriptions.create
 * ja voltou, entao existe uma assinatura Stripe de verdade que ainda pode
 * confirmar.
 */
const ATTEMPT_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * TTL curto para tentativas cujo `providerSubRef` nunca chegou a ser gravado.
 *
 * Duas origens possiveis para essa linha, ambas em me-premium.ts:
 *   1. Falha ANTES de chamar createNativeSubscription (rede fora do ar ao
 *      consultar checkout hospedado aberto, etc) — nesse caso a rota ja marca
 *      `abandoned` no mesmo request (abandonIfJustCreated); nao chega ate aqui.
 *   2. Falha AMBIGUA da propria Stripe (timeout, 5xx, corrida de
 *      idempotency_error) — a rota deixa a linha 'pending' de proposito,
 *      porque a assinatura PODE ter sido criada do lado da Stripe mesmo sem
 *      confirmar o id aqui (ver comentario em me-premium.ts junto do catch de
 *      createNativeSubscription).
 *
 * Mesmo no caso 2, esta linha e inerte para fins de cobranca: o webhook
 * `invoice.paid`/`subscription.activated` casa a tentativa por
 * `providerSubRef` (apply-membership-event.ts:162-165), e essa linha nunca
 * tem um `providerSubRef` para casar. Se a Stripe de fato criou a assinatura,
 * o `PremiumMembership` e criado do mesmo jeito via o id que vem no proprio
 * evento — esta linha so existe para o guard local de "uma tentativa pendente
 * por garagem", e reapa-la cedo nao apaga nem esconde nenhuma cobranca real.
 * Por isso pode (e deve) ser reapada bem antes do TTL de 23h: nada esta "em
 * voo" do ponto de vista desta tabela.
 *
 * 15 minutos e uma folga confortavel acima de qualquer round-trip + retry
 * real (segundos), sem deixar a garagem presa por horas por causa de uma
 * falha ambigua rara. Na pratica a janela real e 15-75 minutos, nao 15: esta
 * funcao so roda dentro de `runReconcileTick`, chamada pelo cron HORARIO
 * (`0 * * * *`, ver startBillingReconcileWorker abaixo) — uma linha que
 * cruza o TTL logo depois de um tick so e reapada no proximo, ate quase uma
 * hora depois. Nao resolve o cenario de UX levantado em review (usuario
 * troca de plano no meio do fluxo) — nesse caso o `providerSubRef` normalmente
 * ja foi gravado antes da resposta do request voltar ao cliente, entao a linha
 * cai no TTL de 23h de qualquer forma. Ver relatorio da tarefa.
 *
 * TRADE-OFF ACEITO (revisao 2026-08-30): Task 9 deriva a idempotency key de
 * `attempt.id` justamente para que um novo toque no MESMO pending row (branch
 * `reuse`) replique a mesma chave e a Stripe devolva a assinatura ORIGINAL
 * (recuperando o orfao em vez de mintar uma segunda). Reapar em 15min mata
 * essa recuperacao no caso 2 acima: o novo toque cria uma tentativa nova, uma
 * chave nova, e a Stripe abre uma segunda assinatura de verdade enquanto a
 * primeira so expira sozinha em ~24h. Aceito de qualquer forma porque os
 * casos 1 e 2 sao INDISTINGUIVEIS por esta query — ambos so tem `pending` +
 * `providerSubRef` nulo — e o caso 1 (crash antes de qualquer chamada a
 * Stripe, nada la fora) e puro dano se travado por 23h. Perder a reutilizacao
 * do caso 2 custa uma assinatura `incomplete` a mais que se autoexpira sem
 * cobrar nada; manter o caso 1 preso por 23h e dano real ao usuario. Ganho
 * rapido vence.
 */
const ATTEMPT_TTL_NO_SUBREF_MS = 15 * 60 * 1000;
const STRIPE_EXPIRED_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid']);
const RC_PREMIUM_ENTITLEMENT_KEY = 'premium_gold';
// Synthetic invoice period used for reconcile-synthesised renewals. Real
// invoice metadata is unknown from a single Subscription retrieve; the prior
// period is approximated as (newPeriodEnd - 30d) so the invoice row records
// a sane bracket. `apply-membership-event.handleRenewed` carries the canonical
// period on the membership row regardless.
const APPROX_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Per-row reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Reconcile one Stripe-backed membership. Returns the BillingEvent to apply,
 * or null if no action needed (in-flight dunning, status we do not handle).
 *
 * Stripe SDK 2026-04-22 dahlia exposes `current_period_{start,end}` on
 * `SubscriptionItem`, not on `Subscription` (see Subscriptions.d.ts +
 * SubscriptionItems.d.ts in the SDK). We read the first item's bracket.
 */
const reconcileStripeRow = async (
  row: PremiumMembership,
  stripe: StripeClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const sub = await stripe.retrieveSubscription(row.providerSubRef);

  const item = sub.items.data[0];
  const itemPeriodEnd =
    item && typeof item.current_period_end === 'number' ? item.current_period_end : null;

  if (
    sub.status === 'active' &&
    itemPeriodEnd !== null &&
    itemPeriodEnd > Math.floor(now.getTime() / 1000)
  ) {
    // Webhook was lost — synthesise a renewal BillingEvent. Pricing is
    // re-snapshotted from Stripe.Price.metadata (canon §F8.1 — devFee from
    // provider, never from env). The reconcile-synthesised invoice ref is
    // stable across re-runs of the sweep so a second tick is idempotent
    // via the @@unique([provider, providerInvoiceRef]) + handleRenewed's
    // SAVEPOINT P2002 swallow.
    // `item` is non-null inside this branch — the guard above requires
    // `itemPeriodEnd !== null`, which only holds when `item` exists.
    const newPeriodEnd = new Date(itemPeriodEnd * 1000);
    const price = item!.price;
    // Use Number.isFinite to accept a valid `0` metadata value (e.g. a free
    // promotional Stripe price, or an Apple/RC-imported price whose dev fee
    // is genuinely 0). `|| row.devFeePercent` would treat 0 as falsy and
    // silently fall back to the prior snapshot, masking provider intent.
    const parsedBase = price
      ? parseInt(String(price.metadata?.baseAmountCents ?? ''), 10)
      : Number.NaN;
    const baseAmountCents = Number.isFinite(parsedBase) ? parsedBase : row.baseAmountCents;
    const parsedFee = price
      ? parseInt(String(price.metadata?.devFeePercent ?? ''), 10)
      : Number.NaN;
    const devFeePercent = Number.isFinite(parsedFee) ? parsedFee : row.devFeePercent;
    const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
    const grossAmountCents = baseAmountCents + devFeeAmountCents;

    const periodStart = new Date(newPeriodEnd.getTime() - APPROX_PERIOD_MS);

    const renewalEvent: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      currentPeriodStart: periodStart,
      currentPeriodEnd: newPeriodEnd,
      pricing: {
        baseAmountCents,
        devFeePercent,
        devFeeAmountCents,
        grossAmountCents,
        currency: row.currency,
      },
      invoice: {
        providerInvoiceRef: `reconcile:${row.providerSubRef}:${itemPeriodEnd}`,
        periodStart,
        periodEnd: newPeriodEnd,
        paidAt: now,
      },
      // Genuinely empty, not a placeholder: this event is synthesised from a
      // single Stripe Subscription retrieve, which carries pricing straight
      // from the provider. There is no multi-line invoice here for a route
      // to decompose, so `lines` has nothing to carry.
      lines: [],
    };
    return renewalEvent;
  }

  if (STRIPE_EXPIRED_STATUSES.has(sub.status)) {
    const expiredEvent: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
    return expiredEvent;
  }

  return null; // in-flight (e.g. incomplete, paused, trialing) — no action this tick
};

/**
 * Reconcile one RC-backed membership. Returns the BillingEvent to apply, or
 * null if no action needed. RC `expiresDate: null` denotes a non-expiring
 * (lifetime) entitlement.
 */
const reconcileRcRow = async (
  row: PremiumMembership,
  rc: RevenueCatClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const subscriber = await rc.getSubscriber(row.providerCustomerRef);

  const entitlement = subscriber.entitlements[RC_PREMIUM_ENTITLEMENT_KEY];
  if (!entitlement) {
    return {
      kind: 'subscription.expired',
      provider: 'apple_revenuecat',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
  }

  if (entitlement.expiresDate === null) {
    // Lifetime entitlement — entitlement still valid, no period to advance.
    return null;
  }

  const expiresAt = new Date(entitlement.expiresDate);
  if (expiresAt > now) {
    // Entitlement still valid — webhook was lost; synthesise renewal.
    // Apple/RC path: devFeePercent = 0 (canon §F8.1 — Apple takes the cut
    // upstream, so the platform does not double-charge a dev fee).
    const periodStart = new Date(expiresAt.getTime() - APPROX_PERIOD_MS);

    return {
      kind: 'subscription.renewed',
      provider: 'apple_revenuecat',
      providerSubRef: row.providerSubRef,
      currentPeriodStart: periodStart,
      currentPeriodEnd: expiresAt,
      pricing: {
        baseAmountCents: row.baseAmountCents,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        grossAmountCents: row.grossAmountCents,
        currency: row.currency,
      },
      invoice: {
        providerInvoiceRef: `reconcile:${row.providerSubRef}:${expiresAt.getTime()}`,
        periodStart,
        periodEnd: expiresAt,
        paidAt: now,
      },
      // Genuinely empty, not a placeholder: RC's getSubscriber reads pricing
      // straight from the provider (row snapshot below), never through a
      // multi-line invoice a route would need to decompose.
      lines: [],
    };
  }

  // expiresDate in the past — entitlement expired.
  return {
    kind: 'subscription.expired',
    provider: 'apple_revenuecat',
    providerSubRef: row.providerSubRef,
    cancelledAt: now,
  };
};

// ---------------------------------------------------------------------------
// Attempt reaping (Task 11)
// ---------------------------------------------------------------------------

/**
 * Reapa `PremiumSubscriptionAttempt` rows presas em `pending` alem do TTL
 * (canon: schema.prisma comment on the model, "RISCO CONHECIDO").
 *
 * So toca em `status: 'pending'` — nunca em `succeeded`, `abandoned` ou
 * `failed`. Uma linha `succeeded` e uma assinatura real e paga; corrompe-la
 * corromperia o registro de um assinante de verdade.
 *
 * Duas janelas (ver ATTEMPT_TTL_MS / ATTEMPT_TTL_NO_SUBREF_MS acima):
 *   - `providerSubRef` preenchido: 23h — pode haver uma assinatura Stripe
 *     `incomplete` ainda confirmavel.
 *   - `providerSubRef` nulo: 15min — nada foi criado do lado da Stripe que
 *     esta linha consiga rastrear; nao ha nada "em voo" para essa tabela.
 *
 * NAO faz nenhuma chamada a Stripe. So marca a linha; uma assinatura
 * `incomplete` nao confirmada expira sozinha na Stripe em ~24h. Cancelar
 * daqui arriscaria atingir uma assinatura que na verdade ja confirmou e cujo
 * webhook so esta atrasado.
 *
 * Idempotente e seguro a reinicio: um `updateMany` condicionado a
 * `status: 'pending'`, sem estado em memoria. Rodar de novo so re-avalia as
 * linhas que ainda estao pending e vencidas; nada e reprocessado.
 */
export const reapAbandonedAttempts = async (
  now: Date,
  log?: FastifyBaseLogger,
): Promise<number> => {
  const subRefCutoff = new Date(now.getTime() - ATTEMPT_TTL_MS);
  const noSubRefCutoff = new Date(now.getTime() - ATTEMPT_TTL_NO_SUBREF_MS);

  const result = await prisma.premiumSubscriptionAttempt.updateMany({
    where: {
      status: 'pending',
      OR: [
        { providerSubRef: null, createdAt: { lt: noSubRefCutoff } },
        { providerSubRef: { not: null }, createdAt: { lt: subRefCutoff } },
      ],
    },
    data: { status: 'abandoned' },
  });

  if (result.count > 0) {
    log?.info(
      { kind: 'reconcile.attempts_reaped', count: result.count },
      'billing-reconcile: tentativas de assinatura abandonadas reapadas',
    );
  }

  return result.count;
};

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

/**
 * One reconciliation tick (canon §F8.12, spec §6).
 *
 * Detects drift between provider-authoritative subscription state and the
 * local DB snapshot, then either replays a missed renewal or expires the
 * membership and clears the Garage snapshot.
 *
 * Query: `status IN ('active','past_due','cancel_scheduled') AND
 * currentPeriodEnd < now` LIMIT 200, ordered ascending by `currentPeriodEnd`
 * so the oldest drift drains first.
 *
 * Per row:
 *   1. Call provider (Stripe `subscriptions.retrieve` or RC `getSubscriber`).
 *   2. Synthesise a `BillingEvent` of kind `subscription.renewed` or
 *      `subscription.expired` (or skip — in-flight dunning, lifetime RC).
 *   3. Open a fresh `prisma.$transaction`, acquire `SELECT FOR UPDATE` on the
 *      Garage row (canon §F8.5), then call `applyMembershipEvent(tx, evt)`.
 *      This preserves the atomicity contract (§F8.4) untouched.
 *
 * Reconcile-synthesised invoices use `reconcile:<subRef>:<periodEndKey>` as
 * `providerInvoiceRef`. This is stable across re-runs, so the
 * `@@unique([provider, providerInvoiceRef])` constraint + handleRenewed's
 * SAVEPOINT P2002 swallow (apply-membership-event.ts:233) make subsequent
 * ticks idempotent.
 *
 * Errors on a single row never crash the tick — the row's error is logged
 * and the loop continues to the next row.
 *
 * Feature-flag gated: `flagEnabled: false` short-circuits with zero DB reads
 * (canon §F8.11).
 */
export const runReconcileTick = async (deps: ReconcileTickDeps): Promise<void> => {
  const flagEnabled = deps.flagEnabled ?? true;
  if (!flagEnabled) return;

  const now = deps.now ?? new Date();
  const log = deps.log;

  await reapAbandonedAttempts(now, log);

  const staleRows = await prisma.premiumMembership.findMany({
    where: {
      status: { in: STALE_STATUSES },
      currentPeriodEnd: { lt: now },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: QUERY_LIMIT,
  });

  if (staleRows.length >= deps.alertDepth) {
    log?.warn(
      {
        kind: 'reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
      },
      'billing-reconcile: stale membership queue depth at or above alert threshold',
    );
  }

  for (const row of staleRows) {
    try {
      let evt: BillingEvent | null = null;

      if (row.provider === 'stripe') {
        evt = await reconcileStripeRow(row, deps.stripe, now);
      } else if (row.provider === 'apple_revenuecat') {
        evt = await reconcileRcRow(row, deps.rc, now);
      }

      if (!evt) {
        log?.info(
          { kind: 'reconcile.skipped', provider: row.provider, membershipId: row.id },
          'billing-reconcile: row in-flight or lifetime, skipping',
        );
        continue;
      }

      // Canon §F8.5: caller must hold `SELECT FOR UPDATE` on the Garage row
      // before calling applyMembershipEvent. We acquire it inside the same
      // $transaction so the lock is held end-to-end through the membership
      // upsert + invoice insert + snapshot update.
      const synthesised = evt;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${row.garageId} FOR UPDATE`;
        await applyMembershipEvent(tx, synthesised);
      });
      // Box Builder Fase 2: open the current-cycle box post-commit (best-effort).
      await openMonthlyBoxIfEligible(prisma, synthesised);

      const logKind =
        evt.kind === 'subscription.expired' ? 'reconcile.expired' : 'reconcile.recovered';
      log?.info(
        { kind: logKind, provider: row.provider, membershipId: row.id, eventKind: evt.kind },
        `billing-reconcile: ${logKind}`,
      );
    } catch (err) {
      log?.error(
        { err, membershipId: row.id, provider: row.provider },
        'billing-reconcile: failed to reconcile row, continuing to next',
      );
      // Non-fatal: continue processing remaining rows.
    }
  }
};

export const startReconcileWorker = (deps: {
  stripe: StripeClient;
  rc: RevenueCatClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('0 * * * *', () => {
    void runReconcileTick({
      stripe: deps.stripe,
      rc: deps.rc,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      flagEnabled: deps.env.GROWTH_PREMIUM_BILLING_ENABLED,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'billing-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
