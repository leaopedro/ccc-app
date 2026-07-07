import { prisma } from '@jdm/db';
import type { MyTicketPickupVoucher } from '@jdm/shared/tickets';

const mapAttributes = (raw: unknown): Record<string, string> | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
};

export const getPickupVouchersByTicket = async (
  ticketIds: string[],
): Promise<Map<string, MyTicketPickupVoucher[]>> => {
  const result = new Map<string, MyTicketPickupVoucher[]>();
  if (ticketIds.length === 0) return result;

  const rows = await prisma.pickupVoucher.findMany({
    where: { ticketId: { in: ticketIds } },
    include: {
      orderItem: {
        select: {
          variant: {
            select: {
              name: true,
              sku: true,
              attributes: true,
              product: { select: { title: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  for (const v of rows) {
    const entry: MyTicketPickupVoucher = {
      id: v.id,
      orderId: v.orderId,
      orderShortId: v.orderId.slice(-8).toUpperCase(),
      code: v.code,
      status: v.status,
      usedAt: v.usedAt?.toISOString() ?? null,
      productTitle: v.orderItem.variant?.product.title ?? null,
      variantName: v.orderItem.variant?.name ?? null,
      variantSku: v.orderItem.variant?.sku ?? null,
      variantAttributes: mapAttributes(v.orderItem.variant?.attributes),
    };
    const bucket = result.get(v.ticketId);
    if (bucket) bucket.push(entry);
    else result.set(v.ticketId, [entry]);
  }

  return result;
};
