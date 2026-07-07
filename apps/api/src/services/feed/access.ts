import { prisma } from '@jdm/db';
import type { UserRoleName } from '@jdm/shared/auth';
import type { FeedAccess, PostingAccess } from '@jdm/shared/feed';

type AccessResult = 'ok' | 'forbidden' | 'banned';

async function hasValidTicket(eventId: string, userId: string): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({
    where: { eventId, userId, status: 'valid' },
    select: { id: true },
  });
  return ticket !== null;
}

async function hasMemberTicket(eventId: string, userId: string): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({
    where: { eventId, userId, status: 'valid', source: 'premium_grant' },
    select: { id: true },
  });
  return ticket !== null;
}

export async function checkFeedReadAccess(
  eventId: string,
  userId: string | null,
  role: UserRoleName,
): Promise<AccessResult> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { feedAccess: true },
  });
  if (!event) return 'forbidden';

  const feedAccess = event.feedAccess as FeedAccess;
  const isStaff = role === 'organizer' || role === 'admin' || role === 'staff';

  if (!isStaff) {
    if (feedAccess === 'attendees') {
      if (!userId) return 'forbidden';
      const hasTicket = await hasValidTicket(eventId, userId);
      if (!hasTicket) return 'forbidden';
    } else if (feedAccess === 'members_only') {
      if (!userId) return 'forbidden';
      const hasMember = await hasMemberTicket(eventId, userId);
      if (!hasMember) return 'forbidden';
    }
  }

  if (userId) {
    const ban = await prisma.feedBan.findFirst({
      where: { eventId, userId, scope: 'view' },
      select: { id: true },
    });
    if (ban) return 'banned';
  }

  return 'ok';
}

export async function isFeedBanned(eventId: string, userId: string): Promise<boolean> {
  const ban = await prisma.feedBan.findFirst({
    where: { eventId, userId },
    select: { id: true },
  });
  return ban !== null;
}

export async function checkFeedPostAccess(
  eventId: string,
  userId: string | null,
  role: UserRoleName,
): Promise<AccessResult> {
  if (!userId) return 'forbidden';

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { postingAccess: true },
  });
  if (!event) return 'forbidden';

  const postingAccess = event.postingAccess as PostingAccess;
  const isStaff = role === 'organizer' || role === 'admin';

  if (!isStaff) {
    if (postingAccess === 'attendees') {
      const hasTicket = await hasValidTicket(eventId, userId);
      if (!hasTicket) return 'forbidden';
    } else if (postingAccess === 'members_only') {
      const hasMember = await hasMemberTicket(eventId, userId);
      if (!hasMember) return 'forbidden';
    } else if (postingAccess === 'organizers_only') {
      return 'forbidden';
    }
  }

  const ban = await prisma.feedBan.findFirst({
    where: { eventId, userId },
    select: { scope: true },
  });
  if (ban) return 'banned';

  return 'ok';
}
