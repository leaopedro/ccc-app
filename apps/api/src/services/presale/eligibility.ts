import { prisma } from '@ccc/db';
import type {
  Prisma,
  Product as DbProduct,
  ProductPhoto as DbProductPhoto,
  Variant as DbVariant,
} from '@prisma/client';

// Single source of truth for pre-sale eligibility. Tasks 6 (showcase) and 7
// (checkout) import this exact constant — do not let either rebuild its own
// `where`, or a product can show in the box and get refused at payment.
export const PRESALE_PRODUCT_WHERE = {
  status: 'active',
  visibleInPresale: true,
  virtual: false,
  currency: 'BRL',
  photos: { some: {} },
  variants: { some: { active: true } },
} satisfies Prisma.ProductWhereInput;

export const PRESALE_PRODUCT_INCLUDE = {
  photos: true,
  variants: true,
} satisfies Prisma.ProductInclude;

export type PresaleProductRow = DbProduct & {
  photos: DbProductPhoto[];
  variants: DbVariant[];
};

export const loadEligiblePresaleProducts = async (): Promise<PresaleProductRow[]> =>
  prisma.product.findMany({
    where: PRESALE_PRODUCT_WHERE,
    include: PRESALE_PRODUCT_INCLUDE,
  });
