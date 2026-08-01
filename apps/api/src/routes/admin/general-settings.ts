import { prisma } from '@ccc/db';
import {
  GENERAL_SETTINGS_SINGLETON_ID,
  generalSettingsUpdateSchema,
} from '@ccc/shared/general-settings';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { invalidateBadgesCatalogCache } from '../../routes/badges-catalog.js';
import { recordAudit } from '../../services/admin-audit.js';
import { ensureGeneralSettings } from '../../services/general-settings.js';

import { serializeAdminGeneralSettings } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminGeneralSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/general/settings', async () => {
    const settings = await ensureGeneralSettings();
    return serializeAdminGeneralSettings(settings);
  });

  app.put('/general/settings', async (request) => {
    const { sub } = requireUser(request);
    const input = generalSettingsUpdateSchema.parse(request.body);

    const existing = await ensureGeneralSettings();

    const data: Prisma.GeneralSettingsUpdateInput = {};
    const capacity = input.capacityDisplay ?? {};
    const touched: string[] = [];

    // The admin form always submits full capacity payloads (mode +
    // thresholdPercent) so we cannot treat "supplied" as "changed" — that would
    // bump `updatedAt` and write an audit row on every Save click. Compare each
    // value against the persisted row and only mark the surface as touched when
    // it actually differs.
    if (capacity.tickets) {
      if (
        capacity.tickets.mode !== undefined &&
        capacity.tickets.mode !== existing.ticketCapacityMode
      ) {
        data.ticketCapacityMode = capacity.tickets.mode;
        touched.push('capacityDisplay.tickets.mode');
      }
      if (
        capacity.tickets.thresholdPercent !== undefined &&
        capacity.tickets.thresholdPercent !== existing.ticketCapacityThresholdPercent
      ) {
        data.ticketCapacityThresholdPercent = capacity.tickets.thresholdPercent;
        touched.push('capacityDisplay.tickets.thresholdPercent');
      }
    }
    if (capacity.extras) {
      if (
        capacity.extras.mode !== undefined &&
        capacity.extras.mode !== existing.extraCapacityMode
      ) {
        data.extraCapacityMode = capacity.extras.mode;
        touched.push('capacityDisplay.extras.mode');
      }
      if (
        capacity.extras.thresholdPercent !== undefined &&
        capacity.extras.thresholdPercent !== existing.extraCapacityThresholdPercent
      ) {
        data.extraCapacityThresholdPercent = capacity.extras.thresholdPercent;
        touched.push('capacityDisplay.extras.thresholdPercent');
      }
    }
    if (capacity.products) {
      if (
        capacity.products.mode !== undefined &&
        capacity.products.mode !== existing.productCapacityMode
      ) {
        data.productCapacityMode = capacity.products.mode;
        touched.push('capacityDisplay.products.mode');
      }
      if (
        capacity.products.thresholdPercent !== undefined &&
        capacity.products.thresholdPercent !== existing.productCapacityThresholdPercent
      ) {
        data.productCapacityThresholdPercent = capacity.products.thresholdPercent;
        touched.push('capacityDisplay.products.thresholdPercent');
      }
    }

    // Garage per-user pivot: reconcile is on-demand via GET /me/garage. The
    // admin save only persists the new cap + records the change in audit;
    // the next /me/garage hit per user self-heals via reconcileGarageSpots.
    const previousFreeLimit: number | null = existing.defaultFreeGarageSpots;
    let nextFreeLimit: number | null = previousFreeLimit;
    let garageSpotsChanged = false;
    if (input.defaultFreeGarageSpots !== undefined) {
      data.defaultFreeGarageSpots = input.defaultFreeGarageSpots;
      nextFreeLimit = input.defaultFreeGarageSpots;
      garageSpotsChanged = previousFreeLimit !== nextFreeLimit;
      if (garageSpotsChanged) {
        touched.push('defaultFreeGarageSpots');
      }
    }

    // Conquistas killswitch toggle. Plan §15.6 + chunk 16: admin flips this
    // flag and the next API call sees the change (no cache on the helper).
    // The badge catalog cache (5min TTL on rows) gets invalidated below so
    // an admin can flip the flag off and immediately re-enable it without
    // serving a stale "enabled: true" + empty-catalog response (or vice
    // versa). The toggle does NOT need an entirely separate audit row —
    // `general_settings.update` with `fields: ['gamificationEnabled']` is
    // the canonical record.
    const previousGamificationEnabled: boolean = existing.gamificationEnabled;
    let gamificationChanged = false;
    if (input.gamificationEnabled !== undefined) {
      if (input.gamificationEnabled !== previousGamificationEnabled) {
        data.gamificationEnabled = input.gamificationEnabled;
        gamificationChanged = true;
        touched.push('gamificationEnabled');
      }
    }

    // No-op saves (e.g. resubmitting unchanged values) must not bump
    // `updatedAt` or pollute the audit log with empty `fields: []` rows. Skip
    // the Prisma write entirely when nothing actually changed.
    if (touched.length === 0) {
      return serializeAdminGeneralSettings(existing);
    }

    const updated = await prisma.generalSettings.update({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      data,
    });

    // Clear the badge-catalog in-memory cache so the next `GET /badges/catalog`
    // call re-reads from the DB. Cheap, no-op when the cache is already empty.
    if (gamificationChanged) {
      invalidateBadgesCatalogCache();
    }

    await recordAudit({
      actorId: sub,
      action: 'general_settings.update',
      entityType: 'general_settings',
      entityId: updated.id,
      metadata: {
        fields: touched,
        ...(garageSpotsChanged
          ? {
              defaultFreeGarageSpots: {
                previous: previousFreeLimit,
                next: nextFreeLimit,
              },
            }
          : {}),
        ...(gamificationChanged
          ? {
              gamificationEnabled: {
                previous: previousGamificationEnabled,
                next: input.gamificationEnabled,
              },
            }
          : {}),
      },
    });

    return serializeAdminGeneralSettings(updated);
  });
};
