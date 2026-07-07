import { prisma } from '@jdm/db';
import { STORE_SETTINGS_SINGLETON_ID, storeSettingsUpdateSchema } from '@jdm/shared/store';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { ensureStoreSettings } from '../../services/store-settings.js';

import { serializeAdminStoreSettings } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/store/settings', async () => {
    const settings = await ensureStoreSettings();
    return serializeAdminStoreSettings(settings);
  });

  app.put('/store/settings', async (request) => {
    const { sub } = requireUser(request);
    const input = storeSettingsUpdateSchema.parse(request.body);

    await ensureStoreSettings();

    const data: Prisma.StoreSettingsUpdateInput = {};
    if (input.storeEnabled !== undefined) {
      data.storeEnabled = input.storeEnabled;
    }
    if (input.defaultShippingFeeCents !== undefined) {
      data.defaultShippingFeeCents = input.defaultShippingFeeCents;
    }
    if (input.lowStockThreshold !== undefined) {
      data.lowStockThreshold = input.lowStockThreshold;
    }
    if (input.storeHeaderTitle !== undefined) {
      data.storeHeaderTitle = input.storeHeaderTitle;
    }
    if (input.storeHeaderSubtitle !== undefined) {
      data.storeHeaderSubtitle = input.storeHeaderSubtitle;
    }
    if (input.eventPickupEnabled !== undefined) {
      data.eventPickupEnabled = input.eventPickupEnabled;
    }
    if (input.pickupDisplayLabel !== undefined) {
      data.pickupDisplayLabel = input.pickupDisplayLabel;
    }
    if (input.supportPhone !== undefined) {
      data.supportPhone = input.supportPhone;
    }

    const updated = await prisma.storeSettings.update({
      where: { id: STORE_SETTINGS_SINGLETON_ID },
      data,
    });

    await recordAudit({
      actorId: sub,
      action: 'store_settings.update',
      entityType: 'store_settings',
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
    });

    return serializeAdminStoreSettings(updated);
  });
};
