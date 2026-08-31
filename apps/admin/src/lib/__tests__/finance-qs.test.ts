import { describe, expect, it } from 'vitest';

import { financeQs } from '../admin-api';

describe('financeQs — livemode forwarding (task 5)', () => {
  it('sends nothing when livemode is absent (API defaults to live)', () => {
    expect(financeQs({ provider: 'stripe' })).not.toContain('livemode');
  });

  it('forwards livemode=test to the request', () => {
    expect(financeQs({ livemode: 'test' })).toBe('?livemode=test');
  });

  it('forwards livemode=all to the request', () => {
    expect(financeQs({ livemode: 'all' })).toBe('?livemode=all');
  });
});
