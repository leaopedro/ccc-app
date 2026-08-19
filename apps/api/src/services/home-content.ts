import { prisma } from '@ccc/db';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';

/**
 * Lê a linha única de HomeContent, criando com os defaults do schema quando
 * ainda não existe. Mesmo idiom de ensureGeneralSettings: o upsert pode
 * colidir com uma request concorrente, e nesse caso a leitura vence.
 */
export const ensureHomeContent = async () => {
  try {
    return await prisma.homeContent.upsert({
      where: { id: HOME_CONTENT_SINGLETON_ID },
      update: {},
      create: { id: HOME_CONTENT_SINGLETON_ID },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.homeContent.findUniqueOrThrow({
        where: { id: HOME_CONTENT_SINGLETON_ID },
      });
    }
    throw err;
  }
};
