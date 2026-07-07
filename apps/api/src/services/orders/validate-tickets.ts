import type { Prisma } from '@jdm/db';
import type { TicketInput } from '@jdm/shared/orders';

export interface TicketValidationResult {
  totalExtrasCents: number;
  /** One entry per unique extra with aggregated quantity, for OrderExtra row creation */
  extraEntries: { extraId: string; priceCents: number; quantity: number }[];
  /** Compact tickets array packed into Stripe PI metadata */
  ticketsMetadata: { e: string[]; c?: string; p?: string; n?: string }[];
  /** For CAS reservation inside transaction — one entry per unique extraId with total count */
  extraStock: { id: string; quantityTotal: number | null; count: number }[];
}

type Tx = Prisma.TransactionClient;

/**
 * Validates per-ticket inputs within a transaction.
 *
 * Enforces (throws coded errors for route to map to HTTP status):
 * - `MISSING_CAR_ID`   → 422 when tier.requiresCar and carId absent
 * - `MISSING_PLATE`    → 422 when tier.requiresCar and licensePlate absent
 * - `CAR_NOT_OWNED`    → 422 when carId doesn't exist or belongs to a different user
 * - `DUPLICATE_EXTRA`  → 422 when same extraId appears twice in one ticket
 * - `EXTRA_NOT_FOUND`  → 404 when extraId doesn't exist or belongs to another event
 * - `EXTRA_SOLD_OUT`   → 409 when extra has no available stock
 */
export async function validateTickets(
  tickets: TicketInput[],
  tier: { requiresCar: boolean },
  eventId: string,
  tx: Tx,
  userId: string,
  opts?: { skipCarValidation?: boolean },
): Promise<TicketValidationResult> {
  const allExtraIds = new Set<string>();
  const allCarIds = new Set<string>();

  for (const ticket of tickets) {
    if (!opts?.skipCarValidation && tier.requiresCar && !ticket.carId) {
      throw Object.assign(new Error('carId required for this tier'), { code: 'MISSING_CAR_ID' });
    }
    if (!opts?.skipCarValidation && tier.requiresCar && !ticket.licensePlate) {
      throw Object.assign(new Error('licensePlate required for this tier'), {
        code: 'MISSING_PLATE',
      });
    }
    if (ticket.carId) {
      allCarIds.add(ticket.carId);
    }
    const seen = new Set<string>();
    for (const extraId of ticket.extras ?? []) {
      if (seen.has(extraId)) {
        throw Object.assign(new Error(`duplicate extra ${extraId} in same ticket`), {
          code: 'DUPLICATE_EXTRA',
        });
      }
      seen.add(extraId);
      allExtraIds.add(extraId);
    }
  }

  if (allCarIds.size > 0) {
    const ownedCars = await tx.car.findMany({
      where: { id: { in: [...allCarIds] }, userId },
      select: { id: true },
    });
    const ownedIds = new Set(ownedCars.map((c) => c.id));
    for (const carId of allCarIds) {
      if (!ownedIds.has(carId)) {
        throw Object.assign(new Error(`car ${carId} not found or not owned by user`), {
          code: 'CAR_NOT_OWNED',
        });
      }
    }
  }

  if (allExtraIds.size === 0) {
    return {
      totalExtrasCents: 0,
      extraEntries: [],
      ticketsMetadata: tickets.map((t) => ({
        e: [] as string[],
        ...(t.carId ? { c: t.carId } : {}),
        ...(t.licensePlate ? { p: t.licensePlate } : {}),
        ...(t.nickname ? { n: t.nickname } : {}),
      })),
      extraStock: [],
    };
  }

  // Count total occurrences per extraId across all tickets (same extra in two tickets = 2)
  const extraCounts = new Map<string, number>();
  for (const ticket of tickets) {
    for (const extraId of ticket.extras ?? []) {
      extraCounts.set(extraId, (extraCounts.get(extraId) ?? 0) + 1);
    }
  }

  const extras = await tx.ticketExtra.findMany({
    where: { id: { in: [...allExtraIds] } },
    select: { id: true, eventId: true, priceCents: true, quantityTotal: true, quantitySold: true },
  });

  const extrasById = new Map(extras.map((e) => [e.id, e]));

  for (const extraId of allExtraIds) {
    const extra = extrasById.get(extraId);
    if (!extra || extra.eventId !== eventId) {
      throw Object.assign(new Error(`extra ${extraId} not found for this event`), {
        code: 'EXTRA_NOT_FOUND',
      });
    }
    const count = extraCounts.get(extraId) ?? 1;
    if (extra.quantityTotal !== null && extra.quantityTotal - extra.quantitySold < count) {
      throw Object.assign(new Error(`extra ${extraId} is sold out`), { code: 'EXTRA_SOLD_OUT' });
    }
  }

  const ticketsMetadata = tickets.map((ticket) => ({
    e: ticket.extras ?? [],
    ...(ticket.carId ? { c: ticket.carId } : {}),
    ...(ticket.licensePlate ? { p: ticket.licensePlate } : {}),
    ...(ticket.nickname ? { n: ticket.nickname } : {}),
  }));

  let totalExtrasCents = 0;
  const extraEntries: { extraId: string; priceCents: number; quantity: number }[] = [];
  const extraStock: { id: string; quantityTotal: number | null; count: number }[] = [];

  for (const [extraId, count] of extraCounts) {
    const extra = extrasById.get(extraId)!;
    totalExtrasCents += extra.priceCents * count;
    extraEntries.push({ extraId, priceCents: extra.priceCents, quantity: count });
    extraStock.push({ id: extra.id, quantityTotal: extra.quantityTotal, count });
  }

  return { totalExtrasCents, extraEntries, ticketsMetadata, extraStock };
}

/**
 * CAS-increments quantitySold for each extra by the requested count.
 * Throws EXTRA_SOLD_OUT if any extra was sold out between validation and reservation
 * (race condition) — allowing the caller's transaction to roll back atomically.
 */
export async function reserveExtras(
  extraStock: { id: string; quantityTotal: number | null; count: number }[],
  tx: Tx,
): Promise<void> {
  for (const { id, quantityTotal, count } of extraStock) {
    const result = await tx.ticketExtra.updateMany({
      where: {
        id,
        // null quantityTotal = unlimited; skip CAS stock predicate
        ...(quantityTotal !== null ? { quantitySold: { lte: quantityTotal - count } } : {}),
      },
      data: { quantitySold: { increment: count } },
    });
    if (result.count === 0) {
      throw Object.assign(new Error(`extra ${id} is sold out`), { code: 'EXTRA_SOLD_OUT' });
    }
  }
}
