import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/check-in-actions', () => ({
  submitCheckIn: vi.fn(),
  submitExtraClaim: vi.fn(),
  submitVoucherClaim: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: vi.fn().mockImplementation(() => ({
    decodeFromConstraints: vi.fn().mockResolvedValue({ stop: vi.fn() }),
  })),
}));

import { isScanLocked, makeScanCallback, ScanResultOverlay, type ScanState } from './scanner';

import type {
  CheckInActionResult,
  ExtraClaimActionResult,
  VoucherClaimActionResult,
} from '~/lib/check-in-actions';

const noop = () => undefined;

const admittedResult: CheckInActionResult = {
  ok: true,
  ticketId: 't-1',
  result: 'admitted',
  holder: 'João Silva',
  tier: 'VIP',
  checkedInAt: '2026-05-13T20:00:00.000Z',
  car: null,
  licensePlate: null,
  extras: [],
  storePickup: [],
};

const alreadyUsedResult: CheckInActionResult = {
  ok: true,
  ticketId: 't-2',
  result: 'already_used',
  holder: 'Maria Santos',
  tier: 'Standard',
  checkedInAt: '2026-05-13T19:00:00.000Z',
  car: null,
  licensePlate: null,
  extras: [],
  storePickup: [],
};

const ticketErrorResult: CheckInActionResult = {
  ok: false,
  error: 'TicketNotFound',
  message: 'ticket not found',
};

const extraClaimedResult: ExtraClaimActionResult = {
  ok: true,
  result: 'claimed',
  name: 'Camiseta',
  holder: 'João Silva',
  tier: 'VIP',
  usedAt: null,
};

const extraAlreadyUsedResult: ExtraClaimActionResult = {
  ok: true,
  result: 'already_used',
  name: 'Camiseta',
  holder: 'João Silva',
  tier: 'VIP',
  usedAt: '2026-05-13T20:00:00.000Z',
};

const extraErrorResult: ExtraClaimActionResult = {
  ok: false,
  error: 'ExtraItemNotFound',
  message: 'extra not found',
};

const voucherClaimedResult: VoucherClaimActionResult = {
  ok: true,
  result: 'claimed',
  voucher: {
    id: 'v-1',
    orderId: 'o-1',
    orderShortId: 'ORD-001',
    status: 'used',
    usedAt: null,
    product: {
      title: 'Moletom JDM',
      variantName: 'M',
      variantSku: 'MOL-M',
      variantAttributes: null,
    },
    holder: { id: 'u-1', name: 'João Silva' },
    ticket: { id: 't-1', tier: { id: 'tier-1', name: 'VIP' } },
  },
};

const voucherErrorResult: VoucherClaimActionResult = {
  ok: false,
  error: 'VoucherNotFound',
  message: 'voucher not found',
};

describe('isScanLocked', () => {
  it('returns false when idle', () => {
    expect(isScanLocked({ kind: 'idle' })).toBe(false);
  });

  it('returns true when pending', () => {
    expect(isScanLocked({ kind: 'pending' })).toBe(true);
  });

  it('returns true when ticket result is showing', () => {
    const state: ScanState = { kind: 'ticket-result', data: admittedResult, code: 'abc' };
    expect(isScanLocked(state)).toBe(true);
  });

  it('returns true when extra result is showing', () => {
    const state: ScanState = { kind: 'extra-result', data: extraClaimedResult, code: 'e.abc' };
    expect(isScanLocked(state)).toBe(true);
  });

  it('returns true when voucher result is showing', () => {
    const state: ScanState = { kind: 'voucher-result', data: voucherClaimedResult, code: 'v.abc' };
    expect(isScanLocked(state)).toBe(true);
  });
});

describe('ScanResultOverlay', () => {
  it('renders nothing when idle', () => {
    const html = renderToStaticMarkup(
      <ScanResultOverlay state={{ kind: 'idle' }} eventId="evt-1" onDismiss={noop} />,
    );
    expect(html).toBe('');
  });

  it('renders overlay with absolute positioning when pending', () => {
    const html = renderToStaticMarkup(
      <ScanResultOverlay state={{ kind: 'pending' }} eventId="evt-1" onDismiss={noop} />,
    );
    expect(html).toContain('absolute inset-0');
    expect(html).toContain('Validando');
  });

  it('overlay covers camera frame — has absolute inset-0 class', () => {
    const states: ScanState[] = [
      { kind: 'pending' },
      { kind: 'ticket-result', data: admittedResult, code: 'abc' },
      { kind: 'extra-result', data: extraClaimedResult, code: 'e.abc' },
      { kind: 'voucher-result', data: voucherClaimedResult, code: 'v.abc' },
    ];
    for (const state of states) {
      const html = renderToStaticMarkup(
        <ScanResultOverlay state={state} eventId="evt-1" onDismiss={noop} />,
      );
      expect(html).toContain('absolute inset-0');
    }
  });

  describe('ticket results', () => {
    it('renders admitted state', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'ticket-result', data: admittedResult, code: 'abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Admitido');
      expect(html).toContain('João Silva');
      expect(html).toContain('VIP');
      expect(html).toContain('Escanear próximo');
    });

    it('renders already-used state', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'ticket-result', data: alreadyUsedResult, code: 'abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Ingresso já utilizado');
      expect(html).toContain('Escanear próximo');
    });

    it('renders ticket error', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'ticket-result', data: ticketErrorResult, code: 'abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Ingresso não encontrado');
      expect(html).toContain('Escanear próximo');
    });
  });

  describe('extra results', () => {
    it('renders claimed state', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'extra-result', data: extraClaimedResult, code: 'e.abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Extra entregue');
      expect(html).toContain('Camiseta');
      expect(html).toContain('Escanear próximo');
    });

    it('renders already-used state', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'extra-result', data: extraAlreadyUsedResult, code: 'e.abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Extra já entregue');
      expect(html).toContain('Escanear próximo');
    });

    it('renders extra error', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'extra-result', data: extraErrorResult, code: 'e.abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Extra não encontrado');
      expect(html).toContain('Escanear próximo');
    });
  });

  describe('voucher results', () => {
    it('renders claimed state', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'voucher-result', data: voucherClaimedResult, code: 'v.abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Voucher entregue');
      expect(html).toContain('Moletom JDM');
      expect(html).toContain('João Silva');
      expect(html).toContain('Escanear próximo');
    });

    it('renders voucher error', () => {
      const html = renderToStaticMarkup(
        <ScanResultOverlay
          state={{ kind: 'voucher-result', data: voucherErrorResult, code: 'v.abc' }}
          eventId="evt-1"
          onDismiss={noop}
        />,
      );
      expect(html).toContain('Voucher não encontrado');
      expect(html).toContain('Escanear próximo');
    });
  });
});

describe('makeScanCallback — decode lock behavior', () => {
  it('ignores a second QR scan while the lock is active', () => {
    const stateRef: { current: ScanState } = { current: { kind: 'idle' } };
    const lastScanRef: { current: { code: string; at: number } | null } = { current: null };
    const onScan = vi.fn();
    const cb = makeScanCallback(stateRef, lastScanRef, onScan);

    cb({ getText: () => 'QR-1' });
    expect(onScan).toHaveBeenCalledOnce();
    expect(stateRef.current.kind).toBe('pending');

    cb({ getText: () => 'QR-2' });
    expect(onScan).toHaveBeenCalledOnce();
  });

  it('allows the same QR again after dismiss resets stateRef and lastScanRef', () => {
    const stateRef: { current: ScanState } = { current: { kind: 'idle' } };
    const lastScanRef: { current: { code: string; at: number } | null } = { current: null };
    const onScan = vi.fn();
    const cb = makeScanCallback(stateRef, lastScanRef, onScan);

    cb({ getText: () => 'QR-1' });
    expect(onScan).toHaveBeenCalledOnce();

    stateRef.current = { kind: 'idle' };
    lastScanRef.current = null;

    cb({ getText: () => 'QR-1' });
    expect(onScan).toHaveBeenCalledTimes(2);
  });
});
