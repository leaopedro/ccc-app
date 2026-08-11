import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { prisma } from '@ccc/db';

import { isFreeShippingCep } from './charge.js';
import { recalcBoxTotals } from './recalc.js';
import { reserveCycleStock } from './stock.js';

export type ConfirmResult =
  | { kind: 'ok'; boxId: string }
  | { kind: 'not_found' }
  | { kind: 'not_open' }
  | { kind: 'bad_address' };

type CepRange = { from: string; to: string };

export const confirmBox = async (args: {
  userId: string;
  membershipId: string;
  shippingAddressId: string;
  autoSendOptIn: boolean;
}): Promise<ConfirmResult> => {
  return prisma.$transaction(async (tx) => {
    // Step 1: find the latest box id for this membership.
    const boxRef = await tx.monthlyBox.findFirst({
      where: { membershipId: args.membershipId },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, garageId: true },
    });
    if (!boxRef) return { kind: 'not_found' };

    // Step 2: lock the Garage row — same resource the cutoff worker locks — so all three paths serialize.
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRef.garageId} FOR UPDATE`;

    // Step 3: re-read full box under the lock; re-check status.
    const box = await tx.monthlyBox.findUnique({
      where: { id: boxRef.id },
      include: { items: true },
    });
    if (!box) return { kind: 'not_found' };
    if (box.status !== 'open') return { kind: 'not_open' };

    // Box locks at the cutoff instant even if the cron worker has not processed it yet.
    if (box.cutoffAt <= new Date()) return { kind: 'not_open' };

    const address = await tx.shippingAddress.findUnique({ where: { id: args.shippingAddressId } });
    if (!address || address.userId !== args.userId) return { kind: 'bad_address' };

    const settings = await tx.boxSettings.findUniqueOrThrow({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
    });
    const ranges = (settings.freeShippingCepRanges as CepRange[]) ?? [];
    const shippingCents = isFreeShippingCep(address.postalCode, ranges)
      ? 0
      : settings.shippingFeeCents;

    await tx.monthlyBox.update({
      where: { id: box.id },
      data: {
        shippingAddressId: address.id,
        shippingCents,
        autoSendOptIn: args.autoSendOptIn,
      },
    });

    // Reserve stock per included catalog line; drop sold-out lines.
    for (const line of box.items.filter((i) => i.included)) {
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

    await recalcBoxTotals(tx, box.id);
    const priced = await tx.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });

    if (priced.chargeCents === 0) {
      await tx.monthlyBox.update({ where: { id: box.id }, data: { status: 'ready' } });
      return { kind: 'ok', boxId: box.id };
    }

    const order = await tx.order.create({
      data: {
        userId: args.userId,
        kind: 'box',
        amountCents: priced.chargeCents,
        baseAmountCents: priced.chargeCents,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: priced.currency,
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        shippingAddressId: address.id,
        shippingCents: priced.shippingCents,
      },
    });
    await tx.monthlyBox.update({
      where: { id: box.id },
      data: { status: 'awaiting_payment', orderId: order.id },
    });
    return { kind: 'ok', boxId: box.id };
  });
};
