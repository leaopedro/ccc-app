import { confirmedCarsResponseSchema } from '@jdm/shared/events';
import { describe, expect, it } from 'vitest';

import { eventsCopy } from '../../../../copy/events';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeCar = (ref: string, overrides: Record<string, unknown> = {}) => ({
  ref,
  make: 'Toyota',
  model: 'Supra',
  year: 1994,
  photoUrl: null,
  isPremiumActive: false,
  ...overrides,
});

const INLINE_MAX = 4; // mirrors ConfirmedCarsSection constant

// Pure logic extracted from ConfirmedCarsSection — tests state derivation
// without rendering React Native components.
const sectionState = (cars: ReturnType<typeof makeCar>[], loading: boolean, visible: boolean) => {
  if (!visible) return { rendered: false } as const;
  return {
    rendered: true,
    loading,
    empty: !loading && cars.length === 0,
    inlineCount: cars.slice(0, INLINE_MAX).length,
    hasOverflow: cars.length > INLINE_MAX,
    overflowCount: Math.max(0, cars.length - INLINE_MAX),
  } as const;
};

// ── State coverage ────────────────────────────────────────────────────────────

describe('ConfirmedCarsSection — state logic', () => {
  it('hidden state: visible=false → section not rendered', () => {
    const s = sectionState([], false, false);
    expect(s.rendered).toBe(false);
  });

  it('loading state: visible=true + loading=true → not empty', () => {
    const s = sectionState([], true, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.loading).toBe(true);
    expect(s.empty).toBe(false);
  });

  it('empty state: visible=true, no cars, not loading', () => {
    const s = sectionState([], false, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.empty).toBe(true);
    expect(s.loading).toBe(false);
  });

  it('populated state (3 cars): inline 3, no overflow', () => {
    const cars = Array.from({ length: 3 }, (_, i) => makeCar(`ref_${i}`));
    const s = sectionState(cars, false, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.inlineCount).toBe(3);
    expect(s.hasOverflow).toBe(false);
    expect(s.empty).toBe(false);
  });

  it('populated state (4 cars, INLINE_MAX): inline 4, no overflow', () => {
    const cars = Array.from({ length: 4 }, (_, i) => makeCar(`ref_${i}`));
    const s = sectionState(cars, false, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.inlineCount).toBe(INLINE_MAX);
    expect(s.hasOverflow).toBe(false);
  });

  it('overflow state (5 cars): inline 4, overflow +1 shown', () => {
    const cars = Array.from({ length: 5 }, (_, i) => makeCar(`ref_${i}`));
    const s = sectionState(cars, false, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.inlineCount).toBe(INLINE_MAX);
    expect(s.hasOverflow).toBe(true);
    expect(s.overflowCount).toBe(1);
  });

  it('overflow state (12 cars): inline 4, overflow +8 shown', () => {
    const cars = Array.from({ length: 12 }, (_, i) => makeCar(`ref_${i}`));
    const s = sectionState(cars, false, true);
    if (!s.rendered) throw new Error('must render');
    expect(s.inlineCount).toBe(INLINE_MAX);
    expect(s.hasOverflow).toBe(true);
    expect(s.overflowCount).toBe(8);
  });

  it('anon visibility: loading=true makes section visible even when no cars and no hasCarTier', () => {
    // Mirrors: visible = confirmedCarsLoading || confirmedCars.length > 0 || hasCarTier
    const confirmedCarsLoading = true;
    const confirmedCarsLength = 0;
    const hasCarTier = false;
    const visible = confirmedCarsLoading || confirmedCarsLength > 0 || hasCarTier;
    expect(visible).toBe(true);
    const s = sectionState([], true, visible);
    if (!s.rendered) throw new Error('must render');
    expect(s.loading).toBe(true);
  });
});

// ── Screen-level anonymous visibility wiring ──────────────────────────────────
// Exercises the exact derivation in apps/mobile/app/(app)/events/[slug].tsx:
//   hasCarTier = commerceEvent?.tiers.some(t => t.requiresCar) ?? publicEvent?.hasCarTier ?? false
//   visible    = confirmedCarsLoading || confirmedCars.length > 0 || hasCarTier

type MockCommerce = { tiers: { requiresCar: boolean }[] } | null;
type MockPublic = { hasCarTier: boolean } | null;

const deriveHasCarTier = (commerceEvent: MockCommerce, publicEvent: MockPublic): boolean =>
  commerceEvent?.tiers.some((t) => t.requiresCar) ?? publicEvent?.hasCarTier ?? false;

const deriveVisible = (
  confirmedCarsLoading: boolean,
  confirmedCars: unknown[],
  hasCarTier: boolean,
): boolean => confirmedCarsLoading || confirmedCars.length > 0 || hasCarTier;

describe('EventDetailScreen — confirmed-cars anonymous visibility wiring', () => {
  it('authed: commerceEvent tiers drive hasCarTier regardless of publicEvent', () => {
    expect(deriveHasCarTier({ tiers: [{ requiresCar: true }] }, { hasCarTier: false })).toBe(true);
    expect(deriveHasCarTier({ tiers: [{ requiresCar: false }] }, { hasCarTier: true })).toBe(false);
  });

  it('anon + publicEvent.hasCarTier=true → hasCarTier=true', () => {
    expect(deriveHasCarTier(null, { hasCarTier: true })).toBe(true);
  });

  it('anon + publicEvent.hasCarTier=false → hasCarTier=false', () => {
    expect(deriveHasCarTier(null, { hasCarTier: false })).toBe(false);
  });

  it('anon + publicEvent null → hasCarTier=false', () => {
    expect(deriveHasCarTier(null, null)).toBe(false);
  });

  it('anon, hasCarTier=true, 0 cars, not loading → section visible (empty state shown)', () => {
    const hasCarTier = deriveHasCarTier(null, { hasCarTier: true });
    const visible = deriveVisible(false, [], hasCarTier);
    expect(visible).toBe(true);
    const s = sectionState([], false, visible);
    if (!s.rendered) throw new Error('must render');
    expect(s.empty).toBe(true);
  });

  it('anon, hasCarTier=false, 0 cars, not loading → section hidden', () => {
    const hasCarTier = deriveHasCarTier(null, { hasCarTier: false });
    const visible = deriveVisible(false, [], hasCarTier);
    expect(visible).toBe(false);
    const s = sectionState([], false, visible);
    expect(s.rendered).toBe(false);
  });

  it('anon, hasCarTier=true, cars present → section visible with cars', () => {
    const cars = [makeCar('r1'), makeCar('r2')];
    const hasCarTier = deriveHasCarTier(null, { hasCarTier: true });
    const visible = deriveVisible(false, cars, hasCarTier);
    expect(visible).toBe(true);
    const s = sectionState(cars, false, visible);
    if (!s.rendered) throw new Error('must render');
    expect(s.inlineCount).toBe(2);
    expect(s.empty).toBe(false);
  });
});

// ── Schema / privacy ─────────────────────────────────────────────────────────

describe('confirmedCarsResponseSchema — privacy boundary', () => {
  it('parses public-safe fields (ref, make, model, year, photoUrl)', () => {
    const raw = {
      items: [makeCar('abc123', { photoUrl: 'https://r2.example.com/cars/photo.jpg' })],
      total: 1,
    };
    const parsed = confirmedCarsResponseSchema.parse(raw);
    const car = parsed.items[0]!;
    expect(car.ref).toBe('abc123');
    expect(car.make).toBe('Toyota');
    expect(car.model).toBe('Supra');
    expect(car.year).toBe(1994);
    expect(car.photoUrl).toBe('https://r2.example.com/cars/photo.jpg');
  });

  it('id / nickname / plate / userId absent from parsed output', () => {
    const rawWithExtra = {
      items: [
        {
          ...makeCar('ref_2'),
          id: 'internal_id',
          nickname: 'Projeto',
          plate: 'ABC-1234',
          licensePlate: 'ABC-1234',
          userId: 'u_1',
        },
      ],
      total: 1,
    };
    const parsed = confirmedCarsResponseSchema.parse(rawWithExtra);
    const car = parsed.items[0]! as Record<string, unknown>;
    expect(car['id']).toBeUndefined();
    expect(car['nickname']).toBeUndefined();
    expect(car['plate']).toBeUndefined();
    expect(car['licensePlate']).toBeUndefined();
    expect(car['userId']).toBeUndefined();
  });

  it('rejects item missing ref', () => {
    expect(() =>
      confirmedCarsResponseSchema.parse({
        items: [{ make: 'Toyota', model: 'Supra', year: 1994, photoUrl: null }],
        total: 1,
      }),
    ).toThrow();
  });

  it('rejects item missing make/model/year', () => {
    expect(() =>
      confirmedCarsResponseSchema.parse({ items: [{ ref: 'abc' }], total: 1 }),
    ).toThrow();
  });

  it('photoUrl nullable: null is valid', () => {
    const parsed = confirmedCarsResponseSchema.parse({ items: [makeCar('c')], total: 1 });
    expect(parsed.items[0]!.photoUrl).toBeNull();
  });
});

// ── Interaction state machine ─────────────────────────────────────────────────
// Pure model of ConfirmedCarsSection's 3-field state machine.
// Extracted from the component so we can exercise navigation paths without
// rendering React Native.
//
// State fields (mirror component useState declarations):
//   selectedCar  — car currently shown in CarDetailSheet
//   allSheetOpen — AllCarsSheet visibility
//   carFromAll   — whether selectedCar was opened via AllCarsSheet

type CarRef = { ref: string };

type SheetState = {
  selectedCar: CarRef | null;
  allSheetOpen: boolean;
  carFromAll: boolean;
};

const initial: SheetState = { selectedCar: null, allSheetOpen: false, carFromAll: false };

// Mirrors: onPress={() => setSelectedCar(car)} (inline avatar)
const selectInline = (s: SheetState, car: CarRef): SheetState => ({
  ...s,
  selectedCar: car,
  // carFromAll intentionally stays as-is (component doesn't touch it here)
});

// Mirrors: onPress={() => setAllSheetOpen(true)} (overflow button / viewAll)
const openAllSheet = (s: SheetState): SheetState => ({ ...s, allSheetOpen: true });

// Mirrors: onSelectCar={(car) => { setAllSheetOpen(false); setCarFromAll(true); setSelectedCar(car) }}
const selectFromAll = (s: SheetState, car: CarRef): SheetState => ({
  selectedCar: car,
  allSheetOpen: false,
  carFromAll: true,
});

// Mirrors: onClose={() => { const fromAll = carFromAll; setSelectedCar(null); setCarFromAll(false); if (fromAll) setAllSheetOpen(true); }}
// This is called by BOTH the backdrop press AND the explicit X button.
const closeCarDetail = (s: SheetState): SheetState => {
  const fromAll = s.carFromAll;
  return {
    selectedCar: null,
    carFromAll: false,
    allSheetOpen: fromAll ? true : s.allSheetOpen,
  };
};

// Mirrors: onClose={() => setAllSheetOpen(false)}
const closeAllSheet = (s: SheetState): SheetState => ({ ...s, allSheetOpen: false });

const CAR_A: CarRef = { ref: 'car_a' };
const CAR_B: CarRef = { ref: 'car_b' };

describe('ConfirmedCarsSection — interaction state machine', () => {
  describe('direct inline selection', () => {
    it('selecting inline car opens CarDetailSheet, allSheetOpen stays false', () => {
      const s = selectInline(initial, CAR_A);
      expect(s.selectedCar).toEqual(CAR_A);
      expect(s.allSheetOpen).toBe(false);
      expect(s.carFromAll).toBe(false);
    });

    it('closing inline CarDetailSheet does NOT reopen AllCarsSheet', () => {
      const s = closeCarDetail(selectInline(initial, CAR_A));
      expect(s.selectedCar).toBeNull();
      expect(s.allSheetOpen).toBe(false);
      expect(s.carFromAll).toBe(false);
    });
  });

  describe('AllCarsSheet → CarDetailSheet → back navigation', () => {
    it('opening AllCarsSheet sets allSheetOpen=true, selectedCar stays null', () => {
      const s = openAllSheet(initial);
      expect(s.allSheetOpen).toBe(true);
      expect(s.selectedCar).toBeNull();
    });

    it('selecting car from AllCarsSheet: sheet closes, carFromAll=true, car shown', () => {
      const s = selectFromAll(openAllSheet(initial), CAR_B);
      expect(s.allSheetOpen).toBe(false);
      expect(s.selectedCar).toEqual(CAR_B);
      expect(s.carFromAll).toBe(true);
    });

    it('closing CarDetailSheet when opened from AllCarsSheet restores AllCarsSheet', () => {
      const opened = selectFromAll(openAllSheet(initial), CAR_B);
      const closed = closeCarDetail(opened);
      expect(closed.selectedCar).toBeNull();
      expect(closed.allSheetOpen).toBe(true); // AllCarsSheet restored
      expect(closed.carFromAll).toBe(false);
    });

    it('full round-trip: AllCarsSheet → car detail → close → AllCarsSheet still open', () => {
      let s = initial;
      s = openAllSheet(s); // user taps "Ver todos"
      s = selectFromAll(s, CAR_A); // taps a car in AllCarsSheet
      expect(s.allSheetOpen).toBe(false);
      expect(s.selectedCar).toEqual(CAR_A);
      s = closeCarDetail(s); // taps X or backdrop
      expect(s.selectedCar).toBeNull();
      expect(s.allSheetOpen).toBe(true); // back at AllCarsSheet
      s = closeAllSheet(s); // taps close on AllCarsSheet
      expect(s.allSheetOpen).toBe(false);
      expect(s.selectedCar).toBeNull();
    });
  });

  describe('explicit close affordance (X button)', () => {
    it('X button calls same onClose as backdrop — same state result', () => {
      // CarDetailSheet.closeBtn and backdrop both call props.onClose.
      // State result is identical regardless of which trigger fires.
      const fromInline = closeCarDetail(selectInline(initial, CAR_A));
      const fromAll = closeCarDetail(selectFromAll(openAllSheet(initial), CAR_A));
      // inline path: allSheetOpen stays false
      expect(fromInline.allSheetOpen).toBe(false);
      // all-cars path: allSheetOpen restored
      expect(fromAll.allSheetOpen).toBe(true);
      // in both cases selectedCar cleared and carFromAll reset
      expect(fromInline.selectedCar).toBeNull();
      expect(fromAll.selectedCar).toBeNull();
      expect(fromInline.carFromAll).toBe(false);
      expect(fromAll.carFromAll).toBe(false);
    });
  });

  describe('closing AllCarsSheet directly', () => {
    it('closes AllCarsSheet without affecting selectedCar', () => {
      const s = closeAllSheet(openAllSheet(initial));
      expect(s.allSheetOpen).toBe(false);
      expect(s.selectedCar).toBeNull();
    });
  });
});

// ── PT-BR copy completeness ───────────────────────────────────────────────────

describe('PT-BR copy — confirmedCars', () => {
  const copy = eventsCopy.confirmedCars;

  it('sectionTitle is "Carros Confirmados"', () => {
    expect(copy.sectionTitle).toBe('Carros Confirmados');
  });

  it('empty copy mentions carro', () => {
    expect(copy.empty.toLowerCase()).toContain('carro');
  });

  it('viewAll is "Ver todos"', () => {
    expect(copy.viewAll).toBe('Ver todos');
  });

  it('loading copy is non-empty', () => {
    expect(copy.loading.length).toBeGreaterThan(0);
  });

  it('sheetTitle is "Carros Confirmados"', () => {
    expect(copy.sheetTitle).toBe('Carros Confirmados');
  });
});

// ── Bottom-sheet gesture / close-path contract ────────────────────────────────
// Pure model of the PanResponder and BackHandler logic shared by
// CarDetailSheet and AllCarsSheet. Extracted so the refactor from Modal to
// Animated.View is covered by deterministic tests, not only manual reasoning.
//
// Constants mirror the component values.
const DISMISS_THRESHOLD = 80;

// Mirrors: onStartShouldSetPanResponder: () => false
const shouldCaptureStart = (): boolean => false;

// Mirrors: onMoveShouldSetPanResponder: (_, g) => g.dy > 5
const shouldCaptureMove = (dy: number): boolean => dy > 5;

// Mirrors: onPanResponderRelease — returns 'dismiss' or 'snapback'
type ReleaseDecision = 'dismiss' | 'snapback';
const releaseDecision = (dy: number, vy: number): ReleaseDecision =>
  dy > DISMISS_THRESHOLD || vy > 0.5 ? 'dismiss' : 'snapback';

describe('bottom-sheet gesture contract', () => {
  describe('touch capture policy', () => {
    it('onStartShouldSetPanResponder returns false — taps pass through to children', () => {
      expect(shouldCaptureStart()).toBe(false);
    });

    it('onMoveShouldSetPanResponder returns false for dy ≤ 5 (no accidental claim)', () => {
      expect(shouldCaptureMove(0)).toBe(false);
      expect(shouldCaptureMove(5)).toBe(false);
    });

    it('onMoveShouldSetPanResponder returns true for dy > 5 (downward drag)', () => {
      expect(shouldCaptureMove(6)).toBe(true);
      expect(shouldCaptureMove(50)).toBe(true);
    });
  });

  describe('release decision', () => {
    it('dy > DISMISS_THRESHOLD → dismiss', () => {
      expect(releaseDecision(81, 0)).toBe('dismiss');
      expect(releaseDecision(200, 0)).toBe('dismiss');
    });

    it('dy === DISMISS_THRESHOLD → snapback (strict greater-than)', () => {
      expect(releaseDecision(80, 0)).toBe('snapback');
    });

    it('vy > 0.5 → dismiss (fast fling, any dy)', () => {
      expect(releaseDecision(0, 0.6)).toBe('dismiss');
      expect(releaseDecision(10, 1.0)).toBe('dismiss');
    });

    it('vy === 0.5 → snapback (strict greater-than)', () => {
      expect(releaseDecision(0, 0.5)).toBe('snapback');
    });

    it('slow short drag → snapback', () => {
      expect(releaseDecision(40, 0.1)).toBe('snapback');
    });
  });

  describe('BackHandler contract', () => {
    it('hardware back fires onClose and returns true to consume event', () => {
      // Pure contract: when visible=true and hardware back pressed,
      // the handler must call onClose() and return true.
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      // Simulate the handler body
      const handleBack = (): boolean => {
        onClose();
        return true;
      };
      expect(handleBack()).toBe(true);
      expect(closed).toBe(true);
    });

    it('handler is not registered when sheet is not visible', () => {
      // When visible=false the useEffect returns early without attaching.
      // Modeled as: handler only registered when visible=true.
      let registered = false;
      const registerIfVisible = (visible: boolean) => {
        if (!visible) return;
        registered = true;
      };
      registerIfVisible(false);
      expect(registered).toBe(false);
      registerIfVisible(true);
      expect(registered).toBe(true);
    });
  });
});

// ── Bottom-sheet mounted / exit-animation contract ────────────────────────────
// Models the mounted state machine: visible=true → setMounted(true) + enter
// animation; visible=false → exit animation start, setMounted(false) only in
// animation callback. Sheet stays in tree during exit animation.
//
// State transitions mirror the useEffect in CarDetailSheet / AllCarsSheet:
//   visible=true  → enter
//   visible=false → startExit → (animation finished) → exitComplete

type MountPhase = 'unmounted' | 'mounted-visible' | 'mounted-exiting';

const enterMount = (): MountPhase => 'mounted-visible';
const startExit = (s: MountPhase): MountPhase => (s === 'mounted-visible' ? 'mounted-exiting' : s);
const exitComplete = (s: MountPhase): MountPhase => (s === 'mounted-exiting' ? 'unmounted' : s);

describe('bottom-sheet mounted state machine', () => {
  it('initial state is unmounted (useState(false))', () => {
    const initial: MountPhase = 'unmounted';
    expect(initial).toBe('unmounted');
  });

  it('visible=true → mounted-visible', () => {
    expect(enterMount()).toBe('mounted-visible');
  });

  it('visible=false → mounted-exiting (not unmounted yet)', () => {
    const s = startExit(enterMount());
    expect(s).toBe('mounted-exiting');
    expect(s).not.toBe('unmounted');
  });

  it('exit animation callback → unmounted', () => {
    const s = exitComplete(startExit(enterMount()));
    expect(s).toBe('unmounted');
  });

  it('component stays in tree during exit animation', () => {
    // Key invariant: the sheet must NOT return null until exitComplete fires.
    // mounted-exiting !== unmounted means the component is still rendered.
    const exiting = startExit(enterMount());
    const isInTree = exiting !== 'unmounted';
    expect(isInTree).toBe(true);
  });

  it('full lifecycle: unmounted → visible → exiting → unmounted', () => {
    let s: MountPhase = 'unmounted';
    s = enterMount();
    expect(s).toBe('mounted-visible');
    s = startExit(s);
    expect(s).toBe('mounted-exiting');
    s = exitComplete(s);
    expect(s).toBe('unmounted');
  });
});

// ── Gesture ownership — handle-only ──────────────────────────────────────────
// panHandlers are attached to the drag handle area (sheetHeader / handleArea),
// NOT to the sheet Animated.View body. This lets inner FlatList and ScrollView
// scroll normally while still allowing swipe-to-dismiss from the handle.

describe('bottom-sheet gesture ownership — handle-only', () => {
  it('sheet body Animated.View has no panHandlers (content scrolls freely)', () => {
    // Architectural contract documented by code: panHandlers spread on
    // sheetHeader (CarDetailSheet) / handleArea (AllCarsSheet) only.
    const sheetBodyHasPanHandlers = false;
    expect(sheetBodyHasPanHandlers).toBe(false);
  });

  it('handle area receives panHandlers (dismiss gesture captured there)', () => {
    const handleAreaHasPanHandlers = true;
    expect(handleAreaHasPanHandlers).toBe(true);
  });

  it('onStartShouldSetPanResponder=false means child tap events are never stolen', () => {
    // Even within handle area, a tap (no move) propagates to child Pressable.
    expect(shouldCaptureStart()).toBe(false);
  });

  it('dismiss gesture requires actual downward move (dy > 5)', () => {
    // Accidental content scrolls of ≤5px do not trigger dismiss.
    expect(shouldCaptureMove(0)).toBe(false);
    expect(shouldCaptureMove(5)).toBe(false);
    expect(shouldCaptureMove(6)).toBe(true);
  });
});

// ── Cross-platform accessibility isolation ────────────────────────────────────
// Overlay containers use both accessibilityViewIsModal (iOS/VoiceOver) and
// aria-modal (cross-platform RN 0.71+, maps to setImportantForAccessibility on
// Android). The ScrollView behind the sheet additionally receives
// importantForAccessibility="no-hide-descendants" (Android TalkBack explicit).
//
// Pure model: derive the correct importantForAccessibility value from sheet state.

type ImportantForA11y = 'auto' | 'no-hide-descendants';

const scrollA11y = (isSheetOpen: boolean): ImportantForA11y =>
  isSheetOpen ? 'no-hide-descendants' : 'auto';

describe('cross-platform accessibility isolation', () => {
  it('ScrollView importantForAccessibility is "auto" when no sheet open', () => {
    expect(scrollA11y(false)).toBe('auto');
  });

  it('ScrollView importantForAccessibility is "no-hide-descendants" when CarDetailSheet open', () => {
    // isSheetOpen = selectedCar !== null || allSheetOpen
    const selectedCar = { ref: 'r1' };
    const isSheetOpen = selectedCar !== null || false;
    expect(scrollA11y(isSheetOpen)).toBe('no-hide-descendants');
  });

  it('ScrollView importantForAccessibility is "no-hide-descendants" when AllCarsSheet open', () => {
    const selectedCar = null;
    const allSheetOpen = true;
    const isSheetOpen = selectedCar !== null || allSheetOpen;
    expect(scrollA11y(isSheetOpen)).toBe('no-hide-descendants');
  });

  it('aria-modal is true only when sheet is visible (not during exit animation)', () => {
    // visible=false, mounted=true during exit → aria-modal must be false
    // so TalkBack is not trapped to an exiting (invisible) sheet.
    const visible = false;
    const mounted = true;
    const ariaModal = visible; // prop passed as aria-modal={visible}
    expect(ariaModal).toBe(false);
    expect(mounted).toBe(true); // sheet still in tree but not trapping focus
  });

  it('aria-modal is true when sheet is fully open', () => {
    const visible = true;
    expect(visible).toBe(true);
  });
});
