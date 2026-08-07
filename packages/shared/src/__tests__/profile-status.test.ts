import { describe, expect, it } from 'vitest';

import { signupSchema } from '../auth.js';
import {
  createDocumentBodySchema,
  documentUploadRequestSchema,
  MAX_DOCUMENT_BYTES,
  userDocumentSchema,
} from '../documents.js';
import {
  buildIncompleteProfileError,
  incompleteProfileErrorSchema,
  MISSING_FIELD_KEYS,
  profileStatusSchema,
} from '../profile-status.js';

describe('profile-status contracts', () => {
  it('keeps the missing-key order stable', () => {
    expect(MISSING_FIELD_KEYS).toEqual(['cpf', 'phone', 'document']);
  });

  it('builds a 403 payload carrying both status and code', () => {
    const payload = buildIncompleteProfileError(['cpf', 'phone']);
    expect(payload.error).toBe('Forbidden');
    expect(payload.status).toBe('incomplete_profile');
    expect(payload.code).toBe('INCOMPLETE_PROFILE');
    expect(payload.missing).toEqual(['cpf', 'phone']);
    expect(incompleteProfileErrorSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an empty missing list', () => {
    expect(incompleteProfileErrorSchema.safeParse(buildIncompleteProfileError([])).success).toBe(
      false,
    );
  });

  it('parses a full profile status', () => {
    const parsed = profileStatusSchema.parse({
      fields: { cpf: true, phone: false, document: false },
      checkout: { complete: false, missing: ['phone'] },
      subscription: { complete: false, missing: ['phone', 'document'] },
      latestDocument: {
        id: 'd1',
        type: 'cnh',
        status: 'pending',
        sentAt: '2026-08-06T00:00:00.000Z',
        reviewedAt: null,
        rejectionReason: null,
      },
    });
    expect(parsed.subscription.missing).toEqual(['phone', 'document']);
  });

  it('accepts a null latestDocument', () => {
    const parsed = profileStatusSchema.parse({
      fields: { cpf: false, phone: false, document: false },
      checkout: { complete: false, missing: ['cpf', 'phone'] },
      subscription: { complete: false, missing: ['cpf', 'phone', 'document'] },
      latestDocument: null,
    });
    expect(parsed.latestDocument).toBeNull();
  });
});

describe('document contracts', () => {
  it('accepts an allowed image type within the size cap', () => {
    expect(
      documentUploadRequestSchema.parse({ contentType: 'image/jpeg', size: 1024 }),
    ).toEqual({ contentType: 'image/jpeg', size: 1024 });
  });

  it('rejects pdf', () => {
    expect(
      documentUploadRequestSchema.safeParse({ contentType: 'application/pdf', size: 1024 }).success,
    ).toBe(false);
  });

  it('rejects a size above the cap', () => {
    expect(
      documentUploadRequestSchema.safeParse({
        contentType: 'image/png',
        size: MAX_DOCUMENT_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('accepts a create body with a known type', () => {
    const parsed = createDocumentBodySchema.parse({
      type: 'rg',
      objectKey: 'identity-document/u1/abc.jpg',
    });
    expect(parsed.type).toBe('rg');
  });

  it('rejects an unknown document type', () => {
    expect(
      createDocumentBodySchema.safeParse({ type: 'passport', objectKey: 'x' }).success,
    ).toBe(false);
  });

  it('allows a null fileUrl for a purged document', () => {
    const parsed = userDocumentSchema.parse({
      id: 'd1',
      type: 'cnh',
      status: 'approved',
      sentAt: '2026-08-06T00:00:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      rejectionReason: null,
      fileUrl: null,
    });
    expect(parsed.fileUrl).toBeNull();
  });
});

describe('signupSchema', () => {
  const base = { name: 'A', email: 'a@b.test', password: 'correct-horse-battery' };

  it('accepts the minimum payload', () => {
    const parsed = signupSchema.parse(base);
    expect(parsed.cpf).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('accepts and normalizes optional cpf and phone', () => {
    const parsed = signupSchema.parse({
      ...base,
      cpf: '529.982.247-25',
      phone: '(11) 98765-4321',
    });
    expect(parsed.cpf).toBe('52998224725');
    expect(parsed.phone).toBe('11987654321');
  });

  it('rejects an invalid optional cpf instead of ignoring it', () => {
    expect(signupSchema.safeParse({ ...base, cpf: '111.111.111-11' }).success).toBe(false);
  });
});
