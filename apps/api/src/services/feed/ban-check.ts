import { prisma } from '@jdm/db';
import type { BanScope } from '@jdm/shared/feed';

export async function checkFeedBan(eventId: string, userId: string): Promise<BanScope | null> {
  const bans = await prisma.feedBan.findMany({
    where: { eventId, userId },
    select: { scope: true },
  });

  if (bans.length === 0) return null;
  if (bans.some((b) => b.scope === 'view')) return 'view';
  return 'post';
}
