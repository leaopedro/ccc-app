// @vitest-environment jsdom
//
// HighlightsSection é puramente visual, então além do texto pinamos os gaps
// do handoff via o mesmo mecanismo `data-style` de HeroSection.test.tsx: o
// mock de `react-native` grava o style resolvido num atributo sintético que
// os testes leem com JSON.parse.

import type { HomeHighlight } from '@ccc/shared/home';
import type { EventSummary } from '@ccc/shared/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { HighlightsSection } from '../HighlightsSection';

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
        accessible,
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
      void accessible;
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

const HIGHLIGHTS: HomeHighlight[] = [
  {
    kind: 'event',
    title: 'Próximos encontros',
    subtitle: 'A agenda do clube.',
    imageUrl: null,
    linkPath: '/events',
    sortOrder: 0,
  },
  {
    kind: 'day_use',
    title: 'Day Use',
    subtitle: null,
    imageUrl: null,
    linkPath: null,
    sortOrder: 1,
  },
];

const EVENTS: EventSummary[] = [
  {
    id: 'evt_1',
    slug: 'encontro-de-verao',
    title: 'Encontro de Verão',
    coverUrl: null,
    startsAt: '2026-09-10T21:00:00.000Z',
    endsAt: '2026-09-11T01:00:00.000Z',
    venueName: null,
    city: 'Curitiba',
    stateCode: 'PR',
    type: 'meeting',
    status: 'published',
  },
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

describe('HighlightsSection', () => {
  it('renders the label, the kind eyebrow and every highlight', () => {
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={[]}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(container.textContent).toContain(inicioCopy.sections.highlights);
    expect(container.textContent).toContain(inicioCopy.highlightKind.event);
    expect(container.textContent).toContain(inicioCopy.highlightKind.day_use);
    expect(container.textContent).toContain('Próximos encontros');
    expect(container.textContent).toContain('A agenda do clube.');
    expect(container.textContent).toContain('Day Use');
  });

  it('passes the linkPath to onOpenLink for a linked highlight', () => {
    const onOpenLink = vi.fn();
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={[]}
        onOpenLink={onOpenLink}
        onOpenEvent={vi.fn()}
      />,
    );
    click('inicio-highlight-0');
    expect(onOpenLink).toHaveBeenCalledWith('/events');
  });

  it('does not call onOpenLink for a highlight without linkPath, and does not make it a press target', () => {
    const onOpenLink = vi.fn();
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={[]}
        onOpenLink={onOpenLink}
        onOpenEvent={vi.fn()}
      />,
    );
    // Catches: always wrapping the card body in an onPress callback (e.g.
    // `onPress={() => linkPath && onOpenLink(linkPath)}`), which would still
    // register a click handler on the card for a null-linkPath highlight
    // even though it never fires onOpenLink. FeatureCard renders a <div>
    // (not a <button>, no onClick) when onPress is undefined, so a real
    // click target must be absent entirely.
    const card = container.querySelector('[data-testid="inicio-highlight-1"]');
    expect(card?.tagName).toBe('DIV');
    click('inicio-highlight-1');
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('renders real events before curated highlights', () => {
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={EVENTS}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    // Catches: swapping the render order (highlights before events) — a test
    // that only checked both texts were present would still pass either way.
    const eventIndex = container.textContent?.indexOf('Encontro de Verão') ?? -1;
    const highlightIndex = container.textContent?.indexOf('Próximos encontros') ?? -1;
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    expect(highlightIndex).toBeGreaterThan(eventIndex);
  });

  it('passes the event slug to onOpenEvent when an event card is pressed', () => {
    const onOpenEvent = vi.fn();
    render(
      <HighlightsSection
        highlights={[]}
        events={EVENTS}
        onOpenLink={vi.fn()}
        onOpenEvent={onOpenEvent}
      />,
    );
    click('inicio-event-encontro-de-verao');
    expect(onOpenEvent).toHaveBeenCalledWith('encontro-de-verao');
  });

  it('renders formatted event dates via formatEventDateRange', () => {
    render(
      <HighlightsSection
        highlights={[]}
        events={EVENTS}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    // formatEventDateRange('2026-09-10T21:00:00.000Z', '2026-09-11T01:00:00.000Z')
    // renders a pt-BR weekday/day/month token; assert a fragment stable
    // across timezone rendering rather than the full localized string.
    expect(container.textContent).toContain('set');
  });

  it('renders the section when only highlights are present (events empty)', () => {
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={[]}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain('Próximos encontros');
  });

  it('renders the section when only events are present (highlights empty)', () => {
    render(
      <HighlightsSection
        highlights={[]}
        events={EVENTS}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain('Encontro de Verão');
  });

  it('renders nothing when both highlights and events are empty', () => {
    render(
      <HighlightsSection highlights={[]} events={[]} onOpenLink={vi.fn()} onOpenEvent={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
    // Catches: returning an empty styled <View> instead of an early `return
    // null;` — the assertion above alone would still pass for that mutation.
    expect(container.firstChild).toBeNull();
  });

  it('pins the handoff gap between the label and the card list', () => {
    render(
      <HighlightsSection
        highlights={HIGHLIGHTS}
        events={[]}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    const outer = container.querySelector('div[data-style]');
    // Catches: changing styles.wrap's gap away from 14.
    expect(styleOf(outer).gap).toBe(14);
    const list = outer?.querySelector('div[data-style]') ?? null;
    // Catches: changing styles.list's gap away from 12.
    expect(styleOf(list).gap).toBe(12);
  });

  it('renders an image for an event/highlight with a cover, and none for one without', () => {
    const eventWithCover: EventSummary = {
      ...EVENTS[0]!,
      coverUrl: 'https://cdn.example.com/evento.webp',
    };
    const highlightWithImage: HomeHighlight = {
      ...HIGHLIGHTS[0]!,
      imageUrl: 'https://cdn.example.com/destaque.webp',
    };
    render(
      <HighlightsSection
        // HIGHLIGHTS[1] (day_use) keeps imageUrl: null, exercising the
        // without-image branch alongside the two with-image fixtures above.
        highlights={[highlightWithImage, HIGHLIGHTS[1]!]}
        events={[eventWithCover]}
        onOpenLink={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );
    // The mock voids `source`, so the URL itself can't be asserted — only
    // that an <Image> rendered at all. Catches: deleting the event's
    // `coverUrl ? <Image/> : null` guard or the highlight's `imageUrl ? ... :
    // null` guard entirely (0 imgs instead of 2), and catches an inverted
    // guard on either one (which would produce 1 or 3 imgs instead of 2).
    expect(container.querySelectorAll('img').length).toBe(2);
  });
});
