import { z } from 'zod';

import { authedRequest } from './client';

const deleteAccountResponseSchema = z.object({ status: z.string() });
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

// Requests account deletion. The backend disables the account immediately and
// schedules anonymization after a grace period (see account-deletion worker).
export const deleteAccount = (): Promise<DeleteAccountResponse> =>
  authedRequest('/me/account/delete', deleteAccountResponseSchema, { method: 'POST' });
