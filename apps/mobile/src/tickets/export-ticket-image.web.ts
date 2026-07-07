import type { RefObject } from 'react';
import type { View } from 'react-native';

export type ExportResult = 'shared' | 'saved' | 'printed' | 'permission_denied' | 'error';

export function exportTicketImage(_ref: RefObject<View | null>): Promise<ExportResult> {
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    return Promise.resolve('error');
  }
  try {
    window.print();
    return Promise.resolve('printed');
  } catch {
    return Promise.resolve('error');
  }
}
