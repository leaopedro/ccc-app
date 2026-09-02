# P2002 on renew/resume — report

- **Status:** done, PR open
- **Branch:** `fix/membership-p2002-renew-resume`
- **Commit:** `d6c847f`
- **PR:** https://github.com/leaopedro/ccc-app/pull/49
- **Tests:** `apps/api/test/billing/renew-resume-live-membership-conflict.test.ts`, 16 new integration tests against a real Postgres (2 reproductions, 7 renew/resume behaviour, 6 audit, 1 route-level). Full runs: `test/billing` 390 pass, `test/stripe` 38 pass, `test/admin` 662 pass. `@ccc/api` + `@ccc/shared` typecheck clean.

---

Closes the two doors PR #44 explicitly deferred, and three more the audit found open.

## The failure, reproduced

`handleRenewed` (forward branch) and `handleResumed` both write `status: 'active'`. When the row they touch is currently OUTSIDE `premium_membership_live_per_garage` (`expired`/`paused`) and a different row for the same garage is inside it, that write moves a second row into the index. Postgres refuses, Prisma raises P2002, it escapes the transaction, the webhook 5xx's, and the provider retries the identical violation forever.

Failing integration tests written first, against a real Postgres. Before the fix:

```
PrismaClientKnownRequestError:
Invalid `tx.premiumMembership.update()` invocation in
  apps/api/src/services/billing/apply-membership-event.ts:549:34
  547 const isForward = currentPeriodEnd > existing.currentPeriodEnd;
  548 const membership = isForward
→ 549   ? await tx.premiumMembership.update(
Unique constraint failed on the fields: (`garageId`)
 ❯ handleRenewed src/services/billing/apply-membership-event.ts:549:7

PrismaClientKnownRequestError:
Invalid `tx.premiumMembership.update()` invocation in
  apps/api/src/services/billing/apply-membership-event.ts:805:49
→ 805 const membership = await tx.premiumMembership.update(
Unique constraint failed on the fields: (`garageId`)
 ❯ handleResumed src/services/billing/apply-membership-event.ts:805:22
```

And at the route level, pinned end to end on RevenueCat, whose handler captures-and-rethrows:

```
POST /webhooks/revenuecat: RENEWAL onto a non-live row beside a live one
  → expected 500 to be 200
```

Both sequences are reachable, and both are downstream of decisions PR #44 made on purpose:

- **renewed** — the activation guard refuses an Apple re-purchase and leaves the Apple row `expired`, but refusing it does not cancel it at Apple. Apple keeps billing. The next RENEWAL arrives keyed on `original_transaction_id` (`normalize-revenuecat`), lands on that same expired row, and the route's unknown-subscription branch does not catch it because the row exists.
- **resumed** — `paused` is inside `LIVE_MEMBERSHIP_STATUSES` but outside the index, and PR #44 scoped its guard to the index precisely so a member with a paused Stripe subscription can still buy on Apple. Right call, and exactly what puts a paused row next to a live one. Clearing `pause_collection` in the Billing Portal then asks us to make the paused row active.

## Behaviour, and why the two differ

`handleActivated` chose "incumbent wins, refuse everything, alert". Renewal does not get that answer.

**Renewal refuses exactly what Postgres refuses, and nothing else.** The activation guard discards the whole event because there is nothing it can safely keep — the paid invoice belongs to a subscription with no membership row, and filing it under the incumbent would corrupt that member's invoice history. A renewal differs on the one point that matters: the row already exists, so the invoice has a correct, unambiguous home. Throwing away a payment we are perfectly able to record is a worse and less recoverable wrong than not flipping a status. So:

- invoice — written, under its own subscription's membership
- period + pricing — written, so the row does not disagree with the invoice just filed under it
- `status` — withheld; the row keeps `expired`/`paused`
- `Garage.premiumUntil` — withheld

The snapshot is the judgement call, and the opposite is arguable: the member did pay for the period. It is skipped anyway. `premiumUntil` is entitlement, entitlement follows the row holding the index slot, and writing a snapshot from a row we are simultaneously declining to activate is internally contradictory. Worse, it would paper over the conflict — the member keeps working premium while two subscriptions bill, which is the state that needs a human. The incumbent is live and keeps its own snapshot current, so nothing is lost today.

Outcome stays `applied`, not `refused_live_conflict`: the invoice and period did land. `openMonthlyBoxIfEligible` is the only post-commit hook that reaches a renewal and it re-reads the row's status, so the un-flipped row correctly opens no box.

**Resume refuses the whole event**, same as activation and for the reason renewal does not: a resume carries no money and no invoice. Deciding which row is live is the only thing this handler does, and that is exactly the thing it may not do. Alert level is `error` despite no charge in the event — the provider resumed collection regardless of our DB, so the next cycle is a real double charge.

Both reuse the existing `premium-live-membership-conflict` tag, the incumbent-describing `extra` keys, and `LIVE_PER_GARAGE_INDEX_STATUSES`. A new `extra.eventKind` discriminates the variants so one alert rule and one runbook section still cover all of them.

## Audit of the remaining status writers — PR #44's report was wrong on three

Verified by probe against a real Postgres, not by reading:

| Handler                           | Writes                            | Verdict                                                                                                                                                                                                                                          |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handleCancelled`                 | `cancel_scheduled` — **in** index | **Exposed.** Reproduced P2002. Most reachable of the three: pause in the Billing Portal, buy on Apple, cancel the paused subscription. Discriminator 1 in `normalize-stripe` fires on the `cancel_at_period_end` flip regardless of pause state. |
| `handlePastDue`                   | `past_due` — **in** index         | **Exposed.** Reproduced P2002. No live path constructible: a paused or cancelled subscription is never charged, so it never produces `payment_failed`, and nothing in the codebase ever writes `trialing`. Guarded anyway.                       |
| `handleUncancelled`               | `active` — **in** index           | **Exposed.** Reproduced P2002. Hardest to reach: the ordinary un-cancel acts on a `cancel_scheduled` row, already in the index. Needs a direct Stripe-dashboard sequence; our admin refuses it. Guarded anyway.                                  |
| `handleTierChanged`               | no status                         | Safe, confirmed.                                                                                                                                                                                                                                 |
| `handleExpired`                   | `expired` — outside               | Safe, confirmed. Only ever leaves the index.                                                                                                                                                                                                     |
| `handlePaused`                    | `paused` — outside                | Safe, confirmed. Only ever leaves the index.                                                                                                                                                                                                     |
| `reconcileMembershipAddonsAmount` | no status                         | Safe, confirmed.                                                                                                                                                                                                                                 |

The three exposed ones share one guard: they carry no money, create no entitlement, and their only job is the status the index refuses, so there is no partial write worth salvaging. Leave the row, complete the event, alert with `attemptedStatus` so the operator knows what the row is now stale about.

This goes beyond the stated scope. It is included because the audit was asked for and it disproved the prior claim — leaving three verified infinite-5xx loops in the file while closing two others made no sense.

## Also

- Scopes **both** attempt-row settles in `handleActivated` by `(garageId, providerSubRef)` instead of `providerSubRef` alone — the refusal path and the success path. `PremiumSubscriptionAttempt` carries no unique index on `providerSubRef`, so only provider convention stopped the filter matching another garage's row. Minor left open by PR #44's review.
- A refused renewal no longer writes `cancelAtPeriodEnd: false`. `status` and `cancelAtPeriodEnd` describe one decision, and writing half of it left an `expired` row claiming it was not winding down while `cancelledAt` still held a date. No reader was affected; the admin detail view read wrong. Both halves now ride the same conflict check, pinned in tests on the refusal and the happy path.
- Runbook 5 in `docs/observability.md` now splits `premium-live-membership-conflict` by `extra.eventKind`, which takes six values from four call sites, grouped into four bullets by remediation. Previously the alert fired from one place and the runbook had one paragraph.
- The same runbook section no longer says "nothing self-heals" flatly, and no longer tells the operator to expire the incumbent "so the resume can be replayed". Every one of these events is marked `processedAt` and is never redelivered. What un-strands the row is the next paid invoice on the losing subscription, which lands in `handleRenewed` and applies in full once the garage has a single subscription again. The human is needed to stop the double billing, not to un-strand the member.

## Not done

- The migration is untouched and `LIVE_MEMBERSHIP_STATUSES` still has its 5 values.
- `packages/db/prisma/schema.prisma` deliberately untouched; the `PremiumSubscriptionAttemptStatus` doc comment is being fixed on another branch.
- Whether `trialing`/`paused` _should_ occupy the index is still the open product question PR #44 named. Answering it means a migration.

## Verification

- `test/billing` 43 files / 390 tests, `test/stripe` 3 files / 38 tests, `test/admin` 64 files / 662 tests — all pass.
- `@ccc/api` and `@ccc/shared` typecheck clean. Lint warnings unchanged from `main` (68 pre-existing, 0 errors).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
