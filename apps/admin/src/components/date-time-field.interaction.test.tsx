// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { DateTimeField } = await import('./date-time-field');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (defaultValue = '2026-10-12T19:00') =>
  act(() => {
    root.render(<DateTimeField name="endsAt" label="Fim" defaultValue={defaultValue} />);
  });

const timeInput = () => container.querySelector<HTMLInputElement>('input[type="text"]')!;
const hiddenInput = () => container.querySelector<HTMLInputElement>('input[type="hidden"]')!;

// Go through the prototype setter so React's value tracker sees the change.
const typeTime = (raw: string) => {
  const input = timeInput();
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  /* eslint-disable @typescript-eslint/unbound-method -- intentional: invoke
     the prototype setter on `input` to bypass React's value tracker. */
  const setter = descriptor?.set;
  /* eslint-enable @typescript-eslint/unbound-method */
  act(() => {
    setter?.call(input, raw);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const blurTime = () => {
  act(() => {
    timeInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
};

describe('DateTimeField time input', () => {
  it('renders 24h text, not a native time input', () => {
    render();
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(timeInput().value).toBe('19:00');
  });

  it('masks digits into HH:MM as the user types', () => {
    render();
    typeTime('0');
    expect(timeInput().value).toBe('0');
    typeTime('09');
    expect(timeInput().value).toBe('09');
    typeTime('093');
    expect(timeInput().value).toBe('09:3');
    typeTime('0930');
    expect(timeInput().value).toBe('09:30');
  });

  it('strips non-digits and extra digits', () => {
    render();
    typeTime('9a3:0pm55');
    expect(timeInput().value).toBe('93:05');
  });

  it('commits a valid 24h time to the hidden field on blur', () => {
    render();
    typeTime('2345');
    blurTime();
    expect(timeInput().value).toBe('23:45');
    expect(hiddenInput().value).toBe('2026-10-12T23:45');
  });

  it('clamps out-of-range hours and minutes on blur', () => {
    render();
    typeTime('9999');
    blurTime();
    expect(timeInput().value).toBe('23:59');
    expect(hiddenInput().value).toBe('2026-10-12T23:59');
  });

  it('reverts to the last committed time when input is incomplete', () => {
    render();
    typeTime('7');
    blurTime();
    expect(timeInput().value).toBe('19:00');
    expect(hiddenInput().value).toBe('2026-10-12T19:00');
  });

  it('keeps the committed time after a later incomplete edit', () => {
    render();
    typeTime('0815');
    blurTime();
    expect(hiddenInput().value).toBe('2026-10-12T08:15');
    typeTime('');
    blurTime();
    expect(timeInput().value).toBe('08:15');
    expect(hiddenInput().value).toBe('2026-10-12T08:15');
  });
});
