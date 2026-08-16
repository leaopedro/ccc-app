import { describe, expect, it } from 'vitest';

import { pushKindSchema } from '../push.js';

describe('pushKindSchema', () => {
  it('accepts the box milestone kinds', () => {
    expect(pushKindSchema.parse('box.paid')).toBe('box.paid');
    expect(pushKindSchema.parse('box.ready')).toBe('box.ready');
    expect(pushKindSchema.parse('box.shipped')).toBe('box.shipped');
    expect(pushKindSchema.parse('box.delivered')).toBe('box.delivered');
  });

  it('still accepts existing kinds', () => {
    expect(pushKindSchema.parse('ticket.confirmed')).toBe('ticket.confirmed');
    expect(pushKindSchema.parse('broadcast')).toBe('broadcast');
  });

  it('rejects unknown kinds', () => {
    expect(pushKindSchema.safeParse('box.unknown').success).toBe(false);
  });
});
