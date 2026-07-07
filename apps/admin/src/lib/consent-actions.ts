'use server';

import { consentListResponseSchema, consentRecordSchema } from '@jdm/shared';
import { PRIVACY_POLICY_VERSION } from '@jdm/shared/legal';
import { z } from 'zod';

import { apiFetch } from './api';

const withdrawResponseSchema = z.object({ withdrawn: z.boolean() });

export async function recordCookieConsent(acceptAnalytics: boolean): Promise<void> {
  const version = PRIVACY_POLICY_VERSION;
  const evidence = { source: 'admin_cookie_banner' };

  await apiFetch('/me/consents', {
    method: 'POST',
    body: JSON.stringify({ purpose: 'privacy_notice', version, evidence }),
    schema: consentRecordSchema,
  });

  if (acceptAnalytics) {
    await apiFetch('/me/consents', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'cookies_analytics', version, evidence }),
      schema: consentRecordSchema,
    });
  } else {
    await apiFetch('/me/consents/cookies_analytics', {
      method: 'DELETE',
      schema: withdrawResponseSchema,
    });
  }
}

export async function listMyConsents() {
  return apiFetch('/me/consents', { schema: consentListResponseSchema });
}
