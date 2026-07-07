import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  checkInTicket,
  InvalidTicketCodeError,
  TicketNotFoundError,
  TicketRevokedError,
  TicketWrongEventError,
} from '../../src/services/tickets/check-in.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedTicket = async (status: 'valid' | 'used' | 'revoked' = 'valid') => {
  const { user } = await createUser({ email: `h-${Math.random()}@jdm.test`, verified: true });
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Test Event',
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
      priceCents: 1000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      status,
      usedAt: status === 'used' ? new Date(Date.now() - 60_000) : null,
      source: 'purchase',
    },
  });
  return { user, event, tier, ticket, code: signTicketCode(ticket.id, env) };
};

describe('checkInTicket', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('admits a valid ticket and sets status=used', async () => {
    const { event, ticket, code } = await seedTicket('valid');
    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');
    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('used');
    expect(updated.usedAt).not.toBeNull();
  });

  it('is idempotent: already_used on retry returns original usedAt', async () => {
    const { event, ticket, code } = await seedTicket('valid');
    const first = await checkInTicket({ code, eventId: event.id }, env);
    expect(first.kind).toBe('admitted');
    const originalUsedAt = (
      await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      })
    ).usedAt!;
    const second = await checkInTicket({ code, eventId: event.id }, env);
    if (second.kind !== 'already_used') throw new Error('expected already_used');
    expect(second.originalUsedAt.toISOString()).toBe(originalUsedAt.toISOString());
  });

  it('throws InvalidTicketCodeError on malformed code', async () => {
    const { event } = await seedTicket('valid');
    await expect(
      checkInTicket({ code: 'not-a-valid-code', eventId: event.id }, env),
    ).rejects.toBeInstanceOf(InvalidTicketCodeError);
  });

  it('throws InvalidTicketCodeError on tampered signature', async () => {
    const { event, code } = await seedTicket('valid');
    const tampered = `${code.split('.')[0]}.aaaaaaaaaaaa`;
    await expect(checkInTicket({ code: tampered, eventId: event.id }, env)).rejects.toBeInstanceOf(
      InvalidTicketCodeError,
    );
  });

  it('throws TicketNotFoundError when the signed ticketId does not exist', async () => {
    const { event } = await seedTicket('valid');
    const orphanCode = signTicketCode('nonexistent-id', env);
    await expect(
      checkInTicket({ code: orphanCode, eventId: event.id }, env),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('throws TicketWrongEventError when eventId does not match', async () => {
    const { code } = await seedTicket('valid');
    const otherEvent = await prisma.event.create({
      data: {
        slug: 'other-event',
        title: 'Other',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'Rio',
        stateCode: 'RJ',
        type: 'meeting',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });
    await expect(checkInTicket({ code, eventId: otherEvent.id }, env)).rejects.toBeInstanceOf(
      TicketWrongEventError,
    );
  });

  it('throws TicketRevokedError for revoked tickets', async () => {
    const { event, code } = await seedTicket('revoked');
    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toBeInstanceOf(
      TicketRevokedError,
    );
  });

  it('concurrent scans: exactly one outcome is admitted', async () => {
    const { event, code } = await seedTicket('valid');
    const results = await Promise.allSettled([
      checkInTicket({ code, eventId: event.id }, env),
      checkInTicket({ code, eventId: event.id }, env),
      checkInTicket({ code, eventId: event.id }, env),
    ]);
    const admitted = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'admitted');
    const retried = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'already_used',
    );
    expect(admitted).toHaveLength(1);
    expect(retried).toHaveLength(2);
  });
});
