import {
  publicProfileSchema,
  type PublicProfile,
  type UpdateProfileInput,
} from '@ccc/shared/profile';
import { profileStatusSchema, type ProfileStatus } from '@ccc/shared/profile-status';

import { authedRequest } from './client';

export const getProfile = (): Promise<PublicProfile> => authedRequest('/me', publicProfileSchema);

// No client-side updateProfileSchema.parse() here: the edit form's resolver
// (edit-profile-form-schema.ts) already validates cpf/phone against the same
// checksum rules with PT-BR field messages before this is ever called.
// Parsing again here would throw a ZodError with no field context for any
// gap between the two (e.g. a schema change deployed to only one side), and
// that error is not an ApiError, so the caller's catch block can only show
// it as a generic banner. Send the input as-is and let the server's 400 be
// the safety net for that gap instead.
export const updateProfile = (input: UpdateProfileInput): Promise<PublicProfile> =>
  authedRequest('/me', publicProfileSchema, { method: 'PATCH', body: input });

export const getProfileStatus = (): Promise<ProfileStatus> =>
  authedRequest('/me/profile-status', profileStatusSchema);
