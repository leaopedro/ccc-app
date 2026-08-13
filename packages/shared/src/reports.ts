import { z } from 'zod';

/**
 * Free-text reason. Deliberately not an enum of canned categories: App Review
 * only requires that a report can be filed, and a category list is a product
 * decision we have not made. The admin moderation queue reads the raw text.
 */
export const reportCreateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export type ReportCreateRequest = z.infer<typeof reportCreateRequestSchema>;

export const reportCreateResponseSchema = z.object({
  reported: z.literal(true),
  /** True when this report crossed the threshold and hid the target. */
  autoHidden: z.boolean(),
});

export type ReportCreateResponse = z.infer<typeof reportCreateResponseSchema>;
