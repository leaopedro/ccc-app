import { describe, expect, it, vi, afterEach } from 'vitest';

import { fetchCep, stripCepDigits } from './useCepLookup';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.clearAllMocks();
});

describe('stripCepDigits', () => {
  it('removes hyphens', () => {
    expect(stripCepDigits('01310-100')).toBe('01310100');
  });

  it('passes through pure digits', () => {
    expect(stripCepDigits('01310100')).toBe('01310100');
  });
});

describe('fetchCep', () => {
  it('returns success with address data on valid CEP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          logradouro: 'Rua das Flores',
          bairro: 'Centro',
          localidade: 'São Paulo',
          uf: 'SP',
        }),
    });

    const result = await fetchCep('01310100');

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.data).toEqual({
        street: 'Rua das Flores',
        neighborhood: 'Centro',
        city: 'São Paulo',
        stateCode: 'SP',
      });
    }
  });

  it('returns not_found when API returns erro: true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ erro: true }),
    });

    const result = await fetchCep('99999999');

    expect(result.status).toBe('not_found');
  });

  it('returns not_found when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const result = await fetchCep('99999999');

    expect(result.status).toBe('not_found');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await fetchCep('01310100');

    expect(result.status).toBe('error');
  });

  it('returns not_found for CEP with fewer than 8 digits', async () => {
    const result = await fetchCep('0131');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.status).toBe('not_found');
  });

  it('strips hyphen before calling ViaCEP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          logradouro: 'Av. Paulista',
          bairro: 'Bela Vista',
          localidade: 'São Paulo',
          uf: 'SP',
        }),
    });

    await fetchCep('01310-100');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://viacep.com.br/ws/01310100/json/',
      expect.any(Object),
    );
  });

  // Regression: CEP B lookup fails after CEP A succeeded — must return not_found, not cached data
  it('returns not_found on second call when second CEP is invalid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          logradouro: 'Rua A',
          bairro: 'Bairro A',
          localidade: 'Cidade A',
          uf: 'SP',
        }),
    });
    const first = await fetchCep('01310100');
    expect(first.status).toBe('success');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ erro: true }),
    });
    const second = await fetchCep('99999999');
    expect(second.status).toBe('not_found');
  });

  // Regression: lookup must not fire for partial CEP (< 8 digits) — edit mode load safety
  it('does not call fetch when CEP has 7 digits', async () => {
    const result = await fetchCep('0131010');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.status).toBe('not_found');
  });
});
