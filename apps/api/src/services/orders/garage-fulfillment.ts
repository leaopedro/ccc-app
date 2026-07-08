import { GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import type { Prisma } from '@prisma/client';

export type GarageFulfillmentResult = {
  /** OrderItem.ids that produced (or already had) a GarageSpot row. */
  fulfilledOrderItemIds: string[];
  /** True when every OrderItem in the order is a virtual garage line; in that case
   *  the caller should set order.fulfillmentStatus = 'virtual_complete'. */
  orderIsAllVirtual: boolean;
};

/**
 * Iterates OrderItem rows for `orderId` and, for each row whose kind='product'
 * and whose linked variant's product is virtual + productType.name='garage_spot',
 * inserts one GarageSpot{ source: 'purchase', sourceOrderItemId, carId: null }.
 *
 * Post-pivot: no tier field. Free vs extra is derived from `source`.
 *
 * Idempotent via GarageSpot.sourceOrderItemId @unique: a replayed call hits a
 * Prisma P2002 which we swallow per-row.
 *
 * Caller MUST pass a TransactionClient bound to the same tx that flips
 * Order.status to 'paid' so the spot insert and the status flip are atomic.
 */
export async function fulfillGarageSpotsForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<GarageFulfillmentResult> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, userId: true },
  });

  const items = await tx.orderItem.findMany({
    where: { orderId, kind: 'product' },
    select: {
      id: true,
      variant: {
        select: {
          product: {
            select: {
              virtual: true,
              productType: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Count all OrderItem rows (any kind) so we can decide if the order is
  // entirely virtual. A mixed order with a ticket + a garage line is NOT all-virtual.
  const totalItemCount = await tx.orderItem.count({ where: { orderId } });

  const garageItems = items.filter(
    (it) =>
      it.variant?.product?.virtual === true &&
      it.variant.product.productType?.name === GARAGE_SPOT_PRODUCT_TYPE_NAME,
  );

  const fulfilledOrderItemIds: string[] = [];
  for (const item of garageItems) {
    try {
      await tx.garageSpot.create({
        data: {
          userId: order.userId,
          source: 'purchase',
          sourceOrderItemId: item.id,
          carId: null,
        },
      });
    } catch (err: unknown) {
      // Idempotency: replayed webhook hits the @unique on sourceOrderItemId.
      const code =
        err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined;
      if (code !== 'P2002') throw err;
    }
    fulfilledOrderItemIds.push(item.id);
  }

  const orderIsAllVirtual = totalItemCount > 0 && garageItems.length === totalItemCount;

  return { fulfilledOrderItemIds, orderIsAllVirtual };
}
