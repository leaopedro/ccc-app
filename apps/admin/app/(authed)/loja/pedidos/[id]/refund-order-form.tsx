'use client';

import type { AdminOrderRefund } from '@ccc/shared/admin';
import type { OrderStatus } from '@ccc/shared/orders';
import { useState, useTransition } from 'react';

import { requestOrderRefundAction } from '~/lib/store-orders-actions';

type Props = {
  orderId: string;
  status: OrderStatus;
  provider: 'stripe' | 'abacatepay';
  siblingOrderCount?: number;
  siblingTicketCount?: number;
  onDone?: () => void;
};

const REASON_MIN_LENGTH = 10;

export const RefundOrderForm = ({
  orderId,
  status,
  provider,
  siblingOrderCount = 0,
  siblingTicketCount = 0,
  onDone,
}: Props) => {
  const [reason, setReason] = useState('');
  const [amountCents, setAmountCents] = useState('');
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    { kind: 'requested' } | { kind: 'error'; message: string } | null
  >(null);

  if (provider !== 'stripe') {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Reembolso de Pix vai pelo suporte da AbacatePay, manualmente.
      </p>
    );
  }

  if (status !== 'paid') {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Só pedidos pagos podem ser reembolsados por aqui.
      </p>
    );
  }

  const canSubmit = reason.trim().length >= REASON_MIN_LENGTH && !isPending;
  const hasSiblings = siblingOrderCount > 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (reason.trim().length < REASON_MIN_LENGTH) return;

    const confirmMessage = hasSiblings
      ? `Este pedido faz parte de um carrinho com mais ${siblingOrderCount} pedido(s). ` +
        `Reembolsar aqui pode revogar ${siblingTicketCount} ingresso(s) válido(s) desses outros ` +
        `pedidos quando o webhook confirmar. Solicitar reembolso mesmo assim?`
      : 'Solicitar reembolso deste pedido à Stripe? Essa ação move dinheiro de verdade e não pode ser desfeita por aqui.';
    // Same confirm() pattern as RevokeGarageSpotButton — no dialog component
    // for destructive actions exists elsewhere in this app.
    if (!window.confirm(confirmMessage)) return;

    const trimmedAmount = amountCents.trim();
    // exactOptionalPropertyTypes: omit the key entirely for a full refund
    // rather than setting it to `undefined` explicitly.
    const input: AdminOrderRefund =
      trimmedAmount === ''
        ? { reason: reason.trim() }
        : { reason: reason.trim(), amountCents: Number(trimmedAmount) };
    startTransition(async () => {
      setOutcome(null);
      const result = await requestOrderRefundAction(orderId, input);
      if (result.ok) {
        setOutcome({ kind: 'requested' });
        onDone?.();
      } else {
        setOutcome({ kind: 'error', message: result.error });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {hasSiblings ? (
        <p
          role="alert"
          className="rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-300"
        >
          Este pedido está num carrinho com mais {siblingOrderCount} pedido(s) e{' '}
          {siblingTicketCount} ingresso(s) válido(s) nesses outros pedidos. Um reembolso total aqui
          revoga esses ingressos também, quando o webhook confirmar — não só os itens deste pedido.
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[color:var(--color-muted)]">Motivo do reembolso</span>
        <textarea
          aria-label="Motivo do reembolso"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={REASON_MIN_LENGTH}
          maxLength={500}
          rows={3}
          required
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[color:var(--color-muted)]">
          Valor parcial em centavos (opcional)
        </span>
        <input
          aria-label="Valor parcial em centavos"
          value={amountCents}
          onChange={(e) => setAmountCents(e.target.value)}
          inputMode="numeric"
          placeholder="Deixe em branco para reembolso total"
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
        />
        <span className="text-xs text-[color:var(--color-muted)]">
          Reembolso parcial hoje <strong>não</strong> vira status de reembolsado. O webhook só
          alerta. Use total, a menos que saiba o que está fazendo.
        </span>
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isPending ? 'Solicitando…' : 'Solicitar reembolso'}
      </button>

      <p className="text-xs text-[color:var(--color-muted)]">
        O status do pedido só muda quando o webhook <code>charge.refunded</code> chegar. Confirme no
        pedido, não no dashboard.
      </p>

      {outcome?.kind === 'requested' ? (
        <p role="status" className="text-sm text-emerald-400">
          Reembolso solicitado à Stripe. O pedido continua &quot;pago&quot; até o webhook confirmar.
        </p>
      ) : null}
      {outcome?.kind === 'error' ? (
        <p role="alert" className="text-sm text-red-400">
          {outcome.message}
        </p>
      ) : null}
    </form>
  );
};
