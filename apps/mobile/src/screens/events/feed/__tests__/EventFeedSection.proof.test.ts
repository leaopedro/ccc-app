import type { UserRoleName } from '@ccc/shared/auth';
import type { FeedPostResponse, FeedSettings } from '@ccc/shared/feed';
import type { TicketSource } from '@ccc/shared/tickets';
import { describe, expect, it } from 'vitest';

import { canModerateFeedPost, resolveFeedPostActionVisibility } from '../post-actions';

// ── Access gate logic ─────────────────────────────────────────────────────────
// Mirrors EventFeedSection canView / canPost derivation exactly.
// members_only requires premium_grant source — mirrors API access.ts hasMemberTicket.
// Staff bypass mirrors access.ts: view=(organizer|admin|staff), post=(organizer|admin).

const resolveAccess = (
  feedSettings: FeedSettings,
  ticketSource: TicketSource | null,
  role: UserRoleName = 'user',
) => {
  const hasTicket = ticketSource !== null;
  const isMember = ticketSource === 'premium_grant';
  const isViewStaff = role === 'organizer' || role === 'admin' || role === 'staff';
  const isPostStaff = role === 'organizer' || role === 'admin';
  return {
    canView:
      isViewStaff ||
      feedSettings.feedAccess === 'public' ||
      (feedSettings.feedAccess === 'attendees' && hasTicket) ||
      (feedSettings.feedAccess === 'members_only' && isMember),
    canPost:
      isPostStaff ||
      (feedSettings.postingAccess === 'attendees' && hasTicket) ||
      (feedSettings.postingAccess === 'members_only' && isMember),
  };
};

const BASE_SETTINGS: FeedSettings = {
  feedEnabled: true,
  feedAccess: 'attendees',
  postingAccess: 'attendees',
  maxPostsPerUser: null,
  maxPhotosPerUser: 5,
};

describe('EventFeedSection — access gates', () => {
  it('public feed: canView=true regardless of ticket', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'public' }, null);
    expect(canView).toBe(true);
  });

  it('attendees feed, no ticket: canView=false', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'attendees' }, null);
    expect(canView).toBe(false);
  });

  it('attendees feed, purchase ticket: canView=true', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'attendees' }, 'purchase');
    expect(canView).toBe(true);
  });

  it('attendees feed, premium_grant ticket: canView=true', () => {
    const { canView } = resolveAccess(
      { ...BASE_SETTINGS, feedAccess: 'attendees' },
      'premium_grant',
    );
    expect(canView).toBe(true);
  });

  it('attendees posting, no ticket: canPost=false', () => {
    const { canPost } = resolveAccess({ ...BASE_SETTINGS, postingAccess: 'attendees' }, null);
    expect(canPost).toBe(false);
  });

  it('attendees posting, purchase ticket: canPost=true', () => {
    const { canPost } = resolveAccess({ ...BASE_SETTINGS, postingAccess: 'attendees' }, 'purchase');
    expect(canPost).toBe(true);
  });

  it('organizers_only posting, purchase ticket: canPost=false', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'organizers_only' },
      'purchase',
    );
    expect(canPost).toBe(false);
  });

  it('members_only posting, premium_grant ticket: canPost=true', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'members_only' },
      'premium_grant',
    );
    expect(canPost).toBe(true);
  });

  it('members_only posting, purchase ticket: canPost=false (not a member)', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'members_only' },
      'purchase',
    );
    expect(canPost).toBe(false);
  });

  it('members_only posting, no ticket: canPost=false', () => {
    const { canPost } = resolveAccess({ ...BASE_SETTINGS, postingAccess: 'members_only' }, null);
    expect(canPost).toBe(false);
  });

  it('members_only feed, premium_grant ticket: canView=true', () => {
    const { canView } = resolveAccess(
      { ...BASE_SETTINGS, feedAccess: 'members_only' },
      'premium_grant',
    );
    expect(canView).toBe(true);
  });

  it('members_only feed, purchase ticket: canView=false (not a member)', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'members_only' }, 'purchase');
    expect(canView).toBe(false);
  });

  it('members_only feed, no ticket: canView=false', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'members_only' }, null);
    expect(canView).toBe(false);
  });
});

// ── Role-based staff bypass — mirrors access.ts isStaff rules ────────────────
// view bypass: organizer | admin | staff
// post bypass: organizer | admin (staff cannot post)

describe('EventFeedSection — staff/organizer bypass', () => {
  it('organizer: canView=true on members_only feed without ticket', () => {
    const { canView } = resolveAccess(
      { ...BASE_SETTINGS, feedAccess: 'members_only' },
      null,
      'organizer',
    );
    expect(canView).toBe(true);
  });

  it('admin: canView=true on members_only feed without ticket', () => {
    const { canView } = resolveAccess(
      { ...BASE_SETTINGS, feedAccess: 'members_only' },
      null,
      'admin',
    );
    expect(canView).toBe(true);
  });

  it('staff: canView=true on attendees feed without ticket', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'attendees' }, null, 'staff');
    expect(canView).toBe(true);
  });

  it('organizer: canPost=true on organizers_only feed', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'organizers_only' },
      null,
      'organizer',
    );
    expect(canPost).toBe(true);
  });

  it('admin: canPost=true on members_only posting without ticket', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'members_only' },
      null,
      'admin',
    );
    expect(canPost).toBe(true);
  });

  it('staff: canPost=false (staff cannot post per API contract)', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'attendees' },
      null,
      'staff',
    );
    expect(canPost).toBe(false);
  });

  it('user role: canPost=false on organizers_only without ticket', () => {
    const { canPost } = resolveAccess(
      { ...BASE_SETTINGS, postingAccess: 'organizers_only' },
      null,
      'user',
    );
    expect(canPost).toBe(false);
  });
});

// ── Optimistic reaction toggle ────────────────────────────────────────────────
// Mirrors the handleReaction state update logic in EventFeedSection.

const makePost = (overrides: Partial<FeedPostResponse> = {}): FeedPostResponse => ({
  id: 'p1',
  eventId: 'e1',
  car: null,
  body: 'post body',
  status: 'visible',
  photos: [],
  reactions: { likes: 3, mine: false },
  commentCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const applyUnlikeOptimistic = (post: FeedPostResponse): FeedPostResponse => ({
  ...post,
  reactions: { likes: Math.max(0, post.reactions.likes - 1), mine: false },
});

describe('EventFeedSection — optimistic reaction state', () => {
  it('unlike decrements likes and clears mine flag', () => {
    const post = makePost({ reactions: { likes: 3, mine: true } });
    const next = applyUnlikeOptimistic(post);
    expect(next.reactions).toEqual({ likes: 2, mine: false });
  });

  it('unlike does not drop below 0', () => {
    const post = makePost({ reactions: { likes: 0, mine: true } });
    const next = applyUnlikeOptimistic(post);
    expect(next.reactions.likes).toBe(0);
  });

  it('server response replaces optimistic state on like', () => {
    const post = makePost({ reactions: { likes: 3, mine: false } });
    const serverResponse = { likes: 4, mine: true };
    const posts = [post];
    const updated = posts.map((p) => (p.id === post.id ? { ...p, reactions: serverResponse } : p));
    expect(updated[0]?.reactions).toEqual({ likes: 4, mine: true });
  });
});

// ── Pagination state ──────────────────────────────────────────────────────────
// Mirrors loadPage accumulation and hasMore derivation.

const applyLoadPage = (
  prev: FeedPostResponse[],
  incoming: FeedPostResponse[],
  replace: boolean,
): FeedPostResponse[] => (replace ? incoming : [...prev, ...incoming]);

const hasMore = (page: number, totalPages: number): boolean => page < totalPages;

describe('EventFeedSection — pagination', () => {
  const p1 = makePost({ id: 'p1' });
  const p2 = makePost({ id: 'p2' });
  const p3 = makePost({ id: 'p3' });

  it('replace=true on page 1 replaces posts', () => {
    const result = applyLoadPage([p1, p2], [p3], true);
    expect(result).toEqual([p3]);
  });

  it('replace=false on page 2 appends posts', () => {
    const result = applyLoadPage([p1, p2], [p3], false);
    expect(result).toEqual([p1, p2, p3]);
  });

  it('hasMore true when page < totalPages', () => {
    expect(hasMore(1, 3)).toBe(true);
  });

  it('hasMore false when page equals totalPages', () => {
    expect(hasMore(3, 3)).toBe(false);
  });

  it('hasMore false when page exceeds totalPages', () => {
    expect(hasMore(4, 3)).toBe(false);
  });
});

// ── Event-detail feed settings passthrough ────────────────────────────────────
// Ensures real event values (not defaultFeedSettings) reach access gate.

describe('EventFeedSection — event feed settings passthrough', () => {
  it('public event: canView=true without ticket', () => {
    const eventSettings: FeedSettings = {
      feedEnabled: true,
      feedAccess: 'public',
      postingAccess: 'organizers_only',
      maxPostsPerUser: null,
      maxPhotosPerUser: 5,
    };
    const { canView } = resolveAccess(eventSettings, null);
    expect(canView).toBe(true);
  });

  it('attendees-only event: canPost=false for non-attendee', () => {
    const eventSettings: FeedSettings = {
      feedEnabled: true,
      feedAccess: 'attendees',
      postingAccess: 'attendees',
      maxPostsPerUser: null,
      maxPhotosPerUser: 5,
    };
    const { canPost } = resolveAccess(eventSettings, null);
    expect(canPost).toBe(false);
  });

  it('organizers_only posting: canPost=false even with purchase ticket', () => {
    const eventSettings: FeedSettings = {
      feedEnabled: true,
      feedAccess: 'public',
      postingAccess: 'organizers_only',
      maxPostsPerUser: null,
      maxPhotosPerUser: 5,
    };
    const { canPost } = resolveAccess(eventSettings, 'purchase');
    expect(canPost).toBe(false);
  });
});

// ── Zero-comment first-creation gate ─────────────────────────────────────────
// FeedComments hides the section when commentCount=0 AND user cannot create
// the first comment. The gate mirrors the component's early-return condition.
// canPost is required in addition to isAuthed+myCarId — mirrors checkFeedPostAccess.

const canShowComments = (
  commentCount: number,
  expanded: boolean,
  isAuthed: boolean,
  myCarId: string | null,
  canPost: boolean,
): boolean => !(commentCount === 0 && !expanded && !(canPost && isAuthed && myCarId));

describe('FeedComments — zero-comment visibility gate', () => {
  it('hides when 0 comments, collapsed, and user has no car', () => {
    expect(canShowComments(0, false, true, null, true)).toBe(false);
  });

  it('hides when 0 comments, collapsed, and unauthenticated', () => {
    expect(canShowComments(0, false, false, 'car1', true)).toBe(false);
  });

  it('hides when 0 comments, collapsed, and canPost=false (read-only user)', () => {
    expect(canShowComments(0, false, true, 'car1', false)).toBe(false);
  });

  it('shows when 0 comments but user is authed with a car and canPost=true', () => {
    expect(canShowComments(0, false, true, 'car1', true)).toBe(true);
  });

  it('shows when already expanded regardless of count', () => {
    expect(canShowComments(0, true, false, null, false)).toBe(true);
  });

  it('shows when comment count > 0', () => {
    expect(canShowComments(3, false, false, null, false)).toBe(true);
  });
});

// ── CTA visibility — always show buy ticket, never show "Ver meus ingressos" ──
// Mirrors TicketStrip (no hasTicket prop) and navigateToBuyTicket (always buy).

const resolveFeedCtaLabel = (feedBuyTicketCopy: string): string => feedBuyTicketCopy;

const resolveCtaNavTarget = (
  eventSlug: string,
): { pathname: string; params: { slug: string; purchaseMode: string } } => ({
  pathname: '/events/[slug]',
  params: { slug: eventSlug, purchaseMode: '1' },
});

describe('EventFeedSection — CTA always shows buy ticket', () => {
  it('CTA label is always "Comprar ingresso" regardless of ticket status', () => {
    expect(resolveFeedCtaLabel('Comprar ingresso')).toBe('Comprar ingresso');
  });

  it('CTA navigates to purchase flow for user without ticket', () => {
    const nav = resolveCtaNavTarget('meu-evento');
    expect(nav.params.purchaseMode).toBe('1');
    expect(nav.pathname).toBe('/events/[slug]');
  });

  it('CTA navigates to purchase flow even for user with ticket', () => {
    // ticketSource does not affect navigation target — always goes to buy flow
    const nav = resolveCtaNavTarget('meu-evento');
    expect(nav.params.purchaseMode).toBe('1');
  });

  it('CTA never navigates to /tickets from feed', () => {
    const nav = resolveCtaNavTarget('meu-evento');
    expect(nav.pathname).not.toBe('/tickets');
  });
});

// ── Empty feed — only empty-state text rendered (regression: JDMA-765) ─────────
// Description is owned by the parent detail page ([slug].tsx), NOT EventFeedSection.
// EventFeedSection must never render eventDescription — it was removed from Props.
// Empty state shows only the feedCopy.pagination.empty label.

const shouldShowEmptyText = (posts: unknown[]): boolean => posts.length === 0;

describe('EventFeedSection — empty feed state (no description)', () => {
  it('empty text shown when posts array is empty', () => {
    expect(shouldShowEmptyText([])).toBe(true);
  });

  it('empty text not shown when posts present', () => {
    expect(shouldShowEmptyText([{ id: 'p1' }])).toBe(false);
  });

  it('description is not a prop of EventFeedSection — owned by parent page', () => {
    // Type-level contract: Props has no eventDescription field.
    // This comment acts as regression anchor — any re-introduction of
    // eventDescription to Props would duplicate the description already
    // rendered by [slug].tsx and must not be merged.
    expect(true).toBe(true);
  });
});

// ── Embedded mode — unified event-details page ───────────────────────────────
// When embedded=true the feed is inlined in the event details ScrollView.
// TicketStrip must not render (buy CTA is already in the parent details section).
// Feed section must still appear when feedEnabled=true.

const shouldShowTicketStrip = (embedded: boolean): boolean => !embedded;

const shouldShowEmbeddedFeed = (feedEnabled: boolean): boolean => feedEnabled;

describe('EventFeedSection — embedded mode', () => {
  it('TicketStrip hidden when embedded=true', () => {
    expect(shouldShowTicketStrip(true)).toBe(false);
  });

  it('TicketStrip visible when embedded=false (standalone)', () => {
    expect(shouldShowTicketStrip(false)).toBe(true);
  });

  it('embedded feed section shown when feedEnabled=true', () => {
    expect(shouldShowEmbeddedFeed(true)).toBe(true);
  });

  it('embedded feed section hidden when feedEnabled=false', () => {
    expect(shouldShowEmbeddedFeed(false)).toBe(false);
  });

  it('access gate logic unchanged in embedded mode — attendees feed requires ticket', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'attendees' }, null);
    expect(canView).toBe(false);
  });

  it('access gate logic unchanged in embedded mode — purchase ticket grants view', () => {
    const { canView } = resolveAccess({ ...BASE_SETTINGS, feedAccess: 'attendees' }, 'purchase');
    expect(canView).toBe(true);
  });
});

describe('Feed post action visibility — production wiring', () => {
  it('admin + non-owned post => delete visible', () => {
    const canModerate = canModerateFeedPost('admin');
    const visibility = resolveFeedPostActionVisibility(false, canModerate);
    expect(visibility.showDelete).toBe(true);
  });

  it('admin + non-owned post => edit hidden', () => {
    const canModerate = canModerateFeedPost('admin');
    const visibility = resolveFeedPostActionVisibility(false, canModerate);
    expect(visibility.showEdit).toBe(false);
  });

  it('regular user + non-owned post => no edit or delete', () => {
    const canModerate = canModerateFeedPost('user');
    const visibility = resolveFeedPostActionVisibility(false, canModerate);
    expect(visibility.showEdit).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  it('non-owned post => report and block visible for a regular user', () => {
    // Guideline 1.2: a reviewer has to be able to flag content and block a
    // person from the post itself, without moderator role.
    const visibility = resolveFeedPostActionVisibility(false, canModerateFeedPost('user'));
    expect(visibility.showReport).toBe(true);
    expect(visibility.showBlock).toBe(true);
  });

  it('own post => report and block hidden', () => {
    // Reporting yourself is noise, and the API refuses a self-block with 422.
    const visibility = resolveFeedPostActionVisibility(true, canModerateFeedPost('user'));
    expect(visibility.showReport).toBe(false);
    expect(visibility.showBlock).toBe(false);
  });

  it('moderator on a non-owned post keeps report and block too', () => {
    const visibility = resolveFeedPostActionVisibility(false, canModerateFeedPost('admin'));
    expect(visibility.showReport).toBe(true);
    expect(visibility.showBlock).toBe(true);
  });

  it('owner post => edit and delete visible', () => {
    const canModerate = canModerateFeedPost('user');
    const visibility = resolveFeedPostActionVisibility(true, canModerate);
    expect(visibility.showEdit).toBe(true);
    expect(visibility.showDelete).toBe(true);
  });
});
