import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import type { Badge } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { readGamificationEnabled } from '../services/garage/killswitch.js';

// Module-level catalog cache. O catálogo passou a ser mutável pelo admin
// (PUT /admin/gamification/copy), então o TTL não é mais seguro por premissa:
// aquele handler chama invalidateBadgesCatalogCache() depois de commitar. O
// killswitch continua fora do cache — ele MUST propagar em < 1s.
const TTL_MS = 5 * 60 * 1000;
let cached: Badge[] | null = null;
let cachedAt = 0;

/**
 * Drop the in-memory catalog cache. Called by admin PUT handlers after a
 * successful write touches catalog-affecting state (e.g. `gamificationEnabled`
 * or the badge copy), so the next read sees fresh state. Safe to call when
 * the cache is already empty.
 */
export const invalidateBadgesCatalogCache = (): void => {
  cached = null;
  cachedAt = 0;
};

export const badgesCatalogRoute: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `badges-catalog:${req.ip}`,
  });

  app.get('/badges/catalog', async () => {
    const enabled = await readGamificationEnabled();
    if (!enabled) return { enabled: false, catalog: [] };

    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      cached = await prisma.badge.findMany({ orderBy: { code: 'asc' } });
      cachedAt = now;
    }

    return {
      enabled: true,
      catalog: cached.map((b) => ({
        code: b.code,
        category: b.category,
        rarity: b.rarity,
        premiumExclusive: b.premiumExclusive,
        icon: b.icon,
        title: b.title,
        description: b.description,
      })),
    };
  });
};
