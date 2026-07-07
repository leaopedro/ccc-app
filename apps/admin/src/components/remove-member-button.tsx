'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { removeGroupMemberAction } from '~/lib/admin-group-actions';

interface Props {
  groupId: string;
  userId: string;
  userName: string;
}

export function RemoveMemberButton({ groupId, userId, userName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    if (!confirm(`Remover ${userName} do grupo?`)) return;
    startTransition(async () => {
      setError(null);
      const result = await removeGroupMemberAction(groupId, userId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handle}
        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        {isPending ? '...' : 'Remover'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
