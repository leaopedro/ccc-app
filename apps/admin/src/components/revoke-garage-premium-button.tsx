'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setAdminUserGaragePremiumAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
}

export function RevokeGaragePremiumButton({ userId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    if (!confirm('Revogar premium desta garagem?')) return;
    startTransition(async () => {
      setError(null);
      const res = await setAdminUserGaragePremiumAction(userId, {
        tier: null,
        premiumUntil: null,
      });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handle}
        className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
      >
        {isPending ? 'Revogando…' : 'Revogar premium'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
