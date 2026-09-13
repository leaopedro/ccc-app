import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicGarage } from '../public-garage';

const validPayload = {
  garage: {
    name: 'Quintal do JDM',
    slug: 'quintal-do-jdm',
    description: null,
    premiumTier: null,
    coverPreset: null,
    coverImageUrl: null,
    isPremiumActive: false,
    gamification: { enabled: true },
    badges: [],
  },
  cars: [],
  gamification: { enabled: true },
};

describe('fetchPublicGarage', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockReset();
  });

  it('returns null when upstream responds 404 (unknown OR private — anti-enumeration)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(fetchPublicGarage('unknown-or-private')).resolves.toBeNull();
  });

  it('returns the parsed payload when upstream responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(validPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await fetchPublicGarage('quintal-do-jdm');
    expect(result).toEqual(validPayload);
  });

  it('throws on non-404 upstream errors (e.g. 500)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(fetchPublicGarage('any')).rejects.toThrow('upstream 500');
  });

  it('throws when upstream payload fails schema validation', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ garage: { name: 'X' }, cars: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(fetchPublicGarage('any')).rejects.toThrow();
  });

  it('url-encodes the slug to defend against path injection', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await fetchPublicGarage('a/b c');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/g/a%2Fb%20c'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
