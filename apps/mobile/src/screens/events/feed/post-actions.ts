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
  /**
   * Whether there is a signed-in user. Load-bearing: guest browsing is
   * supported, and both handlers hit authenticated routes, so showing the
   * controls to a visitor renders the 1.2 feature visibly broken — the tap ends
   * in a generic error alert.
   */
  isAuthenticated = false,
): { showEdit: boolean; showDelete: boolean; showReport: boolean; showBlock: boolean } => ({
  showEdit: isOwn,
  showDelete: isOwn || canModerate,
  showReport: isAuthenticated && !isOwn,
  showBlock: isAuthenticated && !isOwn,
});
