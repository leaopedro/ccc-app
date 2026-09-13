import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { awardBadge } from '../../src/services/garage/awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Regressão: um award repetido não pode levar junto a escrita do chamador.
//
// `awardBadge` engole o P2002 do unique (garageId, badgeCode) e devolve
// `already_earned`. Só que o INSERT que falhou já deixou a transação do
// Postgres em 25P02 (in_failed_sql_transaction): todo comando seguinte falha e
// o COMMIT vira ROLLBACK em silêncio. O chamador recebe `{ awarded: false }`,
// acha que está tudo bem, e perde a própria escrita — sem erro nenhum.
//
// `awardXp` já se protegia com SAVEPOINT e documenta exatamente esta falha;
// `awardBadge` foi escrito sem. Como todo hook reavalia a superfície inteira a
// cada escrita (o segundo carro re-pontua CAR-001, o segundo comentário
// re-pontua COM-004), o caminho repetido é o NORMAL, não o raro.
//
// Em produção isto estava mascarado porque a tabela Badge está vazia: o
// awarder lança `unknown badge` antes de chegar no INSERT. A migration que
// semeia o catálogo tira a máscara.

describe('awardBadge não envenena a transação do chamador', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await prisma.badge.createMany({
      data: [
        {
          code: 'EVT-001',
          category: 'eventos',
          rarity: 'common',
          icon: 'flag',
          title: 'Primeira Largada',
          description: 'd',
          criteria: 'c',
        },
        {
          code: 'CAR-001',
          category: 'carros',
          rarity: 'common',
          icon: 'car',
          title: 'Garagem Aberta',
          description: 'd',
          criteria: 'c',
        },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('a escrita do chamador sobrevive ao commit depois de um award repetido', async () => {
    const { user } = await createUser({ email: 'savepoint@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    await prisma.$transaction(async (tx) => {
      await awardBadge(tx, garage.id, 'EVT-001', 'primeira');
    });

    await prisma.$transaction(async (tx) => {
      await tx.car.create({
        data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2000, nickname: 'sobrevive' },
      });
      const outcome = await awardBadge(tx, garage.id, 'EVT-001', 'segunda');
      expect(outcome).toEqual({ awarded: false, reason: 'already_earned' });
    });

    expect(await prisma.car.count({ where: { userId: user.id } })).toBe(1);
  });

  it('a transação segue utilizável depois do award repetido', async () => {
    // Não basta o commit não sumir com o que veio antes: o que vem DEPOIS do
    // award repetido, dentro da mesma transação, também precisa gravar.
    const { user } = await createUser({ email: 'savepoint2@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    await prisma.$transaction(async (tx) => {
      await awardBadge(tx, garage.id, 'EVT-001', 'primeira');
    });

    await prisma.$transaction(async (tx) => {
      await awardBadge(tx, garage.id, 'EVT-001', 'segunda');
      await tx.car.create({
        data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2001, nickname: 'depois' },
      });
    });

    expect(await prisma.car.count({ where: { userId: user.id } })).toBe(1);
  });

  it('POST /me/cars duas vezes grava os dois carros', async () => {
    // O caso real: a elegibilidade devolve CAR-001 em todo carro a partir do
    // primeiro, então o segundo POST sempre re-pontua. Com o catálogo semeado
    // e sem o savepoint, este endpoint responde 500 e o carro some.
    const { user } = await createUser({ email: 'savepoint-cars@jdm.test', verified: true });
    const auth = { authorization: bearer(loadEnv(), user.id) };

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: auth,
        payload: {
          make: 'Honda',
          model: 'Civic',
          year: 1999 + i,
          nickname: `carro ${i}`,
          modifications: [],
        },
      });
      expect(res.statusCode).toBe(201);
    }

    expect(await prisma.car.count({ where: { userId: user.id } })).toBe(2);
  });
});
