'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { revokeAdminUserGarageSpotAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
  spotId: string;
  source: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
  disabled?: boolean;
}

export function RevokeGarageSpotButton({ userId, spotId, source, disabled }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDefaultFree = source === 'default_free';
  const blocked = disabled || isDefaultFree;

  const handle = () => {
    const msg =
      source === 'purchase'
        ? 'Reembolsar e remover esta vaga comprada?'
        : 'Remover esta vaga extra?';
    if (!confirm(msg)) return;
    startTransition(async () => {
      setError(null);
      const res = await revokeAdminUserGarageSpotAction(userId, spotId, {
        reason: source === 'purchase' ? 'manual_refund' : 'manual_cleanup',
      });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending || blocked}
        onClick={handle}
        className="text-xs text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        title={isDefaultFree ? 'Vagas free não podem ser removidas manualmente' : undefined}
      >
        {isPending ? '...' : 'Remover'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
