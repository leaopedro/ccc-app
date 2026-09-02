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
  /**
   * Valid tickets on THIS order, which the `charge.refunded` cascade revokes
   * too. Usually 0 for a store order, which is why the first version of this
   * form only spoke about siblings. For a ticket order it is the whole blast
   * radius: "0 outros pedidos" alone reads as "nothing else happens", while
   * the buyer's QR is about to stop working.
   */
  ownTicketCount?: number;
  onDone?: () => void;
};

const REASON_MIN_LENGTH = 10;

/**
 * One description of the blast radius, used verbatim by the banner and the
 * confirm dialog. They must never disagree: the banner is what the operator
 * reads, the confirm is what they act on.
 */
const impactSentences = (
  siblingOrderCount: number,
  siblingTicketCount: number,
  ownTicketCount: number,
): string[] => {
  const parts: string[] = [];
  if (ownTicketCount > 0) {
    parts.push(
      `Reembolsar revoga ${ownTicketCount} ingresso(s) válido(s) deste pedido quando o webhook confirmar.`,
    );
  }
  if (siblingOrderCount > 0) {
    parts.push(
      `Este pedido está num carrinho com mais ${siblingOrderCount} pedido(s) e ${siblingTicketCount} ingresso(s) válido(s) nesses outros pedidos. Um reembolso total aqui revoga esses ingressos também, quando o webhook confirmar — não só os itens deste pedido.`,
    );
  }
  return parts;
};

export const RefundOrderForm = ({
  orderId,
  status,
  provider,
  siblingOrderCount = 0,
  siblingTicketCount = 0,
  ownTicketCount = 0,
  onDone,
}: Props) => {
  const [reason, setReason] = useState('');
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
  const impact = impactSentences(siblingOrderCount, siblingTicketCount, ownTicketCount);
  const hasImpact = impact.length > 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (reason.trim().length < REASON_MIN_LENGTH) return;

    const confirmMessage = hasImpact
      ? `${impact.join(' ')} Solicitar reembolso mesmo assim?`
      : 'Solicitar reembolso deste pedido à Stripe? Essa ação move dinheiro de verdade e não pode ser desfeita por aqui.';
    // Same confirm() pattern as RevokeGarageSpotButton — no dialog component
    // for destructive actions exists elsewhere in this app.
    if (!window.confirm(confirmMessage)) return;

    // Always a full refund, so `amountCents` is never sent. The route
    // (apps/api/src/routes/admin/refunds.ts) 422s any value other than the
    // order's exact total since commit 96205f7, so the partial-amount input
    // this form used to render could only produce an error or a redundant
    // full refund. exactOptionalPropertyTypes: the key is omitted entirely,
    // not set to undefined.
    const input: AdminOrderRefund = { reason: reason.trim() };
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
      {hasImpact ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-300"
        >
          {impact.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
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

      <p className="text-xs text-[color:var(--color-muted)]">
        Este formulário só faz reembolso <strong>total</strong>. Para um valor parcial, use o
        dashboard da Stripe diretamente.
      </p>

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
