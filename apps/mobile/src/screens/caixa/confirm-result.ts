// Caixa — Revisão screen: maps useBoxConfirm().confirm() results to the copy +
// UI region that should surface them. Pure so the branching is unit-testable
// without rendering the screen.

import { caixaCopy } from '~/copy/caixa';

export type BoxConfirmResult = 'ok' | 'bad_address' | 'box_locked' | 'not_found' | 'error';

export type ConfirmFeedback =
  | { kind: 'address_error'; message: string }
  | { kind: 'error'; message: string };

export function mapConfirmError(result: Exclude<BoxConfirmResult, 'ok'>): ConfirmFeedback {
  switch (result) {
    case 'bad_address':
      return { kind: 'address_error', message: caixaCopy.review.addressInvalid };
    case 'box_locked':
      return { kind: 'error', message: caixaCopy.review.locked };
    case 'not_found':
      return { kind: 'error', message: caixaCopy.review.confirmError };
    case 'error':
      return { kind: 'error', message: caixaCopy.review.confirmError };
  }
}
