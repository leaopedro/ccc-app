import { prisma } from '@jdm/db';
import {
  adminStoreInventoryFilterSchema,
  adminStoreInventoryListResponseSchema,
  type AdminStoreInventoryRow,
  type AdminStoreInventoryStatus,
} from '@jdm/shared/admin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { ensureStoreSettings } from '../../../services/store-settings.js';

const querySchema = z.object({
  status: adminStoreInventoryFilterSchema.optional(),
});

const classify = (available: number, threshold: number): AdminStoreInventoryStatus => {
  if (available <= 0) return 'zero';
  if (available <= threshold) return 'low';
  return 'ok';
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreInventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/store/inventory', async (request) => {
    const query = querySchema.parse(request.query);
    const filter = query.status ?? 'all';

    const settings = await ensureStoreSettings();
    const threshold = settings.lowStockThreshold;

    const variants = await prisma.variant.findMany({
      where: { product: { status: { not: 'archived' } } },
      include: {
        product: {
          select: { id: true, slug: true, title: true, status: true, currency: true },
        },
      },
    });

    const rows: AdminStoreInventoryRow[] = variants.map((v) => {
      const available = v.quantityTotal - v.quantitySold;
      return {
        variantId: v.id,
        productId: v.productId,
        productSlug: v.product.slug,
        productTitle: v.product.title,
        productStatus: v.product.status,
        variantName: v.name,
        sku: v.sku,
        attributes: (v.attributes ?? {}) as Record<string, string>,
        active: v.active,
        priceCents: v.priceCents,
        currency: v.product.currency,
        quantityTotal: v.quantityTotal,
        quantitySold: v.quantitySold,
        available,
        status: classify(available, threshold),
        updatedAt: v.updatedAt.toISOString(),
      };
    });

    const totals = {
      all: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      low: rows.filter((r) => r.status === 'low').length,
      zero: rows.filter((r) => r.status === 'zero').length,
    };

    const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

    filtered.sort((a, b) => {
      if (a.available !== b.available) return a.available - b.available;
      return a.productTitle.localeCompare(b.productTitle, 'pt-BR');
    });

    return adminStoreInventoryListResponseSchema.parse({
      threshold,
      totals,
      items: filtered,
    });
  });
};
