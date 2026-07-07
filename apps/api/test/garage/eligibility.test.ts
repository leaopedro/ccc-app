import { prisma } from '@jdm/db';
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
  it('yields JDM-003 when User.createdAt is strictly before the cutoff', () => {
    const before = new Date(FOUNDER_CUTOFF.getTime() - 86_400_000);
    const codes = checkSignupEligibility(
      // tx isn't read by this helper.
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u1',
      before,
    );
    expect(codes).toEqual(['JDM-003']);
  });

  it('does NOT yield JDM-003 when User.createdAt is exactly the cutoff', () => {
    const codes = checkSignupEligibility(
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u2',
      FOUNDER_CUTOFF,
    );
    expect(codes).toEqual([]);
  });

  it('does NOT yield JDM-003 when User.createdAt is after the cutoff', () => {
    const after = new Date(FOUNDER_CUTOFF.getTime() + 86_400_000);
    const codes = checkSignupEligibility(
      undefined as unknown as Parameters<typeof checkSignupEligibility>[0],
      'u3',
      after,
    );
    expect(codes).toEqual([]);
  });
});

describe('eligibility/events.checkEligibility — EVT-002 streak query', () => {
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

  it('JDM-001 fires on Curitiba event', async () => {
    const { user } = await createUser({ email: 'ctba@jdm.test', verified: true });
    const e = await makeEvent('curitiba-meet', new Date('2026-05-10T10:00:00Z'), {
      city: 'Curitiba',
    });
    const t = await makeTier(e.id, 'GA');
    const trigger = await makeUsedTicket(user.id, e.id, t.id, new Date('2026-05-10T11:00:00Z'));
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('JDM-001');
  });

  it('JDM-002 fires on drift-type event', async () => {
    const { user } = await createUser({ email: 'drift@jdm.test', verified: true });
    const e = await makeEvent('drift-meet', new Date('2026-05-10T10:00:00Z'), {
      type: 'drift',
    });
    const t = await makeTier(e.id, 'GA');
    const trigger = await makeUsedTicket(user.id, e.id, t.id, new Date('2026-05-10T11:00:00Z'));
    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('JDM-002');
  });
});
