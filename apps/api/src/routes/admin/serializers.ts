import {
  computeCapacityDisplay,
  defaultCapacityDisplaySurfaceSetting,
} from '@jdm/shared/general-settings';
import type {
  Collection as DbCollection,
  GeneralSettings as DbGeneralSettings,
  Product as DbProduct,
  ProductType as DbProductType,
  StoreSettings as DbStoreSettings,
  TicketExtra as DbTicketExtra,
  TicketTier as DbTier,
} from '@prisma/client';

import { toCapacityDisplayPolicy } from '../../services/general-settings.js';
import { displayPriceCents as calcDisplayPrice } from '../../services/pricing/dev-fee.js';

const adminTierCapacityDisplay = (t: DbTier) => {
  const remaining = Math.max(0, t.quantityTotal - t.quantitySold);
  const status = t.quantityTotal > 0 && remaining === 0 ? 'sold_out' : 'available';
  return computeCapacityDisplay(
    { status, remaining, total: t.quantityTotal },
    defaultCapacityDisplaySurfaceSetting,
  );
};

export const serializeAdminTier = (t: DbTier, devFeePercent: number) => ({
  id: t.id,
  name: t.name,
  priceCents: t.priceCents,
  displayPriceCents: calcDisplayPrice(t.priceCents, devFeePercent),
  devFeePercent,
  currency: t.currency,
  quantityTotal: t.quantityTotal,
  quantitySold: t.quantitySold,
  remainingCapacity: Math.max(0, t.quantityTotal - t.quantitySold),
  salesOpenAt: t.salesOpenAt?.toISOString() ?? null,
  salesCloseAt: t.salesCloseAt?.toISOString() ?? null,
  sortOrder: t.sortOrder,
  requiresCar: t.requiresCar,
  isPremiumGrantable: t.isPremiumGrantable,
  capacityDisplay: adminTierCapacityDisplay(t),
});

export const serializeAdminCollection = (
  c: DbCollection,
  productCount: number,
): {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
} => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  active: c.active,
  sortOrder: c.sortOrder,
  productCount,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const serializeAdminCollectionProduct = (
  p: Pick<DbProduct, 'id' | 'slug' | 'title' | 'status'>,
  sortOrder: number,
): {
  productId: string;
  sortOrder: number;
  title: string;
  slug: string;
  status: DbProduct['status'];
} => ({
  productId: p.id,
  sortOrder,
  title: p.title,
  slug: p.slug,
  status: p.status,
});

export const serializeAdminProductType = (p: DbProductType, productCount: number) => ({
  id: p.id,
  name: p.name,
  sortOrder: p.sortOrder,
  productCount,
  createdAt: p.createdAt.toISOString(),
});

export const serializeAdminExtra = (e: DbTicketExtra, devFeePercent: number) => ({
  id: e.id,
  eventId: e.eventId,
  name: e.name,
  description: e.description,
  priceCents: e.priceCents,
  displayPriceCents: calcDisplayPrice(e.priceCents, devFeePercent),
  devFeePercent,
  currency: e.currency,
  quantityTotal: e.quantityTotal,
  quantitySold: e.quantitySold,
  active: e.active,
  sortOrder: e.sortOrder,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const serializeAdminStoreSettings = (s: DbStoreSettings) => ({
  id: s.id,
  storeEnabled: s.storeEnabled,
  defaultShippingFeeCents: s.defaultShippingFeeCents,
  lowStockThreshold: s.lowStockThreshold,
  storeHeaderTitle: s.storeHeaderTitle,
  storeHeaderSubtitle: s.storeHeaderSubtitle,
  eventPickupEnabled: s.eventPickupEnabled,
  pickupDisplayLabel: s.pickupDisplayLabel,
  supportPhone: s.supportPhone,
  updatedAt: s.updatedAt.toISOString(),
});

export const serializeAdminGeneralSettings = (s: DbGeneralSettings) => ({
  id: s.id,
  capacityDisplay: toCapacityDisplayPolicy(s),
  defaultFreeGarageSpots: s.defaultFreeGarageSpots,
  gamificationEnabled: s.gamificationEnabled,
  updatedAt: s.updatedAt.toISOString(),
});
