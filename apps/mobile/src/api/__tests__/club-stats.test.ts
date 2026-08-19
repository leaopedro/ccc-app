// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', () => ({
  request: vi.fn(),
  authedRequest: vi.fn(),
}));

import { getClubStats } from '../club-stats';

import { authedRequest, request } from '~/api/client';

const mockRequest = vi.mocked(request);
const mockAuthedRequest = vi.mocked(authedRequest);

describe('getClubStats', () => {
  // A seção "Status do clube" aparece nos dois estados da home, inclusive
  // deslogado: se isto silenciosamente virasse authedRequest, o card some
  // para todo visitante deslogado sem nenhum outro teste pegando isso.
  it('calls the public request helper with the club-stats path, not the authenticated one', async () => {
    mockRequest.mockResolvedValueOnce(undefined as never);
    await getClubStats();
    expect(mockRequest).toHaveBeenCalledWith('/api/club-stats', expect.anything());
    expect(mockAuthedRequest).not.toHaveBeenCalled();
  });
});
