// @vitest-environment jsdom
// apps/mobile/src/hooks/useBox.test.tsx
//
// Uses `vi.hoisted` + an inline class inside the `vi.mock` factory (rather
// than referencing an outer `const`/`class`) because static `import`
// statements are hoisted above ALL other top-level statements in the file,
// including `const`/`class` declarations further down — referencing those
// from a `vi.mock` factory throws "Cannot access before initialization".
// Same pattern as `usePremiumSubscription.test.tsx`.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const { getBox } = vi.hoisted(() => ({ getBox: vi.fn() }));
vi.mock('../api/box', () => ({ getBox: () => getBox() }));
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
import { useBox } from './useBox';

// `vi.mock` swaps the runtime class, but TS still type-checks `ApiError`
// against the real module (whose constructor is `(status, message, body?)`).
// Cast to the mock's actual shape so the test can construct it.
const ApiError = RealApiError as unknown as new (status: number, body?: unknown) => Error;

let snap: { loading: boolean; notOpen: boolean; box: unknown } | undefined;
function Probe() {
  const s = useBox();
  snap = { loading: s.loading, notOpen: s.notOpen, box: s.box };
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useBox', () => {
  it('exposes the box on success', async () => {
    getBox.mockResolvedValue({ id: 'b1', status: 'open' });
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, notOpen: false });
    expect((snap!.box as { id: string }).id).toBe('b1');
  });

  it('maps a 404 to notOpen, not a hard error', async () => {
    getBox.mockRejectedValue(new ApiError(404, { error: 'box_not_open' }));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, notOpen: true, box: null });
  });
});
