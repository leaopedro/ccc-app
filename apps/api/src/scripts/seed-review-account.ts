import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import { TERMS_VERSION } from '@ccc/shared/terms';
import type { PrismaClient } from '@prisma/client';

import { hashPassword } from '../services/auth/password.js';
import { defaultGarageSlugForUserId, findFreeGarageSlug } from '../services/garage/index.js';

/**
 * Provisions the account App Review signs in with.
 *
 * Why this exists: `apps/mobile/app/_layout.tsx` redirects any user without
 * `emailVerifiedAt` to /verify-email-pending. A reviewer who self-registers is
 * stuck at that wall and rejects the build for being unusable, so the account has
 * to arrive already verified. It also needs an active membership and a bookable
 * event, otherwise the paid surfaces the reviewer is meant to evaluate are empty.
 *
 * Credentials come from the environment and are never committed:
 *   REVIEW_ACCOUNT_EMAIL, REVIEW_ACCOUNT_PASSWORD
 *
 * Idempotent, so it can be re-run before every submission.
 */

export type SeedReviewAccountInput = {
  email: string;
  password: string;
};

export type SeedReviewAccountResult = {
  userId: string;
  garageId: string;
  created: boolean;
  membership: 'created' | 'kept';
  eventSlug: string;
  /** Posts by another member, so the report and block controls are reachable. */
  demoPosts: number;
};

const REVIEW_EVENT_SLUG = 'app-review-demo';

export const seedReviewAccount = async (
  prisma: PrismaClient,
  input: SeedReviewAccountInput,
): Promise<SeedReviewAccountResult> => {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // Reset the password on re-run: the reviewer credential in App Store Connect
  // is the source of truth, so the DB follows it rather than the other way round.
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          emailVerifiedAt: new Date(),
          status: 'active',
          deletedAt: null,
          ageAttestedAt: new Date(),
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: new Date(),
        },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          email,
          name: 'App Review',
          passwordHash,
          emailVerifiedAt: new Date(),
          ageAttestedAt: new Date(),
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: new Date(),
        },
        select: { id: true },
      });

  let garage = await prisma.garage.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!garage) {
    const slug = await findFreeGarageSlug(prisma, defaultGarageSlugForUserId(user.id));
    garage = await prisma.garage.create({
      data: { userId: user.id, name: 'Garagem', slug, isPublic: false },
      select: { id: true },
    });
  }

  // Active membership so the premium surfaces are not empty. Provider refs are
  // synthetic on purpose: this account must never touch the live Stripe account,
  // and the reconcile worker treats an unknown subscription as a no-op rather
  // than expiring it (see workers/billing-reconcile.ts).
  const liveMembership = await prisma.premiumMembership.findFirst({
    where: { garageId: garage.id, status: { in: ['active', 'past_due', 'cancel_scheduled'] } },
    select: { id: true },
  });

  if (!liveMembership) {
    const now = new Date();
    await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: `cus_appreview_${user.id.slice(0, 8)}`,
        providerSubRef: `sub_appreview_${user.id.slice(0, 8)}`,
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        baseAmountCents: 0,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        grossAmountCents: 0,
        currency: 'BRL',
      },
    });
  }

  await prisma.garage.update({
    where: { id: garage.id },
    data: { premiumTier: 'gold', premiumUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000) },
  });

  // A future published event with stock, so the reviewer can reach the ticket
  // flow. Feed is public on it so the report and block controls are reachable
  // without buying anything.
  const startsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const event = await prisma.event.upsert({
    where: { slug: REVIEW_EVENT_SLUG },
    update: {
      status: 'published',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 6 * 3600 * 1000),
      publishedAt: new Date(),
      feedEnabled: true,
      feedAccess: 'public',
    },
    create: {
      slug: REVIEW_EVENT_SLUG,
      title: 'Encontro Casa Car Club (demonstração)',
      description: 'Evento de demonstração para avaliação do app.',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 6 * 3600 * 1000),
      venueName: 'Casa Car Club',
      venueAddress: 'Curitiba, PR',
      city: 'Curitiba',
      stateCode: 'PR',
      type: 'meeting',
      status: 'published',
      capacity: 50,
      maxTicketsPerUser: 2,
      publishedAt: new Date(),
      feedEnabled: true,
      feedAccess: 'public',
      postingAccess: 'attendees',
    },
    select: { id: true, slug: true },
  });

  const tier = await prisma.ticketTier.findFirst({
    where: { eventId: event.id },
    select: { id: true },
  });
  if (!tier) {
    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 5000,
        quantityTotal: 50,
        quantitySold: 0,
        sortOrder: 0,
      },
    });
  }

  // Seed posts by SOMEONE ELSE. Without this the demo feed is empty, the post
  // card never mounts, and the Denunciar / Bloquear controls that guideline 1.2
  // requires are unreachable on a clean review pass — the reviewer writes the
  // same rejection the whole feature was built to prevent. They must not be the
  // reviewer's own posts, because report and block are hidden on your own
  // content by design.
  const demoAuthorEmail = 'demo-autor@casacar.club';
  let demoAuthor = await prisma.user.findUnique({
    where: { email: demoAuthorEmail },
    select: { id: true },
  });
  if (!demoAuthor) {
    demoAuthor = await prisma.user.create({
      data: {
        email: demoAuthorEmail,
        name: 'Membro CCC',
        emailVerifiedAt: new Date(),
        ageAttestedAt: new Date(),
      },
      select: { id: true },
    });
    const slug = await findFreeGarageSlug(prisma, defaultGarageSlugForUserId(demoAuthor.id));
    await prisma.garage.create({
      data: { userId: demoAuthor.id, name: 'Garagem', slug, isPublic: false },
    });
  }

  const existingPosts = await prisma.feedPost.count({ where: { eventId: event.id } });
  if (existingPosts === 0) {
    for (const body of [
      'Confirmado pro encontro. Levando o carro lavado dessa vez.',
      'Alguém sabe se vai ter espaço coberto? Previsão de chuva no sábado.',
    ]) {
      await prisma.feedPost.create({
        data: { eventId: event.id, authorUserId: demoAuthor.id, body },
      });
    }
  }

  return {
    userId: user.id,
    garageId: garage.id,
    created: !existing,
    membership: liveMembership ? 'kept' : 'created',
    eventSlug: event.slug,
    demoPosts: await prisma.feedPost.count({ where: { eventId: event.id } }),
  };
};

/**
 * CLI entry point. Import-safe so tests can import the function.
 *
 *   REVIEW_ACCOUNT_EMAIL=... REVIEW_ACCOUNT_PASSWORD=... \
 *     pnpm --filter @ccc/api exec tsx src/scripts/seed-review-account.ts
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const email = process.env.REVIEW_ACCOUNT_EMAIL;
  const password = process.env.REVIEW_ACCOUNT_PASSWORD;

  if (!email || !password) {
    console.error(
      'Set REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_PASSWORD. They are deliberately not defaulted: the credential belongs in App Store Connect, not in this repo.',
    );
    process.exitCode = 1;
  } else {
    seedReviewAccount(prisma, { email, password })
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        return prisma.$disconnect();
      })
      .catch(async (err: unknown) => {
        console.error(err);
        await prisma.$disconnect();
        process.exitCode = 1;
      });
  }
}
