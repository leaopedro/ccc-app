'use client';

import { useRef } from 'react';

type Props = {
  name: string;
  label: string;
  defaultValue?: string;
  'data-testid'?: string;
};

/**
 * input[type=date] with a click/focus handler that opens the native calendar
 * from anywhere in the field, not just the tiny picker icon. showPicker()
 * isn't in every browser and throws without user activation, so it's
 * feature-detected and wrapped in try/catch — a failure just leaves the
 * plain input, it never throws out of this component.
 */
export function DateField({ name, label, defaultValue, 'data-testid': testId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input || typeof input.showPicker !== 'function') return;
    try {
      input.showPicker();
    } catch {
      // No user activation, unsupported browser, etc. — degrade to plain input.
    }
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
      {label}
      <input
        ref={inputRef}
        type="date"
        name={name}
        defaultValue={defaultValue ?? ''}
        onClick={openPicker}
        onFocus={openPicker}
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
        data-testid={testId}
      />
    </label>
  );
}
