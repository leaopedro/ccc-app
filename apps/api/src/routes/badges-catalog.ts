import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import type { Badge } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { readGamificationEnabled } from '../services/garage/killswitch.js';

// Module-level catalog cache. The badge catalog is immutable at runtime
// (seeded once, never mutated by an API path), so a coarse TTL is safe.
// The killswitch is NOT cached — it MUST propagate in < 1s per kickoff lock.
const TTL_MS = 5 * 60 * 1000;
let cached: Badge[] | null = null;
let cachedAt = 0;

/**
 * Drop the in-memory catalog cache. Called from the admin general-settings
 * PUT handler after a successful write touches `gamificationEnabled`, so the
 * next read sees fresh state. Safe to call when the cache is already empty.
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
      })),
    };
  });
};
