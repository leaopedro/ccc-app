import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const moderateFeedPost =
  vi.fn<(eventId: string, postId: string, action: unknown) => Promise<unknown>>();
const moderateFeedComment =
  vi.fn<(eventId: string, commentId: string, action: unknown) => Promise<unknown>>();
const resolveFeedReport =
  vi.fn<(eventId: string, reportId: string, resolution: string) => Promise<unknown>>();
const dismissFeedReport = vi.fn<(eventId: string, reportId: string) => Promise<unknown>>();
const deleteFeedBan = vi.fn<(eventId: string, banId: string) => Promise<unknown>>();

vi.mock('./admin-api', () => ({
  createFeedBan: vi.fn(),
  deleteFeedBan: (eventId: string, banId: string) => deleteFeedBan(eventId, banId),
  dismissFeedReport: (eventId: string, reportId: string) => dismissFeedReport(eventId, reportId),
  moderateFeedComment: (eventId: string, commentId: string, action: unknown) =>
    moderateFeedComment(eventId, commentId, action),
  moderateFeedPost: (eventId: string, postId: string, action: unknown) =>
    moderateFeedPost(eventId, postId, action),
  resolveFeedReport: (eventId: string, reportId: string, resolution: string) =>
    resolveFeedReport(eventId, reportId, resolution),
}));

import { ApiError } from './api';
import {
  deleteFeedBanAction,
  dismissReportAction,
  moderateFeedItemAction,
  resolveReportAction,
} from './community-management-actions';

describe('community-management-actions ApiError handling', () => {
  beforeEach(() => {
    moderateFeedPost.mockReset();
    moderateFeedComment.mockReset();
    resolveFeedReport.mockReset();
    dismissFeedReport.mockReset();
    deleteFeedBan.mockReset();
    vi.mocked(revalidatePath).mockReset();
  });

  it('returns error state when moderation API fails', async () => {
    moderateFeedPost.mockRejectedValue(new ApiError(400, 'bad_request', 'Falha de moderação'));

    const fd = new FormData();
    fd.set('action', 'restore');
    const result = await moderateFeedItemAction('evt_1', 'post', 'post_1', { error: null }, fd);

    expect(result).toEqual({ error: 'Falha de moderação' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns error state when resolve report API fails', async () => {
    resolveFeedReport.mockRejectedValue(new ApiError(500, 'internal', 'Falha ao resolver'));

    const fd = new FormData();
    fd.set('resolution', 'investigado');
    const result = await resolveReportAction('evt_1', 'rep_1', { error: null }, fd);

    expect(result).toEqual({ error: 'Falha ao resolver' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns error state when dismiss report API fails', async () => {
    dismissFeedReport.mockRejectedValue(
      new ApiError(409, 'conflict', 'Não foi possível dispensar'),
    );

    const result = await dismissReportAction('evt_1', 'rep_1', { error: null }, new FormData());

    expect(result).toEqual({ error: 'Não foi possível dispensar' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns error state when delete ban API fails', async () => {
    deleteFeedBan.mockRejectedValue(new ApiError(404, 'not_found', 'Banimento não encontrado'));

    const result = await deleteFeedBanAction('evt_1', 'ban_1', { error: null }, new FormData());

    expect(result).toEqual({ error: 'Banimento não encontrado' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
