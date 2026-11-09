// Fixtures próprias da pré-venda Casa In Box. Não editar test/helpers.ts:
// aquele arquivo é compartilhado pelas outras ~2250 provas da suíte.
import { prisma } from '@ccc/db';
import type { Prisma } from '@ccc/db';
import { STORE_SETTINGS_SINGLETON_ID } from '@ccc/shared/store';

import { createUser } from '../helpers.js';

const randomSuffix = () => Math.random().toString(36).slice(2, 10);

const ensureProductType = async () =>
  prisma.productType.upsert({
    where: { name: 'Presale Test Type' },
    update: {},
    create: { name: 'Presale Test Type' },
  });

export const createProduct = async (overrides: Partial<Prisma.ProductCreateInput> = {}) => {
  const productType = await ensureProductType();
  return prisma.product.create({
    data: {
      slug: `presale-product-${randomSuffix()}`,
      title: 'Produto Teste Presale',
      description: 'Descrição de teste',
      basePriceCents: 5000,
      status: 'active',
      productType: { connect: { id: productType.id } },
      ...overrides,
    },
  });
};

// Builds a product eligible for the pre-sale (status active, visible in
// presale, non-virtual, BRL, one photo, one active variant at R$99,00),
// then layers productPatch on top of those defaults. `photos` and `variants`
// let a test override just the nested relations without restating the rest.
export const createPresaleProduct = async (
  productPatch: Partial<Prisma.ProductCreateInput> = {},
  opts: {
    photos?: { objectKey?: string; sortOrder?: number }[];
    variants?: Partial<{
      name: string;
      priceCents: number;
      quantityTotal: number;
      quantitySold: number;
      active: boolean;
    }>[];
  } = {},
) => {
  const photos = opts.photos ?? [{}];
  const variants = opts.variants ?? [{}];

  const product = await createProduct({
    visibleInPresale: true,
    virtual: false,
    currency: 'BRL',
    status: 'active',
    basePriceCents: 9900,
    ...(photos.length > 0
      ? {
          photos: {
            create: photos.map((p, idx) => ({
              objectKey: p.objectKey ?? `presale/product/${randomSuffix()}.jpg`,
              sortOrder: p.sortOrder ?? idx,
            })),
          },
        }
      : {}),
    ...productPatch,
  });

  await Promise.all(
    variants.map((v, idx) =>
      prisma.variant.create({
        data: {
          productId: product.id,
          name: v.name ?? `Variante ${idx + 1}`,
          priceCents: v.priceCents ?? 9900,
          quantityTotal: v.quantityTotal ?? 10,
          quantitySold: v.quantitySold ?? 0,
          attributes: {},
          active: v.active ?? true,
        },
      }),
    ),
  );

  return prisma.product.findUniqueOrThrow({
    where: { id: product.id },
    include: { photos: true, variants: true },
  });
};

// PresaleSettings nasce sem id fixo (ver schema.prisma): findFirst/create, não
// upsert por id. Atualiza a MESMA linha que `ensurePresaleSettings` vai ler
// (ordenada createdAt asc, id asc — mesmo critério, ver services/presale/settings.ts)
// em vez de criar uma segunda linha ao lado.
export const setPresaleSettings = async (overrides: Partial<Prisma.PresaleSettingsCreateInput>) => {
  const existing = await prisma.presaleSettings.findFirst({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (existing) {
    return prisma.presaleSettings.update({ where: { id: existing.id }, data: overrides });
  }
  return prisma.presaleSettings.create({ data: overrides });
};

export const setPresaleEnabled = (enabled: boolean) => setPresaleSettings({ enabled });

export const setStoreEnabled = (storeEnabled: boolean) =>
  prisma.storeSettings.upsert({
    where: { id: STORE_SETTINGS_SINGLETON_ID },
    update: { storeEnabled },
    create: { id: STORE_SETTINGS_SINGLETON_ID, storeEnabled },
  });

export const createProductOrder = async (overrides: Partial<Prisma.OrderCreateInput> = {}) => {
  const { user } = await createUser({ email: `presale-order-${randomSuffix()}@jdm.test` });
  const product = await createProduct();
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 10,
      attributes: {},
      active: true,
    },
  });

  return prisma.order.create({
    data: {
      user: { connect: { id: user.id } },
      kind: 'product',
      amountCents: 5000,
      quantity: 1,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_presale_test_${randomSuffix()}`,
      status: 'pending',
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
      ...overrides,
    },
  });
};
