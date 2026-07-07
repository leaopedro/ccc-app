import { prisma } from '@jdm/db';
import type { StorePickupItem, StorePickupOrder } from '@jdm/shared/check-in';

import { decryptField } from '../crypto/field-encryption.js';

const parsePickupTicketId = (notes: string | null, encryptionKey: string): string | null => {
  if (!notes) return null;
  const decrypted = decryptField(notes, encryptionKey) ?? notes;
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).pickupTicketId;
      return typeof id === 'string' ? id : null;
    }
  } catch {
    // ignore malformed notes
  }
  return null;
};

const mapItems = (
  items: {
    id: string;
    quantity: number;
    variant: {
      name: string | null;
      sku: string | null;
      attributes: unknown;
      product: { title: string };
    } | null;
  }[],
): StorePickupItem[] =>
  items.map((it) => {
    const attrs =
      it.variant?.attributes && typeof it.variant.attributes === 'object'
        ? Object.fromEntries(
            Object.entries(it.variant.attributes as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          )
        : null;
    return {
      id: it.id,
      productTitle: it.variant?.product.title ?? null,
      variantName: it.variant?.name ?? null,
      variantSku: it.variant?.sku ?? null,
      variantAttributes: attrs,
      quantity: it.quantity,
    };
  });

const queryPickupOrders = async (ticketId: string, encryptionKey: string) => {
  const candidates = await prisma.order.findMany({
    where: {
      fulfillmentMethod: 'pickup',
      status: 'paid',
      OR: [{ pickupTicketId: ticketId }, { notes: { contains: ticketId } }],
    },
    include: {
      items: {
        where: { kind: 'product' },
        include: {
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
  });
  return candidates.filter(
    (o) =>
      o.pickupTicketId === ticketId || parsePickupTicketId(o.notes, encryptionKey) === ticketId,
  );
};

export const getPickupOrdersForTicket = async (
  ticketId: string,
  encryptionKey: string,
): Promise<StorePickupOrder[]> => {
  const orders = await queryPickupOrders(ticketId, encryptionKey);
  return orders.map((o) => ({
    orderId: o.id,
    shortId: o.id.slice(-8).toUpperCase(),
    fulfillmentStatus: o.fulfillmentStatus as StorePickupOrder['fulfillmentStatus'],
    items: mapItems(o.items),
  }));
};

export const getPickupOrdersByTicket = async (
  ticketIds: string[],
  encryptionKey: string,
): Promise<Map<string, StorePickupOrder[]>> => {
  const result = new Map<string, StorePickupOrder[]>();
  if (ticketIds.length === 0) return result;

  const candidates = await prisma.order.findMany({
    where: {
      fulfillmentMethod: 'pickup',
      status: 'paid',
      OR: [
        { pickupTicketId: { in: ticketIds } },
        ...ticketIds.map((id) => ({ notes: { contains: id } as const })),
      ],
    },
    include: {
      items: {
        where: { kind: 'product' },
        include: {
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
  });

  for (const order of candidates) {
    const linkedTicketId =
      (order.pickupTicketId && ticketIds.includes(order.pickupTicketId)
        ? order.pickupTicketId
        : null) ?? parsePickupTicketId(order.notes, encryptionKey);
    if (!linkedTicketId || !ticketIds.includes(linkedTicketId)) continue;

    const entry: StorePickupOrder = {
      orderId: order.id,
      shortId: order.id.slice(-8).toUpperCase(),
      fulfillmentStatus: order.fulfillmentStatus as StorePickupOrder['fulfillmentStatus'],
      items: mapItems(order.items),
    };
    const bucket = result.get(linkedTicketId);
    if (bucket) bucket.push(entry);
    else result.set(linkedTicketId, [entry]);
  }

  return result;
};
