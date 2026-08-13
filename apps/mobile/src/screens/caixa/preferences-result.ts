// Caixa — Preferências screen: maps useBoxPreferences().save() results to the
// copy + UI region that should surface them. Kept as a pure function so the
// branching (4 outcomes) is unit-testable without rendering the screen.

import { caixaCopy } from '~/copy/caixa';

export type BoxPreferencesSaveResult = 'ok' | 'bad_address' | 'box_locked' | 'error';

export type PreferencesSaveFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'address_error'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'error'; message: string };

export function mapSaveResult(result: BoxPreferencesSaveResult): PreferencesSaveFeedback {
  switch (result) {
    case 'ok':
      return { kind: 'success', message: caixaCopy.preferences.saved };
    case 'bad_address':
      return { kind: 'address_error', message: caixaCopy.preferences.addressInvalid };
    case 'box_locked':
      return { kind: 'locked', message: caixaCopy.preferences.locked.title };
    case 'error':
      return { kind: 'error', message: caixaCopy.preferences.saveError };
  }
}
