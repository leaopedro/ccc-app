// @vitest-environment jsdom
//
// Task 11 — BadgeCelebrationProvider. Orchestration tests only: the overlay
// itself (`BadgeCelebration`) has its own test in `@ccc/ui`, so it is mocked
// here to a cheap probe. Importing the real component through the `@ccc/ui`
// barrel pulls `HexBadge` -> `react-native-svg`, which vitest cannot parse
// and this repo has no stub for (unlike `lucide-react-native`).
//
// `isCelebrationHeld`/`subscribeCelebrationHold` are imported by the provider
// from the dependency-free `@ccc/ui/celebration-hold` subpath, so they stay
// REAL here — not mocked. That module holds module-level mutable state (no
// reset export), so every test that acquires a hold must release it, or a
// leaked hold corrupts a later test's starting state.

import { acquireCelebrationHold, isCelebrationHeld } from '@ccc/ui/celebration-hold';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// ---- Controllable mock state (vi.hoisted so the factories below can close
// over the same objects the test body mutates). ----

const authState = vi.hoisted(() => ({
  current: { status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' },
}));

const garageMocks = vi.hoisted(() => ({
  listCelebrations: vi.fn(),
  ackCelebrations: vi.fn(),
  getMyBadges: vi.fn(),
}));

const sentryMocks = vi.hoisted(() => ({ captureException: vi.fn() }));

const platformState = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' | 'web' }));

const appStateHandlers = vi.hoisted(() => new Set<(state: string) => void>());
const addNotificationReceivedListener = vi.hoisted(() => vi.fn());
const notificationHandlers = vi.hoisted(() => new Set<() => void>());

vi.mock('~/auth/context', () => ({
  useAuth: () => authState.current,
}));

vi.mock('~/api/garage', () => ({
  listCelebrations: garageMocks.listCelebrations,
  ackCelebrations: garageMocks.ackCelebrations,
  getMyBadges: garageMocks.getMyBadges,
}));

vi.mock('~/lib/sentry', () => ({
  captureException: sentryMocks.captureException,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: () => void) => {
    addNotificationReceivedListener(cb);
    notificationHandlers.add(cb);
    return {
      remove: () => {
        notificationHandlers.delete(cb);
      },
    };
  },
}));

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  return {
    View: (props: { children?: ReactNode }) =>
      ReactMod.createElement('div', null, props.children),
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false) },
    AppState: {
      addEventListener: (_event: string, cb: (state: string) => void) => {
        appStateHandlers.add(cb);
        return {
          remove: () => {
            appStateHandlers.delete(cb);
          },
        };
      },
    },
    Platform: platformState,
  };
});

vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    BadgeCelebration: (props: {
      entries: { code: string }[];
      onClose: () => void;
    }) =>
      ReactMod.createElement(
        'div',
        { 'data-testid': 'celebration' },
        ReactMod.createElement(
          'span',
          { 'data-testid': 'codes' },
          props.entries.map((e) => e.code).join(','),
        ),
        ReactMod.createElement('button', { onClick: props.onClose }, 'close'),
      ),
  };
});

const { BadgeCelebrationProvider } = await import('../provider');

const catalogEntry = (code: string) => ({
  code,
  category: 'eventos' as const,
  rarity: 'common' as const,
  premiumExclusive: false,
  icon: 'flag',
  title: `Titulo ${code}`,
  description: `Descricao ${code}`,
});

const pendingEntry = (code: string) => ({ code, earnedAt: '2026-09-13T12:00:00.000Z' });

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let container: HTMLDivElement;
let root: Root;

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BadgeCelebrationProvider>{null}</BadgeCelebrationProvider>);
  });
  await flush();
};

const unmount = async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

const fireAppStateActive = async () => {
  await act(async () => {
    for (const cb of appStateHandlers) cb('active');
  });
  await flush();
};

const firePush = async () => {
  await act(async () => {
    for (const cb of notificationHandlers) cb();
  });
  await flush();
};

const celebrationEl = () => container.querySelector('[data-testid="celebration"]');
const codesText = () => container.querySelector('[data-testid="codes"]')?.textContent ?? '';
const clickClose = async () => {
  const btn = container.querySelector('button');
  await act(async () => {
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  authState.current = { status: 'authenticated' };
  platformState.OS = 'ios';
  appStateHandlers.clear();
  notificationHandlers.clear();
  addNotificationReceivedListener.mockClear();
  garageMocks.listCelebrations.mockReset();
  garageMocks.ackCelebrations.mockReset();
  garageMocks.getMyBadges.mockReset();
  sentryMocks.captureException.mockReset();

  garageMocks.listCelebrations.mockResolvedValue({ enabled: true, pending: [] });
  garageMocks.ackCelebrations.mockResolvedValue({ acked: 0 });
  garageMocks.getMyBadges.mockResolvedValue({ enabled: true, catalog: [], badges: [] });
});

afterEach(async () => {
  if (root) await unmount();
  vi.useRealTimers();
  // Module-level hold state must not leak between tests.
  expect(isCelebrationHeld()).toBe(false);
});

describe('BadgeCelebrationProvider', () => {
  it('nao busca nada sem usuario autenticado', async () => {
    authState.current = { status: 'unauthenticated' };
    await mount();
    expect(garageMocks.listCelebrations).not.toHaveBeenCalled();
  });

  it('busca quando o refresh bus dispara', async () => {
    const { requestCelebrationRefresh } = await import('../refresh-bus');
    await mount();
    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
    garageMocks.listCelebrations.mockClear();

    await act(async () => {
      requestCelebrationRefresh();
    });
    await flush();

    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
  });

  it('nao dispara GET concorrente', async () => {
    // Deferred first response: holds the fetch "in flight" so a second
    // trigger fired before it resolves must be swallowed by the guard.
    // Without it, the second GET resolves AFTER the ack from the close
    // below and resurrects the celebration the user just dismissed.
    let resolveFirst!: (v: { enabled: boolean; pending: { code: string; earnedAt: string }[] }) => void;
    garageMocks.listCelebrations.mockReset();
    garageMocks.listCelebrations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    await mount(); // fires refresh #1, in flight

    const { requestCelebrationRefresh } = await import('../refresh-bus');
    await act(async () => {
      requestCelebrationRefresh(); // fires refresh #2 attempt while #1 is in flight
    });
    await flush();

    // Guard must have blocked the second GET entirely.
    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);

    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    await act(async () => {
      resolveFirst({ enabled: true, pending: [pendingEntry('EVT-001')] });
    });
    await flush();

    expect(celebrationEl()).not.toBeNull();
    expect(codesText()).toBe('EVT-001');
  });

  it('nao reanima codigo ja acked localmente, mesmo se o GET voltar com ele', async () => {
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    await mount();
    expect(celebrationEl()).not.toBeNull();

    await clickClose();
    expect(celebrationEl()).toBeNull();
    expect(garageMocks.ackCelebrations).toHaveBeenCalledWith(['EVT-001']);

    // Server is stale and returns the same code again on the next tick.
    const { requestCelebrationRefresh } = await import('../refresh-bus');
    await act(async () => {
      requestCelebrationRefresh();
    });
    await flush();

    expect(celebrationEl()).toBeNull();
  });

  it('nao reanima quando o POST de ack falha', async () => {
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });
    garageMocks.ackCelebrations.mockRejectedValue(new Error('network down'));

    await mount();
    expect(celebrationEl()).not.toBeNull();

    await clickClose();
    expect(celebrationEl()).toBeNull();
    expect(sentryMocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      'celebrations.ack',
    );

    // A flaky connection means the GET (60/min) keeps returning the same
    // pending code while the ack (20/min) keeps failing. Without the local
    // set, this is a full-screen overlay resurrecting every tick with no
    // way for the user to stop it.
    const { requestCelebrationRefresh } = await import('../refresh-bus');
    await act(async () => {
      requestCelebrationRefresh();
    });
    await flush();

    expect(celebrationEl()).toBeNull();
  });

  it('segura a fila enquanto o hold esta ativo e anima ao liberar', async () => {
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    const release = acquireCelebrationHold();
    try {
      await mount();
      // Fetching happened (queue populated), but the hold blocks showing.
      expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
      expect(celebrationEl()).toBeNull();

      await act(async () => {
        release();
      });
      await flush();

      expect(celebrationEl()).not.toBeNull();
      expect(codesText()).toBe('EVT-001');
    } finally {
      if (isCelebrationHeld()) release();
    }
  });

  it('faz ack sem animar codigo ausente de catalogo carregado', async () => {
    // Catalog loaded successfully, but this code isn't in it — the only
    // scenario resolveEntries treats as ack-without-animation (queue must
    // not get stuck forever behind an unresolvable code).
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-002')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    await mount();

    expect(celebrationEl()).toBeNull();
    expect(garageMocks.ackCelebrations).toHaveBeenCalledWith(['EVT-001']);
  });

  it('NAO faz ack quando o catalogo falha', async () => {
    garageMocks.getMyBadges.mockRejectedValue(new Error('catalog down'));
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    await mount();

    expect(celebrationEl()).toBeNull();
    expect(garageMocks.ackCelebrations).not.toHaveBeenCalled();
    expect(sentryMocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      'celebrations.catalog',
    );
  });

  it('usa intervalo de 5 minutos, nao de 60 segundos', async () => {
    await mount();
    garageMocks.listCelebrations.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(garageMocks.listCelebrations).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 1);
    });
    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
  });

  it('pausa o timer de poll enquanto o overlay esta visivel', async () => {
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    await mount();
    expect(celebrationEl()).not.toBeNull();
    garageMocks.listCelebrations.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    });

    // Overlay still visible (ack only fires on close): a tick here would
    // return the same list and restart the animation under the user.
    expect(garageMocks.listCelebrations).not.toHaveBeenCalled();
    expect(celebrationEl()).not.toBeNull();
  });

  it('so faz ack no fechamento, nao na abertura', async () => {
    garageMocks.getMyBadges.mockResolvedValue({
      enabled: true,
      catalog: [catalogEntry('EVT-001')],
      badges: [],
    });
    garageMocks.listCelebrations.mockResolvedValue({
      enabled: true,
      pending: [pendingEntry('EVT-001')],
    });

    await mount();
    expect(celebrationEl()).not.toBeNull();
    expect(garageMocks.ackCelebrations).not.toHaveBeenCalled();

    await clickClose();
    expect(garageMocks.ackCelebrations).toHaveBeenCalledWith(['EVT-001']);
  });

  it('ignora o listener de push na web (Platform.OS === "web")', async () => {
    platformState.OS = 'web';
    await mount();
    expect(addNotificationReceivedListener).not.toHaveBeenCalled();
  });

  it('registra o listener de push fora da web', async () => {
    platformState.OS = 'ios';
    await mount();
    expect(addNotificationReceivedListener).toHaveBeenCalledTimes(1);

    garageMocks.listCelebrations.mockClear();
    await firePush();
    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
  });

  it('busca de novo quando o AppState volta para active', async () => {
    await mount();
    garageMocks.listCelebrations.mockClear();

    await fireAppStateActive();
    expect(garageMocks.listCelebrations).toHaveBeenCalledTimes(1);
  });

  it('para de escutar o bus e o AppState apos desmontar', async () => {
    const { requestCelebrationRefresh } = await import('../refresh-bus');
    await mount();
    await unmount();
    garageMocks.listCelebrations.mockClear();

    await act(async () => {
      requestCelebrationRefresh();
    });
    await flush();

    expect(garageMocks.listCelebrations).not.toHaveBeenCalled();
  });
});
