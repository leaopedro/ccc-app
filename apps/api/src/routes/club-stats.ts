/**
 * club-stats route — contadores agregados do clube.
 *
 *   GET /api/club-stats — { members, events, cars }
 *
 * UNAUTHED, como os outros catalogos de leitura (premium-catalog.ts, store.ts).
 * A secao "Status do clube" da tela de Inicio aparece nos dois estados, logado
 * e anonimo, entao o mesmo payload serve os dois.
 *
 * COM cache em memoria, ao contrario de /api/home-content. Aqui o cache e
 * correto: sao tres COUNT em tabelas que crescem, chamados na tela mais
 * acessada do app, e um contador defasado por cinco minutos nao muda decisao
 * de ninguem. Conteudo institucional editavel e o oposto, e por isso a outra
 * rota nao tem cache. Mesmo idiom de badges-catalog.ts.
 */

import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import { clubStatsResponseSchema, type ClubStatsResponse } from '@ccc/shared/club-stats';
import type { FastifyPluginAsync } from 'fastify';

export const CLUB_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

let cached: ClubStatsResponse | null = null;
let cachedAt = 0;

/**
 * Descarta o cache em memoria. Existe para os testes controlarem o estado
 * entre casos, e para um futuro handler admin invalidar depois de uma escrita
 * que mude as contagens. Seguro chamar com o cache vazio.
 */
export const invalidateClubStatsCache = (): void => {
  cached = null;
  cachedAt = 0;
};

export const clubStatsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `club-stats:${req.ip}`,
  });

  app.get('/api/club-stats', async () => {
    const now = Date.now();
    if (cached && now - cachedAt <= CLUB_STATS_CACHE_TTL_MS) return cached;

    const [members, events, cars] = await Promise.all([
      prisma.user.count({ where: { status: 'active' } }),
      prisma.event.count({ where: { status: 'published', startsAt: { gte: new Date() } } }),
      prisma.car.count(),
    ]);

    cached = clubStatsResponseSchema.parse({ members, events, cars });
    cachedAt = now;
    return cached;
  });
};
