import { prisma } from '@jdm/db';
import type { Garage } from '@prisma/client';

import { isUniqueConstraintError, isUniqueConstraintErrorOn } from '../../lib/prisma-errors.js';

import { defaultGarageSlugForUserId, findFreeGarageSlug } from './index.js';

// Defensive ensure: users created pre-signup-hook (or via tests bypassing
// helpers) may not yet have a Garage row. Mirrors apps/api/src/routes/garage.ts.
//
// Two distinct unique-constraint races to handle:
//   1. userId race: two concurrent ensures for the same user both miss the
//      pre-tx read; second tx hits @unique on userId. Recover by returning
//      the winner's row (the other tx already created it).
//   2. slug race: `findFreeGarageSlug` SELECTs a candidate; between SELECT and
//      INSERT another *different* user's ensure inserts the same predicted
//      slug. Recover by retrying with a fresh `findFreeGarageSlug` call so the
//      collided candidate is observed and a suffix is appended.
const ENSURE_GARAGE_MAX_SLUG_RETRIES = 3;

export const ensureGarageForUserId = async (userId: string): Promise<Garage> => {
  const existing = await prisma.garage.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const already = await tx.garage.findUnique({ where: { userId } });
        if (already) return already;
        const slug = await findFreeGarageSlug(tx, defaultGarageSlugForUserId(userId));
        return tx.garage.create({
          data: {
            userId,
            name: 'Garagem',
            slug,
            isPublic: false,
          },
        });
      });
    } catch (e) {
      // userId collision wins immediately: the row exists, return it.
      if (isUniqueConstraintErrorOn(e, 'userId')) {
        const winner = await prisma.garage.findUnique({ where: { userId } });
        if (winner) return winner;
      }
      // Slug collision: another user grabbed the predicted slug in the
      // SELECT→INSERT race. Retry with a fresh slug search; the now-inserted
      // collider will be observed and `-2`/`-3`/... will be appended.
      if (isUniqueConstraintErrorOn(e, 'slug')) {
        if (attempt < ENSURE_GARAGE_MAX_SLUG_RETRIES) continue;
        throw new Error(
          `ensureGarageForUserId: slug collision retries exhausted for user ${userId}`,
        );
      }
      // Some legacy callers / unit-test fakes may emit a P2002 without
      // populating `meta.target`. Fall back to the original userId recovery
      // before bubbling.
      if (isUniqueConstraintError(e)) {
        const winner = await prisma.garage.findUnique({ where: { userId } });
        if (winner) return winner;
      }
      throw e;
    }
  }
};
