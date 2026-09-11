import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import type { RankNames } from './progress.js';
import { RANK_KEYS } from './progress.js';

type ReadClient = PrismaClient | Prisma.TransactionClient;

// Leitura tolerante de propósito. A escrita valida forma completa
// (packages/shared/src/admin-gamification.ts); aqui qualquer coisa fora do
// formato cai no mapa vazio, que faz deriveProgress usar os nomes de código.
// Um throw neste ponto seria 500 em GET /me/garage e GET /g/:slug.
const loose = z.object(
  Object.fromEntries(RANK_KEYS.map((k) => [k, z.string().min(1).optional()])) as Record<
    (typeof RANK_KEYS)[number],
    z.ZodOptional<z.ZodString>
  >,
);

export const readRankNames = async (client: ReadClient = prisma): Promise<RankNames> => {
  const row = await client.generalSettings.findUnique({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    select: { rankNames: true },
  });
  if (!row?.rankNames) return {};
  const parsed = loose.safeParse(row.rankNames);
  if (!parsed.success) return {};
  // `exactOptionalPropertyTypes` treats `{ key: undefined }` differently from
  // an absent key. Zod's `.optional()` yields the former for missing input
  // keys; strip them so the result actually satisfies `RankNames`.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as RankNames;
};
