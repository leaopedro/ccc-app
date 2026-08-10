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
    const box = await tx.monthlyBox.findFirst({
      where: { membershipId: args.membershipId },
      orderBy: { cycleStart: 'desc' },
      include: { items: true },
    });
    if (!box) return { kind: 'not_found' };
    if (box.status !== 'open') return { kind: 'not_open' };

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
