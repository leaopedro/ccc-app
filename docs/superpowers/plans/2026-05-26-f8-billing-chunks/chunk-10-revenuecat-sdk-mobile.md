# F8.10 — RevenueCat SDK Mobile Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `react-native-purchases` into `apps/mobile` as a thin iOS-only library module (`src/lib/revenuecat.ts`) that initialises the RevenueCat SDK using `garageId` as `appUserID`, exposes helpers for fetching offerings and triggering a purchase, and is a strict no-op on all non-iOS platforms. Chunk F8.18 (PremiumScreen) consumes this module; F8.10 owns the library only.

**Architecture:** A single `apps/mobile/src/lib/revenuecat.ts` file exports three functions (`initRevenueCat`, `fetchOfferings`, `purchasePackage`). Every function opens with a `Platform.OS === 'ios'` guard (canon §F8.16); the Android/web branch either returns `null` or throws `Error('not_ios')` depending on what the consumer needs. `initRevenueCat` calls `Purchases.configure({ apiKey: EXPO_PUBLIC_RC_IOS_API_KEY, appUserID: garageId })` — the `appUserID = garageId` mapping is canon because the RC webhook resolver in F8.05 reads `app_user_id` to resolve the garage (spec §3.4, skeleton §F8.10). The API key is surfaced as `EXPO_PUBLIC_RC_IOS_API_KEY` inside the existing `extra` block in `app.config.ts` (matching how `stripePublishableKey` and `sentryDsn` are read via `Constants.expoConfig?.extra`). Tests run in vitest with `react-native-purchases` mocked; no Testcontainers, no DB.

**Tech Stack:** `react-native-purchases@10.1.2`, Expo RN (`apps/mobile`), vitest + jsdom (existing mobile test harness), `expo-constants` (existing dep, used to read `extra`), `react-native` Platform API.

---

## Required reading (before first edit)

1. `/Users/pedro/Projects/jdm-experience/CLAUDE.md` — branch preflight.
2. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §"F8.10" + canon §F8.14, §F8.16.
3. `/Users/pedro/Projects/jdm-experience/docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §8.1 (mobile flow), §11 (Apple isolation risk), §3.4 (`app_user_id` RC mapping).
4. `apps/mobile/app.config.ts` — the `extra` block pattern (`apiBaseUrl`, `stripePublishableKey`, `sentryDsn`). This chunk adds `rcIosApiKey` following the same shape.
5. `apps/mobile/package.json` — existing `dependencies` / `devDependencies` to confirm no prior RC entry and to choose the correct insertion alphabetical position.
6. `apps/mobile/src/lib/sentry.ts` — existing `initSentry` pattern (reads from `Constants.expoConfig?.extra`); `initRevenueCat` follows the same shape.
7. `apps/mobile/src/lib/__tests__/capacity-display.test.ts` — existing lib test style (vitest, `describe`/`it`/`expect`; no RN shim needed for pure helpers).

---

## Locked invariants (do NOT relax)

- Every exported function MUST gate on `Platform.OS === 'ios'` as its first statement. Android + web return `null` (for `fetchOfferings`) or throw `Error('not_ios')` (for `purchasePackage`); `initRevenueCat` returns `void` silently. No RC import is called on non-iOS platforms.
- `appUserID` MUST equal `garageId`. This is the canonical mapping between the mobile user and the RC subscriber record that the webhook resolver (`normalize-revenuecat.ts`, chunk F8.05) relies on.
- The API key MUST be read from `Constants.expoConfig?.extra?.rcIosApiKey` (typed via a local `Extra` type), not from `process.env` directly at runtime. `app.config.ts` populates `extra.rcIosApiKey` from `process.env.EXPO_PUBLIC_RC_IOS_API_KEY`.
- `react-native-purchases` MUST be added to `apps/mobile/package.json` AND the lock file updated in the same commit (canon §F8.14). The version pinned is `^10.1.2` (latest stable as of 2026-05-26 per npm registry).
- This chunk does NOT write any screen code. `PremiumScreen` is F8.18's responsibility.
- Tests run via `pnpm --filter @jdm/mobile exec vitest run src/lib/revenuecat.test.tsx` (canon §F8.12). Never run the full suite locally.
- Do NOT reference Stripe URLs, `STRIPE_PUBLISHABLE_KEY`, or `checkout.stripe.com` anywhere in `apps/mobile/src/` (canon §F8.16).

---

## File structure

### New files

- `apps/mobile/src/lib/revenuecat.ts` — library module: `initRevenueCat`, `fetchOfferings`, `purchasePackage` with iOS guard.
- `apps/mobile/src/lib/revenuecat.test.tsx` — vitest unit tests; mocks `react-native-purchases` and `react-native` Platform.

### Modified files

- `apps/mobile/package.json` — add `"react-native-purchases": "^10.1.2"` to `dependencies`.
- `apps/mobile/app.config.ts` — add `rcIosApiKey: process.env.EXPO_PUBLIC_RC_IOS_API_KEY` to the `extra` block.

### Files NOT touched

- `pnpm-lock.yaml` — updated automatically by `pnpm install`; committed together with `package.json` per canon §F8.14.
- Any screen file — F8.18 owns those.

### Touched-path summary

```
apps/mobile/package.json                              (modify — add react-native-purchases dep)
apps/mobile/app.config.ts                             (modify — add rcIosApiKey to extra block)
apps/mobile/src/lib/revenuecat.ts                     (new — SDK init + offerings + purchase helpers)
apps/mobile/src/lib/revenuecat.test.tsx               (new — vitest unit tests with mocked SDK)
pnpm-lock.yaml                                        (updated via pnpm install; committed with package.json)
```

---

## Code shape (canonical for this chunk)

### `apps/mobile/src/lib/revenuecat.ts` (new)

```ts
// F8.10 — RevenueCat SDK wrapper (iOS-only per canon §F8.16).
//
// appUserID = garageId is canonical: the RC webhook normalizer (F8.05)
// reads app_user_id from the RC payload and resolves it as garageId.
// Do NOT use userId or any other identifier here.
//
// All functions guard on Platform.OS === 'ios' as their first statement.
// Android / web paths NEVER call into the Purchases SDK.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  type PurchasesOfferings,
  type MakePurchaseResult,
} from 'react-native-purchases';

type Extra = { rcIosApiKey?: string };

const rcIosApiKey = (): string | undefined =>
  (Constants.expoConfig?.extra as Extra | undefined)?.rcIosApiKey;

// Initialise the RevenueCat SDK.
// Call once at app startup (e.g. from _layout.tsx), passing the authenticated
// garage's ID as appUserID so the RC backend ties purchases to garages.
// No-op silently on Android / web — do NOT throw; callers run unconditionally.
export const initRevenueCat = (garageId: string): void => {
  if (Platform.OS !== 'ios') return;
  const apiKey = rcIosApiKey();
  if (!apiKey) {
    console.warn('[revenuecat] EXPO_PUBLIC_RC_IOS_API_KEY not set; RC init skipped');
    return;
  }
  Purchases.configure({ apiKey, appUserID: garageId });
};

// Fetch the current RC Offerings (product catalogue).
// Returns null on Android / web — callers must guard.
export const fetchOfferings = async (): Promise<PurchasesOfferings | null> => {
  if (Platform.OS !== 'ios') return null;
  return Purchases.getOfferings();
};

// Trigger a StoreKit purchase for the given RC Package.
// Throws Error('not_ios') on Android / web — callers must guard.
// On iOS, throws whatever rc-native throws on failure (caller handles).
export const purchasePackage = async (
  pkg: Parameters<typeof Purchases.purchasePackage>[0],
): Promise<MakePurchaseResult> => {
  if (Platform.OS !== 'ios') throw new Error('not_ios');
  return Purchases.purchasePackage(pkg);
};
```

### `apps/mobile/src/lib/revenuecat.test.tsx` (new)

```tsx
// F8.10 — unit tests for the RC library wrapper.
//
// Strategy: mock react-native-purchases entirely; mock react-native's
// Platform.OS to test iOS vs Android branches.
// No DB, no Testcontainers — mobile tests run in vitest/jsdom.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks (must be before any import of the module under test) ----------

const mockConfigure = vi.fn();
const mockGetOfferings = vi.fn();
const mockPurchasePackage = vi.fn();

vi.mock('react-native-purchases', () => ({
  default: {
    configure: mockConfigure,
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
  },
}));

// expo-constants mock: expose rcIosApiKey so init path can read it
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { rcIosApiKey: 'appl_test_key_123' },
    },
  },
}));

// react-native Platform mock — mutable so tests can flip OS
const platformMock = { OS: 'ios' as 'ios' | 'android' | 'web' };

vi.mock('react-native', () => ({
  Platform: platformMock,
}));

// ---------- import module under test (AFTER mocks are registered) ----------

import { fetchOfferings, initRevenueCat, purchasePackage } from '../revenuecat';

// ---------- tests ----------

describe('initRevenueCat', () => {
  beforeEach(() => {
    platformMock.OS = 'ios';
    mockConfigure.mockReset();
  });

  it('calls Purchases.configure exactly once on iOS with correct args', () => {
    initRevenueCat('garage_abc123');
    expect(mockConfigure).toHaveBeenCalledOnce();
    expect(mockConfigure).toHaveBeenCalledWith({
      apiKey: 'appl_test_key_123',
      appUserID: 'garage_abc123',
    });
  });

  it('passes appUserID equal to the garageId argument (canon F8.10 mapping)', () => {
    const garageId = 'garage_xyz_canonical';
    initRevenueCat(garageId);
    const call = mockConfigure.mock.calls[0][0] as { appUserID: string };
    expect(call.appUserID).toBe(garageId);
  });

  it('does NOT call Purchases.configure on Android', () => {
    platformMock.OS = 'android';
    initRevenueCat('garage_abc123');
    expect(mockConfigure).not.toHaveBeenCalled();
  });

  it('does NOT call Purchases.configure on web', () => {
    platformMock.OS = 'web';
    initRevenueCat('garage_abc123');
    expect(mockConfigure).not.toHaveBeenCalled();
  });
});

describe('fetchOfferings', () => {
  beforeEach(() => {
    platformMock.OS = 'ios';
    mockGetOfferings.mockReset();
  });

  it('calls Purchases.getOfferings and returns its result on iOS', async () => {
    const fakeOfferings = { current: { identifier: 'default' } };
    mockGetOfferings.mockResolvedValueOnce(fakeOfferings);
    const result = await fetchOfferings();
    expect(mockGetOfferings).toHaveBeenCalledOnce();
    expect(result).toBe(fakeOfferings);
  });

  it('returns null on Android without calling Purchases.getOfferings', async () => {
    platformMock.OS = 'android';
    const result = await fetchOfferings();
    expect(result).toBeNull();
    expect(mockGetOfferings).not.toHaveBeenCalled();
  });

  it('returns null on web without calling Purchases.getOfferings', async () => {
    platformMock.OS = 'web';
    const result = await fetchOfferings();
    expect(result).toBeNull();
    expect(mockGetOfferings).not.toHaveBeenCalled();
  });
});

describe('purchasePackage', () => {
  const fakePackage = { identifier: '$rc_monthly' } as Parameters<typeof purchasePackage>[0];

  beforeEach(() => {
    platformMock.OS = 'ios';
    mockPurchasePackage.mockReset();
  });

  it('calls Purchases.purchasePackage and returns PurchaseResult on iOS', async () => {
    const fakePurchaseResult = { transaction: { transactionIdentifier: 'txn_1' } };
    mockPurchasePackage.mockResolvedValueOnce(fakePurchaseResult);
    const result = await purchasePackage(fakePackage);
    expect(mockPurchasePackage).toHaveBeenCalledOnce();
    expect(mockPurchasePackage).toHaveBeenCalledWith(fakePackage);
    expect(result).toBe(fakePurchaseResult);
  });

  it('throws Error("not_ios") on Android without calling Purchases.purchasePackage', async () => {
    platformMock.OS = 'android';
    await expect(purchasePackage(fakePackage)).rejects.toThrow('not_ios');
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });

  it('throws Error("not_ios") on web without calling Purchases.purchasePackage', async () => {
    platformMock.OS = 'web';
    await expect(purchasePackage(fakePackage)).rejects.toThrow('not_ios');
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });
});
```

### `apps/mobile/app.config.ts` extra block delta

```ts
// existing extra block, add one line:
extra: {
  variant,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000',
  r2PublicBaseUrl: process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL || '',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  stripeMerchantIdentifier,
  // RevenueCat iOS API key — populated at build time via .env.local or EAS secret.
  // Only consumed on iOS; Android bundle never reads this value.
  rcIosApiKey: process.env.EXPO_PUBLIC_RC_IOS_API_KEY,
  eas: { projectId: easProjectId },
},
```

### `apps/mobile/package.json` delta

Add to `dependencies` (alphabetically between `react-native-qrcode-svg` and `react-native-safe-area-context`):

```json
"react-native-purchases": "^10.1.2",
```

**Version rationale:** `10.1.2` is the latest stable release on npm as of 2026-05-26. The `^` range follows the existing dep pattern in this file (`^0.50.3` for `@stripe/stripe-react-native`, etc.) and allows compatible patch updates without a plan revision.

---

## Branch preflight (run before first edit)

- [ ] **Step 0: confirm fresh `main` branch**

```bash
git branch --show-current
# Expect: main (NOT production — if production, STOP per CLAUDE.md)
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-10
```

Expected: clean branch off `main`, no merge conflicts.

---

## Task 1 — Add `react-native-purchases` dep + RC API key env entry

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts`
- Updated by install: `pnpm-lock.yaml`

- [ ] **Step 1: write the failing type-check (proves dep is missing)**

```bash
# Before the edit, confirm the dep doesn't exist yet
grep -n "react-native-purchases" /Users/pedro/Projects/jdm-experience/apps/mobile/package.json
# Expected: no output (package not present)
```

- [ ] **Step 2: add `react-native-purchases` to `package.json`**

In `apps/mobile/package.json`, in the `dependencies` object, add between `react-native-qrcode-svg` and `react-native-safe-area-context`:

```json
"react-native-purchases": "^10.1.2",
```

- [ ] **Step 3: add `rcIosApiKey` to `app.config.ts`**

In `apps/mobile/app.config.ts`, inside the `extra: { ... }` block (around line 124), add after `stripeMerchantIdentifier`:

```ts
  // RevenueCat iOS API key — populated at build time via .env.local or EAS secret.
  // Only consumed on iOS; Android bundle never reads this value.
  rcIosApiKey: process.env.EXPO_PUBLIC_RC_IOS_API_KEY,
```

- [ ] **Step 4: install the new dep + update lock file**

```bash
pnpm install --filter @jdm/mobile
# Expected: react-native-purchases@10.x.x installed; pnpm-lock.yaml updated
```

- [ ] **Step 5: verify lock file was updated**

```bash
grep "react-native-purchases" /Users/pedro/Projects/jdm-experience/pnpm-lock.yaml | head -3
# Expected: entry present with version 10.1.x
```

- [ ] **Step 6: commit (package.json + lock file together per canon §F8.14)**

```bash
git add apps/mobile/package.json apps/mobile/app.config.ts pnpm-lock.yaml
git commit -m "feat(mobile): add react-native-purchases@10.1.2 dep + RC iOS API key env entry (F8.10)"
```

---

## Task 2 — Write failing tests for `revenuecat.ts`

**Files:**

- Create: `apps/mobile/src/lib/revenuecat.test.tsx`

- [ ] **Step 1: create the test file**

Create `apps/mobile/src/lib/revenuecat.test.tsx` with the full content from §"Code shape" above (the complete `revenuecat.test.tsx` block).

- [ ] **Step 2: run the tests — expect FAIL**

```bash
pnpm --filter @jdm/mobile exec vitest run src/lib/revenuecat.test.tsx
# Expected: FAIL — "Cannot find module '../revenuecat'"
```

---

## Task 3 — Implement `revenuecat.ts`

**Files:**

- Create: `apps/mobile/src/lib/revenuecat.ts`

- [ ] **Step 1: create the implementation file**

Create `apps/mobile/src/lib/revenuecat.ts` with the full content from §"Code shape" above (the complete `revenuecat.ts` block with all three exported functions).

- [ ] **Step 2: run the tests — expect PASS**

```bash
pnpm --filter @jdm/mobile exec vitest run src/lib/revenuecat.test.tsx
# Expected: 10 passing (4 initRevenueCat + 3 fetchOfferings + 3 purchasePackage)
```

If any test fails, diagnose before moving on. Common failure modes:

- `Platform.OS` mock not applied: check that the mock is registered BEFORE the module import (vitest hoists `vi.mock` calls, so the declaration order in the file is correct as written).
- `Purchases.configure` not found on the default export: verify the `vi.mock('react-native-purchases', ...)` factory returns `{ default: { configure: mockConfigure, ... } }`.

- [ ] **Step 3: typecheck the mobile workspace**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
# If 'react-native-purchases' types are not found: ensure the dep was installed
# in Task 1. The package ships its own type declarations; no @types/* needed.
```

- [ ] **Step 4: commit**

```bash
git add apps/mobile/src/lib/revenuecat.ts apps/mobile/src/lib/revenuecat.test.tsx
git commit -m "feat(mobile): revenuecat.ts iOS-only SDK wrapper + tests — initRevenueCat/fetchOfferings/purchasePackage (F8.10)"
```

---

## Verification (final)

- [ ] **A. Run the touched test file**

```bash
pnpm --filter @jdm/mobile exec vitest run src/lib/revenuecat.test.tsx
# Expected: 10 passing, 0 failing.
```

- [ ] **B. Typecheck the mobile workspace**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **C. Confirm no full suite run** — per memory rule "Never run full test suite locally"; touched files only; CI runs the sweep on PR push.

- [ ] **D. Confirm iOS isolation (no Stripe leak)**

```bash
grep -rn "stripe" /Users/pedro/Projects/jdm-experience/apps/mobile/src/lib/revenuecat.ts
# Expected: no output — zero Stripe references in this file (canon §F8.16).
```

> Do NOT run `pnpm migrate`, `pnpm build --all`, or `pnpm test` (full suite). CI handles those.

---

## Self-review

### Spec coverage

| Spec requirement                                  | Task that covers it                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| §8.1 — iOS uses RC SDK                            | Task 3: `initRevenueCat` calls `Purchases.configure` on `Platform.OS === 'ios'`                    |
| §8.1 — Android is no-op                           | Task 3: all three functions return null / throw `not_ios` on Android; Task 2: Android branch tests |
| §3.4 — `app_user_id = garageId`                   | Task 3: `appUserID: garageId`; Task 2: explicit assertion `call.appUserID === garageId`            |
| §11 — iOS bundle isolation (Apple rejection risk) | Task 3 + Task 1: no Stripe references in `revenuecat.ts`; final verification step D confirms       |
| Canon §F8.14 — dep + lock in same commit          | Task 1 step 6: `git add package.json app.config.ts pnpm-lock.yaml` in one commit                   |
| Canon §F8.16 — iOS-only guard                     | Task 3: every function opens with `if (Platform.OS !== 'ios')` guard                               |
| Env var pattern (app.config.ts extra block)       | Task 1 step 3: `rcIosApiKey` follows existing `stripePublishableKey`/`sentryDsn` pattern           |
| Skeleton note — chunk is library-only, no screen  | Confirmed: no screen files touched; F8.18 owns `PremiumScreen`                                     |

### Placeholder scan

No "TBD", "TODO", "add appropriate error handling", or "similar to Task N" entries. All steps contain exact file content or exact commands with expected output.

### Type consistency

- `initRevenueCat(garageId: string): void` — returned type is `void`; test checks side-effect (configure call), not return value.
- `fetchOfferings(): Promise<PurchasesOfferings | null>` — `PurchasesOfferings` is from `react-native-purchases`; `null` on non-iOS.
- `purchasePackage(pkg): Promise<MakePurchaseResult>` — `MakePurchaseResult` from `react-native-purchases`; throws `Error('not_ios')` on non-iOS.
- The `pkg` parameter type `Parameters<typeof Purchases.purchasePackage>[0]` forwards the exact SDK type without duplication.
- `Extra` type in `revenuecat.ts` (`{ rcIosApiKey?: string }`) matches the field added to `app.config.ts`.

---

## Deviations / deferrals

1. **`react-native-purchases-ui`** (RC paywall UI SDK): the skeleton brief notes "or `react-native-purchases-ui` if RC ships paywall UI v1". As of 2026-05-26, `react-native-purchases-ui` is a separate optional peer. F8.10 ships the base SDK only (`react-native-purchases`). If F8.18 decides to use the paywall UI component, it adds `react-native-purchases-ui` in its own chunk — F8.10's library module is unchanged.

2. **`rcIosApiKey` fallback vs `??`**: `app.config.ts` uses `||` (not `??`) for vars that must never be empty strings (per the existing `apiBaseUrl` comment). For `EXPO_PUBLIC_RC_IOS_API_KEY`, an empty string is indistinguishable from unset at runtime, so `process.env.EXPO_PUBLIC_RC_IOS_API_KEY` (no fallback) is correct. The library itself already handles the `undefined` case with a `console.warn` + early return in `initRevenueCat`.

3. **`Purchases.addCustomerInfoUpdateListener`** (real-time entitlement updates): out of scope for F8.10. The skeleton brief says F8.18 handles the "client polls `/api/me/premium/status`" path. A listener could replace polling in a later chunk; F8.10 does not introduce it.

4. **EAS secret vs `.env.local`**: `EXPO_PUBLIC_RC_IOS_API_KEY` is read at build time by Expo Metro bundler (all `EXPO_PUBLIC_*` vars are inlined). Production value must be added as an EAS secret before the first production build; local dev can use `.env.local`. This is an ops concern, not a code concern. Document in `docs/revenuecat.md` (F8.19 chunk).

---

## PR checklist

- [ ] Branch is `feat/jdma-f8-billing-10`, created from a fresh `main` (CLAUDE.md preflight).
- [ ] Four files changed + lock file: `package.json`, `app.config.ts`, `revenuecat.ts`, `revenuecat.test.tsx`, `pnpm-lock.yaml`.
- [ ] No edits outside the five touched paths.
- [ ] `pnpm --filter @jdm/mobile exec vitest run src/lib/revenuecat.test.tsx` — 10 passing.
- [ ] `pnpm --filter @jdm/mobile typecheck` — 0 errors.
- [ ] `react-native-purchases` present in both `package.json` and `pnpm-lock.yaml` in the same commit (canon §F8.14).
- [ ] Every function in `revenuecat.ts` guards on `Platform.OS !== 'ios'` as first statement (canon §F8.16).
- [ ] `appUserID: garageId` — verified in test `'passes appUserID equal to the garageId argument'`.
- [ ] Zero Stripe references in `revenuecat.ts` — verified by step D of final verification.
- [ ] No screen code written (F8.18 owns `PremiumScreen`).
- [ ] `Co-Authored-By` trailer included in every commit.
- [ ] No `--no-verify`, no `--no-gpg-sign`.
- [ ] PR opened against `main`, never `production`.
- [ ] PR body cites: skeleton §F8.10, canon §F8.14, §F8.16, spec §8.1, §3.4, §11. Notes the F8.18 consumer dependency.
