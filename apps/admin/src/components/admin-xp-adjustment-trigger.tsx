'use client';

import type { AdminXpAdjustmentInput } from '@jdm/shared/admin-garage-xp';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import {
  AdminXpAdjustmentModal,
  type AdminXpAdjustmentSubmitResult,
} from './admin-xp-adjustment-modal';

import { adjustAdminUserGarageXpAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
}

/**
 * Client wrapper that owns the modal `open` state and wires submission
 * through the chunk-35 server action. The action handles re-validation +
 * `revalidatePath`; we call `router.refresh()` defensively so the in-flight
 * page (e.g. the Garagem panel) re-fetches the post-adjustment xp.
 */
export function AdminXpAdjustmentTrigger({ userId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleSubmit = useCallback(
    async (input: AdminXpAdjustmentInput): Promise<AdminXpAdjustmentSubmitResult> => {
      const result = await adjustAdminUserGarageXpAction(userId, input);
      if (result.ok) router.refresh();
      return result;
    },
    [router, userId],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
      >
        Ajustar XP
      </button>
      <AdminXpAdjustmentModal
        userId={userId}
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
    </>
  );
}
