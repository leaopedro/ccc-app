// @vitest-environment jsdom
//
// ProfileMenuScreen route tests (Task 16). Covers the two behaviours added
// to `app/(app)/profile/index.tsx`:
//
//   1. An active subscription with a tier renders the PremiumBadge plus the
//      "Membro <Tier>" label under the hero card location line.
//   2. No active subscription (billing off, or simply not a member) renders
//      neither the badge nor the label — the hook is already 503-safe, so
//      the screen itself must not show a broken/empty slot.
//
// `usePremiumSubscription` is mocked directly so each state (active gold /
// inactive / null) is driven without touching the network. `@ccc/ui` is
// stubbed to a minimal PremiumBadge (real one just renders View/Text, but
// the barrel it lives in also drags in react-native-svg / @ccc/design via
// HexBadge, XPScoreboard, etc. — irrelevant to this screen, so a stub avoids
// mocking that whole chain). `getProfile` is mocked so the route clears its
// loading state and reaches the hero card where the badge/label live.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicProfile } from '@ccc/shared/profile';
import { profileCopy } from '~/copy/profile';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type Tier = 'bronze' | 'silver' | 'gold';

type HookResult = {
  subscription: { active: boolean; tier: Tier | null } | null;
  loading: boolean;
  error: boolean;
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

const hookState = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.value,
}));

// Fix (final review, Critical 1): the "Assinatura" menu row now also reads
// the platform gate (usePremiumPlans), so a gated build does not offer a
// second path back to /assinaturas -> /inicio (the gate's own redirect
// target). Defaults to true so the existing tests below (which only assert
// on the premium badge/label, not this row) keep exercising the same
// behaviour as before this fix.
const plansHookState = vi.hoisted(() => ({
  value: { subscriptionsEnabled: true } as { subscriptionsEnabled: boolean },
}));

vi.mock('~/hooks/usePremiumPlans', () => ({
  usePremiumPlans: () => plansHookState.value,
}));

vi.mock('~/hooks/useUnreadCount', () => ({
  useUnreadCount: () => ({ count: 0, refresh: vi.fn() }),
}));

vi.mock('~/auth/context', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('~/lib/upload-image', () => ({
  pickAndUpload: vi.fn(),
}));

const getProfileMock = vi.fn();
vi.mock('~/api/profile', () => ({
  getProfile: (...args: unknown[]) => getProfileMock(...args),
  updateProfile: vi.fn(),
}));

vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    PremiumBadge: ({ tier }: { tier: Tier | null }) =>
      ReactMod.createElement('span', { 'data-testid': 'premium-badge', 'data-tier': tier ?? '' }),
  };
});

// The global `lucide-react-native` alias (apps/mobile/vitest.config.ts) only
// exports a fixed icon list that doesn't cover most of this screen's icons
// (Bell, BellDot, CarFront, ChevronRight, Gem, LogOut, MapPinned, Package,
// PencilLine, MessageCircle, Ticket). A local vi.mock takes precedence over
// the alias — list every icon the route imports.
vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return {
    Bell: icon,
    BellDot: icon,
    CarFront: icon,
    ChevronRight: icon,
    Gem: icon,
    LogOut: icon,
    MapPinned: icon,
    MessageCircle: icon,
    Package: icon,
    PencilLine: icon,
    ShieldCheck: icon,
    Ticket: icon,
  };
});

vi.mock('expo-router', async () => {
  const ReactMod = await import('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMod.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useRouter: () => ({ push: vi.fn() }),
  };
});

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        source,
        accessible,
        contentContainerStyle,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void className;
      void accessibilityState;
      void source;
      void accessible;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

const baseProfile: PublicProfile = {
  id: 'u_1',
  email: 'membro@casacar.club',
  name: 'Fulano de Tal',
  role: 'user',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  bio: null,
  city: 'São Paulo',
  stateCode: 'SP',
  avatarUrl: null,
  cpf: null,
  phone: null,
};

const hookResult = (over: Partial<HookResult>): HookResult => ({
  subscription: null,
  loading: false,
  error: false,
  billingUnavailable: false,
  refresh: () => Promise.resolve(),
  ...over,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// `PREMIUM_BILLING_ENABLED` (~/lib/premium-runtime) is a top-level const
// evaluated from `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` at
// module-load time, not re-read per render. Same pattern as
// PremiumScreen.test.tsx: `vi.resetModules()` plus a dynamic `import()` of
// the route for every test, so each test's env var is actually observed.
const FLAG_VAR = 'EXPO_PUBLIC_PREMIUM_BILLING_ENABLED';

describe('ProfileMenuScreen (app/(app)/profile/index.tsx)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.resetModules();
    // Preserves the pre-existing default (env var unset) every other test in
    // this file already relies on.
    process.env[FLAG_VAR] = 'false';
    plansHookState.value = { subscriptionsEnabled: true };
    getProfileMock.mockReset();
    getProfileMock.mockResolvedValue(baseProfile);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
    delete process.env[FLAG_VAR];
  });

  const renderScreen = async () => {
    const { default: RouteIndex } = await import('../../../../app/(app)/profile/index');
    await act(async () => {
      root.render(<RouteIndex />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';

  // Fails if the `subscription?.active && subscription.tier` guard is
  // dropped, if PremiumBadge stops receiving the tier, or if memberTier()
  // stops mapping a given tier to its label. Pinned per-tier (not just
  // 'gold') so swapping any two of the three labels in memberTier() makes
  // the corresponding case fail — a prior round only asserted 'gold' and a
  // silver/bronze swap in the mapping still passed all 4 tests.
  it.each<[Tier, string]>([
    ['gold', 'Membro Ouro'],
    ['silver', 'Membro Prata'],
    ['bronze', 'Membro Bronze'],
  ])('renders the badge and "%s" label for an active %s subscription', async (tier, label) => {
    hookState.value = hookResult({ subscription: { active: true, tier } });
    await renderScreen();
    const badge = container.querySelector('[data-testid="premium-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('data-tier')).toBe(tier);
    expect(text()).toContain(label);
    // Guard against the swap mutation only tripping a `toContain` on a
    // substring collision — none of the other two labels should be present.
    const others = ['Membro Ouro', 'Membro Prata', 'Membro Bronze'].filter((l) => l !== label);
    for (const other of others) expect(text()).not.toContain(other);
  });

  // `subscription` is null when billing is off (the hook's 503-safe path) —
  // fails if that case ever renders a broken/empty badge slot.
  it('renders neither badge nor label when billing is unavailable (subscription null)', async () => {
    hookState.value = hookResult({ subscription: null, billingUnavailable: true });
    await renderScreen();
    expect(container.querySelector('[data-testid="premium-badge"]')).toBeNull();
    expect(text()).not.toContain('Membro Ouro');
    expect(text()).not.toContain('Membro Prata');
    expect(text()).not.toContain('Membro Bronze');
  });

  // A tier can be present on the payload even when the subscription is not
  // active (e.g. past-due/cancelled) — this fixture pins that `active` is
  // actually checked, not just "does tier exist". Fails if the guard is
  // weakened to `subscription?.tier` alone (dropping the `active` check),
  // which the null-subscription test above cannot catch since tier is
  // absent there too.
  it('renders neither badge nor label when the subscription has a tier but is not active', async () => {
    hookState.value = hookResult({ subscription: { active: false, tier: 'gold' } });
    await renderScreen();
    expect(container.querySelector('[data-testid="premium-badge"]')).toBeNull();
    expect(text()).not.toContain('Membro Ouro');
  });

  // Regression guard for the deleted legacy menu row (Task 16 step 2): the
  // route must not reintroduce the old "/profile/premium" entry or its
  // literal "Premium Gold" label — the module's own /assinaturas entry is
  // the only premium-related menu row now.
  it('does not render the legacy "Premium Gold" menu entry', async () => {
    hookState.value = hookResult({ subscription: { active: true, tier: 'gold' } });
    await renderScreen();
    expect(text()).not.toContain('Premium Gold');
  });

  // Fix (final review, Critical 1): this row pushes /assinaturas, which
  // redirects right back to /inicio when the platform gate is off — a
  // gated build must not offer that bounce. Same standard already applied
  // to the /inicio upsell pill (MinhaAssinaturaScreen, Task 10).
  describe('assinatura menu row (platform gate)', () => {
    it('hides the row when billing is on but the platform gate is off', async () => {
      process.env[FLAG_VAR] = 'true';
      plansHookState.value = { subscriptionsEnabled: false };
      hookState.value = hookResult({ subscription: null });
      await renderScreen();
      expect(text()).not.toContain(profileCopy.menu.assinatura);
    });

    it('shows the row when billing is on and the platform gate is on', async () => {
      process.env[FLAG_VAR] = 'true';
      plansHookState.value = { subscriptionsEnabled: true };
      hookState.value = hookResult({ subscription: null });
      await renderScreen();
      expect(text()).toContain(profileCopy.menu.assinatura);
    });

    it('hides the row when billing is off, regardless of the platform gate', async () => {
      process.env[FLAG_VAR] = 'false';
      plansHookState.value = { subscriptionsEnabled: true };
      hookState.value = hookResult({ subscription: null });
      await renderScreen();
      expect(text()).not.toContain(profileCopy.menu.assinatura);
    });
  });
});
