import { prisma } from '@ccc/db';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';

/**
 * Lê a linha única de HomeContent, criando com os defaults do schema quando
 * ainda não existe. `findUnique` primeiro evita o BEGIN + 3 SELECT + COMMIT
 * de um upsert com update vazio em toda leitura desta rota pública — o caso
 * comum, depois do primeiro app launch, é a linha já existir. Mesmo idiom de
 * ensureGeneralSettings para a corrida: um create concorrente pode colidir,
 * e nesse caso a leitura vence.
 */
export const ensureHomeContent = async () => {
  const existing = await prisma.homeContent.findUnique({
    where: { id: HOME_CONTENT_SINGLETON_ID },
  });
  if (existing) return existing;

  try {
    return await prisma.homeContent.create({ data: { id: HOME_CONTENT_SINGLETON_ID } });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.homeContent.findUniqueOrThrow({
        where: { id: HOME_CONTENT_SINGLETON_ID },
      });
    }
    throw err;
  }
};
