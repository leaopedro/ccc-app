'use server';

import { revalidatePath } from 'next/cache';

import {
  createFeedBan,
  deleteFeedBan,
  dismissFeedReport,
  moderateFeedComment,
  moderateFeedPost,
  resolveFeedReport,
} from './admin-api';
import { ApiError } from './api';

type FeedCommunityModerationState = { error: string | null };
type FeedModerationAction = 'hide' | 'remove' | 'restore';

const parseScope = (value: string | null): 'view' | 'post' | null =>
  value === 'view' || value === 'post' ? value : null;

const parseAction = (value: string | null): FeedModerationAction | null =>
  value === 'hide' || value === 'remove' || value === 'restore' ? value : null;

export const createFeedBanAction = async (
  eventId: string,
  _prev: FeedCommunityModerationState,
  fd: FormData,
): Promise<FeedCommunityModerationState> => {
  const userId = fd.get('userId');
  const scopeEntry = fd.get('scope');
  const scopeRaw = parseScope(typeof scopeEntry === 'string' ? scopeEntry : null);
  if (typeof userId !== 'string' || userId.trim() === '' || !scopeRaw) {
    return { error: 'Informe usuário e escopo.' };
  }

  try {
    const reasonValue = fd.get('reason');
    await createFeedBan(eventId, {
      userId: userId.trim(),
      scope: scopeRaw,
      reason:
        typeof reasonValue === 'string' && reasonValue.trim() !== ''
          ? reasonValue.trim()
          : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar banimento.' };
  }

  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const moderateFeedItemAction = async (
  eventId: string,
  kind: 'post' | 'comment',
  itemId: string,
  _prev: FeedCommunityModerationState,
  fd: FormData,
): Promise<FeedCommunityModerationState> => {
  const actionEntry = fd.get('action');
  const action = parseAction(typeof actionEntry === 'string' ? actionEntry : null);
  if (!action) return { error: 'Ação inválida.' };

  try {
    if (kind === 'post') await moderateFeedPost(eventId, itemId, action);
    else await moderateFeedComment(eventId, itemId, action);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao moderar item.' };
  }

  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const resolveReportAction = async (
  eventId: string,
  reportId: string,
  _prev: FeedCommunityModerationState,
  fd: FormData,
): Promise<FeedCommunityModerationState> => {
  const resolution = fd.get('resolution');
  if (typeof resolution !== 'string' || resolution.trim() === '') {
    return { error: 'Informe uma resolução.' };
  }

  try {
    await resolveFeedReport(eventId, reportId, resolution.trim());
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao resolver denúncia.' };
  }

  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const dismissReportAction = async (
  eventId: string,
  reportId: string,
  _prev: FeedCommunityModerationState,
  _fd: FormData,
): Promise<FeedCommunityModerationState> => {
  try {
    await dismissFeedReport(eventId, reportId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao dispensar denúncia.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const deleteFeedBanAction = async (
  eventId: string,
  banId: string,
  _prev: FeedCommunityModerationState,
  _fd: FormData,
): Promise<FeedCommunityModerationState> => {
  try {
    await deleteFeedBan(eventId, banId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao remover banimento.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};
