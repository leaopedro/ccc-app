// Fixtures próprias da pré-venda Casa In Box. Não editar test/helpers.ts:
// aquele arquivo é compartilhado pelas outras ~2250 provas da suíte.
import { prisma } from '@ccc/db';
import type { Prisma } from '@ccc/db';

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
