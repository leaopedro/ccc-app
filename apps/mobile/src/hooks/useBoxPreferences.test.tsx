// @vitest-environment jsdom
// apps/mobile/src/hooks/useBoxPreferences.test.tsx
//
// Same pattern as useBox.test.tsx: `vi.hoisted` for the fetch mock and an
// inline mock class for `ApiError` (avoids the static-import hoisting TDZ
// issue — see useBox.test.tsx for the full explanation).
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const { setBoxPreferences } = vi.hoisted(() => ({ setBoxPreferences: vi.fn() }));
vi.mock('../api/box', () => ({ setBoxPreferences: () => setBoxPreferences() }));
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, body?: unknown) {
      super('x');
      this.status = status;
      this.body = body;
    }
  },
}));

import { ApiError as RealApiError } from '../api/client';
import { useBoxPreferences } from './useBoxPreferences';

// `vi.mock` swaps the runtime class, but TS still type-checks `ApiError`
// against the real module (whose constructor is `(status, message, body?)`).
// Cast to the mock's actual shape so the test can construct it.
const ApiError = RealApiError as unknown as new (status: number, body?: unknown) => Error;

let result: string | undefined;
function Probe() {
  const { save } = useBoxPreferences();
  useEffect(() => {
    void save({ autoSendOptIn: true }).then((r) => {
      result = r;
    });
    // Intentionally run once on mount only — `save` isn't memoized, so
    // including it here would refire the effect (and re-call save) every
    // render.
  }, []);
  return null;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useBoxPreferences', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    result = undefined;
    setBoxPreferences.mockReset();
  });

  it('returns ok when the request succeeds', async () => {
    setBoxPreferences.mockResolvedValue(undefined);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(result).toBe('ok');
  });

  it('returns bad_address on a 400 with body.error "bad_address"', async () => {
    setBoxPreferences.mockRejectedValue(new ApiError(400, { error: 'bad_address' }));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(result).toBe('bad_address');
  });

  it('returns box_locked on a 409 with no body', async () => {
    setBoxPreferences.mockRejectedValue(new ApiError(409, undefined));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(result).toBe('box_locked');
  });

  it('returns error on a 500 with no recognizable body', async () => {
    setBoxPreferences.mockRejectedValue(new ApiError(500, undefined));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(result).toBe('error');
  });
});
