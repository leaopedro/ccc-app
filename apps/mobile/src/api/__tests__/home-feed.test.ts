import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest, mockAuthedRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockAuthedRequest: vi.fn(),
}));

vi.mock('~/api/client', () => ({
  request: mockRequest,
  authedRequest: mockAuthedRequest,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { listHomeFeed } from '../home-feed';

import { ApiError } from '~/api/client';

describe('listHomeFeed', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockAuthedRequest.mockReset();
  });

  it('usa authedRequest para GET /api/home-feed', async () => {
    mockAuthedRequest.mockResolvedValue({ posts: [] });

    await listHomeFeed();

    // Load-bearing: com `request` puro o header de auth nunca sai
    // (src/api/client.ts:34-41), request.user e sempre undefined no servidor,
    // e o filtro de bloqueio da rota nunca roda em producao — enquanto os
    // testes da API, que injetam o header na mao, ficam verdes.
    expect(mockAuthedRequest).toHaveBeenCalledWith('/api/home-feed', expect.anything());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('cai para request anonimo quando nao ha token no boot', async () => {
    mockAuthedRequest.mockRejectedValue(new Error('no access token'));
    mockRequest.mockResolvedValue({ posts: [] });

    await listHomeFeed();

    expect(mockRequest).toHaveBeenCalledWith('/api/home-feed', expect.anything());
  });

  it('relanca erro que nao e de token, em vez de cair para anonimo', async () => {
    mockAuthedRequest.mockRejectedValue(new Error('boom'));

    // Catches: afrouxar a condicao do catch. Um fallback largo demais faz
    // qualquer falha da API virar request anonima, e ai o filtro de bloqueio
    // da rota some de novo — o mesmo bug que esta funcao existe para corrigir.
    await expect(listHomeFeed()).rejects.toThrow('boom');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('relanca ApiError que nao e 401, em vez de cair para anonimo', async () => {
    mockAuthedRequest.mockRejectedValue(new ApiError(500, 'server error'));

    await expect(listHomeFeed()).rejects.toThrow('server error');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
