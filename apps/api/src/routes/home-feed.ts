/**
 * home-feed route — posts sorteados de eventos públicos, para a tela de Início.
 *
 *   GET /api/home-feed
 *
 * UNAUTHED como /api/home-content: a Início roda antes do login. Usa tryAuth,
 * não authenticate, só para conseguir aplicar os filtros de bloqueio e ban de
 * quem por acaso está logado.
 *
 * Sem query param de quantidade de propósito. O número vem de
 * HomeContent.feedPostCount, então a configuração fica num lugar só e a URL
 * não vira um jeito de pedir a tabela inteira.
 */

import { prisma } from '@ccc/db';
import { HOME_FEED_POOL_SIZE, homeFeedResponseSchema } from '@ccc/shared/feed';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { blockedUserIdsFor } from '../services/feed/blocks.js';
import { POST_SELECT, serializeFeedPost } from '../services/feed/serialize.js';
import { ensureHomeContent } from '../services/home-content.js';

/** Fisher-Yates sobre uma cópia. */
const shuffle = <T>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

export const homeFeedRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    // Teto alto de propósito, no molde de premium-catalog.ts:78-95. trustProxy
    // NÃO está ligado em app.ts:98, então atrás do Railway `req.ip` é o
    // endereço do proxy para todo caller e a chave por IP colapsa num balde
    // global: com 60/min, 61 pessoas abrindo o app no mesmo minuto derrubariam
    // a seção para a frota inteira. Chaveamos por usuário quando há sessão,
    // que é o único identificador confiável hoje.
    max: 6000,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `home-feed:${req.user?.sub ?? req.ip}`,
  });

  app.get('/api/home-feed', { preHandler: [app.tryAuth] }, async (request, reply) => {
    const userId = request.user?.sub ?? null;

    // Quatro leituras independentes; nenhuma depende da outra.
    const [content, eligibleEvents, blockedIds, viewBans] = await Promise.all([
      ensureHomeContent(),
      prisma.event.findMany({
        where: { status: 'published', feedEnabled: true, feedAccess: 'public' },
        select: { id: true },
      }),
      blockedUserIdsFor(userId),
      userId
        ? prisma.feedBan.findMany({ where: { userId, scope: 'view' }, select: { eventId: true } })
        : Promise.resolve([] as { eventId: string }[]),
    ]);

    const bannedForReader = new Set(viewBans.map((b) => b.eventId));
    const eventIds = eligibleEvents.map((e) => e.id).filter((id) => !bannedForReader.has(id));

    if (content.feedPostCount <= 0 || eventIds.length === 0) {
      return reply.status(200).send(homeFeedResponseSchema.parse({ posts: [] }));
    }

    // `eventId: { in: [...] }` em vez de `where.event.feedAccess: 'public'`.
    // Medido em Postgres 16 com 400k posts: o filtro relacional vira um
    // semi-join que varre o índice [status, createdAt] de trás para frente
    // procurando 50 linhas que casem — 392 mil linhas e 9.127 buffers quando
    // não há nenhum evento público, que é o estado inicial desta feature. Com
    // a lista de ids o planner usa [eventId, createdAt desc]: 63 buffers.
    const pool = await prisma.feedPost.findMany({
      where: {
        status: 'visible',
        eventId: { in: eventIds },
        // Conta apagada: anonymize.ts:107 preserva o body e anula o autor. No
        // feed do evento isso mantém a thread íntegra; aqui viraria promoção
        // do conteúdo de quem pediu eliminação, para anônimo, na primeira
        // tela do app. Ver "Conta apagada" no spec.
        //
        // O `notIn` do bloqueio mora na MESMA chave, então os dois vivem neste
        // objeto único. Perder o `not: null` aqui reintroduziria o problema do
        // `NULL NOT IN (...)` que routes/feed.ts:131-138 documenta.
        authorUserId: blockedIds.length > 0 ? { not: null, notIn: blockedIds } : { not: null },
        // Denúncia aberta: o auto-hide só dispara com 3 denunciantes distintos
        // (services/feed/report.ts:13). Dois é tolerável dentro do evento, não
        // na vitrine do app.
        reports: { none: { status: 'open' } },
      },
      select: { ...POST_SELECT, event: { select: { slug: true, title: true } } },
      // Ordenação total. Sem o desempate por id, dois posts com o mesmo
      // createdAt podem trocar de lugar entre requests e o corte do pool fica
      // não determinístico de um jeito que nenhum teste pega.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HOME_FEED_POOL_SIZE,
    });

    // Autor banido no evento onde postou. FeedBan não mexe em FeedPost.status
    // (routes/admin/feed-moderation.ts:245), então sem isto banir um
    // assediador deixa o conteúdo dele sendo promovido à primeira tela.
    // Filtrado depois do pool, não no where: é um par (eventId, authorUserId),
    // e o encolhimento é tolerável com pool de 50 e corte de 5.
    const authorIds = [
      ...new Set(pool.map((p) => p.authorUserId).filter((id): id is string => id !== null)),
    ];
    const authorBans = await prisma.feedBan.findMany({
      where: { eventId: { in: eventIds }, userId: { in: authorIds } },
      select: { eventId: true, userId: true },
    });
    const bannedPairs = new Set(authorBans.map((b) => `${b.eventId}:${b.userId}`));
    const eligible = pool.filter((p) => !bannedPairs.has(`${p.eventId}:${p.authorUserId ?? ''}`));

    const picked = shuffle(eligible).slice(0, content.feedPostCount);

    let myReactions = new Map<string, string>();
    if (userId && picked.length > 0) {
      const reactions = await prisma.feedReaction.findMany({
        where: { postId: { in: picked.map((p) => p.id) }, userId },
        select: { postId: true, kind: true },
      });
      myReactions = new Map(reactions.map((r) => [r.postId, r.kind]));
    }

    const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

    return reply.status(200).send(
      homeFeedResponseSchema.parse({
        posts: picked.map((p) => ({
          ...serializeFeedPost(p, {
            isOwn: userId !== null && p.authorUserId === userId,
            myReactions,
            buildUrl,
          }),
          event: { slug: p.event.slug, title: p.event.title },
        })),
      }),
    );
  });
};
