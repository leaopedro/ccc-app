// @vitest-environment jsdom
//
// PlansSection é puramente visual, então além do texto pinamos os gaps do
// handoff via o mesmo mecanismo `data-style` de HeroSection.test.tsx: o mock
// de `react-native` grava o style resolvido num atributo sintético que os
// testes leem com JSON.parse. `Check` (lucide-react-native) é redirecionado
// ao stub em apps/mobile/vitest.config.ts.

import type { HomePlan } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';
import { TIER_VISUAL } from '~/screens/assinaturas/tier-visual';

import { PlansSection } from '../PlansSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const resolveStyle = (style: unknown): Record<string, unknown> | undefined => {
  const resolved =
    typeof style === 'function' ? (style as (s: unknown) => unknown)({ pressed: false }) : style;
  if (Array.isArray(resolved)) {
    return resolved.reduce<Record<string, unknown>>(
      (acc, entry) => (entry ? { ...acc, ...(entry as Record<string, unknown>) } : acc),
      {},
    );
  }
  return resolved as Record<string, unknown> | undefined;
};

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityRole,
        testID,
        onPress,
        hitSlop,
        pointerEvents,
        resizeMode,
        source,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void className;
      void hitSlop;
      void pointerEvents;
      void resizeMode;
      void source;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

const PLANS: HomePlan[] = [
  {
    tier: 'bronze',
    slug: 'bronze',
    name: 'Bronze',
    description: 'Entrada no clube.',
    fromAmountCents: 19900,
    currency: 'BRL',
    benefits: ['Eventos abertos', 'Day Use avulso'],
    sortOrder: 0,
  },
  {
    tier: 'gold',
    slug: 'ouro',
    name: 'Ouro',
    description: null,
    fromAmountCents: 49900,
    currency: 'BRL',
    benefits: ['Day Use ilimitado', 'Vaga na garagem', 'Caixa mensal'],
    sortOrder: 1,
  },
];

// Dedicated fixture covering all three tiers, only for the accent-pin test
// below — the two-plan PLANS fixture above (bronze + gold) does not exercise
// silver, and a bronze/silver accent swap would slip past a bronze/gold-only
// comparison.
const PLANS_ALL_TIERS: HomePlan[] = [
  { ...PLANS[0]! },
  {
    tier: 'silver',
    slug: 'prata',
    name: 'Prata',
    description: null,
    fromAmountCents: 29900,
    currency: 'BRL',
    benefits: ['Day Use ilimitado'],
    sortOrder: 1,
  },
  { ...PLANS[1]! },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const styleOf = (el: Element | null): Record<string, unknown> =>
  JSON.parse(el?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('PlansSection', () => {
  it('renders the label, plan names, formatted starting price and benefits', () => {
    render(<PlansSection plans={PLANS} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.sections.plans);
    expect(container.textContent).toContain('Bronze');
    expect(container.textContent).toContain('Ouro');
    expect(container.textContent).toContain(inicioCopy.plans.from);
    expect(container.textContent).toContain('199');
    expect(container.textContent).toContain('Day Use ilimitado');
    expect(container.textContent).toContain('Entrada no clube.');
  });

  it('passes the plan slug (not the tier) to onOpenPlan', () => {
    const onOpenPlan = vi.fn();
    render(<PlansSection plans={PLANS} onOpenPlan={onOpenPlan} onSeeAll={vi.fn()} />);
    click('inicio-plan-ouro');
    // Catches: sending plan.tier ('gold') instead of plan.slug ('ouro') to
    // onOpenPlan — the two differ for this fixture on purpose.
    expect(onOpenPlan).toHaveBeenCalledWith('ouro');
  });

  it('fires onSeeAll from the footer link', () => {
    const onSeeAll = vi.fn();
    render(<PlansSection plans={PLANS} onOpenPlan={vi.fn()} onSeeAll={onSeeAll} />);
    click('inicio-plans-see-all');
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there are no featured plans', () => {
    render(<PlansSection plans={[]} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container.textContent).toBe('');
    // Catches: returning an empty styled <View> instead of an early `return
    // null;` — the assertion above alone would still pass for that mutation.
    expect(container.firstChild).toBeNull();
  });

  it('pins the card list gap and the per-plan card gap from the handoff', () => {
    render(<PlansSection plans={PLANS} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    const outer = container.querySelector('div[data-style]');
    // Catches: changing styles.list's gap away from 12.
    const list = outer?.querySelector('div[data-style]') ?? null;
    expect(styleOf(list).gap).toBe(12);
    // Catches: changing styles.card's borderRadius away from 14.
    const card = list?.querySelector('button[data-style]') ?? null;
    expect(styleOf(card).borderRadius).toBe(14);
  });

  it('pins the per-tier accent dot colour to TIER_VISUAL, for every tier', () => {
    render(<PlansSection plans={PLANS_ALL_TIERS} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    // The dot is the only <div data-style> under each plan's card whose
    // resolved style carries `width: 8` (styles.dot merged with the inline
    // `{ backgroundColor: accent }` override).
    const dotAccent = (testID: string): unknown => {
      const card = container.querySelector(`[data-testid="${testID}"]`);
      const dot = Array.from(card?.querySelectorAll('div[data-style]') ?? []).find(
        (el) => styleOf(el).width === 8,
      );
      return styleOf(dot ?? null).backgroundColor;
    };
    // Catches: hardcoding TIER_ACCENT back into PlansSection.tsx instead of
    // reading TIER_VISUAL (a silent drift the moment tier-visual.ts changes),
    // and catches swapping any two tiers' accents (bronze/silver,
    // bronze/gold or silver/gold), since each assertion is checked against
    // the actual entry for that specific tier, not a hardcoded copy.
    expect(dotAccent('inicio-plan-bronze')).toBe(TIER_VISUAL.bronze.accent);
    expect(dotAccent('inicio-plan-prata')).toBe(TIER_VISUAL.silver.accent);
    expect(dotAccent('inicio-plan-ouro')).toBe(TIER_VISUAL.gold.accent);
  });
});
