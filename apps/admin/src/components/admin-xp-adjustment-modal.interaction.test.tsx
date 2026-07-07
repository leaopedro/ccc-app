// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminXpAdjustmentModal,
  type AdminXpAdjustmentSubmitResult,
} from './admin-xp-adjustment-modal';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const renderModal = async (props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { delta: number; reason: string }) => Promise<AdminXpAdjustmentSubmitResult>;
  gamificationDisabled?: boolean;
}) => {
  await act(async () => {
    const baseProps = {
      userId: 'u_1',
      open: props.open,
      onClose: props.onClose,
      onSubmit: props.onSubmit,
    };
    root.render(
      props.gamificationDisabled === undefined ? (
        <AdminXpAdjustmentModal {...baseProps} />
      ) : (
        <AdminXpAdjustmentModal {...baseProps} gamificationDisabled={props.gamificationDisabled} />
      ),
    );
    await Promise.resolve();
  });
};

const findInput = (label: 'delta' | 'motivo'): HTMLInputElement | HTMLTextAreaElement | null =>
  document.querySelector(`[aria-label="${label}"]`) ?? null;

const findButton = (text: string): HTMLButtonElement | null =>
  Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().startsWith(text),
  ) ?? null;

const setValue = async (
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
): Promise<void> => {
  if (!el) throw new Error('input missing');
  // Native input setter so React picks up the change event. The setter is
  // pulled off the prototype because React installs its own value-tracker
  // on the instance and bypassing that requires the prototype setter.
  const proto = Object.getPrototypeOf(el) as object;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) throw new Error('value setter missing');
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('AdminXpAdjustmentModal — submit gating', () => {
  it('disables submit until delta + reason valid', async () => {
    const onSubmit = vi.fn();
    await renderModal({ open: true, onClose: vi.fn(), onSubmit });

    const apply = findButton('Aplicar');
    if (!apply) throw new Error('Aplicar button missing');
    expect(apply.disabled).toBe(true);

    await setValue(findInput('delta'), '50');
    expect(findButton('Aplicar')?.disabled).toBe(true);

    await setValue(findInput('motivo'), 'Compensação');
    expect(findButton('Aplicar')?.disabled).toBe(false);
  });

  it('rejects delta = 0 client-side', async () => {
    const onSubmit = vi.fn();
    await renderModal({ open: true, onClose: vi.fn(), onSubmit });

    await setValue(findInput('delta'), '0');
    await setValue(findInput('motivo'), 'noop attempt');

    expect(findButton('Aplicar')?.disabled).toBe(true);
  });

  it('rejects non-integer delta client-side (1.5 must NOT submit)', async () => {
    const onSubmit = vi.fn();
    await renderModal({ open: true, onClose: vi.fn(), onSubmit });

    await setValue(findInput('delta'), '1.5');
    await setValue(findInput('motivo'), 'fractional attempt');
    expect(findButton('Aplicar')?.disabled).toBe(true);

    await setValue(findInput('delta'), '10abc');
    expect(findButton('Aplicar')?.disabled).toBe(true);
  });
});

describe('AdminXpAdjustmentModal — submit flow', () => {
  it('calls onSubmit + closes on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, data: { xp: 120 } });
    const onClose = vi.fn();
    await renderModal({ open: true, onClose, onSubmit });

    await setValue(findInput('delta'), '-25');
    await setValue(findInput('motivo'), 'Reversão fraude');

    const apply = findButton('Aplicar');
    if (!apply) throw new Error('Aplicar button missing');
    await act(async () => {
      apply.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({ delta: -25, reason: 'Reversão fraude' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders gamification_disabled error from server', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 409, code: 'gamification_disabled' });
    const onClose = vi.fn();
    await renderModal({ open: true, onClose, onSubmit });

    await setValue(findInput('delta'), '25');
    await setValue(findInput('motivo'), 'tentativa válida');

    const apply = findButton('Aplicar');
    if (!apply) throw new Error('Aplicar button missing');
    await act(async () => {
      apply.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/gamifica/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});
