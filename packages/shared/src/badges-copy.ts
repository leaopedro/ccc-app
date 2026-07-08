// Conquistas (badges) server-facing copy. PT-BR is primary. This is the
// minimal subset the API needs (title per code) to mint Notification rows
// when a badge is awarded. The mobile app holds the richer two-level
// `badgesCopy` object (titles + descriptions + criteria + labels); we keep
// the API surface narrow on purpose so a future locale package move stays
// mechanical without forcing the API to depend on UI-only copy.
//
// Codes must mirror packages/db's Badge.code values verbatim. Adding a new
// catalog code REQUIRES an entry here so the manual-grant notification has
// a real `body` to ship.

export const BADGE_TITLES_PT_BR: Record<string, string> = {
  'EVT-001': 'Primeira Largada',
  'EVT-002': 'Sequência de Três',
  'EVT-003': 'Veterano de Pista',
  'CAR-001': 'Garagem Aberta',
  'CAR-002': 'Garagem Cheia',
  'CAR-003': 'Curador CCC',
  'COM-001': 'Primeira Postagem',
  'COM-002': 'Voz da Comunidade',
  'COM-003': 'Em Chamas',
  'JDM-001': 'Marco Fixado',
  'JDM-002': 'Itinerário CCC',
  'JDM-003': 'Fundador',
};

/**
 * Resolve the PT-BR title for a badge code. Falls back to the raw code if
 * the catalog grows server-side before the copy table is updated — the
 * Notification still ships (no empty body) and the missing entry is
 * surfaced by the next release-time copy audit instead of dropping a row.
 */
export const badgeTitlePtBr = (code: string): string => BADGE_TITLES_PT_BR[code] ?? code;

/** Canonical notification title for badge-awarded events. */
export const BADGE_AWARDED_NOTIFICATION_TITLE = 'Nova conquista!';

/** Canonical Notification.kind for badge-awarded inbox rows. */
export const BADGE_AWARDED_NOTIFICATION_KIND = 'badge_awarded';

/** Build the dedupeKey for a badge-awarded notification. */
export const badgeAwardedDedupeKey = (code: string, userId: string): string =>
  `badge:${code}:${userId}`;
