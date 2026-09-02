import type { Car } from '@ccc/shared/cars';
import type { GarageSpot, GarageSpotSource } from '@ccc/shared/garage';

import type { GaragePurchaseOption, GarageReadResponse } from '~/api/garage';

/**
 * V2 garage slot union for ParkingStallCard. Collapses the legacy 5-kind
 * shape (filled / empty-free / empty-extra / add-card / buy) into three:
 *
 *   filled — a car parked in a real spot
 *   empty  — an unfilled stall; `source` carries why it exists. `spot` is
 *            `null` for the lazy unlimited "add-card" surface (the
 *            allocator mints a default_free spot on next car-create).
 *   buy    — purchase CTA when no slots remain and the garage is capped.
 *
 * `index` is a 1-based render position used by the slot plate (SLOT 01,
 * SLOT 02…). Allocation is iteration-order — keeping the server-driven
 * spot order intact.
 */
export type GarageSlotV2 =
  | {
      kind: 'filled';
      index: number;
      source: GarageSpotSource;
      spot: GarageSpot;
      car: Car;
    }
  | {
      kind: 'empty';
      index: number;
      source: GarageSpotSource;
      spot: GarageSpot | null;
    }
  | {
      kind: 'buy';
      index: number;
      purchaseOption: GaragePurchaseOption;
    };

/**
 * Converts a GarageReadResponse into a deterministic list of slots
 * suitable for FlatList rendering.
 *
 * Server is the source of truth for spot ordering (createdAt ASC).
 * This helper never resorts payload.spots.
 *
 * Lazy add surface (kind:'empty', spot:null) appears for unlimited
 * garages whenever no materialized empty spot exists; the allocator
 * mints a fresh default_free spot on the next car-create
 * (TASK-B-prime self-heal), so the surface stays actionable.
 *
 * Buy card appears only when:
 *   - not unlimited
 *   - no slots available
 *   - purchaseOption is present in the payload
 *   - not iOS (final review I3, below)
 */
export function buildGarageSlots(
  payload: GarageReadResponse,
  // Final review I6: REQUIRED, and `platform` is non-optional. It used to
  // default to `{}`, so `ctx.platform !== 'ios'` failed OPEN — any caller that
  // forgot the argument rendered the buy tile on iOS, where checkout refuses
  // the item with 403 VIRTUAL_ITEM_IOS_BLOCKED and strands it in the cart.
  // A silent regression like that has to be a type error, not a runtime one.
  ctx: { platform: string },
): GarageSlotV2[] {
  const carsById = new Map(payload.cars.map((c) => [c.id, c]));
  const slots: GarageSlotV2[] = [];
  let index = 1;

  for (const spot of payload.spots) {
    if (spot.carId !== null) {
      const car = carsById.get(spot.carId);
      if (!car) continue; // orphan defense
      slots.push({ kind: 'filled', index: index++, source: spot.source, spot, car });
      continue;
    }
    slots.push({ kind: 'empty', index: index++, source: spot.source, spot });
  }

  if (payload.isUnlimited && payload.availableSlots === 0) {
    slots.push({ kind: 'empty', index: index++, source: 'default_free', spot: null });
  }

  // A purchased spot is a virtual-variant cart item; routes/cart.ts refuses
  // it with 403 VIRTUAL_ITEM_IOS_BLOCKED on iOS at checkout time (App Store
  // 3.1.3(e) — digital unlock cannot sell outside IAP). Rendering the tile
  // there is a purchase affordance that always fails by design, and it
  // strands the cart item behind a checkout that will never succeed. Hide
  // it instead of letting the member tap into a guaranteed refusal.
  if (
    !payload.isUnlimited &&
    payload.availableSlots === 0 &&
    payload.purchaseOption &&
    ctx.platform !== 'ios'
  ) {
    slots.push({ kind: 'buy', index: index++, purchaseOption: payload.purchaseOption });
  }

  return slots;
}
