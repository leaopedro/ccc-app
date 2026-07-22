import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';

import { type Env } from './env.js';
import { buildLoggerOptions } from './logger.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { requestIdPlugin } from './plugins/request-id.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { sentryPlugin } from './plugins/sentry.js';
import { abacatepayWebhookRoutes } from './routes/abacatepay-webhook.js';
import { adminRoutes } from './routes/admin/index.js';
import { authRoutes } from './routes/auth/index.js';
import { badgesCatalogRoute } from './routes/badges-catalog.js';
import { carRoutes } from './routes/cars.js';
import { cartRoutes } from './routes/cart.js';
import { devUploadRoutes } from './routes/dev-uploads.js';
import { eventRoutes } from './routes/events.js';
import { feedRoutes } from './routes/feed.js';
import { garageRoutes } from './routes/garage.js';
import { healthRoutes } from './routes/health.js';
import { meAccountDeleteRoutes } from './routes/me-account-delete.js';
import { meConsentRoutes } from './routes/me-consents.js';
import { meDataExportRoutes } from './routes/me-data-export.js';
import { meDeviceTokenRoutes } from './routes/me-device-tokens.js';
import { meEmailChangeRoutes } from './routes/me-email-change.js';
import { meNotificationsRoutes } from './routes/me-notifications.js';
import { meOrdersRoutes } from './routes/me-orders.js';
import { mePremiumAddonRoutes } from './routes/me-premium-addons.js';
import { mePremiumRoutes } from './routes/me-premium.js';
import { meShippingAddressRoutes } from './routes/me-shipping-addresses.js';
import { meSupportRoutes } from './routes/me-support.js';
import { meTicketsRoutes } from './routes/me-tickets.js';
import { meRoutes } from './routes/me.js';
import { orderRoutes } from './routes/orders.js';
import { premiumCatalogRoutes } from './routes/premium-catalog.js';
import { premiumPricingRoutes } from './routes/premium-pricing.js';
import { revenuecatWebhookRoutes } from './routes/revenuecat-webhook.js';
import { storeRoutes } from './routes/store.js';
import { stripeBillingWebhookRoutes } from './routes/stripe-billing-webhook.js';
import { stripeWebhookRoutes } from './routes/stripe-webhook.js';
import { uploadRoutes } from './routes/uploads.js';
import { buildAbacatePay, type AbacatePayClient } from './services/abacatepay/index.js';
import { buildMailer, type Mailer } from './services/mailer/index.js';
import { buildPushSender, type PushSender } from './services/push/index.js';
import { buildRevenueCatClient } from './services/revenuecat/client.js';
import { buildStripe, type StripeClient } from './services/stripe/index.js';
import { configureDeletionQueue } from './services/uploads/deletion-queue.js';
import { DevUploads } from './services/uploads/dev.js';
import { buildUploads, type Uploads } from './services/uploads/index.js';
import { startDeletionWorker } from './workers/account-deletion.js';
import { startReconcileWorker } from './workers/billing-reconcile.js';
import { startBroadcastWorker } from './workers/broadcasts.js';
import { startDataExportWorker } from './workers/data-export.js';
import { startEventRemindersWorker } from './workers/event-reminders.js';
import { startPremiumTicketBackfillWorker } from './workers/premium-ticket-backfill.js';
import { startRetentionWorker } from './workers/retention.js';

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    env: Env;
    uploads: Uploads;
    stripe: StripeClient;
    abacatepay: AbacatePayClient | null;
    push: PushSender;
  }
}

export type BuildAppOverrides = {
  stripe?: StripeClient;
  abacatepay?: AbacatePayClient | null;
  push?: PushSender;
};

export const buildApp = async (
  env: Env,
  overrides: BuildAppOverrides = {},
): Promise<FastifyInstance> => {
  process.stdout.write('[app] creating fastify instance\n');
  const app = Fastify({
    logger: buildLoggerOptions(env),
    disableRequestLogging: false,
    genReqId: () => randomUUID(),
  });

  process.stdout.write('[app] decorating services\n');
  app.decorate('mailer', buildMailer(env));
  app.decorate('env', env);
  app.decorate('uploads', buildUploads(env));
  app.decorate('stripe', overrides.stripe ?? buildStripe(env));
  const abacatepay =
    overrides.abacatepay !== undefined
      ? overrides.abacatepay
      : env.ABACATEPAY_API_KEY && env.ABACATEPAY_WEBHOOK_SECRET
        ? buildAbacatePay({
            ABACATEPAY_API_KEY: env.ABACATEPAY_API_KEY,
            ABACATEPAY_WEBHOOK_SECRET: env.ABACATEPAY_WEBHOOK_SECRET,
          })
        : null;
  app.decorate('abacatepay', abacatepay);
  app.decorate('push', overrides.push ?? buildPushSender(env));
  process.stdout.write('[app] services ready, registering plugins\n');

  await app.register(requestIdPlugin);
  await app.register(securityHeadersPlugin);
  await app.register(sentryPlugin, { env });
  await app.register(sensible);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
  });
  await app.register(errorHandlerPlugin);
  await app.register(healthRoutes);
  await app.register(authPlugin);
  await app.register(meRoutes);
  await app.register(meEmailChangeRoutes);
  await app.register(meTicketsRoutes);
  await app.register(meOrdersRoutes);
  await app.register(meDeviceTokenRoutes);
  await app.register(meNotificationsRoutes);
  await app.register(meShippingAddressRoutes);
  await app.register(meConsentRoutes);
  await app.register(meDataExportRoutes);
  await app.register(meAccountDeleteRoutes);
  await app.register(meSupportRoutes);
  await app.register(mePremiumRoutes);
  await app.register(mePremiumAddonRoutes);
  await app.register(premiumPricingRoutes);
  await app.register(premiumCatalogRoutes);
  await app.register(uploadRoutes);
  await app.register(carRoutes);
  await app.register(garageRoutes);
  await app.register(badgesCatalogRoute);
  await app.register(eventRoutes);
  await app.register(feedRoutes);
  await app.register(storeRoutes);
  await app.register(cartRoutes);
  await app.register(orderRoutes);
  await app.register(stripeWebhookRoutes);
  await app.register(stripeBillingWebhookRoutes);
  await app.register(revenuecatWebhookRoutes);
  await app.register(abacatepayWebhookRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(authRoutes, { prefix: '/auth' });
  process.stdout.write('[app] routes registered\n');

  if (env.WORKER_ENABLED && env.NODE_ENV === 'production') {
    const worker = startEventRemindersWorker({ sender: app.push, log: app.log });
    app.addHook('onClose', () => {
      worker.stop();
    });

    const deletionWorker = startDeletionWorker({
      graceDays: env.DELETION_GRACE_DAYS,
      uploads: app.uploads,
      stripe: app.stripe,
      env,
      log: app.log,
    });
    app.addHook('onClose', () => {
      void deletionWorker.stop();
    });

    // F8.12: hourly reconciliation sweep — feature-flagged off by default
    // (canon §F8.11). Registers only when GROWTH_PREMIUM_BILLING_ENABLED is
    // true; the worker itself short-circuits the same flag inside each tick,
    // but the cron registration is also gated so the schedule is not
    // installed in production until billing is live.
    if (env.GROWTH_PREMIUM_BILLING_ENABLED) {
      const rcApiKey = env.REVENUECAT_REST_API_KEY;
      if (!rcApiKey) {
        app.log.warn(
          { REVENUECAT_REST_API_KEY: undefined },
          '[billing-reconcile] REVENUECAT_REST_API_KEY not set — RC rows will error on reconcile ticks',
        );
      }
      const rc = buildRevenueCatClient(rcApiKey ?? '');
      const reconcileWorker = startReconcileWorker({
        stripe: app.stripe,
        rc,
        env,
        log: app.log,
      });
      app.addHook('onClose', () => {
        reconcileWorker.stop();
      });

      // F8.06: post-commit premium ticket backfill worker.
      // Polls PremiumTicketBackfillJob every minute. Same flag gate as the
      // reconciliation sweep above (canon §F8.11) — the schedule is not
      // installed in production until premium billing is live.
      const backfillWorker = startPremiumTicketBackfillWorker({ env, log: app.log });
      app.addHook('onClose', () => {
        backfillWorker.stop();
      });
    }
  }

  if (env.BROADCAST_WORKER_ENABLED) {
    // Warn loudly when the worker is enabled but the push sender is the dev
    // stub. This is the most common local-smoke misconfiguration: operator
    // sets BROADCAST_WORKER_ENABLED=true expecting real device delivery, but
    // PUSH_PROVIDER stays at 'auto' in dev, so messages only hit DevPushSender
    // and log `[dev-push] …` lines without leaving the process.
    const usingDevSender = app.push.constructor.name === 'DevPushSender';
    if (usingDevSender) {
      app.log.warn(
        {
          BROADCAST_WORKER_ENABLED: env.BROADCAST_WORKER_ENABLED,
          PUSH_PROVIDER: env.PUSH_PROVIDER,
          NODE_ENV: env.NODE_ENV,
        },
        '[broadcasts] worker enabled with DevPushSender — broadcasts will be marked sent but no real push will be delivered. Set PUSH_PROVIDER=expo + EXPO_ACCESS_TOKEN and use a real device to deliver pushes.',
      );
    }
    const bWorker = startBroadcastWorker({
      sender: app.push,
      batchSize: env.BROADCAST_BATCH_SIZE,
      log: app.log,
    });
    app.addHook('onClose', () => {
      void bWorker.stop();
    });
  }

  if (env.WORKER_ENABLED || env.NODE_ENV !== 'production') {
    const exportWorker = startDataExportWorker({ env, log: app.log });
    app.addHook('onClose', () => {
      void exportWorker.stop();
    });
  }

  configureDeletionQueue({
    uploads: app.uploads,
    workerEnabled: env.RETENTION_WORKER_ENABLED,
  });

  if (env.RETENTION_WORKER_ENABLED) {
    const rWorker = startRetentionWorker({ log: app.log, uploads: app.uploads });
    app.addHook('onClose', () => {
      void rWorker.stop();
    });
  } else if (env.NODE_ENV === 'production') {
    app.log.warn(
      { RETENTION_WORKER_ENABLED: false },
      '[retention] worker disabled — queued deletions will use immediate R2 delete fallback. Set RETENTION_WORKER_ENABLED=true for scheduled sweep behavior.',
    );
  }

  if (env.NODE_ENV !== 'production') {
    // Register dev file server only when DevUploads is active.
    // Staging with R2 keys present uses R2Uploads and skips this.
    if (app.uploads instanceof DevUploads) {
      await app.register(devUploadRoutes);
    }
  }

  if (env.NODE_ENV !== 'production' || process.env.SENTRY_DEBUG === '1') {
    app.get('/debug/boom', () => {
      throw new Error('intentional boom for Sentry verification');
    });
  }

  return app;
};
