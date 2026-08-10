import { prisma } from '@ccc/db';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildFakeAbacatePay, type FakeAbacatePay } from '../src/services/abacatepay/fake.js';
import { hashPassword } from '../src/services/auth/password.js';
import { createAccessToken } from '../src/services/auth/tokens.js';
import { buildFakeStripe, type FakeStripe } from '../src/services/stripe/fake.js';

export const makeApp = () => buildApp(loadEnv());

export const makeAppWithFakeStripe = async (): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  stripe: FakeStripe;
}> => {
  const stripe = buildFakeStripe();
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

export const makeAppWithFakes = async (): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  stripe: FakeStripe;
  abacatepay: FakeAbacatePay;
}> => {
  const stripe = buildFakeStripe();
  const abacatepay = buildFakeAbacatePay();
  const app = await buildApp(loadEnv(), { stripe, abacatepay });
  return { app, stripe, abacatepay };
};

export const resetDatabase = async (): Promise<void> => {
  await prisma.$connect();
  await prisma.dsrAction.deleteMany();
  await prisma.dataSubjectRequest.deleteMany();
  await prisma.feedBan.deleteMany();
  await prisma.report.deleteMany();
  await prisma.feedReaction.deleteMany();
  await prisma.feedComment.deleteMany();
  await prisma.feedPostPhoto.deleteMany();
  await prisma.feedPost.deleteMany();
  await prisma.broadcastDelivery.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.cartItemExtra.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.pickupVoucher.deleteMany();
  await prisma.ticketExtraItem.deleteMany();
  await prisma.fridgeUnlockEvent.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderExtra.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.shippingAddress.deleteMany();
  await prisma.ticketExtra.deleteMany();
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.adminAudit.deleteMany();
  await prisma.productCollection.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.productPhoto.deleteMany();
  await prisma.variant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productType.deleteMany();
  await prisma.shippingAddress.deleteMany();
  // F8 premium billing (chunk F8.01): children before parents.
  // PremiumMembershipInvoice → PremiumMembership (Garage FK Cascades, but
  // truncate explicitly so F8.03+ webhook idempotency tests start clean).
  // SubscriptionWebhookEvent has no FK; cleaned here for the same reason.
  await prisma.premiumMembershipInvoice.deleteMany();
  // Box runtime (Fase 2): children before parents.
  await prisma.monthlyBoxItem.deleteMany();
  await prisma.monthlyBoxPartnerItem.deleteMany();
  await prisma.boxCatalogItemCycleStock.deleteMany();
  await prisma.monthlyBox.deleteMany();
  await prisma.premiumMembership.deleteMany();
  await prisma.premiumTicketBackfillJob.deleteMany();
  await prisma.subscriptionWebhookEvent.deleteMany();
  await prisma.ticketTier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.carPhoto.deleteMany();
  await prisma.garageSpot.deleteMany();
  // Conquistas (chunk 15 + 16): clear earned + catalog rows between tests so
  // each spec controls its own badge fixtures explicitly. Order matters —
  // GarageBadge has FKs to Garage + Badge, so it must precede both.
  await prisma.garageBadge.deleteMany();
  await prisma.garage.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.car.deleteMany();
  // GeneralSettings.defaultFreeGarageSpots persists across tests and gates
  // POST /me/cars allocation. Reset so each test sees a clean cap.
  await prisma.generalSettings.deleteMany();
  await prisma.productCollection.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.variant.deleteMany();
  await prisma.productPhoto.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productType.deleteMany();
  await prisma.storeSettings.deleteMany();
  await prisma.dataExportJob.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.uploadDeletionQueue.deleteMany();
  await prisma.boxCatalogItem.deleteMany();
  await prisma.boxSettings.deleteMany();
  await prisma.partnerModule.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.mfaRecoveryCode.deleteMany();
  await prisma.mfaSecret.deleteMany();
  await prisma.emailChangeToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.authProvider.deleteMany();
  await prisma.userGroupMembership.deleteMany();
  await prisma.userGroup.deleteMany();
  await prisma.user.deleteMany();
};

export const createUser = async (
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    verified: boolean;
    role: 'user' | 'organizer' | 'admin' | 'staff';
  }> = {},
) => {
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? 'user@jdm.test',
      name: overrides.name ?? 'Test User',
      passwordHash: await hashPassword(password),
      role: overrides.role ?? 'user',
      emailVerifiedAt: overrides.verified ? new Date() : null,
    },
  });
  // Match the signup-hook + migration backfill invariant: every User has a
  // Garage. Tests create users via this helper rather than the signup route,
  // so we mint the Garage here with the same neutral defaults. Tests sometimes
  // create many users concurrently with id prefixes that collide; we retry on
  // P2002 by appending the User id suffix to defuse the collision. The User id
  // itself is already unique, so the longer slug is guaranteed unique.
  const baseSlug = `user-${user.id.slice(0, 8).toLowerCase()}`;
  let attempt = 0;

  while (true) {
    const candidate = attempt === 0 ? baseSlug : `user-${user.id.toLowerCase()}-${attempt}`;
    try {
      await prisma.garage.create({
        data: {
          userId: user.id,
          name: 'Garagem',
          slug: candidate.slice(0, 40),
          isPublic: false,
        },
      });
      break;
    } catch (e) {
      // P2002 (unique constraint) → keep trying with a longer/more-suffixed slug.
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
        attempt += 1;
        if (attempt > 5) throw e;
        continue;
      }
      throw e;
    }
  }
  return { user, password };
};

export const bearer = (
  env: ReturnType<typeof loadEnv>,
  userId: string,
  role: 'user' | 'organizer' | 'admin' | 'staff' = 'user',
) => `Bearer ${createAccessToken({ sub: userId, role }, env)}`;
