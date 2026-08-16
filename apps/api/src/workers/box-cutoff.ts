import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';

import { sendBoxPush } from '../services/box/notifications.js';
import { recalcBoxTotals } from '../services/box/recalc.js';
import { releaseCycleStock, reserveCycleStock } from '../services/box/stock.js';
import type { PushSender } from '../services/push/index.js';

type Deps = { log?: FastifyBaseLogger; sender?: PushSender };

/** Trim a box to budget-only in-tx: drop all partners, LIFO-trim catalog, reserve stock. */
const resolveBudgetOnly = async (
  tx: Prisma.TransactionClient,
  boxId: string,
): Promise<'ready' | 'skipped'> => {
  const box = await tx.monthlyBox.findUniqueOrThrow({
    where: { id: boxId },
    include: { items: true, partnerItems: true },
  });

  // Budget-only cannot cover shipping. A box outside the free-shipping region
  // (shippingCents > 0) is skipped, never shipped unpaid. This covers both
  // awaiting_payment boxes and open+autoSend boxes: the preferences endpoint
  // computes shippingCents when it stores the auto-send address, so a non-free
  // region auto-send box arrives here with shippingCents > 0 and is skipped.
  if (box.shippingCents > 0) {
    await tx.monthlyBox.update({ where: { id: boxId }, data: { status: 'skipped' } });
    return 'skipped';
  }

  // Drop all partner modules (extras are never auto-sent).
  for (const p of box.partnerItems.filter((i) => i.included)) {
    await tx.monthlyBoxPartnerItem.update({
      where: { id: p.id },
      data: { included: false, droppedAt: new Date(), dropReason: 'cutoff_budget_only' },
    });
  }

  // LIFO order: newest addedAt first.
  const items = [...box.items.filter((i) => i.included)].sort(
    (a, b) => b.addedAt.getTime() - a.addedAt.getTime(),
  );
  let total = items.reduce((s, i) => s + i.subtotalCents, 0);
  for (const line of items) {
    if (total <= box.budgetCentsSnapshot) break;
    // Trim this line unit by unit.
    let qty = line.quantity;
    while (qty > 0 && total > box.budgetCentsSnapshot) {
      qty -= 1;
      total -= line.unitPriceCents;
    }
    if (qty === 0) {
      await tx.monthlyBoxItem.update({
        where: { id: line.id },
        data: {
          included: false,
          quantity: 0,
          subtotalCents: 0,
          droppedAt: new Date(),
          dropReason: 'cutoff_budget_only',
        },
      });
    } else {
      await tx.monthlyBoxItem.update({
        where: { id: line.id },
        data: { quantity: qty, subtotalCents: qty * line.unitPriceCents },
      });
    }
  }

  // Reserve stock for surviving lines; drop sold-out.
  const survivors = await tx.monthlyBoxItem.findMany({ where: { boxId, included: true } });
  for (const line of survivors) {
    const item = await tx.boxCatalogItem.findUniqueOrThrow({ where: { id: line.catalogItemId } });
    const ok = await reserveCycleStock(tx, {
      catalogItemId: line.catalogItemId,
      cycleKey: box.cycleKey,
      capacity: item.stockPerCycle,
      quantity: line.quantity,
    });
    if (!ok) {
      await tx.monthlyBoxItem.update({
        where: { id: line.id },
        data: { included: false, droppedAt: new Date(), dropReason: 'out_of_stock' },
      });
    }
  }

  await recalcBoxTotals(tx, boxId);
  const remaining = await tx.monthlyBoxItem.count({ where: { boxId, included: true } });
  const status = remaining === 0 ? 'skipped' : 'ready';
  await tx.monthlyBox.update({ where: { id: boxId }, data: { status } });
  return status;
};

export const runBoxCutoffTick = async (deps: Deps): Promise<void> => {
  const now = new Date();
  const due = await prisma.monthlyBox.findMany({
    where: { status: { in: ['open', 'awaiting_payment'] }, cutoffAt: { lte: now } },
    select: { id: true, garageId: true },
    take: 50,
  });

  for (const { id, garageId } of due) {
    try {
      const notify = await prisma.$transaction(async (tx): Promise<{ userId: string } | null> => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
        const box = await tx.monthlyBox.findUnique({
          where: { id },
          include: {
            items: true,
            membership: { select: { garage: { select: { userId: true } } } },
          },
        });
        if (!box) return null;
        if (box.status !== 'open' && box.status !== 'awaiting_payment') return null; // re-gate

        const hasItems = box.items.some((i) => i.included);
        const userId = box.membership.garage.userId;

        if (box.status === 'open') {
          // The autoSendOptIn+shippingAddressId precondition is set by the Fase 3
          // mobile builder (member toggles auto-send and picks an address while the
          // box is still open). No Fase 2 endpoint sets these while open by design;
          // this branch is intentionally ahead of its Fase 3 consumer.
          if (!hasItems || !box.autoSendOptIn || !box.shippingAddressId) {
            await tx.monthlyBox.update({ where: { id }, data: { status: 'skipped' } });
            return null;
          }
          const status = await resolveBudgetOnly(tx, id);
          return status === 'ready' ? { userId } : null;
        }

        // awaiting_payment: cancel the pending Order unless it already settled.
        // An awaiting_payment box always has an orderId in practice (confirm sets
        // it); a null orderId simply falls through to resolveBudgetOnly with no
        // order to cancel.
        if (box.orderId) {
          const cancelled = await tx.order.updateMany({
            where: { id: box.orderId, status: 'pending' },
            data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
          });
          if (cancelled.count === 0) {
            // Order was not pending. Distinguish paid from other terminal states.
            const ord = await tx.order.findUnique({
              where: { id: box.orderId },
              select: { status: true },
            });
            if (ord?.status === 'paid') {
              // Pix already settled: leave for the paid path. Its reservation must
              // stand — do NOT release here. box.paid already fired at settle;
              // do not double-notify here.
              return null;
            }
            // Order is cancelled/failed/expired/refunded via another path.
            // Fall through: release reservations and resolve budget-only so the
            // box is not permanently stuck in awaiting_payment.
          }
          await tx.monthlyBox.update({ where: { id }, data: { orderId: null } });
          // Release the confirm-time reservations for this box's included lines.
          // confirm.ts reserved stock when the box entered awaiting_payment;
          // resolveBudgetOnly re-reserves the survivors below, so releasing first
          // returns the ledger to baseline and avoids a permanent double-reserve.
          for (const line of box.items.filter((i) => i.included)) {
            await releaseCycleStock(tx, {
              catalogItemId: line.catalogItemId,
              cycleKey: box.cycleKey,
              quantity: line.quantity,
            });
          }
        }
        const status = await resolveBudgetOnly(tx, id);
        return status === 'ready' ? { userId } : null;
      });

      if (notify && deps.sender) {
        try {
          await sendBoxPush(deps.sender, { userId: notify.userId, boxId: id, kind: 'box.ready' });
        } catch (err) {
          deps.log?.error({ err, boxId: id }, '[box-cutoff] box.ready push failed');
        }
      }
    } catch (err) {
      deps.log?.error({ err, boxId: id }, '[box-cutoff] failed to resolve box');
    }
  }
};

export const startBoxCutoffWorker = (deps: Deps): { stop: () => void } => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runBoxCutoffTick(deps);
    } catch (err) {
      deps.log?.error({ err }, '[box-cutoff] tick error');
    }
  });

  return {
    stop: () => {
      void task.stop();
    },
  };
};
