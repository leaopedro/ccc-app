import { HOME_PLAN_BENEFITS_LIMIT, homeContentResponseSchema } from '@ccc/shared/home';
import { describe, expect, it } from 'vitest';

// Fixture no formato exato que apps/api/src/routes/home-content.ts serializa.
// Se o backend mudar de forma, este teste quebra antes da tela.
const HOME_FIXTURE = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: null,
    bannerUrl: 'https://cdn.example.com/home/banner.webp',
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: null,
  },
  benefits: [
    {
      icon: 'calendar',
      title: 'Eventos exclusivos',
      description: 'Encontros fechados.',
      sortOrder: 0,
    },
  ],
  highlights: [
    {
      kind: 'day_use',
      title: 'Day Use',
      subtitle: 'Um dia na sede.',
      imageUrl: null,
      linkPath: null,
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado', 'Vaga na garagem', 'Caixa mensal'],
      sortOrder: 0,
    },
  ],
} as const;

describe('GET /api/home-content contract', () => {
  it('parses the serialized backend shape', () => {
    const parsed = homeContentResponseSchema.parse(HOME_FIXTURE);
    // Referencia a mesma constante que o backend usa para truncar
    // (apps/api/src/routes/home-content.ts:90), não um literal solto: se
    // HOME_PLAN_BENEFITS_LIMIT mudar, a fixture teria que mudar junto para
    // este assert continuar fazendo sentido, então não fingimos pinar um
    // limite que o schema em si não impõe.
    expect(parsed.plans.map((plan) => plan.benefits.length)).toEqual([HOME_PLAN_BENEFITS_LIMIT]);
  });

  it('strips unknown keys from a plan instead of passing them through', () => {
    const withExtraField = {
      ...HOME_FIXTURE,
      plans: [{ ...HOME_FIXTURE.plans[0], unexpectedField: 'nope' }],
    };
    const parsed = homeContentResponseSchema.parse(withExtraField);
    expect(parsed.plans[0]).not.toHaveProperty('unexpectedField');
  });

  it('rejects a highlight with a kind outside the enum', () => {
    const invalidKind = {
      ...HOME_FIXTURE,
      highlights: [{ ...HOME_FIXTURE.highlights[0], kind: 'not-a-real-kind' }],
    };
    const result = homeContentResponseSchema.safeParse(invalidKind);
    expect(result.success).toBe(false);
  });

  it('rejects an empty hero title', () => {
    const emptyTitle = {
      ...HOME_FIXTURE,
      hero: { ...HOME_FIXTURE.hero, title: '' },
    };
    const result = homeContentResponseSchema.safeParse(emptyTitle);
    expect(result.success).toBe(false);
  });
});
