import type { BoxHistory } from '@ccc/shared/box';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/**
 * Garage-scoped box history, newest first. The list itself is not gated on an
 * active membership: a member who cancelled still sees what they received.
 *
 * `currentMembershipId` is the answer `loadEligibleMembership` gave for this
 * user, or null when no membership qualifies. It decides which row is flagged
 * `current`, and it has to, because position 0 is not the same question.
 * A garage can hold two eligible memberships, `open.ts` writes
 * `cycleStart = currentPeriodStart`, so two subscriptions starting the same day
 * produce two boxes that tie on `cycleStart`. Flagging position 0 would then
 * point at the sibling's box while `GET /me/box` returns the billing one, and
 * the two screens would disagree about which box is current.
 */
export const listBoxHistory = async (
  uploads: Uploads,
  garageId: string,
  currentMembershipId: string | null,
): Promise<BoxHistory> => {
  const boxes = await prisma.monthlyBox.findMany({
    where: { garageId },
    // Garage-scoped, so two memberships of the same garage can both have a box
    // in the list, and `cycleStart` alone is not a total order across them: two
    // subscriptions starting the same day tie. Tie-break down to `id` so the
    // list order itself is stable between calls.
    orderBy: [{ cycleStart: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: {
      items: {
        where: { included: true },
        take: 3,
        include: { catalogItem: { select: { imageObjectKey: true } } },
      },
    },
  });
  // Rows are already ordered newest first, so the first match is that
  // membership's newest box — the same row `GET /me/box` resolves, which reads
  // `monthlyBox.findFirst({ membershipId }, cycleStart desc)`. Null when the
  // member has no eligible membership, or has one with no box yet: nothing is
  // current then, matching the 403/404 the box endpoints answer.
  const currentBoxId =
    currentMembershipId === null
      ? null
      : (boxes.find((b) => b.membershipId === currentMembershipId)?.id ?? null);

  return boxes.map((b) => ({
    id: b.id,
    cycleKey: b.cycleKey,
    cycleStart: b.cycleStart.toISOString(),
    status: b.status,
    chargeCents: b.chargeCents,
    thumbnails: b.items
      .map((i) => i.catalogItem?.imageObjectKey)
      .filter((k): k is string => Boolean(k))
      .map((k) => uploads.buildPublicUrl(k)),
    current: b.id === currentBoxId,
  }));
};
