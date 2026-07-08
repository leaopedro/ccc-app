import { prisma } from '@ccc/db';
import { type CapacityDisplayPolicy, computeCapacityDisplay } from '@ccc/shared/general-settings';
import {
  storeCollectionListResponseSchema,
  storeCollectionSchema,
  storeProductDetailResponseSchema,
  storeProductImageSchema,
  storeProductListQuerySchema,
  storeProductListResponseSchema,
  storeProductSchema,
  storeProductSummarySchema,
  storeSettingsSchema,
  storeProductTypeListResponseSchema,
  storeProductTypeSchema,
  storeProductVariantSchema,
  type StoreSort,
} from '@ccc/shared/store';
import type {
  Collection as DbCollection,
  Prisma,
  Product as DbProduct,
  ProductPhoto as DbProductPhoto,
  ProductType as DbProductType,
  Variant as DbVariant,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { loadCapacityDisplayPolicy } from '../services/general-settings.js';
import { displayPriceCents } from '../services/pricing/dev-fee.js';
import { ensureStoreSettings } from '../services/store-settings.js';
import type { Uploads } from '../services/uploads/index.js';

type ProductWithRelations = DbProduct & {
  productType: DbProductType;
  variants: DbVariant[];
  photos: DbProductPhoto[];
  collections: { collectionId: string }[];
};

const slugify = (input: string): string => {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'tipo';
};

const serializeProductType = (pt: DbProductType) =>
  storeProductTypeSchema.parse({
    id: pt.id,
    slug: slugify(pt.name),
    name: pt.name,
    description: null,
  });

const serializeCollection = (c: DbCollection & { _count?: { products: number } }) =>
  storeCollectionSchema.parse({
    id: c.id,
    slug: c.slug,
    title: c.name,
    description: c.description,
    heroImageUrl: null,
    sortOrder: c.sortOrder,
    productCount: c._count?.products ?? 0,
  });

const serializeImage = (photo: DbProductPhoto, uploads: Uploads) =>
  storeProductImageSchema.parse({
    id: photo.id,
    url: uploads.buildPublicUrl(photo.objectKey),
    alt: null,
    sortOrder: photo.sortOrder,
  });

const variantCapacityDisplay = (v: DbVariant, policy: CapacityDisplayPolicy) => {
  const remaining = Math.max(0, v.quantityTotal - v.quantitySold);
  const status: 'available' | 'sold_out' | 'unavailable' = !v.active
    ? 'unavailable'
    : v.quantityTotal > 0 && remaining === 0
      ? 'sold_out'
      : 'available';
  return computeCapacityDisplay({ status, remaining, total: v.quantityTotal }, policy.products);
};

const serializeVariant = (
  v: DbVariant,
  currency: string,
  devFeePercent: number,
  policy: CapacityDisplayPolicy,
) =>
  storeProductVariantSchema.parse({
    id: v.id,
    sku: v.sku ?? null,
    title: v.name,
    priceCents: v.priceCents,
    displayPriceCents: displayPriceCents(v.priceCents, devFeePercent),
    devFeePercent,
    compareAtPriceCents: null,
    currency,
    stockOnHand: Math.max(0, v.quantityTotal - v.quantitySold),
    isActive: v.active,
    capacityDisplay: variantCapacityDisplay(v, policy),
  });

const computePriceRange = (
  variants: DbVariant[],
  currency: string,
  fallback: number,
  devFeePercent: number,
): {
  minPriceCents: number;
  maxPriceCents: number;
  minDisplayPriceCents: number;
  maxDisplayPriceCents: number;
  devFeePercent: number;
  currency: string;
} => {
  if (variants.length === 0) {
    return {
      minPriceCents: fallback,
      maxPriceCents: fallback,
      minDisplayPriceCents: displayPriceCents(fallback, devFeePercent),
      maxDisplayPriceCents: displayPriceCents(fallback, devFeePercent),
      devFeePercent,
      currency,
    };
  }
  const prices = variants.map((v) => v.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    minPriceCents: min,
    maxPriceCents: max,
    minDisplayPriceCents: displayPriceCents(min, devFeePercent),
    maxDisplayPriceCents: displayPriceCents(max, devFeePercent),
    devFeePercent,
    currency,
  };
};

const hasStock = (variants: DbVariant[]): boolean =>
  variants.some((v) => v.active && v.quantitySold < v.quantityTotal);

const serializeSummary = (
  product: ProductWithRelations,
  uploads: Uploads,
  devFeePercent: number,
) => {
  const activeVariants = product.variants.filter((v) => v.active);
  const sortedPhotos = [...product.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const cover = sortedPhotos[0] ? uploads.buildPublicUrl(sortedPhotos[0].objectKey) : null;
  return storeProductSummarySchema.parse({
    id: product.id,
    slug: product.slug,
    title: product.title,
    shortDescription: null,
    canShip: product.allowShip,
    canPickup: product.allowPickup,
    coverImageUrl: cover,
    productType: serializeProductType(product.productType),
    priceRange: computePriceRange(
      activeVariants,
      product.currency,
      product.basePriceCents,
      devFeePercent,
    ),
    inStock: hasStock(activeVariants),
  });
};

const serializeDetail = (
  product: ProductWithRelations,
  uploads: Uploads,
  devFeePercent: number,
  policy: CapacityDisplayPolicy,
) => {
  const activeVariants = product.variants.filter((v) => v.active);
  const variantsForResponse = activeVariants.length > 0 ? activeVariants : product.variants;
  const sortedPhotos = [...product.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const cover = sortedPhotos[0] ? uploads.buildPublicUrl(sortedPhotos[0].objectKey) : null;
  return storeProductSchema.parse({
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    shortDescription: null,
    status: product.status,
    canShip: product.allowShip,
    canPickup: product.allowPickup,
    coverImageUrl: cover,
    collectionIds: product.collections.map((c) => c.collectionId),
    productType: serializeProductType(product.productType),
    variants: variantsForResponse.map((v) =>
      serializeVariant(v, product.currency, devFeePercent, policy),
    ),
    images: sortedPhotos.map((p) => serializeImage(p, uploads)),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  });
};

type CursorPayload = { k: string | number; i: string };

const encodeCursor = (k: string | number, i: string): string =>
  Buffer.from(JSON.stringify({ k, i }), 'utf8').toString('base64url');

const decodeCursor = (raw: string): CursorPayload => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload;
  if (
    typeof parsed.i !== 'string' ||
    (typeof parsed.k !== 'string' && typeof parsed.k !== 'number')
  ) {
    throw new Error('invalid cursor payload');
  }
  return parsed;
};

const cursorKeyForProduct = (product: ProductWithRelations, sort: StoreSort): string | number => {
  if (sort === 'price_asc' || sort === 'price_desc') return product.basePriceCents;
  return product.createdAt.toISOString();
};

const buildOrderBy = (sort: StoreSort): Prisma.ProductOrderByWithRelationInput[] => {
  switch (sort) {
    case 'price_asc':
      return [{ basePriceCents: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ basePriceCents: 'desc' }, { id: 'desc' }];
    case 'newest':
    case 'featured':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
};

const buildCursorWhere = (
  sort: StoreSort,
  cursor: CursorPayload,
): Prisma.ProductWhereInput | null => {
  if (sort === 'price_asc') {
    if (typeof cursor.k !== 'number') return null;
    return {
      OR: [
        { basePriceCents: { gt: cursor.k } },
        { basePriceCents: cursor.k, id: { gt: cursor.i } },
      ],
    };
  }
  if (sort === 'price_desc') {
    if (typeof cursor.k !== 'number') return null;
    return {
      OR: [
        { basePriceCents: { lt: cursor.k } },
        { basePriceCents: cursor.k, id: { lt: cursor.i } },
      ],
    };
  }
  if (typeof cursor.k !== 'string') return null;
  const at = new Date(cursor.k);
  if (Number.isNaN(at.getTime())) return null;
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.i } }],
  };
};

const PRODUCT_INCLUDE = {
  productType: true,
  variants: true,
  photos: true,
  collections: { select: { collectionId: true } },
} satisfies Prisma.ProductInclude;

const fetchInStockPage = async (
  where: Prisma.ProductWhereInput,
  sort: StoreSort,
  limit: number,
): Promise<{ items: ProductWithRelations[]; nextCursor: string | null }> => {
  const collected: ProductWithRelations[] = [];
  let after: CursorPayload | null = null;

  while (collected.length < limit + 1) {
    const batchWhere: Prisma.ProductWhereInput = after
      ? {
          AND: [where, buildCursorWhere(sort, after) ?? {}],
        }
      : where;
    const rows = await prisma.product.findMany({
      where: batchWhere,
      orderBy: buildOrderBy(sort),
      include: PRODUCT_INCLUDE,
      take: limit + 1,
    });

    if (rows.length === 0) break;

    const inStockRows = rows.filter((p) =>
      p.variants.some((v) => v.active && v.quantitySold < v.quantityTotal),
    );
    collected.push(...inStockRows);

    const lastRow = rows[rows.length - 1];
    after = lastRow ? { k: cursorKeyForProduct(lastRow, sort), i: lastRow.id } : null;

    if (rows.length < limit + 1) break;
  }

  const hasMore = collected.length > limit;
  const page = hasMore ? collected.slice(0, limit) : collected;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(cursorKeyForProduct(last, sort), last.id) : null,
  };
};

// eslint-disable-next-line @typescript-eslint/require-await
export const storeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (_request, reply) => {
    const settings = await ensureStoreSettings();
    if (settings.storeEnabled) return;
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'store is currently disabled' });
  });

  app.get('/store/settings', async () => {
    const settings = await ensureStoreSettings();
    return storeSettingsSchema.parse({
      id: settings.id,
      storeEnabled: settings.storeEnabled,
      defaultShippingFeeCents: settings.defaultShippingFeeCents,
      lowStockThreshold: settings.lowStockThreshold,
      storeHeaderTitle: settings.storeHeaderTitle,
      storeHeaderSubtitle: settings.storeHeaderSubtitle,
      eventPickupEnabled: settings.eventPickupEnabled,
      pickupDisplayLabel: settings.pickupDisplayLabel,
      supportPhone: settings.supportPhone,
      updatedAt: settings.updatedAt.toISOString(),
    });
  });

  app.get('/store/product-types', async () => {
    const rows = await prisma.productType.findMany({
      where: {
        products: {
          some: { visibleInStore: true, status: 'active', photos: { some: {} } },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return storeProductTypeListResponseSchema.parse({
      items: rows.map(serializeProductType),
    });
  });

  app.get('/store/collections', async () => {
    const visibleProductFilter = {
      product: { visibleInStore: true, status: 'active' as const, photos: { some: {} } },
    };
    const rows = await prisma.collection.findMany({
      where: {
        active: true,
        products: { some: visibleProductFilter },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            products: { where: visibleProductFilter },
          },
        },
      },
    });
    return storeCollectionListResponseSchema.parse({
      items: rows.map(serializeCollection),
    });
  });

  app.get('/store/products', async (request, reply) => {
    const query = storeProductListQuerySchema.parse(request.query);
    const where: Prisma.ProductWhereInput = {
      status: 'active',
      visibleInStore: true,
      variants: { some: { active: true } },
      photos: { some: {} },
    };

    if (query.collectionSlug) {
      where.collections = {
        some: { collection: { slug: query.collectionSlug, active: true } },
      };
    }

    if (query.productTypeSlug) {
      const types = await prisma.productType.findMany();
      const matches = types
        .filter((t) => slugify(t.name) === query.productTypeSlug)
        .map((t) => t.id);
      if (matches.length === 0) {
        return storeProductListResponseSchema.parse({ items: [], nextCursor: null });
      }
      where.productTypeId = { in: matches };
    }

    if (query.q) {
      const term = query.q;
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (query.cursor) {
      let parsed: CursorPayload;
      try {
        parsed = decodeCursor(query.cursor);
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
      const cursorWhere = buildCursorWhere(query.sort, parsed);
      if (!cursorWhere) {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
      where.AND = [...((where.AND as Prisma.ProductWhereInput[]) ?? []), cursorWhere];
    }

    const pageResult = query.inStock
      ? await fetchInStockPage(where, query.sort, query.limit)
      : await (async () => {
          const rows = await prisma.product.findMany({
            where,
            orderBy: buildOrderBy(query.sort),
            include: PRODUCT_INCLUDE,
            take: query.limit + 1,
          });
          const hasMore = rows.length > query.limit;
          const page = hasMore ? rows.slice(0, query.limit) : rows;
          const last = page[page.length - 1];
          return {
            items: page,
            nextCursor:
              hasMore && last ? encodeCursor(cursorKeyForProduct(last, query.sort), last.id) : null,
          };
        })();

    return storeProductListResponseSchema.parse({
      items: pageResult.items.map((p) => serializeSummary(p, app.uploads, app.env.DEV_FEE_PERCENT)),
      nextCursor: pageResult.nextCursor,
    });
  });

  app.get('/store/products/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await prisma.product.findFirst({
      where: { slug, status: 'active', visibleInStore: true, photos: { some: {} } },
      include: {
        productType: true,
        variants: true,
        photos: true,
        collections: { select: { collectionId: true } },
      },
    });
    if (!product) return reply.status(404).send({ error: 'NotFound' });

    const collectionIds = product.collections.map((c) => c.collectionId);
    const collections = collectionIds.length
      ? await prisma.collection.findMany({
          where: { id: { in: collectionIds }, active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            _count: {
              select: {
                products: {
                  where: {
                    product: {
                      visibleInStore: true,
                      status: 'active',
                      photos: { some: {} },
                    },
                  },
                },
              },
            },
          },
        })
      : [];

    const policy = await loadCapacityDisplayPolicy();
    return storeProductDetailResponseSchema.parse({
      product: serializeDetail(product, app.uploads, app.env.DEV_FEE_PERCENT, policy),
      collections: collections.map(serializeCollection),
    });
  });
};
