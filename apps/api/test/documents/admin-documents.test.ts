import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedDoc = async (userId: string, overrides: Record<string, unknown> = {}) =>
  prisma.userDocument.create({
    data: {
      userId,
      type: 'cnh',
      objectKey: `identity-document/${userId}/a.jpg`,
      ...overrides,
    },
  });

describe('admin document review', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const asAdmin = async () => {
    const { user } = await createUser({ verified: true, email: 'admin@ccc.test', role: 'admin' });
    return { admin: user, headers: { authorization: bearer(loadEnv(), user.id, 'admin') } };
  };

  it('rejects an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/documents' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a plain user', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects staff — documents are admin only', async () => {
    const { user } = await createUser({ verified: true, email: 's@ccc.test', role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an organizer — documents are admin only', async () => {
    const { user } = await createUser({ verified: true, email: 'o@ccc.test', role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin reach the queue', async () => {
    const { headers } = await asAdmin();
    const res = await app.inject({ method: 'GET', url: '/admin/documents', headers });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for a malformed cursor instead of 500', async () => {
    const { headers } = await asAdmin();
    const res = await app.inject({ method: 'GET', url: '/admin/documents?cursor=zzz', headers });
    expect(res.statusCode).toBe(400);
  });

  it('lists the pending queue', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await seedDoc(user.id);
    await seedDoc(user.id, {
      objectKey: `identity-document/${user.id}/b.jpg`,
      status: 'approved',
      reviewedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/documents?status=pending',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ status: string; userId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.status).toBe('pending');
    expect(body.items[0]!.userId).toBe(user.id);
  });

  it('never exposes the file url in the list payload', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await seedDoc(user.id);
    const res = await app.inject({ method: 'GET', url: '/admin/documents', headers });
    expect(res.body).not.toContain('signed');
    expect(res.body).not.toContain('.jpg');
  });

  it('redirects to a signed url and records an audit entry', async () => {
    const { admin, headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/documents/${doc.id}/file`,
      headers,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('identity-document');

    const audit = await prisma.adminAudit.findFirst({
      where: { entityType: 'user_document', entityId: doc.id, actorId: admin.id },
    });
    expect(audit?.action).toBe('document_viewed');
  });

  it('returns 410 when the file was purged', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id, { fileDeletedAt: new Date() });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/documents/${doc.id}/file`,
      headers,
    });
    expect(res.statusCode).toBe(410);
  });

  it('approves a pending document and audits it', async () => {
    const { admin, headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/approve`,
      headers,
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('approved');
    expect(row.reviewedAt).not.toBeNull();
    expect(row.reviewedByAdminId).toBe(admin.id);

    const audit = await prisma.adminAudit.findFirst({
      where: { entityType: 'user_document', entityId: doc.id, action: 'document_approved' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects with a reason and audits it', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'Foto ilegível' },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('rejected');
    expect(row.rejectionReason).toBe('Foto ilegível');
  });

  it('requires a reason to reject', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.status).toBe('pending');
  });

  it('refuses to re-review an already-reviewed document', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const doc = await seedDoc(user.id, { status: 'approved', reviewedAt: new Date() });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'mudei de ideia' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('does not touch subscription state on rejection', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_x',
        providerSubRef: 'sub_x',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        baseAmountCents: 9900,
        devFeePercent: 10,
        devFeeAmountCents: 990,
        grossAmountCents: 10890,
        currency: 'BRL',
      },
    });
    const doc = await seedDoc(user.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/documents/${doc.id}/reject`,
      headers,
      payload: { reason: 'Foto ilegível' },
    });

    // Guard the guard: if the rejection itself didn't happen (e.g. a future
    // precondition makes this fixture 409), the membership assertion below
    // would pass vacuously and stop meaning anything.
    expect(res.statusCode).toBe(200);
    const reviewed = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(reviewed.status).toBe('rejected');

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row.status).toBe('active');
  });

  it('returns 404 for an unknown document', async () => {
    const { headers } = await asAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/documents/nope/approve',
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  // This asserted `not.toContain(CPF)` for an `admin` actor, which 7e5c0fb
  // deliberately changed: `admin` viewers now get the decrypted digits, gated
  // by role and written to the audit log. That contract is owned by
  // test/admin/users/detail.test.ts ('cpf/phone exposure (admin-only,
  // audited)'), which covers both the admin and the organizer-gets-null side.
  // What is still this file's business is the document: reviewing an identity
  // document must never put the ciphertext or the R2 object key on the wire.
  it('never leaks the cpf ciphertext or the document object key through the admin user detail route', async () => {
    const { headers } = await asAdmin();
    const { user } = await createUser({ verified: true, email: 'member@ccc.test' });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    await seedDoc(user.id);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${user.id}`, headers });
    expect(res.statusCode).toBe(200);
    // Never the stored ciphertext, never the object key of the document file.
    expect(res.body).not.toContain('enc_v1:');
    expect(res.body).not.toContain('.jpg');
    const body = res.json() as {
      hasCpf: boolean;
      hasPhone: boolean;
      cpf: string | null;
      documents: unknown[];
    };
    // Guard the guard: if the route stopped returning the plaintext to an
    // admin, the two assertions above would pass vacuously.
    expect(body.cpf).toBe('52998224725');
    expect(body.hasCpf).toBe(true);
    expect(body.hasPhone).toBe(true);
    expect(body.documents).toHaveLength(1);
  });
});
