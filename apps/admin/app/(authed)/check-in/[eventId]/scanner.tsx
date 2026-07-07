'use client';

import type { CheckInExtraItem, StorePickupOrder } from '@jdm/shared/check-in';
import { PremiumBadge } from '@jdm/ui/web';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import React, { useEffect, useRef, useState } from 'react';

import {
  submitCheckIn,
  submitExtraClaim,
  submitVoucherClaim,
  type CheckInActionResult,
  type ExtraClaimActionResult,
  type VoucherClaimActionResult,
} from '~/lib/check-in-actions';

export type ScanState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ticket-result'; data: CheckInActionResult; code: string }
  | { kind: 'extra-result'; data: ExtraClaimActionResult; code: string }
  | { kind: 'voucher-result'; data: VoucherClaimActionResult; code: string };

const RESCAN_COOLDOWN_MS = 5000;

export function isScanLocked(state: ScanState): boolean {
  return state.kind !== 'idle';
}

export function makeScanCallback(
  stateRef: { current: ScanState },
  lastScanRef: { current: { code: string; at: number } | null },
  onScan: (code: string) => unknown,
): (res: { getText: () => string } | null) => void {
  return (res) => {
    if (!res) return;
    if (stateRef.current.kind !== 'idle') return;
    const code = res.getText();
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === code && now - last.at < RESCAN_COOLDOWN_MS) return;
    stateRef.current = { kind: 'pending' };
    lastScanRef.current = { code, at: now };
    onScan(code);
  };
}

function isExtraCode(code: string): boolean {
  return code.startsWith('e.');
}

function isVoucherCode(code: string): boolean {
  return code.startsWith('v.');
}

function mapCameraError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Permissão de câmera negada. Habilite o acesso nas configurações do navegador e recarregue a página.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Nenhuma câmera compatível detectada neste dispositivo.';
      case 'NotReadableError':
        return 'Câmera está em uso por outro aplicativo. Feche-o e tente novamente.';
      default:
        return err.message || 'Falha ao iniciar câmera.';
    }
  }
  return 'Falha ao iniciar câmera.';
}

export function ScanResultOverlay({
  state,
  eventId,
  onDismiss,
}: {
  state: ScanState;
  eventId: string;
  onDismiss: () => void;
}) {
  if (state.kind === 'idle') return null;
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto rounded bg-black/70 p-4">
      {state.kind === 'pending' && <p className="text-white opacity-80">Validando…</p>}
      {state.kind === 'ticket-result' && (
        <TicketResultCard data={state.data} eventId={eventId} onDismiss={onDismiss} />
      )}
      {state.kind === 'extra-result' && <ExtraResultCard data={state.data} onDismiss={onDismiss} />}
      {state.kind === 'voucher-result' && (
        <VoucherResultCard data={state.data} onDismiss={onDismiss} />
      )}
    </div>
  );
}

export function Scanner({ eventId }: { eventId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'idle' });
  const stateRef = useRef<ScanState>({ kind: 'idle' });
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let controls: IScannerControls | null = null;
    const reader = new BrowserMultiFormatReader();

    const handleScan = async (code: string) => {
      setState({ kind: 'pending' });
      if (isVoucherCode(code)) {
        const data = await submitVoucherClaim(code, eventId);
        const next: ScanState = { kind: 'voucher-result', data, code };
        stateRef.current = next;
        setState(next);
      } else if (isExtraCode(code)) {
        const data = await submitExtraClaim(code, eventId);
        const next: ScanState = { kind: 'extra-result', data, code };
        stateRef.current = next;
        setState(next);
      } else {
        const data = await submitCheckIn(code, eventId);
        const next: ScanState = { kind: 'ticket-result', data, code };
        stateRef.current = next;
        setState(next);
      }
    };

    const start = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          typeof window !== 'undefined' && !window.isSecureContext
            ? 'Câmera requer conexão segura (HTTPS). Acesse pela URL https://.'
            : 'Este navegador não suporta acesso à câmera.',
        );
        return;
      }
      try {
        const guard = makeScanCallback(stateRef, lastScanRef, handleScan);
        const next = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (res) => {
            if (stopped || !res) return;
            guard(res);
          },
        );
        if (stopped) {
          next.stop();
          return;
        }
        controls = next;
      } catch (err) {
        setCameraError(mapCameraError(err));
      }
    };

    void start();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [eventId]);

  const dismiss = () => {
    stateRef.current = { kind: 'idle' };
    lastScanRef.current = null;
    setState({ kind: 'idle' });
  };

  return (
    <div className="flex flex-col gap-4">
      {cameraError ? (
        <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{cameraError}</p>
      ) : null}
      <div className="relative w-full max-w-md">
        <video
          ref={videoRef}
          className="w-full rounded border border-[color:var(--color-border)] bg-black"
          muted
          playsInline
        />
        <ScanResultOverlay state={state} eventId={eventId} onDismiss={dismiss} />
      </div>
      {state.kind === 'idle' && (
        <p className="opacity-80">Aponte para o QR code do ingresso, extra ou voucher.</p>
      )}
    </div>
  );
}

function TicketResultCard({
  data,
  eventId,
  onDismiss,
}: {
  data: CheckInActionResult;
  eventId: string;
  onDismiss: () => void;
}) {
  const [extras, setExtras] = useState<CheckInExtraItem[]>(data.ok ? data.extras : []);

  if (!data.ok) {
    const human = friendlyError(data.error);
    return (
      <div className="rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-lg font-semibold">{human.title}</p>
        <p className="text-sm opacity-80">{human.subtitle ?? data.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    );
  }

  const admitted = data.result === 'admitted';

  const [claimError, setClaimError] = useState<string | null>(null);

  const handleClaim = async (extra: CheckInExtraItem) => {
    setClaimError(null);
    const result = await submitExtraClaim(extra.code, eventId);
    if (result.ok) {
      setExtras((prev) =>
        prev.map((e) =>
          e.id === extra.id ? { ...e, status: 'used' as const, usedAt: result.usedAt } : e,
        ),
      );
    } else {
      setClaimError(`${extra.name}: ${result.message}`);
    }
  };

  return (
    <div
      className={
        admitted
          ? 'rounded border border-green-500/40 bg-green-500/10 p-4'
          : 'rounded border border-amber-500/40 bg-amber-500/10 p-4'
      }
    >
      <p className="text-lg font-semibold">{admitted ? 'Admitido' : 'Ingresso já utilizado'}</p>
      <p>
        {data.holder} · {data.tier}
      </p>
      {data.car ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Carro: {data.car.make} {data.car.model} {data.car.year}
            {data.licensePlate ? ` — placa ${data.licensePlate}` : ''}
          </span>
          <PremiumBadge isPremiumActive={data.car.isPremiumActive} />
        </p>
      ) : null}
      {!admitted ? (
        <p className="text-sm opacity-80">
          Utilizado em {new Date(data.checkedInAt).toLocaleString('pt-BR')}
        </p>
      ) : null}

      {claimError && (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {claimError}
        </p>
      )}

      {extras.length > 0 && <ExtrasPanel extras={extras} onClaim={handleClaim} />}

      {data.storePickup.length > 0 && <StorePickupPanel orders={data.storePickup} />}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    </div>
  );
}

function ExtrasPanel({
  extras,
  onClaim,
}: {
  extras: CheckInExtraItem[];
  onClaim: (extra: CheckInExtraItem) => Promise<void>;
}) {
  return (
    <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
      <p className="mb-2 text-sm font-semibold">Extras</p>
      <ul className="flex flex-col gap-2">
        {extras.map((extra) => (
          <ExtraRow key={extra.id} extra={extra} onClaim={onClaim} />
        ))}
      </ul>
    </div>
  );
}

function ExtraRow({
  extra,
  onClaim,
}: {
  extra: CheckInExtraItem;
  onClaim: (extra: CheckInExtraItem) => Promise<void>;
}) {
  const [claiming, setClaiming] = useState(false);
  const used = extra.status === 'used';
  const revoked = extra.status === 'revoked';

  const handleClick = () => {
    setClaiming(true);
    void onClaim(extra).finally(() => setClaiming(false));
  };

  return (
    <li
      className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
        used
          ? 'border-gray-400/30 bg-gray-400/10 opacity-60'
          : revoked
            ? 'border-red-400/30 bg-red-400/10 opacity-60'
            : 'border-[color:var(--color-border)]'
      }`}
    >
      <div>
        <span className="font-medium">{extra.name}</span>
        {used && extra.usedAt ? (
          <span className="ml-2 text-xs opacity-70">
            entregue {new Date(extra.usedAt).toLocaleString('pt-BR')}
          </span>
        ) : null}
        {revoked ? <span className="ml-2 text-xs opacity-70">revogado</span> : null}
      </div>
      {!used && !revoked && (
        <button
          type="button"
          disabled={claiming}
          onClick={handleClick}
          className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {claiming ? '…' : 'Marcar entregue'}
        </button>
      )}
    </li>
  );
}

function ExtraResultCard({
  data,
  onDismiss,
}: {
  data: ExtraClaimActionResult;
  onDismiss: () => void;
}) {
  if (!data.ok) {
    const human = friendlyExtraError(data.error);
    return (
      <div className="rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-lg font-semibold">{human.title}</p>
        <p className="text-sm opacity-80">{human.subtitle ?? data.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    );
  }

  const claimed = data.result === 'claimed';
  return (
    <div
      className={
        claimed
          ? 'rounded border border-green-500/40 bg-green-500/10 p-4'
          : 'rounded border border-amber-500/40 bg-amber-500/10 p-4'
      }
    >
      <p className="text-lg font-semibold">{claimed ? 'Extra entregue' : 'Extra já entregue'}</p>
      <p>
        {data.name} · {data.holder}
      </p>
      <p className="text-sm opacity-80">{data.tier}</p>
      {!claimed && data.usedAt ? (
        <p className="text-sm opacity-80">
          Entregue em {new Date(data.usedAt).toLocaleString('pt-BR')}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    </div>
  );
}

function StorePickupPanel({ orders }: { orders: StorePickupOrder[] }) {
  return (
    <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
      <p className="mb-2 text-sm font-semibold">Retirada na loja</p>
      <p className="mb-2 text-xs opacity-70">
        Para entregar produtos, escaneie o voucher individual de cada item.
      </p>
      {orders.map((order) => (
        <div key={order.orderId} className="mb-3">
          <p className="mb-1 text-xs opacity-70">Pedido #{order.shortId}</p>
          <ul className="flex flex-col gap-1">
            {order.items.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.productTitle ?? 'Produto'}</span>
                {item.variantName ? (
                  <span className="ml-1 opacity-70"> — {item.variantName}</span>
                ) : null}
                {item.variantSku ? (
                  <span className="ml-1 text-xs opacity-50">SKU: {item.variantSku}</span>
                ) : null}
                {item.variantAttributes
                  ? Object.entries(item.variantAttributes).map(([k, v]) => (
                      <span key={k} className="ml-1 text-xs opacity-60">
                        {k}: {v}
                      </span>
                    ))
                  : null}
                <span className="ml-2 opacity-60">× {item.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VoucherResultCard({
  data,
  onDismiss,
}: {
  data: VoucherClaimActionResult;
  onDismiss: () => void;
}) {
  if (!data.ok) {
    const human = friendlyVoucherError(data.error);
    return (
      <div className="rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-lg font-semibold">{human.title}</p>
        <p className="text-sm opacity-80">{human.subtitle ?? data.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    );
  }

  const claimed = data.result === 'claimed';
  const { voucher } = data;
  const attrs = voucher.product.variantAttributes
    ? Object.entries(voucher.product.variantAttributes)
    : [];
  return (
    <div
      className={
        claimed
          ? 'rounded border border-green-500/40 bg-green-500/10 p-4'
          : 'rounded border border-amber-500/40 bg-amber-500/10 p-4'
      }
    >
      <p className="text-lg font-semibold">
        {claimed ? 'Voucher entregue' : 'Voucher já entregue'}
      </p>
      <p className="text-sm">
        <span className="font-medium">{voucher.product.title ?? 'Produto'}</span>
        {voucher.product.variantName ? (
          <span className="ml-1 opacity-70"> — {voucher.product.variantName}</span>
        ) : null}
      </p>
      {voucher.product.variantSku ? (
        <p className="text-xs opacity-70">SKU: {voucher.product.variantSku}</p>
      ) : null}
      {attrs.length > 0 ? (
        <p className="text-xs opacity-70">{attrs.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
      ) : null}
      <p className="mt-2 text-sm">
        {voucher.holder.name} · {voucher.ticket.tier.name}
      </p>
      <p className="text-xs opacity-70">Pedido #{voucher.orderShortId}</p>
      {!claimed && voucher.usedAt ? (
        <p className="text-sm opacity-80">
          Entregue em {new Date(voucher.usedAt).toLocaleString('pt-BR')}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    </div>
  );
}

function friendlyError(code: string): { title: string; subtitle?: string } {
  switch (code) {
    case 'InvalidTicketCode':
      return { title: 'QR inválido', subtitle: 'Este código não é um ingresso válido.' };
    case 'TicketNotFound':
      return { title: 'Ingresso não encontrado' };
    case 'TicketWrongEvent':
      return {
        title: 'Evento errado',
        subtitle: 'Este ingresso é de outro evento.',
      };
    case 'TicketRevoked':
      return { title: 'Ingresso revogado' };
    default:
      return { title: 'Erro', subtitle: code };
  }
}

function friendlyExtraError(code: string): { title: string; subtitle?: string } {
  switch (code) {
    case 'InvalidExtraCode':
      return { title: 'QR inválido', subtitle: 'Este código não é um extra válido.' };
    case 'ExtraItemNotFound':
      return { title: 'Extra não encontrado' };
    case 'ExtraWrongEvent':
      return {
        title: 'Evento errado',
        subtitle: 'Este extra é de outro evento.',
      };
    case 'ExtraItemRevoked':
      return { title: 'Extra revogado' };
    default:
      return { title: 'Erro', subtitle: code };
  }
}

function friendlyVoucherError(code: string): { title: string; subtitle?: string } {
  switch (code) {
    case 'InvalidVoucherCode':
      return { title: 'QR inválido', subtitle: 'Este código não é um voucher válido.' };
    case 'VoucherNotFound':
      return { title: 'Voucher não encontrado' };
    case 'VoucherWrongEvent':
      return {
        title: 'Evento errado',
        subtitle: 'Este voucher é de outro evento.',
      };
    case 'VoucherRevoked':
      return { title: 'Voucher revogado' };
    default:
      return { title: 'Erro', subtitle: code };
  }
}
