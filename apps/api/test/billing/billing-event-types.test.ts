import { describe, it, expect } from 'vitest';

import {
  normalizeStripeEvent,
  normalizeRevenueCatEvent,
} from '../../src/services/billing/index.js';
import type { BillingEvent, BillingEventKind } from '../../src/services/billing/types.js';

// ---------------------------------------------------------------------------
// Type-narrowing helpers (compile-time assertions via TypeScript exhaustive
// switch). If the union arms drift from spec §3.2, these fail at typecheck.
// ---------------------------------------------------------------------------

/**
 * Returns the `kind` string from a `BillingEvent` via an exhaustive switch.
 * Adding a new `kind` to `BillingEvent` without updating this switch will
 * cause a TypeScript compile error ('never' assignment) — that's intentional.
 */
function extractKind(event: BillingEvent): BillingEventKind {
  switch (event.kind) {
    case 'subscription.activated':
      return event.kind;
    case 'subscription.renewed':
      return event.kind;
    case 'subscription.cancelled':
      return event.kind;
    case 'subscription.uncancelled':
      return event.kind;
    case 'subscription.expired':
      return event.kind;
    case 'subscription.past_due':
      return event.kind;
    case 'subscription.tier_changed':
      return event.kind;
    default: {
      // TypeScript narrows `event` to `never` here if all arms are covered.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime narrowing — each discriminant narrows exclusive fields
// ---------------------------------------------------------------------------

describe('BillingEvent type narrowing', () => {
  it('subscription.activated carries pricing + invoice + garageId', () => {
    const evt: BillingEvent = {
      kind: 'subscription.activated',
      provider: 'stripe',
      providerCustomerRef: 'cus_test',
      providerSubRef: 'sub_test',
      garageId: 'garage-001',
      tier: 'gold',
      cadence: 'monthly',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      pricing: {
        baseAmountCents: 1900,
        devFeePercent: 10,
        devFeeAmountCents: 190,
        grossAmountCents: 2090,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: 'in_test',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
        paidAt: new Date('2026-01-01'),
      },
      lines: [],
      addons: [],
      addonsAmountCents: 0,
    };
    expect(extractKind(evt)).toBe('subscription.activated');
    // Type narrowing — these fields only exist on this arm.
    if (evt.kind === 'subscription.activated') {
      expect(evt.garageId).toBe('garage-001');
      expect(evt.pricing.devFeePercent).toBe(10);
      expect(evt.invoice.providerInvoiceRef).toBe('in_test');
    }
  });

  it('subscription.renewed carries pricing + invoice but NOT garageId', () => {
    const evt: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      currentPeriodStart: new Date('2026-02-01'),
      currentPeriodEnd: new Date('2026-03-01'),
      pricing: {
        baseAmountCents: 1900,
        devFeePercent: 10,
        devFeeAmountCents: 190,
        grossAmountCents: 2090,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: 'in_test2',
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-03-01'),
        paidAt: new Date('2026-02-01'),
      },
      lines: [],
    };
    expect(extractKind(evt)).toBe('subscription.renewed');
    // @ts-expect-error — garageId does NOT exist on 'renewed'; TS must error here.
    void evt.garageId;
  });

  it('subscription.cancelled carries cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.cancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      cancelledAt: new Date('2026-01-15'),
    };
    expect(extractKind(evt)).toBe('subscription.cancelled');
    if (evt.kind === 'subscription.cancelled') {
      expect(evt.cancelledAt).toBeInstanceOf(Date);
    }
  });

  it('subscription.uncancelled has no cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.uncancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test',
    };
    expect(extractKind(evt)).toBe('subscription.uncancelled');
    // @ts-expect-error — cancelledAt does NOT exist on 'uncancelled'.
    void evt.cancelledAt;
  });

  it('subscription.expired carries cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      cancelledAt: new Date('2026-02-01'),
    };
    expect(extractKind(evt)).toBe('subscription.expired');
    if (evt.kind === 'subscription.expired') {
      expect(evt.cancelledAt).toBeInstanceOf(Date);
    }
  });

  it('subscription.past_due has no pricing or cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: 'sub_test',
    };
    expect(extractKind(evt)).toBe('subscription.past_due');
    // @ts-expect-error — pricing does NOT exist on 'past_due'.
    void evt.pricing;
  });

  it('subscription.tier_changed carries tier + cadence + pricing', () => {
    const evt: BillingEvent = {
      kind: 'subscription.tier_changed',
      provider: 'apple_revenuecat',
      providerSubRef: 'sub_rc_test',
      priceRef: 'gold_annual_rc',
      tier: 'gold',
      cadence: 'annual',
      pricing: {
        baseAmountCents: 18000,
        devFeePercent: 0, // Apple/RC path: devFeePercent = 0 (canon §F8.1)
        devFeeAmountCents: 0,
        grossAmountCents: 18000,
        currency: 'BRL',
      },
    };
    expect(extractKind(evt)).toBe('subscription.tier_changed');
    if (evt.kind === 'subscription.tier_changed') {
      expect(evt.pricing.devFeePercent).toBe(0);
      expect(evt.cadence).toBe('annual');
    }
  });

  it('BillingEvent union covers exactly 7 kinds', () => {
    // Enumerate all valid kinds. If a kind is added to the spec later, this
    // list must be updated here — the exhaustive switch above provides the
    // compile-time safety net.
    const allKinds: BillingEventKind[] = [
      'subscription.activated',
      'subscription.renewed',
      'subscription.cancelled',
      'subscription.uncancelled',
      'subscription.expired',
      'subscription.past_due',
      'subscription.tier_changed',
    ];
    expect(allKinds).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Stub-throws verification
// ---------------------------------------------------------------------------

describe('normalizeStripeEvent (implemented in F8.04)', () => {
  it('returns null for unknown event types', () => {
    // F8.04 replaced the stub with a real implementation. Full event-mapping
    // coverage lives in test/billing/normalize-stripe.test.ts.
    const event = { id: 'evt_test', type: 'unknown.event', data: { object: {} } };
    expect(normalizeStripeEvent(event)).toBeNull();
  });
});

describe('normalizeRevenueCatEvent (implemented in F8.05)', () => {
  it('returns null for malformed payloads (missing event.type)', () => {
    // F8.05 replaced the stub with a real implementation. Full event-mapping
    // coverage lives in test/billing/revenuecat-webhook.test.ts.
    expect(normalizeRevenueCatEvent({})).toBeNull();
  });
});
