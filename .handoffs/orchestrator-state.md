# Orchestrator state — F8 completion

**Date:** 2026-05-26  
**Phase:** F8 Premium Membership Billing — COMPLETE (19 chunks merged)  
**Main tip at F8 closeout:** (orchestrator fills with actual SHA after all 19 PRs merge)

---

## F8 dispatch summary

| Wave | Chunks                        | Status   |
| ---- | ----------------------------- | -------- |
| A    | F8.01 → F8.02 → F8.03         | COMPLETE |
| B    | F8.04 ‖ F8.05                 | COMPLETE |
| C    | F8.06 ‖ F8.07 ‖ F8.08         | COMPLETE |
| D    | F8.09 ‖ F8.10 ‖ F8.11         | COMPLETE |
| E    | F8.12                         | COMPLETE |
| F    | F8.13 ‖ F8.14 → F8.15 ‖ F8.16 | COMPLETE |
| G    | F8.17 ‖ F8.18                 | COMPLETE |
| H    | F8.19                         | COMPLETE |

All 19 chunks merged to `main`. Feature flag `GROWTH_PREMIUM_BILLING_ENABLED`
flipped to `true` in Railway production after F8.19 smoke evidence attached.

---

## Canon carried forward (F8 + Phase 2)

**Phase 2 §C1–§C14** carry forward unchanged.

**F8 canon §F8.1–§F8.16** — all load-bearing. Key entries:

- §F8.1: `devFeePercent` snapshotted at time-of-charge; never re-derived from env.
- §F8.2: `sourceRef = 'garage:<garageId>'` for XP `premium_activation` — one-shot-ever.
- §F8.3: `Garage.premiumUntil = max(existing, new)` — admin grants never clobbered.
- §F8.4: Activation tx atomicity — Membership + Invoice + Garage + XP in one tx.
- §F8.5: `SELECT garage FOR UPDATE` at tx start — closes webhook race.
- §F8.6: Single `awardXp` per activation tx — SAVEPOINT collision guard.
- §F8.7: Premium-grant tier selection — first `isPremiumGrantable = true` tier; skip + log if none.
- §F8.8: Partial unique on Ticket `(userId, eventId) WHERE status='valid' AND source='premium_grant'` (narrowed; see spec §2.6).
- §F8.9: Non-BR RC events — 200-OK ack, no DB writes.
- §F8.10: Refund honors period end — entitlement persists; invoice status flips only.
- §F8.11: Feature flag `GROWTH_PREMIUM_BILLING_ENABLED` — now default `true` post-smoke.
- §F8.12: Filtered test command shape (same as Phase 2 §10).
- §F8.13: Rebuild `@jdm/shared` after schema/export changes.
- §F8.14: UI dep + harness in same chunk.
- §F8.15: Webhook idempotency two-layer model.
- §F8.16: iOS bundle isolation — no Stripe references in iOS-conditional code.

---

## Phase F8.1 backlog (deferred from F8 v1)

Items deferred per spec §10 + brainstorm. None of these block the F8 launch.
Track as a future phase.

| Item                                                       | Spec ref     | Notes                                   |
| ---------------------------------------------------------- | ------------ | --------------------------------------- |
| Trial period (free 7/14 day)                               | §10 + §1     | Schema reserves `trialing` enum value.  |
| Dunning push notifications + receipt emails                | §10          | Brainstorm-out-of-scope for v1.         |
| Family / gift subscriptions                                | §10          | Schema open for future tiers.           |
| Promo codes / coupons                                      | §10          | Stripe Coupons API ready to wire.       |
| Cohort retention dashboard (`/finance/membership-cohorts`) | §10          | Needs separate UX brief.                |
| Animated "Welcome to Gold" splash                          | §10          | UI polish; low priority.                |
| Per-tier perk-gating (silver, bronze)                      | §10 §1       | Schema enum ready (`bronze`, `silver`). |
| Google Play Billing (Android RC path)                      | §11 risk     | Depends on Play Store review feedback.  |
| Multi-call `awardXp` SAVEPOINT fix                         | §4.7 + §F8.6 | Awarder-level fix; separate chunk.      |

---

## Active worktrees at F8 closeout

All F8 chunk worktrees are safe to remove after their respective PRs merge.
Remove with:

```bash
git worktree remove .claude/worktrees/agent-f8-billing-<NN>
```

---

## Next phase

No next phase planned at F8 closeout. The Phase F8.1 backlog items above are the
natural candidates. Await product/CEO direction before dispatching Phase F8.1.

Load-bearing invariants from both Phase 2 (§C1–§C14) and F8 (§F8.1–§F8.16) apply
to all future work that touches the billing, XP, premium, or ticket surfaces.
