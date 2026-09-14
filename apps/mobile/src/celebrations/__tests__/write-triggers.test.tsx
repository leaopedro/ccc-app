// @vitest-environment jsdom
//
// Task 12 — the write-triggered refresh. `requestCelebrationRefresh()` is
// what makes the celebration show up seconds after the action instead of up
// to a minute later on the push cron; these tests prove it fires on the two
// client-owned success paths (create car, post to feed) and does NOT fire
// when the underlying request fails. Check-in is deliberately not covered
// here — the admin scanner triggers that award, the member app has no local
// success handler to hook.
//
// react-native + react-native-svg are stubbed to jsdom-safe primitives, same
// shape as GarageIndexRoute.test.tsx / EditGarageSheet.test.tsx, so the real
// `@ccc/ui` Button (pulled in by the garage/new.tsx screen under test) can
// mount without hitting native-only modules. All vi.mock/vi.hoisted calls
// live at module top level (not nested in describe blocks) — vitest only
// reliably hoists them there.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const refreshBusMocks = vi.hoisted(() => ({
  requestCelebrationRefresh: vi.fn(),
}));

const carsMocks = vi.hoisted(() => ({
  createCar: vi.fn(),
  listCars: vi.fn(),
}));

const feedMocks = vi.hoisted(() => ({
  createFeedPost: vi.fn(),
  listFeedPosts: vi.fn(),
}));

vi.mock('~/celebrations/refresh-bus', () => ({
  requestCelebrationRefresh: refreshBusMocks.requestCelebrationRefresh,
  subscribeCelebrationRefresh: vi.fn(() => () => {}),
}));

vi.mock('~/api/cars', () => ({
  createCar: carsMocks.createCar,
  listCars: carsMocks.listCars,
}));

vi.mock('~/api/client', () => ({
  ApiError: class ApiError extends Error {},
}));

vi.mock('~/api/feed', () => ({
  createFeedPost: feedMocks.createFeedPost,
  listFeedPosts: feedMocks.listFeedPosts,
  patchFeedPost: vi.fn(),
  deleteFeedPost: vi.fn(),
  toggleFeedReaction: vi.fn(),
  removeFeedReaction: vi.fn(),
  blockPostAuthor: vi.fn(),
  reportFeedPost: vi.fn(),
}));

vi.mock('~/auth/context', () => ({
  useAuth: () => ({ status: 'authenticated', user: { role: 'user' } }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'https://api.test' } } },
}));

// Composer + post card are mocked out for the feed screen: this is a wiring
// test for the refresh trigger, not a re-test of the composer UI (covered
// elsewhere) or the badge-pulling post card (which drags in @ccc/ui +
// react-native-svg for no reason here).
vi.mock('~/screens/events/feed/FeedComposerSheet', async () => {
  const ReactMod = await import('react');
  return {
    FeedComposerSheet: (props: {
      visible: boolean;
      onSubmit: (body: string, carId: string | undefined) => void;
    }) =>
      props.visible
        ? ReactMod.createElement(
            'button',
            {
              'data-testid': 'mock-composer-submit',
              onClick: () => props.onSubmit('Primeira contribuicao', undefined),
            },
            'mock-submit',
          )
        : null,
  };
});

vi.mock('~/screens/events/feed/FeedPostCard', () => ({
  FeedPostCard: () => null,
}));

vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement(tag, { ref, ...props }),
    );
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    Pattern: make('pattern'),
    Rect: make('rect'),
    Line: make('line'),
    G: make('g'),
    Polygon: make('polygon'),
    Path: make('path'),
    LinearGradient: make('linearGradient'),
    Stop: make('stop'),
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
        accessibilityViewIsModal,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
        contentContainerStyle,
        refreshControl,
        keyboardType,
        placeholderTextColor,
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
      if (disabledFlag) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
      void contentContainerStyle;
      void accessibilityViewIsModal;
      void refreshControl;
      void keyboardType;
      void placeholderTextColor;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const TextInput = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const {
      value,
      onChangeText,
      accessibilityLabel,
      placeholder,
      multiline,
      maxLength,
      testID,
      ...rest
    } = props as {
      value?: string;
      onChangeText?: (next: string) => void;
      accessibilityLabel?: string;
      placeholder?: string;
      multiline?: boolean;
      maxLength?: number;
      testID?: string;
    };
    void rest;
    const tag = multiline ? 'textarea' : 'input';
    const aria: Record<string, unknown> = {};
    if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
    if (typeof testID === 'string') aria['data-testid'] = testID;
    return ReactMod.createElement(tag, {
      ref,
      value: value ?? '',
      placeholder,
      maxLength,
      ...aria,
      onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
    });
  });

  return {
    Pressable: make('button'),
    TouchableOpacity: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    ScrollView: make('div'),
    TextInput,
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  refreshBusMocks.requestCelebrationRefresh.mockClear();
  carsMocks.createCar.mockReset();
  carsMocks.listCars.mockReset();
  carsMocks.listCars.mockResolvedValue([]);
  feedMocks.createFeedPost.mockReset();
  feedMocks.listFeedPosts.mockReset();
  feedMocks.listFeedPosts.mockResolvedValue({ posts: [], page: 1, totalPages: 1 });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
});

// ---------------------------------------------------------------------------
// pede refresh depois de criar carro
// ---------------------------------------------------------------------------

describe('gatilho de escrita — criar carro', () => {
  const fillAndSubmit = async () => {
    const { default: NewCar } = await import('../../../app/(app)/garage/new');
    await act(async () => {
      root.render(<NewCar />);
      await flush();
    });

    const setValue = (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
      expect(input).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await act(async () => {
      setValue('Marca', 'Honda');
      setValue('Modelo', 'Civic');
      setValue('Apelido', 'Apelido1');
      await flush();
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Salvar',
    );
    expect(saveBtn).not.toBeUndefined();
    await act(async () => {
      saveBtn!.click();
      await flush();
      await flush();
    });
  };

  it('pede refresh depois de criar carro', async () => {
    carsMocks.createCar.mockResolvedValue({
      id: 'car_1',
      make: 'Honda',
      model: 'Civic',
      year: 2026,
      nickname: 'Apelido1',
      modifications: [],
      photo: null,
      photos: [],
      isPremiumActive: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await fillAndSubmit();

    expect(carsMocks.createCar).toHaveBeenCalledTimes(1);
    expect(refreshBusMocks.requestCelebrationRefresh).toHaveBeenCalledTimes(1);
  });

  it('NAO pede refresh quando criar carro falha', async () => {
    carsMocks.createCar.mockRejectedValue(new Error('network down'));

    await fillAndSubmit();

    expect(carsMocks.createCar).toHaveBeenCalledTimes(1);
    expect(refreshBusMocks.requestCelebrationRefresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pede refresh depois de postar no feed
// ---------------------------------------------------------------------------

describe('gatilho de escrita — postar no feed', () => {
  const openComposerAndSubmit = async () => {
    const { defaultFeedSettings } = await import('@ccc/shared/feed');
    const { EventFeedSection } = await import('../../screens/events/feed/EventFeedSection');
    await act(async () => {
      root.render(
        <EventFeedSection
          eventSlug="meu-evento"
          eventId="evt_1"
          feedSettings={{ ...defaultFeedSettings, feedAccess: 'public', postingAccess: 'attendees' }}
          ticketSource="purchase"
          embedded
        />,
      );
      await flush();
    });

    const entryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Compartilhe algo com a galera…',
    );
    expect(entryBtn).not.toBeUndefined();
    await act(async () => {
      entryBtn!.click();
      await flush();
    });

    const submitBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-composer-submit"]',
    );
    expect(submitBtn).not.toBeNull();
    await act(async () => {
      submitBtn!.click();
      await flush();
      await flush();
    });
  };

  it('pede refresh depois de postar no feed', async () => {
    feedMocks.createFeedPost.mockResolvedValue({
      id: 'post_1',
      eventId: 'evt_1',
      car: null,
      body: 'Primeira contribuicao',
      status: 'visible',
      isOwn: true,
      photos: [],
      reactions: { likes: 0, mine: false },
      commentCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await openComposerAndSubmit();

    expect(feedMocks.createFeedPost).toHaveBeenCalledTimes(1);
    expect(refreshBusMocks.requestCelebrationRefresh).toHaveBeenCalledTimes(1);
  });

  it('NAO pede refresh quando postar no feed falha', async () => {
    feedMocks.createFeedPost.mockRejectedValue(new Error('network down'));

    await openComposerAndSubmit();

    expect(feedMocks.createFeedPost).toHaveBeenCalledTimes(1);
    expect(refreshBusMocks.requestCelebrationRefresh).not.toHaveBeenCalled();
  });
});
