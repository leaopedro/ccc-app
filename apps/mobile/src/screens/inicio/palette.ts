// Paleta da tela de Início, derivada dos tokens de @ccc/design.
//
// Existe para o mesmo motivo de src/screens/assinaturas/tier-visual.ts: os
// componentes usam StyleSheet, não classes NativeWind, então precisam dos hex
// em runtime. A fonte da verdade é packages/design/src/tokens.ts; aqui só se
// dá nome curto ao que a tela usa.

import { color } from '@ccc/design';

export const p = {
  bg: color.bg,
  surface: color.surfaceGold,
  cream: color.textPrimary,
  gold: color.brand,
  goldDeep: color.goldDeep,
  goldLight: color.goldLight,
  hairline: color.hairlineGold,
  hairlineStrong: color.hairlineGoldStrong,
  muted60: 'rgba(242,232,216,0.6)',
  muted50: 'rgba(242,232,216,0.5)',
  muted45: 'rgba(242,232,216,0.45)',
} as const;
