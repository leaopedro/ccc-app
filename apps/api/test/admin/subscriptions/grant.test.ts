import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const env = loadEnv();

describe('POST /admin/subscriptions/grant', () => {
  let app: FastifyInstance;
  let adminAuth: string;
  let garageId: string;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    const { user: admin } = await createUser({
      email: 'admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    adminAuth = bearer(env, admin.id, 'admin');

    const { user: member } = await createUser({ email: 'member@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { userId: member.id },
      select: { id: true },
    });
    garageId = garage.id;
  });

  const payload = () => ({
    garageId,
    tier: 'gold' as const,
    cadence: 'monthly' as const,
    providerCustomerRef: 'cus_live_recovery',
    providerSubRef: 'sub_live_recovery',
    providerInvoiceRef: 'in_live_recovery',
    baseAmountCents: 24_990,
    devFeePercent: 10,
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    livemode: true,
    reason: 'invoice.paid caiu em unknown-plan-price, evento ja marcado processado',
  });

  it('creates the membership and its invoice', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect(res.statusCode).toBe(201);

    const membership = await prisma.premiumMembership.findFirst({
      where: { providerSubRef: 'sub_live_recovery' },
      select: { id: true, tier: true, cadence: true, status: true, garageId: true },
    });
    expect(membership).toMatchObject({
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      garageId,
    });

    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { providerInvoiceRef: 'in_live_recovery' },
      select: { devFeePercent: true, baseAmountCents: true, grossAmountCents: true },
    });
    // devFee comes from the operator's reading of the real Stripe invoice, not
    // from env. The invoice line is the source of truth forever.
    expect(invoice).toMatchObject({
      devFeePercent: 10,
      baseAmountCents: 24_990,
      grossAmountCents: 27_489,
    });
  });

  it('updates the garage snapshot so the member is premium immediately', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
      select: { premiumTier: true, premiumUntil: true },
    });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('records an audit row naming the actor and the reason', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@jdm.test' },
      select: { id: true },
    });
    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'premium.subscription.granted' },
      select: { actorId: true, entityType: true, entityId: true, metadata: true },
    });
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.entityType).toBe('premium_membership');
    expect(JSON.stringify(audit?.metadata)).toContain('unknown-plan-price');
  });

  // A manual grant looks like real money because it is — the operator
  // transcribed it from the real Stripe invoice. But it must still be
  // possible to tell, from the row itself, that no webhook ever produced it.
  it('is distinguishable from a genuine webhook-driven activation', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { providerInvoiceRef: 'in_live_recovery' },
      select: { providerTransactionRef: true },
    });
    // Stripe-driven activation (normalize-stripe.ts) never sets this field —
    // it exists only for Apple/RevenueCat's original_transaction_id. A
    // non-null value on a `stripe`-provider invoice is therefore unambiguous
    // proof the row came from this endpoint, not from invoice.paid.
    expect(invoice.providerTransactionRef).toBe('admin-grant');
  });

  // livemode has no source anywhere in applyMembershipEvent — the operator
  // states it explicitly because a wrong guess here means test-mode money
  // is counted as live revenue with no way for the cutover script to find
  // it (it keys on createdAt, and this row is created after cutover).
  it('records livemode: true when the operator says the invoice was live', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: { ...payload(), livemode: true },
    });
    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { providerInvoiceRef: 'in_live_recovery' },
      select: { livemode: true },
    });
    expect(invoice.livemode).toBe(true);
  });

  it('records livemode: false when the operator says the invoice was test-mode', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: { ...payload(), livemode: false },
    });
    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { providerInvoiceRef: 'in_live_recovery' },
      select: { livemode: true },
    });
    expect(invoice.livemode).toBe(false);
  });

  // The exact paste-under-pressure mistake this endpoint exists to
  // eliminate: an operator copies a providerSubRef that actually belongs to
  // a DIFFERENT member's membership. handleActivated keys purely on
  // (provider, providerSubRef) with no garageId check, so without a guard
  // this would silently advance the victim's period/pricing while the
  // target garage's snapshot still gets flipped to premium with no
  // membership row of its own.
  it('refuses a providerSubRef that belongs to a different garage', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect(first.statusCode).toBe(201);

    const { user: otherMember } = await createUser({ email: 'other@jdm.test', verified: true });
    const otherGarage = await prisma.garage.findUniqueOrThrow({
      where: { userId: otherMember.id },
      select: { id: true },
    });

    const hijack = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      // Same providerSubRef as the first grant, but a different garage —
      // exactly the paste mistake.
      payload: { ...payload(), garageId: otherGarage.id },
    });
    expect(hijack.statusCode).toBe(409);

    // The victim's membership must be untouched: still on the original
    // garage, still the original period.
    const victim = await prisma.premiumMembership.findUniqueOrThrow({
      where: {
        provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_live_recovery' },
      },
      select: { garageId: true, currentPeriodEnd: true },
    });
    expect(victim.garageId).toBe(garageId);
    expect(victim.currentPeriodEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    // The other garage must NOT have been granted a membership or flipped
    // to premium off the back of the refused request.
    const otherGarageCount = await prisma.premiumMembership.count({
      where: { garageId: otherGarage.id },
    });
    expect(otherGarageCount).toBe(0);
    const otherGarageRow = await prisma.garage.findUniqueOrThrow({
      where: { id: otherGarage.id },
      select: { premiumTier: true },
    });
    expect(otherGarageRow.premiumTier).toBeNull();
  });

  // Replaying the same recovery must not double-charge the books.
  it('is idempotent on the provider invoice ref', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect([200, 201, 409]).toContain(second.statusCode);

    const invoices = await prisma.premiumMembershipInvoice.count({
      where: { providerInvoiceRef: 'in_live_recovery' },
    });
    expect(invoices).toBe(1);
  });

  it('refuses a grant to a garage that already has a live membership', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect(first.statusCode).toBe(201);

    // Different provider ids, same garage: not a replay, a genuine second grant.
    const second = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: {
        ...payload(),
        providerCustomerRef: 'cus_live_recovery_2',
        providerSubRef: 'sub_live_recovery_2',
        providerInvoiceRef: 'in_live_recovery_2',
      },
    });
    expect(second.statusCode).toBe(409);

    const count = await prisma.premiumMembership.count({ where: { garageId } });
    expect(count).toBe(1);
  });

  it('rejects a non-admin caller', async () => {
    const { user } = await createUser({ email: 'nobody@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: payload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s an unknown garage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: { ...payload(), garageId: 'clzzzzzzzzzzzzzzzzzzzzzz' },
    });
    expect(res.statusCode).toBe(404);
  });
});
