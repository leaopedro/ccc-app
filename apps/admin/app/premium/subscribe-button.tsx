'use client';

import { brand } from '@ccc/design';
import { useTransition } from 'react';

import { subscribeAction } from './actions';

export function SubscribeButton({ cadence }: { cadence: 'monthly' | 'annual' }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            const url = await subscribeAction(cadence);
            window.location.href = url;
          } catch {
            // TODO: surface toast on error in Phase F8.1.
          }
        });
      }}
      className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
      style={{ background: brand.color.brand, color: '#0A0A0A' }}
    >
      {isPending ? 'Aguarde...' : 'Assinar'}
    </button>
  );
}
