import { z } from 'zod';

export const consentPurposeSchema = z.enum([
  'privacy_notice',
  'cookies_analytics',
  'cookies_marketing',
  'push_marketing',
  'email_marketing',
  'newsletter',
]);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const consentChannelSchema = z.enum(['web_admin', 'web_public', 'mobile', 'email']);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

export const consentEvidenceSchema = z.object({ source: z.string().min(1) }).passthrough();
export type ConsentEvidence = z.infer<typeof consentEvidenceSchema>;

export const grantConsentBodySchema = z.object({
  purpose: consentPurposeSchema,
  version: z.string().min(1).max(100),
  evidence: consentEvidenceSchema,
});
export type GrantConsentBody = z.infer<typeof grantConsentBodySchema>;

export const consentRecordSchema = z.object({
  id: z.string(),
  purpose: consentPurposeSchema,
  version: z.string(),
  givenAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
  channel: consentChannelSchema,
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentListResponseSchema = z.object({
  items: z.array(consentRecordSchema),
});
export type ConsentListResponse = z.infer<typeof consentListResponseSchema>;

export const adminConsentListQuerySchema = z.object({
  userId: z.string().optional(),
  purpose: consentPurposeSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminConsentListQuery = z.infer<typeof adminConsentListQuerySchema>;

export const adminConsentRecordSchema = consentRecordSchema.extend({
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AdminConsentRecord = z.infer<typeof adminConsentRecordSchema>;

export const adminConsentListResponseSchema = z.object({
  items: z.array(adminConsentRecordSchema),
  nextCursor: z.string().nullable(),
});
export type AdminConsentListResponse = z.infer<typeof adminConsentListResponseSchema>;
