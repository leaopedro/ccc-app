import { prisma } from '@ccc/db';
import { PRESALE_SETTINGS_SINGLETON_ID } from '@ccc/shared/presale';
import type { PresaleSettings } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

// Fixed singleton id, same pattern as ensureStoreSettings
// (../store-settings.ts): upsert on a constant id makes concurrent first-hits
// race-safe at the DB level, instead of merely converging deterministically
// on read. Do not "simplify" this back to findFirst/create on a free-form
// cuid — that reopens the exact gap this closed: Task 11 adds an admin write
// path onto this same row, and a duplicate row there is a silent config
// split (operator edits one row, checkout charges the other).
export const ensurePresaleSettings = async (): Promise<PresaleSettings> => {
  try {
    return await prisma.presaleSettings.upsert({
      where: { id: PRESALE_SETTINGS_SINGLETON_ID },
      update: {},
      create: { id: PRESALE_SETTINGS_SINGLETON_ID },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.presaleSettings.findUniqueOrThrow({
        where: { id: PRESALE_SETTINGS_SINGLETON_ID },
      });
    }
    throw err;
  }
};
