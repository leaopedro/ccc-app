import type { UserRoleName } from '@jdm/shared/auth';

export const canModerateFeedPost = (role: UserRoleName): boolean =>
  role === 'organizer' || role === 'admin';

export const resolveFeedPostActionVisibility = (
  isOwn: boolean,
  canModerate: boolean,
): { showEdit: boolean; showDelete: boolean } => ({
  showEdit: isOwn,
  showDelete: isOwn || canModerate,
});
