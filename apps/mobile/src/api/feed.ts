import {
  type FeedCommentCreateInput,
  feedCommentListResponseSchema,
  type FeedCommentListResponse,
  type FeedCommentResponse,
  feedCommentResponseSchema,
  type FeedListResponse,
  feedListResponseSchema,
  type FeedPostCreateInput,
  type FeedPostPatchInput,
  feedPostResponseSchema,
  type FeedPostResponse,
  feedReactionSummarySchema,
  type FeedReactionSummary,
} from '@ccc/shared/feed';
import { reportCreateResponseSchema } from '@ccc/shared/reports';
import { z } from 'zod';

import { ApiError, authedRequest, request } from './client';

const enc = encodeURIComponent;

export const listFeedPosts = async (eventId: string, page: number): Promise<FeedListResponse> => {
  const path = `/events/${enc(eventId)}/feed?page=${page}`;
  try {
    return await authedRequest(path, feedListResponseSchema);
  } catch (error) {
    // Web boot can hit feed before auth provider/token is ready.
    // Feed read supports anonymous access; safely fall back to public request.
    if (
      (error instanceof ApiError && error.status === 401) ||
      (error instanceof Error &&
        (error.message === 'token provider not registered' || error.message === 'no access token'))
    ) {
      return request(path, feedListResponseSchema);
    }
    throw error;
  }
};

export const createFeedPost = (
  eventId: string,
  input: FeedPostCreateInput,
): Promise<FeedPostResponse> =>
  authedRequest(`/events/${enc(eventId)}/feed`, feedPostResponseSchema, {
    method: 'POST',
    body: input,
  });

export const patchFeedPost = (
  eventId: string,
  postId: string,
  input: FeedPostPatchInput,
): Promise<FeedPostResponse> =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}`, feedPostResponseSchema, {
    method: 'PATCH',
    body: input,
  });

export const deleteFeedPost = (eventId: string, postId: string): Promise<null> =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}`, z.null(), { method: 'DELETE' });

export const toggleFeedReaction = (
  eventId: string,
  postId: string,
  kind: 'like' | 'dislike',
): Promise<FeedReactionSummary> =>
  authedRequest(
    `/events/${enc(eventId)}/feed/${enc(postId)}/reactions`,
    feedReactionSummarySchema,
    { method: 'POST', body: { kind } },
  );

export const removeFeedReaction = (eventId: string, postId: string): Promise<null> =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}/reactions`, z.null(), {
    method: 'DELETE',
  });

export const listFeedComments = async (
  eventId: string,
  postId: string,
  page: number,
): Promise<FeedCommentListResponse> => {
  const path = `/events/${enc(eventId)}/feed/${enc(postId)}/comments?page=${page}`;
  // Gated feeds require auth; fall back to public request when token isn't ready yet.
  try {
    return await authedRequest(path, feedCommentListResponseSchema);
  } catch (error) {
    if (
      (error instanceof ApiError && error.status === 401) ||
      (error instanceof Error &&
        (error.message === 'token provider not registered' || error.message === 'no access token'))
    ) {
      return request(path, feedCommentListResponseSchema);
    }
    throw error;
  }
};

export const createFeedComment = (
  eventId: string,
  postId: string,
  input: FeedCommentCreateInput,
): Promise<FeedCommentResponse> =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}/comments`, feedCommentResponseSchema, {
    method: 'POST',
    body: input,
  });

// App Store guideline 1.2 — report objectionable content and block a person.
// The API answers 201 on a new report and 200 when this reporter had already
// reported the same target, so both are success here: reporting twice is not a
// user error and the UI must not treat it as one.
export const reportFeedPost = (eventId: string, postId: string, reason: string) =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}/report`, reportCreateResponseSchema, {
    method: 'POST',
    body: { reason },
  });

export const reportFeedComment = (eventId: string, commentId: string, reason: string) =>
  authedRequest(
    `/events/${enc(eventId)}/feed/comments/${enc(commentId)}/report`,
    reportCreateResponseSchema,
    { method: 'POST', body: { reason } },
  );

// By post, not by user id: the feed payload does not expose authorUserId and
// adding it would put a new user identifier into a shared contract. The server
// resolves the author.
export const blockPostAuthor = (eventId: string, postId: string): Promise<null> =>
  authedRequest(`/events/${enc(eventId)}/feed/${enc(postId)}/block-author`, z.null(), {
    method: 'PUT',
  });

export const blockUser = (userId: string): Promise<null> =>
  authedRequest(`/api/me/blocks/${enc(userId)}`, z.null(), { method: 'PUT' });

export const unblockUser = (userId: string): Promise<null> =>
  authedRequest(`/api/me/blocks/${enc(userId)}`, z.null(), { method: 'DELETE' });
