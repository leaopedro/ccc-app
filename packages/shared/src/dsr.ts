import { z } from 'zod';

export const dsrTypeSchema = z.enum([
  'access',
  'deletion',
  'rectification',
  'portability',
  'objection',
]);
export type DsrType = z.infer<typeof dsrTypeSchema>;

export const dsrStatusSchema = z.enum([
  'pending_identity',
  'open',
  'in_progress',
  'completed',
  'denied',
]);
export type DsrStatus = z.infer<typeof dsrStatusSchema>;

export const dsrIdentityStatusSchema = z.enum(['not_requested', 'requested', 'verified', 'failed']);
export type DsrIdentityStatus = z.infer<typeof dsrIdentityStatusSchema>;

export const createDsrBodySchema = z.object({
  userId: z.string().min(1),
  type: dsrTypeSchema,
  description: z.string().max(2000).optional(),
});

export const updateDsrBodySchema = z.object({
  status: dsrStatusSchema.optional(),
  identityStatus: dsrIdentityStatusSchema.optional(),
  identityProofKey: z.string().max(300).optional(),
  evidenceKey: z.string().max(300).optional(),
  denialReason: z.string().max(2000).optional(),
  note: z.string().max(2000).optional(),
});

export const dsrListQuerySchema = z.object({
  status: dsrStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number({ coerce: true }).int().min(1).max(100).default(50),
});

export const dsrActionSchema = z.object({
  id: z.string(),
  dsrId: z.string(),
  actorId: z.string(),
  action: z.string(),
  note: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

export const dsrDetailSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: dsrTypeSchema,
  status: dsrStatusSchema,
  identityStatus: dsrIdentityStatusSchema,
  description: z.string().nullable(),
  dueDate: z.string(),
  identityProofKey: z.string().nullable(),
  evidenceKey: z.string().nullable(),
  resolverId: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  denialReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  resolver: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
  actions: z.array(dsrActionSchema),
  daysRemaining: z.number(),
});

export const dsrListItemSchema = dsrDetailSchema.omit({ actions: true });

export const dsrListResponseSchema = z.object({
  items: z.array(dsrListItemSchema),
  nextCursor: z.string().nullable(),
});
