import { z } from 'zod';

import { notificationDeliveryModeSchema, notificationDestinationSchema } from './notifications.js';

export const broadcastTargetKindSchema = z.enum(['all', 'premium', 'attendees_of_event', 'city']);
export type BroadcastTargetKind = z.infer<typeof broadcastTargetKindSchema>;

export const broadcastStatusSchema = z.enum([
  'draft',
  'scheduled',
  'processing',
  'sent',
  'failed',
  'cancelled',
]);
export type BroadcastStatus = z.infer<typeof broadcastStatusSchema>;

export const broadcastDeliveryStatusSchema = z.enum(['pending', 'sent', 'failed', 'skipped']);
export type BroadcastDeliveryStatus = z.infer<typeof broadcastDeliveryStatusSchema>;

export const broadcastTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('premium') }),
  z.object({ kind: z.literal('attendees_of_event'), eventId: z.string().min(1) }),
  z.object({ kind: z.literal('city'), city: z.string().min(1).max(100) }),
]);
export type BroadcastTarget = z.infer<typeof broadcastTargetSchema>;

export const createBroadcastRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(500),
    data: z.record(z.unknown()).default({}),
    target: broadcastTargetSchema,
    deliveryMode: notificationDeliveryModeSchema.default('in_app_plus_push'),
    destination: notificationDestinationSchema.optional(),
    scheduledAt: z.string().datetime().optional(),
    sendNow: z.boolean().optional(),
  })
  .refine((d) => !(d.sendNow && d.scheduledAt), {
    message: 'Use either sendNow or scheduledAt, not both',
  });
export type CreateBroadcastRequest = z.infer<typeof createBroadcastRequestSchema>;

export const updateBroadcastRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(500).optional(),
  data: z.record(z.unknown()).optional(),
  target: broadcastTargetSchema.optional(),
  deliveryMode: notificationDeliveryModeSchema.optional(),
  destination: notificationDestinationSchema.nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type UpdateBroadcastRequest = z.infer<typeof updateBroadcastRequestSchema>;

export const broadcastDryRunRequestSchema = z.object({
  target: broadcastTargetSchema,
});
export type BroadcastDryRunRequest = z.infer<typeof broadcastDryRunRequestSchema>;

export const broadcastDryRunResponseSchema = z.object({
  estimatedRecipients: z.number().int().nonnegative(),
});
export type BroadcastDryRunResponse = z.infer<typeof broadcastDryRunResponseSchema>;

export const broadcastSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  targetKind: broadcastTargetKindSchema,
  targetValue: z.string().nullable(),
  deliveryMode: notificationDeliveryModeSchema,
  destination: notificationDestinationSchema.nullable(),
  status: broadcastStatusSchema,
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  pendingCount: z.number().int(),
});
export type BroadcastSummary = z.infer<typeof broadcastSummarySchema>;

export const broadcastListResponseSchema = z.object({
  broadcasts: z.array(broadcastSummarySchema),
});
export type BroadcastListResponse = z.infer<typeof broadcastListResponseSchema>;

export const pushPrefsSchema = z.object({
  transactional: z.boolean(),
  marketing: z.boolean(),
});
export type PushPrefs = z.infer<typeof pushPrefsSchema>;

export const pushPrefsStorageSchema = z.object({
  transactional: z.boolean().default(true),
  marketing: z.boolean().default(false),
});

export const updatePushPrefsRequestSchema = z.object({
  marketing: z.boolean(),
});
export type UpdatePushPrefsRequest = z.infer<typeof updatePushPrefsRequestSchema>;
