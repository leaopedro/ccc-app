import { prisma } from '@ccc/db';
import {
  adminBoxSettingsSchema,
  adminBoxSettingsUpdateSchema,
  BOX_SETTINGS_SINGLETON_ID,
} from '@ccc/shared/admin-box';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

type Row = Prisma.BoxSettingsGetPayload<Record<string, never>>;

const serialize = (row: Row) => ({
  boxEnabled: row.boxEnabled,
  cutoffDaysBeforeRenewal: row.cutoffDaysBeforeRenewal,
  headerTitle: row.headerTitle,
  headerSubtitle: row.headerSubtitle,
  freeShippingCepRanges: adminBoxSettingsSchema.shape.freeShippingCepRanges.parse(
    row.freeShippingCepRanges,
  ),
  shippingFeeCents: row.shippingFeeCents,
});

// Singleton row keyed by a fixed id, mirrors StoreSettings/GeneralSettings.
// Upsert makes concurrent first requests race-safe (no duplicate rows).
const getOrCreate = async (): Promise<Row> =>
  prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: {},
    create: { id: BOX_SETTINGS_SINGLETON_ID },
  });

export const adminBoxSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/settings', async (_request, reply) => {
    const row = await getOrCreate();
    return reply.send(adminBoxSettingsSchema.parse(serialize(row)));
  });

  app.put('/box/settings', async (request, reply) => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    await getOrCreate();
    const data: Prisma.BoxSettingsUpdateInput = {};
    if (input.boxEnabled !== undefined) data.boxEnabled = input.boxEnabled;
    if (input.cutoffDaysBeforeRenewal !== undefined)
      data.cutoffDaysBeforeRenewal = input.cutoffDaysBeforeRenewal;
    if (input.headerTitle !== undefined) data.headerTitle = input.headerTitle;
    if (input.headerSubtitle !== undefined) data.headerSubtitle = input.headerSubtitle;
    if (input.freeShippingCepRanges !== undefined)
      data.freeShippingCepRanges = input.freeShippingCepRanges as Prisma.InputJsonValue;
    if (input.shippingFeeCents !== undefined) data.shippingFeeCents = input.shippingFeeCents;
    const updated = await prisma.boxSettings.update({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      data,
    });
    return reply.send(adminBoxSettingsSchema.parse(serialize(updated)));
  });
};
