import { prisma } from '@jdm/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkFeedReadAccess, checkFeedPostAccess } from '../../src/services/feed/access.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedEvent = (
  overrides: {
    feedAccess?: 'public' | 'attendees' | 'members_only';
    postingAccess?: 'attendees' | 'members_only' | 'organizers_only';
  } = {},
) =>
  prisma.event.create({
    data: {
      title: 'Feed Access Event',
      slug: `fae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
      feedAccess: overrides.feedAccess ?? 'attendees',
      postingAccess: overrides.postingAccess ?? 'attendees',
    },
  });

const seedTier = (eventId: string) =>
  prisma.ticketTier.create({
    data: { eventId, name: 'Geral', priceCents: 0, quantityTotal: 100 },
  });

const seedTicket = (
  userId: string,
  eventId: string,
  tierId: string,
  source: 'purchase' | 'premium_grant' | 'comp' = 'purchase',
) =>
  prisma.ticket.create({
    data: { userId, eventId, tierId, source, status: 'valid' },
  });

describe('checkFeedReadAccess', () => {
  beforeEach(resetDatabase);

  it('allows anonymous read on public event', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const result = await checkFeedReadAccess(event.id, null, 'user');
    expect(result).toBe('ok');
  });

  it('blocks anonymous on attendees event', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const result = await checkFeedReadAccess(event.id, null, 'user');
    expect(result).toBe('forbidden');
  });

  it('allows ticket holder on attendees event', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    await seedTicket(user.id, event.id, tier.id);
    const result = await checkFeedReadAccess(event.id, user.id, 'user');
    expect(result).toBe('ok');
  });

  it('blocks non-member on members_only event', async () => {
    const event = await seedEvent({ feedAccess: 'members_only' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    await seedTicket(user.id, event.id, tier.id, 'purchase');
    const result = await checkFeedReadAccess(event.id, user.id, 'user');
    expect(result).toBe('forbidden');
  });

  it('allows premium_grant ticket holder on members_only event', async () => {
    const event = await seedEvent({ feedAccess: 'members_only' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    await seedTicket(user.id, event.id, tier.id, 'premium_grant');
    const result = await checkFeedReadAccess(event.id, user.id, 'user');
    expect(result).toBe('ok');
  });

  it('blocks view-banned user even with ticket', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await seedTicket(user.id, event.id, tier.id);
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'view', bannedById: admin.id },
    });
    const result = await checkFeedReadAccess(event.id, user.id, 'user');
    expect(result).toBe('banned');
  });

  it('organizer bypasses feedAccess check', async () => {
    const event = await seedEvent({ feedAccess: 'members_only' });
    const { user } = await createUser({ role: 'organizer' });
    const result = await checkFeedReadAccess(event.id, user.id, 'organizer');
    expect(result).toBe('ok');
  });
});

describe('checkFeedPostAccess', () => {
  beforeEach(resetDatabase);

  it('blocks anonymous posting always', async () => {
    const event = await seedEvent({ postingAccess: 'attendees' });
    const result = await checkFeedPostAccess(event.id, null, 'user');
    expect(result).toBe('forbidden');
  });

  it('allows ticket holder on attendees posting', async () => {
    const event = await seedEvent({ postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    await seedTicket(user.id, event.id, tier.id);
    const result = await checkFeedPostAccess(event.id, user.id, 'user');
    expect(result).toBe('ok');
  });

  it('blocks non-member on members_only posting', async () => {
    const event = await seedEvent({ postingAccess: 'members_only' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    await seedTicket(user.id, event.id, tier.id, 'purchase');
    const result = await checkFeedPostAccess(event.id, user.id, 'user');
    expect(result).toBe('forbidden');
  });

  it('blocks non-organizer on organizers_only posting', async () => {
    const event = await seedEvent({ postingAccess: 'organizers_only' });
    const { user } = await createUser();
    const result = await checkFeedPostAccess(event.id, user.id, 'user');
    expect(result).toBe('forbidden');
  });

  it('allows organizer on organizers_only posting', async () => {
    const event = await seedEvent({ postingAccess: 'organizers_only' });
    const { user } = await createUser({ role: 'organizer' });
    const result = await checkFeedPostAccess(event.id, user.id, 'organizer');
    expect(result).toBe('ok');
  });

  it('blocks post-banned user', async () => {
    const event = await seedEvent({ postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await seedTicket(user.id, event.id, tier.id);
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'post', bannedById: admin.id },
    });
    const result = await checkFeedPostAccess(event.id, user.id, 'user');
    expect(result).toBe('banned');
  });
});
