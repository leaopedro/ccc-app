// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { GeneralSettings } from '@ccc/shared/general-settings';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
}));

vi.mock('~/lib/general-settings-actions', () => ({
  updateAdminGeneralSettingsAction: updateMock,
}));

import { GeneralSettingsForm } from './general-settings-form';

const initial: GeneralSettings = {
  id: 'general_default',
  capacityDisplay: {
    tickets: { mode: 'absolute', thresholdPercent: 15 },
    extras: { mode: 'absolute', thresholdPercent: 15 },
    products: { mode: 'absolute', thresholdPercent: 15 },
  },
  defaultFreeGarageSpots: 5,
  gamificationEnabled: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const findGarageValueInput = (): HTMLInputElement =>
  container.querySelector('input[aria-label="Vagas grátis por usuário"]') as HTMLInputElement;

const findUnlimitedCheckbox = (): HTMLInputElement =>
  container.querySelector(
    'input[aria-label="Vagas de garagem grátis ilimitadas"]',
  ) as HTMLInputElement;

const findAlert = (): HTMLElement | null => container.querySelector('[role="alert"]');

// React's onChange reads through a value tracker installed on the prototype;
// setting `input.value = ...` directly bypasses it. Use the native setter so
// React fires `onChange` like a real user keystroke would.
const setInputValue = (input: HTMLInputElement, value: string) => {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  /* eslint-disable @typescript-eslint/unbound-method -- intentional: invoke
     the prototype setter on `input` to bypass React's value tracker. */
  const setter = descriptor?.set;
  if (setter) {
    setter.call(input, value);
  }
  /* eslint-enable @typescript-eslint/unbound-method */
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  updateMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('GeneralSettingsForm — empty garage input safety', () => {
  it('blocks submit when garage value is cleared and Unlimited is unchecked', async () => {
    await act(async () => {
      root.render(<GeneralSettingsForm initial={initial} />);
      await Promise.resolve();
    });

    // Sanity: unlimited starts unchecked because initial has a numeric cap.
    expect(findUnlimitedCheckbox().checked).toBe(false);

    // Clear the field.
    const input = findGarageValueInput();
    act(() => {
      setInputValue(input, '');
    });

    // Submit.
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    // The action must not be called — otherwise Number('') = 0 would silently
    // downgrade the global cap from 5 to 0.
    expect(updateMock).not.toHaveBeenCalled();

    // A visible validation error must surface.
    const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
    expect(alerts.some((el) => /inteiro maior ou igual a zero/i.test(el.textContent ?? ''))).toBe(
      true,
    );
    expect(findAlert()).not.toBeNull();
  });

  it('submits the parsed integer when garage value is a valid non-empty number', async () => {
    updateMock.mockResolvedValue({
      ok: true,
      settings: { ...initial, defaultFreeGarageSpots: 7 },
    });

    await act(async () => {
      root.render(<GeneralSettingsForm initial={initial} />);
      await Promise.resolve();
    });

    const input = findGarageValueInput();
    act(() => {
      setInputValue(input, '7');
    });

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]![0]).toMatchObject({ defaultFreeGarageSpots: 7 });
  });
});
