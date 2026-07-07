import { prisma } from '@jdm/db';
import type { BroadcastTarget } from '@jdm/shared';

import { hasActiveConsent } from '../consent.js';

export type AudienceRow = {
  userId: string;
  tokens: string[];
  marketingOptedIn: boolean;
};

export type RecipientRow = {
  userId: string;
  tokens: string[];
};

/**
 * Resolve every active user matched by the target. Inbox rows are created for
 * the full audience; push is gated downstream by marketing prefs and tokens.
 */
export const resolveAudience = async (target: BroadcastTarget): Promise<AudienceRow[]> => {
  let userIds: string[];

  if (target.kind === 'all') {
    const users = await prisma.user.findMany({
      where: { status: 'active', role: 'user' },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  } else if (target.kind === 'premium') {
    const tickets = await prisma.ticket.findMany({
      where: { source: 'premium_grant', status: 'valid' },
      select: { userId: true },
      distinct: ['userId'],
    });
    userIds = tickets.map((t) => t.userId);
  } else if (target.kind === 'attendees_of_event') {
    const tickets = await prisma.ticket.findMany({
      where: { eventId: target.eventId, status: { in: ['valid', 'used'] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    userIds = tickets.map((t) => t.userId);
  } else {
    const users = await prisma.user.findMany({
      where: { city: target.city, status: 'active', role: 'user' },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  }

  if (userIds.length === 0) return [];

  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, status: 'active' },
    select: {
      id: true,
      deviceTokens: { select: { expoPushToken: true } },
    },
  });

  const audience: AudienceRow[] = [];
  for (const u of rows) {
    const consented = await hasActiveConsent(u.id, 'push_marketing');
    audience.push({
      userId: u.id,
      tokens: u.deviceTokens.map((dt) => dt.expoPushToken),
      marketingOptedIn: consented,
    });
  }
  return audience;
};

/**
 * Push-eligible subset of the audience. Used by dry-run estimates and the
 * dispatcher's push-send loop.
 */
export const resolveRecipients = async (target: BroadcastTarget): Promise<RecipientRow[]> => {
  const audience = await resolveAudience(target);
  return audience
    .filter((u) => u.marketingOptedIn && u.tokens.length > 0)
    .map((u) => ({ userId: u.userId, tokens: u.tokens }));
};

export const countRecipients = async (target: BroadcastTarget): Promise<number> => {
  const recipients = await resolveRecipients(target);
  return recipients.length;
};
