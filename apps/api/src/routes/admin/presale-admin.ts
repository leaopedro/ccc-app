import { prisma, ensurePresaleSystemUser } from '@ccc/db';
import { adminPresaleSettingsSchema, adminPresaleSettingsUpdateSchema } from '@ccc/shared/admin';
import { PRESALE_SETTINGS_SINGLETON_ID } from '@ccc/shared/presale';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

type Row = Prisma.PresaleSettingsGetPayload<Record<string, never>>;

const ordersQuerySchema = z.object({
  email: z.string().optional(),
});

const serialize = (row: Row) => ({
  enabled: row.enabled,
  pickupAddress: row.pickupAddress,
  pickupHours: row.pickupHours,
  deliveryAreaLabel: row.deliveryAreaLabel,
  deliveryCepRanges: adminPresaleSettingsSchema.shape.deliveryCepRanges.parse(
    row.deliveryCepRanges,
  ),
  shippingFeeCents: row.shippingFeeCents,
  firstBatchLabel: row.firstBatchLabel,
});

// Singleton row keyed by a fixed id, same pattern as StoreSettings/BoxSettings.
// Upsert makes concurrent first requests race-safe (no duplicate rows).
const getOrCreate = async (): Promise<Row> =>
  prisma.presaleSettings.upsert({
    where: { id: PRESALE_SETTINGS_SINGLETON_ID },
    update: {},
    create: { id: PRESALE_SETTINGS_SINGLETON_ID },
  });

export const adminPresaleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/presale/settings', async (_request, reply) => {
    const row = await getOrCreate();
    return reply.send(adminPresaleSettingsSchema.parse(serialize(row)));
  });

  app.patch('/presale/settings', async (request, reply) => {
    const parsed = adminPresaleSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    await getOrCreate();
    const data: Prisma.PresaleSettingsUpdateInput = {};
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.pickupAddress !== undefined) data.pickupAddress = input.pickupAddress;
    if (input.pickupHours !== undefined) data.pickupHours = input.pickupHours;
    if (input.deliveryAreaLabel !== undefined) data.deliveryAreaLabel = input.deliveryAreaLabel;
    if (input.deliveryCepRanges !== undefined)
      data.deliveryCepRanges = input.deliveryCepRanges as Prisma.InputJsonValue;
    if (input.shippingFeeCents !== undefined) data.shippingFeeCents = input.shippingFeeCents;
    if (input.firstBatchLabel !== undefined) data.firstBatchLabel = input.firstBatchLabel;
    const updated = await prisma.presaleSettings.update({
      where: { id: PRESALE_SETTINGS_SINGLETON_ID },
      data,
    });
    return reply.send(adminPresaleSettingsSchema.parse(serialize(updated)));
  });

  app.get('/presale/orders', async (request, reply) => {
    const query = ordersQuerySchema.safeParse(request.query);
    const email = query.success ? query.data.email : undefined;
    if (typeof email !== 'string' || !email.trim()) {
      return reply.status(400).send({ error: 'Email query parameter required' });
    }

    const systemUserId = await ensurePresaleSystemUser();

    const orders = await prisma.order.findMany({
      where: {
        userId: systemUserId,
        origin: 'casa_in_box',
        presaleGuest: {
          email: {
            equals: email.trim(),
            mode: 'insensitive',
          },
        },
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        presaleGuest: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      orders: orders.map((o) => ({
        ...o,
        shortId: o.id.slice(-8).toUpperCase(),
      })),
    });
  });
};
