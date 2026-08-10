import { z } from 'zod';

export const FRIDGE_DEVICE_ID = 'fridge-01' as const;

export const fridgeUnlockBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(3).max(32).optional(),
  })
  .strict();

export type FridgeUnlockBody = z.infer<typeof fridgeUnlockBodySchema>;

export const fridgeUnlockResponseSchema = z.object({
  status: z.literal('sent'),
  deviceId: z.string().min(1),
});

export type FridgeUnlockResponse = z.infer<typeof fridgeUnlockResponseSchema>;
