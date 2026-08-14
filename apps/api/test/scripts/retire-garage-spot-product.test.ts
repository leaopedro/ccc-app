import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { retireGarageSpotProduct } from '../../src/scripts/retire-garage-spot-product.js';
import { resetDatabase } from '../helpers.js';

const seedLegacyProduct = async () => {
  const type = await prisma.productType.create({
    data: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });
  const product = await prisma.product.create({
    data: {
      slug: GARAGE_SPOT_PRODUCT_SLUG,
      title: 'Vaga de Garagem Adicional',
      description: 'legado',
      basePriceCents: 4900,
      status: 'active',
      virtual: true,
      visibleInStore: false,
      productTypeId: type.id,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Vaga padrão',
      sku: 'CCC-SPOT-1',
      priceCents: 4900,
      quantityTotal: 999,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

describe('retireGarageSpotProduct', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('archives the product and deactivates its variants', async () => {
    // Removing the seed call only stops NEW environments from getting the SKU.
    // A database seeded before the retirement still has a buyable row, because
    // the cart checks variant.active and product.status but never visibleInStore.
    const { product, variant } = await seedLegacyProduct();

    const result = await retireGarageSpotProduct(prisma);

    expect(result).toEqual({ productsArchived: 1, variantsDeactivated: 1 });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.status).toBe('archived');
    const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantAfter.active).toBe(false);
  });

  it('is a no-op when the product was never seeded', async () => {
    const result = await retireGarageSpotProduct(prisma);
    expect(result).toEqual({ productsArchived: 0, variantsDeactivated: 0 });
  });

  it('is idempotent', async () => {
    await seedLegacyProduct();
    await retireGarageSpotProduct(prisma);

    const second = await retireGarageSpotProduct(prisma);

    expect(second).toEqual({ productsArchived: 0, variantsDeactivated: 0 });
  });

  it('dry run reports counts and writes nothing', async () => {
    const { product } = await seedLegacyProduct();

    const result = await retireGarageSpotProduct(prisma, { dryRun: true });

    expect(result.productsArchived).toBe(1);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.status).toBe('active');
  });
});
