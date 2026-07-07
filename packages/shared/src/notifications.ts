import { z } from 'zod';

export const notificationDeliveryModeSchema = z.enum(['in_app_only', 'in_app_plus_push']);
export type NotificationDeliveryMode = z.infer<typeof notificationDeliveryModeSchema>;

// Validated relative path: must start with `/`, no protocol, no `..`.
const internalPathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((v) => v.startsWith('/'), { message: 'Path must start with /' })
  .refine((v) => !v.includes('://'), { message: 'Path must be relative' })
  .refine((v) => !v.split('/').includes('..'), { message: 'Path cannot contain ..' });

const externalUrlSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    },
    { message: 'External URL must be a valid http(s) URL' },
  );

export const notificationDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('event'), eventId: z.string().min(1) }),
  z.object({ kind: z.literal('product'), productId: z.string().min(1) }),
  z.object({ kind: z.literal('tickets') }),
  z.object({ kind: z.literal('internal_path'), path: internalPathSchema }),
  z.object({ kind: z.literal('external_url'), url: externalUrlSchema }),
]);
export type NotificationDestination = z.infer<typeof notificationDestinationSchema>;

export const notificationListItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()),
  destination: notificationDestinationSchema.nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationListItem = z.infer<typeof notificationListItemSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationListItemSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationUnreadCountResponseSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type NotificationUnreadCountResponse = z.infer<typeof notificationUnreadCountResponseSchema>;

export const notificationMarkReadResponseSchema = z.object({
  id: z.string(),
  readAt: z.string(),
});
export type NotificationMarkReadResponse = z.infer<typeof notificationMarkReadResponseSchema>;
