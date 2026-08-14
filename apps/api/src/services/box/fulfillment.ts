import { prisma } from '@ccc/db';
import type { BoxFulfillmentStatus } from '@ccc/shared/box';

// Forward-only. delivered/cancelled are terminal. Predecessor of each target.
const PREDECESSOR: Record<'packed' | 'shipped' | 'delivered', BoxFulfillmentStatus> = {
  packed: 'unfulfilled',
  shipped: 'packed',
  delivered: 'shipped',
};

export type BoxAdvanceInput = { boxId: string; to: 'packed' | 'shipped' | 'delivered' };
export type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string };

export const advanceBoxFulfillment = async (input: BoxAdvanceInput): Promise<BoxAdvanceResult> => {
  const box = await prisma.monthlyBox.findUnique({
    where: { id: input.boxId },
    select: { id: true, status: true, fulfillmentStatus: true, orderId: true },
  });
  if (!box) return { kind: 'not_found' };
  if (box.status !== 'ready') return { kind: 'not_ready' };

  const from = box.fulfillmentStatus as BoxFulfillmentStatus;
  const predecessor = PREDECESSOR[input.to];
  if (from !== predecessor) {
    return { kind: 'invalid_transition', from, to: input.to };
  }

  // Race-safe: only the caller that still sees `predecessor` wins. Sync the
  // Order in the same transaction when the box is Order-backed. Never touch
  // Order.status — that flips to paid only from a verified webhook.
  const advanced = await prisma.$transaction(async (tx) => {
    const updated = await tx.monthlyBox.updateMany({
      where: { id: box.id, status: 'ready', fulfillmentStatus: predecessor },
      data: { fulfillmentStatus: input.to },
    });
    if (updated.count === 0) return false;
    if (box.orderId) {
      await tx.order.update({
        where: { id: box.orderId },
        data: { fulfillmentStatus: input.to },
      });
    }
    return true;
  });

  if (!advanced) {
    const fresh = await prisma.monthlyBox.findUnique({
      where: { id: box.id },
      select: { fulfillmentStatus: true },
    });
    return {
      kind: 'invalid_transition',
      from: (fresh?.fulfillmentStatus ?? from) as BoxFulfillmentStatus,
      to: input.to,
    };
  }
  return { kind: 'ok', fulfillmentStatus: input.to };
};
