import {
  consentListResponseSchema,
  consentRecordSchema,
  grantConsentBodySchema,
  type ConsentListResponse,
  type ConsentPurpose,
  type ConsentRecord,
  type GrantConsentBody,
} from '@jdm/shared';
import { z } from 'zod';

import { authedRequest } from './client';

export const grantConsent = (body: GrantConsentBody): Promise<ConsentRecord> => {
  const parsed = grantConsentBodySchema.parse(body);
  return authedRequest('/me/consents', consentRecordSchema, {
    method: 'POST',
    body: parsed,
  });
};

export const withdrawConsent = (purpose: ConsentPurpose): Promise<void> =>
  authedRequest(`/me/consents/${purpose}`, z.unknown(), { method: 'DELETE' }).then(() => undefined);

export const listConsents = (): Promise<ConsentListResponse> =>
  authedRequest('/me/consents', consentListResponseSchema);
