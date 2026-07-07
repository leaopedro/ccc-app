import { z } from 'zod';

/**
 * Body for POST /admin/users/:id/garage/xp-adjustment.
 * Per §C7: delta signed int [-10000, 10000] non-zero; reason 3..120 chars trimmed.
 * Per §C8: admin_adjustment is the ONLY awarder reason accepting signed delta.
 */
export const adminXpAdjustmentSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((n) => n !== 0, { message: 'delta cannot be zero' }),
  reason: z.string().trim().min(3).max(120),
});

export type AdminXpAdjustmentInput = z.infer<typeof adminXpAdjustmentSchema>;
