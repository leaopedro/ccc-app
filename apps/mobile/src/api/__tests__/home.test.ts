// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', () => ({
  request: vi.fn(),
  authedRequest: vi.fn(),
}));

import { getHomeContent } from '../home';

import { authedRequest, request } from '~/api/client';

const mockRequest = vi.mocked(request);
const mockAuthedRequest = vi.mocked(authedRequest);

describe('getHomeContent', () => {
  // A Início roda antes do login: se isto silenciosamente virasse
  // authedRequest, todo visitante deslogado receberia o estado de erro da
  // tela inteira, e nenhum outro teste deste arquivo pegaria isso.
  it('calls the public request helper with the home-content path, not the authenticated one', async () => {
    mockRequest.mockResolvedValueOnce(undefined as never);
    await getHomeContent();
    expect(mockRequest).toHaveBeenCalledWith('/api/home-content', expect.anything());
    expect(mockAuthedRequest).not.toHaveBeenCalled();
  });
});
