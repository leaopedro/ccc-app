// @vitest-environment jsdom
//
// Regression: the modifications field used to derive its displayed text
// straight from the parsed array (`value.join(', ')`). Every keystroke
// re-parsed, dropped the empty segment after the comma, and re-rendered the
// comma away — so a second item could never be typed. These tests pin the
// raw text as local state while still reporting the parsed array upward.
//
// react-native is stubbed to jsdom primitives, same shape as
// celebrations/__tests__/write-triggers.test.tsx.

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    Text: (props: Record<string, unknown>) => {
      const { children, variant, tone, className, ...rest } = props as {
        children?: unknown;
        variant?: string;
        tone?: string;
        className?: string;
      };
      void variant;
      void tone;
      void className;
      return ReactMod.createElement('span', rest, children as never);
    },
  };
});

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { style, className, testID, ...rest } = props;
      void style;
      const aria: Record<string, unknown> = {};
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const TextInput = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const { value, onChangeText, accessibilityLabel, style, className, placeholderTextColor } =
      props as {
        value?: string;
        onChangeText?: (next: string) => void;
        accessibilityLabel?: string;
        style?: unknown;
        className?: string;
        placeholderTextColor?: string;
      };
    void style;
    void className;
    void placeholderTextColor;
    return ReactMod.createElement('input', {
      ref,
      value: value ?? '',
      'aria-label': accessibilityLabel,
      onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
    });
  });

  return {
    View: make('div'),
    Text: make('span'),
    TextInput,
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

const { ModificationsField } = await import('../ModificationsField');

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

const input = (): HTMLInputElement => {
  const el = container.querySelector('input');
  if (!el) throw new Error('input not found');
  return el as HTMLInputElement;
};

const type = (next: string): void => {
  act(() => {
    const el = input();
    // React listens on the native value setter, so a plain `el.value = next`
    // would not notify it. Same idiom as EditGarageSheet.test.tsx.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc?.set) desc.set.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Renders the field the way a react-hook-form Controller does: value above. */
const renderControlled = (
  initial: string[],
): { current: string[]; reset: (next: string[]) => void } => {
  const state: { current: string[]; reset: (next: string[]) => void } = {
    current: initial,
    reset: () => {},
  };
  const Host = () => {
    const [value, setValue] = useState(initial);
    state.current = value;
    state.reset = setValue;
    return createElement(ModificationsField, { value, onChange: setValue, error: undefined });
  };
  act(() => root.render(createElement(Host)));
  return state;
};

describe('ModificationsField', () => {
  it('keeps the comma visible so a second item can be typed', () => {
    const state = renderControlled([]);
    type('turbo');
    expect(input().value).toBe('turbo');

    type('turbo,');
    expect(input().value).toBe('turbo,');
    expect(state.current).toEqual(['turbo']);
  });

  it('keeps the space after the comma', () => {
    renderControlled([]);
    type('turbo,');
    type('turbo, ');
    expect(input().value).toBe('turbo, ');
  });

  it('reports every item once the second one is typed', () => {
    const state = renderControlled([]);
    type('turbo,');
    type('turbo, ');
    type('turbo, rodas');
    expect(input().value).toBe('turbo, rodas');
    expect(state.current).toEqual(['turbo', 'rodas']);
  });

  it('seeds the text from an existing value', () => {
    renderControlled(['turbo', 'rodas']);
    expect(input().value).toBe('turbo, rodas');
  });

  it('replaces the text when the form resets from outside', () => {
    const state = renderControlled([]);
    type('turbo, rod');
    act(() => state.reset(['motor', 'escape']));
    expect(input().value).toBe('motor, escape');
  });

  it('renders a pill per parsed item', () => {
    renderControlled([]);
    type('turbo, rodas');
    const pills = Array.from(container.querySelectorAll('span'))
      .map((n) => n.textContent)
      .filter((t) => t === 'turbo' || t === 'rodas');
    expect(pills).toEqual(['turbo', 'rodas']);
  });
});
