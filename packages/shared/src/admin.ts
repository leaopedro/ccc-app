import { z } from 'zod';

import { userRoleSchema, userStatusSchema } from './auth.js';
import {
  eventDetailCommerceSchema,
  eventStatusSchema,
  eventTypeSchema,
  ticketTierSchema,
} from './events.js';
import {
  FEED_DEFAULT_FEED_ACCESS,
  FEED_DEFAULT_MAX_PHOTOS_PER_USER,
  FEED_DEFAULT_POSTING_ACCESS,
  feedAccessSchema,
  postingAccessSchema,
} from './feed.js';
import { orderStatusSchema } from './orders.js';
import { stateCodeSchema } from './profile.js';
import { storeFulfillmentStatusSchema } from './store.js';
import { ticketSourceSchema, ticketStatusSchema } from './tickets.js';

// Actions recorded in AdminAudit.action — literal union, no free-form strings.
export const adminAuditActionSchema = z.enum([
  'event.create',
  'event.update',
  'event.publish',
  'event.unpublish',
  'event.cancel',
  'tier.create',
  'tier.update',
  'tier.delete',
  'ticket.check_in',
  'ticket.grant_comp',
  'extra.create',
  'extra.update',
  'extra.delete',
  'extra.claim',
  'user.create',
  'user.disable',
  'user.enable',
  'user.role_changed',
  'store.collection.create',
  'store.collection.update',
  'store.collection.delete',
  'store.collection.reorder',
  'store.collection.assign_products',
  'store_settings.update',
  'general_settings.update',
  'store.product.create',
  'store.product.update',
  'store.product.archive',
  'store.product.activate',
  'store.variant.create',
  'store.variant.update',
  'store.variant.delete',
  'store.variant.disable',
  'store.photo.add',
  'store.photo.remove',
  'product_type.create',
  'product_type.update',
  'product_type.delete',
  'store.order.fulfillment_update',
  'box.fulfillment.advance',
  'store.pickup_voucher.claim',
  'support.ticket.close',
  'support.ticket.internal_status_update',
  'feed.post.hide',
  'feed.post.remove',
  'feed.post.restore',
  'feed.comment.hide',
  'feed.comment.remove',
  'feed.comment.restore',
  'feed.report.resolve',
  'feed.report.dismiss',
  'feed.ban.create',
  'feed.ban.delete',
  'mfa.setup_started',
  'mfa.enrolled',
  'mfa.disabled',
  'mfa.recovery_code_used',
  'mfa.recovery_codes_regenerated',
  'retention.purge',
  'dsr.create',
  'dsr.verify_identity',
  'dsr.start_processing',
  'dsr.complete',
  'dsr.deny',
  'dsr.update',
  'dsr.add_note',
  'group.create',
  'group.update',
  'group.add_member',
  'group.remove_member',
  'car.admin_update',
  'car.admin_delete',
  'garage_spot.delete',
  'general_settings.garage_backfill',
  'garage.backfill',
  'garage.premium_grant',
  'garage.premium_revoke',
  'garage.slug_override',
  'garage.update',
  'garage.spot_grant',
  'garage.spot_revoke',
  'garage.cover_set',
  'garage.cover_reset',
  'badge.award',
  'badge.pin',
  'badge.unpin',
  'xp.adjustment',
  'gamification.toggle',
  'premium.subscription.plan_changed',
  'premium.subscription.addon_attached',
  'premium.subscription.addon_detached',
  'premium.subscription.cancel_scheduled',
  'premium.subscription.resumed',
  'premium.subscription.paused',
  'premium.subscription.granted',
  'document_viewed',
  'document_approved',
  'document_rejected',
  'user.pii_viewed',
  'order.refund_requested',
]);
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;

// Entity types referenced by AdminAudit.entityType. The DB column is a free-form
// VARCHAR(40), but new code should constrain inserts to this union so audit
// surfaces stay typed. `garage` is added for the per-user pivot (spec §6.3).
export const adminAuditEntityTypeSchema = z.enum([
  'event',
  'tier',
  'extra',
  'ticket',
  'user',
  'store_collection',
  'store_settings',
  'general_settings',
  'product',
  'variant',
  'photo',
  'product_type',
  'order',
  'pickup_voucher',
  'support_ticket',
  'feed_post',
  'feed_comment',
  'feed_report',
  'feed_ban',
  'mfa',
  'retention',
  'dsr',
  'group',
  'car',
  'garage_spot',
  'garage',
  'premium_membership',
]);
export type AdminAuditEntityType = z.infer<typeof adminAuditEntityTypeSchema>;

const slugSchema = z
  .string()
  .min(3)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

const coverObjectKeySchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^event_cover\//, 'must be an event_cover key')
  .nullable();

// Nullable inputs coerce empty strings to null so the admin form can post
// blank optional fields without client-side plumbing.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().min(1).max(max).nullable(),
  );

export const adminEventCreateSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(10_000),
    coverObjectKey: coverObjectKeySchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    venueName: optionalText(140),
    venueAddress: optionalText(300),
    city: optionalText(100),
    stateCode: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      stateCodeSchema.nullable(),
    ),
    type: eventTypeSchema,
    capacity: z.number().int().nonnegative(),
    // null = unlimited tickets per user; admins set whatever cap they want.
    maxTicketsPerUser: z.number().int().min(1).nullable().default(null),
    feedEnabled: z.boolean().default(true),
    feedAccess: feedAccessSchema.default(FEED_DEFAULT_FEED_ACCESS),
    postingAccess: postingAccessSchema.default(FEED_DEFAULT_POSTING_ACCESS),
    maxPostsPerUser: z.number().int().positive().nullable().default(null),
    maxPhotosPerUser: z.number().int().positive().default(FEED_DEFAULT_MAX_PHOTOS_PER_USER),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type AdminEventCreate = z.infer<typeof adminEventCreateSchema>;

// Slug is omitted here; admins must use a separate endpoint path if we ever
// allow slug edits. Status is explicitly not editable — use publish/cancel.
export const adminEventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(10_000),
    coverObjectKey: coverObjectKeySchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    venueName: optionalText(140),
    venueAddress: optionalText(300),
    city: optionalText(100),
    stateCode: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      stateCodeSchema.nullable(),
    ),
    type: eventTypeSchema,
    capacity: z.number().int().nonnegative(),
    maxTicketsPerUser: z.number().int().min(1).nullable(),
    feedEnabled: z.boolean(),
    feedAccess: feedAccessSchema,
    postingAccess: postingAccessSchema,
    maxPostsPerUser: z.number().int().positive().nullable(),
    maxPhotosPerUser: z.number().int().positive(),
  })
  .partial()
  .strict();
export type AdminEventUpdate = z.infer<typeof adminEventUpdateSchema>;

// Admin tier view — includes the organizer-confidential quantitySold.
// `isPremiumGrantable` is always emitted by the API (DB column has a server-side
// default of false). We use a plain `z.boolean()` here instead of `.default(false)`
// so the inferred OUTPUT type stays a plain `boolean`. With `.default()` zod splits
// input/output (input `boolean | undefined`, output `boolean`) and TS picks the
// input side when this schema is composed via `.omit({ tiers: true }).extend()`,
// which breaks prop-type identity for downstream React components.
export const adminTicketTierSchema = ticketTierSchema.extend({
  quantitySold: z.number().int().nonnegative(),
  isPremiumGrantable: z.boolean(),
});
export type AdminTicketTier = z.infer<typeof adminTicketTierSchema>;

// Admin event detail — public detail + admin-only fields, with adminTicketTierSchema tiers.
export const adminEventDetailSchema = eventDetailCommerceSchema.omit({ tiers: true }).extend({
  status: eventStatusSchema,
  coverObjectKey: z.string().nullable(),
  maxTicketsPerUser: z.number().int().min(1).nullable(),
  feedEnabled: z.boolean(),
  feedAccess: feedAccessSchema,
  postingAccess: postingAccessSchema,
  maxPostsPerUser: z.number().int().positive().nullable(),
  maxPhotosPerUser: z.number().int().positive(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tiers: z.array(adminTicketTierSchema),
});
export type AdminEventDetail = z.infer<typeof adminEventDetailSchema>;

// List row — lean, suitable for a table.
export const adminEventRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string(),
  title: z.string(),
  status: eventStatusSchema,
  type: eventTypeSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  city: z.string().nullable(),
  stateCode: stateCodeSchema.nullable(),
  capacity: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminEventRow = z.infer<typeof adminEventRowSchema>;

export const adminEventListResponseSchema = z.object({
  items: z.array(adminEventRowSchema),
});
export type AdminEventListResponse = z.infer<typeof adminEventListResponseSchema>;

export const adminTierCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().length(3).default('BRL'),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable().optional(),
    salesCloseAt: z.string().datetime().nullable().optional(),
    sortOrder: z.number().int().optional(),
    requiresCar: z.boolean().optional(),
    isPremiumGrantable: z.boolean().default(false),
  })
  .refine(
    (v) => !v.salesOpenAt || !v.salesCloseAt || new Date(v.salesCloseAt) > new Date(v.salesOpenAt),
    { message: 'salesCloseAt must be after salesOpenAt', path: ['salesCloseAt'] },
  );
export type AdminTierCreate = z.infer<typeof adminTierCreateSchema>;

export const adminTierUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable(),
    salesCloseAt: z.string().datetime().nullable(),
    sortOrder: z.number().int(),
    requiresCar: z.boolean(),
    isPremiumGrantable: z.boolean(),
  })
  .partial()
  .strict();
export type AdminTierUpdate = z.infer<typeof adminTierUpdateSchema>;

export const adminGrantTicketSchema = z.object({
  userId: z.string().min(1),
  eventId: z.string().min(1),
  tierId: z.string().min(1),
  extras: z.array(z.string().min(1)).optional(),
  carId: z.string().min(1).optional(),
  licensePlate: z.string().trim().min(1).max(20).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});
export type AdminGrantTicket = z.infer<typeof adminGrantTicketSchema>;

export const adminGrantTicketResponseSchema = z.object({
  ticketId: z.string().min(1),
  code: z.string().min(1),
  extraItems: z.array(
    z.object({
      extraId: z.string().min(1),
      code: z.string().min(1),
    }),
  ),
});
export type AdminGrantTicketResponse = z.infer<typeof adminGrantTicketResponseSchema>;

// ── Admin tickets list ──────────────────────────────────────────────

export const adminTicketsListQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  tier: z.string().min(1).optional(),
  status: ticketStatusSchema.optional(),
  source: ticketSourceSchema.optional(),
  extra: z.string().min(1).optional(),
  q: z.string().min(1).max(200).optional(),
});
export type AdminTicketsListQuery = z.infer<typeof adminTicketsListQuerySchema>;

export const adminTicketHolderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable(),
});

export const adminTicketTierSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const adminTicketExtraSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.string(),
  usedAt: z.string().datetime().nullable(),
});

export const adminTicketRowSchema = z.object({
  id: z.string().min(1),
  holder: adminTicketHolderSchema,
  tier: adminTicketTierSummarySchema,
  extras: z.array(adminTicketExtraSchema),
  status: ticketStatusSchema,
  source: ticketSourceSchema,
  code: z.string().min(1),
  usedAt: z.string().datetime().nullable(),
  car: z.string().nullable(),
  licensePlate: z.string().nullable(),
});
export type AdminTicketRow = z.infer<typeof adminTicketRowSchema>;

export const adminTicketsListResponseSchema = z.object({
  items: z.array(adminTicketRowSchema),
  nextCursor: z.string().nullable(),
});
export type AdminTicketsListResponse = z.infer<typeof adminTicketsListResponseSchema>;

// ── Admin user create / disable / enable ──────────────────────────

export const adminCreateUserBodySchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
});
export type AdminCreateUserBody = z.infer<typeof adminCreateUserBodySchema>;

export const adminUserCreatedSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  status: userStatusSchema,
  createdAt: z.string().datetime(),
});
export type AdminUserCreated = z.infer<typeof adminUserCreatedSchema>;

export const adminUserStatusUpdatedSchema = z.object({
  id: z.string().min(1),
  status: userStatusSchema,
});
export type AdminUserStatusUpdated = z.infer<typeof adminUserStatusUpdatedSchema>;

export const adminUserRoleChangeBodySchema = z.object({
  role: userRoleSchema,
});
export type AdminUserRoleChangeBody = z.infer<typeof adminUserRoleChangeBodySchema>;

export const adminUserRoleChangedSchema = z.object({
  id: z.string().min(1),
  role: userRoleSchema,
});
export type AdminUserRoleChanged = z.infer<typeof adminUserRoleChangedSchema>;

// ── Admin user search + detail ─────────────────────────────────────

export const adminUserSearchQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuerySchema>;

export const adminUserRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable(),
  status: userStatusSchema,
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminUserSearchResponseSchema = z.object({
  items: z.array(adminUserRowSchema),
  nextCursor: z.string().nullable(),
});
export type AdminUserSearchResponse = z.infer<typeof adminUserSearchResponseSchema>;

export const adminUserDetailTicketSchema = z.object({
  id: z.string().min(1),
  status: ticketStatusSchema,
  source: ticketSourceSchema,
  eventTitle: z.string(),
  createdAt: z.string().datetime(),
});

export const adminUserDetailOrderSchema = z.object({
  id: z.string().min(1),
  status: orderStatusSchema,
  amountCents: z.number().int(),
  currency: z.string().length(3),
  eventTitle: z.string(),
  createdAt: z.string().datetime(),
});

export const adminUserGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
export type AdminUserGroup = z.infer<typeof adminUserGroupSchema>;

// Presence + review metadata only — never the file itself. The file is only
// ever handed out through the separately audited GET
// /admin/documents/:id/file. (CPF/phone are a different surface: see
// hasCpf/cpf and hasPhone/phone below, which the product owner deliberately
// chose to expose in full to the `admin` role, audited on every read.)
export const adminUserDetailDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  status: z.string(),
  sentAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
});
export type AdminUserDetailDocument = z.infer<typeof adminUserDetailDocumentSchema>;

export const adminUserDetailSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  // Defaulted rather than required: an older API build predating "perfil
  // progressivo" would omit these fields entirely, and a hard-parsing caller
  // (apps/admin/src/lib/admin-api.ts) must not throw on that response just
  // because both apps auto-deploy from the same merge with no ordering
  // guarantee between them.
  hasCpf: z.boolean().default(false),
  hasPhone: z.boolean().default(false),
  // Full values, `admin` role only. The API returns null for both to any
  // other role that can reach this route, exactly as if the member had not
  // filled them — the caller cannot tell "not admin" apart from "not filled"
  // from this payload alone. Defaulted to null for the same deploy-ordering
  // reason as hasCpf/hasPhone above: an older API build predating this field
  // must not make a hard-parsing caller throw.
  cpf: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  stats: z.object({
    totalTickets: z.number().int().nonnegative(),
    totalOrders: z.number().int().nonnegative(),
  }),
  recentTickets: z.array(adminUserDetailTicketSchema),
  recentOrders: z.array(adminUserDetailOrderSchema),
  groups: z.array(adminUserGroupSchema),
  documents: z.array(adminUserDetailDocumentSchema).default([]),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

// ── Extras ──────────────────────────────────────────────────────────────

export const adminExtraSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  currency: z.string(),
  quantityTotal: z.number().int().nonnegative().nullable(),
  quantitySold: z.number().int().nonnegative(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminExtra = z.infer<typeof adminExtraSchema>;

export const adminExtraCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(2000).optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default('BRL'),
  quantityTotal: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
});
export type AdminExtraCreate = z.infer<typeof adminExtraCreateSchema>;

export const adminExtraUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: optionalText(2000),
    priceCents: z.number().int().nonnegative(),
    quantityTotal: z.number().int().nonnegative().nullable(),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial()
  .strict();
export type AdminExtraUpdate = z.infer<typeof adminExtraUpdateSchema>;

// ── Store product types ────────────────────────────────────────────────

export const adminProductTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  sortOrder: z.number().int(),
  productCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AdminProductType = z.infer<typeof adminProductTypeSchema>;

export const adminProductTypeListResponseSchema = z.object({
  items: z.array(adminProductTypeSchema),
});
export type AdminProductTypeListResponse = z.infer<typeof adminProductTypeListResponseSchema>;

export const adminProductTypeCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().optional(),
});
export type AdminProductTypeCreate = z.infer<typeof adminProductTypeCreateSchema>;

export const adminProductTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sortOrder: z.number().int(),
  })
  .partial()
  .strict();
export type AdminProductTypeUpdate = z.infer<typeof adminProductTypeUpdateSchema>;

// ── Admin finance ─────────────────────────────────────────────────────

const coerceArray = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(inner));

export const adminFinanceQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  eventIds: coerceArray(z.string().min(1)).optional(),
  search: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  stateCode: stateCodeSchema.optional(),
  provider: z.enum(['stripe', 'abacatepay']).optional(),
  method: z.enum(['card', 'pix']).optional(),
  kind: z.enum(['tickets', 'store', 'membership', 'all']).optional(),
  cadence: z.enum(['monthly', 'annual', 'all']).optional(),
  tier: z.enum(['gold', 'all']).optional(),
  membershipStatus: z.enum(['active', 'past_due', 'cancel_scheduled', 'expired', 'all']).optional(),
  statuses: z.array(orderStatusSchema).min(1).optional(),
  /**
   * Revenue-mode scope. Absent means `live`.
   *
   * Before the live cutover, production ran entirely in Stripe test mode. Rows
   * from that period are marked `livemode = false` by
   * apps/api/src/scripts/mark-pre-cutover-orders.ts. Defaulting to `live` here
   * is what keeps the first real revenue report from silently including test
   * money; making the operator remember a parameter to be correct would not.
   *
   * Coverage: filters `Order` and `PremiumMembershipInvoice` rows (and every
   * figure derived from them — totalRevenueCents, netRevenueCents,
   * membershipRevenueCents, membershipNetRevenueCents,
   * membershipDevFeeCollectedCents, membershipRefundedCents). It does NOT
   * filter activeMembershipsCount, membershipMRRCents, membershipARPUCents,
   * newMembershipsCount or churnedMembershipsCount — those read directly from
   * `PremiumMembership`, which has no `livemode` column. That table's
   * test-mode exclusion is a different mechanism entirely:
   * apps/api/src/scripts/purge-test-mode.ts flips `status` to `expired`. See
   * `membershipCountsLivemodeFiltered` on `adminFinanceSummarySchema`.
   */
  livemode: z.enum(['live', 'test', 'all']).optional(),
});
export type AdminFinanceQuery = z.infer<typeof adminFinanceQuerySchema>;

export const adminFinanceSummarySchema = z.object({
  totalRevenueCents: z.number().int(),
  netRevenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  avgOrderCents: z.number().int().nonnegative(),
  ticketCount: z.number().int().nonnegative(),
  refundedCents: z.number().int(),
  refundedCount: z.number().int().nonnegative(),
  storeRevenueCents: z.number().int().nonnegative(),
  storeOrderCount: z.number().int().nonnegative(),
  // Current configured dev-fee percent. Reflects the env at request time, not the per-order snapshots.
  devFeePercent: z.number().int().nonnegative(),
  // Sum of Order.devFeeAmountCents on paid orders in window, minus refunded fee amounts.
  // Legacy orders snapshotted at devFeeAmountCents=0 stay zero — no retroactive imputation.
  devFeeCollectedCents: z.number().int(),
  // Membership KPIs (F8.13). Sums come from PremiumMembershipInvoice rows — devFee and
  // gross are read from the snapshot column (canon §F8.1), never re-derived from env.
  membershipRevenueCents: z.number().int().nonnegative(),
  membershipNetRevenueCents: z.number().int(),
  membershipDevFeeCollectedCents: z.number().int().nonnegative(),
  membershipRefundedCents: z.number().int().nonnegative(),
  activeMembershipsCount: z.number().int().nonnegative(),
  newMembershipsCount: z.number().int().nonnegative(),
  churnedMembershipsCount: z.number().int().nonnegative(),
  // MRR: monthly cadence → grossAmountCents; annual cadence → Math.round(grossAmountCents/12)
  // per spec §7.3 + canon §F8.13.
  membershipMRRCents: z.number().int().nonnegative(),
  // ARPU = membershipNetRevenueCents / activeMembershipsCount; guarded /0 → 0.
  // Net (and therefore ARPU) can be negative in windows where refunds exceed
  // gross — keep the sign so the dashboard can render the loss period.
  membershipARPUCents: z.number().int(),
  // Always `false`. Documents, in the response itself and not just in a
  // schema comment, that activeMembershipsCount, membershipMRRCents,
  // membershipARPUCents, newMembershipsCount and churnedMembershipsCount are
  // NOT scoped by the `livemode` query parameter — they read `PremiumMembership`
  // directly, which has no `livemode` column. A reader must not infer full
  // livemode coverage from the presence of the `livemode` filter elsewhere in
  // this same response.
  membershipCountsLivemodeFiltered: z.literal(false),
  // True when neither `Order` nor `PremiumMembershipInvoice` has ANY row with
  // `livemode = false` yet — i.e. `mark-pre-cutover-orders` has apparently
  // never been run. Until it runs, every pre-cutover test-mode row still
  // defaults to `livemode = true`, so the `live` (default) scope of this very
  // response may silently include test money. This is a purely evidence-based
  // check (did any row ever get flipped) — it does NOT know or guess a cutover
  // instant, and it says nothing once a partial backfill has happened.
  livemodeBackfillPending: z.boolean(),
});
export type AdminFinanceSummary = z.infer<typeof adminFinanceSummarySchema>;

export const adminFinanceEventRowSchema = z.object({
  eventId: z.string().min(1),
  eventTitle: z.string(),
  startsAt: z.string().datetime(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  revenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  ticketCount: z.number().int().nonnegative(),
  refundedCents: z.number().int(),
});
export type AdminFinanceEventRow = z.infer<typeof adminFinanceEventRowSchema>;

export const adminFinanceByEventResponseSchema = z.object({
  items: z.array(adminFinanceEventRowSchema),
});
export type AdminFinanceByEventResponse = z.infer<typeof adminFinanceByEventResponseSchema>;

export const adminFinanceTrendPointSchema = z.object({
  date: z.string(),
  revenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  ticketRevenueCents: z.number().int().nonnegative(),
  storeRevenueCents: z.number().int().nonnegative(),
  // Membership invoice revenue per daily bucket (F8.13). Membership-only days
  // surface a point with orderCount=0 + storeRevenueCents=0 + ticketRevenueCents=0.
  membershipRevenueCents: z.number().int().nonnegative(),
});
export type AdminFinanceTrendPoint = z.infer<typeof adminFinanceTrendPointSchema>;

export const adminFinanceTrendResponseSchema = z.object({
  points: z.array(adminFinanceTrendPointSchema),
});
export type AdminFinanceTrendResponse = z.infer<typeof adminFinanceTrendResponseSchema>;

export const adminFinanceProductRowSchema = z.object({
  productId: z.string().min(1),
  productTitle: z.string(),
  orderCount: z.number().int().nonnegative(),
  quantitySold: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});
export type AdminFinanceProductRow = z.infer<typeof adminFinanceProductRowSchema>;

export const adminFinanceByProductResponseSchema = z.object({
  items: z.array(adminFinanceProductRowSchema),
});
export type AdminFinanceByProductResponse = z.infer<typeof adminFinanceByProductResponseSchema>;

export const adminFinancePaymentMixItemSchema = z.object({
  provider: z.string(),
  method: z.string(),
  revenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  percentage: z.number(),
});
export type AdminFinancePaymentMixItem = z.infer<typeof adminFinancePaymentMixItemSchema>;

export const adminFinancePaymentMixResponseSchema = z.object({
  items: z.array(adminFinancePaymentMixItemSchema),
});
export type AdminFinancePaymentMixResponse = z.infer<typeof adminFinancePaymentMixResponseSchema>;

// ── Admin finance: memberships list (F8.14) ──────────────────────────
//
// Forward-compat for F8.16 (`/financeiro/membros` per-garage drill-down):
// `garageId` is surfaced as an optional filter so the same list endpoint can
// scope to a single garage without a follow-up schema bump.
export const adminFinanceMembershipsQuerySchema = z.object({
  status: z
    .enum(['trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused'])
    .optional(),
  cadence: z.enum(['monthly', 'annual']).optional(),
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  provider: z.enum(['stripe', 'apple_revenuecat']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().min(1).max(200).optional(),
  garageId: z.string().min(1).optional(),
  /** Filtra assinaturas que possuem este modulo com status active ou cancel_scheduled. */
  addonKey: z.string().min(1).max(40).optional(),
  /**
   * Filtra assinaturas que possuem qualquer modulo deste fornecedor, mesmos
   * status. Casamento exato, nao contains: a origem dos valores e o proprio
   * catalogo, nao texto livre do usuario.
   */
  vendorName: z.string().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminFinanceMembershipsQuery = z.infer<typeof adminFinanceMembershipsQuerySchema>;

export const adminFinanceMembershipsItemSchema = z.object({
  membershipId: z.string().min(1),
  garageSlug: z.string(),
  userName: z.string(),
  userId: z.string().min(1),
  userEmail: z.string(),
  tier: z.enum(['bronze', 'silver', 'gold']),
  cadence: z.enum(['monthly', 'annual']),
  status: z.enum(['trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused']),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  totalPaidCents: z.number().int().nonnegative(),
  invoiceCount: z.number().int().nonnegative(),
  provider: z.enum(['stripe', 'apple_revenuecat']),
  providerSubRef: z.string(),
  baseAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  paymentBrand: z.string().nullable(),
  paymentLast4: z.string().nullable(),
  /** Chaves dos modulos vinculados, para chips na tabela. */
  addonKeys: z.array(z.string()),
});
export type AdminFinanceMembershipsItem = z.infer<typeof adminFinanceMembershipsItemSchema>;

export const adminFinanceMembershipsResponseSchema = z.object({
  items: z.array(adminFinanceMembershipsItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type AdminFinanceMembershipsResponse = z.infer<typeof adminFinanceMembershipsResponseSchema>;

// ── Admin store collections ──────────────────────────────────────────

const adminCollectionDescription = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).max(2_000).nullable(),
);

export const adminStoreCollectionSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(140),
  name: z.string().min(1).max(140),
  description: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  productCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminStoreCollection = z.infer<typeof adminStoreCollectionSchema>;

export const adminStoreCollectionListResponseSchema = z.object({
  items: z.array(adminStoreCollectionSchema),
});
export type AdminStoreCollectionListResponse = z.infer<
  typeof adminStoreCollectionListResponseSchema
>;

export const adminStoreCollectionProductSchema = z.object({
  productId: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  title: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']),
});
export type AdminStoreCollectionProduct = z.infer<typeof adminStoreCollectionProductSchema>;

export const adminStoreCollectionDetailSchema = adminStoreCollectionSchema.extend({
  products: z.array(adminStoreCollectionProductSchema),
});
export type AdminStoreCollectionDetail = z.infer<typeof adminStoreCollectionDetailSchema>;

export const adminStoreCollectionCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(140),
  description: adminCollectionDescription.optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type AdminStoreCollectionCreate = z.infer<typeof adminStoreCollectionCreateSchema>;

export const adminStoreCollectionUpdateSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(140),
    description: adminCollectionDescription,
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .partial()
  .strict();
export type AdminStoreCollectionUpdate = z.infer<typeof adminStoreCollectionUpdateSchema>;

export const adminStoreCollectionReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
export type AdminStoreCollectionReorder = z.infer<typeof adminStoreCollectionReorderSchema>;

export const adminStoreCollectionProductsSchema = z.object({
  productIds: z.array(z.string().min(1)).max(500),
});
export type AdminStoreCollectionProducts = z.infer<typeof adminStoreCollectionProductsSchema>;

export const adminStoreProductLookupItemSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']),
});
export type AdminStoreProductLookupItem = z.infer<typeof adminStoreProductLookupItemSchema>;

export const adminStoreProductLookupResponseSchema = z.object({
  items: z.array(adminStoreProductLookupItemSchema),
});
export type AdminStoreProductLookupResponse = z.infer<typeof adminStoreProductLookupResponseSchema>;

// --- Store admin: products, variants, photos ---

export const adminStoreProductStatusSchema = z.enum(['draft', 'active', 'archived']);
export type AdminStoreProductStatus = z.infer<typeof adminStoreProductStatusSchema>;

const productSlugSchema = z
  .string()
  .min(3)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

const productPhotoObjectKeySchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^product_photo\//, 'must be a product_photo key');

export const adminStoreVariantAttributesSchema = z.record(z.string().min(1).max(40)).default({});
export type AdminStoreVariantAttributes = z.infer<typeof adminStoreVariantAttributesSchema>;

export const adminStoreVariantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  quantityTotal: z.number().int().nonnegative(),
  quantitySold: z.number().int().nonnegative(),
  attributes: z.record(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminStoreVariant = z.infer<typeof adminStoreVariantSchema>;

export const adminStoreVariantCreateSchema = z.object({
  name: z.string().trim().min(1).max(140),
  sku: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().min(1).max(80).nullable(),
  ),
  priceCents: z.number().int().nonnegative(),
  quantityTotal: z.number().int().nonnegative(),
  attributes: adminStoreVariantAttributesSchema,
  active: z.boolean().default(true),
});
export type AdminStoreVariantCreate = z.infer<typeof adminStoreVariantCreateSchema>;

export const adminStoreVariantUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(140).optional(),
    sku: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
        z.string().trim().min(1).max(80).nullable(),
      )
      .optional(),
    priceCents: z.number().int().nonnegative().optional(),
    quantityTotal: z.number().int().nonnegative().optional(),
    attributes: adminStoreVariantAttributesSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminStoreVariantUpdate = z.infer<typeof adminStoreVariantUpdateSchema>;

export const adminStoreProductPhotoSchema = z.object({
  id: z.string(),
  objectKey: z.string(),
  url: z.string().url(),
  sortOrder: z.number().int(),
});
export type AdminStoreProductPhoto = z.infer<typeof adminStoreProductPhotoSchema>;

export const adminStoreProductPhotoCreateSchema = z.object({
  objectKey: productPhotoObjectKeySchema,
  sortOrder: z.number().int().nonnegative().default(0),
});
export type AdminStoreProductPhotoCreate = z.infer<typeof adminStoreProductPhotoCreateSchema>;

export const adminStoreProductDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  productTypeId: z.string(),
  productTypeName: z.string(),
  basePriceCents: z.number().int().nonnegative(),
  currency: z.string(),
  status: adminStoreProductStatusSchema,
  virtual: z.boolean(),
  visibleInStore: z.boolean(),
  allowPickup: z.boolean(),
  allowShip: z.boolean(),
  shippingFeeCents: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  variants: z.array(adminStoreVariantSchema),
  photos: z.array(adminStoreProductPhotoSchema),
});
export type AdminStoreProductDetail = z.infer<typeof adminStoreProductDetailSchema>;

export const adminStoreProductCreateSchema = z.object({
  slug: productSlugSchema,
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(10_000),
  productTypeId: z.string().min(1),
  basePriceCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default('BRL'),
  allowPickup: z.boolean().default(false),
  allowShip: z.boolean().default(false),
  shippingFeeCents: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : v),
      z.number().int().nonnegative().nullable(),
    )
    .default(null),
});
export type AdminStoreProductCreate = z.infer<typeof adminStoreProductCreateSchema>;

export const adminStoreProductUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    description: z.string().trim().min(1).max(10_000).optional(),
    productTypeId: z.string().min(1).optional(),
    basePriceCents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    allowPickup: z.boolean().optional(),
    allowShip: z.boolean().optional(),
    shippingFeeCents: z
      .preprocess(
        (v) => (v === '' || v === null || v === undefined ? null : v),
        z.number().int().nonnegative().nullable(),
      )
      .optional(),
    status: adminStoreProductStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminStoreProductUpdate = z.infer<typeof adminStoreProductUpdateSchema>;

export const adminStoreProductRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: adminStoreProductStatusSchema,
  basePriceCents: z.number().int().nonnegative(),
  currency: z.string(),
  productTypeId: z.string(),
  productTypeName: z.string(),
  virtual: z.boolean(),
  visibleInStore: z.boolean(),
  variantCount: z.number().int().nonnegative(),
  photoCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminStoreProductRow = z.infer<typeof adminStoreProductRowSchema>;

export const adminStoreProductListResponseSchema = z.object({
  items: z.array(adminStoreProductRowSchema),
});
export type AdminStoreProductListResponse = z.infer<typeof adminStoreProductListResponseSchema>;

export const adminStoreInventoryStatusSchema = z.enum(['ok', 'low', 'zero']);
export type AdminStoreInventoryStatus = z.infer<typeof adminStoreInventoryStatusSchema>;

export const adminStoreInventoryFilterSchema = z.enum(['all', 'low', 'zero']);
export type AdminStoreInventoryFilter = z.infer<typeof adminStoreInventoryFilterSchema>;

export const adminStoreInventoryRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  productSlug: z.string(),
  productTitle: z.string(),
  productStatus: adminStoreProductStatusSchema,
  variantName: z.string(),
  sku: z.string().nullable(),
  attributes: z.record(z.string()),
  active: z.boolean(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string(),
  quantityTotal: z.number().int().nonnegative(),
  quantitySold: z.number().int().nonnegative(),
  available: z.number().int(),
  status: adminStoreInventoryStatusSchema,
  updatedAt: z.string().datetime(),
});
export type AdminStoreInventoryRow = z.infer<typeof adminStoreInventoryRowSchema>;

export const adminStoreInventoryListResponseSchema = z.object({
  threshold: z.number().int().nonnegative(),
  totals: z.object({
    all: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    zero: z.number().int().nonnegative(),
  }),
  items: z.array(adminStoreInventoryRowSchema),
});
export type AdminStoreInventoryListResponse = z.infer<typeof adminStoreInventoryListResponseSchema>;

// --- Store admin orders queue (Pedidos) ---

export const adminStoreOrderKindSchema = z.enum(['product', 'mixed']);
export type AdminStoreOrderKind = z.infer<typeof adminStoreOrderKindSchema>;

export const adminFulfillmentMethodSchema = z.enum(['ship', 'pickup']);
export type AdminFulfillmentMethod = z.infer<typeof adminFulfillmentMethodSchema>;

// Queue filter buckets — broader than raw status so the UI can group naturally.
export const adminStoreOrderQueueFilterSchema = z.enum([
  'all',
  'open',
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'pickup_ready',
  'picked_up',
  'cancelled',
]);
export type AdminStoreOrderQueueFilter = z.infer<typeof adminStoreOrderQueueFilterSchema>;

const orderKindFilterSchema = z.enum(['all', 'product', 'mixed']);

export const adminStoreOrderQuerySchema = z.object({
  status: adminStoreOrderQueueFilterSchema.optional(),
  kind: orderKindFilterSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type AdminStoreOrderQuery = z.infer<typeof adminStoreOrderQuerySchema>;

export const adminStoreOrderRowSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  kind: adminStoreOrderKindSchema,
  paymentStatus: orderStatusSchema,
  fulfillmentStatus: storeFulfillmentStatusSchema,
  fulfillmentMethod: adminFulfillmentMethodSchema,
  amountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  currency: z.string(),
  itemCount: z.number().int().nonnegative(),
  customerName: z.string(),
  customerEmail: z.string(),
  trackingCode: z.string().nullable(),
  hasShippingAddress: z.boolean(),
  paidAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminStoreOrderRow = z.infer<typeof adminStoreOrderRowSchema>;

export const adminStoreOrderQueueTotalsSchema = z.object({
  all: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  unfulfilled: z.number().int().nonnegative(),
  packed: z.number().int().nonnegative(),
  shipped: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  pickup_ready: z.number().int().nonnegative(),
  picked_up: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
export type AdminStoreOrderQueueTotals = z.infer<typeof adminStoreOrderQueueTotalsSchema>;

export const adminStoreOrderListResponseSchema = z.object({
  totals: adminStoreOrderQueueTotalsSchema,
  items: z.array(adminStoreOrderRowSchema),
});
export type AdminStoreOrderListResponse = z.infer<typeof adminStoreOrderListResponseSchema>;

export const adminStoreOrderItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['product', 'ticket', 'extras']),
  variantId: z.string().nullable(),
  productId: z.string().nullable(),
  productTitle: z.string().nullable(),
  variantName: z.string().nullable(),
  variantSku: z.string().nullable(),
  variantAttributes: z.record(z.string()).nullable(),
  tierId: z.string().nullable(),
  tierName: z.string().nullable(),
  extraId: z.string().nullable(),
  extraLabel: z.string().nullable(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
});
export type AdminStoreOrderItem = z.infer<typeof adminStoreOrderItemSchema>;

export const adminStoreOrderShippingAddressSchema = z.object({
  recipientName: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  number: z.string(),
  district: z.string(),
  city: z.string(),
  stateCode: z.string(),
  postalCode: z.string(),
  phone: z.string().nullable(),
});
export type AdminStoreOrderShippingAddress = z.infer<typeof adminStoreOrderShippingAddressSchema>;

export const adminStoreOrderAuditEntrySchema = z.object({
  id: z.string(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: adminAuditActionSchema,
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type AdminStoreOrderAuditEntry = z.infer<typeof adminStoreOrderAuditEntrySchema>;

export const adminStoreOrderDetailSchema = adminStoreOrderRowSchema.extend({
  provider: z.enum(['stripe', 'abacatepay']),
  providerRef: z.string().nullable(),
  notes: z.string().nullable(),
  customer: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  shippingAddress: adminStoreOrderShippingAddressSchema.nullable(),
  pickupEventId: z.string().nullable(),
  pickupEventTitle: z.string().nullable(),
  pickupTicketId: z.string().nullable(),
  items: z.array(adminStoreOrderItemSchema),
  history: z.array(adminStoreOrderAuditEntrySchema),
});
export type AdminStoreOrderDetail = z.infer<typeof adminStoreOrderDetailSchema>;

/**
 * Assisted refund. Executed by the founder from the admin, never by the
 * customer and never automatically.
 *
 * `amountCents` is optional but, as of fix round 1, may ONLY equal the
 * order's full `amountCents` — the route (apps/api/src/routes/admin/refunds.ts)
 * rejects any other value with 422. Partial refunds are refused, not
 * supported: stripe-webhook.ts's `charge.refunded` handler deliberately
 * leaves `Order.status` untouched on `amount_refunded < amount`, so a
 * partial here would move real money at Stripe while returning the same 202
 * a full refund returns — indistinguishable "done" vs. "drifted, needs a
 * human". Kept in the schema anyway (cleaner than an amount-less shape) but
 * effectively a no-partial field: omit it, or pass the full amount.
 */
export const adminOrderRefundSchema = z.object({
  reason: z.string().min(10).max(500),
  amountCents: z.number().int().positive().optional(),
});
export type AdminOrderRefund = z.infer<typeof adminOrderRefundSchema>;

export const adminOrderRefundResponseSchema = z.object({
  requested: z.literal(true),
  provider: z.literal('stripe'),
});
export type AdminOrderRefundResponse = z.infer<typeof adminOrderRefundResponseSchema>;

// adminStoreFulfillmentUpdateSchema is exported from ./store.js — re-exported via index.

// --- User Groups ---

export const adminGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().default(null),
});
export type AdminGroupCreate = z.infer<typeof adminGroupCreateSchema>;

export const adminGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().min(1).max(500).nullable().optional(),
    ),
  })
  .strict();
export type AdminGroupUpdate = z.infer<typeof adminGroupUpdateSchema>;

export const adminGroupRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AdminGroupRow = z.infer<typeof adminGroupRowSchema>;

export const adminGroupDetailSchema = adminGroupRowSchema.extend({
  updatedAt: z.string().datetime(),
});
export type AdminGroupDetail = z.infer<typeof adminGroupDetailSchema>;

export const adminGroupListResponseSchema = z.object({
  items: z.array(adminGroupRowSchema),
  nextCursor: z.string().nullable(),
});

export const adminGroupMemberSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string(),
  userEmail: z.string(),
  joinedAt: z.string().datetime(),
});
export type AdminGroupMember = z.infer<typeof adminGroupMemberSchema>;

export const adminGroupMembersResponseSchema = z.object({
  items: z.array(adminGroupMemberSchema),
  nextCursor: z.string().nullable(),
});

export const adminGroupAddMemberSchema = z.object({
  userId: z.string().min(1),
});
export type AdminGroupAddMember = z.infer<typeof adminGroupAddMemberSchema>;

// ── Audit query ────────────────────────────────────────────────────

export const adminAuditListQuerySchema = z.object({
  actorId: z.string().optional(),
  action: adminAuditActionSchema.optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminAuditListQuery = z.infer<typeof adminAuditListQuerySchema>;

export const adminAuditItemSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AdminAuditItem = z.infer<typeof adminAuditItemSchema>;

export const adminAuditListResponseSchema = z.object({
  items: z.array(adminAuditItemSchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditListResponse = z.infer<typeof adminAuditListResponseSchema>;

// ── Admin garage / car management ──────────────────────────────────────

// Admin-only car update. Reuses public car field constraints but is a strict object
// so unrelated client keys (e.g. tier) are rejected here — tier changes go through
// the dedicated POST /admin/users/:id/cars/:carId/tier endpoint (TASK-G).
export const adminCarUpdateSchema = z
  .object({
    make: z.string().trim().min(1).max(60).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: z
      .number()
      .int()
      .min(1900)
      .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' })
      .optional(),
    nickname: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
        z.string().trim().min(1).max(60).nullable(),
      )
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminCarUpdate = z.infer<typeof adminCarUpdateSchema>;

// ── Admin premium catalog ──────────────────────────────────────────────
//
// ADMIN surface for the premium subscription catalog. Unlike the public read
// schemas in ./premium-catalog.ts, these DO carry provider price ids
// (stripePriceId / rcProductId) and inactive rows. Never wire these into the
// public /api/plans routes.

const premiumTierSchema = z.enum(['bronze', 'silver', 'gold']);
const premiumCadenceSchema = z.enum(['monthly', 'annual']);
const premiumAddonUnitSchema = z.enum(['access', 'hours']);

const premiumPlanSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

const premiumModuleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key must be lowercase alphanumeric with - or _');

// Provider ids: blank string coerces to null so the admin form can clear them.
const providerIdSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).max(120).nullable(),
);

// --- Response shapes (admin view: provider ids + inactive rows included) ---

export const adminPremiumPlanPriceSchema = z.object({
  cadence: premiumCadenceSchema,
  baseAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  stripePriceId: z.string().nullable(),
  rcProductId: z.string().nullable(),
  active: z.boolean(),
});
export type AdminPremiumPlanPrice = z.infer<typeof adminPremiumPlanPriceSchema>;

export const adminPremiumPlanBenefitSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  sortOrder: z.number().int(),
});
export type AdminPremiumPlanBenefit = z.infer<typeof adminPremiumPlanBenefitSchema>;

export const adminPremiumPlanSchema = z.object({
  id: z.string().min(1),
  tier: premiumTierSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  monthlyBoxBudgetCents: z.number().int(),
  prices: z.array(adminPremiumPlanPriceSchema),
  benefits: z.array(adminPremiumPlanBenefitSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminPremiumPlan = z.infer<typeof adminPremiumPlanSchema>;

export const adminPremiumAddonModuleSchema = z.object({
  id: z.string().min(1),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  monthlyDeltaCents: z.number().int().nonnegative(),
  payoutAmountCents: z.number().int().nonnegative(),
  vendorName: z.string().nullable(),
  currency: z.string(),
  quotaPerCycle: z.number().int(),
  quotaUnit: premiumAddonUnitSchema,
  active: z.boolean(),
  sortOrder: z.number().int(),
  stripePriceId: z.string().nullable(),
  rcProductId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminPremiumAddonModule = z.infer<typeof adminPremiumAddonModuleSchema>;

export const adminPremiumCatalogResponseSchema = z.object({
  plans: z.array(adminPremiumPlanSchema),
  modules: z.array(adminPremiumAddonModuleSchema),
});
export type AdminPremiumCatalogResponse = z.infer<typeof adminPremiumCatalogResponseSchema>;

export const adminPremiumBenefitsReplaceResponseSchema = z.object({
  benefits: z.array(adminPremiumPlanBenefitSchema),
});
export type AdminPremiumBenefitsReplaceResponse = z.infer<
  typeof adminPremiumBenefitsReplaceResponseSchema
>;

// --- Inputs ---

// tier is the immutable identity of a plan; it is only set on create.
export const adminPremiumPlanCreateSchema = z.object({
  tier: premiumTierSchema,
  slug: premiumPlanSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: optionalText(500).optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().optional(),
  monthlyBoxBudgetCents: z.number().int().nonnegative().optional(),
});
export type AdminPremiumPlanCreate = z.infer<typeof adminPremiumPlanCreateSchema>;

export const adminPremiumPlanUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: optionalText(500),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    monthlyBoxBudgetCents: z.number().int().nonnegative(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminPremiumPlanUpdate = z.infer<typeof adminPremiumPlanUpdateSchema>;

export const adminPremiumPriceUpsertSchema = z.object({
  baseAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default('BRL'),
  stripePriceId: providerIdSchema.optional(),
  rcProductId: providerIdSchema.optional(),
  active: z.boolean().default(true),
});
export type AdminPremiumPriceUpsert = z.infer<typeof adminPremiumPriceUpsertSchema>;

export const adminPremiumBenefitInputSchema = z.object({
  label: z.string().trim().min(1).max(140),
  sortOrder: z.number().int().nonnegative(),
});
export type AdminPremiumBenefitInput = z.infer<typeof adminPremiumBenefitInputSchema>;

export const adminPremiumBenefitsReplaceSchema = z.object({
  benefits: z.array(adminPremiumBenefitInputSchema).max(50),
});
export type AdminPremiumBenefitsReplace = z.infer<typeof adminPremiumBenefitsReplaceSchema>;

export const adminPremiumAddonModuleCreateSchema = z.object({
  key: premiumModuleKeySchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  monthlyDeltaCents: z.number().int().nonnegative(),
  payoutAmountCents: z.number().int().nonnegative().default(0),
  vendorName: z.string().trim().min(1).max(120).nullable().optional(),
  quotaPerCycle: z.number().int().nonnegative(),
  quotaUnit: premiumAddonUnitSchema,
  currency: z.string().length(3).default('BRL'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().optional(),
  stripePriceId: providerIdSchema.optional(),
  rcProductId: providerIdSchema.optional(),
});
export type AdminPremiumAddonModuleCreate = z.infer<typeof adminPremiumAddonModuleCreateSchema>;

export const adminPremiumAddonModuleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    monthlyDeltaCents: z.number().int().nonnegative(),
    payoutAmountCents: z.number().int().nonnegative().optional(),
    vendorName: z.string().trim().min(1).max(120).nullable().optional(),
    quotaPerCycle: z.number().int().nonnegative(),
    quotaUnit: premiumAddonUnitSchema,
    currency: z.string().length(3),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    stripePriceId: providerIdSchema,
    rcProductId: providerIdSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminPremiumAddonModuleUpdate = z.infer<typeof adminPremiumAddonModuleUpdateSchema>;
