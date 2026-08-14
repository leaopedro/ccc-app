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

/**
 * True when a block exists in EITHER direction between the two users.
 *
 * Used on the write paths (comment create, reaction). Filtering only the read
 * lists left a real harassment channel: someone who kept a postId in local state
 * could still comment under the post of a person who blocked them, and every
 * other member saw it — only the victim did not. The read filter alone made the
 * abuse invisible to the victim instead of preventing it.
 */
export const isBlockedBetween = async (a: string, b: string | null): Promise<boolean> => {
  if (!b || a === b) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
};
