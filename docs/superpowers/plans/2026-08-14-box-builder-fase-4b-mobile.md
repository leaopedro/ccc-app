# Box Builder — Fase 4b Mobile (Fulfillment Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live 3-step fulfillment timeline (Preparando / Enviado / Entregue) on the Caixa home `ready` state, driven by the box's `fulfillmentStatus`.

**Architecture:** A pure helper `boxTimelineSteps(fulfillmentStatus)` in `box-state.ts` maps the box fulfillment status to three `{ label, state }` steps (labels pulled from `caixaCopy`, mirroring the existing `boxStatusLabel` pattern). A thin presentational `FulfillmentTimeline` component renders those steps and is dropped into both ready-variant bodies (`ReadyBody` and `PostCutoffBody`) of the Caixa home screen. All timeline logic lives in the pure helper and is unit-tested with Vitest; the component stays render-test-free per the caixa convention.

**Tech Stack:** React Native (Expo), TypeScript, Zod (via `@ccc/shared`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-box-builder-fase-4b-fulfillment-design.md` (section 4 is the mobile scope; sections 2 and the interface contract are normative for consumed types).

## Global Constraints

- **PT-BR copy WITH accents.** Timeline labels are exactly `Preparando` / `Enviado` / `Entregue`.
- **Feature stays behind `EXPO_PUBLIC_CAIXA_ENABLED`, default OFF.** The whole caixa build is already gated by `isCaixaBuildEnabled()` (`apps/mobile/src/screens/caixa/caixa-enabled.ts`) at the navigation slot. The timeline renders only inside the `ready` variant of the Caixa home, which is already behind that gate. Do NOT add any new always-on entry point.
- **No RN render tests for caixa screens/components.** Logic lives in pure `.ts` helpers tested with Vitest. `FulfillmentTimeline.tsx` gets no render test; its verification is typecheck + lint + the green helper suite.
- **Consumed from the API/shared plan (already produced on this branch — treat as given, do NOT plan it):** `packages/shared/src/box.ts` exports:
  ```ts
  export const boxFulfillmentStatusSchema = z.enum([
    'unfulfilled',
    'packed',
    'shipped',
    'delivered',
    'cancelled',
  ]);
  export type BoxFulfillmentStatus = z.infer<typeof boxFulfillmentStatusSchema>;
  // boxViewSchema gains: fulfillmentStatus: boxFulfillmentStatusSchema
  ```
  Because `BoxView` is inferred from `boxViewSchema` and the mobile client (`apps/mobile/src/api/box.ts`) parses responses with that same schema, `box.fulfillmentStatus` flows through to the screen automatically. The client requires **no code change** — this satisfies the spec's "client reads the new `fulfillmentStatus`" line. Do not edit `box.ts`.
- **Do not touch unrelated code.** No refund/cancel, no tracking, no push (all out of scope per spec section 6).

---

### Task 1: `boxTimelineSteps` pure helper + copy

**Files:**

- Modify: `apps/mobile/src/copy/caixa.ts` (add `ready.timeline`; remove the unused `actions.trackDelivery` line)
- Modify: `apps/mobile/src/screens/caixa/box-state.ts` (add `TimelineStep`, `TimelineStepState`, `boxTimelineSteps`)
- Test: `apps/mobile/src/screens/caixa/box-state.test.ts` (add `boxTimelineSteps` describe block)

**Interfaces:**

- Consumes (from the API/shared plan, treat as given): `BoxFulfillmentStatus` from `@ccc/shared/box` — the 5-value enum `'unfulfilled' | 'packed' | 'shipped' | 'delivered' | 'cancelled'`.
- Produces (Task 2 relies on these exact names/types):
  ```ts
  export type TimelineStepState = 'done' | 'current' | 'pending';
  export interface TimelineStep {
    label: string;
    state: TimelineStepState;
  }
  export function boxTimelineSteps(
    status: BoxFulfillmentStatus,
  ): [TimelineStep, TimelineStep, TimelineStep];
  ```
  Step order is fixed: index 0 = Preparando, 1 = Enviado, 2 = Entregue.
- Produces copy: `caixaCopy.ready.timeline` = `{ packing: 'Preparando', shipped: 'Enviado', delivered: 'Entregue' }`.

**Mapping (spec section 4, normative):**
| `fulfillmentStatus` | step states `[Preparando, Enviado, Entregue]` |
| --- | --- |
| `unfulfilled` | `[current, pending, pending]` |
| `packed` | `[done, current, pending]` |
| `shipped` | `[done, done, current]` |
| `delivered` | `[done, done, done]` |
| `cancelled` | `[current, pending, pending]` (defensive; see ambiguity note) |

**Ambiguity resolved:** The spec (line 21) states a cancelled box has `status = 'cancelled'` and never reaches the `ready` screen, so `fulfillmentStatus = 'cancelled'` is unreachable here. But the parameter type includes it, and the function must stay total without throwing. Resolution: map `cancelled` defensively to the `unfulfilled` shape (`[current, pending, pending]`). This keeps the function total and never renders a "cancelled" state, matching the spec's "timeline nao mostra cancelado."

- [ ] **Step 1: Add the copy**

In `apps/mobile/src/copy/caixa.ts`, change the `ready` entry from:

```ts
  ready: { banner: 'Caixa confirmada' },
```

to:

```ts
  ready: {
    banner: 'Caixa confirmada',
    timeline: { packing: 'Preparando', shipped: 'Enviado', delivered: 'Entregue' },
  },
```

In the same file, remove the now-unused CTA line from `actions` (it is not rendered anywhere — grep confirms only this definition exists). Delete:

```ts
    trackDelivery: 'Acompanhar entrega',
```

- [ ] **Step 2: Write the failing test**

Append to `apps/mobile/src/screens/caixa/box-state.test.ts`. Add `boxTimelineSteps` to the existing import from `./box-state`, then add:

```ts
describe('boxTimelineSteps', () => {
  it('labels the three steps in PT-BR with accents', () => {
    const [preparando, enviado, entregue] = boxTimelineSteps('unfulfilled');
    expect(preparando.label).toBe('Preparando');
    expect(enviado.label).toBe('Enviado');
    expect(entregue.label).toBe('Entregue');
  });

  it('maps unfulfilled to current/pending/pending', () => {
    expect(boxTimelineSteps('unfulfilled').map((s) => s.state)).toEqual([
      'current',
      'pending',
      'pending',
    ]);
  });

  it('maps packed to done/current/pending', () => {
    expect(boxTimelineSteps('packed').map((s) => s.state)).toEqual(['done', 'current', 'pending']);
  });

  it('maps shipped to done/done/current', () => {
    expect(boxTimelineSteps('shipped').map((s) => s.state)).toEqual(['done', 'done', 'current']);
  });

  it('maps delivered to all done', () => {
    expect(boxTimelineSteps('delivered').map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });

  it('maps cancelled defensively to the unfulfilled shape', () => {
    expect(boxTimelineSteps('cancelled').map((s) => s.state)).toEqual([
      'current',
      'pending',
      'pending',
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/box-state.test.ts`
Expected: FAIL — `boxTimelineSteps is not a function` / not exported.

- [ ] **Step 4: Write minimal implementation**

In `apps/mobile/src/screens/caixa/box-state.ts`, add the `BoxFulfillmentStatus` type to the existing `@ccc/shared/box` import:

```ts
import type { BoxFulfillmentStatus, BoxStatus, BoxView } from '@ccc/shared/box';
```

Then append at the end of the file:

```ts
export type TimelineStepState = 'done' | 'current' | 'pending';

export interface TimelineStep {
  label: string;
  state: TimelineStepState;
}

// Ship-only, 3 marcos (spec 4). Labels live in caixaCopy so this stays a pure
// lookup, mirroring boxStatusLabel. `cancelled` is unreachable on the ready
// screen (a cancelled box has status='cancelled'); mapped to the unfulfilled
// shape defensively so the function stays total and never shows "cancelled".
export function boxTimelineSteps(
  status: BoxFulfillmentStatus,
): [TimelineStep, TimelineStep, TimelineStep] {
  const { packing, shipped, delivered } = caixaCopy.ready.timeline;
  const states: Record<
    BoxFulfillmentStatus,
    [TimelineStepState, TimelineStepState, TimelineStepState]
  > = {
    unfulfilled: ['current', 'pending', 'pending'],
    packed: ['done', 'current', 'pending'],
    shipped: ['done', 'done', 'current'],
    delivered: ['done', 'done', 'done'],
    cancelled: ['current', 'pending', 'pending'],
  };
  const [s0, s1, s2] = states[status];
  return [
    { label: packing, state: s0 },
    { label: shipped, state: s1 },
    { label: delivered, state: s2 },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/box-state.test.ts`
Expected: PASS (all `boxTimelineSteps` cases plus the existing suite).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS. (Confirms the consumed `BoxFulfillmentStatus`/`boxViewSchema.fulfillmentStatus` types from the shared plan are present. If typecheck fails on a missing `BoxFulfillmentStatus` export, the shared/API plan has not landed on this branch yet — stop and confirm the dependency.)

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/copy/caixa.ts apps/mobile/src/screens/caixa/box-state.ts apps/mobile/src/screens/caixa/box-state.test.ts
git commit -m "feat(mobile): boxTimelineSteps helper + timeline copy"
```

---

### Task 2: `FulfillmentTimeline` component wired into the ready variant

**Files:**

- Create: `apps/mobile/src/screens/caixa/FulfillmentTimeline.tsx`
- Modify: `apps/mobile/app/(app)/caixa/index.tsx` (import + render in `ReadyBody` and `PostCutoffBody`)

**Interfaces:**

- Consumes (from Task 1): `boxTimelineSteps`, `TimelineStep`, `TimelineStepState` from `~/screens/caixa/box-state`.
- Consumes (from the API/shared plan): `box.fulfillmentStatus: BoxFulfillmentStatus` on `BoxView`.
- Produces:
  ```ts
  export function FulfillmentTimeline({ status }: { status: BoxFulfillmentStatus }): JSX.Element;
  ```

**No render test** (caixa convention). Verification for this task is typecheck + lint + the still-green Task 1 helper suite.

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/screens/caixa/FulfillmentTimeline.tsx`:

```tsx
// Caixa — fulfillment timeline (Fase 4b). Thin presentational component;
// all mapping logic is in boxTimelineSteps (box-state.ts, unit-tested). No
// tracking, no push — the timeline is inline. See spec section 4.

import type { BoxFulfillmentStatus } from '@ccc/shared/box';
import { Text } from '@ccc/ui';
import { StyleSheet, View } from 'react-native';

import { boxTimelineSteps, type TimelineStepState } from '~/screens/caixa/box-state';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';

function dotStyle(state: TimelineStepState) {
  if (state === 'done') return styles.dotDone;
  if (state === 'current') return styles.dotCurrent;
  return styles.dotPending;
}

export function FulfillmentTimeline({ status }: { status: BoxFulfillmentStatus }) {
  const steps = boxTimelineSteps(status);

  return (
    <View style={styles.row} accessibilityRole="summary">
      {steps.map((step, index) => (
        <View key={step.label} style={styles.step}>
          {index > 0 ? <View style={styles.connector} /> : null}
          <View style={[styles.dot, dotStyle(step.state)]} />
          <Text
            variant="caption"
            tone={step.state === 'pending' ? 'muted' : 'secondary'}
            style={styles.label}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const DOT = 14;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  connector: {
    position: 'absolute',
    top: DOT / 2 - 0.5,
    right: '50%',
    width: '100%',
    height: 1,
    backgroundColor: BORDER_GOLD_SOFT,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  dotDone: {
    backgroundColor: theme.colors.success,
  },
  dotCurrent: {
    backgroundColor: theme.colors.success,
    borderWidth: 3,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  dotPending: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
  },
  label: {
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Import the component in the Caixa home**

In `apps/mobile/app/(app)/caixa/index.tsx`, add the import near the other `~/screens/caixa/*` imports (after the `EmptyState` import, keeping alphabetical-ish grouping):

```tsx
import { FulfillmentTimeline } from '~/screens/caixa/FulfillmentTimeline';
```

- [ ] **Step 3: Render in `ReadyBody`**

In `ReadyBody`, add the timeline after the thumb grid, before the closing fragment. Change the tail of the returned JSX from:

```tsx
      <View style={styles.thumbGrid}>
        {thumbs.map((thumb) =>
          thumb.imageUrl ? (
            <Image
              key={thumb.key}
              source={{ uri: thumb.imageUrl }}
              style={styles.thumb}
              accessible={false}
            />
          ) : (
            <View key={thumb.key} style={[styles.thumb, styles.thumbPlaceholder]} />
          ),
        )}
      </View>
    </>
```

to:

```tsx
      <View style={styles.thumbGrid}>
        {thumbs.map((thumb) =>
          thumb.imageUrl ? (
            <Image
              key={thumb.key}
              source={{ uri: thumb.imageUrl }}
              style={styles.thumb}
              accessible={false}
            />
          ) : (
            <View key={thumb.key} style={[styles.thumb, styles.thumbPlaceholder]} />
          ),
        )}
      </View>
      <FulfillmentTimeline status={box.fulfillmentStatus} />
    </>
```

- [ ] **Step 4: Render in `PostCutoffBody`**

In `PostCutoffBody`, add the timeline directly after the closed-on lock banner block, before the `postCutoff.note` text, so it appears near the top of the confirmed post-cutoff view. Insert immediately after the closing `</View>` of the `styles.lockBanner` block and before:

```tsx
<Text variant="bodySm" tone="secondary">
  {caixaCopy.postCutoff.note}
</Text>
```

so it reads:

```tsx
      <FulfillmentTimeline status={box.fulfillmentStatus} />
      <Text variant="bodySm" tone="secondary">
        {caixaCopy.postCutoff.note}
      </Text>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS. Confirms `box.fulfillmentStatus` is typed on `BoxView` and the component props line up.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS (no unused imports — the `trackDelivery` copy removal from Task 1 leaves no dangling reference).

- [ ] **Step 7: Run the caixa helper suite (regression)**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/box-state.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/screens/caixa/FulfillmentTimeline.tsx "apps/mobile/app/(app)/caixa/index.tsx"
git commit -m "feat(mobile): fulfillment timeline on caixa ready state"
```

---

## Self-Review

**1. Spec coverage (section 4):**

- Pure `boxTimelineSteps(fulfillmentStatus)` in `box-state.ts` returning 3 `{ label, state }` steps with the exact mapping → Task 1. ✓
- `FulfillmentTimeline` rendered in both `ReadyBody` and `PostCutoffBody` → Task 2, Steps 3–4. ✓
- Copy `ready.timeline` = Preparando / Enviado / Entregue with accents → Task 1, Step 1. ✓
- Client reads new `fulfillmentStatus` → flows automatically via `boxViewSchema`/`BoxView`; documented in Global Constraints, verified by typecheck (Task 1 Step 6, Task 2 Step 5). No `box.ts` edit. ✓
- Remove "Acompanhar entrega" CTA → Task 1, Step 1 removes `actions.trackDelivery` (grep confirmed it is defined but never rendered). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks are literal. ✓

**3. Type consistency:** `TimelineStep`, `TimelineStepState`, and `boxTimelineSteps` signatures are identical between Task 1's Produces block, its implementation, and Task 2's consumption. `BoxFulfillmentStatus` is the consumed shared type throughout. Copy keys `packing`/`shipped`/`delivered` match between the copy edit and the helper destructure. ✓
