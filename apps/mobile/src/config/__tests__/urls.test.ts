import { describe, expect, it } from 'vitest';

import { PUBLIC_PROFILE_BASE_URL, publicGarageUrl } from '../urls';

describe('publicGarageUrl', () => {
  it('returns the base URL joined with the slug', () => {
    expect(publicGarageUrl('foo')).toBe('https://casacar.club/g/foo');
  });

  it('preserves hyphens in the slug', () => {
    expect(publicGarageUrl('my-slug-123')).toBe(`${PUBLIC_PROFILE_BASE_URL}/my-slug-123`);
  });
});
