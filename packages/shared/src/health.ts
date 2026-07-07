import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  sha: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
