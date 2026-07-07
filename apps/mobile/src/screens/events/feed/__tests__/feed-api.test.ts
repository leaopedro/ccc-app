import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as client from '../../../../api/client';

vi.mock('../../../../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  request: vi.fn(),
  authedRequest: vi.fn(),
}));

const mockRequest = vi.mocked(client.request);
const mockAuthed = vi.mocked(client.authedRequest);

describe('feed API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listFeedPosts calls GET /events/:eventId/feed with page param', async () => {
    const { listFeedPosts } = await import('../../../../api/feed');
    mockAuthed.mockResolvedValueOnce({ posts: [], page: 1, totalPages: 1, total: 0 });
    await listFeedPosts('event-id-1', 1);
    expect(mockAuthed).toHaveBeenCalledWith('/events/event-id-1/feed?page=1', expect.anything());
  });

  it('listFeedPosts falls back to public request on 401', async () => {
    const { listFeedPosts } = await import('../../../../api/feed');
    mockAuthed.mockRejectedValueOnce(new client.ApiError(401, 'no access token'));
    mockRequest.mockResolvedValueOnce({ posts: [], page: 1, totalPages: 1, total: 0 });
    await listFeedPosts('event-id-1', 1);
    expect(mockRequest).toHaveBeenCalledWith('/events/event-id-1/feed?page=1', expect.anything());
  });

  it('listFeedPosts falls back to public request when auth provider is not ready', async () => {
    const { listFeedPosts } = await import('../../../../api/feed');
    mockAuthed.mockRejectedValueOnce(new Error('token provider not registered'));
    mockRequest.mockResolvedValueOnce({ posts: [], page: 1, totalPages: 1, total: 0 });
    await listFeedPosts('event-id-1', 1);
    expect(mockRequest).toHaveBeenCalledWith('/events/event-id-1/feed?page=1', expect.anything());
  });

  it('createFeedPost calls POST /events/:eventId/feed', async () => {
    const { createFeedPost } = await import('../../../../api/feed');
    const post = {
      id: '1',
      eventId: 'e1',
      car: null,
      body: 'hi',
      status: 'visible',
      photos: [],
      reactions: { likes: 0, mine: false },
      commentCount: 0,
      createdAt: '',
      updatedAt: '',
    };
    mockAuthed.mockResolvedValueOnce(post);
    await createFeedPost('event-id-1', { body: 'hi' });
    expect(mockAuthed).toHaveBeenCalledWith('/events/event-id-1/feed', expect.anything(), {
      method: 'POST',
      body: { body: 'hi' },
    });
  });

  it('patchFeedPost calls PATCH /events/:eventId/feed/:postId', async () => {
    const { patchFeedPost } = await import('../../../../api/feed');
    const post = {
      id: 'p1',
      eventId: 'e1',
      car: null,
      body: 'updated',
      status: 'visible',
      photos: [],
      reactions: { likes: 0, mine: false },
      commentCount: 0,
      createdAt: '',
      updatedAt: '',
    };
    mockAuthed.mockResolvedValueOnce(post);
    await patchFeedPost('e1', 'p1', { body: 'updated' });
    expect(mockAuthed).toHaveBeenCalledWith('/events/e1/feed/p1', expect.anything(), {
      method: 'PATCH',
      body: { body: 'updated' },
    });
  });

  it('deleteFeedPost calls DELETE /events/:eventId/feed/:postId', async () => {
    const { deleteFeedPost } = await import('../../../../api/feed');
    mockAuthed.mockResolvedValueOnce(undefined);
    await deleteFeedPost('e1', 'p1');
    expect(mockAuthed).toHaveBeenCalledWith('/events/e1/feed/p1', expect.anything(), {
      method: 'DELETE',
    });
  });

  it('toggleFeedReaction calls POST /events/:eventId/feed/:postId/reactions', async () => {
    const { toggleFeedReaction } = await import('../../../../api/feed');
    mockAuthed.mockResolvedValueOnce({ likes: 1, mine: true });
    await toggleFeedReaction('e1', 'post-1', 'like');
    expect(mockAuthed).toHaveBeenCalledWith('/events/e1/feed/post-1/reactions', expect.anything(), {
      method: 'POST',
      body: { kind: 'like' },
    });
  });

  it('removeFeedReaction calls DELETE /events/:eventId/feed/:postId/reactions', async () => {
    const { removeFeedReaction } = await import('../../../../api/feed');
    mockAuthed.mockResolvedValueOnce(undefined);
    await removeFeedReaction('e1', 'post-1');
    expect(mockAuthed).toHaveBeenCalledWith('/events/e1/feed/post-1/reactions', expect.anything(), {
      method: 'DELETE',
    });
  });

  it('listFeedComments calls authedRequest first', async () => {
    const { listFeedComments } = await import('../../../../api/feed');
    mockAuthed.mockResolvedValueOnce({ comments: [], page: 1, totalPages: 1, total: 0 });
    await listFeedComments('e1', 'post-1', 1);
    expect(mockAuthed).toHaveBeenCalledWith(
      '/events/e1/feed/post-1/comments?page=1',
      expect.anything(),
    );
  });

  it('listFeedComments falls back to public request on 401', async () => {
    const { listFeedComments } = await import('../../../../api/feed');
    mockAuthed.mockRejectedValueOnce(new client.ApiError(401, 'no access token'));
    mockRequest.mockResolvedValueOnce({ comments: [], page: 1, totalPages: 1, total: 0 });
    await listFeedComments('e1', 'post-1', 1);
    expect(mockRequest).toHaveBeenCalledWith(
      '/events/e1/feed/post-1/comments?page=1',
      expect.anything(),
    );
  });

  it('listFeedComments falls back to public request when auth provider not ready', async () => {
    const { listFeedComments } = await import('../../../../api/feed');
    mockAuthed.mockRejectedValueOnce(new Error('token provider not registered'));
    mockRequest.mockResolvedValueOnce({ comments: [], page: 1, totalPages: 1, total: 0 });
    await listFeedComments('e1', 'post-1', 1);
    expect(mockRequest).toHaveBeenCalledWith(
      '/events/e1/feed/post-1/comments?page=1',
      expect.anything(),
    );
  });

  it('createFeedComment calls POST /events/:eventId/feed/:postId/comments', async () => {
    const { createFeedComment } = await import('../../../../api/feed');
    const comment = {
      id: 'c1',
      postId: 'p1',
      car: null,
      body: 'nice',
      status: 'visible',
      createdAt: '',
      updatedAt: '',
    };
    mockAuthed.mockResolvedValueOnce(comment);
    await createFeedComment('e1', 'post-1', { body: 'nice' });
    expect(mockAuthed).toHaveBeenCalledWith('/events/e1/feed/post-1/comments', expect.anything(), {
      method: 'POST',
      body: { body: 'nice' },
    });
  });
});
