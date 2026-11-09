import { presaleCampaignSchema, presaleProductListResponseSchema } from '@ccc/shared/presale';
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

import {
  createPresaleProduct,
  setPresaleEnabled,
  setPresaleSettings,
  setStoreEnabled,
} from './fixtures.js';

describe('GET /presale/casa-in-box/campaign e /products', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    // PresaleSettings não é limpa por resetDatabase (tabela da Task 6, fora do
    // escopo compartilhado de test/helpers.ts): zera aqui para cada teste
    // começar sem a linha de uma prova anterior.
    await prisma.presaleSettings.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('503 nas duas rotas quando a campanha está desligada', async () => {
    for (const url of ['/presale/casa-in-box/campaign', '/presale/casa-in-box/products']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });
    }
  });

  it('não é desligada pelo storeEnabled da loja', async () => {
    await setPresaleEnabled(true);
    await setStoreEnabled(false);

    const res = await app.inject({ method: 'GET', url: '/presale/casa-in-box/products' });
    expect(res.statusCode).toBe(200);
  });

  it('devolve só os produtos elegíveis', async () => {
    await setPresaleEnabled(true);
    const eligible = await createPresaleProduct();
    await createPresaleProduct({ visibleInPresale: false });

    const res = await app.inject({ method: 'GET', url: '/presale/casa-in-box/products' });
    expect(res.statusCode).toBe(200);
    const body = presaleProductListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(eligible.id);
  });

  it('campaign devolve os dados comerciais da campanha', async () => {
    await setPresaleSettings({
      enabled: true,
      shippingFeeCents: 1990,
      deliveryAreaLabel: 'Grande São Paulo',
      pickupAddress: 'Pocket CASA, Rua Augusta 123',
      pickupHours: 'seg a sex, 9h às 18h',
      firstBatchLabel: '1º lote',
      deliveryCepRanges: [{ from: '01000000', to: '05999999' }],
    });

    const res = await app.inject({ method: 'GET', url: '/presale/casa-in-box/campaign' });
    expect(res.statusCode).toBe(200);
    const raw = res.json();
    expect(raw).not.toHaveProperty('deliveryCepRanges');

    const body = presaleCampaignSchema.parse(raw);
    expect(body).toEqual({
      enabled: true,
      shippingFeeCents: 1990,
      deliveryAreaLabel: 'Grande São Paulo',
      pickupAddress: 'Pocket CASA, Rua Augusta 123',
      pickupHours: 'seg a sex, 9h às 18h',
      firstBatchLabel: '1º lote',
    });
  });

  it('não exige autenticação', async () => {
    await setPresaleEnabled(true);

    const res = await app.inject({ method: 'GET', url: '/presale/casa-in-box/products' });
    expect(res.statusCode).toBe(200);
    expect(res.statusCode).not.toBe(401);
  });
});
