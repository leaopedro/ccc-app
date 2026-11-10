import { prisma, ensurePresaleSystemUser } from '@ccc/db';
import { adminOrderDetailSchema, adminPresaleSettingsSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import {
  createPresaleProduct,
  setPresaleEnabled,
  setPresaleSettings,
} from '../presale/fixtures.js';

const env = loadEnv();

const org = async () => {
  const { user } = await createUser({
    email: `org-${Date.now()}@jdm-test.local`,
    name: 'org',
    verified: true,
    role: 'organizer',
  });
  return bearer(env, user.id, 'organizer');
};

const admin = async () => {
  const { user } = await createUser({
    email: `admin-${Date.now()}@jdm-test.local`,
    name: 'admin',
    verified: true,
    role: 'admin',
  });
  return bearer(env, user.id, 'admin');
};

describe('presale admin', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('settings CRUD', () => {
    it('PATCH grava os dados comerciais e o GET devolve', async () => {
      const header = await org();

      // Lê defaults
      const getRes = await app.inject({
        method: 'GET',
        url: '/admin/presale/settings',
        headers: { authorization: header },
      });
      expect(getRes.statusCode).toBe(200);
      const defaults = adminPresaleSettingsSchema.parse(getRes.json());
      expect(defaults.enabled).toBe(false);
      expect(defaults.pickupAddress).toBeNull();

      // Escreve novos valores
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/admin/presale/settings',
        headers: { authorization: header },
        payload: {
          enabled: true,
          pickupAddress: 'Rua das Flores, 123',
          pickupHours: '10:00-18:00',
          deliveryAreaLabel: 'Porto Alegre e arredores',
          deliveryCepRanges: [{ start: '80000-000', end: '93800-999' }],
          shippingFeeCents: 1990,
          firstBatchLabel: 'Lote 1 - Novembro',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      const updated = adminPresaleSettingsSchema.parse(patchRes.json());
      expect(updated.enabled).toBe(true);
      expect(updated.pickupAddress).toBe('Rua das Flores, 123');
      expect(updated.shippingFeeCents).toBe(1990);
      expect(updated.deliveryCepRanges).toHaveLength(1);

      // Lê novamente e verifica persistência
      const getRes2 = await app.inject({
        method: 'GET',
        url: '/admin/presale/settings',
        headers: { authorization: header },
      });
      expect(getRes2.statusCode).toBe(200);
      const persisted = adminPresaleSettingsSchema.parse(getRes2.json());
      expect(persisted.enabled).toBe(true);
      expect(persisted.pickupAddress).toBe('Rua das Flores, 123');
    });

    it('rejeita PATCH sem admin/organizer', async () => {
      const { user } = await createUser({ email: `user-${Date.now()}@jdm.test`, role: 'user' });
      const userToken = bearer(env, user.id, 'user');

      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/presale/settings',
        headers: { authorization: userToken },
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('order search by email', () => {
    it('acha pedido de convidado em qualquer status', async () => {
      const header = await org();
      await setPresaleEnabled(true);
      const product = await createPresaleProduct();
      const systemUserId = await ensurePresaleSystemUser();

      const guestEmail = 'comprador@exemplo.com';

      // Cria pedidos em diferentes status, todos com mesmo email de convidado
      const pendingOrder = await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_pending_${Date.now()}`,
          status: 'pending',
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador',
              email: guestEmail,
              phone: '11999999999',
            },
          },
        },
      });

      const failedOrder = await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_failed_${Date.now()}`,
          status: 'failed',
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador',
              email: guestEmail,
              phone: '11999999999',
            },
          },
        },
      });

      const paidOrder = await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_paid_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador',
              email: guestEmail,
              phone: '11999999999',
            },
          },
        },
      });

      // Busca por email
      const searchRes = await app.inject({
        method: 'GET',
        url: `/admin/presale/orders?email=${encodeURIComponent(guestEmail)}`,
        headers: { authorization: header },
      });
      expect(searchRes.statusCode).toBe(200);
      const results = searchRes.json() as { orders: { id: string }[] };
      const ids = results.orders.map((o) => o.id);

      expect(ids).toContain(pendingOrder.id);
      expect(ids).toContain(failedOrder.id);
      expect(ids).toContain(paidOrder.id);
    });

    it('a busca não vaza pedido de outro email', async () => {
      const header = await org();
      await setPresaleEnabled(true);
      const product = await createPresaleProduct();
      const systemUserId = await ensurePresaleSystemUser();

      const guestEmail1 = 'comprador1@exemplo.com';
      const guestEmail2 = 'comprador2@exemplo.com';

      await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_1_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador1',
              email: guestEmail1,
            },
          },
        },
      });

      await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_2_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador2',
              email: guestEmail2,
            },
          },
        },
      });

      const searchRes = await app.inject({
        method: 'GET',
        url: `/admin/presale/orders?email=${encodeURIComponent(guestEmail1)}`,
        headers: { authorization: header },
      });
      expect(searchRes.statusCode).toBe(200);
      const results = searchRes.json() as {
        orders: { id: string; presaleGuest?: { email: string } }[];
      };

      expect(results.orders).toHaveLength(1);
      expect(results.orders[0]?.presaleGuest?.email).toBe(guestEmail1);
    });

    it('rejeita requisição sem admin/organizer', async () => {
      const { user } = await createUser({ email: `user-${Date.now()}@jdm.test`, role: 'user' });
      const userToken = bearer(env, user.id, 'user');

      const res = await app.inject({
        method: 'GET',
        url: `/admin/presale/orders?email=test@example.com`,
        headers: { authorization: userToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('order detail', () => {
    it('o detalhe do pedido traz origem e dados do convidado', async () => {
      const header = await admin();
      await setPresaleEnabled(true);
      const product = await createPresaleProduct();
      const systemUserId = await ensurePresaleSystemUser();

      const order = await prisma.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          amountCents: 9900,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'casa_in_box',
          items: {
            create: {
              kind: 'product',
              variantId: product.variants[0]!.id,
              quantity: 1,
              unitPriceCents: 9900,
              subtotalCents: 9900,
            },
          },
          presaleGuest: {
            create: {
              name: 'Comprador Teste',
              email: 'comprador@exemplo.com',
              phone: '11999999999',
              recipientName: 'Fulano de Tal',
              line1: 'Rua das Flores',
              number: '123',
              district: 'Centro',
              city: 'Porto Alegre',
              stateCode: 'RS',
              postalCode: '90010-000',
            },
          },
        },
      });

      const detailRes = await app.inject({
        method: 'GET',
        url: `/admin/orders/${order.id}`,
        headers: { authorization: header },
      });
      expect(detailRes.statusCode).toBe(200);
      const detail = adminOrderDetailSchema.parse(detailRes.json());

      expect(detail.origin).toBe('casa_in_box');
      expect(detail.presaleGuest).not.toBeNull();
      expect(detail.presaleGuest!.email).toBe('comprador@exemplo.com');
      expect(detail.presaleGuest!.name).toBe('Comprador Teste');
      expect(detail.presaleGuest!.recipientName).toBe('Fulano de Tal');
      expect(detail.presaleGuest!.city).toBe('Porto Alegre');
    });

    it('pedido normal continua sem presaleGuest e com origin app', async () => {
      const header = await admin();

      const { user: regularUser } = await createUser({
        email: `regular-user-${Date.now()}@jdm.test`,
        verified: true,
      });

      const order = await prisma.order.create({
        data: {
          userId: regularUser.id,
          kind: 'ticket',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_regular_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'app',
        },
      });

      const detailRes = await app.inject({
        method: 'GET',
        url: `/admin/orders/${order.id}`,
        headers: { authorization: header },
      });
      expect(detailRes.statusCode).toBe(200);
      const detail = adminOrderDetailSchema.parse(detailRes.json());

      expect(detail.origin).toBe('app');
      expect(detail.presaleGuest).toBeNull();
    });

    it('rejeita acesso sem admin/organizer', async () => {
      const { user: regularUser } = await createUser({
        email: `regular-user-${Date.now()}@jdm.test`,
        verified: true,
      });

      const order = await prisma.order.create({
        data: {
          userId: regularUser.id,
          kind: 'ticket',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_${Date.now()}`,
          status: 'paid',
          paidAt: new Date(),
          origin: 'app',
        },
      });

      const { user } = await createUser({
        email: `regular-user-${Date.now()}@jdm.test`,
        verified: true,
        role: 'user',
      });
      const userToken = bearer(env, user.id, 'user');

      const detailRes = await app.inject({
        method: 'GET',
        url: `/admin/orders/${order.id}`,
        headers: { authorization: userToken },
      });
      expect(detailRes.statusCode).toBe(403);
    });
  });

  describe('singleton row integrity', () => {
    it('keeps a single settings row under the fixed id', async () => {
      const header = await org();
      await app.inject({
        method: 'GET',
        url: '/admin/presale/settings',
        headers: { authorization: header },
      });
      await app.inject({
        method: 'GET',
        url: '/admin/presale/settings',
        headers: { authorization: header },
      });
      const rows = await prisma.presaleSettings.findMany();
      expect(rows).toHaveLength(1);
    });
  });
});
