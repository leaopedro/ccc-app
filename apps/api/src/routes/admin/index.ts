import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { adminAuditRoutes } from './audit.js';
import { adminBroadcastRoutes } from './broadcasts.js';
import { adminCheckInRoutes } from './check-in.js';
import { adminCollectionRoutes } from './collections.js';
import { adminConsentRoutes } from './consents.js';
import { adminDocumentRoutes } from './documents.js';
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
import { adminBoxSettingsRoutes } from './box-settings-admin.js';
import { adminPremiumCatalogRoutes } from './premium-catalog-admin.js';
import { adminPremiumRedemptionRoutes } from './premium-redemptions.js';
import { adminStoreInventoryRoutes } from './store/inventory.js';
import { adminStoreOrderRoutes } from './store/orders.js';
import { adminStorePhotoRoutes } from './store/photos.js';
import { adminStoreProductRoutes } from './store/products.js';
import { adminStoreVariantRoutes } from './store/variants.js';
import { adminStoreProductTypeRoutes } from './store-product-types.js';
import { adminStoreSettingsRoutes } from './store-settings.js';
import { adminSubscriptionRoutes } from './subscriptions.js';
import { adminSupportRoutes } from './support.js';
import { adminTicketRoutes } from './tickets.js';
import { adminTierRoutes } from './tiers.js';
import { adminUserGarageRoutes } from './user-garage.js';
import { adminUserDetailRoutes, adminUserMutationRoutes, adminUserRoutes } from './users.js';

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
    await scope.register(adminSubscriptionRoutes);
    await scope.register(adminBoxCatalogRoutes);
    await scope.register(adminBoxPartnersRoutes);
    await scope.register(adminBoxSettingsRoutes);
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

  // Identity documents: admin-only (exposes PII — see the consent/DSR block
  // above for the same rationale) with an isolated 30/min/admin bucket. An
  // identity-document image is more sensitive than a consent record; each
  // read already writes an audit row, but that is detection, not prevention.
  // Separate register block so the bucket does NOT collide with any other.
  // hook: 'preHandler' so the rate-limit keyGenerator runs AFTER auth
  // populates `request.user` — without it the plugin runs on the earlier
  // `onRequest` hook and falls through to an IP-shared bucket.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('admin'));
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-documents:${auth.sub}` : `admin-documents-ip:${req.ip}`;
      },
    });
    await scope.register(adminDocumentRoutes);
  });

  // User detail: hands plaintext CPF/phone to `admin` viewers (organizer
  // viewers get null for both — see users.ts). Isolated 120/min/actor bucket,
  // deliberately looser than admin-documents/admin-user-mut/admin-xp-adj
  // (30/min): those guard mutations, this is a read that fires on every
  // render of this page, and one document approval already costs three
  // renders via revalidatePath + router.refresh(). An admin working a
  // support queue can plausibly open 30 member pages in a minute, so 30/min
  // was tripping on normal use. At 2 reads/sec (120/min) an admin never
  // notices it, while bulk enumeration still trips it; the real deterrent
  // on this route is the `user.pii_viewed` audit row plus the 15-minute
  // access-token lifetime, not this limiter. Separate register block,
  // scoped to just this one route, so the bucket does NOT collide with the
  // shared organizer/admin block above (which still serves GET /users, the
  // no-PII list, via adminUserRoutes).
  // hook: 'preHandler' so the rate-limit keyGenerator runs AFTER auth
  // populates `request.user` — without it the plugin runs on the earlier
  // `onRequest` hook and falls through to an IP-shared bucket.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin'));
    await scope.register(rateLimit, {
      max: 120,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-user-detail:${auth.sub}` : `admin-user-detail-ip:${req.ip}`;
      },
    });
    await scope.register(adminUserDetailRoutes);
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
