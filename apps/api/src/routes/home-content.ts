/**
 * home-content route — READ side do conteúdo institucional da tela de Início.
 *
 *   GET /api/home-content — hero, institucional, benefícios, destaques, planos
 *
 * UNAUTHED, como os outros catálogos de leitura (premium-catalog.ts, store.ts).
 * A Início é a primeira tela do app e roda antes do login.
 *
 * Sem cache em memória de propósito: o critério de aceite é conteúdo editável
 * no banco surtindo efeito sem republicar o app, e um TTL atrasaria isso. Se
 * virar problema de carga, o cache entra junto com o CRUD admin, que é quem
 * sabe invalidar.
 *
 * Uma request devolve a tela inteira. Ids de provider (stripePriceId,
 * rcProductId) ficam nas linhas do banco e nunca são serializados.
 */

import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import { HOME_PLAN_BENEFITS_LIMIT, homeContentResponseSchema } from '@ccc/shared/home';
import type {
  PremiumPlan as DbPremiumPlan,
  PremiumPlanBenefit as DbPremiumPlanBenefit,
  PremiumPlanPrice as DbPremiumPlanPrice,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { ensureHomeContent } from '../services/home-content.js';

type PlanWithRelations = DbPremiumPlan & {
  prices: DbPremiumPlanPrice[];
  benefits: DbPremiumPlanBenefit[];
};

/**
 * Linha de preço mensal ativa do plano, se houver. Devolve a linha inteira, e
 * não só o valor, para que a moeda serializada seja a do preço escolhido.
 *
 * Restrito a `cadence === 'monthly'` de propósito: `fromAmountCents` vira
 * "/MÊS" hardcoded em PlansSection.tsx, e `homePlanSchema` não carrega
 * `cadence` para o cliente distinguir. Reduzir sobre todas as cadências
 * (monthly e annual) escolheria o menor valor NUMÉRICO ignorando o período —
 * um plano anual de R$1.490,00/ano apareceria como "R$1.490,00 /MÊS", um erro
 * de precificação pública de 12x. Um plano sem preço mensal ativo fica de
 * fora da resposta, mesmo padrão de um plano sem preço ativo nenhum.
 */
const cheapestMonthlyPrice = (plan: PlanWithRelations): DbPremiumPlanPrice | null =>
  plan.prices.reduce<DbPremiumPlanPrice | null>(
    (best, price) =>
      price.cadence === 'monthly' && (best === null || price.baseAmountCents < best.baseAmountCents)
        ? price
        : best,
    null,
  );

export const homeContentRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `home-content:${req.ip}`,
  });

  app.get('/api/home-content', async () => {
    const [content, benefits, highlights, plans] = await Promise.all([
      ensureHomeContent(),
      prisma.homeBenefit.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.homeHighlight.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.premiumPlan.findMany({
        where: { active: true, homeFeatured: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          // No orderBy here: @@unique([planId, cadence]) caps this relation
          // at one active row per cadence, so at most one row ever matches
          // the monthly filter below — order can't change which one wins.
          prices: { where: { active: true } },
          benefits: { orderBy: { sortOrder: 'asc' } },
        },
      }),
    ]);

    const mediaUrl = (key: string | null): string | null =>
      key ? app.uploads.buildPublicUrl(key) : null;

    const serializedPlans = plans.flatMap((plan) => {
      const price = cheapestMonthlyPrice(plan);
      // Plano sem preço mensal ativo não tem "valor inicial" para mostrar
      // (ver comentário de cheapestMonthlyPrice). Fica fora em vez de
      // renderizar um card sem preço, ou um preço anual com "/MÊS" errado.
      if (price === null) return [];
      return [
        {
          tier: plan.tier,
          slug: plan.slug,
          name: plan.name,
          description: plan.description,
          fromAmountCents: price.baseAmountCents,
          currency: price.currency,
          benefits: plan.benefits.slice(0, HOME_PLAN_BENEFITS_LIMIT).map((b) => b.label),
          sortOrder: plan.sortOrder,
        },
      ];
    });

    return homeContentResponseSchema.parse({
      hero: {
        title: content.heroTitle,
        subtitle: content.heroSubtitle,
        bannerUrl: mediaUrl(content.heroBannerObjectKey),
      },
      institutional: {
        title: content.institutionalTitle,
        body: content.institutionalBody,
        imageUrl: mediaUrl(content.institutionalImageObjectKey),
      },
      benefits: benefits.map((b) => ({
        icon: b.icon,
        title: b.title,
        description: b.description,
        sortOrder: b.sortOrder,
      })),
      highlights: highlights.map((h) => ({
        kind: h.kind,
        title: h.title,
        subtitle: h.subtitle,
        imageUrl: mediaUrl(h.imageObjectKey),
        linkPath: h.linkPath,
        sortOrder: h.sortOrder,
      })),
      plans: serializedPlans,
    });
  });
};
