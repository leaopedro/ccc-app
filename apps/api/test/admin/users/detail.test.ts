import { prisma } from '@ccc/db';
import { adminUserDetailSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { encryptField } from '../../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: `evt-${Date.now()}`,
      title: 'Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 86400_000),
      endsAt: new Date(Date.now() + 7 * 86400_000 + 3600_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'Curitiba',
      stateCode: 'PR',
      type: 'meeting',
      capacity: 100,
      status: 'published',
      publishedAt: new Date(),
    },
  });

const mkTier = (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Standard',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      sortOrder: 0,
    },
  });

describe('GET /admin/users/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users/nonexistent' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for nonexistent user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/nonexistent',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns user profile with zero stats', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.id).toBe(target.id);
    expect(body.email).toBe('alice@jdm.test');
    expect(body.name).toBe('Alice');
    expect(body.stats.totalTickets).toBe(0);
    expect(body.stats.totalOrders).toBe(0);
    expect(body.recentTickets).toEqual([]);
    expect(body.recentOrders).toEqual([]);
  });

  it('includes empty groups array when user has no memberships', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.groups).toEqual([]);
  });

  it('includes group memberships in response', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const group = await prisma.userGroup.create({
      data: { name: 'VIP', description: null },
    });
    await prisma.userGroupMembership.create({
      data: { groupId: group.id, userId: target.id },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.id).toBe(group.id);
    expect(body.groups[0]!.name).toBe('VIP');
  });

  it('includes ticket and order counts and recent items', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'buyer@jdm.test',
      name: 'Buyer',
      verified: true,
    });

    const event = await mkEvent();
    const tier = await mkTier(event.id);

    await prisma.order.create({
      data: {
        userId: target.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
      },
    });

    await prisma.ticket.create({
      data: {
        userId: target.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.stats.totalTickets).toBe(1);
    expect(body.stats.totalOrders).toBe(1);
    expect(body.recentTickets.length).toBe(1);
    expect(body.recentTickets[0]!.eventTitle).toBe('Test Event');
    expect(body.recentTickets[0]!.status).toBe('valid');
    expect(body.recentOrders.length).toBe(1);
    expect(body.recentOrders[0]!.amountCents).toBe(5000);
    expect(body.recentOrders[0]!.status).toBe('paid');
  });

  describe('cpf/phone exposure (admin-only, audited)', () => {
    const CPF_DIGITS = '52998224725';
    const PHONE_DIGITS = '11987654321';

    it('admin actor gets the decrypted cpf digits and the phone digits', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: target } = await createUser({
        email: 'has-docs@jdm.test',
        name: 'Has Docs',
        verified: true,
      });
      await prisma.user.update({
        where: { id: target.id },
        data: {
          cpf: encryptField(CPF_DIGITS, loadEnv().FIELD_ENCRYPTION_KEY),
          phone: PHONE_DIGITS,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${target.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminUserDetailSchema.parse(res.json());
      expect(body.cpf).toBe(CPF_DIGITS);
      expect(body.phone).toBe(PHONE_DIGITS);
      expect(body.hasCpf).toBe(true);
      expect(body.hasPhone).toBe(true);
    });

    it('non-admin actor who can reach the route gets null for both, rest unchanged', async () => {
      const { user: org } = await createUser({
        email: 'org2@jdm.test',
        verified: true,
        role: 'organizer',
      });
      const { user: target } = await createUser({
        email: 'has-docs2@jdm.test',
        name: 'Has Docs Two',
        verified: true,
      });
      await prisma.user.update({
        where: { id: target.id },
        data: {
          cpf: encryptField(CPF_DIGITS, loadEnv().FIELD_ENCRYPTION_KEY),
          phone: PHONE_DIGITS,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${target.id}`,
        headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminUserDetailSchema.parse(res.json());
      expect(body.cpf).toBeNull();
      expect(body.phone).toBeNull();
      // Presence flags and the rest of the payload are unaffected by the role gate.
      expect(body.hasCpf).toBe(true);
      expect(body.hasPhone).toBe(true);
      expect(body.id).toBe(target.id);
      expect(body.name).toBe('Has Docs Two');

      const audits = await prisma.adminAudit.findMany({ where: { action: 'user.pii_viewed' } });
      expect(audits).toHaveLength(0);
    });

    it('member with no cpf and no phone yields null for both and writes no audit row', async () => {
      const { user: admin } = await createUser({
        email: 'admin3@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: target } = await createUser({
        email: 'no-pii@jdm.test',
        name: 'No Pii',
        verified: true,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${target.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminUserDetailSchema.parse(res.json());
      expect(body.cpf).toBeNull();
      expect(body.phone).toBeNull();

      const audits = await prisma.adminAudit.findMany({ where: { action: 'user.pii_viewed' } });
      expect(audits).toHaveLength(0);
    });

    it('admin read of a member with cpf writes exactly one audit row with no cpf digits in metadata', async () => {
      const { user: admin } = await createUser({
        email: 'admin4@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: target } = await createUser({
        email: 'has-cpf@jdm.test',
        name: 'Has Cpf',
        verified: true,
      });
      await prisma.user.update({
        where: { id: target.id },
        data: {
          cpf: encryptField(CPF_DIGITS, loadEnv().FIELD_ENCRYPTION_KEY),
          phone: PHONE_DIGITS,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${target.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);

      const audits = await prisma.adminAudit.findMany({ where: { action: 'user.pii_viewed' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorId).toBe(admin.id);
      expect(audits[0]!.entityId).toBe(target.id);
      const metadataJson = JSON.stringify(audits[0]!.metadata);
      expect(metadataJson).not.toContain(CPF_DIGITS);
      expect(metadataJson).not.toContain(PHONE_DIGITS);
    });

    it('undecryptable ciphertext yields null and not a 500', async () => {
      const { user: admin } = await createUser({
        email: 'admin5@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: target } = await createUser({
        email: 'bad-cipher@jdm.test',
        name: 'Bad Cipher',
        verified: true,
      });
      const validCiphertext = encryptField(CPF_DIGITS, loadEnv().FIELD_ENCRYPTION_KEY);
      // Flip a hex character in the auth tag segment to break authentication
      // while keeping the enc_v1:iv:data:tag shape intact (isEncrypted() must
      // still recognize it so decryptField takes the decrypt-and-catch path).
      const parts = validCiphertext.split(':');
      const tag = parts[3]!;
      const flippedChar = tag[0] === '0' ? '1' : '0';
      parts[3] = flippedChar + tag.slice(1);
      const corrupted = parts.join(':');

      await prisma.user.update({
        where: { id: target.id },
        data: { cpf: corrupted },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/users/${target.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminUserDetailSchema.parse(res.json());
      expect(body.cpf).toBeNull();

      // hasCpf still reflects that a (corrupted) ciphertext is on file.
      expect(body.hasCpf).toBe(true);
    });
  });
});
