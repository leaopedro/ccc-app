import { prisma } from '@ccc/db';
import { clubStatsResponseSchema } from '@ccc/shared/club-stats';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invalidateClubStatsCache } from '../src/routes/club-stats.js';

import { createUser, makeApp, resetDatabase } from './helpers.js';

const GET = { method: 'GET' as const, url: '/api/club-stats' };

// Datas fixas de proposito. A contagem de eventos depende de "futuro", entao
// uma fixture com Date.now() ficaria fragil na virada do dia.
const PAST = new Date('2026-01-10T20:00:00.000Z');
const PAST_END = new Date('2026-01-11T02:00:00.000Z');
const FUTURE = new Date('2099-01-10T20:00:00.000Z');
const FUTURE_END = new Date('2099-01-11T02:00:00.000Z');

const makeEvent = (slug: string, startsAt: Date, endsAt: Date, status: 'published' | 'draft') =>
  prisma.event.create({
    data: {
      slug,
      title: `Evento ${slug}`,
      description: 'd',
      startsAt,
      endsAt,
      venueName: 'Sede',
      venueAddress: 'Rua A, 1',
      city: 'Curitiba',
      stateCode: 'PR',
      type: 'meeting',
      status,
      capacity: 100,
      ...(status === 'published' ? { publishedAt: PAST } : {}),
    },
  });

describe('GET /api/club-stats', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateClubStatsCache();
    app = await makeApp();
  });

  afterEach(async () => {
    invalidateClubStatsCache();
    await app.close();
  });

  it('responds 200 without auth and satisfies the shared schema', async () => {
    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    expect(() => clubStatsResponseSchema.parse(res.json())).not.toThrow();
  });

  it('returns zeros on an empty database', async () => {
    const res = await app.inject(GET);
    expect(clubStatsResponseSchema.parse(res.json())).toEqual({
      members: 0,
      events: 0,
      cars: 0,
    });
  });

  it('counts only future published events', async () => {
    await makeEvent('futuro-publicado', FUTURE, FUTURE_END, 'published');
    await makeEvent('passado-publicado', PAST, PAST_END, 'published');
    await makeEvent('futuro-rascunho', FUTURE, FUTURE_END, 'draft');

    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    const body = clubStatsResponseSchema.parse(res.json());
    expect(body.events).toBe(1);
  });

  it('counts active members and cars', async () => {
    const { user } = await createUser({ verified: true });
    // nickname e obrigatorio e unico no modelo Car (Step 1); nao assumido no brief original.
    await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1999, nickname: 'skyline-1' },
    });

    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    const body = clubStatsResponseSchema.parse(res.json());
    expect(body.members).toBe(1);
    expect(body.cars).toBe(1);
  });

  it('serves the cached payload on a second call within the TTL', async () => {
    const first = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(first.cars).toBe(0);

    const { user } = await createUser({ verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 1992, nickname: 'nsx-1' },
    });

    // Dentro do TTL, o cache ainda serve a contagem antiga. Isso e o
    // comportamento pretendido, nao um bug.
    const second = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(second.cars).toBe(0);

    // Invalidado, a proxima leitura ve o carro novo. Isso prova que o valor
    // antigo veio do cache e nao de uma query errada.
    invalidateClubStatsCache();
    const third = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(third.cars).toBe(1);
  });
});
