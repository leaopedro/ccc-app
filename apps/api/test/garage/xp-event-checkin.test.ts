import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { checkInTicket } from '../../src/services/tickets/check-in.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEventTicket = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const event = await prisma.event.create({
    data: {
      slug: `xp-evt-${Math.random().toString(36).slice(2, 8)}`,
      title: 'XP Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'GA',
      priceCents: 0,
      currency: 'BRL',
      quantityTotal: 10,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      status: 'valid',
      source: 'purchase',
    },
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, event, tier, ticket, garage, code: signTicketCode(ticket.id, env) };
};

describe('check-in fires awardXp for event_checkin (+10)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Killswitch on by default for these tests.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: true },
      update: { gamificationEnabled: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful check-in writes one XpEvent (+10) + Garage.xp += 10 in same tx', async () => {
    const { event, garage, code } = await seedEventTicket('xp-checkin-ok@jdm.test');

    // Spy on the awarder so we can physically prove `checkInTicket`
    // is the call path — not just that an XpEvent row materialised.
    const spy = vi.spyOn(xpAwarder, 'awardXp');

    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');

    // awardXp invoked exactly once with the canon §4 positional shape.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(), // tx client
      garage.id,
      'event_checkin',
      expect.objectContaining({ sourceRef: `event:${event.id}` }),
    );

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: garage.id, reason: 'event_checkin' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: 10,
      sourceRef: `event:${event.id}`,
    });

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(10);
  });

  it('replay (already_used) on the same event is idempotent — only one +10 row + xp stays 10', async () => {
    const { event, garage, code } = await seedEventTicket('xp-checkin-replay@jdm.test');

    const first = await checkInTicket({ code, eventId: event.id }, env);
    expect(first.kind).toBe('admitted');

    // Second call re-uses the same code. The flip's `updateMany` matches
    // zero rows (already `used`) so the route returns already_used.
    // The awarder branch sits inside the `if (garage)` arm after the
    // flip, and the flip's pre-conditions (status === 'valid') gate the
    // whole arm — so the awarder is not called again on replay. Even if
    // a regression caused a second call, §C1's DB unique on
    // (garageId, reason, sourceRef) would surface P2002 and the awarder
    // would return `{ awarded: false, reason: 'duplicate' }` silently.
    const second = await checkInTicket({ code, eventId: event.id }, env);
    expect(second.kind).toBe('already_used');

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: garage.id, reason: 'event_checkin' },
    });
    expect(rows).toHaveLength(1);

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(10);
  });

  it('killswitch off: check-in still succeeds, but no XpEvent row is written', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-off@jdm.test');

    // Spy proves the hook is still wired even when the killswitch is off
    // — the awarder is called from `checkInTicket`, then internally
    // returns `{ awarded: false, reason: 'gamification_disabled' }`.
    // Without this assertion the test would also pass if the hook were
    // simply absent, which is what we want to rule out.
    const spy = vi.spyOn(xpAwarder, 'awardXp');

    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      garage.id,
      'event_checkin',
      expect.objectContaining({ sourceRef: `event:${event.id}` }),
    );

    // Ticket actually flipped.
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('used');

    // No XP row, garage.xp untouched.
    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);
  });

  it('awardXp non-P2002 throw aborts the parent check-in tx (ticket NOT flipped, no XpEvent row)', async () => {
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-throw@jdm.test');

    // Force awardXp to throw a non-P2002 error. Per canon §5 the
    // call site does NOT wrap awardXp in try/catch, so the throw
    // propagates and the `prisma.$transaction` callback in
    // `check-in.ts` aborts — ticket stays `valid`, no XpEvent row,
    // garage.xp untouched.
    //
    // This test FAILS if check-in.ts ever wraps the awardXp call
    // in a try/catch (which would let the parent tx commit and
    // flip the ticket to `used`).
    vi.spyOn(xpAwarder, 'awardXp').mockRejectedValue(new Error('boom — simulated awarder failure'));

    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toThrow(
      /boom — simulated awarder failure/,
    );

    // Parent rolled back: ticket still valid (not used).
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('valid');
    expect(t.usedAt).toBeNull();

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);

    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);
  });

  it('parent tx rollback proves the awardXp hook lives inside the check-in tx', async () => {
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-rollback@jdm.test');

    // Drive the public `checkInTicket` API end-to-end. We force the
    // parent tx to abort AFTER awardXp has already written its row,
    // by spying on `awardXp` to call through and then throwing
    // synchronously from a post-hook step. We achieve this by
    // wrapping `awardXp` to delegate to the real impl, then having
    // it throw on the SAME call — i.e., it writes the XpEvent row
    // (the row materialises inside the tx) and then re-raises.
    //
    // Per canon §5 the throw propagates out of `check-in.ts` and
    // the parent `prisma.$transaction` rolls back. Because awardXp's
    // write is inside that same tx, the XpEvent row is gone.
    //
    // This test FAILS if the hook is moved outside the check-in tx
    // (e.g., to after `$transaction` commits), because then the
    // XpEvent row would survive after the parent rollback.
    const realAwardXp = xpAwarder.awardXp;
    vi.spyOn(xpAwarder, 'awardXp').mockImplementation(async (tx, garageId, reason, opts) => {
      // Call through — writes XpEvent + bumps Garage.xp inside the tx.
      await realAwardXp(tx, garageId, reason, opts);
      // Now force the parent tx to abort.
      throw new Error('forced rollback after real awardXp write');
    });

    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toThrow(
      /forced rollback after real awardXp write/,
    );

    // Ticket flip rolled back — parent tx aborted.
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('valid');
    expect(t.usedAt).toBeNull();

    // XpEvent row rolled back — proves awardXp ran inside the parent tx,
    // not in a separate connection or after commit.
    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);

    // Garage counter untouched.
    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);
  });
});
