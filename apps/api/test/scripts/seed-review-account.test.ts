import { prisma } from '@ccc/db';
import { TERMS_VERSION } from '@ccc/shared/terms';
import { beforeEach, describe, expect, it } from 'vitest';

import { seedReviewAccount } from '../../src/scripts/seed-review-account.js';
import { resetDatabase } from '../helpers.js';

const INPUT = { email: 'Review@CasaCar.Club', password: 'demo-password-for-review' };

describe('seedReviewAccount', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates a verified account with a garage, membership and bookable event', async () => {
    const result = await seedReviewAccount(prisma, INPUT);

    expect(result.created).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    // The email wall in app/_layout.tsx is what makes an unverified reviewer
    // account an automatic rejection.
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.email).toBe('review@casacar.club');
    expect(user.termsVersion).toBe(TERMS_VERSION);

    const membership = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: result.garageId },
    });
    expect(membership.status).toBe('active');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: result.garageId } });
    expect(garage.premiumTier).toBe('gold');

    const event = await prisma.event.findUniqueOrThrow({ where: { slug: result.eventSlug } });
    expect(event.status).toBe('published');
    expect(event.startsAt.getTime()).toBeGreaterThan(Date.now());
    // Public feed so report and block are reachable without buying a ticket.
    expect(event.feedAccess).toBe('public');

    const tier = await prisma.ticketTier.findFirstOrThrow({ where: { eventId: event.id } });
    expect(tier.quantityTotal).toBeGreaterThan(0);
  });

  it('seeds posts by another member so report and block are reachable', async () => {
    // An empty feed means FeedPostCard never mounts, so the 1.2 controls do not
    // exist on screen. The posts must belong to someone else: report and block
    // are hidden on your own content.
    const result = await seedReviewAccount(prisma, INPUT);

    expect(result.demoPosts).toBeGreaterThan(0);
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: result.eventSlug } });
    const posts = await prisma.feedPost.findMany({ where: { eventId: event.id } });
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.authorUserId !== result.userId)).toBe(true);
    expect(posts.every((p) => p.status === 'visible')).toBe(true);
  });

  it('clears a reviewer block and un-hides reported posts on re-run', async () => {
    // If the reviewer tests Bloquear or Denunciar, the effects survive. A re-run
    // would then hand back an empty feed — exactly what the demo posts exist to
    // prevent. The seed has to be self-healing, not merely non-duplicating.
    const first = await seedReviewAccount(prisma, INPUT);
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: first.eventSlug } });
    const post = await prisma.feedPost.findFirstOrThrow({ where: { eventId: event.id } });

    await prisma.userBlock.create({
      data: { blockerId: first.userId, blockedId: post.authorUserId! },
    });
    await prisma.feedPost.update({
      where: { id: post.id },
      data: { status: 'hidden', hiddenAt: new Date() },
    });

    await seedReviewAccount(prisma, INPUT);

    expect(await prisma.userBlock.count({ where: { blockerId: first.userId } })).toBe(0);
    const after = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe('visible');
  });

  it('is idempotent and does not stack memberships or events', async () => {
    const first = await seedReviewAccount(prisma, INPUT);
    const second = await seedReviewAccount(prisma, INPUT);

    expect(first.userId).toBe(second.userId);
    expect(second.created).toBe(false);
    expect(second.membership).toBe('kept');
    expect(await prisma.premiumMembership.count()).toBe(1);
    expect(await prisma.event.count({ where: { slug: first.eventSlug } })).toBe(1);
    expect(await prisma.ticketTier.count()).toBe(1);
    expect(second.demoPosts).toBe(first.demoPosts);
  });

  it('resets the password on re-run so App Store Connect stays the source of truth', async () => {
    const first = await seedReviewAccount(prisma, INPUT);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });

    await seedReviewAccount(prisma, { ...INPUT, password: 'a-different-password' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });

    expect(after.passwordHash).not.toBe(before.passwordHash);
  });

  it('revives an account that had been soft-deleted', async () => {
    const first = await seedReviewAccount(prisma, INPUT);
    await prisma.user.update({
      where: { id: first.userId },
      data: { deletedAt: new Date(), status: 'deleted', emailVerifiedAt: null },
    });

    await seedReviewAccount(prisma, INPUT);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(user.deletedAt).toBeNull();
    expect(user.status).toBe('active');
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});
