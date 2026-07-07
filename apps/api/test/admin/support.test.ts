/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import { adminSupportTicketListResponseSchema } from '@jdm/shared/support';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

async function seedTicket(
  userId: string,
  overrides: Partial<{ phone: string; message: string; status: 'open' | 'closed' }> = {},
) {
  return prisma.supportTicket.create({
    data: {
      userId,
      phone: overrides.phone ?? '11999999999',
      message: overrides.message ?? 'Mensagem de teste.',
      status: overrides.status ?? 'open',
    },
  });
}

describe('GET /admin/support', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/support' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/support',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns all tickets for organizer', async () => {
    const { user: organizer } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
    await seedTicket(member.id, { message: 'open ticket', status: 'open' });
    await seedTicket(member.id, { message: 'closed ticket', status: 'closed' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/support',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body).toHaveProperty('hasMore');
    expect(body).toHaveProperty('nextCursor');
  });

  it('filters by status=open', async () => {
    const { user: organizer } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm2@jdm.test', verified: true });
    await seedTicket(member.id, { message: 'open ticket', status: 'open' });
    await seedTicket(member.id, { message: 'closed ticket', status: 'closed' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/support?status=open',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('open');
  });

  it('filters by status=closed', async () => {
    const { user: organizer } = await createUser({
      email: 'org3@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm3@jdm.test', verified: true });
    await seedTicket(member.id, { message: 'open ticket', status: 'open' });
    await seedTicket(member.id, { message: 'closed ticket', status: 'closed' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/support?status=closed',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('closed');
  });

  it('returns tickets newest-first with both status fields', async () => {
    const { user: organizer } = await createUser({
      email: 'org4@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm4@jdm.test', verified: true });
    const older = await seedTicket(member.id, { message: 'older ticket', status: 'closed' });
    const newer = await seedTicket(member.id, { message: 'newer ticket', status: 'open' });

    await prisma.supportTicket.update({
      where: { id: older.id },
      data: {
        createdAt: new Date('2026-05-13T15:00:00.000Z'),
        internalStatus: 'done',
      },
    });
    await prisma.supportTicket.update({
      where: { id: newer.id },
      data: {
        createdAt: new Date('2026-05-14T15:00:00.000Z'),
        internalStatus: 'in_progress',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/support',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminSupportTicketListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(body.items[0]).toMatchObject({
      status: 'open',
      internalStatus: 'in_progress',
    });
    expect(body.items[1]).toMatchObject({
      status: 'closed',
      internalStatus: 'done',
    });
  });
});

describe('GET /admin/support/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/support/nonexistent' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/support/nonexistent',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const { user: organizer } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/support/00000000-0000-0000-0000-000000000000',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns ticket detail with user info for organizer', async () => {
    const { user: organizer } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({
      email: 'member@jdm.test',
      name: 'Test Member',
      verified: true,
    });
    const ticket = await seedTicket(member.id, { message: 'Detalhe do ticket.' });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/support/${ticket.id}`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: ticket.id,
      message: 'Detalhe do ticket.',
      status: 'open',
    });
    expect(body.user).toMatchObject({
      id: member.id,
      name: 'Test Member',
      email: 'member@jdm.test',
    });
    expect(body).toHaveProperty('closedAt');
    expect(body).toHaveProperty('closedByAdminId');
    expect(body).toHaveProperty('internalStatus', 'unread');
  });
});

describe('PATCH /admin/support/:id/close', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/nonexistent/close',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/nonexistent/close',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const { user: organizer } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/00000000-0000-0000-0000-000000000000/close',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('closes an open ticket and records closedAt + closedByAdminId', async () => {
    const { user: organizer } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
    const ticket = await seedTicket(member.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticket.id}/close`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('closed');
    expect(body.closedAt).not.toBeNull();
    expect(body.closedByAdminId).toBe(organizer.id);
  });

  it('is idempotent: closing an already-closed ticket returns current state without error', async () => {
    const { user: organizer } = await createUser({
      email: 'org3@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm2@jdm.test', verified: true });
    const ticket = await seedTicket(member.id, { status: 'closed' });

    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { closedAt: new Date(), closedByAdminId: organizer.id },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticket.id}/close`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('closed');
  });
});

describe('PATCH /admin/support/:id/internal-status', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/nonexistent/internal-status',
      payload: { internalStatus: 'seen' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/nonexistent/internal-status',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { internalStatus: 'seen' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const { user: organizer } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/support/00000000-0000-0000-0000-000000000000/internal-status',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
      payload: { internalStatus: 'seen' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates internalStatus and returns updated ticket', async () => {
    const { user: organizer } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
    const ticket = await seedTicket(member.id);

    expect(ticket.internalStatus).toBe('unread');

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticket.id}/internal-status`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
      payload: { internalStatus: 'in_progress' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.internalStatus).toBe('in_progress');
    expect(body.status).toBe('open');
  });

  it('rejects invalid internalStatus value', async () => {
    const { user: organizer } = await createUser({
      email: 'org3@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: member } = await createUser({ email: 'm2@jdm.test', verified: true });
    const ticket = await seedTicket(member.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticket.id}/internal-status`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
      payload: { internalStatus: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });
});
