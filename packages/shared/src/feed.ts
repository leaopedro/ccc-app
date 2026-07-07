import { z } from 'zod';

// ---------- Enums ----------

export const feedAccessSchema = z.enum(['public', 'attendees', 'members_only']);
export type FeedAccess = z.infer<typeof feedAccessSchema>;

export const postingAccessSchema = z.enum(['attendees', 'members_only', 'organizers_only']);
export type PostingAccess = z.infer<typeof postingAccessSchema>;

export const feedPostStatusSchema = z.enum(['visible', 'hidden', 'removed']);
export type FeedPostStatus = z.infer<typeof feedPostStatusSchema>;

export const feedCommentStatusSchema = z.enum(['visible', 'hidden', 'removed']);
export type FeedCommentStatus = z.infer<typeof feedCommentStatusSchema>;

export const reportStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportTargetKindSchema = z.enum(['post', 'comment']);
export type ReportTargetKind = z.infer<typeof reportTargetKindSchema>;

// ---------- Per-event settings ----------

export const FEED_DEFAULT_MAX_PHOTOS_PER_USER = 5;
export const FEED_DEFAULT_FEED_ACCESS: FeedAccess = 'attendees';
export const FEED_DEFAULT_POSTING_ACCESS: PostingAccess = 'attendees';

export const feedSettingsSchema = z.object({
  feedEnabled: z.boolean(),
  feedAccess: feedAccessSchema,
  postingAccess: postingAccessSchema,
  maxPostsPerUser: z.number().int().positive().nullable(),
  maxPhotosPerUser: z.number().int().positive(),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

export const feedSettingsUpdateSchema = feedSettingsSchema.partial();
export type FeedSettingsUpdate = z.infer<typeof feedSettingsUpdateSchema>;

export const defaultFeedSettings: FeedSettings = {
  feedEnabled: true,
  feedAccess: FEED_DEFAULT_FEED_ACCESS,
  postingAccess: FEED_DEFAULT_POSTING_ACCESS,
  maxPostsPerUser: null,
  maxPhotosPerUser: FEED_DEFAULT_MAX_PHOTOS_PER_USER,
};

// ---------- Public car identity ----------
// Public identity for feed posts is the Car, not the user.
// This shape MUST NOT include plate, owner identity, or contact info.

export const publicCarPhotoSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type PublicCarPhoto = z.infer<typeof publicCarPhotoSchema>;

export const publicCarProfileSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().nullable(),
  modifications: z.array(z.string()),
  photo: publicCarPhotoSchema.nullable(),
  // Computed in the API serializer from the owner's Garage (premiumTier +
  // premiumUntil). Never persisted on the post/comment; read-only flag for
  // rendering a PremiumBadge next to the car identity.
  isPremiumActive: z.boolean(),
});
export type PublicCarProfile = z.infer<typeof publicCarProfileSchema>;

// ---------- Post / Comment / Reaction response shapes ----------

export const feedPostPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sortOrder: z.number().int().nonnegative(),
});
export type FeedPostPhoto = z.infer<typeof feedPostPhotoSchema>;

export const feedReactionSummarySchema = z.object({
  likes: z.number().int().nonnegative(),
  mine: z.boolean(),
});
export type FeedReactionSummary = z.infer<typeof feedReactionSummarySchema>;

export const feedPostResponseSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  car: publicCarProfileSchema.nullable(),
  body: z.string(),
  status: feedPostStatusSchema,
  photos: z.array(feedPostPhotoSchema),
  reactions: feedReactionSummarySchema,
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FeedPostResponse = z.infer<typeof feedPostResponseSchema>;

export const feedCommentResponseSchema = z.object({
  id: z.string().min(1),
  postId: z.string().min(1),
  car: publicCarProfileSchema.nullable(),
  body: z.string(),
  status: feedCommentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FeedCommentResponse = z.infer<typeof feedCommentResponseSchema>;

export const feedListResponseSchema = z.object({
  posts: z.array(feedPostResponseSchema),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type FeedListResponse = z.infer<typeof feedListResponseSchema>;

export const feedCommentListResponseSchema = z.object({
  comments: z.array(feedCommentResponseSchema),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type FeedCommentListResponse = z.infer<typeof feedCommentListResponseSchema>;

export const feedPostPatchInputSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  photoObjectKeys: z.array(z.string().min(1).max(300)).max(1).optional(),
  carId: z.undefined({ message: 'carId cannot be changed after publish' }).optional(),
});
export type FeedPostPatchInput = z.infer<typeof feedPostPatchInputSchema>;

export const feedReactionInputSchema = z.object({
  kind: z.enum(['like', 'dislike']),
});
export type FeedReactionInput = z.infer<typeof feedReactionInputSchema>;

// ---------- Inputs ----------

export const feedPostCreateInputSchema = z.object({
  carId: z.string().min(1).optional(),
  body: z.string().trim().min(1).max(2000),
  photoObjectKeys: z.array(z.string().min(1).max(300)).max(1).optional(),
});
export type FeedPostCreateInput = z.infer<typeof feedPostCreateInputSchema>;

export const feedCommentCreateInputSchema = z.object({
  carId: z.string().min(1).optional(),
  body: z.string().trim().min(1).max(1000),
});
export type FeedCommentCreateInput = z.infer<typeof feedCommentCreateInputSchema>;

export const feedReportInputSchema = z.object({
  targetKind: reportTargetKindSchema,
  targetId: z.string().min(1),
  reason: z.string().trim().min(1).max(300),
});
export type FeedReportInput = z.infer<typeof feedReportInputSchema>;

// ---------- Privacy contract ----------
// Forbidden top-level or nested keys for any feed RESPONSE schema.
// Centralised so the contract test in __tests__/feed-privacy-contract.test.ts
// can iterate and prove every public response shape is clean.

export const FEED_FORBIDDEN_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  'plate',
  'email',
  'phone',
  'cpf',
  'userId',
  'ownerId',
  'address',
]);

export const FEED_PUBLIC_RESPONSE_SCHEMAS = {
  publicCarProfile: publicCarProfileSchema,
  feedPostResponse: feedPostResponseSchema,
  feedCommentResponse: feedCommentResponseSchema,
  feedListResponse: feedListResponseSchema,
  feedCommentListResponse: feedCommentListResponseSchema,
  feedReactionSummary: feedReactionSummarySchema,
  feedPostPhoto: feedPostPhotoSchema,
  publicCarPhoto: publicCarPhotoSchema,
  feedSettings: feedSettingsSchema,
} as const;

// ---------- Moderation inputs ----------

export const banScopeSchema = z.enum(['view', 'post']);
export type BanScope = z.infer<typeof banScopeSchema>;

export const moderatePostInputSchema = z.object({
  action: z.enum(['hide', 'remove', 'restore']),
});
export type ModeratePostInput = z.infer<typeof moderatePostInputSchema>;

export const moderateCommentInputSchema = z.object({
  action: z.enum(['hide', 'remove', 'restore']),
});
export type ModerateCommentInput = z.infer<typeof moderateCommentInputSchema>;

export const resolveReportInputSchema = z.object({
  resolution: z.string().trim().min(1).max(300),
});
export type ResolveReportInput = z.infer<typeof resolveReportInputSchema>;

export const createFeedBanInputSchema = z.object({
  userId: z.string().min(1),
  scope: banScopeSchema,
  reason: z.string().trim().max(300).optional(),
});
export type CreateFeedBanInput = z.infer<typeof createFeedBanInputSchema>;

// ---------- Moderation response shapes ----------

export const feedBanResponseSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().nullable(),
  scope: banScopeSchema,
  reason: z.string().nullable(),
  bannedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type FeedBanResponse = z.infer<typeof feedBanResponseSchema>;

export const reportResponseSchema = z.object({
  id: z.string().min(1),
  targetKind: reportTargetKindSchema,
  targetId: z.string().min(1),
  reporterName: z.string().nullable(),
  reason: z.string(),
  status: reportStatusSchema,
  resolution: z.string().nullable(),
  resolverName: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

export const moderationQueueItemSchema = z.object({
  kind: z.enum(['post', 'comment']),
  id: z.string().min(1),
  body: z.string(),
  status: z.string(),
  authorName: z.string().nullable(),
  carNickname: z.string().nullable(),
  // Computed from the author's Garage. Null when the moderated post/comment
  // has no car attachment (carId is null).
  isPremiumActive: z.boolean().nullable(),
  openReportCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;
