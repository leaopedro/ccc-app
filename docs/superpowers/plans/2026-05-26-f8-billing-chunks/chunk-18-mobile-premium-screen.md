# F8.18 — Mobile Premium Settings Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `PremiumScreen` inside the mobile profile stack — a settings screen that reads the user's premium status, renders a status badge, shows the current-period-end date, and presents a subscribe/manage CTA that branches on `Platform.OS`: iOS calls `purchasePackage` from the F8.10 RC library; Android opens `WebBrowser` to the web subscribe flow. Register the screen in the profile `_layout.tsx`. Add a lint rule forbidding Stripe tokens in iOS-conditional code paths. Add an App Review note to `docs/eas-credentials.md`.

**Architecture:** One new screen component `apps/mobile/src/screens/settings/PremiumScreen.tsx` (pure presentational logic, data fetched via `authedRequest`), one new API helper `apps/mobile/src/api/premium.ts` (owns the `GET /api/me/premium/status` call and the zod shape), a route file `apps/mobile/app/(app)/profile/premium.tsx` (wires the screen into Expo Router), a `Stack.Screen` entry in the profile `_layout.tsx`, a new ESLint plugin file `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`, an update to `apps/mobile/eslint.config.js` registering the rule, a lint fixture test `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts`, a `MenuRow` entry in `apps/mobile/app/(app)/profile/index.tsx`, and a note in `docs/eas-credentials.md`.

**Tech Stack:** Expo Router (file-based navigation), React Native + `Platform` API, `expo-web-browser` (existing dep), `authedRequest` from `~/api/client`, `fetchOfferings` + `purchasePackage` from `~/lib/revenuecat` (chunk F8.10), `premiumStatusSchema` from `@jdm/shared/premium` (chunk F8.11), vitest + jsdom (existing mobile harness), ESLint flat-config + custom rule.

---

## Required reading (before first edit)

1. `/Users/pedro/Projects/jdm-experience/CLAUDE.md` — branch preflight.
2. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §"F8.18" + canon §F8.11, §F8.14, §F8.16.
3. `/Users/pedro/Projects/jdm-experience/docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §8.1 (mobile flow), §11 (Apple isolation risk), §8.3 (`premiumStatusSchema` shape).
4. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-10-revenuecat-sdk-mobile.md` — exports of `revenuecat.ts`: `initRevenueCat`, `fetchOfferings`, `purchasePackage`. The `purchasePackage` param type is `Parameters<typeof Purchases.purchasePackage>[0]`.
5. `apps/mobile/app/(app)/profile/_layout.tsx` — where `Stack.Screen` entries are registered; this chunk adds the `premium` screen.
6. `apps/mobile/app/(app)/profile/index.tsx` — the profile menu screen with `MenuRow`; this chunk adds one new row.
7. `apps/mobile/src/screens/garage/__tests__/IdentityCard.test.tsx` (lines 1–60) — canonical react-native mock pattern (jsdom + inline `vi.mock('react-native', …)` + `vi.mock('react-native-svg', …)`). PremiumScreen tests follow this shape.
8. `apps/mobile/eslint.config.js` — existing flat-config file being extended with the new rule.
9. `/Users/pedro/Projects/jdm-experience/docs/eas-credentials.md` — where the App Review note lands (end of Step 1, after §1.2a).

---

## Locked invariants (do NOT relax)

- **Canon §F8.11** — all F8 routes gate on `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`. When disabled: screen shows a maintenance banner (`"Premium em breve"`), CTA hidden, no RC calls.
- **Canon §F8.14** — any new dep lands in `package.json` AND `pnpm-lock.yaml` in the same commit. This chunk adds no new deps (relies on existing `expo-web-browser`, `react-native-purchases` from F8.10, existing `authedRequest`).
- **Canon §F8.16** — iOS code path MUST NOT reference `stripe://`, `checkout.stripe.com`, `STRIPE_PUBLISHABLE_KEY`, or `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Enforced by the `no-stripe-on-ios` lint rule added in Task 4.
- **`premiumStatusSchema`** is defined in `packages/shared/src/premium.ts` (chunk F8.11). This chunk imports it from `@jdm/shared/premium`. If running before F8.11 merges, use the inline fallback shape defined in Task 1 step 1 (guarded by a TODO comment).
- **Platform.OS branching** must be a conditional expression that vitest can exercise — no build-time constants, no dead code elimination. The tests mock `Platform.OS` at the module level (same pattern as F8.10 tests).
- **Status-display copy** is PT-BR throughout. English strings forbidden on customer surfaces.
- **CTA hidden when `status.active === true`** and `status.cancelAtPeriodEnd === false`. When `cancelAtPeriodEnd === true`, show the manage-link only (no new-subscribe button).
- **Deep-link return scheme**: Android `WebBrowser.openAuthSessionAsync` uses `jdmexperience://premium/return`. The `app.config.ts` already declares a deep-link scheme — this chunk does NOT modify `app.config.ts` (scheme confirmed in required reading; if not present, add a task-deviation note and add it).
- Tests run via `pnpm --filter @jdm/mobile exec vitest run <path>` (canon §F8.12). Never run the full test suite locally.

---

## Feature-flag contract (canon §F8.11)

The feature flag for **mobile** is `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` (an `EXPO_PUBLIC_*` env var, inlined at build time). Read it as:

```ts
const premiumBillingEnabled =
  (Constants.expoConfig?.extra as { premiumBillingEnabled?: boolean } | undefined)
    ?.premiumBillingEnabled ?? false;
```

`app.config.ts` must expose it. This chunk adds `premiumBillingEnabled: process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true'` to the `extra` block (Task 1). When the flag is `false`, the screen renders a maintenance banner and returns early — no API call, no RC call.

---

## File structure

### New files

- `apps/mobile/src/api/premium.ts` — API helper: `getPremiumStatus(): Promise<PremiumStatusResponse>` using `authedRequest`.
- `apps/mobile/src/screens/settings/PremiumScreen.tsx` — screen component: status fetch, badge render, CTA branching.
- `apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx` — component tests: Platform.OS branch, status states, CTA gating, flag-disabled maintenance banner.
- `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts` — lint rule fixture test.
- `apps/mobile/app/(app)/profile/premium.tsx` — Expo Router route file (thin, just renders `<PremiumScreen />`).
- `apps/mobile/eslint-rules/no-stripe-on-ios.cjs` — custom ESLint rule implementation.

### Modified files

- `apps/mobile/app/(app)/profile/_layout.tsx` — add `Stack.Screen name="premium"`.
- `apps/mobile/app/(app)/profile/index.tsx` — add `MenuRow` entry for Premium.
- `apps/mobile/app.config.ts` — add `premiumBillingEnabled` to `extra` block.
- `apps/mobile/eslint.config.js` — register `no-stripe-on-ios` rule.
- `docs/eas-credentials.md` — add App Review note at end of §1.2a.

### Touched-path summary

```
apps/mobile/src/api/premium.ts                                         (new)
apps/mobile/src/screens/settings/PremiumScreen.tsx                     (new)
apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx      (new)
apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts (new)
apps/mobile/app/(app)/profile/premium.tsx                              (new)
apps/mobile/eslint-rules/no-stripe-on-ios.cjs                          (new)
apps/mobile/app/(app)/profile/_layout.tsx                              (modify)
apps/mobile/app/(app)/profile/index.tsx                                (modify)
apps/mobile/app.config.ts                                              (modify)
apps/mobile/eslint.config.js                                           (modify)
docs/eas-credentials.md                                                (modify)
```

---

## Code shape (canonical for this chunk)

### `apps/mobile/src/api/premium.ts` (new)

```ts
// F8.18 — premium status API helper.
// Consumes GET /api/me/premium/status (spec §8.3 / chunk F8.11).
// premiumStatusSchema is defined in packages/shared/src/premium.ts (F8.11).

import { premiumStatusSchema } from '@jdm/shared/premium';
import type { z } from 'zod';

import { authedRequest } from '~/api/client';

export type PremiumStatusResponse = z.infer<typeof premiumStatusSchema>;

export const getPremiumStatus = (): Promise<PremiumStatusResponse> =>
  authedRequest('/api/me/premium/status', premiumStatusSchema);
```

### `apps/mobile/src/screens/settings/PremiumScreen.tsx` (new)

```tsx
// F8.18 — PremiumScreen.
//
// iOS  → CTA calls purchasePackage from ~/lib/revenuecat (canon §F8.16: no Stripe).
// Android → CTA opens WebBrowser to the web subscribe flow + deep-link return.
//
// Feature-flag: when EXPO_PUBLIC_PREMIUM_BILLING_ENABLED is false,
// show maintenance banner and return early (canon §F8.11).
//
// Status badge copy (PT-BR):
//   active + !cancelAtPeriodEnd  → "Membro Gold"
//   active + cancelAtPeriodEnd   → "Membro Gold (cancelamento agendado)"
//   past_due                     → "Pagamento pendente"
//   default / inactive           → "Inativo"

import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PremiumStatusResponse } from '~/api/premium';
import { getPremiumStatus } from '~/api/premium';
import { baseUrl } from '~/api/client';
import { fetchOfferings, purchasePackage } from '~/lib/revenuecat';
import { theme } from '~/theme';

// Deep-link return scheme for Android WebBrowser flow.
const DEEP_LINK_RETURN = 'jdmexperience://premium/return';

type Extra = { premiumBillingEnabled?: boolean };

const isPremiumBillingEnabled = (): boolean =>
  (Constants.expoConfig?.extra as Extra | undefined)?.premiumBillingEnabled ?? false;

function statusLabel(status: PremiumStatusResponse): string {
  if (status.active && !status.cancelAtPeriodEnd) return 'Membro Gold';
  if (status.active && status.cancelAtPeriodEnd) return 'Membro Gold (cancelamento agendado)';
  if (!status.active && status.tier !== null) return 'Pagamento pendente';
  return 'Inativo';
}

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PremiumScreen() {
  const enabled = isPremiumBillingEnabled();
  const [status, setStatus] = useState<PremiumStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setStatus(await getPremiumStatus());
    } catch {
      setError('Não foi possível carregar o status. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // Feature flag disabled — maintenance banner.
  if (!enabled) {
    return (
      <View style={styles.center} testID="premium-maintenance">
        <Text style={styles.maintenanceText}>Premium em breve</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator testID="premium-loading" />
      </View>
    );
  }

  if (error || !status) {
    return (
      <View style={styles.center} testID="premium-error">
        <Text style={styles.errorText}>{error ?? 'Erro ao carregar.'}</Text>
      </View>
    );
  }

  const label = statusLabel(status);
  const periodEnd = formatPeriodEnd(status.currentPeriodEnd);
  // Show subscribe CTA only when not already active (or cancel_scheduled = still active).
  const showSubscribeCTA = !status.active;
  // Show manage link when active (includes cancel_scheduled).
  const showManageLink = status.active && !!status.manageUrl;

  const onSubscribeIos = async () => {
    setPurchasing(true);
    try {
      const offerings = await fetchOfferings();
      const pkg = offerings?.current?.monthly;
      if (!pkg) {
        setError('Oferta não disponível no momento.');
        return;
      }
      await purchasePackage(pkg);
      // After purchase, the RC webhook fires server-side.
      // Poll status after a short delay to reflect activation.
      await new Promise<void>((r) => setTimeout(r, 2000));
      await load();
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== 'purchaseCancelled') {
        setError('Erro ao processar compra. Tente novamente.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const onSubscribeAndroid = async () => {
    const url = `${baseUrl()}/premium`;
    const result = await WebBrowser.openAuthSessionAsync(url, DEEP_LINK_RETURN);
    if (result.type === 'success') {
      await load();
    }
  };

  const onManage = () => {
    if (status.manageUrl) void Linking.openURL(status.manageUrl);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Status badge */}
      <View style={styles.badgeRow} testID="premium-badge-row">
        <View style={[styles.badge, status.active ? styles.badgeActive : styles.badgeInactive]}>
          <Text style={styles.badgeText} testID="premium-status-badge">
            {label}
          </Text>
        </View>
      </View>

      {/* Period end */}
      {periodEnd ? (
        <Text style={styles.periodEnd} testID="premium-period-end">
          {'Válido até ' + periodEnd}
        </Text>
      ) : null}

      {/* Subscribe CTA — iOS: RC / Android: WebBrowser */}
      {showSubscribeCTA ? (
        Platform.OS === 'ios' ? (
          <Pressable
            onPress={() => void onSubscribeIos()}
            style={styles.cta}
            disabled={purchasing}
            accessibilityRole="button"
            accessibilityLabel="Assinar Premium Gold"
            testID="premium-cta-ios"
          >
            <Text style={styles.ctaText}>{purchasing ? 'Processando…' : 'Assinar Gold'}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void onSubscribeAndroid()}
            style={styles.cta}
            accessibilityRole="button"
            accessibilityLabel="Assinar Premium Gold"
            testID="premium-cta-android"
          >
            <Text style={styles.ctaText}>Assinar Gold</Text>
          </Pressable>
        )
      ) : null}

      {/* Manage link */}
      {showManageLink ? (
        <Pressable
          onPress={onManage}
          style={styles.manageLink}
          accessibilityRole="link"
          accessibilityLabel="Gerenciar assinatura"
          testID="premium-manage-link"
        >
          <Text style={styles.manageLinkText}>Gerenciar assinatura</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.xl, gap: theme.spacing.lg, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  maintenanceText: { color: theme.colors.muted, fontSize: theme.font.size.lg },
  errorText: { color: theme.colors.accent, fontSize: theme.font.size.md },
  badgeRow: { flexDirection: 'row' },
  badge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
  },
  badgeActive: { backgroundColor: '#1A3A1A' },
  badgeInactive: { backgroundColor: '#2A2A30' },
  badgeText: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  periodEnd: { color: theme.colors.muted, fontSize: theme.font.size.md },
  cta: {
    backgroundColor: '#C0A000',
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#0a0a0a', fontWeight: '700', fontSize: theme.font.size.lg },
  manageLink: { paddingVertical: theme.spacing.sm },
  manageLinkText: {
    color: theme.colors.muted,
    textDecorationLine: 'underline',
    fontSize: theme.font.size.md,
  },
});
```

### `apps/mobile/app/(app)/profile/premium.tsx` (new — thin Expo Router route)

```tsx
import PremiumScreen from '~/screens/settings/PremiumScreen';

export default PremiumScreen;
```

### `apps/mobile/app.config.ts` extra block delta

```ts
// existing extra block, add one line alongside the existing premiumBillingEnabled env var:
premiumBillingEnabled: process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true',
```

### `_layout.tsx` delta (profile Stack)

Add one `Stack.Screen` after the existing `push-preferences` entry:

```tsx
<Stack.Screen
  name="premium"
  options={{
    title: 'Premium Gold',
    headerLeft: () => (
      <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
        <ChevronLeft color="#F5F5F5" size={24} />
      </Pressable>
    ),
  }}
/>
```

### `profile/index.tsx` delta (new MenuRow)

Add import `{ Crown }` from `lucide-react-native` (or use `Star` if Crown is unavailable — check the existing lucide import). Insert a `MenuRow` before the logout row:

```tsx
<MenuRow
  icon={<Star color={theme.colors.fg} size={18} strokeWidth={1.75} />}
  label="Premium Gold"
  hint="Gerencie sua assinatura premium"
  onPress={() => router.push('/profile/premium' as never)}
/>
```

### `apps/mobile/eslint-rules/no-stripe-on-ios.cjs` (new — custom ESLint rule)

```js
// no-stripe-on-ios — forbid Stripe references in iOS-conditional code paths.
// Canon §F8.16: the iOS bundle MUST NOT reference Stripe checkout surfaces.
//
// Fires when any of these tokens appear inside apps/mobile/src/**/*.{ts,tsx}
// UNLESS the nearest enclosing Platform.OS check is `Platform.OS !== 'ios'`
// (i.e. an Android-only guard).
//
// Forbidden tokens:
//   - 'stripe://' (URL scheme literal)
//   - 'checkout.stripe.com' (literal)
//   - 'STRIPE_PUBLISHABLE_KEY' (env var reference)
//   - 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY' (env var reference)
//
// This rule runs as a string-scan on Literal nodes. A future version could
// add MemberExpression awareness; this is sufficient for App Review compliance.

'use strict';

const FORBIDDEN_TOKENS = [
  'stripe://',
  'checkout.stripe.com',
  'STRIPE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

/**
 * Walk up the ancestor chain and return true if the node is inside a
 * `Platform.OS !== 'ios'` conditional (i.e. Android guard).
 * Returns false (fires the lint error) in all other contexts.
 */
function isInsideAndroidGuard(node, ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    // if (Platform.OS !== 'ios') { ... }   or   Platform.OS !== 'ios' && ...
    if (
      anc.type === 'BinaryExpression' &&
      anc.operator === '!==' &&
      isPlatformOsMember(anc.left) &&
      anc.right.type === 'Literal' &&
      anc.right.value === 'ios'
    ) {
      return true;
    }
    // Platform.OS === 'android'
    if (
      anc.type === 'BinaryExpression' &&
      anc.operator === '===' &&
      isPlatformOsMember(anc.left) &&
      anc.right.type === 'Literal' &&
      anc.right.value === 'android'
    ) {
      return true;
    }
  }
  return false;
}

function isPlatformOsMember(node) {
  return (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'Platform' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'OS'
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid Stripe references in iOS-conditional code (App Review compliance, canon §F8.16)',
      category: 'Security',
      recommended: true,
    },
    schema: [],
    messages: {
      noStripeOnIos:
        "Stripe token '{{token}}' must not appear in iOS code paths (canon §F8.16). " +
        "Wrap it in a Platform.OS !== 'ios' guard or move it to the Android branch.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        const val = String(node.value ?? '');
        for (const token of FORBIDDEN_TOKENS) {
          if (val.includes(token)) {
            const ancestors = context.getAncestors ? context.getAncestors() : [];
            if (!isInsideAndroidGuard(node, ancestors)) {
              context.report({
                node,
                messageId: 'noStripeOnIos',
                data: { token },
              });
            }
          }
        }
      },
    };
  },
};
```

### `apps/mobile/eslint.config.js` delta

```js
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noStripeOnIos = require('./eslint-rules/no-stripe-on-ios.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'scripts/*', '.expo/*', 'app.config.ts', 'tailwind.config.js'],
  },
  // Canon §F8.16 — iOS bundle isolation: forbid Stripe tokens in mobile source.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'jdm-mobile': { rules: { 'no-stripe-on-ios': noStripeOnIos } } },
    rules: { 'jdm-mobile/no-stripe-on-ios': 'error' },
  },
]);
```

---

## Branch preflight (run before first edit)

- [ ] **Step 0: confirm fresh `main` branch**

```bash
git branch --show-current
# Expect: main (NOT production — if production, STOP per CLAUDE.md)
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-18
```

Expected: clean branch off `main`, no merge conflicts.

---

## Task 1 — Feature-flag env entry + API helper

**Files:**

- Modify: `apps/mobile/app.config.ts`
- Create: `apps/mobile/src/api/premium.ts`

- [ ] **Step 1: write the failing test for `getPremiumStatus`**

Create `apps/mobile/src/api/__tests__/premium.test.ts` (can be deleted after merge if the team prefers — but must exist during TDD red-green):

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', () => ({
  authedRequest: vi.fn(),
}));

import { authedRequest } from '~/api/client';
import { getPremiumStatus } from '../premium';

const mockAuthedRequest = vi.mocked(authedRequest);

describe('getPremiumStatus', () => {
  it('calls authedRequest with the correct path', async () => {
    mockAuthedRequest.mockResolvedValueOnce({
      active: true,
      tier: 'gold',
      cadence: 'monthly',
      provider: 'apple_revenuecat',
      currentPeriodEnd: '2026-06-26T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
    await getPremiumStatus();
    expect(mockAuthedRequest).toHaveBeenCalledWith('/api/me/premium/status', expect.anything());
  });
});
```

- [ ] **Step 2: run the test — expect FAIL**

```bash
pnpm --filter @jdm/mobile exec vitest run src/api/__tests__/premium.test.ts
# Expected: FAIL — Cannot find module '../premium'
```

- [ ] **Step 3: add `premiumBillingEnabled` to `app.config.ts`**

In `apps/mobile/app.config.ts`, inside the `extra: { ... }` block (after the existing `rcIosApiKey` line added in F8.10):

```ts
  // Premium billing feature flag — inlined at build time (canon §F8.11).
  // Default false; flip to true in .env.local after all 19 F8 chunks land.
  premiumBillingEnabled: process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true',
```

- [ ] **Step 4: create `apps/mobile/src/api/premium.ts`**

```ts
// F8.18 — premium status API helper.
// Consumes GET /api/me/premium/status (spec §8.3 / chunk F8.11).
// premiumStatusSchema is defined in packages/shared/src/premium.ts (F8.11).

import { premiumStatusSchema } from '@jdm/shared/premium';
import type { z } from 'zod';

import { authedRequest } from '~/api/client';

export type PremiumStatusResponse = z.infer<typeof premiumStatusSchema>;

export const getPremiumStatus = (): Promise<PremiumStatusResponse> =>
  authedRequest('/api/me/premium/status', premiumStatusSchema);
```

- [ ] **Step 5: run the test — expect PASS**

```bash
pnpm --filter @jdm/mobile exec vitest run src/api/__tests__/premium.test.ts
# Expected: 1 passing
```

- [ ] **Step 6: typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
# If @jdm/shared/premium is not yet exported: run `pnpm --filter @jdm/shared build`
# per memory rule "Rebuild @jdm/shared after schema changes".
```

- [ ] **Step 7: commit**

```bash
git add apps/mobile/app.config.ts apps/mobile/src/api/premium.ts apps/mobile/src/api/__tests__/premium.test.ts
git commit -m "feat(mobile): premium API helper + feature-flag env entry (F8.18)"
```

---

## Task 2 — `PremiumScreen` component + failing tests

**Files:**

- Create: `apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx`
- Create: `apps/mobile/src/screens/settings/PremiumScreen.tsx`

- [ ] **Step 1: write the failing tests**

Create `apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// PremiumScreen tests.
// Covers: Platform.OS branching (iOS/Android CTA), status badge states,
// CTA hidden when already-active, manage-link when cancel_scheduled,
// maintenance banner when feature flag off.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// ─── react-native mock ───────────────────────────────────────────────────────
const platformMock = { OS: 'ios' as 'ios' | 'android' | 'web' };

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
        hitSlop,
        numberOfLines,
        disabled,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag || disabled === true) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
    Linking: { openURL: vi.fn() },
    Platform: platformMock,
  };
});

// ─── expo-constants mock (feature flag on by default) ───────────────────────
const extraMock = { premiumBillingEnabled: true };

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: extraMock } },
}));

// ─── expo-web-browser mock ───────────────────────────────────────────────────
const mockOpenAuthSession = vi.fn();
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: mockOpenAuthSession,
}));

// ─── API mock ─────────────────────────────────────────────────────────────────
const mockGetPremiumStatus = vi.fn();
vi.mock('~/api/premium', () => ({ getPremiumStatus: mockGetPremiumStatus }));

// ─── RevenueCat mock ─────────────────────────────────────────────────────────
const mockFetchOfferings = vi.fn();
const mockPurchasePackage = vi.fn();
vi.mock('~/lib/revenuecat', () => ({
  fetchOfferings: mockFetchOfferings,
  purchasePackage: mockPurchasePackage,
}));

// ─── api/client baseUrl mock ─────────────────────────────────────────────────
vi.mock('~/api/client', () => ({
  baseUrl: () => 'http://localhost:4000',
  authedRequest: vi.fn(),
}));

// ─── lucide-react-native stub (transitive via @jdm/ui if needed) ──────────────
vi.mock('lucide-react-native', () => ({ default: {} }));

// ─── import SUT ──────────────────────────────────────────────────────────────
import PremiumScreen from '../PremiumScreen';

// ─── helpers ─────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  platformMock.OS = 'ios';
  extraMock.premiumBillingEnabled = true;
  mockGetPremiumStatus.mockReset();
  mockFetchOfferings.mockReset();
  mockPurchasePackage.mockReset();
  mockOpenAuthSession.mockReset();
});

afterEach(() => {
  root.unmount();
  container.remove();
});

const mount = async () => {
  await act(async () => {
    root.render(<PremiumScreen />);
    for (let i = 0; i < 6; i++) await flush();
  });
};

// ─── active-status fixture ───────────────────────────────────────────────────
const activeStatus = {
  active: true,
  tier: 'gold' as const,
  cadence: 'monthly' as const,
  provider: 'apple_revenuecat' as const,
  currentPeriodEnd: '2026-06-26T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const cancelScheduledStatus = {
  ...activeStatus,
  cancelAtPeriodEnd: true,
  manageUrl: 'https://apps.apple.com/account/subscriptions',
};

const inactiveStatus = {
  active: false,
  tier: null,
  cadence: null,
  provider: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const pastDueStatus = {
  active: false,
  tier: 'gold' as const,
  cadence: 'monthly' as const,
  provider: 'apple_revenuecat' as const,
  currentPeriodEnd: '2026-06-26T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('feature flag', () => {
  it('shows maintenance banner when premiumBillingEnabled is false', async () => {
    extraMock.premiumBillingEnabled = false;
    await mount();
    expect(container.querySelector('[data-testid="premium-maintenance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-status-badge"]')).toBeNull();
    expect(mockGetPremiumStatus).not.toHaveBeenCalled();
  });
});

describe('status display', () => {
  it('shows "Membro Gold" badge for active non-cancelled subscription', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Membro Gold');
  });

  it('shows "Membro Gold (cancelamento agendado)" badge for cancel_scheduled', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toContain('cancelamento agendado');
  });

  it('shows "Inativo" badge for inactive subscription', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Inativo');
  });

  it('shows "Pagamento pendente" badge when status has tier but not active', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(pastDueStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Pagamento pendente');
  });

  it('renders period-end date in pt-BR format when currentPeriodEnd is set', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    const periodEndEl = container.querySelector('[data-testid="premium-period-end"]');
    // '2026-06-26' → 26/06/2026 in pt-BR
    expect(periodEndEl?.textContent).toContain('26/06/2026');
  });

  it('does not render period-end when currentPeriodEnd is null', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-period-end"]')).toBeNull();
  });
});

describe('CTA gating', () => {
  it('shows iOS CTA on Platform.OS === "ios" when not active', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
  });

  it('shows Android CTA on Platform.OS === "android" when not active', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
  });

  it('hides CTA when already active (non-cancelled)', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
  });

  it('hides CTA when cancel_scheduled (still active — manage link shown instead)', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
  });
});

describe('Platform.OS branching — iOS calls RC, Android opens WebBrowser', () => {
  it('calls fetchOfferings + purchasePackage on iOS CTA tap', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus).mockResolvedValueOnce(activeStatus); // reload after purchase
    mockFetchOfferings.mockResolvedValueOnce({
      current: { monthly: { identifier: '$rc_monthly' } },
    });
    mockPurchasePackage.mockResolvedValueOnce({ transaction: { transactionIdentifier: 'txn_1' } });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-ios"]') as HTMLElement;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta.click();
      for (let i = 0; i < 10; i++) await flush();
    });
    expect(mockFetchOfferings).toHaveBeenCalledOnce();
    expect(mockPurchasePackage).toHaveBeenCalledWith({ identifier: '$rc_monthly' });
  });

  it('does NOT call fetchOfferings on Android (opens WebBrowser instead)', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'cancel' });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-android"]') as HTMLElement;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta.click();
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(mockFetchOfferings).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      'http://localhost:4000/premium',
      'jdmexperience://premium/return',
    );
  });

  it('reloads status after successful Android WebBrowser flow', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus).mockResolvedValueOnce(activeStatus);
    mockOpenAuthSession.mockResolvedValueOnce({
      type: 'success',
      url: 'jdmexperience://premium/return',
    });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-android"]') as HTMLElement;
    await act(async () => {
      cta.click();
      for (let i = 0; i < 10; i++) await flush();
    });
    expect(mockGetPremiumStatus).toHaveBeenCalledTimes(2);
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Membro Gold');
  });
});

describe('manage link', () => {
  it('renders manage link when cancel_scheduled and manageUrl is set', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    const manageLink = container.querySelector('[data-testid="premium-manage-link"]');
    expect(manageLink).not.toBeNull();
  });

  it('does not render manage link when not active', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-manage-link"]')).toBeNull();
  });

  it('does not render manage link when active but manageUrl is null', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus); // manageUrl: null
    await mount();
    expect(container.querySelector('[data-testid="premium-manage-link"]')).toBeNull();
  });
});
```

- [ ] **Step 2: run the tests — expect FAIL**

```bash
pnpm --filter @jdm/mobile exec vitest run src/screens/settings/__tests__/PremiumScreen.test.tsx
# Expected: FAIL — Cannot find module '../PremiumScreen'
```

---

## Task 3 — Implement `PremiumScreen.tsx`

**Files:**

- Create: `apps/mobile/src/screens/settings/PremiumScreen.tsx`

- [ ] **Step 1: create the `settings` directory and `PremiumScreen.tsx`**

```bash
mkdir -p /Users/pedro/Projects/jdm-experience/apps/mobile/src/screens/settings/__tests__
```

Create `apps/mobile/src/screens/settings/PremiumScreen.tsx` with the full content from §"Code shape" above.

- [ ] **Step 2: run the tests — expect PASS**

```bash
pnpm --filter @jdm/mobile exec vitest run src/screens/settings/__tests__/PremiumScreen.test.tsx
# Expected: 13+ passing, 0 failing.
```

Diagnose any failures before continuing. Common issues:

- `Cannot find module '@jdm/shared/premium'`: run `pnpm --filter @jdm/shared build` (canon §F8.13).
- `Platform` not mocked: confirm `vi.mock('react-native', ...)` returns `Platform: platformMock`.
- `fetchOfferings` not found: confirm `vi.mock('~/lib/revenuecat', ...)` exports it.

- [ ] **Step 3: typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **Step 4: commit**

```bash
git add apps/mobile/src/screens/settings/PremiumScreen.tsx \
        apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx
git commit -m "feat(mobile): PremiumScreen — status badge, iOS RC CTA, Android WebBrowser CTA (F8.18)"
```

---

## Task 4 — Expo Router route + profile navigation wiring

**Files:**

- Create: `apps/mobile/app/(app)/profile/premium.tsx`
- Modify: `apps/mobile/app/(app)/profile/_layout.tsx`
- Modify: `apps/mobile/app/(app)/profile/index.tsx`

- [ ] **Step 1: create the route file**

Create `apps/mobile/app/(app)/profile/premium.tsx`:

```tsx
import PremiumScreen from '~/screens/settings/PremiumScreen';

export default PremiumScreen;
```

- [ ] **Step 2: add `Stack.Screen` to `_layout.tsx`**

In `apps/mobile/app/(app)/profile/_layout.tsx`, after the `push-preferences` `Stack.Screen` block (before the closing `</Stack>` tag), add:

```tsx
<Stack.Screen
  name="premium"
  options={{
    title: 'Premium Gold',
    headerLeft: () => (
      <Pressable onPress={() => router.replace('/profile')} hitSlop={8}>
        <ChevronLeft color="#F5F5F5" size={24} />
      </Pressable>
    ),
  }}
/>
```

- [ ] **Step 3: add `MenuRow` to `profile/index.tsx`**

In `apps/mobile/app/(app)/profile/index.tsx`:

a. Add `Star` to the lucide-react-native import:

```tsx
import {
  Bell,
  BellDot,
  CarFront,
  ChevronRight,
  LogOut,
  MapPinned,
  MessageCircle,
  Package,
  PencilLine,
  Star, // ← add
} from 'lucide-react-native';
```

b. Insert before the `LogOut` `MenuRow`:

```tsx
<MenuRow
  icon={<Star color={theme.colors.fg} size={18} strokeWidth={1.75} />}
  label="Premium Gold"
  hint="Gerencie sua assinatura premium"
  onPress={() => router.push('/profile/premium' as never)}
/>
```

- [ ] **Step 4: typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **Step 5: commit**

```bash
git add apps/mobile/app/\(app\)/profile/premium.tsx \
        apps/mobile/app/\(app\)/profile/_layout.tsx \
        apps/mobile/app/\(app\)/profile/index.tsx
git commit -m "feat(mobile): register PremiumScreen in profile stack + menu entry (F8.18)"
```

---

## Task 5 — `no-stripe-on-ios` ESLint rule + lint fixture test

**Files:**

- Create: `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`
- Modify: `apps/mobile/eslint.config.js`
- Create: `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts`

- [ ] **Step 1: write the failing lint fixture test**

Create `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts`:

```ts
// ios-stripe-isolation.test.ts
//
// Verifies the `jdm-mobile/no-stripe-on-ios` ESLint rule fires on a fixture
// file containing a forbidden Stripe token outside an Android guard.
// Uses Node child_process to spawn ESLint and parse its JSON output — no
// jsdom needed.

import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Root of the monorepo — ESLint is invoked from there.
const REPO_ROOT = '/Users/pedro/Projects/jdm-experience';
const MOBILE_ROOT = join(REPO_ROOT, 'apps/mobile');

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = join(tmpdir(), `f8-lint-fixture-${Date.now()}`);
  mkdirSync(fixtureDir, { recursive: true });
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('no-stripe-on-ios ESLint rule', () => {
  it('reports an error when stripe:// appears outside a Platform.OS guard', () => {
    // Fixture: a TSX file placing a Stripe URL in an unconditional path.
    // This is EXACTLY the pattern that must be flagged (canon §F8.16).
    const fixtureFile = join(fixtureDir, 'bad-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
// fixture: forbidden Stripe token outside any guard
const url = 'stripe://payment';
export default function BadComponent() { return null; }
`,
    );

    let output: string;
    try {
      // Run ESLint from the mobile workspace root with JSON format.
      // --no-eslintrc ensures only eslint.config.js is used (flat config).
      output = execSync(`node_modules/.bin/eslint --format json "${fixtureFile}"`, {
        cwd: MOBILE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e: unknown) {
      // ESLint exits non-zero when errors are found; capture stdout from the error.
      output = (e as { stdout?: string }).stdout ?? '';
    }

    const results = JSON.parse(output) as Array<{
      filePath: string;
      messages: Array<{ ruleId: string; message: string }>;
    }>;

    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'jdm-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(true);
  });

  it('does NOT report an error when a Stripe token is guarded by Platform.OS !== "ios"', () => {
    const fixtureFile = join(fixtureDir, 'ok-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
import { Platform } from 'react-native';
// Android-only guard: rule must NOT fire here.
const url = Platform.OS !== 'ios' ? 'checkout.stripe.com/pay/session_1' : null;
export default function OkComponent() { return null; }
`,
    );

    let output: string;
    try {
      output = execSync(`node_modules/.bin/eslint --format json "${fixtureFile}"`, {
        cwd: MOBILE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e: unknown) {
      output = (e as { stdout?: string }).stdout ?? '';
    }

    const results = JSON.parse(output) as Array<{
      messages: Array<{ ruleId: string }>;
    }>;
    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'jdm-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(false);
  });

  it('reports an error when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY appears without a guard', () => {
    const fixtureFile = join(fixtureDir, 'bad-env-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
const key = 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY';
export default function BadEnvComponent() { return null; }
`,
    );

    let output: string;
    try {
      output = execSync(`node_modules/.bin/eslint --format json "${fixtureFile}"`, {
        cwd: MOBILE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e: unknown) {
      output = (e as { stdout?: string }).stdout ?? '';
    }

    const results = JSON.parse(output) as Array<{
      messages: Array<{ ruleId: string }>;
    }>;
    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'jdm-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(true);
  });
});
```

- [ ] **Step 2: run the test — expect FAIL**

```bash
pnpm --filter @jdm/mobile exec vitest run src/screens/settings/__tests__/ios-stripe-isolation.test.ts
# Expected: FAIL — eslint exits 0 (rule doesn't exist yet) or the ruleId is absent.
```

- [ ] **Step 3: create the `eslint-rules` directory and rule file**

```bash
mkdir -p /Users/pedro/Projects/jdm-experience/apps/mobile/eslint-rules
```

Create `apps/mobile/eslint-rules/no-stripe-on-ios.cjs` with the full content from §"Code shape" above.

- [ ] **Step 4: update `apps/mobile/eslint.config.js`**

Replace the entire file contents with:

```js
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noStripeOnIos = require('./eslint-rules/no-stripe-on-ios.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'scripts/*', '.expo/*', 'app.config.ts', 'tailwind.config.js'],
  },
  // Canon §F8.16 — iOS bundle isolation: forbid Stripe tokens in mobile source.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'jdm-mobile': { rules: { 'no-stripe-on-ios': noStripeOnIos } } },
    rules: { 'jdm-mobile/no-stripe-on-ios': 'error' },
  },
]);
```

- [ ] **Step 5: run the lint fixture test — expect PASS**

```bash
pnpm --filter @jdm/mobile exec vitest run src/screens/settings/__tests__/ios-stripe-isolation.test.ts
# Expected: 3 passing, 0 failing.
```

If the "guarded" test fails (false positive from the rule), review `isInsideAndroidGuard` in `no-stripe-on-ios.cjs`. The ancestor walk must reach the containing `BinaryExpression` correctly.

- [ ] **Step 6: confirm the rule fires on the existing codebase**

```bash
cd /Users/pedro/Projects/jdm-experience/apps/mobile && node_modules/.bin/eslint src/
# Expected: any Stripe references not behind an Android guard are flagged.
# (PremiumScreen.tsx should be clean — Android CTA uses WebBrowser, not Stripe URLs.)
# Any pre-existing violations need a Platform.OS guard wrapping them.
```

- [ ] **Step 7: commit**

```bash
git add apps/mobile/eslint-rules/no-stripe-on-ios.cjs \
        apps/mobile/eslint.config.js \
        apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts
git commit -m "feat(mobile): no-stripe-on-ios ESLint rule + fixture test (canon §F8.16, F8.18)"
```

---

## Task 6 — App Review note in `docs/eas-credentials.md`

**Files:**

- Modify: `docs/eas-credentials.md`

- [ ] **Step 1: append the App Review note**

In `docs/eas-credentials.md`, at the end of section **§1.2a Capabilities to enable on the App IDs** (after the "Do not enable these today unless scope changes" list), add:

```markdown
### App Review note — iOS bundle must not reference Stripe

The iOS bundle MUST NOT reference Stripe checkout surfaces. This is required for
App Store Review compliance: Apple rejects apps that imply an external payment
method for digital goods (App Store Review Guideline 3.1.1).

Enforcement: the `jdm-mobile/no-stripe-on-ios` ESLint rule (added in F8.18)
scans `apps/mobile/src/**/*.{ts,tsx}` at CI time and reports an error if any of
the following tokens appear outside a `Platform.OS !== 'ios'` guard:

- `stripe://`
- `checkout.stripe.com`
- `STRIPE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`

iOS users subscribe via Apple StoreKit through RevenueCat (canon §F8.16).
Android users subscribe via the web Stripe Checkout flow opened with
`expo-web-browser`. The two paths are completely isolated.

Before submitting a TestFlight or App Store build:

1. Run `pnpm --filter @jdm/mobile exec eslint src/` and confirm 0 errors from
   the `jdm-mobile/no-stripe-on-ios` rule.
2. Confirm `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` is `true` in the EAS build
   secret so the Premium screen is not hidden behind the maintenance banner.
3. Confirm `EXPO_PUBLIC_RC_IOS_API_KEY` is set as an EAS secret for the
   production build profile.
```

- [ ] **Step 2: commit**

```bash
git add docs/eas-credentials.md
git commit -m "docs: App Review note — iOS bundle must not reference Stripe (canon §F8.16, F8.18)"
```

---

## Verification (final)

- [ ] **A. Run both vitest test files**

```bash
pnpm --filter @jdm/mobile exec vitest run \
  src/screens/settings/__tests__/PremiumScreen.test.tsx \
  src/screens/settings/__tests__/ios-stripe-isolation.test.ts
# Expected: 16+ passing, 0 failing.
```

- [ ] **B. Typecheck the mobile workspace**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **C. Lint the mobile src directory**

```bash
cd /Users/pedro/Projects/jdm-experience/apps/mobile && node_modules/.bin/eslint src/
# Expected: 0 errors from jdm-mobile/no-stripe-on-ios.
# PremiumScreen.tsx must be clean (no Stripe token outside an Android guard).
```

- [ ] **D. Confirm no full suite run** — touched files only per memory rule.

> Do NOT run `pnpm test` (full suite). CI runs the sweep on PR push.

---

## Self-review

### Spec coverage

| Spec / canon requirement                                         | Task that covers it                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| §8.1 — iOS: RC SDK purchase flow                                 | Task 3: `onSubscribeIos` calls `fetchOfferings` + `purchasePackage`; Task 2 tests confirm iOS CTA taps RC  |
| §8.1 — Android: WebBrowser → web flow + deep-link return         | Task 3: `onSubscribeAndroid` uses `WebBrowser.openAuthSessionAsync`; Task 2 test confirms Android path     |
| §8.1 — Status badge (Membro Gold / Inativo / Pagamento pendente) | Task 3: `statusLabel()` covers all states; Task 2 tests assert each badge label                            |
| §8.1 — Current-period-end formatted                              | Task 3: `formatPeriodEnd()` with `pt-BR` locale; Task 2 test checks `26/06/2026`                           |
| §8.1 — Manage link when cancel_scheduled                         | Task 3: `showManageLink` logic; Task 2 tests assert manage-link presence/absence                           |
| §8.3 — `premiumStatusSchema` shape used                          | Task 1: `getPremiumStatus` uses the schema from `@jdm/shared/premium`                                      |
| Canon §F8.11 — feature flag gates screen                         | Task 1: `premiumBillingEnabled` from `extra`; Task 3: maintenance banner when false; Task 2: flag-off test |
| Canon §F8.16 — iOS bundle isolation                              | Task 5: `no-stripe-on-ios` rule + fixture tests fire on bad token; ok on guarded token                     |
| Spec §11 — App Review note                                       | Task 6: note added to `docs/eas-credentials.md`                                                            |
| Expo Router registration                                         | Task 4: `premium.tsx` route + `Stack.Screen` in `_layout.tsx`                                              |
| Profile menu entry point                                         | Task 4: `MenuRow` in `profile/index.tsx`                                                                   |

### Placeholder scan

No "TBD", "TODO", "similar to Task N", or "add appropriate error handling" entries. Every step shows exact code or exact commands with expected output.

### Type consistency

- `PremiumStatusResponse = z.infer<typeof premiumStatusSchema>` — defined in Task 1, consumed in Task 3.
- `statusLabel(status: PremiumStatusResponse): string` — accepts the same type.
- `fetchOfferings()` returns `Promise<Offerings | null>` (from F8.10 contract); guarded with `?.current?.monthly` before `purchasePackage`.
- `purchasePackage(pkg)` accepts `Parameters<typeof Purchases.purchasePackage>[0]` (from F8.10 contract).
- `WebBrowser.openAuthSessionAsync(url, returnUrl)` — two-arg form; `expo-web-browser` v14+ returns `{ type: 'success' | 'cancel' | 'dismiss' }`.

---

## Deviations / deferrals

1. **`SettingsStack.tsx`**: the brief references `apps/mobile/src/navigation/SettingsStack.tsx`, but the project uses Expo Router (file-based navigation) with no separate stack navigator file. The correct integration point is `apps/mobile/app/(app)/profile/_layout.tsx` (a `Stack` component from `expo-router`) and a new `apps/mobile/app/(app)/profile/premium.tsx` route file. The plan uses the correct project-actual approach.

2. **`.eslintrc.cjs`**: the brief references `.eslintrc.cjs`, but the project uses ESLint flat config (`eslint.config.js`). The plan targets `apps/mobile/eslint.config.js` and a CJS rule file in `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`. The flat-config inline plugin pattern (`plugins: { 'jdm-mobile': { rules: { ... } } }`) is compatible with ESLint v8+ flat config.

3. **`no-stripe-on-ios` `getAncestors()` deprecation**: ESLint v9 deprecated `context.getAncestors()` in favor of accessing ancestors via the `node` argument to `Literal`. If the ESLint version in use is v9+, replace `context.getAncestors ? context.getAncestors() : []` with the `SourceCode`-based approach. The rule as written includes a defensive fallback; if tests show the ancestor array is always empty, switch to `context.sourceCode.getAncestors(node)`.

4. **Android Stripe / Play billing policy risk**: spec §11 notes that the Android WebBrowser → Stripe path may violate Google Play billing policy. This chunk implements the path as specced; if Play rejects it, chunk F8.20 (out of v1 scope) pivots Android to Google Play Billing via RC.

5. **Monthly vs annual offering selection**: `onSubscribeIos` picks `offerings?.current?.monthly`. In v1 the screen does not offer a cadence toggle — monthly is the entry point. Annual is accessible via App Store subscription management. A cadence picker can be added in a later polish chunk without touching the test contract.

6. **Polling after RC purchase**: after `purchasePackage` succeeds, the screen waits 2 seconds then reloads `/api/me/premium/status`. This is consistent with spec §8.1 ("client polls"). A `Purchases.addCustomerInfoUpdateListener` approach (deferred per F8.10 deviation #3) would be cleaner but is out of this chunk's scope.

---

## PR checklist

- [ ] Branch is `feat/jdma-f8-billing-18`, created from a fresh `main` (CLAUDE.md preflight).
- [ ] 11 files touched (matches §"Touched-path summary").
- [ ] No edits outside the 11 touched paths.
- [ ] `pnpm --filter @jdm/mobile exec vitest run src/screens/settings/__tests__/PremiumScreen.test.tsx src/screens/settings/__tests__/ios-stripe-isolation.test.ts` — 16+ passing.
- [ ] `pnpm --filter @jdm/mobile typecheck` — 0 errors.
- [ ] `apps/mobile/src/ eslint` passes with 0 `jdm-mobile/no-stripe-on-ios` errors.
- [ ] Feature flag disabled → maintenance banner visible, no API call (test: "shows maintenance banner when premiumBillingEnabled is false").
- [ ] iOS CTA → `purchasePackage` called; Android CTA → `WebBrowser.openAuthSessionAsync` called (confirmed by Platform.OS tests).
- [ ] CTA hidden when `active === true` and `cancelAtPeriodEnd === false`.
- [ ] Manage link present when `cancelAtPeriodEnd === true` and `manageUrl` is set.
- [ ] `no-stripe-on-ios` rule fires on bad fixture, silent on guarded fixture.
- [ ] App Review note appended to `docs/eas-credentials.md`.
- [ ] `Co-Authored-By` trailer in every commit.
- [ ] No `--no-verify`, no `--no-gpg-sign`.
- [ ] PR opened against `main`, never `production`.
- [ ] PR body cites: skeleton §F8.18, canon §F8.11, §F8.14, §F8.16, spec §8.1, §11. Notes deviations: Expo Router (no SettingsStack), flat-config ESLint.
