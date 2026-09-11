// Conquistas (badges) server-facing copy. PT-BR is primary. `Badge.title` in
// the database is now the source of truth for the per-code title (NOT NULL,
// seeded), so this file only keeps the copy that has no home in a table: the
// fixed notification shell used when a badge is awarded.

/** Canonical notification title for badge-awarded events. */
export const BADGE_AWARDED_NOTIFICATION_TITLE = 'Nova conquista!';

/** Canonical Notification.kind for badge-awarded inbox rows. */
export const BADGE_AWARDED_NOTIFICATION_KIND = 'badge_awarded';

/** Build the dedupeKey for a badge-awarded notification. */
export const badgeAwardedDedupeKey = (code: string, userId: string): string =>
  `badge:${code}:${userId}`;
