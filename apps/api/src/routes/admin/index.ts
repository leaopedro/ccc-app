import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { adminAuditRoutes } from './audit.js';
import { adminBroadcastRoutes } from './broadcasts.js';
import { adminCheckInRoutes } from './check-in.js';
import { adminCollectionRoutes } from './collections.js';
import { adminConsentRoutes } from './consents.js';
import { adminDsrRoutes } from './dsr.js';
import { adminEventRoutes } from './events.js';
import { adminExtraRoutes } from './extras.js';
import { adminFeedModerationRoutes } from './feed-moderation.js';
import { adminFinanceRoutes } from './finance.js';
import { adminGarageXpAdjustmentRoutes } from './garage-xp-adjustment.js';
import { adminGeneralSettingsRoutes } from './general-settings.js';
import { adminGroupRoutes } from './groups.js';
import { adminMfaRoutes } from './mfa.js';
import { adminBoxCatalogRoutes } from './box-catalog-admin.js';
import { adminBoxPartnersRoutes } from './box-partners-admin.js';
import { adminPremiumCatalogRoutes } from './premium-catalog-admin.js';
import { adminPremiumRedemptionRoutes } from './premium-redemptions.js';
import { adminStoreInventoryRoutes } from './store/inventory.js';
import { adminStoreOrderRoutes } from './store/orders.js';
import { adminStorePhotoRoutes } from './store/photos.js';
import { adminStoreProductRoutes } from './store/products.js';
import { adminStoreVariantRoutes } from './store/variants.js';
import { adminStoreProductTypeRoutes } from './store-product-types.js';
import { adminStoreSettingsRoutes } from './store-settings.js';
import { adminSupportRoutes } from './support.js';
import { adminTicketRoutes } from './tickets.js';
import { adminTierRoutes } from './tiers.js';
import { adminUserGarageRoutes } from './user-garage.js';
import { adminUserMutationRoutes, adminUserRoutes } from './users.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // MFA enrollment: any authenticated admin-eligible role.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin', 'staff'));
    await scope.register(adminMfaRoutes);
  });

  // Check-in surface: staff can reach this; organizer/admin can too.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin', 'staff'));
    await scope.register(adminCheckInRoutes);
    await scope.register(adminPremiumRedemptionRoutes);
  });

  // Event + tier management + comp grants: organizer/admin only. Staff are rejected here.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin'));
    await scope.register(adminEventRoutes);
    await scope.register(adminTierRoutes);
    await scope.register(adminExtraRoutes);
    await scope.register(adminTicketRoutes);
    await scope.register(adminUserRoutes);
    await scope.register(adminUserGarageRoutes);
    await scope.register(adminFinanceRoutes);
    await scope.register(adminStoreProductTypeRoutes);
    await scope.register(adminStoreSettingsRoutes);
    await scope.register(adminGeneralSettingsRoutes);
    await scope.register(adminStoreProductRoutes);
    await scope.register(adminStoreVariantRoutes);
    await scope.register(adminStorePhotoRoutes);
    await scope.register(adminStoreInventoryRoutes);
    await scope.register(adminStoreOrderRoutes);
    await scope.register(adminCollectionRoutes);
    await scope.register(adminSupportRoutes);
    await scope.register(adminFeedModerationRoutes);
    await scope.register(adminGroupRoutes);
    await scope.register(adminPremiumCatalogRoutes);
    await scope.register(adminBoxCatalogRoutes);
    await scope.register(adminBoxPartnersRoutes);
  });

  // Broadcasts: organizer/admin with tight rate limit.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin'));
    await scope.register(rateLimit, {
      max: 5,
      timeWindow: '15 minutes',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const user = req.user as { sub?: string } | undefined;
        return `broadcast:${user?.sub ?? req.ip}`;
      },
    });
    await scope.register(adminBroadcastRoutes);
  });

  // LGPD consent audit + DSR management: admin-only (exposes PII).
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('admin'));
    await scope.register(adminConsentRoutes);
    await scope.register(adminDsrRoutes);
    await scope.register(adminAuditRoutes);
  });

  // User create/disable/enable: admin-only with tighter rate limit.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('admin'));
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-user-mut:${auth.sub}` : `admin-user-mut-ip:${req.ip}`;
      },
    });
    await scope.register(adminUserMutationRoutes);
  });

  // XP adjustment: admin-only with isolated 30/min/admin bucket (§C7).
  // Separate register block so the bucket does NOT collide with admin-user-mut.
  // hook: 'preHandler' so the rate-limit keyGenerator runs AFTER auth populates
  // `request.user` — without it the plugin runs on the earlier `onRequest` hook
  // and falls through to an IP-shared bucket instead of the per-admin one §C7
  // mandates.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('admin'));
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-xp-adj:${auth.sub}` : `admin-xp-adj-ip:${req.ip}`;
      },
    });
    await scope.register(adminGarageXpAdjustmentRoutes);
  });
};
