// F8.18 — premium status API helper.
// Consumes GET /api/me/premium/status (spec §8.3 / chunk F8.11).
// premiumStatusSchema is defined in packages/shared/src/premium.ts (F8.11).

import { premiumStatusSchema } from '@jdm/shared/premium';
import type { z } from 'zod';

import { authedRequest } from '~/api/client';

export type PremiumStatusResponse = z.infer<typeof premiumStatusSchema>;

export const getPremiumStatus = (): Promise<PremiumStatusResponse> =>
  authedRequest('/api/me/premium/status', premiumStatusSchema);
