import { z } from 'zod';

export const devicePlatformSchema = z.enum(['ios', 'android']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// Expo tokens are typically `ExponentPushToken[xxxx...]`. We do not parse them
// here; Expo is the source of truth. The 200-char ceiling matches the DB
// column.
export const expoPushTokenSchema = z.string().min(10).max(200);

export const registerDeviceTokenRequestSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  platform: devicePlatformSchema,
});
export type RegisterDeviceTokenRequest = z.infer<typeof registerDeviceTokenRequestSchema>;

export const registerDeviceTokenResponseSchema = z.object({
  ok: z.literal(true),
});
export type RegisterDeviceTokenResponse = z.infer<typeof registerDeviceTokenResponseSchema>;

export const pushKindSchema = z.enum([
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
  'broadcast',
]);
export type PushKind = z.infer<typeof pushKindSchema>;

// Route key embedded in push payload `data.route`. Mobile uses it to decide
// where to land first when the app is opened from a push.
export const pushRouteSchema = z.enum(['notifications']);
export type PushRoute = z.infer<typeof pushRouteSchema>;
