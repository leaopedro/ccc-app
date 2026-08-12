import type { BoxPreferences } from '@ccc/shared/box';
import { useState } from 'react';

import { setBoxPreferences } from '~/api/box';
import { ApiError } from '~/api/client';

type SaveResult = 'ok' | 'bad_address' | 'box_locked' | 'error';

type UseBoxPreferencesResult = {
  save: (input: BoxPreferences) => Promise<SaveResult>;
  saving: boolean;
};

export function useBoxPreferences(): UseBoxPreferencesResult {
  const [saving, setSaving] = useState(false);

  const save = async (input: BoxPreferences): Promise<SaveResult> => {
    setSaving(true);
    try {
      await setBoxPreferences(input);
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (e.status === 400 || code === 'bad_address') return 'bad_address';
        if (e.status === 409 || code === 'box_locked') return 'box_locked';
      }
      return 'error';
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
}
