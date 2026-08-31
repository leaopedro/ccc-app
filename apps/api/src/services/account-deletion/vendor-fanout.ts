import { prisma } from '@ccc/db';

import type { Env } from '../../env.js';
import type { StripeClient } from '../stripe/index.js';

import type { StepEntry } from './anonymize.js';

// Runs before anonymizeUser (see workers/account-deletion.ts), so the user row
// still carries the real email here — needed to locate the Stripe customer.
export const runVendorFanout = async (
  userId: string,
  stripe: StripeClient,
  _env: Env,
): Promise<StepEntry[]> => {
  const steps: StepEntry[] = [];
  const now = () => new Date().toISOString();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, status: true },
  });

  // Stripe: "forget" the customer(s) tied to this email. Customers are deduped
  // by email (findOrCreateCustomer), and no customerId is stored locally, so we
  // look them up by email while it is still present. Guarded so a Stripe error
  // never blocks local anonymization.
  try {
    const alreadyAnonymized =
      !user || user.status === 'anonymized' || user.email.endsWith('@removed.local');
    if (alreadyAnonymized) {
      steps.push({ step: 'stripe_customer_delete', status: 'skipped', at: now() });
    } else {
      const deleted = await stripe.deleteCustomersByEmail(user.email);
      steps.push({
        step: 'stripe_customer_delete',
        status: deleted > 0 ? 'ok' : 'skipped',
        at: now(),
      });
    }
  } catch (err) {
    steps.push({
      step: 'stripe_customer_delete',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      at: now(),
    });
  }

  // Expo push tokens: deleted by anonymize step (deviceToken.deleteMany)
  steps.push({ step: 'expo_token_cleanup', status: 'ok', at: now() });

  // Sentry: no user-identifying data is stored server-side (email is hashed at
  // ingest and Sentry.setUser is never called), and Sentry exposes no per-user
  // deletion API. Nothing to purge.
  steps.push({ step: 'sentry_user_delete', status: 'skipped', at: now() });

  // Resend: transactional-only, no stored audience/contact list. Nothing to purge.
  steps.push({ step: 'resend_contact_remove', status: 'skipped', at: now() });

  // AbacatePay: named Operador in the published privacy policy, so it must
  // appear in the deletion log even when the answer is "nothing to purge".
  // The client (services/abacatepay/index.ts) exposes createPixBilling,
  // getPixBilling and verifyWebhookSignature — no deletion API exists, and
  // AbacatePay documents none. We send no CPF (PixBillingCustomer.taxId has no
  // caller today), so what the vendor holds for a Pix charge is the charge
  // itself, retained by them under their own fiscal obligation. Recorded as
  // `skipped` with this reason rather than omitted.
  steps.push({ step: 'abacatepay_customer_delete', status: 'skipped', at: now() });

  return steps;
};
