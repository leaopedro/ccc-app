import { describe, expect, it } from 'vitest';

import { caixaCopy } from '~/copy/caixa';

import { mapSaveResult } from './preferences-result';

describe('mapSaveResult', () => {
  it('maps ok to a success message', () => {
    expect(mapSaveResult('ok')).toEqual({ kind: 'success', message: caixaCopy.preferences.saved });
  });

  it('maps bad_address to an address-scoped error', () => {
    expect(mapSaveResult('bad_address')).toEqual({
      kind: 'address_error',
      message: caixaCopy.preferences.addressInvalid,
    });
  });

  it('maps box_locked to a locked notice', () => {
    expect(mapSaveResult('box_locked')).toEqual({
      kind: 'locked',
      message: caixaCopy.preferences.locked.title,
    });
  });

  it('maps error to a generic retry message', () => {
    expect(mapSaveResult('error')).toEqual({
      kind: 'error',
      message: caixaCopy.preferences.saveError,
    });
  });
});
