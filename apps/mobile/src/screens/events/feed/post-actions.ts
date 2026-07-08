import type { UserRoleName } from '@ccc/shared/auth';

export const canModerateFeedPost = (role: UserRoleName): boolean =>
  role === 'organizer' || role === 'admin';

export const resolveFeedPostActionVisibility = (
  isOwn: boolean,
  canModerate: boolean,
): { showEdit: boolean; showDelete: boolean } => ({
  showEdit: isOwn,
  showDelete: isOwn || canModerate,
});
