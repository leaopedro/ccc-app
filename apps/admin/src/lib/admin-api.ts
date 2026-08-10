import {
  adminEventDetailSchema,
  adminEventListResponseSchema,
  adminExtraSchema,
  adminProductTypeListResponseSchema,
  adminProductTypeSchema,
  adminFinanceByEventResponseSchema,
  adminFinanceByProductResponseSchema,
  adminFinanceMembershipsResponseSchema,
  adminFinancePaymentMixResponseSchema,
  adminFinanceSummarySchema,
  adminFinanceTrendResponseSchema,
  adminGrantTicketResponseSchema,
  adminGroupDetailSchema,
  adminGroupListResponseSchema,
  adminGroupMembersResponseSchema,
  adminStoreCollectionDetailSchema,
  adminStoreCollectionListResponseSchema,
  adminStoreCollectionSchema,
  adminStoreInventoryListResponseSchema,
  adminStoreOrderDetailSchema,
  adminStoreOrderListResponseSchema,
  adminStoreProductDetailSchema,
  adminStoreProductListResponseSchema,
  adminStoreProductLookupResponseSchema,
  adminStoreProductPhotoSchema,
  adminStoreVariantSchema,
  adminUserCreatedSchema,
  adminUserDetailSchema,
  adminUserSearchResponseSchema,
  type AdminUserDetail,
  adminUserStatusUpdatedSchema,
  type AdminCreateUserBody,
  type AdminEventCreate,
  type AdminEventUpdate,
  type AdminExtraCreate,
  type AdminExtraUpdate,
  type AdminGroupCreate,
  type AdminGroupUpdate,
  type AdminProductTypeCreate,
  type AdminProductTypeUpdate,
  type AdminFinanceByEventResponse,
  type AdminFinanceMembershipsQuery,
  type AdminFinanceMembershipsResponse,
  type AdminFinancePaymentMixResponse,
  type AdminFinanceQuery,
  type AdminFinanceSummary,
  type AdminFinanceTrendResponse,
  type AdminGrantTicket,
  type AdminStoreCollectionCreate,
  type AdminStoreInventoryFilter,
  type AdminStoreInventoryListResponse,
  type AdminStoreOrderDetail,
  type AdminStoreOrderListResponse,
  type AdminStoreOrderQuery,
  type AdminStoreProductLookupResponse,
  type AdminStoreCollectionUpdate,
  type AdminStoreProductCreate,
  type AdminStoreProductPhotoCreate,
  type AdminStoreProductUpdate,
  type AdminStoreVariantCreate,
  type AdminStoreVariantUpdate,
  type AdminTierCreate,
  type AdminTierUpdate,
  adminTicketTierSchema,
  type AdminAuditListResponse,
  adminAuditListResponseSchema,
  adminPremiumAddonModuleSchema,
  adminPremiumBenefitsReplaceResponseSchema,
  adminPremiumCatalogResponseSchema,
  adminPremiumPlanPriceSchema,
  adminPremiumPlanSchema,
  type AdminPremiumAddonModuleCreate,
  type AdminPremiumAddonModuleUpdate,
  type AdminPremiumBenefitsReplace,
  type AdminPremiumPlanCreate,
  type AdminPremiumPlanUpdate,
  type AdminPremiumPriceUpsert,
} from '@ccc/shared/admin';
import {
  adminBoxCatalogItemSchema,
  adminBoxCatalogListSchema,
  adminBoxSettingsSchema,
  adminPartnerListSchema,
  adminPartnerModuleSchema,
  adminPartnerSchema,
  type AdminBoxCatalogItemCreate,
  type AdminBoxCatalogItemUpdate,
  type AdminBoxSettingsUpdate,
  type AdminPartnerCreate,
  type AdminPartnerModuleCreate,
  type AdminPartnerModuleUpdate,
  type AdminPartnerUpdate,
} from '@ccc/shared/admin-box';
import {
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionDetailSchema,
  type AdminSubscriptionAddonAttach,
  type AdminSubscriptionChangePlan,
} from '@ccc/shared/admin-subscription';
import {
  checkInEventsResponseSchema,
  extraClaimRequestSchema,
  extraClaimResponseSchema,
  pickupVoucherClaimRequestSchema,
  pickupVoucherClaimResponseSchema,
  ticketCheckInRequestSchema,
  ticketCheckInResponseSchema,
  type ExtraClaimRequest,
  type ExtraClaimResponse,
  type PickupVoucherClaimRequest,
  type PickupVoucherClaimResponse,
  type TicketCheckInRequest,
  type TicketCheckInResponse,
} from '@ccc/shared/check-in';
import {
  createFeedBanInputSchema,
  feedBanResponseSchema,
  moderationQueueItemSchema,
  reportResponseSchema,
  type CreateFeedBanInput,
  type ModerateCommentInput,
  type ModeratePostInput,
} from '@ccc/shared/feed';
import {
  generalSettingsSchema,
  type GeneralSettings,
  type GeneralSettingsUpdate,
} from '@ccc/shared/general-settings';
import { USER_DOCUMENT_STATUSES } from '@ccc/shared/documents';
import { publicProfileSchema } from '@ccc/shared/profile';
import {
  storeSettingsSchema,
  type AdminStoreFulfillmentUpdate,
  type StoreSettings,
  type StoreSettingsUpdate,
} from '@ccc/shared/store';
import {
  adminSupportTicketDetailSchema,
  adminSupportTicketListResponseSchema,
  type AdminSupportTicketDetail,
  type AdminSupportTicketListResponse,
  type SupportTicketInternalStatus,
} from '@ccc/shared/support';
import { z } from 'zod';

import {
  broadcastDryRunResponseSchema,
  broadcastListResponseSchema,
  broadcastSummarySchema,
  createBroadcastRequestSchema,
  updateBroadcastRequestSchema,
  type BroadcastDryRunRequest,
  type BroadcastDryRunResponse,
  type BroadcastListResponse,
  type BroadcastSummary,
  type CreateBroadcastRequest,
  type UpdateBroadcastRequest,
} from '../../../../packages/shared/src/broadcasts';

import { apiFetch, apiFetchRedirectLocation } from './api';

export const listAdminEvents = () =>
  apiFetch('/admin/events', { schema: adminEventListResponseSchema });

export const getAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}`, { schema: adminEventDetailSchema });

export const createAdminEvent = (input: AdminEventCreate) =>
  apiFetch('/admin/events', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminEventDetailSchema,
  });

export const updateAdminEvent = (id: string, input: AdminEventUpdate) =>
  apiFetch(`/admin/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminEventDetailSchema,
  });

export const publishAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}/publish`, {
    method: 'POST',
    schema: adminEventDetailSchema,
  });

export const unpublishAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}/unpublish`, {
    method: 'POST',
    schema: adminEventDetailSchema,
  });

export const cancelAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}/cancel`, {
    method: 'POST',
    schema: adminEventDetailSchema,
  });

export const createTier = (eventId: string, input: AdminTierCreate) =>
  apiFetch(`/admin/events/${eventId}/tiers`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminTicketTierSchema,
  });

export const updateTier = (eventId: string, tierId: string, input: AdminTierUpdate) =>
  apiFetch(`/admin/events/${eventId}/tiers/${tierId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminTicketTierSchema,
  });

export const deleteTier = (eventId: string, tierId: string) =>
  apiFetch(`/admin/events/${eventId}/tiers/${tierId}`, {
    method: 'DELETE',
    schema: adminTicketTierSchema, // returns 204; apiFetch returns undefined
  });

export const listExtras = (eventId: string) =>
  apiFetch(`/admin/events/${eventId}/extras`, {
    schema: z.object({ items: z.array(adminExtraSchema) }),
  });

export const createExtra = (eventId: string, input: AdminExtraCreate) =>
  apiFetch(`/admin/events/${eventId}/extras`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminExtraSchema,
  });

export const updateExtra = (extraId: string, input: AdminExtraUpdate) =>
  apiFetch(`/admin/extras/${extraId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminExtraSchema,
  });

export const deleteExtra = (extraId: string) =>
  apiFetch(`/admin/extras/${extraId}`, {
    method: 'DELETE',
    schema: adminExtraSchema,
  });

// ── Admin store: product types ─────────────────────────────────────

export const listAdminProductTypes = () =>
  apiFetch('/admin/store/product-types', {
    schema: adminProductTypeListResponseSchema,
  });

export const createAdminProductType = (input: AdminProductTypeCreate) =>
  apiFetch('/admin/store/product-types', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminProductTypeSchema,
  });

export const updateAdminProductType = (id: string, input: AdminProductTypeUpdate) =>
  apiFetch(`/admin/store/product-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminProductTypeSchema,
  });

export const deleteAdminProductType = (id: string) =>
  apiFetch(`/admin/store/product-types/${id}`, {
    method: 'DELETE',
    schema: adminProductTypeSchema, // 204
  });

// ── Admin premium catalog ──────────────────────────────────────────

export const getAdminPremiumCatalog = () =>
  apiFetch('/admin/premium/catalog', { schema: adminPremiumCatalogResponseSchema });

export const createAdminPremiumPlan = (input: AdminPremiumPlanCreate) =>
  apiFetch('/admin/premium/plans', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPremiumPlanSchema,
  });

export const updateAdminPremiumPlan = (id: string, input: AdminPremiumPlanUpdate) =>
  apiFetch(`/admin/premium/plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPremiumPlanSchema,
  });

export const deleteAdminPremiumPlan = (id: string) =>
  apiFetch(`/admin/premium/plans/${id}`, {
    method: 'DELETE',
    schema: adminPremiumPlanSchema,
  });

export const upsertAdminPremiumPrice = (
  id: string,
  cadence: 'monthly' | 'annual',
  input: AdminPremiumPriceUpsert,
) =>
  apiFetch(`/admin/premium/plans/${id}/prices/${cadence}`, {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminPremiumPlanPriceSchema,
  });

export const replaceAdminPremiumBenefits = (id: string, input: AdminPremiumBenefitsReplace) =>
  apiFetch(`/admin/premium/plans/${id}/benefits`, {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminPremiumBenefitsReplaceResponseSchema,
  });

export const createAdminPremiumModule = (input: AdminPremiumAddonModuleCreate) =>
  apiFetch('/admin/premium/addon-modules', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPremiumAddonModuleSchema,
  });

export const updateAdminPremiumModule = (id: string, input: AdminPremiumAddonModuleUpdate) =>
  apiFetch(`/admin/premium/addon-modules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPremiumAddonModuleSchema,
  });

export const deleteAdminPremiumModule = (id: string) =>
  apiFetch(`/admin/premium/addon-modules/${id}`, {
    method: 'DELETE',
    schema: adminPremiumAddonModuleSchema,
  });

export const listCheckInEvents = () =>
  apiFetch('/admin/check-in/events', { schema: checkInEventsResponseSchema });

export const checkInTicket = (input: TicketCheckInRequest): Promise<TicketCheckInResponse> =>
  apiFetch('/admin/tickets/check-in', {
    method: 'POST',
    body: JSON.stringify(ticketCheckInRequestSchema.parse(input)),
    schema: ticketCheckInResponseSchema,
  });

export const claimExtraItem = (input: ExtraClaimRequest): Promise<ExtraClaimResponse> =>
  apiFetch('/admin/extras/claim', {
    method: 'POST',
    body: JSON.stringify(extraClaimRequestSchema.parse(input)),
    schema: extraClaimResponseSchema,
  });

export const claimPickupVoucher = (
  input: PickupVoucherClaimRequest,
): Promise<PickupVoucherClaimResponse> =>
  apiFetch('/admin/store/pickup/voucher/claim', {
    method: 'POST',
    body: JSON.stringify(pickupVoucherClaimRequestSchema.parse(input)),
    schema: pickupVoucherClaimResponseSchema,
  });

// ── Admin users ────────────────────────────────────────────────────

export const searchAdminUsers = (params?: { q?: string; cursor?: string; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.q) sp.set('q', params.q);
  if (params?.cursor) sp.set('cursor', params.cursor);
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetch(`/admin/users${qs ? `?${qs}` : ''}`, {
    schema: adminUserSearchResponseSchema,
  });
};

// Cast, not a plain return-type annotation: adminUserDetailSchema has
// `.default()` fields (hasCpf, hasPhone, documents), which makes their INPUT
// type optional even though the parsed OUTPUT (what schema.parse actually
// returns at runtime) always has them present. apiFetch's `schema:
// ZodType<T>` parameter defaults its contravariant Input type param to `=
// T`, so inferring T from the schema argument leaks that input-side
// optionality into T's shape — hasCpf/hasPhone/documents type as
// possibly-undefined even though the schema guarantees them. A plain
// `: Promise<AdminUserDetail>` annotation still fails structural
// assignability for the same reason; the cast sidesteps the (spurious)
// input-side check and asserts the schema's own documented Output type.
export const getAdminUser = (id: string) =>
  apiFetch(`/admin/users/${id}`, { schema: adminUserDetailSchema }) as Promise<AdminUserDetail>;

export const createAdminUser = (input: AdminCreateUserBody) =>
  apiFetch('/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminUserCreatedSchema,
  });

export const disableAdminUser = (id: string) =>
  apiFetch(`/admin/users/${id}/disable`, {
    method: 'POST',
    schema: adminUserStatusUpdatedSchema,
  });

export const enableAdminUser = (id: string) =>
  apiFetch(`/admin/users/${id}/enable`, {
    method: 'POST',
    schema: adminUserStatusUpdatedSchema,
  });

export const getMe = () => apiFetch('/me', { schema: publicProfileSchema });

// ── Admin document review ──────────────────────────────────────────
// See apps/api/src/routes/admin/documents.ts. Approve/reject responses have
// no shared zod schema (admin-only surface), so they are defined inline
// here, matching the file-wide convention for routes without one (e.g. the
// feed moderation helpers above).

const adminDocumentReviewResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(USER_DOCUMENT_STATUSES),
  reviewedAt: z.string().datetime(),
  rejectionReason: z.string().nullable().optional(),
});

// GET /admin/documents/:id/file replies with a 302 redirect to a short-TTL
// signed URL, not JSON — see apiFetchRedirectLocation for why apiFetch
// cannot be reused here.
export const getAdminDocumentFileUrl = (documentId: string): Promise<string> =>
  apiFetchRedirectLocation(`/admin/documents/${documentId}/file`);

export const approveAdminDocument = (documentId: string) =>
  apiFetch(`/admin/documents/${documentId}/approve`, {
    method: 'POST',
    schema: adminDocumentReviewResponseSchema,
  });

export const rejectAdminDocument = (documentId: string, reason: string) =>
  apiFetch(`/admin/documents/${documentId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    schema: adminDocumentReviewResponseSchema,
  });

export const grantTicket = (input: AdminGrantTicket) =>
  apiFetch('/admin/tickets/grant', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminGrantTicketResponseSchema,
  });

// ── Feed moderation helpers ───────────────────────────────────────

export const listFeedModerationQueue = (eventId: string) =>
  apiFetch(`/admin/events/${eventId}/feed/queue`, {
    schema: z.object({ items: z.array(moderationQueueItemSchema) }),
  });

export const listFeedReports = (
  eventId: string,
  status: 'open' | 'resolved' | 'dismissed' = 'open',
) =>
  apiFetch(`/admin/events/${eventId}/feed/reports?status=${status}`, {
    schema: z.object({ reports: z.array(reportResponseSchema) }),
  });

export const resolveFeedReport = (eventId: string, reportId: string, resolution: string) =>
  apiFetch(`/admin/events/${eventId}/feed/reports/${reportId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution }),
    schema: z.object({ ok: z.boolean() }),
  });

export const dismissFeedReport = (eventId: string, reportId: string) =>
  apiFetch(`/admin/events/${eventId}/feed/reports/${reportId}/dismiss`, {
    method: 'POST',
    schema: z.object({ ok: z.boolean() }),
  });

export const listFeedBans = (eventId: string) =>
  apiFetch(`/admin/events/${eventId}/feed/bans`, {
    schema: z.object({ bans: z.array(feedBanResponseSchema) }),
  });

export const createFeedBan = (eventId: string, input: CreateFeedBanInput) =>
  apiFetch(`/admin/events/${eventId}/feed/bans`, {
    method: 'POST',
    body: JSON.stringify(createFeedBanInputSchema.parse(input)),
    schema: z.object({
      id: z.string().min(1),
      scope: feedBanResponseSchema.shape.scope,
    }),
  });

export const deleteFeedBan = (eventId: string, banId: string) =>
  apiFetch(`/admin/events/${eventId}/feed/bans/${banId}`, {
    method: 'DELETE',
    schema: z.unknown(),
  });

export const moderateFeedPost = (
  eventId: string,
  postId: string,
  action: ModeratePostInput['action'],
) =>
  apiFetch(`/admin/events/${eventId}/feed/posts/${postId}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ action }),
    schema: z.object({ ok: z.boolean(), status: z.string() }),
  });

export const moderateFeedComment = (
  eventId: string,
  commentId: string,
  action: ModerateCommentInput['action'],
) =>
  apiFetch(`/admin/events/${eventId}/feed/comments/${commentId}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ action }),
    schema: z.object({ ok: z.boolean(), status: z.string() }),
  });

// ── Admin finance ────────────────────────────────────────────────────

export const financeQs = (q?: AdminFinanceQuery) => {
  if (!q) return '';
  const sp = new URLSearchParams();
  if (q.from) sp.set('from', q.from);
  if (q.to) sp.set('to', q.to);
  if (q.eventIds) q.eventIds.forEach((id) => sp.append('eventIds', id));
  if (q.search) sp.set('search', q.search);
  if (q.city) sp.set('city', q.city);
  if (q.stateCode) sp.set('stateCode', q.stateCode);
  if (q.provider) sp.set('provider', q.provider);
  if (q.method) sp.set('method', q.method);
  if (q.statuses) q.statuses.forEach((s) => sp.append('statuses', s));
  const str = sp.toString();
  return str ? `?${str}` : '';
};

export const getFinanceSummary = (q?: AdminFinanceQuery): Promise<AdminFinanceSummary> =>
  apiFetch(`/admin/finance/summary${financeQs(q)}`, { schema: adminFinanceSummarySchema });

export const getFinanceByEvent = (q?: AdminFinanceQuery): Promise<AdminFinanceByEventResponse> =>
  apiFetch(`/admin/finance/by-event${financeQs(q)}`, {
    schema: adminFinanceByEventResponseSchema,
  });

export const getFinanceTrends = (q?: AdminFinanceQuery): Promise<AdminFinanceTrendResponse> =>
  apiFetch(`/admin/finance/trends${financeQs(q)}`, { schema: adminFinanceTrendResponseSchema });

export const getFinancePaymentMix = (
  q?: AdminFinanceQuery,
): Promise<AdminFinancePaymentMixResponse> =>
  apiFetch(`/admin/finance/payment-mix${financeQs(q)}`, {
    schema: adminFinancePaymentMixResponseSchema,
  });

export const getFinanceByProduct = (q?: AdminFinanceQuery) =>
  apiFetch(`/admin/finance/by-product${financeQs(q)}`, {
    schema: adminFinanceByProductResponseSchema,
  });

export const getFinanceExportUrl = (q?: AdminFinanceQuery) =>
  `/admin/finance/export${financeQs(q)}`;

export const getFinanceMemberships = (
  q?: AdminFinanceMembershipsQuery,
): Promise<AdminFinanceMembershipsResponse> => {
  const params = new URLSearchParams();
  if (q?.status) params.set('status', q.status);
  if (q?.cadence) params.set('cadence', q.cadence);
  if (q?.tier) params.set('tier', q.tier);
  if (q?.provider) params.set('provider', q.provider);
  if (q?.from) params.set('from', q.from);
  if (q?.to) params.set('to', q.to);
  if (q?.search) params.set('search', q.search);
  if (q?.garageId) params.set('garageId', q.garageId);
  if (q?.addonKey) params.set('addonKey', q.addonKey);
  if (q?.vendorName) params.set('vendorName', q.vendorName);
  if (q?.page) params.set('page', String(q.page));
  if (q?.pageSize) params.set('pageSize', String(q.pageSize));
  const qs = params.toString();
  return apiFetch(`/admin/finance/memberships${qs ? `?${qs}` : ''}`, {
    schema: adminFinanceMembershipsResponseSchema,
  });
};

// ── Admin assinaturas ─────────────────────────────────────────────────

export const getAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}`, { schema: adminSubscriptionDetailSchema });

export const changeAdminSubscriptionPlan = (id: string, input: AdminSubscriptionChangePlan) =>
  apiFetch(`/admin/subscriptions/${id}/plan`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminSubscriptionActionResponseSchema,
  });

export const attachAdminSubscriptionAddon = (id: string, input: AdminSubscriptionAddonAttach) =>
  apiFetch(`/admin/subscriptions/${id}/addons`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminSubscriptionAddonMutationResponseSchema,
  });

export const detachAdminSubscriptionAddon = (id: string, addonKey: string) =>
  apiFetch(`/admin/subscriptions/${id}/addons/${encodeURIComponent(addonKey)}`, {
    method: 'DELETE',
    schema: adminSubscriptionAddonMutationResponseSchema,
  });

export const cancelAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });

export const resumeAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });

export const pauseAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });

// ── Admin store collections ───────────────────────────────────────────

export const listAdminCollections = () =>
  apiFetch('/admin/store/collections', { schema: adminStoreCollectionListResponseSchema });

export const getAdminCollection = (id: string) =>
  apiFetch(`/admin/store/collections/${id}`, { schema: adminStoreCollectionDetailSchema });

export const createAdminCollection = (input: AdminStoreCollectionCreate) =>
  apiFetch('/admin/store/collections', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminStoreCollectionSchema,
  });

export const updateAdminCollection = (id: string, input: AdminStoreCollectionUpdate) =>
  apiFetch(`/admin/store/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminStoreCollectionSchema,
  });

export const deleteAdminCollection = (id: string) =>
  apiFetch(`/admin/store/collections/${id}`, {
    method: 'DELETE',
    schema: z.unknown(),
  });

export const reorderAdminCollections = (ids: string[]) =>
  apiFetch('/admin/store/collections/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids }),
    schema: z.unknown(),
  });

export const setAdminCollectionProducts = (id: string, productIds: string[]) =>
  apiFetch(`/admin/store/collections/${id}/products`, {
    method: 'PUT',
    body: JSON.stringify({ productIds }),
    schema: adminStoreCollectionDetailSchema,
  });

export const lookupAdminStoreProducts = (): Promise<AdminStoreProductLookupResponse> =>
  apiFetch('/admin/store/products/lookup', { schema: adminStoreProductLookupResponseSchema });

export const getAdminStoreSettings = (): Promise<StoreSettings> =>
  apiFetch('/admin/store/settings', { schema: storeSettingsSchema });

export const updateAdminStoreSettings = (input: StoreSettingsUpdate): Promise<StoreSettings> =>
  apiFetch('/admin/store/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: storeSettingsSchema,
  });

export const getAdminGeneralSettings = (): Promise<GeneralSettings> =>
  apiFetch('/admin/general/settings', { schema: generalSettingsSchema });

export const updateAdminGeneralSettings = (
  input: GeneralSettingsUpdate,
): Promise<GeneralSettings> =>
  apiFetch('/admin/general/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: generalSettingsSchema,
  });

// ── Admin broadcasts ───────────────────────────────────────────────

export const listAdminBroadcasts = (): Promise<BroadcastListResponse> =>
  apiFetch('/admin/broadcasts', {
    schema: broadcastListResponseSchema,
  });

export const getAdminBroadcast = (id: string): Promise<BroadcastSummary> =>
  apiFetch(`/admin/broadcasts/${id}`, {
    schema: broadcastSummarySchema,
  });

export const createAdminBroadcast = (input: CreateBroadcastRequest): Promise<BroadcastSummary> =>
  apiFetch('/admin/broadcasts', {
    method: 'POST',
    body: JSON.stringify(createBroadcastRequestSchema.parse(input)),
    schema: broadcastSummarySchema,
  });

export const updateAdminBroadcast = (
  id: string,
  input: UpdateBroadcastRequest,
): Promise<BroadcastSummary> =>
  apiFetch(`/admin/broadcasts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updateBroadcastRequestSchema.parse(input)),
    schema: broadcastSummarySchema,
  });

export const cancelAdminBroadcast = (id: string): Promise<BroadcastSummary> =>
  apiFetch(`/admin/broadcasts/${id}/cancel`, {
    method: 'POST',
    schema: broadcastSummarySchema,
  });

export const dryRunAdminBroadcast = (
  input: BroadcastDryRunRequest,
): Promise<BroadcastDryRunResponse> =>
  apiFetch('/admin/broadcasts/dry-run', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: broadcastDryRunResponseSchema,
  });
// ── Admin store: products / variants / photos ────────────────────────

export const listAdminStoreProducts = () =>
  apiFetch('/admin/store/products', { schema: adminStoreProductListResponseSchema });

export const getAdminStoreProduct = (id: string) =>
  apiFetch(`/admin/store/products/${id}`, { schema: adminStoreProductDetailSchema });

export const createAdminStoreProduct = (input: AdminStoreProductCreate) =>
  apiFetch('/admin/store/products', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminStoreProductDetailSchema,
  });

export const updateAdminStoreProduct = (id: string, input: AdminStoreProductUpdate) =>
  apiFetch(`/admin/store/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminStoreProductDetailSchema,
  });

export const createAdminStoreVariant = (productId: string, input: AdminStoreVariantCreate) =>
  apiFetch(`/admin/store/products/${productId}/variants`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminStoreVariantSchema,
  });

export const updateAdminStoreVariant = (variantId: string, input: AdminStoreVariantUpdate) =>
  apiFetch(`/admin/store/variants/${variantId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminStoreVariantSchema,
  });

export const deleteAdminStoreVariant = (variantId: string) =>
  apiFetch(`/admin/store/variants/${variantId}`, {
    method: 'DELETE',
    schema: adminStoreVariantSchema, // 200 on soft-disable, 204 on hard-delete
  });

export const createAdminStoreProductPhoto = (
  productId: string,
  input: AdminStoreProductPhotoCreate,
) =>
  apiFetch(`/admin/store/products/${productId}/photos`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminStoreProductPhotoSchema,
  });

export const deleteAdminStoreProductPhoto = (productId: string, photoId: string) =>
  apiFetch(`/admin/store/products/${productId}/photos/${photoId}`, {
    method: 'DELETE',
    schema: adminStoreProductPhotoSchema,
  });

export const listAdminStoreInventory = (
  filter: AdminStoreInventoryFilter = 'all',
): Promise<AdminStoreInventoryListResponse> => {
  const qs = filter === 'all' ? '' : `?status=${filter}`;
  return apiFetch(`/admin/store/inventory${qs}`, {
    schema: adminStoreInventoryListResponseSchema,
  });
};

export const listAdminStoreOrders = (
  query: AdminStoreOrderQuery = {},
): Promise<AdminStoreOrderListResponse> => {
  const params = new URLSearchParams();
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.kind && query.kind !== 'all') params.set('kind', query.kind);
  if (query.q) params.set('q', query.q);
  const qs = params.toString();
  return apiFetch(`/admin/store/orders${qs ? `?${qs}` : ''}`, {
    schema: adminStoreOrderListResponseSchema,
  });
};

export const getAdminStoreOrder = (id: string): Promise<AdminStoreOrderDetail> =>
  apiFetch(`/admin/store/orders/${id}`, { schema: adminStoreOrderDetailSchema });

export const updateAdminStoreOrderFulfillment = (
  id: string,
  input: AdminStoreFulfillmentUpdate,
): Promise<AdminStoreOrderDetail> =>
  apiFetch(`/admin/store/orders/${id}/fulfillment`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminStoreOrderDetailSchema,
  });

// ── Admin support tickets ─────────────────────────────────────────

export const listAdminSupportTickets = (opts?: {
  status?: 'open' | 'closed';
  cursor?: string;
}): Promise<AdminSupportTicketListResponse> => {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return apiFetch(`/admin/support${qs ? '?' + qs : ''}`, {
    schema: adminSupportTicketListResponseSchema,
  });
};

export const getAdminSupportTicket = (id: string): Promise<AdminSupportTicketDetail> =>
  apiFetch(`/admin/support/${id}`, { schema: adminSupportTicketDetailSchema });

export const closeAdminSupportTicket = (id: string): Promise<AdminSupportTicketDetail> =>
  apiFetch(`/admin/support/${id}/close`, {
    method: 'PATCH',
    schema: adminSupportTicketDetailSchema,
  });

export const updateAdminSupportTicketInternalStatus = (
  id: string,
  internalStatus: SupportTicketInternalStatus,
): Promise<AdminSupportTicketDetail> =>
  apiFetch(`/admin/support/${id}/internal-status`, {
    method: 'PATCH',
    body: JSON.stringify({ internalStatus }),
    schema: adminSupportTicketDetailSchema,
  });

// ── Admin groups ────────────────────────────────────────────────────

export const listAdminGroups = (params?: { cursor?: string; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.cursor) sp.set('cursor', params.cursor);
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetch(`/admin/groups${qs ? `?${qs}` : ''}`, {
    schema: adminGroupListResponseSchema,
  });
};

export const getAdminGroup = (id: string) =>
  apiFetch(`/admin/groups/${id}`, { schema: adminGroupDetailSchema });

export const createAdminGroup = (input: AdminGroupCreate) =>
  apiFetch('/admin/groups', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminGroupDetailSchema,
  });

export const updateAdminGroup = (id: string, input: AdminGroupUpdate) =>
  apiFetch(`/admin/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminGroupDetailSchema,
  });

export const listGroupMembers = (id: string, params?: { cursor?: string; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.cursor) sp.set('cursor', params.cursor);
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return apiFetch(`/admin/groups/${id}/members${qs ? `?${qs}` : ''}`, {
    schema: adminGroupMembersResponseSchema,
  });
};

export const addGroupMember = (groupId: string, userId: string) =>
  apiFetch(`/admin/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
    schema: adminGroupDetailSchema,
  });

export const removeGroupMember = (groupId: string, userId: string): Promise<void> =>
  apiFetch(`/admin/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
    schema: z.unknown(),
  }) as unknown as Promise<void>;

// ── Admin audit ──────────────────────────────────────────────────

export const listAdminAuditLogs = (opts?: {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}): Promise<AdminAuditListResponse> => {
  const params = new URLSearchParams();
  if (opts?.actorId) params.set('actorId', opts.actorId);
  if (opts?.action) params.set('action', opts.action);
  if (opts?.entityType) params.set('entityType', opts.entityType);
  if (opts?.entityId) params.set('entityId', opts.entityId);
  if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
  if (opts?.dateTo) params.set('dateTo', opts.dateTo);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch(`/admin/audit${qs ? '?' + qs : ''}`, {
    schema: adminAuditListResponseSchema,
  });
};

// ── Admin box catalog ─────────────────────────────────────────────

export const getBoxCatalog = () =>
  apiFetch('/admin/box/catalog-items', { schema: adminBoxCatalogListSchema });

export const createBoxCatalogItem = (input: AdminBoxCatalogItemCreate) =>
  apiFetch('/admin/box/catalog-items', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminBoxCatalogItemSchema,
  });

export const updateBoxCatalogItem = (id: string, input: AdminBoxCatalogItemUpdate) =>
  apiFetch(`/admin/box/catalog-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminBoxCatalogItemSchema,
  });

export const deleteBoxCatalogItem = (id: string) =>
  apiFetch(`/admin/box/catalog-items/${id}`, {
    method: 'DELETE',
    schema: adminBoxCatalogItemSchema,
  });

export const getBoxPartners = () =>
  apiFetch('/admin/box/partners', { schema: adminPartnerListSchema });

export const createBoxPartner = (input: AdminPartnerCreate) =>
  apiFetch('/admin/box/partners', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPartnerSchema,
  });

export const updateBoxPartner = (id: string, input: AdminPartnerUpdate) =>
  apiFetch(`/admin/box/partners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPartnerSchema,
  });

export const deleteBoxPartner = (id: string) =>
  apiFetch(`/admin/box/partners/${id}`, { method: 'DELETE', schema: adminPartnerSchema });

export const createBoxPartnerModule = (id: string, input: AdminPartnerModuleCreate) =>
  apiFetch(`/admin/box/partners/${id}/modules`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPartnerModuleSchema,
  });

export const updateBoxPartnerModule = (moduleId: string, input: AdminPartnerModuleUpdate) =>
  apiFetch(`/admin/box/partner-modules/${moduleId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPartnerModuleSchema,
  });

export const deleteBoxPartnerModule = (moduleId: string) =>
  apiFetch(`/admin/box/partner-modules/${moduleId}`, {
    method: 'DELETE',
    schema: adminPartnerModuleSchema,
  });

export const getBoxSettings = () =>
  apiFetch('/admin/box/settings', { schema: adminBoxSettingsSchema });

export const updateBoxSettings = (input: AdminBoxSettingsUpdate) =>
  apiFetch('/admin/box/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminBoxSettingsSchema,
  });
