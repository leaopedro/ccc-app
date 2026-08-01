// @vitest-environment jsdom
//
// EditGarageSheet tests. Focus on the error-mapping branches: §C7 added a
// `400 { error: 'invalid_slug' }` API response that has to map to the new
// `invalidSlug` copy, alongside the existing `reserved_slug` (400) and
// `slug_taken` (409) paths.
//
// react-native primitives are stubbed (Modal/ScrollView/Switch/TextInput
// included because the sheet form uses them transitively through `SheetShell`).

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
        animationType,
        transparent,
        onRequestClose,
        placeholderTextColor,
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
      void style;
      void hitSlop;
      void numberOfLines;
      void animationType;
      void transparent;
      void onRequestClose;
      void accessibilityViewIsModal;
      void placeholderTextColor;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  // Modal renders children only when `visible` is true so closed sheets
  // produce empty containers in test assertions.
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

  // Switch + TextInput render as native inputs so we can drive them with
  // onChange + assert error messages mapped from props.
  const Switch = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const { value, onValueChange, ...rest } = props as {
      value?: boolean;
      onValueChange?: (next: boolean) => void;
    };
    void rest;
    return ReactMod.createElement('input', {
      ref,
      type: 'checkbox',
      checked: !!value,
      onChange: (e: { target: { checked: boolean } }) => onValueChange?.(e.target.checked),
    });
  });

  const TextInput = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const { value, onChangeText, placeholder, multiline, maxLength, testID, ...rest } = props as {
      value?: string;
      onChangeText?: (next: string) => void;
      placeholder?: string;
      multiline?: boolean;
      maxLength?: number;
      testID?: string;
    };
    void rest;
    const tag = multiline ? 'textarea' : 'input';
    return ReactMod.createElement(tag, {
      ref,
      value: value ?? '',
      placeholder,
      maxLength,
      'data-testid': testID,
      onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
    });
  });

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    ScrollView: make('div'),
    Modal,
    Switch,
    TextInput,
    Share: { share: vi.fn() },
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

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

// `patchGarage` is the only API call we touch. Mock it per-test by reassigning
// the mock implementation.
const patchGarageMock = vi.fn();
vi.mock('~/api/garage', () => ({
  patchGarage: (...args: unknown[]) => patchGarageMock(...args) as Promise<unknown>,
}));

// Stub `~/api/client` so we don't pull `expo-constants` → `expo-modules-core`
// (which references `__DEV__` and blows up under jsdom). Re-export a minimal
// ApiError so production error-mapping branches still match `instanceof`.
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
  return { ApiError };
});

// Suppress the toast helper so we can assert without DOM side effects.
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

const findButtonByText = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btns = Array.from(root.querySelectorAll('button'));
  const found = btns.find((b) => b.textContent === label);
  if (!found) throw new Error(`button "${label}" not found`);
  return found;
};

// Drive a controlled input via React's native valueTracker so the synthetic
// onChange picks up the new value. Plain `input.value = X` doesn't work for
// controlled inputs because React skips the event when its internal tracker
// thinks the value hasn't changed.
const setReactInputValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) {
    desc.set.call(input, value);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('EditGarageSheet', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    patchGarageMock.mockReset();
    showMessageMock.mockReset();
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
  };

  it('renders sheet title + initial values when visible', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    await renderEl(
      <EditGarageSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Editar Garagem');
    // Initial name + slug are pre-populated
    const inputs = container.querySelectorAll('input');
    expect(inputs[0]?.getAttribute('value') ?? '').toBe('Minha Garagem');
    expect(inputs[1]?.getAttribute('value') ?? '').toBe('minha-garagem');
  });

  it('renders nothing when visible=false', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    await renderEl(
      <EditGarageSheet
        visible={false}
        garage={baseGarage}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(container.textContent ?? '').toBe('');
  });

  it('shows invalidSlug copy when API returns 400 { error: "invalid_slug" }', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    const { ApiError } = await import('~/api/client');
    patchGarageMock.mockRejectedValueOnce(
      new ApiError(400, 'Request failed: 400', { error: 'invalid_slug' }),
    );

    await renderEl(
      <EditGarageSheet
        visible
        garage={{ ...baseGarage, name: 'X' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    // Force a diff so the patch fires: change the name input.
    const inputs = container.querySelectorAll('input');
    const nameInput = inputs[0] as HTMLInputElement;
    await act(async () => {
      setReactInputValue(nameInput, 'Renamed');
      await flush();
    });

    const save = findButtonByText(container, 'Salvar');
    await act(async () => {
      save.click();
      await flush();
    });
    expect(patchGarageMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      'URL pode usar apenas letras minúsculas, números e hífens.',
    );
    expect(showMessageMock).not.toHaveBeenCalled();
  });

  it('shows reservedSlug copy when API returns 400 { error: "reserved_slug" }', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    const { ApiError } = await import('~/api/client');
    patchGarageMock.mockRejectedValueOnce(
      new ApiError(400, 'Request failed: 400', { error: 'reserved_slug' }),
    );

    await renderEl(
      <EditGarageSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const inputs = container.querySelectorAll('input');
    const nameInput = inputs[0] as HTMLInputElement;
    await act(async () => {
      setReactInputValue(nameInput, 'Renamed');
      await flush();
    });

    const save = findButtonByText(container, 'Salvar');
    await act(async () => {
      save.click();
      await flush();
    });
    expect(container.textContent).toContain('Esta URL não está disponível. Escolha outra.');
  });

  it('shows slugTaken copy on 409', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    const { ApiError } = await import('~/api/client');
    patchGarageMock.mockRejectedValueOnce(new ApiError(409, 'Request failed: 409', null));

    await renderEl(
      <EditGarageSheet
        visible
        garage={baseGarage}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const inputs = container.querySelectorAll('input');
    const nameInput = inputs[0] as HTMLInputElement;
    await act(async () => {
      setReactInputValue(nameInput, 'Renamed');
      await flush();
    });

    const save = findButtonByText(container, 'Salvar');
    await act(async () => {
      save.click();
      await flush();
    });
    expect(container.textContent).toContain('Esta URL já está em uso. Escolha outra.');
  });

  it('closes without firing patchGarage when nothing changed', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    const onClose = vi.fn();
    await renderEl(
      <EditGarageSheet visible garage={baseGarage} onClose={onClose} onSaved={() => undefined} />,
    );
    const save = findButtonByText(container, 'Salvar');
    await act(async () => {
      save.click();
      await flush();
    });
    expect(patchGarageMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('forwards saved garage to onSaved and shows success toast', async () => {
    const { EditGarageSheet } = await import('../EditGarageSheet');
    const next = { ...baseGarage, name: 'Outra' };
    patchGarageMock.mockResolvedValueOnce({ garage: next });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    await renderEl(
      <EditGarageSheet visible garage={baseGarage} onClose={onClose} onSaved={onSaved} />,
    );
    const inputs = container.querySelectorAll('input');
    const nameInput = inputs[0] as HTMLInputElement;
    await act(async () => {
      setReactInputValue(nameInput, 'Outra');
      await flush();
    });
    const save = findButtonByText(container, 'Salvar');
    await act(async () => {
      save.click();
      await flush();
    });
    expect(patchGarageMock).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(next);
    expect(showMessageMock).toHaveBeenCalledWith('Garagem atualizada.');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
