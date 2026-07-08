// @vitest-environment jsdom
//
// CoverPickerSheet tests. Focus on the §C11 locked-tile contract: free users
// MUST get the premium upsell instead of a dead-tap when they press a
// premium preset OR the upload tile. Plus a happy-path preset-select case.
//
// react-native + Modal/Image are stubbed to plain HTML tags so jsdom can
// render them; api + upload-image modules are mocked per-test.

import type { GarageOwner } from '@ccc/shared/garage';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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
        resizeMode,
        animationType,
        transparent,
        onRequestClose,
        contentContainerStyle,
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
      if (
        source &&
        typeof source === 'object' &&
        typeof (source as { uri?: unknown }).uri === 'string'
      ) {
        aria['data-src'] = (source as { uri: string }).uri;
      }
      void style;
      void hitSlop;
      void numberOfLines;
      void resizeMode;
      void animationType;
      void transparent;
      void onRequestClose;
      void accessibilityViewIsModal;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID, ...rest } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
      };
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void rest;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    Modal,
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

// `@ccc/ui`'s barrel re-exports `ParkingStallCard`, which imports SVG
// primitives. Stub them to inert tags so jsdom doesn't blow up loading the
// SheetShell + garageTokens we actually use.
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
  };
});

// Stub the API client so we don't pull `expo-constants` → `expo-modules-core`
// (references `__DEV__`, blows up under jsdom).
vi.mock('~/api/client', () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly body?: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, authedRequest: vi.fn() };
});

// 10-preset catalog returned by `getCoverPresets`. Marks `tokyo-wangan` and
// the rest as premium per the canonical shared catalog, leaves `default-door`
// free.
const FIXTURE_PRESETS = [
  { slug: 'default-door', label: 'Garagem Padrão', premium: false },
  { slug: 'tokyo-wangan', label: 'Tokyo Wangan', premium: true },
  { slug: 'kanjo-loop', label: 'Kanjo Loop', premium: true },
  { slug: 'touge-pass', label: 'Touge Pass', premium: true },
  { slug: 'tsukuba-dawn', label: 'Tsukuba Dawn', premium: true },
  { slug: 'drift-smoke', label: 'Drift Smoke', premium: true },
  { slug: 'workshop', label: 'Workshop', premium: true },
  { slug: 'autobahn-blue', label: 'Autobahn', premium: true },
  { slug: 'vintage-meet', label: 'Vintage Meet', premium: true },
  { slug: 'monaco-marble', label: 'Monaco', premium: true },
].map((p) => ({ ...p, imageUrl: `https://r2.example/garage-cover-presets/${p.slug}@2x.jpg` }));

const getCoverPresetsMock = vi.fn();
const patchGarageCoverMock = vi.fn();
vi.mock('~/api/garage', () => ({
  getCoverPresets: (...args: unknown[]) => getCoverPresetsMock(...args) as Promise<unknown>,
  patchGarageCover: (...args: unknown[]) => patchGarageCoverMock(...args) as Promise<unknown>,
}));

const requestGarageCoverUploadMock = vi.fn();
vi.mock('~/api/uploads', () => ({
  requestGarageCoverUpload: (...args: unknown[]) =>
    requestGarageCoverUploadMock(...args) as Promise<unknown>,
}));

const pickImageMock = vi.fn();
const uploadBlobToR2Mock = vi.fn();
vi.mock('~/lib/upload-image', () => ({
  pickImage: (...args: unknown[]) => pickImageMock(...args) as Promise<unknown>,
  uploadBlobToR2: (...args: unknown[]) => uploadBlobToR2Mock(...args) as Promise<unknown>,
}));

const showMessageMock = vi.fn();
vi.mock('~/lib/confirm', () => ({
  showMessage: (...args: unknown[]): void => {
    showMessageMock(...args);
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const baseGarage: GarageOwner = {
  id: 'g1',
  name: 'Minha Garagem',
  slug: 'minha-garagem',
  description: null,
  isPublic: false,
  premiumTier: null,
  premiumUntil: null,
  isPremiumActive: false,
  coverPreset: null,
  coverImageObjectKey: null,
  coverImageUrl: null,
  daysLeftUntilExpiry: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  gamification: { enabled: true },
  badges: [],
};

const findButtonByA11y = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btns = Array.from(root.querySelectorAll('button'));
  const found = btns.find((b) => b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`button with aria-label "${label}" not found`);
  return found;
};

describe('CoverPickerSheet', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getCoverPresetsMock.mockReset();
    patchGarageCoverMock.mockReset();
    requestGarageCoverUploadMock.mockReset();
    pickImageMock.mockReset();
    uploadBlobToR2Mock.mockReset();
    showMessageMock.mockReset();
    getCoverPresetsMock.mockResolvedValue({ presets: FIXTURE_PRESETS });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderEl = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
    // Catalog loads via useEffect → setState; flush once more so the second
    // render commits before we query the DOM.
    await act(async () => {
      await flush();
    });
  };

  it('fires onPremiumUpsell (not patch) when a free user taps a premium preset', async () => {
    const { CoverPickerSheet } = await import('../CoverPickerSheet');
    const onPremiumUpsell = vi.fn();
    const onCoverChanged = vi.fn();
    await renderEl(
      <CoverPickerSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onCoverChanged={onCoverChanged}
        onPremiumUpsell={onPremiumUpsell}
      />,
    );

    const tile = findButtonByA11y(container, 'Tokyo Wangan');
    await act(async () => {
      tile.click();
      await flush();
    });

    expect(onPremiumUpsell).toHaveBeenCalledTimes(1);
    expect(patchGarageCoverMock).not.toHaveBeenCalled();
    expect(onCoverChanged).not.toHaveBeenCalled();
  });

  it('PATCHes coverPreset and calls onCoverChanged when free user taps the default-door tile', async () => {
    const { CoverPickerSheet } = await import('../CoverPickerSheet');
    const next: GarageOwner = {
      ...baseGarage,
      coverPreset: 'default-door',
      coverImageUrl: null,
      coverImageObjectKey: null,
    };
    patchGarageCoverMock.mockResolvedValueOnce({ garage: next });

    const onPremiumUpsell = vi.fn();
    const onCoverChanged = vi.fn();
    await renderEl(
      <CoverPickerSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onCoverChanged={onCoverChanged}
        onPremiumUpsell={onPremiumUpsell}
      />,
    );

    const tile = findButtonByA11y(container, 'Garagem Padrão');
    await act(async () => {
      tile.click();
      await flush();
    });

    expect(patchGarageCoverMock).toHaveBeenCalledTimes(1);
    expect(patchGarageCoverMock).toHaveBeenCalledWith({ coverPreset: 'default-door' });
    expect(onCoverChanged).toHaveBeenCalledWith(next);
    expect(onPremiumUpsell).not.toHaveBeenCalled();
  });

  it('fires onPremiumUpsell (not presign) when a free user taps the upload tile', async () => {
    const { CoverPickerSheet } = await import('../CoverPickerSheet');
    const onPremiumUpsell = vi.fn();
    await renderEl(
      <CoverPickerSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onCoverChanged={() => undefined}
        onPremiumUpsell={onPremiumUpsell}
      />,
    );

    const tile = findButtonByA11y(container, 'Enviar imagem');
    await act(async () => {
      tile.click();
      await flush();
    });

    expect(onPremiumUpsell).toHaveBeenCalledTimes(1);
    expect(requestGarageCoverUploadMock).not.toHaveBeenCalled();
    expect(pickImageMock).not.toHaveBeenCalled();
  });

  it('uploads via presign + R2 PUT + PATCH coverImageObjectKey when premium user picks an image', async () => {
    const { CoverPickerSheet } = await import('../CoverPickerSheet');

    const premiumGarage: GarageOwner = {
      ...baseGarage,
      premiumTier: 'gold',
      premiumUntil: '2099-01-01T00:00:00.000Z',
      isPremiumActive: true,
      daysLeftUntilExpiry: 365,
    };
    const next: GarageOwner = {
      ...premiumGarage,
      coverPreset: null,
      coverImageObjectKey: 'garage-cover/u1/abc.jpg',
      coverImageUrl: 'https://r2.example/garage-cover/u1/abc.jpg',
    };

    pickImageMock.mockResolvedValueOnce({
      uri: 'file:///tmp/picked.jpg',
      mime: 'image/jpeg',
      size: 123456,
      width: 1600,
      height: 600,
    });
    const blob = { size: 123456 } as Blob;
    const fetchMock = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(blob),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    requestGarageCoverUploadMock.mockResolvedValueOnce({
      uploadUrl: 'https://r2.example/upload?sig=x',
      objectKey: 'garage-cover/u1/abc.jpg',
      publicUrl: 'https://r2.example/garage-cover/u1/abc.jpg',
      expiresAt: '2099-01-01T00:00:00.000Z',
      headers: { 'x-amz-meta-kind': 'garage_cover' },
    });
    uploadBlobToR2Mock.mockResolvedValueOnce(undefined);
    patchGarageCoverMock.mockResolvedValueOnce({ garage: next });

    const onPremiumUpsell = vi.fn();
    const onCoverChanged = vi.fn();
    await renderEl(
      <CoverPickerSheet
        visible
        garage={premiumGarage}
        onClose={() => undefined}
        onCoverChanged={onCoverChanged}
        onPremiumUpsell={onPremiumUpsell}
      />,
    );

    const tile = findButtonByA11y(container, 'Enviar imagem');
    await act(async () => {
      tile.click();
      await flush();
    });
    // Two more flushes for the chained awaits in handleUpload
    // (pickImage → fetch.blob → requestGarageCoverUpload → uploadBlobToR2 → patchGarageCover).
    await act(async () => {
      await flush();
    });
    await act(async () => {
      await flush();
    });

    expect(pickImageMock).toHaveBeenCalledTimes(1);
    expect(requestGarageCoverUploadMock).toHaveBeenCalledTimes(1);
    expect(requestGarageCoverUploadMock).toHaveBeenCalledWith({
      contentType: 'image/jpeg',
      size: 123456,
    });
    expect(uploadBlobToR2Mock).toHaveBeenCalledTimes(1);
    expect(uploadBlobToR2Mock).toHaveBeenCalledWith(
      blob,
      expect.objectContaining({ objectKey: 'garage-cover/u1/abc.jpg' }),
    );
    expect(patchGarageCoverMock).toHaveBeenCalledTimes(1);
    expect(patchGarageCoverMock).toHaveBeenCalledWith({
      coverImageObjectKey: 'garage-cover/u1/abc.jpg',
    });
    // Locked-contract assertion: PATCH body MUST NOT carry coverImageUrl
    // (§C1 — server only accepts coverPreset | coverImageObjectKey).
    const patchArg = patchGarageCoverMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patchArg).not.toHaveProperty('coverImageUrl');
    expect(onCoverChanged).toHaveBeenCalledWith(next);
    expect(onPremiumUpsell).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
