import type { BoxConfirm } from '@ccc/shared/box';
import { useState } from 'react';

import { confirmBox } from '~/api/box';
import { ApiError } from '~/api/client';
import type { BoxConfirmResult } from '~/screens/caixa/confirm-result';

type UseBoxConfirmResult = {
  confirm: (input: BoxConfirm) => Promise<BoxConfirmResult>;
  confirming: boolean;
};

export function useBoxConfirm(): UseBoxConfirmResult {
  const [confirming, setConfirming] = useState(false);

  const confirm = async (input: BoxConfirm): Promise<BoxConfirmResult> => {
    setConfirming(true);
    try {
      await confirmBox(input);
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (e.status === 400 || code === 'bad_address') return 'bad_address';
        if (e.status === 409 || code === 'box_locked') return 'box_locked';
        if (e.status === 404 || code === 'box_not_open') return 'not_found';
      }
      return 'error';
    } finally {
      setConfirming(false);
    }
  };

  return { confirm, confirming };
}
