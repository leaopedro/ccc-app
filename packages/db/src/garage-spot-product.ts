import type { Prisma } from '@prisma/client';

// Singleton identifiers. Keep in @jdm/db so the seed (in this package) and any
// future admin guard (apps/api, TASK-H) share one source of truth.
export const GARAGE_SPOT_PRODUCT_TYPE_NAME = 'garage_spot';
export const GARAGE_SPOT_PRODUCT_SLUG = 'garage-spot';
export const GARAGE_SPOT_VARIANT_NAME = 'Vaga padrão';
export const GARAGE_SPOT_DEFAULT_PRICE_CENTS = 4900;
export const GARAGE_SPOT_DEFAULT_TITLE = 'Vaga de Garagem Adicional';
export const GARAGE_SPOT_DEFAULT_DESCRIPTION =
  'Vaga adicional na sua garagem para registrar mais um carro. Acesso permanente, sem mensalidade.';

export type GarageSpotProductLike = {
  slug: string;
  virtual: boolean;
  visibleInStore: boolean;
  productType: { name: string } | null;
};

export class VirtualSingletonProtectedError extends Error {
  constructor(
    public readonly slug: string,
    public readonly reason: 'delete' | 'duplicate',
  ) {
    super(`Virtual singleton product '${slug}' refused: ${reason}`);
    this.name = 'VirtualSingletonProtectedError';
  }
}

/** Used by seed to refuse duplicate inserts and by admin code (TASK-H) to refuse deletes. */
export const assertVirtualSingletonProtected = (
  op: 'delete' | 'duplicate',
  product: GarageSpotProductLike | null,
): void => {
  if (!product) return;
  if (
    product.slug === GARAGE_SPOT_PRODUCT_SLUG ||
    product.productType?.name === GARAGE_SPOT_PRODUCT_TYPE_NAME
  ) {
    throw new VirtualSingletonProtectedError(product.slug, op);
  }
};

// Prisma include shape used by seed + future admin lookups.
export const garageSpotProductInclude = {
  productType: { select: { name: true } },
} satisfies Prisma.ProductInclude;
