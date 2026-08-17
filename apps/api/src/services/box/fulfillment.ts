import { prisma } from '@ccc/db';
import type {
  AdminBoxMonthlyListResponse,
  AdminBoxPickingResponse,
  PickingRow,
} from '@ccc/shared/admin-box';
import type { BoxFulfillmentStatus } from '@ccc/shared/box';

import { recordAudit } from '../admin-audit.js';

import { enqueueBoxNotification } from './notifications.js';

// Forward-only. delivered/cancelled are terminal. Predecessor of each target.
const PREDECESSOR: Record<'packed' | 'shipped' | 'delivered', BoxFulfillmentStatus> = {
  packed: 'unfulfilled',
  shipped: 'packed',
  delivered: 'shipped',
};

export type BoxAdvanceInput = {
  boxId: string;
  to: 'packed' | 'shipped' | 'delivered';
  actorId: string;
};
export type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'order_not_paid' }
  | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string };

// Thrown inside the advance transaction to abort (and roll back the box update)
// when a concurrent refund flips the linked Order away from `paid` mid-flight.
class OrderNotPaidAbort extends Error {}

export const advanceBoxFulfillment = async (input: BoxAdvanceInput): Promise<BoxAdvanceResult> => {
  const box = await prisma.monthlyBox.findUnique({
    where: { id: input.boxId },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      orderId: true,
      order: { select: { status: true } },
      membership: { select: { garage: { select: { userId: true } } } },
    },
  });
  if (!box) return { kind: 'not_found' };
  if (box.status !== 'ready') return { kind: 'not_ready' };
  // An Order-backed box must still be paid. A refund/dispute webhook can flip the
  // linked Order to `refunded`/`failed` while the box stays `ready`; do not fulfill
  // (nor overwrite the order's fulfillmentStatus) in that case. Budget-only boxes
  // (no Order) have no payment to void, so they advance freely. Mirrors the store
  // fulfillment guard (`services/store/orders.ts`).
  if (box.orderId && box.order?.status !== 'paid') return { kind: 'order_not_paid' };

  const from = box.fulfillmentStatus as BoxFulfillmentStatus;
  const predecessor = PREDECESSOR[input.to];
  if (from !== predecessor) {
    return { kind: 'invalid_transition', from, to: input.to };
  }

  // Race-safe: only the caller that still sees `predecessor` wins. Sync the
  // Order in the same transaction when the box is Order-backed, guarding on
  // status:'paid' so a refund landing mid-flight aborts the whole advance.
  // Never touch Order.status — that flips to paid only from a verified webhook.
  let outcome: 'ok' | 'stale';
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const updated = await tx.monthlyBox.updateMany({
        where: { id: box.id, status: 'ready', fulfillmentStatus: predecessor },
        data: { fulfillmentStatus: input.to },
      });
      if (updated.count === 0) return 'stale';
      if (box.orderId) {
        const order = await tx.order.updateMany({
          where: { id: box.orderId, status: 'paid' },
          data: { fulfillmentStatus: input.to },
        });
        if (order.count === 0) throw new OrderNotPaidAbort();
      }
      await recordAudit(
        {
          actorId: input.actorId,
          action: 'box.fulfillment.advance',
          entityType: 'monthly_box',
          entityId: box.id,
          metadata: { from: predecessor, to: input.to, orderId: box.orderId },
        },
        tx,
      );
      if (input.to === 'shipped' || input.to === 'delivered') {
        await enqueueBoxNotification(tx, {
          userId: box.membership.garage.userId,
          boxId: box.id,
          kind: `box.${input.to}`,
        });
      }
      return 'ok';
    });
  } catch (e) {
    if (e instanceof OrderNotPaidAbort) return { kind: 'order_not_paid' };
    throw e;
  }

  if (outcome === 'stale') {
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

const EMPTY_COUNTS = (): AdminBoxMonthlyListResponse['counts'] => ({
  unfulfilled: 0,
  packed: 0,
  shipped: 0,
  delivered: 0,
  cancelled: 0,
});

const distinctCyclesDesc = async (): Promise<string[]> => {
  const rows = await prisma.monthlyBox.findMany({
    distinct: ['cycleKey'],
    select: { cycleKey: true },
    orderBy: { cycleKey: 'desc' },
  });
  return rows.map((r) => r.cycleKey);
};

export const listAdminBoxes = async (
  cycleKeyInput?: string,
): Promise<AdminBoxMonthlyListResponse> => {
  const availableCycles = await distinctCyclesDesc();
  const cycleKey = cycleKeyInput ?? availableCycles[0] ?? '';

  const rows = await prisma.monthlyBox.findMany({
    where: { cycleKey },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      chargeCents: true,
      currency: true,
      fulfillmentStatus: true,
      order: { select: { status: true } },
      membership: {
        select: { garage: { select: { user: { select: { name: true, email: true } } } } },
      },
    },
  });

  const counts = EMPTY_COUNTS();
  const boxes = rows.map((b) => {
    const fulfillmentStatus = b.fulfillmentStatus as BoxFulfillmentStatus;
    if (b.status === 'ready') counts[fulfillmentStatus] += 1;
    return {
      id: b.id,
      memberName: b.membership.garage.user.name,
      memberEmail: b.membership.garage.user.email,
      status: b.status,
      chargeCents: b.chargeCents,
      currency: b.currency,
      fulfillmentStatus,
      orderStatus: b.order?.status ?? null,
    };
  });

  return { cycleKey, availableCycles, counts, boxes };
};

type PickingAccumulator = { title: string; totalQuantity: number; boxes: Set<string> };

const foldRows = (acc: Map<string, PickingAccumulator>): PickingRow[] =>
  Array.from(acc.entries()).map(([refId, v]) => ({
    refId,
    title: v.title,
    totalQuantity: v.totalQuantity,
    boxCount: v.boxes.size,
  }));

export const getAdminBoxPicking = async (
  cycleKeyInput?: string,
): Promise<AdminBoxPickingResponse> => {
  const availableCycles = await distinctCyclesDesc();
  const cycleKey = cycleKeyInput ?? availableCycles[0] ?? '';

  const readyBoxes = await prisma.monthlyBox.findMany({
    where: { cycleKey, status: 'ready' },
    select: {
      id: true,
      items: {
        where: { included: true },
        select: { catalogItemId: true, titleSnapshot: true, quantity: true },
      },
      partnerItems: {
        where: { included: true },
        select: { partnerModuleId: true, nameSnapshot: true, quantity: true },
      },
    },
  });

  const items = new Map<string, PickingAccumulator>();
  const partnerItems = new Map<string, PickingAccumulator>();
  for (const box of readyBoxes) {
    for (const line of box.items) {
      const entry = items.get(line.catalogItemId) ?? {
        title: line.titleSnapshot,
        totalQuantity: 0,
        boxes: new Set<string>(),
      };
      entry.totalQuantity += line.quantity;
      entry.boxes.add(box.id);
      items.set(line.catalogItemId, entry);
    }
    for (const line of box.partnerItems) {
      const entry = partnerItems.get(line.partnerModuleId) ?? {
        title: line.nameSnapshot,
        totalQuantity: 0,
        boxes: new Set<string>(),
      };
      entry.totalQuantity += line.quantity;
      entry.boxes.add(box.id);
      partnerItems.set(line.partnerModuleId, entry);
    }
  }

  return { cycleKey, items: foldRows(items), partnerItems: foldRows(partnerItems) };
};
