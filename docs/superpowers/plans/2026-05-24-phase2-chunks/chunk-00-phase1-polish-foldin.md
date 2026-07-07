# Chunk 0 — Phase 1 polish fold-in (TDD plan)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. One PR, six items, all cosmetic / low-blast-radius. Step checkboxes track per-item completion.

**Goal:** Land six non-blocking Phase 1 carry-overs from `.handoffs/orchestrator-state.md` §72 in one PR before they bit-rot. Pure reconciliation against the canon (`.handoffs/design-handoff/design_handoff_garage_redesign/jdma-garage/badges.jsx`); no Phase 2 XP code, no migrations, no API edits. Parallel-with any 2A chunk per skeleton §"Chunk 0".

**Architecture:** Six independent UI/UX edits, one file each + matching unit test. No shared types, no new modules. Tests reuse jsdom-stub patterns in `HexBadge.test.tsx` (mobile) + `web-hex-badge.test.tsx` (admin). No new deps. Stack: RN (mobile) + Next.js 16 (admin) + vitest + jsdom.

---

## Carry-over → item map

| #   | Handoff §72 line                                           | Item | File                                                                |
| --- | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 1a  | "no legendary corner-dot in HexBadge (mobile + web twins)" | A    | `packages/ui/src/{HexBadge.tsx, web/HexBadge.tsx}`                  |
| 1b  | "no category-tabs filter in BadgesSheet"                   | B    | `packages/ui/src/BadgesSheet.tsx` (mobile only — see Deviations §1) |
| 2   | "Phase 1 §C10 in-context return path for buy spot"         | C    | `apps/mobile/src/screens/garage/useBuySpotFlow.ts`                  |
| 3   | "useFocusEffect on killswitch re-enable"                   | D    | `apps/mobile/app/(app)/garage/index.tsx`                            |
| 4+5 | "shared isPending" + "focus trap absent on bypass dialog"  | E    | `apps/admin/src/components/garage-badges-panel.tsx`                 |
| 6   | "BadgeRow overflow chip dashed-border double-spec"         | F    | `packages/ui/src/web/BadgeRow.tsx`                                  |

Items 4 + 5 fold into E (same file).

---

## Item A — HexBadge legendary corner-dot (mobile + web)

**Canon:** `badges.jsx:467–481`. Render only when `earned && rarity === 'legendary' && size !== 'sm'`. Top-right; `4`/`14` offset and `8`/`12` dimensions for md/lg. Background = `rarityColors('legendary').main`. Glow `0 0 8px <brand>` on web; flat on RN (Deviation §2).

**Files:** `packages/ui/src/HexBadge.tsx` + `.../web/HexBadge.tsx` + the two existing test files for those (`apps/mobile/.../HexBadge.test.tsx`, `apps/admin/.../web-hex-badge.test.tsx`).

- [ ] **A1: Failing test (mobile).** Append to `HexBadge.test.tsx`:

```tsx
const dot = () => container.querySelector('[data-testid="hex-legendary-dot"]');
const renderHex = async (props: Record<string, unknown>) => {
  const { HexBadge } = await import('@jdm/ui');
  await renderEl(<HexBadge code="X" {...props} icon="flag" />);
};

it('earned legendary md renders the corner-dot', async () => {
  await renderHex({ variant: 'earned', rarity: 'legendary', size: 'md' });
  expect(dot()).not.toBeNull();
});
it('earned common md does NOT render the corner-dot', async () => {
  await renderHex({ variant: 'earned', rarity: 'common', size: 'md' });
  expect(dot()).toBeNull();
});
it('earned legendary sm suppresses the corner-dot', async () => {
  await renderHex({ variant: 'earned', rarity: 'legendary', size: 'sm' });
  expect(dot()).toBeNull();
});
it('locked legendary does NOT render the corner-dot', async () => {
  await renderHex({ variant: 'locked', rarity: 'legendary', size: 'md' });
  expect(dot()).toBeNull();
});
```

- [ ] **A2: Verify FAIL** — `pnpm --filter @jdm/mobile test -- HexBadge.test.tsx -t "corner-dot"`.

- [ ] **A3: Implement in `packages/ui/src/HexBadge.tsx`.** Inside the `hex` `<View>`, after the glyph `<View>`, append:

```tsx
{
  isEarned && rarity === 'legendary' && size !== 'sm' ? (
    <View
      testID="hex-legendary-dot"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: size === 'lg' ? 14 : 4,
        right: size === 'lg' ? 14 : 4,
        width: size === 'lg' ? 12 : 8,
        height: size === 'lg' ? 12 : 8,
        borderRadius: 999,
        backgroundColor: r.main,
      }}
    />
  ) : null;
}
```

(`r` is already in scope via `const r = rarityColors(rarity)`.)

- [ ] **A4: Verify PASS** — `pnpm --filter @jdm/mobile test -- HexBadge.test.tsx`.

- [ ] **A5: Failing test (web).** Append to `web-hex-badge.test.tsx`:

```tsx
const renderHex = (p: Record<string, unknown>) =>
  renderToStaticMarkup(<HexBadge code="X" icon="flag" {...p} />);

it('earned legendary md renders the corner-dot', () => {
  expect(renderHex({ variant: 'earned', rarity: 'legendary', size: 'md' })).toContain(
    'data-testid="hex-legendary-dot"',
  );
});
it('earned common md does NOT render the corner-dot', () => {
  expect(renderHex({ variant: 'earned', rarity: 'common', size: 'md' })).not.toContain(
    'hex-legendary-dot',
  );
});
it('earned legendary sm suppresses the corner-dot', () => {
  expect(renderHex({ variant: 'earned', rarity: 'legendary', size: 'sm' })).not.toContain(
    'hex-legendary-dot',
  );
});
```

- [ ] **A6: Verify FAIL** — `pnpm --filter @jdm/admin test -- web-hex-badge.test.tsx -t "corner-dot"`.

- [ ] **A7: Implement in `packages/ui/src/web/HexBadge.tsx`.** Inside the inner `<span className="relative inline-block" ...>`, after the glyph `<span>`, append:

```tsx
{
  isEarned && rarity === 'legendary' && size !== 'sm' ? (
    <span
      data-testid="hex-legendary-dot"
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{
        top: size === 'lg' ? 14 : 4,
        right: size === 'lg' ? 14 : 4,
        width: size === 'lg' ? 12 : 8,
        height: size === 'lg' ? 12 : 8,
        backgroundColor: r.main,
        boxShadow: `0 0 8px ${r.main}`,
      }}
    />
  ) : null;
}
```

- [ ] **A8: Verify PASS** — `pnpm --filter @jdm/admin test -- web-hex-badge.test.tsx`.

- [ ] **A9: Commit.** Subject: `feat(ui): HexBadge legendary corner-dot (mobile + web)`. Stage the two `HexBadge.tsx` files + the two test files.

---

## Item B — BadgesSheet category-tabs filter (mobile)

**Canon:** `badges.jsx:670–798`. Five-pill row above the grid: `Todas · Eventos · Carros · Comunidade · JDM`. Active = brand fill; inactive = transparent + border. Tap filters the grid. Current `BadgesSheet.tsx` renders sectioned headers but never filters. **Files:** `packages/ui/src/BadgesSheet.tsx`, `apps/mobile/src/screens/garage/__tests__/BadgesSheet.test.tsx`.

- [ ] **B1: Failing tests.** Append to `BadgesSheet.test.tsx`. Helpers:

```tsx
const renderSheet = async () => {
  const { BadgesSheet } = await import('@jdm/ui');
  await renderEl(
    <BadgesSheet visible onClose={() => {}} data={baseData} onLockedPress={() => {}} />,
  );
};
const clickTab = async (id: string) => {
  await act(async () => {
    (
      container.querySelector(`button[data-testid="badges-tab-${id}"]`) as HTMLButtonElement
    ).click();
    await flush();
  });
};
const tiles = () => container.querySelectorAll('button[aria-label^="Conquista"]');
```

Specs:

```tsx
it('renders 5 category tabs above the grid', async () => {
  await renderSheet();
  const tabs = Array.from(container.querySelectorAll('button[data-testid^="badges-tab-"]'));
  expect(tabs.map((t) => t.getAttribute('data-testid'))).toEqual([
    'badges-tab-all',
    'badges-tab-eventos',
    'badges-tab-carros',
    'badges-tab-comunidade',
    'badges-tab-jdm',
  ]);
});
it('defaults to "all" — every catalog tile rendered', async () => {
  await renderSheet();
  expect(tiles().length).toBe(3);
});
it('tapping Carros narrows grid to carros-only', async () => {
  await renderSheet();
  await clickTab('carros');
  expect(tiles().length).toBe(1);
  expect(tiles()[0]?.getAttribute('aria-label')).toContain('CAR-003');
});
it('tapping Todas clears the filter', async () => {
  await renderSheet();
  await clickTab('carros');
  await clickTab('all');
  expect(tiles().length).toBe(3);
});
```

- [ ] **B2: Verify FAIL** — `pnpm --filter @jdm/mobile test -- BadgesSheet.test.tsx -t "tab"`.

- [ ] **B3: Implement in `packages/ui/src/BadgesSheet.tsx`.** Add `Pressable` to the `react-native` import. Add state + constant near the existing `detailCode`:

```tsx
type TabFilter = 'all' | BadgeCategory;
const TABS: { id: TabFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'carros', label: 'Carros' },
  { id: 'comunidade', label: 'Comunidade' },
  { id: 'jdm', label: 'JDM' },
];
const [tabFilter, setTabFilter] = useState<TabFilter>('all');
```

Insert the tabs row after the summary `<View>` (still inside the grid branch of the `detailEntry` ternary):

```tsx
<View
  style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, marginTop: 12, flexWrap: 'wrap' }}
>
  {TABS.map((t) => {
    const active = tabFilter === t.id;
    return (
      <Pressable
        key={t.id}
        testID={`badges-tab-${t.id}`}
        accessibilityRole="button"
        onPress={() => setTabFilter(t.id)}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
          borderWidth: 1,
          backgroundColor: active ? garageTokens.brand.base : 'transparent',
          borderColor: active ? garageTokens.brand.base : garageTokens.surface.border,
        }}
      >
        <Text style={{ color: active ? '#FFFFFF' : '#C9C9CD', fontSize: 12, fontWeight: '600' }}>
          {t.label}
        </Text>
      </Pressable>
    );
  })}
</View>
```

In the existing `{CATEGORY_ORDER.map((cat) => { ... })}` callback, add at the top:

```tsx
if (tabFilter !== 'all' && tabFilter !== cat) return null;
```

- [ ] **B4: Verify PASS** — `pnpm --filter @jdm/mobile test -- BadgesSheet.test.tsx`.

- [ ] **B5: Commit.** Subject: `feat(ui): BadgesSheet category-tabs filter (mobile)`.

---

## Item C — Buy-spot return-path plumbing (`useBuySpotFlow`, Phase 1 §C10)

`addGarageSpotToCart()` already returns `{ cartId, itemId }` (per `apps/mobile/src/api/garage.ts:55–71`). Hook currently discards it. Polish: thread `itemId` into the `/cart` push so the future cart-success handler has plumbing. Full bounce stays deferred (Deviation §3). **Files:** `useBuySpotFlow.ts`, `__tests__/useBuySpotFlow.test.ts` (new).

- [ ] **C1: Create `useBuySpotFlow.test.ts`.** `@testing-library/react` is NOT in `apps/mobile/package.json` (verified during plan-write — only `react-test-renderer` + manual jsdom). Reuse the same `createRoot` + probe-component pattern as `HexBadge.test.tsx`. No new deps.

```ts
// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const pushMock = vi.fn(), addToCartMock = vi.fn(), refreshMock = vi.fn(), showMessageMock = vi.fn();
vi.mock('expo-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('~/api/garage', () => ({ addGarageSpotToCart: () => addToCartMock() }));
vi.mock('~/cart/context', () => ({ useCart: () => ({ refresh: refreshMock }) }));
vi.mock('~/copy/garage', () => ({ garageCopy: { garage: { buySpotFailed: 'fail' } } }));
vi.mock('~/lib/confirm', () => ({ showMessage: showMessageMock }));
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let container: HTMLDivElement, root: Root;
type HookApi = ReturnType<typeof import('../useBuySpotFlow').useBuySpotFlow>;
const apiRef: { current: HookApi | null } = { current: null };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  [pushMock, addToCartMock, refreshMock, showMessageMock].forEach((m) => m.mockReset());
  apiRef.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

// Probe captures the hook's return value into apiRef — no @testing-library/react.
const mount = async () => {
  const { useBuySpotFlow } = await import('../useBuySpotFlow');
  const Probe = () => { apiRef.current = useBuySpotFlow(); return null; };
  await act(async () => { root.render(<Probe />); });
  return apiRef as { current: HookApi };
};

it('pushes /cart?return=garage&itemId=<id> after a successful cart-add', async () => {
  addToCartMock.mockResolvedValueOnce({ cartId: 'c1', itemId: 'item-9' });
  refreshMock.mockResolvedValueOnce(undefined);
  const api = await mount();
  await act(async () => { await api.current.goCheckout(); await flush(); });
  expect(pushMock).toHaveBeenCalledWith('/cart?return=garage&itemId=item-9');
});

it('skips the push when the sheet is closed mid-flight', async () => {
  addToCartMock.mockResolvedValueOnce({ cartId: 'c1', itemId: 'item-9' });
  refreshMock.mockResolvedValueOnce(undefined);
  const api = await mount();
  await act(async () => {
    api.current.openBuySheet({ purchaseOption: { displayPriceCents: 1000 } } as never);
  });
  const checkout = api.current.goCheckout();
  await act(async () => { api.current.closeBuySheet(); await checkout; await flush(); });
  expect(pushMock).not.toHaveBeenCalled();
});

it('surfaces failure copy when cart-add throws', async () => {
  addToCartMock.mockRejectedValueOnce(new Error('boom'));
  const api = await mount();
  await act(async () => { await api.current.goCheckout(); await flush(); });
  expect(pushMock).not.toHaveBeenCalled();
  expect(showMessageMock).toHaveBeenCalledWith('fail');
});
```

- [ ] **C2: Verify FAIL** — `pnpm --filter @jdm/mobile test -- useBuySpotFlow.test.ts`.

- [ ] **C3: Capture itemId + append query.** Replace `goCheckout` in `useBuySpotFlow.ts`:

```ts
const goCheckout = useCallback(async () => {
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  setSubmitting(true);
  try {
    let cartItem: { cartId: string; itemId: string } | null = null;
    try {
      cartItem = await addGarageSpotToCart();
    } catch {
      showMessage(garageCopy.garage.buySpotFailed);
      return;
    }
    try {
      await refresh();
    } catch {
      /* reconciles on next focus */
    }
    setBuySheet(null);
    if (cancelRef.current) return;
    // Phase 1 §C10 plumbing: future cart-success reads itemId to bounce
    // back to /garage?highlight=<spotId>; v1 cart ignores both keys.
    const url = cartItem
      ? `/cart?return=garage&itemId=${encodeURIComponent(cartItem.itemId)}`
      : '/cart';
    router.push(url as never);
  } finally {
    setSubmitting(false);
    inFlightRef.current = false;
  }
}, [router, refresh]);
```

- [ ] **C4: Verify PASS** — `pnpm --filter @jdm/mobile test -- useBuySpotFlow.test.ts`.

- [ ] **C5: Commit.** Subject: `feat(mobile): thread cart itemId for Phase 1 §C10 buy-spot return plumbing`.

---

## Item D — Refetch badges on focus when killswitch flips

`garage/index.tsx:98–110` runs the badges fetch from a separate `useEffect` keyed `[gamificationEnabled, garageId]`. When an admin flips the killswitch mid-session, `useFocusEffect` re-fetches `getGarage()` and the second effect re-fires only on a later render — racy. Polish: fold the badges fetch into the same `useFocusEffect`. **Files:** `apps/mobile/app/(app)/garage/index.tsx`, `__tests__/GarageIndexRoute.test.tsx`.

- [ ] **D1: Failing test.** The current `GarageIndexRoute.test.tsx` mocks `expo-router`'s `useFocusEffect` as a one-shot `useEffect` (verify exact mock + symbol names — `apiState.getGarage` / `apiState.getMyBadges` / `baseGaragePayload` / `mountRoute` — against the file before pasting). Since the mocked effect doesn't re-fire on re-focus, the test simulates a second focus by unmounting + remounting with the second `getGarage` payload queued. Append:

```tsx
it('refetches badges on re-focus when killswitch flipped on', async () => {
  const off = {
    ...baseGaragePayload,
    garage: { ...baseGaragePayload.garage, gamification: { enabled: false } },
  };
  const on = {
    ...baseGaragePayload,
    garage: { ...baseGaragePayload.garage, gamification: { enabled: true } },
  };
  apiState.getGarage.mockResolvedValueOnce(off).mockResolvedValueOnce(on);
  apiState.getMyBadges.mockResolvedValue({ enabled: true, catalog: [], badges: [] });

  // First focus: killswitch off → no badges fetch.
  const first = await mountRoute();
  await first.flush();
  expect(apiState.getMyBadges).not.toHaveBeenCalled();
  await first.unmount();

  // Second focus = remount (mocked useFocusEffect runs once per mount).
  // The on payload now flips the killswitch; the consolidated effect
  // must fire getMyBadges.
  const second = await mountRoute();
  await second.flush();
  expect(apiState.getMyBadges).toHaveBeenCalledTimes(1);
  await second.unmount();
});
```

If `mountRoute` lacks `unmount` / `flush`, extend it using the `HexBadge.test.tsx` `createRoot` pattern (test-file scope already touched): return `{ flush: () => new Promise(r => setTimeout(r, 0)), unmount: async () => act(async () => root.unmount()) }`.

- [ ] **D2: Verify FAIL** — `pnpm --filter @jdm/mobile test -- GarageIndexRoute.test.tsx -t "re-focus"`.

- [ ] **D3: Consolidate.** Replace the `useFocusEffect` (lines 55–59) AND delete the standalone `useEffect` (lines 98–110):

```tsx
useFocusEffect(
  useCallback(() => {
    void (async () => {
      const next = await getGarage();
      setGarage(next);
      if (next.garage.gamification.enabled) {
        try {
          setBadgesAggregate(await getMyBadges());
        } catch {
          setBadgesAggregate(null);
        }
      } else {
        setBadgesAggregate(null);
      }
    })();
  }, []),
);
```

Keep `refetchBadges` (used by `handleTogglePin`) untouched.

- [ ] **D4: Verify PASS** — `pnpm --filter @jdm/mobile test -- GarageIndexRoute.test.tsx`.

- [ ] **D5: Commit.** Subject: `fix(mobile): refetch badges on focus when killswitch re-enables`.

---

## Item E — Admin panel: per-row pending + dialog focus trap

Two carry-overs (§72 #4 + #5) sharing one file. **Pending:** swap shared `isPending` (`useTransition`) for a `Set<string>` of in-flight codes (`pendingCodes`) — multiple grants can be in flight at once, and each row's disabled state is membership-checked. Single-code tracking would lose row state when a second grant starts before the first resolves. **Focus:** focus Cancel on dialog open; trap Tab/Shift-Tab between Cancel + "Conceder mesmo assim"; restore focus to the originating grant button on Esc/Cancel/confirm. **Files:** `garage-badges-panel.tsx`, `garage-badges-panel.interaction.test.tsx`.

- [ ] **E1: Failing tests.** Append to `garage-badges-panel.interaction.test.tsx`:

```tsx
const render = async (premium = false) => {
  await act(async () => {
    root.render(
      <GarageBadgesPanel
        userId="u1"
        catalog={catalog}
        earnedCodes={[]}
        isPremiumActive={premium}
      />,
    );
  });
};
const openConfirm = async () => {
  await render(false);
  const carBtn = findGrantButtons().find((b) =>
    (b.closest('li')?.textContent ?? '').includes('CAR-003'),
  )!;
  await act(async () => {
    carBtn.click();
  });
  return carBtn;
};
const key = (t: EventTarget, k: string, shift = false) =>
  t.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, shiftKey: shift }),
  );

it('per-row pending: EVT-001 grant in flight leaves CAR-003 enabled', async () => {
  let resolve: ((v: { ok: false; error: string }) => void) | null = null;
  grantMock.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render(true);
  const [evtBtn, carBtn] = findGrantButtons();
  await act(async () => {
    evtBtn?.click();
  });
  expect(evtBtn?.hasAttribute('disabled')).toBe(true);
  expect(carBtn?.hasAttribute('disabled')).toBe(false);
  await act(async () => {
    resolve?.({ ok: false, error: 'already_earned' });
  });
});

it('per-row pending: two concurrent grants — both rows disabled, third stays enabled', async () => {
  let resolveEvt: ((v: { ok: false; error: string }) => void) | null = null;
  let resolveCar: ((v: { ok: false; error: string }) => void) | null = null;
  grantMock
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveEvt = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveCar = r;
        }),
    );
  await render(true);
  const btn = (code: string) =>
    findGrantButtons().find((b) => (b.closest('li')?.textContent ?? '').includes(code))!;
  const evtBtn = btn('EVT-001'),
    carBtn = btn('CAR-003'),
    comBtn = btn('COM-001');
  await act(async () => {
    evtBtn.click();
  });
  await act(async () => {
    carBtn.click();
  });
  expect(evtBtn.hasAttribute('disabled')).toBe(true);
  expect(carBtn.hasAttribute('disabled')).toBe(true);
  expect(comBtn.hasAttribute('disabled')).toBe(false);
  // Resolving EVT only clears EVT — CAR is still in flight.
  await act(async () => {
    resolveEvt?.({ ok: false, error: 'already_earned' });
  });
  expect(carBtn.hasAttribute('disabled')).toBe(true);
  await act(async () => {
    resolveCar?.({ ok: false, error: 'already_earned' });
  });
});

it('focus trap: dialog open focuses Cancel', async () => {
  await openConfirm();
  expect(document.activeElement).toBe(findCancelButton());
});

it('focus trap: Tab wraps Cancel→Conceder and back', async () => {
  await openConfirm();
  const cancel = findCancelButton()!,
    confirm = findConfirmButton()!;
  cancel.focus();
  await act(async () => {
    key(cancel, 'Tab');
  });
  expect(document.activeElement).toBe(confirm);
  await act(async () => {
    key(confirm, 'Tab', true);
  });
  expect(document.activeElement).toBe(cancel);
});

it('focus trap: Esc dismisses + restores focus to the grant button', async () => {
  const carBtn = await openConfirm();
  await act(async () => {
    key(document, 'Escape');
  });
  expect(findCancelButton()).toBeNull();
  expect(document.activeElement).toBe(carBtn);
});
```

- [ ] **E2: Verify FAIL** — `pnpm --filter @jdm/admin test -- garage-badges-panel.interaction.test.tsx`.

- [ ] **E3: Per-row pending in `garage-badges-panel.tsx`.** Track in-flight codes as a Set so concurrent grants don't clobber each other (a single `pendingCode` would forget row A the moment row B starts).

```tsx
const [pendingCodes, setPendingCodes] = useState<ReadonlySet<string>>(() => new Set());
const [, startTransition] = useTransition();
const addPending = (c: string) => setPendingCodes((p) => new Set(p).add(c));
const clearPending = (c: string) =>
  setPendingCodes((p) => {
    if (!p.has(c)) return p;
    const n = new Set(p);
    n.delete(c);
    return n;
  });
const runGrant = useCallback(
  (code: string) => {
    addPending(code);
    startTransition(async () => {
      setError(null);
      try {
        const res = await grantAdminUserBadgeAction(userId, code);
        if (res.ok) router.refresh();
        else setError({ code, message: res.error });
      } finally {
        clearPending(code);
      }
    });
  },
  [router, userId],
);
```

Swap `disabled={isPending}` → `disabled={pendingCodes.has(entry.code)}` on catalog grant buttons; `disabled={pendingCodes.has(confirm.code)}` on the dialog confirm button.

- [ ] **E4: Focus trap + restore.** Add three refs + replace the existing Escape-only `useEffect`:

```tsx
const lastFocusedRef = useRef<HTMLButtonElement | null>(null);
const cancelRef = useRef<HTMLButtonElement | null>(null);
const confirmRef = useRef<HTMLButtonElement | null>(null);

const handleGrantClick = useCallback(
  (entry: BadgeCatalogEntry, originBtn: HTMLButtonElement | null) => {
    if (entry.premiumExclusive && !isPremiumActive) {
      lastFocusedRef.current = originBtn;
      setConfirm({ code: entry.code, category: entry.category });
      return;
    }
    runGrant(entry.code);
  },
  [isPremiumActive, runGrant],
);
const dismissConfirm = useCallback(() => {
  setConfirm(null);
  lastFocusedRef.current?.focus();
}, []);

useEffect(() => {
  if (confirm) cancelRef.current?.focus();
}, [confirm]);
useEffect(() => {
  if (!confirm) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissConfirm();
      return;
    }
    if (e.key !== 'Tab') return;
    const c = cancelRef.current,
      k = confirmRef.current;
    if (!c || !k) return;
    const a = document.activeElement;
    if (e.shiftKey && a === c) {
      e.preventDefault();
      k.focus();
    } else if (!e.shiftKey && a === k) {
      e.preventDefault();
      c.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [confirm, dismissConfirm]);
```

Wire JSX: catalog grant button → `onClick={(e) => handleGrantClick(entry, e.currentTarget)}`. Dialog Cancel → `ref={cancelRef} onClick={dismissConfirm}`. Dialog confirm → `ref={confirmRef} disabled={pendingCodes.has(confirm.code)} onClick={() => { const c = confirm.code; setConfirm(null); runGrant(c); lastFocusedRef.current?.focus(); }}`.

- [ ] **E5: Verify PASS** — `pnpm --filter @jdm/admin test -- garage-badges-panel`.

- [ ] **E6: Commit.** Subject: `fix(admin): per-row pending + focus trap on garage-badges-panel`.

---

## Item F — Drop dead `border-border` Tailwind on web BadgeRow chip

`packages/ui/src/web/BadgeRow.tsx:71–75` has `className="... border border-dashed border-border ..."` plus inline `borderColor: garageTokens.surface.border`. Inline wins; `border-border` is dead. Drop it; keep `border border-dashed` + inline color. **Files:** `web/BadgeRow.tsx`, `web-badge-row.test.tsx`.

- [ ] **F1: Failing test.** Append to `web-badge-row.test.tsx`:

```tsx
it('overflow chip uses inline borderColor — no border-border in className', () => {
  const badges: GarageBadgePublic[] = ['EVT-001', 'EVT-002', 'EVT-003', 'CAR-001', 'CAR-002'].map(
    (code) => ({ code, earnedAt }),
  );
  const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
  const chip = html.match(/aria-label="Mais 1 conquistas"[^>]*/)?.[0] ?? '';
  expect(chip).toContain('border-dashed');
  expect(chip).not.toContain('border-border');
});
```

- [ ] **F2: Verify FAIL** — `pnpm --filter @jdm/admin test -- web-badge-row.test.tsx -t "no border-border"`.

- [ ] **F3: Edit `packages/ui/src/web/BadgeRow.tsx`.** Replace the overflow chip's className:

```tsx
className =
  'inline-flex items-center justify-center rounded-lg border border-dashed bg-surface-deep text-[13px] font-bold text-fg-secondary';
```

Keep the inline `style={{ width: 52, height: 52, borderColor: garageTokens.surface.border }}` exactly as is.

- [ ] **F4: Verify PASS** — `pnpm --filter @jdm/admin test -- web-badge-row.test.tsx`.

- [ ] **F5: Commit.** Subject: `chore(ui): drop dead border-border Tailwind on web BadgeRow chip`.

---

## Verification (touched paths only)

After Item F. Never run the full suite locally (`feedback_no_full_test_suite_locally`):

```bash
pnpm --filter @jdm/ui typecheck && pnpm --filter @jdm/mobile typecheck && pnpm --filter @jdm/admin typecheck
pnpm --filter @jdm/mobile test -- HexBadge.test.tsx BadgesSheet.test.tsx useBuySpotFlow.test.ts GarageIndexRoute.test.tsx
pnpm --filter @jdm/admin test -- web-hex-badge.test.tsx web-badge-row.test.tsx garage-badges-panel
```

Expected: all green. No backend / migration runs. No schema deltas — no `@jdm/shared` rebuild required.

---

## Corrections + deviations

**Corrections that apply:**

- **Phase 2 §C references:** none. Skeleton §"Chunk 0" states "Corrections that apply: none" — Phase 1 reconciliation only. Item C cites **Phase 1 §C10** (= `.handoffs §72 #2`); this is the Phase 1 outline, not Phase 2's §C10 gamification-envelope correction.
- **Canon (`/tmp/phase2-fix-canon.md`):** no canon §1–14 applies to this chunk's code (no XP, no awarder, no schema). Canon §10 (filtered test command shape) is acknowledged but not retro-fixed here — the existing `pnpm --filter <pkg> test -- <file>` patterns in this plan were not flagged by the chunk-0 review and rewriting them is out of scope; future chunks that touch the same scripts should migrate to `pnpm --filter <pkg> exec vitest run <path>`.
- **Plan-review MAJOR fixes applied:** C harness rewritten (no `@testing-library/react`); D harness adds explicit remount-driven re-focus; E switches single `pendingCode` to `Set<string>` + adds concurrent-grant spec. See Deviations §§7–9.

**Deviations from skeleton:**

1. **No BadgesSheet web twin exists.** Skeleton lists `BadgesSheet.tsx + web twin`. Verified during plan-write: `packages/ui/src/web/` ships only `BadgeGlyph` / `BadgeRow` / `HexBadge` / `PremiumBadge`. The public SSR garage (`apps/admin/app/g/[slug]`) renders pinned-only `BadgeRow` — no catalog view to filter. Filter mobile-only; ports verbatim if a future phase adds a web sheet.

2. **RN legendary glow dropped.** Canon `badges.jsx:478` uses `boxShadow: '0 0 8px <brand>'`. RN shadow props approximate poorly over transparent absolute children; mobile dot is flat. Web keeps `boxShadow` per canon. Acceptable per "decorative drift, non-blocking" framing.

3. **Phase 1 §C10 plumbing only, not full bounce.** Handoff §72 #2 frames `/cart` return as multi-surface work (cart-success handler, push, deep-link). This PR threads `?return=garage&itemId=<id>` only; v1 cart ignores both keys. Cart-success bounce + push stay deferred.

4. **Skeleton "returns to /garage?highlight=<slot>" rephrased.** Hook can't bounce without cart knowing the spot id (Deviation §3). TDD asserts pushed-URL shape; the post-purchase pulse already works via the unchanged `useEffect` at `garage/index.tsx:74–85`.

5. **Item D consolidates two effects into one** inside `useFocusEffect`. Skeleton didn't anticipate this; preserves `refetchBadges` for the pin-toggle path.

6. **Item E focus trap inline** — no shared `FocusTrap` primitive in admin shell (no `react-focus-lock` / `@radix-ui/react-focus-scope` dep). Matches existing `AddUserToGroupModal` pattern from handoff §72 #5; migrates trivially later.

7. **Item C uses inline `createRoot` probe, not `@testing-library/react`.** Mobile workspace ships `react-test-renderer` + manual jsdom; no testing-library dep. The hook test mounts a tiny probe component that captures the hook's return value into a ref. No new deps. (Plan-review MAJOR fix.)

8. **Item D forces re-focus by remount, not by re-firing `useFocusEffect`.** The route test mocks `expo-router`'s `useFocusEffect` as a one-shot `useEffect`, so re-focus is simulated by unmount + mount with the second `getGarage` payload queued. Asserts the consolidated effect runs the badges fetch on the second mount. (Plan-review MAJOR fix.)

9. **Item E uses `Set<string>` of pending codes, not a single `pendingCode`.** A single nullable string would forget row A the moment row B starts. The Set lets multiple concurrent grants coexist; each row checks `pendingCodes.has(code)`. Added a two-concurrent-grant spec covering the failure mode. (Plan-review MAJOR fix.)

---

## PR checklist

- [ ] `git branch --show-current` — must NOT be `production` (`CLAUDE.md` preflight). If on `production`, STOP, switch to `main`.
- [ ] `git checkout main && git pull --ff-only origin main`.
- [ ] `git checkout -b feat/jdma-garage-phase2-00-polish`.
- [ ] Items A → F in order; one commit per item using the subjects above. No `--amend`, no `--no-verify`.
- [ ] Run verification block; touched-paths only.
- [ ] `git push -u origin feat/jdma-garage-phase2-00-polish`.
- [ ] Open PR to `main`. **Title:** `feat(garage): Phase 1 polish fold-in — 6 carry-overs`

  **Body template:**

  ```
  ## Summary

  Six non-blocking Phase 1 carry-overs from .handoffs/orchestrator-state.md
  §"Deferred work" landed in one PR before they bit-rot. UI/UX-only.

  - A — HexBadge legendary corner-dot (mobile + web).
  - B — BadgesSheet category-tabs filter (mobile only).
  - C — Buy-spot /cart?return=garage&itemId=<id> plumbing (Phase 1 §C10 prep).
  - D — Refetch badges on focus when killswitch re-enables mid-session.
  - E — Admin grant panel: per-row pending + premium-bypass focus trap.
  - F — Drop dead border-border Tailwind on web BadgeRow chip.

  Plan: docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-00-phase1-polish-foldin.md

  ## Test plan

  - [x] A 7 specs, B 4, C 3, D 1, E 5, F 1 (21 total).
  - [x] @jdm/ui + @jdm/mobile + @jdm/admin typechecks green.

  ## Deviations from plan

  Per plan §"Corrections + deviations":
  1. No BadgesSheet web twin — filter mobile-only.
  2. RN legendary dot flat (no shadow); web keeps boxShadow.
  3. Phase 1 §C10 plumbing only — query keys are no-op in v1 cart.
  4. Skeleton "/garage?highlight=<slot>" rephrased to pushed-URL assertion.
  5. Item D consolidates two effects into one useFocusEffect.
  6. Item E focus trap inline (no shared primitive in admin shell).
  ```

- [ ] Request review on the PR per `CLAUDE.md`. Main-merge only; never push or merge to `production`.
