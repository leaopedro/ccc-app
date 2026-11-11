import { storeProductListResponseSchema } from '@ccc/shared/store';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEligiblePresaleProducts } from '../../src/services/presale/eligibility.js';
import { serializePresaleProduct } from '../../src/services/presale/serialize.js';
import { DevUploads } from '../../src/services/uploads/index.js';
import { makeApp, resetDatabase } from '../helpers.js';

import { createPresaleProduct } from './fixtures.js';

const body = (res: { json: () => unknown }) => storeProductListResponseSchema.parse(res.json());

describe('loadEligiblePresaleProducts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each([
    ['flag desmarcado', { visibleInPresale: false }],
    ['status draft', { status: 'draft' }],
    ['status archived', { status: 'archived' }],
    ['produto virtual', { virtual: true }],
    ['moeda não-BRL', { currency: 'USD' }],
  ] as const)('exclui %s', async (_label, patch) => {
    await createPresaleProduct(patch);
    await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
  });

  it('exclui produto sem nenhuma foto', async () => {
    await createPresaleProduct({}, { photos: [] });
    await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
  });

  it('exclui produto cujas variantes estão todas inativas', async () => {
    await createPresaleProduct({}, { variants: [{ active: false }] });
    await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
  });

  it('inclui o produto elegível e serializa sem preço de display', async () => {
    await createPresaleProduct();
    const [row] = await loadEligiblePresaleProducts();
    expect(row).toBeDefined();

    const out = serializePresaleProduct(row!, new DevUploads());
    expect(out).not.toHaveProperty('displayPriceCents');
    expect(out).not.toHaveProperty('devFeePercent');
    expect(out.variants[0]).not.toHaveProperty('displayPriceCents');
    expect(out.variants[0]).not.toHaveProperty('devFeePercent');
    expect(out.variants[0]!.priceCents).toBe(9900);
  });
});

// O outro lado da divergência deliberada. Sem este teste, uma refatoração
// futura "conserta" a pré-venda somando a taxa, ou tira a taxa da loja, e
// nada acusa. DEV_FEE_PERCENT tem default 10 em apps/api/src/env.ts:67.
describe('divergência de preço entre loja e pré-venda', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('a loja continua somando a taxa no mesmo produto', async () => {
    await createPresaleProduct();

    const res = await app.inject({ method: 'GET', url: '/store/products' });
    expect(res.statusCode).toBe(200);
    const range = body(res).items[0]!.priceRange;
    expect(range.minPriceCents).toBe(9900);
    expect(range.minDisplayPriceCents).toBe(10890);
  });
});
