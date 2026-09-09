import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEligibility as checkCarEligibility } from '../../src/services/garage/eligibility/cars.js';
import { checkEligibility as checkEventEligibility } from '../../src/services/garage/eligibility/events.js';
import { checkEligibility as checkFeedEligibility } from '../../src/services/garage/eligibility/feed.js';
import {
  checkEligibility as checkSignupEligibility,
  FOUNDER_CUTOFF,
} from '../../src/services/garage/eligibility/signup.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

// Minimal helpers — these specs don't go through HTTP, they exercise the
// pure eligibility query layer with hand-rolled fixtures. The badge codes
// are returned as plain strings; tests assert on the array, not the side
// effect.

describe('eligibility/cars.checkEligibility', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('yields CAR-001 on first car', async () => {
    const { user } = await createUser({ email: 'cars1@jdm.test', verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2000, nickname: 'civic-cars1' },
    });
    const codes = await prisma.$transaction((tx) => checkCarEligibility(tx, user.id));
    expect(codes).toContain('CAR-001');
    expect(codes).not.toContain('CAR-003');
  });

  it('yields CAR-001 + CAR-003 once the user has 5+ cars', async () => {
    const { user } = await createUser({ email: 'cars5@jdm.test', verified: true });
    for (let i = 0; i < 5; i++) {
      await prisma.car.create({
        data: {
          userId: user.id,
          make: 'Honda',
          model: 'Civic',
          year: 2000 + i,
          nickname: `civic-cars5-${i}`,
        },
      });
    }
    const codes = await prisma.$transaction((tx) => checkCarEligibility(tx, user.id));
    expect(codes).toContain('CAR-001');
    expect(codes).toContain('CAR-003');
  });

  it('yields CAR-002 when the free spot cap is fully consumed', async () => {
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', defaultFreeGarageSpots: 2 },
      update: { defaultFreeGarageSpots: 2 },
    });
    const { user } = await createUser({ email: 'cars-cap@jdm.test', verified: true });
    const c1 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998, nickname: 'civic-cap-1' },
    });
    const c2 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'civic-cap-2' },
    });
    await prisma.garageSpot.create({
      data: { userId: user.id, source: 'default_free', carId: c1.id },
    });
    await prisma.garageSpot.create({
      data: { userId: user.id, source: 'default_free', carId: c2.id },
    });

    const codes = await prisma.$transaction((tx) => checkCarEligibility(tx, user.id));
    expect(codes).toContain('CAR-002');
  });

  it('does NOT yield CAR-002 when the cap is null (unlimited)', async () => {
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', defaultFreeGarageSpots: null },
      update: { defaultFreeGarageSpots: null },
    });
    const { user } = await createUser({ email: 'cars-unlim@jdm.test', verified: true });
    const c1 = await prisma.car.create({
      data: {
        userId: user.id,
        make: 'Honda',
        model: 'Civic',
        year: 1998,
        nickname: 'civic-unlim-1',
      },
    });
    await prisma.garageSpot.create({
      data: { userId: user.id, source: 'default_free', carId: c1.id },
    });
    const codes = await prisma.$transaction((tx) => checkCarEligibility(tx, user.id));
    expect(codes).not.toContain('CAR-002');
  });
});

describe('eligibility/feed.checkEligibility', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('yields COM-001 on first post', async () => {
    const { user } = await createUser({ email: 'feed1@jdm.test', verified: true });
    const event = await prisma.event.create({
      data: {
        slug: 'feed-event-1',
        title: 'Feed Event',
        description: 'desc',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        endsAt: new Date('2026-05-10T20:00:00Z'),
        type: 'meeting',
        capacity: 100,
        status: 'published',
      },
    });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: user.id, body: 'hello', status: 'visible' },
    });
    const codes = await prisma.$transaction((tx) => checkFeedEligibility(tx, user.id, post.id));
    expect(codes).toEqual(['COM-001']);
  });

  it('returns empty list when the user has zero posts', async () => {
    const { user } = await createUser({ email: 'feed0@jdm.test', verified: true });
    const codes = await prisma.$transaction((tx) =>
      checkFeedEligibility(tx, user.id, 'phantom-post'),
    );
    expect(codes).toEqual([]);
  });
});

describe('eligibility/signup.checkEligibility', () => {
  it('yields CCC-003 when User.createdAt is strictly before the cutoff', () => {
    const before = new Date(FOUNDER_CUTOFF.getTime() - 86_400_000);
    const codes = checkSignupEligibility(
      // tx isn't read by this helper.
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u1',
      before,
    );
    expect(codes).toEqual(['CCC-003']);
  });

  it('does NOT yield CCC-003 when User.createdAt is exactly the cutoff', () => {
    const codes = checkSignupEligibility(
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u2',
      FOUNDER_CUTOFF,
    );
    expect(codes).toEqual([]);
  });

  it('does NOT yield CCC-003 when User.createdAt is after the cutoff', () => {
    const after = new Date(FOUNDER_CUTOFF.getTime() + 86_400_000);
    const codes = checkSignupEligibility(
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u3',
      after,
    );
    expect(codes).toEqual([]);
  });
});

describe('eligibility/events.checkEligibility — EVT-002 streak + EVT-003 event count', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const makeEvent = async (
    slug: string,
    startsAt: Date,
    opts: { city?: string; type?: 'meeting' | 'drift' | 'other' } = {},
  ) =>
    prisma.event.create({
      data: {
        slug,
        title: slug,
        description: 'desc',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3600_000),
        type: opts.type ?? 'meeting',
        status: 'published',
        capacity: 100,
        city: opts.city ?? null,
      },
    });

  const makeTier = (eventId: string, name: string) =>
    prisma.ticketTier.create({
      data: { eventId, name, priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });

  const makeUsedTicket = async (userId: string, eventId: string, tierId: string, usedAt: Date) =>
    prisma.ticket.create({
      data: { userId, eventId, tierId, status: 'used', usedAt },
    });

  it('happy path — 3 consecutive check-ins on 3 most recent past events yields EVT-002', async () => {
    const { user } = await createUser({ email: 'streak@jdm.test', verified: true });

    const e1 = await makeEvent('streak-e1', new Date('2026-04-01T10:00:00Z'));
    const e2 = await makeEvent('streak-e2', new Date('2026-04-15T10:00:00Z'));
    const e3 = await makeEvent('streak-e3', new Date('2026-05-01T10:00:00Z'));
    const t1 = await makeTier(e1.id, 'GA');
    const t2 = await makeTier(e2.id, 'GA');
    const t3 = await makeTier(e3.id, 'GA');

    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-01T11:00:00Z'));
    await makeUsedTicket(user.id, e2.id, t2.id, new Date('2026-04-15T11:00:00Z'));
    const trigger = await makeUsedTicket(user.id, e3.id, t3.id, new Date('2026-05-01T11:00:00Z'));

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('EVT-002');
    expect(codes).toContain('EVT-001');
  });

  it('non-streak — user skipped the middle event (ticket valid but never checked in)', async () => {
    const { user } = await createUser({ email: 'noskip@jdm.test', verified: true });

    const e1 = await makeEvent('miss-e1', new Date('2026-04-01T10:00:00Z'));
    const e2 = await makeEvent('miss-e2', new Date('2026-04-15T10:00:00Z'));
    const e3 = await makeEvent('miss-e3', new Date('2026-05-01T10:00:00Z'));
    const t1 = await makeTier(e1.id, 'GA');
    const t2 = await makeTier(e2.id, 'GA');
    const t3 = await makeTier(e3.id, 'GA');

    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-01T11:00:00Z'));
    // e2 ticket exists but is never `used` — the user held a ticket and
    // skipped the event.
    await prisma.ticket.create({
      data: { userId: user.id, eventId: e2.id, tierId: t2.id, status: 'valid' },
    });
    const trigger = await makeUsedTicket(user.id, e3.id, t3.id, new Date('2026-05-01T11:00:00Z'));

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).not.toContain('EVT-002');
  });

  it('CCC-001 fires on Curitiba event', async () => {
    const { user } = await createUser({ email: 'ctba@jdm.test', verified: true });
    const e = await makeEvent('curitiba-meet', new Date('2026-05-10T10:00:00Z'), {
      city: 'Curitiba',
    });
    const t = await makeTier(e.id, 'GA');
    const trigger = await makeUsedTicket(user.id, e.id, t.id, new Date('2026-05-10T11:00:00Z'));
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('CCC-001');
  });

  it('CCC-002 fires on drift-type event', async () => {
    const { user } = await createUser({ email: 'drift@jdm.test', verified: true });
    const e = await makeEvent('drift-meet', new Date('2026-05-10T10:00:00Z'), {
      type: 'drift',
    });
    const t = await makeTier(e.id, 'GA');
    const trigger = await makeUsedTicket(user.id, e.id, t.id, new Date('2026-05-10T11:00:00Z'));
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('CCC-002');
  });

  it('guest tickets — two check-ins on the same event still yields EVT-002', async () => {
    const { user } = await createUser({ email: 'guest-streak@jdm.test', verified: true });

    const e1 = await makeEvent('guest-e1', new Date('2026-04-01T10:00:00Z'));
    const e2 = await makeEvent('guest-e2', new Date('2026-04-15T10:00:00Z'));
    const e3 = await makeEvent('guest-e3', new Date('2026-05-01T10:00:00Z'));
    const t1 = await makeTier(e1.id, 'GA');
    const t2 = await makeTier(e2.id, 'GA');
    const t3 = await makeTier(e3.id, 'GA');

    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-01T11:00:00Z'));
    await makeUsedTicket(user.id, e2.id, t2.id, new Date('2026-04-15T11:00:00Z'));
    // The member brought a guest to e3 and checked BOTH tickets in. Three
    // events attended, four used tickets — the badge is still owed.
    await makeUsedTicket(user.id, e3.id, t3.id, new Date('2026-05-01T11:00:00Z'));
    const trigger = await makeUsedTicket(user.id, e3.id, t3.id, new Date('2026-05-01T11:00:30Z'));

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('EVT-002');
  });

  it('no streak — five used tickets spanning only two events', async () => {
    const { user } = await createUser({ email: 'twoevents@jdm.test', verified: true });

    const e1 = await makeEvent('two-e1', new Date('2026-04-01T10:00:00Z'));
    const e2 = await makeEvent('two-e2', new Date('2026-04-15T10:00:00Z'));
    const t1 = await makeTier(e1.id, 'GA');
    const t2 = await makeTier(e2.id, 'GA');

    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-01T11:00:00Z'));
    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-01T11:05:00Z'));
    await makeUsedTicket(user.id, e2.id, t2.id, new Date('2026-04-15T11:00:00Z'));
    await makeUsedTicket(user.id, e2.id, t2.id, new Date('2026-04-15T11:05:00Z'));
    const trigger = await makeUsedTicket(user.id, e2.id, t2.id, new Date('2026-04-15T11:10:00Z'));

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('EVT-001');
    expect(codes).not.toContain('EVT-002');
  });

  it('startsAt tie — both tied events attended yields a stable EVT-002', async () => {
    const { user } = await createUser({ email: 'tie-ok@jdm.test', verified: true });

    const tie = new Date('2026-05-01T10:00:00Z');
    const e0 = await makeEvent('tie-ok-e0', new Date('2026-04-01T10:00:00Z'));
    const ea = await makeEvent('tie-ok-ea', tie);
    const eb = await makeEvent('tie-ok-eb', tie);
    const t0 = await makeTier(e0.id, 'GA');
    const ta = await makeTier(ea.id, 'GA');
    const tb = await makeTier(eb.id, 'GA');

    await makeUsedTicket(user.id, e0.id, t0.id, new Date('2026-04-01T11:00:00Z'));
    await makeUsedTicket(user.id, ea.id, ta.id, new Date('2026-05-01T11:00:00Z'));
    // Same check-in instant as the sibling tied event — neither order is total
    // on its own.
    const trigger = await makeUsedTicket(user.id, eb.id, tb.id, new Date('2026-05-01T11:00:00Z'));

    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push(await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id)));
    }
    expect(runs[0]).toContain('EVT-002');
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('EVT-003 — ten used tickets spanning only five events does NOT yield it', async () => {
    const { user } = await createUser({ email: 'legend-dup@jdm.test', verified: true });

    // Five attended events, two used tickets each (member + guest every time).
    // Ten used tickets, five events attended — half the bar.
    let triggerId = '';
    for (let i = 0; i < 5; i++) {
      const e = await makeEvent(`legend-dup-e${i}`, new Date(`2026-0${i + 1}-05T10:00:00Z`));
      const t = await makeTier(e.id, 'GA');
      await makeUsedTicket(user.id, e.id, t.id, new Date(`2026-0${i + 1}-05T11:00:00Z`));
      const guest = await makeUsedTicket(
        user.id,
        e.id,
        t.id,
        new Date(`2026-0${i + 1}-05T11:05:00Z`),
      );
      triggerId = guest.id;
    }

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, triggerId));
    expect(codes).toContain('EVT-001');
    expect(codes).not.toContain('EVT-003');
  });

  it('EVT-003 — exactly ten distinct attended events yields it', async () => {
    const { user } = await createUser({ email: 'legend-ten@jdm.test', verified: true });

    let triggerId = '';
    for (let i = 0; i < 10; i++) {
      const day = String(i + 1).padStart(2, '0');
      const e = await makeEvent(`legend-ten-e${i}`, new Date(`2026-04-${day}T10:00:00Z`));
      const t = await makeTier(e.id, 'GA');
      const last = await makeUsedTicket(user.id, e.id, t.id, new Date(`2026-04-${day}T11:00:00Z`));
      triggerId = last.id;
    }

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, triggerId));
    expect(codes).toContain('EVT-003');
  });

  it('EVT-003 — nine events plus one guest ticket is still nine attended events', async () => {
    const { user } = await createUser({ email: 'legend-guest@jdm.test', verified: true });

    // Nine events, one used ticket each, PLUS a guest ticket at the last one.
    // Ten used tickets, nine attended events — one short.
    let lastEventId = '';
    let lastTierId = '';
    for (let i = 0; i < 9; i++) {
      const day = String(i + 1).padStart(2, '0');
      const e = await makeEvent(`legend-guest-e${i}`, new Date(`2026-04-${day}T10:00:00Z`));
      const t = await makeTier(e.id, 'GA');
      await makeUsedTicket(user.id, e.id, t.id, new Date(`2026-04-${day}T11:00:00Z`));
      lastEventId = e.id;
      lastTierId = t.id;
    }
    // The guest the member brought to the ninth event.
    const guest = await makeUsedTicket(
      user.id,
      lastEventId,
      lastTierId,
      new Date('2026-04-09T11:05:00Z'),
    );
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, guest.id));
    expect(codes).not.toContain('EVT-003');
  });

  it('EVT-003 — draft and not-yet-started events do not count as attended', async () => {
    const { user } = await createUser({ email: 'legend-unpub@jdm.test', verified: true });

    // Eight genuinely attended events.
    let triggerId = '';
    for (let i = 0; i < 8; i++) {
      const day = String(i + 1).padStart(2, '0');
      const e = await makeEvent(`legend-unpub-e${i}`, new Date(`2026-04-${day}T10:00:00Z`));
      const t = await makeTier(e.id, 'GA');
      const last = await makeUsedTicket(user.id, e.id, t.id, new Date(`2026-04-${day}T11:00:00Z`));
      triggerId = last.id;
    }

    // A draft event with a used ticket — never publicly an event the member
    // could attend.
    const draft = await prisma.event.create({
      data: {
        slug: 'legend-unpub-draft',
        title: 'legend-unpub-draft',
        description: 'desc',
        startsAt: new Date('2026-04-20T10:00:00Z'),
        endsAt: new Date('2026-04-20T14:00:00Z'),
        type: 'meeting',
        status: 'draft',
        capacity: 100,
      },
    });
    const draftTier = await makeTier(draft.id, 'GA');
    await makeUsedTicket(user.id, draft.id, draftTier.id, new Date('2026-04-20T11:00:00Z'));

    // A published event that has NOT started yet — an early-gate scan.
    const future = await makeEvent('legend-unpub-future', new Date('2099-01-01T10:00:00Z'));
    const futureTier = await makeTier(future.id, 'GA');
    await makeUsedTicket(user.id, future.id, futureTier.id, new Date('2026-04-21T11:00:00Z'));

    // Ten used tickets, eight attended events.
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, triggerId));
    expect(codes).not.toContain('EVT-003');
  });

  it('startsAt tie — one tied event skipped denies EVT-002 whichever id sorts first', async () => {
    const { user } = await createUser({ email: 'tie-miss@jdm.test', verified: true });

    const tie = new Date('2026-05-01T10:00:00Z');
    const e0 = await makeEvent('tie-miss-e0', new Date('2026-04-01T10:00:00Z'));
    const e1 = await makeEvent('tie-miss-e1', new Date('2026-04-15T10:00:00Z'));
    const ea = await makeEvent('tie-miss-ea', tie);
    const eb = await makeEvent('tie-miss-eb', tie);
    const t0 = await makeTier(e0.id, 'GA');
    const t1 = await makeTier(e1.id, 'GA');
    const ta = await makeTier(ea.id, 'GA');
    const tb = await makeTier(eb.id, 'GA');

    await makeUsedTicket(user.id, e0.id, t0.id, new Date('2026-04-01T11:00:00Z'));
    await makeUsedTicket(user.id, e1.id, t1.id, new Date('2026-04-15T11:00:00Z'));
    const trigger = await makeUsedTicket(user.id, ea.id, ta.id, new Date('2026-05-01T11:00:00Z'));
    // Held a ticket for the tied sibling and skipped it.
    await prisma.ticket.create({
      data: { userId: user.id, eventId: eb.id, tierId: tb.id, status: 'valid' },
    });

    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push(await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id)));
    }
    expect(runs[0]).not.toContain('EVT-002');
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });
});
