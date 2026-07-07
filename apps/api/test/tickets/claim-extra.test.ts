import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signQrCode } from '../../src/lib/qr.js';
import {
  claimExtra,
  ExtraItemNotFoundError,
  ExtraItemRevokedError,
  ExtraWrongEventError,
  InvalidExtraCodeError,
} from '../../src/services/tickets/claim-extra.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedExtraItem = async (status: 'valid' | 'used' | 'revoked' = 'valid') => {
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
      status: 'valid',
      source: 'purchase',
    },
  });
  const extra = await prisma.ticketExtra.create({
    data: {
      eventId: event.id,
      name: 'Cerveja Artesanal',
      priceCents: 2500,
      currency: 'BRL',
      quantityTotal: 50,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const code = signQrCode('e', `${ticket.id}-${extra.id}`, env);
  const item = await prisma.ticketExtraItem.create({
    data: {
      ticketId: ticket.id,
      extraId: extra.id,
      code,
      status,
      usedAt: status === 'used' ? new Date(Date.now() - 60_000) : null,
    },
  });
  return { user, event, tier, ticket, extra, item, code };
};

describe('claimExtra', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('claims a valid extra item and sets status=used', async () => {
    const { event, item, code } = await seedExtraItem('valid');
    const outcome = await claimExtra({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('claimed');
    const updated = await prisma.ticketExtraItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.status).toBe('used');
    expect(updated.usedAt).not.toBeNull();
  });

  it('is idempotent: already_used on retry returns original usedAt', async () => {
    const { event, code } = await seedExtraItem('valid');
    const first = await claimExtra({ code, eventId: event.id }, env);
    expect(first.kind).toBe('claimed');
    const second = await claimExtra({ code, eventId: event.id }, env);
    expect(second.kind).toBe('already_used');
  });

  it('throws InvalidExtraCodeError on malformed code', async () => {
    const { event } = await seedExtraItem('valid');
    await expect(
      claimExtra({ code: 'not-a-valid-code', eventId: event.id }, env),
    ).rejects.toBeInstanceOf(InvalidExtraCodeError);
  });

  it('throws InvalidExtraCodeError on ticket QR code (wrong kind)', async () => {
    const { event, ticket } = await seedExtraItem('valid');
    const ticketCode = signQrCode('t', ticket.id, env);
    await expect(claimExtra({ code: ticketCode, eventId: event.id }, env)).rejects.toBeInstanceOf(
      InvalidExtraCodeError,
    );
  });

  it('throws ExtraItemNotFoundError when code does not match any item', async () => {
    const { event, ticket, extra } = await seedExtraItem('valid');
    const orphanCode = signQrCode('e', `${ticket.id}-${extra.id}xxx`, env);
    await expect(claimExtra({ code: orphanCode, eventId: event.id }, env)).rejects.toBeInstanceOf(
      ExtraItemNotFoundError,
    );
  });

  it('throws ExtraWrongEventError when eventId does not match', async () => {
    const { code } = await seedExtraItem('valid');
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
    await expect(claimExtra({ code, eventId: otherEvent.id }, env)).rejects.toBeInstanceOf(
      ExtraWrongEventError,
    );
  });

  it('throws ExtraItemRevokedError for revoked items', async () => {
    const { event, code } = await seedExtraItem('revoked');
    await expect(claimExtra({ code, eventId: event.id }, env)).rejects.toBeInstanceOf(
      ExtraItemRevokedError,
    );
  });

  it('returns extra name and holder info on claim', async () => {
    const { event, user, code } = await seedExtraItem('valid');
    const outcome = await claimExtra({ code, eventId: event.id }, env);
    if (outcome.kind !== 'claimed') throw new Error('expected claimed');
    expect(outcome.item.extraName).toBe('Cerveja Artesanal');
    expect(outcome.item.ticket.user.id).toBe(user.id);
  });
});
