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

const render = (defaultValue = '2026-10-12T21:00') =>
  act(() => {
    root.render(<DateTimeField name="startsAt" label="Início" defaultValue={defaultValue} />);
  });

const selects = () => Array.from(container.querySelectorAll('select'));
const hourSelect = () => selects()[0]!;
const minuteSelect = () => selects()[1]!;
const hiddenInput = () => container.querySelector<HTMLInputElement>('input[type="hidden"]')!;
const optionValues = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.value);

const pick = (el: HTMLSelectElement, value: string) => {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('DateTimeField time selects', () => {
  it('renders two 24h selects instead of a native time input', () => {
    render();
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(selects()).toHaveLength(2);
    expect(hourSelect().value).toBe('21');
    expect(minuteSelect().value).toBe('00');
  });

  it('offers every hour from 00 to 23 and minutes in 5-minute steps', () => {
    render();
    expect(optionValues(hourSelect())).toHaveLength(24);
    expect(optionValues(hourSelect())[0]).toBe('00');
    expect(optionValues(hourSelect())[23]).toBe('23');
    expect(optionValues(minuteSelect())).toEqual([
      '00',
      '05',
      '10',
      '15',
      '20',
      '25',
      '30',
      '35',
      '40',
      '45',
      '50',
      '55',
    ]);
  });

  // The bug this component was rewritten for: 9 AM used to be unreachable.
  it('sets 09:00 when the hour is changed from 21 to 09', () => {
    render('2026-10-12T21:00');
    pick(hourSelect(), '09');
    expect(hourSelect().value).toBe('09');
    expect(hiddenInput().value).toBe('2026-10-12T09:00');
  });

  it('changes the minute without disturbing the hour', () => {
    render('2026-10-12T09:00');
    pick(minuteSelect(), '30');
    expect(hiddenInput().value).toBe('2026-10-12T09:30');
    expect(hourSelect().value).toBe('09');
  });

  it('keeps both parts across consecutive edits', () => {
    render('2026-10-12T21:00');
    pick(hourSelect(), '08');
    pick(minuteSelect(), '45');
    expect(hiddenInput().value).toBe('2026-10-12T08:45');
  });

  it('keeps a saved off-grid minute selectable instead of rounding it', () => {
    render('2026-10-12T19:07');
    expect(minuteSelect().value).toBe('07');
    expect(hiddenInput().value).toBe('2026-10-12T19:07');
    expect(optionValues(minuteSelect())).toContain('07');
  });

  it('preserves the off-grid minute when only the hour changes', () => {
    render('2026-10-12T19:07');
    pick(hourSelect(), '09');
    expect(hiddenInput().value).toBe('2026-10-12T09:07');
  });
});
