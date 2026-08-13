import { describe, expect, it } from 'vitest';

import { caixaCopy } from '~/copy/caixa';

import { mapConfirmError } from './confirm-result';

describe('mapConfirmError', () => {
  it('maps bad_address to an address error', () => {
    expect(mapConfirmError('bad_address')).toEqual({
      kind: 'address_error',
      message: caixaCopy.review.addressInvalid,
    });
  });

  it('maps box_locked to a locked error', () => {
    expect(mapConfirmError('box_locked')).toEqual({
      kind: 'error',
      message: caixaCopy.review.locked,
    });
  });

  it('maps not_found and error to a generic error', () => {
    expect(mapConfirmError('not_found').kind).toBe('error');
    expect(mapConfirmError('error')).toEqual({
      kind: 'error',
      message: caixaCopy.review.confirmError,
    });
  });
});
