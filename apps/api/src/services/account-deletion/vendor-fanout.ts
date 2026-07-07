import { prisma } from '@jdm/db';

import type { Env } from '../../env.js';
import type { StripeClient } from '../stripe/index.js';

import type { StepEntry } from './anonymize.js';

export const runVendorFanout = async (
  userId: string,
  _stripe: StripeClient,
  _env: Env,
): Promise<StepEntry[]> => {
  const steps: StepEntry[] = [];
  const now = () => new Date().toISOString();

  // Stripe: no direct customer delete in MVP — orders reference providerRef, not customerId
  // Log as skipped; a future migration can map customerId and call stripe.customers.del()
  const hasStripeOrders = await prisma.order.findFirst({
    where: { userId, provider: 'stripe', providerRef: { not: null } },
    select: { id: true },
  });
  steps.push({
    step: 'stripe_customer_detach',
    status: hasStripeOrders ? 'skipped' : 'skipped',
    at: now(),
  });

  // Expo push tokens: deleted by anonymize step (deviceToken.deleteMany)
  steps.push({ step: 'expo_token_cleanup', status: 'ok', at: now() });

  // Sentry: no self-serve user-deletion API; log for manual review
  steps.push({ step: 'sentry_user_delete', status: 'skipped', at: now() });

  // Resend: no stored contact list in MVP
  steps.push({ step: 'resend_contact_remove', status: 'skipped', at: now() });

  return steps;
};
