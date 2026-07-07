'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { grantAdminUserGarageSpotAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
}

export function GrantGarageSpotButton({ userId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    if (!confirm('Conceder uma vaga extra (admin_grant)?')) return;
    startTransition(async () => {
      setError(null);
      const res = await grantAdminUserGarageSpotAction(userId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handle}
        className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)] disabled:opacity-50"
      >
        {isPending ? 'Adicionando…' : '+ Vaga extra'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
