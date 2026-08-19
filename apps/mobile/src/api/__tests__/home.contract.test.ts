import { homeContentResponseSchema } from '@ccc/shared/home';
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
    expect(parsed.plans[0]!.benefits).toHaveLength(3);
    expect(parsed.highlights[0]!.kind).toBe('day_use');
  });
});
