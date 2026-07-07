import { describe, expect, it } from 'vitest';

import { userId, eventId } from '../src/ids';

describe('branded id helpers', () => {
  it('userId accepts a non-empty string and returns a branded UserId', () => {
    const id = userId('usr_123');
    expect(id).toBe('usr_123');
  });

  it('userId rejects an empty string', () => {
    expect(() => userId('')).toThrow(/non-empty/);
  });

  it('eventId accepts a non-empty string', () => {
    expect(eventId('evt_abc')).toBe('evt_abc');
  });
});
