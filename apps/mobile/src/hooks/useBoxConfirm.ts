import type { BoxConfirm, BoxView } from '@ccc/shared/box';
import { useState } from 'react';

import { confirmBox } from '~/api/box';
import { ApiError } from '~/api/client';
import type { BoxConfirmResult } from '~/screens/caixa/confirm-result';

// The confirmed box is returned on success so the caller can route on the
// authoritative post-confirm charge (confirm adds shipping and can drop
// out-of-stock lines, so chargeCents can change from the pre-confirm value).
type ConfirmOutcome = { result: BoxConfirmResult; box: BoxView | null };

type UseBoxConfirmResult = {
  confirm: (input: BoxConfirm) => Promise<ConfirmOutcome>;
  confirming: boolean;
};

export function useBoxConfirm(): UseBoxConfirmResult {
  const [confirming, setConfirming] = useState(false);

  const confirm = async (input: BoxConfirm): Promise<ConfirmOutcome> => {
    setConfirming(true);
    try {
      const box = await confirmBox(input);
      return { result: 'ok', box };
    } catch (e) {
      let result: BoxConfirmResult = 'error';
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (e.status === 400 || code === 'bad_address') result = 'bad_address';
        else if (e.status === 409 || code === 'box_locked') result = 'box_locked';
        else if (e.status === 404 || code === 'box_not_open') result = 'not_found';
      }
      return { result, box: null };
    } finally {
      setConfirming(false);
    }
  };

  return { confirm, confirming };
}
