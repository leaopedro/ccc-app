/**
 * /me/billing — opens the Stripe Billing Portal immediately.
 *
 * Server component: calls POST /api/me/premium/billing-portal to obtain a
 * time-limited Stripe portal URL, then redirects the browser. Lives outside
 * the (authed) route group — `apiFetch` already redirects to /login?reauth=1
 * on a 401 (apps/admin/src/lib/api.ts:63).
 *
 * The bare catch below MUST rethrow the framework's redirect signal,
 * otherwise the /login?reauth=1 redirect that apiFetch fires on 401 gets
 * silently swallowed and the user lands back on /premium without ever
 * being prompted to reauth.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { apiFetch } from '~/lib/api';

const portalResponseSchema = z.object({ url: z.string().url() });

function isRedirectError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export default async function MeBillingPage() {
  let url: string;
  try {
    const data = await apiFetch('/api/me/premium/billing-portal', {
      method: 'POST',
      body: JSON.stringify({}),
      schema: portalResponseSchema,
    });
    url = data.url;
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect('/premium');
  }
  redirect(url);
}
