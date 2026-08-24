// packages/shared/src/home.ts
// Tela de Início — schemas de leitura do conteúdo institucional.
// Backs GET /api/home-content.
//
// Client-facing ONLY. As colunas do banco guardam objectKey de R2; o backend
// resolve para URL pública antes de serializar, então o cliente nunca vê chave
// de objeto. Ids de provider de pagamento não entram aqui, igual
// ./premium-catalog.ts.

import { z } from 'zod';

/** Id da linha única de HomeContent. Espelhado em packages/db/prisma/seed.ts. */
export const HOME_CONTENT_SINGLETON_ID = 'home_default';

/** Quantos benefícios de plano o resumo da home carrega. */
export const HOME_PLAN_BENEFITS_LIMIT = 3;

/**
 * Tipo do destaque da Seção 6. Espelha o enum HomeHighlightKind do Prisma.
 * `day_use` e `experience` não têm modelo de domínio próprio; são conteúdo
 * curado.
 */
export const homeHighlightKindSchema = z.enum(['event', 'day_use', 'experience', 'partner']);
export type HomeHighlightKind = z.infer<typeof homeHighlightKindSchema>;

/** Seção 1 — banner principal e mote. */
export const homeHeroSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  bannerUrl: z.string().url().nullable(),
});
export type HomeHero = z.infer<typeof homeHeroSchema>;

/** Seção 1 — bloco institucional. */
export const homeInstitutionalSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  imageUrl: z.string().url().nullable(),
});
export type HomeInstitutional = z.infer<typeof homeInstitutionalSchema>;

/** Seção 2 — um benefício da assinatura. `icon` é chave resolvida no cliente. */
export const homeBenefitSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type HomeBenefit = z.infer<typeof homeBenefitSchema>;

/** Seção 6 — um destaque. `linkPath` nulo significa card não clicável. */
export const homeHighlightSchema = z.object({
  kind: homeHighlightKindSchema,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  linkPath: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type HomeHighlight = z.infer<typeof homeHighlightSchema>;

/**
 * Seção 5 — resumo de um plano. Derivado de PremiumPlan.
 * `fromAmountCents` é o menor preço ativo do plano, o "valor inicial" da
 * Story. `benefits` vem truncado em HOME_PLAN_BENEFITS_LIMIT; o detalhe
 * completo continua em GET /api/plans.
 */
export const homePlanSchema = z.object({
  tier: z.enum(['bronze', 'silver', 'gold']),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  fromAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  benefits: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type HomePlan = z.infer<typeof homePlanSchema>;

/** GET /api/home-content — resposta completa, uma request por tela. */
export const homeContentResponseSchema = z.object({
  hero: homeHeroSchema,
  institutional: homeInstitutionalSchema,
  benefits: z.array(homeBenefitSchema),
  highlights: z.array(homeHighlightSchema),
  plans: z.array(homePlanSchema),
});
export type HomeContentResponse = z.infer<typeof homeContentResponseSchema>;
