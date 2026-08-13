import type { UserRoleName } from '@ccc/shared/auth';

export const canModerateFeedPost = (role: UserRoleName): boolean =>
  role === 'organizer' || role === 'admin';

/**
 * Which actions a post shows.
 *
 * Report and block exist because App Store guideline 1.2 requires a user to be
 * able to flag objectionable content and to block another person. They are
 * deliberately hidden on your OWN post: reporting yourself is noise, and
 * blocking yourself is refused by the API with 422.
 *
 * Both must be reachable from a VISIBLE control. Hiding them behind a long-press
 * with no affordance is a common rejection reason, because the reviewer has to
 * find them.
 */
export const resolveFeedPostActionVisibility = (
  isOwn: boolean,
  canModerate: boolean,
): { showEdit: boolean; showDelete: boolean; showReport: boolean; showBlock: boolean } => ({
  showEdit: isOwn,
  showDelete: isOwn || canModerate,
  showReport: !isOwn,
  showBlock: !isOwn,
});
