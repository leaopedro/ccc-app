import { prisma } from '@jdm/db';
import { STORE_SETTINGS_SINGLETON_ID } from '@jdm/shared/store';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';

export const ensureStoreSettings = async () => {
  try {
    return await prisma.storeSettings.upsert({
      where: { id: STORE_SETTINGS_SINGLETON_ID },
      update: {},
      create: { id: STORE_SETTINGS_SINGLETON_ID },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.storeSettings.findUniqueOrThrow({
        where: { id: STORE_SETTINGS_SINGLETON_ID },
      });
    }
    throw err;
  }
};
