import { prisma } from '@ccc/db';

/**
 * Every user id that must be invisible to `userId`, in BOTH directions:
 * people they blocked, and people who blocked them.
 *
 * The symmetry is the point. Filtering only "people I blocked" would leave the
 * blocked person free to keep reading and commenting on the blocker's posts,
 * which is exactly the harassment App Store guideline 1.2 asks us to prevent.
 *
 * Returns an empty array for an anonymous reader, so public feeds are unchanged
 * for people who are not logged in.
 */
export const blockedUserIdsFor = async (userId: string | null): Promise<string[]> => {
  if (!userId) return [];

  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  }
  return [...ids];
};
