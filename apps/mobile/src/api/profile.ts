import {
  publicProfileSchema,
  type PublicProfile,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@jdm/shared/profile';

import { authedRequest } from './client';

export const getProfile = (): Promise<PublicProfile> => authedRequest('/me', publicProfileSchema);

export const updateProfile = (input: UpdateProfileInput): Promise<PublicProfile> => {
  const parsed = updateProfileSchema.parse(input);
  return authedRequest('/me', publicProfileSchema, { method: 'PATCH', body: parsed });
};
