import {
  publicProfileSchema,
  type PublicProfile,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@ccc/shared/profile';
import { profileStatusSchema, type ProfileStatus } from '@ccc/shared/profile-status';

import { authedRequest } from './client';

export const getProfile = (): Promise<PublicProfile> => authedRequest('/me', publicProfileSchema);

export const updateProfile = (input: UpdateProfileInput): Promise<PublicProfile> => {
  const parsed = updateProfileSchema.parse(input);
  return authedRequest('/me', publicProfileSchema, { method: 'PATCH', body: parsed });
};

export const getProfileStatus = (): Promise<ProfileStatus> =>
  authedRequest('/me/profile-status', profileStatusSchema);
