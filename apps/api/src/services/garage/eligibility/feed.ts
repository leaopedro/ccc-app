import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Compute the community/feed-surface badges a user is eligible for AFTER
 * `feedPost.id` has just been created. Caller is responsible for running
 * this inside the same transaction as the create.
 *
 * Phase 1 ships COM-001 only. COM-002 (multi-event posting) + COM-003
 * (engagement spike) are deferred per plan §18 main body — the eligibility
 * heuristics for those need product input before shipping.
 *
 * Codes:
 *   - COM-001 — "Voz da Comunidade" : count(feedPost authored by user) >= 1
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
  _postId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const postCount = await tx.feedPost.count({
    where: { authorUserId: userId },
  });
  if (postCount >= 1) codes.push('COM-001');

  return codes;
};
